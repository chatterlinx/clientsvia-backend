/**
 * Simple brace-template renderer for UI-configured prompts.
 *
 * - Replaces tokens like "{firstName}" with provided values.
 * - Leaves unknown tokens intact (so templates are debuggable).
 *
 * NOTE: This is rendering logic, not AI behavior text.
 */
function renderBracedTemplate(template, vars = {}) {
  if (!template || typeof template !== 'string') return '';
  const v = vars && typeof vars === 'object' ? vars : {};
  return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(v, key) && v[key] !== undefined && v[key] !== null) {
      return String(v[key]);
    }
    return m;
  });
}

module.exports = { renderBracedTemplate };

