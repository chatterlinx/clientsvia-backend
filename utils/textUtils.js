function stripMarkdown(text) {
  if (!text) return '';
  return text
    .replace(/\*\*|__|_|#|\n-|\n\*|\n\d\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

module.exports = { stripMarkdown };
