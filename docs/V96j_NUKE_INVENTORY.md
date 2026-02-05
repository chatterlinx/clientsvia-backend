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
| `services/DynamicFlowEngine.js` | Dynamic flows | SHOULD NOT when locked | ⚠️ NEEDS REVIEW |
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
| `FlowTreeDefinition.js` | ✅ REMOVED (V96j) |
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
- [x] BOOKING_SNAP removed from FlowTreeDefinition
- [x] Direct address write in BookingFlowRunner.js:782 fixed (via safeSetSlot)
- [x] ConversationStateMachine slot writes routed through firewall (via _safeWriteSlot helper)
- [x] CONFIRMATION prompt now configurable via Booking Prompt tab (bookingBehavior.confirmationPrompt)
- [x] Added booking behavior options: enforcePromptOrder, confirmIfPreFilled, alwaysAskEvenIfFilled
- [x] BookingFlowResolver reads templates from multiple config paths with source tracking
- [x] Logging added for hardcoded vs configured templates

### Remaining Work
- [ ] Review BookingNameHandler.js slot writes (CONFIRMED UNUSED - safe to deprecate)
- [ ] Review DynamicFlowEngine.js for booking mode bypass
- [ ] Check if AIBrain3tierllm.js is still used (deprecate if not)
- [ ] Remove remaining BOOKING_SNAP references in ConversationEngine.js comments

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

### Template Source Priority
1. `bookingBehavior.confirmationPrompt` (Booking Prompt tab)
2. `bookingOutcome.confirmationPrompt`
3. `bookingOutcome.scripts.final_confirmation`
4. `bookingTemplates.confirmTemplate`
5. Hardcoded default (last resort)

---

## VERIFICATION CHECKLIST

After fixes, verify with test call:

1. [ ] `SPEAKER_OWNER_TRACE_V1` shows `responseOwner: BOOKING_FLOW_RUNNER` when locked
2. [ ] No `IDENTITY_CONTRACT_VIOLATION` events in normal flow
3. [ ] No `BOOKING_SNAP` appears in any matchSource
4. [ ] Name slot cannot be contaminated with non-name values
5. [ ] ConversationEngine does not speak when `bookingModeLocked=true`
