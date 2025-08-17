// Phase 2 — platform-wide fallbacks (ENV-backed)
module.exports = () => ({
  timezone: process.env.DEFAULT_TIMEZONE || "America/New_York",
  voice: {
    provider: process.env.DEFAULT_VOICE_PROVIDER || "elevenlabs",
    voiceId: process.env.DEFAULT_VOICE_ID || "Mathew",
  },
  transfer: {
    serviceAdvisorNumber: process.env.DEFAULT_SERVICE_ADVISOR || "+15555550100",
    notifySms: process.env.DEFAULT_NOTIFY_SMS || "+15555550100",
    notifyEmail: process.env.DEFAULT_NOTIFY_EMAIL || "support@example.com",
  },
  hours: { afterHoursIntake: true },
});
