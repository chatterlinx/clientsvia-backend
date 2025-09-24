/**
 * 🏢 In-House Intelligence Engine
 * Multi-tenant template-based response system for ClientsVia platform
 * 
 * Each company gets isolated settings, templates, and personalized responses.
 * NO external LLMs - pure business logic and pattern matching only.
 * 
 * Processing Hierarchy (per company):
 * 1. Company Knowledge Base (already handled upstream)
 * 2. Trade Category Q&As (already handled upstream)
 * 3. Smart Response Templates (THIS ENGINE - 90% of responses)
 * 4. Conversation Flow Scripts (THIS ENGINE - 8% of responses)
 * 5. Emergency Protocol Responses (THIS ENGINE - 2% of responses)
 * 6. LLM Fallback (external - only if this engine fails)
 */

const Company = require('../models/Company');

class InHouseIntelligenceEngine {
    constructor() {
        this.companySettings = new Map(); // Cache per companyId
        this.confidenceThreshold = 0.75;
        this.templateMatchThreshold = 0.6;
        this.conversationFlowThreshold = 0.5;
    }

    /**
     * Main processing pipeline - Multi-tenant In-House Intelligence
     */
    async processQuery(query, companyId, context = {}) {
        const company = await Company.findById(companyId);
        if (!company) return this.generateFallback(query);

        const processingLog = [];

        try {
            // Tier 1: Company Knowledge Base (Already handled by existing system)
            // This is called first in the main agent.js flow

            // Tier 2: Trade Category Q&As (Already handled by existing system)
            // This is the second check in the main flow

            // Tier 3: Smart Response Templates
            const templateResult = await this.processSmartTemplates(query, company, context);
            if (templateResult && templateResult.confidence >= this.templateMatchThreshold) {
                processingLog.push({
                    tier: 3,
                    method: 'Smart Response Template',
                    confidence: templateResult.confidence,
                    pattern: templateResult.pattern
                });

                return {
                    response: templateResult.response,
                    confidence: templateResult.confidence,
                    source: 'smart_template',
                    shouldEscalate: false,
                    processingLog,
                    inHouseGenerated: true
                };
            }

            // Tier 4: Conversation Flow Scripts
            const flowResult = await this.processConversationFlow(query, company, context);
            if (flowResult && flowResult.confidence >= this.conversationFlowThreshold) {
                processingLog.push({
                    tier: 4,
                    method: 'Conversation Flow Script',
                    confidence: flowResult.confidence,
                    flow: flowResult.flowType
                });

                return {
                    response: flowResult.response,
                    confidence: flowResult.confidence,
                    source: 'conversation_flow',
                    shouldEscalate: false,
                    processingLog,
                    inHouseGenerated: true
                };
            }

            // Tier 5: Dynamic Personality Responses
            const personalityResult = await this.processPersonalityResponse(query, company, context);
            if (personalityResult && personalityResult.confidence >= 0.4) {
                processingLog.push({
                    tier: 5,
                    method: 'Dynamic Personality Response',
                    confidence: personalityResult.confidence,
                    personality: company.agentPersonality?.voiceTone || 'professional'
                });

                return {
                    response: personalityResult.response,
                    confidence: personalityResult.confidence,
                    source: 'personality_template',
                    shouldEscalate: false,
                    processingLog,
                    inHouseGenerated: true
                };
            }

            // Tier 6: Emergency Protocol Responses
            const emergencyResult = await this.processEmergencyProtocols(query, company, context);
            if (emergencyResult) {
                processingLog.push({
                    tier: 6,
                    method: 'Emergency Protocol',
                    confidence: emergencyResult.confidence,
                    protocol: emergencyResult.protocolType
                });

                return {
                    response: emergencyResult.response,
                    confidence: emergencyResult.confidence,
                    source: 'emergency_protocol',
                    shouldEscalate: emergencyResult.shouldEscalate,
                    processingLog,
                    inHouseGenerated: true
                };
            }

            // All in-house options exhausted - return null to trigger LLM rescue
            return null;

        } catch (error) {
            console.error('In-House Intelligence Engine error:', error);
            return null; // Let LLM rescue handle it
        }
    }

    /**
     * Tier 3: Smart Response Templates
     * Pattern-matched responses with dynamic variables per company
     */
    async processSmartTemplates(query, company, context) {
        const qLower = query.toLowerCase();
        const settings = await this.getCompanySettings(company._id);
        if (!settings) return null;

        // Service Inquiry Templates
        if (this.matchesPattern(qLower, ['service', 'services', 'what do you do', 'help with'])) {
            const serviceList = this.buildServiceList(settings.tradeTypes);
            return {
                response: `${settings.companyName} specializes in ${serviceList}. What specific service can I help you with today?`,
                confidence: 0.85,
                pattern: 'service_inquiry'
            };
        }

        // Pricing Templates
        if (this.matchesPattern(qLower, ['price', 'cost', 'how much', 'pricing', 'estimate'])) {
            return {
                response: `I'd be happy to discuss pricing for your specific needs. Our rates vary based on the type of service and project scope. Would you like me to schedule a free estimate?`,
                confidence: 0.80,
                pattern: 'pricing_inquiry'
            };
        }

        // Emergency Templates
        if (this.matchesPattern(qLower, ['emergency', 'urgent', 'asap', 'right now', 'immediately'])) {
            return {
                response: `I understand this is urgent. ${settings.companyName} handles emergency calls. Let me connect you with our emergency dispatch right away.`,
                confidence: 0.90,
                pattern: 'emergency_inquiry'
            };
        }

        // Hours Templates
        if (this.matchesPattern(qLower, ['hours', 'open', 'closed', 'when', 'available'])) {
            const hoursText = this.formatBusinessHours(settings.businessHours);
            return {
                response: `${settings.companyName} is ${hoursText}. Would you like to schedule an appointment?`,
                confidence: 0.85,
                pattern: 'hours_inquiry'
            };
        }

        return null;
    }

    /**
     * Get company-specific settings with caching
     */
    async getCompanySettings(companyId) {
        if (this.companySettings.has(companyId)) {
            return this.companySettings.get(companyId);
        }

        const company = await Company.findById(companyId);
        if (!company) return null;

        const settings = {
            companyName: company.companyName || 'our company',
            tradeTypes: company.tradeTypes || [],
            personality: company.agentPersonality || { voiceTone: 'professional' },
            businessHours: company.businessHours || {},
            phoneNumber: company.phoneNumber || '',
            emergencyNumber: company.emergencyNumber || company.phoneNumber || '',
            customResponses: company.customResponses || {},
            brandVoice: company.brandVoice || 'professional'
        };

        // Cache for 5 minutes
        this.companySettings.set(companyId, settings);
        setTimeout(() => this.companySettings.delete(companyId), 5 * 60 * 1000);

        return settings;
    }
            };
        }

        // Emergency/Urgent Templates
        if (this.matchesPattern(qLower, ['emergency', 'urgent', 'broke', 'broken', 'not working', 'problem'])) {
            return {
                response: `I understand this is urgent. ${companyName} provides emergency services. Can you tell me what's happening so I can get the right technician to you quickly?`,
                confidence: 0.90,
                pattern: 'emergency_inquiry'
            };
        }

        // Scheduling Templates
        if (this.matchesPattern(qLower, ['schedule', 'appointment', 'book', 'when', 'available', 'tomorrow'])) {
            return {
                response: `I can help you schedule an appointment. What type of service do you need, and when would work best for you?`,
                confidence: 0.85,
                pattern: 'scheduling_inquiry'
            };
        }

        // Hours/Availability Templates
        if (this.matchesPattern(qLower, ['hours', 'open', 'closed', 'time', 'when are you'])) {
            const hours = company.businessHours || 'Monday-Friday 8AM-5PM';
            return {
                response: `${companyName} is typically available ${hours}. For emergencies, we also offer after-hours service. What can I help you with?`,
                confidence: 0.75,
                pattern: 'hours_inquiry'
            };
        }

        // Location/Service Area Templates
        if (this.matchesPattern(qLower, ['location', 'where', 'service area', 'come to', 'travel'])) {
            return {
                response: `${companyName} serves the local area. Can you tell me your location so I can confirm we service your area and discuss your needs?`,
                confidence: 0.75,
                pattern: 'location_inquiry'
            };
        }

        return null;
    }

    /**
     * Tier 4: Conversation Flow Scripts
     * Guided interactions for specific business processes
     */
    async processConversationFlow(query, company, context) {
        const qLower = query.toLowerCase();

        // Booking Flow Activation
        if (this.matchesPattern(qLower, ['schedule', 'book', 'appointment', 'come out'])) {
            const bookingFlow = company.bookingFlowFields || [];
            if (bookingFlow.length > 0) {
                const firstField = bookingFlow.find(field => field.order === 1);
                if (firstField) {
                    return {
                        response: firstField.prompt,
                        confidence: 0.70,
                        flowType: 'booking_flow',
                        nextStep: firstField.fieldName
                    };
                }
            }
        }

        // Information Gathering Flow
        if (this.matchesPattern(qLower, ['tell me about', 'information', 'details', 'more about'])) {
            return {
                response: "I'd be happy to provide more information. Are you interested in our services, pricing, or would you like to schedule a consultation?",
                confidence: 0.65,
                flowType: 'information_gathering'
            };
        }

        return null;
    }

    /**
     * Tier 5: Dynamic Personality Responses
     * Brand-consistent responses based on company personality settings
     */
    async processPersonalityResponse(query, company, context) {
        const personality = company.agentPersonality || {};
        const voiceTone = personality.voiceTone || 'professional';
        const useEmojis = personality.useEmojis || false;
        const companyName = company.companyName || 'our company';

        // Use modern AI Agent Logic personality system
        const baseResponse = await this.getModernPersonalityResponse(company, voiceTone, companyName);
        const finalResponse = useEmojis ? `${baseResponse} 😊` : baseResponse;

        return {
            response: finalResponse,
            confidence: 0.45,
            personalityApplied: voiceTone
        };
    }

    /**
     * Tier 6: Emergency Protocol Responses
     * Crisis management and critical situation handling
     */
    async processEmergencyProtocols(query, company, context) {
        const qLower = query.toLowerCase();

        // Critical emergency keywords
        if (this.matchesPattern(qLower, ['flood', 'flooding', 'gas leak', 'no heat', 'no power', 'danger'])) {
            return {
                response: "This sounds like an emergency situation. For your safety, I'm connecting you immediately with our emergency team.",
                confidence: 0.95,
                protocolType: 'critical_emergency',
                shouldEscalate: true
            };
        }

        // After hours emergency
        const currentHour = new Date().getHours();
        if ((currentHour < 8 || currentHour > 17) && 
            this.matchesPattern(qLower, ['emergency', 'urgent', 'help', 'problem'])) {
            return {
                response: "I understand this is urgent. While our office is closed, we do provide emergency service. Let me connect you with our on-call technician.",
                confidence: 0.85,
                protocolType: 'after_hours_emergency',
                shouldEscalate: true
            };
        }

        return null;
    }

    /**
     * Helper Methods
     */
    matchesPattern(text, keywords) {
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

    /**
     * Modern AI Agent Logic personality response system
     * Uses company-specific configuration from aiAgentLogic.responseCategories
     */
    async getModernPersonalityResponse(company, voiceTone, companyName) {
        try {
            // Check if company has modern AI Agent Logic personality configuration
            if (company.aiAgentLogic?.responseCategories?.core?.['greeting-response']) {
                let response = company.aiAgentLogic.responseCategories.core['greeting-response'];
                // Apply company name placeholder
                response = response.replace(/\{companyname\}/gi, companyName);
                response = response.replace(/\{companyName\}/gi, companyName);
                response = response.replace(/\{\{companyName\}\}/gi, companyName);
                return response;
            }
            
            // Fallback to legacy hardcoded responses if no modern config
            const responses = {
                friendly: `Thanks for calling ${companyName}! I'm here to help you with whatever you need.`,
                professional: `Thank you for contacting ${companyName}. How can I assist you today?`,
                playful: `Hey there! You've reached ${companyName} and we're excited to help you out!`
            };
            
            return responses[voiceTone] || responses.professional;
        } catch (error) {
            console.error('Error getting modern personality response:', error);
            return `Thank you for contacting ${companyName}. How can I assist you today?`;
        }
    }

    generateFallback(query) {
        return {
            response: "I want to make sure I give you the best help possible. Let me connect you with one of our specialists.",
            confidence: 0.3,
            source: 'fallback',
            shouldEscalate: true,
            inHouseGenerated: true
        };
    }
}

module.exports = InHouseIntelligenceEngine;
