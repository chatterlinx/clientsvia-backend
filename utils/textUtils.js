function stripMarkdown(text) {
  if (!text) {return '';}
  return text
    .replace(/\*\*|__|_|#|\n-|\n\*|\n\d\./g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Format phone numbers for natural TTS pronunciation
 * "239-565-2202" → "2 3 9, 5 6 5, 2 2 zero 2"
 */
function formatPhoneForTTS(phone) {
  if (!phone) return '';
  
  // Extract just digits
  const digits = phone.replace(/\D/g, '');
  
  if (digits.length === 10) {
    // Format as: "2 3 9, 5 6 5, 2 2 zero 2"
    const area = digits.substring(0, 3).split('').map(d => d === '0' ? 'zero' : d).join(' ');
    const prefix = digits.substring(3, 6).split('').map(d => d === '0' ? 'zero' : d).join(' ');
    const line = digits.substring(6, 10).split('').map(d => d === '0' ? 'zero' : d).join(' ');
    return `${area}, ${prefix}, ${line}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    // With country code
    const area = digits.substring(1, 4).split('').map(d => d === '0' ? 'zero' : d).join(' ');
    const prefix = digits.substring(4, 7).split('').map(d => d === '0' ? 'zero' : d).join(' ');
    const line = digits.substring(7, 11).split('').map(d => d === '0' ? 'zero' : d).join(' ');
    return `${area}, ${prefix}, ${line}`;
  }
  
  // Fallback: space out digits with zero pronunciation
  return digits.split('').map(d => d === '0' ? 'zero' : d).join(' ');
}

/**
 * Format street address numbers for natural TTS pronunciation
 * "12155" → "1 2 1 5 5" or "twelve one fifty-five"
 * "1234" → "1 2 3 4"
 */
function formatAddressNumberForTTS(addressNum) {
  if (!addressNum) return '';
  
  const num = addressNum.toString().trim();
  
  // For 4-5 digit house numbers, space them out
  if (/^\d{4,5}$/.test(num)) {
    return num.split('').map(d => d === '0' ? 'zero' : d).join(' ');
  }
  
  // For shorter numbers (1-3 digits), say naturally
  return num.replace(/0/g, 'zero');
}

/**
 * Format full address for TTS
 * "12155 Metro Parkway" → "1 2 1 5 5 Metro Parkway"
 */
function formatAddressForTTS(address) {
  if (!address) return address;
  
  // Match leading house number
  return address.replace(/^(\d{3,5})\s+/, (match, num) => {
    return formatAddressNumberForTTS(num) + ' ';
  });
}

/**
 * Format any text containing phone numbers or addresses for TTS
 * This is the main function to use before sending to TTS
 */
function formatForTTS(text) {
  if (!text) return '';
  
  let result = text;
  
  // Format phone numbers (various formats)
  // Matches: 239-565-2202, (239) 565-2202, 239.565.2202, 2395652202, +1-239-565-2202
  result = result.replace(
    /\+?1?[-.\s]?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    (match) => formatPhoneForTTS(match)
  );
  
  // Format standalone address numbers at start of address-like patterns
  // Matches: "12155 Metro Parkway", "1234 Main Street"
  result = result.replace(
    /\b(\d{3,5})\s+((?:[A-Z][a-z]+\s*)+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Boulevard|Blvd|Parkway|Pkwy|Way|Place|Pl|Circle|Cir|Terrace|Ter))\b/gi,
    (match, num, street) => formatAddressNumberForTTS(num) + ' ' + street
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

module.exports = { 
  stripMarkdown, 
  cleanTextForTTS,
  formatForTTS,
  formatPhoneForTTS,
  formatAddressForTTS,
  formatAddressNumberForTTS
};
