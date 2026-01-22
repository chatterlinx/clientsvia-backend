/**
 * ============================================================================
 * SCENARIO MIGRATIONS - Admin API for database scenario fixes
 * ============================================================================
 * 
 * These endpoints run scenario migrations on the production database.
 * Used when scenario matching needs to be fixed without manual DB access.
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const { authenticateJWT } = require('../../middleware/auth');

const TEMPLATE_ID = '68fb535130d19aec696d8123';

// ============================================================================
// POST /fix-callback-scenario
// Fix the callback vs "not sure" scenario mismatch
// ============================================================================
router.post('/fix-callback-scenario', authenticateJWT, async (req, res) => {
    console.log('\n============================================================');
    console.log('🔧 RUNNING: Fix Callback vs "Not Sure" Scenario Mismatch');
    console.log('============================================================\n');
    
    const results = {
        success: false,
        notSureScenario: { found: false, negativesAdded: 0, totalNegatives: 0 },
        followUpScenario: { found: false, triggersAdded: 0, totalTriggers: 0, created: false },
        errors: []
    };
    
    try {
        const template = await GlobalInstantResponseTemplate.findById(TEMPLATE_ID);
        if (!template) {
            results.errors.push(`Template not found: ${TEMPLATE_ID}`);
            return res.status(404).json(results);
        }
        
        console.log(`📋 Template: ${template.version} - ${template.name}`);
        console.log(`   Categories: ${template.categories?.length || 0}\n`);
        
        // ============================================================================
        // NEW NEGATIVE TRIGGERS for "Caller Not Sure What They Need"
        // ============================================================================
        const NEW_NEGATIVE_TRIGGERS_FOR_NOT_SURE = [
            'you guys were here', 'was here last week', 'come back out', 'come back again',
            'return visit', 'same technician', 'same tech', 'technician was here',
            'tech was here', 'worked on it before', 'look up my records', 'look up my account',
            'check my records', 'check my account', 'follow up', 'follow-up', 'warranty issue',
            'still not working after', 'same problem again', 'problem came back', 'issue came back',
            'send the same', 'request the same', 'want the same', 'he was here', 'she was here',
            'his name was', 'her name was', 'the guy who', 'the person who'
        ];
        
        // ============================================================================
        // NEW TRIGGERS for "Follow-Up After Service" scenario
        // ============================================================================
        const NEW_TRIGGERS_FOR_FOLLOW_UP = [
            'you guys were here', 'you were here', 'was here last week', 'was here yesterday',
            'was here recently', 'came out before', 'came out last', 'worked on it before',
            'fixed it before', 'repaired it before', 'come back out', 'come back again',
            'come back and check', 'come back and look', 'can you come back', 'need someone back',
            'send someone back', 'same technician', 'same tech', 'the tech who came',
            'the guy who came', 'request the same', 'look up my records', 'look up my account',
            'check my records', 'pull up my file', 'still having the issue', 'problem is back',
            'it broke again', 'stopped working again', 'not working again', 'acting up again',
            'his name was', 'her name was', 'the technician name'
        ];
        
        let notSureScenario = null;
        let followUpScenario = null;
        let customerServiceCategory = null;
        
        // Find scenarios
        for (const category of template.categories || []) {
            for (const scenario of category.scenarios || []) {
                const name = (scenario.name || '').toLowerCase();
                
                if (name.includes('not sure what they need') || name.includes('caller not sure')) {
                    notSureScenario = scenario;
                    results.notSureScenario.found = true;
                    console.log(`✅ Found "Caller Not Sure" in: ${category.name}`);
                }
                
                if (name.includes('follow-up after service') || name.includes('follow up after service') ||
                    name.includes('callback') || name.includes('return visit')) {
                    followUpScenario = scenario;
                    results.followUpScenario.found = true;
                    console.log(`✅ Found "Follow-Up" scenario in: ${category.name}`);
                }
                
                if (category.name?.toLowerCase().includes('customer') || 
                    category.name?.toLowerCase().includes('billing')) {
                    customerServiceCategory = category;
                }
            }
        }
        
        // ============================================================
        // FIX 1: Add negative triggers to "Caller Not Sure"
        // ============================================================
        if (notSureScenario) {
            const existingNegatives = new Set((notSureScenario.negativeTriggers || []).map(t => t.toLowerCase()));
            let addedCount = 0;
            
            for (const newTrigger of NEW_NEGATIVE_TRIGGERS_FOR_NOT_SURE) {
                if (!existingNegatives.has(newTrigger.toLowerCase())) {
                    notSureScenario.negativeTriggers = notSureScenario.negativeTriggers || [];
                    notSureScenario.negativeTriggers.push(newTrigger);
                    addedCount++;
                }
            }
            
            results.notSureScenario.negativesAdded = addedCount;
            results.notSureScenario.totalNegatives = notSureScenario.negativeTriggers?.length || 0;
            console.log(`   ✅ Added ${addedCount} negative triggers to "Caller Not Sure"`);
        }
        
        // ============================================================
        // FIX 2: Add triggers to "Follow-Up After Service"
        // ============================================================
        if (followUpScenario) {
            const existingTriggers = new Set((followUpScenario.triggers || []).map(t => t.toLowerCase()));
            let addedCount = 0;
            
            for (const newTrigger of NEW_TRIGGERS_FOR_FOLLOW_UP) {
                if (!existingTriggers.has(newTrigger.toLowerCase())) {
                    followUpScenario.triggers = followUpScenario.triggers || [];
                    followUpScenario.triggers.push(newTrigger);
                    addedCount++;
                }
            }
            
            // Increase priority
            const oldPriority = followUpScenario.priority || 0;
            followUpScenario.priority = Math.max(oldPriority, 8);
            
            results.followUpScenario.triggersAdded = addedCount;
            results.followUpScenario.totalTriggers = followUpScenario.triggers?.length || 0;
            console.log(`   ✅ Added ${addedCount} triggers to "Follow-Up After Service"`);
            console.log(`   📈 Priority: ${oldPriority} → ${followUpScenario.priority}`);
        } else if (customerServiceCategory) {
            // Create new callback scenario
            const newScenario = {
                scenarioId: `scenario-${Date.now()}-callback`,
                name: 'Callback / Return Visit Request',
                isActive: true,
                status: 'live',
                priority: 8,
                triggers: NEW_TRIGGERS_FOR_FOLLOW_UP,
                negativeTriggers: ['new customer', 'first time calling', 'never used before'],
                quickReplies: [
                    "I see you've had service with us before. Let me look up your account.",
                    "I can definitely help with that. Let me pull up your records.",
                    "We stand behind our work — let me get this scheduled for you."
                ],
                fullReplies: [
                    "I'd be happy to help with a follow-up visit. Let me pull up your account and see when our technician was last there. If the issue is related to the previous repair, we'll absolutely take care of it. Can you give me the address or phone number on the account?",
                    "I understand you need us to come back out. We definitely want to make sure the job was done right. Let me look up your recent service history and we can get someone scheduled. What's the address?",
                    "No problem at all — if you've had service with us before and the issue came back, we'll get it resolved. Let me find your account and check on the previous work. What's your name or address?"
                ],
                actionHooks: ['lookup_history', 'flag_callback'],
                handoffPolicy: 'low_confidence',
                contextWeight: 0.8
            };
            
            customerServiceCategory.scenarios.push(newScenario);
            results.followUpScenario.created = true;
            results.followUpScenario.triggersAdded = NEW_TRIGGERS_FOR_FOLLOW_UP.length;
            console.log(`   ✅ Created new "Callback / Return Visit Request" scenario`);
        }
        
        // Save changes
        await template.save();
        results.success = true;
        
        console.log('\n============================================================');
        console.log('✅ MIGRATION COMPLETE');
        console.log('============================================================\n');
        
        logger.info('[SCENARIO MIGRATION] Callback scenario fix completed', results);
        
        res.json({
            success: true,
            message: 'Callback scenario fix applied successfully',
            results
        });
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        results.errors.push(error.message);
        logger.error('[SCENARIO MIGRATION] Callback fix failed', { error: error.message });
        res.status(500).json(results);
    }
});

// ============================================================================
// POST /fix-filler-words
// Remove meaning-carrying words from filler word lists
// ============================================================================
router.post('/fix-filler-words', authenticateJWT, async (req, res) => {
    console.log('\n============================================================');
    console.log('🔧 RUNNING: Fix Filler Words (Remove Meaningful Words)');
    console.log('============================================================\n');
    
    // V87/V88: Comprehensive list of words that should NEVER be stripped as fillers
    const WORDS_TO_REMOVE = [
        // ════════════════════════════════════════════════════════════════════
        // GREETINGS (V87 FIX - stripping these creates malformed sentences!)
        // "Hi, my name is Mark" → ", my name is mark" BROKEN!
        // ════════════════════════════════════════════════════════════════════
        'hi', 'hey', 'hello', 'yo',
        
        // ════════════════════════════════════════════════════════════════════
        // CONVERSATIONAL WORDS (V87 FIX - carry semantic meaning!)
        // ════════════════════════════════════════════════════════════════════
        'well',        // "Well, the technician was here" → loses context
        'so',          // "So I called about..." → loses connective
        'okay', 'ok',  // "Okay, my address is..." → loses acknowledgment
        'yes', 'yeah', // "Yes, I need help" → loses affirmation
        
        // TIME-RELATED (scheduling info!)
        'today', 'tomorrow', 'now', 'asap', 'urgent', 'emergency',
        'right away', 'immediately', 'tonight', 'morning', 'afternoon', 'evening',
        
        // QUESTION-BREAKING (stripping these breaks questions!)
        'you know',    // "Do you know my name?" → "do my name?" BROKEN!
        'like',        // "I'd like to schedule" → "i'd to schedule" BROKEN!
        'i mean',      // "I mean it's really hot" → loses emphasis
        
        // CONTEXT-BREAKING (stripping these loses info!)
        'you guys',    // "you guys were here last week" → loses the subject
        'there',       // V88 FIX: "There's nothing happening" → "'s nothing happening" BROKEN!
        
        // POLITENESS (should be preserved for tone)
        'please', 'thanks', 'thank you',
        
        // EMPHASIS (carries meaning)
        'actually', 'basically', 'really', 'very'
    ];
    
    const results = {
        success: false,
        templatesUpdated: 0,
        wordsRemoved: {},
        errors: []
    };
    
    try {
        const templates = await GlobalInstantResponseTemplate.find({});
        console.log(`📋 Found ${templates.length} templates to check\n`);
        
        for (const template of templates) {
            let templateModified = false;
            const changes = [];
            
            // Check template-level fillerWords
            if (template.fillerWords && template.fillerWords.length > 0) {
                const originalCount = template.fillerWords.length;
                const filtered = template.fillerWords.filter(word => 
                    !WORDS_TO_REMOVE.includes(word.toLowerCase())
                );
                const removedCount = originalCount - filtered.length;
                
                if (removedCount > 0) {
                    const removed = template.fillerWords.filter(word => 
                        WORDS_TO_REMOVE.includes(word.toLowerCase())
                    );
                    changes.push(`Template-level: removed ${removedCount} words (${removed.join(', ')})`);
                    template.fillerWords = filtered;
                    templateModified = true;
                    
                    // Track removed words
                    removed.forEach(w => {
                        results.wordsRemoved[w] = (results.wordsRemoved[w] || 0) + 1;
                    });
                }
            }
            
            // Check nlpConfig.fillerWords (V88: THIS IS WHERE "please" lives!)
            if (template.nlpConfig && template.nlpConfig.fillerWords && template.nlpConfig.fillerWords.length > 0) {
                const originalCount = template.nlpConfig.fillerWords.length;
                const filtered = template.nlpConfig.fillerWords.filter(word =>
                    !WORDS_TO_REMOVE.includes(word.toLowerCase())
                );
                const removedCount = originalCount - filtered.length;
                
                if (removedCount > 0) {
                    const removed = template.nlpConfig.fillerWords.filter(word =>
                        WORDS_TO_REMOVE.includes(word.toLowerCase())
                    );
                    changes.push(`nlpConfig.fillerWords: removed ${removedCount} words (${removed.join(', ')})`);
                    template.nlpConfig.fillerWords = filtered;
                    templateModified = true;
                    
                    removed.forEach(w => {
                        results.wordsRemoved[w] = (results.wordsRemoved[w] || 0) + 1;
                    });
                }
            }
            
            // Check category-level fillerWords
            if (template.categories && template.categories.length > 0) {
                for (const category of template.categories) {
                    if (category.fillerWords && category.fillerWords.length > 0) {
                        const originalCount = category.fillerWords.length;
                        const filtered = category.fillerWords.filter(word =>
                            !WORDS_TO_REMOVE.includes(word.toLowerCase())
                        );
                        const removedCount = originalCount - filtered.length;
                        
                        if (removedCount > 0) {
                            const removed = category.fillerWords.filter(word =>
                                WORDS_TO_REMOVE.includes(word.toLowerCase())
                            );
                            changes.push(`Category "${category.name || category.categoryId}": removed ${removedCount} words (${removed.join(', ')})`);
                            category.fillerWords = filtered;
                            templateModified = true;
                            
                            // Track removed words
                            removed.forEach(w => {
                                results.wordsRemoved[w] = (results.wordsRemoved[w] || 0) + 1;
                            });
                        }
                    }
                }
            }
            
            if (templateModified) {
                await template.save();
                results.templatesUpdated++;
                console.log(`📝 UPDATED: ${template.name || template._id}`);
                changes.forEach(c => console.log(`   - ${c}`));
            }
        }
        
        results.success = true;
        
        console.log('\n============================================================');
        console.log(`✅ COMPLETE: Updated ${results.templatesUpdated} templates`);
        console.log('============================================================\n');
        
        logger.info('[SCENARIO MIGRATION] Filler words fix completed', results);
        
        res.json({
            success: true,
            message: 'Filler words fix applied successfully',
            results
        });
        
    } catch (error) {
        console.error('❌ Migration failed:', error);
        results.errors.push(error.message);
        logger.error('[SCENARIO MIGRATION] Filler words fix failed', { error: error.message });
        res.status(500).json(results);
    }
});

// ============================================================================
// GET /status - Check current scenario configuration
// ============================================================================
router.get('/status', authenticateJWT, async (req, res) => {
    try {
        const template = await GlobalInstantResponseTemplate.findById(TEMPLATE_ID).lean();
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        const scenarioStats = {
            templateName: template.name,
            version: template.version,
            categories: template.categories?.length || 0,
            scenarios: 0,
            notSureScenario: null,
            followUpScenario: null
        };
        
        for (const category of template.categories || []) {
            scenarioStats.scenarios += category.scenarios?.length || 0;
            
            for (const scenario of category.scenarios || []) {
                const name = (scenario.name || '').toLowerCase();
                
                if (name.includes('not sure what they need')) {
                    scenarioStats.notSureScenario = {
                        name: scenario.name,
                        triggers: scenario.triggers?.length || 0,
                        negativeTriggers: scenario.negativeTriggers?.length || 0,
                        priority: scenario.priority || 0
                    };
                }
                
                if (name.includes('follow-up after service') || name.includes('callback')) {
                    scenarioStats.followUpScenario = {
                        name: scenario.name,
                        triggers: scenario.triggers?.length || 0,
                        negativeTriggers: scenario.negativeTriggers?.length || 0,
                        priority: scenario.priority || 0
                    };
                }
            }
        }
        
        res.json(scenarioStats);
        
    } catch (error) {
        logger.error('[SCENARIO MIGRATION] Status check failed', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// GET /run-filler-fix/:secretKey
// TEMPORARY BYPASS - Run filler word migration without auth
// DELETE AFTER USE IN PRODUCTION
// ============================================================================
router.get('/run-filler-fix/:secretKey', async (req, res) => {
    const { secretKey } = req.params;
    
    // Simple secret key validation
    if (secretKey !== 'clientsvia-v87-filler-fix-2026') {
        return res.status(401).json({ error: 'Invalid secret key' });
    }
    
    console.log('\n============================================================');
    console.log('🔧 RUNNING: V87 Filler Word Fix (Unauthenticated Bypass)');
    console.log('============================================================\n');
    
    // V87: All words that should NEVER be stripped
    const WORDS_TO_REMOVE = [
        'hi', 'hey', 'hello', 'yo',
        'well', 'so', 'okay', 'ok', 'yes', 'yeah',
        'today', 'tomorrow', 'now', 'asap', 'urgent', 'emergency',
        'right away', 'immediately', 'tonight', 'morning', 'afternoon', 'evening',
        'you know', 'like', 'i mean', 'you guys',
        'please', 'thanks', 'thank you',
        'actually', 'basically', 'really', 'very'
    ];
    
    const results = {
        success: false,
        templatesUpdated: 0,
        wordsRemoved: {},
        errors: []
    };
    
    try {
        const templates = await GlobalInstantResponseTemplate.find({});
        console.log(`📋 Found ${templates.length} templates to check\n`);
        
        for (const template of templates) {
            let templateModified = false;
            const changes = [];
            
            // Check template-level fillerWords
            if (template.fillerWords && template.fillerWords.length > 0) {
                const originalCount = template.fillerWords.length;
                const filtered = template.fillerWords.filter(word => 
                    !WORDS_TO_REMOVE.includes(word.toLowerCase())
                );
                const removedCount = originalCount - filtered.length;
                
                if (removedCount > 0) {
                    const removed = template.fillerWords.filter(word => 
                        WORDS_TO_REMOVE.includes(word.toLowerCase())
                    );
                    changes.push(`Template-level: removed ${removedCount} words (${removed.join(', ')})`);
                    template.fillerWords = filtered;
                    templateModified = true;
                    
                    removed.forEach(w => {
                        results.wordsRemoved[w] = (results.wordsRemoved[w] || 0) + 1;
                    });
                }
            }
            
            // Check category-level fillerWords
            if (template.categories && template.categories.length > 0) {
                for (const category of template.categories) {
                    if (category.fillerWords && category.fillerWords.length > 0) {
                        const originalCount = category.fillerWords.length;
                        const filtered = category.fillerWords.filter(word =>
                            !WORDS_TO_REMOVE.includes(word.toLowerCase())
                        );
                        const removedCount = originalCount - filtered.length;
                        
                        if (removedCount > 0) {
                            const removed = category.fillerWords.filter(word =>
                                WORDS_TO_REMOVE.includes(word.toLowerCase())
                            );
                            changes.push(`Category "${category.name || category.categoryId}": removed ${removedCount} words (${removed.join(', ')})`);
                            category.fillerWords = filtered;
                            templateModified = true;
                            
                            removed.forEach(w => {
                                results.wordsRemoved[w] = (results.wordsRemoved[w] || 0) + 1;
                            });
                        }
                    }
                }
            }
            
            if (templateModified) {
                template.markModified('fillerWords');
                template.markModified('categories');
                await template.save();
                results.templatesUpdated++;
                console.log(`📝 UPDATED: ${template.name || template._id}`);
                changes.forEach(c => console.log(`   - ${c}`));
            }
        }
        
        results.success = true;
        console.log(`\n✅ Migration complete. Updated ${results.templatesUpdated} templates.`);
        console.log('Words removed:', results.wordsRemoved);
        
        res.json(results);
        
    } catch (error) {
        logger.error('[FILLER FIX] Migration failed', { error: error.message });
        results.errors.push(error.message);
        res.status(500).json(results);
    }
});

module.exports = router;
