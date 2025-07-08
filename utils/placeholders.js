function applyPlaceholders(text, placeholders = []) {
  let result = text || '';
  if (!Array.isArray(placeholders)) return result;
  for (const ph of placeholders) {
    if (!ph || !ph.name) continue;
    // Handle double curly braces format {{AgentName}}
    const doubleRegex = new RegExp(`\\{\\{\\s*${ph.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*\\}}`, 'gi');
    result = result.replace(doubleRegex, ph.value || '');
    
    // Handle single curly braces format {AgentName}
    const singleRegex = new RegExp(`\\{\\s*${ph.name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\s*\\}`, 'gi');
    result = result.replace(singleRegex, ph.value || '');
  }
  return result;
}
module.exports = { applyPlaceholders };
