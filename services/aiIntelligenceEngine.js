// services/aiIntelligenceEngine.js
// Super-Intelligent AI Engine with Advanced Capabilities

const Redis = require('redis');
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');

class AIIntelligenceEngine {
    constructor() {
        this.redis = null;
        this.initializeRedis();
    }

    async initializeRedis() {
        try {
            this.redis = Redis.createClient({
                url: process.env.REDIS_URL || 'redis://localhost:6379'
            });
            await this.redis.connect();
            console.log('🧠 AI Intelligence Engine: Redis connected');
        } catch (error) {
            console.error('AI Intelligence Engine: Redis connection failed:', error);
        }
    }

    /**
     * 🔍 Semantic Knowledge Processing
     * Uses confidence threshold to determine response quality
     */
    async processSemanticKnowledge(query, companyId, company) {
        const settings = company?.aiSettings?.semanticKnowledge || {};
        if (!settings.enabled) return null;

        const confidenceThreshold = settings.confidenceThreshold || 0.87;
        
        try {
            // Search company's knowledge base with semantic matching
            const db = getDB();
            const companiesCollection = db.collection('companiesCollection');
            const companyData = await companiesCollection.findOne({ _id: new ObjectId(companyId) });
            
            if (!companyData) return null;

            // Get enterprise trade categories and Q&As
            const tradeCategories = await db.collection('enterpriseTradeCategories').find({}).toArray();
            let bestMatch = null;
            let bestConfidence = 0;

            // Semantic search through all Q&As in enterprise system
            for (const category of tradeCategories) {
                if (category.qnas && category.qnas.length > 0) {
                    for (const qa of category.qnas) {
                        const confidence = this.calculateSemanticSimilarity(query, qa.question);
                        if (confidence > bestConfidence && confidence >= confidenceThreshold) {
                            bestMatch = {
                                question: qa.question,
                                answer: qa.answer,
                                confidence: confidence,
                                source: `${category.name}_qa`,
                                category: category.name
                            };
                            bestConfidence = confidence;
                        }
                    }
                }
            }

            if (bestMatch) {
                console.log(`🔍 Semantic Knowledge: Found match with ${(bestMatch.confidence * 100).toFixed(1)}% confidence`);
                
                // Log performance metrics
                await this.logPerformanceMetric(companyId, 'semantic_knowledge', {
                    confidence: bestMatch.confidence,
                    threshold: confidenceThreshold,
                    query: query,
                    matched: true
                });

                return bestMatch;
            }

            return null;
        } catch (error) {
            console.error('Semantic Knowledge processing error:', error);
            return null;
        }
    }

    /**
     * 🧠 Contextual Memory Management
     * Remembers caller history and personalizes responses
     */
    async getContextualMemory(callerId, companyId, company) {
        const settings = company?.aiSettings?.contextualMemory || {};
        if (!settings.enabled || !this.redis) return {};

        try {
            const personalizationLevel = settings.personalizationLevel || 'medium';
            const retentionHours = settings.memoryRetentionHours || 24;
            
            const memoryKey = `contextual_memory:${companyId}:${callerId}`;
            const memoryData = await this.redis.get(memoryKey);
            
            if (!memoryData) return {};

            const memory = JSON.parse(memoryData);
            const now = new Date();
            const cutoffTime = new Date(now.getTime() - (retentionHours * 60 * 60 * 1000));

            // Filter memory based on personalization level
            let contextLength = 1; // Default: last interaction only
            if (personalizationLevel === 'medium') contextLength = 3;
            if (personalizationLevel === 'high') contextLength = 10;

            const recentContext = memory.interactions
                ?.filter(interaction => new Date(interaction.timestamp) > cutoffTime)
                ?.slice(-contextLength) || [];

            console.log(`🧠 Contextual Memory: Retrieved ${recentContext.length} interactions for personalization level: ${personalizationLevel}`);

            return {
                previousInteractions: recentContext,
                callerPreferences: memory.preferences || {},
                lastCallSummary: memory.lastSummary || null,
                personalizationLevel: personalizationLevel
            };
        } catch (error) {
            console.error('Contextual Memory error:', error);
            return {};
        }
    }

    /**
     * Store interaction in contextual memory
     */
    async storeContextualMemory(callerId, companyId, interaction, company) {
        const settings = company?.aiSettings?.contextualMemory || {};
        if (!settings.enabled || !this.redis) return;

        try {
            const memoryKey = `contextual_memory:${companyId}:${callerId}`;
            const retentionHours = settings.memoryRetentionHours || 24;
            
            let memory = {};
            const existingMemory = await this.redis.get(memoryKey);
            if (existingMemory) {
                memory = JSON.parse(existingMemory);
            }

            if (!memory.interactions) memory.interactions = [];
            
            memory.interactions.push({
                ...interaction,
                timestamp: new Date().toISOString()
            });

            // Keep only recent interactions to prevent memory bloat
            const maxInteractions = 20;
            if (memory.interactions.length > maxInteractions) {
                memory.interactions = memory.interactions.slice(-maxInteractions);
            }

            // Set expiration based on retention hours
            const expirationSeconds = retentionHours * 60 * 60;
            await this.redis.setEx(memoryKey, expirationSeconds, JSON.stringify(memory));

            console.log(`🧠 Contextual Memory: Stored interaction for caller ${callerId}`);
        } catch (error) {
            console.error('Store Contextual Memory error:', error);
        }
    }

    /**
     * 🧠 Dynamic Reasoning (ReAct Framework)
     * Implements Observe → Reason → Act pattern
     */
    async processWithDynamicReasoning(query, context, companyId, company) {
        const settings = company?.aiSettings?.dynamicReasoning || {};
        if (!settings.enabled) return null;

        const maxSteps = settings.maxReasoningSteps || 3;
        const useReAct = settings.useReActFramework || true;

        if (!useReAct) return null;

        try {
            console.log('🧠 Dynamic Reasoning: Starting ReAct framework process');
            
            let reasoningSteps = [];
            let currentStep = 1;
            let finalAnswer = null;

            while (currentStep <= maxSteps && !finalAnswer) {
                // OBSERVE: Analyze current state
                const observation = await this.observe(query, context, reasoningSteps);
                
                // REASON: Determine next action
                const reasoning = await this.reason(observation, query, context);
                
                // ACT: Take action based on reasoning
                const action = await this.act(reasoning, query, companyId, company);
                
                reasoningSteps.push({
                    step: currentStep,
                    observation: observation,
                    reasoning: reasoning,
                    action: action,
                    timestamp: new Date().toISOString()
                });

                if (action.type === 'final_answer') {
                    finalAnswer = action.result;
                    break;
                }

                currentStep++;
            }

            if (finalAnswer) {
                console.log(`🧠 Dynamic Reasoning: Reached conclusion in ${currentStep} steps`);
                return {
                    answer: finalAnswer,
                    reasoningSteps: reasoningSteps,
                    stepsUsed: currentStep,
                    source: 'dynamic_reasoning'
                };
            }

            return null;
        } catch (error) {
            console.error('Dynamic Reasoning error:', error);
            return null;
        }
    }

    /**
     * 🚨 Smart Escalation with Sentiment Analysis
     */
    async checkSmartEscalation(transcript, context, companyId, company) {
        const settings = company?.aiSettings?.smartEscalation || {};
        if (!settings.enabled) return { shouldEscalate: false };

        try {
            let escalationReasons = [];
            let confidenceScore = 0;

            // Sentiment-based escalation
            if (settings.sentimentTrigger) {
                const sentiment = await this.analyzeSentiment(transcript);
                if (sentiment.negative > 0.7 || sentiment.anger > 0.5) {
                    escalationReasons.push('negative_sentiment');
                    confidenceScore += 0.4;
                }
            }

            // Context-based escalation
            if (settings.contextualHandoffs) {
                const contextualFactors = this.analyzeContextualFactors(context, transcript);
                if (contextualFactors.complexity > 0.8) {
                    escalationReasons.push('high_complexity');
                    confidenceScore += 0.3;
                }
                if (contextualFactors.repetitiveQuestions > 2) {
                    escalationReasons.push('repetitive_questions');
                    confidenceScore += 0.3;
                }
            }

            const shouldEscalate = confidenceScore >= 0.5;

            if (shouldEscalate) {
                console.log(`🚨 Smart Escalation: Triggering escalation (confidence: ${confidenceScore.toFixed(2)}) - Reasons: ${escalationReasons.join(', ')}`);
                
                // Log escalation metrics
                await this.logPerformanceMetric(companyId, 'smart_escalation', {
                    triggered: true,
                    confidence: confidenceScore,
                    reasons: escalationReasons,
                    sentiment: await this.analyzeSentiment(transcript)
                });
            }

            return {
                shouldEscalate: shouldEscalate,
                confidence: confidenceScore,
                reasons: escalationReasons
            };
        } catch (error) {
            console.error('Smart Escalation error:', error);
            return { shouldEscalate: false };
        }
    }

    /**
     * 🧪 Test Intelligence Engine
     */
    async testAIIntelligence(companyId, testQuery, featuresEnabled = {}) {
        const startTime = Date.now();
        
        try {
            // Get company data
            const db = getDB();
            const company = await db.collection('companiesCollection').findOne({ _id: new ObjectId(companyId) });
            
            if (!company) {
                throw new Error('Company not found');
            }

            const testResults = {
                companyId: companyId,
                testQuery: testQuery,
                timestamp: new Date().toISOString(),
                features: {},
                performance: {},
                overallScore: 0
            };

            // Test Semantic Knowledge
            if (featuresEnabled.semanticKnowledge !== false) {
                const semanticResult = await this.processSemanticKnowledge(testQuery, companyId, company);
                testResults.features.semanticKnowledge = {
                    enabled: true,
                    result: semanticResult,
                    confidence: semanticResult?.confidence || 0
                };
            }

            // Test Contextual Memory
            if (featuresEnabled.contextualMemory !== false) {
                const memoryResult = await this.getContextualMemory('test_caller', companyId, company);
                testResults.features.contextualMemory = {
                    enabled: true,
                    hasMemory: Object.keys(memoryResult).length > 0,
                    personalizationLevel: memoryResult.personalizationLevel
                };
            }

            // Test Dynamic Reasoning
            if (featuresEnabled.dynamicReasoning !== false) {
                const reasoningResult = await this.processWithDynamicReasoning(testQuery, {}, companyId, company);
                testResults.features.dynamicReasoning = {
                    enabled: true,
                    result: reasoningResult,
                    stepsUsed: reasoningResult?.stepsUsed || 0
                };
            }

            // Test Smart Escalation
            if (featuresEnabled.smartEscalation !== false) {
                const escalationResult = await this.checkSmartEscalation(testQuery, {}, companyId, company);
                testResults.features.smartEscalation = {
                    enabled: true,
                    shouldEscalate: escalationResult.shouldEscalate,
                    confidence: escalationResult.confidence
                };
            }

            // Calculate performance metrics
            const endTime = Date.now();
            const responseTime = (endTime - startTime) / 1000;
            
            testResults.performance = {
                responseTime: responseTime,
                responseTimeTarget: company?.aiSettings?.performanceBenchmarks?.targetResponseTime || 1.8,
                meetsTarget: responseTime <= (company?.aiSettings?.performanceBenchmarks?.targetResponseTime || 1.8)
            };

            // Calculate overall intelligence score
            let scoreComponents = [];
            if (testResults.features.semanticKnowledge?.result) scoreComponents.push(testResults.features.semanticKnowledge.confidence);
            if (testResults.features.dynamicReasoning?.result) scoreComponents.push(0.9);
            if (testResults.features.contextualMemory?.hasMemory) scoreComponents.push(0.8);
            if (testResults.performance.meetsTarget) scoreComponents.push(0.9);

            testResults.overallScore = scoreComponents.length > 0 
                ? scoreComponents.reduce((a, b) => a + b, 0) / scoreComponents.length 
                : 0;

            console.log(`🧪 AI Intelligence Test Complete: ${(testResults.overallScore * 100).toFixed(1)}% score in ${responseTime.toFixed(2)}s`);

            return testResults;
        } catch (error) {
            console.error('AI Intelligence Test error:', error);
            throw error;
        }
    }

    /**
     * Helper methods for AI processing
     */
    calculateSemanticSimilarity(query1, query2) {
        // Simple implementation - can be enhanced with embeddings
        const words1 = query1.toLowerCase().split(/\W+/);
        const words2 = query2.toLowerCase().split(/\W+/);
        
        const intersection = words1.filter(word => words2.includes(word));
        const union = [...new Set([...words1, ...words2])];
        
        const similarity = intersection.length / union.length;
        
        // Boost score for exact phrase matches
        if (query2.toLowerCase().includes(query1.toLowerCase()) || 
            query1.toLowerCase().includes(query2.toLowerCase())) {
            return Math.min(similarity + 0.3, 1.0);
        }
        
        return similarity;
    }

    async observe(query, context, previousSteps) {
        return {
            query: query,
            contextAvailable: Object.keys(context).length > 0,
            previousStepsCount: previousSteps.length,
            queryComplexity: this.assessQueryComplexity(query)
        };
    }

    async reason(observation, query, context) {
        if (observation.queryComplexity > 0.7) {
            return {
                type: 'complex_query',
                action: 'search_knowledge_base',
                confidence: 0.8
            };
        } else if (observation.previousStepsCount === 0) {
            return {
                type: 'initial_query',
                action: 'semantic_search',
                confidence: 0.9
            };
        } else {
            return {
                type: 'follow_up',
                action: 'provide_answer',
                confidence: 0.7
            };
        }
    }

    async act(reasoning, query, companyId, company) {
        switch (reasoning.action) {
            case 'semantic_search':
                const semanticResult = await this.processSemanticKnowledge(query, companyId, company);
                if (semanticResult) {
                    return {
                        type: 'final_answer',
                        result: semanticResult.answer,
                        confidence: semanticResult.confidence
                    };
                }
                return { type: 'continue', result: 'No semantic match found' };
                
            case 'provide_answer':
                // Local LLM disabled - use contextual fallback directly
                console.log(`[AI Intelligence] Local LLM disabled - using contextual fallback for: "${query}"`);
                
                // Generate contextual response based on query type
                const contextualResponse = this.generateContextualFallback(query, company);
                return {
                    type: 'final_answer',
                    result: contextualResponse,
                    confidence: Math.max(0.3, reasoning.confidence)
                };
                
            default:
                return { type: 'continue', result: 'Processing...' };
        }
    }

    generateContextualFallback(query, company) {
        const q = query.toLowerCase();
        const companyName = company?.companyName || 'our company';
        
        // Detect query type and provide appropriate response
        if (q.includes('hour') || q.includes('open') || q.includes('close')) {
            return `I'd be happy to help you with our hours. Let me connect you with someone who can provide our current schedule.`;
        }
        
        if (q.includes('price') || q.includes('cost') || q.includes('charge') || q.includes('much')) {
            return `Pricing depends on the specific service needed. I can connect you with someone who can provide an accurate quote.`;
        }
        
        if (q.includes('emergency') || q.includes('urgent') || q.includes('asap')) {
            return `I understand this is urgent. Let me get you connected with our emergency service team right away.`;
        }
        
        if (q.includes('appointment') || q.includes('schedule') || q.includes('book')) {
            return `I can help you schedule an appointment. Let me connect you with our scheduling team to find the best time.`;
        }
        
        if (q.includes('leak') || q.includes('broken') || q.includes('not work') || q.includes('problem')) {
            return `That sounds like something our technicians can definitely help with. Let me connect you with someone who can assess the situation.`;
        }
        
        // Default but more helpful response
        return `I want to make sure you get the exact help you need. Let me connect you with one of our specialists who can provide detailed assistance.`;
    }

    async analyzeSentiment(text) {
        // Simple sentiment analysis - can be enhanced with external APIs
        const negativeWords = ['angry', 'frustrated', 'upset', 'mad', 'terrible', 'awful', 'hate', 'worst'];
        const positiveWords = ['great', 'good', 'excellent', 'amazing', 'wonderful', 'love', 'best'];
        
        const words = text.toLowerCase().split(/\W+/);
        const negativeCount = words.filter(word => negativeWords.includes(word)).length;
        const positiveCount = words.filter(word => positiveWords.includes(word)).length;
        
        return {
            negative: Math.min(negativeCount / words.length * 10, 1),
            positive: Math.min(positiveCount / words.length * 10, 1),
            anger: negativeCount > 2 ? 0.8 : 0.2
        };
    }

    analyzeContextualFactors(context, transcript) {
        return {
            complexity: transcript.length > 200 ? 0.8 : 0.3,
            repetitiveQuestions: context.questionCount || 0
        };
    }

    assessQueryComplexity(query) {
        const complexWords = ['how', 'why', 'when', 'where', 'complex', 'multiple', 'several'];
        const words = query.toLowerCase().split(/\W+/);
        const complexCount = words.filter(word => complexWords.includes(word)).length;
        return Math.min(complexCount / words.length * 3, 1);
    }

    async logPerformanceMetric(companyId, metricType, data) {
        if (!this.redis) return;
        
        try {
            const metricKey = `ai_performance:${companyId}:${metricType}:${Date.now()}`;
            const metricData = {
                timestamp: new Date().toISOString(),
                type: metricType,
                data: data
            };
            
            // Store with 7-day expiration
            await this.redis.setEx(metricKey, 7 * 24 * 60 * 60, JSON.stringify(metricData));
        } catch (error) {
            console.error('Performance metric logging error:', error);
        }
    }
}

module.exports = new AIIntelligenceEngine();
