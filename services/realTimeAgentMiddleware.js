/**
 * Real-Time AI Agent Middleware
 * Integrates super-intelligent capabilities with existing agent service
 */

const SuperIntelligentAgentEngine = require('./superIntelligentAgent');
const AgentService = require('./agent'); // Existing agent service
const agentMonitoring = require('./agentMonitoring'); // Monitoring system
const BookingFlowHandler = require('./bookingFlowHandler'); // Booking flow

// Import monitoring logger
const { monitoringLogger } = agentMonitoring;

class RealTimeAgentMiddleware {
    
    constructor() {
        this.intelligentEngine = new SuperIntelligentAgentEngine();
        this.bookingFlowHandler = new BookingFlowHandler();
        this.activeCalls = new Map(); // Track active call sessions
        this.activeBookings = new Map(); // Track active booking flows
        this.responseCache = new Map(); // Cache frequent responses
        this.performanceMetrics = {
            averageResponseTime: 0,
            totalCalls: 0,
            escalationRate: 0,
            satisfactionScore: 0
        };
    }

    /**
     * Enhanced call handling with super-intelligent capabilities
     */
    async handleIncomingCall(callData) {
        const startTime = Date.now();
        const { callerId, companyId, query, audioStream } = callData;
        
        try {
            // Step 1: Check if caller is in active booking flow
            const activeBookingKey = `${companyId}_${callerId}`;
            const activeBooking = this.activeBookings.get(activeBookingKey);
            
            if (activeBooking) {
                console.log(`[Booking Flow] Continuing booking for caller: ${callerId}`);
                return await this.handleBookingFlow(callData, activeBooking);
            }
            
            // Step 2: Initialize call session with context
            const callSession = await this.initializeCallSession(callerId, companyId);
            
            // Step 3: Process query with intelligent engine (includes service issue detection)
            const intelligentResponse = await this.processWithIntelligence(query, callSession);
            
            // Step 4: Check if response initiated booking flow
            if (intelligentResponse.proceedToBooking) {
                console.log(`[Booking Flow] Initiating booking flow for service issue`);
                return await this.initiateBookingFlow(callData, intelligentResponse);
            }
            
            // Step 5: Check for escalation triggers
            const escalationCheck = await this.checkEscalationNeeded(intelligentResponse, callSession);
            
            // Step 6: Generate optimized response
            const optimizedResponse = await this.optimizeResponse(intelligentResponse, callSession);
            
            // Step 7: Check blacklist before responding
            const blacklistCheck = await agentMonitoring.checkDisapprovalList(
                companyId, 
                query, 
                optimizedResponse.response || optimizedResponse.text || optimizedResponse
            );
            
            if (blacklistCheck.blocked) {
                // Response is on blacklist - escalate instead
                monitoringLogger.warn('Response blocked by blacklist', {
                    companyId,
                    callerId,
                    query,
                    reason: blacklistCheck.reason
                });
                
                return {
                    success: true,
                    response: "I need to connect you with someone who can better assist you with this question.",
                    shouldEscalate: true,
                    escalationData: {
                        reason: 'blacklisted_response',
                        blacklistReason: blacklistCheck.reason,
                        category: blacklistCheck.category,
                        originalQuery: query
                    },
                    responseTime: Date.now() - startTime,
                    confidence: 0
                };
            }
            
            // Step 5: Update session context
            await this.updateCallSession(callSession.id, {
                query,
                response: optimizedResponse,
                timestamp: new Date()
            });
            
            // Step 6: Log interaction for monitoring and continuous improvement
            await this.logInteractionMetrics(callSession.id, query, optimizedResponse, startTime);
            
            // Step 7: Log to monitoring system for oversight
            const interactionData = {
                callerId,
                companyId,
                userQuery: query,
                agentResponse: optimizedResponse,
                confidence: intelligentResponse.confidence,
                responseTime: Date.now() - startTime,
                escalated: escalationCheck.shouldEscalate,
                metadata: {
                    sessionId: callSession.id,
                    sentiment: callSession.sentiment,
                    urgencyLevel: callSession.urgencyLevel,
                    callSid: callData.metadata?.callSid,
                    processingSteps: intelligentResponse.processingSteps || []
                }
            };
            
            // Log interaction for monitoring and review
            await agentMonitoring.logAgentInteraction(interactionData);
            
            return {
                success: true,
                response: optimizedResponse,
                shouldEscalate: escalationCheck.shouldEscalate,
                escalationData: escalationCheck.data,
                responseTime: Date.now() - startTime,
                confidence: intelligentResponse.confidence
            };
            
        } catch (error) {
            console.error('Enhanced call handling failed:', error);
            return await this.handleCallError(callerId, companyId, error);
        }
    }

    /**
     * Initialize call session with contextual memory
     */
    async initializeCallSession(callerId, companyId) {
        const sessionId = `${companyId}_${callerId}_${Date.now()}`;
        
        // Get caller context from intelligent engine
        const callerContext = await this.intelligentEngine.getCallerContext(callerId, companyId);
        
        // Get company configuration
        const companyConfig = await this.getCompanyAIConfig(companyId);
        
        const session = {
            id: sessionId,
            callerId,
            companyId,
            startTime: new Date(),
            context: callerContext,
            config: companyConfig,
            interactions: [],
            sentiment: 0,
            urgencyLevel: 1,
            escalationFlags: []
        };
        
        this.activeCalls.set(sessionId, session);
        return session;
    }

    /**
     * Process query using super-intelligent engine
     */
    async processWithIntelligence(query, session) {
        // Check cache first for performance
        const cacheKey = `${session.companyId}_${this.normalizeQuery(query)}`;
        if (this.responseCache.has(cacheKey)) {
            const cached = this.responseCache.get(cacheKey);
            return { ...cached, source: 'cache' };
        }
        
        // Process with intelligent engine
        const response = await this.intelligentEngine.handleQuery(
            query, 
            session.companyId, 
            session.callerId
        );
        
        // Enhanced reasoning if confidence is borderline
        if (response.confidence >= 0.7 && response.confidence < 0.85) {
            const reasonedResponse = await this.intelligentEngine.reasonAndRespond(
                query, 
                session.context, 
                session.companyId
            );
            
            if (reasonedResponse.confidence > response.confidence) {
                return reasonedResponse;
            }
        }
        
        // Cache successful responses
        if (response.confidence >= 0.85) {
            this.responseCache.set(cacheKey, response);
        }
        
        return response;
    }

    /**
     * Enhanced escalation checking with multiple triggers
     */
    async checkEscalationNeeded(response, session) {
        const escalationTriggers = await this.intelligentEngine.checkEscalationTriggers(
            session.interactions[session.interactions.length - 1]?.query || '',
            session.sentiment,
            session.context,
            this.getCallDuration(session.startTime)
        );
        
        // Check if response suggests escalation
        if (response.shouldEscalate) {
            escalationTriggers.push({
                type: 'low_confidence',
                reason: 'AI confidence below threshold',
                priority: 'medium'
            });
        }
        
        // Company-specific escalation rules
        const companyRules = session.config.escalationRules || {};
        if (companyRules.maxCallDuration && this.getCallDuration(session.startTime) > companyRules.maxCallDuration) {
            escalationTriggers.push({
                type: 'duration_exceeded',
                reason: 'Call duration exceeded company limit',
                priority: 'high'
            });
        }
        
        const shouldEscalate = escalationTriggers.some(trigger => trigger.priority === 'high') ||
                              escalationTriggers.filter(trigger => trigger.priority === 'medium').length >= 2;
        
        return {
            shouldEscalate,
            triggers: escalationTriggers,
            data: shouldEscalate ? await this.prepareEscalationData(session) : null
        };
    }

    /**
     * Optimize response for delivery
     */
    async optimizeResponse(intelligentResponse, session) {
        const optimized = await this.intelligentEngine.optimizeResponseDelivery(
            intelligentResponse.response,
            {
                sentiment: session.sentiment,
                urgency: session.urgencyLevel,
                personalization: session.context.personalization
            }
        );
        
        // Apply company-specific customizations
        const branded = this.applyCompanyBranding(optimized, session.config);
        
        return {
            ...intelligentResponse,
            ...branded,
            optimized: true,
            deliveryTime: optimized.estimatedDuration
        };
    }

    /**
     * Real-time streaming response (for future WebSocket implementation)
     */
    async streamResponse(sessionId, partialQuery) {
        const session = this.activeCalls.get(sessionId);
        if (!session) return null;
        
        // Process partial query for real-time response
        const quickResponse = await this.generateQuickResponse(partialQuery, session);
        
        return {
            type: 'partial_response',
            content: quickResponse,
            confidence: 0.6, // Lower confidence for partial processing
            isComplete: false
        };
    }

    /**
     * Complete streaming response
     */
    async completeStreamResponse(sessionId, fullQuery) {
        const session = this.activeCalls.get(sessionId);
        if (!session) return null;
        
        return await this.processWithIntelligence(fullQuery, session);
    }

    /**
     * Update call session with new interaction
     */
    async updateCallSession(sessionId, interaction) {
        const session = this.activeCalls.get(sessionId);
        if (!session) return;
        
        session.interactions.push(interaction);
        
        // Update context in intelligent engine
        await this.intelligentEngine.updateCallerContext(
            session.callerId,
            session.companyId,
            {
                lastInteraction: interaction,
                sessionData: {
                    callDuration: this.getCallDuration(session.startTime),
                    interactionCount: session.interactions.length
                }
            }
        );
        
        // Analyze sentiment trend
        session.sentiment = await this.analyzeSentimentTrend(session.interactions);
    }

    /**
     * End call session and cleanup
     */
    async endCallSession(sessionId, outcome = 'completed') {
        const session = this.activeCalls.get(sessionId);
        if (!session) return;
        
        const callSummary = {
            sessionId,
            callerId: session.callerId,
            companyId: session.companyId,
            duration: this.getCallDuration(session.startTime),
            interactionCount: session.interactions.length,
            finalSentiment: session.sentiment,
            outcome,
            escalated: session.escalationFlags.length > 0
        };
        
        // Log final metrics
        await this.intelligentEngine.logInteraction(
            session.interactions.map(i => i.query).join(' '),
            session.interactions[session.interactions.length - 1]?.response || {},
            outcome,
            callSummary
        );
        
        // Update performance metrics
        this.updatePerformanceMetrics(callSummary);
        
        // Cleanup
        this.activeCalls.delete(sessionId);
        
        return callSummary;
    }

    /**
     * Get real-time performance metrics
     */
    getPerformanceMetrics() {
        return {
            ...this.performanceMetrics,
            activeCalls: this.activeCalls.size,
            cacheHitRate: this.calculateCacheHitRate(),
            avgConfidence: this.calculateAverageConfidence()
        };
    }

    /**
     * Get active call session by CallSid
     */
    getActiveCall(callSid) {
        for (const [sessionId, session] of this.activeCalls) {
            if (session.metadata && session.metadata.callSid === callSid) {
                return session;
            }
        }
        return null;
    }

    /**
     * Clean up call session when call ends
     */
    cleanupCall(callSid) {
        for (const [sessionId, session] of this.activeCalls) {
            if (session.metadata && session.metadata.callSid === callSid) {
                console.log(`[CLEANUP] Removing call session: ${sessionId}`);
                this.activeCalls.delete(sessionId);
                break;
            }
        }
    }

    // Helper methods
    async getCompanyAIConfig(companyId) {
        // Get company-specific AI configuration from existing setup
        try {
            const Company = require('../models/Company');
            const company = await Company.findById(companyId);
            return company.agentSetup || {};
        } catch (error) {
            console.error('Failed to get company AI config:', error);
            return {};
        }
    }

    normalizeQuery(query) {
        return query.toLowerCase().trim().replace(/[^\w\s]/g, '');
    }

    getCallDuration(startTime) {
        return Math.floor((Date.now() - startTime.getTime()) / 1000);
    }

    async prepareEscalationData(session) {
        const transcript = session.interactions.map(i => 
            `Customer: ${i.query}\nAgent: ${i.response.response || i.response}`
        ).join('\n\n');
        
        return {
            sessionId: session.id,
            callerId: session.callerId,
            summary: await this.intelligentEngine.generateHandoffSummary(transcript, session.context),
            sentiment: session.sentiment,
            urgency: session.urgencyLevel,
            duration: this.getCallDuration(session.startTime),
            interactions: session.interactions.length
        };
    }

    applyCompanyBranding(response, config) {
        // Apply company-specific response customizations
        let branded = { ...response };
        
        if (config.personalityPreset) {
            branded.tone = config.personalityPreset;
        }
        
        if (config.brandVoice) {
            branded.text = this.adjustForBrandVoice(branded.text, config.brandVoice);
        }
        
        return branded;
    }

    adjustForBrandVoice(text, brandVoice) {
        // Adjust response tone based on brand voice settings
        switch (brandVoice) {
            case 'formal':
                return text.replace(/hey|hi/gi, 'Hello').replace(/sure/gi, 'Certainly');
            case 'casual':
                return text.replace(/Hello/gi, 'Hi').replace(/Certainly/gi, 'Sure');
            default:
                return text;
        }
    }

    async generateQuickResponse(partialQuery, session) {
        // Generate quick response for streaming (simplified)
        if (partialQuery.length < 10) return "I'm listening...";
        
        // Check for common patterns
        const patterns = {
            'hours': "Our hours are...",
            'price': "Let me check pricing for you...",
            'appointment': "I can help you schedule..."
        };
        
        for (const [pattern, response] of Object.entries(patterns)) {
            if (partialQuery.toLowerCase().includes(pattern)) {
                return response;
            }
        }
        
        return "I understand you're asking about...";
    }

    async analyzeSentimentTrend(interactions) {
        // Simplified sentiment analysis - would use proper sentiment API
        const recentInteractions = interactions.slice(-3);
        let sentimentSum = 0;
        
        for (const interaction of recentInteractions) {
            const sentiment = this.simpleSentimentAnalysis(interaction.query);
            sentimentSum += sentiment;
        }
        
        return recentInteractions.length > 0 ? sentimentSum / recentInteractions.length : 0;
    }

    simpleSentimentAnalysis(text) {
        const positive = ['thank', 'great', 'good', 'excellent', 'please', 'help'];
        const negative = ['bad', 'terrible', 'awful', 'hate', 'problem', 'issue', 'wrong'];
        
        const words = text.toLowerCase().split(' ');
        let score = 0;
        
        words.forEach(word => {
            if (positive.some(p => word.includes(p))) score += 0.1;
            if (negative.some(n => word.includes(n))) score -= 0.1;
        });
        
        return Math.max(-1, Math.min(1, score));
    }

    updatePerformanceMetrics(callSummary) {
        this.performanceMetrics.totalCalls++;
        
        // Update averages
        const total = this.performanceMetrics.totalCalls;
        this.performanceMetrics.averageResponseTime = 
            (this.performanceMetrics.averageResponseTime * (total - 1) + callSummary.duration) / total;
        
        if (callSummary.escalated) {
            this.performanceMetrics.escalationRate = 
                (this.performanceMetrics.escalationRate * (total - 1) + 1) / total;
        }
    }

    calculateCacheHitRate() {
        // Calculate cache effectiveness
        return 0.75; // Simplified - would track actual cache hits
    }

    calculateAverageConfidence() {
        // Calculate average AI confidence across active calls
        if (this.activeCalls.size === 0) return 0;
        
        let totalConfidence = 0;
        let count = 0;
        
        for (const session of this.activeCalls.values()) {
            session.interactions.forEach(interaction => {
                if (interaction.response?.confidence) {
                    totalConfidence += interaction.response.confidence;
                    count++;
                }
            });
        }
        
        return count > 0 ? totalConfidence / count : 0;
    }

    /**
     * Handle errors during call processing
     */
    async handleCallError(callerId, companyId, error) {
        console.error('Call handling error:', error);
        
        // Log error to monitoring system
        try {
            await agentMonitoring.logAgentInteraction({
                callerId,
                companyId,
                userQuery: 'Error occurred during processing',
                agentResponse: "I'm experiencing a technical issue. Let me connect you with someone who can help immediately.",
                confidence: 0,
                responseTime: 0,
                escalated: true,
                isError: true,
                metadata: {
                    errorMessage: error.message,
                    errorStack: error.stack,
                    timestamp: new Date(),
                    errorType: 'processing_error'
                }
            });
        } catch (monitoringError) {
            console.error('Failed to log error to monitoring:', monitoringError);
        }
        
        return {
            success: false,
            response: {
                text: "I'm experiencing a technical issue. Let me connect you with someone who can help immediately.",
                shouldEscalate: true,
                confidence: 0,
                source: 'error_handler'
            },
            shouldEscalate: true,
            escalationData: {
                reason: 'technical_error',
                error: error.message,
                callerId,
                companyId
            }
        };
    }
}

module.exports = RealTimeAgentMiddleware;
