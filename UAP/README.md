# UAP Architecture

The UAP (UtteranceActParser + surrounding pipeline) architecture is versioned.
Each version file is a frozen snapshot of the architecture as-of that release.

## Current canonical version

**→ [`v1.md`](./v1.md)**

All design references, commit messages, and code comments should point at a
specific version file — never at a floating "UAP.md". When the architecture
substantially changes (shape-level, not content-level), a new version file is
created and this pointer flips.

## Version index

| Version | Date range | Shape |
|---------|-----------|-------|
| **v1** (current) | Apr 2026 — present | 7 Universal Cues + 1 Trade Index + Per-phrase Anchors + advisory scoring |
| v2 | (future) | — |

## What counts as a version bump?

**Minor edits (stay on current version):**
- Adding a new §section for a shipped feature
- Tightening a predicate or rule
- Adding/removing a cue pattern category value
- Documenting new qaLog events

**Major bump (new version file):**
- Collapsing or restructuring the 7+1 separation
- Swapping the pipeline cascade (e.g., ML-ranked scoring replacing deterministic gates)
- Removing or replacing a load-bearing gate
- Fundamentally changing the anchor system

When in doubt, bump. v1.md frozen is cheap. Silent shape drift inside a single file is expensive.

## Related docs

- [`CHANGELOG.md`](./CHANGELOG.md) — version-to-version diff with dates + rationale
- `memory/uap-8cue-anchor-hardening.md` — v1 hardening build tracker (session work log)
- `memory/cue-extractor-design.md` — Field 8 (trade index) deep dive
- `memory/per-phrase-anchor-words.md` — anchor gate design
- `memory/anchor-architecture.md` — anchor system overview
- `memory/uap-kc-design.md` — UAP/KC integration design
- `memory/uap-engine-report.md` — engine report pattern

## Naming discipline

- Spec references: `UAP/v1.md §N` (not `UAP.md §N`)
- Commit messages: `docs(UAP/v1): add §N description`
- Code comments: `See UAP/v1.md §N`
