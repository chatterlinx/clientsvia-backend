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
    
    const prompt = `You are an expert at creating WARM, HUMAN, IMPRESSIVE voice AI receptionist scenarios for ${tradeName} businesses.

═══════════════════════════════════════════════════════════════════════════════
🎯 THE SOUL OF THIS AI RECEPTIONIST
═══════════════════════════════════════════════════════════════════════════════
You are NOT just creating a chatbot. You are creating the BEST receptionist experience:

✨ PERSONALITY: Friendly, warm, genuine - like a helpful neighbor who happens to work there
✨ INTELLIGENCE: Smart, clever, picks up on context - remembers what callers said
✨ CUSTOMER-FOCUSED: Every response should make the caller feel HEARD and VALUED  
✨ GOAL-ORIENTED: Efficiently guide callers toward decisions (book, transfer, get info)
✨ NEVER ROBOTIC: No corporate speak, no "How may I assist you", no scripted feeling

The AI should feel like talking to the BEST employee at the company - someone who:
- Genuinely cares about solving the caller's problem
- Makes callers feel like VIPs, not ticket numbers  
- Is efficient but never rushed or dismissive
- Naturally steers toward helpful outcomes (booking, answers, transfers)
- Builds trust and rapport in seconds

═══════════════════════════════════════════════════════════════════════════════
CONTEXT
═══════════════════════════════════════════════════════════════════════════════
COMPANY: ${company.companyName || 'Service Company'}
TRADE: ${company.tradeKey || 'general'}

CALLER PHRASES (asked ${gap.totalCalls} times, fell through to expensive LLM):
${examples}

═══════════════════════════════════════════════════════════════════════════════
YOUR MISSION: Create a scenario that embodies this friendly, smart receptionist
═══════════════════════════════════════════════════════════════════════════════

⚡ TRIGGER RULES (CRITICAL):
1. Include 10-15 trigger variations - SHORT (2-3 words) AND LONG (5-8 words)
2. Question formats: "when is...", "what's the...", "do you have..."
3. Statement formats: "i need...", "looking for...", "i want..."
4. Casual/natural: "y'all", "gonna", "wanna", contractions
5. NO caller-specific details (names, times, filler words)

🔧 REGEX TRIGGERS (for catching variations):
Generate 2-4 regex patterns that catch key variations:
- Use \\b for word boundaries, \\s* for optional spaces
- Example: "\\b(what's|what is|whats)\\s+(the|your)\\s+(earliest|soonest)\\b"
- Example: "\\b(my name is|this is|i'm|i am)\\s+\\w+\\b"
- Keep patterns simple and readable

🎯 REPLY RULES - THIS IS CRITICAL FOR SOUNDING HUMAN:
1. ALWAYS use {name} placeholder to personalize greetings
2. Acknowledge returning customers with warmth: "Great to hear from you again!"
3. Sound like a real person, NOT corporate/robotic
4. Show genuine care and enthusiasm
5. quickReplies: 3 variations (1-2 sentences) - warm, personal, varied
6. fullReplies: 2 variations (2-4 sentences) - more detail, same warmth
7. Use company-specific placeholders: {companyName}, {servicePrice}, etc.

❌ NEVER SAY (sounds robotic):
- "How can I assist you today?"
- "What can I do for you?"
- "Thank you for calling"
- Generic corporate greetings

✅ INSTEAD SAY (sounds human):
- "Hey {name}! Good to hear from you."
- "Hi {name}! Thanks for reaching out to us."
- "Great to have you back, {name}!"
- "{name}, I'm glad you called!"

═══════════════════════════════════════════════════════════════════════════════
OUTPUT FORMAT (JSON only, no markdown):
═══════════════════════════════════════════════════════════════════════════════
{
    "name": "Short descriptive name (3-5 words)",
    "category": "Scheduling|Pricing|Hours|Service Area|Emergency|FAQ|Warranty|Billing|General",
    
    "scenarioType": "FAQ|BOOKING|EMERGENCY|TROUBLESHOOT|BILLING|TRANSFER|SMALL_TALK",
    "priority": 0,
    
    "behavior": "friendly_warm|empathetic_reassuring|professional_efficient|enthusiastic_positive|calm_patient",
    
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
        "Hey {name}! [warm, personal response with {placeholder} if relevant]",
        "{name}, [different warm phrasing variation 2]",
        "[Third unique warm response]"
    ],
    
    "fullReplies": [
        "Hi {name}! [Warm greeting]. [More detailed helpful response]. [Proactive offer to help further]",
        "[Alternative warm greeting to {name}]. [Different detailed response]. [Close warmly]"
    ],
    
    "followUpFunnel": "Is there anything else I can help you with today, {name}?",
    
    "followUpMode": "NONE|ASK_IF_BOOK|ASK_FOLLOWUP_QUESTION",
    "followUpQuestionText": "Would you like me to get that set up for you, {name}?",
    
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

BEHAVIOR GUIDE (pick the most appropriate):
- friendly_warm: Casual, welcoming, great for most scenarios
- empathetic_reassuring: For problems, complaints, service issues
- professional_efficient: Business inquiries, billing, formal
- enthusiastic_positive: Booking, returning customers, good news
- calm_patient: Frustrated callers, complex questions, emergencies

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
                    content: `You are creating scenarios for the BEST AI receptionist in the world.

YOUR MINDSET:
- You're crafting how a WARM, INTELLIGENT, CARING human receptionist would respond
- Every response should make callers feel like VIPs, not ticket numbers
- Be efficient but NEVER robotic or dismissive
- Naturally guide toward helpful outcomes (booking, answers, transfers)

CREATE COMPREHENSIVE SCENARIOS WITH:
- 10-15 clean triggers (SHORT 2-3 words + LONG 5-8 words, no leading punctuation)
- 2-4 regex patterns for catching variations
- 3 quickReplies (varied, warm, personal - use {name} placeholder)
- 2 fullReplies (detailed but still warm and human)
- Appropriate entityCapture (name, phone, issue, etc.)
- templateVariables with fallbacks (name=valued customer, etc.)
- Smart followUpFunnel to steer conversation

Output VALID JSON only. No markdown. No explanations.` 
                },
                { role: 'user', content: prompt }
            ],
            temperature: 0.7,  // Slightly higher for more creative, human responses
            max_tokens: 2000   // More tokens for comprehensive output
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
