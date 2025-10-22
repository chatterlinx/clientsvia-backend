#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

console.log('🔎 TENANT-CONTEXT SCAN (company tabs)');

/**
 * Heuristic: in company-area routes/services, any DB/Redis call should have companyId
 * in a ±8-line window. Adjust directories as needed.
 */
const roots = ['routes/company', 'services', 'models'];
const dbPatterns = [
  /\.find(ById|One|Many|)?\s*\(/,
  /\.update(One|Many)?\s*\(/,
  /\.aggregate\s*\(/,
  /\.save\s*\(/,
  /redis(Client)?\.(get|set|del|hget|hset|scan)\s*\(/
];

function walk(dir, acc=[]) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir)) {
    const p = path.join(dir, e);
    const s = fs.statSync(p);
    if (s.isDirectory()) walk(p, acc);
    else if (p.endsWith('.js')) acc.push(p);
  }
  return acc;
}

const files = roots.flatMap(r => walk(r, []));
let failures = [];

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8').split('\n');
  for (let i = 0; i < src.length; i++) {
    const line = src[i];
    if (!dbPatterns.some(rx => rx.test(line))) continue;
    const start = Math.max(0, i - 8), end = Math.min(src.length, i + 9);
    const windowText = src.slice(start, end).join('\n');
    const hasCompanyId = /companyId/.test(windowText) || /tenantContext/.test(windowText);
    if (!hasCompanyId) {
      failures.push(`${file}:${i + 1}: DB/Redis call without nearby companyId/tenantContext`);
    }
  }
}

if (failures.length) {
  console.log('❌ Missing tenant context near DB/Redis calls:');
  console.log(failures.join('\n'));
  process.exit(1);
} else {
  console.log('✅ Tenant context present near DB/Redis calls in scanned areas');
}

