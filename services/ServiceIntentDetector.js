/**
 * ============================================================================
 * SERVICE INTENT DETECTOR
 * ============================================================================
 * 
 * Detects when a caller is asking about a specific service (e.g., duct cleaning)
 * before scenario matching occurs. This enables DETERMINISTIC DECLINE for
 * disabled services - no LLM hallucination risk.
 * 
 * Flow:
 * 1. Caller says: "Do you clean ducts?"
 * 2. ServiceIntentDetector: detects "duct_cleaning" with confidence 0.85
 * 3. Check: company.services.duct_cleaning.enabled = false
 * 4. Response: Deterministic decline (rules-first, not LLM)
 * 
 * Features:
 * - Keyword matching (fast, high precision)
 * - Phrase matching (for context)
 * - Negative keywords (avoid false positives)
 * - Confidence scoring with minConfidence threshold
 * - Full audit trace for debugging
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

class ServiceIntentDetector {
    /**
     * Detect service intent from caller input
     * 
     * @param {string} input - Caller's message
     * @param {Object} servicesConfig - From GET /services-config endpoint
     * @returns {Object} Detection result with serviceKey, confidence, and trace
     */
    static detect(input, servicesConfig) {
        const startTime = Date.now();
        const normalizedInput = this.normalizeText(input);
        const trace = {
            input: input,
            normalizedInput: normalizedInput,
            servicesChecked: [],
            matchDetails: [],
            timestamp: new Date().toISOString()
        };
        
        if (!servicesConfig || !servicesConfig.services) {
            return {
                detected: false,
                serviceKey: null,
                confidence: 0,
                reason: 'no_services_config',
                trace
            };
        }
        
        let bestMatch = null;
        let bestConfidence = 0;
        
        // Check each service
        for (const [serviceKey, service] of Object.entries(servicesConfig.services)) {
            trace.servicesChecked.push(serviceKey);
            
            const keywords = service.keywords || [];
            const phrases = service.phrases || [];
            const negative = service.negative || [];
            const minConfidence = service.minConfidence || 0.6;
            
            // Check for negative keywords first (exclusion)
            const negativeHit = negative.find(neg => 
                normalizedInput.includes(this.normalizeText(neg))
            );
            
            if (negativeHit) {
                trace.matchDetails.push({
                    serviceKey,
                    result: 'excluded_by_negative',
                    negativeKeyword: negativeHit
                });
                continue;
            }
            
            // Calculate confidence based on matches
            let confidence = 0;
            let matchedKeywords = [];
            let matchedPhrases = [];
            
            // Keyword matching (each keyword adds to confidence)
            for (const keyword of keywords) {
                const normalizedKeyword = this.normalizeText(keyword);
                if (normalizedInput.includes(normalizedKeyword)) {
                    matchedKeywords.push(keyword);
                    // Longer keywords are more specific = higher confidence boost
                    const boost = Math.min(0.3, 0.1 + (keyword.split(' ').length * 0.05));
                    confidence += boost;
                }
            }
            
            // Phrase matching (higher confidence for exact phrases)
            for (const phrase of phrases) {
                const normalizedPhrase = this.normalizeText(phrase);
                if (normalizedInput.includes(normalizedPhrase)) {
                    matchedPhrases.push(phrase);
                    confidence += 0.4; // Phrases are strong signals
                }
            }
            
            // Cap confidence at 1.0
            confidence = Math.min(1.0, confidence);
            
            trace.matchDetails.push({
                serviceKey,
                confidence,
                minConfidence,
                meetsThreshold: confidence >= minConfidence,
                matchedKeywords,
                matchedPhrases,
                enabled: service.enabled
            });
            
            // Track best match above threshold
            if (confidence >= minConfidence && confidence > bestConfidence) {
                bestMatch = {
                    serviceKey,
                    confidence,
                    matchedKeywords,
                    matchedPhrases,
                    enabled: service.enabled,
                    declineMessage: service.declineMessage,
                    categoryName: service.categoryName
                };
                bestConfidence = confidence;
            }
        }
        
        trace.processingTimeMs = Date.now() - startTime;
        
        if (bestMatch) {
            logger.info('[SERVICE INTENT] Detected', {
                serviceKey: bestMatch.serviceKey,
                confidence: bestMatch.confidence,
                enabled: bestMatch.enabled,
                inputSnippet: input.substring(0, 50)
            });
            
            return {
                detected: true,
                serviceKey: bestMatch.serviceKey,
                confidence: bestMatch.confidence,
                enabled: bestMatch.enabled,
                categoryName: bestMatch.categoryName,
                declineMessage: bestMatch.declineMessage,
                matchedKeywords: bestMatch.matchedKeywords,
                matchedPhrases: bestMatch.matchedPhrases,
                action: bestMatch.enabled ? 'PROCEED' : 'DETERMINISTIC_DECLINE',
                trace
            };
        }
        
        return {
            detected: false,
            serviceKey: null,
            confidence: 0,
            action: 'PROCEED_TO_MATCHING',
            reason: 'no_service_intent_detected',
            trace
        };
    }
    
    /**
     * Normalize text for matching (lowercase, remove punctuation)
     */
    static normalizeText(text) {
        if (!text) return '';
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ')  // Remove punctuation
            .replace(/\s+/g, ' ')       // Collapse whitespace
            .trim();
    }
    
    /**
     * Generate deterministic decline response
     * 
     * @param {Object} detection - Result from detect()
     * @param {Object} options - Additional options
     * @returns {string} Decline message
     */
    static generateDeclineResponse(detection, options = {}) {
        if (!detection.detected || detection.enabled) {
            return null;
        }
        
        // Use custom decline message if available
        if (detection.declineMessage) {
            return detection.declineMessage;
        }
        
        // Generate default decline
        const serviceName = detection.categoryName || detection.serviceKey.replace(/_/g, ' ');
        return `I apologize, but we don't currently offer ${serviceName} services. Is there anything else I can help you with today?`;
    }
    
    /**
     * Build a decision trace entry for logging/debugging
     */
    static buildTraceEntry(detection, companyId) {
        return {
            type: 'serviceIntentDetection',
            companyId,
            timestamp: new Date().toISOString(),
            input: detection.trace?.input,
            detectedService: detection.serviceKey,
            confidence: detection.confidence,
            enabled: detection.enabled,
            action: detection.action,
            declineMessage: detection.enabled ? null : detection.declineMessage,
            matchedKeywords: detection.matchedKeywords,
            matchedPhrases: detection.matchedPhrases,
            servicesChecked: detection.trace?.servicesChecked,
            processingTimeMs: detection.trace?.processingTimeMs
        };
    }
}

module.exports = ServiceIntentDetector;
