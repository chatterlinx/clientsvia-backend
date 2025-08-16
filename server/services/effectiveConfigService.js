/**
 * Effective Configuration Service
 * Wrapper around resolver + cache + env hydration + module reset helper
 * Provides:
 *  - getEffectiveSettings(companyId)
 *  - getEffectiveModule(companyId, moduleKey)
 *  - invalidate(companyId, moduleKey)
 *  - resetModule(companyId, moduleKey)
 *
 * Keeps resolver standalone and provides a single integration point for routes/runtime.
 */

const resolver = require('./effectiveConfigResolver');
const cache = require('./effectiveConfigCache');
const starterPack = require('../presets/starterPack.hvac_v1.json');
const platformDefaults = require('../presets/platformDefaults.json');
const Company = require('../../models/Company');

function hydrateWithEnv(config) {
    // Overlay environment-backed platform defaults (non-destructive)
    try {
        const envVoice = process.env.DEFAULT_VOICE_ID || process.env.DEFAULT_VOICE || null;
        const envTz = process.env.DEFAULT_TIMEZONE || null;
        const envFallbackPhone = process.env.FALLBACK_TRANSFER_NUMBER || null;
        const envFallbackEmail = process.env.FALLBACK_TRANSFER_EMAIL || null;
        const envSupportHours = process.env.SUPPORT_HOURS || null;

        if (!config) return config;

        const out = JSON.parse(JSON.stringify(config));

        out.environment = out.environment || {};
        if (envVoice) out.environment.defaultVoiceId = envVoice;
        if (envTz) out.environment.defaultTimezone = envTz;
        if (envFallbackPhone) out.environment.fallbackTransferNumber = envFallbackPhone;
        if (envFallbackEmail) out.environment.fallbackTransferEmail = envFallbackEmail;
        if (envSupportHours) out.environment.supportHours = envSupportHours;

        // Ensure voice top-level also reflects chosen defaults if missing
        out.voice = out.voice || {};
        if (!out.voice.voiceId && out.environment.defaultVoiceId) out.voice.voiceId = out.environment.defaultVoiceId;

        return out;
    } catch (err) {
        console.warn('[EffectiveService] Failed to hydrate env onto config:', err.message);
        return config;
    }
}

async function getEffectiveSettings(companyId) {
    if (!companyId) throw new Error('companyId required');

    // Try cache first
    const cached = cache.get(companyId, 'full');
    if (cached) {
        return { config: hydrateWithEnv(cached.config), etag: cached.etag };
    }

    // Resolve fresh
    const resolved = await resolver.getEffectiveSettings(companyId);
    const hydrated = hydrateWithEnv(resolved);
    const etag = cache.set(companyId, hydrated, 'full');

    return { config: hydrated, etag };
}

async function getEffectiveModule(companyId, moduleKey) {
    if (!companyId) throw new Error('companyId required');
    if (!moduleKey) throw new Error('moduleKey required');

    const cached = cache.get(companyId, moduleKey);
    if (cached) {
        return { config: hydrateWithEnv(cached.config), etag: cached.etag };
    }

    const resolved = await resolver.getEffectiveModule(companyId, moduleKey);
    const hydrated = hydrateWithEnv(resolved);
    const etag = cache.set(companyId, hydrated, moduleKey);

    return { config: hydrated, etag };
}

function invalidate(companyId, moduleKey = null) {
    if (!companyId) return;
    cache.invalidate(companyId, moduleKey);
}

async function resetModule(companyId, moduleKey, actor = 'system') {
    if (!companyId || !moduleKey) throw new Error('companyId and moduleKey required');

    const company = await Company.findById(companyId);
    if (!company) throw new Error('Company not found');

    // Build update payload by mapping moduleKey to starterPack defaults
    const updateFields = {};
    switch (moduleKey) {
        case 'knowledge':
            // companyQnA and tradeCategories
            updateFields.companyQnA = starterPack.knowledge?.companyKB?.entries || [];
            updateFields.tradeCategories = starterPack.knowledge?.tradeCategories || [];
            break;
        case 'agent-settings':
        case 'agentSettings':
            updateFields.agentSettings = starterPack.agentSettings || {};
            break;
        case 'intelligence':
            // Store intelligence preferences back into agentSettings where we read them from
            updateFields.agentSettings = Object.assign({}, company.agentSettings || {}, {
                memoryMode: starterPack.intelligence?.memoryMode,
                confidenceScoring: starterPack.agentSettings?.confidenceScoring ?? (company.agentSettings && company.agentSettings.confidenceScoring),
                semanticSearchEnabled: starterPack.agentSettings?.semanticSearchEnabled ?? (company.agentSettings && company.agentSettings.semanticSearchEnabled)
            });
            break;
        case 'personality':
            updateFields.personalitySettings = starterPack.personality || {};
            break;
        case 'voice':
            // Map voice defaults to aiSettings / elevenLabs
            updateFields.aiSettings = Object.assign({}, company.aiSettings || {}, {
                ttsProvider: starterPack.voice?.provider || company.aiSettings?.ttsProvider
            });
            // set elevenLabs voice id if using elevenlabs
            if (starterPack.voice?.voiceId) {
                updateFields.elevenLabs = Object.assign({}, company.elevenLabs || {}, { voiceId: starterPack.voice.voiceId });
            }
            break;
        case 'transfer':
            updateFields.transferEmail = starterPack.transfer?.transferEmail || company.transferEmail;
            updateFields.transferPhone = starterPack.transfer?.transferPhone || company.transferPhone;
            break;
        case 'booking':
            updateFields.agentSetup = Object.assign({}, company.agentSetup || {}, {
                operatingHours: starterPack.booking?.operatingHours || company.agentSetup?.operatingHours,
                timezone: starterPack.booking?.timezone || company.agentSetup?.timezone,
                use247Routing: starterPack.booking?.use247Routing ?? company.agentSetup?.use247Routing,
                afterHoursAction: starterPack.booking?.afterHoursAction || company.agentSetup?.afterHoursAction
            });
            break;
        case 'notifications':
            updateFields.emailNotifications = starterPack.notifications?.emailNotifications ?? company.emailNotifications;
            updateFields.smsNotifications = starterPack.notifications?.smsNotifications ?? company.smsNotifications;
            break;
        default:
            throw new Error('Unknown moduleKey for reset: ' + moduleKey);
    }

    updateFields.updatedAt = new Date();

    const updated = await Company.findByIdAndUpdate(companyId, { $set: updateFields }, { new: true, runValidators: true });
    if (!updated) throw new Error('Failed to update company during reset');

    // Invalidate caches and return fresh module
    invalidate(companyId, null);
    const { config, etag } = await getEffectiveModule(companyId, moduleKey);
    return { company: updated, module: config, etag };
}

module.exports = {
    getEffectiveSettings,
    getEffectiveModule,
    invalidate,
    resetModule
};
