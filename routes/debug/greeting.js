/**
 * ============================================================================
 * DEBUG: GREETING RAW DB VALUES
 * ============================================================================
 * 
 * This endpoint exists ONLY to debug "greeting not sticking" issues.
 * It reads directly from MongoDB and shows EXACTLY what's stored.
 * 
 * NO RESOLVER LOGIC - just raw DB reads.
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
 * NO resolver logic, NO preview truncation, just raw truth.
 */
router.get('/', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        // Read DIRECTLY from MongoDB (lean = raw JSON, no Mongoose magic)
        const company = await v2Company.findById(companyId).lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // READ ALL POSSIBLE GREETING LOCATIONS (RAW, NO RESOLVER)
        // ═══════════════════════════════════════════════════════════════════════════
        const rawValues = {
            // CANONICAL (where runtime SHOULD read from)
            'connectionMessages.voice.text': getPath(company, 'connectionMessages.voice.text'),
            'connectionMessages.voice.realtime.text': getPath(company, 'connectionMessages.voice.realtime.text'),
            
            // LEGACY (might be overriding canonical)
            'frontDeskBehavior.greeting': getPath(company, 'frontDeskBehavior.greeting'),
            'aiAgentSettings.frontDeskBehavior.greeting': getPath(company, 'aiAgentSettings.frontDeskBehavior.greeting'),
            'aiAgentSettings.greeting': getPath(company, 'aiAgentSettings.greeting'),
            'callFlowEngine.style.greeting': getPath(company, 'callFlowEngine.style.greeting'),
            
            // SUPER LEGACY (shouldn't exist but check anyway)
            'greeting': getPath(company, 'greeting'),
            'profile.greeting': getPath(company, 'profile.greeting'),
            'connectionMessages.voiceText': getPath(company, 'connectionMessages.voiceText'),
            'connectionMessages.text': getPath(company, 'connectionMessages.text')
        };
        
        // ═══════════════════════════════════════════════════════════════════════════
        // DETERMINE WHICH PATH WINS (SAME LOGIC AS SNAPSHOT PROVIDER)
        // ═══════════════════════════════════════════════════════════════════════════
        let resolvedSource = 'none';
        let resolvedPath = null;
        let resolvedRaw = null;
        
        // Priority 1: connectionMessages.voice.text (CANONICAL)
        if (rawValues['connectionMessages.voice.text']?.trim?.()) {
            resolvedSource = 'connectionMessages.voice (CANONICAL)';
            resolvedPath = 'connectionMessages.voice.text';
            resolvedRaw = rawValues['connectionMessages.voice.text'];
        }
        // Priority 2: connectionMessages.voice.realtime.text
        else if (rawValues['connectionMessages.voice.realtime.text']?.trim?.()) {
            resolvedSource = 'connectionMessages.voice.realtime (CANONICAL FALLBACK)';
            resolvedPath = 'connectionMessages.voice.realtime.text';
            resolvedRaw = rawValues['connectionMessages.voice.realtime.text'];
        }
        // Priority 3: frontDeskBehavior.greeting (LEGACY)
        else if (rawValues['frontDeskBehavior.greeting']?.trim?.()) {
            resolvedSource = 'frontDeskBehavior.greeting (LEGACY - THIS IS THE BUG!)';
            resolvedPath = 'frontDeskBehavior.greeting';
            resolvedRaw = rawValues['frontDeskBehavior.greeting'];
        }
        // Priority 4: aiAgentSettings paths
        else if (rawValues['aiAgentSettings.frontDeskBehavior.greeting']?.trim?.()) {
            resolvedSource = 'aiAgentSettings.frontDeskBehavior.greeting (LEGACY)';
            resolvedPath = 'aiAgentSettings.frontDeskBehavior.greeting';
            resolvedRaw = rawValues['aiAgentSettings.frontDeskBehavior.greeting'];
        }
        else if (rawValues['aiAgentSettings.greeting']?.trim?.()) {
            resolvedSource = 'aiAgentSettings.greeting (LEGACY)';
            resolvedPath = 'aiAgentSettings.greeting';
            resolvedRaw = rawValues['aiAgentSettings.greeting'];
        }
        
        // Render with placeholders
        let resolvedRendered = null;
        if (resolvedRaw) {
            try {
                const { substitutePlaceholders } = require('../../utils/placeholderStandard');
                const Placeholder = require('../../models/Placeholder');
                const placeholders = await Placeholder.find({ companyId }).lean();
                const placeholderMap = { companyName: company.companyName };
                placeholders.forEach(p => { placeholderMap[p.key] = p.value; });
                resolvedRendered = substitutePlaceholders(resolvedRaw, placeholderMap);
            } catch (e) {
                resolvedRendered = resolvedRaw; // Fallback to raw if substitution fails
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // BUILD DIAGNOSTIC
        // ═══════════════════════════════════════════════════════════════════════════
        const canonical = rawValues['connectionMessages.voice.text'];
        const legacy = rawValues['frontDeskBehavior.greeting'];
        
        let diagnosis = 'UNKNOWN';
        let fix = 'Run /debug/greeting PUT endpoint';
        
        if (canonical?.trim?.() && !legacy?.trim?.()) {
            diagnosis = 'OK - Canonical has value, legacy is empty';
            fix = 'None needed - greeting should work';
        } else if (!canonical?.trim?.() && legacy?.trim?.()) {
            diagnosis = 'BUG - Legacy has value but canonical is EMPTY! Legacy is winning.';
            fix = 'Use PUT /debug/greeting to write to canonical path';
        } else if (canonical?.trim?.() && legacy?.trim?.()) {
            diagnosis = 'WARNING - Both have values. Canonical wins but legacy should be cleared.';
            fix = 'Use PUT /debug/greeting to clear legacy';
        } else if (!canonical?.trim?.() && !legacy?.trim?.()) {
            diagnosis = 'NO GREETING SET - Both canonical and legacy are empty';
            fix = 'Use PUT /debug/greeting to set greeting';
        }
        
        res.json({
            success: true,
            companyId,
            companyName: company.companyName,
            
            // ═══════════════════════════════════════════════════════════════════════════
            // RESOLVED (what runtime SHOULD use based on priority)
            // ═══════════════════════════════════════════════════════════════════════════
            resolved: {
                source: resolvedSource,
                path: resolvedPath,
                raw: resolvedRaw,
                rendered: resolvedRendered
            },
            
            // ═══════════════════════════════════════════════════════════════════════════
            // RAW VALUES FROM ALL PATHS (the truth)
            // ═══════════════════════════════════════════════════════════════════════════
            rawValues,
            
            // ═══════════════════════════════════════════════════════════════════════════
            // DIAGNOSTIC
            // ═══════════════════════════════════════════════════════════════════════════
            diagnostic: {
                canonicalPath: 'connectionMessages.voice.text',
                canonicalValue: canonical || '(EMPTY)',
                legacyPath: 'frontDeskBehavior.greeting',
                legacyValue: legacy || '(EMPTY)',
                diagnosis,
                fix
            },
            
            generatedAt: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('[DEBUG GREETING] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/company/:companyId/debug/greeting
 * 
 * FORCE WRITE to canonical paths ONLY.
 * Also CLEARS all legacy paths.
 * Returns GET output immediately so you see proof.
 */
router.put('/', async (req, res) => {
    const { companyId } = req.params;
    const { text, realtimeText } = req.body;
    
    if (!text) {
        return res.status(400).json({
            success: false,
            error: 'text field is required',
            example: { text: '{{companyName}} — how can I help?', realtimeText: '{{companyName}} — how can I help?' }
        });
    }
    
    try {
        // ═══════════════════════════════════════════════════════════════════════════
        // DIRECT MONGODB UPDATE (bypass Mongoose to avoid any hooks)
        // ═══════════════════════════════════════════════════════════════════════════
        const result = await v2Company.updateOne(
            { _id: new mongoose.Types.ObjectId(companyId) },
            {
                $set: {
                    'connectionMessages.voice.text': text,
                    'connectionMessages.voice.realtime.text': realtimeText || text,
                    'connectionMessages.lastUpdated': new Date()
                },
                $unset: {
                    // CLEAR ALL LEGACY PATHS
                    'frontDeskBehavior.greeting': '',
                    'aiAgentSettings.greeting': '',
                    'aiAgentSettings.frontDeskBehavior.greeting': '',
                    'callFlowEngine.style.greeting': '',
                    'greeting': '',
                    'profile.greeting': ''
                }
            }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Clear Redis cache
        try {
            const { redisClient } = require('../../db');
            if (redisClient && redisClient.isOpen) {
                await redisClient.del(`company:${companyId}`);
                logger.info(`[DEBUG GREETING] Cleared Redis cache for ${companyId}`);
            }
        } catch (e) {
            logger.warn('[DEBUG GREETING] Redis clear failed:', e.message);
        }
        
        logger.info(`[DEBUG GREETING] FORCE WROTE greeting for ${companyId}: "${text}"`);
        
        // ═══════════════════════════════════════════════════════════════════════════
        // NOW RE-READ AND RETURN THE SAME FORMAT AS GET
        // (This proves the write actually worked)
        // ═══════════════════════════════════════════════════════════════════════════
        
        // Re-fetch to verify
        const company = await v2Company.findById(companyId).lean();
        
        const rawValues = {
            'connectionMessages.voice.text': getPath(company, 'connectionMessages.voice.text'),
            'connectionMessages.voice.realtime.text': getPath(company, 'connectionMessages.voice.realtime.text'),
            'frontDeskBehavior.greeting': getPath(company, 'frontDeskBehavior.greeting'),
            'aiAgentSettings.frontDeskBehavior.greeting': getPath(company, 'aiAgentSettings.frontDeskBehavior.greeting'),
            'aiAgentSettings.greeting': getPath(company, 'aiAgentSettings.greeting'),
            'callFlowEngine.style.greeting': getPath(company, 'callFlowEngine.style.greeting')
        };
        
        res.json({
            success: true,
            action: 'FORCE_WRITE',
            companyId,
            companyName: company.companyName,
            
            wrote: {
                'connectionMessages.voice.text': text,
                'connectionMessages.voice.realtime.text': realtimeText || text
            },
            
            cleared: [
                'frontDeskBehavior.greeting',
                'aiAgentSettings.greeting',
                'aiAgentSettings.frontDeskBehavior.greeting',
                'callFlowEngine.style.greeting',
                'greeting',
                'profile.greeting'
            ],
            
            // PROOF: Re-read values
            verifiedValues: rawValues,
            
            verification: {
                canonicalNowHasValue: !!rawValues['connectionMessages.voice.text'],
                legacyNowCleared: !rawValues['frontDeskBehavior.greeting'],
                success: rawValues['connectionMessages.voice.text'] === text
            },
            
            generatedAt: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('[DEBUG GREETING] Error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PUT /api/company/:companyId/debug/greeting/add-transfer
 * 
 * EMERGENCY: Add service_advisor transfer target (fixes the trap door).
 */
router.put('/add-transfer', async (req, res) => {
    const { companyId } = req.params;
    const { 
        id = 'service_advisor',
        name = 'Service Advisor',
        type = 'phone',
        destination = '+15551234568',
        description = 'Primary escalation for urgent calls'
    } = req.body;
    
    try {
        // Add to aiAgentSettings.transferTargets
        const result = await v2Company.updateOne(
            { _id: new mongoose.Types.ObjectId(companyId) },
            {
                $push: {
                    'aiAgentSettings.transferTargets': {
                        id,
                        name,
                        type,
                        destination,
                        description,
                        priority: 1,
                        enabled: true,
                        isDefault: true
                    }
                }
            }
        );
        
        if (result.matchedCount === 0) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        // Clear Redis cache
        try {
            const { redisClient } = require('../../db');
            if (redisClient && redisClient.isOpen) {
                await redisClient.del(`company:${companyId}`);
            }
        } catch (e) {
            // Redis clear failed, not critical
        }
        
        logger.info(`[DEBUG] Added transfer target ${id} for ${companyId}`);
        
        // Verify
        const company = await v2Company.findById(companyId).lean();
        const transfers = company?.aiAgentSettings?.transferTargets || [];
        
        res.json({
            success: true,
            action: 'ADD_TRANSFER',
            companyId,
            added: { id, name, type, destination },
            totalTransfers: transfers.length,
            transferIds: transfers.map(t => t.id)
        });
        
    } catch (error) {
        logger.error('[DEBUG ADD TRANSFER] Error:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;

