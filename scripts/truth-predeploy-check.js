#!/usr/bin/env node
/**
 * Prevent regressions: fail when new hardcoded speech appears in backend.
 */
const fs = require('fs').promises;
const path = require('path');
const glob = require('glob');
const { promisify } = require('util');
const crypto = require('crypto');

const globAsync = promisify(glob);

const ROOT = path.join(__dirname, '..');
const BASELINE_PATH = path.join(ROOT, 'config', 'truth-hardcoded-baseline.json');
const TARGET_DIRS = ['routes', 'services/engine', 'services/'];
const EXCLUDE = [
  '**/node_modules/**',
  '**/tests/**',
  '**/test/**',
  '**/*.test.js',
  '**/*.spec.js',
  '**/services/compliance/HardcodedSpeechScanner.js'
];

const SPEECH_REGEX = /(?:replyText|responseText|nextPrompt|greeting|holdMessage|fallbackText|confirmationMessage)\s*[:=]\s*["'`][^"'`]{6,}/i;
const ALLOWLIST_REGEX = [
  /logger\./i,
  /throw new Error/i,
  /\/\/\s*/i,
  /\/\*/i
];

async function scanFile(file) {
  const content = await fs.readFile(file, 'utf-8');
  const lines = content.split('\n');
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!SPEECH_REGEX.test(line)) continue;
    if (ALLOWLIST_REGEX.some(rx => rx.test(line))) continue;
    violations.push({
      file: path.relative(ROOT, file),
      line: i + 1,
      code: line.trim().slice(0, 180)
    });
  }
  return violations;
}

async function run() {
  const updateBaseline = process.argv.includes('--update-baseline');
  const files = [];
  for (const dir of TARGET_DIRS) {
    const found = await globAsync('**/*.js', {
      cwd: path.join(ROOT, dir),
      nodir: true,
      ignore: EXCLUDE
    });
    for (const rel of found) files.push(path.join(ROOT, dir, rel));
  }

  const uniqueFiles = [...new Set(files)];
  const violations = [];
  for (const file of uniqueFiles) {
    const found = await scanFile(file);
    violations.push(...found);
  }

  const withFingerprint = violations.map(v => {
    const codeHash = crypto.createHash('sha256').update(v.code).digest('hex');
    return {
      ...v,
      fingerprint: `${v.file}|${codeHash}`
    };
  });

  if (updateBaseline) {
    const payload = {
      generatedAt: new Date().toISOString(),
      count: withFingerprint.length,
      fingerprints: withFingerprint.map(v => v.fingerprint).sort()
    };
    await fs.writeFile(BASELINE_PATH, JSON.stringify(payload, null, 2), 'utf-8');
    console.log(`[truth-predeploy-check] Baseline updated (${payload.count} entries)`);
    process.exit(0);
  }

  let baseline = { fingerprints: [] };
  try {
    baseline = JSON.parse(await fs.readFile(BASELINE_PATH, 'utf-8'));
  } catch {
    console.error('[truth-predeploy-check] Missing baseline file. Run with --update-baseline once.');
    process.exit(1);
  }

  const baselineSet = new Set(baseline.fingerprints || []);
  const newViolations = withFingerprint.filter(v => !baselineSet.has(v.fingerprint));

  if (newViolations.length > 0) {
    console.error(`[truth-predeploy-check] FAIL: ${newViolations.length} NEW hardcoded speech pattern(s) detected`);
    newViolations.slice(0, 30).forEach(v => {
      console.error(` - ${v.file}:${v.line} :: ${v.code}`);
    });
    process.exit(1);
  }

  console.log('[truth-predeploy-check] PASS: no new hardcoded speech patterns detected');
}

run().catch((error) => {
  console.error('[truth-predeploy-check] ERROR:', error.message);
  process.exit(1);
});

