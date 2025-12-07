/**
 * STTComparisonService.js - Compare STT Providers for Quality Analysis
 * 
 * Re-transcribes call recordings with Deepgram to compare against
 * Twilio's original transcription. Helps determine if Deepgram upgrade
 * is worth the cost.
 * 
 * Features:
 * - Re-transcribe recordings with Deepgram
 * - Word-level accuracy comparison
 * - Confidence scoring
 * - Cost estimation
 * 
 * @module services/stt/STTComparisonService
 * @version 1.0.0
 */

const logger = require('../../utils/logger');
const DeepgramService = require('./DeepgramService');
const BlackBoxRecording = require('../../models/BlackBoxRecording');

class STTComparisonService {
    
    /**
     * Compare transcription quality between Twilio and Deepgram
     * @param {string} callId - Call ID from Black Box
     * @param {string} companyId - Company ID
     * @returns {Object} Comparison results
     */
    static async compareTranscriptions(callId, companyId) {
        const startTime = Date.now();
        
        try {
            // 1. Get original Black Box recording
            const recording = await BlackBoxRecording.findOne({ callId, companyId }).lean();
            
            if (!recording) {
                return {
                    success: false,
                    error: 'Recording not found',
                    callId
                };
            }
            
            // 2. Get original Twilio transcripts from events
            const twilioTranscripts = this.extractTwilioTranscripts(recording);
            
            if (twilioTranscripts.length === 0) {
                return {
                    success: false,
                    error: 'No transcripts found in recording',
                    callId
                };
            }
            
            // 3. Check if we have a recording URL
            const recordingUrl = recording.metadata?.recordingUrl || 
                                recording.events?.find(e => e.data?.recordingUrl)?.data?.recordingUrl;
            
            let deepgramResult = null;
            let deepgramAvailable = false;
            
            // 4. If Deepgram is available and we have audio, re-transcribe
            if (DeepgramService.isAvailable() && recordingUrl) {
                deepgramAvailable = true;
                try {
                    deepgramResult = await DeepgramService.transcribeUrl(recordingUrl, {
                        language: 'en-US',
                        model: 'nova-2',
                        punctuate: true,
                        diarize: false
                    });
                } catch (dgError) {
                    logger.warn('[STT COMPARISON] Deepgram transcription failed:', dgError.message);
                    deepgramResult = { success: false, error: dgError.message };
                }
            }
            
            // 5. Calculate comparison metrics
            const comparison = this.calculateComparison(twilioTranscripts, deepgramResult);
            
            // 6. Build result
            const result = {
                success: true,
                callId,
                companyId,
                analyzedAt: new Date().toISOString(),
                processingTimeMs: Date.now() - startTime,
                
                // Original Twilio data
                twilio: {
                    totalTurns: twilioTranscripts.length,
                    totalWords: twilioTranscripts.reduce((sum, t) => sum + (t.text?.split(' ').length || 0), 0),
                    averageConfidence: this.averageConfidence(twilioTranscripts),
                    lowConfidenceTurns: twilioTranscripts.filter(t => (t.confidence || 0) < 0.7).length,
                    transcripts: twilioTranscripts
                },
                
                // Deepgram re-analysis (if available)
                deepgram: deepgramAvailable ? {
                    available: true,
                    success: deepgramResult?.success || false,
                    transcript: deepgramResult?.transcript || null,
                    confidence: deepgramResult?.confidence || 0,
                    wordCount: deepgramResult?.words?.length || 0,
                    processingTimeMs: deepgramResult?.processingTimeMs || 0,
                    error: deepgramResult?.error || null
                } : {
                    available: false,
                    message: !DeepgramService.isAvailable() 
                        ? 'DEEPGRAM_API_KEY not configured' 
                        : 'No recording URL available'
                },
                
                // Comparison metrics
                comparison: comparison,
                
                // Recommendations
                recommendation: this.generateRecommendation(twilioTranscripts, deepgramResult),
                
                // 🎯 VOCABULARY SUGGESTIONS - The training gold!
                vocabularySuggestions: this.generateVocabularySuggestions(
                    twilioTranscripts, 
                    deepgramResult
                )
            };
            
            logger.info('[STT COMPARISON] Analysis complete', {
                callId,
                twilioTurns: result.twilio.totalTurns,
                twilioAvgConfidence: result.twilio.averageConfidence,
                deepgramAvailable: deepgramAvailable,
                deepgramSuccess: deepgramResult?.success
            });
            
            return result;
            
        } catch (error) {
            logger.error('[STT COMPARISON] Analysis failed:', error);
            return {
                success: false,
                error: error.message,
                callId,
                processingTimeMs: Date.now() - startTime
            };
        }
    }
    
    /**
     * Extract Twilio transcripts from Black Box events
     */
    static extractTwilioTranscripts(recording) {
        const transcripts = [];
        
        // From events
        if (recording.events) {
            recording.events.forEach(event => {
                if (event.type === 'GATHER_FINAL' && event.data?.speechResult) {
                    transcripts.push({
                        turn: event.turn || transcripts.length + 1,
                        text: event.data.speechResult,
                        confidence: event.data.confidence || 0,
                        timestamp: event.ts
                    });
                }
            });
        }
        
        // From transcript array
        if (recording.transcript?.callerTurns) {
            recording.transcript.callerTurns.forEach(turn => {
                if (!transcripts.find(t => t.turn === turn.turn)) {
                    transcripts.push({
                        turn: turn.turn,
                        text: turn.text,
                        confidence: turn.confidence || 0,
                        timestamp: turn.t
                    });
                }
            });
        }
        
        return transcripts.sort((a, b) => (a.turn || 0) - (b.turn || 0));
    }
    
    /**
     * Calculate average confidence
     */
    static averageConfidence(transcripts) {
        if (transcripts.length === 0) return 0;
        const sum = transcripts.reduce((acc, t) => acc + (t.confidence || 0), 0);
        return Math.round((sum / transcripts.length) * 100) / 100;
    }
    
    /**
     * Calculate comparison metrics between Twilio and Deepgram
     */
    static calculateComparison(twilioTranscripts, deepgramResult) {
        if (!deepgramResult?.success || !deepgramResult?.transcript) {
            return {
                available: false,
                reason: 'Deepgram transcription not available'
            };
        }
        
        // Combine all Twilio text
        const twilioFull = twilioTranscripts.map(t => t.text).join(' ').toLowerCase();
        const deepgramFull = (deepgramResult.transcript || '').toLowerCase();
        
        // Word-level comparison
        const twilioWords = twilioFull.split(/\s+/).filter(w => w.length > 0);
        const deepgramWords = deepgramFull.split(/\s+/).filter(w => w.length > 0);
        
        // Find matching words
        const matchingWords = twilioWords.filter(w => deepgramWords.includes(w));
        
        // Calculate similarity
        const twilioLength = twilioWords.length;
        const deepgramLength = deepgramWords.length;
        const matchCount = matchingWords.length;
        
        const similarity = twilioLength > 0 
            ? Math.round((matchCount / Math.max(twilioLength, deepgramLength)) * 100) 
            : 0;
        
        // Find differences
        const onlyInTwilio = twilioWords.filter(w => !deepgramWords.includes(w));
        const onlyInDeepgram = deepgramWords.filter(w => !twilioWords.includes(w));
        
        return {
            available: true,
            similarity: similarity,
            twilioWordCount: twilioLength,
            deepgramWordCount: deepgramLength,
            matchingWords: matchCount,
            
            // Confidence comparison
            twilioAvgConfidence: Math.round(this.averageConfidence(twilioTranscripts) * 100),
            deepgramConfidence: Math.round((deepgramResult.confidence || 0) * 100),
            
            // Differences
            differences: {
                onlyInTwilio: onlyInTwilio.slice(0, 20), // Limit for display
                onlyInDeepgram: onlyInDeepgram.slice(0, 20),
                totalDifferences: onlyInTwilio.length + onlyInDeepgram.length
            },
            
            // Side-by-side
            sideBySide: {
                twilio: twilioFull.substring(0, 500),
                deepgram: deepgramFull.substring(0, 500)
            }
        };
    }
    
    /**
     * Generate recommendation based on comparison
     */
    static generateRecommendation(twilioTranscripts, deepgramResult) {
        const avgConfidence = this.averageConfidence(twilioTranscripts);
        const lowConfCount = twilioTranscripts.filter(t => (t.confidence || 0) < 0.7).length;
        const totalTurns = twilioTranscripts.length;
        
        // No Deepgram available
        if (!deepgramResult?.success) {
            if (avgConfidence >= 0.85) {
                return {
                    verdict: 'TWILIO_SUFFICIENT',
                    icon: '✅',
                    message: 'Twilio accuracy looks good! Average confidence is high.',
                    details: `${Math.round(avgConfidence * 100)}% average confidence across ${totalTurns} turns.`,
                    action: 'Your current STT setup appears sufficient. Deepgram may not provide significant improvement.'
                };
            } else if (avgConfidence >= 0.7) {
                return {
                    verdict: 'CONSIDER_DEEPGRAM',
                    icon: '🤔',
                    message: 'Twilio accuracy is moderate. Deepgram might help.',
                    details: `${Math.round(avgConfidence * 100)}% average confidence. ${lowConfCount}/${totalTurns} turns had low confidence.`,
                    action: 'Configure DEEPGRAM_API_KEY to run a comparison and see potential improvement.'
                };
            } else {
                return {
                    verdict: 'RECOMMEND_DEEPGRAM',
                    icon: '⚠️',
                    message: 'Twilio accuracy is low. Deepgram recommended.',
                    details: `Only ${Math.round(avgConfidence * 100)}% average confidence. ${lowConfCount}/${totalTurns} turns had low confidence.`,
                    action: 'Configure DEEPGRAM_API_KEY to significantly improve transcription accuracy.'
                };
            }
        }
        
        // Have Deepgram comparison
        const dgConfidence = deepgramResult.confidence || 0;
        const confidenceDiff = dgConfidence - avgConfidence;
        
        if (confidenceDiff > 0.15) {
            return {
                verdict: 'DEEPGRAM_BETTER',
                icon: '🎯',
                message: 'Deepgram shows significant improvement!',
                details: `Deepgram: ${Math.round(dgConfidence * 100)}% vs Twilio: ${Math.round(avgConfidence * 100)}% (+${Math.round(confidenceDiff * 100)}%)`,
                action: 'Consider enabling Deepgram for live calls. Cost: ~$0.004/min.',
                costEstimate: this.estimateCost(twilioTranscripts)
            };
        } else if (confidenceDiff > 0.05) {
            return {
                verdict: 'DEEPGRAM_SLIGHTLY_BETTER',
                icon: '📊',
                message: 'Deepgram shows moderate improvement.',
                details: `Deepgram: ${Math.round(dgConfidence * 100)}% vs Twilio: ${Math.round(avgConfidence * 100)}% (+${Math.round(confidenceDiff * 100)}%)`,
                action: 'Deepgram offers some improvement. Evaluate if cost is justified for your volume.',
                costEstimate: this.estimateCost(twilioTranscripts)
            };
        } else {
            return {
                verdict: 'TWILIO_COMPARABLE',
                icon: '✅',
                message: 'Twilio is comparable to Deepgram!',
                details: `Deepgram: ${Math.round(dgConfidence * 100)}% vs Twilio: ${Math.round(avgConfidence * 100)}%`,
                action: 'Your current STT setup is working well. No need for Deepgram upgrade.',
                costSavings: 'Saving ~$0.004/min by staying with Twilio'
            };
        }
    }
    
    /**
     * Estimate Deepgram cost for this call
     */
    static estimateCost(twilioTranscripts) {
        // Estimate call duration based on transcript length
        // Average speaking rate: ~150 words per minute
        const totalWords = twilioTranscripts.reduce((sum, t) => sum + (t.text?.split(' ').length || 0), 0);
        const estimatedMinutes = Math.max(1, totalWords / 150);
        const cost = estimatedMinutes * 0.0043;
        
        return {
            estimatedMinutes: Math.round(estimatedMinutes * 10) / 10,
            costPerCall: `$${cost.toFixed(4)}`,
            costPer1000Calls: `$${(cost * 1000).toFixed(2)}`
        };
    }
    
    /**
     * Generate vocabulary suggestions from comparison
     * This is the GOLD - use Deepgram to train your Twilio setup!
     */
    static generateVocabularySuggestions(twilioTranscripts, deepgramResult, existingProfile = null) {
        const suggestions = {
            corrections: [],      // Misheard word mappings
            keywords: [],         // Words to boost in STT
            fillers: [],          // Noise words to strip
            impossibleWords: []   // Words that shouldn't appear
        };
        
        if (!deepgramResult?.success || !deepgramResult?.transcript) {
            return { available: false, reason: 'Deepgram comparison needed' };
        }
        
        // Get existing items to avoid duplicates
        const existingCorrections = new Set(
            (existingProfile?.corrections || []).map(c => c.heard.toLowerCase())
        );
        const existingKeywords = new Set(
            (existingProfile?.vocabulary?.boostedKeywords || []).map(k => k.phrase.toLowerCase())
        );
        const existingFillers = new Set(
            (existingProfile?.fillers || []).map(f => f.phrase.toLowerCase())
        );
        
        // Parse both transcripts
        const twilioFull = twilioTranscripts.map(t => t.text).join(' ').toLowerCase();
        const deepgramFull = (deepgramResult.transcript || '').toLowerCase();
        
        const twilioWords = twilioFull.split(/\s+/).filter(w => w.length > 1);
        const deepgramWords = deepgramFull.split(/\s+/).filter(w => w.length > 1);
        
        // Find words only in Deepgram (Twilio missed these)
        const missedByTwilio = deepgramWords.filter(w => !twilioWords.includes(w));
        
        // Find words only in Twilio (possible mishears)
        const onlyInTwilio = twilioWords.filter(w => !deepgramWords.includes(w));
        
        // === CORRECTION SUGGESTIONS ===
        // Look for similar words that might be mishears
        for (const twilioWord of onlyInTwilio) {
            for (const deepgramWord of missedByTwilio) {
                // Check for phonetic similarity (simple Levenshtein-ish check)
                if (this.areSimilar(twilioWord, deepgramWord) && !existingCorrections.has(twilioWord)) {
                    suggestions.corrections.push({
                        heard: twilioWord,
                        shouldBe: deepgramWord,
                        confidence: this.calculateSimilarity(twilioWord, deepgramWord),
                        context: this.extractContext(twilioFull, twilioWord),
                        reason: `Twilio heard "${twilioWord}" but Deepgram heard "${deepgramWord}"`
                    });
                }
            }
        }
        
        // === KEYWORD SUGGESTIONS ===
        // Technical/domain words that Deepgram caught
        const technicalPatterns = [
            /hvac|furnace|thermostat|compressor|condenser|refrigerant|freon|coil|ductwork/i,
            /plumb|pipe|drain|leak|faucet|valve|water heater|sewer/i,
            /electric|outlet|circuit|breaker|panel|wire|voltage/i,
            /appointment|schedule|service|repair|maintenance|emergency|technician/i
        ];
        
        for (const word of missedByTwilio) {
            const isTechnical = technicalPatterns.some(p => p.test(word));
            if (isTechnical && !existingKeywords.has(word)) {
                suggestions.keywords.push({
                    phrase: word,
                    reason: 'Technical term Deepgram caught that Twilio missed',
                    boostWeight: 7
                });
            }
        }
        
        // Also suggest words that appeared with low confidence in Twilio
        for (const turn of twilioTranscripts) {
            if ((turn.confidence || 0) < 0.7) {
                const words = (turn.text || '').toLowerCase().split(/\s+/);
                for (const word of words) {
                    if (word.length > 3 && !existingKeywords.has(word) && 
                        !suggestions.keywords.find(k => k.phrase === word)) {
                        const isTechnical = technicalPatterns.some(p => p.test(word));
                        if (isTechnical) {
                            suggestions.keywords.push({
                                phrase: word,
                                reason: 'Low confidence turn - boost this keyword',
                                boostWeight: 6
                            });
                        }
                    }
                }
            }
        }
        
        // === FILLER SUGGESTIONS ===
        // Common filler words that appear frequently
        const commonFillers = ['um', 'uh', 'like', 'you know', 'so', 'well', 'basically', 
                              'actually', 'i mean', 'kind of', 'sort of', 'right', 'okay so'];
        
        for (const filler of commonFillers) {
            const count = (twilioFull.match(new RegExp(`\\b${filler}\\b`, 'gi')) || []).length;
            if (count >= 2 && !existingFillers.has(filler)) {
                suggestions.fillers.push({
                    phrase: filler,
                    occurrences: count,
                    reason: `Appeared ${count} times - likely filler noise`
                });
            }
        }
        
        // === IMPOSSIBLE WORD DETECTION ===
        // Words that don't make sense in context
        // (e.g., medical terms in HVAC calls)
        const impossiblePatterns = {
            hvac: /toothache|dentist|doctor|prescription|medication|surgery/i,
            plumbing: /dentist|prescription|medication/i,
            electrical: /dentist|plumber|hvac/i
        };
        
        // Detect template type from keywords
        const templateType = this.detectTemplateType(deepgramWords);
        if (templateType && impossiblePatterns[templateType]) {
            for (const word of twilioWords) {
                if (impossiblePatterns[templateType].test(word)) {
                    suggestions.impossibleWords.push({
                        word: word,
                        reason: `"${word}" doesn't belong in ${templateType} context - likely STT error`
                    });
                }
            }
        }
        
        // Sort by confidence/relevance
        suggestions.corrections.sort((a, b) => b.confidence - a.confidence);
        suggestions.keywords.sort((a, b) => b.boostWeight - a.boostWeight);
        suggestions.fillers.sort((a, b) => b.occurrences - a.occurrences);
        
        // Limit results
        return {
            available: true,
            corrections: suggestions.corrections.slice(0, 10),
            keywords: suggestions.keywords.slice(0, 15),
            fillers: suggestions.fillers.slice(0, 10),
            impossibleWords: suggestions.impossibleWords.slice(0, 5),
            summary: {
                totalSuggestions: suggestions.corrections.length + suggestions.keywords.length + 
                                 suggestions.fillers.length + suggestions.impossibleWords.length,
                correctionCount: suggestions.corrections.length,
                keywordCount: suggestions.keywords.length,
                fillerCount: suggestions.fillers.length,
                impossibleCount: suggestions.impossibleWords.length
            },
            copyReady: this.generateCopyReadyOutput(suggestions)
        };
    }
    
    /**
     * Check if two words are phonetically similar
     */
    static areSimilar(word1, word2) {
        if (Math.abs(word1.length - word2.length) > 3) return false;
        
        const similarity = this.calculateSimilarity(word1, word2);
        return similarity > 0.5;
    }
    
    /**
     * Calculate similarity between two words (0-1)
     */
    static calculateSimilarity(word1, word2) {
        const len1 = word1.length;
        const len2 = word2.length;
        const maxLen = Math.max(len1, len2);
        
        if (maxLen === 0) return 1;
        
        // Simple character overlap
        let matches = 0;
        for (const char of word1) {
            if (word2.includes(char)) matches++;
        }
        
        return matches / maxLen;
    }
    
    /**
     * Extract context around a word
     */
    static extractContext(text, word) {
        const index = text.toLowerCase().indexOf(word.toLowerCase());
        if (index === -1) return '';
        
        const start = Math.max(0, index - 30);
        const end = Math.min(text.length, index + word.length + 30);
        
        return '...' + text.substring(start, end) + '...';
    }
    
    /**
     * Detect template type from words
     */
    static detectTemplateType(words) {
        const wordSet = new Set(words.map(w => w.toLowerCase()));
        
        const hvacWords = ['hvac', 'ac', 'furnace', 'heating', 'cooling', 'thermostat', 'air'];
        const plumbingWords = ['plumbing', 'pipe', 'drain', 'water', 'leak', 'faucet'];
        const electricalWords = ['electrical', 'outlet', 'circuit', 'power', 'wire'];
        
        const hvacScore = hvacWords.filter(w => wordSet.has(w)).length;
        const plumbingScore = plumbingWords.filter(w => wordSet.has(w)).length;
        const electricalScore = electricalWords.filter(w => wordSet.has(w)).length;
        
        if (hvacScore > plumbingScore && hvacScore > electricalScore) return 'hvac';
        if (plumbingScore > hvacScore && plumbingScore > electricalScore) return 'plumbing';
        if (electricalScore > hvacScore && electricalScore > plumbingScore) return 'electrical';
        
        return null;
    }
    
    /**
     * Generate copy-ready output for easy addition to STT Profile
     */
    static generateCopyReadyOutput(suggestions) {
        const output = {
            corrections: suggestions.corrections.map(c => ({
                heard: c.heard,
                normalized: c.shouldBe,
                context: [],
                enabled: true
            })),
            keywords: suggestions.keywords.map(k => ({
                phrase: k.phrase,
                type: 'manual',
                source: 'Deepgram Analysis',
                boostWeight: k.boostWeight,
                enabled: true
            })),
            fillers: suggestions.fillers.map(f => ({
                phrase: f.phrase,
                scope: 'template',
                enabled: true,
                addedBy: 'deepgram_analysis'
            }))
        };
        
        return output;
    }

    /**
     * Batch analyze multiple calls
     */
    static async analyzeMultiple(callIds, companyId) {
        const results = [];
        
        for (const callId of callIds) {
            const result = await this.compareTranscriptions(callId, companyId);
            results.push(result);
            
            // Small delay to avoid rate limiting
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        // Calculate aggregate stats
        const successful = results.filter(r => r.success);
        const avgTwilioConfidence = successful.length > 0
            ? successful.reduce((sum, r) => sum + (r.twilio?.averageConfidence || 0), 0) / successful.length
            : 0;
        
        return {
            success: true,
            totalAnalyzed: results.length,
            successfulAnalyses: successful.length,
            aggregateStats: {
                averageTwilioConfidence: Math.round(avgTwilioConfidence * 100),
                callsWithLowConfidence: successful.filter(r => (r.twilio?.averageConfidence || 0) < 0.7).length
            },
            results
        };
    }
}

module.exports = STTComparisonService;

