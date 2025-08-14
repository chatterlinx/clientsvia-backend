/**
 * Phase 7: Audio Debug API
 * Provides real-time verification of audio sources during and after calls
 * Proves every audio file came from the correct AI Agent Logic pipeline
 */

const express = require('express');
const router = express.Router();
const { getCallAudioEvents, validateAudioSources } = require('../utils/audioEventTracer');
const { isGuardArmed } = require('../utils/twilioSayGuard');
const { VOICE_GUARD_V1, KILL_TWIML_SAY } = require('../../config/flags');
const logger = require('../../utils/logger');

/**
 * GET /api/debug/call/:callSid/audio-events
 * Get comprehensive audio event log for a specific call
 */
router.get('/call/:callSid/audio-events', async (req, res) => {
  try {
    const { callSid } = req.params;
    
    if (!VOICE_GUARD_V1) {
      return res.status(404).json({ 
        ok: false, 
        error: 'Audio tracing disabled (VOICE_GUARD_V1=off)',
        feature: 'VOICE_GUARD_V1',
        enabled: false
      });
    }

    const result = await getCallAudioEvents(callSid);
    
    if (!result.ok) {
      return res.status(404).json(result);
    }

    // Add validation analysis
    const validation = validateAudioSources(result.events);
    
    // Add system status
    const systemStatus = {
      voiceGuardEnabled: VOICE_GUARD_V1,
      twilioSayBlocked: KILL_TWIML_SAY && isGuardArmed(),
      tracingActive: true
    };

    res.json({
      ...result,
      validation,
      systemStatus,
      message: `Found ${result.totalEvents} audio events for call ${callSid}`
    });

  } catch (error) {
    logger.error('[DEBUG_API] Error fetching audio events', {
      error: error.message,
      callSid: req.params.callSid
    });
    res.status(500).json({ 
      ok: false, 
      error: 'Internal server error',
      details: error.message 
    });
  }
});

/**
 * GET /api/debug/call/:callSid/voice-source-proof
 * Simplified endpoint that proves voice source for quick verification
 */
router.get('/call/:callSid/voice-source-proof', async (req, res) => {
  try {
    const { callSid } = req.params;
    const result = await getCallAudioEvents(callSid);
    
    if (!result.ok) {
      return res.status(404).json({ 
        ok: false, 
        error: 'No audio events found',
        callSid,
        proof: 'unavailable'
      });
    }

    const events = result.events;
    const greetingEvent = events.find(e => e.kind === 'greeting');
    const responseEvents = events.filter(e => e.kind === 'response');
    
    const proof = {
      callSid,
      greetingSource: greetingEvent ? {
        provider: greetingEvent.provider,
        domain: greetingEvent.urlDomain,
        timestamp: greetingEvent.timestamp,
        verified: greetingEvent.provider === 'elevenlabs'
      } : null,
      responsesSources: responseEvents.map(e => ({
        provider: e.provider,
        domain: e.urlDomain,
        timestamp: e.timestamp,
        verified: ['elevenlabs', 'cache'].includes(e.provider)
      })),
      allFromElevenLabs: events.every(e => ['elevenlabs', 'cache'].includes(e.provider)),
      totalAudioEvents: events.length,
      systemGuarded: KILL_TWIML_SAY && isGuardArmed()
    };

    res.json({
      ok: true,
      proof,
      message: proof.allFromElevenLabs ? 
        '✅ ALL audio verified from ElevenLabs/Cache - No Twilio voice detected!' :
        '⚠️ Mixed audio sources detected - Review events for details'
    });

  } catch (error) {
    logger.error('[DEBUG_API] Error generating voice source proof', {
      error: error.message,
      callSid: req.params.callSid
    });
    res.status(500).json({ 
      ok: false, 
      error: 'Failed to generate proof',
      details: error.message 
    });
  }
});

/**
 * GET /api/debug/system/voice-guard-status
 * Check overall system voice guard status
 */
router.get('/system/voice-guard-status', (req, res) => {
  const status = {
    voiceGuardEnabled: VOICE_GUARD_V1,
    twilioSayBlocked: KILL_TWIML_SAY,
    guardArmed: isGuardArmed(),
    tracingActive: VOICE_GUARD_V1,
    timestamp: new Date().toISOString(),
    features: {
      VOICE_GUARD_V1,
      KILL_TWIML_SAY
    }
  };

  const overallStatus = status.guardArmed && status.tracingActive ? 'PROTECTED' : 'PARTIAL';
  
  res.json({
    ok: true,
    status: overallStatus,
    details: status,
    message: overallStatus === 'PROTECTED' ? 
      '🛡️ Voice guard fully active - Only ElevenLabs can speak' :
      '⚠️ Voice guard partially active - Check feature flags'
  });
});

/**
 * POST /api/debug/test/audio-trace
 * Test endpoint to manually add audio events (for testing)
 */
router.post('/test/audio-trace', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Test endpoints disabled in production' });
  }

  try {
    const { addAudioEvent } = require('../utils/audioEventTracer');
    const { callSid, provider = 'elevenlabs', text = 'Test audio', kind = 'test' } = req.body;
    
    if (!callSid) {
      return res.status(400).json({ error: 'callSid required' });
    }

    await addAudioEvent({
      callSid,
      companyId: 'test-company',
      provider,
      url: `https://example.com/test-audio-${Date.now()}.mp3`,
      text,
      kind,
      metadata: { test: true }
    });

    res.json({ 
      ok: true, 
      message: 'Test audio event added',
      callSid,
      provider,
      kind
    });

  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to add test audio event',
      details: error.message 
    });
  }
});

module.exports = router;
