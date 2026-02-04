# Agent Wiring (AW) Platform Audit Report
**Generated:** 2026-02-04
**Status:** CRITICAL GAPS IDENTIFIED

---

## Executive Summary

| Metric | Count |
|--------|-------|
| Fields in AW Registry | **67** |
| Config sections saved by UI | **~120+** |
| Estimated Coverage | **~40%** |
| **GAPS IDENTIFIED** | **~70+ fields** |

---

## 🟢 COVERED (In Registry + Has UI + Runtime Reads)

These fields are properly wired:

### Front Desk Core
| Field ID | UI Location | Status |
|----------|-------------|--------|
| `frontDesk.aiName` | Front Desk → Personality | ✅ WIRED |
| `frontDesk.conversationStyle` | Front Desk → Personality | ✅ WIRED |
| `frontDesk.styleAcknowledgments` | Front Desk → Personality | ✅ WIRED |
| `frontDesk.personality.warmth` | Front Desk → Personality | ✅ WIRED |
| `frontDesk.personality.speakingPace` | Front Desk → Personality | ✅ WIRED |
| `frontDesk.greetingResponses` | Front Desk → Greetings | ✅ WIRED |
| `frontDesk.businessHours` | Front Desk → Hours | ✅ WIRED |

### Discovery & Consent
| Field ID | UI Location | Status |
|----------|-------------|--------|
| `frontDesk.discoveryConsent.forceLLMDiscovery` | Front Desk → Discovery | ✅ WIRED |
| `frontDesk.discoveryConsent.disableScenarioAutoResponses` | Front Desk → Discovery | ✅ WIRED |
| `frontDesk.discoveryConsent.bookingRequiresExplicitConsent` | Front Desk → Discovery | ✅ WIRED |
| `frontDesk.discoveryConsent.consentPhrases` | Front Desk → Discovery | ✅ WIRED |

### Booking
| Field ID | UI Location | Status |
|----------|-------------|--------|
| `frontDesk.bookingEnabled` | Front Desk → Booking | ✅ WIRED |
| `frontDesk.bookingSlots` | Front Desk → Booking Prompts | ✅ WIRED |
| `frontDesk.commonFirstNames` | Front Desk → Slot Extraction | ✅ WIRED |
| `booking.nameParsing.*` | Front Desk → Name Parsing | ✅ WIRED (V92) |
| `booking.addressVerification.*` | Front Desk → Address | ✅ WIRED (V93) |

### Escalation & Loop Prevention
| Field ID | UI Location | Status |
|----------|-------------|--------|
| `frontDesk.escalation.enabled` | Front Desk → Escalation | ✅ WIRED |
| `frontDesk.escalation.triggerPhrases` | Front Desk → Escalation | ✅ WIRED |
| `frontDesk.loopPrevention` | Front Desk → Loop Prevention | ✅ WIRED |

### Data & Config
| Field ID | UI Location | Status |
|----------|-------------|--------|
| `dataConfig.templateReferences` | Data & Config → Templates | ✅ WIRED |
| `dataConfig.scenarios` | Data & Config → Scenarios | ✅ WIRED |
| `dynamicFlow.companyFlows` | Dynamic Flow | ✅ WIRED |

### Integrations
| Field ID | UI Location | Status |
|----------|-------------|--------|
| `integrations.googleGeo.*` | Integrations → Google Geo | ✅ WIRED (V93) |
| `integrations.googleCalendar.*` | Integrations → Calendar | ✅ WIRED |
| `integrations.smsNotifications.*` | Integrations → SMS | ✅ WIRED |

### Transfers
| Field ID | UI Location | Status |
|----------|-------------|--------|
| `transfers.transferTargets` | Transfer Calls | ✅ WIRED |

---

## 🔴 CRITICAL GAPS (UI Exists → NOT in Registry)

These fields exist in the UI and are being saved, but AW doesn't track them:

### FrontDeskBehaviorManager Gaps

| Missing Field | UI Location | Endpoint | Impact |
|---------------|-------------|----------|--------|
| `bookingInterruption.*` | Front Desk → Booking Behavior | `/api/admin/front-desk-behavior` | Interruption handling invisible to AW |
| `serviceFlow.*` | Front Desk → Service Flow | `/api/admin/front-desk-behavior` | Trade-based prompts invisible |
| `vendorHandling.*` | Front Desk → Vendor | `/api/admin/front-desk-behavior` | Vendor prompts invisible |
| `unitOfWork.*` | Front Desk → Unit of Work | `/api/admin/front-desk-behavior` | Multi-booking confirmation invisible |
| `afterHoursMessageContract` | Front Desk → After Hours | `/api/admin/front-desk-behavior` | After-hours behavior invisible |
| `bookingOutcome.*` | Front Desk → Booking Outcome | `/api/admin/front-desk-behavior` | Outcome mode invisible |
| `modeSwitching.*` | Front Desk → Mode Switching | `/api/admin/front-desk-behavior` | Mode switch rules invisible |
| `detectionTriggers.wantsBooking` | Front Desk → Detection | `/api/admin/front-desk-behavior` | Booking detection invisible |
| `vocabularyGuardrails.*` | Front Desk → Vocabulary | `/api/admin/front-desk-behavior` | Forbidden words invisible |
| `callerVocabulary.*` | Front Desk → Caller Vocab | `/api/admin/front-desk-behavior` | Synonym translations invisible |
| `fillerWords.custom` | Front Desk → Filler Words | `/api/admin/front-desk-behavior` | Custom fillers invisible |
| `nameSpellingVariants.*` | Front Desk → Name Spelling | `/api/admin/front-desk-behavior` | Spelling variants invisible |
| `bookingPrompts.*` | Front Desk → Booking Prompts | `/api/admin/front-desk-behavior` | Prompt templates invisible |
| `bookingTemplates.*` | Front Desk → Booking Templates | `/api/admin/front-desk-behavior` | Confirm/complete templates invisible |
| `promptGuards.*` | Front Desk → Prompt Guards | `/api/admin/front-desk-behavior` | Missing prompt fallback invisible |

### STTSettingsManager Gaps (ENTIRE MANAGER NOT IN AW)

| Missing Field | UI Location | Endpoint | Impact |
|---------------|-------------|----------|--------|
| `aiGuards.*` | STT Settings → AI Guards | `/api/company/:id` | Phase/generic/turn1 guards invisible |
| `callExperience.*` | STT Settings → Call Experience | `/api/company/:id/call-experience` | Timing/interruption settings invisible |
| `sttProvider.*` | STT Settings → Provider | `/api/admin/stt-profile/:id/provider` | STT provider config invisible |
| `fillerWords` | STT Settings → Fillers | `/api/admin/stt-profile/:id/fillers` | Filler word list invisible |
| `vocabulary` | STT Settings → Vocabulary | `/api/admin/stt-profile/:id/vocabulary` | Boost keywords invisible |
| `corrections` | STT Settings → Corrections | `/api/admin/stt-profile/:id/corrections` | STT corrections invisible |
| `impossibleWords` | STT Settings → Impossible | `/api/admin/stt-profile/:id/impossible-words` | Blocked words invisible |
| `speakingCorrections` | STT Settings → Speaking | `/api/admin/stt-profile/:id/speaking-corrections` | Output corrections invisible |

### CallProtectionManager Gaps (ENTIRE MANAGER NOT IN AW)

| Missing Field | UI Location | Endpoint | Impact |
|---------------|-------------|----------|--------|
| `edgeCases[]` | Call Protection → Edge Cases | `/api/admin/cheatsheet/:id/edge-cases` | All spam/edge case rules invisible |
| `edgeCases[].match.keywordsAny` | Call Protection → Keywords | Same | Detection patterns invisible |
| `edgeCases[].action.*` | Call Protection → Actions | Same | Hangup/transfer/response actions invisible |
| `edgeCases[].sideEffects.*` | Call Protection → Effects | Same | Blacklist/tagging invisible |

### QuickAnswersManager Gaps (ENTIRE MANAGER NOT IN AW)

| Missing Field | UI Location | Endpoint | Impact |
|---------------|-------------|----------|--------|
| `quickAnswers[]` | Data & Config → Quick Answers | `/api/admin/quick-answers/:id` | All Q&A pairs invisible |
| `quickAnswers[].question` | Quick Answers → Question | Same | Question text invisible |
| `quickAnswers[].answer` | Quick Answers → Answer | Same | Answer text invisible |
| `quickAnswers[].triggers` | Quick Answers → Triggers | Same | Match triggers invisible |
| `quickAnswers[].category` | Quick Answers → Category | Same | Category invisible |

### CheatSheetManager Gaps (ENTIRE MANAGER NOT IN AW)

| Missing Field | UI Location | Endpoint | Impact |
|---------------|-------------|----------|--------|
| `cheatSheet.frontlineIntel` | Cheat Sheet → Instructions | `/api/company/:id` | Company instructions invisible |
| `cheatSheet.behaviorRules[]` | Cheat Sheet → Behavior | Same | Behavior rules invisible |
| `cheatSheet.guardrails[]` | Cheat Sheet → Guardrails | Same | Safety rules invisible |
| `cheatSheet.allowedActions[]` | Cheat Sheet → Actions | Same | Action allowlist invisible |
| `cheatSheet.bookingRules[]` | Cheat Sheet → Booking | Same | Booking rules invisible |
| `cheatSheet.companyContacts[]` | Cheat Sheet → Contacts | Same | Contact directory invisible |
| `cheatSheet.links[]` | Cheat Sheet → Links | Same | Reference links invisible |
| `cheatSheet.calculators[]` | Cheat Sheet → Calculators | Same | Calculators invisible |
| `manualTriageRules[]` | Cheat Sheet → Triage | Same | Manual triage invisible |

### TransferDirectoryManager Gaps

| Missing Field | UI Location | Endpoint | Impact |
|---------------|-------------|----------|--------|
| `companyContacts[]` | Transfer → Contacts | `/api/cheatsheet/:id/company-contacts` | Contact directory invisible |
| `transferRules[]` | Transfer → Rules | `/api/cheatsheet/:id/transfer-rules` | Transfer routing invisible |

### AiCoreLiveScenariosManager Gaps

| Missing Field | UI Location | Endpoint | Impact |
|---------------|-------------|----------|--------|
| `scenarioOverrides[]` | Data → Scenarios | `/api/company/:id/overrides/scenarios` | Enable/disable state invisible |
| `scenarioOverrides[].fallbackPreference` | Data → Scenarios | Same | Fallback behavior invisible |
| `scenarioOverrides[].quickReply` | Data → Scenarios | Same | Custom replies invisible |

---

## 📊 Gap Summary by Manager

| Manager | Total Fields | In Registry | Gap |
|---------|--------------|-------------|-----|
| FrontDeskBehaviorManager | ~50 | ~25 | **~25** |
| STTSettingsManager | ~15 | 0 | **~15** |
| CallProtectionManager | ~10 | 0 | **~10** |
| QuickAnswersManager | ~5 | 0 | **~5** |
| CheatSheetManager | ~15 | 0 | **~15** |
| TransferDirectoryManager | ~5 | ~1 | **~4** |
| AiCoreLiveScenariosManager | ~5 | 0 | **~5** |
| **TOTAL** | **~105** | **~26** | **~79** |

---

## 🚨 Priority Action Plan

### P0 - CRITICAL (Affects call behavior)
1. Add `callExperience.*` to registry (timing/interruption)
2. Add `aiGuards.*` to registry (safety checks)
3. Add `edgeCases[]` to registry (spam blocking)
4. Add `cheatSheet.guardrails[]` to registry (safety rules)

### P1 - HIGH (Affects booking flow)
1. Add `bookingInterruption.*` to registry
2. Add `bookingPrompts.*` to registry
3. Add `bookingTemplates.*` to registry
4. Add `unitOfWork.*` to registry

### P2 - MEDIUM (Affects conversation quality)
1. Add `quickAnswers[]` to registry
2. Add `vocabularyGuardrails.*` to registry
3. Add `callerVocabulary.*` to registry
4. Add `sttProvider.*` and corrections to registry

### P3 - LOW (Nice to have)
1. Add `cheatSheet.links[]` to registry
2. Add `cheatSheet.calculators[]` to registry
3. Add `nameSpellingVariants.*` to registry

---

## Recommendations

1. **Expand wiringRegistry.v2.js** to include ALL fields from this report
2. **Add runtime readers** in runtimeReaders.map.js for each new field
3. **Emit CONFIG_READ** events when runtime accesses these fields
4. **Re-run audit** monthly to catch new gaps

---

## Next Steps

To achieve 100% coverage:
1. Add 79 missing field definitions to registry
2. Map each to its DB path
3. Add runtime reader mappings
4. Verify with CONFIG_READ events in Raw Events

**Estimated effort:** ~8-16 hours of registry expansion
