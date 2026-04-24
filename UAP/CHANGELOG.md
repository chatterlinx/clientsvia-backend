# UAP Architecture Changelog

All notable changes to the UAP architecture specification.
Each entry is dated and ties to a commit range when possible.

---

## v1.2.0 — 2026-04-23

**Media Streams + Deepgram Nova-3 Direct STT — §30 shipped.**

Platform-wide STT upgrade replacing Twilio `<Gather>` for opted-in
tenants. Feature-flagged OFF by default. Gather path preserved as the
universal fallback — any tenant, any call, can always reach it. Five
commits, 8 test suites, 101 tests passing.

- **C1 — Scrub hardcoded tenant data from STT services.** Removed the
  HVAC keyword block from `services/stt/DeepgramService.js`
  (L198-219). `model` param now required; no hardcoded default.
  `DeepgramFallback.js` audited for same. Shipped `d3fd0bfd3`.
- **C2 — Platform vocab + config resolvers + schema.** New
  `services/mediaStream/VocabularyResolver.js` (per-tenant keywords +
  `AdminSettings.globalHub.tradeVocabularies[]` + platform-global
  first names, deduped, sorted by boost DESC). New
  `ConfigResolver.js` (tenant → platform → fallback). Schema
  additions: `company.aiAgentSettings.agent2.mediaStreams.{enabled,
  model, endpointingMs, utteranceEndMs, languageOverride}` and
  `AdminSettings.globalHub.mediaStreams.{defaultModel,
  defaultEndpointingMs, defaultUtteranceEndMs, defaultLanguage}`
  (defaults: `nova-3`, `300`, `1000`, `en-US`). Shipped `538af2a62`.
- **C3 — WebSocket server + circuit breaker + turn adapter.** New
  `services/mediaStream/MediaStreamServer.js` (mirrors
  `services/stt/TestConsoleASRServer.js` upgrade pattern).
  `DeepgramCircuitBreaker` — Redis-backed, platform-wide key
  (`deepgram:ms:circuit:global`), 3 consecutive failures in 5-min
  window → opens for 1h. `TurnLifecycleAdapter` aggregates DG
  interim → final → UtteranceEnd → emits turn payload matching the
  existing engine contract. Shipped `2cd9fbac1`.
- **C4 — Wire Media Streams as primary STT, gated by per-company
  flag.** New `routes/mediaStream.js` (bootstrap + fallback
  endpoints). `/voice` handler checks `mediaStreams.enabled &&
  !circuit.open` → emits `<Connect><Stream>` TwiML with
  CustomParameters, else existing Gather path runs unchanged. Mid-call
  failures trigger `bailToFallback()` (Twilio REST `calls(sid).update`
  redirect to `/api/twilio/media-stream/:companyId/fallback`). New
  `OutboundAudioPlayer.js` (ElevenLabs `output_format: 'ulaw_8000'` →
  160-byte frames → base64 media events + mark events for playback
  completion + barge-in cancelToken). Admin UI adds "Speech Pipeline"
  card to `agent-console/agent2.html` with read-only resolved preview.
  Shipped `146967ba1`.
- **C5 — Observability, health endpoint, architecture docs.** New
  `utils/mediaStreamHealthMonitor.js` — ring-buffered platform
  telemetry (active WS count, DG connect success rate, turn latency
  p50/p95/p99, 24h mid-call fallback count, circuit state). Wired
  `record*()` calls into `MediaStreamServer`. `GET
  /health/media-streams` + daily heartbeat (pattern mirrors
  `utils/memoryMonitor.js`). 13 new `MS_*` kinds catalogued in
  `CallTranscriptV2.TraceSchema` comment. §30 architecture doc with
  11 sub-sections covering flow diagram, platform principles,
  constants table, rollback levers, rollout protocol. Shipped
  `44b1d3b73`.

**Rollout:** Deploy with all tenants OFF. Flip flag per-tenant via
admin UI Speech Pipeline card after dev validation. Platform kill
switch: `DeepgramCircuitBreaker.forceOpen()` in Render Shell — every
tenant instantly falls back to Gather for 1h.

Commits: `d3fd0bfd3`, `538af2a62`, `2cd9fbac1`, `146967ba1`,
`44b1d3b73`. Architecture: §30 (11 sub-sections).

---

## v1.1.0 — 2026-04-23

**UAP 7+1 Cue + Anchor Hardening — §23 through §29 shipped.**

Single-day build against existing `globalshare.html` +
`cuePhrasesImport.js` + `KCDiscoveryRunner.js`. Eight code items + one
data operation. All acceptance bars met; zero regression on the baseline
call fixture (`CAf03bb37aee8b414e5e31cd6d5d5c8353`).

- **§23 — Architectural truth: 7 Universal Cues + 1 Trade Index.** Naming
  lock written BEFORE Items 1-9 began so code comments, commit messages,
  and UI copy converge on a single vocabulary. Shipped `1111ba3cc`.
- **§23.3 — Semantic lint predicates** (`_semanticLint()` in
  `routes/admin/cuePhrasesImport.js`). Advisory by default; `strictSemantic`
  opt-in drops warnings from clean set. Ships `warningsByReason` +
  `warningsSample` in all 4 preview/apply response shapes. Shipped
  `4e441ab47`.
- **§24 — Anchor acronym expansion.** New `utils/anchorAcronyms.js`
  (13-row curated bidirectional table, `Object.freeze`'d). Wired into
  `AUTO_ANCHOR_WORDS_FILLED` block in `routes/admin/companyKnowledge.js`.
  Expansion runs only when admin hasn't set anchors; admin override always
  wins. Shipped `42de3fc2e`.
- **§25 — Trade index specificity + tie-break.** Every `tradeIndex[term]`
  entry now carries `specificity = 1/fanout` at index-build time and
  entries are pre-sorted DESC by specificity. GATE 2.4b winner selection
  deterministic. `KC_TRADE_TIE_LOW_SPECIFICITY` telemetry emitted when
  winner specificity <0.5. Shipped `1154586ae`.
- **§26 — Unified ROUTE_DECISION qaLog + observability event.** Additive
  aggregate written at 3 dispatch sites in `KCDiscoveryRunner.run()`
  (SECTION_GAP, KC_MATCH, NO_MATCH LLM fallback). Includes
  `candidates[]`, `winner`, `winnerBy`, `runnerUp`, `margin`. Existing
  gate events untouched. Shipped `ca74e8a1e`.
- **§27 — Offline call replay CLI** (`scripts/replay-call.js`). Monkey-
  patches `DiscoveryNotesService` to async no-ops, feeds recorded
  `userInput` back through live `KCDiscoveryRunner.run()`, compares
  replayed vs recorded ROUTE_DECISION side-by-side. Zero engine change.
  Flags: `--json`, `--turn N`, `--verbose`. Shipped `f4b80897c`.
- **§28 — KC_CUE_MISS telemetry + dashboard panel.** New event + 4
  reason codes (`NO_FIELDS_EXTRACTED`, `LOW_FIELD_COUNT`,
  `MULTI_TRADE_NO_VOCAB_HIT`, `SINGLE_TRADE_SCAN_MISS`) wired in the
  CUE_EXTRACT try block. New endpoint
  `GET /:companyId/knowledge/cue-misses` + new "Cue Misses" tab in
  `todo.html`. Fire-and-forget writes; never affects routing. Shipped
  `f1b367dcd`.
- **§29 — cuePhrases + tradeVocabulary drift monitor.** New
  `utils/cuePhrasesDriftMonitor.js` (pattern mirrors
  `utils/memoryMonitor.js`). 3-axis snapshot, 3 conservative thresholds
  (20% total / 30% per-token / 25% trade), 3 severity levels (info / warn
  / critical). In-memory baseline (no spurious alarms on rolling
  deploys). `/health/drift` mounted next to `/health/memory`;
  `startDriftMonitor()` called after HTTP bind. Shipped `659cd9e16`.
- **Item 2 data operation (companion to §23.3) — dictionary triage
  2026-04-23.** Baseline snapshot captured at
  `~/Desktop/baseline-pre-triage-04-23-2026.json` (1,927 patterns).
  Full 7-token audit completed. 27 polysemous rows dropped (−1.4%):
  12 bare directives (`just`, `please`, `stop`, `start`, `keep`,
  `avoid`, `try`, `check`, `look`, `do not`, `don't`, `never`) + 14
  bare generic verbs (`make`, `get`, `handle`, `help`, `assist`,
  `answer`, `tell`, `give`, `call`, `text`, `email`, `process`,
  `cover`, `file`) + 1 broken paste row. Post-apply baseline: 1,900
  patterns. Well under Item 9 drift thresholds; zero alarms fired on
  apply; Item 1 `_semanticLint()` passed every surviving row.
- **TOC extended** to 29 entries; "Last verified against code" header
  bumped to 2026-04-23.

**Rationale:** The v1.0.0 rehoming was structural. v1.1.0 is the first
spec-level hardening of the 7+1 architecture against dictionary
pollution, data gaps, and silent routing drift. The "no shortcuts"
principle — baseline fixture must not regress, replay harness must be
green, drift must be bounded, decisions must be traceable — is now
enforced by running code, not documentation.

**Shipped with commits:** `4e441ab47`, `1154586ae`, `ca74e8a1e`,
`42de3fc2e`, `f4b80897c`, `f1b367dcd`, `659cd9e16`, plus the §23 naming
lock `1111ba3cc` and this documentation sync.

**Companion work:** `memory/uap-8cue-anchor-hardening.md` — full
decision log, status board, baseline-call fixture, acceptance bar,
anti-gimmick guardrail.

---

## v1.0.0 — 2026-04-23

**Initial consolidation from flat `UAP.md` into versioned `UAP/v1.md`.**

- Moved `UAP.md` → `UAP/v1.md` (`git mv`, history preserved via `--follow`)
- Created `UAP/README.md` with version index + naming discipline
- Created `UAP/CHANGELOG.md` (this file)
- **No content changes** — v1.0.0 is a structural rehoming. All §1-16
  content is preserved verbatim from the pre-move `UAP.md`.

**Rationale:** flat `UAP.md` was growing monotonically (§1 through §16 as of
April 2026) with no boundary for future shape changes. Versioning gives each
architectural era a frozen snapshot, enables clean major-bump boundaries, and
makes reviews cheaper (diffs against a known baseline).

**Companion work tracked in:** `memory/uap-8cue-anchor-hardening.md`

---

<!--
Template for future entries:

## v1.X.Y — YYYY-MM-DD

**Short title of what changed.**

- Bullet of concrete change
- Bullet of concrete change

**Rationale:** why the change matters architecturally.

**Shipped with:** commit SHA(s) or feature name(s).

**Companion work:** path to memory/ tracker if applicable.
-->
