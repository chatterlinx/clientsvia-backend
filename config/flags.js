/**
 * Production Feature Flags Configuration
 * Multi-tenant platform flags for controlled rollouts
 */

module.exports = {
  // AI Agent Logic v2 rollout
  AI_LOGIC_V2: process.env.AI_LOGIC_V2 === 'on',
  
  // Enhanced fallback message system
  FALLBACK_V2: process.env.FALLBACK_V2 === 'on',
  
  // Soft configuration defaults for new companies
  CONFIG_SOFT_DEFAULTS: process.env.CONFIG_SOFT_DEFAULTS === 'on',
  
  // TTS voice consistency lock
  TTS_LOCK: process.env.TTS_LOCK === 'on',
  
  // Real-time notifications system
  NOTIFY_ENABLED: process.env.NOTIFY_ENABLED === 'on',
  
  // Directory service v2
  DIRECTORY_V2: process.env.DIRECTORY_V2 === 'on',
  
  // Phase 3: Reason-specific fallback overrides
  FALLBACK_OVERRIDES_V1: process.env.FALLBACK_OVERRIDES_V1 === 'on',
  
  // Phase 4: Tenant-scoped fallback actions (SMS, transfer, voicemail, callback, booking)
  FALLBACK_ACTIONS_V1: process.env.FALLBACK_ACTIONS_V1 === 'on',
  
  // ==== Directory & Notifications (MVP) ====
  DIRECTORY_V1: process.env.DIRECTORY_V1?.toLowerCase?.() === 'on',
  NOTIFY_V1: process.env.NOTIFY_V1?.toLowerCase?.() === 'on',
  
  // ==== Phase 2: Live Effective Config Resolver ====
  LIVE_RESOLVER_V1: process.env.LIVE_RESOLVER_V1?.toLowerCase?.() === 'on' || process.env.LIVE_RESOLVER_V1 === 'true' || true, // Default ON for Phase 2
  
  // ==== Phase 6: Default Presets & Auto-Onboarding ====
  PRESETS_V1: process.env.PRESETS_V1 === 'on',
  PRESET_DEFAULT: process.env.PRESET_DEFAULT || 'hvac_starter',
  
  // ==== Phase 7: One Voice, One Source (Audio Verification & Guardrails) ====
  VOICE_GUARD_V1: process.env.VOICE_GUARD_V1 === 'on',     // enable audio event tracing
  KILL_TWIML_SAY: process.env.KILL_TWIML_SAY === 'on',     // block any TwiML <Say>
  
  // ==== Phase 8: Publish & Snapshot (Compiled Config Pipeline) ====
  PUBLISH_V1: process.env.PUBLISH_V1 === 'on',             // enable config snapshots
  
  // Helper to check if any experimental features are enabled
  hasExperimentalFeatures() {
    return this.AI_LOGIC_V2 || this.FALLBACK_V2 || this.CONFIG_SOFT_DEFAULTS || 
           this.TTS_LOCK || this.NOTIFY_ENABLED || this.DIRECTORY_V2 || 
           this.FALLBACK_OVERRIDES_V1 || this.FALLBACK_ACTIONS_V1 ||
           this.DIRECTORY_V1 || this.NOTIFY_V1 || this.PRESETS_V1 ||
           this.VOICE_GUARD_V1 || this.KILL_TWIML_SAY || this.PUBLISH_V1 ||
           this.LIVE_RESOLVER_V1;
  },
  
  // Get flags summary for debugging
  getSummary() {
    return {
      AI_LOGIC_V2: this.AI_LOGIC_V2,
      FALLBACK_V2: this.FALLBACK_V2,
      CONFIG_SOFT_DEFAULTS: this.CONFIG_SOFT_DEFAULTS,
      TTS_LOCK: this.TTS_LOCK,
      NOTIFY_ENABLED: this.NOTIFY_ENABLED,
      DIRECTORY_V2: this.DIRECTORY_V2,
      FALLBACK_OVERRIDES_V1: this.FALLBACK_OVERRIDES_V1,
      FALLBACK_ACTIONS_V1: this.FALLBACK_ACTIONS_V1,
      DIRECTORY_V1: this.DIRECTORY_V1,
      NOTIFY_V1: this.NOTIFY_V1,
      PRESETS_V1: this.PRESETS_V1,
      PRESET_DEFAULT: this.PRESET_DEFAULT,
      VOICE_GUARD_V1: this.VOICE_GUARD_V1,
      KILL_TWIML_SAY: this.KILL_TWIML_SAY,
      PUBLISH_V1: this.PUBLISH_V1,
      LIVE_RESOLVER_V1: this.LIVE_RESOLVER_V1,
      experimental: this.hasExperimentalFeatures()
    };
  }
};
