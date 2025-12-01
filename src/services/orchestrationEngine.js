/**
 * ============================================================================
 * ORCHESTRATION ENGINE - LLM-0 MASTER ORCHESTRATOR + 3-TIER BRIDGE
 * ============================================================================
 * 
 * PURPOSE: Main entry point for processing every caller utterance
 * ARCHITECTURE: Wires together Frontline-Intel, LLM-0, 3-Tier KB, BookingHandler
 * USED BY: Twilio voice routes (real-time call processing)
 * 
 * FLOW:
 * 1. Load FrontlineContext from Redis
 * 2. Load runtime config from CompanyConfigLoader
 * 3. Strip filler words
 * 4. Run Frontline-Intel (cheap intent classifier)
 * 5. Build LLM-0 prompt
 * 6. Call LLM for orchestrator decision
 * 6.5. [THE BRIDGE] If knowledge needed → IntelligentRouter (3-Tier) → Reshape naturally
 * 7. Apply decision to context
 * 8. Trigger booking if ready
 * 9. Return nextPrompt for TTS
 * 
 * PHASE 4 ADDITION (Nov 16, 2025):
 * STEP 6.5 connects LLM-0 to the existing 3-Tier knowledge engine:
 * - Detects when factual knowledge is needed
 * - Routes query through IntelligentRouter (Tier 1 → Tier 2 → Tier 3)
 * - Receives accurate facts from company knowledge base
 * - Reshapes facts into natural conversational response
 * - Logs tier usage for cost tracking and self-improvement
 * 
 * This makes the agent:
 * ✅ Naturally conversational (LLM-0 personality)
 * ✅ Factually accurate (3-Tier verified knowledge)
 * ✅ Cost efficient (95%+ answered FREE via Tier 1/2)
 * ✅ Self-improving (Tier 3 → Learning Console → Admin → Tier 1)
 * 
 * ============================================================================
 */

const openaiClient = require('../../config/openai');
const logger = require('../../utils/logger');
const { loadCompanyRuntimeConfig } = require('./companyConfigLoader');
const { classifyFrontlineIntent } = require('./frontlineIntelService');
const frontlineContextService = require('./frontlineContextService');
const bookingHandler = require('./bookingHandler');
const IntelligentRouter = require('../../services/IntelligentRouter');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const V2Company = require('../../models/v2Company');
const TraceLogger = require('../../services/TraceLogger');

// ============================================================================
// PRECISION V23 ENHANCEMENTS (Domain-Driven Design)
// ============================================================================
const {
  preprocessing: { FillerStripper, TranscriptNormalizer },
  intelligence: { EmotionDetector },
  routing: { MicroLLMRouter, CompactPromptCompiler },
  personality: { HumanLayerAssembler }
} = require('./orchestration');

/**
 * Process a single caller turn and return what to say next
 * @param {Object} params
 * @param {string} params.companyId - Company ID
 * @param {string} params.callId - Twilio Call SID
 * @param {'caller'|'agent'} params.speaker - Who is speaking
 * @param {string} params.text - Original STT output
 * @param {Object} [params.rawSttMetadata] - Optional STT metadata
 * @returns {Promise<import('../core/orchestrationTypes').OrchestrationResult>}
 */
async function processCallerTurn({ companyId, callId, speaker, text, rawSttMetadata = {} }) {
  const startTime = Date.now();
  
  try {
    logger.info('[ORCHESTRATOR] Processing caller turn', {
      companyId,
      callId,
      speaker,
      textLength: text.length,
      startTime
    });
    
    // ========================================================================
    // STEP 1: Load current context from Redis
    // ========================================================================
    let ctx = await frontlineContextService.loadContext(callId);
    
    if (!ctx) {
      logger.info('[ORCHESTRATOR] No context found, initializing new context', { callId, companyId });
      
      // Initialize new context if missing
      ctx = await frontlineContextService.initContext({
        callId,
        companyId,
        trade: undefined, // Will be populated from config
        configVersion: 1
      });
    }
    
    // ========================================================================
    // STEP 2: Load runtime config from CompanyConfigLoader
    // ========================================================================
    const config = await loadCompanyRuntimeConfig({ companyId });
    
    // PRODUCTION HARDENING: Check feature flag
    // If orchestrator is not enabled for this company, return no-op
    const orchestratorEnabled = config.intelligence?.orchestratorEnabled !== false; // Default true
    
    if (!orchestratorEnabled) {
      logger.info('[ORCHESTRATOR] Orchestrator disabled for company, returning no-op', {
        companyId,
        callId
      });
      
      return {
        nextPrompt: null, // Signal to caller to use legacy system
        decision: {
          action: 'no_op',
          nextPrompt: null,
          updatedIntent: null,
          updates: { extracted: {}, flags: {} },
          knowledgeQuery: null,
          debugNotes: 'orchestrator_disabled_for_company'
        }
      };
    }
    
    // Update trade in context if not set
    if (!ctx.trade && config.trade) {
      ctx.trade = config.trade;
    }
    
    // PRODUCTION HARDENING: Check debug flag for detailed logging
    const debugOrchestrator = config.intelligence?.debugOrchestrator === true; // Default false
    
    if (debugOrchestrator) {
      logger.debug('[ORCHESTRATOR] Config loaded (DEBUG MODE)', {
        companyName: config.name,
        trade: config.trade,
        scenariosTotal: config.scenarios.length,
        variablesCount: config.variables.definitions.length,
        orchestratorEnabled,
        configSample: {
          variables: Object.keys(config.variables?.values || {}).slice(0, 5),
          fillerWordsCount: config.fillerWords?.active?.length || 0,
          scenarioCategories: Object.keys(config.scenarios?.byCategory || {})
        }
      });
    } else {
      logger.info('[ORCHESTRATOR] Config loaded', {
        companyId,
        companyName: config.name,
        orchestratorEnabled
      });
    }
    
    // ========================================================================
    // STEP 3: Preprocessing (Precision V23 Enhancement)
    // ========================================================================
    const rawText = text;
    
    // Step 3a: Strip filler words (upgraded to FillerStripper)
    let cleanedText = FillerStripper.clean(text);
    
    // Step 3b: Normalize transcript (spelling, punctuation)
    cleanedText = TranscriptNormalizer.normalize(cleanedText);
    
    if (debugOrchestrator) {
      logger.debug('[ORCHESTRATOR] Filler words stripped (DEBUG)', {
        originalLength: rawText.length,
        cleanedLength: cleanedText.length,
        fillerWordsCount: config.fillerWords.active.length,
        rawText: rawText.substring(0, 100),
        cleanedText: cleanedText.substring(0, 100)
      });
    }
    
    // Append to transcript
    ctx.transcript.push({
      role: speaker,
      text: rawText,
      timestamp: Date.now()
    });
    
    // ========================================================================
    // STEP 4: Run Frontline-Intel (cheap classifier)
    // ========================================================================
    const intel = classifyFrontlineIntent({
      text: cleanedText,
      config,
      context: ctx
    });
    
    logger.info('[ORCHESTRATOR] Frontline-Intel classification', {
      intent: intel.intent,
      confidence: intel.confidence,
      signals: intel.signals
    });
    
    // ========================================================================
    // STEP 4.5: Emotion Detection (Precision V23 Enhancement)
    // ========================================================================
    const emotion = EmotionDetector.analyze(cleanedText, ctx.memory);
    
    logger.info('[ORCHESTRATOR] Emotion detected', {
      primary: emotion.primary,
      intensity: emotion.intensity.toFixed(2),
      signalCount: emotion.signals.length
    });
    
    // Attach emotion to context for downstream use
    ctx.emotion = emotion;
    
    // Update intent if confidence is high and not spam/wrong_number
    if (intel.confidence > 0.7 && !['spam', 'wrong_number'].includes(intel.intent)) {
      ctx.currentIntent = intel.intent;
    }
    
    // ========================================================================
    // STEP 5: Build LLM-0 prompt
    // ========================================================================
    const llmPrompt = buildOrchestratorPrompt({
      cleanedText,
      context: ctx,
      config,
      intel
    });
    
    // ========================================================================
    // STEP 6: Call LLM for orchestrator decision
    // ========================================================================
    let decision;
    
    try {
      decision = await callLLM0(llmPrompt, { companyId, callId });
      
      // PRODUCTION HARDENING: Post-filter for guardrail violations
      decision = enforceGuardrails(decision, config);
      
    } catch (llmError) {
      logger.error('[ORCHESTRATOR] LLM call failed, using fallback', {
        error: llmError.message,
        companyId,
        callId
      });
      
      // Fallback decision
      decision = buildFallbackDecision(intel, ctx);
    }
    
    logger.info('[ORCHESTRATOR] LLM-0 decision', {
      action: decision.action,
      updatedIntent: decision.updatedIntent,
      readyToBook: decision.updates?.flags?.readyToBook,
      needsKnowledgeSearch: decision.updates?.flags?.needsKnowledgeSearch,
      debugNotes: decision.debugNotes
    });
    
    // ========================================================================
    // STEP 6.5: 3-TIER KNOWLEDGE INTEGRATION (THE BRIDGE)
    // ========================================================================
    // If LLM-0 determined that factual knowledge is needed, route through
    // the existing 3-Tier system (IntelligentRouter) to get accurate facts
    // from company knowledge base, then have LLM-0 deliver them naturally.
    // 
    // This is the critical bridge that connects:
    // - Frontline-Intel (intent classification)
    // - LLM-0 (orchestration + natural delivery)
    // - 3-Tier (accurate knowledge: Tier 1 FREE → Tier 2 CHEAP → Tier 3 LLM)
    // ========================================================================
    
    const needsKnowledge = decision.updates?.flags?.needsKnowledgeSearch === true ||
                           decision.action === 'answer_with_knowledge';
    
    if (needsKnowledge && decision.knowledgeQuery) {
      try {
        logger.info('[ORCHESTRATOR] Knowledge search requested via 3-Tier', {
          callId,
          companyId,
          queryType: decision.knowledgeQuery.type,
          queryText: decision.knowledgeQuery.queryText?.substring(0, 100)
        });
        
        // Load full company document (needed for IntelligentRouter)
        const company = await V2Company.findById(companyId).lean();
        
        if (!company) {
          throw new Error('Company not found');
        }
        
        // Get template reference from company configuration
        const templateId = company.configuration?.clonedFrom || 
                          company.aiAgentSettings?.templateId;
        
        if (!templateId) {
          logger.warn('[ORCHESTRATOR] No template found for company, skipping 3-Tier', {
            companyId,
            callId
          });
        } else {
          // Load template (contains scenarios for matching)
          const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
          
          if (!template) {
            logger.warn('[ORCHESTRATOR] Template not found, skipping 3-Tier', {
              companyId,
              templateId,
              callId
            });
          } else {
            // Initialize 3-Tier IntelligentRouter
            const router = new IntelligentRouter();
            
            // Route through 3-Tier system (Tier 1 → Tier 2 → Tier 3)
            const knowledgeResult = await router.route({
              callerInput: decision.knowledgeQuery.queryText || cleanedText,
              template,
              company,
              callId,
              context: {
                intent: decision.updatedIntent || ctx.currentIntent,
                frontlineIntel: intel,
                extractedContext: ctx.extracted,
                conversationHistory: ctx.transcript.slice(-3) // Last 3 turns for context
              }
            });
            
            logger.info('[ORCHESTRATOR] 3-Tier knowledge result', {
              callId,
              tier: knowledgeResult.tier,
              confidence: knowledgeResult.confidence?.toFixed(3),
              hasScenario: !!knowledgeResult.scenario,
              cost: knowledgeResult.cost?.total || 0
            });
            
            // Log tier usage in context trace
            ctx.tierTrace.push({
              tier: knowledgeResult.tier || 0,
              timestamp: Date.now(),
              action: 'knowledge_search',
              intent: ctx.currentIntent,
              confidence: knowledgeResult.confidence || 0,
              sourceId: knowledgeResult.scenario?.scenarioId || 'unknown',
              reasoning: JSON.stringify({
                tier: knowledgeResult.tier,
                confidence: knowledgeResult.confidence,
                matched: knowledgeResult.scenario?.name || 'no_match',
                cost: knowledgeResult.cost?.total || 0
              }).slice(0, 500)
            });
            
            // If 3-Tier found solid factual knowledge, use it
            if (knowledgeResult.scenario && knowledgeResult.confidence >= 0.5) {
              // Extract factual content from scenario
              const factualKnowledge = knowledgeResult.scenario.responseText || 
                                      knowledgeResult.responseText || 
                                      '';
              
              // CRITICAL: Have LLM-0 reshape facts into natural conversational response
              // This maintains the "lively" personality while ensuring accuracy
              if (factualKnowledge) {
                logger.info('[ORCHESTRATOR] Reshaping 3-Tier facts into natural response', {
                  callId,
                  tier: knowledgeResult.tier,
                  factLength: factualKnowledge.length
                });
                
                // Build enhanced prompt for LLM-0 to reshape facts naturally
                const reshapeSystemPrompt = `You are reshaping factual knowledge into a natural, conversational response.

CRITICAL RULES:
- Use the EXACT facts provided (do not change technical details)
- Deliver them in a warm, natural, human tone
- Keep the caller's emotional context in mind
- Move towards the appropriate next action (booking, clarification, etc.)
- NEVER add facts not in the source material

FACTUAL KNOWLEDGE FROM KB (Tier ${knowledgeResult.tier}):
${factualKnowledge}

CALLER CONTEXT:
- Intent: ${ctx.currentIntent}
- Recent transcript: ${ctx.transcript.slice(-2).map(t => `${t.role}: ${t.text}`).join('\n')}

YOUR TASK:
Reshape these facts into a natural response that:
1. Acknowledges the caller's concern
2. Delivers the factual knowledge conversationally
3. Offers appropriate next action

Respond ONLY with the natural dialogue (no JSON, no meta-commentary).`;

                try {
                  const reshapeResponse = await openaiClient.chat.completions.create({
                    model: 'gpt-4o-mini',
                    temperature: 0.7, // Slightly higher for natural delivery
                    max_tokens: 300,
                    messages: [
                      { role: 'system', content: reshapeSystemPrompt },
                      { role: 'user', content: decision.knowledgeQuery.queryText || cleanedText }
                    ]
                  });
                  
                  const naturalResponse = reshapeResponse.choices?.[0]?.message?.content?.trim();
                  
                  if (naturalResponse) {
                    // Use the naturally reshaped response
                    decision.nextPrompt = naturalResponse;
                    decision.action = 'answer_with_knowledge';
                    decision.knowledgeTier = knowledgeResult.tier;
                    decision.knowledgeConfidence = knowledgeResult.confidence;
                    
                    logger.info('[ORCHESTRATOR] Natural response created from 3-Tier facts', {
                      callId,
                      tier: knowledgeResult.tier,
                      responseLength: naturalResponse.length
                    });
                  }
                  
                } catch (reshapeError) {
                  logger.error('[ORCHESTRATOR] Failed to reshape facts naturally, using direct response', {
                    error: reshapeError.message,
                    callId
                  });
                  
                  // Fallback: use scenario response directly (less natural but still accurate)
                  decision.nextPrompt = factualKnowledge;
                  decision.action = 'answer_with_knowledge';
                  decision.knowledgeTier = knowledgeResult.tier;
                  decision.knowledgeConfidence = knowledgeResult.confidence;
                }
              }
            } else {
              // No solid knowledge found in 3-Tier
              logger.warn('[ORCHESTRATOR] 3-Tier found no confident answer', {
                callId,
                companyId,
                highestConfidence: knowledgeResult.confidence?.toFixed(3) || 0
              });
              
              // Keep original LLM-0 decision (might escalate to human or clarify)
              if (decision.action === 'answer_with_knowledge') {
                // Change to clarify since we don't have solid knowledge
                decision.action = 'clarify_intent';
                decision.nextPrompt = decision.nextPrompt || 
                  "I want to make sure I give you accurate information. Could you tell me a bit more about what's happening?";
              }
            }
          }
        }
        
      } catch (knowledgeError) {
        logger.error('[ORCHESTRATOR] 3-Tier knowledge search failed', {
          error: knowledgeError.message,
          stack: knowledgeError.stack,
          callId,
          companyId
        });
        
        // Graceful fallback: escalate to human or use original LLM-0 response
        if (decision.action === 'answer_with_knowledge') {
          decision.action = 'escalate_to_human';
          decision.nextPrompt = "Let me connect you with someone from the office who can help you with that right away.";
        }
      }
    }
    
    // ========================================================================
    // STEP 7: Apply decision to context
    // ========================================================================
    
    // Update intent if LLM suggests new one
    if (decision.updatedIntent) {
      ctx.currentIntent = decision.updatedIntent;
    }
    
    // Merge extracted context updates
    if (decision.updates?.extracted) {
      ctx.extracted = mergeExtractedContext(ctx.extracted, decision.updates.extracted);
    }
    
    // Update flags
    if (decision.updates?.flags) {
      if (typeof decision.updates.flags.readyToBook === 'boolean') {
        ctx.readyToBook = decision.updates.flags.readyToBook;
      }
    }
    
    // Add to tier trace
    ctx.tierTrace.push({
      tier: 0, // LLM-0 orchestrator
      timestamp: Date.now(),
      action: decision.action,
      intent: ctx.currentIntent,
      confidence: intel.confidence,
      sourceId: 'orchestrator',
      reasoning: decision.debugNotes || ''
    });
    
    // Save context back to Redis
    await frontlineContextService.saveContext(ctx);
    
    logger.debug('[ORCHESTRATOR] Context updated and saved', {
      callId,
      currentIntent: ctx.currentIntent,
      readyToBook: ctx.readyToBook,
      transcriptLength: ctx.transcript.length,
      tierTraceLength: ctx.tierTrace.length
    });
    
    // ========================================================================
    // STEP 8: Handle booking if ready
    // ========================================================================
    let finalPrompt = decision.nextPrompt;
    
    if (decision.action === 'initiate_booking' && ctx.readyToBook) {
      try {
        logger.info('[ORCHESTRATOR] Initiating booking', {
          callId,
          companyId,
          extracted: ctx.extracted
        });
        
        const appointment = await bookingHandler.handleBookingFromContext(ctx);
        
        // Update context with appointment info
        ctx.appointmentId = appointment._id.toString();
        await frontlineContextService.saveContext(ctx);
        
        // Enhance confirmation prompt
        finalPrompt = buildBookingConfirmationPrompt(appointment, ctx.extracted, config);
        
        logger.info('[ORCHESTRATOR] Booking successful', {
          callId,
          appointmentId: ctx.appointmentId,
          scheduledDate: appointment.scheduledDate,
          timeWindow: appointment.timeWindow
        });
        
      } catch (bookingError) {
        logger.error('[ORCHESTRATOR] Booking failed', {
          error: bookingError.message,
          stack: bookingError.stack,
          callId,
          companyId
        });
        
        // Override decision to escalate
        decision.action = 'escalate_to_human';
        finalPrompt = "I'm having trouble completing your booking right now. Let me connect you with someone who can help you directly.";
        
        // Save error in context
        ctx.tierTrace.push({
          tier: 0,
          timestamp: Date.now(),
          action: 'booking_failed',
          intent: ctx.currentIntent,
          confidence: 0,
          sourceId: 'booking_error',
          reasoning: bookingError.message
        });
        
        await frontlineContextService.saveContext(ctx);
      }
    }
    
    // ========================================================================
    // STEP 9: Return orchestration result
    // ========================================================================
    const duration = Date.now() - startTime;
    
    if (debugOrchestrator) {
      logger.info('[ORCHESTRATOR] Turn complete (DEBUG)', {
        callId,
        companyId,
        action: decision.action,
        intent: ctx.currentIntent,
        readyToBook: ctx.readyToBook,
        appointmentId: ctx.appointmentId || null,
        durationMs: duration,
        finalPromptLength: finalPrompt.length,
        extractedSample: {
          hasContact: !!(ctx.extracted?.contact?.name || ctx.extracted?.contact?.phone),
          hasLocation: !!ctx.extracted?.location?.addressLine1,
          hasProblem: !!ctx.extracted?.problem?.summary
        },
        tierTraceLength: ctx.tierTrace.length
      });
    } else {
      // Compact logging for production
      logger.info('[ORCHESTRATOR] Turn complete', {
        callId,
        companyId,
        action: decision.action,
        intent: ctx.currentIntent,
        readyToBook: ctx.readyToBook,
        appointmentId: ctx.appointmentId || null
      });
    }
    
    // ========================================================================
    // STEP 10: TRACE LOGGING (FIRE-AND-FORGET)
    // ========================================================================
    // Log full decision chain to MongoDB for Cortex-Intel debugging
    // This NEVER blocks the call - errors are caught and logged only
    // ========================================================================
    const turnNumber = ctx.transcript.length;
    
    // Find 3-Tier knowledge result from tier trace if it exists
    const knowledgeLookup = ctx.tierTrace.find(t => t.action === 'knowledge_search' && t.tier > 0);
    
    TraceLogger.logTurn({
      callId,
      companyId,
      turnNumber,
      
      input: {
        speaker,
        text,
        textCleaned: cleanedText,
        sttMetadata: rawSttMetadata
      },
      
      frontlineIntel: {
        intent: intel.intent,
        confidence: intel.confidence,
        signals: intel.signals,
        entities: null, // Could be enhanced later
        metadata: null
      },
      
      orchestratorDecision: {
        action: decision.action,
        nextPrompt: finalPrompt,
        updatedIntent: decision.updatedIntent,
        updates: decision.updates,
        knowledgeQuery: decision.knowledgeQuery,
        debugNotes: decision.debugNotes
      },
      
      knowledgeLookup: knowledgeLookup ? {
        triggered: true,
        result: knowledgeLookup.reasoning ? JSON.parse(knowledgeLookup.reasoning) : null,
        reason: 'LLM-0 requested knowledge search'
      } : {
        triggered: false,
        result: null,
        reason: 'Not requested'
      },
      
      bookingAction: ctx.appointmentId ? {
        triggered: true,
        contactId: null, // bookingHandler doesn't expose this easily
        locationId: null, // bookingHandler doesn't expose this easily
        appointmentId: ctx.appointmentId,
        result: 'success',
        error: null
      } : {
        triggered: false,
        contactId: null,
        locationId: null,
        appointmentId: null,
        result: null,
        error: null
      },
      
      output: {
        agentResponse: finalPrompt,
        action: decision.action,
        nextState: ctx.currentIntent
      },
      
      performance: {
        frontlineIntelMs: 5, // Frontline-Intel is sub-5ms (approx)
        orchestratorMs: duration - 5, // Rest is orchestrator + other ops
        knowledgeLookupMs: knowledgeLookup ? 100 : 0, // Approximate if available
        bookingMs: ctx.appointmentId ? 50 : 0, // Approximate if booking happened
        totalMs: duration
      },
      
      cost: {
        frontlineIntel: 0, // Free
        orchestrator: decision.llmCost || 0, // If tracked in decision
        knowledgeLookup: knowledgeLookup && knowledgeLookup.reasoning ? 
          (JSON.parse(knowledgeLookup.reasoning).cost || 0) : 0,
        booking: 0, // DB ops only
        total: (decision.llmCost || 0) + (knowledgeLookup && knowledgeLookup.reasoning ? 
          (JSON.parse(knowledgeLookup.reasoning).cost || 0) : 0)
      },
      
      contextSnapshot: {
        currentIntent: ctx.currentIntent,
        extractedData: ctx.extracted,
        conversationLength: turnNumber,
        bookingReadiness: ctx.readyToBook
      }
    }).catch((traceError) => {
      // Log trace errors but NEVER let them break the call
      logger.error('[ORCHESTRATOR] Trace logging failed (non-fatal)', {
        error: traceError.message,
        callId,
        companyId,
        turnNumber
      });
    });
    
    return {
      nextPrompt: finalPrompt,
      decision: {
        ...decision,
        nextPrompt: finalPrompt // Use enhanced prompt if booking modified it
      }
    };
    
  } catch (error) {
    logger.error('[ORCHESTRATOR] Fatal error processing caller turn', {
      error: error.message,
      stack: error.stack,
      companyId,
      callId,
      speaker,
      text: text?.substring(0, 100)
    });
    
    // Emergency fallback
    return {
      nextPrompt: "I'm here to help. Could you please tell me your name and what you need assistance with?",
      decision: {
        action: 'ask_question',
        nextPrompt: "I'm here to help. Could you please tell me your name and what you need assistance with?",
        updatedIntent: null,
        updates: {
          extracted: {},
          flags: {
            readyToBook: false,
            needsKnowledgeSearch: false,
            wantsHuman: false
          }
        },
        knowledgeQuery: null,
        debugNotes: `orchestrator_fatal_error: ${error.message}`
      }
    };
  }
}

// REMOVED: stripFillerWords() - replaced with FillerStripper.clean() + TranscriptNormalizer.normalize() (Precision V23)

/**
 * Build LLM-0 orchestrator prompt
 * @param {Object} params
 * @returns {{system: string, user: string}}
 */
function buildOrchestratorPrompt({ cleanedText, context, config, intel }) {
  const systemPrompt = `You are LLM-0, the master orchestrator for ${config.name || 'the company'}, a ${config.trade || 'service'} company's AI receptionist.

YOUR ROLE:
- You are NOT a content/knowledge bot
- You decide ACTIONS and extract STRUCTURED DATA
- You return ONLY valid JSON (no extra text)
- You are the "traffic cop" - decide what to do next, not what to say (except for nextPrompt)

CURRENT CALL STATE:
- Intent: ${context.currentIntent || 'unknown'}
- Ready to Book: ${context.readyToBook ? 'YES' : 'NO'}
- Extracted Contact: ${JSON.stringify(context.extracted?.contact || {})}
- Extracted Location: ${JSON.stringify(context.extracted?.location || {})}
- Extracted Problem: ${JSON.stringify(context.extracted?.problem || {})}
- Extracted Scheduling: ${JSON.stringify(context.extracted?.scheduling || {})}

FRONTLINE-INTEL SIGNALS:
- Classified Intent: ${intel.intent} (confidence: ${intel.confidence})
- Emergency: ${intel.signals.maybeEmergency ? 'YES' : 'NO'}
- Wrong Number: ${intel.signals.maybeWrongNumber ? 'YES' : 'NO'}
- Spam: ${intel.signals.maybeSpam ? 'YES' : 'NO'}

AVAILABLE ACTIONS:
- ask_question: Need more info from caller
- confirm_info: Verify what we have so far
- answer_with_knowledge: Simple factual answer (hours, location, etc)
- initiate_booking: We have enough info to book
- update_booking: Caller wants to change existing appointment
- escalate_to_human: Beyond our capability
- small_talk: Acknowledge greeting/pleasantry
- close_call: End call (wrong number, spam, resolved)
- clarify_intent: Unclear what caller wants
- no_op: Nothing to do (system message, etc)

BOOKING REQUIREMENTS (all must be present to set readyToBook = true):
1. Contact name
2. Contact phone (or extracted from caller ID)
3. Service address (at least addressLine1 and city/state or zip)
4. Problem summary (what's wrong / what service needed)
5. Time preference (even if vague like "tomorrow" or "asap")

INSTRUCTIONS:
- If intel shows wrong_number or spam → action: "close_call" with polite exit
- If emergency signals → extract urgency, prioritize ASAP scheduling
- If missing booking requirements → action: "ask_question" for what's needed
- If all requirements met → set readyToBook: true, action: "initiate_booking"
- Keep nextPrompt natural, helpful, brief (1-2 sentences max)
- Extract data from what caller said into updates.extracted structure
- Use variables from company config when mentioning company info

⚠️ CRITICAL GUARDRAILS - YOU MUST NOT:
- Invent or quote prices, fees, or costs unless explicitly provided in company variables
- Promise specific arrival times or dispatch windows not in config
- Claim 24/7 service, emergency response, or capabilities not in config
- Answer legal, medical, or financial questions (use escalate_to_human instead)
- Make up company policies, warranties, or guarantees
- If caller asks about pricing and no price variables exist → action: "escalate_to_human"
- If caller asks about availability/hours and not in config → action: "escalate_to_human"

COMPANY VARIABLES (use these in responses):
${Object.entries(config.variables.values || {}).slice(0, 10).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

RESPONSE JSON SCHEMA (respond ONLY with this JSON, nothing else):
{
  "action": "ask_question|confirm_info|answer_with_knowledge|initiate_booking|update_booking|escalate_to_human|small_talk|close_call|clarify_intent|no_op",
  "nextPrompt": "what to say back to caller",
  "updatedIntent": "booking|troubleshooting|info|billing|emergency|update_appointment|wrong_number|spam|other" or null,
  "updates": {
    "extracted": {
      "contact": { "name": "...", "phone": "...", "email": "..." },
      "location": { "addressLine1": "...", "city": "...", "state": "...", "zip": "..." },
      "problem": { "summary": "...", "category": "...", "urgency": "normal|high|emergency" },
      "scheduling": { "preferredDate": "...", "preferredWindow": "..." },
      "access": { "gateCode": "...", "notes": "..." }
    },
    "flags": {
      "readyToBook": false,
      "needsKnowledgeSearch": false,
      "wantsHuman": false
    }
  },
  "knowledgeQuery": null,
  "debugNotes": "brief internal reasoning"
}`;

  // Build user message with recent transcript
  const recentTurns = context.transcript.slice(-3);
  const transcriptSummary = recentTurns
    .map(t => `${t.role}: ${t.text}`)
    .join('\n');
  
  const userPrompt = `CALLER JUST SAID: "${cleanedText}"

RECENT CONVERSATION:
${transcriptSummary}

Based on this, decide the next action and extract any new information. Return ONLY valid JSON.`;

  return {
    system: systemPrompt,
    user: userPrompt
  };
}

/**
 * Call LLM-0 for orchestrator decision
 * @param {{system: string, user: string}} prompt
 * @param {{companyId: string, callId: string}} metadata
 * @returns {Promise<import('../core/orchestrationTypes').OrchestratorDecision>}
 */
async function callLLM0(prompt, metadata) {
  if (!openaiClient) {
    throw new Error('OpenAI client not initialized - check OPENAI_API_KEY');
  }
  
  const startTime = Date.now();
  
  try {
    const response = await openaiClient.chat.completions.create({
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      temperature: 0.2, // Low temp for consistency
      max_tokens: 800,
      messages: [
        { role: 'system', content: prompt.system },
        { role: 'user', content: prompt.user }
      ]
    });
    
    const duration = Date.now() - startTime;
    const rawResponse = response.choices[0].message.content;
    
    logger.debug('[ORCHESTRATOR] LLM-0 raw response', {
      durationMs: duration,
      tokensUsed: response.usage?.total_tokens,
      responseLength: rawResponse.length
    });
    
    // Parse JSON response
    let decision;
    
    try {
      // Try to extract JSON from response (might have markdown formatting)
      const jsonMatch = rawResponse.match(/```json\s*([\s\S]*?)\s*```/) || 
                       rawResponse.match(/\{[\s\S]*\}/);
      
      const jsonString = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawResponse;
      decision = JSON.parse(jsonString);
      
    } catch (parseError) {
      // PRODUCTION HARDENING: Secure logging of parse errors
      logger.error('[ORCHESTRATOR] Failed to parse LLM-0 response as JSON', {
        error: parseError.message,
        rawResponse: rawResponse.substring(0, 500),
        companyId: metadata.companyId,
        callId: metadata.callId
      });
      
      // Log full response to secure channel for debugging (truncated to avoid massive logs)
      logger.error('[ORCHESTRATOR] Full LLM response (parse failure)', {
        companyId: metadata.companyId,
        callId: metadata.callId,
        fullResponse: rawResponse.substring(0, 2000), // Max 2000 chars
        responseLength: rawResponse.length
      });
      
      throw new Error('LLM response not valid JSON');
    }
    
    // Validate decision structure - required fields
    if (!decision.action || !decision.nextPrompt) {
      logger.error('[ORCHESTRATOR] LLM-0 response missing required fields', {
        hasAction: !!decision.action,
        hasNextPrompt: !!decision.nextPrompt,
        companyId: metadata.companyId,
        callId: metadata.callId,
        decision: JSON.stringify(decision).substring(0, 500)
      });
      
      throw new Error('LLM response missing required fields');
    }
    
    // PRODUCTION HARDENING: Normalize missing optional fields to prevent undefined errors
    if (!decision.updates) {
      decision.updates = { extracted: {}, flags: {} };
    }
    if (!decision.updates.extracted) {
      decision.updates.extracted = {};
    }
    if (!decision.updates.flags) {
      decision.updates.flags = { readyToBook: false, needsKnowledgeSearch: false, wantsHuman: false };
    }
    
    return decision;
    
  } catch (error) {
    logger.error('[ORCHESTRATOR] LLM-0 call failed', {
      error: error.message,
      companyId: metadata.companyId,
      callId: metadata.callId,
      durationMs: Date.now() - startTime
    });
    
    throw error;
  }
}

/**
 * Enforce guardrails on LLM decision to prevent price/promise violations
 * PRODUCTION HARDENING: Prevent LLM from making up prices, promises, or capabilities
 * @param {import('../core/orchestrationTypes').OrchestratorDecision} decision
 * @param {Object} config - Company runtime config
 * @returns {import('../core/orchestrationTypes').OrchestratorDecision}
 */
function enforceGuardrails(decision, config) {
  // Skip guardrails for safe actions
  const safeActions = ['close_call', 'escalate_to_human', 'no_op', 'small_talk', 'clarify_intent'];
  if (safeActions.includes(decision.action)) {
    return decision;
  }
  
  const prompt = decision.nextPrompt || '';
  const promptLower = prompt.toLowerCase();
  
  // Check for price/cost language
  const priceKeywords = ['$', 'dollar', 'cost', 'price', 'fee', 'charge', 'estimate', 'quote'];
  const hasPriceLanguage = priceKeywords.some(keyword => promptLower.includes(keyword));
  
  // Check if company has price-related variables
  const hasPriceVariables = config.variables && config.variables.values && 
    Object.keys(config.variables.values).some(key => 
      key.toLowerCase().includes('price') || 
      key.toLowerCase().includes('cost') || 
      key.toLowerCase().includes('fee') ||
      key.toLowerCase().includes('rate')
    );
  
  // GUARDRAIL: If LLM used price language without price variables → escalate
  if (hasPriceLanguage && !hasPriceVariables && decision.action === 'answer_with_knowledge') {
    logger.warn('[ORCHESTRATOR] Guardrail triggered: price language without config', {
      originalAction: decision.action,
      originalPrompt: prompt.substring(0, 100)
    });
    
    return {
      action: 'escalate_to_human',
      nextPrompt: "For exact pricing and service details, let me connect you with someone from the office who can go over all the options with you.",
      updatedIntent: decision.updatedIntent,
      updates: decision.updates || { extracted: {}, flags: { readyToBook: false, needsKnowledgeSearch: false, wantsHuman: true } },
      knowledgeQuery: null,
      debugNotes: `guardrail_price_violation: ${decision.debugNotes || ''}`
    };
  }
  
  // Check for time/availability promises
  const timePromiseKeywords = ['we\'ll be there', 'arrive', 'technician will come', 'dispatch', 'on our way'];
  const hasTimePromise = timePromiseKeywords.some(keyword => promptLower.includes(keyword));
  
  // GUARDRAIL: Don't let LLM promise specific times without booking
  if (hasTimePromise && decision.action !== 'initiate_booking') {
    logger.warn('[ORCHESTRATOR] Guardrail triggered: time promise without booking', {
      originalAction: decision.action,
      originalPrompt: prompt.substring(0, 100)
    });
    
    // Soften the language
    decision.nextPrompt = decision.nextPrompt.replace(/we'?ll be there/gi, 'we can schedule')
      .replace(/technician will come/gi, 'technician can come')
      .replace(/arrive/gi, 'schedule');
  }
  
  // Check for capability claims (24/7, emergency, etc.)
  const capabilityKeywords = ['24/7', 'twenty four seven', 'always available', 'emergency service'];
  const hasCapabilityClaim = capabilityKeywords.some(keyword => promptLower.includes(keyword));
  
  // GUARDRAIL: Don't claim capabilities not in config
  if (hasCapabilityClaim) {
    const hasEmergencyConfig = config.intelligence?.enabled && 
                               config.readiness?.canGoLive;
    
    if (!hasEmergencyConfig) {
      logger.warn('[ORCHESTRATOR] Guardrail triggered: capability claim without config', {
        originalAction: decision.action,
        originalPrompt: prompt.substring(0, 100)
      });
      
      // Remove capability claims
      decision.nextPrompt = decision.nextPrompt
        .replace(/24\/7|twenty four seven|always available/gi, 'during business hours')
        .replace(/emergency service/gi, 'service');
    }
  }
  
  return decision;
}

/**
 * Build fallback decision when LLM fails
 * @param {Object} intel - Frontline-Intel result
 * @param {Object} ctx - Current context
 * @returns {import('../core/orchestrationTypes').OrchestratorDecision}
 */
function buildFallbackDecision(intel, ctx) {
  // Handle special cases first
  if (intel.intent === 'wrong_number' || intel.intent === 'spam') {
    return {
      action: 'close_call',
      nextPrompt: "Thank you for your call. Have a great day!",
      updatedIntent: intel.intent,
      updates: {
        extracted: {},
        flags: {
          readyToBook: false,
          needsKnowledgeSearch: false,
          wantsHuman: false
        }
      },
      knowledgeQuery: null,
      debugNotes: 'fallback_decision_wrong_number_or_spam'
    };
  }
  
  if (intel.intent === 'emergency') {
    return {
      action: 'ask_question',
      nextPrompt: "I understand this is urgent. I need your name, address, and a brief description of the emergency so I can get someone to you right away.",
      updatedIntent: 'emergency',
      updates: {
        extracted: {
          problem: {
            urgency: 'emergency'
          }
        },
        flags: {
          readyToBook: false,
          needsKnowledgeSearch: false,
          wantsHuman: false
        }
      },
      knowledgeQuery: null,
      debugNotes: 'fallback_decision_emergency'
    };
  }
  
  // Default fallback - ask for basic info
  return {
    action: 'ask_question',
    nextPrompt: "I'm here to help. Can you please tell me your name and what you need assistance with?",
    updatedIntent: intel.intent || ctx.currentIntent || 'other',
    updates: {
      extracted: {},
      flags: {
        readyToBook: false,
        needsKnowledgeSearch: false,
        wantsHuman: false
      }
    },
    knowledgeQuery: null,
    debugNotes: 'fallback_decision_generic'
  };
}

/**
 * Merge extracted context (deep merge with preference to new data)
 * @param {Object} existing - Existing extracted context
 * @param {Object} updates - New extracted context
 * @returns {Object} Merged context
 */
function mergeExtractedContext(existing = {}, updates = {}) {
  return {
    contact: {
      ...(existing.contact || {}),
      ...(updates.contact || {})
    },
    location: {
      ...(existing.location || {}),
      ...(updates.location || {})
    },
    problem: {
      ...(existing.problem || {}),
      ...(updates.problem || {})
    },
    scheduling: {
      ...(existing.scheduling || {}),
      ...(updates.scheduling || {})
    },
    access: {
      ...(existing.access || {}),
      ...(updates.access || {})
    },
    meta: {
      ...(existing.meta || {}),
      ...(updates.meta || {})
    }
  };
}

/**
 * Build booking confirmation prompt
 * @param {Object} appointment - Created appointment
 * @param {Object} extracted - Extracted context
 * @param {Object} config - Company config
 * @returns {string} Confirmation message
 */
function buildBookingConfirmationPrompt(appointment, extracted, config) {
  const companyName = config.name || 'we';
  const date = appointment.scheduledDate || 'soon';
  const window = appointment.timeWindow || 'during your preferred time';
  const address = extracted.location?.addressLine1 || 'your location';
  
  return `Perfect! ${companyName} has you scheduled for ${date} ${window}. A technician will come to ${address}. You'll receive a confirmation shortly. Is there anything else I can help you with?`;
}

module.exports = {
  processCallerTurn
};

