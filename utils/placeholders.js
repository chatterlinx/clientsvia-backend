function applyPlaceholders(text, placeholders = []) {
  let result = text || '';
  if (!Array.isArray(placeholders)) return result;
  for (const ph of placeholders) {
    if (!ph || !ph.name) continue;
    const regex = new RegExp(`\\{\\{\\s*${ph.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*\\}}`, 'gi');
    result = result.replace(regex, ph.value || '');
  }
  return result;
}
module.exports = { applyPlaceholders };
