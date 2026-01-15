const { buildMigrationPreview, applyMigration } = require('../services/promptPacks/PromptPackMigrationService');

describe('PromptPackMigrationService', () => {
    it('builds a preview and applies legacy key migration safely', () => {
        const company = {
            _id: 'company123',
            aiAgentSettings: {
                frontDeskBehavior: {
                    bookingPromptsMap: {
                        hvac_service_non_urgent_consent: 'Legacy HVAC consent',
                        system_missing_prompt_fallback: 'Fallback legacy'
                    },
                    serviceFlow: {
                        promptKeysByTrade: {
                            hvac: {
                                nonUrgentConsent: 'hvac_service_non_urgent_consent'
                            }
                        }
                    },
                    promptGuards: {
                        missingPromptFallbackKey: 'system_missing_prompt_fallback'
                    },
                    promptPacks: {
                        migration: { status: 'not_started' }
                    }
                }
            }
        };

        const preview = buildMigrationPreview(company);
        expect(preview.legacyKeysFound).toContain('hvac_service_non_urgent_consent');
        expect(preview.proposedMappings[0].newKey).toBe('booking.hvac.service.non_urgent_consent');

        const result = applyMigration(company, { appliedBy: 'test-run' });
        const frontDesk = company.aiAgentSettings.frontDeskBehavior;

        expect(frontDesk.bookingPromptsMap['booking.hvac.service.non_urgent_consent']).toBe('Legacy HVAC consent');
        expect(frontDesk.serviceFlow.promptKeysByTrade.hvac.nonUrgentConsent).toBe('booking.hvac.service.non_urgent_consent');
        expect(frontDesk.promptGuards.missingPromptFallbackKey).toBe('booking.universal.guardrails.missing_prompt_fallback');
        expect(frontDesk.promptPacks.migration.status).toBe('applied');
        expect(result.migratedKeysCount).toBe(2);
    });
});
