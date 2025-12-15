/**
 * ============================================================================
 * CONVERSATION ENGINE - Unified AI Brain for ALL Channels
 * ============================================================================
 * 
 * This is THE SINGLE ENTRY POINT for all conversation processing.
 * Every channel (phone, SMS, website, test console) calls this engine.
 * 
 * WHAT THIS ENGINE DOES:
 * 1. Loads company config (RuntimeConfigLoader pattern)
 * 2. Gets/creates session (SessionService - MongoDB)
 * 3. Builds customer context (CustomerService)
 * 4. Builds running summary (RunningSummaryService)
 * 5. Extracts slots from user input (programmatic)
 * 6. Calls AI brain (HybridReceptionistLLM)
 * 7. Applies guards (forbidden phrases, phase rules)
 * 8. Saves turn to session
 * 9. Returns unified response
 * 
 * WHAT CHANNELS DO (adapters only):
 * - Phone: TwiML formatting, STT/TTS, Twilio callbacks
 * - Chat/Website: JSON formatting, debug payloads
 * - SMS: Plain text in/out
 * 
 * CRITICAL RULES:
 * - ALL AI behavior changes go HERE, never in channel routes
 * - Same persona, same prompts, same phase logic across channels
 * - If you're editing AI logic in v2twilio.js or chat.js, STOP - edit here
 * 
 * MULTI-TENANT: All operations require companyId for isolation.
 * 
 * ============================================================================
 */

const Company = require('../models/v2Company');
const CustomerService = require('./CustomerService');
const SessionService = require('./SessionService');
const RunningSummaryService = require('./RunningSummaryService');
const HybridReceptionistLLM = require('./HybridReceptionistLLM');
const BookingScriptEngine = require('./BookingScriptEngine');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// VERSION BANNER - Proves this code is deployed
// ═══════════════════════════════════════════════════════════════════════════
const ENGINE_VERSION = '2025-12-13-V1-UNIFIED-BRAIN';
logger.info(`[CONVERSATION ENGINE] 🧠 LOADED VERSION: ${ENGINE_VERSION}`, {
    features: [
        '✅ Single entry point for ALL channels',
        '✅ SessionService for state (not Redis)',
        '✅ Unified persona and prompts',
        '✅ Same behavior: phone = chat = sms'
    ]
});

/**
 * Programmatic slot extraction helpers
 * These extract obvious data (name, phone, address) before LLM processing
 */
const SlotExtractors = {
    /**
     * Extract name from user input
     * Handles any case (STT may output lowercase)
     */
    extractName(text) {
        if (!text || typeof text !== 'string') return null;
        
        // ═══════════════════════════════════════════════════════════════════
        // FALSE POSITIVES - Filter out common greetings and phrases
        // ═══════════════════════════════════════════════════════════════════
        const falsePositiveWords = [
            'the', 'that', 'this', 'what', 'just', 'yeah', 'yes', 'sure', 
            'hi', 'hello', 'hey', 'good', 'morning', 'afternoon', 'evening', 'night',
            'thanks', 'thank', 'you', 'okay', 'ok', 'alright', 'well', 'please'
        ];
        
        // Full phrases that look like names but aren't
        const falsePositivePhrases = [
            'good morning', 'good afternoon', 'good evening', 'good night',
            'thank you', 'hi there', 'hello there', 'hey there',
            'this is', 'that is', 'what is', 'yes please', 'okay thanks',
            'yeah sure', 'sure thing', 'all right', 'well hello'
        ];
        
        // Normalize and check if input is just a greeting/phrase
        const normalizedInput = text.toLowerCase().trim();
        for (const phrase of falsePositivePhrases) {
            if (normalizedInput === phrase || normalizedInput.startsWith(phrase + ' ') || normalizedInput.endsWith(' ' + phrase)) {
                return null; // Don't extract anything from greeting-only messages
            }
        }
        
        // Common patterns - use [a-zA-Z] to handle any case from STT
        const patterns = [
            /my name is\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
            /this is\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
            /i'?m\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
            /it'?s\s+([a-zA-Z]+)\s+(?:calling|here)/i,
            /(?:name\s*(?:is)?\s*)([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,  // "name Mark" or "name is Mark"
            /(?:^|\s)([a-zA-Z]+\s+[a-zA-Z]+)(?:\s*$|\s+(?:here|calling))/i  // "John Smith" at start/end
        ];
        
        for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const rawName = match[1].trim();
                const rawNameLower = rawName.toLowerCase();
                
                // Filter out single-word false positives
                if (falsePositiveWords.includes(rawNameLower)) {
                    continue;
                }
                
                // Filter out two-word phrases that are false positives
                if (falsePositivePhrases.includes(rawNameLower)) {
                    continue;
                }
                
                // Filter out if BOTH words are false positives (e.g., "Good Morning")
                const words = rawNameLower.split(/\s+/);
                if (words.length === 2 && falsePositiveWords.includes(words[0]) && falsePositiveWords.includes(words[1])) {
                    continue;
                }
                
                // Title case the name: "mark" -> "Mark", "mark smith" -> "Mark Smith"
                const name = rawName.split(' ')
                    .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                    .join(' ');
                return name;
            }
        }
        
        return null;
    },
    
    /**
     * Extract phone number from user input
     */
    extractPhone(text) {
        if (!text || typeof text !== 'string') return null;
        
        // Remove common words that might confuse extraction
        let cleaned = text.replace(/\b(phone|number|is|my|the|at|reach|me|call)\b/gi, ' ');
        
        // Look for 10-digit patterns
        const digits = cleaned.replace(/\D/g, '');
        
        // Must be 10 or 11 digits (with country code)
        if (digits.length === 10) {
            return digits.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
        } else if (digits.length === 11 && digits.startsWith('1')) {
            return digits.substring(1).replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
        }
        
        return null;
    },
    
    /**
     * Extract address from user input
     * STRICTER version - requires street number + street type
     */
    extractAddress(text) {
        if (!text || typeof text !== 'string') return null;
        
        // Must have a street number and street type indicator
        const streetTypes = /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|circle|cir)\b/i;
        const hasStreetNumber = /\b\d{1,5}\s+\w+/; // e.g., "123 Main"
        
        // Check for both requirements
        if (!streetTypes.test(text) || !hasStreetNumber.test(text)) {
            return null;
        }
        
        // Filter out common complaint phrases that might have numbers
        const complaintPhrases = ['not cooling', 'not working', 'system', 'unit', 'years old', 'degrees'];
        for (const phrase of complaintPhrases) {
            if (text.toLowerCase().includes(phrase)) {
                return null;
            }
        }
        
        // Extract address-like pattern
        const addressPattern = /\b(\d{1,5}\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|circle|cir)[\w\s,]*)/i;
        const match = text.match(addressPattern);
        
        if (match && match[1] && match[1].length > 10) {
            return match[1].trim();
        }
        
        return null;
    }
};

/**
 * ════════════════════════════════════════════════════════════════════════════
 * MAIN ENTRY POINT: processTurn
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Call this for EVERY user message, regardless of channel.
 * 
 * @param {Object} params
 * @param {string} params.companyId - Required: Company ID for multi-tenant isolation
 * @param {string} params.channel - Required: 'phone' | 'sms' | 'website' | 'test'
 * @param {string} params.userText - Required: What the user said/typed
 * @param {string} params.sessionId - Optional: Existing session ID (creates new if not provided)
 * @param {string} params.callerPhone - Optional: Caller's phone number (for phone/sms)
 * @param {string} params.callSid - Optional: Twilio Call SID (for phone)
 * @param {Object} params.visitorInfo - Optional: Website visitor info { ip, userAgent, pageUrl }
 * @param {Object} params.metadata - Optional: Additional metadata (STT confidence, etc.)
 * @param {boolean} params.includeDebug - Optional: Include debug info in response
 * 
 * @returns {Object} {
 *   success: boolean,
 *   reply: string,              // AI response text
 *   sessionId: string,          // Session ID for continuity
 *   phase: string,              // Current phase: 'greeting' | 'discovery' | 'booking' | 'complete'
 *   slotsCollected: Object,     // { name, phone, address, ... }
 *   wantsBooking: boolean,      // Caller wants to schedule
 *   conversationMode: string,   // 'free' | 'booking'
 *   debug?: Object              // Debug info (if includeDebug: true)
 * }
 */
async function processTurn({
    companyId,
    channel,
    userText,
    sessionId: providedSessionId = null,
    callerPhone = null,
    callSid = null,
    visitorInfo = {},
    metadata = {},
    includeDebug = false
}) {
    const startTime = Date.now();
    const debugLog = [];
    
    const log = (msg, data = {}) => {
        const entry = { ts: Date.now() - startTime, msg, ...data };
        debugLog.push(entry);
        logger.info(`[CONVERSATION ENGINE] ${msg}`, data);
    };
    
    try {
        // ═══════════════════════════════════════════════════════════════════
        // VALIDATION
        // ═══════════════════════════════════════════════════════════════════
        if (!companyId) {
            throw new Error('companyId is required');
        }
        
        if (!channel || !['phone', 'sms', 'website', 'test'].includes(channel)) {
            throw new Error('channel must be one of: phone, sms, website, test');
        }
        
        if (!userText || typeof userText !== 'string') {
            userText = ''; // Allow empty for silence/timeout handling
        }
        
        log('CHECKPOINT 1: Starting processTurn', { companyId, channel, textLength: userText.length });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Load company
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 2: Loading company...');
        const company = await Company.findById(companyId);
        
        if (!company) {
            throw new Error(`Company not found: ${companyId}`);
        }
        log('CHECKPOINT 2: ✅ Company loaded', { name: company.companyName });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 2: Find or create customer
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 3: Customer lookup...');
        let customer = null;
        let isNewCustomer = false;
        
        // Generate session ID if not provided
        const sessionId = providedSessionId || 
            (channel === 'phone' && callSid) ? `call-${callSid}` :
            `${channel}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        try {
            const identifier = callerPhone || visitorInfo.phone || visitorInfo.email;
            if (identifier) {
                const result = await CustomerService.findOrCreate(
                    companyId,
                    {
                        phone: callerPhone || visitorInfo.phone,
                        email: visitorInfo.email,
                        name: visitorInfo.name,
                        sessionId
                    },
                    channel
                );
                customer = result.customer;
                isNewCustomer = result.isNew;
            }
        } catch (custErr) {
            log('Customer lookup failed (non-fatal)', { error: custErr.message });
        }
        
        log('CHECKPOINT 3: ✅ Customer done', { hasCustomer: !!customer, isNew: isNewCustomer });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: Get or create session
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 4: Session management...');
        
        const identifiers = channel === 'phone' 
            ? { callSid, callerPhone, calledNumber: metadata.calledNumber }
            : channel === 'sms'
            ? { smsPhone: callerPhone }
            : { sessionId, ip: visitorInfo.ip, userAgent: visitorInfo.userAgent, pageUrl: visitorInfo.pageUrl };
        
        const session = await SessionService.getOrCreate({
            companyId,
            channel,
            identifiers,
            customer
        });
        
        log('CHECKPOINT 4: ✅ Session ready', { 
            sessionId: session._id, 
            turns: session.metrics?.totalTurns || 0,
            phase: session.phase,
            // 🔍 DIAGNOSTIC: Show what slots were already saved in this session
            existingSlots: JSON.stringify(session.collectedSlots || {}),
            isSessionReused: (session.metrics?.totalTurns || 0) > 0
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: Build customer context for AI
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 5: Building customer context...');
        let customerContext;
        try {
            customerContext = customer 
                ? CustomerService.buildContextForAI(customer)
                : { isKnown: false, summary: `New ${channel} visitor` };
        } catch (ctxErr) {
            customerContext = { isKnown: false, summary: `New ${channel} visitor` };
        }
        log('CHECKPOINT 5: ✅ Customer context built');
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 5: Build running summary (conversation memory)
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 6: Building running summary...');
        let summaryBullets = [];
        let summaryFormatted = '';
        try {
            const summaryResult = RunningSummaryService.buildAndFormat({
                previousSummary: session.runningSummary || [],
                customerContext,
                currentTurn: { userMessage: userText },
                conversationState: {
                    phase: session.phase || 'greeting',
                    knownSlots: session.collectedSlots || {},
                    signals: session.signals || {}
                },
                company
            });
            summaryBullets = summaryResult.bullets;
            summaryFormatted = summaryResult.formatted;
        } catch (sumErr) {
            log('Running summary failed (non-fatal)', { error: sumErr.message });
        }
        log('CHECKPOINT 6: ✅ Running summary built', { bullets: summaryBullets.length });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 6: Get conversation history
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 7: Getting conversation history...');
        let conversationHistory = [];
        try {
            conversationHistory = session.getHistoryForAI ? session.getHistoryForAI() : [];
        } catch (histErr) {
            log('getHistoryForAI failed (non-fatal)', { error: histErr.message });
        }
        log('CHECKPOINT 7: ✅ History retrieved', { turns: conversationHistory.length });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 7: Extract slots programmatically
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 8: Extracting slots...');
        
        // ════════════════════════════════════════════════════════════════════
        // SLOT VALIDATOR - Clean up obviously invalid stored values
        // This catches corrupted data from old sessions or bad extractions
        // ════════════════════════════════════════════════════════════════════
        const rawSlots = { ...(session.collectedSlots || {}) };
        const currentSlots = {};
        
        // Validate name - reject greetings, single letters, numbers, etc.
        if (rawSlots.name) {
            const nameLower = rawSlots.name.toLowerCase().trim();
            const invalidNames = [
                'good morning', 'good afternoon', 'good evening', 'good night',
                'hi', 'hello', 'hey', 'hi there', 'hello there', 'good',
                'morning', 'afternoon', 'evening', 'yes', 'no', 'yeah', 'yep',
                'thanks', 'thank you', 'okay', 'ok', 'sure', 'please'
            ];
            if (invalidNames.includes(nameLower) || nameLower.length < 2) {
                log('🚨 INVALID NAME DETECTED - clearing:', rawSlots.name);
                // Don't copy invalid name
            } else {
                currentSlots.name = rawSlots.name;
            }
        }
        
        // Validate phone - must have at least 7 digits
        if (rawSlots.phone) {
            const digitsOnly = rawSlots.phone.replace(/\D/g, '');
            if (digitsOnly.length >= 7) {
                currentSlots.phone = rawSlots.phone;
            } else {
                log('🚨 INVALID PHONE DETECTED - clearing:', rawSlots.phone);
            }
        }
        
        // Copy other slots as-is (address, time, etc.)
        if (rawSlots.address) currentSlots.address = rawSlots.address;
        if (rawSlots.time) currentSlots.time = rawSlots.time;
        if (rawSlots.partialName) currentSlots.partialName = rawSlots.partialName;
        
        // Copy any other custom slots
        for (const key of Object.keys(rawSlots)) {
            if (!['name', 'phone', 'address', 'time', 'partialName'].includes(key)) {
                currentSlots[key] = rawSlots[key];
            }
        }
        
        log('CHECKPOINT 8a: Slots after validation', { 
            raw: JSON.stringify(rawSlots), 
            validated: JSON.stringify(currentSlots) 
        });
        
        // If validation cleared any invalid slots, update the session to persist the cleanup
        const slotsWereCleaned = JSON.stringify(rawSlots) !== JSON.stringify(currentSlots);
        if (slotsWereCleaned) {
            log('🧹 CLEANING SESSION - Invalid slots were removed');
            session.collectedSlots = currentSlots;
            // Save immediately so the cleanup persists
            try {
                await session.save();
                log('✅ Session cleaned and saved');
            } catch (saveErr) {
                log('⚠️ Failed to save cleaned session (non-fatal)', { error: saveErr.message });
            }
        }
        
        const extractedThisTurn = {};
        
        // Get booking config for askMissingNamePart setting
        const bookingConfig = BookingScriptEngine.getBookingSlotsFromCompany(company);
        const nameSlotConfig = bookingConfig.slots.find(s => s.slotId === 'name' || s.id === 'name');
        const askMissingNamePart = nameSlotConfig?.askMissingNamePart === true;
        
        // Extract name
        if (currentSlots.name) {
            log('📝 Name already collected:', currentSlots.name);
        } else if (userText) {
            log('🔍 Attempting name extraction from:', userText.substring(0, 50));
            const extractedName = SlotExtractors.extractName(userText);
            log('🔍 Extraction result:', extractedName || '(none)');
            if (extractedName) {
                const isPartialName = !extractedName.includes(' ');
                const alreadyAskedForMissingPart = session.askedForMissingNamePart === true;
                
                if (askMissingNamePart && isPartialName && !alreadyAskedForMissingPart) {
                    // Store partial, let AI ask for full name
                    currentSlots.partialName = extractedName;
                    extractedThisTurn.partialName = extractedName;
                    log('Partial name detected (will ask for full)', { partialName: extractedName });
                } else {
                    // Accept name as-is
                    if (currentSlots.partialName && isPartialName) {
                        currentSlots.name = `${currentSlots.partialName} ${extractedName}`;
                        delete currentSlots.partialName;
                    } else {
                        currentSlots.name = extractedName;
                    }
                    extractedThisTurn.name = currentSlots.name;
                    log('Name extracted', { name: currentSlots.name });
                }
            } else if (currentSlots.partialName) {
                // Accept partial as complete (only ask once)
                currentSlots.name = currentSlots.partialName;
                delete currentSlots.partialName;
                extractedThisTurn.name = currentSlots.name;
                log('Accepting partial name as complete', { name: currentSlots.name });
            }
        }
        
        // Extract phone
        if (!currentSlots.phone && userText) {
            const extractedPhone = SlotExtractors.extractPhone(userText);
            if (extractedPhone) {
                currentSlots.phone = extractedPhone;
                extractedThisTurn.phone = extractedPhone;
                log('Phone extracted', { phone: extractedPhone });
            }
        }
        
        // Extract address
        if (!currentSlots.address && userText) {
            const extractedAddress = SlotExtractors.extractAddress(userText);
            if (extractedAddress) {
                currentSlots.address = extractedAddress;
                extractedThisTurn.address = extractedAddress;
                log('Address extracted', { address: extractedAddress });
            }
        }
        
        const willAskForMissingNamePart = currentSlots.partialName && !currentSlots.name;
        log('CHECKPOINT 8: ✅ Slots extracted', { 
            currentSlots: JSON.stringify(currentSlots),
            extractedThisTurn: JSON.stringify(extractedThisTurn),
            willAskForMissingNamePart
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 8: Call AI brain
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 9: Calling AI brain...');
        const aiStartTime = Date.now();
        
        const aiResult = await HybridReceptionistLLM.processConversation({
            company,
            callContext: {
                callId: session._id.toString(),
                companyId,
                customerContext,
                runningSummary: summaryFormatted,
                turnCount: (session.metrics?.totalTurns || 0) + 1,
                channel,
                partialName: currentSlots.partialName || null
            },
            currentMode: session.phase === 'booking' ? 'booking' : 'free',
            knownSlots: currentSlots,
            conversationHistory,
            userInput: userText,
            behaviorConfig: company.aiAgentSettings?.frontDeskBehavior || {}
        });
        
        const aiLatencyMs = Date.now() - aiStartTime;
        
        // 🚨 DEBUG: Check if AI returned an error
        if (aiResult.debug?.error) {
            logger.error('[CONVERSATION ENGINE] ⚠️ AI brain returned error state:', {
                errorMessage: aiResult.debug?.errorMessage,
                errorName: aiResult.debug?.errorName,
                errorCode: aiResult.debug?.errorCode,
                tokensUsed: aiResult.tokensUsed || 0,
                latencyMs: aiLatencyMs
            });
        }
        
        // Merge extracted slots
        aiResult.filledSlots = { ...(aiResult.filledSlots || {}), ...extractedThisTurn };
        
        log('CHECKPOINT 9: ✅ AI response generated', { 
            latencyMs: aiLatencyMs, 
            tokensUsed: aiResult.tokensUsed,
            mode: aiResult.conversationMode,
            hasError: !!aiResult.debug?.error,
            replyPreview: (aiResult.reply || '').substring(0, 50)
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 9: Process AI response
        // ═══════════════════════════════════════════════════════════════════
        let aiResponse = (aiResult?.reply || aiResult?.response || '').trim();
        
        // Handle empty response
        if (!aiResponse) {
            log('⚠️ Empty AI response, using fallback');
            aiResponse = "I'm sorry, could you repeat that?";
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 10: Update session
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 10: Updating session...');
        const latencyMs = Date.now() - startTime;
        
        try {
            await SessionService.addTurn({
                session,
                userMessage: userText,
                aiResponse,
                metadata: {
                    latencyMs,
                    tokensUsed: aiResult?.tokensUsed || 0,
                    responseSource: aiResult?.fromQuickAnswers ? 'quick_answer' : 'llm',
                    confidence: aiResult?.confidence,
                    slotsExtracted: aiResult?.filledSlots || {},
                    channel
                },
                company
            });
        } catch (turnErr) {
            log('Failed to save turn (non-fatal)', { error: turnErr.message });
        }
        
        // Update phase
        const newPhase = aiResult?.conversationMode === 'booking' ? 'booking' : 
                         aiResult?.conversationMode === 'complete' ? 'complete' : 
                         session.phase || 'greeting';
        
        if (newPhase !== session.phase) {
            await SessionService.updatePhase(session, newPhase);
        }
        
        // Save flags
        if (willAskForMissingNamePart) {
            session.askedForMissingNamePart = true;
            await session.save();
        }
        
        log('CHECKPOINT 10: ✅ Session updated', { phase: newPhase });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 11: Build response
        // ═══════════════════════════════════════════════════════════════════
        const response = {
            success: true,
            reply: aiResponse,
            sessionId: session._id.toString(),
            phase: newPhase,
            slotsCollected: { ...session.collectedSlots, ...(aiResult.filledSlots || {}) },
            wantsBooking: aiResult.wantsBooking || false,
            conversationMode: aiResult.conversationMode || 'free',
            latencyMs
        };
        
        // Add debug info if requested
        if (includeDebug) {
            response.debug = {
                engineVersion: ENGINE_VERSION,
                channel,
                latencyMs,
                aiLatencyMs,
                tokensUsed: aiResult.tokensUsed || 0,
                responseSource: aiResult.fromQuickAnswers ? 'quick_answer' : 'llm',
                confidence: aiResult.confidence,
                customerContext: {
                    isKnown: customerContext.isKnown,
                    isReturning: customerContext.isReturning,
                    name: customerContext.name
                },
                runningSummary: summaryBullets,
                turnNumber: session.metrics?.totalTurns || 0,
                historySent: conversationHistory.length,
                // 🔍 SLOT DIAGNOSTICS - Shows exactly what happened with slots
                slotDiagnostics: {
                    sessionId: session._id.toString(),
                    wasSessionReused: (session.metrics?.totalTurns || 0) > 0,
                    slotsBeforeThisTurn: session.collectedSlots || {},
                    extractedThisTurn: extractedThisTurn,
                    slotsAfterMerge: { ...session.collectedSlots, ...(aiResult.filledSlots || {}) },
                    whatLLMSaw: currentSlots
                },
                bookingConfig: {
                    source: bookingConfig.source,
                    isConfigured: bookingConfig.isConfigured,
                    slots: bookingConfig.slots.map(s => ({
                        id: s.slotId,
                        type: s.type,
                        question: s.question,
                        required: s.required
                    }))
                },
                // 🧠 LLM BRAIN DEBUG - What the LLM decided and why
                llmBrain: aiResult.debug || null,
                debugLog
            };
        }
        
        log('✅ processTurn complete', { responseLength: aiResponse.length, latencyMs });
        
        return response;
        
    } catch (error) {
        logger.error('[CONVERSATION ENGINE] ❌ Error in processTurn', {
            error: error.message,
            stack: error.stack,
            companyId,
            channel
        });
        
        return {
            success: false,
            error: error.message,
            errorType: error.name,
            reply: "I'm sorry, I'm having trouble right now. Could you repeat that?",
            sessionId: providedSessionId,
            phase: 'error',
            slotsCollected: {},
            wantsBooking: false,
            conversationMode: 'free',
            latencyMs: Date.now() - startTime,
            debug: includeDebug ? { debugLog, error: error.message } : undefined
        };
    }
}

/**
 * Get session by ID (for reconnecting or debugging)
 */
async function getSession(sessionId) {
    return SessionService.findById(sessionId);
}

/**
 * End a session with outcome
 */
async function endSession(sessionId, outcome = 'no_action') {
    const session = await SessionService.findById(sessionId);
    if (!session) {
        throw new Error('Session not found');
    }
    return SessionService.end(session, outcome);
}

module.exports = {
    processTurn,
    getSession,
    endSession,
    
    // Export version for debugging
    ENGINE_VERSION,
    
    // Export slot extractors for testing
    SlotExtractors
};

