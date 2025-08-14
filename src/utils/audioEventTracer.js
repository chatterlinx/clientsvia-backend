/**
 * Phase 7: Audio Event Tracer
 * Comprehensive logging of all audio events for voice source verification
 * Proves every audio file came from the correct AI Agent Logic + ElevenLabs pipeline
 */

const crypto = require('crypto');
const logger = require('../../utils/logger');
const { VOICE_GUARD_V1 } = require('../../config/flags');

/**
 * Create a short hash of text for tracking without storing sensitive content
 */
function hashText(text) {
  if (!text || typeof text !== 'string') return 'empty';
  return crypto.createHash('sha1').update(text).digest('hex').slice(0, 10);
}

/**
 * Add an audio event to the response trace for comprehensive audit trail
 * This creates an immutable record of every audio file played during a call
 */
async function addAudioEvent({ callSid, companyId, provider, url, text, kind, metadata = {} }) {
  if (!VOICE_GUARD_V1) {
    // Feature disabled - just log locally
    logger.debug('[AUDIO_TRACE] Audio event (tracing disabled)', { provider, kind, url: url?.substring(0, 50) + '...' });
    return;
  }

  try {
    // Import here to avoid circular dependencies
    const ResponseTrace = require('../models/ResponseTrace');
    
    const textHash = hashText(text);
    const audioEvent = {
      type: 'audio_event',
      timestamp: new Date().toISOString(),
      applied: true,
      config: { 
        provider,        // 'elevenlabs' | 'cache' | 'twilio' | 'fallback'
        kind,           // 'greeting' | 'response' | 'fallback' | 'transfer_prompt' | 'hangup'
        ...metadata     // Additional context (voice_id, language, etc.)
      },
      result: { 
        url: url || 'unknown',
        textHash,
        textLength: text ? text.length : 0,
        urlDomain: url ? new URL(url).hostname : 'unknown'
      }
    };

    // Find or create response trace for this call
    let trace = await ResponseTrace.findOne({ callSid }).sort({ createdAt: -1 });
    
    if (!trace) {
      // Create new trace if none exists
      trace = new ResponseTrace({
        callSid,
        companyId,
        behaviors: [audioEvent],
        summary: {
          audioEventsCount: 1,
          primaryProvider: provider
        },
        createdAt: new Date()
      });
    } else {
      // Add to existing trace
      if (!trace.behaviors) trace.behaviors = [];
      trace.behaviors.push(audioEvent);
      
      // Update summary statistics
      if (!trace.summary) trace.summary = {};
      trace.summary.audioEventsCount = (trace.summary.audioEventsCount || 0) + 1;
      if (!trace.summary.primaryProvider && provider !== 'cache') {
        trace.summary.primaryProvider = provider;
      }
    }

    await trace.save();

    logger.info('[AUDIO_TRACE] 🎵 Audio event recorded', {
      callSid,
      provider,
      kind,
      textHash,
      urlDomain: audioEvent.result.urlDomain,
      traceId: trace._id
    });

  } catch (error) {
    logger.error('[AUDIO_TRACE] ❌ Failed to record audio event', {
      error: error.message,
      callSid,
      provider,
      kind
    });
    // Don't throw - audio tracing should never break the call flow
  }
}

/**
 * Helper to trace ElevenLabs audio generation
 */
async function traceElevenLabsAudio({ callSid, companyId, url, text, kind = 'response', voiceId, modelId }) {
  return addAudioEvent({
    callSid,
    companyId,
    provider: 'elevenlabs',
    url,
    text,
    kind,
    metadata: {
      voiceId,
      modelId,
      apiVersion: 'v1'
    }
  });
}

/**
 * Helper to trace cached audio usage
 */
async function traceCachedAudio({ callSid, companyId, url, text, kind = 'response', cacheKey }) {
  return addAudioEvent({
    callSid,
    companyId,
    provider: 'cache',
    url,
    text,
    kind,
    metadata: {
      cacheKey,
      cached: true
    }
  });
}

/**
 * Helper to trace fallback audio (if any)
 */
async function traceFallbackAudio({ callSid, companyId, url, text, kind = 'fallback', fallbackReason }) {
  return addAudioEvent({
    callSid,
    companyId,
    provider: 'fallback',
    url,
    text,
    kind,
    metadata: {
      fallbackReason,
      emergency: true
    }
  });
}

/**
 * Get all audio events for a specific call
 */
async function getCallAudioEvents(callSid) {
  if (!VOICE_GUARD_V1) {
    return { ok: false, error: 'Audio tracing disabled (VOICE_GUARD_V1=off)' };
  }

  try {
    const ResponseTrace = require('../models/ResponseTrace');
    const trace = await ResponseTrace.findOne({ callSid }).sort({ createdAt: -1 }).lean();
    
    if (!trace) {
      return { ok: false, error: 'No trace found for call' };
    }

    const audioEvents = (trace.behaviors || [])
      .filter(b => b?.type === 'audio_event')
      .map(b => ({
        timestamp: b.timestamp,
        provider: b?.config?.provider,
        kind: b?.config?.kind,
        url: b?.result?.url,
        textHash: b?.result?.textHash,
        textLength: b?.result?.textLength,
        urlDomain: b?.result?.urlDomain,
        metadata: { ...b.config }
      }))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return {
      ok: true,
      callSid,
      totalEvents: audioEvents.length,
      events: audioEvents,
      summary: trace.summary || {},
      traceId: trace._id
    };
    
  } catch (error) {
    logger.error('[AUDIO_TRACE] ❌ Failed to get call audio events', {
      error: error.message,
      callSid
    });
    return { ok: false, error: error.message };
  }
}

/**
 * Validate that all audio in a call came from expected sources
 */
function validateAudioSources(audioEvents, expectedProviders = ['elevenlabs', 'cache']) {
  const unexpectedSources = audioEvents.filter(event => 
    !expectedProviders.includes(event.provider)
  );
  
  const isValid = unexpectedSources.length === 0;
  
  return {
    isValid,
    unexpectedSources,
    totalEvents: audioEvents.length,
    providerBreakdown: audioEvents.reduce((acc, event) => {
      acc[event.provider] = (acc[event.provider] || 0) + 1;
      return acc;
    }, {})
  };
}

module.exports = {
  addAudioEvent,
  traceElevenLabsAudio,
  traceCachedAudio,
  traceFallbackAudio,
  getCallAudioEvents,
  validateAudioSources,
  hashText
};
