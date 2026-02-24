# 🗂️ QUICK REFERENCE - PAGES & MODALS
## Visual Index for Rapid Navigation

**Last Updated:** February 24, 2026

---

## 📄 ALL PAGES (6 Total)

### **PAGE 1: DASHBOARD**
```
📍 /agent-console/index.html
🔗 /agent-console/index.html?companyId={id}
📄 385 lines (index.js)
🪟 Modals: 0
```

**Components:**
- 4 Navigation Cards (Agent 2.0, Booking, Global Hub, Calendar)
- Runtime Truth JSON Viewer
- Download Truth button

**Links:**
- → agent2.html
- → booking.html
- → global-hub.html
- → calendar.html
- ← company-profile.html

---

### **PAGE 2: AGENT 2.0 DISCOVERY**
```
📍 /agent-console/agent2.html
🔗 /agent-console/agent2.html?companyId={id}
📄 1554 lines (agent2.js)
🪟 Modals: 1
```

**Sections:**
1. Health Status Bar
2. Discovery Statistics
3. 🎙️ Call Start Greeting
4. 👋 Greeting Interceptor + Rules Table
5. Booking Consent Phrases
6. Escalation Phrases
7. Discovery Style
8. Live Test Turn Panel
9. Handoff Contract Reference

**Modals:**
- ✅ Greeting Rule Modal

**Links:**
- → triggers.html (Manage Trigger Cards)
- → company-profile.html (ElevenLabs setup)
- ← index.html

---

### **PAGE 3: TRIGGER CONSOLE**
```
📍 /agent-console/triggers.html
🔗 /agent-console/triggers.html?companyId={id}
📄 1776+ lines (triggers.js)
🪟 Modals: 4
```

**Sections:**
1. Group Console (Global Trigger Group selector)
2. Stats Bar (Global, Local, Overrides, Total, Disabled)
3. Company Variables Table (auto-detected)
4. Trigger Cards Table

**Modals:**
- ✅ Trigger Edit Modal (main)
  - ✅ GPT Settings Modal (sub-modal)
- ✅ Approval Modal
- ✅ Create Global Group Modal

**Features:**
- Scope filter (All, Global, Local)
- Search triggers
- Health check (duplicates)
- GPT-4 Prefill
- Audio generation per trigger
- Variable detection & editing

**Links:**
- ← agent2.html
- → company-profile.html (ElevenLabs)

---

### **PAGE 4: BOOKING LOGIC**
```
📍 /agent-console/booking.html
🔗 /agent-console/booking.html?companyId={id}
📄 481+ lines (booking.js)
🪟 Modals: 0
```

**Sections:**
1. Calendar Connection Status
2. Booking Parameters (slot duration, buffer, advance window)
3. Confirmation Settings
4. Booking Flow Steps (reference)
5. Booking Flow Simulator
6. bookingCtx Contract Reference

**⚠️ Missing UI:**
- Booking Prompts (all hardcoded in backend)

**Links:**
- ← index.html
- → company-profile.html

---

### **PAGE 5: GLOBAL HUB**
```
📍 /agent-console/global-hub.html
🔗 /agent-console/global-hub.html?companyId={id}
📄 401+ lines (global-hub.js)
🪟 Modals: 1
```

**Sections:**
1. First Names Dictionary (with stats)
2. Platform Default Triggers
3. Vocabulary Normalization (examples)
4. Global Intelligence (model display)

**Modals:**
- ✅ First Names Search Modal

**Links:**
- ← index.html

---

### **PAGE 6: GOOGLE CALENDAR**
```
📍 /agent-console/calendar.html
🔗 /agent-console/calendar.html?companyId={id}
📄 490+ lines (calendar.js)
🪟 Modals: 0
```

**Sections:**
1. Connection Status (3 states: Connected, Disconnected, Error)
2. Primary Calendar Selection
3. Test Availability
4. Booking Logic Integration Info

**States:**
- Connected: Show email, timestamp, calendar, test/disconnect buttons
- Disconnected: Show warning, connect button
- Error: Show error message, retry button

**Links:**
- ← index.html

---

## 🪟 ALL MODALS (6 Total)

### **MODAL 1: Greeting Rule Modal**
```
🆔 modal-greeting-rule
📍 agent2.html (lines 453-528)
📐 Size: Standard
🔧 Fields: 6
🎯 Purpose: Add/Edit greeting interceptor rules
```

**Opened From:**
- agent2.html → Greeting Interceptor → "Add Rule" button
- agent2.html → Greeting Rules Table → Edit icon

**Fields:**
1. Priority (1-1000)
2. Match Type (EXACT, FUZZY, CONTAINS, REGEX)
3. Triggers (comma-separated)
4. Response (max 300 chars)
5. Audio URL (readonly, generated)
6. Rule ID (hidden, auto-generated)

**Buttons:**
- Save Rule
- Cancel
- Generate Audio
- Play Audio

---

### **MODAL 2: Trigger Edit Modal**
```
🆔 modal-trigger-edit
📍 triggers.html (lines 1009-1215)
📐 Size: Standard (600px)
🔧 Fields: 13+
🎯 Purpose: Add/Edit trigger cards
```

**Opened From:**
- triggers.html → "Add Trigger" button
- triggers.html → Trigger Table → Edit icon

**Sections:**
1. **Basic Info**
   - Label
   - Rule ID (category.topic)
   - Priority (1-1000)

2. **Matching Rules**
   - Keywords (comma-separated)
   - Phrases (comma-separated)
   - Negative Keywords (comma-separated)
   - GPT Settings button
   - GPT-4 Prefill button

3. **Response** (Mode-dependent)
   - **Toggle:** Standard / LLM Fact Pack
   - **Standard Mode:**
     - Answer Text
     - Audio URL (readonly, generated)
     - Generate/Play buttons
   - **LLM Mode:**
     - Included Facts (max 2500)
     - Excluded Facts (max 2500)
     - Backup Answer (max 500, required)

4. **Follow-up**
   - Follow-up Question

5. **Scope** (new triggers only)
   - Create as Local (checkbox)

**Buttons:**
- Save Trigger
- Cancel
- Generate Audio (Standard mode only)
- Play Audio (Standard mode only)
- GPT Settings (opens Modal 4)
- GPT-4 Prefill

**Special Features:**
- Dark theme styling
- Response mode switching
- Audio status tracking (ready, stale, missing)

---

### **MODAL 3: Approval Modal**
```
🆔 modal-approval
📍 triggers.html (lines 1217-1244)
📐 Size: Small (400px)
🔧 Fields: 1
🎯 Purpose: Confirm destructive actions
```

**Opened From:**
- triggers.html → Delete trigger
- triggers.html → Change global group
- triggers.html → Disable global trigger
- triggers.html → Toggle trigger scope

**Dynamic Content:**
- Title (varies by action)
- Warning text (varies by action)
- Approval phrase (varies: "approved", "Yes", etc.)

**Buttons:**
- Cancel (secondary)
- Confirm (danger - red)

**Actions Requiring Approval:**
1. Delete any trigger
2. Change global trigger group (affects live calls)
3. Disable global trigger (affects all companies)
4. Toggle trigger scope (create override)

---

### **MODAL 4: GPT Settings Modal**
```
🆔 modal-gpt-settings
📍 triggers.html (lines 1247-1313)
📐 Size: Medium (500px)
🔧 Fields: 5
🎯 Purpose: Configure GPT-4 prefill AI
```

**Opened From:**
- triggers.html → Trigger Edit Modal → GPT Settings gear icon

**Fields:**
1. Business Type (dropdown)
   - HVAC / Air Conditioning
   - Plumbing
   - Electrical
   - Dental Office
   - Medical Practice
   - Law Firm
   - Automotive / Mechanic
   - Landscaping
   - Cleaning Services
   - General Service Business

2. Default Priority (1-1000)

3. Tone (dropdown)
   - Friendly & Conversational
   - Professional & Formal
   - Casual & Relaxed
   - Empathetic & Supportive

4. Additional Instructions (textarea)

5. Generate follow-up questions (checkbox)

**Storage:** LocalStorage (client-side only)

**Buttons:**
- Save Settings
- Cancel

---

### **MODAL 5: Create Global Group Modal**
```
🆔 modal-create-group
📍 triggers.html (lines 1315-1374)
📐 Size: Standard
🔧 Fields: 4
🎯 Purpose: Create new global trigger group
```

**Opened From:**
- triggers.html → Group Console → "New Group" button

**Warning Banner:**
⚠️ "WARNING: This is NOT a trigger card!"

**Fields:**
1. Group ID (lowercase, alphanumeric + hyphens)
2. Name
3. Icon (emoji, default: 📋)
4. Description

**Buttons:**
- Create Group
- Cancel

**Extra Confirmation:**
Browser prompt requiring "yes global" text

**Permission:**
Requires `canCreateGroup` permission

---

### **MODAL 6: First Names Modal**
```
🆔 modal-firstnames
📍 global-hub.html (lines 243-285)
📐 Size: Medium (700px)
🔧 Fields: 1
🎯 Purpose: Search first names dictionary
```

**Opened From:**
- global-hub.html → First Names Dictionary → "Search Names" button

**Components:**
- Search input
- Search button
- Results display (Found/Not Found with icons)
- Sample names tag list

**API:**
- `GET /api/admin/global-hub/first-names/lookup?name={name}`

**Buttons:**
- Search
- Close

---

## 🗺️ PAGE-MODAL RELATIONSHIP MAP

```
┌─────────────────────────────────────────────┐
│  PAGE: index.html (Dashboard)               │
│  Modals: NONE                               │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  PAGE: agent2.html (Agent 2.0)              │
│  Modals: 1                                  │
│    └─ Greeting Rule Modal                   │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  PAGE: triggers.html (Trigger Console)      │
│  Modals: 4                                  │
│    ├─ Trigger Edit Modal ────────┐          │
│    │    └─ GPT Settings Modal    │ (nested) │
│    ├─ Approval Modal             │          │
│    └─ Create Global Group Modal  │          │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  PAGE: booking.html (Booking Logic)         │
│  Modals: NONE                               │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  PAGE: global-hub.html (Global Hub)         │
│  Modals: 1                                  │
│    └─ First Names Modal                     │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  PAGE: calendar.html (Google Calendar)      │
│  Modals: NONE                               │
└─────────────────────────────────────────────┘
```

---

## 🎨 COMPONENT QUICK REFERENCE

### **Tables (3):**
1. Greeting Rules Table (agent2.html)
2. Trigger Cards Table (triggers.html)
3. Company Variables Table (triggers.html)

### **Modals (6):**
1. Greeting Rule Modal (agent2.html)
2. Trigger Edit Modal (triggers.html)
3. Approval Modal (triggers.html)
4. GPT Settings Modal (triggers.html)
5. Create Global Group Modal (triggers.html)
6. First Names Modal (global-hub.html)

### **Test Panels (3):**
1. Live Test Turn (agent2.html)
2. Booking Flow Simulator (booking.html)
3. Test Availability (calendar.html)

### **Audio Controls (3 Sets):**
1. Call Start Greeting (agent2.html)
2. Greeting Rule (agent2.html modal)
3. Trigger Answer (triggers.html modal)

---

## 🔍 FIND COMPONENT FAST

**Looking for where to edit greetings?**
→ `agent2.html` → Call Start Greeting card

**Looking for where to add trigger cards?**
→ `triggers.html` → "Add Trigger" button → Trigger Edit Modal

**Looking for where to configure booking?**
→ `booking.html` → Booking Parameters card

**Looking for where to check calendar?**
→ `calendar.html` → Connection Status card

**Looking for first names dictionary?**
→ `global-hub.html` → First Names Dictionary → "Search Names" button

**Looking for recovery messages?**
→ ⚠️ **NOT IN UI YET** - See VIOLATIONS-AND-FIXES.md

**Looking for booking prompts?**
→ ⚠️ **NOT IN UI YET** - See VIOLATIONS-AND-FIXES.md

---

## 📊 MODAL COMPLEXITY LEVELS

```
Simple         Medium              Complex
───────        ────────────        ──────────────────
First Names    Greeting Rule       Trigger Edit
Approval       Create Group        └─ GPT Settings
                                       (nested)

Fields: 1-2    Fields: 4-6         Fields: 13+
No nesting     No nesting          Has sub-modal
               May have            Mode switching
               confirmation        Dynamic fields
```

---

**END OF QUICK REFERENCE**

*Use this for rapid navigation and component location. For detailed documentation, see the main audit files.*
