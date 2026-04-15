# UAP Engine Report — Complete A-to-Z Pipeline Reference

**Last verified against code: April 15, 2026**

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

---

## 1. Architecture Overview

```
Caller speaks → STT → userInput (string)
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
                    GATE 2.4  CueExtractor (<1ms)
                      ├─ 2.4b  Trade match route
                      └─ 2.4c  Cue profile scan (single-trade)
                          │
                    GATE 2.5  UAP Layer 1 (<1ms)
                      ├─ Logic 1: Word Gate (anchor words)
                      └─ Logic 2: Core Confirmation (~50ms embed)
                          │
                    GATE 2.8  Semantic Match (~50ms)
                          │
                    GATE 3    Keyword Scoring (<1ms)
                          │
                    [Section Gap Detection]
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

**Two modes the agent operates in:**
- **Mode 1 — Discovery (UAP + KC):** Default. Agent satisfies the caller. UAP identifies what they're saying, KC has the answers.
- **Mode 2 — Structured Requirements (Booking / Transfer):** Exception states where the business owner has requirements.

Even inside structured flows, when the caller wanders and asks a question: right back to Mode 1. Stateless. No consent gates.

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

**Trigger:** `!_inputHasQuestion && KCBookingIntentDetector.isBookingIntent(userInput)`

**Question detection:** Input contains `?` OR matches question word regex (what/how/why/when/which/where/does/do you/can you/tell me/explain/about/offer/etc.).

**Hedged-yes override:** If question words are present but NO literal `?` AND utterance starts with a leading affirmative (yes/yeah/sure/okay + fillers), `_inputHasQuestion` resets to `false` → booking fires.

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
**On miss:** Falls through to GATE 3.
**Note:** SemanticMatchService does NOT apply anchor multiplier. That's GATE 3 only.

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
GATE 3     Keyword Scoring        sync, <1ms        → (keyword match)
[Diag]     Section Gap            sync, ~0ms        → KC_SECTION_GAP (log only)
GATE 3.5   Pre-Qualify            Redis, ~2ms       → KC_PREQUAL_PENDING
[Answer]   KCS.answer() Groq      async, ~500ms     → KC_DIRECT_ANSWER
GATE 4.5   Upsell Chain           Redis, ~2ms       → KC_UPSELL_PENDING
GATE 4     LLM Fallback Claude    async, ~800ms     → KC_LLM_FALLBACK
[Fallback] Graceful ACK           sync, ~0ms        → KC_GRACEFUL_ACK
```

**The system is self-improving:** More callerPhrases → better UAP routing → fewer LLM fallbacks → faster, cheaper, more accurate responses. Fuzzy Recovery catches edge cases. Calibration Dashboard shows where the gaps are. Gaps & Todo page shows exactly which utterances fell through and why.
