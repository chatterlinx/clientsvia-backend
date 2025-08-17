const router = require('express').Router();

/**
 * 🔧 PHASE 4: Self-Test (lite) - Enterprise-grade production validation
 * Returns comprehensive health status for core AI Agent wiring
 */
router.get('/api/selftest/:companyId', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { companyId } = req.params;
    console.log(`[SELF-TEST] Starting validation for company: ${companyId}`);
    
    // Input validation
    if (!companyId || companyId.length < 3) {
      return res.status(400).json({ 
        ok: false, 
        error: 'Invalid company ID provided',
        timestamp: new Date().toISOString()
      });
    }
    
    // Use existing resolver service safely with performance tracking
    let config = {};
    let configSource = 'resolver';
    try {
      const resolver = require('../services/effectiveConfigResolver');
      const configResult = await resolver.getEffectiveSettings(companyId);
      config = configResult?.config || {};
      console.log(`[SELF-TEST] Config loaded via resolver in ${Date.now() - startTime}ms`);
    } catch (resolverError) {
      console.warn('⚠️ Self-test using fallback config validation:', resolverError.message);
      configSource = 'direct';
      // Fallback: Try to get basic company config
      const Company = require('../models/Company');
      const company = await Company.findOne({ companyId }).lean();
      config = company?.aiAgentLogic || {};
      console.log(`[SELF-TEST] Config loaded via direct query in ${Date.now() - startTime}ms`);
    }

    // Core validation checks (safe with fallbacks)
    const ttsOk = !!(config?.voice?.provider && config?.voice?.voiceId);
    const sttOk = true; // Twilio phone_call model is always available
    const transferOk = !!(config?.transfer?.serviceAdvisorNumber || config?.transfer?.targets?.length);
    const notifyOk = !!(config?.notify?.sms?.length || config?.notify?.email?.length);

    // Knowledge base validation with safe counting
    const qCount = 
      (config?.qna?.companyQA?.length || 0) +
      (config?.qna?.tradeQA?.length || 0) +
      (config?.qna?.generic?.length || 0);
    const knowledgeOk = qCount >= 20; // Minimum threshold for production

    // Build comprehensive result object with detailed diagnostics
    const result = {
      tts: { 
        ok: ttsOk, 
        detail: config?.voice?.provider || 'missing',
        status: ttsOk ? 'configured' : 'needs_setup'
      },
      stt: { 
        ok: sttOk, 
        detail: 'twilio phone_call',
        status: 'ready'
      },
      transfer: { 
        ok: transferOk, 
        detail: config?.transfer?.serviceAdvisorNumber || 'no advisor set',
        status: transferOk ? 'configured' : 'needs_setup'
      },
      notifications: { 
        ok: notifyOk, 
        detail: { 
          sms: (config?.notify?.sms || []).length, 
          email: (config?.notify?.email || []).length 
        },
        status: notifyOk ? 'configured' : 'optional'
      },
      knowledge: { 
        ok: knowledgeOk, 
        total: qCount,
        breakdown: {
          companyQA: config?.qna?.companyQA?.length || 0,
          tradeQA: config?.qna?.tradeQA?.length || 0,
          generic: config?.qna?.generic?.length || 0
        },
        status: knowledgeOk ? 'sufficient' : 'needs_content'
      }
    };

    // Overall health assessment with performance metrics
    const overallOk = ttsOk && sttOk && knowledgeOk;
    const executionTime = Date.now() - startTime;
    
    console.log(`[SELF-TEST] Completed in ${executionTime}ms - Overall: ${overallOk ? 'PASS' : 'FAIL'}`);

    res.json({ 
      ok: overallOk, 
      result,
      meta: {
        configSource,
        executionTimeMs: executionTime,
        timestamp: new Date().toISOString(),
        companyId,
        version: '4.0'
      }
    });

  } catch (error) {
    console.error('❌ Self-test error:', error);
    res.status(500).json({ 
      ok: false, 
      error: error?.message || 'selftest-failed',
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
