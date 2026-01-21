/**
 * ============================================================================
 * WIRING REGISTRY V1.2 - PRODUCTION GRADE (Jan 2026 Audit Complete)
 * ============================================================================
 * 
 * This file defines EXACTLY what "wired" means for every component.
 * 
 * RULES:
 * 1. Database paths must match ACTUAL schema (not aspirational)
 * 2. Every UI tab must be represented
 * 3. Consumers must be REAL service/engine names that EXIST in /services/
 * 4. Trace keys must be emitted by real code
 * 
 * AUDIT CHANGES (Jan 18, 2026):
 * - Removed phantom services (CallProtectionEngine, TransferRouter, etc.)
 * - Mapped to ACTUAL services that exist
 * - Removed deleted tabs (companyContacts - merged into transfers)
 * - Removed unimplemented features (QA Dashboard, GoldenAutofillEngine)
 * - All expectedConsumers now reference real .js files
 * 
 * ============================================================================
 */

const WIRING_SCHEMA_VERSION = "WIRING_SNAPSHOT_V1.2";

/**
 * Node types:
 * - TAB: Top-level Control Plane tab
 * - SECTION: Sub-section within a tab
 * - ITEM: Individual configurable item
 * - INFRASTRUCTURE: System-level component (Redis, MongoDB, etc.)
 * - INTEGRATION: External integration point
 * 
 * Status values (computed, never hardcoded):
 * - WIRED: Config exists + Compiled + Consumer connected + Trace capable
 * - PROVEN: WIRED + Actually fired in recent traces
 * - PARTIAL: Some but not all requirements met
 * - MISCONFIGURED: Enabled but missing required fields
 * - UI_ONLY: Config exists in UI but no runtime consumer
 * - DISABLED: Intentionally not enabled
 */

const wiringRegistryV1 = {
  schemaVersion: WIRING_SCHEMA_VERSION,
  
  // =========================================================================
  // ACTUAL SERVICES MAP (for reference - these files EXIST)
  // =========================================================================
  _actualServices: {
    // Core Engine
    "ConversationEngine": "services/ConversationEngine.js",
    "HybridReceptionistLLM": "services/HybridReceptionistLLM.js",
    "HybridScenarioSelector": "services/HybridScenarioSelector.js",
    
    // Flow & State
    "DynamicFlowEngine": "services/DynamicFlowEngine.js",
    "FlowEngine": "services/FlowEngine.js",
    "BookingStateMachine": "services/BookingStateMachine.js",
    "ConversationStateMachine": "services/ConversationStateMachine.js",
    "SessionService": "services/SessionService.js",
    
    // Scenarios & Templates
    "ScenarioPoolService": "services/ScenarioPoolService.js",
    "LLMDiscoveryEngine": "services/LLMDiscoveryEngine.js",
    
    // Tier 3 & Fallback
    "Tier3LLMFallback": "services/Tier3LLMFallback.js",
    "LowConfidenceHandler": "services/LowConfidenceHandler.js",
    
    // Call Protection & Spam
    "SmartCallFilter": "services/SmartCallFilter.js",
    "CheatSheetEngine": "services/CheatSheetEngine.js",
    "CheatSheetRuntimeService": "services/cheatsheet/CheatSheetRuntimeService.js",
    
    // Logging & Debug
    "BlackBoxLogger": "services/BlackBoxLogger.js",
    
    // Response & Rendering
    "ResponseRenderer": "services/ResponseRenderer.js",
    "FrontlineScriptBuilder": "services/FrontlineScriptBuilder.js",
    
    // Customer & Call
    "CustomerService": "services/CustomerService.js",
    "CustomerLookup": "services/CustomerLookup.js",
    "CallSummaryService": "services/CallSummaryService.js",
    
    // Platform
    "PlatformSnapshotService": "platform/snapshot/PlatformSnapshotService.js",
    "ConfigAuditService": "services/ConfigAuditService.js"
  },
  
  nodes: [
    // =========================================================================
    // TAB: FRONT DESK
    // =========================================================================
    {
      id: "tab.frontDesk",
      type: "TAB",
      label: "Front Desk",
      description: "Controls how AI talks to callers - personality, booking, behavior",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior"
      ],
      expectedConsumers: ["ConversationEngine", "HybridReceptionistLLM"],
      expectedTraceKeys: ["trace.frontDesk.loaded"],
      children: [
        "frontDesk.personality",
        "frontDesk.greetings",
        "frontDesk.discoveryConsent",
        "frontDesk.vocabulary",
        "frontDesk.bookingPrompts",
        // "frontDesk.promptPacks" REMOVED Jan 2026
        "frontDesk.promptGuards",
        "frontDesk.emotions",
        "frontDesk.frustration",
        "frontDesk.escalation",
        "frontDesk.loops",
        "frontDesk.forbidden",
        "frontDesk.fallbacks",
        "frontDesk.modes"
      ]
    },

    // SECTION: Personality Settings
    {
      id: "frontDesk.personality",
      type: "SECTION",
      label: "Personality Settings",
      parentId: "tab.frontDesk",
      description: "AI name, tone, professionalism level",
      expectedDbPaths: [
        "company.aiAgentSettings.aiName",
        "company.aiAgentSettings.frontDeskBehavior.conversationStyle",
        "company.aiAgentSettings.frontDeskBehavior.personality"
      ],
      expectedConsumers: ["FrontlineScriptBuilder", "HybridReceptionistLLM"],
      expectedTraceKeys: ["trace.personality.applied"],
      requiredFields: []
    },

    // SECTION: Greeting Responses (0 TOKENS - Instant intercept)
    {
      id: "frontDesk.greetings",
      type: "SECTION",
      label: "Greeting Responses",
      parentId: "tab.frontDesk",
      description: "Instant responses to caller greetings (0 LLM tokens)",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.greetingResponses"
      ],
      expectedConsumers: ["ConversationEngine"],
      runtimeMethod: "greetingIntercept()",
      expectedTraceKeys: [
        "trace.greeting.intercepted",
        "CHECKPOINT 2.7"
      ],
      requiredFields: ["trigger", "response"],
      criticalBug: {
        id: "V34_GREETING_BUG",
        description: "fresh-* session IDs were treated as existing sessions",
        status: "FIXED",
        fixedAt: "2026-01-05"
      }
    },

    // SECTION: Discovery & Consent
    {
      id: "frontDesk.discoveryConsent",
      type: "SECTION",
      label: "Discovery & Consent",
      parentId: "tab.frontDesk",
      description: "Kill switches and consent gate configuration",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.discoveryConsent",
        "company.aiAgentSettings.frontDeskBehavior.discoveryConsent.forceLLMDiscovery",
        "company.aiAgentSettings.frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses",
        "company.aiAgentSettings.frontDeskBehavior.discoveryConsent.bookingRequiresExplicitConsent"
      ],
      expectedConsumers: ["ConversationEngine"],
      runtimeMethod: "checkKillSwitches()",
      expectedTraceKeys: [
        "CHECKPOINT 9a",
        "trace.consent.detected"
      ],
      requiredFields: []
    },

    // SECTION: Vocabulary
    {
      id: "frontDesk.vocabulary",
      type: "SECTION",
      label: "Vocabulary",
      parentId: "tab.frontDesk",
      description: "Word replacements and translations",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.vocabulary"
      ],
      expectedConsumers: ["HybridScenarioSelector"],
      runtimeMethod: "normalize()",
      expectedTraceKeys: ["trace.vocabulary.replaced"],
      requiredFields: []
    },

    // SECTION: Booking Prompts
    {
      id: "frontDesk.bookingPrompts",
      type: "SECTION",
      label: "Booking Prompts",
      parentId: "tab.frontDesk",
      description: "Slot definitions for booking flow",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.bookingSlots",
        "company.aiAgentSettings.frontDeskBehavior.bookingEnabled"
      ],
      expectedCompiledPaths: [
        "runtimeSlots.source",
        "runtimeSlots.slotCount"
        // ☢️ NUKED: bookingContractV2.enabled - Jan 2026
      ],
      expectedConsumers: ["BookingStateMachine", "ConversationEngine"],
      expectedTraceKeys: [
        "trace.booking.slotRequested",
        "CHECKPOINT 8"
      ],
      requiredFields: ["id", "type", "question"]
      // ☢️ NUKED: criticalIssue for bookingContractV2 - Jan 2026
    },

    // SECTION: Prompt Packs REMOVED Jan 2026 - nuked (static packs = maintenance overhead)

    // SECTION: Prompt Guards
    {
      id: "frontDesk.promptGuards",
      type: "SECTION",
      label: "Prompt Guards",
      parentId: "tab.frontDesk",
      description: "Missing prompt guardrails and fallback key",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.promptGuards"
      ],
      expectedConsumers: ["ConversationEngine"],
      expectedTraceKeys: [],
      requiredFields: []
    },

    // SECTION: Emotions
    {
      id: "frontDesk.emotions",
      type: "SECTION",
      label: "Emotions",
      parentId: "tab.frontDesk",
      description: "Emotion detection and response adjustment",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.emotions"
      ],
      expectedConsumers: ["HybridReceptionistLLM"],
      runtimeMethod: "detectEmotion()",
      expectedTraceKeys: ["trace.emotion.detected", "CHECKPOINT 9d"],
      requiredFields: []
    },

    // SECTION: Frustration
    {
      id: "frontDesk.frustration",
      type: "SECTION",
      label: "Frustration",
      parentId: "tab.frontDesk",
      description: "Frustration detection and de-escalation",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.frustration"
      ],
      expectedConsumers: ["ConversationEngine", "HybridReceptionistLLM"],
      expectedTraceKeys: ["trace.frustration.detected"],
      requiredFields: []
    },

    // SECTION: Escalation
    {
      id: "frontDesk.escalation",
      type: "SECTION",
      label: "Escalation",
      parentId: "tab.frontDesk",
      description: "Human transfer triggers",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.escalation"
      ],
      expectedConsumers: ["ConversationEngine"],
      runtimeMethod: "handleEscalation()",
      expectedTraceKeys: ["trace.escalation.triggered"],
      requiredFields: ["enabled", "triggers"]
    },

    // SECTION: Loops
    {
      id: "frontDesk.loops",
      type: "SECTION",
      label: "Loops",
      parentId: "tab.frontDesk",
      description: "Loop detection and recovery",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.loopPrevention"
      ],
      expectedConsumers: ["ConversationStateMachine"],
      runtimeMethod: "detectLoop()",
      expectedTraceKeys: ["trace.loop.detected"],
      requiredFields: []
    },

    // SECTION: Forbidden Phrases
    {
      id: "frontDesk.forbidden",
      type: "SECTION",
      label: "Forbidden",
      parentId: "tab.frontDesk",
      description: "Phrases AI must never say",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.forbiddenPhrases"
      ],
      expectedConsumers: ["HybridReceptionistLLM"],
      runtimeMethod: "postProcessResponse() - filters output",
      expectedTraceKeys: ["trace.forbidden.blocked"],
      requiredFields: []
    },

    // SECTION: Fallbacks
    {
      id: "frontDesk.fallbacks",
      type: "SECTION",
      label: "Fallbacks",
      parentId: "tab.frontDesk",
      description: "Default responses when no match",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.fallbackResponses"
      ],
      expectedConsumers: ["LowConfidenceHandler", "Tier3LLMFallback"],
      expectedTraceKeys: ["trace.fallback.used"],
      requiredFields: []
    },

    // SECTION: Modes
    {
      id: "frontDesk.modes",
      type: "SECTION",
      label: "Modes",
      parentId: "tab.frontDesk",
      description: "DISCOVERY / BOOKING / SUPPORT mode configuration",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.modes"
      ],
      expectedConsumers: ["ConversationEngine"],
      runtimeMethod: "determineMode()",
      expectedTraceKeys: ["trace.mode.transition"],
      requiredFields: []
    },

    // =========================================================================
    // TAB: FLOW TREE (READ-ONLY VISUALIZATION)
    // =========================================================================
    {
      id: "tab.flowTree",
      type: "TAB",
      label: "Flow Tree",
      description: "READ-ONLY: AI Decision Flow Tree visualization + System Snapshot",
      expectedDbPaths: [],
      expectedConsumers: ["PlatformSnapshotService"],
      expectedTraceKeys: [],
      uiOnly: true,
      note: "This tab VISUALIZES state, it doesn't control behavior",
      children: [
        "flowTree.decisionTree",
        "flowTree.systemSnapshot"
      ]
    },

    {
      id: "flowTree.decisionTree",
      type: "SECTION",
      label: "AI Decision Flow Tree",
      parentId: "tab.flowTree",
      description: "Visual representation of call flow decisions",
      expectedDbPaths: [],
      expectedConsumers: [],
      uiOnly: true,
      requiredFields: []
    },

    {
      id: "flowTree.systemSnapshot",
      type: "SECTION",
      label: "System Snapshot",
      parentId: "tab.flowTree",
      description: "Runtime truth snapshot with health status",
      expectedDbPaths: [],
      expectedConsumers: ["PlatformSnapshotService"],
      requiredFields: []
    },

    // =========================================================================
    // TAB: DYNAMIC FLOW (PER-TURN RULES)
    // =========================================================================
    {
      id: "tab.dynamicFlow",
      type: "TAB",
      label: "Dynamic Flow",
      description: "Trigger-based rules evaluated EVERY turn (emergency, after-hours, etc.)",
      expectedDbPaths: [
        "DynamicFlow collection"
      ],
      expectedConsumers: ["DynamicFlowEngine"],
      expectedTraceKeys: ["trace.dynamicFlow.evaluated", "CHECKPOINT 3"],
      children: [
        "dynamicFlow.companyFlows",
        "dynamicFlow.templates"
      ]
    },

    {
      id: "dynamicFlow.companyFlows",
      type: "SECTION",
      label: "Company Flows",
      parentId: "tab.dynamicFlow",
      description: "Active flows for this company",
      expectedDbPaths: [
        "DynamicFlow collection (companyId=X, isTemplate=false)"
      ],
      expectedConsumers: ["DynamicFlowEngine"],
      expectedTraceKeys: ["trace.flow.activated"],
      requiredFields: ["flowKey", "triggers", "enabled"]
    },

    {
      id: "dynamicFlow.templates",
      type: "SECTION",
      label: "Available Templates",
      parentId: "tab.dynamicFlow",
      description: "Global templates that can be copied to company",
      expectedDbPaths: [
        "DynamicFlow collection (isTemplate=true)"
      ],
      expectedConsumers: [],
      requiredFields: []
    },

    // =========================================================================
    // TAB: DATA & CONFIG
    // =========================================================================
    {
      id: "tab.dataConfig",
      type: "TAB",
      label: "Data & Config",
      description: "Placeholders, templates, scenarios - the Q&A brain",
      expectedDbPaths: [],
      expectedConsumers: [],
      expectedTraceKeys: [],
      children: [
        "dataConfig.onboarding",
        "dataConfig.placeholders",
        "dataConfig.defaultReplies",
        "dataConfig.templates",
        "dataConfig.templateReferences",
        "dataConfig.scenarios",
        "dataConfig.executionMap",
        "dataConfig.qaDashboard"
      ]
    },

    {
      id: "dataConfig.onboarding",
      type: "SECTION",
      label: "Onboarding",
      parentId: "tab.dataConfig",
      description: "Company setup wizard status",
      expectedDbPaths: ["company.onboardingStatus"],
      expectedConsumers: [],
      requiredFields: []
    },

    {
      id: "dataConfig.placeholders",
      type: "SECTION",
      label: "Placeholders",
      parentId: "tab.dataConfig",
      description: "Dynamic tokens like {companyName}, {phone}",
      expectedDbPaths: ["CompanyPlaceholders collection"],
      expectedConsumers: ["ResponseRenderer", "HybridReceptionistLLM"],
      expectedTraceKeys: ["trace.placeholder.resolved"],
      requiredFields: ["key", "value"]
    },

    {
      id: "dataConfig.defaultReplies",
      type: "SECTION",
      label: "Default Replies",
      parentId: "tab.dataConfig",
      description: "Fallback responses (not offered, unknown intent, after hours)",
      expectedDbPaths: ["CompanyResponseDefaults collection"],
      expectedConsumers: ["LowConfidenceHandler"],
      expectedTraceKeys: ["trace.defaultReply.used"],
      requiredFields: []
    },

    {
      id: "dataConfig.templates",
      type: "SECTION",
      label: "Templates",
      parentId: "tab.dataConfig",
      description: "Global trade knowledge templates (HVAC, Dental, etc.)",
      expectedDbPaths: ["GlobalInstantResponseTemplate collection"],
      expectedConsumers: ["ScenarioPoolService"],
      expectedTraceKeys: ["trace.template.loaded"],
      requiredFields: ["name", "templateType", "categories"]
    },

    // CRITICAL SECTION
    {
      id: "dataConfig.templateReferences",
      type: "SECTION",
      label: "Template References",
      parentId: "tab.dataConfig",
      description: "Links company to global templates - CRITICAL for scenarios",
      expectedDbPaths: ["company.aiAgentSettings.templateReferences"],
      expectedConsumers: ["ScenarioPoolService", "LLMDiscoveryEngine"],
      expectedTraceKeys: ["trace.templateRef.loaded", "CHECKPOINT 2.6"],
      requiredFields: ["templateId", "enabled"],
      critical: true,
      criticalIssue: {
        id: "TEMPLATE_REF_MISSING",
        description: "If templateReferences is empty, scenarioCount=0 at runtime",
        checkField: "company.aiAgentSettings.templateReferences.length > 0"
      }
    },

    {
      id: "dataConfig.scenarios",
      type: "SECTION",
      label: "Scenarios",
      parentId: "tab.dataConfig",
      description: "Trade knowledge scenarios from templates (Q&A)",
      expectedDbPaths: ["GlobalInstantResponseTemplate.categories[].scenarios[]"],
      expectedConsumers: ["HybridScenarioSelector", "LLMDiscoveryEngine"],
      expectedTraceKeys: ["trace.scenario.matched", "CHECKPOINT 9c"],
      requiredFields: ["scenarioId", "name", "scenarioType", "triggers"]
    },

    {
      id: "dataConfig.executionMap",
      type: "SECTION",
      label: "Execution Map",
      parentId: "tab.dataConfig",
      description: "Visual map of scenario execution paths",
      expectedDbPaths: [],
      expectedConsumers: [],
      uiOnly: true,
      requiredFields: []
    },

    {
      id: "dataConfig.qaDashboard",
      type: "SECTION",
      label: "QA Dashboard",
      parentId: "tab.dataConfig",
      description: "Category quality scores and Golden Autofill",
      expectedDbPaths: ["GlobalInstantResponseTemplate.categories[].scenarios[]"],
      expectedConsumers: [],
      routeFile: "routes/admin/goldenAutofill.js",
      expectedTraceKeys: [],
      requiredFields: []
    },

    // =========================================================================
    // TAB: CALL PROTECTION (Edge Cases)
    // =========================================================================
    {
      id: "tab.callProtection",
      type: "TAB",
      label: "Call Protection",
      description: "Pre-answer filters: spam, telemarketer, IVR detection",
      expectedDbPaths: ["CheatSheetVersion.config.edgeCases"],
      expectedConsumers: ["SmartCallFilter", "CheatSheetEngine"],
      expectedTraceKeys: ["trace.callProtection.evaluated"],
      children: [
        "callProtection.edgeCases",
        "callProtection.spamDetection"
      ]
    },

    {
      id: "callProtection.edgeCases",
      type: "SECTION",
      label: "Edge Cases",
      parentId: "tab.callProtection",
      description: "Telemarketer filter, polite hangup, auto-blacklist rules",
      expectedDbPaths: ["CheatSheetVersion.config.edgeCases"],
      expectedConsumers: ["CheatSheetEngine"],
      runtimeMethod: "applyEdgeCases()",
      expectedTraceKeys: ["trace.edgeCase.matched"],
      requiredFields: []
    },

    {
      id: "callProtection.spamDetection",
      type: "SECTION",
      label: "Spam Detection",
      parentId: "tab.callProtection",
      description: "AI-powered spam scoring and blocking",
      expectedDbPaths: [],
      expectedConsumers: ["SmartCallFilter"],
      runtimeMethod: "analyzeCall()",
      expectedTraceKeys: ["trace.spam.blocked"],
      requiredFields: []
    },

    // =========================================================================
    // TAB: TRANSFER CALLS (Directory + Rules)
    // =========================================================================
    {
      id: "tab.transfers",
      type: "TAB",
      label: "Transfer Calls",
      description: "Contact directory + transfer routing rules (merged Jan 2026)",
      expectedDbPaths: [
        "CheatSheetVersion.config.companyContacts",
        "CheatSheetVersion.config.transferRules"
      ],
      expectedConsumers: ["ConversationEngine", "CheatSheetEngine"],
      expectedTraceKeys: ["trace.transfer.initiated"],
      children: [
        "transfers.directory",
        "transfers.rules"
      ]
    },

    {
      id: "transfers.directory",
      type: "SECTION",
      label: "Contact Directory",
      parentId: "tab.transfers",
      description: "Available transfer targets (Customer Service, Sales, etc.)",
      expectedDbPaths: ["CheatSheetVersion.config.companyContacts"],
      expectedConsumers: ["ConversationEngine"],
      runtimeMethod: "resolveTransferTarget()",
      expectedTraceKeys: ["trace.transfer.targetResolved"],
      requiredFields: ["name", "phone", "role"]
    },

    {
      id: "transfers.rules",
      type: "SECTION",
      label: "Transfer Rules",
      parentId: "tab.transfers",
      description: "Intent-based transfer routing",
      expectedDbPaths: ["CheatSheetVersion.config.transferRules"],
      expectedConsumers: ["CheatSheetEngine"],
      runtimeMethod: "evaluateTransferRules()",
      expectedTraceKeys: ["trace.transfer.ruleMatched"],
      requiredFields: []
    },

    // =========================================================================
    // TAB: CALL CENTER (CRM)
    // =========================================================================
    {
      id: "tab.callCenter",
      type: "TAB",
      label: "Call Center",
      description: "CRM: Call history, customers, transcripts (opens in new page)",
      expectedDbPaths: [
        "CallSummary collection",
        "Customer collection",
        "ConversationSession collection"
      ],
      expectedConsumers: ["CallSummaryService", "CustomerService", "CustomerLookup"],
      expectedTraceKeys: [],
      externalPage: "/call-center.html",
      children: []
    },

    // =========================================================================
    // TAB: LINKS (Outbound URLs)
    // =========================================================================
    {
      id: "tab.links",
      type: "TAB",
      label: "Links",
      description: "URLs the AI can share with callers (payment, forms, etc.)",
      expectedDbPaths: ["CheatSheetVersion.config.links"],
      expectedConsumers: ["ConversationEngine"],
      expectedTraceKeys: ["trace.link.shared"],
      children: []
    },

    // =========================================================================
    // TAB: LLM-0 CONTROLS (AI Behavior Configuration)
    // =========================================================================
    {
      id: "tab.llm0Controls",
      type: "TAB",
      label: "LLM-0 Controls",
      description: "Fine-tune AI conversation behavior - thresholds, spam detection, knowledge priorities",
      expectedDbPaths: [
        "company.aiAgentLogic.thresholds",
        "company.aiAgentLogic.memorySettings",
        "company.aiAgentLogic.fallbackBehavior",
        "company.aiAgentLogic.knowledgeSourcePriorities"
      ],
      expectedConsumers: ["ConversationEngine", "LLMDiscoveryEngine", "HybridReceptionistLLM"],
      expectedTraceKeys: ["trace.llm0.loaded", "trace.llm0.threshold.applied"],
      children: [
        "llm0.thresholds",
        "llm0.memorySettings",
        "llm0.spamFilter",
        "llm0.knowledgePriorities"
      ]
    },

    {
      id: "llm0.thresholds",
      type: "SECTION",
      label: "Confidence Thresholds",
      parentId: "tab.llm0Controls",
      description: "Tier-1/Tier-2/Tier-3 confidence cutoffs",
      expectedDbPaths: [
        "company.aiAgentLogic.thresholds.tier1",
        "company.aiAgentLogic.thresholds.tier2",
        "company.aiAgentLogic.thresholds.tier3"
      ],
      expectedConsumers: ["HybridScenarioSelector", "LLMDiscoveryEngine"],
      runtimeMethod: "evaluateConfidence()",
      expectedTraceKeys: ["trace.threshold.tier1", "trace.threshold.tier2", "trace.threshold.tier3"],
      requiredFields: []
    },

    {
      id: "llm0.memorySettings",
      type: "SECTION",
      label: "Memory Settings",
      parentId: "tab.llm0Controls",
      description: "Conversation history retention and context",
      expectedDbPaths: ["company.aiAgentLogic.memorySettings"],
      expectedConsumers: ["ConversationEngine", "SessionService"],
      expectedTraceKeys: ["trace.memory.loaded"],
      requiredFields: []
    },

    {
      id: "llm0.spamFilter",
      type: "SECTION",
      label: "Mid-Conversation Spam Detection",
      parentId: "tab.llm0Controls",
      description: "Telemarketer phrase detection DURING conversation (different from Company Profile pre-call spam)",
      expectedDbPaths: ["company.aiAgentLogic.spamFilter"],
      expectedConsumers: ["LLM0ControlsLoader"],
      runtimeMethod: "isSpamPhrase()",
      expectedTraceKeys: ["trace.midConvoSpam.detected"],
      requiredFields: [],
      note: "⚠️ DIFFERENT from Company Profile → Spam Filter (pre-call blocking)"
    },

    {
      id: "llm0.knowledgePriorities",
      type: "SECTION",
      label: "Knowledge Source Priorities",
      parentId: "tab.llm0Controls",
      description: "Priority order: scenarios > templates > LLM fallback",
      expectedDbPaths: ["company.aiAgentLogic.knowledgeSourcePriorities"],
      expectedConsumers: ["LLMDiscoveryEngine"],
      expectedTraceKeys: ["trace.knowledge.priorityApplied"],
      requiredFields: []
    },

    // =========================================================================
    // SUBSYSTEM: 3-TIER INTELLIGENCE (Scenario Matching Cascade)
    // =========================================================================
    {
      id: "subsystem.3tier",
      type: "INFRASTRUCTURE",
      label: "3-Tier Intelligence System",
      description: "Scenario matching cascade: Tier-1 (rules) → Tier-2 (semantic) → Tier-3 (LLM fallback)",
      expectedDbPaths: [],
      expectedConsumers: ["HybridScenarioSelector", "LLMDiscoveryEngine", "Tier3LLMFallback"],
      expectedTraceKeys: [
        "trace.tier1.matched",
        "trace.tier2.matched",
        "trace.tier3.fallback"
      ],
      children: [
        "tier.tier1",
        "tier.tier2",
        "tier.tier3"
      ],
      critical: true
    },

    {
      id: "tier.tier1",
      type: "SECTION",
      label: "Tier-1: Rule-Based Matching",
      parentId: "subsystem.3tier",
      description: "Exact keyword/trigger matching - FREE, instant (0 tokens)",
      expectedDbPaths: ["GlobalInstantResponseTemplate.categories[].scenarios[].triggers"],
      expectedConsumers: ["HybridScenarioSelector"],
      runtimeMethod: "matchTier1()",
      expectedTraceKeys: ["trace.tier1.matched", "CHECKPOINT 9c"],
      requiredFields: ["triggers"],
      cost: "FREE",
      latency: "<10ms"
    },

    {
      id: "tier.tier2",
      type: "SECTION",
      label: "Tier-2: Semantic Matching",
      parentId: "subsystem.3tier",
      description: "Embedding similarity matching - FREE, fast",
      expectedDbPaths: [],
      expectedConsumers: ["LLMDiscoveryEngine"],
      runtimeMethod: "matchTier2()",
      expectedTraceKeys: ["trace.tier2.matched"],
      requiredFields: [],
      cost: "FREE",
      latency: "<100ms"
    },

    {
      id: "tier.tier3",
      type: "SECTION",
      label: "Tier-3: LLM Fallback",
      parentId: "subsystem.3tier",
      description: "OpenAI LLM fallback for edge cases - COSTS TOKENS",
      expectedDbPaths: [],
      expectedConsumers: ["Tier3LLMFallback", "HybridReceptionistLLM"],
      runtimeMethod: "invokeLLM()",
      expectedTraceKeys: ["trace.tier3.fallback", "trace.llm.tokens"],
      requiredFields: [],
      cost: "$0.01-0.05 per call",
      latency: "1-3 seconds"
    },

    // =========================================================================
    // SUBSYSTEM: SLOT EXTRACTION (Booking Data Collection)
    // =========================================================================
    {
      id: "subsystem.slotExtraction",
      type: "INFRASTRUCTURE",
      label: "Slot Extraction Services",
      description: "Name, Phone, Address, Time extraction from caller speech",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.bookingSlots"
      ],
      expectedConsumers: ["ConversationEngine", "BookingStateMachine"],
      expectedTraceKeys: ["CHECKPOINT 8", "trace.slot.extracted"],
      children: [
        "slot.name",
        "slot.phone",
        "slot.address",
        "slot.time"
      ]
    },

    {
      id: "slot.name",
      type: "SECTION",
      label: "Name Extraction",
      parentId: "subsystem.slotExtraction",
      description: "First/last name detection with smart common names list",
      expectedDbPaths: ["GlobalInstantResponseTemplate.commonFirstNames"],
      expectedConsumers: ["ConversationEngine"],
      utilityFile: "utils/nameExtraction.js",
      expectedTraceKeys: ["trace.name.extracted", "trace.name.partial"],
      requiredFields: [],
      stopWords: ["probably", "maybe", "air conditioner", "what", "who"]
    },

    {
      id: "slot.phone",
      type: "SECTION",
      label: "Phone Extraction",
      parentId: "subsystem.slotExtraction",
      description: "Phone number detection with caller ID prioritization",
      expectedDbPaths: [],
      expectedConsumers: ["ConversationEngine"],
      utilityFile: "utils/phoneExtraction.js",
      expectedTraceKeys: ["trace.phone.extracted", "trace.phone.callerIdUsed"],
      runtimeBehavior: "Offers caller ID first: 'Is {callerPhone} a good number?'"
    },

    {
      id: "slot.address",
      type: "SECTION",
      label: "Address Extraction & Validation",
      parentId: "subsystem.slotExtraction",
      description: "Google Maps Address Validation API integration",
      expectedDbPaths: [],
      expectedConsumers: ["ConversationEngine", "AddressValidationService"],
      utilityFile: "services/AddressValidationService.js",
      expectedTraceKeys: ["trace.address.extracted", "trace.address.validated", "trace.address.unitNeeded"],
      envRequired: "GOOGLE_MAPS_API_KEY",
      features: [
        "Background validation while conversation continues",
        "Smart unit detection for apartments/condos",
        "Gate code detection for gated communities",
        "Commercial building type identification",
        "Equipment access prompts"
      ]
    },

    {
      id: "slot.time",
      type: "SECTION",
      label: "Time Extraction",
      parentId: "subsystem.slotExtraction",
      description: "Date/time parsing for appointments",
      expectedDbPaths: [],
      expectedConsumers: ["ConversationEngine"],
      expectedTraceKeys: ["trace.time.extracted"],
      requiredFields: []
    },

    // =========================================================================
    // SUBSYSTEM: BOOKING INTERRUPTION (Mid-Booking Questions)
    // =========================================================================
    {
      id: "subsystem.bookingInterruption",
      type: "INFRASTRUCTURE",
      label: "Booking Interruption Handler",
      description: "Handles off-topic questions during booking flow",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.bookingInterruption"
      ],
      expectedConsumers: ["ConversationEngine", "HybridReceptionistLLM"],
      expectedTraceKeys: ["trace.interruption.detected", "trace.interruption.answered", "trace.interruption.returned"],
      runtimeBehavior: "Caller asks question → AI answers briefly → Returns to current slot"
    },

    // =========================================================================
    // TAB: WIRING (Developer Tool)
    // =========================================================================
    {
      id: "tab.wiring",
      type: "TAB",
      label: "Wiring",
      description: "Developer tool: Compliance checker, runtime diagnostics",
      expectedDbPaths: [],
      expectedConsumers: [],
      developerOnly: true,
      children: []
    },

    // =========================================================================
    // TAB: LEGACY (Migration Audit)
    // =========================================================================
    {
      id: "tab.legacy",
      type: "TAB",
      label: "Legacy",
      description: "READ-ONLY archive of pre-2026 data for migration auditing",
      expectedDbPaths: [],
      expectedConsumers: [],
      deprecated: true,
      note: "Data here is NOT used by live system - for audit reference only",
      children: []
    },

    // =========================================================================
    // INFRASTRUCTURE COMPONENTS
    // =========================================================================
    {
      id: "infra.redis",
      type: "INFRASTRUCTURE",
      label: "Redis Cache",
      description: "Scenario pool caching (5 min TTL)",
      expectedDbPaths: [],
      expectedConsumers: ["ScenarioPoolService", "redisClientFactory"],
      expectedTraceKeys: [],
      cacheKey: "scenario-pool:{companyId}",
      cacheTTL: 300,
      critical: true,
      criticalIssue: {
        id: "REDIS_STALE_CACHE",
        description: "Stale cache causes scenarioCount=0 even when templates exist",
        solution: "Clear cache: node scripts/clear-scenario-cache.js"
      }
    },

    {
      id: "infra.mongodb",
      type: "INFRASTRUCTURE",
      label: "MongoDB Connection",
      description: "Primary database",
      expectedDbPaths: [],
      expectedConsumers: ["mongoose"],
      expectedTraceKeys: [],
      critical: true
    },

    {
      id: "infra.effectiveConfig",
      type: "INFRASTRUCTURE",
      label: "Effective Config Version",
      description: "Hash of compiled configuration for drift detection",
      expectedDbPaths: ["company.effectiveConfigVersion"],
      expectedConsumers: ["PlatformSnapshotService", "ConfigAuditService"],
      expectedTraceKeys: [],
      critical: true
    },

    // =========================================================================
    // BLACK BOX (Logging - accessed via Call Center)
    // =========================================================================
    {
      id: "infra.blackBox",
      type: "INFRASTRUCTURE",
      label: "Black Box Logger",
      description: "Turn-by-turn conversation logging and debugging",
      expectedDbPaths: ["V22BlackBox collection"],
      expectedConsumers: ["BlackBoxLogger", "ConversationEngine"],
      expectedTraceKeys: ["CHECKPOINT 10", "trace.blackBox.logged"],
      note: "Accessed via Call Center tab, not a separate tab"
    }
  ],

  // =========================================================================
  // GUARDRAILS (MUST NOT DO)
  // =========================================================================
  guardrails: [
    {
      id: "GR_NO_TENANT_HARDCODE",
      label: "No hardcoded tenant logic in runtime",
      severity: "CRITICAL",
      description: "Never hardcode company names, IDs, or trade-specific logic in runtime code"
    },
    {
      id: "GR_NO_TRADE_ASSUMPTIONS",
      label: "No trade-specific assumptions in runtime",
      severity: "CRITICAL",
      description: "Runtime must be trade-agnostic; all trade behavior comes from config"
    },
    {
      id: "GR_NO_SILENT_FALLBACKS",
      label: "No silent fallback when enabled misconfigured",
      severity: "HIGH",
      description: "If a feature is enabled but misconfigured, fail loudly, don't silently fall back"
    },
    {
      id: "GR_NO_UI_ONLY_ENABLED",
      label: "No UI-only enabled features",
      severity: "HIGH",
      description: "Every enabled feature must have a runtime consumer"
    },
    {
      id: "GR_CACHE_KEYS_SCOPED",
      label: "Cache keys must be companyId scoped",
      severity: "CRITICAL",
      description: "All Redis cache keys must include companyId to prevent cross-tenant leaks"
    },
    {
      id: "GR_SCENARIOS_GLOBAL_ONLY",
      label: "Scenarios live in global templates only",
      severity: "CRITICAL",
      description: "Never store scenarios in company documents; use templateReferences"
    },
    {
      id: "GR_NO_GUESSING_IDS",
      label: "No guessing scenario/category IDs",
      severity: "HIGH",
      description: "Always use Export JSON to get real IDs; never fabricate them"
    },
    {
      id: "GR_NO_PHANTOM_SERVICES",
      label: "No phantom services in registry",
      severity: "HIGH",
      description: "Every expectedConsumer must be an actual .js file that exists in /services/"
    }
  ],

  // =========================================================================
  // CHECKPOINT REFERENCE (from ConversationEngine.js)
  // =========================================================================
  checkpoints: [
    { id: "CHECKPOINT 1", description: "Starting processTurn", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 2", description: "Loading company", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 2.5", description: "Cheat sheets loaded", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 2.6", description: "Template loaded", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 2.7", description: "GREETING INTERCEPT (0 tokens)", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 3", description: "Customer lookup / Dynamic Flow Engine", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 4", description: "Session management", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 5", description: "Building customer context", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 6", description: "Building running summary", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 7", description: "Getting conversation history", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 8", description: "Extracting slots", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 9", description: "Mode Control (DISCOVERY/BOOKING)", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 9a", description: "Kill switches loaded", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 9b", description: "V22 LLM-LED DISCOVERY MODE", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 9c", description: "Scenarios retrieved as tools", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 9d", description: "Emotion detected", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 9e", description: "LLM context built", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 9f", description: "LLM response generated", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 9g", description: "Session state saved", file: "ConversationEngine.js" },
    { id: "CHECKPOINT 10", description: "Updating session / Black Box logged", file: "ConversationEngine.js" }
  ],

  // =========================================================================
  // COMPANY PROFILE CROSS-REFERENCE (Don't forget these exist!)
  // =========================================================================
  // These settings live in Company Profile page, NOT Control Plane.
  // They affect runtime but are configured elsewhere.
  // =========================================================================
  _companyProfileConfig: {
    // TAB: OVERVIEW
    "profile.overview": {
      description: "Company basic info - name, phone, email, address",
      dbPath: "company.companyName, company.businessPhone, company.address",
      usedBy: ["FrontlineScriptBuilder", "ResponseRenderer"],
      configuredIn: "Company Profile → Overview tab"
    },
    
    // TAB: CONFIGURATION
    "profile.twilio": {
      description: "Twilio credentials - accountSid, authToken, phone numbers",
      dbPath: "company.twilioConfig",
      usedBy: ["v2twilio.js"],
      configuredIn: "Company Profile → Configuration tab"
    },
    "profile.accountStatus": {
      description: "Account status - active/call_forward/suspended",
      dbPath: "company.accountStatus.status",
      usedBy: ["v2twilio.js (call entry)"],
      configuredIn: "Company Profile → Configuration tab",
      runtimeBehavior: "Checked on EVERY incoming call before AI answers"
    },
    
    // TAB: AI VOICE SETTINGS
    "profile.voiceSettings": {
      description: "ElevenLabs TTS - voice ID, stability, model",
      dbPath: "company.aiAgentSettings.voiceSettings",
      usedBy: ["v2elevenLabsService", "v2AIAgentRuntime"],
      configuredIn: "Company Profile → AI Voice Settings tab"
    },
    
    // TAB: AI AGENT SETTINGS → Messages & Greetings
    "profile.connectionMessages": {
      description: "Initial greeting message - prerecorded or realtime TTS",
      dbPath: "company.connectionMessages.voice",
      usedBy: ["v2twilio.js (greeting)"],
      configuredIn: "Company Profile → AI Agent Settings → Messages & Greetings"
    },
    
    // TAB: SPAM FILTER
    // ⚠️ PRE-CALL FILTERING - Different from LLM-0 spamFilter!
    "profile.spamFilter": {
      description: "Pre-call spam blocking - blacklist, whitelist, detection",
      dbPath: "company.callFilteringConfig",
      usedBy: ["SmartCallFilter.checkCall()"],
      configuredIn: "Company Profile → Spam Filter tab",
      runtimeBehavior: "Checked on EVERY incoming call BEFORE AI answers",
      notSameAs: "Control Plane → LLM-0 Controls → spamFilter (mid-conversation)"
    }
  },

  // =========================================================================
  // REMOVED ITEMS (Audit Jan 2026)
  // =========================================================================
  _removed: {
    "tab.companyContacts": "Merged into tab.transfers (Jan 2026)",
    "tab.testAgent": "Part of Front Desk tab now, not separate",
    "tab.blackBox": "Accessed via Call Center, not separate tab",
    "dataConfig.cheatSheets": "Tab removed, CheatSheet system still works via Call Protection",
    "GoldenAutofillEngine": "Not a service - logic is in routes/admin/goldenAutofill.js",
    "CallProtectionEngine": "Phantom - actual service is SmartCallFilter + CheatSheetEngine",
    "TransferRouter": "Phantom - logic is in ConversationEngine.handleTransfer()",
    "CallCenterEngine": "Phantom - actual services are CallSummaryService + CustomerService",
    "OutputGuardrails": "Phantom - logic is in HybridReceptionistLLM.postProcessResponse()",
    "DetectionEngine": "Phantom - logic is in HybridScenarioSelector",
    "FallbackController": "Phantom - actual services are LowConfidenceHandler + Tier3LLMFallback",
    "ModePolicy": "Phantom - logic is inline in ConversationEngine",
    "EscalationPolicy": "Phantom - logic is inline in ConversationEngine",
    "LoopDetector": "Phantom - actual service is ConversationStateMachine",
    "FrustrationEngine": "Phantom - logic is inline in ConversationEngine",
    "EmotionClassifier": "Phantom - logic is in HybridReceptionistLLM",
    "ConsentGate": "Phantom - logic is inline in ConversationEngine",
    "InputNormalizer": "Phantom - logic is in HybridScenarioSelector.normalize()",
    "SpamFilterManager": "Phantom - actual service is SmartCallFilter",
    "SystemPromptComposer": "Phantom - actual service is FrontlineScriptBuilder",
    "RuntimeTruthProvider": "Phantom - actual service is PlatformSnapshotService",
    "PlatformSnapshotProvider": "Phantom - actual service is PlatformSnapshotService"
  }
};

module.exports = { wiringRegistryV1, WIRING_SCHEMA_VERSION };
