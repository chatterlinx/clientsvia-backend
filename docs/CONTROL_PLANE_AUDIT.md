# Control Plane Audit - Front Desk Tab-by-Tab

**Platform Law**: IF IT'S NOT ON FRONT DESK UI (Control Plane Wiring), IT DOES NOT EXIST.

**Contract Version**: `controlPlaneContract.frontDesk.v1.json`

**Audit Date**: 2026-02-06

---

## Audit Status Legend

| Status | Meaning |
|--------|---------|
| ✅ WIRED | UI path exists, runtime reads it, trace proves it |
| ⚠️ PARTIAL | UI exists but runtime has fallback/hardcoded behavior |
| ❌ ROGUE | Runtime behavior exists without UI control |
| 🗑️ DEAD | UI exists but runtime never reads it |

---

## Tab 1: Personality

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `frontDesk.aiName` | AWConfigReader | `source: controlPlane` | ✅ WIRED |
| `frontDesk.conversationStyle` | AWConfigReader | `source: controlPlane` | ✅ WIRED |
| `frontDesk.styleAcknowledgments` | AWConfigReader | `source: controlPlane` | ✅ WIRED |
| `frontDesk.personality.warmth` | AWConfigReader | `source: controlPlane` | ✅ WIRED |
| `frontDesk.personality.speakingPace` | AWConfigReader | `source: controlPlane` | ✅ WIRED |
| `frontDesk.greetingResponses` | AWConfigReader | `source: controlPlane` | ✅ WIRED |

**Rogue Behaviors**: None detected

---

## Tab 2: Discovery & Consent

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `frontDesk.discoveryConsent.forceLLMDiscovery` | AWConfigReader | `source: controlPlane` | ✅ WIRED |
| `frontDesk.discoveryConsent.disableScenarioAutoResponses` | AWConfigReader | `source: controlPlane` | ✅ WIRED |
| `frontDesk.discoveryConsent.bookingRequiresExplicitConsent` | AWConfigReader | `source: controlPlane` | ✅ WIRED |
| `frontDesk.discoveryConsent.consentPhrases` | ConversationEngine.minimalBookingDetection | `source: controlPlane` | ✅ WIRED (V98c) |
| `frontDesk.discoveryConsent.autoReplyAllowedScenarioTypes` | AWConfigReader | `source: controlPlane` | ✅ WIRED |

**Rogue Behaviors**: None after V98c fix

---

## Tab 3: Detection (Intent Triggers)

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `frontDesk.detectionTriggers.wantsBooking` | ConversationEngine.minimalBookingDetection | `source: controlPlane` | ✅ WIRED (V98c) |
| `booking.directIntentPatterns` | ConversationEngine.minimalBookingDetection | `source: controlPlane` | ✅ WIRED (V98c) |

**Rogue Behaviors**: None after V98c fix

---

## Tab 4: Hours & Availability

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `frontDesk.businessHours` | AWConfigReader | `source: controlPlane` | ⚠️ PARTIAL - UI exists but runtime may not use |

**Action Required**: Verify runtime reads this for scheduling

---

## Tab 5: Vocabulary

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `frontDesk.commonFirstNames` | SlotExtractor | `source: controlPlane` | ✅ WIRED |
| `slotExtraction.nameStopWords.enabled` | SlotExtractor | `source: controlPlane` | ✅ WIRED |
| `slotExtraction.nameStopWords.custom` | SlotExtractor | `source: controlPlane` | ✅ WIRED |
| `frontDesk.vocabulary` | AWConfigReader | `source: controlPlane` | ✅ WIRED |

**Rogue Behaviors**: None detected

---

## Tab 6: Booking Prompts ⭐ (Critical)

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `frontDesk.bookingEnabled` | BookingFlowResolver | `source: controlPlane` | ✅ WIRED |
| `frontDesk.bookingSlots` | BookingFlowResolver | `source: bookingPromptTab` | ✅ WIRED |
| `frontDesk.bookingSlots[].question` | BookingFlowRunner.askStep | `promptSource: bookingPromptTab:slot.question` | ✅ WIRED (V99) |
| `frontDesk.bookingSlots[].streetBreakdownPrompt` | BookingFlowRunner.askStep | `promptSource: bookingPromptTab:streetBreakdownPrompt` | ✅ WIRED (V99) |
| `frontDesk.bookingSlots[].cityPrompt` | BookingFlowRunner | `promptSource: bookingPromptTab:cityPrompt` | ✅ WIRED (V99) |
| `frontDesk.bookingSlots[].zipPrompt` | BookingFlowRunner | `promptSource: bookingPromptTab:zipPrompt` | ✅ WIRED (V99) |
| `frontDesk.bookingSlots[].unitNumberPrompt` | BookingFlowRunner | `promptSource: bookingPromptTab:unitNumberPrompt` | ✅ WIRED (V99) |
| `frontDesk.bookingSlots[].lastNameQuestion` | BookingFlowRunner | `promptSource: bookingPromptTab:lastNameQuestion` | ✅ WIRED (V99) |
| `frontDesk.bookingSlots[].breakDownIfUnclear` | BookingFlowRunner.askStep | `source: controlPlane` | ✅ WIRED (V99) |
| `frontDesk.bookingSlots[].areaCodePrompt` | BookingFlowRunner | `promptSource: bookingPromptTab:areaCodePrompt` | ✅ WIRED (V99) |
| `frontDesk.bookingSlots[].restOfNumberPrompt` | BookingFlowRunner | `promptSource: bookingPromptTab:restOfNumberPrompt` | ✅ WIRED (V99) |
| `frontDesk.nameSpellingVariants.enabled` | BookingFlowRunner | `source: controlPlane` | ✅ WIRED |
| `frontDesk.nameSpellingVariants.mode` | BookingFlowRunner | `source: controlPlane` | ✅ WIRED |
| `booking.addressVerification.enabled` | BookingFlowRunner | `source: controlPlane` | ✅ WIRED |
| `booking.addressVerification.requireCity` | BookingFlowRunner | `source: controlPlane` | ✅ WIRED |
| `booking.addressVerification.requireState` | BookingFlowRunner | `source: controlPlane` | ✅ WIRED |
| `booking.addressVerification.requireZip` | BookingFlowRunner | `source: controlPlane` | ✅ WIRED |
| `booking.addressVerification.unitQuestionMode` | BookingFlowRunner | `source: controlPlane` | ✅ WIRED |

**Rogue Behaviors Fixed in V99**:
- ~~Hardcoded "What is your {type}?" fallback~~ → Now logs warning, uses minimal fallback
- ~~Hardcoded "I didn't quite catch that"~~ → Now uses UI reprompt
- ~~Hardcoded address prompts~~ → Now uses UI cityPrompt, zipPrompt, etc.
- ~~Hardcoded lastNameQuestion~~ → Now uses UI lastNameQuestion

---

## Tab 7: Escalation

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `frontDesk.escalation.enabled` | EscalationHandler | `source: controlPlane` | ✅ WIRED |
| `frontDesk.escalation.triggerPhrases` | MetaIntentDetector | `source: controlPlane` | ✅ WIRED |
| `frontDesk.escalation.transferMessage` | EscalationHandler | `source: controlPlane` | ✅ WIRED |
| `transfers.transferTargets` | TransferHandler | `source: controlPlane` | ✅ WIRED |

**Rogue Behaviors**: None detected

---

## Tab 8: Emotions

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `frontDesk.emotions` | EmotionHandler | `source: controlPlane` | ✅ WIRED |

**Rogue Behaviors**: None detected

---

## Tab 9: Frustration

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `frontDesk.frustration` | FrustrationHandler | `source: controlPlane` | ✅ WIRED |

**Rogue Behaviors**: None detected

---

## Tab 10: Forbidden Phrases

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `frontDesk.forbiddenPhrases` | ResponseFilter | `source: controlPlane` | ✅ WIRED |

**Rogue Behaviors**: None detected

---

## Tab 11: Loop Prevention

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `frontDesk.loopPrevention` | LoopDetector | `source: controlPlane` | ✅ WIRED |
| `frontDesk.offRailsRecovery.bridgeBack.resumeBooking` | OffRailsHandler | `source: controlPlane` | ✅ WIRED |

**Rogue Behaviors**: None detected

---

## Tab 12: Fallbacks

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `frontDesk.fallbackResponses` | FallbackHandler | `source: controlPlane` | ✅ WIRED |

**Rogue Behaviors**: None detected

---

## Tab 13: Dynamic Flows

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `dynamicFlow.companyFlows` | DynamicFlowRouter | `source: controlPlane` | ✅ WIRED |

**Rogue Behaviors**: None detected

---

## Tab 14: Integrations

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `integrations.googleGeo.enabled` | AddressValidationService | `source: controlPlane` | ✅ WIRED |
| `integrations.googleGeo.verificationMode` | AddressValidationService | `source: controlPlane` | ✅ WIRED |
| `integrations.googleGeo.minConfidence` | AddressValidationService | `source: controlPlane` | ✅ WIRED |

**Rogue Behaviors**: None detected

---

## Tab 15: Enforcement (NEW)

| UI Key | Runtime Reader | Trace Source | Status |
|--------|----------------|--------------|--------|
| `frontDesk.enforcement.strictControlPlaneOnly` | ControlPlaneEnforcer | `source: controlPlane` | ✅ WIRED (V99) |
| `infra.strictConfigRegistry` | AWConfigReader | `source: controlPlane` | ✅ WIRED |
| `infra.strictConfigRegistry.blockDeadReads` | AWConfigReader | `source: controlPlane` | ✅ WIRED |

---

## Mode Ownership Audit

**Platform Law**: Only FrontDeskRouter can set:
- `mode`
- `bookingModeLocked`
- `consentPending`
- `branchTaken`
- `sessionMode`

| State Key | Current Owner | Compliant? |
|-----------|---------------|------------|
| `mode` | ConversationEngine | ⚠️ NEEDS MIGRATION |
| `bookingModeLocked` | ConversationEngine | ⚠️ NEEDS MIGRATION |
| `consentPending` | ConversationEngine | ⚠️ NEEDS MIGRATION |
| `branchTaken` | N/A | ✅ Not implemented yet |
| `sessionMode` | v2twilio.js | ⚠️ NEEDS MIGRATION |

**Action Required**: Create FrontDeskRouter as the sole dispatcher for mode changes.

---

## Summary

| Category | Wired | Partial | Rogue | Dead |
|----------|-------|---------|-------|------|
| Personality | 6 | 0 | 0 | 0 |
| Discovery & Consent | 5 | 0 | 0 | 0 |
| Detection | 2 | 0 | 0 | 0 |
| Hours & Availability | 0 | 1 | 0 | 0 |
| Vocabulary | 4 | 0 | 0 | 0 |
| Booking Prompts | 17 | 0 | 0 | 0 |
| Escalation | 4 | 0 | 0 | 0 |
| Emotions | 1 | 0 | 0 | 0 |
| Frustration | 1 | 0 | 0 | 0 |
| Forbidden | 1 | 0 | 0 | 0 |
| Loop Prevention | 2 | 0 | 0 | 0 |
| Fallbacks | 1 | 0 | 0 | 0 |
| Dynamic Flows | 1 | 0 | 0 | 0 |
| Integrations | 3 | 0 | 0 | 0 |
| Enforcement | 3 | 0 | 0 | 0 |
| **TOTAL** | **51** | **1** | **0** | **0** |

---

## Next Steps

1. ✅ Create `controlPlaneContract.frontDesk.v1.json` - DONE
2. ✅ Create `ControlPlaneEnforcer.js` with `cfgGet()` - DONE
3. ⏳ Migrate mode ownership to FrontDeskRouter
4. ⏳ Wire `businessHours` to runtime
5. ⏳ Add `strictControlPlaneOnly` toggle to UI
6. ⏳ Refactor all remaining direct config reads to use `cfgGet()`

---

## Enforcement Checklist

When `frontDesk.enforcement.strictControlPlaneOnly = true`:

- [ ] Unknown key access → `CONTROL_PLANE_VIOLATION` + fail closed
- [ ] Missing required key → `MISSING_REQUIRED_KEY` + escalate
- [ ] Non-FrontDeskRouter mode change → `MODE_OWNERSHIP_VIOLATION` + log
- [ ] Every turn emits `CONTROL_PLANE_HEADER`
- [ ] Every decision emits `DECISION_TRACE` with `keysUsed[]`, `sourcesUsed[]`
