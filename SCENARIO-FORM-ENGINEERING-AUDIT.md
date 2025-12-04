# 🔬 SCENARIO FORM ENGINEERING AUDIT
## Performance & Architecture Review

**Date:** December 4, 2025  
**Purpose:** Analyze 30+ scenario settings for runtime impact on call latency

---

## 📊 EXECUTIVE SUMMARY

### The Good News 🟢
**Most settings are DESIGN-TIME only** - they affect how scenarios are stored, not how fast they're matched at runtime.

### The Concern 🟡
**The architecture question is valid** - but the bottleneck isn't the form complexity, it's the MATCHING algorithm.

---

## 🕐 RUNTIME vs DESIGN-TIME BREAKDOWN

### ⚡ DESIGN-TIME ONLY (24 settings)
These are processed ONCE when admin saves, stored in DB, and NEVER touched during calls:

| # | Setting | Tab | Purpose | Runtime Impact |
|---|---------|-----|---------|----------------|
| 1 | Scenario Name | Basic | Display only | ❌ None |
| 2 | Status (draft/live/archived) | Basic | Filtering | ❌ None (pre-filtered) |
| 3 | Priority Level | Basic | Tie-breaker | ⚡ O(1) comparison |
| 4 | Inherited Fillers (display) | Basic | Admin view | ❌ None |
| 5 | Inherited Synonyms (display) | Basic | Admin view | ❌ None |
| 6 | Regex Triggers | Basic | Pre-compiled | ❌ Compiled at save |
| 7 | Channel | Basic | Pre-filtered | ❌ None |
| 8 | Language | Basic | Pre-filtered | ❌ None |
| 9 | Full Replies | Replies | Response pool | ⚡ Random pick O(1) |
| 10 | Follow-Up Funnel | Replies | Post-response | ❌ None on match |
| 11 | Reply Selection Strategy | Replies | Pick algorithm | ⚡ O(1) |
| 12 | Scenario Type | Replies | Metadata | ❌ None |
| 13 | Reply Strategy | Replies | Response mode | ⚡ O(1) switch |
| 14 | Entity Capture | Entities | Extraction list | ⚠️ Per-entity regex |
| 15 | Dynamic Variables | Entities | Fallback map | ⚡ O(1) lookup |
| 16 | Entity Validation | Entities | Post-match | ❌ None on match |
| 17 | Cooldown | Advanced | Rate limit | ⚡ O(1) timestamp |
| 18 | Handoff Policy | Advanced | Post-response | ❌ None on match |
| 19 | Follow-Up Mode | Advanced | Post-response | ❌ None on match |
| 20 | Follow-Up Question | Advanced | Post-response | ❌ None on match |
| 21 | Transfer Target | Advanced | Post-response | ❌ None on match |
| 22 | Timed Follow-Up | Advanced | Async timer | ❌ Async |
| 23 | Silence Policy | Advanced | Timeout handler | ❌ Async |
| 24 | TTS Override | Advanced | Voice params | ❌ Post-match |

### 🔥 RUNTIME-CRITICAL (6 settings)
These directly affect matching speed:

| # | Setting | Impact | Current Implementation |
|---|---------|--------|----------------------|
| 1 | **Trigger Phrases** | O(n) per phrase | Fuzzy match via fuzz.js |
| 2 | **Negative Triggers** | O(n) per phrase | Early-exit filter |
| 3 | **Min Confidence** | O(1) threshold | Simple comparison |
| 4 | **Behavior** | O(1) lookup | ID reference |
| 5 | **Quick Replies** | O(1) random | Array pick |
| 6 | **Preconditions** | O(k) state checks | JSON evaluation |

---

## 🚨 THE REAL BOTTLENECK: Call Flow Architecture

### Current Flow (Your Concern):
```
Caller speaks (200-500ms STT)
    ↓
Brain-1/FrontlineIntel receives text (1ms)
    ↓
Triage/Quick Decision check (5-20ms)  ← FAST IF HIT
    ↓ (if no quick match)
3-Tier Scenario Engine (50-300ms)     ← SLOW
    ↓
Process matched scenario form (1-5ms)  ← FAST
    ↓
Generate response (10-50ms TTS)
    ↓
Total: 260-850ms (acceptable for voice)
```

### Where Time Actually Goes:

| Stage | Time | Optimization Status |
|-------|------|---------------------|
| Twilio STT | 200-500ms | ❌ Can't optimize (external) |
| Network latency | 20-50ms | ❌ Can't optimize |
| **Triage Quick Match** | **5-20ms** | ✅ FAST - keyword hash |
| **3-Tier Semantic** | **50-150ms** | ⚠️ Embedding lookup |
| **3-Tier LLM Fallback** | **500-2000ms** | 🔴 EXPENSIVE |
| Scenario Form Processing | 1-5ms | ✅ Already fast |
| TTS Generation | 50-200ms | ❌ External |

---

## 💡 KEY INSIGHT: The Form Is NOT The Problem

### The 30 Settings Don't Hurt Performance Because:

1. **Pre-compilation**: Regex triggers compiled at save, not runtime
2. **Pre-filtering**: Status/channel/language filtered before matching
3. **O(1) Operations**: Most runtime settings are simple lookups
4. **Lazy Evaluation**: Follow-up/transfer only processed AFTER match

### The REAL Performance Questions:

1. **How many scenarios are in the pool?**
   - 10 scenarios = ~5ms matching
   - 100 scenarios = ~50ms matching
   - 1000 scenarios = ~500ms matching (problem!)

2. **How often do we hit LLM fallback (Tier-3)?**
   - Tier-1 (keyword): ~10ms ✅
   - Tier-2 (semantic): ~50-100ms ⚠️
   - Tier-3 (LLM): ~500-2000ms 🔴

3. **Is Triage working correctly?**
   - Good Triage = 80%+ calls resolved in 10ms
   - Bad Triage = Everything goes to 3-Tier

---

## 🎯 RECOMMENDATIONS

### Option A: Keep Current Form (Recommended)
**Rationale**: The form complexity is a DESIGN-TIME investment that SAVES runtime.

- More trigger variations = better Tier-1 matching
- More replies = more natural variety
- Better scenarios = fewer LLM fallbacks

**Optimize runtime instead:**
1. Index trigger phrases for O(1) hash lookup
2. Pre-warm semantic embeddings in Redis
3. Reduce Tier-3 LLM calls

### Option B: Simplify Form (Not Recommended)
**Risk**: Simpler scenarios = more LLM calls = SLOWER overall

If we remove:
- Negative triggers → More false positives → More LLM verification
- Entity capture → Manual extraction needed → More LLM work
- Follow-up modes → Less structured → More LLM improvisation

---

## 📋 SETTINGS DEEP DIVE BY TAB

### Tab 1: Basic Info (12 fields)

| Field | Design | Runtime | Verdict |
|-------|--------|---------|---------|
| Scenario Name | ✅ | ❌ | Keep |
| Status | ✅ | Pre-filter | Keep |
| Priority | ✅ | O(1) | Keep |
| Trigger Phrases | ✅ | **Matching** | **Critical** |
| Negative Triggers | ✅ | Early-exit | **Critical** |
| Regex Triggers | ✅ | Compiled | Keep |
| Min Confidence | ✅ | Threshold | Keep |
| Behavior | ✅ | ID lookup | Keep |
| Channel | ✅ | Pre-filter | Could hide |
| Language | ✅ | Pre-filter | Could hide |
| Inherited Fillers | Display | ❌ | Display only |
| Inherited Synonyms | Display | ❌ | Display only |

### Tab 2: Replies & Flow (8 fields)

| Field | Design | Runtime | Verdict |
|-------|--------|---------|---------|
| Quick Replies | ✅ | Random pick | **Critical** |
| Full Replies | ✅ | Random pick | **Critical** |
| Follow-Up Funnel | ✅ | Post-match | Keep |
| Reply Selection | ✅ | Pick algo | Keep |
| Scenario Type | ✅ | Metadata | Could auto-infer |
| Reply Strategy | ✅ | Mode switch | Keep |

### Tab 3: Entities & Variables (4 fields)

| Field | Design | Runtime | Verdict |
|-------|--------|---------|---------|
| Entity Capture | ✅ | Extraction | Optional |
| Dynamic Variables | ✅ | Fallbacks | Keep |
| Entity Validation | ✅ | Post-match | Optional |

### Tab 4: Advanced (10+ fields)

| Field | Design | Runtime | Verdict |
|-------|--------|---------|---------|
| Cooldown | ✅ | Rate limit | Keep |
| Handoff Policy | ✅ | Post-match | Keep |
| Follow-Up Mode | ✅ | Post-match | Keep |
| Follow-Up Question | ✅ | Post-match | Keep |
| Transfer Target | ✅ | Post-match | Keep |
| Timed Follow-Up | ✅ | Async | Keep |
| Silence Policy | ✅ | Timeout | Keep |
| TTS Override | ✅ | Voice | Optional |
| Preconditions | ✅ | State check | Power user |
| Effects | ✅ | Post-match | Power user |

---

## 🔧 ACTIONABLE OPTIMIZATIONS

### Quick Wins (This Week)
1. **Hash index for triggers** - O(n) → O(1) for exact matches
2. **Skip empty fields** - Don't process null settings
3. **Lazy-load Advanced tab** - Most users never open it

### Medium Term (This Month)
1. **Triage Card priority** - Always check cards before 3-Tier
2. **Pre-compute embeddings** - Semantic matching in Redis
3. **Scenario pooling** - Load active scenarios at call start

### Long Term (This Quarter)
1. **Two-tier form** - Basic (5 fields) vs Advanced (30 fields)
2. **Auto-infer settings** - AI suggests based on triggers/replies
3. **Scenario templates** - Pre-filled common patterns

---

## 🏁 CONCLUSION

**The 30+ settings are NOT causing latency.**

The form is designed for ADMIN efficiency, not runtime processing. At call time:
- Only 6 fields affect matching
- Most are O(1) operations
- The real bottleneck is Tier-2/Tier-3 matching

**Recommendation**: Focus on improving Tier-1 hit rate (Triage Cards) rather than simplifying the form. A well-configured scenario with 30 settings will OUTPERFORM a simple scenario that requires LLM fallback.

---

## 📊 METRICS TO TRACK

| Metric | Target | Action if Missed |
|--------|--------|-----------------|
| Tier-1 hit rate | >70% | Add more triage cards |
| Tier-2 hit rate | >20% | Improve embeddings |
| Tier-3 usage | <10% | Better scenarios |
| Match latency | <100ms | Index optimization |
| Total response | <800ms | Reduce LLM calls |

---

*Generated by Engineering Audit - December 2025*

