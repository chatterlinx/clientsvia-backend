/**
 * ============================================================================
 * RESPONSE ENGINE - INTELLIGENT REPLY SELECTION
 * ============================================================================
 * 
 * Purpose: Centralize all reply selection logic based on:
 * - Scenario Type (INFO_FAQ, ACTION_FLOW, SYSTEM_ACK, SMALL_TALK)
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

class ResponseEngine {
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
      let scenarioTypeResolved = scenario.scenarioType;
      
      if (!scenarioTypeResolved) {
        // Infer from content
        if (scenario.fullReplies && scenario.fullReplies.length > 0) {
          scenarioTypeResolved = 'INFO_FAQ';
        } else {
          scenarioTypeResolved = 'SYSTEM_ACK';
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
          replyStrategyResolved
        }));
      } else if (channel === 'sms' || channel === 'chat') {
        ({ text, strategyUsed } = this._decideSmsOrChatReply({
          scenario,
          replyStrategyResolved
        }));
      } else {
        // Unknown channel, default to voice rules
        ({ text, strategyUsed } = this._decideVoiceReply({
          scenario,
          scenarioTypeResolved,
          replyStrategyResolved
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
  _decideVoiceReply({ scenario, scenarioTypeResolved, replyStrategyResolved }) {
    const hasFullReplies = scenario.fullReplies && scenario.fullReplies.length > 0;
    const hasQuickReplies = scenario.quickReplies && scenario.quickReplies.length > 0;
    
    let text;
    let strategyUsed;
    
    // ========================================================================
    // VOICE + INFO_FAQ
    // ========================================================================
    if (scenarioTypeResolved === 'INFO_FAQ') {
      if (replyStrategyResolved === 'AUTO' || replyStrategyResolved === 'FULL_ONLY') {
        // Info scenarios on voice MUST always include full reply
        if (hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (hasQuickReplies) {
          // Fallback to quick if no full replies (scenario broken, but handle gracefully)
          logger.warn(`⚠️ [RESPONSE ENGINE] INFO_FAQ scenario missing fullReplies`, {
            scenarioName: scenario.name
          });
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          // No replies at all
          logger.error(`🚨 [RESPONSE ENGINE] INFO_FAQ scenario has NO replies!`, {
            scenarioName: scenario.name
          });
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'QUICK_THEN_FULL') {
        // Combine quick intro with full detail
        if (hasQuickReplies && hasFullReplies) {
          const quick = this._selectRandom(scenario.quickReplies);
          const full = this._selectRandom(scenario.fullReplies);
          text = `${quick} ${full}`;
          strategyUsed = 'QUICK_THEN_FULL';
        } else if (hasFullReplies) {
          // Fall back to full only
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'QUICK_ONLY') {
        // Explicitly requested quick-only (dangerous for INFO_FAQ, but allow)
        logger.warn(`⚠️ [RESPONSE ENGINE] INFO_FAQ scenario forced to QUICK_ONLY (misconfigured?)`, {
          scenarioName: scenario.name,
          replyStrategy: replyStrategyResolved
        });
        if (hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          // Fallback to full
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'LLM_WRAP' || replyStrategyResolved === 'LLM_CONTEXT') {
        // LLM features not yet implemented
        // For now, use FULL_ONLY and mark as such
        if (hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY'; // Not LLM_WRAP yet
        } else if (hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      }
    }
    
    // ========================================================================
    // VOICE + SYSTEM_ACK
    // ========================================================================
    else if (scenarioTypeResolved === 'SYSTEM_ACK') {
      if (replyStrategyResolved === 'AUTO') {
        // Default: quick if available, else full
        if (hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'QUICK_ONLY') {
        if (hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'FULL_ONLY') {
        if (hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'QUICK_THEN_FULL') {
        if (hasQuickReplies && hasFullReplies) {
          const quick = this._selectRandom(scenario.quickReplies);
          const full = this._selectRandom(scenario.fullReplies);
          text = `${quick} ${full}`;
          strategyUsed = 'QUICK_THEN_FULL';
        } else if (hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'LLM_WRAP' || replyStrategyResolved === 'LLM_CONTEXT') {
        // For now, use same logic as AUTO
        if (hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      }
    }
    
    // ========================================================================
    // VOICE + ACTION_FLOW
    // ========================================================================
    else if (scenarioTypeResolved === 'ACTION_FLOW') {
      if (replyStrategyResolved === 'AUTO') {
        // Default: quick+full if both exist, else full, else quick
        if (hasQuickReplies && hasFullReplies) {
          const quick = this._selectRandom(scenario.quickReplies);
          const full = this._selectRandom(scenario.fullReplies);
          text = `${quick} ${full}`;
          strategyUsed = 'QUICK_THEN_FULL';
        } else if (hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'FULL_ONLY') {
        if (hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'QUICK_ONLY') {
        if (hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'QUICK_THEN_FULL') {
        if (hasQuickReplies && hasFullReplies) {
          const quick = this._selectRandom(scenario.quickReplies);
          const full = this._selectRandom(scenario.fullReplies);
          text = `${quick} ${full}`;
          strategyUsed = 'QUICK_THEN_FULL';
        } else if (hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else if (replyStrategyResolved === 'LLM_WRAP' || replyStrategyResolved === 'LLM_CONTEXT') {
        // For now, use same logic as AUTO
        if (hasQuickReplies && hasFullReplies) {
          const quick = this._selectRandom(scenario.quickReplies);
          const full = this._selectRandom(scenario.fullReplies);
          text = `${quick} ${full}`;
          strategyUsed = 'QUICK_THEN_FULL';
        } else if (hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
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
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      } else {
        // Respect explicit strategy
        if (replyStrategyResolved === 'QUICK_ONLY' && hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (replyStrategyResolved === 'FULL_ONLY' && hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else if (replyStrategyResolved === 'QUICK_THEN_FULL' && hasQuickReplies && hasFullReplies) {
          const quick = this._selectRandom(scenario.quickReplies);
          const full = this._selectRandom(scenario.fullReplies);
          text = `${quick} ${full}`;
          strategyUsed = 'QUICK_THEN_FULL';
        } else if (hasQuickReplies) {
          text = this._selectRandom(scenario.quickReplies);
          strategyUsed = 'QUICK_ONLY';
        } else if (hasFullReplies) {
          text = this._selectRandom(scenario.fullReplies);
          strategyUsed = 'FULL_ONLY';
        } else {
          text = null;
          strategyUsed = 'ERROR_NO_REPLIES';
        }
      }
    }
    
    // Unknown scenario type, default to INFO_FAQ rules
    else {
      if (hasFullReplies) {
        text = this._selectRandom(scenario.fullReplies);
        strategyUsed = 'FULL_ONLY';
      } else if (hasQuickReplies) {
        text = this._selectRandom(scenario.quickReplies);
        strategyUsed = 'QUICK_ONLY';
      } else {
        text = null;
        strategyUsed = 'ERROR_NO_REPLIES';
      }
    }
    
    return { text, strategyUsed };
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
  _decideSmsOrChatReply({ scenario, replyStrategyResolved }) {
    const hasFullReplies = scenario.fullReplies && scenario.fullReplies.length > 0;
    const hasQuickReplies = scenario.quickReplies && scenario.quickReplies.length > 0;
    
    let text;
    let strategyUsed;
    
    if (replyStrategyResolved === 'AUTO') {
      // Default: prefer full, fallback to quick
      if (hasFullReplies) {
        text = this._selectRandom(scenario.fullReplies);
        strategyUsed = 'FULL_ONLY';
      } else if (hasQuickReplies) {
        text = this._selectRandom(scenario.quickReplies);
        strategyUsed = 'QUICK_ONLY';
      } else {
        text = null;
        strategyUsed = 'ERROR_NO_REPLIES';
      }
    } else if (replyStrategyResolved === 'FULL_ONLY') {
      if (hasFullReplies) {
        text = this._selectRandom(scenario.fullReplies);
        strategyUsed = 'FULL_ONLY';
      } else if (hasQuickReplies) {
        text = this._selectRandom(scenario.quickReplies);
        strategyUsed = 'QUICK_ONLY';
      } else {
        text = null;
        strategyUsed = 'ERROR_NO_REPLIES';
      }
    } else if (replyStrategyResolved === 'QUICK_ONLY') {
      if (hasQuickReplies) {
        text = this._selectRandom(scenario.quickReplies);
        strategyUsed = 'QUICK_ONLY';
      } else if (hasFullReplies) {
        text = this._selectRandom(scenario.fullReplies);
        strategyUsed = 'FULL_ONLY';
      } else {
        text = null;
        strategyUsed = 'ERROR_NO_REPLIES';
      }
    } else if (replyStrategyResolved === 'QUICK_THEN_FULL') {
      if (hasQuickReplies && hasFullReplies) {
        const quick = this._selectRandom(scenario.quickReplies);
        const full = this._selectRandom(scenario.fullReplies);
        text = `${quick} ${full}`;
        strategyUsed = 'QUICK_THEN_FULL';
      } else if (hasFullReplies) {
        text = this._selectRandom(scenario.fullReplies);
        strategyUsed = 'FULL_ONLY';
      } else if (hasQuickReplies) {
        text = this._selectRandom(scenario.quickReplies);
        strategyUsed = 'QUICK_ONLY';
      } else {
        text = null;
        strategyUsed = 'ERROR_NO_REPLIES';
      }
    } else if (replyStrategyResolved === 'LLM_WRAP' || replyStrategyResolved === 'LLM_CONTEXT') {
      // For now, use AUTO behavior
      if (hasFullReplies) {
        text = this._selectRandom(scenario.fullReplies);
        strategyUsed = 'FULL_ONLY';
      } else if (hasQuickReplies) {
        text = this._selectRandom(scenario.quickReplies);
        strategyUsed = 'QUICK_ONLY';
      } else {
        text = null;
        strategyUsed = 'ERROR_NO_REPLIES';
      }
    }
    
    return { text, strategyUsed };
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
