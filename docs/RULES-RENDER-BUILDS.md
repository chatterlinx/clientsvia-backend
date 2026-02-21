# PERMANENT RULE: Render Build Configuration

## 🚨 CRITICAL RULE - DO NOT VIOLATE

**Render build must NEVER run tests.**

**Render `buildCommand` = `npm ci` ONLY.**

**Any test gates belong in GitHub Actions later, NOT in production deploys.**

---

## Why This Rule Exists

### The Problem

On **Feb 20, 2026**, deployments were completely blocked because:

```yaml
# render.yaml (WRONG - DO NOT USE)
buildCommand: npm ci && npm run test:ci
```

```json
// package.json (WRONG - DO NOT USE)
"test:ci": "jest --runInBand --passWithNoTests=false"
```

The `--passWithNoTests=false` flag **fails the build if there are zero tests**.

This means:
- ❌ Production deploys blocked by CI gates
- ❌ Critical fixes can't deploy
- ❌ System goes down waiting for someone to "fix tests"
- ❌ Voice system unavailable to customers

### The Root Cause

A **hard reset** (`git reset --hard bbd5d4a`) reverted past commit `16a385c0` which had removed this test gate.

This brought the "test landmine" back into the codebase.

---

## The Correct Configuration

### render.yaml (CORRECT)

```yaml
services:
  - type: web
    name: clientsvia-backend
    env: node
    plan: starter
    buildCommand: npm ci           # ← CORRECT: No tests
    startCommand: npm start
    envVars:
      - key: NODE_ENV
        value: production
      - key: PORT
        value: 4000
      - fromGroup: clientsvia-env-group
```

### package.json (HARDENED)

```json
{
  "scripts": {
    "test:ci": "echo 'CI tests disabled for this repo - tests must not block production deploys' && exit 0"
  }
}
```

The `test:ci` script is now a **harmless no-op** that always succeeds.

This prevents anyone from accidentally reintroducing the build blocker.

---

## What Render Builds Should Do

### ✅ ALLOWED

- `npm ci` - Install dependencies
- `npm run build` - Build production assets (if needed)
- `npm run build-css-prod` - Build Tailwind CSS

### ❌ FORBIDDEN

- `npm run test` - Unit tests
- `npm run test:ci` - CI test gates
- `npm run test:integration` - Integration tests
- Any command with `--passWithNoTests=false`

---

## Where Tests Should Run

**Tests belong in GitHub Actions** (or separate CI pipeline).

Example `.github/workflows/ci.yml`:

```yaml
name: CI Tests
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run test:unit
      - run: npm run test:integration
```

This way:
- ✅ Tests run on every push/PR
- ✅ Production deploys are NOT blocked
- ✅ You get test feedback without breaking the runtime

---

## How to Enforce This Rule

### 1. Code Review Checklist

Before merging ANY PR that touches `render.yaml` or `package.json`, verify:

- [ ] `render.yaml` buildCommand does NOT include tests
- [ ] `package.json` test:ci does NOT use `--passWithNoTests=false`
- [ ] No new test gates were added

### 2. Git Hooks (Future Enhancement)

Create `.git/hooks/pre-commit`:

```bash
#!/bin/bash
if git diff --cached render.yaml | grep -q "test:ci"; then
  echo "❌ BLOCKED: render.yaml must not run tests"
  echo "See docs/RULES-RENDER-BUILDS.md"
  exit 1
fi
```

### 3. AI Agent Instructions

When working with AI agents (Cursor, Copilot, etc.), include this prompt:

```
CRITICAL RULE: Render builds must NEVER run tests.
render.yaml buildCommand = "npm ci" only.
Do NOT add test:ci or any test gates to Render builds.
Tests belong in GitHub Actions, not production deploys.
```

---

## What to Do If This Rule Is Violated

### Symptoms

- Render deployments failing with "exit status 1"
- Build logs show "No tests found" or similar
- Deploy fails even though code is valid

### Fix (Emergency)

```bash
# 1. Fix render.yaml
git checkout main
git pull
# Edit render.yaml: change buildCommand to "npm ci"
git add render.yaml
git commit -m "fix(render): remove test gate (CRITICAL)"
git push

# 2. Hard kill test:ci script
# Edit package.json: change test:ci to echo + exit 0
git add package.json
git commit -m "chore(ci): disable test:ci (no tests in prod builds)"
git push
```

### Prevention

After fixing, add this to your commit message template:

```
RENDER BUILD RULE: buildCommand = npm ci only
DO NOT add tests to Render builds
See docs/RULES-RENDER-BUILDS.md
```

---

## Historical Context

### Timeline of the Feb 20, 2026 Incident

1. **Commit 16a385c0** - Removed test gate from Render build ✅
2. **Hard reset to bbd5d4a** - Accidentally reverted the fix ❌
3. **All deployments started failing** - CI gate blocking production ❌
4. **Commit f83b87ae** - Re-removed test gate ✅
5. **Commit 3a0c52b5** - Hard killed test:ci script to prevent reintroduction ✅

### Lessons Learned

1. **Hard resets are dangerous** - They can revert critical infrastructure fixes
2. **Test gates don't belong in production** - Separate CI from runtime deploys
3. **Defense in depth** - Disable the script AND the build command
4. **Documentation matters** - This rule must be visible and enforced

---

## Related Documents

- `docs/DEPLOYMENT-FIX-2026-02-20.md` - Full incident report
- `docs/DEPLOYMENT_SAFETY_CHECKLIST.md` - Deployment safety checklist
- `scripts/verify-deployment.sh` - Deployment verification script

---

## Enforcement

**This is a CRITICAL infrastructure rule.**

Violations will cause:
- Production outages
- Blocked emergency deploys
- Customer impact

**If you see this rule being violated, STOP the PR and escalate.**

---

## Questions?

If you're unsure whether a change violates this rule, ask yourself:

1. Does this add anything to `render.yaml` buildCommand besides `npm ci`?
   - If YES → **VIOLATION**
2. Does this change `test:ci` to fail on missing tests?
   - If YES → **VIOLATION**
3. Would this change block a production deploy if tests don't exist?
   - If YES → **VIOLATION**

When in doubt, keep Render builds minimal: **`npm ci` only**.
