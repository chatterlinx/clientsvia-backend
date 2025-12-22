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
            .select('companyName aiAgentSettings frontDeskBehavior tradeKey industryType connectionMessages')
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
        
        // CRITICAL: connectionMessages can be at ROOT level OR inside aiAgentSettings
        // ConnectionMessagesManager saves to ROOT: company.connectionMessages
        // Some legacy code may save to: company.aiAgentSettings.connectionMessages
        // Check BOTH locations!
        const connectionMessages = company.connectionMessages || settings.connectionMessages || {};
        
        // Extract configuration
        // FIXED: Check correct DB paths for greeting (Dec 2025)
        // - frontDeskBehavior.greeting is a STRING (canonical)
        // - connectionMessages.voice.text / .realtime.text (Voice UI save location)
        // - conversationStages.greetingRules is array
        // - fallbackResponses.greeting is fallback string
        // 
        // PRECEDENCE ORDER (locked):
        // 1. frontDeskBehavior.greeting (canonical)
        // 2. connectionMessages.voice (Voice Calls UI save location)
        // 3. conversationStages.greetingRules (rule-based)
        // 4. fallbackResponses.greeting (fallback)
        
        let greetingConfigured = false;
        let greetingSource = 'none';
        let greetingText = null;
        
        // ═══════════════════════════════════════════════════════════════════════════
        // GREETING RESOLUTION ORDER (CANONICAL FIRST)
        // CRITICAL: connectionMessages.voice.text is CANONICAL
        //           frontDeskBehavior.greeting is LEGACY (only read if canonical empty)
        // ═══════════════════════════════════════════════════════════════════════════
        
        // 1. CANONICAL: connectionMessages.voice.text
        if (connectionMessages.voice?.text?.trim().length > 0) {
            greetingConfigured = true;
            greetingSource = 'connectionMessages.voice';
            greetingText = connectionMessages.voice.text.trim();
        }
        // 2. CANONICAL FALLBACK: connectionMessages.voice.realtime.text
        else if (connectionMessages.voice?.realtime?.text?.trim().length > 0) {
            greetingConfigured = true;
            greetingSource = 'connectionMessages.voice.realtime';
            greetingText = connectionMessages.voice.realtime.text.trim();
        }
        // 3. LEGACY: frontDeskBehavior.greeting (deprecated - only if canonical empty)
        else if (frontDesk.greeting && frontDesk.greeting.trim().length > 0) {
            greetingConfigured = true;
            greetingSource = 'frontDeskBehavior (LEGACY)';
            greetingText = frontDesk.greeting.trim();
        } 
        // 4. LEGACY: conversationStages.greetingRules (rule-based)
        else if (settings.conversationStages?.greetingRules?.length > 0) {
            const validRules = settings.conversationStages.greetingRules.filter(
                r => r.trigger && r.response
            );
            if (validRules.length > 0) {
                greetingConfigured = true;
                greetingSource = 'conversationStages (LEGACY)';
                greetingText = validRules[0].response;
            }
        } 
        // 5. LEGACY: fallbackResponses.greeting
        else if (settings.fallbackResponses?.greeting && settings.fallbackResponses.greeting.trim().length > 0) {
            greetingConfigured = true;
            greetingSource = 'fallbackResponses (LEGACY)';
            greetingText = settings.fallbackResponses.greeting.trim();
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
                    greetingSource,  // "frontDeskBehavior" | "connectionMessages.voice" | "conversationStages" | "fallbackResponses" | "none"
                    greetingPreview: greetingText ? (greetingText.length > 50 ? greetingText.substring(0, 50) + '...' : greetingText) : null,
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

