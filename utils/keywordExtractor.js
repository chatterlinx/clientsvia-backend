function extractKeywords(text) {
  return text.toLowerCase().split(/\s+/).filter(w => w.length > 2);
}
module.exports = { extractKeywords };
