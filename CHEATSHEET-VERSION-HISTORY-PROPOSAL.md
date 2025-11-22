# CheatSheet Version History System - Technical Proposal

**Version**: 2.0  
**Date**: November 22, 2025  
**Status**: Proposal for Engineering Review  
**Current Platform State**: Stable at commit `cd0ccfe2`

---

## 📋 Executive Summary

This proposal outlines a comprehensive versioning system for AI Agent CheatSheet configurations, enabling:
- **Draft/Live workflow** with safe editing
- **Version history** with restore capabilities
- **Template library** for rapid onboarding
- **Global sharing** with quality controls

**Risk Level**: Medium - Significant new functionality but isolated from existing systems  
**Timeline Estimate**: 2-3 days of focused development + testing  
**Rollback Strategy**: Feature flag + complete isolation from existing CheatSheet storage

---

## 🎯 Business Objectives

### Primary Goals
1. **Prevent accidental production changes** - Admins edit in draft, push when ready
2. **Enable version rollback** - Restore any previous configuration
3. **Accelerate onboarding** - Start from pre-built templates
4. **Knowledge sharing** - Share successful configs across companies

### Success Metrics
- Zero production incidents from accidental CheatSheet changes
- 50%+ reduction in new company setup time (via templates)
- 90%+ admin satisfaction with version control workflow

---

## 🏗️ Architecture Overview

### Storage Strategy

**NEW: Separate Collection Approach**
```javascript
// OLD (Current): Embedded in Company document
Company {
  aiAgentSettings: {
    cheatSheet: { /* all config here */ }  // ❌ Bloats document, no history
  }
}

// NEW: Pointer to separate collection
Company {
  aiAgentSettings: {
    cheatSheetMeta: {
      liveVersionId: ObjectId("..."),     // Points to live version
      draftVersionId: ObjectId("..."),    // Points to draft (if exists)
      lastUpdated: Date
    }
  }
}

CheatSheetVersion {
  _id: ObjectId,
  companyId: ObjectId,
  versionId: "v-1732282834-a3f8d9",
  status: "live" | "draft" | "archived",
  name: "Production Config v2.1",
  config: { /* actual cheatsheet config */ },
  checksum: "sha256...",
  createdAt: Date,
  createdBy: "admin@example.com",
  // ... metadata
}
```

**Benefits**:
- ✅ No Company document bloat
- ✅ Unlimited version history
- ✅ Fast queries (indexed by companyId + status)
- ✅ Clean separation of concerns

**Risks**:
- ⚠️ Requires migration for existing data
- ⚠️ Two database queries instead of one (mitigated by caching)

---

## 📦 Component Breakdown

### Phase 1: Core Versioning (MVP)
**Estimated Time**: 1 day  
**Risk Level**: Low

#### 1.1 Database Schema
```javascript
// models/cheatsheet/CheatSheetVersion.js
const CheatSheetVersionSchema = new mongoose.Schema({
  companyId: { type: ObjectId, ref: 'Company', required: true, index: true },
  versionId: { type: String, required: true, unique: true, index: true },
  status: { type: String, enum: ['live', 'draft', 'archived'], required: true, index: true },
  name: { type: String, required: true, maxlength: 200 },
  notes: { type: String, default: '', maxlength: 2000 },
  config: { type: CheatSheetConfigSchema, required: true },
  checksum: { type: String, required: true },
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: String, required: true },
  updatedAt: { type: Date, default: Date.now },
  updatedBy: { type: String, required: true },
  activatedAt: { type: Date, default: null },
  activatedBy: { type: String, default: null }
});

// Compound indexes for performance
CheatSheetVersionSchema.index({ companyId: 1, status: 1 });
CheatSheetVersionSchema.index({ companyId: 1, createdAt: -1 });
```

**Invariants Enforced by Service Layer**:
- ✅ At most ONE live version per company
- ✅ At most ONE draft version per company
- ✅ Live versions are READ-ONLY (edits create new draft)
- ✅ Version IDs are unique and immutable

#### 1.2 Backend API Routes
```
Base Path: /api/cheatsheet/:companyId/

GET    /versions              → List all versions (paginated)
GET    /versions/live         → Get current live version
GET    /versions/draft        → Get current draft version
GET    /versions/:versionId   → Get specific version

POST   /versions/draft        → Create new draft
PATCH  /versions/:versionId   → Update draft (live versions rejected)
DELETE /versions/:versionId   → Delete draft

POST   /versions/:versionId/push-live  → Promote draft to live (archives old live)
POST   /versions/:versionId/restore    → Restore archived version as new draft
```

**Security**:
- All routes require JWT authentication
- Company access validation middleware
- Rate limiting (60 req/min per company)

#### 1.3 Service Layer
```javascript
// services/cheatsheet/CheatSheetVersionService.js

class CheatSheetVersionService {
  static async createDraft(companyId, name, createdBy, config = null)
  static async saveDraft(companyId, versionId, config, updatedBy)
  static async pushLive(companyId, versionId, pushedBy)
  static async discardDraft(companyId, versionId, discardedBy)
  static async restoreVersion(companyId, sourceVersionId, newName, restoredBy)
  static async getAllVersions(companyId, filters = {})
  static async getLiveVersion(companyId)
  static async getDraftVersion(companyId)
}
```

**Error Handling**:
- Custom error classes (`CheatSheetVersionNotFoundError`, `CheatSheetLiveVersionExistsError`, etc.)
- Proper HTTP status codes (400, 404, 409, 500)
- Detailed error messages for debugging

#### 1.4 Frontend Integration
```javascript
// public/js/ai-agent-settings/CheatSheetVersioningAdapter.js

class CheatSheetVersioningAdapter {
  async initialize()                    // Fetch live + draft status
  async createDraft(name)               // Start new draft
  async saveDraft(config)               // Save changes to draft
  async pushLive(versionId)             // Promote to live
  async getVersionHistory()             // Fetch all versions
  async restoreVersion(versionId, name) // Restore old version
}
```

**UI Changes**:
- New "Version History" tab in CheatSheet Manager
- Version cards showing: name, status, date, author
- "Restore" button on archived versions
- "Push Live" button on drafts
- Confirmation modals for destructive actions

---

### Phase 2: Version History UI
**Estimated Time**: 1 day  
**Risk Level**: Low

#### 2.1 Version History Tab
```
┌─────────────────────────────────────────────────┐
│  📚 Version History                 [3 Versions]│
├─────────────────────────────────────────────────┤
│                                                  │
│  ┌────────────────────────────────────────┐    │
│  │ 🟢 LIVE   Production Config v2.1       │    │
│  │ By: admin@example.com                  │    │
│  │ Activated: Nov 21, 2025 4:30 PM       │    │
│  │ [View Details] [Clone to Draft]       │    │
│  └────────────────────────────────────────┘    │
│                                                  │
│  ┌────────────────────────────────────────┐    │
│  │ 📝 DRAFT  Testing new edge cases      │    │
│  │ By: admin@example.com                  │    │
│  │ Created: Nov 22, 2025 10:15 AM        │    │
│  │ [Edit] [Push Live] [Discard]          │    │
│  └────────────────────────────────────────┘    │
│                                                  │
│  ┌────────────────────────────────────────┐    │
│  │ 📦 ARCHIVED  Initial Setup             │    │
│  │ By: admin@example.com                  │    │
│  │ Archived: Nov 20, 2025 2:45 PM        │    │
│  │ [View Details] [Restore]               │    │
│  └────────────────────────────────────────┘    │
│                                                  │
└─────────────────────────────────────────────────┘
```

#### 2.2 User Flows

**Flow 1: Edit CheatSheet (Safe)**
1. Admin clicks "Edit CheatSheet"
2. If no draft exists → Create draft from live
3. If draft exists → Resume editing draft
4. Make changes in draft
5. Click "Push Live" when ready
6. Confirm → Old live becomes archived, draft becomes live

**Flow 2: Restore Old Version**
1. Admin opens Version History tab
2. Browse archived versions
3. Click "Restore" on desired version
4. System creates NEW draft from that version
5. Admin can edit and push live

**Flow 3: Discard Changes**
1. Admin editing draft
2. Click "Discard Draft"
3. Confirm → Draft deleted, back to live-only state

---

### Phase 3: Template System (Optional - Future)
**Estimated Time**: 1 day  
**Risk Level**: Medium

#### 3.1 Global Templates Collection
```javascript
GlobalCheatSheetTemplate {
  templateId: String,
  name: String,
  description: String,
  tradeNameId: ObjectId,  // HVAC, Dental, etc.
  subcategory: String,
  config: CheatSheetConfigSchema,
  downloads: Number,
  rating: Number,
  createdBy: String,
  isOfficial: Boolean,
  status: "active" | "deprecated"
}
```

#### 3.2 Template Features
- Browse templates by trade name
- Preview template before importing
- Import creates new draft with variable replacement
- Rate templates after use

---

## 🔒 Security & Multi-Tenancy

### Data Isolation
```javascript
// ALL database queries MUST filter by companyId
CheatSheetVersion.find({ companyId: req.companyId, ... })

// Middleware enforces company access
router.use('/:companyId/*', validateCompanyAccess);
```

### Permissions
- **Company Admin**: Full CRUD on own company's versions
- **Platform Admin**: Read-only on all companies (for support)
- **AI Agent Runtime**: Read-only access to live versions

### Audit Trail
```javascript
CheatSheetAuditLog {
  companyId: ObjectId,
  versionId: String,
  action: "created" | "updated" | "published" | "archived" | "restored",
  performedBy: String,
  timestamp: Date,
  changes: Object,  // Diff of changes
  metadata: Object  // IP, user agent, etc.
}
```

---

## ⚡ Performance Considerations

### Caching Strategy
```javascript
// 3-Layer Cache for Live Configs
1. In-Memory LRU (Node.js) - 100ms TTL, 1000 entries
2. Redis - 5min TTL
3. MongoDB - Source of truth

// Cache invalidation on push-live
```

### Database Indexes
```javascript
// Critical indexes for performance
{ companyId: 1, status: 1 }          // Find live/draft
{ companyId: 1, createdAt: -1 }      // Version history
{ versionId: 1 }                     // Unique lookup
{ checksum: 1 }                      // Duplicate detection
```

### Query Optimization
- Pagination for version history (default 50, max 200)
- Lean queries for list views (no config data)
- Full config only fetched on demand

---

## 🚀 Migration Plan

### Step 1: Deploy Models & Routes (No Data Migration)
- Deploy new code with feature flag OFF
- New companies start using versioning
- Old companies continue using embedded cheatSheet

### Step 2: Gradual Migration Script
```javascript
// One-time migration per company
async function migrateCompanyToVersioning(companyId) {
  const company = await Company.findById(companyId);
  const existingConfig = company.aiAgentSettings.cheatSheet;
  
  // Create initial live version
  const liveVersion = await CheatSheetVersion.create({
    companyId,
    versionId: generateVersionId(),
    status: 'live',
    name: 'Migrated from V1',
    config: existingConfig,
    checksum: calculateChecksum(existingConfig),
    createdBy: 'system-migration',
    createdAt: company.aiAgentSettings.cheatSheet.updatedAt || new Date()
  });
  
  // Update company to point to new version
  company.aiAgentSettings.cheatSheetMeta = {
    liveVersionId: liveVersion._id,
    draftVersionId: null,
    lastUpdated: new Date()
  };
  
  // Keep old embedded data for rollback safety (can remove after 30 days)
  await company.save();
}
```

### Step 3: Enable Feature Flag
- Monitor for errors
- Enable for 10% of companies
- Gradually increase to 100%

### Rollback Plan
```javascript
// If issues found, disable feature flag
// Old embedded cheatSheet still exists
// Zero data loss, instant rollback
```

---

## 🧪 Testing Strategy

### Unit Tests
```javascript
// services/cheatsheet/CheatSheetVersionService.test.js
describe('CheatSheetVersionService', () => {
  test('creates draft successfully')
  test('prevents multiple live versions per company')
  test('prevents multiple drafts per company')
  test('archives old live when pushing new live')
  test('prevents editing live versions')
  test('restores archived version as new draft')
  test('calculates checksum correctly')
  test('validates config schema')
});
```

### Integration Tests
```javascript
// routes/cheatsheet/versionRoutes.test.js
describe('Version Routes', () => {
  test('GET /versions returns paginated results')
  test('POST /versions/draft creates draft')
  test('POST /versions/:id/push-live promotes draft')
  test('requires authentication')
  test('enforces company access')
  test('returns proper error codes')
});
```

### E2E Tests
```javascript
describe('Version History Workflow', () => {
  test('Admin can create draft, edit, and push live')
  test('Admin can restore old version')
  test('Admin can discard draft')
  test('Multi-admin conflict detection works')
});
```

### Load Testing
- 100 concurrent admins editing drafts
- 1000 req/s to live config endpoint (AI runtime)
- Database query performance under load

---

## 📊 Monitoring & Observability

### Key Metrics
```javascript
// Prometheus metrics
cheatsheet_version_operations_total{operation, status}
cheatsheet_version_query_duration_seconds
cheatsheet_live_config_cache_hits_total
cheatsheet_live_config_cache_misses_total
```

### Alerts
- High error rate (>5% in 5 minutes)
- Slow queries (>500ms p99)
- Cache miss rate >50%
- Multiple live versions exist (data integrity violation)

### Logging
```javascript
logger.cheatsheet('push_live', companyId, versionId, {
  oldLiveVersionId: previousLive._id,
  pushedBy: req.user.email,
  configChanges: diff(oldConfig, newConfig)
});
```

---

## ⚠️ Risks & Mitigations

### Risk 1: Data Inconsistency
**Risk**: Live version deleted but company still points to it  
**Mitigation**: 
- Soft deletes (mark as deleted, never actually remove)
- Database transactions for critical operations
- Daily integrity check cron job

### Risk 2: Performance Degradation
**Risk**: Two queries instead of one slows down runtime  
**Mitigation**:
- Aggressive caching (Redis + in-memory)
- Background preload of popular configs
- Monitoring with alerts

### Risk 3: Migration Failures
**Risk**: Data loss during migration  
**Mitigation**:
- Keep old embedded data for 30 days
- Dry-run migration script on staging
- Migrate in batches with validation
- Feature flag for instant rollback

### Risk 4: Frontend Breaking Changes
**Risk**: Frontend still expects old data structure  
**Mitigation**:
- Adapter pattern isolates frontend from API changes
- Graceful degradation if versioning unavailable
- Timeout on versioning calls (5s) with fallback

### Risk 5: Multi-Admin Conflicts
**Risk**: Two admins editing draft simultaneously  
**Mitigation**:
- Optimistic concurrency control (checksum validation)
- "Last write wins" with conflict notification
- Future: Real-time collaboration with WebSockets

---

## 📅 Phased Rollout Plan

### Week 1: Foundation (MVP)
- ✅ Database models
- ✅ Backend API routes
- ✅ Service layer with business logic
- ✅ Unit tests
- ✅ Deploy with feature flag OFF

### Week 2: Integration
- ✅ Frontend Version History tab
- ✅ Integration tests
- ✅ Migration script (tested on staging)
- ✅ Enable for 1 test company

### Week 3: Beta Testing
- ✅ Enable for 10% of companies
- ✅ Monitor metrics and errors
- ✅ Collect admin feedback
- ✅ Fix bugs and UX issues

### Week 4: General Availability
- ✅ Enable for 100% of companies
- ✅ Deprecate old embedded cheatSheet (keep for rollback)
- ✅ Performance optimization based on real usage
- ✅ Documentation and training

---

## 💰 Cost Analysis

### Development Cost
- Backend: 1 day (8 hours)
- Frontend: 1 day (8 hours)
- Testing: 0.5 days (4 hours)
- Migration: 0.5 days (4 hours)
- **Total**: 3 days

### Infrastructure Cost
- MongoDB: +5% storage (version history)
- Redis: +10% memory (cache live configs)
- Bandwidth: Negligible
- **Total**: ~$10-20/month additional

### Maintenance Cost
- Low - well-tested, isolated system
- Monitoring via existing Prometheus/Grafana

---

## 🎯 Success Criteria

### Technical
- ✅ Zero production incidents from accidental changes
- ✅ <100ms p99 latency for live config queries
- ✅ 100% data integrity (no orphaned versions)
- ✅ 95%+ test coverage

### Business
- ✅ 90%+ admin satisfaction with version control
- ✅ 50%+ reduction in new company setup time
- ✅ Zero data loss during migration
- ✅ <5 support tickets per month about versioning

### User Experience
- ✅ Intuitive UI (no training required)
- ✅ Clear visual distinction between draft/live
- ✅ Fast operations (<2s to push live)
- ✅ Helpful error messages

---

## 🔧 Alternative Approaches Considered

### Alternative 1: Keep Embedded Storage, Add Audit Log
**Pros**: Simpler, no migration  
**Cons**: Still bloats Company document, limited history  
**Verdict**: ❌ Doesn't scale long-term

### Alternative 2: External Version Control (Git)
**Pros**: Mature tooling, industry standard  
**Cons**: Complex integration, overkill for use case  
**Verdict**: ❌ Over-engineered

### Alternative 3: Snapshot on Every Save
**Pros**: Automatic, no user action needed  
**Cons**: Storage bloat, performance impact  
**Verdict**: ❌ Too much overhead

### **Chosen Approach: Separate Collection with Explicit Versioning**
**Pros**: Clean, scalable, explicit user control  
**Cons**: Requires migration, more complex  
**Verdict**: ✅ Best balance of simplicity and power

---

## 📚 References

### Internal Documentation
- [CheatSheet Schema Documentation](./models/cheatsheet/CheatSheetConfigSchema.js)
- [API Route Standards](./docs/API_STANDARDS.md)
- [Multi-Tenancy Guidelines](./docs/MULTI_TENANCY.md)

### External Resources
- [MongoDB Versioning Patterns](https://www.mongodb.com/blog/post/building-with-patterns-the-document-versioning-pattern)
- [REST API Design Best Practices](https://restfulapi.net/)
- [Optimistic Concurrency Control](https://en.wikipedia.org/wiki/Optimistic_concurrency_control)

---

## ❓ Open Questions for Engineering Review

1. **Checksum Algorithm**: SHA256 vs faster alternatives for config integrity?
2. **Pagination Strategy**: Cursor-based vs offset-based for version history?
3. **Archive Retention**: How long to keep archived versions? (Proposal: 1 year)
4. **Conflict Resolution**: Last-write-wins vs manual merge for concurrent edits?
5. **Rate Limiting**: 60 req/min sufficient or should we adjust?
6. **Cache TTL**: 5min for live configs or shorter for faster updates?
7. **Migration Timing**: Off-hours maintenance window or gradual background migration?
8. **Rollback Window**: How long to keep old embedded data? (Proposal: 30 days)

---

## 📝 Sign-Off

**Prepared By**: AI Development Assistant  
**Date**: November 22, 2025  
**Version**: 2.0  
**Status**: Awaiting Engineering Review

**Reviewers**:
- [ ] Lead Engineer - Architecture Review
- [ ] Backend Engineer - API & Service Review  
- [ ] Frontend Engineer - UI/UX Review
- [ ] DevOps Engineer - Infrastructure & Deployment Review
- [ ] QA Engineer - Testing Strategy Review

**Approval Required Before**: Implementation begins

---

## 🚦 Decision: Proceed / Revise / Reject

**Decision**: _____________  
**Date**: _____________  
**Approved By**: _____________  
**Notes**: 
```
_______________________________________________________
_______________________________________________________
_______________________________________________________
```

---

**End of Proposal**

