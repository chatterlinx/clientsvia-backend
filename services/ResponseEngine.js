/**
 * ============================================================================
 * RESPONSE ENGINE - INTELLIGENT REPLY SELECTION
 * ============================================================================
 * 
 * Purpose: Centralize all reply selection logic based on:
 * - Scenario Type (FAQ, BOOKING, EMERGENCY, TRANSFER, SYSTEM, SMALL_TALK)
 * - Reply Strategy (AUTO, FULL_ONLY, QUICK_ONLY, QUICK_THEN_FULL, LLM_WRAP, LLM_CONTEXT)
 * - Channel (voice, sms, chat)
 * 
 * This is the single source of truth for how scenarios speak.
 * Removes scattered logic from IntelligentRouter and AIBrain3tierllm.
 * 
 * Decision Matrix: See below in buildResponse()
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const { normalizeScenarioType } = require('../utils/scenarioTypeDetector');
const { 
  sanitizeNoNameReplies, 
  containsNamePlaceholder 
} = require('../utils/sanitizeNoNameReply');

class ResponseEngine {
  /**
   * ============================================================================
   * PERSONALIZATION: Get the right reply arrays based on caller name availability
   * ============================================================================
   * 
   * SELECTION ORDER (deterministic):
   * 1. If caller name exists → use normal replies
   * 2. If no name + _noName exists → use _noName variants
   * 3. If no name + _noName missing + normal has {name} → use sanitized(normal)
   * 4. If no name + _noName missing + normal has no {name} → use normal
   * 
   * This is a SEATBELT that ensures we NEVER speak "{name}" to a caller.
   * 
   * @param {Object} scenario - The scenario with reply arrays
   * @param {Object} context - Context with callerName, callerInfo, etc.
   * @returns {Object} { quickReplies, fullReplies, hasCallerName, usedFallback }
   */
  _getPersonalizedReplyArrays(scenario, context = {}) {
    // Check if we have caller name from various sources
    const callerName = context.callerName 
      || context.callerInfo?.name 
      || context.callerInfo?.firstName
      || context.extractedEntities?.name
      || context.conversationState?.callerName
      || null;
    
    const hasCallerName = !!callerName && callerName.trim().length > 0;
    
    // Start with default arrays
    let quickReplies = scenario.quickReplies || [];
    let fullReplies = scenario.fullReplies || [];
    let usedFallback = false;
    let fallbackType = null;
    
    // Scenario metadata for logging
    const scenarioMeta = {
      scenarioId: scenario.scenarioId || scenario._id,
      scenarioName: scenario.name || 'unknown'
    };
    
    if (!hasCallerName) {
      // ========================================================================
      // CALLER NAME UNKNOWN - Need to avoid {name} in output
      // ========================================================================
      
      const hasQuickNoName = scenario.quickReplies_noName && scenario.quickReplies_noName.length > 0;
      const hasFullNoName = scenario.fullReplies_noName && scenario.fullReplies_noName.length > 0;
      const quickHasNamePlaceholder = containsNamePlaceholder(quickReplies);
      const fullHasNamePlaceholder = containsNamePlaceholder(fullReplies);
      
      // --- QUICK REPLIES ---
      if (hasQuickNoName) {
        // Best case: _noName variant exists
        quickReplies = scenario.quickReplies_noName;
        logger.info('[RESPONSE ENGINE] Using quickReplies_noName (caller name unknown)');
      } else if (quickHasNamePlaceholder) {
        // Fallback: sanitize normal replies to remove {name}
        quickReplies = sanitizeNoNameReplies(quickReplies, { 
          type: 'quick', 
          ...scenarioMeta 
        });
        usedFallback = true;
        fallbackType = 'quick';
        logger.warn('[RESPONSE ENGINE] LAZY FALLBACK: Sanitized quickReplies (no _noName, has {name})', {
          ...scenarioMeta,
          lazyNoNameFallbackUsed: true
        });
      }
      // else: no {name} in quickReplies, safe to use as-is
      
      // --- FULL REPLIES ---
      if (hasFullNoName) {
        // Best case: _noName variant exists
        fullReplies = scenario.fullReplies_noName;
        logger.info('[RESPONSE ENGINE] Using fullReplies_noName (caller name unknown)');
      } else if (fullHasNamePlaceholder) {
        // Fallback: sanitize normal replies to remove {name}
        fullReplies = sanitizeNoNameReplies(fullReplies, { 
          type: 'full', 
          ...scenarioMeta 
        });
        usedFallback = true;
        fallbackType = fallbackType ? 'both' : 'full';
        logger.warn('[RESPONSE ENGINE] LAZY FALLBACK: Sanitized fullReplies (no _noName, has {name})', {
          ...scenarioMeta,
          lazyNoNameFallbackUsed: true
        });
      }
      // else: no {name} in fullReplies, safe to use as-is
    }
    
    return { 
      quickReplies, 
      fullReplies, 
      hasCallerName, 
      callerName,
      usedFallback,
      fallbackType
    };
  }
  
  /**
   * ============================================================================
   * PERSONALIZATION: Replace placeholders in reply text
   * ============================================================================
   * 
   * Replaces {name}, {companyName}, etc. with actual values from context.
   * Gracefully handles missing values.
   * 
   * @param {String} text - The reply text with placeholders
   * @param {Object} context - Context with placeholder values
   * @param {String} callerName - The caller's name (or null)
   * @returns {String} Text with placeholders replaced
   */
  _replacePlaceholders(text, context = {}, callerName = null) {
    if (!text) return text;
    
    let result = text;
    
    // Replace {name} with caller name, or remove gracefully
    if (callerName && callerName.trim()) {
      result = result.replace(/\{name\}/gi, callerName.trim());
    } else {
      // Remove {name} patterns gracefully:
      // "Thanks, {name}." → "Thanks."
      // "Thanks, {name}. What's..." → "Thanks. What's..."
      result = result.replace(/,?\s*\{name\}\.?\s*/gi, '. ').replace(/\.\s*\./g, '.').trim();
      // Clean up double spaces
      result = result.replace(/\s+/g, ' ');
    }
    
    // Replace other common placeholders
    const company = context.company || context.companyInfo || {};
    result = result.replace(/\{companyName\}/gi, company.companyName || company.name || 'our company');
    result = result.replace(/\{companyname\}/gi, company.companyName || company.name || 'our company');
    result = result.replace(/\{phone\}/gi, company.phone || company.primaryPhone || '');
    result = result.replace(/\{office_city\}/gi, company.city || company.serviceArea || '');
    
    // Replace technician placeholder
    result = result.replace(/\{technician\}/gi, context.technicianName || 'our technician');
    
    // Replace time placeholder
    result = result.replace(/\{time\}/gi, context.appointmentTime || context.time || 'soon');
    
    return result;
  }
  /**
   * Main entry point: Build the final response for a scenario
   * 
   * @param {Object} params
   * @param {Object} params.scenario - The matched scenario object
   * @param {String} params.channel - 'voice' | 'sms' | 'chat' (default: 'voice')
   * @param {Object} params.context - Optional context (company, routingId, etc.)
   * 
   * @returns {Object}
   *   {
   *     text: String,                   // final response to send
   *     strategyUsed: String,           // what the engine actually did
   *     scenarioTypeResolved: String,   // final scenario type (explicit or inferred)
   *     replyStrategyResolved: String   // final strategy (explicit or AUTO)
   *   }
   */
  async buildResponse({ scenario, channel = 'voice', context = {} }) {
    const startTime = Date.now();
    
    // Validate inputs
    if (!scenario) {
      logger.error('🚨 [RESPONSE ENGINE] No scenario provided');
      return {
        text: null,
        strategyUsed: 'ERROR',
        scenarioTypeResolved: null,
        replyStrategyResolved: null
      };
    }
    
    try {
      // ========================================================================
      // STEP 1: RESOLVE SCENARIO TYPE
      // ========================================================================
      let scenarioTypeResolved = normalizeScenarioType(scenario.scenarioType, { allowUnknown: true });
      
      if (!scenarioTypeResolved || scenarioTypeResolved === 'UNKNOWN') {
        // Infer from content using canonical types
        if (scenario.fullReplies && scenario.fullReplies.length > 0) {
          scenarioTypeResolved = 'FAQ';
        } else if (scenario.quickReplies && scenario.quickReplies.length > 0) {
          scenarioTypeResolved = 'SYSTEM';
        } else {
          scenarioTypeResolved = 'FAQ';
        }
      }
      
      // ========================================================================
      // STEP 2: RESOLVE REPLY STRATEGY
      // ========================================================================
      let replyStrategyResolved = scenario.replyStrategy || 'AUTO';
      
      // ========================================================================
      // STEP 3: DECISION MATRIX BY CHANNEL & SCENARIO TYPE
      // ========================================================================
      
      let text;
      let strategyUsed;
      
      if (channel === 'voice') {
        ({ text, strategyUsed } = this._decideVoiceReply({
          scenario,
          scenarioTypeResolved,
          replyStrategyResolved,
          context
        }));
      } else if (channel === 'sms' || channel === 'chat') {
        ({ text, strategyUsed } = this._decideSmsOrChatReply({
          scenario,
          replyStrategyResolved,
          context
        }));
      } else {
        // Unknown channel, default to voice rules
        ({ text, strategyUsed } = this._decideVoiceReply({
          scenario,
          scenarioTypeResolved,
          replyStrategyResolved,
          context
        }));
      }
      
      // ========================================================================
      // STEP 4: RETURN RESULT
      // ========================================================================
      
      const responseTime = Date.now() - startTime;
      
      // 🎯 PHASE A – STEP 3A: Prepare follow-up metadata (data only, no behavior change)
      const followUpMode = scenario.followUpMode || 'NONE';
      
      if (followUpMode !== 'NONE') {
        logger.info('[RESPONSE ENGINE] Scenario has follow-up configured', {
          scenarioId: scenario.scenarioId,
          scenarioName: scenario.name,
          followUpMode,
          followUpQuestionText: scenario.followUpQuestionText,
          transferTarget: scenario.transferTarget
        });
      }
      
      logger.info(`🎯 [RESPONSE ENGINE] Reply selected`, {
        scenarioName: scenario.name,
        scenarioType: scenarioTypeResolved,
        replyStrategy: replyStrategyResolved,
        strategyUsed,
        channel,
        textLength: text ? text.length : 0,
        responseTime
      });
      
      return {
        text,
        strategyUsed,
        scenarioTypeResolved,
        replyStrategyResolved,
        // 🎯 PHASE A – STEP 3A: Follow-up metadata (used in AIBrain metadata)
        followUp: {
          mode: followUpMode,
          questionText: scenario.followUpQuestionText || null,
          transferTarget: scenario.transferTarget || null
        }
      };
      
    } catch (error) {
      logger.error('🚨 [RESPONSE ENGINE] Error building response', {
        error: error.message,
        scenarioName: scenario?.name,
        channel
      });
      
      return {
        text: null,
        strategyUsed: 'ERROR',
        scenarioTypeResolved: scenario?.scenarioType || null,
        replyStrategyResolved: scenario?.replyStrategy || 'AUTO',
        // 🎯 PHASE A – STEP 3A: Follow-up metadata (with safe defaults on error)
        followUp: {
          mode: scenario?.followUpMode || 'NONE',
          questionText: scenario?.followUpQuestionText || null,
          transferTarget: scenario?.transferTarget || null
        }
      };
    }
  }
  
  /**
   * ============================================================================
   * VOICE CHANNEL DECISION MATRIX
   * ============================================================================
   * 
   * Voice is our priority channel. Rules are strict to ensure callers
   * always hear actual information, not generic fallbacks.
   * 
   * ============================================================================
   */
  _decideVoiceReply({ scenario, scenarioTypeResolved, replyStrategyResolved, context = {} }) {
    // Get personalized reply arrays (uses _noName variants if caller name unknown)
    const { quickReplies, fullReplies, hasCallerName, callerName } = this._getPersonalizedReplyArrays(scenario, context);
    
    const hasFullReplies = fullReplies && fullReplies.length > 0;
    const hasQuickReplies = quickReplies && quickReplies.length > 0;
    
    let text;
    let strategyUsed;
    
    // ========================================================================
    // VOICE + INFO TYPES (FAQ/BILLING/TROUBLESHOOT)
    // ========================================================================
    if (['FAQ', 'BILLING', 'TROUBLESHOOT'].includes(scenarioTypeResolved)) {
      if (replyStrategyResolved === 'AUTO' || replyStrategyResolved === 'FULL_ONLY') {
        // Info scenarios on voice MUST always include full reply
        if (hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (hasQuickReplies) {
          // Fallback to quick if no full replies (scenario broken, but handle gracefully)
          logger.warn(`⚠️ [RESPONSE ENGINE] ${scenarioTypeResolved} scenario missing fullReplies`, {
            scenarioName: scenario.name
          });
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          // No replies at all
          logger.error(`🚨 [RESPONSE ENGINE] ${scenarioTypeResolved} scenario has NO replies!`, {
            scenarioName: scenario.name
          });
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'QUICK_THEN_FULL') {
        // Combine quick intro with full detail
        if (hasQuickReplies && hasFullReplies) {
          const quick = this._selectRandom(quickReplies);
          const full = this._selectRandom(fullReplies);
          text = `${quick} ${full}`;
          strategyUsed = 'QUICK_THEN_FULL';
        } else if (hasFullReplies) {
          // Fall back to full only
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'QUICK_ONLY') {
        // Explicitly requested quick-only (dangerous for info-heavy scenarios, but allow)
        logger.warn(`⚠️ [RESPONSE ENGINE] ${scenarioTypeResolved} scenario forced to QUICK_ONLY (misconfigured?)`, {
          scenarioName: scenario.name,
          replyStrategy: replyStrategyResolved
        });
        if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          // Fallback to full
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'LLM_WRAP' || replyStrategyResolved === 'LLM_CONTEXT') {
        // LLM features not yet implemented
        // For now, use FULL_ONLY and mark as such
        if (hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY'; // Not LLM_WRAP yet
        } else if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      }
    }
    
    // ========================================================================
    // VOICE + SYSTEM
    // ========================================================================
    else if (scenarioTypeResolved === 'SYSTEM') {
      if (replyStrategyResolved === 'AUTO') {
        // Default: quick if available, else full
        if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'QUICK_ONLY') {
        if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'FULL_ONLY') {
        if (hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'QUICK_THEN_FULL') {
        if (hasQuickReplies && hasFullReplies) {
          const quick = this._selectRandom(quickReplies);
          const full = this._selectRandom(fullReplies);
          text = `${quick} ${full}`;
          strategyUsed = 'QUICK_THEN_FULL';
        } else if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'LLM_WRAP' || replyStrategyResolved === 'LLM_CONTEXT') {
        // For now, use same logic as AUTO
        if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      }
    }
    
    // ========================================================================
    // VOICE + ACTION TYPES (BOOKING/EMERGENCY/TRANSFER)
    // ========================================================================
    else if (['BOOKING', 'EMERGENCY', 'TRANSFER'].includes(scenarioTypeResolved)) {
      if (replyStrategyResolved === 'AUTO') {
        // Default: quick+full if both exist, else full, else quick
        if (hasQuickReplies && hasFullReplies) {
          const quick = this._selectRandom(quickReplies);
          const full = this._selectRandom(fullReplies);
          text = `${quick} ${full}`;
          strategyUsed = 'QUICK_THEN_FULL';
        } else if (hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'FULL_ONLY') {
        if (hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'QUICK_ONLY') {
        if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'QUICK_THEN_FULL') {
        if (hasQuickReplies && hasFullReplies) {
          const quick = this._selectRandom(quickReplies);
          const full = this._selectRandom(fullReplies);
          text = `${quick} ${full}`;
          strategyUsed = 'QUICK_THEN_FULL';
        } else if (hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'LLM_WRAP' || replyStrategyResolved === 'LLM_CONTEXT') {
        // For now, use same logic as AUTO
        if (hasQuickReplies && hasFullReplies) {
          const quick = this._selectRandom(quickReplies);
          const full = this._selectRandom(fullReplies);
          text = `${quick} ${full}`;
          strategyUsed = 'QUICK_THEN_FULL';
        } else if (hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      }
    }
    
    // ========================================================================
    // VOICE + SMALL_TALK
    // ========================================================================
    else if (scenarioTypeResolved === 'SMALL_TALK') {
      if (replyStrategyResolved === 'AUTO') {
        // Default: quick if available, else full
        if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else {
        // Respect explicit strategy
        if (replyStrategyResolved === 'QUICK_ONLY' && hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (replyStrategyResolved === 'FULL_ONLY' && hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (replyStrategyResolved === 'QUICK_THEN_FULL' && hasQuickReplies && hasFullReplies) {
          const quick = this._selectRandom(quickReplies);
          const full = this._selectRandom(fullReplies);
          text = `${quick} ${full}`;
          strategyUsed = 'QUICK_THEN_FULL';
        } else if (hasQuickReplies) {
          text = this._selectRandom(quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          text = this._selectRandom(fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      }
    }
    
    // Unknown scenario type, default to FAQ rules
    else {
      if (hasFullReplies) {
        text = this._selectRandom(fullReplies);
        strategyUsed = 'FULL_ONLY';
      } else if (hasQuickReplies) {
        text = this._selectRandom(quickReplies);
        strategyUsed = 'QUICK_ONLY';
      } else {
        text = null;
        strategyUsed = 'ERROR_NO_REPLIES';
      }
    }
    
    // ========================================================================
    // PERSONALIZATION: Replace placeholders in final text
    // ========================================================================
    if (text) {
      text = this._replacePlaceholders(text, context, callerName);
      
      // Log personalization info
      logger.info('[RESPONSE ENGINE] Personalized response', {
        scenarioName: scenario.name,
        hasCallerName,
        callerName: callerName || '(none)',
        usedNoNameVariants: !hasCallerName && (scenario.quickReplies_noName?.length > 0 || scenario.fullReplies_noName?.length > 0),
        strategyUsed
      });
    }
    
    return { text, strategyUsed, hasCallerName, callerName };
  }
  
  /**
   * ============================================================================
   * SMS & CHAT CHANNEL DECISION MATRIX
   * ============================================================================
   * 
   * SMS and chat are simpler than voice.
   * Default: prefer full if available, else quick.
   * Respect explicit strategies.
   * 
   * ============================================================================
   */
  _decideSmsOrChatReply({ scenario, replyStrategyResolved, context = {} }) {
    // Get personalized reply arrays (uses _noName variants if caller name unknown)
    const { quickReplies, fullReplies, hasCallerName, callerName } = this._getPersonalizedReplyArrays(scenario, context);
    
    const hasFullReplies = fullReplies && fullReplies.length > 0;
    const hasQuickReplies = quickReplies && quickReplies.length > 0;
    
    let text;
    let strategyUsed;
    
    if (replyStrategyResolved === 'AUTO') {
      // Default: prefer full, fallback to quick
      if (hasFullReplies) {
        text = this._selectRandom(fullReplies);
        strategyUsed = 'FULL_ONLY';
      } else if (hasQuickReplies) {
        text = this._selectRandom(quickReplies);
        strategyUsed = 'QUICK_ONLY';
      } else {
        text = null;
        strategyUsed = 'ERROR_NO_REPLIES';
      }
    } else if (replyStrategyResolved === 'FULL_ONLY') {
      if (hasFullReplies) {
        text = this._selectRandom(fullReplies);
        strategyUsed = 'FULL_ONLY';
      } else if (hasQuickReplies) {
        text = this._selectRandom(quickReplies);
        strategyUsed = 'QUICK_ONLY';
      } else {
        text = null;
        strategyUsed = 'ERROR_NO_REPLIES';
      }
    } else if (replyStrategyResolved === 'QUICK_ONLY') {
      if (hasQuickReplies) {
        text = this._selectRandom(quickReplies);
        strategyUsed = 'QUICK_ONLY';
      } else if (hasFullReplies) {
        text = this._selectRandom(fullReplies);
        strategyUsed = 'FULL_ONLY';
      } else {
        text = null;
        strategyUsed = 'ERROR_NO_REPLIES';
      }
    } else if (replyStrategyResolved === 'QUICK_THEN_FULL') {
      if (hasQuickReplies && hasFullReplies) {
        const quick = this._selectRandom(quickReplies);
        const full = this._selectRandom(fullReplies);
        text = `${quick} ${full}`;
        strategyUsed = 'QUICK_THEN_FULL';
      } else if (hasFullReplies) {
        text = this._selectRandom(fullReplies);
        strategyUsed = 'FULL_ONLY';
      } else if (hasQuickReplies) {
        text = this._selectRandom(quickReplies);
        strategyUsed = 'QUICK_ONLY';
      } else {
        text = null;
        strategyUsed = 'ERROR_NO_REPLIES';
      }
    } else if (replyStrategyResolved === 'LLM_WRAP' || replyStrategyResolved === 'LLM_CONTEXT') {
      // For now, use AUTO behavior
      if (hasFullReplies) {
        text = this._selectRandom(fullReplies);
        strategyUsed = 'FULL_ONLY';
      } else if (hasQuickReplies) {
        text = this._selectRandom(quickReplies);
        strategyUsed = 'QUICK_ONLY';
      } else {
        text = null;
        strategyUsed = 'ERROR_NO_REPLIES';
      }
    }
    
    // ========================================================================
    // PERSONALIZATION: Replace placeholders in final text
    // ========================================================================
    if (text) {
      text = this._replacePlaceholders(text, context, callerName);
    }
    
    return { text, strategyUsed, hasCallerName, callerName };
  }
  
  /**
   * Helper: Select random element from array with weighted probability
   * 
   * 🎯 PHASE A – STEP 1: Weighted Reply Selection (implemented)
   * - If replies are objects with {text, weight}, uses weight for probability
   * - If replies are strings (legacy), treats all with equal weight
   * - Uses cumulative weight distribution for O(n) selection
   * 
   * Behavior:
   * - `[{text: "Hi", weight: 5}, {text: "Hello", weight: 1}]`
   *   → "Hi" is 5x more likely to be selected
   * - `["Hi", "Hello"]` → both equally likely (weight 1 each)
   * - Mixed format treated safely (strings converted to weight 1)
   * 
   * @param {Array} arr - Array of strings or {text, weight} objects
   * @returns {String} - The selected reply text (null if empty/invalid)
   */
  _selectRandom(arr) {
    if (!arr || arr.length === 0) {
      return null;
    }

    // ========================================================================
    // BUILD WEIGHTED DISTRIBUTION
    // ========================================================================
    const items = [];
    let totalWeight = 0;

    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      let text = null;
      let weight = 1;

      // Handle different input formats
      if (typeof item === 'string') {
        // Legacy format: plain string
        text = item;
        weight = 1;
      } else if (typeof item === 'object' && item !== null && item.text) {
        // New format: {text, weight}
        text = item.text;
        weight = typeof item.weight === 'number' && item.weight > 0 ? item.weight : 3;
      } else {
        // Invalid item - skip with warning
        logger.warn('[RESPONSE ENGINE] Invalid reply item in _selectRandom', {
          index: i,
          itemType: typeof item,
          hasText: item?.text !== undefined
        });
        continue;
      }

      items.push({ text, weight });
      totalWeight += weight;
    }

    // Handle edge case: no valid items
    if (items.length === 0 || totalWeight <= 0) {
      return null;
    }

    // ========================================================================
    // WEIGHTED RANDOM SELECTION
    // ========================================================================
    let randomValue = Math.random() * totalWeight;
    let cumulativeWeight = 0;

    for (const item of items) {
      cumulativeWeight += item.weight;
      if (randomValue < cumulativeWeight) {
        return item.text;
      }
    }

    // Fallback (should not happen, but just in case of floating point edge case)
    return items[items.length - 1].text;
  }
}

module.exports = new ResponseEngine();
