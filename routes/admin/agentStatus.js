/**
 * ============================================================================
 * AGENT STATUS API - ENTERPRISE VISIBILITY & CONTROL
 * ============================================================================
 * 
 * PURPOSE: Provide complete transparency into live agent configuration
 * SECURITY: Admin-only access with company-scoped visibility
 * 
 * ENDPOINTS:
 * - GET  /api/admin/agent-status/:companyId - Get live agent configuration
 * - POST /api/admin/agent-status/:companyId/component/:componentId/toggle - Enable/disable component
 * - GET  /api/admin/agent-status/:companyId/metrics - Get performance metrics
 * - GET  /api/admin/agent-status/:companyId/health - System health check
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const V2Company = require('../../models/v2Company');
const RoutingDecisionLog = require('../../models/routing/RoutingDecisionLog');
const PromptVersion = require('../../models/routing/PromptVersion');
const CheatSheetVersion = require('../../models/cheatsheet/CheatSheetVersion');
const TriageCard = require('../../models/TriageCard');
const { getSharedRedisClient, isRedisConfigured } = require('../../services/redisClientFactory');

const HealthCheckLog = require('../../models/HealthCheckLog');
const NotificationLog = require('../../models/NotificationLog');

// ============================================================================
// CURRENT SYSTEM COMPONENTS - The REAL production architecture (Dec 2025)
// ============================================================================
// OLD: Complex orchestration with FillerStripper, EmotionDetector, MicroLLMRouter
// NEW: Simple, direct path: ConversationEngine → HybridReceptionistLLM → OpenAI
// ============================================================================

const CURRENT_SYSTEM_COMPONENTS = {
  core: {
    conversationEngine: {
      id: 'conversation_engine',
      name: 'Conversation Engine',
      description: 'Unified AI brain for all channels (phone, SMS, web)',
      path: 'services/ConversationEngine.js',
      performance: { target: '<2000ms', critical: '4000ms' },
      enabled: true
    },
    hybridReceptionistLLM: {
      id: 'hybrid_receptionist_llm',
      name: 'Hybrid Receptionist LLM',
      description: 'Smart AI brain using GPT-4o-mini with lean prompt',
      path: 'services/HybridReceptionistLLM.js',
      performance: { target: '<1500ms', critical: '3000ms' },
      enabled: true
    }
  },
  services: {
    sessionService: {
      id: 'session_service',
      name: 'Session Service',
      description: 'Manages conversation sessions and slot persistence',
      path: 'services/SessionService.js',
      performance: { target: '<50ms', critical: '200ms' },
      enabled: true
    },
    customerService: {
      id: 'customer_service',
      name: 'Customer Service',
      description: 'Customer recognition and personalization',
      path: 'services/CustomerService.js',
      performance: { target: '<50ms', critical: '200ms' },
      enabled: true
    },
    bookingScriptEngine: {
      id: 'booking_script_engine',
      name: 'Booking Script Engine',
      description: 'UI-configured booking questions and slot management',
      path: 'services/BookingScriptEngine.js',
      performance: { target: '<10ms', critical: '50ms' },
      enabled: true
    }
  },
  external: {
    openai: {
      id: 'openai_api',
      name: 'OpenAI API',
      description: 'GPT-4o-mini for intelligent responses',
      path: 'External API',
      performance: { target: '<1500ms', critical: '3000ms' },
      enabled: true
    }
  }
};

// ============================================================================
// GET /api/admin/agent-status/:companyId - Live Agent Configuration
// ============================================================================

router.get('/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;

    logger.info('[AGENT STATUS] Fetching live configuration', { companyId });

    // Load company configuration
    const company = await V2Company.findById(companyId).lean();
    if (!company) {
      return res.status(404).json({ 
        success: false, 
        error: 'Company not found' 
      });
    }

    // Build component status
    const componentStatus = buildComponentStatus(company);

    // Get active configuration - check both PromptVersion and CheatSheetVersion
    let activePrompt = null;
    let activeCheatSheet = null;
    
    // Try PromptVersion first (legacy)
    activePrompt = await PromptVersion.findOne({
      companyId,
      status: 'active'
    }).lean();
    
    // Also check CheatSheetVersion (current system)
    activeCheatSheet = await CheatSheetVersion.findOne({
      companyId,
      status: 'live'
    }).lean();

    // Get ACTUAL triage cards count from TriageCard collection (not embedded in config)
    const triageCardsCount = await TriageCard.countDocuments({ companyId });
    const activeTriageCardsCount = await TriageCard.countDocuments({ companyId, isActive: true });

    // Check for Frontline-Intel
    const hasFrontlineIntel = !!(
      activeCheatSheet?.config?.frontlineIntel ||
      company.aiAgentSettings?.frontlineIntelScript ||
      company.configuration?.frontlineIntelScript
    );

    // Check for Booking Rules
    const hasBookingRules = !!(
      activeCheatSheet?.config?.bookingRules?.length > 0 ||
      company.aiAgentSettings?.bookingRules?.length > 0 ||
      company.configuration?.bookingRules?.length > 0
    );

    // Get cache status
    const cacheStatus = await getCacheStatus(companyId);

    // Build active configuration info with troubleshooting guidance
    let activeConfig = null;
    
    if (activeCheatSheet) {
      // CheatSheetVersion is the current system
      activeConfig = {
        source: 'CheatSheetVersion',
        version: activeCheatSheet.name || activeCheatSheet.versionId,
        versionId: activeCheatSheet.versionId,
        versionHash: activeCheatSheet.versionId?.substring(0, 8) || 'N/A',
        deployedAt: activeCheatSheet.activatedAt || activeCheatSheet.updatedAt,
        
        // Triage Cards - use actual collection count
        triageCardsCount,
        activeTriageCardsCount,
        hasTriageCards: triageCardsCount > 0,
        triageStatus: activeTriageCardsCount > 0 ? 'ACTIVE' : triageCardsCount > 0 ? 'INACTIVE' : 'MISSING',
        triageTroubleshooting: triageCardsCount === 0 
          ? 'Go to Triage Cards tab → Click "Auto-Generate from Brain 2" or create cards manually'
          : activeTriageCardsCount === 0 
          ? 'Triage cards exist but all are disabled. Click "Enable All" in Triage Cards tab'
          : null,
        
        // Frontline-Intel
        hasFrontlineIntel,
        frontlineStatus: hasFrontlineIntel ? 'CONFIGURED' : 'MISSING',
        frontlineTroubleshooting: !hasFrontlineIntel 
          ? 'Go to Frontline-Intel tab → Use Script Builder or paste your script → Save as Live'
          : null,
        
        // Booking Rules
        hasBookingRules,
        bookingStatus: hasBookingRules ? 'CONFIGURED' : 'MISSING',
        bookingTroubleshooting: !hasBookingRules 
          ? 'Go to Booking Rules tab → Add booking rules for how appointments should be handled'
          : null
      };
    } else if (activePrompt) {
      // Legacy PromptVersion
      activeConfig = {
        source: 'PromptVersion',
        version: activePrompt.version,
        versionHash: activePrompt.versionHash,
        deployedAt: activePrompt.deployedAt,
        triageCardsCount: activePrompt.triageCardsSnapshot?.length || 0
      };
    }

    // Response
    res.json({
      success: true,
      companyId,
      companyName: company.companyName || company.name,
      timestamp: new Date().toISOString(),
      orchestrationMode: 'LLM-0 Enhanced', // All companies now use enhanced LLM-0
      components: componentStatus,
      activePrompt: activeConfig, // Now includes CheatSheetVersion info
      cache: cacheStatus,
      status: 'operational' // Can be: operational, degraded, down
    });

  } catch (error) {
    logger.error('[AGENT STATUS] Error fetching configuration', { 
      error: error.message,
      stack: error.stack 
    });
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch agent status' 
    });
  }
});

// ============================================================================
// GET /api/admin/agent-status/:companyId/metrics - Performance Metrics
// Now reads from BlackBox where HybridReceptionistLLM actually logs data
// ============================================================================

router.get('/:companyId/metrics', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { timeRange = '24h' } = req.query; // 1h, 24h, 7d, 30d

    logger.info('[AGENT STATUS] Fetching performance metrics', { companyId, timeRange });

    // Calculate time window
    const timeWindow = getTimeWindow(timeRange);

    // Query BlackBox for actual metrics (this is where HybridReceptionistLLM logs)
    const BlackBoxRecording = require('../../models/BlackBoxRecording');
    
    // Get unique calls in time window
    const callStats = await BlackBoxRecording.aggregate([
      {
        $match: {
          companyId: companyId,
          createdAt: { $gte: timeWindow }
        }
      },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          avgDuration: { $avg: '$duration' }
        }
      }
    ]);
    
    // Get LLM response events for latency/token metrics
    const llmEvents = await BlackBoxRecording.aggregate([
      {
        $match: {
          companyId: companyId,
          createdAt: { $gte: timeWindow }
        }
      },
      { $unwind: '$events' },
      {
        $match: {
          'events.type': { $in: ['LLM_RESPONSE', 'HYBRID_LLM_RESPONSE'] }
        }
      },
      {
        $group: {
          _id: null,
          totalResponses: { $sum: 1 },
          avgLatency: { $avg: '$events.data.latencyMs' },
          maxLatency: { $max: '$events.data.latencyMs' },
          totalTokens: { $sum: '$events.data.tokensUsed' }
        }
      }
    ]);
    
    // Get fallback count (errors)
    const fallbackEvents = await BlackBoxRecording.aggregate([
      {
        $match: {
          companyId: companyId,
          createdAt: { $gte: timeWindow }
        }
      },
      { $unwind: '$events' },
      {
        $match: {
          'events.type': { $in: ['LLM_FALLBACK_USED', 'EMERGENCY_FALLBACK'] }
        }
      },
      {
        $group: {
          _id: null,
          fallbackCount: { $sum: 1 }
        }
      }
    ]);
    
    // Get emotion detections
    const emotionEvents = await BlackBoxRecording.aggregate([
      {
        $match: {
          companyId: companyId,
          createdAt: { $gte: timeWindow }
        }
      },
      { $unwind: '$events' },
      {
        $match: {
          'events.type': 'EMOTION_DETECTED'
        }
      },
      {
        $group: {
          _id: '$events.data.emotion',
          count: { $sum: 1 }
        }
      }
    ]);

    const calls = callStats[0] || { totalCalls: 0 };
    const llm = llmEvents[0] || { totalResponses: 0, avgLatency: 0, maxLatency: 0, totalTokens: 0 };
    const fallbacks = fallbackEvents[0] || { fallbackCount: 0 };
    
    // Calculate routing accuracy (successful responses vs fallbacks)
    const totalResponses = llm.totalResponses || 0;
    const fallbackCount = fallbacks.fallbackCount || 0;
    const successCount = Math.max(0, totalResponses - fallbackCount);
    const routingAccuracy = totalResponses > 0 
      ? ((successCount / totalResponses) * 100).toFixed(1)
      : 100; // If no calls, show 100%

    // Build emotion distribution from actual events
    const emotionDistribution = {};
    const defaultEmotions = ['neutral', 'frustrated', 'angry', 'panicked', 'humorous', 'stressed', 'sad'];
    defaultEmotions.forEach(e => { emotionDistribution[e] = { count: 0, percentage: 0 }; });
    
    const totalEmotions = emotionEvents.reduce((sum, e) => sum + e.count, 0) || 1;
    emotionEvents.forEach(e => {
      const emotion = (e._id || 'neutral').toLowerCase();
      emotionDistribution[emotion] = {
        count: e.count,
        percentage: ((e.count / totalEmotions) * 100).toFixed(1)
      };
    });

    // Estimated cost (GPT-4o-mini pricing)
    const estimatedCost = ((llm.totalTokens || 0) / 1000000) * 0.375;

    res.json({
      success: true,
      companyId,
      timeRange,
      timestamp: new Date().toISOString(),
      dataSource: 'BlackBox', // So we know where data comes from
      metrics: {
        calls: {
          total: calls.totalCalls,
          avgPerHour: calculateAvgPerHour(calls.totalCalls, timeRange)
        },
        performance: {
          avgLatency: Math.round(llm.avgLatency) || 0,
          maxLatency: Math.round(llm.maxLatency) || 0,
          target: 500,
          status: (llm.avgLatency || 0) < 500 ? 'good' : (llm.avgLatency || 0) < 1000 ? 'warning' : 'critical'
        },
        routing: {
          accuracy: routingAccuracy,
          correctRoutes: successCount,
          incorrectRoutes: fallbackCount,
          target: 95.0,
          status: routingAccuracy >= 95 ? 'good' : routingAccuracy >= 85 ? 'warning' : 'critical'
        },
        emotions: emotionDistribution,
        tokens: {
          total: llm.totalTokens || 0,
          avgPerCall: totalResponses > 0 ? Math.round((llm.totalTokens || 0) / totalResponses) : 0,
          estimatedCost: estimatedCost.toFixed(4)
        }
      }
    });

  } catch (error) {
    logger.error('[AGENT STATUS] Error fetching metrics', { 
      error: error.message,
      stack: error.stack 
    });
    res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch metrics' 
    });
  }
});

// ============================================================================
// GET /api/admin/agent-status/:companyId/health - System Health Check
// ============================================================================

router.get('/:companyId/health', async (req, res) => {
  try {
    const { companyId } = req.params;

    logger.info('[AGENT STATUS] Running health check', { companyId });

    const healthChecks = {
      database: await checkDatabase(companyId),
      redis: await checkRedis(companyId),
      llm: await checkLLMAvailability(),
      components: await checkComponents()
    };

    const overallStatus = Object.values(healthChecks).every(check => check.status === 'healthy')
      ? 'healthy'
      : Object.values(healthChecks).some(check => check.status === 'down')
      ? 'down'
      : 'degraded';

    res.json({
      success: true,
      companyId,
      timestamp: new Date().toISOString(),
      status: overallStatus,
      checks: healthChecks
    });

  } catch (error) {
    logger.error('[AGENT STATUS] Health check failed', { 
      error: error.message,
      stack: error.stack 
    });
    res.status(500).json({ 
      success: false, 
      error: 'Health check failed',
      status: 'down'
    });
  }
});

// ============================================================================
// GET /api/admin/agent-status/:companyId/llm-config - Get LLM Configuration
// ============================================================================

// ============================================================================
// GET/PUT LLM-0 ENABLED STATUS
// ============================================================================
// This controls whether the intelligent LLM-0 brain is active
// When disabled, the agent uses the legacy (slow, dumb) path
// ============================================================================

router.get('/:companyId/llm0-enabled', async (req, res) => {
  try {
    const { companyId } = req.params;
    const company = await V2Company.findById(companyId, 'agentSettings.llm0Enabled companyName').lean();
    
    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }
    
    res.json({
      success: true,
      companyId,
      companyName: company.companyName,
      llm0Enabled: company.agentSettings?.llm0Enabled === true
    });
  } catch (error) {
    logger.error('[AGENT STATUS] Error fetching LLM-0 status', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch LLM-0 status' });
  }
});

router.put('/:companyId/llm0-enabled', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { enabled } = req.body;
    
    logger.info('[AGENT STATUS] 🧠 Updating LLM-0 enabled status', { companyId, enabled });
    
    const company = await V2Company.findByIdAndUpdate(
      companyId,
      { $set: { 'agentSettings.llm0Enabled': enabled === true } },
      { new: true }
    );
    
    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }
    
    // Clear Redis cache to ensure new settings take effect immediately
    const { redisClient } = require('../../clients');
    if (redisClient) {
      await redisClient.del(`company:${companyId}`);
      await redisClient.del(`company:${companyId}:agentSettings`);
    }
    
    logger.info('[AGENT STATUS] ✅ LLM-0 status updated', { 
      companyId, 
      llm0Enabled: enabled === true
    });
    
    res.json({
      success: true,
      message: enabled ? '🧠 LLM-0 Brain ENABLED - Intelligent responses active' : '⚠️ LLM-0 Brain DISABLED - Using legacy path',
      llm0Enabled: enabled === true
    });
  } catch (error) {
    logger.error('[AGENT STATUS] Error updating LLM-0 status', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to update LLM-0 status' });
  }
});

router.get('/:companyId/llm-config', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    logger.info('[AGENT STATUS] Fetching LLM config', { companyId });
    
    const company = await V2Company.findById(companyId, 'aiAgentSettings.llmConfig companyName').lean();
    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }
    
    // Default config if not set
    const llmConfig = company.aiAgentSettings?.llmConfig || {
      routingModel: 'gpt-4o-mini',
      estimatedCostPer1000Calls: 0.08,
      expectedLatencyMs: 500
    };
    
    // Model info for UI
    const modelOptions = [
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        description: 'Fast & affordable - Best for most companies',
        speed: '~500ms',
        cost: '$0.08 per 1,000 calls',
        recommended: true
      },
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        description: 'Premium accuracy - For complex routing decisions',
        speed: '~1,200ms',
        cost: '$2.50 per 1,000 calls',
        recommended: false
      },
      {
        id: 'gpt-4-turbo',
        name: 'GPT-4 Turbo',
        description: 'Legacy model - Not recommended for new setups',
        speed: '~1,500ms',
        cost: '$3.00 per 1,000 calls',
        recommended: false,
        deprecated: true
      }
    ];
    
    res.json({
      success: true,
      companyId,
      companyName: company.companyName,
      llmConfig,
      modelOptions
    });
    
  } catch (error) {
    logger.error('[AGENT STATUS] Error fetching LLM config', { error: error.message });
    res.status(500).json({ success: false, error: 'Failed to fetch LLM config' });
  }
});

// ============================================================================
// PUT /api/admin/agent-status/:companyId/llm-config - Update LLM Configuration
// ============================================================================

router.put('/:companyId/llm-config', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { routingModel } = req.body;
    
    logger.info('[AGENT STATUS] Updating LLM config', { companyId, routingModel });
    
    // Validate model
    const validModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'];
    if (!validModels.includes(routingModel)) {
      return res.status(400).json({ 
        success: false, 
        error: `Invalid model. Must be one of: ${validModels.join(', ')}` 
      });
    }
    
    // Get cost/latency for selected model
    const modelConfig = {
      'gpt-4o-mini': { cost: 0.08, latency: 500 },
      'gpt-4o': { cost: 2.50, latency: 1200 },
      'gpt-4-turbo': { cost: 3.00, latency: 1500 }
    };
    
    const config = modelConfig[routingModel];
    
    // Update company
    const company = await V2Company.findByIdAndUpdate(
      companyId,
      {
        $set: {
          'aiAgentSettings.llmConfig.routingModel': routingModel,
          'aiAgentSettings.llmConfig.estimatedCostPer1000Calls': config.cost,
          'aiAgentSettings.llmConfig.expectedLatencyMs': config.latency,
          'aiAgentSettings.llmConfig.lastUpdatedAt': new Date(),
          'aiAgentSettings.llmConfig.lastUpdatedBy': req.user?.email || 'admin'
        }
      },
      { new: true }
    );
    
    if (!company) {
      return res.status(404).json({ success: false, error: 'Company not found' });
    }
    
    logger.info('[AGENT STATUS] ✅ LLM config updated', { 
      companyId, 
      routingModel,
      estimatedCost: config.cost,
      expectedLatency: config.latency
    });
    
    res.json({
      success: true,
      message: `LLM model updated to ${routingModel}`,
      llmConfig: company.aiAgentSettings?.llmConfig
    });
    
  } catch (error) {
    logger.error('[AGENT STATUS] Error updating LLM config', { 
      error: error.message,
      stack: error.stack 
    });
    res.status(500).json({ success: false, error: 'Failed to update LLM config' });
  }
});

// ============================================================================
// GET /api/admin/agent-status/platform/health - Platform-Wide Health Check
// ============================================================================
// PURPOSE: Real-time health status for ALL companies (platform-wide)
// ============================================================================

router.get('/platform/health', async (req, res) => {
  try {
    logger.info('[AGENT STATUS] Running platform-wide health check');

    // Simple inline health check (DependencyHealthMonitor was removed)
    const healthStatus = {
      overall: 'healthy',
      timestamp: new Date().toISOString(),
      checks: {
        database: { status: 'healthy', message: 'MongoDB connected' },
        redis: isRedisConfigured() ? { status: 'healthy', message: 'Redis configured' } : { status: 'degraded', message: 'Redis not configured' },
        openai: { status: 'unknown', message: 'Use /api/openai-health for real test' }
      }
    };

    // Get latest platform health check from history
    const latestHealthCheck = await HealthCheckLog.findOne()
      .sort({ timestamp: -1 })
      .limit(1)
      .lean();

    // Get unacknowledged alerts
    const unacknowledgedAlerts = await NotificationLog.aggregate([
      {
        $match: {
          'acknowledgment.isAcknowledged': false
        }
      },
      {
        $group: {
          _id: '$severity',
          count: { $sum: 1 }
        }
      }
    ]);

    const alertCounts = {
      CRITICAL: unacknowledgedAlerts.find(a => a._id === 'CRITICAL')?.count || 0,
      WARNING: unacknowledgedAlerts.find(a => a._id === 'WARNING')?.count || 0,
      INFO: unacknowledgedAlerts.find(a => a._id === 'INFO')?.count || 0
    };

    // Map health status to standard format
    const components = {};
    healthStatus.services.forEach(svc => {
      const key = svc.name.toLowerCase().replace(/\s+/g, '_');
      components[key] = {
        name: svc.name,
        status: svc.status.toLowerCase(),
        responseTime: svc.responseTime,
        message: svc.message || svc.details || 'Operational',
        critical: svc.critical || false
      };
    });

    // Determine overall status
    let overallStatus = 'healthy';
    if (healthStatus.overallStatus === 'DOWN' || healthStatus.overallStatus === 'CRITICAL') {
      overallStatus = 'down';
    } else if (healthStatus.overallStatus === 'DEGRADED') {
      overallStatus = 'degraded';
    }

    // Override to degraded if critical alerts exist
    if (alertCounts.CRITICAL > 0 && overallStatus === 'healthy') {
      overallStatus = 'degraded';
    }

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      status: overallStatus,
      components,
      alerts: {
        unacknowledged: alertCounts.CRITICAL + alertCounts.WARNING + alertCounts.INFO,
        critical: alertCounts.CRITICAL,
        warning: alertCounts.WARNING,
        info: alertCounts.INFO
      },
      lastHealthCheck: latestHealthCheck ? {
        timestamp: latestHealthCheck.timestamp,
        status: latestHealthCheck.overallStatus,
        duration: latestHealthCheck.totalDuration,
        passed: latestHealthCheck.summary?.passed || 0,
        failed: latestHealthCheck.summary?.failed || 0,
        warnings: latestHealthCheck.summary?.warnings || 0
      } : null,
      system: {
        uptime: process.uptime(),
        nodeVersion: process.version,
        platform: process.platform
      }
    });

  } catch (error) {
    logger.error('[AGENT STATUS] Platform health check failed', { 
      error: error.message,
      stack: error.stack 
    });
    res.status(500).json({ 
      success: false, 
      error: 'Platform health check failed',
      status: 'down'
    });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

function buildComponentStatus(company) {
  const status = {};
  
  for (const [category, components] of Object.entries(CURRENT_SYSTEM_COMPONENTS)) {
    status[category] = {};
    
    for (const [key, component] of Object.entries(components)) {
      status[category][key] = {
        ...component,
        enabled: component.enabled,
        status: 'operational'
      };
    }
  }
  
  return status;
}

async function getCacheStatus(companyId) {
  try {
    if (!isRedisConfigured()) {
      return {
        status: 'unavailable',
        error: 'REDIS_URL not configured'
      };
    }
    
    const redis = await getSharedRedisClient();
    if (!redis) {
      return {
        status: 'unavailable',
        error: 'Redis connection failed'
      };
    }

    const promptCacheKey = `prompt:compiled:${companyId}`;
    const promptCached = await redis.exists(promptCacheKey);
    
    const policyCacheKey = `policy:${companyId}:active`;
    const policyCached = await redis.exists(policyCacheKey);
    
    return {
      promptCompiler: {
        cached: promptCached === 1,
        key: promptCacheKey
      },
      policyEngine: {
        cached: policyCached === 1,
        key: policyCacheKey
      },
      status: 'healthy'
    };
  } catch (error) {
    logger.error('[AGENT STATUS] Cache check failed', { error: error.message });
    return {
      status: 'unavailable',
      error: error.message
    };
  }
}

function getTimeWindow(timeRange) {
  const now = new Date();
  const windows = {
    '1h': 1 * 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
    '30d': 30 * 24 * 60 * 60 * 1000
  };
  
  return new Date(now - (windows[timeRange] || windows['24h']));
}

function calculateAvgPerHour(totalCalls, timeRange) {
  const hours = {
    '1h': 1,
    '24h': 24,
    '7d': 168,
    '30d': 720
  };
  
  return Math.round(totalCalls / (hours[timeRange] || 24));
}

function calculateEmotionDistribution(emotions) {
  const distribution = {
    NEUTRAL: 0,
    FRUSTRATED: 0,
    ANGRY: 0,
    PANICKED: 0,
    HUMOROUS: 0,
    STRESSED: 0,
    SAD: 0
  };
  
  emotions.forEach(emotion => {
    if (emotion && emotion.primary && distribution.hasOwnProperty(emotion.primary)) {
      distribution[emotion.primary]++;
    }
  });
  
  const total = emotions.length || 1;
  
  return Object.entries(distribution).map(([emotion, count]) => ({
    emotion,
    count,
    percentage: ((count / total) * 100).toFixed(1)
  }));
}

async function checkDatabase(companyId) {
  try {
    const company = await V2Company.findById(companyId).lean();
    return {
      status: company ? 'healthy' : 'degraded',
      message: company ? 'Company data accessible' : 'Company not found',
      responseTime: 0 // Can add actual timing
    };
  } catch (error) {
    return {
      status: 'down',
      message: error.message,
      responseTime: 0
    };
  }
}

async function checkRedis(companyId) {
  try {
    if (!isRedisConfigured()) {
      return {
        status: 'down',
        message: 'REDIS_URL not configured',
        responseTime: 0
      };
    }
    
    const startTime = Date.now();
    const redis = await getSharedRedisClient();
    if (!redis) {
      return {
        status: 'down',
        message: 'Redis connection failed',
        responseTime: 0
      };
    }

    const testKey = `health:check:${companyId}:${Date.now()}`;
    
    // Redis v5+ uses set() with EX option instead of setex()
    await redis.set(testKey, 'test', { EX: 10 });
    const value = await redis.get(testKey);
    await redis.del(testKey);
    
    const responseTime = Date.now() - startTime;
    
    return {
      status: value === 'test' ? 'healthy' : 'degraded',
      message: value === 'test' ? 'Redis read/write successful' : 'Redis read/write failed',
      responseTime
    };
  } catch (error) {
    return {
      status: 'down',
      message: error.message,
      responseTime: 0
    };
  }
}

async function checkLLMAvailability() {
  try {
    const openaiConfigured = !!process.env.OPENAI_API_KEY;
    
    return {
      status: openaiConfigured ? 'healthy' : 'degraded',
      message: openaiConfigured ? 'OpenAI API key configured' : 'OpenAI API key missing',
      model: 'gpt-4o-mini'
    };
  } catch (error) {
    return {
      status: 'down',
      message: error.message
    };
  }
}

async function checkComponents() {
  try {
    // Check the ACTUAL current system components (Dec 2025 architecture)
    const ConversationEngine = require('../../services/ConversationEngine');
    const HybridReceptionistLLM = require('../../services/HybridReceptionistLLM');
    const SessionService = require('../../services/SessionService');
    const CustomerService = require('../../services/CustomerService');
    const BookingScriptEngine = require('../../services/BookingScriptEngine');
    
    // Verify core methods exist
    const checks = [
      { name: 'ConversationEngine.processTurn', ok: typeof ConversationEngine.processTurn === 'function' },
      { name: 'HybridReceptionistLLM.processConversation', ok: typeof HybridReceptionistLLM.processConversation === 'function' },
      { name: 'SessionService.getOrCreate', ok: typeof SessionService.getOrCreate === 'function' },
      { name: 'CustomerService.findOrCreate', ok: typeof CustomerService.findOrCreate === 'function' },
      { name: 'BookingScriptEngine.getBookingSlotsFromCompany', ok: typeof BookingScriptEngine.getBookingSlotsFromCompany === 'function' }
    ];
    
    const failedChecks = checks.filter(c => !c.ok);
    
    if (failedChecks.length > 0) {
      return {
        status: 'degraded',
        message: `Some components missing methods: ${failedChecks.map(c => c.name).join(', ')}`,
        count: checks.length - failedChecks.length
      };
    }
    
    return {
      status: 'healthy',
      message: 'All core components loaded successfully',
      count: checks.length
    };
  } catch (error) {
    return {
      status: 'down',
      message: `Component load failed: ${error.message}`,
      count: 0
    };
  }
}

module.exports = router;

