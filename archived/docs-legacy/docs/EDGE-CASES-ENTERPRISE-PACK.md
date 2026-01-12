# 🛡️ EDGE CASES ENTERPRISE PACK

**Purpose**: Pre-built, production-ready edge cases for enterprise deployments  
**Date**: November 27, 2025  
**Status**: Reference Implementation (Ready to Deploy)

---

## 📋 OVERVIEW

The Enterprise Pack provides **5 foundational edge case categories** that every production AI agent should have. These are **not theoretical** — they solve real problems that occur in production calls.

Each edge case is designed to:
1. **Protect** the business from liability, abuse, or spam
2. **Route** calls efficiently without human intervention
3. **Log** critical events for review and compliance
4. **Scale** to handle thousands of calls per day

---

## 🎯 CATEGORY 1: ABUSE & PROFANITY DETECTION

### Purpose
Detect and terminate abusive, profane, or threatening calls immediately. Protects staff, logs incidents, and blacklists repeat offenders.

### Use Cases
- Caller uses profanity or abusive language
- Verbal harassment or threats
- Spam calls with aggressive tactics
- Inappropriate or sexual content

### Edge Case Definition

```json
{
  "id": "ec-abuse-detection-001",
  "name": "Abuse & Profanity Detection",
  "description": "Detects profanity, abuse, and threats. Hangs up politely and blacklists caller.",
  "enabled": true,
  "priority": 1,
  
  "match": {
    "keywordsAny": [
      "fuck", "shit", "asshole", "bitch", "damn",
      "idiot", "stupid", "moron", "scam", "fraud",
      "sue you", "report you", "lawyer", "attorney"
    ],
    "regexPatterns": [
      "/\\b(kill|hurt|harm|attack)\\b/i",
      "/\\b(racist|sexist|homophobic)\\b/i"
    ]
  },
  
  "action": {
    "type": "polite_hangup",
    "hangupMessage": "Thank you for calling. This call is now ending. If you need assistance, please call back during business hours."
  },
  
  "sideEffects": {
    "autoBlacklist": true,
    "autoTag": ["abuse", "profanity", "terminated"],
    "notifyContacts": ["manager", "security"],
    "logSeverity": "critical"
  }
}
```

### Expected Behavior
1. Caller says: "This is a fucking scam"
2. Edge case matches (keyword: "fucking", "scam")
3. Agent responds: "Thank you for calling. This call is now ending..."
4. Call hangs up
5. Caller auto-blacklisted (future calls blocked at Layer 1)
6. Manager/security notified via SMS/email
7. Critical log created for review

---

## 🎯 CATEGORY 2: LEGAL THREATS & ESCALATION

### Purpose
Detect legal threats or lawsuit language. Immediately escalate to management without exposing AI agent to liability.

### Use Cases
- "I'm going to sue you"
- "I need to speak to a lawyer"
- "This is a legal matter"
- "I'm contacting the BBB/attorney general"

### Edge Case Definition

```json
{
  "id": "ec-legal-threat-001",
  "name": "Legal Threat Detection",
  "description": "Detects legal threats, lawsuit language, or requests for legal representation. Escalates to management immediately.",
  "enabled": true,
  "priority": 2,
  
  "match": {
    "keywordsAny": [
      "lawyer", "attorney", "sue", "lawsuit",
      "legal action", "legal matter", "attorney general",
      "better business bureau", "BBB", "court",
      "subpoena", "complaint", "report you"
    ],
    "regexPatterns": [
      "/\\b(legal|law)\\s+(action|matter|issue|problem)\\b/i",
      "/\\b(file|filing)\\s+(complaint|lawsuit|claim)\\b/i"
    ]
  },
  
  "action": {
    "type": "force_transfer",
    "transferTarget": "manager",
    "transferMessage": "I understand this is a legal matter. Let me connect you with our manager who can assist you with this. Please hold."
  },
  
  "sideEffects": {
    "autoBlacklist": false,
    "autoTag": ["legal", "threat", "escalated"],
    "notifyContacts": ["manager", "legal"],
    "logSeverity": "critical"
  }
}
```

### Expected Behavior
1. Caller says: "I'm going to sue your company"
2. Edge case matches (keyword: "sue")
3. Agent responds: "I understand this is a legal matter. Let me connect you with our manager..."
4. Call transfers to manager
5. Manager/legal team notified immediately
6. Critical log created for legal review

---

## 🎯 CATEGORY 3: OUT-OF-SCOPE SERVICES

### Purpose
Detect when caller is asking for services the company doesn't provide. Politely redirect without wasting time.

### Use Cases
- Plumbing company receives call asking for electrical work
- HVAC company receives call asking for roofing
- Service area mismatch (caller is 500 miles away)

### Edge Case Definition

```json
{
  "id": "ec-out-of-scope-001",
  "name": "Out-of-Scope Service Detection",
  "description": "Detects requests for services outside company's trade/service area. Politely declines and suggests alternatives.",
  "enabled": true,
  "priority": 5,
  
  "match": {
    "keywordsAny": [
      "electrical", "electrician", "wiring", "breaker",
      "roofing", "roof repair", "shingles",
      "legal advice", "medical advice", "financial advice",
      "appliance repair", "handyman"
    ],
    "tradeRequired": ["HVAC", "Plumbing"]
  },
  
  "action": {
    "type": "override_response",
    "inlineResponse": "Thank you for calling! We specialize in {trade} services. For {detected_request}, I'd recommend contacting a licensed specialist in that field. If you need {trade} help in the future, we're here 24/7!"
  },
  
  "sideEffects": {
    "autoBlacklist": false,
    "autoTag": ["out_of_scope", "polite_decline"],
    "notifyContacts": [],
    "logSeverity": "info"
  }
}
```

### Expected Behavior
1. Caller says: "I need an electrician to fix my breaker"
2. Edge case matches (keyword: "electrician", "breaker")
3. Agent responds: "Thank you for calling! We specialize in HVAC services..."
4. Call continues (no hangup/transfer)
5. Caller can still book HVAC if they change mind
6. Info log created (not critical)

---

## 🎯 CATEGORY 4: PRICING NEGOTIATION & DISCOUNTS

### Purpose
Enforce pricing policy without empowering AI to make unauthorized discounts. Redirect to manager or provide policy response.

### Use Cases
- "Can you give me a discount?"
- "That's too expensive, what's your lowest price?"
- "I saw a coupon online, can you honor it?"
- "Will you price match?"

### Edge Case Definition

```json
{
  "id": "ec-pricing-negotiation-001",
  "name": "Pricing & Discount Policy Enforcement",
  "description": "Detects pricing negotiation attempts. Provides policy response or escalates to manager based on context.",
  "enabled": true,
  "priority": 8,
  
  "match": {
    "keywordsAny": [
      "discount", "cheaper", "lower price", "best price",
      "coupon", "promo code", "deal", "special offer",
      "price match", "competitor", "quoted less"
    ],
    "regexPatterns": [
      "/\\b(how much|what.*cost|price|rate)\\b/i"
    ]
  },
  
  "action": {
    "type": "override_response",
    "inlineResponse": "Great question! We offer transparent, competitive pricing for all {trade} services. Our rates include {value_props}. For specific pricing, I can schedule a free consultation where our technician will provide an exact quote. We also offer financing options and seasonal promotions. Would you like to schedule that appointment?"
  },
  
  "sideEffects": {
    "autoBlacklist": false,
    "autoTag": ["pricing_inquiry", "discount_request"],
    "notifyContacts": [],
    "logSeverity": "info"
  }
}
```

### Alternative (Manager Escalation):
For high-value negotiations, use `force_transfer` instead of `override_response`:

```json
{
  "action": {
    "type": "force_transfer",
    "transferTarget": "sales_manager",
    "transferMessage": "I'd be happy to connect you with our sales manager who can discuss pricing options and any available promotions. One moment please."
  }
}
```

### Expected Behavior
1. Caller says: "Can you give me a discount?"
2. Edge case matches (keyword: "discount")
3. Agent responds with pricing policy (or transfers to manager)
4. No unauthorized discounts given
5. Info log created for sales tracking

---

## 🎯 CATEGORY 5: HIGH-RISK DATA & PCI COMPLIANCE

### Purpose
Prevent AI agent from collecting sensitive data (credit cards, SSN, passwords) over voice. Protects company from PCI/compliance violations.

### Use Cases
- Caller tries to give credit card number
- Caller asks to provide SSN or personal info
- Caller wants to share password or account credentials

### Edge Case Definition

```json
{
  "id": "ec-high-risk-data-001",
  "name": "PCI & Data Security Guard",
  "description": "Prevents collection of credit cards, SSNs, passwords over voice. Redirects to secure payment methods.",
  "enabled": true,
  "priority": 3,
  
  "match": {
    "keywordsAny": [
      "credit card", "card number", "debit card",
      "social security", "SSN", "social security number",
      "password", "account number", "routing number",
      "CVV", "expiration date", "security code"
    ],
    "regexPatterns": [
      "/\\b\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}\\b/",
      "/\\b\\d{3}-\\d{2}-\\d{4}\\b/"
    ]
  },
  
  "action": {
    "type": "override_response",
    "inlineResponse": "For your security, please don't share credit card or personal information over the phone. We use secure payment processing. I can send you a secure payment link via SMS, or you can pay when our technician arrives. Which would you prefer?"
  },
  
  "sideEffects": {
    "autoBlacklist": false,
    "autoTag": ["pci_guard", "security", "sensitive_data"],
    "notifyContacts": ["security"],
    "logSeverity": "warning"
  }
}
```

### Expected Behavior
1. Caller says: "My card number is 4532-1234-5678-9012"
2. Edge case matches (regex: credit card pattern)
3. Agent responds: "For your security, please don't share credit card..."
4. Agent offers secure alternatives (payment link, pay on-site)
5. Security team notified (for audit trail)
6. Warning log created for compliance

---

## 📊 DEPLOYMENT PRIORITY

Deploy in this order for maximum impact:

| Priority | Category | Business Impact |
|----------|----------|-----------------|
| 1 | High-Risk Data (PCI) | **Legal/Compliance** - Must have before processing any payments |
| 2 | Legal Threats | **Liability Protection** - Prevents AI from making legal mistakes |
| 3 | Abuse & Profanity | **Staff Protection** - Protects team from harassment |
| 4 | Out-of-Scope Services | **Efficiency** - Saves time on unqualified leads |
| 5 | Pricing Negotiation | **Revenue Protection** - Prevents unauthorized discounts |

---

## 🔧 CUSTOMIZATION GUIDE

### Per-Industry Adjustments

**HVAC Companies:**
- Add "furnace", "AC", "heat pump" to out-of-scope keywords (if not offering)
- Add seasonal pricing edge cases (winter emergency, summer peak)

**Plumbing Companies:**
- Add "sewer", "drain", "water heater" to scope keywords
- Add emergency keywords for after-hours escalation

**Multi-Trade Companies:**
- Disable out-of-scope edge cases
- Add trade-specific routing edge cases

### Per-Company Adjustments

**Company Size:**
- Small (1-5 techs): Use `override_response` for pricing (no manager)
- Medium (5-20 techs): Use `force_transfer` to on-duty manager
- Large (20+ techs): Use `force_transfer` to department (sales/billing/support)

**Service Area:**
- Add geo-fencing keywords (city names, zip codes) to out-of-scope
- Add regional competitor names to pricing edge cases

**Brand Voice:**
- Adjust response tone (formal vs. friendly)
- Add company-specific value propositions
- Customize variable placeholders

---

## 🧪 TESTING CHECKLIST

Before deploying any edge case to production:

### ✅ Functionality Tests
1. [ ] Test positive match (edge case triggers correctly)
2. [ ] Test negative match (doesn't trigger on similar but safe input)
3. [ ] Test action type (override/transfer/hangup/flag works)
4. [ ] Test variable replacement (company name, trade, etc.)
5. [ ] Test side effects (blacklist, tags, notifications)

### ✅ Logging Tests
1. [ ] `[CHEAT SHEET ENGINE]` log shows edge case details
2. [ ] `[CHEATSHEET]` log shows appliedBlocks with edge case
3. [ ] `[AGENT-OUTPUT]` log shows correct finalAction
4. [ ] Side effect logs appear (blacklist, tags, notifications)

### ✅ Integration Tests
1. [ ] Transfer target resolves to correct contact/phone
2. [ ] Hangup message plays via ElevenLabs (or Twilio fallback)
3. [ ] Redis cache invalidates on save
4. [ ] Multiple edge cases respect priority order

### ✅ Production Readiness
1. [ ] All keywords reviewed for false positives
2. [ ] Regex patterns tested with real call transcripts
3. [ ] Response messages approved by legal/compliance
4. [ ] Manager contacts configured and tested
5. [ ] Blacklist thresholds configured

---

## 📈 METRICS TO TRACK

After deploying edge cases, monitor these KPIs:

### Edge Case Performance
- **Trigger Rate**: How often each edge case fires (%)
- **False Positive Rate**: Incorrect triggers requiring override
- **Action Distribution**: Override vs. Transfer vs. Hangup vs. Flag

### Business Impact
- **Abuse Calls Terminated**: Count of polite_hangup edge cases
- **Legal Escalations**: Count of legal threat transfers
- **Time Saved**: Avg call duration for out-of-scope (should be < 30 sec)
- **Blacklist Growth**: Numbers added via edge case auto-blacklist

### Quality Metrics
- **Customer Satisfaction**: CSAT scores for edge case calls
- **False Hangup Complaints**: Customers wrongly terminated
- **Manager Escalation Accuracy**: % of transfers that were appropriate

---

## 🚀 ROLLOUT PLAN

### Phase 1: Single Company Pilot (Week 1)
1. Deploy PCI/High-Risk Data edge case only
2. Monitor for 3 days
3. Review logs for false positives
4. Adjust keywords if needed

### Phase 2: Full Pack (Week 2)
1. Deploy all 5 categories
2. Set all to priority 5-10 (not highest)
3. Monitor trigger rates daily
4. Adjust based on call patterns

### Phase 3: Priority Optimization (Week 3)
1. Identify highest-value edge cases
2. Adjust priorities (1-3 for critical)
3. Fine-tune keywords based on real transcripts
4. Enable auto-blacklist for abuse cases

### Phase 4: Scale to All Companies (Week 4+)
1. Export successful edge cases as templates
2. Deploy to all companies with same trade
3. Customize per-company variables
4. Monitor aggregate metrics

---

## 📚 ADDITIONAL RESOURCES

- **Schema Reference**: `models/cheatsheet/CheatSheetConfigSchema.js` (EdgeCaseSchema)
- **Runtime Engine**: `services/CheatSheetEngine.js` (apply method)
- **Migration Script**: `scripts/migrate-edge-cases-to-enterprise.js`
- **Audit Report**: `NOTES-EDGE-CASES-PIPELINE.md`

---

**Enterprise Pack Version**: 1.0  
**Last Updated**: November 27, 2025  
**Status**: Production-Ready ✅

