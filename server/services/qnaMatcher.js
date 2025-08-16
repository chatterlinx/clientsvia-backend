// Phase 3 — Deterministic QnA matcher for out-of-the-box answers
const resolver = require("./effectiveConfigResolver");

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
  // Expand a single canonical phrase by synonyms table
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

  // Strong contains match first (prefer companyQA > tradeQA > generic by index order)
  for (const row of index) {
    for (const q of row.questions) {
      if (t.includes(q)) return { answer: row.answer, source: row.source, match: q };
    }
  }

  // Token overlap fallback (very light)
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

exports.tryAnswer = async (companyId, userText) => {
  const { config } = await resolver.getEffectiveSettings(companyId);
  const index = buildIndex(config);
  const hit = matchQuestion(index, userText);
  if (!hit) return { ok: false };
  return { ok: true, answer: hit.answer, source: hit.source };
};
