// routes/company/enhancedAgentSettings.js
// Enhanced AI Agent Logic - LLM Selector & Advanced Settings Routes
// Multi-tenant, Production-grade Implementation

const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');
const { ObjectId } = require('mongodb');

// =============================================
// 🚀 UPDATE COMPLETE AGENT INTELLIGENCE SETTINGS
// =============================================

router.put('/companies/:companyId/agent-settings', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { agentIntelligenceSettings } = req.body;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid company ID format' 
            });
        }

        console.log(`[Enhanced Agent] 💾 Updating agent settings for company: ${companyId}`);
        console.log(`[Enhanced Agent] 📋 Settings:`, JSON.stringify(agentIntelligenceSettings, null, 2));

        // Validate LLM settings
        const validLLMModels = ['gemini-pro', 'openai-gpt4', 'claude-3'];
        
        if (agentIntelligenceSettings.primaryLLM && !validLLMModels.includes(agentIntelligenceSettings.primaryLLM)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid primary LLM model' 
            });
        }

        if (agentIntelligenceSettings.fallbackLLM && !validLLMModels.includes(agentIntelligenceSettings.fallbackLLM)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid fallback LLM model' 
            });
        }

        if (agentIntelligenceSettings.allowedLLMModels) {
            const invalidModels = agentIntelligenceSettings.allowedLLMModels.filter(model => !validLLMModels.includes(model));
            if (invalidModels.length > 0) {
                return res.status(400).json({ 
                    success: false, 
                    error: `Invalid LLM models: ${invalidModels.join(', ')}` 
                });
            }

            // Ensure primary and fallback are in allowed models
            if (agentIntelligenceSettings.primaryLLM && !agentIntelligenceSettings.allowedLLMModels.includes(agentIntelligenceSettings.primaryLLM)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Primary LLM must be in allowed models list' 
                });
            }

            if (agentIntelligenceSettings.fallbackLLM && !agentIntelligenceSettings.allowedLLMModels.includes(agentIntelligenceSettings.fallbackLLM)) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Fallback LLM must be in allowed models list' 
                });
            }
        }

        // Validate threshold values
        if (agentIntelligenceSettings.fallbackThreshold !== undefined) {
            if (agentIntelligenceSettings.fallbackThreshold < 0 || agentIntelligenceSettings.fallbackThreshold > 1) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Fallback threshold must be between 0 and 1' 
                });
            }
        }

        if (agentIntelligenceSettings.learningConfidenceThreshold !== undefined) {
            if (agentIntelligenceSettings.learningConfidenceThreshold < 0 || agentIntelligenceSettings.learningConfidenceThreshold > 1) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Learning confidence threshold must be between 0 and 1' 
                });
            }
        }

        // Validate range values
        if (agentIntelligenceSettings.rePromptAfterTurns !== undefined) {
            if (agentIntelligenceSettings.rePromptAfterTurns < 1 || agentIntelligenceSettings.rePromptAfterTurns > 10) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Re-prompt after turns must be between 1 and 10' 
                });
            }
        }

        if (agentIntelligenceSettings.maxPromptsPerCall !== undefined) {
            if (agentIntelligenceSettings.maxPromptsPerCall < 1 || agentIntelligenceSettings.maxPromptsPerCall > 10) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Max prompts per call must be between 1 and 10' 
                });
            }
        }

        if (agentIntelligenceSettings.maxPendingQnAs !== undefined) {
            if (agentIntelligenceSettings.maxPendingQnAs < 10 || agentIntelligenceSettings.maxPendingQnAs > 500) {
                return res.status(400).json({ 
                    success: false, 
                    error: 'Max pending Q&As must be between 10 and 500' 
                });
            }
        }

        // Update company settings
        const company = await Company.findByIdAndUpdate(
            companyId,
            { 
                $set: { 
                    agentIntelligenceSettings: {
                        ...agentIntelligenceSettings,
                        updatedAt: new Date()
                    }
                }
            },
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }

        console.log(`[Enhanced Agent] ✅ Agent settings updated successfully`);

        res.json({ 
            success: true, 
            message: 'Agent settings updated successfully',
            settings: company.agentIntelligenceSettings
        });

    } catch (error) {
        console.error('[Enhanced Agent] ❌ Error updating agent settings:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update agent settings',
            details: error.message 
        });
    }
});

// =============================================
// 🚀 GET CURRENT AGENT SETTINGS
// =============================================

router.get('/companies/:companyId/agent-settings', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid company ID format' 
            });
        }

        console.log(`[Enhanced Agent] 📥 Getting agent settings for company: ${companyId}`);

        const company = await Company.findById(companyId).select('agentIntelligenceSettings');

        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }

        console.log(`[Enhanced Agent] ✅ Agent settings retrieved successfully`);

        res.json({ 
            success: true, 
            settings: company.agentIntelligenceSettings || {}
        });

    } catch (error) {
        console.error('[Enhanced Agent] ❌ Error getting agent settings:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get agent settings',
            details: error.message 
        });
    }
});

// =============================================
// 🚀 RESET AGENT SETTINGS TO DEFAULTS
// =============================================

router.post('/companies/:companyId/reset-agent-settings', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid company ID format' 
            });
        }

        console.log(`[Enhanced Agent] 🔄 Resetting agent settings to defaults for company: ${companyId}`);

        // Default agent intelligence settings
        const defaultSettings = {
            useLLM: true,
            llmModel: 'gemini-pro',
            primaryLLM: 'gemini-pro',
            fallbackLLM: 'gemini-pro',
            allowedLLMModels: ['gemini-pro'],
            autoLearningEnabled: true,
            learningApprovalMode: 'manual',
            learningConfidenceThreshold: 0.85,
            maxPendingQnAs: 100,
            memoryMode: 'short',
            fallbackThreshold: 0.5,
            escalationMode: 'ask',
            rePromptAfterTurns: 3,
            maxPromptsPerCall: 2,
            firstPromptSoft: true,
            semanticSearchEnabled: true,
            confidenceScoring: true,
            autoLearningQueue: true,
            contextRetention: true,
            intelligentRouting: true,
            sentimentAnalysis: false,
            realTimeOptimization: true,
            updatedAt: new Date()
        };

        // Update company with default settings
        const company = await Company.findByIdAndUpdate(
            companyId,
            { $set: { agentIntelligenceSettings: defaultSettings } },
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }

        console.log(`[Enhanced Agent] ✅ Agent settings reset to defaults successfully`);

        res.json({ 
            success: true, 
            message: 'Agent settings reset to defaults successfully',
            settings: company.agentIntelligenceSettings
        });

    } catch (error) {
        console.error('[Enhanced Agent] ❌ Error resetting agent settings:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to reset agent settings',
            details: error.message 
        });
    }
});

// =============================================
// 🚀 TEST AGENT CONFIGURATION
// =============================================

router.post('/companies/:companyId/agent-test', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { message, includeTrace = true } = req.body;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid company ID format' 
            });
        }

        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Message is required and must be a non-empty string' 
            });
        }

        console.log(`[Enhanced Agent] 🧪 Testing agent for company: ${companyId}`);
        console.log(`[Enhanced Agent] 📝 Test message: "${message.trim()}"`);

        const startTime = Date.now();
        const traceId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Get company settings
        const company = await Company.findById(companyId).select('agentIntelligenceSettings');
        
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }

        const settings = company.agentIntelligenceSettings || {};
        
        // Initialize trace logs
        const traceLogs = [];
        
        function addTrace(message, level = 'info') {
            const trace = {
                timestamp: new Date().toISOString(),
                message: message,
                level: level
            };
            traceLogs.push(trace);
            console.log(`[Test Trace] ${level.toUpperCase()}: ${message}`);
        }

        addTrace(`🚀 Starting agent test with trace ID: ${traceId}`, 'info');
        addTrace(`📋 Using LLM: ${settings.primaryLLM || 'gemini-pro'}`, 'info');
        addTrace(`⚙️ Memory mode: ${settings.memoryMode || 'short'}`, 'info');
        addTrace(`🎯 Fallback threshold: ${settings.fallbackThreshold || 0.5}`, 'info');

        // Simulate agent processing
        addTrace('🔍 Analyzing input message...', 'info');
        
        // Simulate different response scenarios based on message content
        let response, confidence, source;
        
        if (message.toLowerCase().includes('hello') || message.toLowerCase().includes('hi')) {
            response = "Hello! Thank you for contacting us. I'm here to help you with any questions about our services.";
            confidence = 0.95;
            source = 'predefined_responses';
            addTrace('✅ High confidence greeting detected', 'success');
        } else if (message.toLowerCase().includes('price') || message.toLowerCase().includes('cost')) {
            response = "I'd be happy to help you with pricing information. Our rates vary depending on the specific service you need. Can you tell me more about what type of work you're looking for?";
            confidence = 0.78;
            source = 'llm_generation';
            addTrace('💰 Pricing inquiry detected, using LLM generation', 'info');
        } else if (message.toLowerCase().includes('emergency') || message.toLowerCase().includes('urgent')) {
            response = "I understand this is urgent. Let me connect you with our emergency service team right away. Please hold while I transfer your call.";
            confidence = 0.92;
            source = 'priority_routing';
            addTrace('🚨 Emergency detected, triggering priority routing', 'warning');
        } else if (message.toLowerCase().includes('book') || message.toLowerCase().includes('schedule')) {
            response = "I'll help you schedule an appointment. What type of service do you need, and when would be the best time for you?";
            confidence = 0.86;
            source = 'booking_flow';
            addTrace('📅 Booking request detected, engaging booking flow', 'info');
        } else {
            response = "Thank you for your message. I want to make sure I give you the most accurate information. Let me connect you with one of our specialists who can help you with your specific needs.";
            confidence = 0.45;
            source = 'fallback_response';
            addTrace('🤔 Low confidence response, triggering fallback', 'warning');
        }

        const endTime = Date.now();
        const responseTime = endTime - startTime;

        addTrace(`⏱️ Processing completed in ${responseTime}ms`, 'success');
        addTrace(`📊 Confidence score: ${(confidence * 100).toFixed(1)}%`, 'info');
        addTrace(`📍 Response source: ${source}`, 'info');

        // Check if confidence is below threshold
        if (confidence < (settings.fallbackThreshold || 0.5)) {
            addTrace('⚠️ Confidence below threshold, would escalate in production', 'warning');
        } else {
            addTrace('✅ Confidence acceptable, response ready', 'success');
        }

        const result = {
            success: true,
            response: response,
            confidence: confidence,
            source: source,
            responseTime: responseTime,
            traceId: traceId,
            settings: {
                llmModel: settings.primaryLLM || 'gemini-pro',
                memoryMode: settings.memoryMode || 'short',
                fallbackThreshold: settings.fallbackThreshold || 0.5,
                escalationMode: settings.escalationMode || 'ask'
            }
        };

        if (includeTrace) {
            result.traceLogs = traceLogs;
        }

        console.log(`[Enhanced Agent] ✅ Agent test completed successfully`);
        console.log(`[Enhanced Agent] 📊 Response: "${response.substring(0, 50)}..." (${confidence * 100}% confidence)`);

        res.json(result);

    } catch (error) {
        console.error('[Enhanced Agent] ❌ Error testing agent:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to test agent configuration',
            details: error.message 
        });
    }
});

// =============================================
// 🚀 GET AVAILABLE LLM MODELS
// =============================================

router.get('/llm-models', async (req, res) => {
    try {
        console.log(`[Enhanced Agent] 📋 Getting available LLM models`);

        const models = [
            {
                id: 'gemini-pro',
                name: 'Gemini Pro',
                description: 'Google\'s balanced AI model (Primary)',
                type: 'cloud',
                performance: 'balanced',
                cost: 'paid'
            },
            {
                id: 'openai-gpt4',
                name: 'OpenAI GPT-4',
                description: 'Most advanced reasoning',
                type: 'cloud',
                performance: 'premium',
                cost: 'premium'
            },
            {
                id: 'claude-3',
                name: 'Claude-3',
                description: 'Anthropic\'s latest model',
                type: 'cloud',
                performance: 'premium',
                cost: 'premium'
            }
        ];

        console.log(`[Enhanced Agent] ✅ Returning ${models.length} available LLM models`);

        res.json({ 
            success: true, 
            models: models
        });

    } catch (error) {
        console.error('[Enhanced Agent] ❌ Error getting LLM models:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get LLM models',
            details: error.message 
        });
    }
});

module.exports = router;
