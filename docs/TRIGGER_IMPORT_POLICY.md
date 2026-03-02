# Trigger Import Policy

## Rule: JSON filenames are irrelevant to runtime

Trigger JSON files in the `docs/` folder are **static reference backups only**.

- The agent runtime **never reads these files**.
- Filenames have **zero connection** to database records or group names.
- Runtime loads triggers from **MongoDB only**: `companyLocalTriggers` and `globalTriggers` collections.

---

## How trigger JSON files work

### What they ARE:
- Static backup/export files for version control
- Used for manual import via UI "Import LOCAL Triggers" button
- Reference documentation of trigger sets

### What they are NOT:
- Not read by the agent at runtime
- Not linked to global group names
- Not automatically loaded into the database

---

## Naming convention for trigger JSON files

Use **generic, descriptive names** that describe content, not deployment state:

**Good:**
- `trigger-library-backup.json`
- `emergency-triggers.json`
- `plumbing-common-questions.json`

**Bad (creates confusion):**
- `hvac-master-v1.json` ❌ (sounds like it's tied to a group called "hvac-master-v1")
- `production-triggers.json` ❌ (sounds like it's what production is using)
- `active-triggers-2026.json` ❌ (sounds like a runtime source)

---

## To import triggers from a JSON file

1. Open file in editor, copy JSON array
2. Go to Admin → Trigger Cards → Import/Export → Import LOCAL Triggers
3. Paste JSON, check the required "LOCAL only" checkbox
4. Click "Import as LOCAL"

This writes records to `companyLocalTriggers` for that one company. The filename is never saved or referenced.

---

## To promote a trigger to global

1. Open Admin → Trigger Cards
2. Find the LOCAL trigger
3. Toggle LOCAL → GLOBAL
4. Type "Yes" to confirm

The trigger is then written to `globalTriggers` with `state: 'published'` under the company's active group (e.g., `hvac`).

---

## Why this policy exists

In 2 years there may be 20+ JSON files in `docs/`. If they have confusing names like `hvac-v1`, `hvac-master`, `hvac-production`, people will assume the filename matters and waste time debugging phantom connections that don't exist.

**Filename = irrelevant. MongoDB = source of truth.**
