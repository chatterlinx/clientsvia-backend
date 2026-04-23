/**
 * DeepgramService.js - Deepgram Speech-to-Text Integration
 * 
 * Enterprise-grade STT with superior accuracy for phone calls.
 * Integrates with Twilio Media Streams for real-time transcription.
 * 
 * PRICING: ~$0.0043/minute (pay-as-you-go)
 * ACCURACY: 90%+ for phone calls (vs Twilio's ~80%)
 * 
 * @module services/stt/DeepgramService
 * @version 1.0.0
 */

const logger = require('../../utils/logger');

// Lazy-load Deepgram SDK to avoid errors if not installed
let Deepgram = null;
let deepgramClient = null;

class DeepgramService {
    
    /**
     * Initialize Deepgram client
     * @returns {boolean} Success status
     */
    static async initialize() {
        if (deepgramClient) return true;
        
        const apiKey = process.env.DEEPGRAM_API_KEY;
        if (!apiKey) {
            logger.warn('[DEEPGRAM] DEEPGRAM_API_KEY not configured - service disabled');
            return false;
        }
        
        try {
            // Dynamic import to avoid crash if package not installed
            const { createClient } = require('@deepgram/sdk');
            deepgramClient = createClient(apiKey);
            logger.info('[DEEPGRAM] ✅ Client initialized successfully');
            return true;
        } catch (error) {
            logger.warn('[DEEPGRAM] SDK not installed or initialization failed:', error.message);
            return false;
        }
    }
    
    /**
     * Check if Deepgram is available and configured
     * @returns {boolean} Availability status
     */
    static isAvailable() {
        return !!process.env.DEEPGRAM_API_KEY;
    }
    
    /**
     * Transcribe audio from URL (post-call or recorded)
     * @param {string} audioUrl - URL to audio file (mp3, wav, etc.)
     * @param {Object} options - Transcription options
     * @returns {Object} Transcription result
     */
    static async transcribeUrl(audioUrl, options = {}) {
        if (!await this.initialize()) {
            throw new Error('Deepgram not initialized');
        }

        if (!options.model) {
            throw new Error('[DEEPGRAM] transcribeUrl requires explicit options.model (resolve via ConfigResolver)');
        }

        const startTime = Date.now();

        try {
            const sdkOpts = {
                model: options.model,
                language: options.language || 'en-US',
                smart_format: true,
                punctuate: true,
                diarize: options.diarize || false,
                utterances: options.utterances || false,
                keywords: options.keywords || []
            };
            if (options.tier) sdkOpts.tier = options.tier;
            if (options.version) sdkOpts.version = options.version;

            const { result, error } = await deepgramClient.listen.prerecorded.transcribeUrl(
                { url: audioUrl },
                sdkOpts
            );
            
            if (error) {
                throw new Error(error.message);
            }
            
            const transcript = result.results?.channels?.[0]?.alternatives?.[0];
            const processingTime = Date.now() - startTime;
            
            logger.info('[DEEPGRAM] Transcription complete', {
                duration: result.metadata?.duration,
                processingTimeMs: processingTime,
                confidence: transcript?.confidence,
                wordCount: transcript?.words?.length
            });
            
            return {
                success: true,
                transcript: transcript?.transcript || '',
                confidence: transcript?.confidence || 0,
                words: transcript?.words || [],
                duration: result.metadata?.duration,
                processingTimeMs: processingTime
            };
            
        } catch (error) {
            logger.error('[DEEPGRAM] Transcription failed:', error);
            return {
                success: false,
                error: error.message,
                processingTimeMs: Date.now() - startTime
            };
        }
    }
    
    /**
     * Transcribe raw audio buffer
     * @param {Buffer} audioBuffer - Raw audio data
     * @param {string} mimetype - Audio mimetype (audio/wav, audio/mp3, etc.)
     * @param {Object} options - Transcription options
     * @returns {Object} Transcription result
     */
    static async transcribeBuffer(audioBuffer, mimetype = 'audio/wav', options = {}) {
        if (!await this.initialize()) {
            throw new Error('Deepgram not initialized');
        }

        if (!options.model) {
            throw new Error('[DEEPGRAM] transcribeBuffer requires explicit options.model (resolve via ConfigResolver)');
        }

        const startTime = Date.now();

        try {
            const { result, error } = await deepgramClient.listen.prerecorded.transcribeFile(
                audioBuffer,
                {
                    model: options.model,
                    language: options.language || 'en-US',
                    smart_format: true,
                    punctuate: true,
                    keywords: options.keywords || [],
                    mimetype
                }
            );
            
            if (error) {
                throw new Error(error.message);
            }
            
            const transcript = result.results?.channels?.[0]?.alternatives?.[0];
            
            return {
                success: true,
                transcript: transcript?.transcript || '',
                confidence: transcript?.confidence || 0,
                words: transcript?.words || [],
                processingTimeMs: Date.now() - startTime
            };
            
        } catch (error) {
            logger.error('[DEEPGRAM] Buffer transcription failed:', error);
            return {
                success: false,
                error: error.message,
                processingTimeMs: Date.now() - startTime
            };
        }
    }
    
    /**
     * Get live transcription WebSocket connection config
     * For use with Twilio Media Streams (and Test Console ASR).
     *
     * PLATFORM RULE: This function is vocabulary-agnostic and trade-agnostic.
     * Callers MUST pass `opts.model` and (optionally) `opts.keywords` sourced
     * from per-company settings + platform globals via VocabularyResolver /
     * ConfigResolver. No hardcoded trade terms live here.
     *
     * @param {Object} options - Connection options
     * @param {string} options.model - REQUIRED. Deepgram model id (e.g. 'nova-3', 'nova-2', 'nova-2-phonecall').
     * @param {string} [options.language='en-US']
     * @param {string} [options.endpointing='800'] - ms
     * @param {string} [options.encoding='mulaw']
     * @param {string} [options.sample_rate='8000']
     * @param {string} [options.channels='1']
     * @param {string[]} [options.keywords=[]] - Deepgram keyword format 'phrase:boost' or plain phrases.
     * @param {string} [options.version='latest']
     * @param {string} [options.tier] - optional tier string if caller specifies.
     * @returns {Object} WebSocket configuration
     */
    static getLiveConnectionConfig(options = {}) {
        const apiKey = process.env.DEEPGRAM_API_KEY;
        if (!apiKey) {
            throw new Error('DEEPGRAM_API_KEY not configured');
        }

        if (!options.model) {
            throw new Error('[DEEPGRAM] getLiveConnectionConfig requires explicit options.model (resolve via ConfigResolver)');
        }

        // Build query params for Deepgram live endpoint
        const params = new URLSearchParams({
            model: options.model,
            language: options.language || 'en-US',
            smart_format: 'true',
            punctuate: 'true',
            interim_results: 'true',
            endpointing: options.endpointing || '800',  // 800ms = natural conversation pauses
            vad_events: 'true',
            // Phone call defaults (mulaw 8k mono) — callers may override
            encoding: options.encoding || 'mulaw',
            sample_rate: options.sample_rate || '8000',
            channels: options.channels || '1'
        });

        if (options.version) params.set('version', options.version);
        if (options.tier) params.set('tier', options.tier);

        // Keywords are pass-through only. Caller resolves vocabulary from
        // company.aiAgentSettings + AdminSettings.globalHub via VocabularyResolver.
        const keywordsToUse = Array.isArray(options.keywords) ? options.keywords : [];
        for (const kw of keywordsToUse) {
            if (kw) params.append('keywords', String(kw));
        }

        return {
            url: `wss://api.deepgram.com/v1/listen?${params.toString()}`,
            headers: {
                'Authorization': `Token ${apiKey}`
            },
            // For Twilio Media Streams integration
            twilioFormat: {
                encoding: 'audio/x-mulaw',
                sampleRate: 8000
            }
        };
    }
    
    /**
     * Build keywords array from STTProfile vocabulary
     * @param {Object} sttProfile - STT Profile with vocabulary
     * @returns {string[]} Keywords for Deepgram
     */
    static buildKeywordsFromProfile(sttProfile) {
        if (!sttProfile?.vocabulary?.boostedKeywords) {
            return [];
        }
        
        return sttProfile.vocabulary.boostedKeywords
            .filter(k => k.enabled)
            .sort((a, b) => (b.boostWeight || 5) - (a.boostWeight || 5))
            .slice(0, 100) // Deepgram limit
            .map(k => k.phrase);
    }
    
    /**
     * Health check for Deepgram service
     * @returns {Object} Health status
     */
    static async healthCheck() {
        const hasApiKey = !!process.env.DEEPGRAM_API_KEY;
        
        if (!hasApiKey) {
            return {
                status: 'unconfigured',
                message: 'DEEPGRAM_API_KEY not set',
                configured: false
            };
        }
        
        try {
            const initialized = await this.initialize();
            if (!initialized) {
                return {
                    status: 'error',
                    message: 'Failed to initialize Deepgram client',
                    configured: true
                };
            }
            
            // Try to get projects to verify API key works
            const { result, error } = await deepgramClient.manage.getProjects();
            
            if (error) {
                return {
                    status: 'error',
                    message: error.message,
                    configured: true
                };
            }
            
            return {
                status: 'healthy',
                message: 'Deepgram API connected',
                configured: true,
                projects: result?.projects?.length || 0
            };
            
        } catch (error) {
            return {
                status: 'error',
                message: error.message,
                configured: true
            };
        }
    }
}

module.exports = DeepgramService;

