#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const { execSync } = require('child_process');

console.log('🔎 REGISTRY-COVERAGE MAP');

/**
 * Authoritative Notification Center registry.
 * Keep this in sync with NOTIFICATION_CONTRACT.md.
 */
const REGISTRY = [
  { id: 'NOTIF.DASHBOARD.LOAD',          failures: ['NOTIF_DASHBOARD_LOAD_FAILURE'],      ok: 'NOTIF_DASHBOARD_LOAD_OK' },
  { id: 'NOTIF.REGISTRY.VALIDATE_ALL',   failures: ['NOTIF_REGISTRY_VALIDATE_FAILURE'],   ok: 'NOTIF_REGISTRY_VALIDATE_OK' },
  { id: 'NOTIF.LOGS.LIST',               failures: ['NOTIF_LOGS_LIST_FAILURE'],           ok: 'NOTIF_LOGS_LIST_OK' },
  { id: 'NOTIF.ALERT.ACK',               failures: ['NOTIF_ALERT_ACK_FAILURE'],           ok: 'NOTIF_ALERT_ACK_OK' },
  { id: 'NOTIF.ALERT.SNOOZE',            failures: ['NOTIF_ALERT_SNOOZE_FAILURE'],        ok: 'NOTIF_ALERT_SNOOZE_OK' },
  { id: 'NOTIF.ALERT.RESOLVE',           failures: ['NOTIF_ALERT_RESOLVE_FAILURE'],       ok: 'NOTIF_ALERT_RESOLVE_OK' },
  { id: 'NOTIF.SETTINGS.SAVE',           failures: ['NOTIF_SETTINGS_SAVE_FAILURE','NOTIF_SETTINGS_TWILIO_MISSING_SID','NOTIF_SETTINGS_TWILIO_MISSING_TOKEN','NOTIF_SETTINGS_TWILIO_MISSING_NUMBER'], ok: 'NOTIF_SETTINGS_SAVE_OK' },
  { id: 'NOTIF.SETTINGS.TEST_SMS',       failures: ['NOTIF_SETTINGS_TEST_SMS_FAILURE'],    ok: 'NOTIF_SETTINGS_TEST_SMS_OK' },
  { id: 'NOTIF.HEALTH.RUN',              failures: ['NOTIF_HEALTH_RUN_FAILURE','SLO_NOTIF_HEALTH_RUN_P95'], ok: 'NOTIF_HEALTH_RUN_OK' }
];

const requiredCodes = new Set();
for (const e of REGISTRY) {
  e.failures.forEach(c => requiredCodes.add(c));
  if (e.ok) {requiredCodes.add(e.ok);}
}

function grepCodes() {
  try {
    const out = execSync(
      `rg -nI --no-heading -S "sendAlert\\s*\\(\\s*\\{[^}]*code\\s*:\\s*['\\\`\\\"]([A-Z0-9_]+)['\\\`\\\"]" routes/ services/ public/`,
      { stdio: ['ignore', 'pipe', 'pipe'] }
    ).toString();
    const found = new Set();
    const lines = out.split('\n').filter(Boolean);
    const regex = /code\s*:\s*['`"]([A-Z0-9_]+)['`"]/;
    for (const line of lines) {
      const m = line.match(regex);
      if (m) {found.add(m[1]);}
    }
    return { found, lines };
  } catch {
    return { found: new Set(), lines: [] };
  }
}

const { found, lines } = grepCodes();

const missingInCode = [...requiredCodes].filter(c => !found.has(c)).sort();
const extraInCode = [...found].filter(c => !requiredCodes.has(c) && !c.startsWith('SLO_')).sort();

console.log('Found sendAlert call-sites:', lines.length);
if (lines.length) {console.log(lines.slice(0, 20).join('\n') + (lines.length > 20 ? `\n... (+${lines.length - 20} more)` : ''));}

let failed = false;
if (missingInCode.length) {
  console.log('❌ MISSING_IN_CODE (required codes not found in repo):');
  console.log(missingInCode.join('\n'));
  failed = true;
} else {
  console.log('✅ All required codes present in code');
}

if (extraInCode.length) {
  console.log('⚠️  EXTRA_IN_CODE (codes not in registry list; verify or add to registry):');
  console.log(extraInCode.join('\n'));
  // not a hard fail; informational to keep registry tidy
}

process.exit(failed ? 1 : 0);

