/**
 * ============================================================================
 * COMPANY CONFIGURATION API - 100% ISOLATED FROM LEGACY
 * ============================================================================
 * 
 * PURPOSE: Backend API for AI Agent Settings tab
 * ISOLATION: Zero dependencies on legacy AI Agent Logic routes
 * 
 * ENDPOINTS:
 * - GET    /api/company/:companyId/configuration
 * - GET    /api/company/:companyId/configuration/variables
 * - PATCH  /api/company/:companyId/configuration/variables
 * - POST   /api/company/:companyId/configuration/variables/scan      [NEW]
 * - POST   /api/company/:companyId/configuration/variables/validate  [NEW]
 * - GET    /api/company/:companyId/configuration/variables/:key/usage
 * - GET    /api/company/:companyId/configuration/filler-words
 * - POST   /api/company/:companyId/configuration/filler-words
 * - DELETE /api/company/:companyId/configuration/filler-words/:word
 * - POST   /api/company/:companyId/configuration/filler-words/reset
 * - GET    /api/company/:companyId/configuration/scenarios
 * - GET    /api/company/:companyId/configuration/template-info
 * - POST   /api/company/:companyId/configuration/sync
 * - GET    /api/company/:companyId/configuration/analytics
 * 
 * ============================================================================
 */

const express = require('express');
const logger = require('../../utils/logger.js');

const router = express.Router();
const mongoose = require('mongoose');
const Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const IdempotencyLog = require('../../models/IdempotencyLog');
const AuditLog = require('../../models/AuditLog');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const ConfigurationReadinessService = require('../../services/ConfigurationReadinessService');
const { generatePreviewToken, verifyPreviewToken } = require('../../utils/previewToken');
const { validate } = require('../../utils/variableValidators');
const { redisClient } = require('../../db');

// Apply authentication AND multi-tenant access control to all routes
router.use(authenticateJWT);
router.use(requireCompanyAccess);

/**
 * ============================================================================
 * HELPER: Clear Redis Cache for Company
 * ============================================================================
 * CRITICAL: Mongoose + Redis architecture requires explicit cache invalidation
 * after ANY write operation to company data
 * ============================================================================
 */
async function clearCompanyCache(companyId, context = '') {
    try {
        if (redisClient && redisClient.isOpen) {
            await redisClient.del(`company:${companyId}`);
            logger.debug(`✅ [CACHE CLEAR] ${context} - Cleared Redis cache for company:${companyId}`);
            return true;
        } 
            logger.warn(`⚠️ [CACHE CLEAR] ${context} - Redis client not available`);
            return false;
        
    } catch (error) {
        logger.error(`❌ [CACHE CLEAR] ${context} - Failed:`, error.message);
        // Non-fatal error - don't block the response
        return false;
    }
}

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration
 * Load complete configuration (overview)
 * ============================================================================
 */
router.get('/:companyId/configuration', async (req, res) => {
    logger.info(`[COMPANY CONFIG] GET /configuration for company: ${req.params.companyId}`);
    
    try {
        // 🔧 FIX: Use .lean() to bypass Mongoose validation of corrupt data
        const company = await Company.findById(req.params.companyId).lean();
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        logger.info(`[COMPANY CONFIG] Company found: ${company.companyName}`);
        logger.info(`[COMPANY CONFIG] Has configuration:`, Boolean(company.configuration));
        logger.debug(`[COMPANY CONFIG] Configuration type:`, typeof company.configuration);
        
        // FIX: Ensure configuration is an object (migration fix)
        if (!company.configuration || typeof company.configuration !== 'object' || Array.isArray(company.configuration)) {
            logger.debug(`[COMPANY CONFIG] MIGRATION: Initializing configuration object`);
            company.configuration = {};
        }
        
        // Return configuration overview
        const config = {
            variables: company.configuration?.variables || {},
            variablesStatus: calculateVariablesStatus(company),
            fillerWords: {
                inherited: company.configuration?.fillerWords?.inherited || [],
                custom: company.configuration?.fillerWords?.custom || [],
                active: [
                    ...(company.configuration?.fillerWords?.inherited || []),
                    ...(company.configuration?.fillerWords?.custom || [])
                ]
            },
            clonedFrom: company.configuration?.clonedFrom || null,
            lastSyncedAt: company.configuration?.lastSyncedAt || null
        };
        
        logger.debug(`[COMPANY CONFIG] Configuration loaded successfully`);
        res.json(config);
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error loading configuration:', error);
        logger.error('[COMPANY CONFIG] Error stack:', error.stack);
        res.status(500).json({ 
            error: 'Failed to load configuration',
            message: error.message
        });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/variables
 * Load variables and their definitions
 * 
 * REFACTORED: Now uses CompanyVariablesService (canonical source)
 * - Reads from: aiAgentSettings.variableDefinitions + aiAgentSettings.variables
 * - Auto-migrates from legacy configuration.variables if needed
 * ============================================================================
 */
const CompanyVariablesService = require('../../services/CompanyVariablesService');

router.get('/:companyId/configuration/variables', async (req, res) => {
    logger.info(`[COMPANY CONFIG] GET /configuration/variables for company: ${req.params.companyId}`);
    
    try {
        const result = await CompanyVariablesService.getVariablesForCompany(req.params.companyId);
        
        res.json({
            success: true,
            variables: result.variables,
            definitions: result.definitions,
            meta: result.meta
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error loading variables:', error);
        
        if (error.message.includes('not found')) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        res.status(500).json({ error: 'Failed to load variables' });
    }
});

/**
 * ============================================================================
 * PATCH /api/company/:companyId/configuration/variables
 * Update variable values
 * 
 * REFACTORED: Now uses CompanyVariablesService + validation
 * - Writes to: aiAgentSettings.variables
 * - Validates using variableValidators.js
 * - Auto-updates configurationAlert for missing required variables
 * ============================================================================
 */
const { validateBatch } = require('../../utils/variableValidators');

router.patch('/:companyId/configuration/variables', async (req, res) => {
    logger.info(`[COMPANY CONFIG] PATCH /configuration/variables for company: ${req.params.companyId}`);
    
    try {
        const { variables } = req.body;
        
        if (!variables || typeof variables !== 'object') {
            return res.status(400).json({ error: 'Invalid variables data' });
        }
        
        // Load definitions for validation
        const { definitions } = await CompanyVariablesService.getVariablesForCompany(req.params.companyId);
        
        // Validate all variables
        const validation = validateBatch(variables, definitions);
        
        if (!validation.isValid) {
            logger.warn(`[COMPANY CONFIG] Validation failed for company ${req.params.companyId}:`, validation.errors);
            return res.status(400).json({ 
                error: 'Validation failed',
                validationErrors: validation.errors
            });
        }
        
        // Update variables (uses formatted/normalized values from validation)
        const result = await CompanyVariablesService.updateVariablesForCompany(
            req.params.companyId, 
            validation.formatted
        );
        
        logger.info(`✅ [COMPANY CONFIG] Variables updated for company: ${req.params.companyId}`);
        
        res.json({
            success: true,
            variables: result.variables,
            definitions: result.definitions,
            meta: result.meta
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error updating variables:', error);
        
        if (error.message.includes('not found')) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        res.status(500).json({ error: 'Failed to update variables' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/configuration/variables/preview
 * Preview variable changes before applying
 * ============================================================================
 */
router.post('/:companyId/configuration/variables/preview', async (req, res) => {
    logger.info(`[COMPANY CONFIG] POST /configuration/variables/preview for company: ${req.params.companyId}`);
    
    try {
        const { variables } = req.body;
        
        if (!variables || typeof variables !== 'object') {
            return res.status(400).json({ error: 'Invalid variables data' });
        }
        
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // ============================================
        // STEP 1: Load template and variable definitions
        // ============================================
        const scenariosAffected = [];
        let template = null;
        const variableDefinitions = {};
        
        if (company.configuration?.clonedFrom) {
            template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
            
            // Build variable definitions lookup map
            if (template && template.variableDefinitions) {
                template.variableDefinitions.forEach(def => {
                    variableDefinitions[def.key] = def;
                });
            }
        }
        
        // ============================================
        // STEP 2: Validate all variables
        // ============================================
        const validationErrors = [];
        const validatedVariables = {};
        
        for (const [key, value] of Object.entries(variables)) {
            const definition = variableDefinitions[key];
            
            // If no definition, allow any value (backward compatibility)
            if (!definition) {
                validatedVariables[key] = value;
                continue;
            }
            
            // Validate using type-specific validator
            const validationResult = validate(value, definition);
            
            if (!validationResult.isValid) {
                validationErrors.push({
                    key,
                    label: definition.label || key,
                    error: validationResult.errorMessage,
                    value
                });
            } else {
                // Use formatted value (e.g., phone normalized to E.164)
                validatedVariables[key] = validationResult.formatted || value;
            }
        }
        
        // Return validation errors if any
        if (validationErrors.length > 0) {
            logger.info(`[COMPANY CONFIG] ❌ Validation failed: ${validationErrors.length} errors`);
            return res.status(400).json({
                error: 'Validation failed',
                validationErrors,
                message: `${validationErrors.length} variable(s) failed validation`
            });
        }
        
        logger.debug(`[COMPANY CONFIG] ✅ All variables validated successfully`);
        
        // ============================================
        // STEP 3: Build before/after comparisons
        // ============================================
        const currentVariables = company.configuration?.variables || {};
        const changes = [];
        const examples = [];
        
        for (const [key, newValue] of Object.entries(validatedVariables)) {
            const oldValue = currentVariables.get ? currentVariables.get(key) : currentVariables[key];
            
            if (oldValue !== newValue) {
                const definition = variableDefinitions[key];
                changes.push({
                    key,
                    label: definition?.label || key,
                    type: definition?.type || 'text',
                    oldValue: oldValue || '[empty]',
                    newValue: newValue || '[empty]',
                    status: !oldValue ? 'added' : !newValue ? 'removed' : 'modified'
                });
                
                // Find scenarios using this variable
                if (template) {
                    const variablePattern = `{${key}}`;
                    
                    template.categories.forEach(category => {
                        category.scenarios.forEach(scenario => {
                            const usedInQuick = scenario.quickReplies?.some(r => r.includes(variablePattern));
                            const usedInFull = scenario.fullReplies?.some(r => r.includes(variablePattern));
                            
                            if (usedInQuick || usedInFull) {
                                const exampleReply = scenario.quickReplies?.[0] || scenario.fullReplies?.[0] || '';
                                
                                // Generate before/after example
                                const beforeText = exampleReply.replace(variablePattern, oldValue || '[empty]');
                                const afterText = exampleReply.replace(variablePattern, newValue || '[empty]');
                                
                                if (examples.length < 10) {
                                    examples.push({
                                        scenario: scenario.name,
                                        category: category.name,
                                        before: beforeText,
                                        after: afterText
                                    });
                                }
                                
                                if (!scenariosAffected.includes(scenario.name)) {
                                    scenariosAffected.push(scenario.name);
                                }
                            }
                        });
                    });
                }
            }
        }
        
        // ============================================
        // STEP 4: Generate preview token
        // ============================================
        // CRITICAL: Token is generated from VALIDATED variables
        // This ensures apply endpoint will accept the same values
        const previewToken = generatePreviewToken(
            req.params.companyId,
            req.user?.userId || 'anonymous',
            validatedVariables
        );
        
        logger.security(`[COMPANY CONFIG] ✅ Preview generated: ${changes.length} changes, ${scenariosAffected.length} scenarios affected`);
        
        res.json({
            previewToken,
            expiresIn: 600, // 10 minutes in seconds
            summary: {
                variablesChanging: changes.length,
                scenariosAffected: scenariosAffected.length,
                validationsPassed: Object.keys(validatedVariables).length
            },
            changes,
            examples,
            scenariosAffected: scenariosAffected.slice(0, 20), // Limit to 20 for display
            validatedVariables // Return validated (formatted) values for frontend
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error generating preview:', error);
        res.status(500).json({ error: 'Failed to generate preview' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/configuration/variables/apply
 * Apply variable changes (requires preview token + idempotency key)
 * ============================================================================
 */
router.post('/:companyId/configuration/variables/apply', async (req, res) => {
    logger.security(`[COMPANY CONFIG] POST /configuration/variables/apply for company: ${req.params.companyId}`);
    
    try {
        const { variables, previewToken } = req.body;
        const idempotencyKey = req.headers['idempotency-key'];
        
        // Validate inputs
        if (!variables || typeof variables !== 'object') {
            return res.status(400).json({ error: 'Invalid variables data' });
        }
        
        if (!previewToken) {
            return res.status(400).json({ error: 'Preview token required. Please preview changes first.' });
        }
        
        if (!idempotencyKey) {
            return res.status(400).json({ error: 'Idempotency-Key header required' });
        }
        
        // Check idempotency
        const idempotencyCheck = await IdempotencyLog.checkOrStore(
            idempotencyKey,
            req.params.companyId,
            req.user?.userId || 'anonymous',
            'apply_variables',
            { variables },
            null, // Will be set after processing
            {
                ip: req.auditInfo?.ip || req.ip,
                userAgent: req.auditInfo?.userAgent || req.headers['user-agent']
            }
        );
        
        if (idempotencyCheck.isDuplicate) {
            logger.security(`[COMPANY CONFIG] ⚠️ Duplicate apply request (idempotency)`);
            return res.status(idempotencyCheck.response.statusCode).json(idempotencyCheck.response.body);
        }
        
        // Verify preview token
        const tokenVerification = verifyPreviewToken(previewToken, variables);
        
        if (!tokenVerification.valid) {
            return res.status(400).json({ error: tokenVerification.error });
        }
        
        // Verify company ID matches
        if (tokenVerification.payload.companyId !== req.params.companyId) {
            return res.status(400).json({ error: 'Preview token is for a different company' });
        }
        
        // Load company
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Start transaction (MongoDB session)
        const session = await mongoose.startSession();
        session.startTransaction();
        
        try {
            // Save old variables for audit
            const oldVariables = company.configuration?.variables || {};
            
            // Update variables
            if (!company.configuration) {
                company.configuration = {};
            }
            
            company.configuration.variables = variables;
            company.configuration.lastUpdatedAt = new Date();
            company.configuration.customization.hasCustomVariables = true;
            company.configuration.customization.lastCustomizedAt = new Date();
            
            await company.save({ session });
            
            // Create audit log
            const changedKeys = [];
            for (const key of Object.keys(variables)) {
                const oldVal = oldVariables.get ? oldVariables.get(key) : oldVariables[key];
                const newVal = variables[key];
                if (oldVal !== newVal) {
                    changedKeys.push(key);
                }
            }
            
            await AuditLog.createLog({
                companyId: company._id,
                userId: req.user?.userId || 'anonymous',
                action: 'update_variables',
                changes: {
                    before: oldVariables,
                    after: variables,
                    diff: {
                        modified: changedKeys
                    }
                },
                impact: {
                    variablesChanged: changedKeys,
                    severity: changedKeys.length > 10 ? 'high' : changedKeys.length > 5 ? 'medium' : 'low',
                    description: `${changedKeys.length} variable(s) updated`
                },
                metadata: {
                    previewToken,
                    idempotencyKey,
                    ip: req.auditInfo?.ip || req.ip,
                    userAgent: req.auditInfo?.userAgent || req.headers['user-agent']
                }
            });
            
            // Commit transaction
            await session.commitTransaction();
            
            logger.security(`[COMPANY CONFIG] ✅ Variables applied: ${changedKeys.length} changes`);
            
            // Invalidate readiness cache
            try {
                await redisClient.del(`readiness:${req.params.companyId}`);
            } catch (err) {
                logger.warn('[COMPANY CONFIG] Failed to invalidate cache:', err);
            }
            
            const successResponse = {
                success: true,
                variablesUpdated: changedKeys.length,
                variables: company.configuration.variables
            };
            
            // Update idempotency log with success response
            await IdempotencyLog.findOneAndUpdate(
                { key: idempotencyKey, companyId: req.params.companyId },
                {
                    response: {
                        statusCode: 200,
                        body: successResponse
                    }
                }
            );
            
            res.json(successResponse);
            
        } catch (error) {
            // Rollback transaction
            await session.abortTransaction();
            throw error;
        } finally {
            session.endSession();
        }
        
    } catch (error) {
        logger.security('[COMPANY CONFIG] Error applying variables:', error);
        res.status(500).json({ error: 'Failed to apply variables' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/variables/:key/usage
 * Get usage information for a specific variable
 * ============================================================================
 */
router.get('/:companyId/configuration/variables/:key/usage', async (req, res) => {
    logger.info(`[COMPANY CONFIG] GET /configuration/variables/${req.params.key}/usage`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get template to find scenarios using this variable
        const scenarios = [];
        
        if (company.configuration?.clonedFrom) {
            const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
            if (template) {
                const variablePattern = `{${req.params.key}}`;
                
                // Search through all scenarios
                template.categories.forEach(category => {
                    category.scenarios.forEach(scenario => {
                        // Check if variable is used in replies
                        const usedInQuick = scenario.quickReplies?.some(r => r.includes(variablePattern));
                        const usedInFull = scenario.fullReplies?.some(r => r.includes(variablePattern));
                        
                        if (usedInQuick || usedInFull) {
                            scenarios.push({
                                name: scenario.name,
                                category: category.name,
                                exampleReply: scenario.quickReplies?.[0] || scenario.fullReplies?.[0] || ''
                            });
                        }
                    });
                });
            }
        }
        
        res.json({
            key: req.params.key,
            usageCount: scenarios.length,
            scenarios
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error loading variable usage:', error);
        res.status(500).json({ error: 'Failed to load variable usage' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/filler-words
 * Load filler words (inherited + custom)
 * ============================================================================
 */
router.get('/:companyId/configuration/filler-words', async (req, res) => {
    logger.info(`[COMPANY CONFIG] GET /configuration/filler-words for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get inherited words from template
        let inherited = [];
        
        if (company.configuration?.clonedFrom) {
            const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
            if (template && template.fillerWords) {
                inherited = template.fillerWords;
            }
        }
        
        // Get custom words
        const custom = company.configuration?.fillerWords?.custom || [];
        
        res.json({
            inherited,
            custom,
            all: [...inherited, ...custom]
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error loading filler words:', error);
        res.status(500).json({ error: 'Failed to load filler words' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/configuration/filler-words
 * Add custom filler words
 * ============================================================================
 */
router.post('/:companyId/configuration/filler-words', async (req, res) => {
    logger.info(`[COMPANY CONFIG] POST /configuration/filler-words for company: ${req.params.companyId}`);
    
    try {
        const { words } = req.body;
        
        if (!Array.isArray(words) || words.length === 0) {
            return res.status(400).json({ error: 'Invalid words array' });
        }
        
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Initialize configuration if needed
        if (!company.configuration) {
            company.configuration = {};
        }
        if (!company.configuration.fillerWords) {
            company.configuration.fillerWords = { custom: [] };
        }
        
        // Add new words (prevent duplicates)
        const existingCustom = company.configuration.fillerWords.custom || [];
        const newWords = words.filter(w => !existingCustom.includes(w));
        
        company.configuration.fillerWords.custom = [...existingCustom, ...newWords];
        company.configuration.lastUpdatedAt = new Date();
        
        await company.save();
        
        // Clear Redis cache
        await clearCompanyCache(req.params.companyId, 'Filler Words Added');
        
        logger.debug(`[COMPANY CONFIG] Added ${newWords.length} filler words for company: ${req.params.companyId}`);
        
        res.json({
            success: true,
            added: newWords.length,
            custom: company.configuration.fillerWords.custom
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error adding filler words:', error);
        res.status(500).json({ error: 'Failed to add filler words' });
    }
});

/**
 * ============================================================================
 * DELETE /api/company/:companyId/configuration/filler-words/:word
 * Delete a custom filler word
 * ============================================================================
 */
router.delete('/:companyId/configuration/filler-words/:word', async (req, res) => {
    logger.info(`[COMPANY CONFIG] DELETE /configuration/filler-words/${req.params.word}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        if (!company.configuration?.fillerWords?.custom) {
            return res.status(400).json({ error: 'No custom filler words found' });
        }
        
        // Remove the word
        const word = decodeURIComponent(req.params.word);
        company.configuration.fillerWords.custom = company.configuration.fillerWords.custom.filter(w => w !== word);
        company.configuration.lastUpdatedAt = new Date();
        
        await company.save();
        
        // Clear Redis cache
        await clearCompanyCache(req.params.companyId, 'Filler Word Deleted');
        
        logger.debug(`[COMPANY CONFIG] Deleted filler word "${word}" for company: ${req.params.companyId}`);
        
        res.json({
            success: true,
            custom: company.configuration.fillerWords.custom
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error deleting filler word:', error);
        res.status(500).json({ error: 'Failed to delete filler word' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/configuration/filler-words/reset
 * Reset filler words to template defaults (remove all custom)
 * ============================================================================
 */
router.post('/:companyId/configuration/filler-words/reset', async (req, res) => {
    logger.info(`[COMPANY CONFIG] POST /configuration/filler-words/reset for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Clear custom filler words
        if (company.configuration?.fillerWords) {
            company.configuration.fillerWords.custom = [];
            company.configuration.lastUpdatedAt = new Date();
            await company.save();
            
            // Clear Redis cache
            await clearCompanyCache(req.params.companyId, 'Filler Words Reset');
        }
        
        logger.debug(`[COMPANY CONFIG] Reset filler words for company: ${req.params.companyId}`);
        
        res.json({
            success: true,
            custom: []
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error resetting filler words:', error);
        res.status(500).json({ error: 'Failed to reset filler words' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/urgency-keywords
 * Load urgency keywords (inherited + custom)
 * CRITICAL: Used by HybridScenarioSelector for emergency detection
 * ============================================================================
 */
router.get('/:companyId/configuration/urgency-keywords', async (req, res) => {
    logger.info(`[COMPANY CONFIG] GET /configuration/urgency-keywords for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get inherited keywords from company (copied from template at clone time)
        const inherited = company.configuration?.urgencyKeywords?.inherited || [];
        
        // Get custom keywords (added by company)
        const custom = company.configuration?.urgencyKeywords?.custom || [];
        
        // Combine all keywords
        const all = [...inherited, ...custom];
        
        res.json({
            inherited,
            custom,
            all,
            totalCount: all.length,
            totalWeight: all.reduce((sum, kw) => sum + (kw.weight || 0), 0).toFixed(2)
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error loading urgency keywords:', error);
        res.status(500).json({ error: 'Failed to load urgency keywords' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/configuration/urgency-keywords/sync
 * Sync urgency keywords from template (updates inherited keywords)
 * CRITICAL: Call this when template urgency keywords are updated
 * ============================================================================
 */
router.post('/:companyId/configuration/urgency-keywords/sync', async (req, res) => {
    logger.info(`[COMPANY CONFIG] POST /configuration/urgency-keywords/sync for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        if (!company.configuration?.clonedFrom) {
            return res.status(400).json({ error: 'Company has not cloned a template' });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Initialize urgency keywords if needed
        if (!company.configuration.urgencyKeywords) {
            company.configuration.urgencyKeywords = { inherited: [], custom: [] };
        }
        
        // Update inherited urgency keywords from template
        company.configuration.urgencyKeywords.inherited = template.urgencyKeywords?.map(kw => ({
            word: kw.word,
            weight: kw.weight,
            category: kw.category
        })) || [];
        
        company.configuration.lastUpdatedAt = new Date();
        
        await company.save();
        
        // Clear Redis cache
        await clearCompanyCache(req.params.companyId, 'Urgency Keywords Synced');
        
        logger.debug(`[COMPANY CONFIG] ✅ Synced ${company.configuration.urgencyKeywords.inherited.length} urgency keywords from template`);
        
        res.json({
            success: true,
            inherited: company.configuration.urgencyKeywords.inherited,
            syncedCount: company.configuration.urgencyKeywords.inherited.length,
            message: `Synced ${company.configuration.urgencyKeywords.inherited.length} urgency keywords from template`
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error syncing urgency keywords:', error);
        res.status(500).json({ error: 'Failed to sync urgency keywords' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/scenarios
 * Load scenarios from cloned template
 * ============================================================================
 */
router.get('/:companyId/configuration/scenarios', async (req, res) => {
    logger.info(`[COMPANY CONFIG] GET /configuration/scenarios for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        const scenarios = [];
        const categories = [];
        
        if (company.configuration?.clonedFrom) {
            const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
            if (template) {
                // Flatten scenarios from all categories
                template.categories.forEach(category => {
                    categories.push(category.name);
                    
                    category.scenarios.forEach(scenario => {
                        scenarios.push({
                            id: scenario._id,
                            name: scenario.name,
                            categories: scenario.categories || [category.name],
                            status: scenario.status || 'active',
                            triggers: scenario.triggers || [],
                            quickReplies: scenario.quickReplies || [],
                            fullReplies: scenario.fullReplies || [],
                            priority: scenario.priority || 5
                        });
                    });
                });
            }
        }
        
        res.json({
            scenarios,
            categories: [...new Set(categories)]
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error loading scenarios:', error);
        res.status(500).json({ error: 'Failed to load scenarios' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/template-info
 * Load template information and sync status
 * ============================================================================
 */
router.get('/:companyId/configuration/template-info', async (req, res) => {
    logger.info(`[COMPANY CONFIG] GET /configuration/template-info for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        if (!company.configuration?.clonedFrom) {
            return res.status(404).json({ error: 'No template cloned' });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
        
        if (!template) {
            return res.status(404).json({ error: 'Cloned template not found' });
        }
        
        // Calculate stats
        let totalScenarios = 0;
        const totalCategories = template.categories.length;
        
        template.categories.forEach(cat => {
            totalScenarios += cat.scenarios.length;
        });
        
        // Determine sync status
        const clonedVersion = company.configuration.clonedVersion || '1.0.0';
        const currentVersion = template.version || '1.0.0';
        let syncStatus = 'up_to_date';
        
        if (clonedVersion !== currentVersion) {
            syncStatus = 'updates_available';
        }
        
        res.json({
            templateName: template.name,
            templateDescription: template.description,
            clonedVersion,
            currentVersion,
            clonedAt: company.configuration.clonedAt,
            lastSyncedAt: company.configuration.lastSyncedAt || company.configuration.clonedAt,
            syncStatus,
            stats: {
                scenarios: totalScenarios,
                categories: totalCategories,
                variables: template.availableVariables?.length || 0,
                fillerWords: template.fillerWords?.length || 0
            }
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error loading template info:', error);
        res.status(500).json({ error: 'Failed to load template info' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/configuration/clone-template
 * Clone a Global AI Brain template to this company (INITIAL CLONE)
 * ============================================================================
 */
router.post('/:companyId/configuration/clone-template', async (req, res) => {
    logger.debug(`[COMPANY CONFIG] POST /configuration/clone-template for company: ${req.params.companyId}`);
    
    try {
        const { templateId } = req.body;
        
        if (!templateId) {
            return res.status(400).json({ error: 'Template ID is required' });
        }
        
        // Find company
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Check if already has a template
        if (company.configuration?.clonedFrom) {
            return res.status(400).json({ 
                error: 'Template already cloned',
                message: 'Use the sync endpoint to update instead'
            });
        }
        
        // Find the Global AI Brain template
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Calculate total scenarios
        let totalScenarios = 0;
        template.categories.forEach(cat => {
            totalScenarios += cat.scenarios.length;
        });
        
        logger.debug(`[COMPANY CONFIG] Cloning template "${template.name}" v${template.version} (${totalScenarios} scenarios)`);
        
        // Initialize configuration object
        if (!company.configuration) {
            company.configuration = {};
        }
        
        // Set template tracking
        company.configuration.clonedFrom = template._id;
        company.configuration.clonedVersion = template.version || '1.0.0';
        company.configuration.clonedAt = new Date();
        company.configuration.lastSyncedAt = new Date();
        company.configuration.lastUpdatedAt = new Date();
        
        // Initialize variables (empty, will be filled by user)
        if (!company.configuration.variables) {
            company.configuration.variables = {};
        }
        
        // Copy filler words from template (inherited)
        company.configuration.fillerWords = {
            inherited: template.fillerWords || [],
            custom: []
        };
        
        // Copy urgency keywords from template (inherited)
        if (template.urgencyKeywords) {
            company.configuration.urgencyKeywords = {
                inherited: template.urgencyKeywords || [],
                custom: []
            };
        }
        
        // Initialize customization tracking
        company.configuration.customization = {
            hasCustomVariables: false,
            hasCustomFillerWords: false,
            lastCustomizedAt: null
        };
        
        // Initialize readiness tracking
        company.configuration.readiness = {
            score: 0,
            lastCalculated: new Date(),
            blockers: ['variables_not_configured']
        };
        
        // Mark configuration as modified
        company.markModified('configuration');
        
        // Save company
        await company.save();
        
        logger.debug(`✅ [COMPANY CONFIG] Template cloned successfully for company ${req.params.companyId}`);
        
        // Clear Redis cache
        if (redisClient && redisClient.isOpen) {
            await redisClient.del(`company:${company._id}`);
            logger.debug(`[COMPANY CONFIG] Cleared Redis cache for company ${company._id}`);
        }
        
        // ========================================================================
        // 🔥 AUTO-SCAN FOR PLACEHOLDERS
        // ========================================================================
        // After cloning template, auto-scan for placeholders
        // Background job: Non-blocking
        // ========================================================================
        setImmediate(async () => {
            try {
                logger.info(`🔍 [AUTO-SCAN] Triggering placeholder scan for company ${req.params.companyId} after template clone`);
                
                // Add template reference to aiAgentSettings
                if (!company.aiAgentSettings) {
                    company.aiAgentSettings = {};
                }
                if (!company.aiAgentSettings.templateReferences) {
                    company.aiAgentSettings.templateReferences = [];
                }
                
                // Add reference if not already present
                if (!company.aiAgentSettings.templateReferences.find(ref => ref.templateId === templateId)) {
                    company.aiAgentSettings.templateReferences.push({
                        templateId,
                        enabled: true,
                        priority: 1,
                        clonedAt: new Date()
                    });
                    
                    company.markModified('aiAgentSettings.templateReferences');
                    await company.save();
                    
                    // Clear Redis cache
                    await clearCompanyCache(req.params.companyId, 'Template Reference Added');
                    
                    logger.debug(`✅ [AUTO-SCAN] Added template reference to aiAgentSettings`);
                }
                
                // Scan company for placeholders
                const scanResult = await PlaceholderScanService.scanCompany(req.params.companyId);
                logger.info(`✅ [AUTO-SCAN] Placeholder scan complete: ${scanResult.newCount} placeholders detected`);
                
            } catch (scanError) {
                logger.error(`❌ [AUTO-SCAN] Background scan failed for company ${req.params.companyId}:`, scanError.message);
                // Non-critical error - don't block response
            }
        });
        
        // Log to audit
        await AuditLog.create({
            userId: req.user?._id || null,
            userEmail: req.user?.email || 'System',
            action: 'TEMPLATE_CLONED',
            resourceType: 'Company',
            resourceId: company._id,
            changes: {
                templateId: template._id,
                templateName: template.name,
                templateVersion: template.version,
                scenariosCount: totalScenarios
            },
            ipAddress: req.ip,
            userAgent: req.get('user-agent')
        });
        
        res.json({
            success: true,
            message: 'Template cloned successfully',
            template: {
                id: template._id,
                name: template.name,
                version: template.version,
                description: template.description
            },
            stats: {
                scenarios: totalScenarios,
                categories: template.categories.length,
                variables: template.availableVariables?.length || 0,
                fillerWords: template.fillerWords?.length || 0
            },
            clonedAt: company.configuration.clonedAt,
            backgroundScan: {
                triggered: true,
                note: 'Placeholder scan running in background'
            }
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error cloning template:', error);
        res.status(500).json({ 
            error: 'Failed to clone template',
            message: error.message
        });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/configuration/sync
 * Sync updates from Global AI Brain template
 * ============================================================================
 */
router.post('/:companyId/configuration/sync', async (req, res) => {
    logger.info(`[COMPANY CONFIG] POST /configuration/sync for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        if (!company.configuration?.clonedFrom) {
            return res.status(400).json({ error: 'No template cloned' });
        }
        
        const template = await GlobalInstantResponseTemplate.findById(company.configuration.clonedFrom);
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Update configuration with latest template data
        company.configuration.clonedVersion = template.version;
        company.configuration.lastSyncedAt = new Date();
        
        // Note: Actual scenario sync would happen here
        // For now, just update the metadata
        
        await company.save();
        
        // Clear Redis cache
        await clearCompanyCache(req.params.companyId, 'Template Synced');
        
        logger.debug(`[COMPANY CONFIG] Synced company ${req.params.companyId} with template ${template._id}`);
        
        res.json({
            success: true,
            syncedVersion: template.version,
            syncedAt: company.configuration.lastSyncedAt
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error syncing template:', error);
        res.status(500).json({ error: 'Failed to sync template' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/readiness
 * Calculate readiness score with Redis caching
 * ============================================================================
 */
router.get('/:companyId/configuration/readiness', async (req, res) => {
    logger.debug(`[COMPANY CONFIG] GET /configuration/readiness for company: ${req.params.companyId}`);
    
    try {
        const companyId = req.params.companyId;
        const cacheKey = `readiness:${companyId}`;
        
        // Check cache first (30 second TTL)
        try {
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                logger.debug(`[COMPANY CONFIG] ✅ Returning cached readiness for ${companyId}`);
                return res.json(JSON.parse(cached));
            }
        } catch (cacheError) {
            logger.warn('[COMPANY CONFIG] Redis cache miss or error:', cacheError.message);
            // Continue without cache
        }
        
        // Load company
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Calculate readiness
        const report = await ConfigurationReadinessService.calculateReadiness(company);
        
        // Update company readiness in DB (fire and forget)
        Company.findByIdAndUpdate(companyId, {
            'configuration.readiness': {
                lastCalculatedAt: report.calculatedAt,
                score: report.score,
                canGoLive: report.canGoLive,
                isLive: company.configuration?.readiness?.isLive || false,
                goLiveAt: company.configuration?.readiness?.goLiveAt || null,
                goLiveBy: company.configuration?.readiness?.goLiveBy || null,
                components: report.components
            }
        }).catch(err => {
            logger.error('[COMPANY CONFIG] Error updating readiness in DB:', err);
        });
        
        // Cache for 30 seconds
        try {
            await redisClient.setex(cacheKey, 30, JSON.stringify(report));
        } catch (cacheError) {
            logger.warn('[COMPANY CONFIG] Failed to cache readiness:', cacheError.message);
        }
        
        logger.debug(`[COMPANY CONFIG] ✅ Readiness calculated: ${report.score}/100, Can Go Live: ${report.canGoLive}`);
        
        res.json(report);
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error calculating readiness:', error);
        res.status(500).json({ error: 'Failed to calculate readiness' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/configuration/go-live
 * Mark company as live (requires readiness check)
 * ============================================================================
 */
router.post('/:companyId/configuration/go-live', async (req, res) => {
    logger.info(`[COMPANY CONFIG] POST /configuration/go-live for company: ${req.params.companyId}`);
    
    try {
        const companyId = req.params.companyId;
        
        // Load company
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Calculate readiness first
        const report = await ConfigurationReadinessService.calculateReadiness(company);
        
        // Check if can go live
        if (!report.canGoLive) {
            return res.status(400).json({
                error: 'Company is not ready to go live',
                score: report.score,
                blockers: report.blockers,
                canGoLive: false
            });
        }
        
        // Mark as live
        company.configuration.readiness = {
            lastCalculatedAt: report.calculatedAt,
            score: report.score,
            canGoLive: report.canGoLive,
            isLive: true,
            goLiveAt: new Date(),
            goLiveBy: req.user?.userId || 'system',
            components: report.components
        };
        
        await company.save();
        
        // Invalidate cache
        try {
            await redisClient.del(`readiness:${companyId}`);
        } catch (err) {
            logger.warn('[COMPANY CONFIG] Failed to invalidate cache:', err);
        }
        
        logger.debug(`[COMPANY CONFIG] 🚀 Company ${companyId} is now LIVE!`);
        
        res.json({
            success: true,
            isLive: true,
            goLiveAt: company.configuration.readiness.goLiveAt,
            score: report.score
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error going live:', error);
        res.status(500).json({ error: 'Failed to go live' });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/analytics
 * Load analytics data
 * ============================================================================
 */
router.get('/:companyId/configuration/analytics', async (req, res) => {
    logger.info(`[COMPANY CONFIG] GET /configuration/analytics for company: ${req.params.companyId}`);
    
    try {
        // Placeholder - will be implemented in Phase 2
        res.json({
            matchRate: 0,
            avgConfidence: 0,
            avgSpeed: 0,
            totalCalls: 0
        });
        
    } catch (error) {
        logger.error('[COMPANY CONFIG] Error loading analytics:', error);
        res.status(500).json({ error: 'Failed to load analytics' });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/configuration/variables/scan
 * Trigger background scan for all active templates
 * ============================================================================
 */
const PlaceholderScanService = require('../../services/PlaceholderScanService');
const CacheHelper = require('../../utils/cacheHelper');

router.post('/:companyId/configuration/variables/scan', async (req, res) => {
    logger.debug(`🔍 [VARIABLE SCAN] POST /configuration/variables/scan for company: ${req.params.companyId}`);
    
    try {
        const companyId = req.params.companyId;
        
        // Verify company exists
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        logger.info(`🔍 [VARIABLE SCAN] Starting scan for company ${companyId}`);
        
        // Run the scan using PlaceholderScanService (uses ScenarioPoolService for consistency)
        const scanResult = await PlaceholderScanService.scanCompany(companyId, {
            reason: 'manual',
            triggeredBy: req.user?.email || 'system'
        });
        
        logger.info(`✅ [VARIABLE SCAN] Scan complete:`, scanResult);
        
        // Get updated variables data (includes meta)
        const result = await CompanyVariablesService.getVariablesForCompany(companyId);
        
        // Build detected variables summary for frontend
        const detectedVariablesSummary = result.definitions.map(def => ({
            key: def.key,
            label: def.label || def.key,
            type: def.type || 'text',
            category: def.category || 'General',
            usageCount: def.usageCount || 0,
            required: def.required || false
        }));
        
        // Build stats object from scanResult
        const stats = scanResult.stats || {
            templatesCount: 0,
            categoriesCount: 0,
            scenariosCount: 0,
            totalPlaceholderOccurrences: 0,
            uniqueVariables: 0
        };
        stats.newVariables = scanResult.newCount || 0;
        
        res.json({
            success: true,
            message: 'Scan completed',
            scannedAt: new Date().toISOString(),
            variables: result.variables,
            definitions: result.definitions,
            meta: result.meta,
            stats,
            detectedVariables: detectedVariablesSummary,
            templatesUsed: scanResult.templatesUsed || [], // Include template metadata for UI
            scanMetadata: scanResult.scanMetadata || { reason: 'manual', triggeredBy: 'system' }
        });
        
    } catch (error) {
        logger.error('❌ [VARIABLE SCAN] Error scanning company:', error);
        res.status(500).json({ 
            error: 'Failed to scan variables',
            message: error.message
        });
    }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/configuration/variables/scan-status
 * Get current scan status and progress
 * ============================================================================
 */
router.get('/:companyId/configuration/variables/scan-status', async (req, res) => {
    logger.info(`📊 [VARIABLE SCAN STATUS] GET /configuration/variables/scan-status for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        const scanStatus = company.aiAgentSettings?.variableScanStatus || {
            isScanning: false,
            lastScan: null,
            scanProgress: { current: 0, total: 0, currentTemplate: '' },
            scanHistory: []
        };
        
        res.json({
            success: true,
            scanStatus
        });
        
    } catch (error) {
        logger.error('❌ [VARIABLE SCAN STATUS] Error:', error);
        res.status(500).json({ 
            error: 'Failed to get scan status',
            message: error.message
        });
    }
});

/**
 * ============================================================================
 * POST /api/company/:companyId/configuration/variables/validate
 * Validate if company has all required variables filled
 * ============================================================================
 */
router.post('/:companyId/configuration/variables/validate', async (req, res) => {
    logger.info(`🔍 [VALIDATION] POST /configuration/variables/validate for company: ${req.params.companyId}`);
    
    try {
        const companyId = req.params.companyId;
        
        // Verify company exists
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Run validation
        const validation = await PlaceholderScanService.validateCompanyVariables(companyId);
        
        logger.info(`${validation.isValid ? '✅' : '⚠️ '} [VALIDATION] Company ${companyId}: ${validation.isValid ? 'VALID' : `Missing ${validation.missingRequired.length} required variables`}`);
        
        res.json({
            success: true,
            isValid: validation.isValid,
            totalRequired: validation.totalRequired,
            filledRequired: validation.filledRequired,
            missingRequired: validation.missingRequired,
            message: validation.isValid 
                ? 'All required variables are configured' 
                : `${validation.missingRequired.length} required variable(s) need values`
        });
        
    } catch (error) {
        logger.error('❌ [VALIDATION] Error validating company:', error);
        res.status(500).json({ 
            error: 'Failed to validate variables',
            message: error.message
        });
    }
});

/**
 * ============================================================================
 * HELPER FUNCTIONS
 * ============================================================================
 */

/**
 * Calculate variables status
 */
function calculateVariablesStatus(company) {
    const variables = company.configuration?.variables || {};
    
    // This would normally check against template's availableVariables
    // For now, return a simple status
    const totalKeys = Object.keys(variables).length;
    const configuredKeys = Object.values(variables).filter(v => v && v.trim() !== '').length;
    
    return {
        required: totalKeys,
        configured: configuredKeys,
        missing: [],
        isValid: totalKeys > 0 && configuredKeys === totalKeys
    };
}

/**
 * ============================================================================
 * AICORE TEMPLATES ENDPOINTS - REFERENCE-BASED SYSTEM
 * ============================================================================
 */

/**
 * GET /api/company/:companyId/configuration/templates
 * Get all loaded templates for this company
 */
router.get('/:companyId/configuration/templates', async (req, res) => {
    logger.info(`[AICORE TEMPLATES] GET /configuration/templates for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get template references from aiAgentSettings
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        
        if (templateRefs.length === 0) {
            return res.json([]);
        }
        
        // Fetch full template details from Global AI Brain
        const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
        const templates = [];
        
        for (const ref of templateRefs) {
            if (!ref.enabled) {continue;} // Skip disabled templates
            
            const template = await GlobalInstantResponseTemplate.findById(ref.templateId);
            
            if (!template) {
                logger.warn(`[AICORE TEMPLATES] Template ${ref.templateId} not found in Global AI Brain`);
                continue;
            }
            
            // Calculate stats
            let totalScenarios = 0;
            let totalTriggers = 0;
            const totalCategories = template.categories.length;
            
            template.categories.forEach(cat => {
                totalScenarios += cat.scenarios.length;
                cat.scenarios.forEach(scenario => {
                    totalTriggers += (scenario.triggers || []).length;
                });
            });
            
            templates.push({
                templateId: template._id,
                name: template.name,
                description: template.description,
                icon: template.icon,
                version: template.version || 'v1.0.0',
                lastUpdated: template.updatedAt,
                priority: ref.priority,
                clonedAt: ref.clonedAt,
                stats: {
                    categories: totalCategories,
                    scenarios: totalScenarios,
                    triggers: totalTriggers
                }
            });
        }
        
        res.json(templates);
        
    } catch (error) {
        logger.error('[AICORE TEMPLATES] Error fetching templates:', error);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

/**
 * POST /api/company/:companyId/configuration/templates
 * Add a template reference to this company
 */
router.post('/:companyId/configuration/templates', async (req, res) => {
    logger.info(`[AICORE TEMPLATES] POST /configuration/templates for company: ${req.params.companyId}`);
    
    try {
        const { templateId } = req.body;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId is required' });
        }
        
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Verify template exists
        const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Initialize aiAgentSettings if needed
        if (!company.aiAgentSettings) {
            company.aiAgentSettings = {
                templateReferences: [],
                variableDefinitions: [],
                variables: new Map()
            };
        }
        
        if (!company.aiAgentSettings.templateReferences) {
            company.aiAgentSettings.templateReferences = [];
        }
        
        // Check if template is already loaded
        const existing = company.aiAgentSettings.templateReferences.find(
            ref => ref.templateId.toString() === templateId.toString()
        );
        
        if (existing) {
            return res.status(400).json({ error: 'Template is already loaded' });
        }
        
        // Add template reference
        company.aiAgentSettings.templateReferences.push({
            templateId,
            enabled: true,
            priority: company.aiAgentSettings.templateReferences.length + 1,
            clonedAt: new Date()
        });
        
        company.aiAgentSettings.lastUpdated = new Date();
        company.markModified('aiAgentSettings');
        
        await company.save();
        
        // 🔥 AUTO-SCAN: Trigger variable scan after template activation
        const PlaceholderScanService = require('../../services/PlaceholderScanService');
        setImmediate(async () => {
            try {
                logger.info(`🔍 [AUTO-SCAN] Template activated (${templateId}), triggering variable scan for company ${req.params.companyId}`);
                const scanResult = await PlaceholderScanService.scanCompany(req.params.companyId, {
                    reason: 'template_activated',
                    triggeredBy: req.user?.email || 'system',
                    templateId
                });
                logger.info(`✅ [AUTO-SCAN] Variable scan complete after template activation: ${scanResult.stats?.uniqueVariables || 0} variables found`);
            } catch (scanError) {
                logger.error(`❌ [AUTO-SCAN] Variable scan failed after template activation:`, scanError.message);
                // Non-critical - don't block the response
            }
        });
        
        // Clear cache using the local function (already defined at top of file)
        await clearCompanyCache(req.params.companyId, 'Template Added');
        
        // CRITICAL: Also clear live-scenarios cache (template activation changes available scenarios)
        try {
            await redisClient.del(`live-scenarios:${req.params.companyId}`);
            logger.debug(`✅ [CACHE CLEAR] Template Added - Cleared live-scenarios cache for company:${req.params.companyId}`);
        } catch (cacheError) {
            logger.warn(`⚠️ [CACHE CLEAR] Failed to clear live-scenarios cache:`, cacheError.message);
        }
        
        res.json({ 
            success: true, 
            message: 'Template added successfully',
            templateId
        });
        
    } catch (error) {
        logger.error('[TEMPLATE HUB] Error adding template:', error);
        res.status(500).json({ error: 'Failed to add template' });
    }
});

/**
 * DELETE /api/company/:companyId/configuration/templates/:templateId
 * Remove a template reference from this company
 */
router.delete('/:companyId/configuration/templates/:templateId', async (req, res) => {
    logger.info(`[TEMPLATE HUB] DELETE /configuration/templates/${req.params.templateId} for company: ${req.params.companyId}`);
    
    try {
        const company = await Company.findById(req.params.companyId);
        
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        if (!company.aiAgentSettings || !company.aiAgentSettings.templateReferences) {
            logger.warn(`[TEMPLATE HUB] Company ${req.params.companyId} has no templateReferences array`);
            return res.status(404).json({ error: 'No templates loaded' });
        }
        
        // DIAGNOSTIC: Log what we're looking for vs what exists
        const requestedId = req.params.templateId.toString();
        logger.info(`[TEMPLATE HUB] Requested templateId to remove: ${requestedId}`);
        logger.info(`[TEMPLATE HUB] Current templateReferences count: ${company.aiAgentSettings.templateReferences.length}`);
        company.aiAgentSettings.templateReferences.forEach((ref, index) => {
            const refId = ref.templateId ? ref.templateId.toString() : 'undefined';
            logger.info(`[TEMPLATE HUB]   [${index}] templateId: ${refId}, match: ${refId === requestedId}`);
        });
        
        // Find and remove the template reference
        const initialLength = company.aiAgentSettings.templateReferences.length;
        company.aiAgentSettings.templateReferences = company.aiAgentSettings.templateReferences.filter(
            ref => {
                const refId = ref.templateId ? ref.templateId.toString() : null;
                const match = refId === requestedId;
                logger.info(`[TEMPLATE HUB] Filter: refId=${refId}, requested=${requestedId}, keeping=${!match}`);
                return !match;
            }
        );
        
        if (company.aiAgentSettings.templateReferences.length === initialLength) {
            logger.error(`[TEMPLATE HUB] Template ${requestedId} not found. Available: ${company.aiAgentSettings.templateReferences.map(r => r.templateId).join(', ')}`);
            return res.status(404).json({ error: 'Template not found in company' });
        }
        
        company.aiAgentSettings.lastUpdated = new Date();
        company.markModified('aiAgentSettings');
        
        await company.save();
        
        // 🔥 AUTO-SCAN: Trigger variable scan after template removal
        const PlaceholderScanService = require('../../services/PlaceholderScanService');
        setImmediate(async () => {
            try {
                logger.info(`🔍 [AUTO-SCAN] Template removed (${req.params.templateId}), triggering variable scan for company ${req.params.companyId}`);
                const scanResult = await PlaceholderScanService.scanCompany(req.params.companyId, {
                    reason: 'template_removed',
                    triggeredBy: req.user?.email || 'system',
                    templateId: req.params.templateId
                });
                logger.info(`✅ [AUTO-SCAN] Variable scan complete after template removal: ${scanResult.stats?.uniqueVariables || 0} variables found`);
            } catch (scanError) {
                logger.error(`❌ [AUTO-SCAN] Variable scan failed after template removal:`, scanError.message);
                // Non-critical - don't block the response
            }
        });
        
        // Clear cache using the local function (already defined at top of file)
        await clearCompanyCache(req.params.companyId, 'Template Removed');
        
        // CRITICAL: Also clear live-scenarios cache (template removal changes available scenarios)
        try {
            await redisClient.del(`live-scenarios:${req.params.companyId}`);
            logger.debug(`✅ [CACHE CLEAR] Template Removed - Cleared live-scenarios cache for company:${req.params.companyId}`);
        } catch (cacheError) {
            logger.warn(`⚠️ [CACHE CLEAR] Failed to clear live-scenarios cache:`, cacheError.message);
        }
        
        res.json({ 
            success: true, 
            message: 'Template removed successfully'
        });
        
    } catch (error) {
        logger.error('[TEMPLATE HUB] Error removing template:', error);
        res.status(500).json({ error: 'Failed to remove template' });
    }
});

/**
 * ============================================================================
 * PATCH /api/company/:companyId/intelligence
 * ============================================================================
 * PURPOSE: Update company's production intelligence settings (3-tier system)
 * 
 * BODY:
 * {
 *   productionIntelligence: {
 *     enabled: true,
 *     inheritFromTestPilot: false,
 *     thresholds: {
 *       tier1: 0.80,
 *       tier2: 0.60,
 *       enableTier3: true
 *     },
 *     llmConfig: {
 *       model: 'gpt-4o-mini',
 *       maxCostPerCall: 0.10,
 *       dailyBudget: 50  // optional
 *     }
 *   }
 * }
 * 
 * CACHING: Clears company cache in Redis
 * ============================================================================
 */
router.patch('/:companyId/intelligence', async (req, res) => {
    const { companyId } = req.params;
    const { productionIntelligence } = req.body;
    
    logger.info(`[COMPANY INTELLIGENCE] PATCH request for company: ${companyId}`);
    
    // Validation
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
        return res.status(400).json({ 
            success: false, 
            message: 'Invalid company ID' 
        });
    }
    
    if (!productionIntelligence) {
        return res.status(400).json({ 
            success: false, 
            message: 'productionIntelligence object required' 
        });
    }
    
    try {
        // Fetch company
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                message: 'Company not found' 
            });
        }
        
        // Ensure aiAgentLogic exists
        if (!company.aiAgentLogic) {
            company.aiAgentLogic = {};
        }
        
        // Update production intelligence settings
        company.aiAgentLogic.productionIntelligence = {
            enabled: productionIntelligence.enabled !== false, // default true
            inheritFromTestPilot: productionIntelligence.inheritFromTestPilot !== false, // default true
            thresholds: {
                tier1: parseFloat(productionIntelligence.thresholds?.tier1) || 0.80,
                tier2: parseFloat(productionIntelligence.thresholds?.tier2) || 0.60,
                enableTier3: productionIntelligence.thresholds?.enableTier3 !== false // default true
            },
            llmConfig: {
                model: productionIntelligence.llmConfig?.model || 'gpt-4o-mini',
                maxCostPerCall: parseFloat(productionIntelligence.llmConfig?.maxCostPerCall) || 0.10
            },
            lastUpdated: new Date(),
            updatedBy: req.user?.email || 'Admin'
        };
        
        // Add daily budget if provided (optional)
        if (productionIntelligence.llmConfig?.dailyBudget && parseFloat(productionIntelligence.llmConfig.dailyBudget) > 0) {
            company.aiAgentLogic.productionIntelligence.llmConfig.dailyBudget = parseFloat(productionIntelligence.llmConfig.dailyBudget);
        }
        
        // Save to MongoDB
        await company.save();
        
        logger.info(`✅ [COMPANY INTELLIGENCE] Settings saved for company: ${companyId}`);
        
        // Clear Redis cache for this company
        try {
            await clearCompanyCache(companyId);
            logger.info(`🗑️ [COMPANY INTELLIGENCE] Cache cleared for company: ${companyId}`);
        } catch (cacheError) {
            logger.warn(`⚠️ [COMPANY INTELLIGENCE] Failed to clear cache:`, cacheError.message);
        }
        
        res.json({ 
            success: true, 
            message: 'Production Intelligence settings saved successfully',
            productionIntelligence: company.aiAgentLogic.productionIntelligence
        });
        
    } catch (error) {
        logger.error('[COMPANY INTELLIGENCE] Error saving settings:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Failed to save production intelligence settings',
            error: error.message 
        });
    }
});

module.exports = router;

