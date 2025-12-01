// ============================================================================
// 🤖 ORCHESTRATION HEALTH CHECK SERVICE
// ============================================================================
// Purpose: Comprehensive health monitoring for LLM-0 Orchestration Engine
//
// Components Monitored:
// 1. Preprocessing (FillerStripper, TranscriptNormalizer)
// 2. Intelligence (EmotionDetector)
// 3. Routing (MicroLLMRouter, CompactPromptCompiler)
// 4. Personality (HumanLayerAssembler)
// 5. LLM Connectivity (gpt-4o-mini API)
//
// Integration:
// - Called by DependencyHealthMonitor
// - Called by Agent Status API
// - Results logged to HealthCheckLog
// ============================================================================

const logger = require('../utils/logger');
const openai = require('../clients/openaiClient');

class OrchestrationHealthCheck {
    
    /**
     * Run comprehensive health check of entire orchestration pipeline
     * @returns {Promise<Object>} Health status with component details
     */
    static async checkOrchestrationPipeline() {
        const startTime = Date.now();
        
        try {
            logger.info('🤖 [ORCHESTRATION HEALTH] Running pipeline health check');
            
            // Run all checks in parallel
            const [
                preprocessingHealth,
                intelligenceHealth,
                routingHealth,
                personalityHealth,
                llmHealth
            ] = await Promise.all([
                this.checkPreprocessing(),
                this.checkIntelligence(),
                this.checkRouting(),
                this.checkPersonality(),
                this.checkMicroLLM()
            ]);
            
            const totalDuration = Date.now() - startTime;
            
            // Calculate overall status
            const allChecks = [
                preprocessingHealth,
                intelligenceHealth,
                routingHealth,
                personalityHealth,
                llmHealth
            ];
            
            const criticalDown = allChecks.filter(c => c.status === 'DOWN' && c.critical).length;
            const anyDegraded = allChecks.filter(c => c.status === 'DEGRADED').length;
            
            let overallStatus;
            if (criticalDown > 0) {
                overallStatus = 'CRITICAL';
            } else if (anyDegraded > 0) {
                overallStatus = 'DEGRADED';
            } else {
                overallStatus = 'HEALTHY';
            }
            
            return {
                timestamp: new Date(),
                overallStatus,
                totalDuration,
                components: {
                    preprocessing: preprocessingHealth,
                    intelligence: intelligenceHealth,
                    routing: routingHealth,
                    personality: personalityHealth,
                    microLLM: llmHealth
                }
            };
            
        } catch (error) {
            logger.error('❌ [ORCHESTRATION HEALTH] Pipeline check failed:', error);
            return {
                timestamp: new Date(),
                overallStatus: 'DOWN',
                totalDuration: Date.now() - startTime,
                error: error.message
            };
        }
    }
    
    /**
     * Check Preprocessing Components (FillerStripper, TranscriptNormalizer)
     */
    static async checkPreprocessing() {
        const startTime = Date.now();
        
        try {
            // Load components
            const FillerStripper = require('../src/services/orchestration/preprocessing/FillerStripper');
            const TranscriptNormalizer = require('../src/services/orchestration/preprocessing/TranscriptNormalizer');
            
            // Test FillerStripper
            const testInput = "um, like, you know, my AC is broken";
            const stripped = FillerStripper.strip(testInput);
            
            if (!stripped || stripped === testInput) {
                throw new Error('FillerStripper not working');
            }
            
            // Test TranscriptNormalizer
            const normalized = TranscriptNormalizer.normalize(testInput);
            
            if (!normalized) {
                throw new Error('TranscriptNormalizer not working');
            }
            
            const responseTime = Date.now() - startTime;
            
            return {
                name: 'Preprocessing',
                status: responseTime > 10 ? 'DEGRADED' : 'HEALTHY',
                critical: false, // Non-critical - system can work without preprocessing
                message: `FillerStripper & TranscriptNormalizer operational`,
                responseTime,
                details: {
                    components: ['FillerStripper', 'TranscriptNormalizer'],
                    testPassed: true
                }
            };
            
        } catch (error) {
            return {
                name: 'Preprocessing',
                status: 'DOWN',
                critical: false,
                message: `Preprocessing failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                impact: 'Degraded quality - raw transcripts used without cleaning'
            };
        }
    }
    
    /**
     * Check Intelligence Components (EmotionDetector)
     */
    static async checkIntelligence() {
        const startTime = Date.now();
        
        try {
            const EmotionDetector = require('../src/services/orchestration/intelligence/EmotionDetector');
            
            // Test emotion detection
            const testInput = "I'm so frustrated! My AC is broken again!";
            const emotion = EmotionDetector.analyze(testInput);
            
            if (!emotion || !emotion.primary || emotion.intensity === undefined) {
                throw new Error('EmotionDetector not returning valid results');
            }
            
            const responseTime = Date.now() - startTime;
            
            return {
                name: 'Intelligence',
                status: responseTime > 25 ? 'DEGRADED' : 'HEALTHY',
                critical: false, // Non-critical - system can work without emotion detection
                message: `EmotionDetector operational (detected: ${emotion.primary})`,
                responseTime,
                details: {
                    components: ['EmotionDetector'],
                    testPassed: true,
                    sampleEmotion: emotion.primary
                }
            };
            
        } catch (error) {
            return {
                name: 'Intelligence',
                status: 'DOWN',
                critical: false,
                message: `Intelligence failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                impact: 'Reduced empathy - responses less personalized'
            };
        }
    }
    
    /**
     * Check Routing Components (MicroLLMRouter, CompactPromptCompiler)
     */
    static async checkRouting() {
        const startTime = Date.now();
        
        try {
            const MicroLLMRouter = require('../src/services/orchestration/routing/MicroLLMRouter');
            const CompactPromptCompiler = require('../src/services/orchestration/routing/CompactPromptCompiler');
            
            // Verify components load
            if (!MicroLLMRouter || !CompactPromptCompiler) {
                throw new Error('Routing components not loaded');
            }
            
            // Note: We don't actually call the LLM here (that's tested in checkMicroLLM)
            // This just verifies the components are loadable
            
            const responseTime = Date.now() - startTime;
            
            return {
                name: 'Routing',
                status: 'HEALTHY',
                critical: true, // CRITICAL - core routing logic
                message: `MicroLLMRouter & CompactPromptCompiler loaded`,
                responseTime,
                details: {
                    components: ['MicroLLMRouter', 'CompactPromptCompiler'],
                    note: 'LLM connectivity tested separately'
                }
            };
            
        } catch (error) {
            return {
                name: 'Routing',
                status: 'DOWN',
                critical: true,
                message: `Routing components failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                impact: 'CRITICAL - Cannot route calls'
            };
        }
    }
    
    /**
     * Check Personality Components (HumanLayerAssembler)
     */
    static async checkPersonality() {
        const startTime = Date.now();
        
        try {
            const HumanLayerAssembler = require('../src/services/orchestration/personality/HumanLayerAssembler');
            
            // Test response assembly
            const testContext = {
                routing: { thought: 'user needs AC repair', confidence: 0.95 },
                memory: { callerHistory: [{ firstName: 'John', totalCount: 1 }] },
                emotion: { primary: 'FRUSTRATED', intensity: 0.8 },
                company: { companyName: 'Test HVAC' }
            };
            
            const response = HumanLayerAssembler.build(testContext);
            
            if (!response || response.length === 0) {
                throw new Error('HumanLayerAssembler not generating responses');
            }
            
            const responseTime = Date.now() - startTime;
            
            return {
                name: 'Personality',
                status: responseTime > 15 ? 'DEGRADED' : 'HEALTHY',
                critical: false, // Non-critical - system can work with simpler responses
                message: `HumanLayerAssembler operational`,
                responseTime,
                details: {
                    components: ['HumanLayerAssembler'],
                    testPassed: true,
                    sampleResponseLength: response.length
                }
            };
            
        } catch (error) {
            return {
                name: 'Personality',
                status: 'DOWN',
                critical: false,
                message: `Personality failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                impact: 'Reduced personality - responses less human-like'
            };
        }
    }
    
    /**
     * Check Micro-LLM (gpt-4o-mini) Connectivity
     * This is CRITICAL for LLM-0 routing to work
     */
    static async checkMicroLLM() {
        const startTime = Date.now();
        
        try {
            // Check API key
            const apiKey = process.env.OPENAI_API_KEY;
            
            if (!apiKey) {
                return {
                    name: 'Micro-LLM (gpt-4o-mini)',
                    status: 'DOWN',
                    critical: true, // CRITICAL - LLM-0 cannot route without it
                    message: 'OPENAI_API_KEY not configured',
                    responseTime: Date.now() - startTime,
                    missingVars: ['OPENAI_API_KEY'],
                    impact: 'CRITICAL - LLM-0 routing engine completely down',
                    action: 'Set OPENAI_API_KEY in environment variables'
                };
            }
            
            // Verify API key format
            const validFormat = apiKey.startsWith('sk-') && apiKey.length > 40;
            
            if (!validFormat) {
                return {
                    name: 'Micro-LLM (gpt-4o-mini)',
                    status: 'DOWN',
                    critical: true,
                    message: 'OPENAI_API_KEY invalid format',
                    responseTime: Date.now() - startTime,
                    impact: 'CRITICAL - LLM-0 routing engine down',
                    action: 'Verify OPENAI_API_KEY is correct'
                };
            }
            
            // Test actual API call with minimal tokens
            if (!openai) {
                throw new Error('OpenAI client not initialized');
            }
            
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a health check assistant.' },
                    { role: 'user', content: 'Reply with "OK"' }
                ],
                max_tokens: 5,
                temperature: 0
            });
            
            const responseTime = Date.now() - startTime;
            const responseText = completion.choices[0]?.message?.content || '';
            
            // Check response time for degraded status
            let status = 'HEALTHY';
            let message = 'gpt-4o-mini API operational';
            
            if (responseTime > 3000) {
                status = 'DEGRADED';
                message = `gpt-4o-mini API slow (${responseTime}ms)`;
            } else if (responseTime > 1000) {
                status = 'DEGRADED';
                message = `gpt-4o-mini elevated latency (${responseTime}ms)`;
            }
            
            return {
                name: 'Micro-LLM (gpt-4o-mini)',
                status,
                critical: true, // CRITICAL for LLM-0
                message,
                responseTime,
                details: {
                    model: 'gpt-4o-mini',
                    apiKeyConfigured: true,
                    apiKeyFormat: 'valid',
                    testResponse: responseText.substring(0, 20),
                    tokensUsed: completion.usage?.total_tokens || 0
                }
            };
            
        } catch (error) {
            return {
                name: 'Micro-LLM (gpt-4o-mini)',
                status: 'DOWN',
                critical: true,
                message: `gpt-4o-mini API failed: ${error.message}`,
                responseTime: Date.now() - startTime,
                impact: 'CRITICAL - LLM-0 routing engine completely down',
                error: error.message
            };
        }
    }
}

module.exports = OrchestrationHealthCheck;

