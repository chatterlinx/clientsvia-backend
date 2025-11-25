/**
 * ============================================================================
 * PLATFORM CONTRACTS V2.0 - LOCKED SPECIFICATION
 * ============================================================================
 * 
 * These TypeScript interfaces define the EXACT data shapes that all platform
 * components must follow. DO NOT DRIFT from these specs.
 * 
 * Last Updated: November 25, 2025
 * Status: LOCKED - Changes require documented approval
 * 
 * ============================================================================
 */

import { z } from 'zod';

// ============================================================================
// CONTRACT 1: FRONTLINE-INTEL OUTPUT
// ============================================================================

/**
 * Result from Frontline-Intel cheap classifier
 * File: src/services/frontlineIntelService.js
 * Function: classifyFrontlineIntent()
 */
export interface FrontlineIntelResult {
  // Primary classification
  intent: 'booking' | 'troubleshooting' | 'info' | 'billing' | 
          'emergency' | 'update_appointment' | 'wrong_number' | 
          'spam' | 'other';
  
  // Confidence score (0.0 - 1.0)
  confidence: number;
  
  // Boolean signals for LLM-0
  signals: {
    urgent: boolean;
    bookingIntent: 'high' | 'low' | 'none';
    hasQuestions: boolean;
    maybeWrongNumber: boolean;
    maybeSpam: boolean;
    mentionsCompetitor: boolean;
    mentionsPricing: boolean;
    mentionsEmergency: boolean;
  };
  
  // Detected entities (optional)
  entities: {
    phoneNumbers: string[];
    addresses: string[];
    dates: string[];
    names: string[];
  };
  
  // Processing metadata
  metadata: {
    matchedRules: string[];
    processingTimeMs: number;
    fillerWordsRemoved: string[];
  };
}

// Zod schema for runtime validation
export const FrontlineIntelResultSchema = z.object({
  intent: z.enum(['booking', 'troubleshooting', 'info', 'billing', 'emergency', 'update_appointment', 'wrong_number', 'spam', 'other']),
  confidence: z.number().min(0).max(1),
  signals: z.object({
    urgent: z.boolean(),
    bookingIntent: z.enum(['high', 'low', 'none']),
    hasQuestions: z.boolean(),
    maybeWrongNumber: z.boolean(),
    maybeSpam: z.boolean(),
    mentionsCompetitor: z.boolean(),
    mentionsPricing: z.boolean(),
    mentionsEmergency: z.boolean()
  }),
  entities: z.object({
    phoneNumbers: z.array(z.string()),
    addresses: z.array(z.string()),
    dates: z.array(z.string()),
    names: z.array(z.string())
  }),
  metadata: z.object({
    matchedRules: z.array(z.string()),
    processingTimeMs: z.number(),
    fillerWordsRemoved: z.array(z.string())
  })
});

// ============================================================================
// CONTRACT 2: LLM-0 ORCHESTRATOR DECISION
// ============================================================================

/**
 * Decision from LLM-0 master orchestrator
 * File: src/services/orchestrationEngine.js
 * Function: processCallerTurn()
 */
export interface OrchestratorDecision {
  // Primary action to take
  action: 'ask_question' | 'confirm_info' | 'answer_with_knowledge' | 
          'initiate_booking' | 'update_booking' | 'escalate_to_human' | 
          'small_talk' | 'close_call' | 'clarify_intent' | 'no_op';
  
  // What to say to caller (TTS-ready)
  nextPrompt: string;
  
  // Updated intent (if changed, null if same)
  updatedIntent: 'booking' | 'troubleshooting' | 'info' | 'billing' | 
                 'emergency' | 'update_appointment' | 'wrong_number' | 
                 'spam' | 'other' | null;
  
  // Context updates
  updates: {
    // Extracted structured data
    extracted: {
      contact?: {
        name?: string;
        phone?: string;
        email?: string;
      };
      location?: {
        addressLine1?: string;
        addressLine2?: string;
        city?: string;
        state?: string;
        zip?: string;
      };
      problem?: {
        summary?: string;
        category?: string;
        urgency?: 'normal' | 'high' | 'emergency';
      };
      scheduling?: {
        preferredDate?: string;
        preferredWindow?: string;
        flexibilityLevel?: 'flexible' | 'specific' | 'asap';
      };
      access?: {
        gateCode?: string;
        parkingInstructions?: string;
        notes?: string;
      };
    };
    
    // Boolean flags
    flags: {
      readyToBook: boolean;
      needsKnowledgeSearch: boolean;
      wantsHuman: boolean;
      needsCallBack: boolean;
      needsConfirmation: boolean;
    };
  };
  
  // Knowledge query (if needs 3-Tier lookup)
  knowledgeQuery: {
    category: string;
    queryText: string;
    context?: Record<string, any>;
  } | null;
  
  // Internal reasoning (for debugging)
  debugNotes: string;
}

// Zod schema
export const OrchestratorDecisionSchema = z.object({
  action: z.enum(['ask_question', 'confirm_info', 'answer_with_knowledge', 'initiate_booking', 'update_booking', 'escalate_to_human', 'small_talk', 'close_call', 'clarify_intent', 'no_op']),
  nextPrompt: z.string(),
  updatedIntent: z.enum(['booking', 'troubleshooting', 'info', 'billing', 'emergency', 'update_appointment', 'wrong_number', 'spam', 'other']).nullable(),
  updates: z.object({
    extracted: z.object({
      contact: z.object({
        name: z.string().optional(),
        phone: z.string().optional(),
        email: z.string().optional()
      }).optional(),
      location: z.object({
        addressLine1: z.string().optional(),
        addressLine2: z.string().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional()
      }).optional(),
      problem: z.object({
        summary: z.string().optional(),
        category: z.string().optional(),
        urgency: z.enum(['normal', 'high', 'emergency']).optional()
      }).optional(),
      scheduling: z.object({
        preferredDate: z.string().optional(),
        preferredWindow: z.string().optional(),
        flexibilityLevel: z.enum(['flexible', 'specific', 'asap']).optional()
      }).optional(),
      access: z.object({
        gateCode: z.string().optional(),
        parkingInstructions: z.string().optional(),
        notes: z.string().optional()
      }).optional()
    }),
    flags: z.object({
      readyToBook: z.boolean(),
      needsKnowledgeSearch: z.boolean(),
      wantsHuman: z.boolean(),
      needsCallBack: z.boolean(),
      needsConfirmation: z.boolean()
    })
  }),
  knowledgeQuery: z.object({
    category: z.string(),
    queryText: z.string(),
    context: z.record(z.any()).optional()
  }).nullable(),
  debugNotes: z.string()
});

// ============================================================================
// CONTRACT 3: 3-TIER KNOWLEDGE RESULT (THE KEY CONTRACT)
// ============================================================================

/**
 * Result from 3-Tier Knowledge System
 * File: services/IntelligentRouter.js
 * Function: route()
 * 
 * CRITICAL: metadata provides hints to LLM-0, NOT commands
 */
export interface KnowledgeResult {
  // Core response
  text: string;
  confidence: number;
  matched: boolean;
  success: boolean;
  
  // Tier information
  tierUsed: 1 | 2 | 3;
  cost: {
    total: number;
    tier1: number;
    tier2: number;
    tier3: number;
  };
  
  // Matched scenario (if any)
  scenario: {
    scenarioId: string;
    name: string;
    category: string;
    scenarioType?: string;
  } | null;
  
  // 🎯 METADATA HINTS - Guides LLM-0 without controlling it
  metadata: {
    // Scenario classification
    scenarioType?: string;
    suggestedIntent?: string;
    
    // Action hints (NOT commands)
    relatedActions?: string[];
    
    // Follow-up guidance
    requiresFollowUp?: boolean;
    followUpSuggestion?: string;
    
    // Booking eligibility
    bookingEligible?: boolean;
    bookingType?: string;
    
    // Confidence signals
    needsHumanReview?: boolean;
    partialMatch?: boolean;
    
    // Business logic hints
    requiresPricing?: boolean;
    requiresAvailability?: boolean;
    requiresVerification?: boolean;
    
    // Content flags
    containsWarning?: boolean;
    containsLegalInfo?: boolean;
    containsEmergencyInfo?: boolean;
  };
  
  // Performance tracking
  performance: {
    tier1Time?: number;
    tier2Time?: number;
    tier3Time?: number;
    totalTime: number;
  };
  
  // Detailed tier results (debugging)
  tier1Result?: {
    matched: boolean;
    confidence: number;
    matchedRules?: string[];
  };
  tier2Result?: {
    matched: boolean;
    confidence: number;
    topMatches?: Array<{
      scenarioId: string;
      score: number;
    }>;
  };
  tier3Result?: {
    matched: boolean;
    confidence: number;
    llmReasoning?: string;
  };
}

// Zod schema
export const KnowledgeResultSchema = z.object({
  text: z.string(),
  confidence: z.number().min(0).max(1),
  matched: z.boolean(),
  success: z.boolean(),
  tierUsed: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  cost: z.object({
    total: z.number(),
    tier1: z.number(),
    tier2: z.number(),
    tier3: z.number()
  }),
  scenario: z.object({
    scenarioId: z.string(),
    name: z.string(),
    category: z.string(),
    scenarioType: z.string().optional()
  }).nullable(),
  metadata: z.object({
    scenarioType: z.string().optional(),
    suggestedIntent: z.string().optional(),
    relatedActions: z.array(z.string()).optional(),
    requiresFollowUp: z.boolean().optional(),
    followUpSuggestion: z.string().optional(),
    bookingEligible: z.boolean().optional(),
    bookingType: z.string().optional(),
    needsHumanReview: z.boolean().optional(),
    partialMatch: z.boolean().optional(),
    requiresPricing: z.boolean().optional(),
    requiresAvailability: z.boolean().optional(),
    requiresVerification: z.boolean().optional(),
    containsWarning: z.boolean().optional(),
    containsLegalInfo: z.boolean().optional(),
    containsEmergencyInfo: z.boolean().optional()
  }),
  performance: z.object({
    tier1Time: z.number().optional(),
    tier2Time: z.number().optional(),
    tier3Time: z.number().optional(),
    totalTime: z.number()
  }),
  tier1Result: z.object({
    matched: z.boolean(),
    confidence: z.number(),
    matchedRules: z.array(z.string()).optional()
  }).optional(),
  tier2Result: z.object({
    matched: z.boolean(),
    confidence: z.number(),
    topMatches: z.array(z.object({
      scenarioId: z.string(),
      score: z.number()
    })).optional()
  }).optional(),
  tier3Result: z.object({
    matched: z.boolean(),
    confidence: z.number(),
    llmReasoning: z.string().optional()
  }).optional()
});

// ============================================================================
// CONTRACT 4: RESPONSE TRACE LOG
// ============================================================================

/**
 * Full transparency log for each conversation turn
 * Model: models/ResponseTraceLog.js
 * 
 * Records entire decision chain for debugging, compliance, optimization
 */
export interface ResponseTraceLog {
  // Identifiers
  traceId: string;
  callId: string;
  companyId: string;
  turnNumber: number;
  timestamp: Date;
  
  // Input
  input: {
    speaker: 'caller' | 'agent';
    text: string;
    textCleaned: string;
    sttMetadata?: Record<string, any>;
  };
  
  // Step 1: Frontline-Intel
  frontlineIntel: FrontlineIntelResult;
  
  // Step 2: LLM-0 Decision
  orchestratorDecision: OrchestratorDecision;
  
  // Step 3: Knowledge Lookup (if performed)
  knowledgeLookup?: {
    triggered: boolean;
    result: KnowledgeResult | null;
    reason: string;
  };
  
  // Step 4: Booking Action (if performed)
  bookingAction?: {
    triggered: boolean;
    contactId?: string;
    locationId?: string;
    appointmentId?: string;
    result: 'success' | 'failed' | 'partial';
    error?: string;
  };
  
  // Output
  output: {
    agentResponse: string;
    action: string;
    nextState: string;
  };
  
  // Performance
  performance: {
    frontlineIntelMs: number;
    orchestratorMs: number;
    knowledgeLookupMs?: number;
    bookingMs?: number;
    totalMs: number;
  };
  
  // Cost Breakdown
  cost: {
    frontlineIntel: number;
    orchestrator: number;
    knowledgeLookup: number;
    booking: number;
    total: number;
  };
  
  // Context Snapshot (at end of turn)
  contextSnapshot: {
    currentIntent: string;
    extractedData: Record<string, any>;
    conversationLength: number;
    bookingReadiness: boolean;
  };
}

// Zod schema
export const ResponseTraceLogSchema = z.object({
  traceId: z.string(),
  callId: z.string(),
  companyId: z.string(),
  turnNumber: z.number(),
  timestamp: z.date(),
  input: z.object({
    speaker: z.enum(['caller', 'agent']),
    text: z.string(),
    textCleaned: z.string(),
    sttMetadata: z.record(z.any()).optional()
  }),
  frontlineIntel: FrontlineIntelResultSchema,
  orchestratorDecision: OrchestratorDecisionSchema,
  knowledgeLookup: z.object({
    triggered: z.boolean(),
    result: KnowledgeResultSchema.nullable(),
    reason: z.string()
  }).optional(),
  bookingAction: z.object({
    triggered: z.boolean(),
    contactId: z.string().optional(),
    locationId: z.string().optional(),
    appointmentId: z.string().optional(),
    result: z.enum(['success', 'failed', 'partial']),
    error: z.string().optional()
  }).optional(),
  output: z.object({
    agentResponse: z.string(),
    action: z.string(),
    nextState: z.string()
  }),
  performance: z.object({
    frontlineIntelMs: z.number(),
    orchestratorMs: z.number(),
    knowledgeLookupMs: z.number().optional(),
    bookingMs: z.number().optional(),
    totalMs: z.number()
  }),
  cost: z.object({
    frontlineIntel: z.number(),
    orchestrator: z.number(),
    knowledgeLookup: z.number(),
    booking: z.number(),
    total: z.number()
  }),
  contextSnapshot: z.object({
    currentIntent: z.string(),
    extractedData: z.record(z.any()),
    conversationLength: z.number(),
    bookingReadiness: z.boolean()
  })
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Validate any result against its schema
 * Use in dev/test mode to catch drift
 */
export function validateContract<T>(
  data: unknown,
  schema: z.ZodSchema<T>,
  contractName: string
): T {
  try {
    return schema.parse(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      console.error(`❌ [CONTRACT VALIDATION] ${contractName} failed:`, error.errors);
      throw new Error(`Contract violation: ${contractName}`);
    }
    throw error;
  }
}

/**
 * Usage examples:
 * 
 * // Validate Frontline-Intel output
 * const intel = classifyFrontlineIntent(...);
 * validateContract(intel, FrontlineIntelResultSchema, 'FrontlineIntelResult');
 * 
 * // Validate Orchestrator decision
 * const decision = await processCallerTurn(...);
 * validateContract(decision, OrchestratorDecisionSchema, 'OrchestratorDecision');
 * 
 * // Validate Knowledge result
 * const knowledge = await router.route(...);
 * validateContract(knowledge, KnowledgeResultSchema, 'KnowledgeResult');
 */

// ============================================================================
// EXPORTS
// ============================================================================

export default {
  FrontlineIntelResultSchema,
  OrchestratorDecisionSchema,
  KnowledgeResultSchema,
  ResponseTraceLogSchema,
  validateContract
};

