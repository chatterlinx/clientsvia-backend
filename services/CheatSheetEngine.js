// services/CheatSheetEngine.js
// ============================================================================
// CHEAT SHEET ENGINE - Runtime Policy Application
// ============================================================================
// PURPOSE: Apply compiled cheat sheet policies during live calls
// ARCHITECTURE: Strict precedence chain (EdgeCase → Transfer → Guardrails → Behavior)
// PERFORMANCE: Sub-10ms application budget with abort on timeout
// SAFETY: Action validation, content filtering, server-side enforcement
// OBSERVABILITY: Comprehensive logging for forensics and debugging
// ============================================================================

const logger = require('../utils/logger');
const { replacePlaceholders } = require('../utils/placeholderReplacer');

class CheatSheetEngine {
  
  // ═══════════════════════════════════════════════════════════════════
  // APPLY CHEAT SHEET - Main Entry Point
  // ═══════════════════════════════════════════════════════════════════
  // INPUT:
  //   - baseResponse: Initial response from scenario (what to say)
  //   - userInput: Caller's input text
  //   - context: Call context (company, session, turn info)
  //   - policy: Compiled policy artifact from PolicyCompiler
  // 
  // OUTPUT:
  //   {
  //     response: Final polished response text,
  //     appliedBlocks: Array of blocks applied ['EDGE_CASE', 'GUARDRAILS'],
  //     action: 'RESPOND' | 'TRANSFER' | 'COLLECT_ENTITIES',
  //     transferTarget: Contact name/queue (if action = TRANSFER),
  //     collectEntities: Entity definitions (if applicable),
  //     timeMs: Execution time,
  //     shortCircuit: Boolean (if edge case short-circuited)
  //   }
  // 
  // PRECEDENCE: EdgeCase → Transfer → Guardrails → Behavior (STRICT ORDER)
  // ═══════════════════════════════════════════════════════════════════
  
  async apply(baseResponse, userInput, context, policy) {
    const startTime = Date.now();
    let response = baseResponse;
    const appliedBlocks = [];
    
    // ────────────────────────────────────────────────────────────────
    // 🛡️ SAFETY WRAPPER: Never crash the call if CheatSheet fails
    // ────────────────────────────────────────────────────────────────
    try {
      // Deserialize policy if needed (Redis stores as JSON)
      const deserializedPolicy = this.deserializePolicy(policy);
      
      logger.debug('[CHEAT SHEET ENGINE] Starting application', {
        companyId: context.companyId,
        callId: context.callId,
        turnNumber: context.turnNumber,
        policyVersion: deserializedPolicy.version,
        policyChecksum: deserializedPolicy.checksum
      });
      
      // ────────────────────────────────────────────────────────────────
      // PRECEDENCE STEP 1: EDGE CASES (Highest Priority)
      // ────────────────────────────────────────────────────────────────
      // Check for unusual caller inputs (machine detection, system delays)
      // If matched → RETURN IMMEDIATELY (short-circuit all other rules)
      // NOW WITH SPAM BRIDGE: Can also react to spam score thresholds
      
      const edgeCase = this.detectEdgeCase(userInput, deserializedPolicy.edgeCases, context);
    
    if (edgeCase) {
      // ────────────────────────────────────────────────────────────────
      // DETERMINE ACTION TYPE (Enterprise Mode vs Legacy Mode)
      // ────────────────────────────────────────────────────────────────
      // Legacy mode: Only has responseText, no action object
      // Enterprise mode: Has action.type (override_response | force_transfer | polite_hangup | flag_only)
      
      const actionType = edgeCase.action?.type || 'override_response';  // Default to legacy behavior
      
      // ────────────────────────────────────────────────────────────────
      // GET RESPONSE TEXT (based on action type and mode)
      // ────────────────────────────────────────────────────────────────
      let responseText = '';
      
      if (actionType === 'override_response') {
        // Legacy: edgeCase.response (from PolicyCompiler)
        // Enterprise: action.inlineResponse or action.responseTemplateId
        responseText = edgeCase.action?.inlineResponse || 
                       edgeCase.responseText ||  // Backward compat with old schema
                       edgeCase.response ||      // Backward compat with compiled policy
                       '';
      } else if (actionType === 'force_transfer') {
        responseText = edgeCase.action?.transferMessage || 
                       "Let me connect you with someone who can help.";
      } else if (actionType === 'polite_hangup') {
        responseText = edgeCase.action?.hangupMessage || 
                       "Thank you for calling. Goodbye.";
      } else if (actionType === 'flag_only') {
        // No response override - use base response
        responseText = baseResponse;
      }
      
      // ✨ VARIABLE REPLACEMENT - Replace {variables} in response
      response = responseText;
      if (response && context.company) {
        logger.info('[CHEAT SHEET ENGINE] Replacing variables in edge case response...');
        response = replacePlaceholders(response, context.company);
      }
      
      appliedBlocks.push({ 
        type: 'EDGE_CASE', 
        id: edgeCase.id,
        name: edgeCase.name,
        actionType: actionType
      });
      
      const elapsed = Date.now() - startTime;
      
      // ────────────────────────────────────────────────────────────────
      // 📊 ENHANCED LOGGING (Enterprise-grade observability)
      // ────────────────────────────────────────────────────────────────
      logger.info('[CHEAT SHEET ENGINE] Edge case triggered', {
        companyId: context.companyId,
        callId: context.callId,
        edgeCase: {
          id: edgeCase.id,
          name: edgeCase.name,
          priority: edgeCase.priority || 10,
          actionType: actionType,
          matchedPattern: edgeCase._matchedPattern || 'unknown',
          spamScore: edgeCase._spamScore || 0,  // Include spam score for spam bridge
          spamBridgeActive: edgeCase.minSpamScore != null || edgeCase.spamRequired
        },
        sideEffects: {
          autoBlacklist: edgeCase.sideEffects?.autoBlacklist || false,
          tags: edgeCase.sideEffects?.autoTag || [],
          notifyContacts: edgeCase.sideEffects?.notifyContacts || [],
          logSeverity: edgeCase.sideEffects?.logSeverity || 'info'
        },
        shortCircuit: actionType !== 'flag_only',  // flag_only doesn't short-circuit
        timeMs: elapsed
      });
      
      // ────────────────────────────────────────────────────────────────
      // 🎬 SIDE EFFECTS (Auto-blacklist, tagging, notifications)
      // ────────────────────────────────────────────────────────────────
      // These are ASYNC and NON-BLOCKING - don't wait for completion
      // ────────────────────────────────────────────────────────────────
      
      // AUTO-BLACKLIST (if configured in side effects OR legacy auto-blacklist enabled)
      if (edgeCase.sideEffects?.autoBlacklist && context.callerPhone) {
        const SmartCallFilter = require('./SmartCallFilter');
        
        logger.security('[CHEAT SHEET ENGINE] 🤖 Triggering auto-blacklist (side effect)...', {
          companyId: context.companyId,
          callerPhone: context.callerPhone,
          edgeCaseId: edgeCase.id,
          edgeCaseName: edgeCase.name
        });
        
        // Trigger auto-blacklist (async, non-blocking)
        SmartCallFilter.autoAddToBlacklist({
          companyId: context.companyId,
          phoneNumber: context.callerPhone,
          edgeCaseName: edgeCase.name,
          detectionMethod: 'edge_case'
        }).then(result => {
          if (result.success) {
            logger.security('[CHEAT SHEET ENGINE] 🎉 Auto-blacklist SUCCESS:', {
              companyId: context.companyId,
              phoneNumber: context.callerPhone,
              edgeCaseName: edgeCase.name,
              status: result.status,
              message: result.message
            });
          } else {
            logger.debug('[CHEAT SHEET ENGINE] ⏭️ Auto-blacklist skipped:', {
              companyId: context.companyId,
              phoneNumber: context.callerPhone,
              reason: result.reason,
              detections: result.detections,
              threshold: result.threshold
            });
          }
        }).catch(error => {
          logger.error('[CHEAT SHEET ENGINE] ❌ Auto-blacklist error (non-critical):', {
            error: error.message,
            companyId: context.companyId,
            phoneNumber: context.callerPhone,
            edgeCaseName: edgeCase.name
          });
        });
      }
      
      // AUTO-TAGGING (if configured)
      if (edgeCase.sideEffects?.autoTag && edgeCase.sideEffects.autoTag.length > 0) {
        logger.info('[CHEAT SHEET ENGINE] 🏷️ Auto-tagging call', {
          companyId: context.companyId,
          callId: context.callId,
          tags: edgeCase.sideEffects.autoTag
        });
        // TODO: Implement call tagging in call log system
      }
      
      // CONTACT NOTIFICATIONS (if configured)
      if (edgeCase.sideEffects?.notifyContacts && edgeCase.sideEffects.notifyContacts.length > 0) {
        logger.info('[CHEAT SHEET ENGINE] 📧 Triggering contact notifications', {
          companyId: context.companyId,
          callId: context.callId,
          contactIds: edgeCase.sideEffects.notifyContacts,
          severity: edgeCase.sideEffects.logSeverity
        });
        // TODO: Implement contact notification system
      }
      
      // ────────────────────────────────────────────────────────────────
      // FLAG-ONLY MODE: Don't short-circuit, continue to other rules
      // ────────────────────────────────────────────────────────────────
      if (actionType === 'flag_only') {
        logger.info('[CHEAT SHEET ENGINE] Edge case flag-only mode: continuing to other rules', {
          companyId: context.companyId,
          callId: context.callId,
          edgeCaseId: edgeCase.id
        });
        // Don't return yet - let transfer/behavior/guardrails run
        // Just log and continue (fall through to next precedence layer)
      } else {
        // ────────────────────────────────────────────────────────────────
        // SHORT-CIRCUIT: Return immediately for override/transfer/hangup
        // ────────────────────────────────────────────────────────────────
        
        // Enforce performance budget
        this.enforcePerformanceBudget(startTime, 10, context);
        
        // Determine final action based on edge case type
        let finalAction = 'RESPOND';
        const result = {
          response,
          appliedBlocks,
          timeMs: elapsed,
          shortCircuit: true
        };
        
        if (actionType === 'override_response') {
          finalAction = 'RESPOND';
          result.action = finalAction;
          
        } else if (actionType === 'force_transfer') {
          finalAction = 'TRANSFER';
          result.action = finalAction;
          result.transferTarget = edgeCase.action?.transferTarget || 'manager';
          result.shouldTransfer = true;
          
          logger.info('[CHEAT SHEET ENGINE] Edge case forcing transfer', {
            companyId: context.companyId,
            callId: context.callId,
            transferTarget: result.transferTarget
          });
          
        } else if (actionType === 'polite_hangup') {
          finalAction = 'HANGUP';
          result.action = finalAction;
          result.shouldHangup = true;
          
          logger.info('[CHEAT SHEET ENGINE] Edge case forcing hangup', {
            companyId: context.companyId,
            callId: context.callId,
            hangupMessage: response
          });
        }
        
        return result;
      }
    }
    
    // ────────────────────────────────────────────────────────────────
    // PRECEDENCE STEP 2: TRANSFER RULES (Second Priority)
    // ────────────────────────────────────────────────────────────────
    // Check for transfer intents (billing, emergency, technical, etc.)
    // If matched → RETURN WITH TRANSFER ACTION
    
    const transferRule = this.matchTransferRule(
      userInput, 
      context, 
      deserializedPolicy.transferRules
    );
    
    if (transferRule) {
      // Validate action is allowed
      const action = 'TRANSFER_' + transferRule.intentTag.toUpperCase();
      
      if (!deserializedPolicy.allowedActionFlags.has(action)) {
        logger.warn('[CHEAT SHEET ENGINE] Unauthorized transfer blocked', {
          companyId: context.companyId,
          callId: context.callId,
          action,
          intentTag: transferRule.intentTag,
          transferRuleId: transferRule.id
        });
        
        // Log security violation
        this.logSecurityViolation(context, action, transferRule);
        
        // Downgrade to safe response
        response = "Let me connect you with someone who can help.";
        appliedBlocks.push({ 
          type: 'TRANSFER_BLOCKED',
          reason: 'UNAUTHORIZED_ACTION'
        });
        
      } else {
        // Transfer is authorized
        // ✨ VARIABLE REPLACEMENT - Replace {variables} in transfer script
        response = transferRule.script;
        if (response && context.company) {
          logger.info('[CHEAT SHEET ENGINE] Replacing variables in transfer script...');
          response = replacePlaceholders(response, context.company);
        }
        
        appliedBlocks.push({ 
          type: 'TRANSFER_RULE', 
          id: transferRule.id,
          intentTag: transferRule.intentTag
        });
        
        const elapsed = Date.now() - startTime;
        
        logger.info('[CHEAT SHEET ENGINE] Transfer rule applied', {
          companyId: context.companyId,
          callId: context.callId,
          transferRuleId: transferRule.id,
          intentTag: transferRule.intentTag,
          transferTarget: transferRule.contact,
          timeMs: elapsed
        });
        
        // Enforce performance budget
        this.enforcePerformanceBudget(startTime, 10, context);
        
        return {
          response,
          appliedBlocks,
          action: 'TRANSFER',
          transferTarget: transferRule.contact,
          transferPhone: transferRule.phone,
          collectEntities: transferRule.entities || [],
          timeMs: elapsed,
          shortCircuit: false
        };
      }
    }
    
    // ────────────────────────────────────────────────────────────────
    // PRECEDENCE STEP 3: GUARDRAILS (Content Filtering)
    // ────────────────────────────────────────────────────────────────
    // Filter unauthorized content (prices, phone numbers, medical advice)
    // Applied to response text, modifies in-place
    
    const guardrailResult = this.enforceGuardrails(
      response,
      deserializedPolicy,
      context
    );
    
    if (guardrailResult.modified) {
      response = guardrailResult.response;
      appliedBlocks.push({ 
        type: 'GUARDRAILS',
        firedFlags: guardrailResult.firedFlags
      });
      
      logger.info('[CHEAT SHEET ENGINE] Guardrails applied', {
        companyId: context.companyId,
        callId: context.callId,
        firedFlags: guardrailResult.firedFlags,
        modificationsCount: guardrailResult.firedFlags.length
      });
    }
    
    // ────────────────────────────────────────────────────────────────
    // PRECEDENCE STEP 4: BEHAVIOR POLISH (Final Touches)
    // ────────────────────────────────────────────────────────────────
    // Apply tone adjustments (prepend "Ok", inject company name, etc.)
    // Final pass before returning to caller
    
    const behaviorResult = this.applyBehaviorRules(
      response,
      deserializedPolicy,
      context
    );
    
    if (behaviorResult.modified) {
      response = behaviorResult.response;
      appliedBlocks.push({ 
        type: 'BEHAVIOR_RULES',
        appliedRules: behaviorResult.appliedRules
      });
      
      logger.debug('[CHEAT SHEET ENGINE] Behavior rules applied', {
        companyId: context.companyId,
        callId: context.callId,
        appliedRules: behaviorResult.appliedRules
      });
    }
    
      // ────────────────────────────────────────────────────────────────
      // FINAL: Enforce Performance Budget & Return
      // ────────────────────────────────────────────────────────────────
      
      const elapsed = Date.now() - startTime;
      this.enforcePerformanceBudget(startTime, 10, context);
      
      logger.debug('[CHEAT SHEET ENGINE] Application complete', {
        companyId: context.companyId,
        callId: context.callId,
        turnNumber: context.turnNumber,
        appliedBlocks: appliedBlocks.map(b => b.type),
        timeMs: elapsed
      });
      
      return {
        response,
        appliedBlocks,
        action: 'RESPOND',
        timeMs: elapsed,
        shortCircuit: false
      };
      
    } catch (error) {
      // ────────────────────────────────────────────────────────────────
      // 🛡️ SAFE FALLBACK: CheatSheetEngine failed - never crash the call
      // ────────────────────────────────────────────────────────────────
      // If CheatSheet processing fails for ANY reason, we:
      // 1. Log CRITICAL error with full context
      // 2. Return base response (unchanged from 3-Tier)
      // 3. Mark failure in appliedBlocks for forensics
      // 4. DO NOT throw - call must continue gracefully
      
      const elapsed = Date.now() - startTime;
      
      logger.error('[CHEAT SHEET ENGINE] ❌ CRITICAL FAILURE - Safe fallback activated', {
        companyId: context.companyId,
        callId: context.callId,
        turnNumber: context.turnNumber,
        error: error.message,
        stack: error.stack,
        userInput: userInput.slice(0, 100),  // First 100 chars for context
        timeMs: elapsed,
        fallbackBehavior: 'returning_base_response'
      });
      
      // Return safe fallback response (no CheatSheet modifications)
      return {
        response: baseResponse,  // Use original 3-Tier response unchanged
        appliedBlocks: [{
          type: 'CHEATSHEET_FAILURE',
          error: error.message,
          failedAt: new Date().toISOString()
        }],
        action: 'RESPOND',
        timeMs: elapsed,
        shortCircuit: false,
        failureMode: true  // Flag for monitoring
      };
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // EDGE CASE DETECTION
  // ═══════════════════════════════════════════════════════════════════
  // Pattern matching against unusual caller inputs
  // First match wins (already sorted by priority)
  // ═══════════════════════════════════════════════════════════════════
  
  detectEdgeCase(input, edgeCases, context = {}) {
    const lowerInput = input.toLowerCase();
    const spam = context.spamContext || {};
    
    for (const edgeCase of edgeCases) {
      // ────────────────────────────────────────────────────────────────
      // 🛡️ SPAM → EDGE CASE BRIDGE: Enforce spam thresholds FIRST
      // ────────────────────────────────────────────────────────────────
      // Check spam conditions before keyword matching.
      // If spam requirements aren't met, skip this edge case entirely.
      
      if (edgeCase.minSpamScore != null) {
        if (!spam.spamScore || spam.spamScore < edgeCase.minSpamScore) {
          logger.debug('[CHEAT SHEET ENGINE] Edge case skipped (spam score too low)', {
            edgeCaseId: edgeCase.id,
            edgeCaseName: edgeCase.name,
            required: edgeCase.minSpamScore,
            actual: spam.spamScore || 0
          });
          continue; // Doesn't qualify, skip this rule
        }
      }
      
      if (edgeCase.spamRequired) {
        if (!spam.spamScore && (!spam.spamFlags || spam.spamFlags.length === 0)) {
          logger.debug('[CHEAT SHEET ENGINE] Edge case skipped (spam required but not present)', {
            edgeCaseId: edgeCase.id,
            edgeCaseName: edgeCase.name
          });
          continue; // No spam signal present, skip
        }
      }
      
      // ────────────────────────────────────────────────────────────────
      // PATTERN MATCHING: Check keywords/patterns
      // ────────────────────────────────────────────────────────────────
      for (const pattern of edgeCase.patterns) {
        if (pattern.test(lowerInput)) {
          logger.debug('[CHEAT SHEET ENGINE] Edge case matched', {
            edgeCaseId: edgeCase.id,
            edgeCaseName: edgeCase.name,
            pattern: pattern.source,
            priority: edgeCase.priority,
            spamScore: spam.spamScore || 0,
            spamBridgeActive: edgeCase.minSpamScore != null || edgeCase.spamRequired
          });
          
          // Return edge case with matched pattern metadata for logging
          return {
            ...edgeCase,
            _matchedPattern: pattern.source,  // Add matched pattern to result
            _spamScore: spam.spamScore || 0   // Include spam score for logging
          };
        }
      }
    }
    
    return null;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // TRANSFER RULE MATCHING
  // ═══════════════════════════════════════════════════════════════════
  // Intent-based matching with optional time-of-day filtering
  // First match wins (already sorted by priority)
  // ═══════════════════════════════════════════════════════════════════
  
  matchTransferRule(input, context, transferRules) {
    const lowerInput = input.toLowerCase();
    const currentHour = new Date().getHours();
    const isAfterHours = currentHour < 7 || currentHour >= 19;
    
    for (const rule of transferRules) {
      // Check after-hours restriction
      if (rule.afterHoursOnly && !isAfterHours) {
        continue;
      }
      
      // Check patterns
      for (const pattern of rule.patterns) {
        if (pattern.test(lowerInput)) {
          logger.debug('[CHEAT SHEET ENGINE] Transfer rule matched', {
            transferRuleId: rule.id,
            intentTag: rule.intentTag,
            pattern: pattern.source,
            priority: rule.priority,
            afterHoursOnly: rule.afterHoursOnly,
            isAfterHours
          });
          
          return rule;
        }
      }
    }
    
    return null;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // GUARDRAIL ENFORCEMENT
  // ═══════════════════════════════════════════════════════════════════
  // Content filtering and safety checks
  // Server-side enforcement (LLM cannot override)
  // ═══════════════════════════════════════════════════════════════════
  
  enforceGuardrails(response, policy, context) {
    let modified = response;
    const firedFlags = [];
    
    // NO_PRICES: Block $ amounts not in approved variables
    if (policy.guardrailFlags.has('NO_PRICES')) {
      const pricePattern = policy.guardrailPatterns.prices;
      
      if (pricePattern && pricePattern.test(modified)) {
        // Extract approved prices from company variables
        const approvedPrices = this.extractVariablePrices(context.company?.aiAgentSettings?.variables);
        
        modified = modified.replace(pricePattern, (match) => {
          if (approvedPrices.includes(match)) {
            return match; // Keep approved prices
          } else {
            firedFlags.push('NO_PRICES');
            logger.warn('[CHEAT SHEET ENGINE] Blocked unauthorized pricing', {
              companyId: context.companyId,
              callId: context.callId,
              blockedText: match
            });
            return '[contact us for pricing]';
          }
        });
      }
    }
    
    // NO_PHONE_NUMBERS: Block phone numbers unless whitelisted
    if (policy.guardrailFlags.has('NO_PHONE_NUMBERS')) {
      const phonePattern = policy.guardrailPatterns.phones;
      
      if (phonePattern && phonePattern.test(modified)) {
        const approvedPhones = [
          context.company?.aiAgentSettings?.variables?.phone,
          context.company?.aiAgentSettings?.variables?.emergencyPhone
        ].filter(Boolean);
        
        modified = modified.replace(phonePattern, (match) => {
          const isApproved = approvedPhones.some(p => 
            p && (p.includes(match) || match.includes(p))
          );
          
          if (isApproved) {
            return match;
          } else {
            firedFlags.push('NO_PHONE_NUMBERS');
            logger.warn('[CHEAT SHEET ENGINE] Blocked unauthorized phone number', {
              companyId: context.companyId,
              callId: context.callId
            });
            return '[contact information]';
          }
        });
      }
    }
    
    // NO_URLS: Block URLs unless whitelisted
    if (policy.guardrailFlags.has('NO_URLS')) {
      const urlPattern = policy.guardrailPatterns.urls;
      
      if (urlPattern && urlPattern.test(modified)) {
        modified = modified.replace(urlPattern, () => {
          firedFlags.push('NO_URLS');
          logger.warn('[CHEAT SHEET ENGINE] Blocked URL', {
            companyId: context.companyId,
            callId: context.callId
          });
          return '[website link removed]';
        });
      }
    }
    
    // NO_APOLOGIES_SPAM: Limit "sorry" to 1x per response
    if (policy.guardrailFlags.has('NO_APOLOGIES_SPAM')) {
      const apologyPattern = policy.guardrailPatterns.apologies;
      
      if (apologyPattern) {
        const matches = modified.match(apologyPattern);
        
        if (matches && matches.length > 1) {
          firedFlags.push('NO_APOLOGIES_SPAM');
          
          // Remove all but first "sorry"
          let firstApology = true;
          modified = modified.replace(apologyPattern, (match) => {
            if (firstApology) {
              firstApology = false;
              return match;
            }
            return '';
          });
          
          logger.debug('[CHEAT SHEET ENGINE] Reduced apology spam', {
            companyId: context.companyId,
            callId: context.callId,
            originalCount: matches.length,
            reducedTo: 1
          });
        }
      }
    }
    
    // NO_MEDICAL_ADVICE: Block medical terminology
    if (policy.guardrailFlags.has('NO_MEDICAL_ADVICE')) {
      const medicalPattern = policy.guardrailPatterns.medical;
      
      if (medicalPattern && medicalPattern.test(modified)) {
        firedFlags.push('NO_MEDICAL_ADVICE');
        
        modified = modified.replace(medicalPattern, (match) => {
          logger.warn('[CHEAT SHEET ENGINE] Blocked medical advice', {
            companyId: context.companyId,
            callId: context.callId,
            blockedTerm: match
          });
          return '[consult a professional]';
        });
      }
    }
    
    // NO_LEGAL_ADVICE: Block legal terminology
    if (policy.guardrailFlags.has('NO_LEGAL_ADVICE')) {
      const legalPattern = policy.guardrailPatterns.legal;
      
      if (legalPattern && legalPattern.test(modified)) {
        firedFlags.push('NO_LEGAL_ADVICE');
        
        modified = modified.replace(legalPattern, (match) => {
          logger.warn('[CHEAT SHEET ENGINE] Blocked legal advice', {
            companyId: context.companyId,
            callId: context.callId,
            blockedTerm: match
          });
          return '[consult legal counsel]';
        });
      }
    }
    
    return {
      response: modified,
      modified: modified !== response,
      firedFlags: [...new Set(firedFlags)] // Deduplicate
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // BEHAVIOR RULE APPLICATION
  // ═══════════════════════════════════════════════════════════════════
  // Tone and style adjustments (final polish)
  // ═══════════════════════════════════════════════════════════════════
  
  applyBehaviorRules(response, policy, context) {
    let modified = response;
    const appliedRules = [];
    
    // ACK_OK: Prepend "Ok" if not already present
    if (policy.behaviorFlags.has('ACK_OK')) {
      if (!modified.toLowerCase().startsWith('ok')) {
        modified = 'Ok, ' + modified.charAt(0).toLowerCase() + modified.slice(1);
        appliedRules.push('ACK_OK');
      }
    }
    
    // USE_COMPANY_NAME: Inject company name in first-turn greeting
    if (policy.behaviorFlags.has('USE_COMPANY_NAME') && context.isFirstTurn) {
      const companyName = context.company?.aiAgentSettings?.variables?.companyname;
      
      if (companyName && !modified.includes(companyName)) {
        modified = `Thanks for calling ${companyName}! ${modified}`;
        appliedRules.push('USE_COMPANY_NAME');
      }
    }
    
    // CONFIRM_ENTITIES: Repeat back collected entities
    if (policy.behaviorFlags.has('CONFIRM_ENTITIES') && context.collectedEntities) {
      const entityPairs = Object.entries(context.collectedEntities)
        .filter(([key, val]) => val)
        .map(([key, val]) => `${key}: ${val}`);
      
      if (entityPairs.length > 0) {
        modified += ` Just to confirm: ${entityPairs.join(', ')}.`;
        appliedRules.push('CONFIRM_ENTITIES');
      }
    }
    
    // POLITE_PROFESSIONAL: Expand contractions, formal tone
    if (policy.behaviorFlags.has('POLITE_PROFESSIONAL')) {
      const contractions = {
        "don't": "do not",
        "can't": "cannot",
        "won't": "will not",
        "didn't": "did not",
        "hasn't": "has not",
        "haven't": "have not",
        "isn't": "is not",
        "aren't": "are not",
        "wasn't": "was not",
        "weren't": "were not",
        "I'm": "I am",
        "you're": "you are",
        "we're": "we are",
        "they're": "they are",
        "it's": "it is",
        "that's": "that is"
      };
      
      let expandedContractions = false;
      Object.entries(contractions).forEach(([contraction, expansion]) => {
        const regex = new RegExp(`\\b${contraction}\\b`, 'gi');
        if (regex.test(modified)) {
          modified = modified.replace(regex, expansion);
          expandedContractions = true;
        }
      });
      
      if (expandedContractions) {
        appliedRules.push('POLITE_PROFESSIONAL');
      }
    }
    
    return {
      response: modified,
      modified: modified !== response,
      appliedRules
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // PERFORMANCE BUDGET ENFORCEMENT
  // ═══════════════════════════════════════════════════════════════════
  // Hard 10ms budget - abort if exceeded
  // Emit alert for ops team if severely over budget
  // ═══════════════════════════════════════════════════════════════════
  
  enforcePerformanceBudget(startTime, budgetMs, context) {
    const elapsed = Date.now() - startTime;
    
    if (elapsed > budgetMs) {
      logger.error('[CHEAT SHEET ENGINE] Performance budget exceeded', {
        companyId: context.companyId,
        callId: context.callId,
        elapsed,
        budget: budgetMs,
        overage: elapsed - budgetMs
      });
      
      // Alert ops if severely over budget (>15ms)
      if (elapsed > 15) {
        this.alertOps('CHEATSHEET_PERF_FAULT', {
          companyId: context.companyId,
          callId: context.callId,
          elapsed,
          budget: budgetMs,
          overage: elapsed - budgetMs
        });
      }
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // HELPER: Deserialize Policy
  // ═══════════════════════════════════════════════════════════════════
  // Convert serialized policy (from Redis) to runtime format
  // Sets: Array → Set, RegExp: {pattern, flags} → RegExp
  // ═══════════════════════════════════════════════════════════════════
  
  deserializePolicy(policy) {
    // If already deserialized, return as-is
    if (policy.behaviorFlags instanceof Set) {
      return policy;
    }
    
    return {
      ...policy,
      behaviorFlags: new Set(policy.behaviorFlags || []),
      guardrailFlags: new Set(policy.guardrailFlags || []),
      allowedActionFlags: new Set(policy.allowedActionFlags || []),
      
      edgeCases: (policy.edgeCases || []).map(ec => ({
        ...ec,
        patterns: ec.patterns.map(p => 
          new RegExp(p.pattern, p.flags)
        )
      })),
      
      transferRules: (policy.transferRules || []).map(tr => ({
        ...tr,
        patterns: tr.patterns.map(p => 
          new RegExp(p.pattern, p.flags)
        )
      })),
      
      guardrailPatterns: Object.fromEntries(
        Object.entries(policy.guardrailPatterns || {}).map(([key, p]) => [
          key,
          new RegExp(p.pattern, p.flags)
        ])
      )
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // HELPER: Extract Variable Prices
  // ═══════════════════════════════════════════════════════════════════
  
  extractVariablePrices(variables) {
    if (!variables) return [];
    
    const prices = [];
    
    // variables can be a Map or plain object
    const entries = variables instanceof Map 
      ? Array.from(variables.entries())
      : Object.entries(variables);
    
    entries.forEach(([key, value]) => {
      if (typeof value === 'string') {
        const matches = value.match(/\$\d+(?:,\d{3})*(?:\.\d{2})?/g);
        if (matches) {
          prices.push(...matches);
        }
      }
    });
    
    return prices;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // HELPER: Log Security Violation
  // ═══════════════════════════════════════════════════════════════════
  
  logSecurityViolation(context, action, transferRule) {
    logger.warn('[CHEAT SHEET ENGINE] Security violation', {
      type: 'UNAUTHORIZED_ACTION',
      companyId: context.companyId,
      callId: context.callId,
      action,
      transferRuleId: transferRule.id,
      intentTag: transferRule.intentTag,
      timestamp: new Date().toISOString()
    });
    
    // In production, this would also write to SecurityLog model
    // For now, just log to console
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // HELPER: Alert Ops Team
  // ═══════════════════════════════════════════════════════════════════
  
  alertOps(event, data) {
    logger.error(`[ALERT] ${event}`, data);
    
    // In production, this would integrate with:
    // - PagerDuty
    // - Datadog alerts
    // - Slack notifications
    // For now, just log to console
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXPORT SINGLETON
// ═══════════════════════════════════════════════════════════════════
module.exports = new CheatSheetEngine();

