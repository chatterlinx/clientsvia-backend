# Company Profile - Clean Specification

## What STAYS (Core Features)

### Tabs (5 Total)

1. **Overview Tab**
   - Company name, email, phone
   - Owner information
   - Creation date
   - Status display

2. **Configuration Tab**
   - Account Status Control (Active/Call Forward/Suspended)
   - Twilio Phone Numbers
   - Trade Categories

3. **Notes Tab**
   - Company notes list
   - Add/delete notes

4. **AI Voice Settings Tab**
   - ElevenLabs voice configuration
   - Voice selection
   - Voice parameters
   - Preview/test functionality

5. **AI Agent Settings Tab**
   - Variables & Placeholders
   - Scenarios & Responses
   - Filler Words
   - Template Management
   - Readiness Score

### Core Functionality
- Tab switching
- Data loading/saving
- Authentication
- Form validation
- Status badges
- Save buttons

---

## What GOES (Legacy/Dead Code)

### Delete All:
- Comments with emojis (🗑️, 🔧, ⚠️, etc.)
- "DELETED:" comments
- "REMOVED:" comments
- "FIXME:" comments
- "TODO:" comments
- "HACK:" comments
- "TEMP:" comments
- "LEGACY:" comments
- Dead CSS rules
- Unused div wrappers
- Old inline styles
- Deprecated classes
- Legacy tab references (Calendar, CRM, etc.)
- All hotfix comments
- All aggressive fix comments
- All bulletproof fix comments

### Specific Removals:
- Knowledge Management CSS references
- AI Agent Logic tab references (replaced by AI Agent Settings)
- Calendar Settings tab references
- CRM & Contacts tab references (future V2)
- Legacy AI Settings references
- Quick Variables section references
- All old commented-out HTML
- All debugging styles

---

## Clean Architecture

### HTML Structure
```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Company Profile</title>
  <link rel="stylesheet" href="/css/output.css">
  <link rel="stylesheet" href="/css/company-profile.css">
</head>
<body>
  <!-- Navigation -->
  <!-- Company Header -->
  <!-- Tab Navigation -->
  <!-- Tab Content Sections -->
  
  <!-- Scripts -->
  <script src="/js/company-profile/CompanyProfileManager.js"></script>
</body>
</html>
```

### CSS Organization
- Global Styles
- Navigation & Tabs
- Forms & Inputs
- Buttons
- Tab-Specific Styles (5 sections)
- Utility Classes

### JavaScript Modules
- CompanyProfileManager.js (orchestrator)
- OverviewTab.js
- ConfigurationTab.js
- NotesTab.js
- AIVoiceSettingsTab.js
- AIAgentSettingsTab.js

---

## Naming Conventions

### CSS Classes
- Descriptive, kebab-case
- Prefixed by section: `cp-` for company-profile
- Example: `cp-tab-nav`, `cp-form-input`, `cp-status-badge`

### JavaScript
- PascalCase for classes
- camelCase for methods/variables
- Clear, descriptive names
- Example: `CompanyProfileManager`, `switchTab()`, `saveAccountStatus()`

### HTML IDs
- Descriptive, kebab-case
- Example: `company-name-header`, `account-status-badge`, `save-config-btn`

---

## Code Quality Standards

### All Code Must Be:
- Clean (no dead code)
- Documented (clear comments)
- Organized (logical sections)
- Consistent (same patterns throughout)
- Professional (industry best practices)

### Comments Should:
- Explain WHY, not WHAT
- Be clear and concise
- Use proper grammar
- Have consistent formatting
- NO emojis
- NO debugging notes
- NO temporary markers

### Example Good Comment:
```javascript
/**
 * Switches the active tab and loads its content
 * @param {string} tabName - The tab identifier (overview, config, notes, etc.)
 */
```

### Example Bad Comment (DELETE THESE):
```javascript
// 🔧 HOTFIX: Prevent floating
// TODO: Fix this later
// TEMP: This is a hack
```

---

## Success Criteria

✅ Zero legacy markers
✅ Zero dead code
✅ Zero old comments
✅ Clean section boundaries
✅ Modular architecture
✅ Professional quality
✅ Easy to maintain
✅ Fast to debug


