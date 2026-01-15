const { resolveBookingPrompt, resolveServiceFlowPrompts } = require('../services/PromptResolver');
const { getPromptPackById } = require('../config/promptPacks');

describe('PromptResolver', () => {
    it('resolves booking prompts from a plain object', () => {
        const company = {
            aiAgentSettings: {
                frontDeskBehavior: {
                    bookingPromptsMap: {
                        hvac_service_non_urgent_consent: 'Schedule service?'
                    }
                }
            }
        };

        expect(resolveBookingPrompt(company, 'hvac_service_non_urgent_consent')).toBe('Schedule service?');
    });

    it('resolves service flow prompts by trade', () => {
        const promptMap = new Map();
        promptMap.set('booking.hvac.service.non_urgent_consent', 'Consent');
        promptMap.set('booking.hvac.service.urgent_triage_question', 'Urgent');
        promptMap.set('booking.hvac.service.post_triage_consent', 'Post');
        promptMap.set('booking.hvac.service.consent_clarify', 'Clarify');

        const company = {
            aiAgentSettings: {
                frontDeskBehavior: {
                    bookingPromptsMap: promptMap,
                    serviceFlow: {
                        mode: 'hybrid',
                        promptKeysByTrade: {
                            hvac: {
                                nonUrgentConsent: 'booking.hvac.service.non_urgent_consent',
                                urgentTriageQuestion: 'booking.hvac.service.urgent_triage_question',
                                postTriageConsent: 'booking.hvac.service.post_triage_consent',
                                consentClarify: 'booking.hvac.service.consent_clarify'
                            }
                        }
                    }
                }
            }
        };

        const prompts = resolveServiceFlowPrompts(company, 'hvac');
        expect(prompts).toEqual({
            nonUrgentConsent: 'Consent',
            urgentTriageQuestion: 'Urgent',
            postTriageConsent: 'Post',
            consentClarify: 'Clarify'
        });
    });

    it('falls back to explicit prompt packs when tenant map is missing', () => {
        const hvacPack = getPromptPackById('hvac_v1');
        const company = {
            aiAgentSettings: {
                frontDeskBehavior: {
                    bookingPromptsMap: {},
                    promptPacks: {
                        enabled: true,
                        selectedByTrade: {
                            hvac: 'hvac_v1',
                            universal: 'universal_v1'
                        }
                    }
                }
            }
        };

        const prompt = resolveBookingPrompt(
            company,
            'booking.hvac.service.non_urgent_consent',
            { tradeKey: 'hvac' }
        );

        expect(prompt).toBe(hvacPack.prompts['booking.hvac.service.non_urgent_consent']);
    });
});
