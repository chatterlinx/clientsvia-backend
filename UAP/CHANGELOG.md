# UAP Architecture Changelog

All notable changes to the UAP architecture specification.
Each entry is dated and ties to a commit range when possible.

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
