function normalizeNameToken(value) {
  return String(value || '').trim().toLowerCase();
}

function buildCommonFirstNameSet(commonFirstNames) {
  const set = new Set();
  (commonFirstNames || []).forEach((name) => {
    const normalized = normalizeNameToken(name);
    if (normalized) {
      set.add(normalized);
    }
  });
  return set;
}

function isSuspiciousDuplicateName(first, last, commonFirstNames = []) {
  const firstLower = normalizeNameToken(first);
  const lastLower = normalizeNameToken(last);
  if (!firstLower || !lastLower) return false;
  if (firstLower !== lastLower) return false;

  const commonFirstNamesSet = buildCommonFirstNameSet(commonFirstNames);
  return commonFirstNamesSet.has(firstLower);
}

module.exports = {
  isSuspiciousDuplicateName,
  buildCommonFirstNameSet
};
