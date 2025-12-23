/**
 * ════════════════════════════════════════════════════════════════════════════════
 * DEBUG TEMPLATES - Company Template Wiring Verification
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * READ-ONLY endpoint to verify what templates a company is actually using.
 * Critical for debugging why runtime might not match expectations.
 * 
 * GET /api/company/:companyId/debug/templates
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const logger = require('../../utils/logger');
const v2Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');

/**
 * GET /api/company/:companyId/debug/templates
 * 
 * Returns complete template wiring information:
 * - What templates are referenced in company config
 * - What the runtime would actually load
 * - Validation of template existence
 * - Mismatch warnings
 */
router.get('/', async (req, res) => {
    const { companyId } = req.params;
    const startTime = Date.now();
    
    logger.info(`[DEBUG TEMPLATES] Checking template wiring for company ${companyId}`);
    
    try {
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Load company document
        // ═══════════════════════════════════════════════════════════════════
        const company = await v2Company.findById(companyId).lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found',
                companyId
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 2: Extract all template references from company config
        // ═══════════════════════════════════════════════════════════════════
        const templateReferences = [];
        const warnings = [];
        
        // Check aiAgentSettings.templateReferences (primary location)
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        for (const ref of templateRefs) {
            templateReferences.push({
                source: 'aiAgentSettings.templateReferences',
                templateId: ref.templateId,
                templateName: ref.templateName,
                isPrimary: ref.isPrimary || false,
                isActive: ref.isActive !== false,
                addedAt: ref.addedAt,
                priority: ref.priority || 0
            });
        }
        
        // Check configuration.clonedFrom (legacy location)
        if (company.configuration?.clonedFrom) {
            templateReferences.push({
                source: 'configuration.clonedFrom',
                templateId: company.configuration.clonedFrom,
                templateName: null,
                isPrimary: true,
                isActive: true,
                legacy: true
            });
        }
        
        // Check aiAgentLogic.selectedTemplate (another possible location)
        if (company.aiAgentLogic?.selectedTemplate) {
            templateReferences.push({
                source: 'aiAgentLogic.selectedTemplate',
                templateId: company.aiAgentLogic.selectedTemplate,
                templateName: null,
                isPrimary: false,
                isActive: true
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: Validate each template exists and get stats
        // ═══════════════════════════════════════════════════════════════════
        const validatedTemplates = [];
        const uniqueTemplateIds = [...new Set(templateReferences.map(r => r.templateId?.toString()).filter(Boolean))];
        
        for (const templateId of uniqueTemplateIds) {
            try {
                const template = await GlobalInstantResponseTemplate.findById(templateId)
                    .select('name version templateType isActive isPublished categories')
                    .lean();
                
                if (template) {
                    const categoryCount = (template.categories || []).length;
                    const scenarioCount = (template.categories || []).reduce((sum, c) => sum + (c.scenarios || []).length, 0);
                    const triggerCount = (template.categories || []).reduce((sum, c) => 
                        sum + (c.scenarios || []).reduce((s, sc) => s + (sc.triggers || []).length, 0), 0);
                    
                    validatedTemplates.push({
                        templateId: template._id,
                        name: template.name,
                        version: template.version,
                        templateType: template.templateType,
                        isActive: template.isActive,
                        isPublished: template.isPublished,
                        exists: true,
                        stats: {
                            categories: categoryCount,
                            scenarios: scenarioCount,
                            triggers: triggerCount
                        },
                        referencedIn: templateReferences
                            .filter(r => r.templateId?.toString() === templateId)
                            .map(r => r.source)
                    });
                } else {
                    warnings.push(`Template ${templateId} referenced but NOT FOUND in database`);
                    validatedTemplates.push({
                        templateId,
                        exists: false,
                        error: 'Template not found in database'
                    });
                }
            } catch (e) {
                warnings.push(`Error validating template ${templateId}: ${e.message}`);
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: Determine what runtime would actually use
        // ═══════════════════════════════════════════════════════════════════
        
        // Find primary template (what live-scenarios would load)
        const primaryRef = templateReferences.find(r => r.isPrimary && r.isActive);
        const activeRefs = templateReferences.filter(r => r.isActive);
        
        let runtimeWouldUse = null;
        if (primaryRef) {
            runtimeWouldUse = validatedTemplates.find(t => t.templateId?.toString() === primaryRef.templateId?.toString());
        } else if (activeRefs.length > 0) {
            // Fallback to first active
            runtimeWouldUse = validatedTemplates.find(t => 
                t.templateId?.toString() === activeRefs[0].templateId?.toString());
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 5: Check for mismatches and issues
        // ═══════════════════════════════════════════════════════════════════
        
        if (templateReferences.length === 0) {
            warnings.push('NO TEMPLATE REFERENCES FOUND - Company has no templates configured');
        }
        
        if (!primaryRef && templateReferences.length > 0) {
            warnings.push('No PRIMARY template set - runtime will use first active template');
        }
        
        const inactiveTemplates = validatedTemplates.filter(t => t.exists && !t.isActive);
        if (inactiveTemplates.length > 0) {
            warnings.push(`${inactiveTemplates.length} referenced template(s) are marked isActive=false`);
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 6: Build response
        // ═══════════════════════════════════════════════════════════════════
        
        const response = {
            success: true,
            companyId,
            companyName: company.companyName,
            tradeKey: company.tradeKey || company.industryType || 'not_set',
            
            // What's stored in the company document
            storedReferences: {
                count: templateReferences.length,
                references: templateReferences
            },
            
            // Validated against actual templates in DB
            validatedTemplates: {
                count: validatedTemplates.length,
                templates: validatedTemplates
            },
            
            // What runtime would actually use
            runtimeWouldUse: runtimeWouldUse ? {
                templateId: runtimeWouldUse.templateId,
                name: runtimeWouldUse.name,
                version: runtimeWouldUse.version,
                stats: runtimeWouldUse.stats,
                reason: primaryRef ? 'Primary template' : 'First active template (no primary set)'
            } : {
                error: 'NO TEMPLATE WOULD BE LOADED',
                reason: 'No valid, active template references found'
            },
            
            // Health check
            health: {
                status: warnings.length === 0 ? 'GREEN' : 
                        warnings.some(w => w.includes('NOT FOUND') || w.includes('NO TEMPLATE')) ? 'RED' : 'YELLOW',
                warnings,
                isWiredCorrectly: runtimeWouldUse?.exists === true && runtimeWouldUse?.stats?.scenarios > 0
            },
            
            meta: {
                generatedAt: new Date().toISOString(),
                generatedInMs: Date.now() - startTime
            }
        };
        
        logger.info(`[DEBUG TEMPLATES] Company ${companyId}: ${validatedTemplates.length} templates, runtime would use: ${runtimeWouldUse?.name || 'NONE'}`);
        
        res.json(response);
        
    } catch (error) {
        logger.error(`[DEBUG TEMPLATES] Error:`, error);
        res.status(500).json({
            success: false,
            error: error.message,
            companyId
        });
    }
});

module.exports = router;

