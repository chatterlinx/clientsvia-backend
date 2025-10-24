# 📋 SCENARIO BULK LOADER - CSV FIELD REFERENCE

> **Complete guide to every column in the scenario CSV template**  
> Use this reference when filling out `SCENARIO-BULK-LOADER-CSV-TEMPLATE.csv`

---

## 📑 Table of Contents

1. [Basic Info (Columns 1-3)](#basic-info)
2. [Trigger Matching (Columns 4-7)](#trigger-matching)
3. [Voice & Channel (Columns 8-10)](#voice--channel)
4. [Replies & Flow (Columns 11-14)](#replies--flow)
5. [Entity Capture (Columns 15-17)](#entity-capture)
6. [Advanced Settings (Columns 18-19)](#advanced-settings)
7. [Timed Follow-Up (Columns 20-23)](#timed-follow-up)
8. [Silence Policy (Columns 24-25)](#silence-policy)
9. [TTS Override (Columns 26-28)](#tts-override)
10. [State Machine (Columns 29-30)](#state-machine)
11. [Integrations (Column 31)](#integrations)
12. [Security (Columns 32-33)](#security)

---

## 🔹 **BASIC INFO**

### **1. name** (REQUIRED)
- **Type:** Text
- **Max Length:** 100 characters
- **Description:** Short, clear descriptor of this conversation scenario
- **Examples:**
  - ✅ `"Thermostat blank screen"`
  - ✅ `"AC not cooling"`
  - ✅ `"Emergency heating failure"`
  - ❌ `"Scenario 1"` (too vague)
  - ❌ `"This is when a customer calls about their thermostat not working because..."` (too long)
- **Tips:** Use action-oriented, searchable names

---

### **2. status** (REQUIRED)
- **Type:** Enum
- **Options:** `draft` | `live` | `archived`
- **Default:** `live`
- **Description:** Scenario lifecycle state
  - **`draft`**: Saved but not active; won't match caller input
  - **`live`**: Published and actively matching calls
  - **`archived`**: Deprecated but kept for history/analytics
- **Examples:**
  - ✅ `live` (most common)
  - ✅ `draft` (for testing before publish)
- **Tips:** Start with `draft` when unsure, then promote to `live` after testing

---

### **3. priority** (REQUIRED)
- **Type:** Integer
- **Range:** `-10` to `100`
- **Default:** `0`
- **Description:** Tie-breaker when multiple scenarios match with same confidence score. Higher value = higher priority.
- **Recommended Values:**
  - **Emergency/Critical:** `10` (e.g., "No heat in winter", "Gas leak")
  - **Important Service:** `5-7` (e.g., "AC not cooling", "Water leak")
  - **Standard Inquiry:** `0-3` (e.g., "Schedule maintenance", "Filter replacement")
  - **Chitchat/Filler:** `-5` to `0` (e.g., "Weather talk", "Small talk")
  - **Fallback:** `1-3` (domain-aware fallback scenarios)
- **Examples:**
  - ✅ `10` for emergency scenarios
  - ✅ `0` for routine questions
  - ✅ `-5` for low-priority small talk
- **Tips:** Don't set everything to `10` or priority becomes meaningless

---

## 🔹 **TRIGGER MATCHING**

### **4. triggers** (REQUIRED)
- **Type:** Pipe-separated list (`|`)
- **Case:** Lowercase (automatically normalized)
- **Min Required:** 3-5 trigger phrases
- **Description:** Natural phrases callers might say that should match this scenario. Uses BM25 keyword matching + semantic similarity.
- **Format:** `phrase 1|phrase 2|phrase 3`
- **Examples:**
  - ✅ `"thermostat blank|no display|screen off|stat dead|thermostat not turning on"`
  - ✅ `"ac not cooling|air is warm|not blowing cold|ac running but warm"`
  - ✅ `"need appointment|schedule service|book a tech|set up visit"`
- **Tips:**
  - Include natural variations (formal + casual)
  - Cover different phrasings (synonyms)
  - Think like a caller, not a technician
  - More triggers = better matching (aim for 5-10)

---

### **5. negative_triggers** (OPTIONAL)
- **Type:** Pipe-separated list (`|`)
- **Description:** Phrases that **prevent** this scenario from matching. Used to avoid false positives.
- **Format:** `phrase 1|phrase 2|phrase 3`
- **Examples:**
  - ✅ `"smart thermostat setup|wifi pairing"` (prevents "thermostat blank" from matching setup questions)
  - ✅ `"don't hold|no hold|can't wait"` (prevents "Hold Request" from matching refusals)
  - ✅ `"pricing|cost|how much"` (prevents technical scenarios from matching billing questions)
- **When to Use:**
  - Two scenarios have overlapping keywords
  - You need to block specific contexts
  - Prevent opposite meanings from matching (e.g., "don't" + trigger word)
- **Tips:** Leave blank if not needed; only use when necessary

---

### **6. regex_triggers** (OPTIONAL - ADVANCED)
- **Type:** Pipe-separated regex patterns (`|`)
- **Description:** JavaScript regular expressions for advanced pattern matching
- **Format:** `pattern1|pattern2|pattern3`
- **Examples:**
  - ✅ `"\\b(hold|wait)\\s*(on|up)?\\b"` (matches "hold", "wait", "hold on", "wait up")
  - ✅ `"\\d{3}[-.\\s]?\\d{3}[-.\\s]?\\d{4}"` (matches phone numbers)
  - ✅ `"^schedule.*appointment$"` (starts with "schedule", ends with "appointment")
- **When to Use:**
  - Phone numbers, dates, times
  - Exact word boundaries
  - Complex patterns simple triggers can't capture
- **Tips:**
  - Escape backslashes: `\\b` not `\b`
  - Test patterns on regex101.com first
  - Leave blank if not needed (most scenarios don't need this)

---

### **7. min_confidence** (REQUIRED)
- **Type:** Decimal
- **Range:** `0.0` to `1.0` (0% to 100%)
- **Default:** `0.7` (70%)
- **Description:** Minimum confidence score required for AI to use this scenario. Higher = more selective.
- **Recommended Values:**
  - **Emergency/High-Stakes:** `0.90-0.95` (90-95%) - must be very sure
  - **Standard Service:** `0.70-0.80` (70-80%) - confident but not perfect
  - **Chitchat/Filler:** `0.50-0.60` (50-60%) - loose matching OK
  - **Fallback:** `0.40-0.50` (40-50%) - catch-all
- **Examples:**
  - ✅ `0.95` for "Emergency no heat" scenario
  - ✅ `0.70` for "Schedule maintenance"
  - ✅ `0.50` for "Small talk weather"
- **Tips:** Start at `0.70`; lower if too restrictive, raise if too loose

---

## 🔹 **VOICE & CHANNEL**

### **8. behavior** (REQUIRED)
- **Type:** String (references `GlobalAIBehaviorTemplate.behaviorId`)
- **Description:** AI personality/tone for this scenario. Controls pace, volume, emotion, instructions.
- **Available Behaviors:** (check Global AI Brain → Behaviors tab for current list)
  - `professional_warm`
  - `empathetic_reassuring`
  - `urgent_action_oriented`
  - `educational_informative`
  - `consultative_advisory`
  - `friendly_casual`
- **Examples:**
  - ✅ `professional_warm` (most common, balanced)
  - ✅ `urgent_action_oriented` (emergency scenarios)
  - ✅ `empathetic_reassuring` (frustrated callers)
- **Tips:** Match behavior to scenario emotion (emergency = urgent, chitchat = casual)

---

### **9. channel** (OPTIONAL)
- **Type:** Enum
- **Options:** `any` | `voice` | `sms` | `chat`
- **Default:** `any`
- **Description:** Restrict scenario to specific communication channels
- **Examples:**
  - ✅ `any` (most common - works everywhere)
  - ✅ `voice` (only during phone calls)
  - ✅ `sms` (only for text messages)
- **Tips:** Use `any` unless scenario is channel-specific (e.g., "Hold Request" is voice-only)

---

### **10. language** (OPTIONAL)
- **Type:** String (ISO 639-1 code)
- **Options:** `auto` | `en` | `es` | `fr` | etc.
- **Default:** `auto` (detect from caller input)
- **Description:** Language for this scenario
- **Examples:**
  - ✅ `auto` (recommended - AI detects language)
  - ✅ `en` (English-only)
  - ✅ `es` (Spanish-only)
- **Tips:** Use `auto` for now; multi-language is future enhancement

---

## 🔹 **REPLIES & FLOW**

### **11. quick_replies** (REQUIRED)
- **Type:** Pipe-separated list (`|`)
- **Min Required:** 2-3 variations
- **Max Length:** ~50-80 characters each
- **Description:** Short acknowledgment responses. AI randomly selects to avoid sounding robotic.
- **Format:** `reply 1|reply 2|reply 3`
- **Examples:**
  - ✅ `"A blank thermostat usually means no power or low battery.|Let's get that thermostat powered up.|Sounds like a power issue with your thermostat."`
  - ✅ `"Sure, I can hold.|No problem, take your time.|Of course, I'll wait."`
- **Tips:**
  - Keep it concise (1-2 sentences max)
  - Natural, conversational tone
  - Vary sentence structure for variety
  - Aim for 3 variations

---

### **12. full_replies** (REQUIRED)
- **Type:** Pipe-separated list (`|`)
- **Min Required:** 2-3 variations
- **Max Length:** ~200-400 characters each
- **Description:** Expanded responses with explanation, troubleshooting steps, or next actions
- **Format:** `reply 1|reply 2|reply 3`
- **Examples:**
  - ✅ `"If your thermostat screen is blank, it's typically dead batteries or a tripped breaker. Try fresh batteries and check the breaker. If it stays blank, we should take a look at low-voltage power to the system.|A blank screen usually means either the batteries died or there's a power issue. Replace the batteries first, then check your breaker panel. Still blank? Let's send a tech to check the wiring."`
- **Tips:**
  - Include troubleshooting steps when applicable
  - Use company variables: `{companyName}`, `{technicianName}`
  - End with a call-to-action or offer
  - Vary phrasing significantly between variations

---

### **13. followup_funnel** (OPTIONAL)
- **Type:** Single string
- **Max Length:** ~100 characters
- **Description:** Re-engagement prompt to steer caller back to purpose after answering their question
- **Examples:**
  - ✅ `"Do you want me to schedule a tech to check power and safety switches?"`
  - ✅ `"Would you like to book a diagnostic visit?"`
  - ✅ `"Anything else I can help you with today?"`
- **Tips:**
  - Use for service-oriented scenarios
  - Ask a question to keep conversation flowing
  - Leave blank for simple acknowledgments (e.g., "Hold Request")

---

### **14. reply_selection** (OPTIONAL)
- **Type:** Enum
- **Options:** `random` | `sequential` | `bandit`
- **Default:** `random`
- **Description:** How AI picks from multiple reply variations
  - **`random`**: Pick randomly (most natural, recommended)
  - **`sequential`**: Rotate through replies in order
  - **`bandit`**: AI learns which replies perform best over time (future feature)
- **Examples:**
  - ✅ `random` (use this 99% of the time)
- **Tips:** Always use `random` unless you have a specific reason not to

---

## 🔹 **ENTITY CAPTURE**

### **15. entity_capture** (OPTIONAL)
- **Type:** Pipe-separated list (`|`)
- **Description:** Variable "slots" AI should detect and extract from caller speech
- **Format:** `entity1|entity2|entity3`
- **Common Entities:**
  - `name` - Caller's name
  - `phone` - Phone number
  - `email` - Email address
  - `time` - Time/date reference
  - `location` - Address/location
  - `technician` - Technician name
  - `equipment` - Equipment type/model
- **Examples:**
  - ✅ `"name|phone|time"` (booking scenario)
  - ✅ `"equipment|issue"` (technical scenario)
  - ✅ `""` (leave blank if not capturing anything)
- **Tips:**
  - Only capture what you'll use
  - Use with `dynamicVariables` to personalize replies

---

### **16. dynamic_variables** (OPTIONAL)
- **Type:** Pipe-separated key=value pairs (`|`)
- **Description:** Fallback values for entities if not captured. Use in replies with `{variableName}`
- **Format:** `key1=fallback1|key2=fallback2`
- **Examples:**
  - ✅ `"name=valued customer|time=shortly|technician=our team member"`
  - ✅ `"location=your location|equipment=your system"`
- **Usage in Replies:**
  - Reply: `"Thanks for holding, {name}!"`
  - If `name` captured: `"Thanks for holding, Sarah!"`
  - If `name` not captured: `"Thanks for holding, valued customer!"`
- **Tips:**
  - Always provide graceful fallbacks
  - Match entity names from `entity_capture`
  - Leave blank if not using variables

---

### **17. entity_validation** (OPTIONAL - ADVANCED)
- **Type:** JSON object
- **Description:** Validation rules for captured entities (regex patterns, prompts)
- **Format:** `{"entity": {"pattern": "regex", "prompt": "error message"}}`
- **Examples:**
  - ✅ `{"phone": {"pattern": "^[0-9]{10}$", "prompt": "Please provide a 10-digit phone number"}}`
  - ✅ `{"email": {"pattern": "@", "prompt": "Please provide a valid email address"}}`
- **Tips:**
  - Leave blank unless you need strict validation
  - Useful for booking/data collection scenarios
  - Test patterns thoroughly before deploying

---

## 🔹 **ADVANCED SETTINGS**

### **18. cooldown_seconds** (OPTIONAL)
- **Type:** Integer
- **Range:** `0` to `300` (5 minutes)
- **Default:** `0` (no cooldown)
- **Description:** Prevents scenario from firing again within N seconds. Avoids spam/repetition.
- **Examples:**
  - ✅ `0` (most scenarios - no cooldown needed)
  - ✅ `30` (acknowledgment scenarios - prevent "I hear you" spam)
  - ✅ `60` (hold scenarios - prevent repeated "still there?" prompts)
- **Tips:**
  - Use `0` unless scenario is repetitive by nature
  - Apply to: hold requests, acknowledgments, check-ins

---

### **19. handoff_policy** (OPTIONAL)
- **Type:** Enum
- **Options:** `never` | `low_confidence` | `always_on_keyword`
- **Default:** `low_confidence`
- **Description:** When to escalate caller to human
  - **`never`**: AI handles fully (e.g., simple acknowledgments)
  - **`low_confidence`**: Escalate if AI is unsure (recommended default)
  - **`always_on_keyword`**: Always offer human transfer after response (e.g., complex technical questions)
- **Examples:**
  - ✅ `low_confidence` (most scenarios)
  - ✅ `never` (hold requests, simple confirmations)
  - ✅ `always_on_keyword` (billing disputes, complex repairs)
- **Tips:** Use `low_confidence` for 90% of scenarios

---

## 🔹 **TIMED FOLLOW-UP**

### **20. timed_followup_enabled** (OPTIONAL)
- **Type:** Boolean
- **Options:** `true` | `false`
- **Default:** `false`
- **Description:** Enable automatic prompts after caller is silent/idle
- **When to Enable:**
  - Hold scenarios (check if caller still there)
  - Booking scenarios (prompt for info if caller stalls)
  - Emergency scenarios (urgency check-ins)
- **Examples:**
  - ✅ `false` (most scenarios)
  - ✅ `true` (hold requests, waiting scenarios)
- **Tips:** Only enable for scenarios where silence = potential problem

---

### **21. timed_followup_delay** (OPTIONAL)
- **Type:** Integer (seconds)
- **Default:** `50`
- **Description:** How long to wait before first check-in
- **Examples:**
  - ✅ `30` (quick check-in)
  - ✅ `50` (standard hold)
  - ✅ `90` (patient waiting)
- **Tips:** Only applies if `timed_followup_enabled = true`

---

### **22. timed_followup_extension** (OPTIONAL)
- **Type:** Integer (seconds)
- **Default:** `30`
- **Description:** Additional time granted if caller responds "still here"
- **Examples:**
  - ✅ `30` (standard)
  - ✅ `60` (more patient)
- **Tips:** Only applies if `timed_followup_enabled = true`

---

### **23. timed_followup_messages** (OPTIONAL)
- **Type:** Pipe-separated list (`|`)
- **Description:** Messages to send during timed check-ins
- **Format:** `message1|message2`
- **Examples:**
  - ✅ `"Are you still there?|Just checking in..."`
  - ✅ `"Still with me?|Hello?"`
- **Tips:** Only applies if `timed_followup_enabled = true`; leave blank otherwise

---

## 🔹 **SILENCE POLICY**

### **24. silence_max_consecutive** (OPTIONAL)
- **Type:** Integer
- **Range:** `1` to `5`
- **Default:** `2`
- **Description:** How many silent turns before triggering warning
- **Examples:**
  - ✅ `2` (standard - warn after 2 silent responses)
  - ✅ `3` (more patient)
- **Tips:** Most scenarios use default `2`

---

### **25. silence_final_warning** (OPTIONAL)
- **Type:** Single string
- **Default:** `"Hello? Did I lose you?"`
- **Description:** Message to send when max silence threshold reached
- **Examples:**
  - ✅ `"Hello? Did I lose you?"`
  - ✅ `"Are you still on the line?"`
  - ✅ `"I'm here if you need me!"`
- **Tips:** Use default unless you want custom phrasing

---

## 🔹 **TTS OVERRIDE**

### **26. tts_pitch** (OPTIONAL)
- **Type:** Enum
- **Options:** `low` | `medium` | `high` | `` (blank = inherit from behavior)
- **Description:** Voice pitch override for this specific scenario
- **Examples:**
  - ✅ `""` (blank - use behavior default) ← **RECOMMENDED**
  - ✅ `high` (excited/urgent scenarios only)
- **Tips:** Leave blank unless you have a very specific voice requirement

---

### **27. tts_rate** (OPTIONAL)
- **Type:** Enum
- **Options:** `slow` | `medium` | `fast` | `` (blank = inherit from behavior)
- **Description:** Speaking speed override for this scenario
- **Examples:**
  - ✅ `""` (blank - use behavior default) ← **RECOMMENDED**
  - ✅ `slow` (complex instructions only)
- **Tips:** Leave blank unless scenario requires specific pacing

---

### **28. tts_volume** (OPTIONAL)
- **Type:** Enum
- **Options:** `soft` | `medium` | `loud` | `` (blank = inherit from behavior)
- **Description:** Voice volume override for this scenario
- **Examples:**
  - ✅ `""` (blank - use behavior default) ← **RECOMMENDED**
  - ✅ `loud` (emergency alerts only)
- **Tips:** Leave blank; behavior controls volume appropriately

---

## 🔹 **STATE MACHINE**

### **29. preconditions** (OPTIONAL - ADVANCED)
- **Type:** JSON object
- **Description:** Conditions that must be met for scenario to match
- **Format:** `{"state": "value", "hasEntity": ["entity1"]}`
- **Examples:**
  - ✅ `{"state": "collecting_phone"}` (only match if conversation state = collecting_phone)
  - ✅ `{"hasEntity": ["name", "phone"]}` (only match if name AND phone already captured)
  - ✅ `""` (blank - no preconditions)
- **When to Use:**
  - Multi-step booking flows
  - Confirmation scenarios that require prior data
  - Advanced conversation state management
- **Tips:** Leave blank unless building complex flows

---

### **30. effects** (OPTIONAL - ADVANCED)
- **Type:** JSON object
- **Description:** State changes to apply after scenario executes
- **Format:** `{"setState": "value", "increment": {"counter": 1}}`
- **Examples:**
  - ✅ `{"setState": "confirming"}` (set conversation state to "confirming")
  - ✅ `{"increment": {"holdCount": 1}}` (increment hold counter)
  - ✅ `""` (blank - no effects)
- **When to Use:**
  - Tracking conversation flow
  - Counting interactions (hold count, repeat count)
  - Advanced state management
- **Tips:** Leave blank unless building complex flows

---

## 🔹 **INTEGRATIONS**

### **31. action_hooks** (OPTIONAL)
- **Type:** Comma-separated list (`,`)
- **Description:** External functions/actions to trigger after this response
- **Format:** `hook1,hook2,hook3`
- **Common Hooks:**
  - `offer_service` - Offer to book technician
  - `offer_scheduling` - Offer appointment booking
  - `offer_estimate` - Offer price quote
  - `escalation_emergency` - Immediate human transfer
  - `log_complaint` - Log complaint in CRM
  - `send_sms_summary` - Send SMS recap
- **Examples:**
  - ✅ `offer_service` (most technical scenarios)
  - ✅ `offer_scheduling,send_sms_summary` (booking scenarios)
  - ✅ `escalation_emergency` (emergency scenarios)
  - ✅ `""` (blank - no hooks)
- **Tips:**
  - Check Global AI Brain → Action Hooks tab for available hooks
  - Use sparingly (1-2 per scenario max)
  - Most scenarios don't need hooks

---

## 🔹 **SECURITY**

### **32. sensitive_info_rule** (OPTIONAL)
- **Type:** Enum
- **Options:** `platform_default` | `custom`
- **Default:** `platform_default`
- **Description:** How to handle sensitive data (SSN, credit cards, addresses)
  - **`platform_default`**: Use system-wide masking rules (recommended)
  - **`custom`**: Use custom masking rules defined in `custom_masking`
- **Examples:**
  - ✅ `platform_default` (use this 99% of the time)
  - ✅ `custom` (only if scenario needs special data handling)
- **Tips:** Leave as `platform_default` unless you have specific compliance requirements

---

### **33. custom_masking** (OPTIONAL - ADVANCED)
- **Type:** JSON object
- **Description:** Per-entity custom masking rules
- **Format:** `{"entity": "masking_strategy"}`
- **Masking Strategies:**
  - `last4` - Show only last 4 digits (e.g., phone: `***-***-1234`)
  - `full` - Completely mask (e.g., SSN: `***-**-****`)
  - `street_only` - Address: show street, mask apt/suite
- **Examples:**
  - ✅ `{"phone": "last4", "address": "street_only"}`
  - ✅ `""` (blank - use platform defaults)
- **When to Use:**
  - Payment collection scenarios
  - Identity verification scenarios
  - HIPAA/compliance scenarios
- **Tips:** Leave blank unless `sensitive_info_rule = custom`

---

## ✅ **QUICK REFERENCE CHEAT SHEET**

### **Always Fill These (REQUIRED):**
1. `name`
2. `status` (`live` recommended)
3. `priority` (`0` for normal, `10` for emergency)
4. `triggers` (5-10 natural phrases)
5. `min_confidence` (`0.70` recommended)
6. `behavior` (get from Behaviors tab)
7. `quick_replies` (2-3 short variations)
8. `full_replies` (2-3 expanded variations)

### **Usually Leave Blank (OPTIONAL):**
- `negative_triggers` (only if needed to prevent false positives)
- `regex_triggers` (power user feature)
- `entity_capture` + `dynamic_variables` (only for data collection)
- `cooldown_seconds` (only for repetitive scenarios)
- `timed_followup_*` (only for hold/waiting scenarios)
- `tts_*` (let behavior control voice)
- `preconditions` + `effects` (advanced flows only)
- `action_hooks` (only if triggering external actions)
- `sensitive_info_rule` + `custom_masking` (use defaults)

### **Set to Default (RECOMMENDED):**
- `channel` = `any`
- `language` = `auto`
- `reply_selection` = `random`
- `handoff_policy` = `low_confidence`
- `silence_max_consecutive` = `2`
- `silence_final_warning` = `"Hello? Did I lose you?"`
- `sensitive_info_rule` = `platform_default`

---

## 📞 **NEED HELP?**

Refer to:
- **Main Documentation:** `docs/AICORE-INTELLIGENCE-SYSTEM.md`
- **CSV Template:** `docs/SCENARIO-BULK-LOADER-CSV-TEMPLATE.csv`
- **Loader Script:** `scripts/scenario-bulk-loader.js`
- **Global AI Brain:** Check Behaviors, Categories, and Action Hooks tabs for current options

---

**Last Updated:** October 24, 2025  
**Version:** 1.0  
**Platform:** ClientsVia Multi-Tenant AI Agent Platform

