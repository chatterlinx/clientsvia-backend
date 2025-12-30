### Predeploy QA Gates (mandatory)

This folder contains **machine-checkable** predeploy gates. These scripts are designed to fail fast if the platform can’t prove runtime wiring.

### Run

```bash
QA_BASE_URL="https://clientsvia-backend.onrender.com" \
QA_TOKEN="Bearer <TOKEN>" \
QA_COMPANY_ID="<companyId>" \
node scripts/qa/predeploy-gates.js
```

### What it checks

- **`/runtime-truth`** returns valid JSON with `_meta.schemaVersion` and `_meta.effectiveConfigVersion`
- **Scenario pool is non-zero** via admin diagnostics link-check
- **KPI summary endpoint** returns a valid structure


