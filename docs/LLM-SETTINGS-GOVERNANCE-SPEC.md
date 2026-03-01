# LLM Settings Governance Specification

## Executive Summary

**ALL LLM behavior must be UI-governed. Zero hardcoded constraints.**

This document defines the complete settings structure for the LLM Settings UI (`llm.html`). Every guardrail, boundary, prompt, and parameter must be visible, editable, and persisted through the UI.

---

## Core Principle: No Hidden Behavior

**RULE:** If an LLM does it, the settings UI must control it.

- ✅ **Transparent** - Admin sees all prompts, constraints, and rules
- ✅ **Editable** - Admin can customize for their business type
- ✅ **Testable** - Admin can preview what LLM receives before saving
- ✅ **Auditable** - All changes tracked with timestamps and user info
- ❌ **Never hidden** - No hardcoded prompts or secret instructions

---

## Settings Structure (Complete)

### 1. CORE IDENTITY & ROLE

**What is the LLM's job?** Define its purpose and boundaries.

```javascript
{
  coreIdentity: {
    primaryRole: "Scenario Architect",  // What does it do?
    secondaryRole: null,                // Optional additional role
    
    // CRITICAL GUARDRAILS - What it CANNOT do
    prohibitedActions: [
      "Never book appointments directly",
      "Never modify external systems",
      "Never provide medical/legal/financial advice",
      "Never invent company policies or prices",
      "Never collect sensitive data without explicit domain mode",
      "Never handle emergencies without escalation"
    ],
    
    // ALLOWED ACTIONS - What it CAN do
    allowedActions: [
      "Draft scenario configurations",
      "Generate trigger phrases and replies",
      "Suggest conversational flows",
      "Answer unforeseen questions within domain safety rules",
      "Route to appropriate scenarios",
      "Ask clarifying questions when uncertain"
    ],
    
    // OUTPUT FORMAT - How should it respond?
    outputFormat: "JSON", // "JSON" | "Natural Language" | "Hybrid"
    outputValidation: "strict", // "strict" | "relaxed"
    
    notes: "Admin can add custom notes about role definition"
  }
}
```

**UI Section:** "Core Identity & Role Definition"
- Dropdown for primaryRole
- Multi-select checklist for prohibitedActions (pre-filled + custom)
- Multi-select checklist for allowedActions (pre-filled + custom)
- Text area for custom notes

---

### 2. BEHAVIORAL GUARDRAILS

**Hard boundaries that prevent dangerous or unwanted behavior.**

```javascript
{
  guardrails: {
    booking: {
      canBookAppointments: false,
      canModifyAppointments: false,
      canCancelAppointments: false,
      canAccessCalendar: false,
      bookingBehavior: "answer_only", // "answer_only" | "route_to_human" | "escalate_immediately"
      customInstructions: "When asked about booking, explain process and hand off to booking flow."
    },
    
    information: {
      canInventPrices: false,
      canInventPolicies: false,
      canMakeGuarantees: false,
      canQuoteExactFees: false,
      pricingBehavior: "generic_only", // "generic_only" | "variables_only" | "strict_none"
      customInstructions: "Use cautious language: 'our team can review', 'a representative will confirm'"
    },
    
    data: {
      canCollectSSN: false,
      canCollectCreditCard: false,
      canCollectMedicalInfo: false,
      canCollectFinancialInfo: false,
      sensitiveDataBehavior: "refuse_politely", // "refuse_politely" | "route_to_secure_channel" | "require_explicit_consent"
      customInstructions: "Never ask for SSN, credit cards, or medical details unless explicitly allowed by domain mode"
    },
    
    emergency: {
      canTriageEmergencies: false,
      canProvideMedicalAdvice: false,
      canDelayEmergencyServices: false,
      emergencyBehavior: "escalate_immediately", // "escalate_immediately" | "collect_info_first" | "assess_severity"
      emergencyEscalationPrompt: "If caller describes severe symptoms or danger, instruct them to hang up and dial 911 immediately.",
      customInstructions: ""
    },
    
    compliance: {
      requireExplicitConsent: true,
      mustDiscloseAIIdentity: true,
      mustOfferHumanEscalation: true,
      recordingDisclosure: "automatic", // "automatic" | "on_request" | "none"
      compliancePrompt: "You must disclose you are an AI assistant. Always offer to transfer to a human representative.",
      customInstructions: ""
    },
    
    tone: {
      allowedPersonalities: ["professional", "friendly", "empathetic"],
      prohibitedPersonalities: ["aggressive", "dismissive", "overly casual"],
      maxCasualness: 0.3, // 0-1 scale (0 = formal, 1 = very casual)
      mustAvoidSlang: true,
      mustAvoidEmojis: true,
      toneInstructions: "Use professional, courteous language. Be concise and clear."
    },
    
    responseConstraints: {
      maxSentences: 2,
      maxWords: 50,
      mustEndWithQuestion: false,
      mustEndWithFunnelQuestion: true, // Guide caller to next step
      mustProvideNextSteps: true,
      constraintInstructions: "Keep responses under 2 sentences. Always guide caller to next action."
    },
    
    customGuardrails: [
      // Admin can add custom guardrails as free-text
      {
        id: "hvac_seasonal_pricing",
        name: "HVAC Seasonal Pricing Restriction",
        rule: "Never quote exact prices. Seasonal rates vary. Always say 'let me connect you with our team for current pricing.'",
        enabled: true
      }
    ]
  }
}
```

**UI Section:** "Behavioral Guardrails & Boundaries"
- Tabbed interface:
  - **Booking** - Checkboxes for what LLM can/cannot do with appointments
  - **Information** - Controls for pricing, policies, guarantees
  - **Data Collection** - Sensitive data handling rules
  - **Emergency** - Emergency triage and escalation rules
  - **Compliance** - Consent, disclosure, human escalation requirements
  - **Tone & Style** - Personality, formality, language constraints
  - **Response Format** - Length limits, structure requirements
  - **Custom Guardrails** - Add your own business-specific rules

---

### 3. DOMAIN SAFETY MODES

**Industry-specific rulesets that override defaults.**

```javascript
{
  domainSafety: {
    medical: {
      enabled: false,
      strictness: "maximum", // "maximum" | "high" | "moderate"
      
      prohibitions: [
        "No diagnosis or symptom interpretation",
        "No medication recommendations",
        "No treatment plan changes",
        "No emergency triage",
        "No lab result interpretation"
      ],
      
      allowedScope: [
        "Scheduling appointments",
        "Office hours and directions",
        "Insurance verification routing",
        "General office policies"
      ],
      
      emergencyProtocol: "If caller describes severe symptoms, immediately instruct to call 911 or go to ER. Do not assess severity.",
      
      customPrompt: "You are configuring scenarios for a medical office. NEVER provide medical advice...",
      
      hipaaCompliance: true,
      requireExplicitConsent: true,
      
      notes: ""
    },
    
    financial: {
      enabled: false,
      strictness: "high",
      
      prohibitions: [
        "No investment advice",
        "No tax advice",
        "No legal opinions",
        "No fee waivers or refund promises",
        "No exact balance quotes without verification"
      ],
      
      allowedScope: [
        "General billing questions routing",
        "Payment method options",
        "Contact information for billing team"
      ],
      
      languageGuidelines: "Use cautious phrasing: 'our team can review', 'a representative will confirm'",
      
      customPrompt: "You are configuring billing scenarios. Never promise refunds or quote exact amounts...",
      
      pciCompliance: true,
      requireSecureChannel: true,
      
      notes: ""
    },
    
    legal: {
      enabled: false,
      strictness: "maximum",
      
      prohibitions: [
        "No legal advice",
        "No interpretation of contracts or terms",
        "No predictions about case outcomes",
        "No recommendations about legal strategy"
      ],
      
      allowedScope: [
        "Scheduling consultations",
        "General office information",
        "Document collection logistics"
      ],
      
      disclaimer: "Remind callers that AI cannot provide legal advice and consultation is required.",
      
      customPrompt: "",
      notes: ""
    },
    
    emergency: {
      enabled: false,
      strictness: "maximum",
      
      criticalRule: "AI MUST NOT delay or discourage emergency services. For ANY description of immediate danger, instruct caller to hang up and dial 911.",
      
      prohibitions: [
        "No triage or severity assessment",
        "No 'wait and see' recommendations",
        "No calming down active emergencies"
      ],
      
      allowedScope: [
        "Immediate escalation to 911",
        "Clear, short safety instructions only"
      ],
      
      responseTemplate: "This sounds like an emergency. Please hang up now and dial 911 immediately.",
      
      customPrompt: "",
      notes: ""
    },
    
    custom: [
      // Admin can define custom domain modes
      {
        id: "hvac_warranty_claims",
        name: "HVAC Warranty Claims Mode",
        enabled: false,
        prohibitions: ["No warranty approval", "No coverage determination"],
        allowedScope: ["Collect claim details", "Route to warranty team"],
        customPrompt: "For warranty questions, collect unit model and issue, then route to warranty specialist.",
        notes: "Used during warranty season (winter/summer)"
      }
    ]
  }
}
```

**UI Section:** "Domain Safety Modes"
- Accordion or tabs for each domain (Medical, Financial, Legal, Emergency)
- Toggle to enable each mode
- Strictness slider (Moderate → High → Maximum)
- Editable prohibitions and allowed scope lists
- Custom prompt text area per domain
- "Add Custom Domain Mode" button

---

### 4. PROFILE SETTINGS

**Pre-configured behavior profiles with different creativity/safety tradeoffs.**

```javascript
{
  profiles: {
    active: "compliance_safe", // Which profile is currently active
    
    compliance_safe: {
      enabled: true,
      label: "Compliance-Safe (Default)",
      description: "Conservative, low creativity. Prioritizes safety and policy alignment.",
      
      modelSettings: {
        model: "gpt-4o-mini",
        temperature: 0.2,
        topP: 0.9,
        maxTokens: 2200,
        
        // Server enforces these limits even if admin tries to override
        clamps: {
          temperature: { min: 0.1, max: 0.35 },
          topP: { min: 0.7, max: 0.95 },
          maxTokens: { min: 1200, max: 2600 }
        }
      },
      
      behaviorOverrides: {
        askWhenUncertain: true,
        avoidStrongClaims: true,
        preferEscalation: true,
        creativity: "minimal"
      },
      
      customPrompt: "PROFILE: COMPLIANCE-SAFE\n\nBehavior:\n- Be conservative and low-creativity...",
      
      notes: "Best for regulated industries (medical, financial, legal)"
    },
    
    call_center_optimized: {
      enabled: true,
      label: "Call Center Optimized",
      description: "Balanced creativity. Tuned for phone calls with natural language.",
      
      modelSettings: {
        model: "gpt-4o",
        temperature: 0.35,
        topP: 0.9,
        maxTokens: 2600,
        clamps: null // No strict clamps
      },
      
      behaviorOverrides: {
        generateRicherVariants: true,
        soundNatural: true,
        phoneOptimized: true,
        creativity: "moderate"
      },
      
      customPrompt: "PROFILE: CALL CENTER OPTIMIZED\n\nBehavior:\n- Balanced creativity...",
      
      notes: "Best for HVAC, plumbing, general service businesses"
    },
    
    creative_exploration: {
      enabled: true,
      label: "Creative Exploration (Internal)",
      description: "High creativity for brainstorming. Review before production.",
      
      modelSettings: {
        model: "gpt-4o",
        temperature: 0.65,
        topP: 0.95,
        maxTokens: 3000,
        clamps: null
      },
      
      behaviorOverrides: {
        generateManyVariants: true,
        exploreEdgeCases: true,
        creativity: "high"
      },
      
      customPrompt: "PROFILE: CREATIVE EXPLORATION\n\nBehavior:\n- High creativity and breadth...",
      
      notes: "For brainstorming only. Always review output before going live."
    },
    
    // Admin can create custom profiles
    custom: [
      {
        id: "dental_office_balanced",
        label: "Dental Office Balanced",
        description: "Medical mode enabled, moderate creativity for friendly dental practice",
        modelSettings: {
          model: "gpt-4o-mini",
          temperature: 0.25,
          topP: 0.85,
          maxTokens: 2000,
          clamps: { temperature: { min: 0.1, max: 0.4 } }
        },
        inheritFrom: "compliance_safe",
        domainModes: ["medical"],
        customPrompt: "",
        notes: "Combines safety with friendly dental practice tone"
      }
    ]
  }
}
```

**UI Section:** "Behavior Profiles"
- Profile selector (radio buttons or dropdown)
- Per-profile configuration cards showing:
  - Model settings with sliders (temp, topP, maxTokens)
  - Clamp indicators (visual warning when values are clamped)
  - Behavior toggles
  - Custom prompt editor
- "Create Custom Profile" wizard
- "Inherit from existing profile" option

---

### 5. PROMPT ENGINEERING

**The actual text sent to the LLM. Fully editable.**

```javascript
{
  prompts: {
    system: {
      base: `You are the AI Scenario Architect for ClientVia.ai.

Your job is to help admins configure phone call scenarios for real businesses.
You do NOT talk directly to end users. You only produce structured JSON drafts...`,
      
      footer: `Your output must always include a checklistSummary explaining key assumptions, risks, and anything the admin should double-check before going live.`,
      
      notes: "This is the foundation prompt always included"
    },
    
    profileSpecific: {
      compliance_safe: "PROFILE: COMPLIANCE-SAFE\n\nBehavior:\n- Be conservative...",
      call_center_optimized: "PROFILE: CALL CENTER OPTIMIZED\n\nBehavior:\n- Balanced creativity...",
      creative_exploration: "PROFILE: CREATIVE EXPLORATION\n\nBehavior:\n- High creativity..."
    },
    
    domainSpecific: {
      medical: "DOMAIN SAFETY: MEDICAL OFFICE\n\nYou are configuring scenarios for medical...",
      financial: "DOMAIN SAFETY: FINANCIAL & BILLING\n\nYou are configuring scenarios for billing...",
      emergency: "DOMAIN SAFETY: EMERGENCY SERVICES\n\nYou are configuring scenarios where callers..."
    },
    
    guardrailEnforcement: {
      strictCompliance: "GLOBAL OVERRIDE: STRICT COMPLIANCE MODE IS ON.\n\nWhen in doubt, behave like the Compliance-Safe profile...",
      
      bookingRestriction: "CRITICAL: You CANNOT book appointments. You can only answer questions and route to booking flow.",
      
      pricingRestriction: "NEVER quote exact prices. Say: 'Let me connect you with our team for current pricing.'",
      
      emergencyEscalation: "If caller describes emergency symptoms or danger, immediately instruct: 'Please hang up and dial 911 now.'"
    },
    
    customPrompts: [
      {
        id: "hvac_seasonal_disclaimer",
        name: "HVAC Seasonal Pricing Disclaimer",
        prompt: "Note: HVAC pricing varies by season and service complexity. Always route pricing questions to sales team.",
        appliesTo: ["call_center_optimized"],
        enabled: true
      }
    ],
    
    // LIVE PREVIEW: Shows assembled prompt exactly as LLM sees it
    assembledPreview: {
      sections: [
        { type: "system.base", content: "...", order: 1 },
        { type: "profile.compliance_safe", content: "...", order: 2 },
        { type: "domain.medical", content: "...", order: 3 },
        { type: "guardrail.strictCompliance", content: "...", order: 4 },
        { type: "system.footer", content: "...", order: 5 }
      ],
      fullPrompt: "// Assembled final system prompt sent to OpenAI",
      characterCount: 3421,
      estimatedTokens: 850
    }
  }
}
```

**UI Section:** "Prompt Engineering"
- Tabbed editor:
  - **Base System Prompt** (always included)
  - **Profile Prompts** (3 tabs: compliance/call-center/creative)
  - **Domain Safety Prompts** (medical/financial/emergency/legal)
  - **Guardrail Prompts** (booking/pricing/data/emergency)
  - **Custom Prompts** (user-defined)
- Live preview panel (right side):
  - Shows assembled prompt with color-coded sections
  - Real-time updates as settings change
  - Character and token count
- "Reset to Default" button per section
- "Test Prompt" button (calls OpenAI with current settings, shows response)

---

### 6. GENERATION SETTINGS

**How the LLM generates outputs (variants, modes, formats).**

```javascript
{
  generation: {
    mode: "single", // "single" | "multi"
    
    variants: {
      enabled: false,
      defaultCount: 1,
      maxCount: 15,
      diversityLevel: 0.7, // 0-1 (how different should variants be)
      notes: "Generate multiple versions of triggers/replies for A/B testing"
    },
    
    output: {
      format: "json",
      validation: "strict", // "strict" | "relaxed"
      requireSchemaMatch: true,
      allowPartialResults: false
    },
    
    tokens: {
      maxInput: 4000,
      maxOutput: 3000,
      reserveBuffer: 500,
      notes: "Total context window management"
    },
    
    retry: {
      enabled: true,
      maxRetries: 2,
      retryOnInvalidJSON: true,
      retryOnConstraintViolation: true,
      fallbackBehavior: "use_emergency_response" // "use_emergency_response" | "return_error" | "use_last_valid"
    }
  }
}
```

**UI Section:** "Generation Settings"
- Single vs Multi mode toggle
- Variant settings (slider for count, diversity level)
- Token limits configuration
- Retry behavior settings

---

### 7. TESTING & VALIDATION

**Tools to test settings before going live.**

```javascript
{
  testing: {
    testMode: false, // When true, changes don't affect live calls
    
    testScenarios: [
      {
        id: "emergency_test",
        input: "My chest hurts really bad and I can't breathe",
        expectedBehavior: "Immediate 911 escalation",
        domainMode: "medical"
      },
      {
        id: "pricing_test",
        input: "How much does a new AC unit cost?",
        expectedBehavior: "Generic response, route to sales",
        guardrail: "pricing_restriction"
      },
      {
        id: "booking_test",
        input: "Can you book me for Tuesday at 2pm?",
        expectedBehavior: "Explain process, route to booking flow",
        guardrail: "booking_restriction"
      }
    ],
    
    validation: {
      runBeforeSave: true,
      requiredTests: ["emergency_test"], // Must pass before saving
      warningTests: ["pricing_test", "booking_test"] // Warn if fails but allow save
    }
  }
}
```

**UI Section:** "Test & Validate"
- "Test Mode" toggle (preview changes without affecting live)
- Pre-defined test scenarios with expected behaviors
- "Run Test Suite" button
- Pass/fail indicators
- Live testing: Enter custom input, see LLM response with current settings

---

### 8. SCOPE & INHERITANCE

**Multitenant: Global vs Company-specific settings.**

```javascript
{
  scope: {
    current: "global", // "global" | "company:<companyId>"
    
    global: {
      // Settings that apply to all companies by default
      // ...all settings above...
    },
    
    companyOverrides: {
      // Company-specific overrides
      "company:12345": {
        inheritsFrom: "global",
        overrides: {
          profiles: { active: "call_center_optimized" },
          domainSafety: { medical: { enabled: false } },
          guardrails: { tone: { maxCasualness: 0.5 } }
        },
        notes: "HVAC company - more casual tone, no medical restrictions"
      },
      "company:67890": {
        inheritsFrom: "global",
        overrides: {
          profiles: { active: "compliance_safe" },
          domainSafety: { medical: { enabled: true, strictness: "maximum" } },
          guardrails: { compliance: { requireExplicitConsent: true } }
        },
        notes: "Dental office - maximum safety, HIPAA compliance"
      }
    },
    
    inheritanceChain: [
      { level: "global", source: "DEFAULT_LLM_ENTERPRISE_SETTINGS" },
      { level: "company", source: "company:12345 overrides" }
    ]
  }
}
```

**UI Section:** "Scope Selector" (top of page)
- Dropdown: "Global Settings" vs "Company: [Name]"
- Visual indicator showing inheritance
- "View Inheritance Chain" button
- "Reset to Global" button (for company overrides)

---

## UI Layout Structure

### Header
- **Scope Selector**: Global vs Company
- **Active Profile Indicator**: Currently selected profile
- **Save Button**: Persist changes to MongoDB
- **Test Mode Toggle**: Preview without affecting live calls

### Main Content (Tabbed)

#### Tab 1: Overview & Quick Settings
- Current active profile card
- Enabled domain modes badges
- Quick toggles for common settings
- Live prompt preview (read-only summary)

#### Tab 2: Behavior Profiles
- Profile selector
- Model settings (temp, topP, maxTokens)
- Clamp indicators
- Custom profile wizard

#### Tab 3: Behavioral Guardrails
- Sub-tabs:
  - Booking Restrictions
  - Information & Pricing
  - Data Collection
  - Emergency Handling
  - Compliance Rules
  - Tone & Style
  - Response Constraints
  - Custom Guardrails

#### Tab 4: Domain Safety Modes
- Medical Mode settings
- Financial Mode settings
- Legal Mode settings
- Emergency Mode settings
- Custom domain modes

#### Tab 5: Prompt Engineering
- System prompt editor
- Profile-specific prompts
- Domain-specific prompts
- Guardrail enforcement prompts
- Custom prompts
- **Live Preview Panel** (right side, always visible)

#### Tab 6: Generation Settings
- Single vs Multi mode
- Variant configuration
- Token limits
- Retry behavior

#### Tab 7: Test & Validate
- Test mode toggle
- Pre-defined test scenarios
- Custom test input
- Run test suite
- Pass/fail results

### Right Sidebar (Persistent)
- **Live Prompt Preview**
  - Assembled system prompt
  - Color-coded sections
  - Character/token count
  - "Copy to Clipboard" button

### Footer
- Save status indicator
- Last saved timestamp
- Last modified by
- "Reset All to Defaults" button (with confirmation)

---

## API Integration

### Endpoints Used

```javascript
// Load current settings
GET /api/admin/llm-settings?scope=global
GET /api/admin/llm-settings?scope=company:12345

// Save partial updates
PUT /api/admin/llm-settings
Body: { scope: "global", updates: { profiles: { active: "call_center_optimized" } } }

// Reset to defaults
POST /api/admin/llm-settings/reset
Body: { scope: "global", section: "all" | "profiles" | "guardrails" | "prompts" }

// Test prompt (validation endpoint)
POST /api/admin/llm-settings/test
Body: { scope: "global", testInput: "How much does it cost?", expectedBehavior: "route_to_sales" }
```

### Data Flow

```
User edits setting in UI
  ↓
llm.js captures change, updates local state
  ↓
Live preview updates in real-time
  ↓
User clicks "Save"
  ↓
PUT /api/admin/llm-settings { scope, updates }
  ↓
Backend: llmSettingsService.saveSettings() merges with existing
  ↓
MongoDB: LLMSettings.findOneAndUpdate({ scope }, { settings: merged })
  ↓
Response: { success: true, settings: fullMergedSettings, promptParts }
  ↓
UI updates with saved settings + confirmation toast
```

---

## Success Criteria

✅ **Every LLM behavior is visible** - No hidden prompts or constraints  
✅ **Every setting is editable** - Admin can customize for their business  
✅ **Changes are testable** - Test mode + validation before going live  
✅ **Changes are traceable** - Audit log with timestamps and user info  
✅ **Changes are safe** - Clamps and validation prevent dangerous configs  
✅ **Changes are scoped** - Global vs company-specific with inheritance  
✅ **Changes are live-previewed** - See assembled prompt in real-time  

---

## Next Steps

1. **User reviews this spec** - Confirm all settings are captured
2. **User answers scope question** - V1 global-only, or include company overrides?
3. **User approves UI layout** - Tab structure and sidebar preview
4. **Build begins** - Create `llm.html` + `llm.js` with full governance UI
