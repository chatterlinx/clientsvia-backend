# V96j Nuke Clean Sweep Inventory

## Date: Feb 4, 2026
## Purpose: Systematic cleanup of legacy speaker paths and slot contamination sources

---

## PHASE 1: LEGACY SPEAKER INVENTORY

### Modules That Can Output Replies

| File | Role | Can Speak During Booking? | Status |
|------|------|---------------------------|--------|
| `routes/v2twilio.js` | Top-level routing + final response | YES (controls all) | ✅ OWNER GATE ADDED |
| `services/ConversationEngine.js` | Scenarios, LLM, inline booking mode | WAS YES → NOW DEFERS | ✅ BOOKING_MODE GUARDED |
| `services/engine/booking/BookingFlowRunner.js` | Deterministic booking | YES (intended owner) | ✅ PRIMARY SPEAKER |
| `services/ConversationStateMachine.js` | Rule-based conversation | SHOULD NOT | ⚠️ NEEDS REVIEW |
| `services/HybridReceptionistLLM.js` | LLM tier 3 fallback | SHOULD NOT when locked | ✅ GATED BY ENGINE |
| `services/ResponseEngine.js` | Response building | N/A (not a speaker) | ✅ OK |
| ~~`services/DynamicFlowEngine.js`~~ | ~~Dynamic flows~~ | N/A | ☢️ NUKED Feb 2026 (V110 replaces) |
| `services/SMSConversationHandler.js` | SMS channel | Different channel | ✅ OK |
| `services/ServiceAreaHandler.js` | Service area responses | N/A | ✅ OK |
| `services/AIBrain3tierllm.js` | Legacy AI brain | DEPRECATED? | ⚠️ CHECK IF USED |

### Speaker Ownership Contract (ENFORCED)

| Mode | Owner | Others Blocked? |
|------|-------|-----------------|
| DISCOVERY | ConversationEngine | N/A |
| BOOKING (locked) | BookingFlowRunner | ✅ YES (V96j) |
| TRANSFER | TransferHandler | ✅ YES |
| ERROR | FallbackHandler | ✅ YES |

---

## PHASE 4: IDENTITY SLOT WRITERS INVENTORY

### Files That Write Identity Slots Directly

| File | Line(s) | What It Writes | Through Firewall? | Status |
|------|---------|----------------|-------------------|--------|
| `BookingFlowRunner.js` | ~150 | `state.bookingCollected[slotName]` | ✅ YES (safeSetSlot→Firewall) | ✅ FIXED V96j |
| `BookingFlowRunner.js` | ~782 | `state.bookingCollected.address` | ✅ YES (via safeSetSlot) | ✅ FIXED V96j |
| `ConversationStateMachine.js` | ~835 | `this.booking.collectedSlots.name` | ✅ YES (via _safeWriteSlot) | ✅ FIXED V96j |
| `ConversationStateMachine.js` | ~856-858 | `.phone`, `.address`, `.time` | ✅ YES (via _safeWriteSlot) | ✅ FIXED V96j |
| `ConversationStateMachine.js` | ~1568-1602 | Multiple slots | ✅ YES (via _safeWriteSlot) | ✅ FIXED V96j |
| `ConversationEngine.js` | ~7227+ | `session.booking.activeSlot` | N/A (metadata, not value) | ✅ OK |
| `BookingNameHandler.js` | ~105-170 | `ctx.slots.*` | ❌ NO | ⚠️ NEEDS REVIEW |
| `SlotExtractor.js` | mergeSlots | Merges into slots object | ✅ Has IdentityValidators | ✅ OK |

### Direct Write Patterns Found (grep results)

```
bookingCollected.address = (BookingFlowRunner.js:782)
booking.collectedSlots.name = (ConversationStateMachine.js:835,846,1568,1580)
booking.collectedSlots.phone = (ConversationStateMachine.js:856,1594)
booking.collectedSlots.address = (ConversationStateMachine.js:857,1598)
booking.collectedSlots.time = (ConversationStateMachine.js:858,1602)
ctx.slots.* = (BookingNameHandler.js: multiple)
```

---

## PHASE 5: BOOKING_SNAP GHOST CLEANUP

### Files Still Referencing BOOKING_SNAP

| File | Status |
|------|--------|
| `FlowTreeDefinition.js` | ✅ REMOVED (V96j) → ☢️ FILE DELETED (Feb 2026 - Flow Tree nuke) |
| `v2twilio.js` | ✅ REMOVED from usedPath (V96j) |
| `ConversationEngine.js` | ⚠️ Has comments + debug checks |

---

## ACTION ITEMS

### Completed (V96j)
- [x] SPEAKER_OWNER_TRACE_V1 added
- [x] IDENTITY_CONTRACT_VIOLATION in IdentitySlotFirewall
- [x] Booking gate in v2twilio.js with defer handling
- [x] ConversationEngine BOOKING_MODE block guarded
- [x] BookingFlowRunner.safeSetSlot routes through IdentitySlotFirewall
- [x] BOOKING_SNAP removed from FlowTreeDefinition → ☢️ FILE DELETED (Feb 2026 - Flow Tree nuke)
- [x] Direct address write in BookingFlowRunner.js:782 fixed (via safeSetSlot)
- [x] ConversationStateMachine slot writes routed through firewall (via _safeWriteSlot helper)
- [x] CONFIRMATION prompt now configurable via Booking Prompt tab (bookingBehavior.confirmationPrompt)
- [x] Added booking behavior options: enforcePromptOrder, confirmIfPreFilled, alwaysAskEvenIfFilled
- [x] BookingFlowResolver reads templates from multiple config paths with source tracking
- [x] Logging added for hardcoded vs configured templates
- [x] **FEB 5 FIX**: BookingFlowResolver now reads confirmTemplate from correct UI path (frontDeskBehavior.bookingTemplates, frontDeskBehavior.bookingPrompts)
- [x] **FEB 5 FIX**: SPEAKER_OWNER_TRACE_V1 now includes `promptSource` field showing exact origin of each response
- [x] **FEB 5 FIX**: BookingFlowRunner askStep/repromptStep/buildConfirmation/buildCompletion include promptSource in debug
- [x] **FEB 5 FIX**: branchTaken now correctly shows BOOKING_RUNNER (not NORMAL_ROUTING) when booking gate active

### Remaining Work
- [ ] Review BookingNameHandler.js slot writes (CONFIRMED UNUSED - safe to deprecate)
- [x] ~~Review DynamicFlowEngine.js for booking mode bypass~~ — ☢️ NUKED Feb 2026: DynamicFlowEngine removed entirely (V110 replaces)
- [ ] Check if AIBrain3tierllm.js is still used (deprecate if not)
- [ ] Remove remaining BOOKING_SNAP references in ConversationEngine.js comments

---

## V96j: STRICT CONFIG REGISTRY (Feb 5 - Nuke Clean Sweep)

### New Config Paths (per-company enforcement)

```javascript
// Enable strict mode for Penguin Air only:
db.companies.updateOne(
  { _id: ObjectId("68e3f77a9d623b8058c700c4") },
  { $set: { 
    "aiAgentSettings.infra.strictConfigRegistry": true,
    // Optional: block reads to unregistered paths entirely
    "aiAgentSettings.infra.strictConfigRegistry.blockDeadReads": false,
    // Optional: allowlist paths during gradual migration
    "aiAgentSettings.infra.strictConfigRegistry.allowlist": []
  }}
)
```

### New Events

| Event | When | What It Means |
|-------|------|---------------|
| `CONFIG_REGISTRY_VIOLATION` | Runtime reads unregistered path | DEAD_READ detected - legacy reader bypassing Control Plane |
| `BOOKING_VOICE_COLLISION` | Non-BookingFlowRunner speaks when `bookingModeLocked=true` | Multiple booking systems alive - "split brain" bug |

### How to Use

1. **Enable strict mode for one company** (Penguin Air recommended)
2. **Run 3-5 test calls** through the full booking flow
3. **Check Raw Events** for `CONFIG_REGISTRY_VIOLATION` events
4. **For each DEAD_READ**:
   - If the path should be registered: add to `wiringRegistry.v2.js`
   - If the reader is legacy: remove or migrate the code
   - Temporary escape: add to allowlist
5. **Check for `BOOKING_VOICE_COLLISION`** - each one is a bug where ConversationEngine or another module spoke when it shouldn't have

### Expected DEAD_READ Paths (from screenshot)

These were flagged in the wiring audit and need resolution:

| Path | Status | Action Needed |
|------|--------|---------------|
| `booking.addressVerification` | DEAD_READ | Already has LEGACY_BRIDGE - migration in progress |
| `booking.nameParsing` | DEAD_READ | Already has LEGACY_BRIDGE - migration in progress |
| `frontDesk.nameSpellingVariants` | DEAD_READ | Has full AW path - check reader location |
| `infra.scenarioPoolCache` | DEAD_READ | Infrastructure path - add to registry |
| `integrations.googleCalendar.*` | DEAD_READ | Integration paths - add to registry or remove |
| `integrations.smsNotifications.*` | DEAD_READ | Integration paths - add to registry or remove |

### Expected WIRED + NOT_READ Paths

These are configured in UI but runtime never reads them:

| Path | Likely Cause |
|------|--------------|
| `booking.addressVerification.enabled` | Runtime reads parent object instead |
| `booking.directIntentPatterns` | Runtime reads different path |
| `booking.addressVerification.requireCity` etc | Runtime reads parent object |

**Fix**: Change runtime code to use AWConfigReader.get() with the exact wired path

---

## V96j BOOKING CONFIGURATION OPTIONS

### New Config Paths (in frontDeskBehavior)

```javascript
// In company.aiAgentSettings.frontDeskBehavior:
{
  bookingBehavior: {
    // Custom confirmation message (replaces hardcoded "Let me confirm...")
    confirmationPrompt: "Great! So I have {name} calling from {phone}, and you need service at {address}. Is that all correct?",
    
    // Custom completion message
    completionPrompt: "Awesome! You're all set. A technician will be in touch soon.",
    
    // If true, always ask questions in configured order even if slots pre-filled
    enforcePromptOrder: false,
    
    // If true, ask to confirm pre-filled slots (from discovery/caller ID)
    // If false, accept pre-filled values without confirmation
    confirmIfPreFilled: true,
    
    // Array of slots to always ask even if pre-filled (e.g., ["phone", "address"])
    alwaysAskEvenIfFilled: []
  },
  
  // Alternative config path (also checked)
  bookingOutcome: {
    confirmationPrompt: "...",
    scripts: {
      final_confirmation: "...",
      booking_complete: "..."
    }
  }
}
```

### Template Source Priority (V96j Feb 5 FIX)
1. `bookingBehavior.confirmationPrompt` (Booking Prompt tab - new field)
2. `bookingOutcome.confirmationPrompt`
3. `bookingOutcome.scripts.final_confirmation`
4. `frontDeskBehavior.bookingPrompts.confirmTemplate` (UI writes here!)
5. `frontDeskBehavior.bookingTemplates.confirmTemplate` (UI also writes here!)
6. Hardcoded default (last resort - logged with warning)

**FIX APPLIED**: BookingFlowResolver was reading from `aiAgentSettings.bookingTemplates` 
but the UI saves to `frontDeskBehavior.bookingTemplates`. Now reads from correct path.

---

## VERIFICATION CHECKLIST

After fixes, verify with test call:

1. [ ] `SPEAKER_OWNER_TRACE_V1` shows `responseOwner: BOOKING_FLOW_RUNNER` when locked
2. [ ] `SPEAKER_OWNER_TRACE_V1` shows `promptSource: booking.step:name` (or relevant step) - NOT "UNKNOWN"
3. [ ] `branchTaken` shows `BOOKING_RUNNER` (not `NORMAL_ROUTING`) when booking gate active
4. [ ] Confirmation message comes from config (check `promptSource: booking.confirmationTemplate:bookingPrompts` or `bookingTemplates`)
5. [ ] No `IDENTITY_CONTRACT_VIOLATION` events in normal flow
6. [ ] No `BOOKING_VOICE_COLLISION` events when `bookingModeLocked=true`
7. [ ] (With strict mode) No `CONFIG_REGISTRY_VIOLATION` events for expected paths
3. [ ] No `BOOKING_SNAP` appears in any matchSource
4. [ ] Name slot cannot be contaminated with non-name values
5. [ ] ConversationEngine does not speak when `bookingModeLocked=true`
