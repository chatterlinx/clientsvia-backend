// ============================================================================
// 🏎️ ORCHESTRATION HEALTH CHECK SERVICE - INDY 500 GRADE
// ============================================================================
// Purpose: COMPREHENSIVE health monitoring for LLM-0 Orchestration Engine
// Philosophy: NO MASKING - Full transparency, detailed checkpoints, expose all weaknesses
//
// Components Monitored (with granular checkpoints):
// 1. Preprocessing (FillerStripper, TranscriptNormalizer)
// 2. Intelligence (EmotionDetector)
// 3. Routing (MicroLLMRouter, CompactPromptCompiler)
// 4. Personality (HumanLayerAssembler)
// 5. LLM Connectivity (gpt-4o-mini API)
//
// PERFORMANCE THRESHOLDS (Production-Grade):
// - Component Load: < 5ms (HEALTHY), 5-15ms (DEGRADED), >15ms (SLOW)
// - Test Execution: < 10ms (HEALTHY), 10-50ms (DEGRADED), >50ms (SLOW)
// - LLM Response: < 500ms (HEALTHY), 500-1000ms (DEGRADED), >1000ms (SLOW)
//
// Integration:
// - Called by DependencyHealthMonitor
// - Called by Agent Status API
// - Results displayed in Service Health panel
// ============================================================================

const logger = require('../utils/logger');
const openai = require('../config/openai');

class OrchestrationHealthCheck {
    
    // ========================================================================
    // PERFORMANCE THRESHOLDS (Realistic Production Grade)
    // ========================================================================
    // NOTE: Thresholds adjusted 2025-12-03 for realistic production variance
    // Preprocessing: 10-80ms normal, 100ms+ is concerning
    // LLM: Cold start 800-2000ms, Warm 300-800ms (OpenAI has variance)
    // Old values were too aggressive, causing false DEGRADED alerts
    static THRESHOLDS = {
        componentLoad: { healthy: 10, degraded: 30 },     // ms - local module load
        testExecution: { healthy: 50, degraded: 100 },    // ms - preprocessing/local tests
        llmResponse: { healthy: 1000, degraded: 2000 },   // ms - OpenAI API (network variance)
        totalPipeline: { healthy: 500, degraded: 1500 }   // ms - full pipeline
    };
    
    /**
     * Run comprehensive health check of entire orchestration pipeline
     * Returns detailed checkpoints for every component
     * @returns {Promise<Object>} Health status with component details
     */
    static async checkOrchestrationPipeline() {
        const startTime = Date.now();
        const pipelineCheckpoints = [];
        
        try {
            logger.info('🏎️ [ORCHESTRATION HEALTH] Running INDY 500 grade pipeline check');
            
            pipelineCheckpoints.push({
                name: 'Pipeline initialization',
                status: 'passed',
                timestamp: new Date().toISOString()
            });
            
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
            
            // Collect all components
            const allChecks = [
                preprocessingHealth,
                intelligenceHealth,
                routingHealth,
                personalityHealth,
                llmHealth
            ];
            
            // ================================================================
            // DETAILED ANALYSIS - No Masking!
            // ================================================================
            const criticalDown = allChecks.filter(c => c.status === 'DOWN' && c.critical);
            const degraded = allChecks.filter(c => c.status === 'DEGRADED');
            const healthy = allChecks.filter(c => c.status === 'HEALTHY');
            const down = allChecks.filter(c => c.status === 'DOWN');
            
            // Calculate overall status
            let overallStatus;
            let statusReason;
            
            if (criticalDown.length > 0) {
                overallStatus = 'CRITICAL';
                statusReason = `CRITICAL: ${criticalDown.map(c => c.name).join(', ')} down`;
            } else if (down.length > 0) {
                overallStatus = 'DOWN';
                statusReason = `DOWN: ${down.map(c => c.name).join(', ')} failed`;
            } else if (degraded.length > 0) {
                overallStatus = 'DEGRADED';
                statusReason = `DEGRADED: ${degraded.map(c => c.name).join(', ')} slow or impaired`;
            } else {
                overallStatus = 'HEALTHY';
                statusReason = 'All 5 components operational';
            }
            
            // Pipeline duration check
            let pipelinePerformance = 'EXCELLENT';
            if (totalDuration > this.THRESHOLDS.totalPipeline.degraded) {
                pipelinePerformance = 'SLOW';
            } else if (totalDuration > this.THRESHOLDS.totalPipeline.healthy) {
                pipelinePerformance = 'ACCEPTABLE';
            }
            
            pipelineCheckpoints.push({
                name: 'All components checked',
                status: 'passed',
                duration: `${totalDuration}ms`,
                performance: pipelinePerformance
            });
            
            // ================================================================
            // BUILD COMPREHENSIVE RESULT
            // ================================================================
            return {
                timestamp: new Date(),
                overallStatus,
                statusReason,
                totalDuration,
                pipelinePerformance,
                pipelineCheckpoints,
                
                // Detailed component breakdown
                components: [
                    preprocessingHealth,
                    intelligenceHealth,
                    routingHealth,
                    personalityHealth,
                    llmHealth
                ],
                
                // Summary stats (for quick debugging)
                summary: {
                    total: allChecks.length,
                    healthy: healthy.length,
                    degraded: degraded.length,
                    down: down.length,
                    critical: criticalDown.length,
                    slowestComponent: this.findSlowest(allChecks),
                    fastestComponent: this.findFastest(allChecks)
                },
                
                // Performance breakdown
                performanceBreakdown: {
                    preprocessing: preprocessingHealth.responseTime,
                    intelligence: intelligenceHealth.responseTime,
                    routing: routingHealth.responseTime,
                    personality: personalityHealth.responseTime,
                    microLLM: llmHealth.responseTime,
                    total: totalDuration
                },
                
                // Root cause if not healthy
                rootCause: overallStatus !== 'HEALTHY' ? {
                    affectedComponents: [...criticalDown, ...down, ...degraded].map(c => ({
                        name: c.name,
                        status: c.status,
                        reason: c.message,
                        impact: c.impact || 'Unknown'
                    })),
                    recommendedAction: this.getRecommendedAction(overallStatus, [...criticalDown, ...down, ...degraded])
                } : null
            };
            
        } catch (error) {
            logger.error('❌ [ORCHESTRATION HEALTH] Pipeline check CRASHED:', error);
            
            return {
                timestamp: new Date(),
                overallStatus: 'CRITICAL',
                statusReason: `Pipeline check crashed: ${error.message}`,
                totalDuration: Date.now() - startTime,
                pipelineCheckpoints: [
                    ...pipelineCheckpoints,
                    {
                        name: 'Pipeline execution',
                        status: 'CRASHED',
                        error: error.message,
                        stack: error.stack?.split('\n').slice(0, 5).join('\n')
                    }
                ],
                error: {
                    message: error.message,
                    stack: error.stack,
                    name: error.name
                }
            };
        }
    }
    
    /**
     * Check Preprocessing Components (FillerStripper, TranscriptNormalizer)
     * DETAILED CHECKPOINTS - No masking!
     */
    static async checkPreprocessing() {
        const startTime = Date.now();
        const checkpoints = [];
        
        // Checkpoint 1: Module load
        const loadStart = Date.now();
        let FillerStripper, TranscriptNormalizer;
        
        try {
            FillerStripper = require('../src/services/orchestration/preprocessing/FillerStripper');
            checkpoints.push({
                name: 'FillerStripper module load',
                status: 'passed',
                duration: `${Date.now() - loadStart}ms`
            });
        } catch (err) {
            checkpoints.push({
                name: 'FillerStripper module load',
                status: 'FAILED',
                error: err.message,
                path: '../src/services/orchestration/preprocessing/FillerStripper'
            });
            return this.buildFailedResult('Preprocessing', checkpoints, startTime, 
                'FillerStripper module not found', false);
        }
        
        const loadStart2 = Date.now();
        try {
            TranscriptNormalizer = require('../src/services/orchestration/preprocessing/TranscriptNormalizer');
            checkpoints.push({
                name: 'TranscriptNormalizer module load',
                status: 'passed',
                duration: `${Date.now() - loadStart2}ms`
            });
        } catch (err) {
            checkpoints.push({
                name: 'TranscriptNormalizer module load',
                status: 'FAILED',
                error: err.message,
                path: '../src/services/orchestration/preprocessing/TranscriptNormalizer'
            });
            return this.buildFailedResult('Preprocessing', checkpoints, startTime,
                'TranscriptNormalizer module not found', false);
        }
        
        // Checkpoint 2: FillerStripper functionality
        // NOTE: Method is .clean() not .strip() - fixed 2025-12-01
        const testInput = "um, like, you know, my AC is broken";
        const stripStart = Date.now();
        let stripped;
        
        try {
            stripped = FillerStripper.clean(testInput);
            const stripTime = Date.now() - stripStart;
            
            checkpoints.push({
                name: 'FillerStripper.clean() execution',
                status: stripped && stripped !== testInput ? 'passed' : 'FAILED',
                duration: `${stripTime}ms`,
                input: testInput,
                output: stripped,
                fillersRemoved: stripped !== testInput
            });
            
            if (!stripped || stripped === testInput) {
                checkpoints.push({
                    name: 'FillerStripper effectiveness',
                    status: 'WARNING',
                    message: 'No fillers were removed - check filler patterns'
                });
            }
        } catch (err) {
            checkpoints.push({
                name: 'FillerStripper.clean() execution',
                status: 'FAILED',
                error: err.message
            });
            return this.buildFailedResult('Preprocessing', checkpoints, startTime,
                `FillerStripper.clean() failed: ${err.message}`, false);
        }
        
        // Checkpoint 3: TranscriptNormalizer functionality
        const normalizeStart = Date.now();
        let normalized;
        
        try {
            normalized = TranscriptNormalizer.normalize(testInput);
            const normalizeTime = Date.now() - normalizeStart;
            
            checkpoints.push({
                name: 'TranscriptNormalizer.normalize() execution',
                status: normalized ? 'passed' : 'FAILED',
                duration: `${normalizeTime}ms`,
                input: testInput,
                output: normalized?.substring(0, 50)
            });
        } catch (err) {
            checkpoints.push({
                name: 'TranscriptNormalizer.normalize() execution',
                status: 'FAILED',
                error: err.message
            });
            return this.buildFailedResult('Preprocessing', checkpoints, startTime,
                `TranscriptNormalizer.normalize() failed: ${err.message}`, false);
        }
        
        const responseTime = Date.now() - startTime;
        
        // Determine status based on performance
        let status = 'HEALTHY';
        let statusReason = 'All preprocessing components operational';
        
        if (responseTime > this.THRESHOLDS.testExecution.degraded) {
            status = 'DEGRADED';
            statusReason = `Preprocessing slow: ${responseTime}ms (threshold: ${this.THRESHOLDS.testExecution.degraded}ms)`;
        } else if (responseTime > this.THRESHOLDS.testExecution.healthy) {
            status = 'DEGRADED';
            statusReason = `Preprocessing elevated latency: ${responseTime}ms`;
        }
        
        checkpoints.push({
            name: 'Total preprocessing time',
            status: status === 'HEALTHY' ? 'passed' : 'WARNING',
            duration: `${responseTime}ms`,
            threshold: `<${this.THRESHOLDS.testExecution.healthy}ms healthy`
        });
        
        return {
            name: 'Preprocessing',
            status,
            statusReason,
            critical: false,
            message: statusReason,
            responseTime,
            checkpoints,
            details: {
                components: ['FillerStripper', 'TranscriptNormalizer'],
                testInput,
                strippedOutput: stripped,
                normalizedOutput: normalized?.substring(0, 50)
            },
            impact: status !== 'HEALTHY' ? 'Degraded quality - raw transcripts may have noise' : null
        };
    }
    
    /**
     * Check Intelligence Components (EmotionDetector)
     * DETAILED CHECKPOINTS
     */
    static async checkIntelligence() {
        const startTime = Date.now();
        const checkpoints = [];
        
        // Checkpoint 1: Module load
        const loadStart = Date.now();
        let EmotionDetector;
        
        try {
            EmotionDetector = require('../src/services/orchestration/intelligence/EmotionDetector');
            checkpoints.push({
                name: 'EmotionDetector module load',
                status: 'passed',
                duration: `${Date.now() - loadStart}ms`
            });
        } catch (err) {
            checkpoints.push({
                name: 'EmotionDetector module load',
                status: 'FAILED',
                error: err.message,
                path: '../src/services/orchestration/intelligence/EmotionDetector'
            });
            return this.buildFailedResult('Intelligence', checkpoints, startTime,
                'EmotionDetector module not found', false);
        }
        
        // Checkpoint 2: Emotion detection test cases
        const testCases = [
            { input: "I'm so frustrated! My AC is broken again!", expectedEmotion: 'FRUSTRATED' },
            { input: "Thank you so much, you've been very helpful!", expectedEmotion: 'HAPPY' },
            { input: "I need to schedule an appointment.", expectedEmotion: 'NEUTRAL' }
        ];
        
        const emotionResults = [];
        
        for (const testCase of testCases) {
            const detectStart = Date.now();
            try {
                const emotion = EmotionDetector.analyze(testCase.input);
                const detectTime = Date.now() - detectStart;
                
                const passed = emotion && emotion.primary && emotion.intensity !== undefined;
                emotionResults.push({
                    input: testCase.input.substring(0, 30) + '...',
                    detected: emotion?.primary || 'NONE',
                    expected: testCase.expectedEmotion,
                    intensity: emotion?.intensity,
                    duration: detectTime,
                    passed
                });
                
                checkpoints.push({
                    name: `Emotion detection: "${testCase.input.substring(0, 20)}..."`,
                    status: passed ? 'passed' : 'FAILED',
                    duration: `${detectTime}ms`,
                    detected: emotion?.primary,
                    intensity: emotion?.intensity
                });
            } catch (err) {
                emotionResults.push({
                    input: testCase.input.substring(0, 30) + '...',
                    error: err.message,
                    passed: false
                });
                checkpoints.push({
                    name: `Emotion detection: "${testCase.input.substring(0, 20)}..."`,
                    status: 'FAILED',
                    error: err.message
                });
            }
        }
        
        const responseTime = Date.now() - startTime;
        const passedTests = emotionResults.filter(r => r.passed).length;
        
        // Determine status
        let status = 'HEALTHY';
        let statusReason = `EmotionDetector operational (${passedTests}/${testCases.length} tests passed)`;
        
        if (passedTests === 0) {
            status = 'DOWN';
            statusReason = 'EmotionDetector not returning valid results';
        } else if (passedTests < testCases.length) {
            status = 'DEGRADED';
            statusReason = `EmotionDetector partial failure (${passedTests}/${testCases.length} tests)`;
        } else if (responseTime > this.THRESHOLDS.testExecution.degraded) {
            status = 'DEGRADED';
            statusReason = `EmotionDetector slow: ${responseTime}ms`;
        }
        
        return {
            name: 'Intelligence',
            status,
            statusReason,
            critical: false,
            message: statusReason,
            responseTime,
            checkpoints,
            details: {
                components: ['EmotionDetector'],
                testResults: emotionResults,
                passedTests,
                totalTests: testCases.length
            },
            impact: status !== 'HEALTHY' ? 'Reduced empathy - responses less personalized' : null
        };
    }
    
    /**
     * Check Routing Components (MicroLLMRouter, CompactPromptCompiler)
     * DETAILED CHECKPOINTS
     */
    static async checkRouting() {
        const startTime = Date.now();
        const checkpoints = [];
        
        // Checkpoint 1: MicroLLMRouter load
        const loadStart = Date.now();
        let MicroLLMRouter;
        
        try {
            MicroLLMRouter = require('../src/services/orchestration/routing/MicroLLMRouter');
            checkpoints.push({
                name: 'MicroLLMRouter module load',
                status: 'passed',
                duration: `${Date.now() - loadStart}ms`,
                hasMethods: {
                    route: typeof MicroLLMRouter.route === 'function',
                    classify: typeof MicroLLMRouter.classify === 'function'
                }
            });
        } catch (err) {
            checkpoints.push({
                name: 'MicroLLMRouter module load',
                status: 'FAILED',
                error: err.message,
                path: '../src/services/orchestration/routing/MicroLLMRouter'
            });
            return this.buildFailedResult('Routing', checkpoints, startTime,
                'MicroLLMRouter module not found - CRITICAL', true);
        }
        
        // Checkpoint 2: CompactPromptCompiler load
        const loadStart2 = Date.now();
        let CompactPromptCompiler;
        
        try {
            CompactPromptCompiler = require('../src/services/orchestration/routing/CompactPromptCompiler');
            checkpoints.push({
                name: 'CompactPromptCompiler module load',
                status: 'passed',
                duration: `${Date.now() - loadStart2}ms`,
                hasMethods: {
                    compile: typeof CompactPromptCompiler.compile === 'function'
                }
            });
        } catch (err) {
            checkpoints.push({
                name: 'CompactPromptCompiler module load',
                status: 'FAILED',
                error: err.message,
                path: '../src/services/orchestration/routing/CompactPromptCompiler'
            });
            return this.buildFailedResult('Routing', checkpoints, startTime,
                'CompactPromptCompiler module not found - CRITICAL', true);
        }
        
        // Checkpoint 3: Verify critical methods exist
        // NOTE: CompactPromptCompiler uses getPrompt() not compile() - fixed 2025-12-01
        const methodChecks = [
            { name: 'MicroLLMRouter.route', exists: typeof MicroLLMRouter?.route === 'function' },
            { name: 'CompactPromptCompiler.getPrompt', exists: typeof CompactPromptCompiler?.getPrompt === 'function' }
        ];
        
        for (const check of methodChecks) {
            checkpoints.push({
                name: `Method check: ${check.name}`,
                status: check.exists ? 'passed' : 'FAILED',
                message: check.exists ? 'Method exists' : 'Method NOT FOUND'
            });
        }
        
        const responseTime = Date.now() - startTime;
        const allMethodsExist = methodChecks.every(m => m.exists);
        
        let status = 'HEALTHY';
        let statusReason = 'MicroLLMRouter & CompactPromptCompiler loaded and verified';
        
        if (!allMethodsExist) {
            status = 'DOWN';
            statusReason = 'Critical routing methods missing';
        } else if (responseTime > this.THRESHOLDS.componentLoad.degraded) {
            status = 'DEGRADED';
            statusReason = `Routing components slow to load: ${responseTime}ms`;
        }
        
        return {
            name: 'Routing',
            status,
            statusReason,
            critical: true, // CRITICAL - core routing logic
            message: statusReason,
            responseTime,
            checkpoints,
            details: {
                components: ['MicroLLMRouter', 'CompactPromptCompiler'],
                methodsVerified: methodChecks,
                note: 'LLM connectivity tested separately in Micro-LLM check'
            },
            impact: status !== 'HEALTHY' ? 'CRITICAL - Cannot route calls properly' : null
        };
    }
    
    /**
     * Check Personality Components (HumanLayerAssembler)
     * DETAILED CHECKPOINTS
     */
    static async checkPersonality() {
        const startTime = Date.now();
        const checkpoints = [];
        
        // Checkpoint 1: Module load
        const loadStart = Date.now();
        let HumanLayerAssembler;
        
        try {
            HumanLayerAssembler = require('../src/services/orchestration/personality/HumanLayerAssembler');
            checkpoints.push({
                name: 'HumanLayerAssembler module load',
                status: 'passed',
                duration: `${Date.now() - loadStart}ms`
            });
        } catch (err) {
            checkpoints.push({
                name: 'HumanLayerAssembler module load',
                status: 'FAILED',
                error: err.message,
                path: '../src/services/orchestration/personality/HumanLayerAssembler'
            });
            return this.buildFailedResult('Personality', checkpoints, startTime,
                'HumanLayerAssembler module not found', false);
        }
        
        // Checkpoint 2: Response assembly test
        const testContext = {
            routing: { thought: 'user needs AC repair', confidence: 0.95 },
            memory: { callerHistory: [{ firstName: 'John', totalCount: 1 }] },
            emotion: { primary: 'FRUSTRATED', intensity: 0.8 },
            company: { companyName: 'Test HVAC' }
        };
        
        const buildStart = Date.now();
        let response;
        
        try {
            response = HumanLayerAssembler.build(testContext);
            const buildTime = Date.now() - buildStart;
            
            checkpoints.push({
                name: 'HumanLayerAssembler.build() execution',
                status: response && response.length > 0 ? 'passed' : 'FAILED',
                duration: `${buildTime}ms`,
                responseLength: response?.length || 0,
                sampleOutput: response?.substring(0, 50)
            });
            
            if (!response || response.length === 0) {
                return this.buildFailedResult('Personality', checkpoints, startTime,
                    'HumanLayerAssembler not generating responses', false);
            }
        } catch (err) {
            checkpoints.push({
                name: 'HumanLayerAssembler.build() execution',
                status: 'FAILED',
                error: err.message
            });
            return this.buildFailedResult('Personality', checkpoints, startTime,
                `HumanLayerAssembler.build() failed: ${err.message}`, false);
        }
        
        // Checkpoint 3: Response quality checks
        const qualityChecks = [
            { name: 'Response length > 10', passed: response.length > 10 },
            { name: 'Response length < 500', passed: response.length < 500 },
            { name: 'No undefined in response', passed: !response.includes('undefined') },
            { name: 'No null in response', passed: !response.includes('null') }
        ];
        
        for (const check of qualityChecks) {
            checkpoints.push({
                name: `Quality: ${check.name}`,
                status: check.passed ? 'passed' : 'WARNING',
                message: check.passed ? 'OK' : 'Quality issue detected'
            });
        }
        
        const responseTime = Date.now() - startTime;
        const qualityPassed = qualityChecks.filter(q => q.passed).length;
        
        let status = 'HEALTHY';
        let statusReason = 'HumanLayerAssembler operational';
        
        if (qualityPassed < qualityChecks.length) {
            status = 'DEGRADED';
            statusReason = `Personality quality issues: ${qualityChecks.length - qualityPassed} checks failed`;
        } else if (responseTime > this.THRESHOLDS.testExecution.degraded) {
            status = 'DEGRADED';
            statusReason = `Personality slow: ${responseTime}ms`;
        }
        
        return {
            name: 'Personality',
            status,
            statusReason,
            critical: false,
            message: statusReason,
            responseTime,
            checkpoints,
            details: {
                components: ['HumanLayerAssembler'],
                testContext,
                sampleResponse: response?.substring(0, 100),
                responseLength: response?.length,
                qualityChecks
            },
            impact: status !== 'HEALTHY' ? 'Reduced personality - responses may be less human-like' : null
        };
    }
    
    /**
     * Check Micro-LLM (gpt-4o-mini) Connectivity
     * DETAILED CHECKPOINTS - This is CRITICAL for LLM-0
     */
    static async checkMicroLLM() {
        const startTime = Date.now();
        const checkpoints = [];
        
        // Checkpoint 1: API Key existence
        const apiKey = process.env.OPENAI_API_KEY;
        
        checkpoints.push({
            name: 'OPENAI_API_KEY environment variable',
            status: apiKey ? 'passed' : 'FAILED',
            message: apiKey ? `Set (${apiKey.length} chars)` : 'NOT SET - CRITICAL!'
        });
        
        if (!apiKey) {
            return this.buildFailedResult('Micro-LLM (gpt-4o-mini)', checkpoints, startTime,
                'OPENAI_API_KEY not configured - LLM-0 CANNOT FUNCTION', true, ['OPENAI_API_KEY']);
        }
        
        // Checkpoint 2: API Key format validation
        const validFormat = apiKey.startsWith('sk-') && apiKey.length > 40;
        
        checkpoints.push({
            name: 'API key format validation',
            status: validFormat ? 'passed' : 'WARNING',
            message: validFormat ? 'Valid format (sk-...)' : `Unusual format (${apiKey.substring(0, 5)}...)`,
            keyLength: apiKey.length
        });
        
        // Checkpoint 3: OpenAI client initialization
        checkpoints.push({
            name: 'OpenAI client initialization',
            status: openai ? 'passed' : 'FAILED',
            message: openai ? 'Client initialized' : 'Client NOT initialized'
        });
        
        if (!openai) {
            return this.buildFailedResult('Micro-LLM (gpt-4o-mini)', checkpoints, startTime,
                'OpenAI client not initialized - check config/openai.js', true);
        }
        
        // Checkpoint 4: API call test
        const apiStart = Date.now();
        
        try {
            const completion = await openai.chat.completions.create({
                model: 'gpt-4o-mini',
                messages: [
                    { role: 'system', content: 'You are a health check assistant. Respond with exactly "HEALTHY"' },
                    { role: 'user', content: 'Status?' }
                ],
                max_tokens: 10,
                temperature: 0
            });
            
            const apiTime = Date.now() - apiStart;
            const responseText = completion.choices[0]?.message?.content || '';
            const tokensUsed = completion.usage?.total_tokens || 0;
            
            checkpoints.push({
                name: 'gpt-4o-mini API call',
                status: 'passed',
                duration: `${apiTime}ms`,
                response: responseText.substring(0, 20),
                tokensUsed,
                model: completion.model
            });
            
            // Checkpoint 5: Response time evaluation
            let latencyStatus = 'EXCELLENT';
            if (apiTime > this.THRESHOLDS.llmResponse.degraded) {
                latencyStatus = 'SLOW';
            } else if (apiTime > this.THRESHOLDS.llmResponse.healthy) {
                latencyStatus = 'ACCEPTABLE';
            }
            
            checkpoints.push({
                name: 'API latency evaluation',
                status: latencyStatus === 'EXCELLENT' ? 'passed' : 'WARNING',
                duration: `${apiTime}ms`,
                threshold: `<${this.THRESHOLDS.llmResponse.healthy}ms excellent`,
                evaluation: latencyStatus
            });
            
            // Checkpoint 6: Token usage check
            checkpoints.push({
                name: 'Token usage check',
                status: tokensUsed < 50 ? 'passed' : 'WARNING',
                tokensUsed,
                message: tokensUsed < 50 ? 'Efficient' : 'Higher than expected for health check'
            });
            
            const responseTime = Date.now() - startTime;
            
            // Determine overall status
            let status = 'HEALTHY';
            let statusReason = `gpt-4o-mini API operational (${apiTime}ms)`;
            
            if (apiTime > this.THRESHOLDS.llmResponse.degraded) {
                status = 'DEGRADED';
                statusReason = `gpt-4o-mini API SLOW: ${apiTime}ms (threshold: ${this.THRESHOLDS.llmResponse.degraded}ms)`;
            } else if (apiTime > this.THRESHOLDS.llmResponse.healthy) {
                status = 'DEGRADED';
                statusReason = `gpt-4o-mini elevated latency: ${apiTime}ms`;
            }
            
            return {
                name: 'Micro-LLM (gpt-4o-mini)',
                status,
                statusReason,
                critical: true,
                message: statusReason,
                responseTime,
                checkpoints,
                details: {
                    model: 'gpt-4o-mini',
                    apiKeyConfigured: true,
                    apiKeyFormat: validFormat ? 'valid' : 'unusual',
                    apiLatency: apiTime,
                    testResponse: responseText,
                    tokensUsed,
                    latencyEvaluation: latencyStatus
                },
                impact: status !== 'HEALTHY' ? 'LLM-0 routing may be slow - affects call response time' : null
            };
            
        } catch (error) {
            checkpoints.push({
                name: 'gpt-4o-mini API call',
                status: 'FAILED',
                error: error.message,
                errorCode: error.code || error.status || 'UNKNOWN',
                duration: `${Date.now() - apiStart}ms`
            });
            
            // Diagnose the error
            let diagnosis = 'Unknown error';
            let action = 'Check OpenAI status page and API key';
            
            if (error.message?.includes('401') || error.message?.includes('auth')) {
                diagnosis = 'API key invalid or expired';
                action = 'Regenerate API key at platform.openai.com';
            } else if (error.message?.includes('429')) {
                diagnosis = 'Rate limited';
                action = 'Check OpenAI usage limits and billing';
            } else if (error.message?.includes('500') || error.message?.includes('503')) {
                diagnosis = 'OpenAI service error';
                action = 'Check status.openai.com - may be temporary';
            } else if (error.message?.includes('timeout') || error.message?.includes('ETIMEDOUT')) {
                diagnosis = 'Connection timeout';
                action = 'Check network connectivity and firewall rules';
            }
            
            checkpoints.push({
                name: 'Error diagnosis',
                status: 'info',
                diagnosis,
                recommendedAction: action
            });
            
            return this.buildFailedResult('Micro-LLM (gpt-4o-mini)', checkpoints, startTime,
                `gpt-4o-mini API failed: ${error.message}`, true, null, {
                    error: error.message,
                    diagnosis,
                    action
                });
        }
    }
    
    // ========================================================================
    // HELPER METHODS
    // ========================================================================
    
    static buildFailedResult(name, checkpoints, startTime, message, critical, missingVars = null, extra = {}) {
        return {
            name,
            status: 'DOWN',
            statusReason: message,
            critical,
            message,
            responseTime: Date.now() - startTime,
            checkpoints,
            ...(missingVars && { missingVars }),
            impact: critical ? 'CRITICAL - Component failure affects core functionality' : 'Component unavailable',
            ...extra
        };
    }
    
    static findSlowest(components) {
        return components.reduce((max, c) => 
            (c.responseTime || 0) > (max.responseTime || 0) ? c : max
        , components[0])?.name || 'Unknown';
    }
    
    static findFastest(components) {
        return components.reduce((min, c) => 
            (c.responseTime || Infinity) < (min.responseTime || Infinity) ? c : min
        , components[0])?.name || 'Unknown';
    }
    
    static getRecommendedAction(status, affectedComponents) {
        if (status === 'CRITICAL') {
            const critical = affectedComponents.find(c => c.critical);
            if (critical?.name?.includes('LLM')) {
                return 'Check OPENAI_API_KEY and OpenAI service status immediately';
            }
            if (critical?.name?.includes('Routing')) {
                return 'Check routing module files exist in src/services/orchestration/routing/';
            }
            return 'Investigate critical component failure - calls may not be processing';
        }
        
        if (status === 'DOWN') {
            return 'Check component module paths and dependencies';
        }
        
        if (status === 'DEGRADED') {
            return 'Performance degraded - check server resources and network latency';
        }
        
        return 'Monitor system health';
    }
}

module.exports = OrchestrationHealthCheck;
