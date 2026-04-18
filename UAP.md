# UAP Engine Report — Complete A-to-Z Pipeline Reference

**Last verified against code: April 17, 2026**

This document describes the complete caller utterance routing pipeline from speech input to agent response. Paste this into any future conversation for full system context.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Data Foundations](#2-data-foundations)
3. [The 8-Field CueExtractor](#3-the-8-field-cueextractor)
4. [BridgeService — Phrase Index Builder](#4-bridgeservice--phrase-index-builder)
5. [UAP — UtteranceActParser (6-Pass Phrase Matcher)](#5-uap--utteranceactparser-6-pass-phrase-matcher)
6. [KCDiscoveryRunner — The Gate Sequence](#6-kcdiscoveryrunner--the-gate-sequence)
7. [Answer Delivery — Fixed vs Groq](#7-answer-delivery--fixed-vs-groq)
8. [Constants & Thresholds Reference](#8-constants--thresholds-reference)
9. [Key Files Reference](#9-key-files-reference)
10. [Turn 1 Preamble Stripping](#10-turn-1-preamble-stripping-april-2026)
11. [Booking Name-Answer Escape Hatch](#11-booking-name-answer-escape-hatch-april-2026)
12. [KC Gaps Turn 1 Visibility Fix](#12-kc-gaps-turn-1-visibility-fix-april-2026)
13. [Booking Intent Guards — Narrative Filter + noAnchor Semantics](#13-booking-intent-guards--narrative-filter--noanchor-semantics-april-2026)
14. [Timing & Silence Layer — All UI, No Hardcoded](#14-timing--silence-layer--all-ui-no-hardcoded-april-2026)
15. [LAP — ListenerActParser (Pre-Pipeline Gate)](#15-lap--listeneractparser-pre-pipeline-gate-april-2026)
16. [Answer-From-KB LLM Posture + Enriched callContext](#16-answer-from-kb-llm-posture--enriched-callcontext-april-2026)
17. [Agent Studio + Cross-Container KC Recovery](#17-agent-studio--cross-container-kc-recovery-april-2026)
18. [Speculative Pre-Warm — UAP Runs While Caller Is Speaking](#18-speculative-pre-warm--uap-runs-while-caller-is-speaking-april-2026)
19. [Design Rationale + Operational Guardrails (Read This First on Every New Session)](#19-design-rationale--operational-guardrails-april-2026)

---

## 1. Architecture Overview

### The Two-Path Execution Model (READ THIS FIRST)

The pipeline runs in TWO places per turn — not just once. This is critical to understand:

1. **Speculative path** — fires on every PARTIAL STT transcript while the caller is still speaking
2. **Final path** — fires once when STT completes and the caller has finished speaking

```
CALLER STARTS SPEAKING
         │
         ├── Twilio streams partials every ~300ms → /v2-agent-partial/:companyId
         │          │
         │          ▼
         │   runSpeculativeLLM(callSid, companyId, partialText)
         │          │
         │          ▼
         │   CallRuntime.processTurn()  ← FULL PIPELINE RUNS HERE (on partial)
         │     GATE 0.5 → 0.7 → 1 → 2.4 → 2.5 → 2.8 → 2.9 → 3 → 3.5 → Groq → 4 → 4.5
         │          │
         │          ▼
         │   Result cached in Redis (TTL=8s, key: speculative:result:{callSid})
         │
         │   (repeats 3-5 times as caller keeps talking — each partial overwrites cache)
         │
CALLER FINISHES SPEAKING (Twilio endpointing)
         │
         ▼
  /v2-agent-respond/:companyID  (main handler, FINAL transcript)
         │
         ▼
  checkSpeculativeResult(callSid, finalText, turnCount, redis)
         │
         ├── Token containment ≥ 75%?  (did partial ≈ final?)
         │    │
         │    ├─ YES → 🚀 Use cached response, skip pipeline, save ~1-2s
         │    │
         │    └─ NO → Discard cache, run pipeline fresh on final transcript
         │
         ▼
  AGENT SPEAKS (Groq stream, ElevenLabs TTS, Twilio Play)
```

### KCDiscoveryRunner.run() — The Pipeline (runs in BOTH paths)

Same pipeline executes speculatively AND on final. Speculative runs it on every partial; final runs it once if the speculative miss wasn't good enough.

```
Caller utterance (partial OR final) → userInput (string)
                          │
                    KCDiscoveryRunner.run()
                          │
    ┌─────────────────────┼─────────────────────┐
    │                     │                     │
  GATE 0.5          GATE 0.7              GATE 1
  Transfer?         Pending PQ/Upsell?    Booking?
    │                     │                     │
    └─────────────────────┼─────────────────────┘
                          │
              [Parallel Load: Notes + Containers + Rejected IDs]
              [Rejection Detector]
                          │
                    GATE 2.4  CueExtractor (<1ms) — 8-field grammatical cues
                      ├─ 2.4b  Trade match route
                      └─ 2.4c  Cue profile scan (single-trade)
                          │
                    GATE 2.5  UAP Layer 1 (<1ms) — phrase index lookup
                      ├─ Logic 1: Word Gate (anchor words)
                      └─ Logic 2: Core Confirmation (~50ms embed)
                          │
                    GATE 2.8  Semantic Match (~50ms)
                          │
                    GATE 2.9  Negative Keyword Checkpoint (<1ms)
                      └─ suppress match if negKw present → fall through
                          │
                    GATE 3    Keyword Scoring (<1ms) — anchor 3× boost
                          │
                    [Section Gap Detection + Cross-Container Rescue]
                          │
                ┌─── match found? ───┐
                │                    │
              YES                   NO
                │                    │
          GATE 3.5               GATE 4
          Pre-qualify?           LLM Fallback (Claude ~800ms)
                │                    │
          KCS.answer()           GRACEFUL ACK
          (Groq ~500ms)          (canned response)
                │
          GATE 4.5
          Upsell chain?
                │
          Return response
```

### Two Modes the Agent Operates In

- **Mode 1 — Discovery (UAP + 8cuecore + anchor + KC):** Default. Agent satisfies the caller. UAP+CueExtractor identify what they're saying, KC has the answers, anchor persists topic across turns.
- **Mode 2 — Structured Requirements (Booking / Transfer):** Exception states where the business owner has requirements.

Even inside structured flows, when the caller wanders and asks a question: right back to Mode 1. Stateless. No consent gates.

### Why This Matters (Architectural Principle)

**UAP + 8cuecore + anchor is the LATEST design — it replaced an earlier daType + daSubType classifier routing.** The earlier design is preserved in `memory/uap-kc-design.md` but is HISTORICAL — do not confuse it with current runtime. Current routing is deterministic phrase-index + grammatical cues + anchor persistence, NOT an LLM classifier. See §19 for the design rationale.

---

## 2. Data Foundations

### GlobalShare (AdminSettings.globalHub.phraseIntelligence)

Stored in `AdminSettings` model under `globalHub.phraseIntelligence` (type: `mongoose.Schema.Types.Mixed`). Six sub-collections:

| Collection | Shape | Count | Purpose |
|---|---|---|---|
| `cuePhrases` | `[{ pattern, token }]` | ~1,832 | 7 cue types for CueExtractor fields 1-7 |
| `tradeVocabularies` | `[{ tradeKey, label, terms[] }]` | 2+ vocabs (HVAC=329, SPAM=87) | Industry term banks linked to KC containers |
| `synonymGroups` | `[{ token, synonyms[] }]` | varies | Canonical folding for UAP Pass 4A |
| `intentNormalizers` | `[{ pattern, token }]` | varies | Longest-match intent replacement |
| `stopWords` | `[String]` | varies | Stripped during phrase reduction |
| `dangerWords` | `[String]` | varies | Never stripped (not, no, emergency, cancel) |

All accessed via `PhraseReducerService` with a **5-minute in-memory cache**. Invalidated on admin save.

### CompanyKnowledgeContainer (KC Cards)

Each company has multiple KC containers. Each container has multiple sections.

**Container-level fields:**
- `companyId`, `title`, `kcId` (human-readable, e.g. "700c4-34")
- `isActive` (boolean), `priority` (sort order)
- `tradeVocabularyKey` (string, links to GlobalShare trade vocabulary, e.g. "HVAC")
- `useFixedResponse` (boolean, container-level fixed response toggle)
- `knowledgeBaseSettings` overrides (word limit, response style, booking action)

**Section-level fields (sectionSchema):**
- `label` (string, max 80) — section heading
- `content` (string, max 2000) — Fixed mode reads this verbatim. Groq fallback. Target: 35-42 words.
- `groqContent` (string, max 4000) — Rich source material for Groq. Preferred over content when non-empty.
- `order` (number) — display/injection order
- `isActive` (boolean) — per-section on/off
- `contentKeywords` (string[]) — auto-extracted bigrams for GATE 3 keyword scoring
- `negativeKeywords` (string[]) — exclusion keywords, skip section if found in utterance
- `tradeTerms` (string[]) — admin-curated trade terms for CueExtractor field 8 section-level routing
- `useFixedResponse` (boolean) — per-section fixed response toggle
- `fixedResponseText` / `audioUrl` — pre-cached fixed response + audio
- `contentEmbedding` ([Number], 512-dim) — for GATE 2.8 semantic match
- `phraseCore` (string) — reduced semantic core of all callerPhrases combined
- `phraseCoreEmbedding` ([Number], 512-dim) — for Logic 2 core confirmation
- `bookingAction` (enum: offer_to_book / advisor_callback / none / null)
- `isPromotion` / `promotionLabel` — promotion tagging
- `preQualifyQuestion` — GATE 3.5 intercept config
- `upsellChain` — GATE 4.5 sequential add-on offers

**CallerPhrase sub-schema (per section):**
```
{
  text:        String (max 200),      // "how much is my service call going to be"
  embedding:   [Number] (512-dim),    // auto-generated on save
  anchorWords: [String],              // admin-defined discriminating words (orange in UI)
  addedAt:     Date,
  score: {                            // 3TSM score (persisted on Re-score)
    t1, t1Source, t2, t3, t3Score, tc, core, status, scoredAt,
    normalizedPatterns: [{ pattern, token }]
  }
}
```

---

## 3. The 8-Field CueExtractor

**File:** `services/cueExtractor/CueExtractorService.js`
**Pipeline position:** GATE 2.4 in KCDiscoveryRunner
**Latency:** <1ms (pure string matching, no LLM, no embedding, no API)

### Purpose

Extracts the structural skeleton from caller "word salad." The 7 universal fields parse English sentence structure. The 1 trade field is the only per-company variable.

### The 8 Fields

| # | Field | Source | Example Values |
|---|---|---|---|
| 1 | `requestCue` | GlobalShare cuePhrases | "can you", "could you", "would you" |
| 2 | `permissionCue` | GlobalShare cuePhrases | "do i have to", "am i required to", "will i need to" |
| 3 | `infoCue` | GlobalShare cuePhrases | "what is", "how does", "tell me about" |
| 4 | `directiveCue` | GlobalShare cuePhrases | "i need", "i want", "please", "send someone" |
| 5 | `actionCore` | GlobalShare cuePhrases | "schedule", "pay", "charge", "cost", "refund", "fix" |
| 6 | `urgencyCore` | GlobalShare cuePhrases | "today", "right now", "asap", "emergency" |
| 7 | `modifierCore` | GlobalShare cuePhrases | "next week", "another", "again", "same problem" |
| 8 | `tradeMatches` | Per-company trade index | `[{ term, containerId, sectionIdx, sectionLabel }]` |

**Fields 1-7** are the same for ALL companies (English language patterns). Loaded from `PhraseReducerService.getCuePatterns()`. Patterns grouped by token, sorted longest-first within each group. First (longest) substring match per field wins.

**Field 8** is the only per-company variable. Built from two sources into a reverse index `{ normalizedTerm: [{ term, containerId, sectionIdx, sectionLabel }] }`:
- **Source 1 — Global vocabularies:** Container's `tradeVocabularyKey` links to GlobalShare `tradeVocabularies`. Terms indexed at container level (`sectionIdx = -1`, no section targeting).
- **Source 2 — Per-section tradeTerms[]:** Custom overrides on individual sections. Terms indexed with specific `sectionIdx` for direct section routing.

### Trade Index Caching (Two-Tier)

| Tier | TTL | Key |
|---|---|---|
| In-memory | 5 min | `_tradeIndexCache[companyId]` |
| Redis | 1 hour | `cue-trade-idx:{companyId}` |
| MongoDB (cold) | N/A | queries CompanyKnowledgeContainer |

Invalidated via `invalidateTradeIndex(companyId)` when KC containers are saved.

### Output Shape (cueFrame)

```javascript
{
  requestCue:       'can you' | null,
  permissionCue:    null,
  infoCue:          'how much' | null,
  directiveCue:     null,
  actionCore:       'pay' | null,
  urgencyCore:      'today' | null,
  modifierCore:     null,
  tradeMatches:     [{ term, containerId, sectionIdx, sectionLabel }],
  fieldCount:       5,           // count of non-null fields (0-8)
  extractedAt:      ISO string,
  companyTradeKeys: ['hvac'],    // distinct tradeVocabularyKey values for this company
  isSingleTrade:    true,        // companyTradeKeys.length <= 1
}
```

### Design Intent

The 8 cues differentiate utterances that share keywords but need different responses:
- "Can I **pay** with **credit card**" → requestCue + actionCore + tradeMatch
- "Do I **have to pay** for this call **today**" → permissionCue + actionCore + urgencyCore
- "How much is my **service** going to **cost**" → infoCue + actionCore

Same topic words, different cue profiles, different KC sections.

---

## 4. BridgeService — Phrase Index Builder

**File:** `services/engine/kc/BridgeService.js`
**VERSION:** 5 (v5 = per-phrase anchorWords[] replaces section-level anchorTerm)

### What It Builds

Queries all active KC containers for a company, iterates every section and callerPhrase, and builds two indexes:

**phraseIndex** — normalized phrase text → routing metadata:
```javascript
phraseIndex[normalizedPhrase] = {
  containerId:  string,       // ObjectId
  kcId:         string|null,  // human-readable "700c4-34"
  sectionIdx:   number,
  sectionLabel: string,
  anchorWords:  string[],     // normalized, from the specific phrase ([] = no gate)
}
```

**phoneticIndex** — Double Metaphone code → candidate phrases:
```javascript
phoneticIndex[metaphoneCode] = [
  { word, phrase, containerId, kcId, sectionIdx, sectionLabel }
]
```

### Build Rules
- Inactive sections (`isActive === false`) are excluded — their phrases are NOT indexed.
- First-phrase-wins deduplication: if normalized phrase already exists, it's skipped. Priority-sorted containers mean higher-priority phrases win.
- Each phrase's `anchorWords[]` are normalized and stored directly on the index entry.

### Caching
- **Redis key:** `bridge:{companyId}` (no TTL, event-invalidated)
- **Version check:** If cached bridge has `version !== 5`, rebuild from MongoDB.
- **Invalidation:** `invalidate(companyId)` deletes Redis key + clears UAP in-process caches. Called on KC container save.
- **Graceful degrade:** Redis unavailable → build works, just not cached.

---

## 5. UAP — UtteranceActParser (6-Pass Phrase Matcher)

**File:** `services/engine/kc/UtteranceActParser.js`
**Pipeline position:** GATE 2.5 in KCDiscoveryRunner
**Latency:** <1ms (phrase index lookup from Redis/memory)

### parse() Function

```javascript
async function parse(companyId, utterance)
// Returns: ParsedUtterance (never null)
```

### Result Shape

```javascript
{
  containerId:   string | null,
  kcId:          string | null,
  sectionIdx:    number | null,
  sectionLabel:  string | null,
  confidence:    number,          // 0.00 - 0.95
  matchedPhrase: string | null,
  matchType:     string,          // EXACT|PARTIAL|WORD_OVERLAP|SYNONYM|FUZZY_PHONETIC|NONE
  anchorWords:   string[],        // from phraseIndex entry for matched phrase
  topicWords:    string[],        // significant words from caller input (for Logic 2 + GATE 3)
  rawInput:      string,
  normInput:     string,
}
```

### The 6-Pass Pipeline

All passes operate on normalized input (lowercased, punctuation → spaces, whitespace collapsed).

| Pass | Name | Confidence | Logic |
|---|---|---|---|
| 1 | EXACT | 0.95 | Entire callerPhrase is a substring of input. Longest phrase wins. |
| 2 | PARTIAL | 0.80 | All significant phrase words (len>=3, min 2 words) found in input. |
| 3 | WORD_OVERLAP | 0.70 / 0.50 | Weighted word overlap. Words >7 chars get 1.5x. Score >=0.5 → 0.70, <0.5 → 0.50. |
| 4A | SYNONYM | 0.75 | Loads GlobalShare synonymGroups. Expands input via synonym replacement. Re-runs Passes 1-3. If any hit, confidence overridden to 0.75. |
| 4B | FUZZY_PHONETIC | 0.70 / 0.65 | Double Metaphone codes compared against phoneticIndex. Score >=0.5 → 0.70, <0.5 → 0.65. |
| 5 | NONE | 0.00 | No match. All IDs null. topicWords still populated for downstream GATE 3. |

**Passes 1-2** (confidence >= 0.80) → direct route at GATE 2.5, carrying `anchorWords[]`.
**Passes 3-5** (confidence < 0.80) → populate `uapResult.containerId` as hint for downstream gates. Falls through.

### In-Process Caches

```javascript
const PHRASE_INDEX_CACHE_TTL = 60 * 60 * 1000; // 1 hour
const _phraseCache   = new Map();   // companyId -> { index, builtAt }
const _phoneticCache = new Map();   // companyId -> { index, builtAt }
```

---

## 6. KCDiscoveryRunner — The Gate Sequence

**File:** `services/engine/kc/KCDiscoveryRunner.js`
**Main function:** `KCDiscoveryRunner.run({ company, companyId, callSid, userInput, state, emitEvent, turn, bridgeToken, redis, onSentence, pendingBookingQuestion })`
**Returns:** `{ response, matchSource: 'KC_ENGINE', state, kcTrace, audioHintText? }`

### match Object Shape

Initialized as `null`. First gate to set it wins (subsequent gates are skipped via `if (!match)` guards).

```javascript
{
  container:        Object,        // full KC container document
  score:            Number,        // 0-100
  matchSource:      String,        // CUE_EXTRACT | CUE_PROFILE_SCAN | UAP_LAYER1 | SEMANTIC | (keyword)
  targetSection:    Object|null,   // specific section, or null = Groq reads all sections
  targetSectionIdx: Number|null,
  cueFrame?:        Object,        // only on CUE_EXTRACT / CUE_PROFILE_SCAN
  uapResult?:       Object,        // only on UAP_LAYER1
}
```

---

### GATE 0.5 — Transfer Intent (~0ms fast path)

**File:** `services/engine/kc/KCTransferIntentDetector.js`
**Trigger:** `KCTransferIntentDetector.isTransferIntent(userInput)` — synchronous phrase match (~100 phrases).
**Anti-false-positive:** Checks `NOT_TRANSFER_PHRASES` first (12 exclusions: "bank transfer", "transfer my appointment", etc.).
**On hit:** Loads TransferPolicy + TransferDestination. Emergency override → immediate return. Normal → sets `state.sessionMode = 'TRANSFER'`, returns announcement text.
**On miss:** Falls through to GATE 0.7.
**Path:** `KC_TRANSFER_INTENT` or `KC_TRANSFER_OVERFLOW`

### GATE 0.7 — Pending Pre-Qualify or Upsell State (~2ms Redis)

**Trigger:** Redis keys `kc-prequal:{companyId}:{callSid}` or `kc-upsell:{companyId}:{callSid}` exist (set by previous turn's GATE 3.5 or GATE 4.5).
**On hit:** Calls `_handlePrequalResponse()` or `_handleUpsellResponse()` to process caller's answer.
**On miss:** Falls through to GATE 1.
**Path:** `KC_PREQUAL_PENDING` / `KC_UPSELL_PENDING` / `KC_DIRECT_ANSWER`

### GATE 1 — Booking Intent (~0ms synchronous)

**Trigger:** `!_inputHasQuestion && !_inputIsNarrative && KCBookingIntentDetector.isBookingIntent(userInput)`

**Question detection:** Input contains `?` OR matches question word regex (what/how/why/when/which/where/does/do you/can you/tell me/explain/about/offer/etc.).

**Hedged-yes override:** If question words are present but NO literal `?` AND utterance starts with a leading affirmative (yes/yeah/sure/okay + fillers), `_inputHasQuestion` resets to `false` → booking fires.

**Narrative filter — 3 guards (any one triggers):** Prevents callers who are narrating a story from being misread as booking intent. Full details in [Section 13](#13-booking-intent-guards--narrative-filter--noanchor-semantics-april-2026).
- **Guard 1 — NARRATIVE_INDICATORS regex** (past-tense/story words): `i came`, `i was`, `it started`, `you guys`, `last time`, `came home`, etc. (~45 patterns).
- **Guard 2 — Trailing conjunction**: >6 words ending in `and`/`but`/`so`/etc. — caller is mid-story.
- **Guard 3 — Length guard**: >20 words with only filler affirmatives (yeah/okay/sure) — long narrative with incidental agreement.

**Compound intent:** If both `_inputHasQuestion` AND `isBookingIntent()` are true, `_hasCompoundBookingIntent = true` — KC answers the question first, then sets booking lane after.

**On hit:** Sets `state.lane = 'BOOKING'`, `state.sessionMode = 'BOOKING'`. Returns "Great! Let me get that scheduled for you."
**On miss:** Falls through to parallel load + GATE 2.4.
**Path:** `KC_BOOKING_INTENT`

---

### PARALLEL LOAD (between GATE 1 and GATE 2.4)

Three concurrent loads:
1. `DiscoveryNotesService.load()` — discoveryNotes for this call
2. `KCS.getActiveForCompany()` — all active KC containers with full sections
3. `redis.get('kc-rejected:{companyId}:{callSid}')` — rejected container IDs from this call

Plus: `EngineHubRuntime.load(company)` (synchronous).

### REJECTION DETECTOR (before scoring)

If caller utterance starts with rejection pattern (`_REJECTION_RE`: no/nope/that's not/wrong/I didn't ask/etc.) AND there is an anchored container from discoveryNotes:
- Adds anchor to `rejectedContainerIds`
- Persists to Redis (TTL 4h)
- Writes title to `discoveryNotes.rejectedTopics[]`
- Clears anchor

`scorableContainers` = containers minus rejected ones.

---

### GATE 2.4 — CueExtractor (<1ms pattern match)

**Always runs.** Calls `CueExtractorService.extract(companyId, userInput)`. Always writes `cueFrame` to discoveryNotes (enrichment for downstream + Groq).

**Three routing branches:**

#### Branch A — GATE 2.4b: Trade match present
**Condition:** `fieldCount >= 3 AND tradeMatches.length > 0`
- First trade match wins (sorted longest-first).
- `sectionIdx === -1` (container-level vocab) → no section targeting, Groq reads all sections. Anchor check skipped.
- `sectionIdx >= 0` (section-level tradeTerms) → targets specific section. Anchor confirmation runs: >=90% of any phrase's anchorWords must be present (stem-matched).
- **matchSource:** `'CUE_EXTRACT'`
- **Score:** `Math.round((fieldCount / 8) * 100)`

#### Branch B — GATE 2.4c: Single-trade, no trade match
**Condition:** `fieldCount >= 3 AND tradeMatches.length === 0 AND isSingleTrade`
- Trade is implicit (only one trade exists). Scans all callerPhrases across all KC cards using `_cueScanPhrases()`.
- `_cueScanPhrases` logic: collects non-null cue pattern values, tests each callerPhrase for substring matches of those patterns, scores by overlap count (minimum 2 overlaps required), then runs anchor confirmation on the best match.
- **matchSource:** `'CUE_PROFILE_SCAN'`
- **Score:** same formula

#### Branch C — Multi-trade, no trade match
**Condition:** `fieldCount >= 3 AND tradeMatches.length === 0 AND !isSingleTrade`
- Ambiguous trade. Logs for awareness. Falls through to GATE 2.5.
- Future: if ALL downstream gates also miss, this info enables a trade-clarification response.

#### Branch D — Low field count (1-2)
- Enrichment only. Falls through to GATE 2.5.

**On any error:** Falls through to GATE 2.5 (logged as warning).

---

### GATE 2.5 — UAP Layer 1 (<1ms phrase index)

**Guard:** `if (!match)` — only fires if GATE 2.4 did not set a match.

Calls `UtteranceActParser.parse(companyId, userInput)`.

**Trigger:** `uapResult.confidence >= 0.80` (UAP_CONFIDENCE_THRESHOLD)

**Anchor Gate — Two sequential gates (both must pass):**

**Logic 1 — Word Gate (<1ms):**
- If `anchorWords.length > 0`: checks >=90% of anchor words present in utterance (exact or stem-matched via `_stem()`).
- `_stem()`: simple suffix stripper (ing/ings/ation/ations/ers/er/ed/ly/ies/ves/s).
- If ratio < 0.90: `anchorGatePassed = false`.
- Phrases with empty `anchorWords[]`: gate is skipped (backward compatible).

**EXACT bypass:** `matchType === 'EXACT'` → skip Logic 2 entirely, route directly.

**Logic 2 — Core Confirmation (~50ms):**
- Only runs if Logic 1 passes AND matchType is NOT EXACT.
- Takes UAP's `topicWords`, embeds them via OpenAI, computes cosine similarity against `section.phraseCoreEmbedding`.
- If cosine < 0.80 (CORE_MATCH_THRESHOLD): `anchorGatePassed = false`.
- If `phraseCoreEmbedding` absent (Re-score not yet run): Logic 2 skipped, routes on Logic 1 alone.
- If `topicWords` empty: Logic 2 skipped.

**On hit:** Sets `match` with `matchSource: 'UAP_LAYER1'`.
**On miss:** Falls through to GATE 2.8. Fuzzy recovery attempts (SYNONYM/FUZZY_PHONETIC) logged to qaLog.
**Path:** `KC_DIRECT_ANSWER` (eventually)

---

### GATE 2.8 — Semantic Match (~50ms embedding)

**File:** `services/engine/kc/SemanticMatchService.js`
**Guard:** `if (!match)` — only fires if GATE 2.5 did not set a match.
**Embedding model:** OpenAI `text-embedding-3-small` at 512 dimensions.

Two-pass comparison per section:
- **Pass A:** callerPhrase embeddings vs utterance vector
- **Pass B:** contentEmbedding vs utterance vector

**Threshold:** `MIN_SIMILARITY = 0.50` (env: `KC_SEMANTIC_THRESHOLD`). Best scoring section above threshold wins.

**On hit:** Sets `match` with `matchSource: 'SEMANTIC'`, `score: Math.round(similarity * 100)`.
**On miss:** Falls through to GATE 2.9.
**Note:** SemanticMatchService does NOT apply anchor multiplier. That's GATE 3 only.

---

### GATE 2.9 — Universal Negative Keyword Checkpoint (<1ms)

**File:** `services/engine/kc/KCDiscoveryRunner.js` (~line 1507)
**Guard:** `if (match)` — only fires if GATE 2.4 / 2.5 / 2.8 set a match. GATE 3's built-in negativeKeyword check is separate and sufficient for keyword-scored matches.

**Why this gate exists:** negativeKeywords were historically only enforced inside `findContainer()` (GATE 3). If GATE 2.4 / 2.5 / 2.8 matched before GATE 3 even ran, the matched section's negativeKeywords were never checked — a Recovery KC match on "AC is not cooling" could stand even though "AC" is a Recovery negativeKeyword meant to route to HVAC.

**Logic:**

1. **Section-level match** (`match.targetSection` present):
   - Check `match.targetSection.negativeKeywords` for any hit in the utterance (whole-word boundary regex).
   - Any hit → suppress match, fall through to GATE 3 to re-score.

2. **Container-level match** (`match.targetSection === null` — Groq reads all sections):
   - Scan ALL active sections in the container.
   - If ANY section's negativeKeywords match the utterance → suppress match → fall through to GATE 3.
   - Rationale: a container-level match sends all sections to Groq, so ANY negative keyword hit means the utterance contains content we explicitly don't want routed here.

**On suppression:** `match = null`. Logs `KC_ENGINE 🚫 GATE 2.9: NEGATIVE_KEYWORD_BLOCK` with matched keywords, matchSource, and container title. GATE 3 re-runs keyword scoring on the remaining containers.

**On miss (no negativeKeyword hit):** Match stands. Pipeline proceeds to `_handleKCMatch()`.

**Latency:** <1ms (whole-word regex scan over small keyword lists).

---

### GATE 3 — Keyword Scoring (<1ms)

**File:** `services/engine/agent2/KnowledgeContainerService.js` → `findContainer()`
**Guard:** Runs if `match` is still null after gates 2.4, 2.5, 2.8.

**Scoring via `_scorePhrase()` helper:**
- Multi-word phrase, exact substring: `phrase.length * 2`
- Multi-word phrase, word-overlap fallback: words >= 5 chars that overlap, words >= 8 chars get 1.5x their length
- Single word, whole-word boundary: `phrase.length`

**Two scoring paths per container:**

| Path | Source | Weight |
|---|---|---|
| A | `section.contentKeywords[]` | 0.9x (best single keyword score per section) |
| B | `container.title` | 0.8x |

**Anchor container multiplier:** If container matches `callContext.anchorContainerId`, final score is **3x**.

**ANCHOR_FLOOR (24):** Safety net. Fires only when anchor container has zero raw keyword overlap AND no competitor scored above MIN_THRESHOLD.

**MIN_THRESHOLD:** 8 (env: `KC_KEYWORD_THRESHOLD`). Matches below 8 are discarded unless anchor floor.

**Context fallback:** If no match and `callContext.callReason` exists, augments input with call reason and re-runs scoring. Tagged `contextAssisted: true`.

**On hit:** Sets `match` with container, score, bestSection.
**On miss:** Falls through to Section Gap check → GATE 4.

---

### SECTION GAP DETECTION + PRE-FILTER (between GATE 3 and answer delivery)

**Condition:** `match && match.container && !match.targetSection`
Container matched but no specific section identified.

**Two-phase handling:**

**Phase 1 — Diagnostic logging:**
Logs `KC_SECTION_GAP` event. Writes to qaLog for the Gaps & Todo admin page with gap filter metadata.

**Phase 2 — Section pre-filter (GAP_MAX_SECTIONS = 5):**
When a container has more than 5 sections, `_scoreSectionsForGap()` narrows to the top 5 most relevant sections before Groq synthesizes. This prevents Groq from drowning in 200+ sections of content.

**`_scoreSectionsForGap()` scoring per section:**

| Signal | Weight | Source |
|---|---|---|
| Label word overlap | ×4 per hit | Section label words matched against input (stem-matched) |
| CallerPhrase word overlap | best phrase hits ×3 | Best single phrase word overlap score |
| contentKeywords overlap | ×2 per hit | Bigram substring match against input |
| CueFrame pattern bonus | +2 per pattern | Cue patterns found as substring in callerPhrases |
| negativeKeyword | -1000 (disqualify) | Section excluded if negativeKeyword found in input |

**Minimum:** Score > 0 to be included. Top 5 by score are kept.

**Implementation:** Shallow-clones the container with only the top sections. `_buildContainerBlock()` sees 5 sections instead of 200+. No changes to KnowledgeContainerService needed.

**Fallback:** If no section scores > 0, Groq gets all sections unchanged (original behavior).

**qaLog persistence:** Gap filter metadata is written to qaLog: `gapFiltered`, `gapOriginalCount`, `gapFilteredCount`, `gapTopSections[]` — visible in Gaps & Todo page and Call Intelligence.

**Example impact:**
- Before: 204 sections → ~285K chars → Groq 5500ms → wrong/generic answer
- After: 204 → 5 sections → ~20K chars → Groq ~500ms → focused, correct answer

---

### ANSWER DELIVERY via `_handleKCMatch()`

When `match && match.container` after all gates:

1. **GATE 3.5 — Pre-Qualify Question (~2ms Redis)**
   - Fires if `targetSection.preQualifyQuestion.text` exists and is enabled, not already pending, not already answered this call.
   - Sets Redis key `kc-prequal:{companyId}:{callSid}` (TTL 4h).
   - Returns the pre-qualify question text. Path: `KC_PREQUAL_PENDING`.

2. **KCS.answer()** — Groq synthesis (see Section 7 below).

3. **If Groq returns `BOOKING_READY`:**
   - **GATE 4.5 — Upsell Chain (~2ms Redis)**
     - Fires if `targetSection.upsellChain.length > 0`, no chain already in progress, first offer has script text.
     - Sets Redis key `kc-upsell:{companyId}:{callSid}` (TTL 4h).
     - Returns first upsell's `offerScript`. Path: `KC_UPSELL_PENDING`.
   - If no upsell: Sets booking lane. Path: `KC_BOOKING_INTENT`.

4. **Normal answer:** Writes discoveryNotes (callReason, anchorContainerId, qaLog). Returns response. Path: `KC_DIRECT_ANSWER`.

5. **Compound booking intent:** If `_hasCompoundBookingIntent` was set at GATE 1, KC answers the question AND sets booking lane.

---

### GATE 4 — LLM Fallback (Claude ~800ms)

**Trigger:** `match` is still null after all gates.

1. Loads Engine Hub Behavior Card (tone/rules).
2. Builds `callContext` from discoveryNotes (caller name, issue summary, urgency).
3. Calls `callLLMAgentForFollowUp()` with `bucket: 'COMPLEX'`, `triggerSource: 'KC_ENGINE_FALLBACK'`.
4. If Claude returns response: Path `KC_LLM_FALLBACK`. Writes qaLog entry.
5. If Claude fails: **GRACEFUL ACK** — canned response from `company.knowledgeBaseSettings.fallbackResponse` or random `_gracefulAck()`. Path `KC_GRACEFUL_ACK`.

---

## 7. Answer Delivery — Fixed vs Groq

**File:** `services/engine/agent2/KnowledgeContainerService.js` → `answer()`

### Fixed Response Path (Groq bypassed)

Checked first:
1. **Per-section fixed** (`targetSection.useFixedResponse && targetSection.content`): Returns section `content` verbatim.
2. **Container-level fixed** (`container.useFixedResponse`): Returns first active section with content (sorted by order).

`{placeholder}` variables resolved. Booking CTA appended if applicable. `confidence: 1.0`. Audio pre-cached on save via `/audio-safe/` URLs.

**Content density target:** 35-42 words / ~180 chars.

### Groq Path (LLM synthesis)

- **Model:** `llama-3.3-70b-versatile`
- **MAX_TOKENS:** 180
- **TEMPERATURE:** 0.15
- **JSON mode:** enabled

**Content source:** `_buildContainerBlock()` prefers `groqContent` (up to 4000 chars) → falls back to `content`.

**With `targetSection`:** Groq reads only that one section. Fast, focused.
**Without `targetSection` (null):** Groq reads ALL active sections sorted by order. Synthesizes from whichever content is most relevant.

**Prompt assembly (system blocks injected in order):**
1. No-greeting rule (turn 1 only)
2. Container content (target section only, or ALL active sections if no target)
3. Call context (callReason, urgency, prior-visit from discoveryNotes)
4. Pre-qualify context (pricing tier, customer type)
5. Behavior card (compliance guardrails)
6. Tone & style directives
7. Booking instruction (offer_to_book / advisor_callback / smart close / none)

**Word limit:** container override → company default → 40 (hard default). Response style multiplier: concise (1x), balanced (1.5x), detailed (2x).

**Content density target for groqContent:** 25-150 words (source material for synthesis). Up to 4000 chars for complex topics.

---

## 8. Constants & Thresholds Reference

| Constant | Value | Location | Purpose |
|---|---|---|---|
| `UAP_CONFIDENCE_THRESHOLD` | 0.80 | KCDiscoveryRunner | UAP match must reach this for GATE 2.5 direct route |
| `ANCHOR_MATCH_THRESHOLD` | 0.90 | KCDiscoveryRunner | Logic 1: >=90% anchor words must be present |
| `CORE_MATCH_THRESHOLD` | 0.80 | KCDiscoveryRunner | Logic 2: cosine(callerCore, phraseCore) must reach this |
| `CUE_MIN_FIELD_COUNT` | 3 | KCDiscoveryRunner | GATE 2.4: minimum cue fields for routing |
| `GAP_MAX_SECTIONS` | 5 | KCDiscoveryRunner | Section gap pre-filter: max sections sent to Groq |
| `MIN_SIMILARITY` | 0.50 | SemanticMatchService | GATE 2.8: minimum cosine similarity |
| `MIN_THRESHOLD` | 8 | KnowledgeContainerService | GATE 3: minimum keyword score |
| `ANCHOR_FLOOR` | 24 | KnowledgeContainerService | GATE 3: safety net score for anchor container |
| Anchor multiplier | 3x | KnowledgeContainerService | GATE 3: anchor container score boost |
| contentKeywords weight | 0.9x | KnowledgeContainerService | GATE 3: keyword scoring weight |
| title weight | 0.8x | KnowledgeContainerService | GATE 3: title scoring weight |
| Bridge VERSION | 5 | BridgeService | Forces Redis rebuild on version mismatch |
| Trade index mem TTL | 5 min | CueExtractorService | In-memory trade index cache |
| Trade index Redis TTL | 1 hour | CueExtractorService | Redis trade index cache |
| PhraseReducer cache TTL | 5 min | PhraseReducerService | GlobalShare data cache |
| UAP phrase cache TTL | 1 hour | UtteranceActParser | In-process phrase/phonetic index cache |
| Groq MAX_TOKENS | 180 | KnowledgeContainerService | Max response tokens |
| Groq TEMPERATURE | 0.15 | KnowledgeContainerService | Response creativity |
| Groq model | llama-3.3-70b-versatile | KnowledgeContainerService | LLM model |
| Embedding model | text-embedding-3-small | SemanticMatchService | OpenAI embedding model |
| Embedding dimensions | 512 | SemanticMatchService | Vector size |
| `initialTimeout` default | 7 sec (schema min 3 / max 15) | v2Company schema `speechDetection` | Gather initial wait for any speech — admin-tunable via Agent 2.0 UI |
| `maxSilentRelistens` default | 2 (schema min 0 / max 5) | v2Company schema `agent2.discovery` | Silent re-listens on empty input before prompting |
| Narrative length guard | >20 words | KCDiscoveryRunner | Blocks booking intent on long narratives with only filler affirmatives |
| Narrative trailing conjunction | >6 words | KCDiscoveryRunner | Blocks booking intent when utterance ends in and/but/so mid-story |
| LAP trailing content threshold | >4 substantive words | LAPService | Above this, LAP does NOT intercept — real question/content follows hold phrase |

---

## 9. Key Files Reference

### Core Pipeline
| File | Purpose |
|---|---|
| `services/engine/kc/KCDiscoveryRunner.js` | Main gate sequence orchestrator |
| `services/engine/kc/UtteranceActParser.js` | 6-pass phrase matcher (GATE 2.5) |
| `services/engine/kc/BridgeService.js` | Phrase index builder + Redis cache |
| `services/cueExtractor/CueExtractorService.js` | 8-field pattern extractor (GATE 2.4) |
| `services/engine/kc/SemanticMatchService.js` | Embedding similarity matcher (GATE 2.8) |
| `services/engine/agent2/KnowledgeContainerService.js` | Keyword scoring (GATE 3) + answer delivery |
| `services/engine/kc/KCBookingIntentDetector.js` | Booking intent detector (GATE 1) |
| `services/engine/kc/KCTransferIntentDetector.js` | Transfer intent detector (GATE 0.5) |

### Supporting Systems
| File | Purpose |
|---|---|
| `services/phraseIntelligence/PhraseReducerService.js` | GlobalShare data access (cue patterns, trade vocabs, synonyms) |
| `services/discoveryNotes/DiscoveryNotesService.js` | Redis-backed live call state |
| `services/engine/EngineHubRuntime.js` | Company-level engine configuration |
| `models/CompanyKnowledgeContainer.js` | KC container + section schema |
| `models/AdminSettings.js` | GlobalShare (phraseIntelligence) schema |

### Admin & Diagnostics
| File | Purpose |
|---|---|
| `routes/admin/kcGaps.js` | Gaps & Todo API (qaLog aggregation) |
| `public/agent-console/todo.html` / `todo.js` | Gaps & Todo admin page |
| `public/agent-console/services-item.html` | KC admin UI (sections, phrases, Re-score, etc.) |
| `public/agent-console/globalshare.html` | GlobalShare admin (cue patterns, trade vocabs) |
| `routes/admin/calibration.js` | UAP Calibration Dashboard |
| `scripts/diag-cue-extractor.js` | CueExtractor diagnostic (run on Render Shell) |

---

## Pipeline Execution Order Summary

```
GATE 0.5   Transfer intent       sync, ~0ms        → KC_TRANSFER_INTENT
GATE 0.7   Pending PQ/Upsell     Redis, ~2ms       → KC_PREQUAL_PENDING / KC_UPSELL_PENDING
GATE 1     Booking intent         sync, ~0ms        → KC_BOOKING_INTENT
[Load]     Notes + Containers     parallel, ~20ms
[Reject]   Rejection detector     sync, ~0ms
GATE 2.4   CueExtractor          sync, <1ms        → CUE_EXTRACT / CUE_PROFILE_SCAN
GATE 2.5   UAP Layer 1           sync, <1ms        → UAP_LAYER1
  Logic 1  Word Gate              sync, <1ms
  Logic 2  Core Confirmation      async, ~50ms
GATE 2.8   Semantic Match         async, ~50ms      → SEMANTIC
GATE 2.9   Negative Keyword Check sync, <1ms        → NEGATIVE_KEYWORD_BLOCK (suppress)
GATE 3     Keyword Scoring        sync, <1ms        → (keyword match)
[Diag]     Section Gap            sync, ~0ms        → KC_SECTION_GAP (log only)
GATE 3.5   Pre-Qualify            Redis, ~2ms       → KC_PREQUAL_PENDING
[Answer]   KCS.answer() Groq      async, ~500ms     → KC_DIRECT_ANSWER
GATE 4.5   Upsell Chain           Redis, ~2ms       → KC_UPSELL_PENDING
GATE 4     LLM Fallback Claude    async, ~800ms     → KC_LLM_FALLBACK
[Fallback] Graceful ACK           sync, ~0ms        → KC_GRACEFUL_ACK
```

**The system is self-improving:** More callerPhrases → better UAP routing → fewer LLM fallbacks → faster, cheaper, more accurate responses. Fuzzy Recovery catches edge cases. Calibration Dashboard shows where the gaps are. Gaps & Todo page shows exactly which utterances fell through and why.

---

## 10. Turn 1 Preamble Stripping (April 2026)

**Problem:** On Turn 1, callers front-load their utterance with greetings, self-intros, filler words, and conversational context. Example:

> "Hi John. This is Mark. Um you guys been here a few times and I'm still having air conditioning problems."

The intent clause is "I'm still having air conditioning problems" but KC routing scores the FULL 19-word utterance, causing generic words like "air conditioning" to bias toward the wrong container.

**Solution:** `Turn1Engine._stripPreamble(input)` — sequential regex chain removes:
1. Greeting + addressee ("Hi John.")
2. Self-introduction ("This is Mark.")
3. Filler words ("Um", "Uh", "So")
4. Prior-visit context ("you guys been here a few times and")

**Safety:** If stripping leaves < 3 words, the original input is returned unchanged.

**Wiring:** `CALLER_WITH_INTENT` lane passes `cleanedInput` to `KCDiscoveryRunner.run()` while the original input is preserved for `_composePrefix()` (empathy detection needs the full utterance). Event `TURN1_PATH` includes `preambleStripped`, `originalLen`, `cleanedLen`, `cleanedInput` when stripping occurred.

**File:** `services/engine/turn1/Turn1Engine.js`

---

## 11. Booking Name-Answer Escape Hatch (April 2026)

**Problem:** During COLLECT_NAME, callers answer with trailing context:

> "Okay, my name is Mark. I already told you that before."

`parseName()` correctly extracts "Mark" → step advances. But 12 words triggers `_isLikelyOffTopic()` (threshold = 6 words), UAP matches trailing content → `uapHasAnyMatch = true` → both conditions conspire to trigger KC digression → name is rolled back → caller hears a KC response → "I didn't catch your name" on next turn.

**Solution:** Name-answer escape hatch in BookingLogicEngine, positioned before the UAP signal gates:

```
if (advanced && step === COLLECT_NAME):
  - input starts with name-answer pattern ("my name is", "I'm", "this is", etc.)
    AND no "?" present → return stepResult (trust the name extraction)
  - OR parseName captured a real firstName (≥ 2 chars)
    AND no "?" present → return stepResult
```

**Event:** `BK_NAME_ANSWER_ESCAPE` — includes rawInput + captured firstName for audit.

**File:** `services/engine/booking/BookingLogicEngine.js`

---

## 12. KC Gaps Turn 1 Visibility Fix (April 2026)

**Problem:** `kcGaps.js` filtered out ALL Turn 1 qaLog entries by default (`turn > 1`). This masked real KC_SECTION_GAP events that occurred on Turn 1 — container matched but no section handled the caller's utterance. These are real routing failures, not expected Turn 1 noise.

**Solution:** Changed the turn filter to use `$or`:
- Turn > 1 events: always shown (as before)
- Turn 1 KC_SECTION_GAP events: always shown (these are real failures)
- Turn 1 KC_LLM_FALLBACK / KC_GRACEFUL_ACK: hidden by default, shown with `?turn1=1`

**File:** `routes/admin/kcGaps.js`

---

## 13. Booking Intent Guards — Narrative Filter + noAnchor Semantics (April 2026)

**File:** `services/engine/kc/KCDiscoveryRunner.js` (~line 820 for narrative filter, ~line 2250 for noAnchor callReason guard)
**File:** `services/engine/agent2/KnowledgeContainerService.js` (~lines 992 + 1047 for noAnchor bookingAction guard)
**Commit:** `5cf948f8e` (April 16, 2026)

### 13.1 — Narrative Filter (3 Guards) at GATE 1

**Problem:** Callers narrating their situation were being misread as booking intent. Example: "yeah you guys were here last time and Tony fixed the motor but now water is leaking" — the trailing "and" + length + affirmative "yeah" caused `isBookingIntent()` to fire, hijacking a real HVAC question into the booking flow.

**Solution:** Before the booking intent check, compute `_inputIsNarrative`. If true → skip booking intent, fall through to KC routing.

#### Guard 1 — NARRATIVE_INDICATORS regex (past-tense / story words)

Compiled once as a large alternation. Captures ~45 patterns grouped by subject:
- **First-person past:** `i came`, `i was `, `i had `, `i have `, `i noticed`, `i went`, `i tried`, `i called`, `i got `, `i walked`, `i heard`, `i saw`, `i checked`, `i looked`, `i turned`, `i woke`
- **Third-person past:** `it was `, `it started`, `it happened`, `it broke`, `it stopped`, `it keeps`
- **Quotatives:** `you guys `, `you said`, `you told`, `you were`, `they said`, `they told`, `he said`, `she said`
- **Time references:** `last time`, `yesterday`, `this morning`, `the other day`, `couple days`, `few days`, `a while`
- **Arrival verbs:** `when i got`, `when i came`, `when we`, `came home`, `got home`, `walked in`

**Hit:** Any substring match sets `_inputIsNarrative = true`.

#### Guard 2 — Trailing Conjunction

**Condition:** utterance has >6 words AND ends in one of: `and`, `but`, `so`, `because`, `then`, `or`, `while`, `until`, `when`, `if`, `though`.

**Rationale:** Mid-sentence cutoff during a story. The trailing conjunction is the tell.

#### Guard 3 — Length Guard with Filler Affirmatives

**Condition:** utterance has >20 words AND the only booking-intent signal is a leading filler affirmative (`yeah`, `yes`, `okay`, `sure`, `alright`, `mhm`).

**Rationale:** "yeah so I came home and my AC is not working and you guys changed the motor last month…" has "yeah" that would normally trigger hedged-yes booking routing, but 21+ words of narrative content overrides.

### 13.2 — noAnchor Container Semantics

Meta-conversation containers (Recovery, Price Objections, Scheduling & Availability, Warranty & Guarantee, Appointment Management) are marked `noAnchor = true` at the container level. This flag triggers three defensive behaviors:

| Behavior | Location | Purpose |
|---|---|---|
| **No booking CTA** | KnowledgeContainerService.js L992 (Fixed), L1047 (Groq) | `_bookingAction = container.noAnchor ? 'none' : ...` — prevents Recovery KC answer from appending "would you like to schedule?" which a caller then agrees to, causing false booking intent. |
| **No callReason write** | KCDiscoveryRunner.js L2253, L2277, L2308 (3 `_writeDiscoveryNotes` sites) | `...(!container.noAnchor ? { callReason: containerTitle } : {})` — a Recovery match mid-call does NOT overwrite the real call reason (e.g., "No Cooling"). |
| **No anchor container set** | KCDiscoveryRunner.js L2256, L2280, L2311 | `...(!container.noAnchor ? { anchorContainerId: containerId } : {})` — meta-containers never become the 3× scoring anchor. |

**The cascade these guards break:**
1. Caller asks an off-topic question → Recovery KC matches.
2. Old behavior: Recovery answer appended "would you like to schedule an appointment?"
3. Caller says "okay" → GATE 1 fired KC_BOOKING_INTENT.
4. Old behavior: callReason was overwritten to "Conversational Recovery", poisoning downstream routing and call reports.

All three guards together make noAnchor containers stateless, non-polluting, and non-triggering for booking intent.

---

## 14. Timing & Silence Layer — All UI, No Hardcoded (April 2026)

**File:** `routes/v2twilio.js`
**Schema:** `models/v2Company.js` → `aiAgentSettings.agent2.speechDetection` + `aiAgentSettings.agent2.discovery`
**UI:** `public/agent-console/agent2.html` → Speech Detection card + Personality System → Conversation Patterns
**Commits:** `7617e43d3` + `36475623d` + `79cc6eb05` + `0675caf9e`

### 14.1 — speechDetection Settings (Read Pattern)

**Helper:** `_getSpeechDetection(company)` — always prefers `agent2.speechDetection`, falls back to legacy `voiceSettings.speechDetection`.

```javascript
company.aiAgentSettings?.agent2?.speechDetection
  || company.aiAgentSettings?.voiceSettings?.speechDetection
  || {};
```

**Fields (all UI-configurable):**

| Field | Default | Range | Purpose |
|---|---|---|---|
| `initialTimeout` | 7 sec | 3-15 | Gather initial wait for ANY speech before firing `actionOnEmptyResult` |
| `speechTimeout` | `'auto'` or number | — | End-of-speech silence trigger |
| `bargeIn` | false | — | Allow caller to cut off agent's speech |
| `enhancedRecognition` | true | — | Twilio enhanced ASR |
| `speechModel` | `phone_call` | — | Twilio speech model hint |

### 14.2 — gatherTimeout — Admin-Configurable (not hardcoded)

**Read order:**
1. `speechDet.initialTimeout` (admin UI)
2. Fallback to 7 if missing

```javascript
const adminInitialTimeout = speechDet.initialTimeout ?? 7;
const gatherTimeout = isPatienceMode ? patienceTimeout : adminInitialTimeout;
```

**⚠️ Ordering rule (TDZ lesson from commit `0675caf9e`):** `speechDet` is declared with `const`. It MUST be declared BEFORE any code that reads `speechDet.initialTimeout` (patience mode block, gatherTimeout computation). Violating this causes `ReferenceError: Cannot access 'speechDet' before initialization` → COMPUTE_CRASH on every call.

### 14.3 — Patience Mode

**Trigger:** Caller said "hold on", "one minute", "let me grab" (detected by LAP hold action). A Redis key marks the call as in patience mode.

**Effect:** `patienceTimeout` (UI-configurable on Agent 2.0 panel, default longer than `initialTimeout`) replaces the normal `gatherTimeout`. Typical value: 20-30 sec vs normal 7 sec.

**Reset:** Any speech detection or timer expiration clears patience mode.

### 14.4 — Ghost Turn Guard

**File:** `routes/v2twilio.js` (~line 5908)

**Problem:** If Gather's initial timeout fires with NO speech AND a pending follow-up question is active, running the full pipeline on empty input wastes compute and often triggers KC_LLM_FALLBACK incorrectly.

**Fix:** Detect this state and silently re-open the Gather listener with the same pending question, preserving session state.

```javascript
const ghostSpeechDet = _getSpeechDetection(company);
// ... re-open Gather with ghostSpeechDet.initialTimeout / bargeIn / enhanced / speechModel
```

**Bug fix record (2026-04-16):** `ghostSpeechDet` was never declared — every ghost turn silently crashed with `ReferenceError`, caught by outer try/catch and routed to COMPUTE_CRASH. Now declared explicitly.

### 14.5 — Silent Re-Listen Guard (Empty Input, No Pending Question)

**File:** `routes/v2twilio.js` (~line 6038)

**Problem:** When Gather timeout fires with empty speech AND no pending question, the prior logic ran the full pipeline on `""` which either crashed or generated KC_GRACEFUL_ACK. Neither is what a human expects — humans expect the agent to keep listening.

**Fix:** Track `consecutiveEmptyTurns` on call state. Up to `maxSilentRelistens` (UI-configurable, default 2, range 0-5), silently re-open the listener without speaking. After the limit, fall through to the pipeline which can prompt.

```javascript
const consecutiveEmpties = (callState?.agent2?.discovery?.consecutiveEmptyTurns || 0) + 1;
const maxSilentRelistens = company?.aiAgentSettings?.agent2?.discovery?.maxSilentRelistens ?? 2;

if (consecutiveEmpties <= maxSilentRelistens) {
  // silently re-listen, return 'silent_relisten' voiceProviderUsed
}
// Reset counter on any real speech
```

**Schema:** `v2Company.js` line 4589 — `maxSilentRelistens: { type: Number, default: 2, min: 0, max: 5 }`.

### 14.6 — responseDelay + thinkingTime (Previously Dead Code, Now Wired)

**Source:** `company.aiAgentSettings.agent2.personalitySystem.conversationPatterns`
- `responseDelay`: `'immediate' | 'brief' | 'thoughtful'`
- `thinkingTime`: numeric seconds, clamped 0-3

**Effect:** Before the agent's response, TwiML inserts `<Pause length="thinkingTime"/>` when `responseDelay !== 'immediate'` AND `thinkingTime > 0`. Gives the caller a human-like breath between question and answer.

**Previously:** Fields existed in the schema and UI but zero references in v2twilio.js → UI changes did nothing. Now fully wired.

### 14.7 — Crash Recovery Messages (UI-Configured, Not Hardcoded)

**Helper:** `getRecoveryMessage(company, key)` where `key ∈ { 'generalError', 'timeoutError', 'routingError', ... }`.

**Crash paths now wired (commit `79cc6eb05`):**
1. COMPUTE_CRASH (~line 7585): catastrophic pipeline failure → reads `generalError`
2. Bridge crash (~line 4652): KCDiscoveryRunner wrapper failure → reads `generalError`
3. ROUTE_CRASH (~line 8107): Express route exception → reads `generalError`

**Pattern:**
```javascript
const _rcvText = (await getRecoveryMessage(company, 'generalError').catch(() => null))
  || 'I apologize for the interruption. Could you repeat that?';
```

**Rule (multi-tenant principle):** No hardcoded business strings. Every user-facing message the caller hears on a failure path is UI-configurable. The hardcoded fallback exists ONLY as a last-resort safety net when the company object or recovery config is unavailable.

### 14.8 — Timing Fields Added to Webhook Reports

Webhook timing breakdown now logs `stateLoadMs`, `audioBlockMs`, `twimlBuildMs` alongside `companyLoadMs`, `coreRuntimeMs`, `eventFlushMs`, `totalMs`. Fills the previously-mystery gap between core runtime and total webhook latency. Visible in WEBHOOK_TIMING trace and call reports.

---

## 15. LAP — ListenerActParser (Pre-Pipeline Gate) (April 2026)

**File:** `services/engine/lap/LAPService.js`
**Pipeline position:** Runs BEFORE KCDiscoveryRunner, in the `/v2-agent-respond` handler in v2twilio.js.
**Commit:** `f03f50148` (trailing content guard, April 16, 2026)

### Purpose

LAP is an attention gate. It catches conversational mechanics (hold requests, repeat requests) before they pollute KC routing. Zero LLM. Pure keyword match with a safety guard.

### Entry Config

On the company document:
- `systemKeywords[]` — platform-wide defaults (e.g., "hold on", "one moment", "repeat that")
- `customKeywords[]` — company-specific overrides

Each entry has `{ phrase, action }` where `action` is one of:

| Action | Behavior |
|---|---|
| `respond` | Return a canned acknowledgment (e.g., "Sure, take your time") |
| `hold` | Set patience mode flag, extend silence timeout |
| `repeat_last` | Read `CallSummary.liveProgress.lastResponse` and play it back |

### match() Logic

Iterates entries in order. For each:
1. Normalize caller input and entry phrase.
2. Check phrase substring match.
3. **Trailing content guard** (applies to `respond` and `hold`, NOT `repeat_last`):
   - Extract trailing content after the matched phrase.
   - Strip fillers: `um`, `uh`, `like`, `you know`, `well`, `so`, `and`, `but`, `oh`, `hmm`, `erm`, `ah`.
   - Check for question words (`what`, `how`, `why`, `when`, `where`, `which`, `who`, `does`, `do you`, `can you`, `can i`, `is it`, `is there`, `is that`, `how much`, `how long`, `tell me`, `explain`) OR a literal `?`.
   - Check for >4 substantive trailing words (after filler strip).
   - **Either condition → SKIP this entry** (fall through to next LAP entry or to KC pipeline).

### Why repeat_last is Exempt

`repeat_last` is often phrased as "can you repeat that" with no legitimate trailing content worth preserving. Adding a guard would over-trigger and prevent repeat requests from firing.

### Why the Trailing Guard Exists

**Before the guard:** Caller says "wait a minute, how much is a service call?" → LAP matched "wait a minute" → returned hold action → the real pricing question was swallowed, never reached KC.

**After the guard:** Trailing content "how much is a service call" has question word `how much` → LAP skips this entry → KC handles the pricing question. The hold gesture is ignored (which is correct — the caller wasn't really asking the agent to hold, they were using "wait a minute" as a verbal tic).

### Output

Returns `{ matched: true, action, response?, entry }` or `{ matched: false }`.
- `action='respond'` → route handler speaks `response`, closes turn.
- `action='hold'` → route handler sets patience mode, re-opens listener with longer timeout.
- `action='repeat_last'` → route handler reads `liveProgress.lastResponse` and plays it.
- `matched=false` → pipeline continues to KCDiscoveryRunner.

---

## 16. Answer-From-KB LLM Posture + Enriched callContext (April 2026)

**Files:** `services/engine/kc/KCDiscoveryRunner.js` (`_buildCallContext` helper), `services/engine/agent2/Agent2DiscoveryRunner.js` (`callLLMAgentForFollowUp`), `config/llmAgentDefaults.js` (`composeSystemPrompt`)
**Commit:** `a77796b05`

### The Problem This Solves

When KC routing missed and the conversation fell to `KC_LLM_FALLBACK`, Claude produced non-directive deflections: *"Sounds good. Let me check on that for you."* Then dead air. Caller waited. Call failed.

Root causes:
1. Prompt posture was DISCOVERY/ROUTE — Claude was told to *never quote prices* and *hand off*, not to *answer*.
2. `callContext` carried only `firstName + callReason + urgency`. No prior visits, no staff names, no repeat-issue signal → no material for an acknowledgment.
3. No explicit rule forbidding "let me check" as final words.

### 16.1 — `_buildCallContext()` Helper (KCDiscoveryRunner.js)

Packages `discoveryNotes` + pre-warmed `callerProfile` (from `CallerRecognitionService`) into a rich context object consumed by the LLM.

**Fields surfaced** (all optional — omitted if absent):

| Field | Source | Purpose |
|---|---|---|
| `caller.firstName` | `entities.firstName` / `temp.firstName` / `callerProfile.lastConfirmed.firstName` | Name for acknowledgment |
| `issue.summary` | `notes.callReason` (fallback: `notes.objective`) | What caller is calling about |
| `urgency.level` | `notes.urgency === 'high'` only | High-urgency flag (noise filtering) |
| `priorVisits[]` | `callerProfile.lastCallDate`, `lastCallReason`, `lastConfirmed.staffInvolved` | "Tony was here 32 days ago for No Cooling" |
| `visitCount` | `callerProfile.visitCount` (>1 only) | Returning-customer warmth |
| `repeatIssue` | `callerProfile.repeatIssueDetected` + `repeatIssueReason` | Caller has called about same issue 2+ times |
| `rejectedTopics[]` | `notes.rejectedTopics` (last 5) | Don't re-offer what caller declined this call |
| `recentQA[]` | `notes.qaLog` (last 2 meaningful pairs) | Don't repeat yourself |
| `behaviorBlock` | `EngineHubRuntime.formatStandaloneBCForPrompt(discoveryFlowBC)` | Engine Hub discovery_flow BC rules |

### 16.2 — `mode='answer-from-kb'` in composeSystemPrompt

New `mode` parameter on `composeSystemPrompt(settings, channel, mode)`:

| Mode | Used By | Posture |
|---|---|---|
| `'discovery'` (default) | triggerFallback, consent follow-up, no-match discovery | DISCOVERY + CONSENT FUNNEL. Never quotes prices. Hands off. |
| `'answer-from-kb'` | KC_LLM_FALLBACK (the final save) | ANSWER-FIRST. acknowledge → reflect → answer → directive. May quote prices IF in KB. |

**The answer-from-kb purpose block replaces:**
```
"Your PRIMARY PURPOSE is DISCOVERY — find out why the customer is calling..."
"You do NOT quote prices."
```

**With:**
```
"Your PRIMARY PURPOSE right now is to ANSWER THE CALLER using the KNOWLEDGE BASE."
"Find it. Deliver it clearly. Do NOT defer. Do NOT say 'let me check' and stop —
that creates dead air the caller cannot forgive."

"RESPONSE PATTERN — MANDATORY:
  1. ACKNOWLEDGE using CALL CONTEXT (prior visits, staff, repeat issues)
  2. ANSWER directly from the KNOWLEDGE BASE
  3. DIRECTIVE — end with ONE natural yes/no question

ABSOLUTE RULE — NEVER end a response with 'let me check' as the final words."
```

**Conditional `noPricing` guardrail** (mode-aware):
- `'discovery'`: *"NEVER quote prices, fees, or estimates."*
- `'answer-from-kb'`: *"NEVER INVENT prices. You MAY state prices IF they appear in the KNOWLEDGE BASE."*

### 16.3 — Enriched CALL CONTEXT Block (Agent2DiscoveryRunner.js)

`callLLMAgentForFollowUp` now accepts `mode` parameter and renders enriched fields into the prompt:

```
=== CALL CONTEXT (already established) ===
Caller name: Mark
Issue: No Cooling
Last visit: 32 days ago — No Cooling (technician: Tony)
USE THIS: open with an acknowledgment that references this prior visit when relevant.
Visit count: 3 (returning customer — treat warmly)
REPEAT ISSUE DETECTED: caller has called about "no cooling" multiple times.
Acknowledge the frustration before proposing the solution.
Do NOT re-offer these (already declined this call): Maintenance Plan
Recent conversation turns (most recent last):
  caller: "what about the motor?"  → you said: "We can warranty that up to…"
Do NOT repeat yourself — build on what you already said.
=== END CALL CONTEXT ===
```

### 16.4 — Wiring Summary

- **KC_LLM_FALLBACK site** (`_handleLLMFallback` in KCDiscoveryRunner.js ~line 2582): passes `callContext: _buildCallContext(notes, behaviorBlock)` and `mode: 'answer-from-kb'`.
- **`_handleKCMatch` secondary fallback** (~line 2166): now propagates `notes` (previously lost).
- **triggerFallback / consent / no-match paths**: unchanged — still use `mode: 'discovery'` (default).

### 16.5 — What This Replaces

**Before** (actual Turn 2 response from call CA951d50a2...):
> Caller: *"Do I have to pay for another service call?"*
> Agent: *"Sounds good. As a returning customer, let me check on that for you."* [dead air]

**After** (target pattern — requires Diagnostic Fee KC content to include return-visit sections):
> Caller: *"Do I have to pay for another service call?"*
> Agent: *"I hear you, Mark — I see Tony was out 32 days ago for the motor repair. Since that's within our recent-service warranty window, the return-visit diagnostic is waived. Want me to get someone out today to look at the water leak?"*

### 16.6 — What's Still Needed for the Full Vision

Changes A+B+C unblock the acknowledge-reflect pattern. Still open (future work):
- **Cross-container KC recovery**: when anchor container's Section GAP hits, re-score across all containers WITHOUT anchor multiplier. Would route "service call fee" question from anchored No Cooling → Diagnostic Fee container.
- **KC semantic ranking** before injection into LLM prompt (~~currently all enabled cards are dumped in verbatim~~ ✅ shipped in §17 as `_rankTopKCSections`).
- **`groqContent` in `composeSystemPrompt`**: ~~currently only basic `card.content` is injected~~ ✅ shipped in §17 — composeSystemPrompt now prefers `groqContent` when building kcContext.
- **Bridge phrase library** — configurable per-company "hold while I check" phrases. (Still open.)
- **Consent funnel validator** — post-generation check that response ends with yes/no. (Still open.)

---

## 17. Agent Studio + Cross-Container KC Recovery (April 2026)

**Commits:** `c00e83e2d` (Phase 1 engine) + `ec1f910b5` → `59c18e1bf` (C.1-C.6 UI consolidation).
**Plan:** `memory/agent-studio-rebuild.md` (full execution record).
**Architecture:** `memory/agent-studio-architecture.md` (the 3-page mental model + schema + how to extend).

### 17.1 — Cross-Container KC Recovery (engine)

When KC routing hits a Section GAP (container matched but no specific section), the pipeline now attempts a RESCUE before falling into the gap pre-filter or LLM fallback. This fixes the anchor-overweight problem that pinned conversations to the wrong container.

**File:** `services/engine/kc/KCDiscoveryRunner.js` (~line 1647)

**Sequence at Section GAP:**
1. Matched container is usually the anchored one (3× boost).
2. Re-run `KCS.findContainer(scorableContainers, userInput, { ...callContext, anchorContainerId: null })` — NO anchor multiplier.
3. If the rescue winner is a DIFFERENT container AND has a real section match (`bestSection !== null`) → SWAP.
4. Log `KC_SECTION_GAP_RESCUED` + qaLog entry.
5. Route through `_handleKCMatch` normally with the correct container.

**Example it solves:**
- Anchored on "No Cooling" (HVAC question in Turn 1).
- Turn 4: caller asks *"Do I have to pay for another service call?"*
- Anchor boost pins match to No Cooling — but no section covers return-visit fees.
- Rescue: scores containers without anchor → **Diagnostic Fee** wins → routes there → real answer.

### 17.2 — `_rankTopKCSections` Helper

**File:** `services/engine/kc/KCDiscoveryRunner.js` (~line 385)

Cross-container section ranker. Reuses `_scoreSectionsForGap` scoring (label×4, callerPhrase×3, contentKeywords×2, cue-bonus) but flattens across ALL containers to pick the global top N (default 5). Excludes `noAnchor` meta-containers (Recovery, etc.) — their content is conversational mechanics, not knowledge.

Used at the LLM fallback site to inject real KC knowledge into Claude's prompt (instead of leaving Claude blind). Result: LLM fallback now produces answers sourced from KC, not generic platitudes.

### 17.3 — `kcContext` Parameter on `composeSystemPrompt`

**File:** `config/llmAgentDefaults.js`

```javascript
composeSystemPrompt(settings, channel, mode, kcContext)
```

New 4th parameter `kcContext = [{ container, section, score }]`. When provided, renders as:

```
=== KNOWLEDGE BASE (top matches for this caller's question) ===
--- Diagnostic Fee / Fee For Return Visit After Recent Service ---
[groqContent — up to 4000 chars]
--- No Cooling / No Cooling With Water Leaking In Garage ---
[groqContent]
=== END KNOWLEDGE BASE ===
Use the KNOWLEDGE BASE above to answer. If the answer is in there, give it confidently.
```

Prefers `section.groqContent` (deep, up to 4000 chars) over `section.content` (short fixed, 35-42 words). Falls back gracefully.

Legacy `settings.knowledgeCards[]` was REMOVED in commit `ec1f910b5` — KC containers are the single source of truth.

### 17.4 — Agent Studio Consolidation (UI)

Before the rebuild, admin had to navigate between `services.html` (knowledge) and `llmagent.html` (persona/guardrails/behavior) to configure one agent. **`llmagent.html` has been deleted.** All agent configuration now lives on `services.html`, which is the **Agent Studio** — 5 tabs:

| Tab | What it configures | Schema path |
|---|---|---|
| **Knowledge** (default) | KC containers (unchanged — original services.html) | `CompanyKnowledgeContainer` collection |
| **Behavior** | Persona, guardrails, behavior rules | `aiAgentSettings.llmAgent.{persona, guardrails, behaviorRules}` |
| **Intake** | Turn-1 entity extraction | `aiAgentSettings.llmAgent.intake` |
| **Model** | LLM master switch, primary model, activation, handoff | `aiAgentSettings.llmAgent.{enabled, model, activation, handoff}` |
| **System Prompt** | Live preview of rendered system prompt | (read-only — calls `preview-prompt` route) |

**Implementation:** 4 IIFE modules at end of services.html's `<script>` block. Hash-persistent tab state (`#tab=behavior`), debounced autosave (400ms), shared floating save indicator.

**API routes (reused):**
- `GET /:companyId/llm-agent/config` — read merged config
- `PATCH /:companyId/llm-agent/config` — partial deep-merge save
- `POST /:companyId/llm-agent/preview-prompt` — renders `composeSystemPrompt` with live data
- `POST /:companyId/llm-agent/ping` + `/ping-groq` — provider health checks
- `POST /:companyId/llm-agent/test-conversation` — test harness

**Clean sweep commit (`59c18e1bf`):**
- Deleted `public/agent-console/llmagent.html` (2175 lines)
- Deleted `public/agent-console/llmagent.js` (1780 lines)
- Deleted `POST /llm-agent/scrape-url` (dead website scraper)
- Deleted `GET /llm-agent/sync-triggers` (dead trigger bridge)
- Removed `cheerio` + 3 trigger model imports (unused after route deletion)
- Removed nav card in `index.html` + case handler in `index.js`
- Updated all forward pointers in `discovery.js`, `models/v2Company.js`, `config/llmAgentDefaults.js`
- Zero legacy fallback code remaining. Git history is the ghost.

**Multi-tenant principle preserved:** storage path `aiAgentSettings.llmAgent` unchanged. Existing company configs load without migration.

### 17.5 — What's Still Open

- **Bridge phrase library** — configurable per-company "hold while I check" phrases (currently the LLM is instructed via prompt to never end with "let me check" but there's no admin UI for custom bridge phrases)
- **Consent funnel validator** — post-generation check that response ends with yes/no (currently a prompt instruction, not a runtime enforcement)
- **No Cooling repeat-visit sections** — the content gap from April 17 gap report (9 SECTION_GAP events, now mostly rescued by §17.1 cross-container recovery, but authoring purpose-built repeat-visit sections would still improve quality)

---

## 18. Speculative Pre-Warm — UAP Runs While Caller Is Speaking (April 2026)

**Files:**
- `services/speculative/SpeculativeLLMService.js` — core logic
- `routes/v2twilio.js` ~line 8190 — `POST /v2-agent-partial/:companyId` partial handler
- `routes/v2twilio.js` Twilio Gather config — sets `partialResultCallback`

**This is the single most important piece of the UAP architecture to understand. It is what lets the system feel instant to callers.** Every other section (1-17) documents the pipeline. This section explains WHERE and WHEN the pipeline fires.

### The Misconception (Do Not Repeat)

A casual reading of KCDiscoveryRunner suggests the pipeline runs once per turn on the final STT transcript. That is WRONG. It runs multiple times per turn:
- Once per partial STT transcript during speaking (speculative)
- Once more on the final transcript IF speculative didn't match

A new session reading only KCDiscoveryRunner will miss this. Read this section first.

### How It Works (Verified From Code)

**Setup — Twilio Gather's `partialResultCallback`:**
```javascript
twiml.gather({
  input:                 'speech',
  speechTimeout:         'auto',
  partialResultCallback: `https://${host}/api/twilio/v2-agent-partial/${companyID}`,
  ...
});
```
Twilio streams partial transcripts to this endpoint every ~300ms as the caller speaks.

**The partial handler:**
```javascript
// routes/v2twilio.js — POST /v2-agent-partial/:companyId
router.post('/v2-agent-partial/:companyId', async (req, res) => {
  res.sendStatus(200);   // ACK Twilio immediately — non-blocking
  runSpeculativeLLM(CallSid, companyId, StableSpeechResult)
    .catch(() => {});    // Fire-and-forget — caller never blocked
});
```

**`runSpeculativeLLM()` (SpeculativeLLMService.js):**
1. Sanity checks: callSid + companyId + non-empty partialText.
2. Loads callState from Redis.
3. Loads company (lean).
4. Calls `CallRuntime.processTurn(aiAgentSettings, callState, partialText, {...})` — **the FULL pipeline. Every gate. Every match. Groq synthesis. Claude fallback if needed.**
5. Stores result in Redis: `speculative:result:{callSid}` with TTL=8s.
6. Does NOT flush event buffer. Does NOT write callState back. Caller never blocked.
7. Best-effort — any error is swallowed.

**Stability requirement:** Twilio fires partial callbacks on unstable (interim) and stable (confirmed) partial transcripts. Speculative runs only on stable partials (`StableSpeechResult` flag from Twilio), otherwise we'd thrash on every word boundary.

**Final handler consumption — `checkSpeculativeResult()`:**
When `POST /v2-agent-respond/:companyID` fires with the final transcript:
```javascript
const preWarm = await checkSpeculativeResult(callSid, finalText, expectedTurnCount, redis);
if (preWarm?.response) {
  // HIT — use cached response directly, skip the pipeline entirely.
  return preWarm;
}
// MISS — run the pipeline fresh on final transcript.
```

**The 75% token-containment threshold:**
```javascript
function _tokenContainment(partial, final) {
  // What fraction of the partial's tokens appear in final?
  // Partial is always a prefix of final → containment ≈ 1.0 on normal flows.
}
```
If `containment >= 0.75` → cache HIT → pre-computed response is used.
If `containment < 0.75` → cache DISCARDED → pipeline runs fresh on final.

Rationale: the caller may change their mind mid-utterance. Partial at 2-second mark: *"what's your pricing"* → pipeline answers pricing. Caller finishes at 5 seconds: *"never mind, I'll call back"* → low containment → pre-warm discarded → pipeline correctly handles the "never mind" on final.

### Why This Matters Economically

Every partial triggers a full pipeline run. For a 5-second caller utterance with 3 stable partials, `runSpeculativeLLM()` fires 3 times. On complex turns, this can include Groq AND Claude calls.

**Operational metric to monitor:** speculative hit rate (% of turns where `checkSpeculativeResult` returns a cached response). If hit rate is high (>40%), the economics are excellent — you save ~1-2s of perceived latency per call at modest extra API cost. If hit rate is low (<20%), you're burning Groq/Claude spend on speculation that gets discarded. Tune by:
- Raising the stability bar (only run on fully stable partials, not interim)
- Adding a "partial confidence gate" — skip speculation if partial is too short or too noisy
- Adding a "fast-gate short-circuit" — skip Groq/Claude on partials that don't hit UAP Layer 1

### Why This Matters Architecturally

**Speculative pre-warm is why UAP + 8cuecore + anchor replaced daType+daSubType routing.** An LLM classifier on every partial would be prohibitively expensive and slow. Deterministic phrase-index + grammatical cues at <1ms per gate makes running the full pipeline on every partial viable.

In other words: the move from daType+daSubType to phrase-index wasn't primarily about simplicity or owner burden — it was about making speculative pre-warm computationally feasible. The architecture choice in the match layer unlocked the architecture choice in the execution model.

### Fire-and-Forget Invariants

Speculative execution has strict rules to prevent side effects:
- **Never flush event buffer** — that's the main handler's job on cache HIT
- **Never write callState back to Redis** — main handler owns state
- **Never persist discoveryNotes updates** — those fire on the final path only
- **Never affect booking/transfer/upsell Redis keys** — state changes belong to final
- **8s TTL** — stale results auto-expire before the next turn could fire

### Cache Key Format

```
Redis key: speculative:result:{callSid}
TTL:       8 seconds
Value:     JSON { input, result, turnCount, latencyMs, ts }
```

`turnCount` guards against using a Turn-N pre-warm for Turn-N+1 — they're always distinct turns. Mismatch → cache discarded, pipeline runs fresh.

### Events Emitted

Look for these in Call Intelligence logs:
- `[SPEC_LLM] ✅ Pre-warm stored` — speculative run completed, result cached
- `[SPEC_CHECK] 🚀 HIT — using pre-warm` — final handler used cached response
- `[SPEC_CHECK] Low similarity (X%) — discarding pre-warm` — containment too low, fresh pipeline fired
- `[SPEC_CHECK] Turn mismatch — discarding` — stale cache from previous turn

---

## 19. Design Rationale + Operational Guardrails (April 2026)

**Read this section first on any new session.** It captures the architectural decisions that define current UAP, the trade-offs accepted, and the metrics/behaviors to watch. A month from now, this will be the map that prevents flying blind.

### 19.1 — Why UAP + 8cuecore + Anchor Replaced daType + daSubType

The earlier design (`memory/uap-kc-design.md`, March 2026) specified an LLM classifier producing `ParsedUtterance { daType, daSubTypes[] }` that routed to KC subTopics via a Bridge table. **That design was never fully built. It was superseded.**

Current design replaces the classifier layer with three cooperating deterministic mechanisms:

| Layer | Replaces | Latency | Rationale |
|---|---|---|---|
| **UAP Layer 1 (phrase index)** | daType classification | <1ms | Matches on authored callerPhrases — no LLM, no misclassification, no taxonomy maintenance. The authored phrases ARE the taxonomy. |
| **8-Field CueExtractor** | daSubType routing | <1ms | 1,832 grammatical patterns (requestCue, permissionCue, infoCue, directiveCue, actionCore, urgencyCore, modifierCore, tradeMatches). Cue profile distinguishes "can I pay with credit card" from "do I have to pay" even when topic words overlap. |
| **Anchor container (3× + ANCHOR_FLOOR=24)** | Bridge state persistence | <1ms | Keeps conversation on topic across turns without a state machine. `noAnchor` escape hatch prevents meta-containers from poisoning persistence. Cross-container rescue (§17.1) handles legitimate topic switches. |

**Why this swap was architecturally necessary:** see §18. An LLM classifier on every partial STT transcript would be prohibitively expensive. Deterministic <1ms layers make speculative pre-warm viable. The match layer architecture enabled the execution model architecture.

### 19.2 — Accepted Trade-Offs (Know These Going In)

**1. Phrase-index brittleness to novel phrasings.**
The system matches on authored callerPhrases. Novel caller phrasings don't match. Mitigations:
- UAP Pass 4A — SYNONYM expansion (GlobalShare synonymGroups, 0.75 confidence)
- UAP Pass 4B — FUZZY_PHONETIC (Double Metaphone, 0.65-0.70 confidence)
- GATE 2.8 — Semantic embedding match (~50ms, threshold 0.50)
- GATE 4 — Claude LLM fallback (answer-from-kb mode with top-ranked KC sections injected as kcContext, §17)

These catch most misses. The remaining tail requires gap report triage and authoring new callerPhrases. See `public/agent-console/todo.html` for the workflow.

**2. Complexity budget is high.**
~15 gates, 6 fallback layers, speculative pre-warm, narrative filter, noAnchor semantics, cross-container rescue, pre-qualify/upsell state, patience mode, ghost-turn guard, silent re-listen. Each is individually justified. **Onboarding a new engineer will take weeks. Debugging edge cases requires deep context.** This is manageable today; it is a scaling risk if engineering team grows.

**3. Anchor can pin too hard.**
The 3× multiplier is aggressive. The cross-container rescue (§17.1, shipped `c00e83e2d` + noAnchor guard `2aa733fce`) is the safety valve for Section GAP cases. But rescue only fires when `match.targetSection` is null — if the anchor-boosted container wins with a WRONG section match, rescue never fires. Watch gap reports for this signature.

**4. Speculative pre-warm economics are pay-for-performance.**
See §18. Every partial fires a full pipeline run (potentially including Groq + Claude). If hit rate drops below ~40%, API spend exceeds latency savings. Monitor `[SPEC_CHECK] 🚀 HIT` vs `[SPEC_CHECK] Low similarity` ratio.

### 19.3 — Operational Metrics to Monitor (Add to Admin Dashboard Someday)

| Metric | Signal | Target | Where to find today |
|---|---|---|---|
| Speculative hit rate | Pre-warm effectiveness | ≥40% | Grep `[SPEC_CHECK] 🚀 HIT` vs `Low similarity` in logs |
| KC_SECTION_GAP rate | Missing authored content | ↓ over time | `public/agent-console/todo.html` |
| KC_LLM_FALLBACK rate | Complete KC miss | ↓ over time | `todo.html` |
| KC_GRACEFUL_ACK rate | Everything failed, canned response played | near 0 | `todo.html` |
| KC_SECTION_GAP_RESCUED count | Cross-container recovery firing | Healthy signal (rescue working) | qaLog, `todo.html` |
| Anchor container pin-rate | How often anchor wins vs natural match | Balance — neither 0% nor 100% | Call reports |
| Webhook total latency | End-to-end time | <2s p95 | `WEBHOOK_TIMING` log events |
| Turn 1 response time | First impression | <3s p95 | Call reports |

### 19.4 — Do-Not-Break Invariants

These have bitten before. Do not regress:

1. **Speculative path is fire-and-forget.** Never flush event buffer, never write callState back, never persist discoveryNotes mutations in the speculative path. Only the final path owns state.
2. **`speechDet` must be declared BEFORE `gatherTimeout`.** TDZ bug killed every call for a morning (commit `0675caf9e`). See §14.2.
3. **`/audio-safe/` URLs for all pre-recorded audio that must survive deploys.** `/audio/` is ephemeral (express.static) — no MongoDB fallback. See MEMORY.md "Audio URL Architecture."
4. **All pre-recorded audio path checks must pass `synthesizeSpeech` full voice settings.** Provenance tracking (UI_OWNED / LLM_GENERATED / HARDCODED) must be preserved.
5. **Multi-tenant filter on every Redis key + every Mongo query.** Missing companyId = tenant data leak. No exceptions.
6. **Schema fields must have UI.** "If it's not UI, it doesn't exist." Dead config fields (like a removed `knowledgeCards`) must be surgically excised, not left as orphans.
7. **noAnchor containers never become the anchor, never write callReason, never offer booking.** Guarded at 6 sites: KnowledgeContainerService L992+L1047 (bookingAction), KCDiscoveryRunner L2253+L2277+L2308 (callReason + anchor), rescue guard L1721 (rescue candidacy). Regressing any one opens the 3-bug cascade documented in §13.

### 19.5 — The Mental Model in One Paragraph

*The caller speaks. Twilio streams partial transcripts every 300ms. On each stable partial, the entire KC pipeline runs speculatively — UAP phrase-index lookup, 8cuecore grammatical parsing, anchor persistence scoring, Groq answer synthesis, Claude fallback if needed — and caches the result in Redis. When the caller stops talking, Twilio sends the final transcript. If the final is ≥75% token-contained by the last speculative partial, the cached response is used instantly. Otherwise the pipeline runs fresh. Groq is the voice of authored KC content. Claude is the fallback brain when no KC matched. BackupModel (if wired) retries Claude on API errors. All layers are deterministic, multi-tenant-isolated, and <1ms per gate except the two async calls (Groq ~500ms, Claude ~800ms). The anchor container is the topic memory that holds the conversation together across turns.*

That's the system. If a future session remembers only that paragraph, they'll be oriented.

### 19.6 — Where to Start When Something Is Wrong

1. **Caller experience issue** → call report JSON in Call Intelligence → qaLog + events
2. **"Wrong container answered"** → check `KC_SECTION_GAP_RESCUED`, anchor pin, negativeKeywords
3. **"Dead air / let me check"** → Section GAP? Claude fallback without kcContext? See §16 + §17
4. **"Agent didn't hear me"** → ghost turn guard, silent re-listen, speechTimeout/initialTimeout — §14
5. **"Call crashed / COMPUTE_CRASH"** → check TDZ invariants (§14.2), `ghostSpeechDet`, `speechDet` ordering
6. **"Booking loop / asking same question twice"** → narrative filter, noAnchor guards — §13
7. **"LAP swallowed a question"** → trailing content guard — §15

Start with the call report, then the specific section. Don't read the whole pipeline — find the symptom's section first.

