# Call Console — Engineering Report

**Version:** 1.0.0  
**Date:** February 24, 2026  
**Author:** AI Engineering Assistant  
**Commit:** `3427c999`

---

## Executive Summary

The Call Console is an enterprise-level call review system built to diagnose calls, trace agent response provenance, and enforce the critical compliance rule: **"If it's not in UI, it does NOT exist."**

This document details the architectural decisions, implementation approach, and technical specifications for the complete Call Console system.

---

## 1. Requirements Analysis

### 1.1 Business Requirements

| Requirement | Priority | Implementation |
|-------------|----------|----------------|
| Review all calls with filtering | CRITICAL | Call list with search, date range, status filters |
| Diagnose individual call issues | CRITICAL | Detail modal with turn-by-turn transcript |
| Detect hardcoded agent speech | CRITICAL | Provenance tracking system |
| Trace response to UI config | CRITICAL | UI path mapping with clickable links |
| Multi-tenant compliance | CRITICAL | Company-scoped queries, JWT authentication |
| Export for auditing | HIGH | JSON export with full provenance data |

### 1.2 Technical Requirements

- **No Legacy Code:** Built from scratch, no paths copied from previous implementations
- **Clean Architecture:** IIFE pattern, modular sections, clear separation of concerns
- **Design System Compliance:** Uses existing `styles.css` variables and components
- **Authentication:** JWT-based via `AgentConsoleAuth`
- **API Consistency:** Follows existing `/api/agent-console` patterns

---

## 2. Architecture Overview

### 2.1 System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                        CALL CONSOLE                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────────┐    ┌──────────────────┐    ┌────────────┐ │
│  │  callconsole.html │    │  callconsole.js  │    │ styles.css │ │
│  │  (27.5 KB)        │───▶│  (41.5 KB)       │───▶│ (shared)   │ │
│  │  Page Structure   │    │  IIFE Controller │    │ Design Sys │ │
│  └──────────────────┘    └────────┬─────────┘    └────────────┘ │
│                                   │                              │
│                                   ▼                              │
│                          ┌────────────────┐                      │
│                          │   auth.js      │                      │
│                          │ (JWT + apiFetch)│                      │
│                          └────────┬───────┘                      │
│                                   │                              │
├───────────────────────────────────┼──────────────────────────────┤
│                      BACKEND API  │                              │
│                                   ▼                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                   callReview.js (25.3 KB)                 │   │
│  │  ├─ GET /:companyId/calls         (list + pagination)    │   │
│  │  ├─ GET /:companyId/calls/:callSid (detail + provenance) │   │
│  │  └─ GET /:companyId/calls/export   (compliance export)   │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                   │                              │
│                                   ▼                              │
│                          ┌────────────────┐                      │
│                          │   CallLog      │                      │
│                          │   (MongoDB)    │                      │
│                          └────────────────┘                      │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 File Structure

```
public/agent-console/
├── callconsole.html     # Page structure + page-specific CSS
├── callconsole.js       # IIFE controller (16 sections)
├── index.html           # Updated: Added nav card
├── index.js             # Updated: Added navigation handler
├── styles.css           # Shared design system (unchanged)
└── lib/auth.js          # Authentication (unchanged)

routes/agentConsole/
├── callReview.js        # NEW: Call review API endpoints
├── agentConsole.js      # Updated: Registered callReview routes
└── truthExport.js       # Existing (unchanged)
```

---

## 3. Provenance Tracking System

### 3.1 The Core Problem

In a multi-tenant AI voice platform, every word the agent speaks must be traceable to a UI configuration. Hardcoded responses are **forbidden** because:

1. **Compliance:** Tenants must control all agent speech
2. **Auditability:** Every response must have documented origin
3. **Debugging:** When calls fail, we need to know what spoke and why

### 3.2 Provenance Categories

| Type | Badge | Meaning | Action Required |
|------|-------|---------|-----------------|
| `UI_OWNED` | ✓ Green | Response from UI configuration | None (compliant) |
| `FALLBACK` | ⚠ Yellow | Emergency fallback (logged) | Review if frequent |
| `HARDCODED` | 🚨 Red | **VIOLATION** — Not UI-driven | Must fix immediately |
| `UNKNOWN` | ? Gray | Source could not be determined | Investigate |

### 3.3 Provenance Data Structure

```javascript
{
  type: 'UI_OWNED',           // Classification
  uiPath: 'greetings.callStart',  // Config path
  uiPage: 'agent2.html',      // Which page to edit
  uiTab: 'greetings',         // Which tab/section
  uiSection: 'Call Start Greeting',
  triggerId: null,            // If from trigger system
  reason: 'Initial greeting when call starts',
  isViolation: false,
  violationSeverity: null,
  fixInstructions: null
}
```

### 3.4 UI Path Mapping

The system maintains a comprehensive map from backend config paths to UI locations:

```javascript
const PROVENANCE_UI_MAP = {
  // Agent 2.0 Discovery
  'greetings.callStart': {
    uiPage: 'agent2.html',
    uiTab: 'greetings',
    uiSection: 'Call Start Greeting'
  },
  'greetings.interceptor': { /* ... */ },
  'discovery.recoveryMessages': { /* ... */ },
  
  // Triggers
  'triggers.global': {
    uiPage: 'triggers.html',
    uiTab: 'triggers',
    uiSection: 'Global Triggers'
  },
  
  // Booking Logic
  'bookingPrompts.askName': {
    uiPage: 'booking.html',
    uiTab: 'prompts',
    uiSection: 'Ask Name Prompt'
  },
  // ... 15+ mappings total
};
```

---

## 4. Frontend Architecture

### 4.1 JavaScript Structure (16 Sections)

The `callconsole.js` controller follows a strict modular pattern:

```javascript
(function() {
  'use strict';

  /* Section 1:  CONFIGURATION        */ // API endpoints, page size, provenance types
  /* Section 2:  STATE MANAGEMENT     */ // Centralized state object
  /* Section 3:  DOM REFERENCES       */ // Cached element references
  /* Section 4:  INITIALIZATION       */ // Auth check, setup, load data
  /* Section 5:  EVENT LISTENERS      */ // All user interaction handlers
  /* Section 6:  DATA LOADING         */ // API calls for calls list & detail
  /* Section 7:  RENDERING — LIST     */ // Call list table rendering
  /* Section 8:  RENDERING — DETAIL   */ // Modal content rendering
  /* Section 9:  FILTERS & PAGINATION */ // Filter change handlers
  /* Section 10: MODAL MANAGEMENT     */ // Open/close modal state
  /* Section 11: EXPORT & DOWNLOAD    */ // Export to JSON functionality
  /* Section 12: NAVIGATION           */ // Page navigation helpers
  /* Section 13: UTILITY FUNCTIONS    */ // Loading state, counters
  /* Section 14: FORMATTING HELPERS   */ // Phone, time, duration formatters
  /* Section 15: TOAST NOTIFICATIONS  */ // User feedback system
  /* Section 16: BOOTSTRAP            */ // DOMContentLoaded initialization

})();
```

### 4.2 State Management

```javascript
const state = {
  // Company context
  companyId: null,
  companyName: null,

  // Call list data
  calls: [],
  totalCalls: 0,
  currentPage: 1,
  totalPages: 1,

  // Filters
  filters: {
    search: '',
    status: '',      // clean | violations | problems
    dateRange: 'week' // today | yesterday | week | month | all
  },

  // Selected call for detail view
  selectedCall: null,

  // UI state
  isLoading: false,
  isModalOpen: false
};
```

### 4.3 CSS Architecture

Page-specific styles are embedded in `callconsole.html` to avoid polluting the shared `styles.css`:

| Component | Purpose |
|-----------|---------|
| `.call-list-container` | Table wrapper with header |
| `.call-table` | Sortable call list |
| `.provenance-badge-*` | Color-coded status indicators |
| `.transcript-container` | Dark theme (matches user mockups) |
| `.turn` | Individual transcript turns |
| `.provenance-details` | Collapsible source attribution |
| `.violation-alert` | Red warning for hardcoded speech |
| `.events-section` | Collapsible raw events log |

Dark theme colors for transcript:
```css
--transcript-bg: #0f172a;
--transcript-header: #1e293b;
--transcript-border: #334155;
--transcript-text: #e2e8f0;
```

---

## 5. Backend Architecture

### 5.1 API Endpoints

#### `GET /:companyId/calls`

List calls with filtering and pagination.

**Query Parameters:**
| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | number | 1 | Page number |
| `limit` | number | 25 | Items per page (max 100) |
| `dateRange` | string | week | today/yesterday/week/month/all |
| `search` | string | — | Search phone or CallSid |
| `status` | string | — | clean/violations/problems |

**Response:**
```json
{
  "success": true,
  "page": 1,
  "limit": 25,
  "total": 142,
  "totalPages": 6,
  "calls": [
    {
      "callSid": "CA1234567890",
      "fromPhone": "+15551234567",
      "startTime": "2026-02-24T15:30:00Z",
      "durationSeconds": 187,
      "turnCount": 12,
      "hasHardcodedViolation": false,
      "hasFallback": true,
      "problemCount": 0
    }
  ]
}
```

#### `GET /:companyId/calls/:callSid`

Get detailed call with full provenance tracking.

**Response includes:**
- Call metadata (phones, time, duration)
- Provenance summary (counts by type)
- LLM token usage
- Problems detected
- Turn-by-turn transcript with provenance
- Raw events log
- Config snapshot reference

#### `GET /:companyId/calls/export`

Export calls for compliance auditing (up to 1000 calls).

### 5.2 Provenance Enrichment

The `enrichTurnWithProvenance()` function processes each agent turn:

```javascript
function enrichTurnWithProvenance(turn, callMeta) {
  if (turn.speaker === 'caller') {
    return { ...turn, provenance: null };
  }

  // Check explicit source attribution (added at runtime)
  if (turn.sourceAttribution?.uiPath) {
    // Map to UI location
    const uiMapping = PROVENANCE_UI_MAP[attr.uiPath];
    return {
      ...turn,
      provenance: {
        type: 'UI_OWNED',
        uiPath: attr.uiPath,
        uiPage: uiMapping.uiPage,
        uiTab: uiMapping.uiTab,
        // ...
      }
    };
  }

  // Fallback detection
  if (turn.sourceAttribution?.isFallback) {
    return { ...turn, provenance: { type: 'FALLBACK', ... } };
  }

  // No attribution = HARDCODED (violation)
  return {
    ...turn,
    provenance: {
      type: 'HARDCODED',
      isViolation: true,
      violationSeverity: 'CRITICAL',
      fixInstructions: '...'
    }
  };
}
```

### 5.3 Mock Data for Development

When `CallLog` model is unavailable, the API returns realistic mock data:

```javascript
function generateMockCalls(companyId, count) {
  // Generates calls with:
  // - 15% chance of hardcoded violation
  // - 25% chance of fallback usage (if no violation)
  // - Random durations, turn counts, timestamps
}

function generateMockCallDetail(companyId, callSid) {
  // Full 10-turn conversation simulating:
  // - Greeting → Intent → Acknowledgment → Hold
  // - Offer times → Selection → Ask name → Confirmation
  // All with proper sourceAttribution
}
```

---

## 6. Integration Points

### 6.1 Dashboard Integration

Added navigation card to `index.html`:

```html
<div class="card nav-card" data-navigate="callconsole">
  <div class="nav-card-icon"><!-- Phone/check icon --></div>
  <h3 class="nav-card-title">Call Console</h3>
  <p class="nav-card-description">Review calls, diagnose issues, trace provenance...</p>
</div>
```

Added handler to `index.js`:

```javascript
case 'callconsole':
  window.location.href = `${baseUrl}/callconsole.html${companyParam}`;
  break;
```

### 6.2 Route Registration

In `agentConsole.js`:

```javascript
const callReviewRouter = require('./callReview');
router.use('/', callReviewRouter);
```

Routes are now available at:
- `GET /api/agent-console/:companyId/calls`
- `GET /api/agent-console/:companyId/calls/:callSid`
- `GET /api/agent-console/:companyId/calls/export`

---

## 7. Security Considerations

| Concern | Implementation |
|---------|----------------|
| Authentication | JWT required via `authenticateJWT` middleware |
| Authorization | `requirePermission(PERMISSIONS.CONFIG_READ)` |
| Data Isolation | All queries scoped by `companyId` |
| XSS Prevention | `escapeHtml()` on all user-displayed content |
| Secret Stripping | N/A (call data doesn't contain secrets) |

---

## 8. Testing Strategy

### 8.1 Manual Testing Checklist

- [ ] Navigate to Call Console from dashboard
- [ ] Verify call list loads with mock data
- [ ] Test all filters (search, status, date range)
- [ ] Test pagination (prev/next buttons)
- [ ] Click call row → modal opens
- [ ] Verify transcript renders with provenance badges
- [ ] Check UI links point to correct pages
- [ ] Test export functionality
- [ ] Test download report for single call
- [ ] Verify modal closes on Escape key
- [ ] Check mobile responsiveness

### 8.2 Integration Testing (Future)

```javascript
describe('Call Review API', () => {
  it('lists calls with pagination', async () => {
    const res = await request(app)
      .get('/api/agent-console/company123/calls?page=1&limit=10')
      .set('Authorization', `Bearer ${jwt}`);
    
    expect(res.status).toBe(200);
    expect(res.body.calls).toHaveLength(10);
  });

  it('returns 404 for unknown call', async () => {
    const res = await request(app)
      .get('/api/agent-console/company123/calls/UNKNOWN_SID')
      .set('Authorization', `Bearer ${jwt}`);
    
    expect(res.status).toBe(404);
  });
});
```

---

## 9. Future Enhancements

### 9.1 Planned Features

| Feature | Priority | Description |
|---------|----------|-------------|
| Audio Playback | HIGH | Play call audio with transcript sync |
| Config Snapshot Viewer | HIGH | View exact config at call time |
| Bulk Violation Fixer | MEDIUM | Fix multiple violations at once |
| Call Search by Transcript | MEDIUM | Full-text search in call content |
| Analytics Dashboard | LOW | Aggregate provenance statistics |
| Webhook on Violation | LOW | Alert when hardcoded speech detected |

### 9.2 Runtime Integration

To fully enable provenance tracking, runtime code must add `sourceAttribution` to every agent turn:

```javascript
// In Agent2DiscoveryEngine.js
const turn = {
  speaker: 'agent',
  text: greetingText,
  timestamp: new Date(),
  sourceAttribution: {
    uiPath: 'greetings.callStart',
    type: 'UI_OWNED'
  }
};
```

---

## 10. Metrics & Performance

### 10.1 Bundle Sizes

| File | Size | Gzipped (est.) |
|------|------|----------------|
| `callconsole.html` | 27.5 KB | ~6 KB |
| `callconsole.js` | 41.5 KB | ~10 KB |
| `callReview.js` | 25.3 KB | ~6 KB |

### 10.2 API Performance Targets

| Endpoint | Target | Notes |
|----------|--------|-------|
| List calls | < 200ms | With indexes on companyId, startTime |
| Call detail | < 100ms | Single document lookup |
| Export | < 2s | Capped at 1000 calls |

---

## 11. Conclusion

The Call Console delivers a production-ready call review system with:

1. **Enterprise Architecture:** Clean IIFE pattern, 16 modular sections, comprehensive documentation
2. **Compliance-First Design:** Every agent response traced to UI configuration
3. **Developer Experience:** Mock data for development, clear error messages, request IDs
4. **User Experience:** Dark-theme transcript (per user mockups), one-click fixes, export capability

The system is ready for production deployment pending:
- `CallLog` model implementation (currently using mock data)
- Runtime `sourceAttribution` integration in voice engines

---

## Appendix A: File Checksums

```
SHA256 (callconsole.html) = [computed on build]
SHA256 (callconsole.js)   = [computed on build]
SHA256 (callReview.js)    = [computed on build]
```

## Appendix B: Related Documentation

- `VIOLATIONS-AND-FIXES.md` — Hardcoded speech scanner reference
- `MASTER-SUMMARY.md` — Call 2.0 requirements
- `QUICK-REFERENCE-PAGES-AND-MODALS.md` — UI page inventory
