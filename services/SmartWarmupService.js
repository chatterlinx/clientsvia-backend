/**
 * ============================================================================
 * SMART WARMUP SERVICE
 * ============================================================================
 * Purpose: Intelligent LLM pre-warming to eliminate perceived delay for Tier 3
 * Strategy: Parallel execution with AbortController for cost-effective warmup
 * 
 * How It Works:
 * 1. During Tier 2 search, check if warmup should be triggered
 * 2. If yes, start LLM call in parallel with Tier 2
 * 3. If Tier 2 succeeds → Cancel LLM (no charge)
 * 4. If Tier 2 fails → LLM already ready (instant Tier 3 response)
 * 
 * Cost Efficiency:
 * - Only charges for LLM calls that are actually used
 * - Smart prediction reduces wasted warmup calls
 * - Daily budget cap prevents runaway costs
 * - Auto-disable if hit rate drops below threshold
 * ============================================================================
 */

const { OpenAI } = require('openai');
const Company = require('../models/v2Company');
const CostLog = require('../models/aiGateway/CostLog');
const redisClient = require('../db').redisClient;

// Initialize OpenAI client
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

class SmartWarmupService {
    constructor() {
        this.activeWarmups = new Map(); // Track active warmup calls
        this.dailyBudgets = new Map(); // Track daily spend per company
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // DECISION LOGIC: Should we trigger warmup?
    // ═══════════════════════════════════════════════════════════════════════════
    async shouldTriggerWarmup(companyId, tier2Confidence, detectedCategory = null) {
        try {
            // Get company warmup settings from Redis or MongoDB
            const warmupSettings = await this.getWarmupSettings(companyId);
            
            // Check 1: Is warmup enabled?
            if (!warmupSettings.enabled) {
                return { trigger: false, reason: 'Warmup disabled' };
            }

            // Check 2: Daily budget exceeded?
            const todaySpent = await this.getTodayWarmupSpend(companyId);
            if (todaySpent >= warmupSettings.dailyBudget) {
                return { trigger: false, reason: 'Daily budget exceeded', spent: todaySpent, budget: warmupSettings.dailyBudget };
            }

            // Check 3: Category-based rules (highest priority)
            if (detectedCategory) {
                // Never warmup for these categories
                if (warmupSettings.neverWarmupCategories.includes(detectedCategory)) {
                    return { trigger: false, reason: `Category '${detectedCategory}' in never-warmup list` };
                }
                
                // Always warmup for these categories
                if (warmupSettings.alwaysWarmupCategories.includes(detectedCategory)) {
                    return { trigger: true, reason: `Category '${detectedCategory}' in always-warmup list` };
                }
            }

            // Check 4: Confidence threshold
            if (tier2Confidence >= warmupSettings.confidenceThreshold) {
                return { trigger: false, reason: 'Confidence too high', confidence: tier2Confidence, threshold: warmupSettings.confidenceThreshold };
            }

            // Check 5: Hit rate too low? (Auto-disable protection)
            if (warmupSettings.enablePatternLearning) {
                const hitRate = await this.getWarmupHitRate(companyId);
                if (hitRate !== null && hitRate < warmupSettings.minimumHitRate) {
                    // Auto-disable warmup
                    await this.autoDisableWarmup(companyId, hitRate, warmupSettings.minimumHitRate);
                    return { trigger: false, reason: 'Hit rate too low, auto-disabled', hitRate, minimum: warmupSettings.minimumHitRate };
                }
            }

            // All checks passed → Trigger warmup
            return { 
                trigger: true, 
                reason: 'Low confidence prediction',
                confidence: tier2Confidence,
                threshold: warmupSettings.confidenceThreshold,
                budgetRemaining: warmupSettings.dailyBudget - todaySpent
            };

        } catch (error) {
            console.error(`[SmartWarmup] Error in shouldTriggerWarmup for company ${companyId}:`, error);
            return { trigger: false, reason: 'Error in decision logic', error: error.message };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // PARALLEL EXECUTION: Start LLM warmup with AbortController
    // ═══════════════════════════════════════════════════════════════════════════
    async startWarmup(companyId, query, context = {}) {
        const warmupId = `warmup_${companyId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        try {
            console.log(`[SmartWarmup] 🔥 Starting warmup ${warmupId} for company ${companyId}`);
            console.log(`[SmartWarmup] Query: "${query}"`);

            // Create AbortController for this warmup
            const abortController = new AbortController();
            
            // Get company LLM settings
            const warmupSettings = await this.getWarmupSettings(companyId);
            const llmModel = warmupSettings.llmModel || 'gpt-4o-mini';

            // Build LLM prompt
            const prompt = this.buildWarmupPrompt(query, context);

            // Start timer
            const startTime = Date.now();

            // Start LLM call (non-blocking)
            const llmPromise = openai.chat.completions.create({
                model: llmModel,
                messages: [
                    { role: 'system', content: context.systemPrompt || 'You are a helpful AI assistant.' },
                    { role: 'user', content: prompt }
                ],
                temperature: 0.3,
                max_tokens: 500
            }, {
                signal: abortController.signal // Enable cancellation
            }).then(response => {
                const duration = Date.now() - startTime;
                console.log(`[SmartWarmup] ✅ Warmup ${warmupId} completed in ${duration}ms`);
                return {
                    success: true,
                    response: response.choices[0].message.content,
                    duration,
                    model: llmModel,
                    cancelled: false
                };
            }).catch(error => {
                const duration = Date.now() - startTime;
                
                // Check if it was cancelled (this is not an error)
                if (error.name === 'AbortError' || error.code === 'ECONNABORTED') {
                    console.log(`[SmartWarmup] ⚡ Warmup ${warmupId} cancelled after ${duration}ms (Tier 2 succeeded)`);
                    return {
                        success: false,
                        cancelled: true,
                        duration,
                        reason: 'Tier 2 succeeded, warmup not needed'
                    };
                }

                // Actual error
                console.error(`[SmartWarmup] ❌ Warmup ${warmupId} failed after ${duration}ms:`, error.message);
                return {
                    success: false,
                    cancelled: false,
                    error: error.message,
                    duration
                };
            });

            // Store warmup metadata
            this.activeWarmups.set(warmupId, {
                companyId,
                query,
                startTime,
                abortController,
                promise: llmPromise,
                context
            });

            return {
                warmupId,
                promise: llmPromise,
                cancel: () => this.cancelWarmup(warmupId)
            };

        } catch (error) {
            console.error(`[SmartWarmup] Error starting warmup ${warmupId}:`, error);
            throw error;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // CANCELLATION: Cancel warmup if Tier 2 succeeds
    // ═══════════════════════════════════════════════════════════════════════════
    async cancelWarmup(warmupId) {
        try {
            const warmup = this.activeWarmups.get(warmupId);
            if (!warmup) {
                console.warn(`[SmartWarmup] Cannot cancel ${warmupId}: Not found`);
                return false;
            }

            console.log(`[SmartWarmup] 🚫 Cancelling warmup ${warmupId}`);
            
            // Trigger abort
            warmup.abortController.abort();

            // Log cancellation (no cost incurred)
            await this.logWarmupEvent(warmup.companyId, {
                warmupId,
                action: 'cancelled',
                reason: 'Tier 2 succeeded',
                duration: Date.now() - warmup.startTime,
                cost: 0,
                query: warmup.query
            });

            // Remove from active warmups
            this.activeWarmups.delete(warmupId);

            return true;

        } catch (error) {
            console.error(`[SmartWarmup] Error cancelling warmup ${warmupId}:`, error);
            return false;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // USAGE: Use warmup result for Tier 3
    // ═══════════════════════════════════════════════════════════════════════════
    async useWarmup(warmupId) {
        try {
            const warmup = this.activeWarmups.get(warmupId);
            if (!warmup) {
                console.warn(`[SmartWarmup] Cannot use ${warmupId}: Not found`);
                return null;
            }

            console.log(`[SmartWarmup] 💰 Using warmup ${warmupId} (Tier 2 failed, Tier 3 needed)`);

            // Wait for LLM response
            const result = await warmup.promise;

            if (result.success && !result.cancelled) {
                // Calculate cost
                const estimatedCost = this.estimateCost(result.model, warmup.query, result.response);

                // Log usage (cost incurred)
                await this.logWarmupEvent(warmup.companyId, {
                    warmupId,
                    action: 'used',
                    reason: 'Tier 2 failed, warmup used',
                    duration: result.duration,
                    cost: estimatedCost,
                    model: result.model,
                    query: warmup.query,
                    responseLength: result.response.length
                });

                // Update daily budget tracking
                await this.incrementDailySpend(warmup.companyId, estimatedCost);

                // Remove from active warmups
                this.activeWarmups.delete(warmupId);

                return {
                    success: true,
                    response: result.response,
                    duration: result.duration,
                    cost: estimatedCost,
                    warmupUsed: true
                };
            } else {
                // Warmup failed or was cancelled
                await this.logWarmupEvent(warmup.companyId, {
                    warmupId,
                    action: 'failed',
                    reason: result.cancelled ? 'Cancelled' : result.error,
                    duration: result.duration,
                    cost: 0,
                    query: warmup.query
                });

                this.activeWarmups.delete(warmupId);
                return null;
            }

        } catch (error) {
            console.error(`[SmartWarmup] Error using warmup ${warmupId}:`, error);
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    // HELPER METHODS
    // ═══════════════════════════════════════════════════════════════════════════

    async getWarmupSettings(companyId) {
        try {
            // Try Redis cache first
            const cacheKey = `company:${companyId}:warmup_settings`;
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                return JSON.parse(cached);
            }

            // Fallback to MongoDB
            const company = await Company.findById(companyId).select('aiAgentLogic.productionIntelligence');
            const prodInt = company?.aiAgentLogic?.productionIntelligence;
            const smartWarmup = prodInt?.smartWarmup || {};
            const llmConfig = prodInt?.llmConfig || {};

            const settings = {
                enabled: smartWarmup.enabled || false,
                confidenceThreshold: smartWarmup.confidenceThreshold || 0.75,
                dailyBudget: smartWarmup.dailyBudget || 5.00,
                enablePatternLearning: smartWarmup.enablePatternLearning !== false,
                minimumHitRate: smartWarmup.minimumHitRate || 0.30,
                alwaysWarmupCategories: smartWarmup.alwaysWarmupCategories || [],
                neverWarmupCategories: smartWarmup.neverWarmupCategories || [],
                llmModel: llmConfig.model || 'gpt-4o-mini'
            };

            // Cache for 5 minutes
            await redisClient.setex(cacheKey, 300, JSON.stringify(settings));

            return settings;

        } catch (error) {
            console.error(`[SmartWarmup] Error getting warmup settings for company ${companyId}:`, error);
            // Return safe defaults
            return {
                enabled: false,
                confidenceThreshold: 0.75,
                dailyBudget: 5.00,
                enablePatternLearning: true,
                minimumHitRate: 0.30,
                alwaysWarmupCategories: [],
                neverWarmupCategories: [],
                llmModel: 'gpt-4o-mini'
            };
        }
    }

    async getTodayWarmupSpend(companyId) {
        try {
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const cacheKey = `company:${companyId}:warmup_spend:${today}`;
            
            const cached = await redisClient.get(cacheKey);
            if (cached) {
                return parseFloat(cached);
            }

            // Query CostLog for today's warmup spend
            const startOfDay = new Date(today);
            const endOfDay = new Date(today);
            endOfDay.setDate(endOfDay.getDate() + 1);

            const result = await CostLog.aggregate([
                {
                    $match: {
                        companyId: companyId,
                        timestamp: { $gte: startOfDay, $lt: endOfDay },
                        'metadata.warmupUsed': true
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalCost: { $sum: '$cost' }
                    }
                }
            ]);

            const totalSpend = result.length > 0 ? result[0].totalCost : 0;

            // Cache for 5 minutes
            await redisClient.setex(cacheKey, 300, totalSpend.toString());

            return totalSpend;

        } catch (error) {
            console.error(`[SmartWarmup] Error getting today's warmup spend for company ${companyId}:`, error);
            return 0;
        }
    }

    async incrementDailySpend(companyId, amount) {
        try {
            const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
            const cacheKey = `company:${companyId}:warmup_spend:${today}`;
            
            const current = await redisClient.get(cacheKey);
            const newTotal = (parseFloat(current) || 0) + amount;
            
            // Cache until end of day
            const secondsUntilMidnight = this.getSecondsUntilMidnight();
            await redisClient.setex(cacheKey, secondsUntilMidnight, newTotal.toString());

            return newTotal;

        } catch (error) {
            console.error(`[SmartWarmup] Error incrementing daily spend for company ${companyId}:`, error);
        }
    }

    async getWarmupHitRate(companyId) {
        try {
            // Calculate hit rate over last 7 days
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

            const stats = await CostLog.aggregate([
                {
                    $match: {
                        companyId: companyId,
                        timestamp: { $gte: sevenDaysAgo },
                        'metadata.warmupTriggered': true
                    }
                },
                {
                    $group: {
                        _id: null,
                        totalTriggered: { $sum: 1 },
                        totalUsed: {
                            $sum: {
                                $cond: [{ $eq: ['$metadata.warmupUsed', true] }, 1, 0]
                            }
                        }
                    }
                }
            ]);

            if (stats.length === 0 || stats[0].totalTriggered === 0) {
                return null; // Not enough data
            }

            const hitRate = stats[0].totalUsed / stats[0].totalTriggered;
            return hitRate;

        } catch (error) {
            console.error(`[SmartWarmup] Error calculating hit rate for company ${companyId}:`, error);
            return null;
        }
    }

    async autoDisableWarmup(companyId, currentHitRate, minimumHitRate) {
        try {
            console.warn(`[SmartWarmup] 🚨 Auto-disabling warmup for company ${companyId}`);
            console.warn(`[SmartWarmup] Hit rate: ${(currentHitRate * 100).toFixed(1)}% < ${(minimumHitRate * 100).toFixed(1)}% minimum`);

            // Update database
            await Company.findByIdAndUpdate(companyId, {
                'aiAgentLogic.productionIntelligence.smartWarmup.enabled': false,
                'aiAgentLogic.productionIntelligence.lastUpdated': new Date(),
                'aiAgentLogic.productionIntelligence.updatedBy': 'System (Auto-disabled)'
            });

            // Clear cache
            const cacheKey = `company:${companyId}:warmup_settings`;
            await redisClient.del(cacheKey);

            // TODO: Send notification to company admin
            // await NotificationService.send({
            //     companyId,
            //     type: 'warmup_auto_disabled',
            //     message: `Smart warmup auto-disabled due to low hit rate (${(currentHitRate * 100).toFixed(1)}%)`
            // });

            return true;

        } catch (error) {
            console.error(`[SmartWarmup] Error auto-disabling warmup for company ${companyId}:`, error);
            return false;
        }
    }

    buildWarmupPrompt(query, context) {
        // Use same prompt format as Tier 3
        return `Customer Query: "${query}"\n\nProvide a helpful, professional response based on the available knowledge.`;
    }

    estimateCost(model, inputText, outputText) {
        // Rough cost estimation based on OpenAI pricing
        const inputTokens = Math.ceil(inputText.length / 4);
        const outputTokens = Math.ceil(outputText.length / 4);

        const pricing = {
            'gpt-4o': { input: 0.0025 / 1000, output: 0.01 / 1000 },
            'gpt-4o-mini': { input: 0.00015 / 1000, output: 0.0006 / 1000 },
            'gpt-3.5-turbo': { input: 0.0005 / 1000, output: 0.0015 / 1000 }
        };

        const modelPricing = pricing[model] || pricing['gpt-4o-mini'];
        const cost = (inputTokens * modelPricing.input) + (outputTokens * modelPricing.output);

        return parseFloat(cost.toFixed(6));
    }

    async logWarmupEvent(companyId, eventData) {
        try {
            // Log to CostLog with warmup metadata
            await CostLog.create({
                companyId,
                timestamp: new Date(),
                tier: 'warmup',
                cost: eventData.cost || 0,
                metadata: {
                    warmupId: eventData.warmupId,
                    action: eventData.action,
                    reason: eventData.reason,
                    duration: eventData.duration,
                    model: eventData.model,
                    query: eventData.query,
                    warmupTriggered: true,
                    warmupUsed: eventData.action === 'used',
                    warmupCancelled: eventData.action === 'cancelled'
                }
            });

        } catch (error) {
            console.error(`[SmartWarmup] Error logging warmup event for company ${companyId}:`, error);
        }
    }

    getSecondsUntilMidnight() {
        const now = new Date();
        const midnight = new Date();
        midnight.setHours(24, 0, 0, 0);
        return Math.floor((midnight - now) / 1000);
    }

    // Cleanup: Remove stale warmups (older than 30 seconds)
    cleanupStaleWarmups() {
        const now = Date.now();
        const maxAge = 30000; // 30 seconds

        for (const [warmupId, warmup] of this.activeWarmups.entries()) {
            if (now - warmup.startTime > maxAge) {
                console.warn(`[SmartWarmup] Cleaning up stale warmup ${warmupId}`);
                this.cancelWarmup(warmupId);
            }
        }
    }
}

// Singleton instance
const smartWarmupService = new SmartWarmupService();

// Cleanup interval (every 60 seconds)
setInterval(() => {
    smartWarmupService.cleanupStaleWarmups();
}, 60000);

module.exports = smartWarmupService;

