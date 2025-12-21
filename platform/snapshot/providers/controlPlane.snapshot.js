/**
 * ============================================================================
 * CONTROL PLANE SNAPSHOT PROVIDER
 * ============================================================================
 * Provides: Front desk, greeting, tone, booking configuration
 */

const Company = require('../../../models/v2Company');
const logger = require('../../../utils/logger');

module.exports.getSnapshot = async function(companyId) {
    const startTime = Date.now();
    
    try {
        const company = await Company.findById(companyId)
            .select('companyName aiAgentSettings frontDeskBehavior tradeKey industryType')
            .lean();
        
        if (!company) {
            return {
                provider: 'controlPlane',
                providerVersion: '1.0',
                schemaVersion: 'v1',
                enabled: false,
                health: 'RED',
                error: 'Company not found',
                data: null,
                generatedIn: Date.now() - startTime
            };
        }
        
        const settings = company.aiAgentSettings || {};
        const frontDesk = settings.frontDeskBehavior || {};
        
        // Extract configuration
        // FIXED: Check correct DB paths for greeting (Dec 2025)
        // - frontDeskBehavior.greeting is a STRING (canonical)
        // - conversationStages.greetingRules is array
        // - fallbackResponses.greeting is fallback string
        // 
        // PRECEDENCE ORDER (locked):
        // 1. frontDeskBehavior.greeting (canonical)
        // 2. conversationStages.greetingRules (rule-based)
        // 3. fallbackResponses.greeting (fallback)
        
        let greetingConfigured = false;
        let greetingSource = 'none';
        
        if (frontDesk.greeting && frontDesk.greeting.trim().length > 0) {
            greetingConfigured = true;
            greetingSource = 'frontDeskBehavior';
        } else if (settings.conversationStages?.greetingRules?.length > 0) {
            // Check if at least one rule is valid (has trigger + response)
            const validRules = settings.conversationStages.greetingRules.filter(
                r => r.trigger && r.response
            );
            if (validRules.length > 0) {
                greetingConfigured = true;
                greetingSource = 'conversationStages';
            }
        } else if (settings.fallbackResponses?.greeting && settings.fallbackResponses.greeting.trim().length > 0) {
            greetingConfigured = true;
            greetingSource = 'fallbackResponses';
        }
        
        const bookingEnabled = settings.bookingEnabled !== false;
        const bookingSlots = frontDesk.bookingSlots || [];
        
        const escalationRules = frontDesk.escalationTriggers || [];
        
        // Determine health
        let health = 'GREEN';
        const warnings = [];
        
        if (!greetingConfigured) {
            warnings.push('No greeting configured');
            health = 'YELLOW';
        }
        
        if (bookingEnabled && bookingSlots.length === 0) {
            warnings.push('Booking enabled but no slots configured');
            health = 'YELLOW';
        }
        
        return {
            provider: 'controlPlane',
            providerVersion: '1.0',
            schemaVersion: 'v1',
            enabled: true,
            health,
            warnings,
            data: {
                companyName: company.companyName,
                tradeKey: company.tradeKey || company.industryType || 'universal',
                
                frontDesk: {
                    greetingConfigured,
                    greetingSource,  // "frontDeskBehavior" | "conversationStages" | "fallbackResponses" | "none"
                    toneProfile: frontDesk.conversationStyle || 'balanced',
                    bookingEnabled,
                    bookingSlotsCount: bookingSlots.length,
                    bookingSlotNames: bookingSlots.map(s => s.id || s.name),
                    escalationRulesCount: escalationRules.length
                },
                
                personality: {
                    enabled: frontDesk.personality?.enabled !== false,
                    professionalismLevel: frontDesk.personality?.professionalismLevel || 3,
                    empathyLevel: frontDesk.personality?.empathyLevel || 3
                },
                
                policies: {
                    blockPricing: frontDesk.blockPricing !== false,
                    forbiddenPhrasesCount: (frontDesk.forbiddenPhrases || []).length
                }
            },
            generatedIn: Date.now() - startTime
        };
        
    } catch (error) {
        logger.error('[SNAPSHOT:controlPlane] Error:', error.message);
        return {
            provider: 'controlPlane',
            providerVersion: '1.0',
            schemaVersion: 'v1',
            enabled: false,
            health: 'RED',
            error: error.message,
            data: null,
            generatedIn: Date.now() - startTime
        };
    }
};

