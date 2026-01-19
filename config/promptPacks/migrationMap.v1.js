// V83 FIX: Use colons instead of dots - Mongoose Maps don't allow dots in keys
const LEGACY_PROMPT_KEY_MAP_V1 = {
    // Guardrail fallback
    system_missing_prompt_fallback: 'booking:universal:guardrails:missing_prompt_fallback',

    // HVAC service flow
    hvac_service_non_urgent_consent: 'booking:hvac:service:non_urgent_consent',
    hvac_service_urgent_triage: 'booking:hvac:service:urgent_triage_question',
    hvac_service_urgent_consent: 'booking:hvac:service:urgent_consent',
    hvac_service_post_triage_consent: 'booking:hvac:service:post_triage_consent',
    hvac_service_consent_clarify: 'booking:hvac:service:consent_clarify',

    // Plumbing service flow
    plumbing_service_non_urgent_consent: 'booking:plumbing:service:non_urgent_consent',
    plumbing_service_urgent_triage: 'booking:plumbing:service:urgent_triage_question',
    plumbing_service_urgent_consent: 'booking:plumbing:service:urgent_consent',
    plumbing_service_post_triage_consent: 'booking:plumbing:service:post_triage_consent',
    plumbing_service_consent_clarify: 'booking:plumbing:service:consent_clarify',

    // Electrical service flow
    electrical_service_non_urgent_consent: 'booking:electrical:service:non_urgent_consent',
    electrical_service_urgent_triage: 'booking:electrical:service:urgent_triage_question',
    electrical_service_urgent_consent: 'booking:electrical:service:urgent_consent',
    electrical_service_post_triage_consent: 'booking:electrical:service:post_triage_consent',
    electrical_service_consent_clarify: 'booking:electrical:service:consent_clarify',

    // Appliance service flow
    appliance_service_non_urgent_consent: 'booking:appliance:service:non_urgent_consent',
    appliance_service_urgent_triage: 'booking:appliance:service:urgent_triage_question',
    appliance_service_urgent_consent: 'booking:appliance:service:urgent_consent',
    appliance_service_post_triage_consent: 'booking:appliance:service:post_triage_consent',
    appliance_service_consent_clarify: 'booking:appliance:service:consent_clarify'
};

function getLegacyPromptKeyMap() {
    return { ...LEGACY_PROMPT_KEY_MAP_V1 };
}

function isLegacyPromptKey(key) {
    return Boolean(LEGACY_PROMPT_KEY_MAP_V1[key]);
}

module.exports = {
    LEGACY_PROMPT_KEY_MAP_V1,
    getLegacyPromptKeyMap,
    isLegacyPromptKey
};
