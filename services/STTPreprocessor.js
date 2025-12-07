/**
 * STTPreprocessor.js - Speech-to-Text Preprocessing Engine
 * 
 * Cleans raw STT transcripts using template-specific intelligence:
 * 1. Strip filler words
 * 2. Apply mishear corrections (with context awareness)
 * 3. Detect impossible words
 * 4. Log transformations to Black Box
 * 
 * Performance: O(n) time complexity using regex-based matching
 * 
 * @module services/STTPreprocessor
 * @version 1.0.0
 */

const logger = require('../utils/logger');
const STTProfile = require('../models/STTProfile');
const BlackBoxLogger = require('./BlackBoxLogger');

// Cache for loaded profiles (Redis will be used in production)
const profileCache = new Map();
const CACHE_TTL = 60000; // 1 minute

class STTPreprocessor {
    
    /**
     * Main entry point: Process raw transcript through STT intelligence
     * @param {string} rawTranscript - Raw text from STT provider
     * @param {ObjectId} templateId - Template ID for loading profile
     * @param {Object} options - Additional options
     * @param {string} options.callId - Call ID for Black Box logging
     * @param {string} options.companyId - Company ID for Black Box logging
     * @returns {Promise<Object>} Processed result with transformations
     */
    static async process(rawTranscript, templateId, options = {}) {
        const startTime = Date.now();
        const { callId, companyId } = options;
        
        // Initialize result object
        const result = {
            raw: rawTranscript,
            cleaned: rawTranscript,
            transformations: {
                fillersRemoved: [],
                correctionsApplied: [],
                impossibleWordsDetected: []
            },
            metrics: {
                processingTimeMs: 0,
                fillerCount: 0,
                correctionCount: 0,
                impossibleCount: 0
            },
            suggestions: []
        };
        
        try {
            // Load STT profile for this template
            const profile = await this.loadProfile(templateId);
            
            if (!profile) {
                logger.debug('[STT PREPROCESSOR] No profile found, returning raw transcript', { templateId });
                result.metrics.processingTimeMs = Date.now() - startTime;
                return result;
            }
            
            let transcript = rawTranscript.toLowerCase().trim();
            
            // Stage 1: Strip filler words
            if (profile.provider.applyFillers) {
                const fillerResult = this.stripFillers(transcript, profile.fillers);
                transcript = fillerResult.cleaned;
                result.transformations.fillersRemoved = fillerResult.removed;
                result.metrics.fillerCount = fillerResult.removed.length;
            }
            
            // Stage 2: Apply corrections with context awareness
            if (profile.provider.applyCorrections) {
                const correctionResult = this.applyCorrections(transcript, profile.corrections);
                transcript = correctionResult.cleaned;
                result.transformations.correctionsApplied = correctionResult.applied;
                result.metrics.correctionCount = correctionResult.applied.length;
            }
            
            // Stage 3: Detect impossible words
            if (profile.provider.applyImpossibleWords) {
                const impossibleResult = this.detectImpossibleWords(transcript, profile.impossibleWords);
                result.transformations.impossibleWordsDetected = impossibleResult.detected;
                result.metrics.impossibleCount = impossibleResult.detected.length;
                result.suggestions.push(...impossibleResult.suggestions);
            }
            
            // Stage 4: Detect unknown patterns for suggestions
            const unknownPatterns = this.detectUnknownPatterns(transcript, profile);
            result.suggestions.push(...unknownPatterns);
            
            // Final cleanup
            result.cleaned = this.normalizeWhitespace(transcript);
            result.metrics.processingTimeMs = Date.now() - startTime;
            
            // Log to Black Box if call context provided
            if (callId && companyId && BlackBoxLogger) {
                this.logToBlackBox(callId, companyId, result, profile);
            }
            
            // Update profile metrics (async, don't await)
            this.updateProfileMetrics(profile._id, result.metrics).catch(err => {
                logger.debug('[STT PREPROCESSOR] Failed to update metrics', { error: err.message });
            });
            
            logger.debug('[STT PREPROCESSOR] Processing complete', {
                templateId,
                rawLength: rawTranscript.length,
                cleanedLength: result.cleaned.length,
                fillersRemoved: result.metrics.fillerCount,
                correctionsApplied: result.metrics.correctionCount,
                processingTimeMs: result.metrics.processingTimeMs
            });
            
            return result;
            
        } catch (error) {
            logger.error('[STT PREPROCESSOR] Processing failed', {
                error: error.message,
                templateId,
                rawTranscript: rawTranscript.substring(0, 100)
            });
            
            // Fallback: Return raw transcript on error
            result.cleaned = rawTranscript;
            result.error = error.message;
            result.metrics.processingTimeMs = Date.now() - startTime;
            return result;
        }
    }
    
    /**
     * Load STT profile with caching
     * @param {ObjectId} templateId - Template ID
     * @returns {Promise<Object>} STT Profile
     */
    static async loadProfile(templateId) {
        const cacheKey = templateId.toString();
        const cached = profileCache.get(cacheKey);
        
        if (cached && Date.now() - cached.loadedAt < CACHE_TTL) {
            return cached.profile;
        }
        
        const profile = await STTProfile.getByTemplateId(templateId);
        
        if (profile) {
            profileCache.set(cacheKey, {
                profile,
                loadedAt: Date.now()
            });
        }
        
        return profile;
    }
    
    /**
     * Clear cached profile (call when profile is updated)
     * @param {ObjectId} templateId - Template ID
     */
    static clearCache(templateId) {
        profileCache.delete(templateId.toString());
    }
    
    /**
     * Strip filler words from transcript
     * Uses regex for O(n) performance
     * @param {string} transcript - Input transcript
     * @param {Array} fillers - Filler definitions from profile
     * @returns {Object} { cleaned, removed }
     */
    static stripFillers(transcript, fillers) {
        const removed = [];
        let cleaned = transcript;
        
        // Sort fillers by length (longest first) to handle multi-word fillers
        const sortedFillers = fillers
            .filter(f => f.enabled)
            .sort((a, b) => b.phrase.length - a.phrase.length);
        
        for (const filler of sortedFillers) {
            // Build regex that matches whole words/phrases
            const escaped = filler.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
            
            const matches = cleaned.match(regex);
            if (matches) {
                removed.push({
                    phrase: filler.phrase,
                    count: matches.length,
                    scope: filler.scope
                });
                cleaned = cleaned.replace(regex, ' ');
            }
        }
        
        return { cleaned, removed };
    }
    
    /**
     * Apply mishear corrections with context awareness
     * Uses sliding window for context checking
     * @param {string} transcript - Input transcript
     * @param {Array} corrections - Correction definitions from profile
     * @returns {Object} { cleaned, applied }
     */
    static applyCorrections(transcript, corrections) {
        const applied = [];
        let cleaned = transcript;
        const words = transcript.split(/\s+/);
        
        const enabledCorrections = corrections.filter(c => c.enabled);
        
        for (const correction of enabledCorrections) {
            // Check if "heard" word exists in transcript
            const escaped = correction.heard.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
            
            if (!regex.test(cleaned)) continue;
            
            // If context is specified, check sliding window
            if (correction.context && correction.context.length > 0) {
                const shouldApply = this.checkContextWindow(
                    words,
                    correction.heard,
                    correction.context,
                    correction.contextWindow || 5
                );
                
                if (!shouldApply) continue;
            }
            
            // Apply correction
            const beforeCount = (cleaned.match(regex) || []).length;
            cleaned = cleaned.replace(regex, correction.normalized);
            
            if (beforeCount > 0) {
                applied.push({
                    heard: correction.heard,
                    normalized: correction.normalized,
                    context: correction.context,
                    count: beforeCount
                });
            }
        }
        
        return { cleaned, applied };
    }
    
    /**
     * Check if context words appear within window of target word
     * @param {Array} words - All words in transcript
     * @param {string} targetWord - Word to check context for
     * @param {Array} contextWords - Required context words
     * @param {number} windowSize - Words to check on each side
     * @returns {boolean} Whether any context word is within window
     */
    static checkContextWindow(words, targetWord, contextWords, windowSize) {
        const targetIndices = [];
        
        // Find all indices of target word
        for (let i = 0; i < words.length; i++) {
            if (words[i].toLowerCase() === targetWord.toLowerCase()) {
                targetIndices.push(i);
            }
        }
        
        // For each occurrence, check if any context word is within window
        for (const targetIdx of targetIndices) {
            const windowStart = Math.max(0, targetIdx - windowSize);
            const windowEnd = Math.min(words.length - 1, targetIdx + windowSize);
            
            for (let i = windowStart; i <= windowEnd; i++) {
                if (i === targetIdx) continue;
                
                const windowWord = words[i].toLowerCase();
                if (contextWords.some(ctx => windowWord.includes(ctx.toLowerCase()))) {
                    return true;
                }
            }
        }
        
        return false;
    }
    
    /**
     * Detect impossible words in transcript
     * @param {string} transcript - Input transcript
     * @param {Array} impossibleWords - Impossible word definitions
     * @returns {Object} { detected, suggestions }
     */
    static detectImpossibleWords(transcript, impossibleWords) {
        const detected = [];
        const suggestions = [];
        const words = transcript.split(/\s+/);
        
        const enabledImpossible = impossibleWords.filter(iw => iw.enabled);
        
        for (const impossible of enabledImpossible) {
            const found = words.filter(w => w.toLowerCase() === impossible.word.toLowerCase());
            
            if (found.length > 0) {
                detected.push({
                    word: impossible.word,
                    reason: impossible.reason,
                    suggestedCorrection: impossible.suggestCorrection,
                    count: found.length
                });
                
                // Generate suggestion for auto-learning
                if (impossible.suggestCorrection) {
                    suggestions.push({
                        type: 'correction',
                        phrase: impossible.word,
                        suggestedCorrection: impossible.suggestCorrection,
                        confidenceScore: 0.7,
                        context: `Impossible word detected: ${impossible.reason || 'domain mismatch'}`
                    });
                }
            }
        }
        
        return { detected, suggestions };
    }
    
    /**
     * Detect unknown patterns that might need attention
     * @param {string} transcript - Cleaned transcript
     * @param {Object} profile - STT Profile
     * @returns {Array} Suggestions for new fillers/corrections
     */
    static detectUnknownPatterns(transcript, profile) {
        const suggestions = [];
        const words = transcript.split(/\s+/).filter(w => w.length > 1);
        
        // Build known vocabulary set
        const knownWords = new Set();
        
        // Add all filler phrases
        for (const filler of profile.fillers) {
            filler.phrase.split(/\s+/).forEach(w => knownWords.add(w.toLowerCase()));
        }
        
        // Add all boosted keywords
        for (const keyword of profile.vocabulary.boostedKeywords) {
            keyword.phrase.split(/\s+/).forEach(w => knownWords.add(w.toLowerCase()));
        }
        
        // Add all correction targets
        for (const correction of profile.corrections) {
            correction.normalized.split(/\s+/).forEach(w => knownWords.add(w.toLowerCase()));
        }
        
        // Common English words to ignore
        const commonWords = new Set([
            'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it', 'they', 'them',
            'a', 'an', 'the', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
            'may', 'might', 'must', 'can', 'need', 'want', 'get', 'got',
            'and', 'or', 'but', 'if', 'then', 'because', 'so', 'when', 'where', 'what', 'who',
            'to', 'of', 'in', 'on', 'at', 'for', 'with', 'by', 'from', 'about',
            'this', 'that', 'these', 'those', 'here', 'there',
            'not', 'no', 'yes', 'just', 'only', 'also', 'very', 'too', 'more',
            'how', 'why', 'all', 'any', 'some', 'most', 'other', 'such',
            'up', 'out', 'down', 'off', 'over', 'under', 'again', 'back',
            'now', 'then', 'today', 'tomorrow', 'yesterday',
            'one', 'two', 'three', 'first', 'second', 'last', 'new', 'old',
            'good', 'bad', 'great', 'long', 'little', 'big', 'small', 'high', 'low'
        ]);
        
        // Find words that aren't in known vocabulary or common words
        const unknownWords = words.filter(w => {
            const normalized = w.toLowerCase().replace(/[^a-z]/g, '');
            return normalized.length > 2 && 
                   !knownWords.has(normalized) && 
                   !commonWords.has(normalized);
        });
        
        // Suggest potential fillers (short repeated words)
        const wordCounts = {};
        for (const word of unknownWords) {
            const normalized = word.toLowerCase();
            wordCounts[normalized] = (wordCounts[normalized] || 0) + 1;
        }
        
        for (const [word, count] of Object.entries(wordCounts)) {
            if (count >= 2 && word.length <= 6) {
                suggestions.push({
                    type: 'filler',
                    phrase: word,
                    confidenceScore: Math.min(0.3 + (count * 0.1), 0.8),
                    context: `Appeared ${count} times in single transcript`
                });
            }
        }
        
        return suggestions;
    }
    
    /**
     * Normalize whitespace in transcript
     * @param {string} transcript - Input transcript
     * @returns {string} Normalized transcript
     */
    static normalizeWhitespace(transcript) {
        return transcript
            .replace(/\s+/g, ' ')
            .trim();
    }
    
    /**
     * Log transformation results to Black Box
     * @param {string} callId - Call ID
     * @param {string} companyId - Company ID
     * @param {Object} result - Processing result
     * @param {Object} profile - STT Profile used
     */
    static logToBlackBox(callId, companyId, result, profile) {
        try {
            BlackBoxLogger.logEvent({
                callId,
                companyId,
                type: 'STT_PREPROCESSING',
                data: {
                    templateId: profile.templateId,
                    templateName: profile.templateName,
                    raw: result.raw.substring(0, 200),
                    cleaned: result.cleaned.substring(0, 200),
                    fillersRemoved: result.transformations.fillersRemoved,
                    correctionsApplied: result.transformations.correctionsApplied,
                    impossibleWordsDetected: result.transformations.impossibleWordsDetected,
                    metrics: result.metrics,
                    suggestionsGenerated: result.suggestions.length
                }
            });
        } catch (error) {
            logger.debug('[STT PREPROCESSOR] Failed to log to Black Box', { error: error.message });
        }
    }
    
    /**
     * Update profile metrics (async background task)
     * @param {ObjectId} profileId - Profile ID
     * @param {Object} metrics - Metrics to increment
     */
    static async updateProfileMetrics(profileId, metrics) {
        await STTProfile.updateOne(
            { _id: profileId },
            {
                $inc: {
                    'metrics.totalCallsProcessed': 1,
                    'metrics.fillersStripped': metrics.fillerCount || 0,
                    'metrics.correctionsApplied': metrics.correctionCount || 0,
                    'metrics.impossibleWordsBlocked': metrics.impossibleCount || 0
                },
                $set: {
                    'metrics.lastProcessedAt': new Date()
                }
            }
        );
    }
    
    /**
     * Add suggestion to profile from runtime detection
     * @param {ObjectId} templateId - Template ID
     * @param {Object} suggestion - Suggestion to add
     * @param {string} callId - Call ID for tracking
     */
    static async addSuggestion(templateId, suggestion, callId) {
        try {
            const profile = await STTProfile.findOne({ templateId, isActive: true });
            if (!profile) return;
            
            profile.addSuggestion({
                ...suggestion,
                lastSeenCallId: callId
            });
            
            await profile.save();
            
            logger.debug('[STT PREPROCESSOR] Added suggestion to profile', {
                templateId,
                suggestionType: suggestion.type,
                phrase: suggestion.phrase
            });
        } catch (error) {
            logger.debug('[STT PREPROCESSOR] Failed to add suggestion', { error: error.message });
        }
    }
}

module.exports = STTPreprocessor;
