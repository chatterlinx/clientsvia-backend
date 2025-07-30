/**
 * Template Intelligence Engine
 * Integrates with your existing Answer Priority Flow system
 * 
 * Processing Order (as configured in your UI):
 * 1. Company Knowledge Base (handled upstream)
 * 2. Trade Categories Q&A (handled upstream) 
 * 3. Template Intelligence (this engine)
 * 4. Learning Queue Insights (handled downstream)
 * 
 * Multi-Tenant: All responses personalized per companyId
 */

const Company = require('../models/Company');

class TemplateIntelligenceEngine {
    constructor() {
        this.confidenceThreshold = 0.65;
    }

    /**
     * Main Template Intelligence Processing
     * Called from your Answer Priority Flow as Tier 3
     */
    async processQuery(query, companyId, context = {}) {
        try {
            const company = await Company.findById(companyId);
            if (!company) return null;

            console.log(`[Template Intelligence] Processing for company ${companyId}: "${query.substring(0, 50)}..."`);

            // Get company's personality settings
            const personality = company.agentPersonality || {};
            const responseCategories = company.responseCategories || {};

            // Process through template matching
            const templateResult = await this.matchSmartTemplates(query, company, personality, context);
            
            if (templateResult && templateResult.confidence >= this.confidenceThreshold) {
                console.log(`[Template Intelligence] Match found: ${templateResult.category} (${(templateResult.confidence * 100).toFixed(1)}%)`);
                
                // Apply personality settings to response
                const personalizedResponse = this.applyPersonality(templateResult.response, personality, company);
                
                return {
                    response: personalizedResponse,
                    confidence: templateResult.confidence,
                    source: 'template_intelligence',
                    category: templateResult.category,
                    templateUsed: templateResult.templateKey,
                    personalityApplied: {
                        voiceTone: personality.voiceTone,
                        useEmojis: personality.useEmojis,
                        speechPace: personality.speechPace
                    }
                };
            }

            return null;

        } catch (error) {
            console.error('[Template Intelligence] Error:', error);
            return null;
        }
    }

    /**
     * Smart Template Matching
     * Uses your existing Response Categories system
     */
    async matchSmartTemplates(query, company, personality, context) {
        const qLower = query.toLowerCase();
        const companyName = company.companyName || 'our company';
        const responseCategories = company.responseCategories || {};

        // Primary Interactions
        if (this.matchesKeywords(qLower, ['hello', 'hi', 'hey', 'good morning', 'good afternoon'])) {
            return {
                response: this.getGreetingResponse(company, responseCategories, context),
                confidence: 0.90,
                category: 'greeting',
                templateKey: 'primary_greeting'
            };
        }

        if (this.matchesKeywords(qLower, ['goodbye', 'bye', 'thank you', 'thanks', 'have a good'])) {
            return {
                response: this.getFarewellResponse(company, responseCategories, context),
                confidence: 0.85,
                category: 'farewell', 
                templateKey: 'primary_farewell'
            };
        }

        if (this.matchesKeywords(qLower, ['hold', 'wait', 'one moment', 'please wait'])) {
            return {
                response: this.getHoldResponse(company, responseCategories, context),
                confidence: 0.80,
                category: 'hold',
                templateKey: 'primary_hold'
            };
        }

        // Service Interactions
        if (this.matchesKeywords(qLower, ['transfer', 'speak to', 'talk to', 'connect me', 'manager'])) {
            return {
                response: this.getTransferResponse(company, responseCategories, context),
                confidence: 0.85,
                category: 'transfer',
                templateKey: 'service_transfer'
            };
        }

        if (this.matchesKeywords(qLower, ['hours', 'open', 'closed', 'business hours', 'what time'])) {
            return {
                response: this.getBusinessHoursResponse(company, responseCategories, context),
                confidence: 0.80,
                category: 'business_hours',
                templateKey: 'service_hours'
            };
        }

        // Service Availability
        if (this.matchesKeywords(qLower, ['service', 'services', 'what do you do', 'help with', 'available'])) {
            return {
                response: this.getServiceResponse(company, context),
                confidence: 0.75,
                category: 'service_inquiry',
                templateKey: 'service_available'
            };
        }

        // Emergency/Urgent
        if (this.matchesKeywords(qLower, ['emergency', 'urgent', 'broke', 'broken', 'not working', 'problem'])) {
            return {
                response: this.getEmergencyResponse(company, context),
                confidence: 0.90,
                category: 'emergency',
                templateKey: 'emergency_service'
            };
        }

        // Scheduling
        if (this.matchesKeywords(qLower, ['schedule', 'appointment', 'book', 'when can', 'available'])) {
            return {
                response: this.getSchedulingResponse(company, context),
                confidence: 0.80,
                category: 'scheduling',
                templateKey: 'appointment_booking'
            };
        }

        return null;
    }

    /**
     * Response Generators using your Response Categories system
     */
    getGreetingResponse(company, responseCategories, context) {
        const template = responseCategories.greeting || 
            "Hi {{callerName}}! Thanks for calling {{companyName}}. How can I help you today?";
        
        return this.processTemplate(template, company, context);
    }

    getFarewellResponse(company, responseCategories, context) {
        const template = responseCategories.farewell || 
            "Thanks for calling {{companyName}}! Have a great day!";
        
        return this.processTemplate(template, company, context);
    }

    getHoldResponse(company, responseCategories, context) {
        const template = responseCategories.hold || 
            "Please hold for just a moment while I look that up for you.";
        
        return this.processTemplate(template, company, context);
    }

    getTransferResponse(company, responseCategories, context) {
        const template = responseCategories.transfer || 
            "Let me connect you with {{departmentName}} who can better assist you.";
        
        return this.processTemplate(template, company, context);
    }

    getBusinessHoursResponse(company, responseCategories, context) {
        const template = responseCategories.businessHours || 
            "We're open {{businessHours}}. You can also visit our website at {{website}}.";
        
        return this.processTemplate(template, company, context);
    }

    getServiceResponse(company, context) {
        const tradeTypes = company.tradeTypes || [];
        const serviceList = this.buildServiceList(tradeTypes);
        const companyName = company.companyName || 'our company';
        
        return `${companyName} specializes in ${serviceList}. What specific service can I help you with today?`;
    }

    getEmergencyResponse(company, context) {
        const companyName = company.companyName || 'our company';
        return `I understand this is urgent. ${companyName} provides emergency services. Can you tell me what's happening so I can get the right technician to you quickly?`;
    }

    getSchedulingResponse(company, context) {
        return "I can help you schedule an appointment. What type of service do you need, and when would work best for you?";
    }

    /**
     * Template Variable Processing
     * Processes your {{variable}} syntax from Response Categories
     */
    processTemplate(template, company, context) {
        const variables = {
            callerName: context.callerName || 'there',
            companyName: company.companyName || 'our company',
            currentTime: new Date().toLocaleTimeString(),
            businessHours: company.businessHours || 'Monday-Friday 8AM-5PM',
            website: company.website || 'our website',
            departmentName: context.departmentName || 'our specialist',
            specialistName: context.specialistName || 'our specialist',
            serviceType: context.serviceType || 'service',
            alternativeService: context.alternativeService || 'another service',
            estimatedTime: context.estimatedTime || 'a few minutes'
        };

        let processedTemplate = template;
        
        // Replace all {{variable}} placeholders
        Object.keys(variables).forEach(key => {
            const placeholder = `{{${key}}}`;
            processedTemplate = processedTemplate.replace(new RegExp(placeholder, 'g'), variables[key]);
        });

        return processedTemplate;
    }

    /**
     * Apply Personality Settings
     * Uses your Agent Personality Configuration
     */
    applyPersonality(response, personality, company) {
        let personalizedResponse = response;

        // Apply voice tone adjustments
        switch (personality.voiceTone) {
            case 'friendly':
                personalizedResponse = this.makeFriendly(personalizedResponse);
                break;
            case 'playful':
                personalizedResponse = this.makePlayful(personalizedResponse);
                break;
            case 'professional':
            default:
                // Already professional by default
                break;
        }

        // Add emojis if enabled
        if (personality.useEmojis) {
            personalizedResponse = this.addEmojis(personalizedResponse);
        }

        // Apply speech pace (affects TTS later in the pipeline)
        // This is handled by your existing TTS system

        return personalizedResponse;
    }

    /**
     * Personality Adjustments
     */
    makeFriendly(response) {
        // Make response warmer and more approachable
        return response
            .replace(/\bI can\b/g, "I'd be happy to")
            .replace(/\bWhat\b/g, "What")
            .replace(/\?$/, "? I'm here to help!");
    }

    makePlayful(response) {
        // Add casual, fun elements
        return response
            .replace(/\bHi\b/g, "Hey there")
            .replace(/\bThanks\b/g, "Awesome, thanks")
            .replace(/\bGreat\b/g, "Perfect");
    }

    addEmojis(response) {
        // Add contextual emojis based on your UI settings
        if (response.includes('Thanks') || response.includes('thank')) {
            response = response.replace(/Thanks/g, 'Thanks 😊');
        }
        if (response.includes('Great') || response.includes('Perfect')) {
            response = response.replace(/Great/g, 'Great 👍');
        }
        if (response.includes('emergency') || response.includes('urgent')) {
            response = response.replace(/emergency/g, 'emergency 🚨');
        }
        return response;
    }

    /**
     * Helper Methods
     */
    matchesKeywords(text, keywords) {
        return keywords.some(keyword => text.includes(keyword));
    }

    buildServiceList(tradeTypes) {
        if (!tradeTypes || tradeTypes.length === 0) {
            return "professional service solutions";
        }
        
        if (tradeTypes.length === 1) {
            return tradeTypes[0].toLowerCase();
        }
        
        if (tradeTypes.length === 2) {
            return tradeTypes.join(' and ').toLowerCase();
        }
        
        const last = tradeTypes[tradeTypes.length - 1];
        const rest = tradeTypes.slice(0, -1);
        return `${rest.join(', ').toLowerCase()}, and ${last.toLowerCase()}`;
    }
}

module.exports = TemplateIntelligenceEngine;
