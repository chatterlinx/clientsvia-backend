/**
 * ============================================================================
 * DEBUG: GREETING ENDPOINTS
 * ============================================================================
 * 
 * GET  /api/company/:companyId/debug/greeting  - Read raw DB values
 * PUT  /api/company/:companyId/debug/greeting  - Force write + read-back
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const mongoose = require('mongoose');
const v2Company = require('../../models/v2Company');
const logger = require('../../utils/logger');

/**
 * Safe path getter (like lodash.get)
 */
function getPath(obj, path, defaultValue = null) {
    if (!obj || !path) return defaultValue;
    const keys = path.split('.');
    let result = obj;
    for (const key of keys) {
        if (result === null || result === undefined) return defaultValue;
        result = result[key];
    }
    return result !== undefined ? result : defaultValue;
}

/**
 * GET /api/company/:companyId/debug/greeting
 * 
 * Returns RAW DB values from ALL possible greeting locations.
 */
router.get('/', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const company = await v2Company.findById(companyId).lean();
        
        if (!company) {
            return res.status(404).json({ ok: false, error: 'Company not found' });
        }
        
        // Read ALL possible greeting locations
        const rawValues = {
            'connectionMessages.voice.text': getPath(company, 'connectionMessages.voice.text'),
            'connectionMessages.voice.realtime.text': getPath(company, 'connectionMessages.voice.realtime.text'),
            'frontDeskBehavior.greeting': getPath(company, 'frontDeskBehavior.greeting'),
            'aiAgentSettings.frontDeskBehavior.greeting': getPath(company, 'aiAgentSettings.frontDeskBehavior.greeting'),
            'aiAgentSettings.greeting': getPath(company, 'aiAgentSettings.greeting'),
            'callFlowEngine.style.greeting': getPath(company, 'callFlowEngine.style.greeting')
        };
        
        // Determine which path wins
        let resolvedSource = 'none';
        let resolvedPath = null;
        let resolvedRaw = null;
        
        if (rawValues['connectionMessages.voice.text']?.trim?.()) {
            resolvedSource = 'connectionMessages.voice (CANONICAL)';
            resolvedPath = 'connectionMessages.voice.text';
            resolvedRaw = rawValues['connectionMessages.voice.text'];
        } else if (rawValues['connectionMessages.voice.realtime.text']?.trim?.()) {
            resolvedSource = 'connectionMessages.voice.realtime (CANONICAL FALLBACK)';
            resolvedPath = 'connectionMessages.voice.realtime.text';
            resolvedRaw = rawValues['connectionMessages.voice.realtime.text'];
        } else if (rawValues['frontDeskBehavior.greeting']?.trim?.()) {
            resolvedSource = 'frontDeskBehavior.greeting (LEGACY)';
            resolvedPath = 'frontDeskBehavior.greeting';
            resolvedRaw = rawValues['frontDeskBehavior.greeting'];
        }
        
        // Render with placeholders
        let rendered = null;
        if (resolvedRaw) {
            try {
                const { substitutePlaceholders } = require('../../utils/placeholderStandard');
                const Placeholder = require('../../models/Placeholder');
                const placeholders = await Placeholder.find({ companyId }).lean();
                const placeholderMap = { companyName: company.companyName };
                placeholders.forEach(p => { placeholderMap[p.key] = p.value; });
                rendered = substitutePlaceholders(resolvedRaw, placeholderMap);
            } catch (e) {
                rendered = resolvedRaw;
            }
        }
        
        // Diagnostic
        const canonical = rawValues['connectionMessages.voice.text'];
        const legacy = rawValues['frontDeskBehavior.greeting'];
        
        let diagnosis = 'UNKNOWN';
        if (canonical?.trim?.() && !legacy?.trim?.()) {
            diagnosis = 'OK - Canonical has value, legacy is empty';
        } else if (!canonical?.trim?.() && legacy?.trim?.()) {
            diagnosis = 'BUG - Legacy has value but canonical is EMPTY!';
        } else if (canonical?.trim?.() && legacy?.trim?.()) {
            diagnosis = 'WARNING - Both have values. Canonical wins but legacy should be cleared.';
        } else {
            diagnosis = 'NO GREETING SET';
        }
        
        res.json({
            ok: true,
            companyId,
            companyName: company.companyName,
            resolved: { source: resolvedSource, path: resolvedPath, raw: resolvedRaw, rendered },
            rawValues,
            diagnostic: { diagnosis }
        });
        
    } catch (error) {
        logger.error('[DEBUG GREETING GET] Error:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

/**
 * PUT /api/company/:companyId/debug/greeting
 * 
 * Force write to canonical paths, clear legacy, return read-back proof.
 * 
 * Body: { "text": "...", "realtimeText": "..." }
 */
router.put('/', async (req, res) => {
    const { companyId } = req.params;
    const { text, realtimeText } = req.body;
    
    if (!text) {
        return res.status(400).json({
            ok: false,
            error: 'text field is required',
            example: { text: '{{companyName}} — how can I help?', realtimeText: '{{companyName}} — how can I help?' }
        });
    }
    
    try {
        const effectiveRealtimeText = realtimeText || text;
        
        // Direct MongoDB update
        const result = await v2Company.updateOne(
            { _id: new mongoose.Types.ObjectId(companyId) },
            {
                $set: {
                    'connectionMessages.voice.text': text,
                    'connectionMessages.voice.realtime.text': effectiveRealtimeText,
                    'connectionMessages.lastUpdated': new Date(),
                    updatedAt: new Date()
                },
                $unset: {
                    'frontDeskBehavior.greeting': '',
                    'aiAgentSettings.greeting': '',
                    'aiAgentSettings.frontDeskBehavior.greeting': '',
                    'callFlowEngine.style.greeting': ''
                }
            }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ ok: false, error: 'Company not found' });
        }
        
        // Clear Redis cache
        try {
            const { redisClient } = require('../../db');
            if (redisClient && redisClient.isOpen) {
                await redisClient.del(`company:${companyId}`);
            }
        } catch (e) {
            // Non-critical
        }
        
        logger.info(`[DEBUG GREETING PUT] Wrote greeting for ${companyId}`);
        
        // Read-back from DB
        const company = await v2Company.findById(companyId).lean();
        
        const readBack = {
            'connectionMessages.voice.text': getPath(company, 'connectionMessages.voice.text'),
            'connectionMessages.voice.realtime.text': getPath(company, 'connectionMessages.voice.realtime.text'),
            'frontDeskBehavior.greeting': getPath(company, 'frontDeskBehavior.greeting'),
            'aiAgentSettings.greeting': getPath(company, 'aiAgentSettings.greeting')
        };
        
        // Placeholder-rendered preview
        let renderedPreview = null;
        try {
            const { substitutePlaceholders } = require('../../utils/placeholderStandard');
            const Placeholder = require('../../models/Placeholder');
            const placeholders = await Placeholder.find({ companyId }).lean();
            const placeholderMap = { companyName: company.companyName };
            placeholders.forEach(p => { placeholderMap[p.key] = p.value; });
            renderedPreview = substitutePlaceholders(text, placeholderMap);
        } catch (e) {
            renderedPreview = text;
        }
        
        res.json({
            ok: true,
            wrote: {
                'connectionMessages.voice.text': text,
                'connectionMessages.voice.realtime.text': effectiveRealtimeText
            },
            cleared: [
                'frontDeskBehavior.greeting',
                'aiAgentSettings.greeting',
                'aiAgentSettings.frontDeskBehavior.greeting',
                'callFlowEngine.style.greeting'
            ],
            readBack,
            renderedPreview,
            verification: {
                success: readBack['connectionMessages.voice.text'] === text
            }
        });
        
    } catch (error) {
        logger.error('[DEBUG GREETING PUT] Error:', error);
        res.status(500).json({ ok: false, error: error.message });
    }
});

module.exports = router;
