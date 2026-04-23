/**
 * ConfigResolver.js — Media Streams per-tenant config resolution
 *
 * Single source of truth for resolving Deepgram live STT config.
 * Precedence: tenant override → platform default → hardcoded last-resort.
 *
 * Lives outside any route/service so every caller (MediaStreamServer in C3,
 * /voice branch in C4, Test Console, health checks) reads the same values.
 *
 * ⚠️ Multi-tenant rule: NEVER hardcode a model/endpointing/language in a
 * service file. All such values flow through this resolver. Last-resort
 * defaults are only here so the resolver never returns null.
 *
 * @module services/mediaStream/ConfigResolver
 * @version 1.0.0
 */

'use strict';

// Last-resort defaults — only used if both the company and AdminSettings
// are missing the relevant key. Platform defaults should live in
// AdminSettings.globalHub.mediaStreams (see models/AdminSettings.js).
const HARDCODED_FALLBACKS = Object.freeze({
    model: 'nova-3',
    endpointingMs: 300,
    utteranceEndMs: 1000,
    language: 'en-US'
});

/**
 * Internal: return the first defined, non-null value from a list.
 * Treats undefined and null as missing. Treats 0, '', and false as valid.
 */
function firstDefined(...values) {
    for (const v of values) {
        if (v !== undefined && v !== null) return v;
    }
    return undefined;
}

/**
 * Resolve Media Streams config for a tenant.
 *
 * @param {Object} company - Mongoose company doc or plain object
 * @param {Object} [adminSettings] - AdminSettings doc (plain or Mongoose)
 * @returns {{
 *   model:          string,
 *   endpointingMs:  number,
 *   utteranceEndMs: number,
 *   language:       string,
 *   enabled:        boolean,
 *   source: {
 *     model:          'tenant' | 'platform' | 'fallback',
 *     endpointingMs:  'tenant' | 'platform' | 'fallback',
 *     utteranceEndMs: 'tenant' | 'platform' | 'fallback',
 *     language:       'tenant' | 'platform' | 'fallback'
 *   }
 * }}
 */
function resolveMediaStreamConfig(company, adminSettings) {
    const tenant = company?.aiAgentSettings?.agent2?.mediaStreams || {};
    const platform = adminSettings?.globalHub?.mediaStreams || {};

    const resolved = {
        enabled: Boolean(tenant.enabled),
        model: firstDefined(tenant.model, platform.defaultModel, HARDCODED_FALLBACKS.model),
        endpointingMs: firstDefined(tenant.endpointingMs, platform.defaultEndpointingMs, HARDCODED_FALLBACKS.endpointingMs),
        utteranceEndMs: firstDefined(tenant.utteranceEndMs, platform.defaultUtteranceEndMs, HARDCODED_FALLBACKS.utteranceEndMs),
        language: firstDefined(tenant.languageOverride, platform.defaultLanguage, HARDCODED_FALLBACKS.language)
    };

    resolved.source = {
        model: tenant.model != null ? 'tenant' : (platform.defaultModel != null ? 'platform' : 'fallback'),
        endpointingMs: tenant.endpointingMs != null ? 'tenant' : (platform.defaultEndpointingMs != null ? 'platform' : 'fallback'),
        utteranceEndMs: tenant.utteranceEndMs != null ? 'tenant' : (platform.defaultUtteranceEndMs != null ? 'platform' : 'fallback'),
        language: tenant.languageOverride != null ? 'tenant' : (platform.defaultLanguage != null ? 'platform' : 'fallback')
    };

    return resolved;
}

/**
 * Shortcut for the most common question: is Media Streams path enabled for
 * this tenant? Encodes the single contract callers need so the feature-flag
 * check is centralised (easier to audit/extend later).
 *
 * @param {Object} company
 * @returns {boolean}
 */
function isMediaStreamsEnabled(company) {
    return Boolean(company?.aiAgentSettings?.agent2?.mediaStreams?.enabled);
}

module.exports = {
    resolveMediaStreamConfig,
    isMediaStreamsEnabled,
    HARDCODED_FALLBACKS
};
