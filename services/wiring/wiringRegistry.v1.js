/**
 * ============================================================================
 * WIRING REGISTRY V1 - SINGLE SOURCE OF TRUTH
 * ============================================================================
 * 
 * This file defines EXACTLY what "wired" means for every component.
 * 
 * RULES:
 * 1. Database paths must match ACTUAL schema (not aspirational)
 * 2. Every UI tab must be represented
 * 3. Consumers must be real service/engine names
 * 4. Trace keys must be emitted by real code
 * 
 * LAST UPDATED: Jan 5, 2026
 * UPDATED BY: AI Coder (Boss Mode)
 * 
 * ============================================================================
 */

const WIRING_SCHEMA_VERSION = "WIRING_SNAPSHOT_V1.1";

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
  
  nodes: [
    // =========================================================================
    // TAB: FRONT DESK
    // =========================================================================
    {
      id: "tab.frontDesk",
      type: "TAB",
      label: "Front Desk",
      description: "Controls how AI talks to callers",
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
        "frontDesk.promptPacks",
        "frontDesk.promptGuards",
        "frontDesk.dynamicFlows",
        "frontDesk.emotions",
        "frontDesk.frustration",
        "frontDesk.escalation",
        "frontDesk.loops",
        "frontDesk.forbidden",
        "frontDesk.detection",
        "frontDesk.fallbacks",
        "frontDesk.modes",
        "frontDesk.test"
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
      expectedConsumers: ["SystemPromptComposer", "HybridReceptionistLLM"],
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
      expectedConsumers: ["ConversationEngine.greetingIntercept"],
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
        "company.aiAgentSettings.frontDeskBehavior.discoveryConsent.bookingRequiresExplicitConsent",
        "company.aiAgentSettings.frontDeskBehavior.discoveryConsent.autoReplyAllowedScenarioTypes"
      ],
      expectedConsumers: ["ConversationEngine.killSwitches", "ConsentGate"],
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
      expectedConsumers: ["InputNormalizer"],
      expectedTraceKeys: ["trace.vocabulary.replaced"],
      requiredFields: []
    },

    // SECTION: Booking Prompts (V2)
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
        "runtimeSlots.slotCount",
        "bookingContractV2.enabled"
      ],
      expectedConsumers: ["BookingStateMachine", "SlotExtractors"],
      expectedTraceKeys: [
        "trace.booking.slotRequested",
        "CHECKPOINT 8"
      ],
      requiredFields: ["id", "type", "question"],
      criticalIssue: {
        id: "BOOKING_NOT_COMPILED",
        description: "Slots defined but bookingContractV2.enabled = false",
        checkField: "bookingContractV2.enabled"
      }
    },

    // SECTION: Prompt Packs (Hybrid defaults)
    {
      id: "frontDesk.promptPacks",
      type: "SECTION",
      label: "Prompt Packs",
      parentId: "tab.frontDesk",
      description: "Trade-scoped prompt packs (explicit selection only)",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.promptPacks",
        "company.aiAgentSettings.frontDeskBehavior.promptPacks.selectedByTrade"
      ],
      expectedConsumers: ["PromptResolver", "ConversationEngine"],
      expectedTraceKeys: [],
      requiredFields: []
    },

    // SECTION: Prompt Guards
    {
      id: "frontDesk.promptGuards",
      type: "SECTION",
      label: "Prompt Guards",
      parentId: "tab.frontDesk",
      description: "Missing prompt guardrails and fallback key",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.promptGuards",
        "company.aiAgentSettings.frontDeskBehavior.promptGuards.missingPromptFallbackKey"
      ],
      expectedConsumers: ["ConversationEngine"],
      expectedTraceKeys: [],
      requiredFields: []
    },

    // SECTION: Dynamic Flows (within Front Desk tab)
    {
      id: "frontDesk.dynamicFlows",
      type: "SECTION",
      label: "Dynamic Flows",
      parentId: "tab.frontDesk",
      description: "Trigger-based conversation flows",
      expectedDbPaths: [
        "DynamicFlow collection (companyId filter)"
      ],
      expectedConsumers: ["DynamicFlowEngine"],
      expectedTraceKeys: [
        "trace.dynamicFlows.evaluated",
        "CHECKPOINT 3: Dynamic Flow Engine"
      ],
      requiredFields: ["flowKey", "triggers", "actions"]
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
      expectedConsumers: ["EmotionClassifier"],
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
      expectedConsumers: ["FrustrationEngine"],
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
      expectedConsumers: ["EscalationPolicy", "ConversationEngine"],
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
      expectedConsumers: ["LoopDetector"],
      expectedTraceKeys: ["trace.loop.detected"],
      requiredFields: []
    },

    // SECTION: Forbidden
    {
      id: "frontDesk.forbidden",
      type: "SECTION",
      label: "Forbidden",
      parentId: "tab.frontDesk",
      description: "Phrases AI must never say",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.forbiddenPhrases"
      ],
      expectedConsumers: ["OutputGuardrails"],
      expectedTraceKeys: ["trace.forbidden.blocked"],
      requiredFields: []
    },

    // SECTION: Detection
    {
      id: "frontDesk.detection",
      type: "SECTION",
      label: "Detection",
      parentId: "tab.frontDesk",
      description: "Intent and entity detection settings",
      expectedDbPaths: [
        "company.aiAgentSettings.frontDeskBehavior.detectionTriggers"
      ],
      expectedConsumers: ["DetectionEngine"],
      expectedTraceKeys: ["trace.detection.hit"],
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
      expectedConsumers: ["FallbackController", "HybridReceptionistLLM"],
      expectedTraceKeys: ["trace.fallback.used"],
      requiredFields: ["didNotUnderstandTier1"]
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
      expectedConsumers: ["ModePolicy", "ConversationEngine"],
      expectedTraceKeys: ["trace.mode.transition"],
      requiredFields: []
    },

    // SECTION: Test (within Front Desk)
    {
      id: "frontDesk.test",
      type: "SECTION",
      label: "Test",
      parentId: "tab.frontDesk",
      description: "Test console for Front Desk behavior",
      expectedDbPaths: [],
      expectedConsumers: ["ConversationEngine"],
      expectedTraceKeys: ["trace.test.turn"],
      requiredFields: []
    },

    // =========================================================================
    // TAB: FLOW TREE
    // =========================================================================
    {
      id: "tab.flowTree",
      type: "TAB",
      label: "Flow Tree",
      description: "AI Decision Flow Tree visualization",
      expectedDbPaths: [],
      expectedConsumers: ["RuntimeTruthProvider"],
      expectedTraceKeys: [],
      children: [
        "flowTree.decisionTree",
        "flowTree.systemSnapshot"
      ]
    },

    // SECTION: Decision Tree
    {
      id: "flowTree.decisionTree",
      type: "SECTION",
      label: "AI Decision Flow Tree",
      parentId: "tab.flowTree",
      description: "Visual representation of call flow decisions",
      expectedDbPaths: [],
      expectedConsumers: ["RuntimeTruthProvider"],
      expectedTraceKeys: [],
      requiredFields: []
    },

    // SECTION: System Snapshot
    {
      id: "flowTree.systemSnapshot",
      type: "SECTION",
      label: "System Snapshot",
      parentId: "tab.flowTree",
      description: "Runtime truth snapshot with health status",
      expectedDbPaths: [],
      expectedConsumers: ["RuntimeTruthProvider", "PlatformSnapshotProvider"],
      expectedTraceKeys: [],
      requiredFields: []
    },

    // =========================================================================
    // TAB: DYNAMIC FLOW
    // =========================================================================
    {
      id: "tab.dynamicFlow",
      type: "TAB",
      label: "Dynamic Flow",
      description: "Trigger-based conversation flows",
      expectedDbPaths: [
        "DynamicFlow collection"
      ],
      expectedConsumers: ["DynamicFlowEngine"],
      expectedTraceKeys: ["trace.dynamicFlow.evaluated"],
      children: [
        "dynamicFlow.companyFlows",
        "dynamicFlow.templates"
      ]
    },

    // SECTION: Company Flows
    {
      id: "dynamicFlow.companyFlows",
      type: "SECTION",
      label: "Company Flows",
      parentId: "tab.dynamicFlow",
      description: "Active flows for this company (isTemplate=false)",
      expectedDbPaths: [
        "DynamicFlow collection (companyId=X, isTemplate=false)"
      ],
      expectedConsumers: ["DynamicFlowEngine"],
      expectedTraceKeys: ["trace.flow.activated"],
      requiredFields: ["flowKey", "triggers", "enabled"]
    },

    // SECTION: Templates
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
      expectedTraceKeys: [],
      requiredFields: []
    },

    // =========================================================================
    // TAB: DATA & CONFIG
    // =========================================================================
    {
      id: "tab.dataConfig",
      type: "TAB",
      label: "Data & Config",
      description: "Placeholders, templates, scenarios, and data management",
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

    // SECTION: Onboarding
    {
      id: "dataConfig.onboarding",
      type: "SECTION",
      label: "Onboarding",
      parentId: "tab.dataConfig",
      description: "Company setup wizard status",
      expectedDbPaths: [
        "company.onboardingStatus"
      ],
      expectedConsumers: [],
      expectedTraceKeys: [],
      requiredFields: []
    },

    // SECTION: Placeholders
    {
      id: "dataConfig.placeholders",
      type: "SECTION",
      label: "Placeholders",
      parentId: "tab.dataConfig",
      description: "Dynamic tokens like {companyName}, {phone}",
      expectedDbPaths: [
        "CompanyPlaceholders collection"
      ],
      expectedConsumers: ["ResponseRenderer", "HybridReceptionistLLM"],
      expectedTraceKeys: ["trace.placeholder.resolved"],
      requiredFields: ["key", "value"]
    },

    // SECTION: Default Replies
    {
      id: "dataConfig.defaultReplies",
      type: "SECTION",
      label: "Default Replies",
      parentId: "tab.dataConfig",
      description: "Fallback responses (not offered, unknown intent, after hours)",
      expectedDbPaths: [
        "CompanyResponseDefaults collection"
      ],
      expectedConsumers: ["FallbackController"],
      expectedTraceKeys: ["trace.defaultReply.used"],
      requiredFields: []
    },

    // SECTION: Templates (Global Instant Response Templates)
    {
      id: "dataConfig.templates",
      type: "SECTION",
      label: "Templates",
      parentId: "tab.dataConfig",
      description: "Global trade knowledge templates (HVAC, Dental, etc.)",
      expectedDbPaths: [
        "GlobalInstantResponseTemplate collection"
      ],
      expectedConsumers: ["ScenarioPoolService"],
      expectedTraceKeys: ["trace.template.loaded"],
      requiredFields: ["name", "templateType", "categories"]
    },

    // SECTION: Template References (CRITICAL!)
    {
      id: "dataConfig.templateReferences",
      type: "SECTION",
      label: "Template References",
      parentId: "tab.dataConfig",
      description: "Links company to global templates - CRITICAL for scenarios",
      expectedDbPaths: [
        "company.aiAgentSettings.templateReferences"
      ],
      expectedConsumers: ["ScenarioPoolService", "LLMDiscoveryEngine"],
      expectedTraceKeys: [
        "trace.templateRef.loaded",
        "CHECKPOINT 2.6"
      ],
      requiredFields: ["templateId", "enabled"],
      critical: true,
      criticalIssue: {
        id: "TEMPLATE_REF_MISSING",
        description: "If templateReferences is empty, scenarioCount=0 at runtime",
        checkField: "company.aiAgentSettings.templateReferences.length > 0"
      }
    },

    // SECTION: Scenarios
    {
      id: "dataConfig.scenarios",
      type: "SECTION",
      label: "Scenarios",
      parentId: "tab.dataConfig",
      description: "Trade knowledge scenarios from templates",
      expectedDbPaths: [
        "GlobalInstantResponseTemplate.categories[].scenarios[]"
      ],
      expectedConsumers: ["HybridScenarioSelector", "LLMDiscoveryEngine"],
      expectedTraceKeys: [
        "trace.scenario.matched",
        "CHECKPOINT 9c"
      ],
      requiredFields: ["scenarioId", "name", "scenarioType", "triggers"]
    },

    // SECTION: Execution Map
    {
      id: "dataConfig.executionMap",
      type: "SECTION",
      label: "Execution Map",
      parentId: "tab.dataConfig",
      description: "Visual map of scenario execution paths",
      expectedDbPaths: [],
      expectedConsumers: [],
      expectedTraceKeys: [],
      requiredFields: []
    },

    // SECTION: QA Dashboard
    {
      id: "dataConfig.qaDashboard",
      type: "SECTION",
      label: "QA Dashboard",
      parentId: "tab.dataConfig",
      description: "Scenario quality scores and enforcement status",
      expectedDbPaths: [],
      expectedConsumers: ["GoldenAutofillEngine"],
      expectedTraceKeys: [],
      requiredFields: []
    },

    // =========================================================================
    // TAB: CALL PROTECTION
    // =========================================================================
    {
      id: "tab.callProtection",
      type: "TAB",
      label: "Call Protection",
      description: "Pre-answer filters: spam, IVR, machine detection",
      expectedDbPaths: [
        "CheatSheetVersion.config.edgeCases"
      ],
      expectedConsumers: ["CallProtectionEngine"],
      expectedTraceKeys: ["trace.callProtection.evaluated"],
      children: [
        "callProtection.spamCheck",
        "callProtection.ivrDetection",
        "callProtection.machineDetection"
      ]
    },

    // SECTION: Spam Check
    {
      id: "callProtection.spamCheck",
      type: "SECTION",
      label: "Spam Check",
      parentId: "tab.callProtection",
      description: "Filter known spam callers",
      expectedDbPaths: [
        "CheatSheetVersion.config.edgeCases (type=spam)"
      ],
      expectedConsumers: ["SpamFilterManager"],
      expectedTraceKeys: ["trace.spam.blocked"],
      requiredFields: []
    },

    // SECTION: IVR Detection
    {
      id: "callProtection.ivrDetection",
      type: "SECTION",
      label: "IVR Detection",
      parentId: "tab.callProtection",
      description: "Detect and handle IVR systems",
      expectedDbPaths: [
        "CheatSheetVersion.config.edgeCases (type=ivr)"
      ],
      expectedConsumers: ["CallProtectionEngine"],
      expectedTraceKeys: ["trace.ivr.detected"],
      requiredFields: []
    },

    // SECTION: Machine Detection
    {
      id: "callProtection.machineDetection",
      type: "SECTION",
      label: "Machine Detection",
      parentId: "tab.callProtection",
      description: "Detect voicemail and answering machines",
      expectedDbPaths: [
        "CheatSheetVersion.config.edgeCases (type=machine)"
      ],
      expectedConsumers: ["CallProtectionEngine"],
      expectedTraceKeys: ["trace.machine.detected"],
      requiredFields: []
    },

    // =========================================================================
    // TAB: TRANSFER CALLS
    // =========================================================================
    {
      id: "tab.transfers",
      type: "TAB",
      label: "Transfer Calls",
      description: "Transfer targets and routing rules",
      expectedDbPaths: [
        "company.aiAgentSettings.transferTargets"
      ],
      expectedConsumers: ["TransferRouter"],
      expectedTraceKeys: ["trace.transfer.initiated"],
      children: [
        "transfers.directory",
        "transfers.rules"
      ]
    },

    // SECTION: Transfer Directory
    {
      id: "transfers.directory",
      type: "SECTION",
      label: "Transfer Directory",
      parentId: "tab.transfers",
      description: "Available transfer targets",
      expectedDbPaths: [
        "company.aiAgentSettings.transferTargets"
      ],
      expectedConsumers: ["TransferRouter"],
      expectedTraceKeys: ["trace.transfer.targetResolved"],
      requiredFields: ["id", "name", "phone"]
    },

    // SECTION: Transfer Rules
    {
      id: "transfers.rules",
      type: "SECTION",
      label: "Transfer Rules",
      parentId: "tab.transfers",
      description: "Conditions for automatic transfers",
      expectedDbPaths: [
        "CheatSheetVersion.config.transferRules"
      ],
      expectedConsumers: ["TransferRouter"],
      expectedTraceKeys: ["trace.transfer.ruleMatched"],
      requiredFields: []
    },

    // =========================================================================
    // TAB: CALL CENTER
    // =========================================================================
    {
      id: "tab.callCenter",
      type: "TAB",
      label: "Call Center",
      description: "Call handling and agent settings",
      expectedDbPaths: [
        "company.aiAgentSettings.callCenter"
      ],
      expectedConsumers: ["CallCenterEngine"],
      expectedTraceKeys: [],
      children: []
    },

    // =========================================================================
    // TAB: COMPANY CONTACTS
    // =========================================================================
    {
      id: "tab.companyContacts",
      type: "TAB",
      label: "Company Contacts",
      description: "Contact directory for the company",
      expectedDbPaths: [
        "company.contacts"
      ],
      expectedConsumers: [],
      expectedTraceKeys: [],
      children: []
    },

    // =========================================================================
    // TAB: BLACK BOX (Critical for debugging)
    // =========================================================================
    {
      id: "tab.blackBox",
      type: "TAB",
      label: "Black Box",
      description: "Turn-by-turn conversation logging and debugging",
      expectedDbPaths: [
        "V22BlackBox collection"
      ],
      expectedConsumers: ["BlackBoxLogger", "ConversationEngine"],
      expectedTraceKeys: [
        "CHECKPOINT 10",
        "trace.blackBox.logged"
      ],
      children: [
        "blackBox.turnLogs",
        "blackBox.sessionHistory",
        "blackBox.debugPayload"
      ]
    },

    // SECTION: Turn Logs
    {
      id: "blackBox.turnLogs",
      type: "SECTION",
      label: "Turn Logs",
      parentId: "tab.blackBox",
      description: "Individual turn records with full debug",
      expectedDbPaths: [
        "V22BlackBox collection"
      ],
      expectedConsumers: ["BlackBoxLogger"],
      expectedTraceKeys: ["trace.turn.logged"],
      requiredFields: ["companyId", "sessionId", "turn", "userInput", "aiResponse"]
    },

    // SECTION: Session History
    {
      id: "blackBox.sessionHistory",
      type: "SECTION",
      label: "Session History",
      parentId: "tab.blackBox",
      description: "Full conversation sessions",
      expectedDbPaths: [
        "ConversationSession collection"
      ],
      expectedConsumers: ["SessionService"],
      expectedTraceKeys: [],
      requiredFields: []
    },

    // SECTION: Debug Payload
    {
      id: "blackBox.debugPayload",
      type: "SECTION",
      label: "Debug Payload",
      parentId: "tab.blackBox",
      description: "Full diagnostic JSON for troubleshooting",
      expectedDbPaths: [],
      expectedConsumers: ["ConversationEngine"],
      expectedTraceKeys: [],
      requiredFields: []
    },

    // =========================================================================
    // TAB: TEST AGENT
    // =========================================================================
    {
      id: "tab.testAgent",
      type: "TAB",
      label: "Test Agent",
      description: "Live test console for AI agent",
      expectedDbPaths: [],
      expectedConsumers: ["ConversationEngine"],
      expectedTraceKeys: ["trace.testAgent.turn"],
      children: [
        "testAgent.console",
        "testAgent.debugMode"
      ]
    },

    // SECTION: Test Console
    {
      id: "testAgent.console",
      type: "SECTION",
      label: "Test Console",
      parentId: "tab.testAgent",
      description: "Interactive chat for testing",
      expectedDbPaths: [],
      expectedConsumers: ["ConversationEngine"],
      expectedTraceKeys: [],
      requiredFields: []
    },

    // SECTION: Debug Mode
    {
      id: "testAgent.debugMode",
      type: "SECTION",
      label: "Debug Mode",
      parentId: "tab.testAgent",
      description: "Verbose debug output during tests",
      expectedDbPaths: [],
      expectedConsumers: ["ConversationEngine"],
      expectedTraceKeys: [],
      requiredFields: []
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
      expectedConsumers: ["ScenarioPoolService", "redisFactory"],
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
      expectedDbPaths: [
        "company.effectiveConfigVersion"
      ],
      expectedConsumers: ["RuntimeTruthProvider", "ConfigAuditService"],
      expectedTraceKeys: [],
      critical: true
    },

    // =========================================================================
    // CHEAT SHEETS (Discovery fallback)
    // =========================================================================
    {
      id: "dataConfig.cheatSheets",
      type: "SECTION",
      label: "Cheat Sheets",
      parentId: "tab.dataConfig",
      description: "FAQ knowledge base for discovery fallback",
      expectedDbPaths: [
        "CheatSheetVersion collection"
      ],
      expectedConsumers: ["CheatSheetRuntimeService", "ConversationEngine"],
      expectedTraceKeys: [
        "CHECKPOINT 2.5",
        "trace.cheatSheet.used"
      ],
      requiredFields: []
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
  ]
};

module.exports = { wiringRegistryV1, WIRING_SCHEMA_VERSION };

