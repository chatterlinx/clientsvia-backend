/**
 * ============================================================================
 * SEED GOLDEN SETUP API
 * ============================================================================
 * 
 * POST /api/company/:companyId/seed-golden
 * 
 * Populates a company with a complete, valid, production-ready configuration
 * based on a golden reference profile (e.g., Penguin Air for HVAC).
 * 
 * RULES:
 * - Idempotent: Creates missing, updates incorrect, never duplicates
 * - Never wipes call logs or analytics
 * - Everything seeded is UI-editable
 * - All enabled rules are VALID (patterns + actions)
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const logger = require('../../utils/logger');

// Models
const Company = require('../../models/v2Company');
const CompanyPlaceholders = require('../../models/CompanyPlaceholders');
const CompanyResponseDefaults = require('../../models/CompanyResponseDefaults');
const DynamicFlow = require('../../models/DynamicFlow');
const CheatSheetVersion = require('../../models/cheatsheet/CheatSheetVersion');

// Golden configurations
const goldenConfigs = {
    hvac_residential: require('../../config/goldenSetups/hvac_residential')
};

// Auth middleware
const { authenticateJWT, requireAdminRole } = require('../../middleware/auth');

/**
 * POST /api/company/:companyId/seed-golden
 * 
 * Body: {
 *   profile: "penguin_air" | "hvac_standard",
 *   tradeCategoryKey: "hvac_residential"
 * }
 */
router.post('/', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const { profile = 'penguin_air', tradeCategoryKey = 'hvac_residential' } = req.body;
    
    const startTime = Date.now();
    const results = {
        companyId,
        profile,
        tradeCategoryKey,
        actions: [],
        warnings: [],
        errors: []
    };
    
    logger.info('[SEED GOLDEN] Starting golden setup', { companyId, profile, tradeCategoryKey });
    
    try {
        // Get golden configuration
        const goldenConfig = goldenConfigs[tradeCategoryKey];
        if (!goldenConfig) {
            return res.status(400).json({
                success: false,
                error: `Unknown trade category: ${tradeCategoryKey}`,
                available: Object.keys(goldenConfigs)
            });
        }
        
        // Verify company exists
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // A) SEED PLACEHOLDERS
        // ═══════════════════════════════════════════════════════════════════
        try {
            const placeholdersResult = await seedPlaceholders(companyId, goldenConfig.placeholders);
            results.actions.push({
                section: 'placeholders',
                ...placeholdersResult
            });
        } catch (error) {
            results.errors.push({ section: 'placeholders', error: error.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // B) SEED FRONT DESK BEHAVIOR
        // ═══════════════════════════════════════════════════════════════════
        try {
            const frontDeskResult = await seedFrontDeskBehavior(companyId, goldenConfig.frontDeskBehavior, company);
            results.actions.push({
                section: 'frontDeskBehavior',
                ...frontDeskResult
            });
        } catch (error) {
            results.errors.push({ section: 'frontDeskBehavior', error: error.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // C) SEED BOOKING CONFIGURATION
        // ═══════════════════════════════════════════════════════════════════
        try {
            const bookingResult = await seedBookingConfig(companyId, goldenConfig.booking, company);
            results.actions.push({
                section: 'booking',
                ...bookingResult
            });
        } catch (error) {
            results.errors.push({ section: 'booking', error: error.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // D) SEED DEFAULT REPLIES
        // ═══════════════════════════════════════════════════════════════════
        try {
            const defaultsResult = await seedDefaultReplies(companyId, goldenConfig.defaultReplies);
            results.actions.push({
                section: 'defaultReplies',
                ...defaultsResult
            });
        } catch (error) {
            results.errors.push({ section: 'defaultReplies', error: error.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // E) SEED TRANSFERS
        // ═══════════════════════════════════════════════════════════════════
        try {
            const transfersResult = await seedTransfers(companyId, goldenConfig.transfers, company);
            results.actions.push({
                section: 'transfers',
                ...transfersResult
            });
        } catch (error) {
            results.errors.push({ section: 'transfers', error: error.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // F) SEED CALL PROTECTION
        // ═══════════════════════════════════════════════════════════════════
        try {
            const callProtectionResult = await seedCallProtection(companyId, goldenConfig.callProtection);
            results.actions.push({
                section: 'callProtection',
                ...callProtectionResult
            });
        } catch (error) {
            results.errors.push({ section: 'callProtection', error: error.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // G) SEED DYNAMIC FLOWS
        // ═══════════════════════════════════════════════════════════════════
        try {
            const dynamicFlowsResult = await seedDynamicFlows(companyId, goldenConfig.dynamicFlows);
            results.actions.push({
                section: 'dynamicFlows',
                ...dynamicFlowsResult
            });
        } catch (error) {
            results.errors.push({ section: 'dynamicFlows', error: error.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // H) SET TRADE CATEGORY
        // ═══════════════════════════════════════════════════════════════════
        try {
            await Company.findByIdAndUpdate(companyId, {
                $set: {
                    tradeKey: tradeCategoryKey,
                    industryType: tradeCategoryKey
                }
            });
            results.actions.push({
                section: 'tradeCategory',
                action: 'set',
                value: tradeCategoryKey
            });
        } catch (error) {
            results.errors.push({ section: 'tradeCategory', error: error.message });
        }
        
        results.duration = Date.now() - startTime;
        results.success = results.errors.length === 0;
        
        logger.info('[SEED GOLDEN] Completed', {
            companyId,
            profile,
            duration: results.duration,
            actionsCount: results.actions.length,
            errorsCount: results.errors.length
        });
        
        res.json(results);
        
    } catch (error) {
        logger.error('[SEED GOLDEN] Fatal error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            results
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function seedPlaceholders(companyId, placeholders) {
    const result = { created: 0, updated: 0, skipped: 0 };
    
    // Get or create placeholders document
    let doc = await CompanyPlaceholders.findOne({ companyId });
    if (!doc) {
        doc = new CompanyPlaceholders({ companyId, placeholders: [] });
        result.created = placeholders.length;
    }
    
    // Merge placeholders (don't overwrite existing values unless empty)
    const existingMap = new Map(doc.placeholders.map(p => [p.key, p]));
    
    for (const ph of placeholders) {
        const existing = existingMap.get(ph.key);
        if (!existing) {
            doc.placeholders.push(ph);
            result.created++;
        } else if (!existing.value && ph.value) {
            existing.value = ph.value;
            result.updated++;
        } else {
            result.skipped++;
        }
    }
    
    await doc.save();
    return result;
}

async function seedFrontDeskBehavior(companyId, config, company) {
    const update = {
        'aiAgentSettings.frontDeskBehavior.greeting': config.greeting,
        'aiAgentSettings.frontDeskBehavior.conversationStyle': config.conversationStyle,
        'aiAgentSettings.frontDeskBehavior.personality': config.personality,
        'aiAgentSettings.frontDeskBehavior.forbiddenPhrases': config.forbiddenPhrases,
        'aiAgentSettings.frontDeskBehavior.blockPricing': config.blockPricing,
        'aiAgentSettings.frontDeskBehavior.pricingDeflection': config.pricingDeflection
    };
    
    await Company.findByIdAndUpdate(companyId, { $set: update });
    return { action: 'updated', fields: Object.keys(update).length };
}

async function seedBookingConfig(companyId, config, company) {
    const update = {
        'aiAgentSettings.bookingEnabled': config.enabled,
        'aiAgentSettings.frontDeskBehavior.bookingSlots': config.slots,
        'aiAgentSettings.frontDeskBehavior.urgentBookingBehavior': config.urgentBookingBehavior,
        'aiAgentSettings.frontDeskBehavior.urgentTransferTarget': config.urgentTransferTarget
    };
    
    await Company.findByIdAndUpdate(companyId, { $set: update });
    return { action: 'updated', slotsCount: config.slots.length };
}

async function seedDefaultReplies(companyId, config) {
    const defaults = await CompanyResponseDefaults.findOneAndUpdate(
        { companyId },
        {
            $set: {
                notOfferedReply: config.notOfferedReply,
                unknownIntentReply: config.unknownIntentReply,
                afterHoursReply: config.afterHoursReply,
                strictDisabledBehavior: config.strictDisabledBehavior
            }
        },
        { upsert: true, new: true }
    );
    
    return { action: 'upserted', id: defaults._id.toString() };
}

async function seedTransfers(companyId, transfers, company) {
    const result = { created: 0, updated: 0 };
    
    // Store in company document (aiAgentSettings.transferTargets)
    const existingTargets = company.aiAgentSettings?.transferTargets || [];
    const existingMap = new Map(existingTargets.map(t => [t.id, t]));
    
    const newTargets = [];
    for (const transfer of transfers) {
        const existing = existingMap.get(transfer.id);
        if (existing) {
            // Update existing
            Object.assign(existing, transfer);
            newTargets.push(existing);
            result.updated++;
        } else {
            newTargets.push(transfer);
            result.created++;
        }
    }
    
    // Keep any existing targets not in golden config
    for (const [id, target] of existingMap) {
        if (!transfers.find(t => t.id === id)) {
            newTargets.push(target);
        }
    }
    
    await Company.findByIdAndUpdate(companyId, {
        $set: { 'aiAgentSettings.transferTargets': newTargets }
    });
    
    return result;
}

async function seedCallProtection(companyId, rules) {
    const result = { created: 0, updated: 0, removed: 0 };
    
    // Get or create live cheatsheet version
    let cheatSheet = await CheatSheetVersion.findOne({ companyId, status: 'live' });
    
    if (!cheatSheet) {
        cheatSheet = new CheatSheetVersion({
            companyId,
            status: 'live',
            config: { edgeCases: [], transferRules: [] }
        });
    }
    
    // Replace edge cases with valid golden rules
    const existingEdgeCases = cheatSheet.config?.edgeCases || [];
    
    // Remove invalid rules (empty patterns, no response)
    const invalidRemoved = existingEdgeCases.filter(ec => 
        ec.enabled !== false && 
        ((ec.triggerPatterns?.length === 0 && !['voicemail', 'machine', 'spam'].includes(ec.type)) ||
         (!ec.responseText && !ec.transferTargetId && ec.action !== 'hangup'))
    );
    result.removed = invalidRemoved.length;
    
    // Keep valid existing rules, add new golden rules
    const existingValidMap = new Map(
        existingEdgeCases
            .filter(ec => !invalidRemoved.includes(ec))
            .map(ec => [ec.name, ec])
    );
    
    const newEdgeCases = [];
    for (const rule of rules) {
        const existing = existingValidMap.get(rule.name);
        if (existing) {
            Object.assign(existing, rule);
            newEdgeCases.push(existing);
            result.updated++;
            existingValidMap.delete(rule.name);
        } else {
            newEdgeCases.push(rule);
            result.created++;
        }
    }
    
    // Keep remaining valid existing rules
    for (const [name, rule] of existingValidMap) {
        newEdgeCases.push(rule);
    }
    
    cheatSheet.config.edgeCases = newEdgeCases;
    await cheatSheet.save();
    
    return result;
}

async function seedDynamicFlows(companyId, flows) {
    const result = { created: 0, updated: 0 };
    
    for (const flowConfig of flows) {
        const existing = await DynamicFlow.findOne({ companyId, flowKey: flowConfig.flowKey });
        
        if (existing) {
            // Update existing flow
            Object.assign(existing, flowConfig, { companyId });
            await existing.save();
            result.updated++;
        } else {
            // Create new flow
            const newFlow = new DynamicFlow({
                ...flowConfig,
                companyId
            });
            await newFlow.save();
            result.created++;
        }
    }
    
    return result;
}

/**
 * GET /api/company/:companyId/seed-golden/profiles
 * Returns available golden profiles
 */
router.get('/profiles', authenticateJWT, (req, res) => {
    res.json({
        success: true,
        profiles: Object.keys(goldenConfigs).map(key => ({
            tradeCategoryKey: key,
            profileKey: goldenConfigs[key].profileKey,
            name: goldenConfigs[key].placeholders.find(p => p.key === 'companyname')?.value || key
        }))
    });
});

/**
 * POST /api/company/:companyId/seed-golden/copy-from/:sourceCompanyId
 * 
 * Copy settings from a golden/reference company to the target company.
 * 
 * Body: {
 *   sections: ['frontDesk', 'booking', 'defaultReplies', 'transfers', 'dynamicFlows', 'callProtection', 'placeholders', 'scenarioToggles']
 * }
 */
router.post('/copy-from/:sourceCompanyId', authenticateJWT, async (req, res) => {
    const { companyId: targetCompanyId, sourceCompanyId } = req.params;
    const { sections = ['frontDesk', 'booking', 'defaultReplies', 'transfers', 'dynamicFlows'] } = req.body;
    
    const startTime = Date.now();
    const results = {
        targetCompanyId,
        sourceCompanyId,
        sections,
        copied: [],
        skipped: [],
        errors: []
    };
    
    logger.info('[COPY FROM GOLDEN] Starting copy', { targetCompanyId, sourceCompanyId, sections });
    
    try {
        // Verify both companies exist
        const [sourceCompany, targetCompany] = await Promise.all([
            Company.findById(sourceCompanyId),
            Company.findById(targetCompanyId)
        ]);
        
        if (!sourceCompany) {
            return res.status(404).json({ success: false, error: 'Source company not found' });
        }
        if (!targetCompany) {
            return res.status(404).json({ success: false, error: 'Target company not found' });
        }
        
        // Copy each requested section
        for (const section of sections) {
            try {
                switch (section) {
                    case 'frontDesk':
                        await copyFrontDesk(sourceCompanyId, targetCompanyId, sourceCompany);
                        results.copied.push('frontDesk');
                        break;
                        
                    case 'booking':
                        await copyBooking(sourceCompanyId, targetCompanyId, sourceCompany);
                        results.copied.push('booking');
                        break;
                        
                    case 'defaultReplies':
                        await copyDefaultReplies(sourceCompanyId, targetCompanyId);
                        results.copied.push('defaultReplies');
                        break;
                        
                    case 'transfers':
                        await copyTransfers(sourceCompanyId, targetCompanyId, sourceCompany);
                        results.copied.push('transfers');
                        break;
                        
                    case 'dynamicFlows':
                        await copyDynamicFlows(sourceCompanyId, targetCompanyId);
                        results.copied.push('dynamicFlows');
                        break;
                        
                    case 'callProtection':
                        await copyCallProtection(sourceCompanyId, targetCompanyId);
                        results.copied.push('callProtection');
                        break;
                        
                    case 'placeholders':
                        await copyPlaceholders(sourceCompanyId, targetCompanyId);
                        results.copied.push('placeholders');
                        break;
                        
                    default:
                        results.skipped.push(section);
                }
            } catch (error) {
                results.errors.push({ section, error: error.message });
            }
        }
        
        results.duration = Date.now() - startTime;
        results.success = results.errors.length === 0;
        
        logger.info('[COPY FROM GOLDEN] Completed', results);
        res.json(results);
        
    } catch (error) {
        logger.error('[COPY FROM GOLDEN] Fatal error:', error);
        res.status(500).json({ success: false, error: error.message, results });
    }
});

// ═══════════════════════════════════════════════════════════════════════════
// COPY HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function copyFrontDesk(sourceId, targetId, sourceCompany) {
    const frontDesk = sourceCompany.aiAgentSettings?.frontDeskBehavior || {};
    await Company.findByIdAndUpdate(targetId, {
        $set: {
            'aiAgentSettings.frontDeskBehavior.greeting': frontDesk.greeting,
            'aiAgentSettings.frontDeskBehavior.conversationStyle': frontDesk.conversationStyle,
            'aiAgentSettings.frontDeskBehavior.personality': frontDesk.personality,
            'aiAgentSettings.frontDeskBehavior.forbiddenPhrases': frontDesk.forbiddenPhrases,
            'aiAgentSettings.frontDeskBehavior.blockPricing': frontDesk.blockPricing,
            'aiAgentSettings.frontDeskBehavior.pricingDeflection': frontDesk.pricingDeflection
        }
    });
}

async function copyBooking(sourceId, targetId, sourceCompany) {
    const settings = sourceCompany.aiAgentSettings || {};
    const frontDesk = settings.frontDeskBehavior || {};
    await Company.findByIdAndUpdate(targetId, {
        $set: {
            'aiAgentSettings.bookingEnabled': settings.bookingEnabled,
            'aiAgentSettings.frontDeskBehavior.bookingSlots': frontDesk.bookingSlots,
            'aiAgentSettings.frontDeskBehavior.urgentBookingBehavior': frontDesk.urgentBookingBehavior,
            'aiAgentSettings.frontDeskBehavior.urgentTransferTarget': frontDesk.urgentTransferTarget
        }
    });
}

async function copyDefaultReplies(sourceId, targetId) {
    const sourceDefaults = await CompanyResponseDefaults.findOne({ companyId: sourceId }).lean();
    if (sourceDefaults) {
        await CompanyResponseDefaults.findOneAndUpdate(
            { companyId: targetId },
            {
                $set: {
                    notOfferedReply: sourceDefaults.notOfferedReply,
                    unknownIntentReply: sourceDefaults.unknownIntentReply,
                    afterHoursReply: sourceDefaults.afterHoursReply,
                    strictDisabledBehavior: sourceDefaults.strictDisabledBehavior
                }
            },
            { upsert: true }
        );
    }
}

async function copyTransfers(sourceId, targetId, sourceCompany) {
    const transfers = sourceCompany.aiAgentSettings?.transferTargets || [];
    await Company.findByIdAndUpdate(targetId, {
        $set: { 'aiAgentSettings.transferTargets': transfers }
    });
}

async function copyDynamicFlows(sourceId, targetId) {
    const sourceFlows = await DynamicFlow.find({ companyId: sourceId }).lean();
    
    for (const flow of sourceFlows) {
        const { _id, companyId, createdAt, updatedAt, ...flowData } = flow;
        
        // Upsert by flowKey
        await DynamicFlow.findOneAndUpdate(
            { companyId: targetId, flowKey: flow.flowKey },
            { $set: { ...flowData, companyId: targetId } },
            { upsert: true }
        );
    }
}

async function copyCallProtection(sourceId, targetId) {
    const sourceSheet = await CheatSheetVersion.findOne({ companyId: sourceId, status: 'live' }).lean();
    
    if (sourceSheet?.config?.edgeCases) {
        let targetSheet = await CheatSheetVersion.findOne({ companyId: targetId, status: 'live' });
        if (!targetSheet) {
            targetSheet = new CheatSheetVersion({
                companyId: targetId,
                status: 'live',
                config: { edgeCases: [], transferRules: [] }
            });
        }
        targetSheet.config.edgeCases = sourceSheet.config.edgeCases;
        await targetSheet.save();
    }
}

async function copyPlaceholders(sourceId, targetId) {
    const sourcePlaceholders = await CompanyPlaceholders.findOne({ companyId: sourceId }).lean();
    
    if (sourcePlaceholders?.placeholders) {
        await CompanyPlaceholders.findOneAndUpdate(
            { companyId: targetId },
            { $set: { placeholders: sourcePlaceholders.placeholders } },
            { upsert: true }
        );
    }
}

module.exports = router;

