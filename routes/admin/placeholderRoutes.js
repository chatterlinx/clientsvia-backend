/**
 * ════════════════════════════════════════════════════════════════════════════════
 * PLACEHOLDER API ROUTES
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints:
 * - GET  /catalog - Get global placeholder catalog
 * - GET  /template/:templateId/scan - Scan template for placeholder tokens
 * - POST /company/:companyId/import-defaults - Import required placeholders
 * - GET  /company/:companyId/coverage - Check placeholder coverage
 * ════════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');

const { 
    getCatalog, 
    resolveAlias, 
    validateKey,
    getGPTPlaceholderGuide 
} = require('../../config/placeholders/PlaceholderCatalog');

const { 
    analyzeTemplatePlaceholders, 
    checkPlaceholderCoverage 
} = require('../../services/placeholders/TemplatePlaceholderScanner');

const CompanyPlaceholders = require('../../models/CompanyPlaceholders');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const Company = require('../../models/v2Company');

// ════════════════════════════════════════════════════════════════════════════════
// GET PLACEHOLDER CATALOG
// ════════════════════════════════════════════════════════════════════════════════
router.get('/catalog', async (req, res) => {
    try {
        const { tradeKey, format = 'full' } = req.query;
        
        const catalog = getCatalog(tradeKey);
        
        if (format === 'gpt') {
            // Return GPT-friendly markdown guide
            return res.json({
                success: true,
                tradeKey: catalog.tradeKey,
                guide: getGPTPlaceholderGuide(tradeKey),
                validKeys: catalog.placeholders.map(p => p.key)
            });
        }
        
        if (format === 'keys') {
            // Return just the keys (for validation)
            return res.json({
                success: true,
                tradeKey: catalog.tradeKey,
                keys: catalog.placeholders.map(p => p.key),
                aliases: catalog.aliases
            });
        }
        
        // Full catalog
        res.json({
            success: true,
            catalog
        });
        
    } catch (error) {
        logger.error('[PLACEHOLDERS] Error getting catalog:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// SCAN TEMPLATE FOR PLACEHOLDERS
// ════════════════════════════════════════════════════════════════════════════════
router.get('/template/:templateId/scan', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { tradeKey } = req.query;
        
        // Load template
        const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
        
        if (!template) {
            return res.status(404).json({ 
                success: false, 
                error: 'Template not found' 
            });
        }
        
        // Analyze placeholders
        const analysis = analyzeTemplatePlaceholders(template, tradeKey || template.tradeKey);
        
        res.json({
            success: true,
            analysis
        });
        
    } catch (error) {
        logger.error('[PLACEHOLDERS] Error scanning template:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// SCAN COMPANY'S ACTIVE TEMPLATE
// ════════════════════════════════════════════════════════════════════════════════
router.get('/company/:companyId/template-scan', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        // Get company to find active template
        // Templates are stored in aiAgentSettings.templateReferences[] array
        const company = await Company.findById(companyId)
            .select('name trade aiAgentSettings.templateReferences')
            .lean();
        
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }
        
        // Find the primary (enabled, lowest priority number) template
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const activeRef = templateRefs
            .filter(ref => ref.enabled !== false)
            .sort((a, b) => (a.priority || 1) - (b.priority || 1))[0];
        
        const templateId = activeRef?.templateId;
        
        if (!templateId) {
            return res.json({
                success: true,
                hasActiveTemplate: false,
                message: 'Company has no active template selected',
                analysis: null
            });
        }
        
        // Load template
        const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
        
        if (!template) {
            return res.json({
                success: true,
                hasActiveTemplate: false,
                message: 'Active template not found',
                analysis: null
            });
        }
        
        // Analyze placeholders
        const analysis = analyzeTemplatePlaceholders(template, company.trade);
        
        res.json({
            success: true,
            hasActiveTemplate: true,
            companyName: company.name,
            tradeKey: company.trade,
            templateId: templateId.toString(),
            templateName: template.name,
            analysis
        });
        
    } catch (error) {
        logger.error('[PLACEHOLDERS] Error scanning company template:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// CHECK PLACEHOLDER COVERAGE
// ════════════════════════════════════════════════════════════════════════════════
router.get('/company/:companyId/coverage', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        // Get company
        const company = await Company.findById(companyId)
            .select('name trade aiAgentSettings.templateReferences')
            .lean();
        
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }
        
        // Get company placeholders
        const placeholderDoc = await CompanyPlaceholders.findOne({ companyId }).lean();
        const placeholderValues = placeholderDoc?.placeholders || [];
        
        // Convert to map
        const valuesMap = {};
        for (const p of placeholderValues) {
            valuesMap[p.key] = p.value;
        }
        
        // Get active template (primary enabled template)
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const activeRef = templateRefs
            .filter(ref => ref.enabled !== false)
            .sort((a, b) => (a.priority || 1) - (b.priority || 1))[0];
        const templateId = activeRef?.templateId;
        
        if (!templateId) {
            return res.json({
                success: true,
                hasActiveTemplate: false,
                companyName: company.name,
                placeholderCount: placeholderValues.length,
                coverage: null,
                message: 'No active template - cannot determine required placeholders'
            });
        }
        
        // Load and analyze template
        const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
        
        if (!template) {
            return res.json({
                success: true,
                hasActiveTemplate: false,
                placeholderCount: placeholderValues.length,
                coverage: null,
                message: 'Active template not found'
            });
        }
        
        const analysis = analyzeTemplatePlaceholders(template, company.trade);
        const coverage = checkPlaceholderCoverage(valuesMap, analysis);
        
        res.json({
            success: true,
            hasActiveTemplate: true,
            companyName: company.name,
            templateName: template.name,
            placeholderCount: placeholderValues.length,
            coverage,
            canPublish: coverage.canPublish,
            analysis: {
                requiredPlaceholders: analysis.requiredPlaceholders,
                optionalPlaceholders: analysis.optionalPlaceholders,
                warnings: analysis.warnings
            }
        });
        
    } catch (error) {
        logger.error('[PLACEHOLDERS] Error checking coverage:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// IMPORT DEFAULTS (based on template requirements)
// ════════════════════════════════════════════════════════════════════════════════
router.post('/company/:companyId/import-defaults', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { overwriteExisting = false } = req.body;
        
        // Get company
        const company = await Company.findById(companyId)
            .select('name trade aiAgentSettings.templateReferences')
            .lean();
        
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }
        
        // Get or create placeholder document
        let placeholderDoc = await CompanyPlaceholders.findOne({ companyId });
        
        if (!placeholderDoc) {
            placeholderDoc = new CompanyPlaceholders({
                companyId,
                placeholders: []
            });
        }
        
        // Build existing keys set
        const existingKeys = new Set(
            placeholderDoc.placeholders.map(p => p.key.toLowerCase())
        );
        
        // Determine which placeholders to import
        let placeholdersToImport = [];
        
        // Check if company has active template (primary enabled template)
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const activeRef = templateRefs
            .filter(ref => ref.enabled !== false)
            .sort((a, b) => (a.priority || 1) - (b.priority || 1))[0];
        const templateId = activeRef?.templateId;
        
        if (templateId) {
            // Load template and scan for required placeholders
            const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
            
            if (template) {
                const analysis = analyzeTemplatePlaceholders(template, company.trade);
                
                // Import only placeholders used by template
                placeholdersToImport = [
                    ...analysis.requiredPlaceholders,
                    ...analysis.optionalPlaceholders
                ].map(p => ({
                    key: p.key,
                    value: '', // Start empty - admin fills in
                    description: p.label,
                    example: p.example,
                    required: p.required,
                    type: p.type,
                    category: p.category,
                    fallback: p.fallback
                }));
            }
        }
        
        // If no template or template has no placeholders, use catalog defaults
        if (placeholdersToImport.length === 0) {
            const catalog = getCatalog(company.trade);
            
            // Import required placeholders from catalog
            placeholdersToImport = catalog.required.map(p => ({
                key: p.key,
                value: '',
                description: p.label,
                example: p.example,
                required: p.required,
                type: p.type,
                category: p.category,
                fallback: p.fallback
            }));
        }
        
        // Add placeholders (respecting overwriteExisting flag)
        const imported = [];
        const skipped = [];
        
        for (const p of placeholdersToImport) {
            const normalizedKey = p.key.toLowerCase();
            
            if (existingKeys.has(normalizedKey)) {
                if (overwriteExisting) {
                    // Update existing
                    const idx = placeholderDoc.placeholders.findIndex(
                        x => x.key.toLowerCase() === normalizedKey
                    );
                    if (idx >= 0) {
                        // Keep existing value, update metadata
                        placeholderDoc.placeholders[idx].description = p.description;
                    }
                    imported.push({ key: p.key, action: 'updated' });
                } else {
                    skipped.push({ key: p.key, reason: 'already_exists' });
                }
            } else {
                // Add new
                placeholderDoc.placeholders.push({
                    key: p.key,
                    value: p.value || '',
                    description: p.description || p.label,
                    isSystem: false
                });
                imported.push({ key: p.key, action: 'added' });
                existingKeys.add(normalizedKey);
            }
        }
        
        // Save
        await placeholderDoc.save();
        
        res.json({
            success: true,
            message: `Imported ${imported.length} placeholders`,
            imported,
            skipped,
            totalPlaceholders: placeholderDoc.placeholders.length
        });
        
    } catch (error) {
        logger.error('[PLACEHOLDERS] Error importing defaults:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// VALIDATE A PLACEHOLDER KEY
// ════════════════════════════════════════════════════════════════════════════════
router.get('/validate/:key', async (req, res) => {
    try {
        const { key } = req.params;
        const { tradeKey } = req.query;
        
        const validation = validateKey(key, tradeKey);
        
        res.json({
            success: true,
            key,
            validation
        });
        
    } catch (error) {
        logger.error('[PLACEHOLDERS] Error validating key:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// RESOLVE ALIAS
// ════════════════════════════════════════════════════════════════════════════════
router.get('/resolve/:key', async (req, res) => {
    try {
        const { key } = req.params;
        
        const canonical = resolveAlias(key);
        
        res.json({
            success: true,
            original: key,
            canonical,
            isAlias: canonical !== key
        });
        
    } catch (error) {
        logger.error('[PLACEHOLDERS] Error resolving alias:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
