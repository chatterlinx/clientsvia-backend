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
  
  // ════════════════════════════════════════════════════════════════════════════
  // V86 P0 FIX: SANITIZE TRAILING NUMBERS FROM UI CONFIG POLLUTION
  // ════════════════════════════════════════════════════════════════════════════
  // Problem: UI config sometimes has variant IDs appended to questions:
  //   "What's your name 3?" ← The "3" is a config artifact, NOT intentional
  //   "Did I get that right 1?" ← Same issue
  //
  // Y106 (Apr 2026) — Previous version's third regex was too aggressive:
  //   text.replace(/(\w)\s+\d([?!.,])/g, '$1$2')
  // stripped legitimate numeric content: "option 3?", "suite 4,", "on the 7?"
  // all lost their digit. Voice callers hearing "option? is available" is worse
  // than leaving a rare config artifact in place.
  //
  // Fix: Constrain the variant-ID stripper to an explicit wordlist — only
  // prompt-keywords commonly followed by a UI variant ID. Generic word+digit
  // patterns (addresses, menu options, dates) are left intact.
  // ════════════════════════════════════════════════════════════════════════════
  text = text.replace(/\s+\d+([?!.]?)$/g, '$1');  // End of text: " 3?" → "?"
  text = text.replace(/\s+\d+([?!.])(\s)/g, '$1$2');  // Mid-text: " 3? " → "? "

  // Y106: mid-text variant-ID stripper — only fires after known prompt keywords
  // (where a trailing digit is almost always a config artifact, never speech).
  // Keep in lowercase since we already replaced whitespace above; regex is /i.
  text = text.replace(
    /\b(name|phone|email|address|zip|number|question|confirm|right|correct)\s+\d([?!.,])/gi,
    '$1$2'
  );
  
  // Format phone numbers and addresses for natural pronunciation
  text = formatForTTS(text);
  
  return text;
}

// ════════════════════════════════════════════════════════════════════════════
// V86 P1: ENFORCE SHORT VOICE RESPONSES
// ════════════════════════════════════════════════════════════════════════════
// Receptionist pattern: "Acknowledgment + Next Question" (1-2 sentences max)
// Long chatty responses cause:
// - Longer TTS generation (scales with length)
// - Dead air while playing
// - Caller can't interrupt (if bargeIn=false)
// 
// Target: Keep responses under 150 chars for voice calls
// ════════════════════════════════════════════════════════════════════════════

/**
 * Truncate response for voice calls to prevent long TTS
 * Keeps: first acknowledgment sentence + first question
 * 
 * @param {string} text - Full response text
 * @param {number} maxChars - Maximum characters (default 180)
 * @param {boolean} isVoice - Whether this is for voice (true) or text (false)
 * @returns {string} - Truncated text
 */
function enforceVoiceResponseLength(text, maxChars = 180, isVoice = true) {
  if (!text || !isVoice) return text;
  
  // If already short, return as-is
  if (text.length <= maxChars) return text;
  
  // Split into sentences
  const sentences = text.match(/[^.!?]+[.!?]+/g) || [text];
  
  // Find the first question (ends with ?)
  const questionIndex = sentences.findIndex(s => s.trim().endsWith('?'));
  
  if (questionIndex === -1) {
    // No question found - just take first sentence
    return sentences[0].trim();
  }
  
  if (questionIndex === 0) {
    // First sentence is the question - return it
    return sentences[0].trim();
  }
  
  // Take first sentence (acknowledgment) + question
  const ack = sentences[0].trim();
  const question = sentences[questionIndex].trim();
  
  const combined = `${ack} ${question}`;
  
  // If still too long, just return the question
  if (combined.length > maxChars) {
    return question;
  }
  
  return combined;
}

// Re-export confirmation formatter functions for convenience
const confirmationFormatter = require('./confirmationFormatter');

module.exports = { 
  stripMarkdown, 
  cleanTextForTTS,
  formatForTTS,
  enforceVoiceResponseLength,  // V86: Short response enforcement
  // Re-export from confirmationFormatter
  formatPhoneForTTS: confirmationFormatter.formatPhoneDigitsForTTS,
  formatAddressForTTS: confirmationFormatter.formatAddressForTTS,
  formatAddressNumberForTTS: confirmationFormatter.formatHouseNumberForTTS,
  // New confirmation builders
  buildConfirmationLine: confirmationFormatter.buildConfirmationLine,
  wrapWithEmotion: confirmationFormatter.wrapWithEmotion
};
