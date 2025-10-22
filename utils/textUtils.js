function stripMarkdown(text) {
  if (!text) {return '';}
  return text
    .replace(/\*\*|__|_|#|\n-|\n\*|\n\d\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTextForTTS(text) {
  if (!text) {return '';}
  
  // First decode HTML entities
  text = text.replace(/&amp;/g, '&')
             .replace(/&lt;/g, '<')
             .replace(/&gt;/g, '>')
             .replace(/&quot;/g, '"')
             .replace(/&#39;|&apos;/g, "'")
             .replace(/&nbsp;/g, ' ');
  
  // Clean up common formatting issues
  text = text.replace(/\s+/g, ' ')
             .replace(/\n+/g, ' ')
             .trim();
  
  // Remove markdown formatting
  text = stripMarkdown(text);
  
  return text;
}

module.exports = { stripMarkdown, cleanTextForTTS };
