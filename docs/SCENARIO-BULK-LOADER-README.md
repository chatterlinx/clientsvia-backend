# 📦 SCENARIO BULK LOADER - Documentation Index

> **Everything you need to bulk-load AI scenarios via CSV**

---

## 📚 **Documentation Files**

### **1. 📄 CSV Template** ← **Start Here**
**File:** `SCENARIO-BULK-LOADER-CSV-TEMPLATE.csv`

**What it is:**
- Clean, production-ready CSV template
- Header row + example scenario
- Ready for data entry

**When to use:**
- Starting a new batch of scenarios
- Need a clean template to fill out

**How to use:**
1. Open in Excel, Google Sheets, or any CSV editor
2. Delete the example row (row 2) or keep it as reference
3. Fill in your scenarios (one per row)
4. Save as CSV (UTF-8 encoding)

---

### **2. 📋 Quick Reference** ← **"Info Icon" Tooltips**
**File:** `SCENARIO-CSV-QUICK-REFERENCE.md`

**What it is:**
- Fast lookup table for all 33 columns
- Shows what each field does, examples, and defaults
- Organized by importance (Required → Common → Advanced)

**When to use:**
- Filling out the CSV and need quick clarification
- "What does this column mean again?"
- Quick format reference (pipe vs comma separated)

**How to use:**
- Keep open in a second window while filling CSV
- Search (Cmd/Ctrl+F) for column name
- Copy/paste examples directly

---

### **3. 📖 Complete Field Reference** ← **Deep Dive**
**File:** `SCENARIO-CSV-FIELD-REFERENCE.md`

**What it is:**
- Comprehensive 5,500+ word guide
- Detailed explanation for every field
- Examples, tips, best practices, common mistakes
- Organized into 12 sections

**When to use:**
- First time using the bulk loader
- Need to understand a complex field (preconditions, effects, entity validation)
- Want to see all available options (behaviors, channels, handoff policies)
- Troubleshooting why scenarios aren't matching

**How to use:**
- Read sections relevant to your scenarios
- Reference when building complex flows
- Bookmark for training new team members

---

### **4. 🤖 AI Intelligence System** ← **Context & Architecture**
**File:** `AICORE-INTELLIGENCE-SYSTEM.md`

**What it is:**
- Complete architecture of the AI Core system
- How scenarios fit into templates, categories, and company config
- Runtime matching logic (BM25, semantic, regex, confidence)
- Variable system, action hooks, behaviors

**When to use:**
- Want to understand the big picture
- Designing complex scenarios with state machines
- Troubleshooting matching behavior
- Training developers on the AI system

---

## 🚀 **Quick Start Guide**

### **For First-Time Users:**
1. ✅ Read `SCENARIO-CSV-QUICK-REFERENCE.md` (5 min scan)
2. ✅ Open `SCENARIO-BULK-LOADER-CSV-TEMPLATE.csv`
3. ✅ Fill in **8 required fields** only (ignore optional columns for now)
4. ✅ Save and run the loader script

### **For Experienced Users:**
1. ✅ Grab the CSV template
2. ✅ Keep quick reference open for lookup
3. ✅ Fill scenarios row by row
4. ✅ Use advanced fields as needed

### **For Power Users:**
1. ✅ Review `SCENARIO-CSV-FIELD-REFERENCE.md` for all options
2. ✅ Check `AICORE-INTELLIGENCE-SYSTEM.md` for system behavior
3. ✅ Use advanced fields: preconditions, effects, entity validation
4. ✅ Design multi-step conversation flows

---

## 📊 **CSV Structure at a Glance**

```
┌─────────────────────────────────────────────────────────────┐
│ Row 1: HEADER (33 columns)                                  │
├─────────────────────────────────────────────────────────────┤
│ Row 2: Example scenario (reference - can delete)            │
├─────────────────────────────────────────────────────────────┤
│ Row 3+: YOUR SCENARIOS (one per row)                        │
└─────────────────────────────────────────────────────────────┘
```

**33 Columns:**
- **8 Required:** name, status, priority, triggers, min_confidence, behavior, quick_replies, full_replies
- **4 Common:** negative_triggers, followup_funnel, action_hooks, cooldown_seconds
- **21 Optional:** Advanced settings, TTS, state machine, security

---

## 🎯 **Column Fill Strategy**

### **Level 1: Basic Scenarios** (80% of use cases)
Fill only these **8 columns:**
```
name, status, priority, triggers, min_confidence, behavior, quick_replies, full_replies
```
Leave all others blank → smart defaults apply

### **Level 2: Service Scenarios** (15% of use cases)
Add these **4 columns:**
```
+ negative_triggers, followup_funnel, action_hooks, cooldown_seconds
```

### **Level 3: Advanced Flows** (5% of use cases)
Use advanced columns as needed:
```
+ entity_capture, dynamic_variables, preconditions, effects, timed_followup_*
```

---

## 🛠️ **Tools & Scripts**

### **Bulk Loader Script** (Coming Soon)
**File:** `scripts/scenario-bulk-loader.js`

**Features:**
- ✅ Load CSV with validation
- ✅ Dry-run mode (preview changes)
- ✅ Error reporting with line numbers
- ✅ Rollback on failure
- ✅ Progress tracking

**Usage:**
```bash
# Dry run (preview only)
node scripts/scenario-bulk-loader.js \
  --csv thermostats.csv \
  --template HVAC_TRADE_TEMPLATE_ID \
  --category THERMOSTATS_CATEGORY_ID \
  --dry-run

# Actual load
node scripts/scenario-bulk-loader.js \
  --csv thermostats.csv \
  --template HVAC_TRADE_TEMPLATE_ID \
  --category THERMOSTATS_CATEGORY_ID
```

---

## 📞 **Support & Resources**

### **Have Questions?**
1. Check `SCENARIO-CSV-QUICK-REFERENCE.md` for quick answers
2. Read `SCENARIO-CSV-FIELD-REFERENCE.md` for detailed explanations
3. Review `AICORE-INTELLIGENCE-SYSTEM.md` for system architecture

### **Common Issues**
- **CSV not loading?** → Check UTF-8 encoding
- **Scenarios not matching?** → Check triggers, min_confidence, negative_triggers
- **Validation errors?** → Review field format in quick reference
- **JSON errors?** → Escape quotes: `{""key"": ""value""}`

---

## 📝 **Changelog**

### **v1.0 - October 24, 2025**
- ✅ Initial release
- ✅ 33-column CSV template
- ✅ Quick reference guide
- ✅ Complete field reference (5,500+ words)
- ✅ Production-ready for HVAC template build

---

**Platform:** ClientsVia Multi-Tenant AI Agent Platform  
**Maintained By:** Platform Engineering Team  
**Last Updated:** October 24, 2025

