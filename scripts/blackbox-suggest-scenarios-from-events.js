#!/usr/bin/env node
/**
 * BlackBox Event Analyzer: Suggest Scenarios To Build (Deterministic)
 *
 * Usage:
 *   node scripts/blackbox-suggest-scenarios-from-events.js /path/to/events.json
 *   cat events.json | node scripts/blackbox-suggest-scenarios-from-events.js
 *
 * Notes:
 * - Input should be an array of events like the raw BlackBox timeline (type, t, data.text, etc.).
 * - This is tooling for scenario builders and coders; it does not change runtime behavior.
 */

const fs = require('fs');
const path = require('path');

const { suggestFromEvents } = require('../services/ScenarioSuggestionEngine');

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

async function main() {
  const argPath = process.argv[2];
  let raw;

  if (argPath) {
    const abs = path.isAbsolute(argPath) ? argPath : path.join(process.cwd(), argPath);
    raw = fs.readFileSync(abs, 'utf8');
  } else {
    raw = await readStdin();
  }

  if (!raw || !raw.trim()) {
    console.error('No input provided. Pass a JSON file path or pipe JSON via stdin.');
    process.exit(2);
  }

  let events;
  try {
    events = JSON.parse(raw);
  } catch (e) {
    console.error('Input is not valid JSON:', e.message);
    process.exit(2);
  }

  if (!Array.isArray(events)) {
    console.error('Expected a JSON array of events.');
    process.exit(2);
  }

  const result = suggestFromEvents(events, { maxSuggestions: 10 });
  console.log(JSON.stringify(result, null, 2));
}

main().catch(err => {
  console.error('Failed to generate suggestions:', err);
  process.exit(1);
});

