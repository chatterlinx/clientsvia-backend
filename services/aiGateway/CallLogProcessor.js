// ============================================================================
// 📞 AI GATEWAY - CALL LOG PROCESSOR SERVICE
// ============================================================================
// PURPOSE: Process and store call logs, trigger LLM analysis
// FEATURES: Call log storage, validation, analysis queuing
// INTEGRATIONS: AIGatewayCallLog model, LLMAnalyzer, NotificationCenter
// CREATED: 2025-10-29
// ============================================================================

const { AIGatewayCallLog } = require('../../models/aiGateway');
const LLMAnalyzer = require('./LLMAnalyzer');
const AdminNotificationService = require('../AdminNotificationService');
const logger = require('../../utils/logger');

class CallLogProcessor {
    // ========================================================================
    // 🏗️ CONSTRUCTOR
    // ========================================================================
    
    constructor() {
        console.log('🏗️ [AI GATEWAY PROCESSOR] Initializing CallLogProcessor...');
        this.processingQueue = [];
        this.isProcessing = false;
        console.log('✅ [AI GATEWAY PROCESSOR] CallLogProcessor initialized');
    }
    
    // ========================================================================
    // 💾 STORE CALL LOG
    // ========================================================================
    
    async storeCallLog(callData) {
        // ────────────────────────────────────────────────────────────────────
        // CHECKPOINT 1: Validating Call Data
        // ────────────────────────────────────────────────────────────────────
        console.log(`💾 [AI GATEWAY PROCESSOR] CHECKPOINT 1: Storing call log ${callData.callId}`);
        
        try {
            // Validate required fields
            if (!callData.companyId) {
                throw new Error('companyId is required');
            }
            if (!callData.templateId) {
                throw new Error('templateId is required');
            }
            if (!callData.callId) {
                throw new Error('callId is required');
            }
            if (!callData.tierUsed) {
                throw new Error('tierUsed is required');
            }
            
            console.log(`✅ [AI GATEWAY PROCESSOR] Validation passed for call ${callData.callId}`);
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 2: Creating Call Log Document
            // ────────────────────────────────────────────────────────────────
            console.log('📝 [AI GATEWAY PROCESSOR] CHECKPOINT 2: Creating call log document...');
            
            const callLog = await AIGatewayCallLog.create({
                companyId: callData.companyId,
                templateId: callData.templateId,
                categoryId: callData.categoryId || null,
                scenarioId: callData.scenarioId || null,
                callId: callData.callId,
                callerPhone: callData.callerPhone || null,
                callerName: callData.callerName || null,
                transcript: callData.transcript || '',
                userInput: callData.userInput || '',
                processedInput: callData.processedInput || '',
                finalResponse: callData.finalResponse || '',
                tierUsed: callData.tierUsed,
                tier1Result: callData.tier1Result || {},
                tier2Result: callData.tier2Result || {},
                tier3Result: callData.tier3Result || {},
                totalResponseTime: callData.totalResponseTime || 0,
                cost: callData.cost || 0,
                isTest: callData.isTest || false,
                metadata: callData.metadata || {}
            });
            
            console.log(`✅ [AI GATEWAY PROCESSOR] Call log created: ${callLog._id}`);
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 3: Queuing for Analysis (if Tier 3)
            // ────────────────────────────────────────────────────────────────
            if (callLog.tierUsed === 'Tier3' || callLog.tierUsed === 'Fallback') {
                console.log('📋 [AI GATEWAY PROCESSOR] CHECKPOINT 3: Queuing call for LLM analysis...');
                this.queueForAnalysis(callLog._id);
                console.log('✅ [AI GATEWAY PROCESSOR] Call queued for analysis');
            } else {
                console.log('⏭️ [AI GATEWAY PROCESSOR] Call does not require analysis (not Tier 3)');
            }
            
            logger.info(`[AI GATEWAY PROCESSOR] Stored call log ${callData.callId}`, {
                callLogId: callLog._id,
                tierUsed: callLog.tierUsed,
                companyId: callData.companyId,
                templateId: callData.templateId
            });
            
            return {
                success: true,
                callLogId: callLog._id,
                queuedForAnalysis: callLog.tierUsed === 'Tier3' || callLog.tierUsed === 'Fallback'
            };
            
        } catch (error) {
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT ERROR: Storage Failed
            // ────────────────────────────────────────────────────────────────
            console.error('❌ [AI GATEWAY PROCESSOR] CHECKPOINT ERROR: Failed to store call log');
            console.error('❌ [AI GATEWAY PROCESSOR] Error:', error.message);
            console.error('❌ [AI GATEWAY PROCESSOR] Stack:', error.stack);
            
            logger.error(`[AI GATEWAY PROCESSOR] Failed to store call log ${callData.callId}`, {
                error: error.message,
                stack: error.stack,
                callData
            });
            
            // ────────────────────────────────────────────────────────────────
            // NOTIFICATION: Send critical alert
            // ────────────────────────────────────────────────────────────────
            await AdminNotificationService.sendNotification({
                code: 'AI_GATEWAY_CALL_LOG_STORAGE_FAILED',
                severity: 'CRITICAL',
                message: `Failed to store call log: ${error.message}`,
                details: {
                    callId: callData.callId,
                    error: error.message,
                    stack: error.stack
                },
                source: 'AIGatewayCallLogProcessor'
            });
            console.log('📢 [AI GATEWAY PROCESSOR] NOTIFICATION: Sent storage failure alert');
            
            throw error;
        }
    }
    
    // ========================================================================
    // 📋 QUEUE FOR ANALYSIS
    // ========================================================================
    
    queueForAnalysis(callLogId) {
        console.log(`📋 [AI GATEWAY PROCESSOR] Adding ${callLogId} to analysis queue`);
        this.processingQueue.push(callLogId);
        
        // Start processing if not already running
        if (!this.isProcessing) {
            this.processQueue();
        }
    }
    
    // ========================================================================
    // 🔄 PROCESS ANALYSIS QUEUE
    // ========================================================================
    
    async processQueue() {
        if (this.isProcessing || this.processingQueue.length === 0) {
            return;
        }
        
        this.isProcessing = true;
        
        console.log(`🔄 [AI GATEWAY PROCESSOR] ═══════════════════════════════════════════`);
        console.log(`🔄 [AI GATEWAY PROCESSOR] Processing analysis queue: ${this.processingQueue.length} calls`);
        console.log(`🔄 [AI GATEWAY PROCESSOR] ═══════════════════════════════════════════`);
        
        while (this.processingQueue.length > 0) {
            const callLogId = this.processingQueue.shift();
            
            try {
                console.log(`🔍 [AI GATEWAY PROCESSOR] Processing call log ${callLogId}...`);
                
                const callLog = await AIGatewayCallLog.findById(callLogId);
                if (!callLog) {
                    console.warn(`⚠️ [AI GATEWAY PROCESSOR] Call log not found: ${callLogId}`);
                    continue;
                }
                
                await LLMAnalyzer.analyzeCall(callLog);
                console.log(`✅ [AI GATEWAY PROCESSOR] Successfully analyzed ${callLogId}`);
                
            } catch (error) {
                console.error(`❌ [AI GATEWAY PROCESSOR] Failed to analyze ${callLogId}:`, error.message);
            }
        }
        
        console.log(`🔄 [AI GATEWAY PROCESSOR] ═══════════════════════════════════════════`);
        console.log(`🔄 [AI GATEWAY PROCESSOR] Queue processing complete`);
        console.log(`🔄 [AI GATEWAY PROCESSOR] ═══════════════════════════════════════════`);
        
        this.isProcessing = false;
    }
    
    // ========================================================================
    // 📊 GET CALL LOG STATISTICS
    // ========================================================================
    
    async getStatistics(templateId, days = 30) {
        console.log(`📊 [AI GATEWAY PROCESSOR] Fetching statistics for template ${templateId} (last ${days} days)`);
        
        try {
            const stats = await AIGatewayCallLog.getTemplateStats(templateId, days);
            
            // Transform aggregate results into user-friendly format
            const result = {
                totalCalls: 0,
                tier1: { count: 0, avgCost: 0, avgResponseTime: 0 },
                tier2: { count: 0, avgCost: 0, avgResponseTime: 0 },
                tier3: { count: 0, avgCost: 0, avgResponseTime: 0 },
                fallback: { count: 0, avgCost: 0, avgResponseTime: 0 }
            };
            
            stats.forEach(stat => {
                const tierKey = stat._id.toLowerCase();
                result[tierKey] = {
                    count: stat.count,
                    avgCost: stat.avgCost || 0,
                    avgResponseTime: stat.avgResponseTime || 0
                };
                result.totalCalls += stat.count;
            });
            
            console.log(`✅ [AI GATEWAY PROCESSOR] Statistics fetched: ${result.totalCalls} total calls`);
            
            return result;
            
        } catch (error) {
            console.error('❌ [AI GATEWAY PROCESSOR] Failed to fetch statistics:', error.message);
            throw error;
        }
    }
    
    // ========================================================================
    // 🧹 CLEANUP OLD LOGS (Manual trigger)
    // ========================================================================
    
    async cleanupOldLogs(daysToKeep = 90) {
        console.log(`🧹 [AI GATEWAY PROCESSOR] ═══════════════════════════════════════════`);
        console.log(`🧹 [AI GATEWAY PROCESSOR] CLEANUP: Removing logs older than ${daysToKeep} days`);
        console.log(`🧹 [AI GATEWAY PROCESSOR] ═══════════════════════════════════════════`);
        
        try {
            const cutoffDate = new Date(Date.now() - (daysToKeep * 24 * 60 * 60 * 1000));
            
            const result = await AIGatewayCallLog.deleteMany({
                timestamp: { $lt: cutoffDate }
            });
            
            console.log(`✅ [AI GATEWAY PROCESSOR] Deleted ${result.deletedCount} old call logs`);
            
            // Send notification
            await AdminNotificationService.sendNotification({
                code: 'AI_GATEWAY_CLEANUP_COMPLETED',
                severity: 'INFO',
                message: `Cleanup completed: ${result.deletedCount} old call logs deleted`,
                details: {
                    deletedCount: result.deletedCount,
                    daysToKeep: daysToKeep,
                    cutoffDate: cutoffDate
                },
                source: 'AIGatewayCallLogProcessor'
            });
            
            console.log(`🧹 [AI GATEWAY PROCESSOR] ═══════════════════════════════════════════`);
            console.log(`🧹 [AI GATEWAY PROCESSOR] CLEANUP COMPLETE`);
            console.log(`🧹 [AI GATEWAY PROCESSOR] ═══════════════════════════════════════════`);
            
            return {
                success: true,
                deletedCount: result.deletedCount
            };
            
        } catch (error) {
            console.error('❌ [AI GATEWAY PROCESSOR] Cleanup failed:', error.message);
            throw error;
        }
    }
}

// ────────────────────────────────────────────────────────────────────────────
// 📦 SINGLETON EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = new CallLogProcessor();

