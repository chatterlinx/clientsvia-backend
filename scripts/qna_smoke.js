// Simple smoke test for deterministic QnA matcher (Phase 3)
const path = require('path');
const hvacPack = require(path.join(__dirname, '..', 'server', 'presets', 'starterPack.hvac_v1.json'));

const HVAC_SYNONYMS = [
  ["service call fee", "diagnostic fee", "trip charge", "service fee"],
  ["tune up", "tune-up", "maintenance plan", "seasonal check", "maintenance"],
  ["no cool", "not cooling", "warm air", "ac not working"],
  ["thermostat blank", "thermostat screen off"],
  ["filter size", "air filter size"],
  ["leak", "water leak", "drain clogged", "drain line"],
  ["speak to person", "representative", "live agent", "human"]
];

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function expands(q) {
  const out = [q];
  HVAC_SYNONYMS.forEach(group => {
    if (group.some(x => q.includes(x))) {
      group.forEach(syn => { if (!out.includes(syn)) out.push(syn); });
    }
  });
  return out;
}

function buildIndex(effectiveConfig) {
  const index = [];
  const pushSet = (arr, source) => {
    if (!Array.isArray(arr)) return;
    arr.forEach(item => {
      const questions = (item.q || []).map(normalize).flatMap(expands);
      const answer = item.a || "";
      if (!questions.length || !answer) return;
      index.push({ questions, answer, source });
    });
  };

  pushSet(effectiveConfig?.qna?.companyQA, "companyQA");
  pushSet(effectiveConfig?.qna?.tradeQA, "tradeQA");
  pushSet(effectiveConfig?.qna?.generic, "generic");
  return index;
}

function matchQuestion(index, userText) {
  const t = normalize(userText);
  if (!t) return null;

  for (const row of index) {
    for (const q of row.questions) {
      if (t.includes(q)) return { answer: row.answer, source: row.source, match: q };
    }
  }

  const toks = new Set(t.split(" "));
  let best = null, bestScore = 0;
  for (const row of index) {
    for (const q of row.questions) {
      const qs = q.split(" ");
      const overlap = qs.filter(w => toks.has(w)).length;
      const score = overlap / Math.max(qs.length, 1);
      if (score >= 0.6 && score > bestScore) { best = row; bestScore = score; }
    }
  }
  return best ? { answer: best.answer, source: best.source, match: "overlap" } : null;
}

(async function main(){
  try {
    console.log('Loaded hvac pack keys:', Object.keys(hvacPack.qna || {}));
    const index = buildIndex(hvacPack);
    console.log('Index built with', index.length, 'entries');

    const tests = [
      'How much is your service call fee?',
      'I want to talk to a human, please',
      'My AC is not cooling',
      'What size filter do I need?',
      'Tell me about maintenance plans',
      'Hello there'
    ];

    for (const t of tests) {
      const hit = matchQuestion(index, t);
      console.log('\nUser:', t);
      if (hit) {
        console.log('MATCH -> source:', hit.source, 'match:', hit.match);
        console.log('ANSWER:', hit.answer.substring(0, 200) + (hit.answer.length>200? '...':''));
      } else {
        console.log('No deterministic match');
      }
    }

    process.exit(0);
  } catch (e) {
    console.error('Smoke test failed:', e);
    process.exit(2);
  }
})();
