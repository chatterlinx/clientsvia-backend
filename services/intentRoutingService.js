/**
 * Intent Routing & Flow Control Service
 * Manages multi-tenant AI logic configuration, intent classification, and flow validation
 */

const winston = require('winston');

class IntentRoutingService {
    constructor() {
        this.logger = winston.createLogger({
            level: 'info',
            format: winston.format.combine(
                winston.format.timestamp(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    return `${timestamp} [${level.toUpperCase()}] [IntentRouting] ${message} ${Object.keys(meta).length ? JSON.stringify(meta) : ''}`;
                })
            ),
            transports: [
                new winston.transports.File({ filename: 'logs/intent-routing.log' }),
                new winston.transports.Console()
            ]
        });
        
        // Default intent flow configuration
        this.defaultIntentFlow = [
            {
                id: 'service_issue',
                name: 'Service Issue Detection',
                description: 'Detect AC/heating/plumbing emergencies',
                priority: 'high',
                enabled: true,
                confidence: 85,
                keywords: ['broken', 'not working', 'emergency', 'repair', 'fix', 'stopped working', 'no cold air', 'no heat'],
                order: 1,
                handler: 'ServiceIssueHandler',
                conditions: {
                    urgency: 'high',
                    businessHours: 'any',
                    escalateAfter: 0
                }
            },
            {
                id: 'booking_request',
                name: 'Booking Request',
                description: 'Schedule appointments and services',
                priority: 'high',
                enabled: true,
                confidence: 80,
                keywords: ['schedule', 'appointment', 'book', 'availability', 'when can you come', 'technician'],
                order: 2,
                handler: 'BookingFlowHandler',
                conditions: {
                    urgency: 'medium',
                    businessHours: 'preferred',
                    escalateAfter: 2
                }
            },
            {
                id: 'information_request',
                name: 'Information Request',
                description: 'General questions and company info',
                priority: 'medium',
                enabled: true,
                confidence: 75,
                keywords: ['hours', 'pricing', 'services', 'about', 'cost', 'how much', 'what do you'],
                order: 3,
                handler: 'KnowledgeBaseHandler',
                conditions: {
                    urgency: 'low',
                    businessHours: 'any',
                    escalateAfter: 3
                }
            },
            {
                id: 'transfer_request',
                name: 'Transfer Request',
                description: 'Transfer to human agent',
                priority: 'medium',
                enabled: true,
                confidence: 90,
                keywords: ['manager', 'human', 'transfer', 'speak to', 'real person', 'representative'],
                order: 4,
                handler: 'TransferHandler',
                conditions: {
                    urgency: 'immediate',
                    businessHours: 'required',
                    escalateAfter: 0
                }
            },
            {
                id: 'after_hours',
                name: 'After Hours Protocol',
                description: 'Handle calls outside business hours',
                priority: 'low',
                enabled: true,
                confidence: 95,
                keywords: ['closed', 'hours', 'open', 'business hours'],
                order: 5,
                handler: 'AfterHoursHandler',
                conditions: {
                    urgency: 'low',
                    businessHours: 'outside',
                    escalateAfter: 1
                }
            }
        ];
    }

    /**
     * Get intent routing configuration for a company
     */
    async getIntentRoutingConfig(companyId) {
        try {
            this.logger.info('Getting intent routing config', { companyId });
            
            // In a real implementation, this would load from database
            // For now, return default configuration
            const config = {
                companyId,
                intentFlow: this.defaultIntentFlow,
                settings: {
                    enableIntentClassification: true,
                    enableStrictPriority: true,
                    enableFlowMonitoring: true,
                    intentConfidenceThreshold: 75,
                    fallbackHandler: 'LLMFallbackHandler'
                },
                performance: {
                    intentAccuracy: 94,
                    routingSpeed: 0.3,
                    fallbackRate: 8,
                    totalIntents: 1247
                },
                lastUpdated: new Date()
            };
            
            return { success: true, data: config };
        } catch (error) {
            this.logger.error('Error getting intent routing config', { companyId, error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Update intent routing configuration
     */
    async updateIntentRoutingConfig(companyId, config) {
        try {
            this.logger.info('Updating intent routing config', { companyId });
            
            // Validate configuration
            const validation = this.validateIntentFlow(config.intentFlow);
            if (!validation.isValid) {
                return { success: false, error: 'Invalid intent flow configuration', details: validation.errors };
            }
            
            // In a real implementation, this would save to database
            this.logger.info('Intent routing config updated successfully', { companyId });
            
            return { success: true, data: { updated: true, timestamp: new Date() } };
        } catch (error) {
            this.logger.error('Error updating intent routing config', { companyId, error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Classify caller intent based on input text
     */
    async classifyIntent(companyId, inputText, context = {}) {
        try {
            this.logger.info('Classifying intent', { companyId, inputText: inputText.substring(0, 100) });
            
            // Get company's intent flow configuration
            const configResult = await this.getIntentRoutingConfig(companyId);
            if (!configResult.success) {
                throw new Error('Could not load intent configuration');
            }
            
            const intentFlow = configResult.data.intentFlow;
            const settings = configResult.data.settings;
            
            // Sort by priority and order
            const sortedIntents = intentFlow
                .filter(intent => intent.enabled)
                .sort((a, b) => {
                    // Priority order: high > medium > low
                    const priorityOrder = { high: 3, medium: 2, low: 1 };
                    const priorityDiff = priorityOrder[b.priority] - priorityOrder[a.priority];
                    if (priorityDiff !== 0) return priorityDiff;
                    
                    // If same priority, sort by order
                    return a.order - b.order;
                });
            
            // Classify intent
            const classifications = [];
            
            for (const intent of sortedIntents) {
                const confidence = this.calculateIntentConfidence(inputText, intent);
                
                if (confidence >= intent.confidence) {
                    classifications.push({
                        intentId: intent.id,
                        intentName: intent.name,
                        confidence,
                        priority: intent.priority,
                        handler: intent.handler,
                        conditions: intent.conditions
                    });
                }
            }
            
            // Get the best match
            const bestMatch = classifications.length > 0 ? classifications[0] : null;
            
            // Check if meets global threshold
            if (bestMatch && bestMatch.confidence >= settings.intentConfidenceThreshold) {
                this.logger.info('Intent classified successfully', {
                    companyId,
                    intentId: bestMatch.intentId,
                    confidence: bestMatch.confidence
                });
                
                return {
                    success: true,
                    data: {
                        intent: bestMatch,
                        allClassifications: classifications,
                        processingTime: '0.3s',
                        timestamp: new Date()
                    }
                };
            } else {
                // Fallback to default handler
                this.logger.info('Intent classification below threshold, using fallback', {
                    companyId,
                    bestConfidence: bestMatch?.confidence || 0,
                    threshold: settings.intentConfidenceThreshold
                });
                
                return {
                    success: true,
                    data: {
                        intent: {
                            intentId: 'fallback',
                            intentName: 'LLM Fallback',
                            confidence: 0,
                            priority: 'low',
                            handler: settings.fallbackHandler,
                            conditions: { urgency: 'low', businessHours: 'any', escalateAfter: 1 }
                        },
                        allClassifications: classifications,
                        processingTime: '0.3s',
                        timestamp: new Date()
                    }
                };
            }
        } catch (error) {
            this.logger.error('Error classifying intent', { companyId, error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Calculate intent confidence based on keyword matching and semantic analysis
     */
    calculateIntentConfidence(inputText, intent) {
        const text = inputText.toLowerCase();
        const keywords = intent.keywords.map(k => k.toLowerCase());
        
        let score = 0;
        let totalKeywords = keywords.length;
        
        // Exact keyword matching
        let exactMatches = 0;
        for (const keyword of keywords) {
            if (text.includes(keyword)) {
                exactMatches++;
                score += 20; // 20 points per exact match
            }
        }
        
        // Partial matching (for multi-word keywords)
        let partialMatches = 0;
        for (const keyword of keywords) {
            const keywordWords = keyword.split(' ');
            if (keywordWords.length > 1) {
                const matchedWords = keywordWords.filter(word => text.includes(word)).length;
                if (matchedWords > 0) {
                    partialMatches += matchedWords / keywordWords.length;
                    score += (matchedWords / keywordWords.length) * 10; // Up to 10 points per partial match
                }
            }
        }
        
        // Semantic similarity bonus (simplified)
        if (intent.id === 'service_issue' && (text.includes('problem') || text.includes('issue') || text.includes('trouble'))) {
            score += 15;
        }
        
        if (intent.id === 'booking_request' && (text.includes('need') || text.includes('want') || text.includes('can you'))) {
            score += 10;
        }
        
        // Context bonuses
        if (intent.id === 'after_hours' && new Date().getHours() < 8 || new Date().getHours() > 17) {
            score += 20; // After hours bonus
        }
        
        // Normalize to percentage
        const maxPossibleScore = totalKeywords * 20 + 35; // 35 for bonuses
        const confidence = Math.min(Math.round((score / maxPossibleScore) * 100), 100);
        
        return confidence;
    }

    /**
     * Validate intent flow configuration
     */
    validateIntentFlow(intentFlow) {
        const errors = [];
        
        if (!Array.isArray(intentFlow) || intentFlow.length === 0) {
            errors.push('Intent flow must be a non-empty array');
            return { isValid: false, errors };
        }
        
        // Check for required fields
        for (const intent of intentFlow) {
            if (!intent.id || !intent.name || !intent.handler) {
                errors.push(`Intent ${intent.id || 'unknown'} missing required fields`);
            }
            
            if (!intent.priority || !['high', 'medium', 'low'].includes(intent.priority)) {
                errors.push(`Intent ${intent.id} has invalid priority`);
            }
            
            if (intent.confidence < 50 || intent.confidence > 100) {
                errors.push(`Intent ${intent.id} has invalid confidence threshold`);
            }
        }
        
        // Check for duplicate IDs
        const ids = intentFlow.map(i => i.id);
        const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
        if (duplicateIds.length > 0) {
            errors.push(`Duplicate intent IDs: ${duplicateIds.join(', ')}`);
        }
        
        // Check for gaps in order
        const orders = intentFlow.map(i => i.order).sort((a, b) => a - b);
        for (let i = 1; i < orders.length; i++) {
            if (orders[i] !== orders[i-1] + 1) {
                errors.push('Gaps detected in intent ordering');
                break;
            }
        }
        
        return { isValid: errors.length === 0, errors };
    }

    /**
     * Test intent flow with sample input
     */
    async testIntentFlow(companyId, testInput, scenario) {
        try {
            this.logger.info('Testing intent flow', { companyId, scenario });
            
            const startTime = Date.now();
            
            // Classify intent
            const classificationResult = await this.classifyIntent(companyId, testInput);
            
            if (!classificationResult.success) {
                throw new Error('Intent classification failed');
            }
            
            const processingTime = Date.now() - startTime;
            const intent = classificationResult.data.intent;
            
            // Simulate flow execution steps
            const steps = [
                {
                    step: 'Intent Classification',
                    status: 'success',
                    message: `Classified as: ${intent.intentName} (confidence: ${intent.confidence}%)`
                },
                {
                    step: 'Priority Check',
                    status: 'success',
                    message: `${intent.priority.charAt(0).toUpperCase() + intent.priority.slice(1)} priority intent - processing ${intent.priority === 'high' ? 'immediately' : 'in order'}`
                },
                {
                    step: 'Flow Routing',
                    status: 'success',
                    message: `Routed to ${intent.handler}`
                },
                {
                    step: 'Response Generation',
                    status: 'success',
                    message: `Generated ${intent.intentId === 'fallback' ? 'LLM fallback' : 'structured'} response`
                }
            ];
            
            // Generate sample response based on intent
            const sampleResponse = this.generateSampleResponse(intent, testInput);
            
            return {
                success: true,
                data: {
                    input: testInput,
                    scenario,
                    intent,
                    steps,
                    finalResponse: sampleResponse,
                    processingTime: `${processingTime}ms`,
                    confidence: `${intent.confidence}%`,
                    timestamp: new Date()
                }
            };
        } catch (error) {
            this.logger.error('Error testing intent flow', { companyId, error: error.message });
            return { success: false, error: error.message };
        }
    }

    /**
     * Generate sample response based on intent
     */
    generateSampleResponse(intent, input) {
        const responses = {
            'service_issue': "I understand you're having an issue with your AC. Let me help you get that fixed right away. Can you tell me your name and the best phone number to reach you?",
            'booking_request': "I'd be happy to help you schedule an appointment. What type of service do you need, and when would work best for you?",
            'information_request': "I can help you with that information. Let me look that up for you.",
            'transfer_request': "Of course, I can connect you with one of our team members. Please hold for just a moment.",
            'after_hours': "Thank you for calling! We're currently closed, but I can help you schedule a callback or handle emergency service requests.",
            'fallback': "Thank you for calling! How can I help you today?"
        };
        
        return responses[intent.intentId] || responses['fallback'];
    }

    /**
     * Get intent routing performance metrics
     */
    async getPerformanceMetrics(companyId, timeRange = '24h') {
        try {
            // In a real implementation, this would query analytics database
            const metrics = {
                intentAccuracy: 94,
                routingSpeed: 0.3,
                fallbackRate: 8,
                totalIntents: 1247,
                timeRange,
                breakdown: {
                    'service_issue': { count: 450, accuracy: 96 },
                    'booking_request': { count: 380, accuracy: 92 },
                    'information_request': { count: 280, accuracy: 89 },
                    'transfer_request': { count: 87, accuracy: 98 },
                    'after_hours': { count: 50, accuracy: 100 }
                }
            };
            
            return { success: true, data: metrics };
        } catch (error) {
            this.logger.error('Error getting performance metrics', { companyId, error: error.message });
            return { success: false, error: error.message };
        }
    }
}

module.exports = new IntentRoutingService();
