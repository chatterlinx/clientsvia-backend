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
        // - frontDesk.greeting is a STRING, not object with .text
        // - greetingRules lives under conversationStages, not frontDesk
        // - fallbackResponses.greeting is also valid
        const greetingConfigured = !!(
            (frontDesk.greeting && frontDesk.greeting.trim().length > 0) ||  // String field
            settings.conversationStages?.greetingRules?.length > 0 ||        // Correct path
            (settings.fallbackResponses?.greeting && settings.fallbackResponses.greeting.trim().length > 0)
        );
        
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

