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
// GET MERGED PLACEHOLDER VALUES (Catalog-First + Canonical Keys)
// ════════════════════════════════════════════════════════════════════════════════
// 
// Builds the "one truth" table by merging THREE sources:
// 1) Catalog (company-scope tokens for this trade)  [base set]
// 2) Template scan usage (usedInCount + requiredByTemplate)
// 3) Company stored values (Mongo)                  [values only]
//
// Rules:
// - Output keys are ALWAYS canonical (aliases resolved)
// - Catalog required tokens are ALWAYS included, even if template doesn't use them
// - Runtime tokens NEVER appear in this table
// ════════════════════════════════════════════════════════════════════════════════
router.get('/company/:companyId/values-merged', async (req, res) => {
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
        
        const tradeKey = company.trade || 'HVAC';
        
        // Helpers: normalize + canonicalize
        const normalizeToken = (token) => {
            if (!token) return '';
            return String(token).trim().replace(/^\{+/, '').replace(/\}+$/, '');
        };
        
        const canonicalizeToken = (token) => {
            const cleaned = normalizeToken(token);
            if (!cleaned) return '';
            const canonical = resolveAlias(cleaned) || cleaned;
            return canonical;
        };
        
        // ───────────────────────────────────────────────────────────────────────
        // 1) CATALOG (base set - company tokens only)
        // ───────────────────────────────────────────────────────────────────────
        const catalog = getCatalog(tradeKey);
        const catalogCompanyTokens = (catalog.placeholders || []).filter(p => p.scope === 'company');
        
        const catalogMap = new Map(); // canonicalLower -> catalog entry
        const catalogRequiredSet = new Set();
        const catalogOptionalSet = new Set();
        
        for (const p of catalogCompanyTokens) {
            const canonicalKey = p.key;
            const canonicalLower = canonicalKey.toLowerCase();
            catalogMap.set(canonicalLower, p);
            if (p.required) {
                catalogRequiredSet.add(canonicalLower);
            } else {
                catalogOptionalSet.add(canonicalLower);
            }
        }
        
        // ───────────────────────────────────────────────────────────────────────
        // 2) TEMPLATE SCAN (usage + required by template)
        // ───────────────────────────────────────────────────────────────────────
        let templateScan = null;
        let templateName = null;
        let hasActiveTemplate = false;
        
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const activeRef = templateRefs
            .filter(ref => ref.enabled !== false)
            .sort((a, b) => (a.priority || 1) - (b.priority || 1))[0];
        const templateId = activeRef?.templateId;
        
        if (templateId) {
            const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
            if (template) {
                hasActiveTemplate = true;
                templateName = template.name;
                templateScan = analyzeTemplatePlaceholders(template, tradeKey);
            }
        }
        
        const requiredByTemplateSet = new Set(); // canonicalLower
        const usedByTemplateSet = new Set();     // canonicalLower
        const usageMap = {};                     // canonicalLower -> count
        const labelMap = {};                     // canonicalLower -> label
        
        if (templateScan) {
            for (const p of (templateScan.requiredPlaceholders || [])) {
                const canonical = canonicalizeToken(p.key);
                const canonicalLower = canonical.toLowerCase();
                requiredByTemplateSet.add(canonicalLower);
                usedByTemplateSet.add(canonicalLower);
                usageMap[canonicalLower] = (p.usedIn || []).length;
                labelMap[canonicalLower] = p.label;
            }
            for (const p of (templateScan.optionalPlaceholders || [])) {
                const canonical = canonicalizeToken(p.key);
                const canonicalLower = canonical.toLowerCase();
                usedByTemplateSet.add(canonicalLower);
                usageMap[canonicalLower] = (p.usedIn || []).length;
                labelMap[canonicalLower] = p.label;
            }
        }
        
        // ───────────────────────────────────────────────────────────────────────
        // 3) COMPANY VALUES (Mongo - canonicalized)
        // ───────────────────────────────────────────────────────────────────────
        const placeholderDoc = await CompanyPlaceholders.findOne({ companyId }).lean();
        const companyPlaceholders = placeholderDoc?.placeholders || [];
        
        const companyMap = new Map(); // canonicalLower -> { key, value, description, originalKeys }
        
        for (const p of companyPlaceholders) {
            const canonicalKey = canonicalizeToken(p.key);
            const canonicalLower = canonicalKey.toLowerCase();
            
            const value = p.value || '';
            const existing = companyMap.get(canonicalLower);
            
            if (!existing) {
                companyMap.set(canonicalLower, {
                    key: canonicalKey,
                    value,
                    description: p.description || null,
                    originalKeys: [p.key]
                });
            } else {
                // Merge duplicate/legacy keys: prefer non-empty value
                const hasValue = value && String(value).trim();
                const existingHasValue = existing.value && String(existing.value).trim();
                if (!existingHasValue && hasValue) {
                    existing.value = value;
                }
                existing.originalKeys.push(p.key);
            }
        }
        
        // ───────────────────────────────────────────────────────────────────────
        // 4) BUILD MERGED ROWS (Catalog-first)
        // ───────────────────────────────────────────────────────────────────────
        const rowsByKey = new Map(); // canonicalLower -> row
        
        // 4a) Start from catalog (company tokens only)
        for (const p of catalogCompanyTokens) {
            const canonicalKey = p.key;
            const canonicalLower = canonicalKey.toLowerCase();
            
            rowsByKey.set(canonicalLower, {
                token: canonicalKey,
                displayToken: `{${canonicalKey}}`,
                label: p.label || canonicalKey,
                scope: 'company',
                category: p.category || null,
                requiredByCatalog: !!p.required,
                optionalByCatalog: !p.required,
                requiredByTemplate: false,
                usedByTemplate: false,
                usedInCount: 0,
                existsInCompany: false,
                value: '',
                status: 'missing'
            });
        }
        
        // 4b) Overlay template usage
        const applyTemplateUsage = (canonicalLower, isRequiredByTemplate) => {
            const row = rowsByKey.get(canonicalLower);
            if (row) {
                row.usedByTemplate = true;
                if (isRequiredByTemplate) row.requiredByTemplate = true;
                row.usedInCount = usageMap[canonicalLower] || row.usedInCount || 0;
                if (!row.label && labelMap[canonicalLower]) {
                    row.label = labelMap[canonicalLower];
                }
            } else {
                // Template token not in catalog (unknown) - still surface for clarity
                const canonicalKey = canonicalLower;
                rowsByKey.set(canonicalLower, {
                    token: canonicalKey,
                    displayToken: `{${canonicalKey}}`,
                    label: labelMap[canonicalLower] || canonicalKey,
                    scope: 'company',
                    category: 'unknown',
                    requiredByCatalog: false,
                    optionalByCatalog: false,
                    requiredByTemplate: !!isRequiredByTemplate,
                    usedByTemplate: true,
                    usedInCount: usageMap[canonicalLower] || 0,
                    existsInCompany: false,
                    value: '',
                    status: 'missing'
                });
            }
        };
        
        for (const keyLower of requiredByTemplateSet) {
            applyTemplateUsage(keyLower, true);
        }
        for (const keyLower of usedByTemplateSet) {
            applyTemplateUsage(keyLower, false);
        }
        
        // 4c) Overlay company values (Mongo)
        for (const [canonicalLower, companyData] of companyMap.entries()) {
            const row = rowsByKey.get(canonicalLower);
            const hasValue = companyData.value && String(companyData.value).trim();
            
            if (row) {
                row.existsInCompany = true;
                row.value = companyData.value || '';
                row.status = hasValue ? 'filled' : 'missing';
                if (!row.label && companyData.description) {
                    row.label = companyData.description;
                }
            } else {
                // Company token not in catalog or template (custom)
                rowsByKey.set(canonicalLower, {
                    token: companyData.key,
                    displayToken: `{${companyData.key}}`,
                    label: companyData.description || companyData.key,
                    scope: 'company',
                    category: 'custom',
                    requiredByCatalog: false,
                    optionalByCatalog: false,
                    requiredByTemplate: requiredByTemplateSet.has(canonicalLower),
                    usedByTemplate: usedByTemplateSet.has(canonicalLower),
                    usedInCount: usageMap[canonicalLower] || 0,
                    existsInCompany: true,
                    value: companyData.value || '',
                    status: hasValue ? 'filled' : 'missing'
                });
            }
        }
        
        // ───────────────────────────────────────────────────────────────────────
        // 5) FINAL ROWS + SUMMARY
        // ───────────────────────────────────────────────────────────────────────
        const rows = Array.from(rowsByKey.values());
        
        // Sort: missing catalog-required first, then missing template-required, then others
        rows.sort((a, b) => {
            const score = (r) => {
                let s = 0;
                if (r.requiredByCatalog) s += 100;
                else if (r.requiredByTemplate) s += 50;
                if (r.status === 'missing') s += 20;
                return s;
            };
            const diff = score(b) - score(a);
            if (diff !== 0) return diff;
            return (b.usedInCount || 0) - (a.usedInCount || 0);
        });
        
        const missingRequiredByCatalog = rows.filter(r => r.requiredByCatalog && r.status === 'missing').length;
        const missingRequiredByTemplate = rows.filter(r => r.requiredByTemplate && r.status === 'missing').length;
        const missingTotal = rows.filter(r => r.status === 'missing').length;
        const filledCount = rows.filter(r => r.status === 'filled').length;
        
        res.json({
            success: true,
            companyId,
            companyName: company.name,
            tradeKey,
            hasActiveTemplate,
            templateName,
            rows,
            summary: {
                total: rows.length,
                filled: filledCount,
                missing: missingTotal,
                missingRequiredByCatalog,
                missingRequiredByTemplate,
                isReady: missingRequiredByCatalog === 0
            },
            meta: {
                aliases: catalog.aliases || {},
                templateWarnings: templateScan?.warnings || [],
                unknownTokens: templateScan?.unknownTokens || [],
                aliasedTokens: templateScan?.aliasedTokens || []
            }
        });
        
    } catch (error) {
        logger.error('[PLACEHOLDERS] Error getting merged values:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// NORMALIZE COMPANY PLACEHOLDER KEYS (legacy → canonical)
// ════════════════════════════════════════════════════════════════════════════════
// 
// - Converts legacy/alias keys to canonical keys
// - Merges duplicates
// - Removes legacy keys after migration
// - Optionally prefers canonical key values on conflict
// ════════════════════════════════════════════════════════════════════════════════
router.post('/company/:companyId/normalize', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { preferCanonical = true } = req.body || {};
        
        const company = await Company.findById(companyId)
            .select('name trade')
            .lean();
        
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }
        
        const tradeKey = company.trade || 'HVAC';
        const catalog = getCatalog(tradeKey);
        
        const doc = await CompanyPlaceholders.findOne({ companyId });
        if (!doc) {
            return res.json({
                success: true,
                message: 'No placeholders to normalize',
                migratedCount: 0,
                deletedCount: 0,
                finalCount: 0,
                conflicts: []
            });
        }
        
        const normalizeToken = (token) => {
            if (!token) return '';
            return String(token).trim().replace(/^\{+/, '').replace(/\}+$/, '');
        };
        
        const canonicalizeToken = (token) => {
            const cleaned = normalizeToken(token);
            if (!cleaned) return '';
            const canonical = resolveAlias(cleaned) || cleaned;
            return canonical;
        };
        
        const mergedMap = new Map(); // canonicalLower -> merged data
        const migrated = [];
        const conflicts = [];
        let legacyCount = 0;
        
        for (const p of (doc.placeholders || [])) {
            const canonicalKey = canonicalizeToken(p.key);
            const canonicalLower = canonicalKey.toLowerCase();
            const originalLower = (p.key || '').toLowerCase();
            const isAlias = canonicalLower !== originalLower;
            
            if (isAlias) {
                legacyCount += 1;
                migrated.push({ from: p.key, to: canonicalKey });
            }
            
            const value = p.value || '';
            const hasValue = value && String(value).trim();
            const isCanonicalSource = originalLower === canonicalLower;
            
            if (!mergedMap.has(canonicalLower)) {
                mergedMap.set(canonicalLower, {
                    key: canonicalLower, // stored lowercase (schema lowercases anyway)
                    canonicalKey,
                    value,
                    description: p.description || null,
                    hasCanonicalSource: isCanonicalSource,
                    originalKeys: [p.key]
                });
                continue;
            }
            
            const existing = mergedMap.get(canonicalLower);
            const existingHasValue = existing.value && String(existing.value).trim();
            
            // Merge logic: prefer canonical if configured, otherwise keep first non-empty
            if (!existingHasValue && hasValue) {
                existing.value = value;
                if (!existing.description && p.description) {
                    existing.description = p.description;
                }
                existing.hasCanonicalSource = existing.hasCanonicalSource || isCanonicalSource;
            } else if (existingHasValue && hasValue && String(existing.value).trim() !== String(value).trim()) {
                conflicts.push({
                    key: canonicalKey,
                    keptValue: existing.value,
                    incomingValue: value,
                    keptFrom: existing.originalKeys[0],
                    incomingFrom: p.key
                });
                
                // If preferCanonical and incoming is canonical source, override
                if (preferCanonical && isCanonicalSource && !existing.hasCanonicalSource) {
                    existing.value = value;
                    existing.hasCanonicalSource = true;
                }
            }
            
            existing.originalKeys.push(p.key);
        }
        
        // Build normalized placeholders array
        const normalizedPlaceholders = Array.from(mergedMap.values()).map(entry => ({
            key: entry.key,
            value: entry.value || '',
            description: entry.description || null,
            isSystem: false
        }));
        
        const originalCount = doc.placeholders.length;
        const finalCount = normalizedPlaceholders.length;
        const deletedCount = originalCount - finalCount;
        
        // Save normalized placeholders
        doc.placeholders = normalizedPlaceholders;
        doc.lastUpdatedBy = req.user?.email || req.user?.username || 'System';
        await doc.save();
        
        res.json({
            success: true,
            message: `Normalized ${legacyCount} legacy key(s)`,
            companyId,
            companyName: company.name,
            tradeKey,
            migratedCount: legacyCount,
            deletedCount,
            finalCount,
            conflicts
        });
        
    } catch (error) {
        logger.error('[PLACEHOLDERS] Error normalizing placeholders:', error);
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
