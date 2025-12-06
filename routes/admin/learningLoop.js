// ============================================================================
// LEARNING LOOP ADMIN ROUTES
// ============================================================================
// 📋 PURPOSE: Quick-add endpoints for the AI Learning Loop
// 🎯 FEATURES:
//    - Add spam phrases to Edge Cases (from Black Box TODO)
//    - Add spam numbers to Blacklist (from Black Box TODO)
//    - Add synonyms to scenarios (from Black Box TODO)
//    - Track learning improvements over time
// 🔒 AUTH: Admin only
// 🔄 FLOW: Black Box TODO → Quick Add → Edge Cases/Blacklist → FREE next time
// ============================================================================

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const v2Company = require('../../models/v2Company');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const { redisClient } = require('../../clients');

// ============================================================================
// QUICK ADD EDGE CASE (from Black Box TODO)
// ============================================================================
// Purpose: One-click add spam phrase from Black Box to Edge Cases
// Flow: Black Box detects spam phrase → Admin clicks "Add to Edge Cases" → Done
// ============================================================================
router.post('/quick-add-edge-case/:companyId', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { 
            triggerPhrase,      // The spam phrase that triggered LLM detection
            responseText,       // What to say when detected
            actionType,         // 'polite_hangup' | 'override_response' | 'flag_only'
            priority,           // 1-100 (higher = checked first)
            sourceCallId,       // Black Box call ID for tracking
            sourceEvent,        // Black Box event type (e.g., 'SPAM_DETECTED')
            category            // 'telemarketer' | 'robocall' | 'irrelevant' | 'custom'
        } = req.body;

        logger.info(`🎓 [LEARNING LOOP] Quick-add edge case request`, {
            companyId,
            triggerPhrase: triggerPhrase?.substring(0, 50),
            actionType,
            sourceCallId
        });

        // Validation
        if (!triggerPhrase || triggerPhrase.trim().length < 3) {
            return res.status(400).json({
                success: false,
                message: 'Trigger phrase is required (minimum 3 characters)'
            });
        }

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Initialize aiAgentSettings.cheatSheet if not exists
        if (!company.aiAgentSettings) {
            company.aiAgentSettings = {};
        }
        if (!company.aiAgentSettings.cheatSheet) {
            company.aiAgentSettings.cheatSheet = {
                version: 1,
                status: 'draft',
                edgeCases: [],
                transferRules: [],
                behaviorRules: [],
                guardrails: []
            };
        }
        if (!Array.isArray(company.aiAgentSettings.cheatSheet.edgeCases)) {
            company.aiAgentSettings.cheatSheet.edgeCases = [];
        }

        // Check if similar edge case already exists
        const normalizedPhrase = triggerPhrase.toLowerCase().trim();
        const existingEdgeCase = company.aiAgentSettings.cheatSheet.edgeCases.find(ec => {
            if (!ec.triggerPatterns) return false;
            return ec.triggerPatterns.some(pattern => 
                pattern.toLowerCase().includes(normalizedPhrase) ||
                normalizedPhrase.includes(pattern.toLowerCase())
            );
        });

        if (existingEdgeCase) {
            logger.info(`⚠️ [LEARNING LOOP] Similar edge case already exists`, {
                companyId,
                existingName: existingEdgeCase.name,
                existingPatterns: existingEdgeCase.triggerPatterns
            });
            return res.status(409).json({
                success: false,
                message: `Similar edge case already exists: "${existingEdgeCase.name}"`,
                existingEdgeCase: {
                    name: existingEdgeCase.name,
                    patterns: existingEdgeCase.triggerPatterns
                }
            });
        }

        // Generate unique ID
        const edgeCaseId = `ec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

        // Build the new edge case
        const categoryLabels = {
            'telemarketer': '🤖 Telemarketer',
            'robocall': '📞 Robocall',
            'irrelevant': '❌ Irrelevant',
            'custom': '⚙️ Custom'
        };

        const defaultResponses = {
            'telemarketer': "I appreciate the call, but we're not interested in any services at this time. Thank you, goodbye.",
            'robocall': "This appears to be an automated call. Goodbye.",
            'irrelevant': "I'm sorry, but that's not something we can help with. Is there anything else?",
            'custom': responseText || "I understand. Let me transfer you to the appropriate person."
        };

        const newEdgeCase = {
            id: edgeCaseId,
            name: `${categoryLabels[category] || '🎓 Learned'}: ${triggerPhrase.substring(0, 30)}...`,
            description: `Auto-learned from call ${sourceCallId || 'unknown'} via Black Box`,
            enabled: true,
            priority: priority || 80,  // High priority for spam
            triggerPatterns: [normalizedPhrase],
            responseText: responseText || defaultResponses[category] || defaultResponses['custom'],
            action: {
                type: actionType || 'polite_hangup',
                hangupMessage: responseText || defaultResponses[category],
                logEvent: true
            },
            // Metadata for tracking
            createdAt: new Date(),
            createdBy: req.user?.email || 'admin',
            source: 'learning_loop',
            sourceCallId: sourceCallId || null,
            sourceEvent: sourceEvent || null,
            category: category || 'custom'
        };

        // Add to edge cases
        company.aiAgentSettings.cheatSheet.edgeCases.push(newEdgeCase);
        company.aiAgentSettings.cheatSheet.status = 'draft';
        company.aiAgentSettings.cheatSheet.updatedAt = new Date();
        company.aiAgentSettings.cheatSheet.updatedBy = req.user?.email || 'admin';

        company.markModified('aiAgentSettings.cheatSheet');
        await company.save();

        // Clear Redis cache
        try {
            await redisClient.del(`company:${companyId}`);
            await redisClient.del(`policy:${companyId}:active`);
            logger.debug(`✅ [LEARNING LOOP] Redis cache cleared for company: ${companyId}`);
        } catch (cacheError) {
            logger.warn(`⚠️ [LEARNING LOOP] Cache clear failed (non-critical):`, cacheError.message);
        }

        logger.info(`✅ [LEARNING LOOP] Edge case added successfully`, {
            companyId,
            edgeCaseId,
            name: newEdgeCase.name,
            triggerPhrase: normalizedPhrase
        });

        res.json({
            success: true,
            message: `Edge case added! "${triggerPhrase}" will now be handled automatically.`,
            edgeCase: newEdgeCase,
            nextSteps: [
                'Edge case is now in DRAFT mode',
                'Go to Control Plane → Cheat Sheet → Edge Cases to review',
                'Click "Compile" to activate the new rule',
                'Next call with this phrase will be blocked at Layer 2 (FREE!)'
            ]
        });

    } catch (error) {
        logger.error(`❌ [LEARNING LOOP] Quick-add edge case failed:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to add edge case',
            error: error.message
        });
    }
});

// ============================================================================
// QUICK ADD TO BLACKLIST (from Black Box TODO)
// ============================================================================
// Purpose: One-click add spam number from Black Box to company blacklist
// Flow: Black Box shows spam call → Admin clicks "Add to Blacklist" → Done
// ============================================================================
router.post('/quick-add-blacklist/:companyId', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { 
            phoneNumber,        // The spam caller's phone number
            reason,             // Why it's being blocked
            sourceCallId,       // Black Box call ID for tracking
            spamCategory        // 'telemarketer' | 'robocall' | 'harassment' | 'other'
        } = req.body;

        logger.info(`🎓 [LEARNING LOOP] Quick-add blacklist request`, {
            companyId,
            phoneNumber,
            spamCategory,
            sourceCallId
        });

        // Validation
        if (!phoneNumber) {
            return res.status(400).json({
                success: false,
                message: 'Phone number is required'
            });
        }

        // Normalize phone number
        const normalizedPhone = phoneNumber.replace(/[^\d+]/g, '');
        if (normalizedPhone.length < 10) {
            return res.status(400).json({
                success: false,
                message: 'Invalid phone number format'
            });
        }

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Initialize callFiltering if not exists
        if (!company.callFiltering) {
            company.callFiltering = {
                enabled: true,
                blacklist: [],
                whitelist: [],
                settings: {},
                stats: {}
            };
        }

        // Check if already blacklisted
        const existing = company.callFiltering.blacklist.find(entry => 
            entry.phoneNumber === normalizedPhone && entry.status === 'active'
        );

        if (existing) {
            return res.status(409).json({
                success: false,
                message: 'Number already in blacklist',
                addedAt: existing.addedAt,
                reason: existing.reason
            });
        }

        // Build reason with category
        const categoryLabels = {
            'telemarketer': '🤖 Telemarketer',
            'robocall': '📞 Robocall',
            'harassment': '⚠️ Harassment',
            'other': '❌ Other'
        };
        const fullReason = `${categoryLabels[spamCategory] || '🎓 Learned'}: ${reason || 'Flagged from Black Box'}`;

        // Add to blacklist
        company.callFiltering.blacklist.push({
            phoneNumber: normalizedPhone,
            reason: fullReason,
            addedAt: new Date(),
            addedBy: req.user?.email || 'admin',
            status: 'active',
            source: 'learning_loop',
            sourceCallId: sourceCallId || null,
            category: spamCategory || 'other'
        });

        await company.save();

        // Clear Redis cache
        try {
            await redisClient.del(`company:${companyId}`);
            logger.debug(`✅ [LEARNING LOOP] Redis cache cleared for company: ${companyId}`);
        } catch (cacheError) {
            logger.warn(`⚠️ [LEARNING LOOP] Cache clear failed (non-critical):`, cacheError.message);
        }

        logger.info(`✅ [LEARNING LOOP] Number blacklisted successfully`, {
            companyId,
            phoneNumber: normalizedPhone,
            reason: fullReason
        });

        res.json({
            success: true,
            message: `Number ${normalizedPhone} blacklisted! Future calls will be blocked at Layer 1 (FREE!).`,
            blacklistEntry: {
                phoneNumber: normalizedPhone,
                reason: fullReason,
                addedAt: new Date()
            },
            nextSteps: [
                'Number is now blocked immediately',
                'Future calls from this number will be rejected at Layer 1 (SmartCallFilter)',
                'No LLM cost - completely free blocking!',
                'View blocked calls in Spam Filter → Blocked Calls'
            ]
        });

    } catch (error) {
        logger.error(`❌ [LEARNING LOOP] Quick-add blacklist failed:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to add to blacklist',
            error: error.message
        });
    }
});

// ============================================================================
// QUICK ADD SYNONYM (from Black Box TODO)
// ============================================================================
// Purpose: One-click add slang/colloquial term to synonym list
// Flow: Black Box detects slang → Admin clicks "Add Synonym" → Done
// ============================================================================
router.post('/quick-add-synonym/:companyId', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { companyId } = req.params;
        const { 
            colloquialTerm,     // The slang term (e.g., "thingy on the wall")
            technicalTerm,      // What it means (e.g., "thermostat")
            scenarioId,         // Which scenario to add it to
            sourceCallId        // Black Box call ID for tracking
        } = req.body;

        logger.info(`🎓 [LEARNING LOOP] Quick-add synonym request`, {
            companyId,
            colloquialTerm,
            technicalTerm,
            scenarioId,
            sourceCallId
        });

        // Validation
        if (!colloquialTerm || !technicalTerm) {
            return res.status(400).json({
                success: false,
                message: 'Both colloquial term and technical term are required'
            });
        }

        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Find the scenario to add synonym to
        const scenarios = company.aiAgentSettings?.scenarios || [];
        let targetScenario = null;

        if (scenarioId) {
            targetScenario = scenarios.find(s => s._id?.toString() === scenarioId || s.id === scenarioId);
        }

        if (!targetScenario) {
            // Return available scenarios for user to choose
            const availableScenarios = scenarios.map(s => ({
                id: s._id?.toString() || s.id,
                name: s.name || s.scenarioName,
                category: s.category
            }));

            return res.status(400).json({
                success: false,
                message: 'Scenario not found. Please select a scenario.',
                availableScenarios
            });
        }

        // Initialize synonyms array if needed
        if (!targetScenario.effectiveSynonyms) {
            targetScenario.effectiveSynonyms = [];
        }

        // Check if synonym already exists
        const normalizedColloquial = colloquialTerm.toLowerCase().trim();
        const existingSynonym = targetScenario.effectiveSynonyms.find(s => 
            s.term?.toLowerCase() === normalizedColloquial ||
            (s.aliases && s.aliases.some(a => a.toLowerCase() === normalizedColloquial))
        );

        if (existingSynonym) {
            return res.status(409).json({
                success: false,
                message: `Synonym "${colloquialTerm}" already exists in this scenario`,
                existingSynonym
            });
        }

        // Add the new synonym
        const newSynonym = {
            term: technicalTerm.toLowerCase().trim(),
            aliases: [normalizedColloquial],
            addedAt: new Date(),
            addedBy: req.user?.email || 'admin',
            source: 'learning_loop',
            sourceCallId: sourceCallId || null
        };

        targetScenario.effectiveSynonyms.push(newSynonym);

        company.markModified('aiAgentSettings.scenarios');
        await company.save();

        // Clear Redis cache
        try {
            await redisClient.del(`company:${companyId}`);
            logger.debug(`✅ [LEARNING LOOP] Redis cache cleared for company: ${companyId}`);
        } catch (cacheError) {
            logger.warn(`⚠️ [LEARNING LOOP] Cache clear failed (non-critical):`, cacheError.message);
        }

        logger.info(`✅ [LEARNING LOOP] Synonym added successfully`, {
            companyId,
            scenarioId,
            colloquialTerm: normalizedColloquial,
            technicalTerm
        });

        res.json({
            success: true,
            message: `Synonym added! "${colloquialTerm}" will now be understood as "${technicalTerm}".`,
            synonym: newSynonym,
            scenario: {
                id: targetScenario._id?.toString() || targetScenario.id,
                name: targetScenario.name || targetScenario.scenarioName
            },
            nextSteps: [
                `Synonym added to scenario "${targetScenario.name || targetScenario.scenarioName}"`,
                'AI will now recognize this term automatically',
                'Future calls using this slang will match the scenario'
            ]
        });

    } catch (error) {
        logger.error(`❌ [LEARNING LOOP] Quick-add synonym failed:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to add synonym',
            error: error.message
        });
    }
});

// ============================================================================
// GET LEARNING STATS (what we've learned)
// ============================================================================
router.get('/stats/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;

        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        // Count learned items
        const edgeCases = company.aiAgentSettings?.cheatSheet?.edgeCases || [];
        const blacklist = company.callFiltering?.blacklist || [];
        const scenarios = company.aiAgentSettings?.scenarios || [];

        const learnedEdgeCases = edgeCases.filter(ec => ec.source === 'learning_loop');
        const learnedBlacklist = blacklist.filter(b => b.source === 'learning_loop');
        
        let learnedSynonyms = 0;
        scenarios.forEach(s => {
            if (s.effectiveSynonyms) {
                learnedSynonyms += s.effectiveSynonyms.filter(syn => syn.source === 'learning_loop').length;
            }
        });

        const stats = {
            edgeCases: {
                total: edgeCases.length,
                learned: learnedEdgeCases.length,
                manual: edgeCases.length - learnedEdgeCases.length
            },
            blacklist: {
                total: blacklist.filter(b => b.status === 'active').length,
                learned: learnedBlacklist.filter(b => b.status === 'active').length,
                manual: blacklist.filter(b => b.status === 'active').length - learnedBlacklist.filter(b => b.status === 'active').length
            },
            synonyms: {
                learned: learnedSynonyms
            },
            // Cost savings estimate (rough)
            estimatedSavings: {
                blockedAtLayer1: learnedBlacklist.filter(b => b.status === 'active').length,
                blockedAtLayer2: learnedEdgeCases.filter(ec => ec.enabled).length,
                llmCallsAvoided: learnedBlacklist.filter(b => b.status === 'active').length + learnedEdgeCases.filter(ec => ec.enabled).length,
                estimatedCostSaved: `$${((learnedBlacklist.filter(b => b.status === 'active').length + learnedEdgeCases.filter(ec => ec.enabled).length) * 0.05).toFixed(2)} per occurrence`
            }
        };

        res.json({
            success: true,
            stats,
            message: 'Learning loop is making your AI smarter and cheaper!'
        });

    } catch (error) {
        logger.error(`❌ [LEARNING LOOP] Stats fetch failed:`, error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch learning stats',
            error: error.message
        });
    }
});

module.exports = router;

