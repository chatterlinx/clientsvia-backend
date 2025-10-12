# 📁 Seed Templates Directory

## 🎯 Purpose

This folder contains **isolated, self-contained seed scripts** for creating Global AI Brain templates. Each file creates a complete template with categories and scenarios.

---

## 🏗️ Structure

```
seed-templates/
├── README.md                              ← You are here
├── universal-test-12-categories.js        ← Test template (12 categories)
├── universal-full-103-categories.js       ← (Future) Production template
├── dental-office-template.js              ← (Future) Dental industry
└── hvac-template.js                       ← (Future) HVAC industry
```

---

## ✅ Benefits of This Approach

1. **Clean Isolation** - Each template is in its own file
2. **Easy Deletion** - Delete the file, no traces in codebase
3. **Version Control** - Track template changes over time
4. **No Cross-Contamination** - Templates don't interfere with each other
5. **Easy Testing** - Spin up test data, test, then delete

---

## 🚀 How to Use

### Run a Seed Script

```bash
node scripts/seed-templates/universal-test-12-categories.js
```

### Delete a Template

**Option 1: Via UI**
- Go to Global AI Brain → Dashboard → Templates
- Click the delete button for the template

**Option 2: Via MongoDB**
```javascript
db.globalinstantresponsetemplates.deleteOne({ 
    name: "Universal AI Brain (All Industries)" 
})
```

**Option 3: Delete the Script File**
- Just delete this file when you're done testing
- No code traces left behind!

---

## 📝 Current Templates

### `universal-test-12-categories.js`

**Purpose:** Comprehensive test template with 12 categories covering all form fields

**Categories:**
1. 📅 Appointment Booking (2 scenarios)
2. 🚨 Emergency Service (1 scenario)
3. 💰 Pricing Questions (1 scenario)
4. 🕐 Business Hours (1 scenario)
5. ⏸️ Hold Request (1 scenario)
6. 👋 Gratitude / Goodbye (1 scenario)
7. 😟 Complaint / Problem (1 scenario)
8. 💳 Payment Plans (1 scenario)
9. 📋 Billing Question (1 scenario)
10. ❓ General Inquiry (1 scenario)
11. 💬 Small Talk / Off-Topic (1 scenario)
12. 🤔 Confused / Uncertain (1 scenario)

**Total Scenarios:** 14

**Features Tested:**
- ✅ Triggers (positive, negative, regex)
- ✅ Priority levels (-10 to 100)
- ✅ Confidence thresholds
- ✅ Entity capture & validation
- ✅ Dynamic variables with fallbacks
- ✅ Action hooks
- ✅ Reply variations (quick & full)
- ✅ Follow-up funnels
- ✅ Timed follow-ups
- ✅ Silence policies
- ✅ Handoff policies
- ✅ Cooldowns & max turns
- ✅ Language & channel selection
- ✅ Behavior assignment

---

## 🧪 Testing Workflow

1. **Run the seed script**
   ```bash
   node scripts/seed-templates/universal-test-12-categories.js
   ```

2. **Test via UI**
   - Open Global AI Brain dashboard
   - Verify categories and scenarios appear
   - Edit scenarios via the world-class form
   - Test all form fields

3. **Test via Phone**
   - Configure Twilio test number in Overview → Dashboard
   - Call the test number
   - Say different phrases to trigger scenarios
   - Verify responses and matching logic

4. **Iron out bugs**
   - Fix any issues in the UI or matching logic
   - Refine scenarios based on test results

5. **Clean up when done**
   - Delete the template via UI
   - Optionally delete this seed file
   - No traces left behind!

---

## 🔮 Future Templates

As we scale, we'll add:

- `universal-full-103-categories.js` - Complete production template
- `dental-office-template.js` - Dental industry-specific scenarios
- `hvac-template.js` - HVAC industry scenarios
- `plumbing-template.js` - Plumbing industry scenarios
- `automotive-template.js` - Auto repair scenarios
- `healthcare-template.js` - Medical office scenarios

Each will be isolated, self-contained, and easy to manage!

---

## 🧹 Cleanup Guidelines

**When testing is complete:**

1. ✅ Delete the template via UI (or MongoDB command)
2. ✅ Keep the seed file (for future reference) OR delete it
3. ✅ No manual file hunting required!
4. ✅ No risk of leaving dead code

**The beauty of this approach:**
- Templates are **data**, not code
- Seed files are **tools**, not dependencies
- Everything is **isolated** and **organized**

---

## 🌟 World-Class Code Standards

This folder follows ClientsVia's coding principles:

- ✅ **Clean** - Well-commented, clearly labeled
- ✅ **Organized** - Logical structure, easy to navigate
- ✅ **Isolated** - No cross-contamination between templates
- ✅ **Deletable** - Easy to remove with zero traces
- ✅ **Production-Ready** - No shortcuts, no placeholders

---

**BUILT WITH LOVE BY THE CLIENTSVIA TEAM** 🔥💪

