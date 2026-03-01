# LLM Settings Consolidation Plan

## Problem Statement

The platform needs ONE centralized location where all LLM behavior settings live. This is critical for a multitenant platform where:
- **HVAC companies** need different prompt behavior than **Dentist offices**
- Each business type requires custom domain safety rules
- Compliance, creativity, and risk tolerance vary by industry
- All LLM responses must be configurable without code changes

## Current State Analysis

### ✅ What EXISTS (Backend is Ready)

**Data Layer:**
- `models/LLMSettings.js` - MongoDB schema storing settings per scope (global/company)
- `services/llmSettingsService.js` - CRUD operations for settings
- `config/llmScenarioPrompts.js` - **THE SOURCE OF TRUTH** for all LLM configuration

**API Layer:**
- `routes/admin/llmSettings.js` - REST API (GET/PUT/RESET)
  - `GET /api/admin/llm-settings` - Load current settings
  - `PUT /api/admin/llm-settings` - Save partial updates
  - `POST /api/admin/llm-settings/reset` - Reset to defaults

**Runtime Usage:**
- `routes/admin/llmScenarioAssistant.js` - Uses settings to generate scenarios
- Calls `getSettings('global')` → merges with defaults → applies to LLM calls

### ❌ What's MISSING (Frontend Needed)

**NO dedicated UI exists yet.** There's only:
- `public/admin-llm-learning-console-v2.html` - Different feature (learning/feedback)
- No single page to configure the LLM settings that control scenario generation

## What LLM Settings Control

### 1. **Profile Selection** (How Creative vs Safe)
- **Compliance-Safe** (temp 0.2, gpt-4o-mini) - Conservative, asks questions, safe defaults
- **Call Center Optimized** (temp 0.35, gpt-4o) - Balanced, natural phone language
- **Creative Exploration** (temp 0.65, gpt-4o) - High creativity, brainstorming mode

### 2. **Domain Safety Modes** (Industry-Specific Rules)
- **Medical Office Mode** - No diagnosis, no symptoms interpretation, logistics only
- **Financial Mode** - No investment advice, no fee promises, cautious language
- **Emergency Services Mode** - No triage, immediate escalation protocols

### 3. **Model Parameters** (Per Profile)
- Model Override (gpt-4o-mini, gpt-4o, gpt-4-turbo, o1-mini, o1-preview)
- Temperature (creativity level)
- Top-P (nucleus sampling)
- Max Tokens (response length)

### 4. **Compliance Controls**
- Strict Compliance Mode (global override to be conservative)
- Notes field for admin documentation

### 5. **Prompt Text** (FULLY EDITABLE)
- Base Architect Prompt (core instructions)
- Per-Profile Prompts (compliance/call-center/creative)
- Domain Safety Prompts (medical/financial/emergency)
- Strict Compliance Override Text

### 6. **Generation Behavior**
- Single vs Multi-variant generation
- Default variant count
- Max variant count (1-15)

## Proposed Solution: `llm.html` + `llm.js`

### Page Purpose
**Single source of truth UI** for configuring how the LLM generates scenarios across the entire platform.

### Location
`/public/agent-console/llm.html` - Accessed from Agent Console dashboard

### Key Features

#### Section 1: Profile Management
- Radio buttons to select active profile (compliance_safe, call_center_optimized, creative_exploration)
- Display current profile metadata (model, temp, description)
- Show effective parameters with overrides applied
- Model Override dropdown (optional: force specific model across all profiles)

#### Section 2: Domain Safety Toggles
- Checkboxes for:
  - Medical Office Mode
  - Financial Mode  
  - Emergency Services Mode
  - Strict Compliance Mode (global override)
- Each toggle shows/hides corresponding prompt text editor

#### Section 3: Advanced Parameters
- Per-profile overrides (temperature, topP, maxTokens)
- Show clamps if applicable (e.g., Compliance-Safe has strict limits)
- Visual indicators when values are clamped

#### Section 4: Prompt Text Editors
- Tabbed interface:
  - **Base Prompt** (always applied)
  - **Profile Prompts** (3 tabs: compliance/call-center/creative)
  - **Domain Prompts** (3 tabs: medical/financial/emergency)
  - **Strict Compliance** (override text)
- Live preview: Shows exactly what the LLM receives
- Reset to Default buttons per section

#### Section 5: Generation Settings
- Single vs Multi mode
- Variant count sliders
- Effective model display

#### Section 6: Live Preview
- Shows assembled system prompt exactly as LLM sees it
- Color-coded sections (base, profile, domain, compliance)
- Real-time updates as settings change

### Data Flow

```
User Changes Setting
  ↓
llm.js captures change
  ↓
PUT /api/admin/llm-settings { partialUpdate }
  ↓
llmSettingsService.saveSettings() merges with existing
  ↓
MongoDB LLMSettings.findOneAndUpdate()
  ↓
Response includes merged settings + promptParts
  ↓
llm.js updates UI + live preview
```

### Multitenant Architecture

**Current: Global Scope Only**
- Settings stored with `scope: 'global'`
- All companies share same LLM configuration

**Future: Company-Specific Overrides**
- Add scope selector: `global` vs `company:<companyId>`
- Company settings inherit from global, override specific fields
- UI shows inheritance chain (global → company overrides)
- Example: Global is "compliance_safe", but HVAC company X uses "call_center_optimized" with medical mode OFF

## Integration with Agent Console

### Navigation Card to Add

```html
<div class="card nav-card" data-navigate="llm">
  <div class="nav-card-icon">
    <svg><!-- Brain/AI icon --></svg>
  </div>
  <h3 class="nav-card-title">🧠 LLM Settings</h3>
  <p class="nav-card-description">
    Configure AI behavior, domain safety, and prompt engineering. 
    Control how the LLM generates scenarios for different business types.
  </p>
  <div class="nav-card-action">Open →</div>
</div>
```

### Where It Fits

**Logical Flow:**
1. **Call Console** - Review live calls
2. **Triggers** - Configure scenario matching
3. **LLM Settings** ← NEW - Configure how LLM generates scenarios
4. **Agent 2.0** - Configure discovery flow
5. **Booking Logic** - Configure booking flow

## Risk Mitigation

### Safety Guards (Already Built)
- **Clamps**: Compliance-Safe profile enforces strict limits (can't override to unsafe values)
- **Validation**: Backend validates all model names, temperatures, etc.
- **Defaults**: If DB returns nothing, falls back to safe defaults
- **Audit**: All changes tracked with timestamps in MongoDB

### UI Safety Features
- Show warnings when changing from Compliance-Safe to Creative
- Display clamp indicators ("Value clamped to safe range")
- Require confirmation for Medical/Financial/Emergency mode changes
- "Test Mode" toggle: Preview changes without saving

## Dependencies

### Existing Code (No Changes Needed)
- ✅ Backend API is complete
- ✅ Database model exists
- ✅ Default settings defined
- ✅ Runtime integration works

### New Files to Create
- `public/agent-console/llm.html` - Main UI
- `public/agent-console/llm.js` - Frontend logic
- Update `public/agent-console/index.html` - Add navigation card

### Shared Resources (Already Exist)
- `public/agent-console/styles.css` - Styling
- `public/agent-console/lib/auth.js` - Authentication

## Success Criteria

1. ✅ Admin can view current LLM settings in one place
2. ✅ Admin can change active profile (compliance/call-center/creative)
3. ✅ Admin can toggle domain safety modes (medical/financial/emergency)
4. ✅ Admin can override model parameters per profile
5. ✅ Admin can edit prompt text and reset to defaults
6. ✅ Admin can see live preview of assembled system prompt
7. ✅ Changes persist to MongoDB and apply to next LLM calls
8. ✅ UI is accessible from Agent Console main page

## Open Questions

1. **Scope Selection**: Should v1 support company-specific overrides, or just global?
2. **Permissions**: Should this be admin-only, or allow company managers to edit their own?
3. **Versioning**: Should we track prompt text history (who changed what when)?
4. **Testing**: Should we add "Test Prompt" button that calls OpenAI with current settings?
5. **Import/Export**: Should admins be able to export/import LLM configs as JSON?

---

## Next Steps

**BEFORE BUILDING:**
1. User reviews this plan
2. User answers open questions
3. User approves scope and design

**AFTER APPROVAL:**
1. Create `llm.html` with complete UI
2. Create `llm.js` with API integration
3. Add navigation card to agent console index
4. Test with real settings changes
5. Verify LLM scenario generation uses updated settings
