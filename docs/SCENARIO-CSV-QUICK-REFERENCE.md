# 📋 SCENARIO CSV - QUICK REFERENCE

> **Quick lookup guide for CSV columns** - Click any field for explanation

---

## ✅ **REQUIRED FIELDS** (Must fill these)

| Column | What It Is | Example | Format |
|--------|-----------|---------|--------|
| **name** | Scenario name | `"Thermostat blank screen"` | Text, 100 chars max |
| **status** | Lifecycle state | `live` | `draft` \| `live` \| `archived` |
| **priority** | Importance level | `10` | `-10` to `100` (0=normal, 10=emergency) |
| **triggers** | Phrases to match | `thermostat blank\|no display\|screen off` | Pipe-separated list |
| **min_confidence** | Match threshold | `0.70` | `0.0` to `1.0` (0.7=70% sure) |
| **behavior** | AI personality | `professional_warm` | behaviorId from Behaviors tab |
| **quick_replies** | Short responses | `Sure, I can help.\|Let me check that.` | 2-3 variations, pipe-separated |
| **full_replies** | Full responses | `If your thermostat...\|A blank screen...` | 2-3 variations, pipe-separated |

---

## 📌 **COMMONLY USED** (Fill when needed)

| Column | What It Is | Example | When to Use |
|--------|-----------|---------|-------------|
| **negative_triggers** | Block these phrases | `smart thermostat setup\|wifi` | Prevent false matches |
| **followup_funnel** | Re-engagement | `Want me to book a tech?` | Service scenarios |
| **action_hooks** | Trigger actions | `offer_service` | Booking/escalation |
| **cooldown_seconds** | Spam prevention | `30` | Repetitive scenarios (hold, ack) |

---

## 🔧 **ADVANCED OPTIONAL** (Leave blank unless needed)

| Column | What It Is | Default | When to Use |
|--------|-----------|---------|-------------|
| **regex_triggers** | Pattern matching | _(blank)_ | Phone numbers, complex patterns |
| **channel** | Limit to channel | `any` | Voice-only, SMS-only scenarios |
| **language** | Language code | `auto` | Multi-language (future) |
| **reply_selection** | Pick strategy | `random` | Always use `random` |
| **entity_capture** | Data to extract | _(blank)_ | Booking scenarios (name, phone) |
| **dynamic_variables** | Variable fallbacks | `name=valued customer` | Use with entity_capture |
| **entity_validation** | Validate entities | _(blank)_ | Strict data collection |
| **handoff_policy** | Escalation rule | `low_confidence` | Change only for special cases |
| **timed_followup_enabled** | Auto check-ins | `false` | Hold scenarios |
| **timed_followup_delay** | Wait time | `50` | Seconds before check-in |
| **timed_followup_extension** | Extra time | `30` | Seconds granted if caller responds |
| **timed_followup_messages** | Check-in phrases | `Still there?\|Hello?` | Hold scenario prompts |
| **silence_max_consecutive** | Max silent turns | `2` | Engagement threshold |
| **silence_final_warning** | Silence message | `Hello? Did I lose you?` | Warning phrase |
| **tts_pitch** | Voice pitch | _(blank)_ | Rare - let behavior control |
| **tts_rate** | Speaking speed | _(blank)_ | Rare - let behavior control |
| **tts_volume** | Voice volume | _(blank)_ | Rare - let behavior control |
| **preconditions** | State requirements | _(blank)_ | Multi-step flows |
| **effects** | State changes | _(blank)_ | Multi-step flows |
| **sensitive_info_rule** | Data security | `platform_default` | Always use default |
| **custom_masking** | Custom masking | _(blank)_ | Only if custom security needed |

---

## 🎯 **FORMATTING RULES**

### **Pipe-Separated Lists** (`|`)
Use for: `triggers`, `negative_triggers`, `regex_triggers`, `quick_replies`, `full_replies`, `entity_capture`, `timed_followup_messages`

```csv
"trigger 1|trigger 2|trigger 3"
```

### **Comma-Separated Lists** (`,`)
Use for: `action_hooks`

```csv
"offer_service,log_interaction"
```

### **Key=Value Lists** (`|` separated)
Use for: `dynamic_variables`

```csv
"name=valued customer|time=shortly|technician=our team member"
```

### **JSON Objects** (wrap in quotes)
Use for: `entity_validation`, `preconditions`, `effects`, `custom_masking`

```csv
"{""phone"": {""pattern"": ""^[0-9]{10}$""}}"
```

### **Booleans**
Use for: `timed_followup_enabled`

```csv
true
false
```

### **Numbers**
Use for: `priority`, `min_confidence`, `cooldown_seconds`, `timed_followup_delay`, `timed_followup_extension`, `silence_max_consecutive`

```csv
10
0.70
30
```

---

## 📖 **NEED MORE DETAILS?**

For comprehensive explanations, examples, and best practices:
→ **[Open Full Field Reference](SCENARIO-CSV-FIELD-REFERENCE.md)**

For CSV template:
→ **[Open CSV Template](SCENARIO-BULK-LOADER-CSV-TEMPLATE.csv)**

---

## 💡 **QUICK TIPS**

### **Starting Out?**
Fill only these 8 required fields:
1. `name`
2. `status` = `live`
3. `priority` = `0` (or `10` for emergencies)
4. `triggers` = 5-10 natural phrases
5. `min_confidence` = `0.70`
6. `behavior` = `professional_warm`
7. `quick_replies` = 3 short variations
8. `full_replies` = 3 expanded variations

Leave everything else **blank** (defaults work great!)

### **Common Mistakes**
❌ Don't use commas in pipe-separated lists  
❌ Don't forget quotes around JSON objects  
❌ Don't set everything to priority `10`  
❌ Don't fill optional fields "just because" - blank = smart defaults

### **Pro Tips**
✅ More trigger variations = better matching  
✅ Use negative triggers only when needed  
✅ Let behavior control voice (skip TTS overrides)  
✅ Start with `draft` status, promote to `live` after testing

---

**Last Updated:** October 24, 2025  
**Version:** 1.0  
**Platform:** ClientsVia Multi-Tenant AI Agent Platform

