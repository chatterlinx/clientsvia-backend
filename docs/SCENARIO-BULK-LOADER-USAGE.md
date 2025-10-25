# 🚀 SCENARIO BULK LOADER - Complete Usage Guide

> **Enterprise-grade system for loading 10-100+ scenarios at once**

---

## 🎯 **Quick Start (Choose Your Method)**

### **Method 1: Web UI** (Point & Click - Easiest)
1. Go to **Global AI Brain** → **Dashboard Tab**
2. Click **"Bulk Upload"** button (purple card)
3. Download CSV template
4. Fill in your scenarios
5. Upload, validate, and load!

### **Method 2: CLI** (Developers & Automation)
```bash
# Dry-run (preview)
node scripts/scenario-bulk-loader.js \
  --csv hvac-thermostats.csv \
  --template 675abc123 \
  --category THERMO_001

# Execute load
node scripts/scenario-bulk-loader.js \
  --csv hvac-thermostats.csv \
  --template 675abc123 \
  --category THERMO_001 \
  --execute
```

---

## 📋 **Step-by-Step: Web UI Method**

### **Step 1: Open Bulk Upload Modal**
1. Login to admin panel
2. Navigate to **Global AI Brain** page
3. Select your template (e.g., "HVAC Trade Knowledge Template")
4. Click the **"Bulk Upload"** button in the purple card

### **Step 2: Download CSV Template**
- Click **"Download CSV Template"** button
- This gives you a clean, production-ready CSV with all 33 fields
- Opens in Excel, Google Sheets, or any CSV editor

### **Step 3: Fill CSV**
**Minimum required fields (8 total):**
1. `name` - Scenario name
2. `status` - `live`, `draft`, or `archived`
3. `priority` - `-10` to `100` (0=normal, 10=emergency)
4. `triggers` - Pipe-separated phrases: `phrase 1|phrase 2|phrase 3`
5. `min_confidence` - `0.0` to `1.0` (0.7=70% confidence)
6. `behavior` - Behavior ID (e.g., `professional_warm`)
7. `quick_replies` - 2-3 variations, pipe-separated
8. `full_replies` - 2-3 variations, pipe-separated

**Reference the Quick Reference guide for all field explanations!**

### **Step 4: Upload CSV**
- Click upload area or drag & drop your CSV
- System shows file name and size
- **Buttons activate** when file is uploaded

### **Step 5: Validate (Optional but Recommended)**
- Click **"Validate Only"** button
- System checks all rows **without writing to database**
- Shows:
  - ✅ Green box: All valid, ready to load
  - ❌ Red box: Errors with row numbers and fixes

**Fix any errors and re-upload before loading!**

### **Step 6: Load Scenarios**
1. Click **"Load Scenarios"** button
2. Enter **Category ID** when prompted (e.g., `THERMO_001`)
3. Watch real-time progress bar
4. Results:
   - ✅ Success: All scenarios loaded
   - ⚠️ Partial: Some failed (details in console)

**Done!** Scenarios appear in your template immediately.

---

## 💻 **Step-by-Step: CLI Method**

### **Prerequisites**
```bash
# 1. Set environment variables
# Add to .env file:
API_BASE_URL=https://clientsvia-backend.onrender.com
ADMIN_TOKEN=your_jwt_token_here

# 2. Get your auth token
# Login to admin → DevTools Console → Run:
localStorage.getItem('token')
```

### **Step 1: Get Template & Category IDs**
```bash
# Open Global AI Brain in browser
# Click on your template
# Note the IDs from URL or console:
Template ID: 675abc123def456
Category ID: THERMO_001
```

### **Step 2: Prepare CSV**
```bash
# Download template
curl https://clientsvia-backend.onrender.com/docs/SCENARIO-BULK-LOADER-CSV-TEMPLATE.csv -o my-scenarios.csv

# Fill in your scenarios using Excel or text editor
```

### **Step 3: Validate (Dry-Run)**
```bash
node scripts/scenario-bulk-loader.js \
  --csv my-scenarios.csv \
  --template 675abc123def456 \
  --category THERMO_001

# Shows:
# ✅ Validation passed
# 📋 Preview of what will be created
# 🚀 Command to execute
```

### **Step 4: Test with First Scenario**
```bash
node scripts/scenario-bulk-loader.js \
  --csv my-scenarios.csv \
  --template 675abc123def456 \
  --category THERMO_001 \
  --test-one \
  --execute

# Loads only first scenario
# Verify in UI → looks good? Continue.
```

### **Step 5: Load All Scenarios**
```bash
node scripts/scenario-bulk-loader.js \
  --csv my-scenarios.csv \
  --template 675abc123def456 \
  --category THERMO_001 \
  --execute

# Loads all scenarios
# ✅ Shows success count
# ❌ Shows any failures
```

---

## 🔧 **CLI Options Reference**

### **Required Arguments**
```bash
--csv <file>          Path to CSV file
--template <id>       Template ID (from Global AI Brain)
--category <id>       Category ID within template
```

### **Execution Modes**
```bash
--execute             Actually load scenarios (default is dry-run)
--dry-run             Preview only, no database writes (default)
--test-one            Load only first scenario (for testing)
--validate-only       Run validation only, then exit
```

### **Advanced Options**
```bash
--continue-on-error   Continue loading even if one fails
--verbose, -v         Show detailed output
--api-url <url>       Override API base URL
--token <jwt>         Override auth token
--help, -h            Show help message
```

---

## 📊 **CSV Format Guide**

### **Header Row (Required)**
```
name,status,priority,triggers,negative_triggers,regex_triggers,min_confidence,behavior,channel,language,quick_replies,full_replies,followup_funnel,reply_selection,entity_capture,dynamic_variables,entity_validation,cooldown_seconds,handoff_policy,timed_followup_enabled,timed_followup_delay,timed_followup_extension,timed_followup_messages,silence_max_consecutive,silence_final_warning,tts_pitch,tts_rate,tts_volume,preconditions,effects,action_hooks,sensitive_info_rule,custom_masking
```

### **Data Row Example**
```csv
"Thermostat blank screen",live,10,"thermostat blank|no display|screen off","smart thermostat setup|wifi pairing",,0.70,professional_warm,any,auto,"A blank thermostat usually means no power or low battery.|Let's get that thermostat powered up.","If your thermostat screen is blank it's typically dead batteries or a tripped breaker. Try fresh batteries and check the breaker. If it stays blank we should take a look at low-voltage power to the system.|A blank screen usually means either the batteries died or there's a power issue.","Do you want me to schedule a tech to check power and safety switches?",random,,name=valued customer,,0,low_confidence,false,50,30,,2,Hello? Did I lose you?,,,,,,offer_service,platform_default,
```

### **Formatting Rules**
- **Pipe-separated** (`|`): `triggers`, `negative_triggers`, `quick_replies`, `full_replies`, `entity_capture`
- **Comma-separated** (`,`): `action_hooks`
- **Key=value pairs** (`|` separated): `dynamic_variables`
- **JSON objects** (wrap in quotes): `entity_validation`, `preconditions`, `effects`, `custom_masking`
- **Booleans**: `true`, `false`, `yes`, `no`, `1`, `0`
- **Enums**: Case-insensitive (e.g., `LIVE` = `live` = `Live`)

---

## ✅ **Validation Rules**

### **Always Checked**
- ✅ 33 columns present
- ✅ UTF-8 encoding
- ✅ Required fields not empty
- ✅ Enum values valid
- ✅ Numbers in range
- ✅ JSON is valid
- ✅ Behavior exists in database
- ✅ Min 1 trigger phrase
- ✅ Min 2-3 reply variations

### **Warnings (Not Errors)**
- ⚠️ Less than 3 trigger phrases
- ⚠️ Less than 2 quick reply variations
- ⚠️ Less than 2 full reply variations

---

## 🛡️ **Safety Features**

### **Pre-Validation** (Zero Risk)
- All rows checked **before** any database write
- Errors reported with row numbers and fixes
- **Nothing written until 100% valid**

### **Atomic Transactions**
- All scenarios loaded in single transaction
- If ANY fail → **ALL rollback**
- Database stays clean (no partial imports)

### **Smart Retry Logic**
- Network timeouts: 3 retries with backoff
- Rate limits: Auto-wait and resume
- Server errors: Retry once, then fail gracefully

### **Clear Error Messages**
- Row-level validation errors
- Suggested fixes ("Did you mean...?")
- Available options displayed

---

## ❌ **Troubleshooting**

### **CSV Upload Failed**
```
Error: CSV must have 33 columns, found 32
```
**Fix:** Make sure all 33 columns are in header row (no missing commas)

---

### **Validation Errors**
```
Row 5: behavior "profesional_warm" not found
Available: professional_warm, empathetic_reassuring, ...
Did you mean: "professional_warm"?
```
**Fix:** Check spelling, copy exact `behaviorId` from Behaviors tab

---

### **Authentication Failed**
```
Error: Authentication failed: Invalid token
```
**Fix:**
1. Login to admin panel
2. DevTools Console → Run: `localStorage.getItem('token')`
3. Update `.env`: `ADMIN_TOKEN=your_token_here`

---

### **Network Timeout**
```
Request timeout - API not responding
```
**Fix:**
1. Check internet connection
2. Verify API URL: `curl https://clientsvia-backend.onrender.com/health`
3. Try again (script auto-retries 3x)

---

### **Category Not Found**
```
Error: Category "THERMO_001" not found in template
```
**Fix:**
1. Go to Global AI Brain → your template
2. Find correct category ID
3. Use exact ID (case-sensitive)

---

## 💡 **Pro Tips**

### **For First-Time Users**
1. ✅ Start with **1-2 test scenarios**
2. ✅ Use **Web UI** (easier than CLI)
3. ✅ Always **validate first** before loading
4. ✅ Keep **Quick Reference open** while filling CSV

### **For Power Users**
1. ✅ Use **CLI + dry-run** for large batches
2. ✅ Test with `--test-one` before full load
3. ✅ Use `--verbose` for debugging
4. ✅ Automate with shell scripts

### **For Teams**
1. ✅ One person fills CSV, another reviews
2. ✅ Version control your CSV files (Git)
3. ✅ Document custom behaviors/hooks
4. ✅ Use consistent naming conventions

---

## 📚 **Related Documentation**

- **Quick Reference:** `SCENARIO-CSV-QUICK-REFERENCE.md` - Fast field lookup
- **Field Reference:** `SCENARIO-CSV-FIELD-REFERENCE.md` - Comprehensive guide
- **AI System:** `AICORE-INTELLIGENCE-SYSTEM.md` - How scenarios work
- **Index:** `SCENARIO-BULK-LOADER-README.md` - Documentation map

---

## 🎯 **Real-World Examples**

### **Example 1: Loading 7 Thermostat Scenarios**

**CSV File:** `hvac-thermostats.csv`
- 7 rows (thermostats scenarios)
- All required fields filled
- 3-5 triggers per scenario
- 3 reply variations each

**CLI Command:**
```bash
node scripts/scenario-bulk-loader.js \
  --csv hvac-thermostats.csv \
  --template 675abc123 \
  --category THERMO_001 \
  --execute
```

**Result:**
```
✅ Validation passed: 7 scenarios ready
🚀 Loading scenarios...
  [1/7] Creating "Thermostat blank screen"...
  ✅ Created: Thermostat blank screen
  [2/7] Creating "Thermostat not responding"...
  ✅ Created: Thermostat not responding
  ... (5 more)
✅ SUCCESS: 7 scenarios loaded
```

---

### **Example 2: Web UI - Quick Upload**

1. **Open Global AI Brain**
2. **Click "Bulk Upload"**
3. **Download template**
4. **Fill 10 scenarios in Excel**
5. **Upload CSV**
6. **Click "Validate"** → ✅ All valid
7. **Click "Load"** → Enter `THERMO_001`
8. **Watch progress bar** → 100% complete
9. **Done!** 10 scenarios in template

**Time: ~5 minutes** (including CSV fill)

---

## ⚡ **Performance & Limits**

- **Max file size:** 10MB
- **Recommended batch:** 10-50 scenarios per load
- **Large batches (50+):** CLI recommended (better for automation)
- **Load time:** ~0.5-1 second per scenario
- **Network timeouts:** Auto-retry 3x with backoff

---

## 🔐 **Security & Permissions**

- **Authentication:** JWT token required
- **Authorization:** Admin role required
- **Audit logging:** All loads tracked
- **Validation:** Server-side + client-side
- **No SQL injection:** Parameterized queries
- **Rate limiting:** 100 requests/min per user

---

## 📞 **Support**

### **Have Questions?**
1. Check **Quick Reference** for field explanations
2. Read **Field Reference** for detailed examples
3. Review **AICORE-INTELLIGENCE-SYSTEM.md** for architecture

### **Found a Bug?**
1. Check console for detailed error
2. Try with `--verbose` flag (CLI)
3. Note row number and error message
4. Report with CSV example (redact sensitive data)

---

**Last Updated:** October 24, 2025  
**Version:** 1.0  
**Platform:** ClientsVia Multi-Tenant AI Agent Platform  
**Maintained By:** Platform Engineering Team

---

🚀 **Ready to load your first batch of scenarios?** Start with the Web UI and 1-2 test scenarios! 💪

