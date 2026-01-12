# STANDARD INTENT VOCABULARY

> **Status:** AUTHORITATIVE - All triage cards and 3-Tier scenarios MUST use these intents
> **Version:** 1.0
> **Date:** 2025-11-29

---

## Why Standard Intents Matter

The BehaviorEngine, TriageService, and 3-Tier Router all need to speak the **same language**.

If HVAC uses `AC_REPAIR` and Plumbing uses `PIPE_FIX` and Dental uses `TOOTH_PROBLEM`:
- BehaviorEngine can't decide tone
- Analytics are useless
- Cross-trade features break

**Solution:** Standard intents that work for ALL trades.

---

## The Standard Intent List

| Intent | Meaning | Example Phrases (Any Trade) |
|--------|---------|----------------------------|
| `SERVICE_REPAIR` | Something is broken/not working, needs fixing | "It's not working", "It broke", "Something's wrong" |
| `MAINTENANCE` | Routine preventive service, tune-up, cleaning | "Annual service", "Tune-up", "Checkup" |
| `NEW_SALES_ESTIMATE` | Quote for new equipment/service, replacement | "How much for new...", "I need a quote", "Price for replacement" |
| `INSTALLATION` | Install new equipment (already decided to buy) | "Ready to install", "Schedule installation" |
| `BILLING_ISSUE` | Invoice question, payment dispute, refund | "My bill...", "You charged me...", "Refund" |
| `SCHEDULING` | Reschedule, cancel, confirm existing appointment | "Change my appointment", "Cancel", "Confirm" |
| `GENERAL_QUESTION` | Info request that doesn't fit other categories | "What are your hours?", "Do you do X?" |
| `EMERGENCY` | Safety concern, needs immediate attention | "Emergency", "Urgent", "Smoke/fire/leak" |
| `FOLLOWUP` | Callback about previous service or quote | "Calling back about...", "You were out here last week" |
| `WRONG_NUMBER` | Caller reached wrong business | "Is this [other company]?", "Wrong number" |
| `SOLICITATION` | Sales call, spam, not a customer | "I'm calling from...", "Special offer" |
| `MESSAGE_ONLY` | Just wants to leave a message | "Can I leave a message?", "Have someone call me" |
| `UNKNOWN` | Can't determine intent, needs clarification | (Fallback when no match) |

---

## Trade-Specific Examples

### HVAC
| Standard Intent | Trade-Specific Situation |
|-----------------|--------------------------|
| `SERVICE_REPAIR` | AC not cooling, furnace not heating, compressor dead |
| `MAINTENANCE` | AC tune-up, furnace checkup, filter change |
| `NEW_SALES_ESTIMATE` | Quote for new AC unit, system replacement |
| `EMERGENCY` | Smoke from vents, gas smell, no heat in freezing temps |

### Plumbing
| Standard Intent | Trade-Specific Situation |
|-----------------|--------------------------|
| `SERVICE_REPAIR` | Clogged drain, leaky pipe, toilet won't flush |
| `MAINTENANCE` | Drain cleaning, water heater flush |
| `NEW_SALES_ESTIMATE` | Quote for new water heater, repipe |
| `EMERGENCY` | Burst pipe, sewage backup, flooding |

### Dental
| Standard Intent | Trade-Specific Situation |
|-----------------|--------------------------|
| `SERVICE_REPAIR` | Broken tooth, crown fell off, filling came out |
| `MAINTENANCE` | Cleaning, checkup, x-rays |
| `NEW_SALES_ESTIMATE` | Quote for implants, veneers, orthodontics |
| `EMERGENCY` | Severe pain, bleeding won't stop, swelling |

### Electrical
| Standard Intent | Trade-Specific Situation |
|-----------------|--------------------------|
| `SERVICE_REPAIR` | Outlet not working, breaker keeps tripping |
| `MAINTENANCE` | Panel inspection, surge protector check |
| `NEW_SALES_ESTIMATE` | Quote for panel upgrade, EV charger |
| `EMERGENCY` | Sparks, burning smell, partial power outage |

---

## How BehaviorEngine Uses Intents

The BehaviorEngine maps intents to tones:

```javascript
switch (intent) {
  case 'SERVICE_REPAIR':     return 'FRIENDLY_DIRECT';
  case 'MAINTENANCE':        return 'FRIENDLY_CASUAL';
  case 'NEW_SALES_ESTIMATE': return 'CONSULTATIVE';
  case 'EMERGENCY':          return 'EMERGENCY_SERIOUS';
  case 'BILLING_ISSUE':      return 'CONFLICT_SERIOUS';
  // ...
}
```

This is why **standard intents are critical** - they enable trade-agnostic behavior.

---

## How Triage Cards Should Use Intents

When creating a TriageCard:

```json
{
  "triageLabel": "HVAC_AC_NOT_COOLING",
  "quickRuleConfig": {
    "intent": "SERVICE_REPAIR",      // ← Use STANDARD intent
    "serviceType": "REPAIR",
    "action": "DIRECT_TO_3TIER",
    "mustHaveKeywords": ["not cooling"]
  }
}
```

**NOT:**
```json
{
  "quickRuleConfig": {
    "intent": "AC_REPAIR",           // ← BAD: Trade-specific
  }
}
```

---

## How 3-Tier Scenarios Should Use Intents

When creating a scenario:

```yaml
scenarioKey: HVAC_AC_NOT_COOLING
categoryKey: SERVICE_REPAIR           # ← Use STANDARD intent as category
trade: HVAC
```

The `categoryKey` should match the standard intent so BehaviorEngine can decide tone.

---

## Migration Guide

If existing cards use trade-specific intents:

| Old (Trade-Specific) | New (Standard) |
|---------------------|----------------|
| `AC_REPAIR` | `SERVICE_REPAIR` |
| `AC_MAINTENANCE` | `MAINTENANCE` |
| `AC_EMERGENCY` | `EMERGENCY` |
| `NEW_AC_ESTIMATE` | `NEW_SALES_ESTIMATE` |
| `PIPE_FIX` | `SERVICE_REPAIR` |
| `TOOTH_REPAIR` | `SERVICE_REPAIR` |

**Rule:** The trade is identified by the `tradeKey` field, not the intent.

---

## Adding New Intents

Before adding a new intent:

1. **Check if it fits an existing intent** - Most things do
2. **Confirm it applies to multiple trades** - If it's trade-specific, don't add it
3. **Define the BehaviorEngine mapping** - What tone should it use?
4. **Update this document** - Keep the vocabulary documented

---

## Summary

- Use **STANDARD INTENTS** in all triage cards and scenarios
- Trade is specified by `tradeKey`, not intent
- BehaviorEngine uses intents to decide tone
- Same intent = same behavior, regardless of trade

*This vocabulary is the foundation of multi-trade support.*

