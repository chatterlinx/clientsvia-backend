// ============================================================================
// 🔬 AI GATEWAY - DIAGNOSTIC ENGINE
// ============================================================================
// PURPOSE: Analyzes health check failures and generates detailed diagnostic reports
// FEATURES: Root cause analysis, suggested fixes, formatted copy-paste reports
// USAGE: DiagnosticEngine.analyzeHealthCheck(healthResults)
// CREATED: 2025-10-29
// ============================================================================

// ────────────────────────────────────────────────────────────────────────────
// 📦 IMPORTS
// ────────────────────────────────────────────────────────────────────────────

const logger = require('../../utils/logger');

// ────────────────────────────────────────────────────────────────────────────
// 🔬 DIAGNOSTIC ENGINE CLASS
// ────────────────────────────────────────────────────────────────────────────

class DiagnosticEngine {
    
    // ========================================================================
    // 🎯 MAIN DIAGNOSTIC ANALYSIS
    // ========================================================================
    
    /**
     * Analyze health check results and generate comprehensive diagnostic report
     * @param {Object} healthResults - Results from HealthMonitor.checkAllSystems()
     * @returns {Object} Diagnostic analysis with root cause, fixes, and formatted report
     */
    static analyzeHealthCheck(healthResults) {
        console.log('🔬 [DIAGNOSTIC ENGINE] Starting analysis...');
        
        const analysis = {
            rootCauseAnalysis: null,
            suggestedFixes: [],
            affectedSystems: [],
            diagnosticDetails: {},
            severity: 'INFO',
            reportFormatted: null
        };
        
        // ────────────────────────────────────────────────────────────────────
        // 1️⃣ IDENTIFY AFFECTED SYSTEMS
        // ────────────────────────────────────────────────────────────────────
        
        const failedSystems = [];
        const warningSystems = [];
        
        if (healthResults.openai?.status === 'UNHEALTHY') {
            failedSystems.push('openai');
        } else if (healthResults.openai?.status === 'NOT_CONFIGURED') {
            warningSystems.push('openai');
        }
        
        if (healthResults.mongodb?.status === 'UNHEALTHY') {
            failedSystems.push('mongodb');
        }
        
        if (healthResults.redis?.status === 'UNHEALTHY') {
            failedSystems.push('redis');
        }
        
        if (healthResults.tier3System?.status === 'DISABLED' || healthResults.tier3System?.status === 'NOT_CONFIGURED') {
            warningSystems.push('tier3System');
        }
        
        analysis.affectedSystems = [...failedSystems, ...warningSystems];
        
        // ────────────────────────────────────────────────────────────────────
        // 2️⃣ DETERMINE SEVERITY
        // ────────────────────────────────────────────────────────────────────
        
        if (failedSystems.length === 0 && warningSystems.length === 0) {
            analysis.severity = 'INFO';
            analysis.rootCauseAnalysis = 'All systems operational';
        } else if (failedSystems.includes('mongodb') || failedSystems.includes('redis')) {
            analysis.severity = 'CRITICAL';
        } else if (failedSystems.length > 0) {
            analysis.severity = 'ERROR';
        } else {
            analysis.severity = 'WARNING';
        }
        
        // ────────────────────────────────────────────────────────────────────
        // 3️⃣ ANALYZE EACH FAILED SYSTEM
        // ────────────────────────────────────────────────────────────────────
        
        const rootCauses = [];
        
        // OpenAI Analysis
        if (failedSystems.includes('openai')) {
            const openaiAnalysis = this.analyzeOpenAIFailure(healthResults.openai);
            rootCauses.push(openaiAnalysis.cause);
            analysis.suggestedFixes.push(...openaiAnalysis.fixes);
            analysis.diagnosticDetails.openai = openaiAnalysis.details;
        }
        
        // MongoDB Analysis
        if (failedSystems.includes('mongodb')) {
            const mongoAnalysis = this.analyzeMongoDBFailure(healthResults.mongodb);
            rootCauses.push(mongoAnalysis.cause);
            analysis.suggestedFixes.push(...mongoAnalysis.fixes);
            analysis.diagnosticDetails.mongodb = mongoAnalysis.details;
        }
        
        // Redis Analysis
        if (failedSystems.includes('redis')) {
            const redisAnalysis = this.analyzeRedisFailure(healthResults.redis);
            rootCauses.push(redisAnalysis.cause);
            analysis.suggestedFixes.push(...redisAnalysis.fixes);
            analysis.diagnosticDetails.redis = redisAnalysis.details;
        }
        
        // 3-Tier System Warnings
        if (warningSystems.includes('tier3System')) {
            const tier3Analysis = this.analyzeTier3Status(healthResults.tier3System);
            rootCauses.push(tier3Analysis.cause);
            analysis.suggestedFixes.push(...tier3Analysis.fixes);
            analysis.diagnosticDetails.tier3System = tier3Analysis.details;
        }
        
        // ────────────────────────────────────────────────────────────────────
        // 4️⃣ CONSOLIDATE ROOT CAUSE
        // ────────────────────────────────────────────────────────────────────
        
        if (rootCauses.length > 0) {
            analysis.rootCauseAnalysis = rootCauses.join(' | ');
        }
        
        // ────────────────────────────────────────────────────────────────────
        // 5️⃣ GENERATE FORMATTED REPORT
        // ────────────────────────────────────────────────────────────────────
        
        analysis.reportFormatted = this.generateFormattedReport(healthResults, analysis);
        
        console.log(`✅ [DIAGNOSTIC ENGINE] Analysis complete - Severity: ${analysis.severity}, Affected: ${analysis.affectedSystems.length}`);
        
        return analysis;
    }
    
    // ========================================================================
    // 🔧 OPENAI FAILURE ANALYSIS
    // ========================================================================
    
    static analyzeOpenAIFailure(openaiResult) {
        const error = openaiResult.error || 'Unknown error';
        const analysis = {
            cause: '',
            fixes: [],
            details: {
                error,
                responseTime: openaiResult.responseTime
            }
        };
        
        // API Key Issues
        if (error.includes('API key') || error.includes('authentication') || error.includes('401')) {
            analysis.cause = 'OpenAI API key invalid or missing';
            analysis.fixes.push('Verify OPENAI_API_KEY in Render environment variables');
            analysis.fixes.push('Check OpenAI dashboard for API key status');
            analysis.fixes.push('Ensure API key has sufficient permissions');
        }
        // Rate Limiting
        else if (error.includes('rate limit') || error.includes('429')) {
            analysis.cause = 'OpenAI API rate limit exceeded';
            analysis.fixes.push('Wait for rate limit to reset (typically 1 minute)');
            analysis.fixes.push('Review API usage in OpenAI dashboard');
            analysis.fixes.push('Consider upgrading OpenAI plan for higher limits');
        }
        // Timeout Issues
        else if (error.includes('timeout') || error.includes('ETIMEDOUT')) {
            analysis.cause = 'OpenAI API request timeout';
            analysis.fixes.push('Check network connectivity to OpenAI servers');
            analysis.fixes.push('Increase timeout in HealthMonitor.js');
            analysis.fixes.push('Check Render logs for network issues');
        }
        // Billing Issues
        else if (error.includes('quota') || error.includes('billing')) {
            analysis.cause = 'OpenAI account quota exceeded or billing issue';
            analysis.fixes.push('Check OpenAI billing dashboard');
            analysis.fixes.push('Add payment method or upgrade plan');
            analysis.fixes.push('Review usage limits in account settings');
        }
        // Generic Failure
        else {
            analysis.cause = `OpenAI API failure: ${error}`;
            analysis.fixes.push('Check OpenAI status page: https://status.openai.com');
            analysis.fixes.push('Review Render server logs for detailed error trace');
            analysis.fixes.push('Test connection manually: node scripts/test-openai.js');
        }
        
        return analysis;
    }
    
    // ========================================================================
    // 🗄️ MONGODB FAILURE ANALYSIS
    // ========================================================================
    
    static analyzeMongoDBFailure(mongoResult) {
        const error = mongoResult.error || 'Unknown error';
        const analysis = {
            cause: '',
            fixes: [],
            details: {
                error,
                queryTime: mongoResult.queryTime
            }
        };
        
        // Connection Issues
        if (error.includes('connect') || error.includes('ECONNREFUSED')) {
            analysis.cause = 'MongoDB connection failed';
            analysis.fixes.push('Check MongoDB Atlas cluster status');
            analysis.fixes.push('Verify MONGO_URI environment variable is correct');
            analysis.fixes.push('Check network connectivity and firewall rules');
            analysis.fixes.push('Ensure MongoDB Atlas IP whitelist includes Render IPs');
        }
        // Authentication Issues
        else if (error.includes('auth') || error.includes('credentials')) {
            analysis.cause = 'MongoDB authentication failed';
            analysis.fixes.push('Verify MongoDB username/password in MONGO_URI');
            analysis.fixes.push('Check database user permissions in MongoDB Atlas');
            analysis.fixes.push('Ensure database name in connection string is correct');
        }
        // Timeout Issues
        else if (error.includes('timeout')) {
            analysis.cause = 'MongoDB query timeout';
            analysis.fixes.push('Check MongoDB Atlas cluster performance metrics');
            analysis.fixes.push('Verify network latency to MongoDB Atlas');
            analysis.fixes.push('Consider upgrading MongoDB Atlas tier for better performance');
        }
        // Generic Failure
        else {
            analysis.cause = `MongoDB failure: ${error}`;
            analysis.fixes.push('Check MongoDB Atlas logs for errors');
            analysis.fixes.push('Review Render server logs for connection errors');
            analysis.fixes.push('Test connection: node scripts/test-mongodb.js');
        }
        
        return analysis;
    }
    
    // ========================================================================
    // 🔴 REDIS FAILURE ANALYSIS
    // ========================================================================
    
    static analyzeRedisFailure(redisResult) {
        const error = redisResult.error || 'Unknown error';
        const analysis = {
            cause: '',
            fixes: [],
            details: {
                error,
                latency: redisResult.latency
            }
        };
        
        // Connection Issues
        if (error.includes('connect') || error.includes('ECONNREFUSED')) {
            analysis.cause = 'Redis connection failed';
            analysis.fixes.push('Check Redis connection settings in db.js');
            analysis.fixes.push('Verify REDIS_HOST and REDIS_PORT environment variables');
            analysis.fixes.push('Ensure Redis service is running on Render');
            analysis.fixes.push('Check Redis connection logs in Render dashboard');
        }
        // Authentication Issues
        else if (error.includes('auth') || error.includes('NOAUTH')) {
            analysis.cause = 'Redis authentication failed';
            analysis.fixes.push('Verify REDIS_PASSWORD environment variable');
            analysis.fixes.push('Check Redis ACL configuration');
        }
        // Connection Pool Exhausted
        else if (error.includes('pool') || error.includes('Too many')) {
            analysis.cause = 'Redis connection pool exhausted';
            analysis.fixes.push('Increase Redis connection pool size in db.js');
            analysis.fixes.push('Check for connection leaks in application code');
            analysis.fixes.push('Restart Redis connection pool: redisClient.quit() then reconnect');
        }
        // Timeout Issues
        else if (error.includes('timeout')) {
            analysis.cause = 'Redis operation timeout';
            analysis.fixes.push('Check Redis server performance and memory usage');
            analysis.fixes.push('Increase timeout in Redis client configuration');
            analysis.fixes.push('Consider upgrading Redis instance for better performance');
        }
        // Generic Failure
        else {
            analysis.cause = `Redis failure: ${error}`;
            analysis.fixes.push('Check Render Redis logs for errors');
            analysis.fixes.push('Review server logs: tail -f logs/error.log | grep REDIS');
            analysis.fixes.push('Test connection: node scripts/test-redis.js');
        }
        
        return analysis;
    }
    
    // ========================================================================
    // 🎯 3-TIER SYSTEM STATUS ANALYSIS
    // ========================================================================
    
    static analyzeTier3Status(tier3Result) {
        const analysis = {
            cause: '',
            fixes: [],
            details: {
                status: tier3Result.status,
                info: tier3Result.details
            }
        };
        
        if (tier3Result.status === 'DISABLED' || tier3Result.status === 'NOT_CONFIGURED') {
            analysis.cause = '3-Tier Intelligence System is disabled';
            analysis.fixes.push('Enable in Render: Set ENABLE_3_TIER_INTELLIGENCE=true');
            analysis.fixes.push('Add OpenAI API key: OPENAI_API_KEY=your_key');
            analysis.fixes.push('Restart Render service after adding environment variables');
        }
        
        return analysis;
    }
    
    // ========================================================================
    // 📋 GENERATE FORMATTED REPORT (for copy-paste)
    // ========================================================================
    
    static generateFormattedReport(healthResults, analysis) {
        const timestamp = new Date().toISOString();
        const lines = [];
        
        lines.push('═══════════════════════════════════════════════════════════════════');
        lines.push('🔍 AI GATEWAY HEALTH CHECK REPORT');
        lines.push('═══════════════════════════════════════════════════════════════════');
        lines.push('');
        lines.push(`📅 Timestamp: ${timestamp}`);
        lines.push(`⚠️  Severity: ${analysis.severity}`);
        lines.push(`🎯 Overall Status: ${healthResults.overallStatus || 'UNKNOWN'}`);
        lines.push('');
        
        // System Status Breakdown
        lines.push('━━━ SYSTEM STATUS ━━━');
        lines.push('');
        
        // OpenAI
        const openaiIcon = healthResults.openai?.status === 'HEALTHY' ? '✅' : 
                          healthResults.openai?.status === 'NOT_CONFIGURED' ? '⚙️' : '❌';
        lines.push(`${openaiIcon} OpenAI: ${healthResults.openai?.status || 'UNKNOWN'}`);
        if (healthResults.openai?.responseTime) {
            lines.push(`   Response Time: ${healthResults.openai.responseTime}ms`);
        }
        if (healthResults.openai?.details?.model) {
            lines.push(`   Model: ${healthResults.openai.details.model}`);
        }
        if (healthResults.openai?.error) {
            lines.push(`   Error: ${healthResults.openai.error}`);
        }
        lines.push('');
        
        // MongoDB
        const mongoIcon = healthResults.mongodb?.status === 'HEALTHY' ? '✅' : '❌';
        lines.push(`${mongoIcon} MongoDB: ${healthResults.mongodb?.status || 'UNKNOWN'}`);
        if (healthResults.mongodb?.queryTime) {
            lines.push(`   Query Time: ${healthResults.mongodb.queryTime}ms`);
        }
        if (healthResults.mongodb?.error) {
            lines.push(`   Error: ${healthResults.mongodb.error}`);
        }
        lines.push('');
        
        // Redis
        const redisIcon = healthResults.redis?.status === 'HEALTHY' ? '✅' : '❌';
        lines.push(`${redisIcon} Redis: ${healthResults.redis?.status || 'UNKNOWN'}`);
        if (healthResults.redis?.latency) {
            lines.push(`   Latency: ${healthResults.redis.latency}ms`);
        }
        if (healthResults.redis?.error) {
            lines.push(`   Error: ${healthResults.redis.error}`);
        }
        lines.push('');
        
        // 3-Tier System
        const tier3Icon = healthResults.tier3System?.status === 'ENABLED' ? '✅' : '⚙️';
        lines.push(`${tier3Icon} 3-Tier Intelligence: ${healthResults.tier3System?.status || 'UNKNOWN'}`);
        if (healthResults.tier3System?.details) {
            lines.push(`   Info: ${healthResults.tier3System.details}`);
        }
        lines.push('');
        
        // Root Cause Analysis
        if (analysis.rootCauseAnalysis && analysis.rootCauseAnalysis !== 'All systems operational') {
            lines.push('━━━ ROOT CAUSE ANALYSIS ━━━');
            lines.push('');
            lines.push(analysis.rootCauseAnalysis);
            lines.push('');
        }
        
        // Affected Systems
        if (analysis.affectedSystems.length > 0) {
            lines.push('━━━ AFFECTED SYSTEMS ━━━');
            lines.push('');
            analysis.affectedSystems.forEach(system => {
                lines.push(`  • ${system}`);
            });
            lines.push('');
        }
        
        // Suggested Fixes
        if (analysis.suggestedFixes.length > 0) {
            lines.push('━━━ SUGGESTED FIXES ━━━');
            lines.push('');
            analysis.suggestedFixes.forEach((fix, index) => {
                lines.push(`${index + 1}. ${fix}`);
            });
            lines.push('');
        }
        
        // Diagnostic Details
        if (Object.keys(analysis.diagnosticDetails).length > 0) {
            lines.push('━━━ TECHNICAL DETAILS ━━━');
            lines.push('');
            lines.push(JSON.stringify(analysis.diagnosticDetails, null, 2));
            lines.push('');
        }
        
        lines.push('═══════════════════════════════════════════════════════════════════');
        lines.push('📋 Copy this entire report and paste it for debugging assistance');
        lines.push('═══════════════════════════════════════════════════════════════════');
        
        return lines.join('\n');
    }
}

// ────────────────────────────────────────────────────────────────────────────
// 📦 EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = DiagnosticEngine;

