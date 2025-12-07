/**
 * ============================================================================
 * DEEPGRAM FALLBACK SERVICE
 * ============================================================================
 * 
 * HYBRID STT ARCHITECTURE
 * 
 * When Twilio STT returns low confidence, use Deepgram as a smarter fallback
 * instead of asking the caller to repeat. This gives premium accuracy without
 * the UX penalty of repeated prompts.
 * 
 * FLOW:
 * 1. Twilio returns transcript with 42% confidence
 * 2. Low confidence detected (< 60% threshold)
 * 3. Instead of "Could you repeat that?" → Send to Deepgram
 * 4. Deepgram returns "I need AC service" at 98%
 * 5. Continue with Deepgram transcript
 * 6. Log comparison to Black Box for vocabulary learning
 * 
 * COST MODEL:
 * - Deepgram: ~$0.0048/minute (Nova-2)
 * - Only used on ~10% of calls (low confidence)
 * - ~$0.50 per 100 calls for dramatically better accuracy
 * 
 * CONFIG:
 * - DEEPGRAM_API_KEY: Platform-level env variable (shared across all companies)
 * - Per-company toggle: company.aiAgentSettings.llm0Controls.lowConfidenceHandling.useDeepgramFallback
 * 
 * ============================================================================
 */

const axios = require('axios');
const logger = require('../utils/logger');

const DG_API_KEY = process.env.DEEPGRAM_API_KEY || '';

// Deepgram configuration defaults
const DG_DEFAULTS = {
    model: 'nova-2-phonecall',  // Optimized for phone calls
    language: 'en-US',
    smart_format: true,         // Smart formatting (numbers, dates)
    punctuate: true,            // Add punctuation
    diarize: false,             // No speaker separation needed (single caller)
    utterances: false,          // No utterance splitting
    keywords: [],               // Can be enhanced with company vocabulary later
};

/**
 * Transcribe a recording URL with Deepgram
 * 
 * @param {string} recordingUrl - Publicly reachable URL to audio (Twilio recording)
 * @param {object} options - Optional overrides for Deepgram params
 * @returns {object|null} - { transcript, confidence, raw } or null on failure
 */
async function transcribeWithDeepgram(recordingUrl, options = {}) {
    const startTime = Date.now();
    
    if (!DG_API_KEY) {
        logger.warn('[DEEPGRAM] No API key configured - fallback disabled');
        return null;
    }
    
    if (!recordingUrl) {
        logger.warn('[DEEPGRAM] No recording URL provided');
        return null;
    }

    const payload = {
        url: recordingUrl,
        ...DG_DEFAULTS,
        ...options,
    };

    try {
        logger.info(`[DEEPGRAM] Starting transcription for: ${recordingUrl.substring(0, 50)}...`);
        
        const res = await axios({
            method: 'POST',
            url: 'https://api.deepgram.com/v1/listen',
            headers: {
                'Authorization': `Token ${DG_API_KEY}`,
                'Content-Type': 'application/json',
            },
            data: payload,
            timeout: 10000, // 10 second timeout
        });

        const dg = res.data;
        const duration = Date.now() - startTime;
        
        if (!dg || !dg.results || !dg.results.channels?.[0]?.alternatives?.[0]) {
            logger.warn(`[DEEPGRAM] No results returned (${duration}ms)`);
            return null;
        }

        const alt = dg.results.channels[0].alternatives[0];
        const transcript = alt.transcript || '';
        const confidence = typeof alt.confidence === 'number' ? alt.confidence : 0;

        logger.info(`[DEEPGRAM] ✅ Transcription complete (${duration}ms): "${transcript.substring(0, 50)}..." (${(confidence * 100).toFixed(1)}%)`);

        return {
            transcript,
            confidence,
            confidencePercent: Math.round(confidence * 100),
            durationMs: duration,
            raw: dg,
        };
        
    } catch (err) {
        const duration = Date.now() - startTime;
        logger.error(`[DEEPGRAM] ❌ Transcription failed (${duration}ms):`, err?.response?.data || err.message);
        
        return null;
    }
}

/**
 * Decide whether Deepgram should be tried for this utterance
 * 
 * @param {number} twilioConfPercent - Twilio confidence 0-100
 * @param {object} lcSettings - Low confidence config object (per company)
 * @returns {boolean}
 */
function shouldUseDeepgramFallback(twilioConfPercent, lcSettings) {
    // No API key = no fallback
    if (!DG_API_KEY) {
        return false;
    }
    
    // Settings not provided
    if (!lcSettings) {
        return false;
    }
    
    // Toggle not enabled
    if (!lcSettings.useDeepgramFallback) {
        return false;
    }
    
    // Check threshold
    const threshold = Number(lcSettings.deepgramFallbackThreshold ?? lcSettings.threshold ?? 60);
    return twilioConfPercent < threshold;
}

/**
 * Check if Deepgram result is good enough to use
 * 
 * @param {object} dgResult - Result from transcribeWithDeepgram
 * @param {object} lcSettings - Low confidence config object
 * @returns {boolean}
 */
function shouldAcceptDeepgramResult(dgResult, lcSettings) {
    if (!dgResult || !dgResult.transcript) {
        return false;
    }
    
    const acceptThreshold = Number(lcSettings?.deepgramAcceptThreshold ?? 80);
    return dgResult.confidencePercent >= acceptThreshold;
}

/**
 * Check if Deepgram is configured and available
 * @returns {boolean}
 */
function isDeepgramConfigured() {
    return Boolean(DG_API_KEY);
}

/**
 * Generate vocabulary suggestions by comparing Twilio and Deepgram transcripts
 * 
 * @param {string} twilioTranscript - What Twilio heard
 * @param {string} deepgramTranscript - What Deepgram heard
 * @returns {object} - Suggestions for STT improvements
 */
function generateVocabularySuggestions(twilioTranscript, deepgramTranscript) {
    const suggestions = {
        corrections: [],
        keywords: [],
        fillers: [],
        impossibleWords: [],
    };
    
    if (!twilioTranscript || !deepgramTranscript) {
        return suggestions;
    }
    
    const twilioWords = twilioTranscript.toLowerCase().split(/\s+/);
    const deepgramWords = deepgramTranscript.toLowerCase().split(/\s+/);
    
    // Find words that differ
    for (let i = 0; i < Math.min(twilioWords.length, deepgramWords.length); i++) {
        const tw = twilioWords[i];
        const dg = deepgramWords[i];
        
        if (tw !== dg && tw.length > 2 && dg.length > 2) {
            // Potential mishearing
            suggestions.corrections.push({
                heard: tw,
                actual: dg,
                context: deepgramWords.slice(Math.max(0, i-2), i+3).join(' ')
            });
        }
    }
    
    // Extract potential domain keywords from Deepgram (words Twilio missed)
    const twilioSet = new Set(twilioWords);
    for (const word of deepgramWords) {
        if (!twilioSet.has(word) && word.length > 3) {
            suggestions.keywords.push(word);
        }
    }
    
    return suggestions;
}

module.exports = {
    transcribeWithDeepgram,
    shouldUseDeepgramFallback,
    shouldAcceptDeepgramResult,
    isDeepgramConfigured,
    generateVocabularySuggestions,
    DG_DEFAULTS,
};

