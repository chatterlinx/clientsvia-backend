# 🎯 Enterprise AiCore Variables System - User Guide

**Version:** 2.0  
**Last Updated:** November 4, 2025  
**Status:** ✅ Production Ready

---

## 📖 Table of Contents

1. [Introduction](#introduction)
2. [Why Variables Matter](#why-variables-matter)
3. [Quick Start](#quick-start)
4. [Understanding the Dashboard](#understanding-the-dashboard)
5. [Automatic Scanning](#automatic-scanning)
6. [Smart Force Scan](#smart-force-scan)
7. [Managing Variables](#managing-variables)
8. [Differential Analysis](#differential-analysis)
9. [Template Breakdown](#template-breakdown)
10. [Best Practices](#best-practices)
11. [Troubleshooting](#troubleshooting)
12. [Advanced Features](#advanced-features)

---

## 🎯 Introduction

The **Enterprise AiCore Variables System** is the heart of your AI agent's ability to provide personalized, accurate responses to your customers. When a customer calls and asks about your business hours, pricing, or location, the AI agent pulls this information from **variables**.

### What Are Variables?

Variables are **dynamic placeholders** in your AI templates that get replaced with your actual company information:

```
Template: "We're open {business_hours}. Located at {address}."
Becomes:  "We're open Mon-Fri 9am-5pm. Located at 123 Main St."
```

Without variables, your AI would give generic responses. With variables, every response is **personalized to YOUR company**.

---

## 🚨 Why Variables Matter

### The Critical Link

```
┌─────────────────┐      ┌──────────────┐      ┌──────────────┐
│  AI Templates   │ ───> │  Variables   │ ───> │  Customer    │
│  (Global Brain) │      │  (Your Data) │      │  Response    │
└─────────────────┘      └──────────────┘      └──────────────┘
```

**Without accurate variable scanning:**
- ❌ AI won't know what information it needs
- ❌ Customers will get generic or incorrect responses
- ❌ Your AI agent can't provide value

**With the Enterprise Variables System:**
- ✅ **Automatic detection** of all required variables
- ✅ **Real-time updates** when templates change
- ✅ **100% accuracy** in scanning (no missed placeholders)
- ✅ **Smart differential analysis** to track changes

---

## 🚀 Quick Start

### Step 1: Activate a Template

1. Go to **AI Agent Settings** → **Global AI Brain**
2. Select a template (e.g., "Universal AI Brain")
3. Click **Add Template**

👉 **Automatic scan runs immediately!**

### Step 2: Review Detected Variables

1. Go to **AI Agent Settings** → **AiCore Variables**
2. Check the **Enterprise Scan Report** section
3. You'll see:
   - How many variables were found
   - Which templates were scanned
   - Word count statistics
   - Template breakdown

### Step 3: Fill In Your Variables

1. Click on the **Variables Management** tab
2. You'll see all detected variables grouped by category
3. Fill in **your company's actual information**:
   - `{company_name}` → "ABC Plumbing Services"
   - `{business_hours}` → "Mon-Fri 8am-6pm, Sat 9am-3pm"
   - `{phone_number}` → "+1 (555) 123-4567"
4. Click **Save Variables**

### Step 4: Test It!

Go to **Testing Center** and call in with a test phrase like:
- "What are your hours?"
- "How much do you charge?"
- "Where are you located?"

The AI will respond with **YOUR variables** automatically!

---

## 📊 Understanding the Dashboard

### System Health Header

```
┌─────────────────────────────────────────────────────────┐
│  SYSTEM ✓ HEALTHY                                       │
│  Variables Management Control Center                    │
│                                                         │
│  Last Scan: 2 hours ago                                │
│  Variables Found: 18 unique                            │
│  Completion: 16/18 (89%)                               │
│                                                         │
│         [🔍 Force Scan Now]                            │
└─────────────────────────────────────────────────────────┘
```

**Status Indicators:**
- ✅ **HEALTHY** - All variables scanned and filled
- ⚠️ **NEEDS ATTENTION** - Missing required variables
- 🔄 **SCANNING** - Background scan in progress

---

## 🔄 Automatic Scanning

### When Scans Automatically Trigger

The system automatically scans for variables in these situations:

#### 1️⃣ **Template Activation**
```
You: [Add "Universal AI Brain" template]
System: 🔍 Auto-scan triggered...
        📊 Found 18 variables across 45 scenarios
        ✨ +18 new variables discovered!
```

#### 2️⃣ **Template Removal**
```
You: [Remove "HVAC Specialist" template]
System: 🔍 Cleanup scan triggered...
        📊 6 variables removed (orphaned by template removal)
        ℹ️  Remaining: 12 variables
```

#### 3️⃣ **Template Updates** (Global Admin)
```
Admin: [Updates "Universal AI Brain" template]
System: 🔍 All companies using this template auto-scan...
        📊 Change detected in 850 companies
        ✨ +2 new variables: {service_area}, {warranty_period}
```

### Background Scanning

Scans run **in the background** and don't block the UI:

```
┌─────────────────────────────────────────────┐
│  🔄 Background Scan in Progress             │
│                                             │
│  Scanning Universal AI Brain...             │
│  Progress: 32/45 scenarios (71%)           │
│                                             │
│  [████████████░░░░░] 71%                   │
│                                             │
│  ℹ️  You can close this page and it will  │
│     continue running.                      │
└─────────────────────────────────────────────┘
```

---

## 🎯 Smart Force Scan

### When to Use Force Scan

Click **Force Scan Now** in these scenarios:

1. **After manual template edits** (if admin edited scenarios directly)
2. **Verification scan** (confirm everything is up to date)
3. **Troubleshooting** (if something seems off)

### Smart Messaging

The Force Scan button is **intelligent** and tells you exactly what it found:

#### Scenario 1: No Changes
```
┌─────────────────────────────────────┐
│  ✅ No New Findings                 │
│                                     │
│  This scan found the exact same    │
│  18 variables as the previous scan. │
│                                     │
│  All templates, scenarios, and     │
│  variables are unchanged.          │
└─────────────────────────────────────┘
```

#### Scenario 2: Zero Variables (Valid State)
```
┌─────────────────────────────────────┐
│  ℹ️  Zero Variables Found           │
│                                     │
│  No {variable} placeholders were   │
│  found in your active templates.   │
│                                     │
│  This is valid if your templates   │
│  don't use dynamic content.        │
└─────────────────────────────────────┘
```

#### Scenario 3: Changes Detected
```
┌─────────────────────────────────────┐
│  🔄 Changes Detected                │
│                                     │
│  +3 new, -1 removed, ↕️1 modified  │
│                                     │
│  Total: 20 unique variables        │
└─────────────────────────────────────┘
```

---

## 📦 Template Breakdown

### Understanding the Breakdown

For each template, you'll see detailed statistics:

```
┌──────────────────────────────────────────────────────────┐
│  Universal AI Brain (All Industries) v1.0.0   Priority 1 │
│                                                          │
│  Categories: 12/12 ✅    Scenarios: 45/45 ✅            │
│  Variables: 18 (72 uses) Words: 8,342 (1,456 unique)   │
└──────────────────────────────────────────────────────────┘
```

**What This Tells You:**
- **12/12 Categories** - All categories were scanned
- **45/45 Scenarios** - All scenarios were scanned
- **18 variables (72 uses)** - 18 unique variables, used 72 times total
- **8,342 words** - Total word count across all responses
- **1,456 unique** - Vocabulary diversity

### Why Word Count Matters

Word counts help you understand:
- **Template complexity** (more words = more sophisticated responses)
- **Vocabulary richness** (unique/total ratio)
- **Scan completeness** (proof that all content was analyzed)

---

## 🔄 Differential Analysis

### Change Tracking

The system tracks **every change** between scans:

```
┌─────────────────────────────────────────────────┐
│  🔄 Changes Since Last Scan                     │
│                                                 │
│  ➕ 3 New Variables                             │
│  • {service_area} - 8 uses                     │
│  • {warranty_period} - 5 uses                  │
│  • {emergency_phone} - 3 uses                  │
│                                                 │
│  ➖ 1 Removed Variable                          │
│  • {old_pricing_model}                         │
│                                                 │
│  ↕️ 1 Modified Variable                         │
│  • {business_hours} - 12 → 15 uses (+3)       │
└─────────────────────────────────────────────────┘
```

### Why Differential Analysis Matters

1. **Audit Trail** - See exactly what changed and when
2. **Orphaned Variables** - Detect variables no longer needed
3. **Usage Trends** - See which variables are used more frequently
4. **Quality Assurance** - Verify template updates didn't break anything

---

## 🛠️ Managing Variables

### Variable Categories

Variables are automatically organized by category:

```
┌─────────────────────────────────────────┐
│  📞 Contact Information (4 variables)   │
│  ├─ company_name                        │
│  ├─ phone_number                        │
│  ├─ email                               │
│  └─ website                             │
│                                         │
│  🕒 Business Operations (3 variables)   │
│  ├─ business_hours                      │
│  ├─ service_area                        │
│  └─ emergency_phone                     │
│                                         │
│  💰 Pricing & Services (5 variables)    │
│  ├─ base_price                          │
│  ├─ consultation_fee                    │
│  └─ ...                                 │
└─────────────────────────────────────────┘
```

### Variable Types

The system infers the correct type for each variable:

| Type | Example | Validation |
|------|---------|------------|
| `text` | Company name | Any text |
| `phone` | Phone number | Phone format validation |
| `email` | Email address | Email format validation |
| `url` | Website | URL format validation |
| `currency` | Pricing | Numeric + currency symbol |
| `time` | Business hours | Time/schedule format |

### Required vs. Optional

- **Required** ⭐ - Variables that MUST be filled (AI can't respond without them)
- **Optional** - Variables that enhance responses but aren't critical

```
┌─────────────────────────────────────────┐
│  ⭐ phone_number (REQUIRED)             │
│  "Main contact number for customers"   │
│  📱 Phone Number                        │
│  [________________]                     │
│                                         │
│  ℹ️  Used in 12 scenarios              │
└─────────────────────────────────────────┘
```

---

## ✅ Best Practices

### 1. Keep Variables Updated

```
❌ BAD:  Set it once and forget
✅ GOOD: Review variables monthly

Example:
- Update {business_hours} when hours change
- Update {service_area} when you expand
- Update {pricing} when rates change
```

### 2. Fill Required Variables First

```
Priority Order:
1. ⭐ Required contact info (phone, email, address)
2. ⭐ Required business info (hours, services)
3. Optional enhancement variables
```

### 3. Use Descriptive Values

```
❌ BAD:  {phone_number} = "Call us"
✅ GOOD: {phone_number} = "+1 (555) 123-4567"

❌ BAD:  {business_hours} = "Open daily"
✅ GOOD: {business_hours} = "Mon-Fri 8am-6pm, Sat 9am-3pm"
```

### 4. Test After Changes

```
Workflow:
1. Update variables
2. Save
3. Go to Testing Center
4. Test with real phrases
5. Verify AI uses your new values
```

### 5. Monitor Scan History

```
Check the scan history to:
- See when last scan ran
- Review what changed
- Catch any unexpected changes
```

---

## 🔧 Troubleshooting

### Issue 1: "Zero Variables Found"

**Symptoms:**
```
ℹ️  Zero Variables Found
No {variable} placeholders were found in your active templates.
```

**Possible Causes:**
1. No templates are activated
2. Templates don't use any `{variable}` syntax
3. All scenarios are marked as inactive

**Solutions:**
1. Go to **Global AI Brain** → Add a template
2. Check that template categories/scenarios are active
3. Contact support if using custom templates

---

### Issue 2: "Missing Required Variables"

**Symptoms:**
```
⚠️  Missing Required Variables
3 required variables are not filled:
- {phone_number}
- {business_hours}
- {address}
```

**Solutions:**
1. Go to **Variables Management** tab
2. Find the starred ⭐ required variables
3. Fill them in with your company info
4. Click **Save Variables**

---

### Issue 3: "Variables Not Updating in AI Responses"

**Symptoms:**
- You updated a variable
- Saved successfully
- But AI still uses old value

**Solutions:**
1. **Clear cache:**
   - Click **Force Scan Now**
   - Wait for scan to complete
2. **Restart test session:**
   - If using Testing Center, refresh the page
3. **Check Redis cache:**
   - Variables are cached for performance
   - Backend clears cache automatically after saves
   - If issue persists, contact support

---

### Issue 4: "Scan Stuck at 'Scanning...'"

**Symptoms:**
```
🔄 Background Scan in Progress
Scanning... 0/0 scenarios (0%)
```

**Solutions:**
1. Wait 30 seconds (scans usually complete quickly)
2. Refresh the page
3. Check **Scan History** to see if scan actually completed
4. If stuck >5 minutes, contact support (check backend logs)

---

## 🚀 Advanced Features

### API Access

Variables can be accessed programmatically:

```javascript
// GET all variables for a company
GET /api/company/:companyId/configuration/variables

// Trigger manual scan
POST /api/company/:companyId/configuration/variables/scan

// Get scan status
GET /api/company/:companyId/configuration/variables/scan-status

// Update variables
PATCH /api/company/:companyId/configuration/variables
```

### Scan Report Structure

The comprehensive scan report includes:

```json
{
  "scanId": "scan-abc123",
  "timestamp": "2025-11-04T10:30:00Z",
  "companyId": "company-xyz",
  "triggerReason": "template_added",
  "triggeredBy": "admin@company.com",
  
  "aggregated": {
    "uniqueVariables": 18,
    "totalPlaceholders": 72,
    "totalScenarios": 45,
    "totalWords": 8342,
    "uniqueWords": 1456
  },
  
  "templatesScanned": {
    "total": 1,
    "list": [...]
  },
  
  "differential": {
    "summary": {
      "isFirstScan": false,
      "noChangesDetected": false,
      "newVariablesCount": 3,
      "removedVariablesCount": 1,
      "modifiedVariablesCount": 1
    },
    "variablesChanged": {
      "new": [...],
      "removed": [...],
      "modified": [...],
      "unchanged": [...]
    }
  },
  
  "performance": {
    "scenariosPerSecond": 15.2
  },
  
  "duration": 2.96
}
```

### Event-Driven Architecture

The system uses event hooks:

```
Template Added    → Auto-scan triggered    → Variables updated
Template Removed  → Cleanup scan triggered → Orphaned vars removed
Template Modified → Re-scan triggered      → Diff analysis run
```

---

## 📞 Support

### Need Help?

1. **Check this guide first**
2. **Review scan history logs** for clues
3. **Check backend logs** (if you have access)
4. **Contact support** with:
   - Company ID
   - Scan ID (from scan report)
   - Description of issue
   - Screenshots if applicable

### Feedback

We're constantly improving the Enterprise Variables System. If you have suggestions or find bugs, please let us know!

---

## 🎓 Summary

### Key Takeaways

✅ **Automatic Detection** - System finds all `{variable}` placeholders  
✅ **Real-Time Updates** - Scans trigger on template changes  
✅ **Smart Messaging** - Force Scan tells you exactly what changed  
✅ **100% Accuracy** - No missed variables (tested and verified)  
✅ **Differential Analysis** - Track changes over time  
✅ **Enterprise-Grade** - Built for scale and reliability  

### The Critical Link

```
Without Variables → Generic AI responses ❌
With Variables     → Personalized AI responses ✅
```

Your variables are **the bridge** between your AI templates and your customers. Keep them accurate, and your AI agent will provide **world-class service** to every caller.

---

**Version:** 2.0  
**Last Updated:** November 4, 2025  
**Status:** ✅ Production Ready

