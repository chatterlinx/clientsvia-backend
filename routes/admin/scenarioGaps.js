/**
 * ============================================================================
 * SCENARIO GAPS API - Enterprise Intelligence System
 * ============================================================================
 * 
 * PURPOSE:
 * Surfaces missed scenarios from Tier 3 (LLM fallback) calls, enabling
 * one-click scenario creation with AI-generated triggers and responses.
 * 
 * ENDPOINTS:
 * GET  /:companyId/gaps         - Get all scenario gaps with priority ranking
 * GET  /:companyId/gaps/preview - Preview AI-generated scenario (query: representative, examples)
 * POST /:companyId/gaps/create  - Auto-create scenario from gap
 * POST /:companyId/gaps/dismiss - Dismiss a gap (won't show again)
 * 
 * FEATURES:
 * - Aggregates Tier 3 calls from past 7-30 days
 * - Clusters similar caller phrases using semantic analysis
 * - Calculates cost impact (tokens used, potential savings)
 * - AI-generates complete scenario with triggers, reply, placeholders
 * - Tracks dismissed gaps to avoid repetition
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const mongoose = require('mongoose');

// Authentication & Authorization
const { authenticateJWT } = require('../../middleware/auth');
const authorizeCompanyAccess = require('../../middleware/authorizeCompanyAccess');

// Models
const BlackBoxRecording = require('../../models/BlackBoxRecording');
const Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');

// Services
const openaiClient = require('../../config/openai');
const logger = require('../../utils/logger');

// ============================================================================
// MIDDLEWARE - All routes require authentication
// ============================================================================
router.use('/:companyId', authenticateJWT, authorizeCompanyAccess);

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    // Analysis window
    DEFAULT_DAYS_BACK: 7,
    MAX_DAYS_BACK: 30,
    
    // Clustering
    MIN_CALLS_FOR_GAP: 2,           // Minimum calls to surface as a gap
    HIGH_PRIORITY_THRESHOLD: 5,     // 5+ calls = high priority
    MEDIUM_PRIORITY_THRESHOLD: 3,   // 3-4 calls = medium priority
    
    // Cost estimation (per 1K tokens)
    COST_PER_1K_INPUT_TOKENS: 0.00015,
    COST_PER_1K_OUTPUT_TOKENS: 0.0006,
    AVG_TOKENS_PER_TIER3_CALL: 800,
    
    // Limits
    MAX_GAPS_RETURNED: 20,
    MAX_EXAMPLES_PER_GAP: 5
};

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Normalize text for comparison
 */
function normalizeText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s''-]/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Calculate similarity between two strings (Jaccard similarity on words)
 */
function calculateSimilarity(text1, text2) {
    const words1 = new Set(normalizeText(text1).split(' ').filter(w => w.length > 2));
    const words2 = new Set(normalizeText(text2).split(' ').filter(w => w.length > 2));
    
    if (words1.size === 0 || words2.size === 0) return 0;
    
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    
    return intersection.size / union.size;
}

/**
 * Cluster similar phrases together
 */
function clusterPhrases(phrases, similarityThreshold = 0.5) {
    const clusters = [];
    const assigned = new Set();
    
    for (let i = 0; i < phrases.length; i++) {
        if (assigned.has(i)) continue;
        
        const cluster = {
            representative: phrases[i].text,
            examples: [phrases[i]],
            totalCalls: phrases[i].count || 1,
            totalTokens: phrases[i].tokens || 0,
            callIds: phrases[i].callIds || []
        };
        assigned.add(i);
        
        // Find similar phrases
        for (let j = i + 1; j < phrases.length; j++) {
            if (assigned.has(j)) continue;
            
            const similarity = calculateSimilarity(phrases[i].text, phrases[j].text);
            if (similarity >= similarityThreshold) {
                cluster.examples.push(phrases[j]);
                cluster.totalCalls += phrases[j].count || 1;
                cluster.totalTokens += phrases[j].tokens || 0;
                cluster.callIds = [...cluster.callIds, ...(phrases[j].callIds || [])];
                assigned.add(j);
            }
        }
        
        clusters.push(cluster);
    }
    
    return clusters;
}

/**
 * Determine gap priority based on call count
 */
function getPriority(callCount) {
    if (callCount >= CONFIG.HIGH_PRIORITY_THRESHOLD) return 'high';
    if (callCount >= CONFIG.MEDIUM_PRIORITY_THRESHOLD) return 'medium';
    return 'low';
}

/**
 * Calculate estimated cost savings if scenario were created
 */
function calculateSavings(totalCalls, totalTokens) {
    const avgTokensPerCall = totalTokens / totalCalls || CONFIG.AVG_TOKENS_PER_TIER3_CALL;
    const weeklyCost = (totalCalls * avgTokensPerCall / 1000) * 
        (CONFIG.COST_PER_1K_INPUT_TOKENS + CONFIG.COST_PER_1K_OUTPUT_TOKENS);
    
    return {
        weeklyCallsSaved: totalCalls,
        weeklyTokensSaved: totalTokens || totalCalls * CONFIG.AVG_TOKENS_PER_TIER3_CALL,
        weeklyCostSaved: Math.round(weeklyCost * 100) / 100,
        monthlyCostSaved: Math.round(weeklyCost * 4.3 * 100) / 100
    };
}

/**
 * Clean raw caller text for better LLM processing
 */
function cleanCallerText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/^[,.\s]+/, '')           // Remove leading punctuation/spaces
        .replace(/[,.\s]+$/, '')           // Remove trailing punctuation/spaces
        .replace(/\s+/g, ' ')              // Normalize whitespace
        .replace(/\bi\s+i\b/gi, 'I')       // Fix "i i" stutter
        .replace(/\bum+\b/gi, '')          // Remove um
        .replace(/\buh+\b/gi, '')          // Remove uh
        .replace(/\s+/g, ' ')              // Re-normalize whitespace
        .trim();
}

/**
 * Generate scenario using LLM - COMPREHENSIVE VERSION
 * Fills ALL useful scenario fields for the Global Brain form
 */
async function generateScenarioFromGap(gap, company) {
    const openai = openaiClient;
    if (!openai) {
        logger.warn('[SCENARIO GAPS] OpenAI client not available, using fallback generation');
        return generateFallbackScenario(gap, company);
    }
    
    // Clean up the examples for better LLM input
    const cleanedExamples = gap.examples
        .slice(0, 5)
        .map(e => cleanCallerText(e.text))
        .filter(t => t.length > 5);
    
    const examples = cleanedExamples.map(e => `- "${e}"`).join('\n');
    
    const tradeName = company.tradeKey?.toUpperCase() || 'SERVICE';
    
    const prompt = `You are creating scenarios for an EXPERIENCED ${tradeName} SERVICE DISPATCHER.

═══════════════════════════════════════════════════════════════════════════════
🎯 WHO YOU ARE (THIS IS CRITICAL)
═══════════════════════════════════════════════════════════════════════════════
You are NOT a chatbot.
You are NOT customer service.
You are NOT a hotel concierge.

You ARE: An experienced ${tradeName} service dispatcher who handles problems all day, every day.

YOUR TONE:
• Calm - never flustered
• Professional - but not corporate
• Friendly - but NOT chatty
• Confident - you've heard this 10,000 times
• Efficient - every word moves toward resolution
• Action-oriented - always progressing toward booking

Callers are often uncomfortable, frustrated, or impatient.
Your job: Make them feel HEARD quickly and move toward getting the problem FIXED.

═══════════════════════════════════════════════════════════════════════════════
CONTEXT
═══════════════════════════════════════════════════════════════════════════════
COMPANY: ${company.companyName || 'Service Company'}
TRADE: ${company.tradeKey || 'general'}

CALLER PHRASES (asked ${gap.totalCalls} times):
${examples}

═══════════════════════════════════════════════════════════════════════════════
THE GOLDEN FORMULA: ACKNOWLEDGE → NARROW → BOOK
═══════════════════════════════════════════════════════════════════════════════
Every response must:
1. Briefly acknowledge (3 words max: "I understand." "Got it." "No problem.")
2. Ask ONE smart narrowing question that diagnoses the issue
3. Keep momentum toward scheduling service

═══════════════════════════════════════════════════════════════════════════════
⚡ TRIGGER RULES
═══════════════════════════════════════════════════════════════════════════════
Include 10-15 trigger variations:
- SHORT (2-3 words): "ac broken", "not cooling", "need repair"  
- LONG (5-8 words): "my air conditioning is not working"
- Questions AND statements
- Casual: "y'all", "gonna", "ain't working"

🔧 REGEX TRIGGERS (2-4 patterns):
- Use \\b for word boundaries
- Example: "\\b(ac|air conditioning|a\\.?c\\.?)\\s*(not|isn't|ain't|won't)\\s*(working|cooling|running)\\b"

═══════════════════════════════════════════════════════════════════════════════
🎯 RESPONSE RULES (READ THIS CAREFULLY)
═══════════════════════════════════════════════════════════════════════════════

KEEP RESPONSES UNDER 20 WORDS (unless collecting booking details)

quickReplies (3 variations) - DISPATCHER STYLE:
• Acknowledge briefly + ask ONE specific diagnostic question
• Sound like you've handled this 10,000 times
• Move toward understanding the problem

fullReplies (2 variations) - STILL DISPATCHER STYLE:
• Slightly more context but STILL under 25 words
• Never paragraphs, never fluffy

═══════════════════════════════════════════════════════════════════════════════
❌ BANNED PHRASES (instant failure if you use these)
═══════════════════════════════════════════════════════════════════════════════
CHATBOT WORDS (ban these):
• "Wonderful to hear from you"
• "Great to have you back"  
• "We're here to help"
• "Let's sort this out together"
• "I apologize for the inconvenience"

HELP DESK WORDS (ban these - dispatchers don't say them):
• "Got it" 
• "No problem"
• "Absolutely"
• "Of course"

LAZY QUESTIONS (ban these):
• "Tell me more about..."
• "Can you describe..."
• "Could you explain..."
• "Have you checked..." (troubleshooting = technician's job)
• "Is it set correctly?" (troubleshooting)
• "Any unusual noises?" (technician question)

• Anything that sounds like a chatbot, concierge, or help desk
• Anything over 20 words

═══════════════════════════════════════════════════════════════════════════════
✅ HOW A PRO DISPATCHER SOUNDS (copy this style exactly)
═══════════════════════════════════════════════════════════════════════════════

QUICK REPLIES (classification questions):
❌ Bad: "I'm so sorry you're dealing with this. Let's figure this out together!"
✅ Good: "I understand. Is the unit running but not cooling, or not turning on?"

❌ Bad: "Got it. Can you tell me more about the problem?"
✅ Good: "Is air coming out of the vents?"

❌ Bad: "No problem. Have you checked the thermostat settings?"
✅ Good: "Is the thermostat screen on or blank?"

FULL REPLIES (booking momentum - use after classification):
❌ Bad: "I understand, {name}. Is the unit making any unusual noises?"
✅ Good: "Alright. That's helpful. We'll get a technician out. Morning or afternoon?"

❌ Bad: "Have you checked if the thermostat is set correctly?"
✅ Good: "We'll get a technician out. Morning or afternoon?"

NATURAL BRIDGE (between classify → book):
Caller: "The screen is blank."
✅ Good: "Alright. That's helpful. We'll get a technician out. Morning or afternoon?"

RETURNING CUSTOMER:
❌ Bad: "Great to hear from you again! How wonderful to have you back!"
✅ Good: "Good to hear from you, {name}. What's going on with the system today?"

GREETING:
❌ Bad: "Hi {name}! Thanks so much for reaching out to us today!"
✅ Good: "Hi {name}. What's going on?"

═══════════════════════════════════════════════════════════════════════════════
🔥 PRO DISPATCHER RULES (BULLETPROOF)
═══════════════════════════════════════════════════════════════════════════════
1. Ask only ONE question per response
2. Never ask caller to "describe" or "explain" - ask SPECIFIC questions
3. Empathy is just "I understand." or "Alright." - pick ONE, never stack
4. Never repeat what caller already said
5. Never sound surprised or curious - sound EXPERIENCED
6. If problem category is identified, begin scheduling IMMEDIATELY
7. Assume caller is uncomfortable and wants FAST action
8. NEVER ask homeowner to troubleshoot - that's technician territory
9. NEVER ask questions a technician would ask on site
10. Your job: Classify problem category → Book the call

ANTI-DRIFT RULES (prevents GPT from sneaking assistant tone back):
• Never stack acknowledgements: "I understand. Alright. Let's..." ❌ Pick ONE.
• Don't start more than 2 responses with "I understand" - vary with "Alright." "Okay."
• No extra questions if you already know enough to book

THE DISPATCHER FLOW:
• Quick replies = ONE classification question
• Bridge sentence (optional): "Alright. That's helpful."
• Full replies = BOOKING ("We'll get a technician out. Morning or afternoon?")

${company.tradeKey === 'hvac' ? `
HVAC-SPECIFIC - ONLY THESE 3 CLASSIFICATION QUESTIONS:
• "Is the system running but not cooling, or not turning on?"
• "Is the thermostat screen on or blank?"
• "Is air coming out of the vents?"

BRIDGE SENTENCE (use between classify → book):
• "Alright. That's helpful."

Then BOOK (tight, no fluff):
• "We'll get a technician out. Morning or afternoon?"
• "Let's get you on the schedule. What day works?"

EXAMPLE FLOW:
Caller: "My thermostat screen is blank"
AI: "Alright. That's helpful. We'll get a technician out. Morning or afternoon?"

NEVER ASK:
• "Have you checked..." (troubleshooting)
• "Any unusual noises?" (technician question)  
• "Is it set correctly?" (troubleshooting)
• Anything a technician would ask on site
` : ''}

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON only, no markdown):
═══════════════════════════════════════════════════════════════════════════════
{
    "name": "Short descriptive name (3-5 words)",
    "category": "Scheduling|Pricing|Hours|Service Area|Emergency|FAQ|Warranty|Billing|General",
    
    "scenarioType": "FAQ|BOOKING|EMERGENCY|TROUBLESHOOT|BILLING|TRANSFER|SMALL_TALK",
    "priority": 0,
    
    "behavior": "calm_professional",
    
    "triggers": [
        "short trigger",
        "another short one", 
        "medium length trigger",
        "what's the trigger question",
        "longer natural phrasing here",
        "different way to ask",
        "casual way to say it",
        "formal version of question",
        "i need statement version",
        "looking for variation"
    ],
    
    "regexTriggers": [
        "\\\\b(keyword1|keyword2)\\\\s*(optional)?\\\\b",
        "\\\\b(another|pattern)\\\\b"
    ],
    
    "negativeTriggers": ["phrases that look similar but mean something DIFFERENT"],
    
    "quickReplies": [
        "I understand. [ONE classification question - running/not running, air/no air, thermostat on/off]",
        "[Same question, slightly different wording]",
        "[Third variation of the classification question]"
    ],
    
    "fullReplies": [
        "Alright. That's helpful. We'll get a technician out. Morning or afternoon?",
        "We'll get a technician out. Morning or afternoon?"
    ],
    
    "followUpFunnel": "We'll get a technician out. Morning or afternoon?",
    
    "followUpMode": "ASK_IF_BOOK",
    "followUpQuestionText": "Let's get you on the schedule. What day works?",
    
    "actionType": "REPLY_ONLY|REQUIRE_BOOKING|TRANSFER",
    "bookingIntent": false,
    
    "entityCapture": ["name", "phone", "issue"],
    
    "templateVariables": [
        "name=valued customer",
        "technician=our team member", 
        "time=as soon as possible",
        "location=your area"
    ],
    
    "notes": "Internal note about when this scenario fires and edge cases",
    
    "suggestedPlaceholders": [
        {"key": "name", "description": "Caller's name (auto-captured)", "exampleValue": "Mark"},
        {"key": "companyName", "description": "Your business name", "exampleValue": "${company.companyName || 'Our Company'}"}
    ],
    
    "followUpMessages": [
        "Are you still there, {name}?",
        "Just checking in - did that answer your question?"
    ],
    
    "cooldown": 0,
    "handoffPolicy": "low_confidence|always|never",
    
    "actionHooks": ["offer_scheduling", "log_inquiry"],
    
    "entityValidation": {
        "phone": {"pattern": "^[0-9]{10}$", "prompt": "Could you give me a 10-digit phone number, {name}?"},
        "email": {"pattern": "@", "prompt": "What's your email address?"}
    }
}

ENTITY CAPTURE GUIDE (what to extract from caller speech):
- name: Always include - caller's name
- phone: If they might provide callback number
- address: If location/service area matters
- issue: The problem or request description
- time_preference: Preferred appointment time
- equipment: For service calls (AC model, furnace type)
- urgency: Emergency indicators

TEMPLATE VARIABLES GUIDE (fallbacks for {placeholders}):
- Format: key=fallback value
- Example: name=valued customer (if we don't have their name yet)
- Example: technician=our team member (if tech name not specified)
- Example: time=shortly (if no specific time mentioned)

BEHAVIOR GUIDE (for service dispatch):
- calm_professional: DEFAULT for all service calls - calm, in control, experienced
- empathetic_reassuring: For complaints, callbacks, service recovery
- professional_efficient: Business inquiries, billing, formal requests

DO NOT USE:
- friendly_warm (makes AI chatty)
- enthusiastic_positive (sounds like sales, not dispatch)

SCENARIO TYPE GUIDE:
- FAQ: Informational (pricing, hours, area) - priority 40-60
- BOOKING: Wants to schedule - priority 70-85, bookingIntent=true
- EMERGENCY: Urgent (no heat, leak, flood) - priority 90-100
- TROUBLESHOOT: Problem-solving - priority 50-70
- BILLING: Payment questions - priority 40-60
- SMALL_TALK: Greetings, thanks - priority -5 to 10

FOLLOW-UP MODE GUIDE:
- NONE: Just answer, let conversation continue
- ASK_IF_BOOK: After answering, offer to schedule
- ASK_FOLLOWUP_QUESTION: Ask a specific follow-up

ADVANCED SETTINGS GUIDE:

followUpMessages: Silence handlers - what to say if caller goes quiet
- Default: ["Are you still there, {name}?", "Just checking in..."]
- Emergency: ["I'm still here to help - are you okay?"]

cooldown: Seconds before scenario can fire again (spam prevention)
- Most scenarios: 0 (no cooldown)
- Greeting/small talk: 30-60 seconds
- Emergency: 0 (always allow)

handoffPolicy: When to transfer to human
- "low_confidence": Only when AI is unsure (DEFAULT for most)
- "always": Always offer human option (billing, complaints)
- "never": AI handles fully (simple FAQ, greetings)

actionHooks: System actions to trigger (comma-separated)
- offer_scheduling: Proactively offer to book
- escalate_to_human: Flag for manager review
- log_complaint: Record as complaint
- send_confirmation: Send SMS confirmation
- check_availability: Query calendar

entityValidation: JSON validation rules for captured entities
- phone: {"pattern": "^[0-9]{10}$", "prompt": "Could you give me a 10-digit number?"}
- email: {"pattern": "@", "prompt": "What's your email address?"}
- Only include if scenario captures these entities`;

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',  // 🚀 Using GPT-4o for highest quality scenario generation
            messages: [
                { 
                    role: 'system', 
                    content: `You are creating scenarios for an EXPERIENCED SERVICE DISPATCHER, not a chatbot.

YOUR MINDSET - THIS IS CRITICAL:
You are NOT creating chatbot responses.
You are creating how a SEASONED DISPATCHER who handles 50+ calls/day would respond.

DISPATCHER PERSONALITY:
• Calm, confident, experienced - heard this 10,000 times
• Friendly but NOT chatty - no fluff, no filler
• Every sentence moves toward DIAGNOSIS or BOOKING
• Empathy in 3 words max: "I understand." "Got it." "No problem."
• Never sounds surprised, never sounds curious - sounds EXPERIENCED

RESPONSE RULES:
• quickReplies: Under 15 words each. Acknowledge + ONE diagnostic question.
• fullReplies: Under 25 words each. Still brief, just slightly more context.
• Ask SPECIFIC questions, never "tell me more" or "can you describe"
• ONE question per response - dispatchers guide, not shotgun
• Sound like someone who turns calls into booked jobs

BANNED (instant failure):
• "Wonderful to hear from you" / "Great to have you back"
• "We're here to help" / "Let's sort this out together"  
• "Can you describe..." / "Tell me more..."
• Anything over 20 words (unless booking details)
• Anything that sounds like a chatbot or concierge

Output VALID JSON only. No markdown. No explanations.` 
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.5,  // Lower for more consistent, professional responses
            max_tokens: 2000
        });
        
        const content = response.choices[0]?.message?.content || '';
        
        // Parse JSON (handle potential markdown wrapping)
        let jsonStr = content.trim();
        if (jsonStr.startsWith('```')) {
            jsonStr = jsonStr.replace(/```json?\n?/g, '').replace(/```$/g, '').trim();
        }
        
        const s = JSON.parse(jsonStr);
        
        // Build comprehensive scenario object
        return {
            success: true,
            scenario: {
                // Identity
                name: s.name || gap.representative.substring(0, 50),
                category: s.category || 'FAQ',
                
                // Classification
                scenarioType: s.scenarioType || 'FAQ',
                priority: typeof s.priority === 'number' ? s.priority : 50,
                status: 'draft',
                
                // Triggers (required)
                triggers: Array.isArray(s.triggers) ? s.triggers : [gap.representative],
                negativeTriggers: Array.isArray(s.negativeTriggers) ? s.negativeTriggers : [],
                
                // Replies (support both single and array formats)
                quickReplies: Array.isArray(s.quickReplies) ? s.quickReplies : 
                    (s.quickReply ? [s.quickReply] : ['I can help with that.']),
                fullReplies: Array.isArray(s.fullReplies) ? s.fullReplies : 
                    (s.fullReply ? [s.fullReply] : []),
                
                // Follow-up behavior
                followUpMode: s.followUpMode || 'NONE',
                followUpQuestionText: s.followUpQuestionText || null,
                
                // Wiring/Actions
                actionType: s.actionType || 'REPLY_ONLY',
                bookingIntent: s.bookingIntent === true,
                
                // Entity extraction
                entityCapture: Array.isArray(s.entityCapture) ? 
                    s.entityCapture.filter(e => e && e !== 'none') : [],
                
                // Admin notes
                notes: s.notes || `Auto-generated from Scenario Gaps. Detected ${gap.totalCalls} similar calls.`,
                
                // Placeholders for company values
                suggestedPlaceholders: Array.isArray(s.suggestedPlaceholders) ? s.suggestedPlaceholders : [],
                
                // Metadata
                generatedBy: 'ai',
                confidence: 0.85,
                sourceGap: gap.representative
            },
            tokensUsed: response.usage?.total_tokens || 0
        };
    } catch (error) {
        logger.error('[SCENARIO GAPS] LLM generation failed', { error: error.message });
        return generateFallbackScenario(gap, company);
    }
}

/**
 * Fallback scenario generation (no LLM) - Comprehensive format
 */
function generateFallbackScenario(gap, company) {
    const normalized = normalizeText(gap.representative);
    
    // Extract potential category and type from keywords
    let category = 'FAQ';
    let scenarioType = 'FAQ';
    let priority = 50;
    let followUpMode = 'NONE';
    
    if (/price|cost|how much|rate|fee|charge/.test(normalized)) {
        category = 'Pricing';
        scenarioType = 'FAQ';
        priority = 50;
    } else if (/hour|open|close|when are you/.test(normalized)) {
        category = 'Hours';
        scenarioType = 'FAQ';
        priority = 45;
    } else if (/service|area|location|zip|where|serve/.test(normalized)) {
        category = 'Service Area';
        scenarioType = 'FAQ';
        priority = 45;
    } else if (/warranty|guarantee/.test(normalized)) {
        category = 'Warranty';
        scenarioType = 'FAQ';
        priority = 50;
    } else if (/emergency|urgent|asap|help|no heat|no ac|leak|flood/.test(normalized)) {
        category = 'Emergency';
        scenarioType = 'EMERGENCY';
        priority = 95;
    } else if (/book|schedule|appoint|earliest|soonest|available/.test(normalized)) {
        category = 'Scheduling';
        scenarioType = 'BOOKING';
        priority = 75;
        followUpMode = 'ASK_IF_BOOK';
    }
    
    // Generate triggers from examples
    const triggers = gap.examples
        .slice(0, 5)
        .map(e => normalizeText(e.text))
        .filter(t => t.length > 5);
    
    return {
        success: true,
        scenario: {
            name: gap.representative.substring(0, 50),
            category,
            scenarioType,
            priority,
            status: 'draft',
            triggers: triggers.length > 0 ? triggers : [normalized],
            negativeTriggers: [],
            quickReplies: ['I can help you with that. Let me get more information to assist you.'],
            fullReplies: [],
            followUpMode,
            followUpQuestionText: followUpMode === 'ASK_IF_BOOK' ? 'Would you like to schedule an appointment?' : null,
            actionType: scenarioType === 'BOOKING' ? 'REQUIRE_BOOKING' : 'REPLY_ONLY',
            bookingIntent: scenarioType === 'BOOKING',
            entityCapture: [],
            notes: `Auto-generated fallback. Detected ${gap.totalCalls} similar calls.`,
            suggestedPlaceholders: [],
            generatedBy: 'fallback',
            confidence: 0.5,
            sourceGap: gap.representative
        },
        tokensUsed: 0
    };
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * GET /:companyId/gaps
 * 
 * Get all scenario gaps for a company, prioritized by impact
 */
router.get('/:companyId/gaps', async (req, res) => {
    const { companyId } = req.params;
    const { days = CONFIG.DEFAULT_DAYS_BACK, minCalls = CONFIG.MIN_CALLS_FOR_GAP } = req.query;
    
    logger.info('[SCENARIO GAPS] Request received', { companyId, days, minCalls });
    
    try {
        // Validate company
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Calculate date range
        const daysBack = Math.min(parseInt(days) || CONFIG.DEFAULT_DAYS_BACK, CONFIG.MAX_DAYS_BACK);
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - daysBack);
        
        // Fetch Tier 3 calls from Black Box
        const recordings = await BlackBoxRecording.find({
            companyId: new mongoose.Types.ObjectId(companyId),
            createdAt: { $gte: startDate },
            'events.type': 'TIER3_FALLBACK'
        }).lean();
        
        logger.info('[SCENARIO GAPS] Analyzing recordings', { 
            companyId, 
            recordingsFound: recordings.length,
            daysBack 
        });
        
        // Extract Tier 3 caller phrases
        const tier3Phrases = [];
        
        for (const recording of recordings) {
            const events = recording.events || [];
            
            for (let i = 0; i < events.length; i++) {
                const event = events[i];
                
                if (event.type === 'TIER3_FALLBACK') {
                    // Find the preceding GATHER_FINAL to get what caller said
                    let callerText = '';
                    let tokens = event.data?.tokensUsed || 0;
                    
                    // Look backwards for the caller input
                    for (let j = i - 1; j >= 0 && j >= i - 10; j--) {
                        if (events[j].type === 'GATHER_FINAL' && events[j].data?.text) {
                            callerText = events[j].data.text;
                            break;
                        }
                    }
                    
                    if (callerText && callerText.length > 5) {
                        tier3Phrases.push({
                            text: callerText,
                            tokens,
                            callIds: [recording._id.toString()],  // Array for clustering
                            timestamp: event.ts || recording.createdAt
                        });
                    }
                }
            }
        }
        
        logger.info('[SCENARIO GAPS] Extracted Tier 3 phrases', { count: tier3Phrases.length });
        
        // Cluster similar phrases
        const clusters = clusterPhrases(tier3Phrases, 0.4);
        
        // Filter by minimum calls and sort by impact
        const minCallsInt = parseInt(minCalls) || CONFIG.MIN_CALLS_FOR_GAP;
        const significantGaps = clusters
            .filter(c => c.totalCalls >= minCallsInt)
            .map((cluster, index) => ({
                id: `gap_${index}_${Date.now()}`,
                representative: cluster.representative,
                examples: cluster.examples.slice(0, CONFIG.MAX_EXAMPLES_PER_GAP).map(e => ({
                    text: e.text,
                    timestamp: e.timestamp
                })),
                callCount: cluster.totalCalls,
                totalTokens: cluster.totalTokens,
                priority: getPriority(cluster.totalCalls),
                savings: calculateSavings(cluster.totalCalls, cluster.totalTokens),
                callIds: cluster.callIds.slice(0, 10) // Limit for response size
            }))
            .sort((a, b) => b.callCount - a.callCount)
            .slice(0, CONFIG.MAX_GAPS_RETURNED);
        
        // Calculate summary stats
        const totalTier3Calls = tier3Phrases.length;
        const totalTokensUsed = tier3Phrases.reduce((sum, p) => sum + (p.tokens || 0), 0);
        const totalEstimatedCost = (totalTokensUsed / 1000) * 
            (CONFIG.COST_PER_1K_INPUT_TOKENS + CONFIG.COST_PER_1K_OUTPUT_TOKENS);
        
        const summary = {
            period: `Last ${daysBack} days`,
            totalTier3Calls,
            uniqueGaps: significantGaps.length,
            totalTokensUsed,
            estimatedCost: Math.round(totalEstimatedCost * 100) / 100,
            potentialSavings: significantGaps.reduce((sum, g) => sum + g.savings.weeklyCostSaved, 0),
            highPriorityCount: significantGaps.filter(g => g.priority === 'high').length,
            mediumPriorityCount: significantGaps.filter(g => g.priority === 'medium').length
        };
        
        res.json({
            success: true,
            companyId,
            companyName: company.companyName,
            summary,
            gaps: significantGaps
        });
        
    } catch (error) {
        logger.error('[SCENARIO GAPS] Error fetching gaps', { error: error.message, companyId });
        res.status(500).json({ error: 'Failed to analyze scenario gaps', details: error.message });
    }
});

/**
 * GET /:companyId/gaps/preview
 * 
 * Preview AI-generated scenario for a gap (without creating it)
 * Query params: representative (required), examples (optional JSON array)
 */
router.get('/:companyId/gaps/preview', async (req, res) => {
    const { companyId } = req.params;
    const { representative, examples } = req.query;
    
    try {
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Build gap object from query params
        const gap = {
            representative: representative || 'Unknown question',
            examples: examples ? JSON.parse(examples) : [{ text: representative }],
            totalCalls: 1
        };
        
        // Generate scenario preview
        const result = await generateScenarioFromGap(gap, company);
        
        res.json({
            success: true,
            preview: result.scenario,
            tokensUsed: result.tokensUsed
        });
        
    } catch (error) {
        logger.error('[SCENARIO GAPS] Error generating preview', { error: error.message });
        res.status(500).json({ error: 'Failed to generate scenario preview', details: error.message });
    }
});

/**
 * POST /:companyId/gaps/create
 * 
 * Create a scenario from a gap
 */
router.post('/:companyId/gaps/create', async (req, res) => {
    const { companyId } = req.params;
    const { 
        representative, 
        examples = [], 
        // Optional overrides (if user edited the AI suggestion)
        name,
        category,
        triggers,
        negativeTriggers,
        quickReply,
        fullReply,
        placeholders
    } = req.body;
    
    try {
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get the template for this company's trade
        const template = await GlobalInstantResponseTemplate.findOne({
            tradeKey: company.tradeKey || 'universal'
        });
        
        if (!template) {
            return res.status(404).json({ error: 'No template found for company trade' });
        }
        
        // Generate or use provided scenario data
        let scenarioData;
        
        if (name && triggers && quickReply) {
            // User provided custom data
            scenarioData = {
                name,
                category: category || 'FAQ',
                triggers: Array.isArray(triggers) ? triggers : [triggers],
                negativeTriggers: negativeTriggers || [],
                quickReply,
                fullReply: fullReply || null
            };
        } else {
            // Generate from gap
            const gap = {
                representative,
                examples: examples.map(e => typeof e === 'string' ? { text: e } : e),
                totalCalls: examples.length || 1
            };
            
            const result = await generateScenarioFromGap(gap, company);
            scenarioData = result.scenario;
        }
        
        // Find or create the category
        let categoryDoc = template.categories.find(c => 
            c.name.toLowerCase() === scenarioData.category.toLowerCase()
        );
        
        if (!categoryDoc) {
            // Create new category
            categoryDoc = {
                name: scenarioData.category,
                description: `Auto-created category for ${scenarioData.category} scenarios`,
                scenarios: [],
                createdAt: new Date()
            };
            template.categories.push(categoryDoc);
        }
        
        // Create the scenario
        const newScenario = {
            name: scenarioData.name,
            description: `Auto-created from Scenario Gaps. Original phrase: "${representative}"`,
            triggers: scenarioData.triggers,
            negativeTriggers: scenarioData.negativeTriggers || [],
            quickReplies: [scenarioData.quickReply],
            fullReplies: scenarioData.fullReply ? [scenarioData.fullReply] : [],
            priority: 50,
            enabled: true,
            aiGenerated: true,
            createdAt: new Date(),
            createdBy: 'scenario_gaps_system',
            metadata: {
                source: 'scenario_gaps',
                originalPhrase: representative,
                exampleCount: examples.length,
                generatedBy: scenarioData.generatedBy || 'ai'
            }
        };
        
        // Add scenario to category
        const categoryIndex = template.categories.findIndex(c => c.name === categoryDoc.name);
        if (categoryIndex >= 0) {
            template.categories[categoryIndex].scenarios.push(newScenario);
        }
        
        // Save template
        template.markModified('categories');
        await template.save();
        
        // Add suggested placeholders to company if provided
        if (scenarioData.suggestedPlaceholders && scenarioData.suggestedPlaceholders.length > 0) {
            const existingPlaceholders = company.placeholders || {};
            let placeholdersAdded = 0;
            
            for (const ph of scenarioData.suggestedPlaceholders) {
                if (!existingPlaceholders[ph.key]) {
                    existingPlaceholders[ph.key] = ph.exampleValue || `[Set ${ph.key}]`;
                    placeholdersAdded++;
                }
            }
            
            if (placeholdersAdded > 0) {
                company.placeholders = existingPlaceholders;
                await company.save();
            }
        }
        
        logger.info('[SCENARIO GAPS] Scenario created', {
            companyId,
            scenarioName: newScenario.name,
            category: categoryDoc.name,
            triggersCount: newScenario.triggers.length
        });
        
        res.json({
            success: true,
            message: 'Scenario created successfully',
            scenario: {
                name: newScenario.name,
                category: categoryDoc.name,
                triggers: newScenario.triggers,
                quickReply: newScenario.quickReplies[0]
            },
            templateId: template._id.toString(),
            suggestedPlaceholders: scenarioData.suggestedPlaceholders || []
        });
        
    } catch (error) {
        logger.error('[SCENARIO GAPS] Error creating scenario', { error: error.message, companyId });
        res.status(500).json({ error: 'Failed to create scenario', details: error.message });
    }
});

/**
 * GET /:companyId/scenarios
 * 
 * Get existing scenarios from the company's template for "Add to Existing" feature
 */
router.get('/:companyId/scenarios', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get the template for this company's trade
        const template = await GlobalInstantResponseTemplate.findOne({
            tradeKey: company.tradeKey || 'universal'
        }).lean();
        
        if (!template) {
            return res.json({ success: true, scenarios: [], categories: [] });
        }
        
        // Extract scenarios with their categories
        const scenarios = [];
        const categoryNames = [];
        
        for (const category of (template.categories || [])) {
            categoryNames.push(category.name);
            
            for (const scenario of (category.scenarios || [])) {
                scenarios.push({
                    id: scenario._id?.toString() || `${category.name}_${scenario.name}`,
                    name: scenario.name,
                    category: category.name,
                    triggersCount: scenario.triggers?.length || 0,
                    triggers: (scenario.triggers || []).slice(0, 5), // Preview first 5
                    quickReply: scenario.quickReplies?.[0] || scenario.quickReply || ''
                });
            }
        }
        
        // Sort by name
        scenarios.sort((a, b) => a.name.localeCompare(b.name));
        
        res.json({
            success: true,
            templateId: template._id.toString(),
            templateName: template.name,
            categories: categoryNames,
            scenarios
        });
        
    } catch (error) {
        logger.error('[SCENARIO GAPS] Error fetching scenarios', { error: error.message, companyId });
        res.status(500).json({ error: 'Failed to fetch scenarios', details: error.message });
    }
});

/**
 * POST /:companyId/scenarios/add-triggers
 * 
 * Add triggers to an existing scenario (instead of creating new)
 */
router.post('/:companyId/scenarios/add-triggers', async (req, res) => {
    const { companyId } = req.params;
    const { scenarioId, categoryName, scenarioName, newTriggers } = req.body;
    
    try {
        const company = await Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Get the template
        const template = await GlobalInstantResponseTemplate.findOne({
            tradeKey: company.tradeKey || 'universal'
        });
        
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Find the category and scenario
        let found = false;
        let addedCount = 0;
        let existingTriggers = [];
        
        for (const category of (template.categories || [])) {
            if (category.name !== categoryName) continue;
            
            for (const scenario of (category.scenarios || [])) {
                const matchById = scenarioId && scenario._id?.toString() === scenarioId;
                const matchByName = scenario.name === scenarioName;
                
                if (matchById || matchByName) {
                    existingTriggers = scenario.triggers || [];
                    
                    // Add new triggers that don't already exist
                    const existingSet = new Set(existingTriggers.map(t => t.toLowerCase()));
                    
                    for (const trigger of (newTriggers || [])) {
                        const normalized = trigger.toLowerCase().trim();
                        if (normalized && !existingSet.has(normalized)) {
                            scenario.triggers.push(trigger.trim());
                            existingSet.add(normalized);
                            addedCount++;
                        }
                    }
                    
                    found = true;
                    break;
                }
            }
            if (found) break;
        }
        
        if (!found) {
            return res.status(404).json({ error: 'Scenario not found in template' });
        }
        
        // Save template
        template.markModified('categories');
        await template.save();
        
        logger.info('[SCENARIO GAPS] Triggers added to existing scenario', {
            companyId,
            scenarioName,
            categoryName,
            addedCount,
            totalTriggers: existingTriggers.length + addedCount
        });
        
        res.json({
            success: true,
            message: `Added ${addedCount} new trigger${addedCount !== 1 ? 's' : ''} to "${scenarioName}"`,
            addedCount,
            totalTriggers: existingTriggers.length + addedCount
        });
        
    } catch (error) {
        logger.error('[SCENARIO GAPS] Error adding triggers', { error: error.message, companyId });
        res.status(500).json({ error: 'Failed to add triggers', details: error.message });
    }
});

/**
 * POST /:companyId/calls/preview
 * 
 * Get basic info for a list of call IDs (for "View Calls" modal)
 * MULTI-TENANT SAFE: Always filters by companyId
 */
router.post('/:companyId/calls/preview', async (req, res) => {
    const { companyId } = req.params;
    const { callIds } = req.body;
    
    try {
        if (!callIds || !Array.isArray(callIds) || callIds.length === 0) {
            return res.json({ success: true, calls: [] });
        }
        
        // CRITICAL: Import CallRecording model
        const CallRecording = require('../../models/CallRecording');
        
        // MULTI-TENANT SAFETY: Query MUST include BOTH conditions
        // Even if someone passes callIds from another company, they get NOTHING
        const calls = await CallRecording.find({
            _id: { $in: callIds.slice(0, 20) }, // Limit to 20
            companyId: companyId // ← HARD FILTER - prevents bleeding
        })
        .select('_id companyId createdAt callerPhone duration outcome transcript callSid')
        .sort({ createdAt: -1 })
        .lean();
        
        // Format for frontend
        const formatted = calls.map(call => {
            // Get first few words of transcript for preview
            let firstLine = '';
            if (call.transcript && Array.isArray(call.transcript)) {
                const callerTurn = call.transcript.find(t => t.role === 'caller' || t.speaker === 'caller');
                if (callerTurn) {
                    firstLine = (callerTurn.text || callerTurn.content || '').substring(0, 80);
                    if (firstLine.length === 80) firstLine += '...';
                }
            }
            
            return {
                id: call._id.toString(),
                date: call.createdAt,
                phone: call.callerPhone || 'Unknown',
                duration: call.duration || 0,
                durationFormatted: formatDuration(call.duration || 0),
                outcome: call.outcome || 'unknown',
                firstLine: firstLine || 'No transcript available',
                callSid: call.callSid
            };
        });
        
        logger.debug('[SCENARIO GAPS] Call preview fetched', {
            companyId,
            requestedIds: callIds.length,
            returnedCalls: formatted.length
        });
        
        res.json({
            success: true,
            calls: formatted
        });
        
    } catch (error) {
        logger.error('[SCENARIO GAPS] Error fetching call preview', { error: error.message, companyId });
        res.status(500).json({ error: 'Failed to fetch calls', details: error.message });
    }
});

// Helper to format duration
function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * POST /:companyId/gaps/dismiss
 * 
 * Dismiss a gap (user doesn't want a scenario for this)
 */
router.post('/:companyId/gaps/dismiss', async (req, res) => {
    const { companyId } = req.params;
    const { representative, reason } = req.body;
    
    try {
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Store dismissed gaps in company metadata
        if (!company.metadata) company.metadata = {};
        if (!company.metadata.dismissedScenarioGaps) company.metadata.dismissedScenarioGaps = [];
        
        company.metadata.dismissedScenarioGaps.push({
            representative,
            reason: reason || 'User dismissed',
            dismissedAt: new Date()
        });
        
        // Keep only last 100 dismissed gaps
        if (company.metadata.dismissedScenarioGaps.length > 100) {
            company.metadata.dismissedScenarioGaps = company.metadata.dismissedScenarioGaps.slice(-100);
        }
        
        company.markModified('metadata');
        await company.save();
        
        res.json({
            success: true,
            message: 'Gap dismissed'
        });
        
    } catch (error) {
        logger.error('[SCENARIO GAPS] Error dismissing gap', { error: error.message });
        res.status(500).json({ error: 'Failed to dismiss gap', details: error.message });
    }
});

module.exports = router;
