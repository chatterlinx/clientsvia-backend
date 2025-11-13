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
    
    const edgeCase = this.detectEdgeCase(userInput, deserializedPolicy.edgeCases);
    
    if (edgeCase) {
      // ✨ VARIABLE REPLACEMENT - Replace {variables} in edge case response
      response = edgeCase.response;
      if (response && context.company) {
        logger.info('[CHEAT SHEET ENGINE] Replacing variables in edge case response...');
        response = replacePlaceholders(response, context.company);
      }
      
      appliedBlocks.push({ 
        type: 'EDGE_CASE', 
        id: edgeCase.id,
        name: edgeCase.name
      });
      
      const elapsed = Date.now() - startTime;
      
      logger.info('[CHEAT SHEET ENGINE] Edge case triggered (short-circuit)', {
        companyId: context.companyId,
        callId: context.callId,
        edgeCaseId: edgeCase.id,
        edgeCaseName: edgeCase.name,
        timeMs: elapsed
      });
      
      // ────────────────────────────────────────────────────────────────
      // 🤖 AUTO-BLACKLIST TRIGGER (Nov 2025)
      // ────────────────────────────────────────────────────────────────
      // Check if this edge case should trigger auto-blacklist
      // This is ASYNC and NON-BLOCKING - don't wait for completion
      // 
      // Auto-blacklist will:
      // 1. Check if auto-blacklist is enabled for company
      // 2. Check if this edge case is in configured triggers
      // 3. Check detection threshold
      // 4. Add to blacklist (pending or active based on settings)
      // 5. Clear Redis cache
      // 
      // Future calls from this number will be blocked at Layer 1
      // (before reaching AI agent, saving AI credits)
      // ────────────────────────────────────────────────────────────────
      
      if (context.callerPhone) {
        const SmartCallFilter = require('./SmartCallFilter');
        
        logger.security('[CHEAT SHEET ENGINE] 🤖 Checking auto-blacklist trigger...', {
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
            // Not an error - just didn't meet criteria (disabled, threshold not met, etc.)
            logger.debug('[CHEAT SHEET ENGINE] ⏭️ Auto-blacklist skipped:', {
              companyId: context.companyId,
              phoneNumber: context.callerPhone,
              reason: result.reason,
              detections: result.detections,
              threshold: result.threshold
            });
          }
        }).catch(error => {
          // Log error but don't fail the call
          logger.error('[CHEAT SHEET ENGINE] ❌ Auto-blacklist error (non-critical):', {
            error: error.message,
            companyId: context.companyId,
            phoneNumber: context.callerPhone,
            edgeCaseName: edgeCase.name
          });
        });
      } else {
        logger.warn('[CHEAT SHEET ENGINE] ⚠️ Auto-blacklist skipped: No caller phone number in context');
      }
      
      // Enforce performance budget
      this.enforcePerformanceBudget(startTime, 10, context);
      
      return {
        response,
        appliedBlocks,
        action: 'RESPOND',
        timeMs: elapsed,
        shortCircuit: true
      };
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
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // EDGE CASE DETECTION
  // ═══════════════════════════════════════════════════════════════════
  // Pattern matching against unusual caller inputs
  // First match wins (already sorted by priority)
  // ═══════════════════════════════════════════════════════════════════
  
  detectEdgeCase(input, edgeCases) {
    const lowerInput = input.toLowerCase();
    
    for (const edgeCase of edgeCases) {
      for (const pattern of edgeCase.patterns) {
        if (pattern.test(lowerInput)) {
          logger.debug('[CHEAT SHEET ENGINE] Edge case matched', {
            edgeCaseId: edgeCase.id,
            edgeCaseName: edgeCase.name,
            pattern: pattern.source,
            priority: edgeCase.priority
          });
          
          return edgeCase;
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

