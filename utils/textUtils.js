function stripMarkdown(text) {
  if (!text) {return '';}
  return text
    .replace(/\*\*|__|_|#|\n-|\n\*|\n\d\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ════════════════════════════════════════════════════════════════════════════
// TTS FORMATTING - Phone & Address Pronunciation
// ════════════════════════════════════════════════════════════════════════════
// Advanced formatting is in confirmationFormatter.js
// These are lightweight wrappers for backward compatibility
// ════════════════════════════════════════════════════════════════════════════

/**
 * Format any text containing phone numbers or addresses for TTS
 * This is the main function to use before sending to TTS
 * 
 * Uses confirmationFormatter for consistent, natural pronunciation
 */
function formatForTTS(text) {
  if (!text) return '';
  
  // Import the advanced confirmation formatter
  const { formatPhoneDigitsForTTS, formatHouseNumberForTTS } = require('./confirmationFormatter');
  
  let result = text;
  
  // Format phone numbers (various formats)
  // Matches: 239-565-2202, (239) 565-2202, 239.565.2202, 2395652202, +1-239-565-2202
  result = result.replace(
    /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    (match) => {
      const digits = match.replace(/\D/g, '');
      return formatPhoneDigitsForTTS(digits);
    }
  );
  
  // Format standalone address numbers at start of address-like patterns
  // Matches: "12155 Metro Parkway", "1234 Main Street"
  result = result.replace(
    /\b(\d{3,5})\s+((?:[A-Z][a-z]+\s*)+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Boulevard|Blvd|Parkway|Pkwy|Way|Place|Pl|Circle|Cir|Terrace|Ter))\b/gi,
    (match, num, street) => formatHouseNumberForTTS(num) + ' ' + street
  );
  
  return result;
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
  
  // Format phone numbers and addresses for natural pronunciation
  text = formatForTTS(text);
  
  return text;
}

// Re-export confirmation formatter functions for convenience
const confirmationFormatter = require('./confirmationFormatter');

module.exports = { 
  stripMarkdown, 
  cleanTextForTTS,
  formatForTTS,
  // Re-export from confirmationFormatter
  formatPhoneForTTS: confirmationFormatter.formatPhoneDigitsForTTS,
  formatAddressForTTS: confirmationFormatter.formatAddressForTTS,
  formatAddressNumberForTTS: confirmationFormatter.formatHouseNumberForTTS,
  // New confirmation builders
  buildConfirmationLine: confirmationFormatter.buildConfirmationLine,
  wrapWithEmotion: confirmationFormatter.wrapWithEmotion
};
