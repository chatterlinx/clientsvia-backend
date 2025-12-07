/**
 * STTProviderFactory.js - Speech-to-Text Provider Router
 * 
 * Factory pattern for switching between STT providers based on STTProfile settings.
 * Supports: Twilio (default), Deepgram (premium), Google (enterprise)
 * 
 * @module services/stt/STTProviderFactory
 * @version 1.0.0
 */

const logger = require('../../utils/logger');
const DeepgramService = require('./DeepgramService');

class STTProviderFactory {
    
    /**
     * Get the appropriate STT provider based on profile settings
     * @param {Object} sttProfile - STT Profile with provider configuration
     * @returns {Object} Provider service and configuration
     */
    static getProvider(sttProfile) {
        const providerType = sttProfile?.provider?.type || 'twilio';
        
        switch (providerType) {
            case 'deepgram':
                return this.getDeepgramProvider(sttProfile);
            case 'google':
                return this.getGoogleProvider(sttProfile);
            case 'twilio':
            default:
                return this.getTwilioProvider(sttProfile);
        }
    }
    
    /**
     * Get Twilio STT configuration (default)
     * Uses Twilio's built-in <Gather> speech recognition
     */
    static getTwilioProvider(sttProfile) {
        const hints = this.buildTwilioHints(sttProfile);
        
        return {
            type: 'twilio',
            service: null, // Twilio STT is built into <Gather>
            config: {
                speechModel: sttProfile?.provider?.model || 'phone_call',
                language: sttProfile?.provider?.language || 'en-US',
                enhanced: true,
                hints: hints
            },
            // Twilio uses hints in <Gather>, not separate transcription
            useBuiltInGather: true,
            cost: 'FREE (included with Twilio Voice)',
            accuracy: '~80%'
        };
    }
    
    /**
     * Get Deepgram STT configuration (premium)
     * Uses Deepgram's Nova-2 model for superior accuracy
     */
    static getDeepgramProvider(sttProfile) {
        if (!DeepgramService.isAvailable()) {
            logger.warn('[STT FACTORY] Deepgram requested but not configured, falling back to Twilio');
            return this.getTwilioProvider(sttProfile);
        }
        
        const keywords = DeepgramService.buildKeywordsFromProfile(sttProfile);
        
        return {
            type: 'deepgram',
            service: DeepgramService,
            config: {
                model: 'nova-2',
                language: sttProfile?.provider?.language || 'en-US',
                keywords: keywords,
                // Live transcription config for Media Streams
                liveConfig: DeepgramService.getLiveConnectionConfig({
                    language: sttProfile?.provider?.language || 'en-US',
                    keywords: keywords
                })
            },
            useBuiltInGather: false, // Use Media Streams instead
            cost: '~$0.0043/min',
            accuracy: '~95%'
        };
    }
    
    /**
     * Get Google STT configuration (enterprise)
     * Placeholder for future Google Cloud Speech integration
     */
    static getGoogleProvider(sttProfile) {
        logger.warn('[STT FACTORY] Google STT not yet implemented, falling back to Twilio');
        return this.getTwilioProvider(sttProfile);
    }
    
    /**
     * Build Twilio hints string from STT Profile
     * @param {Object} sttProfile - STT Profile with vocabulary
     * @returns {string} Comma-separated hints (max 500 phrases, 10KB)
     */
    static buildTwilioHints(sttProfile) {
        const keywords = sttProfile?.vocabulary?.boostedKeywords || [];
        const fillers = sttProfile?.fillers || [];
        
        // Get enabled keywords sorted by boost weight
        const boostKeywords = keywords
            .filter(k => k.enabled)
            .sort((a, b) => (b.boostWeight || 5) - (a.boostWeight || 5))
            .slice(0, 400) // Leave room for fillers
            .map(k => k.phrase);
        
        // Get enabled filler words (helps recognize them for removal)
        const fillerPhrases = fillers
            .filter(f => f.enabled)
            .slice(0, 50)
            .map(f => f.phrase);
        
        // Combine and deduplicate
        const allHints = [...new Set([...boostKeywords, ...fillerPhrases])];
        
        // Build string respecting Twilio limits
        let hintsString = '';
        for (const hint of allHints) {
            const next = hintsString ? hintsString + ', ' + hint : hint;
            if (next.length > 10000) break; // 10KB limit
            hintsString = next;
        }
        
        return hintsString;
    }
    
    /**
     * Get provider comparison for UI display
     * @returns {Array} Provider options with details
     */
    static getProviderOptions() {
        return [
            {
                type: 'twilio',
                name: 'Twilio (Current)',
                description: 'Built-in STT with Twilio Voice - no extra cost',
                cost: 'FREE',
                accuracy: '~80%',
                latency: 'Real-time',
                available: true,
                recommended: false
            },
            {
                type: 'deepgram',
                name: 'Deepgram Nova-2',
                description: 'Premium accuracy with industry-leading AI',
                cost: '$0.0043/min',
                accuracy: '~95%',
                latency: 'Real-time',
                available: DeepgramService.isAvailable(),
                recommended: true,
                setupRequired: !DeepgramService.isAvailable() ? 'Add DEEPGRAM_API_KEY' : null
            },
            {
                type: 'google',
                name: 'Google Cloud Speech',
                description: 'Enterprise-grade with Google AI (coming soon)',
                cost: '$0.006/15sec',
                accuracy: '~90%',
                latency: 'Near real-time',
                available: false,
                recommended: false,
                setupRequired: 'Coming soon'
            }
        ];
    }
    
    /**
     * Health check all providers
     * @returns {Object} Health status for all providers
     */
    static async healthCheck() {
        const results = {
            twilio: {
                status: 'healthy',
                message: 'Built-in to Twilio (always available)'
            }
        };
        
        // Check Deepgram
        try {
            results.deepgram = await DeepgramService.healthCheck();
        } catch (error) {
            results.deepgram = {
                status: 'error',
                message: error.message
            };
        }
        
        // Google placeholder
        results.google = {
            status: 'unavailable',
            message: 'Not yet implemented'
        };
        
        return results;
    }
}

module.exports = STTProviderFactory;

