/**
 * ============================================================================
 * CONFIRMATION FORMATTER - Human-Sounding TTS Confirmations
 * ============================================================================
 * 
 * Makes phone numbers, addresses, and other confirmations sound natural.
 * Handles:
 * - First vs second vs third attempt (varies phrasing)
 * - Returning customer recognition
 * - Confused caller handling (simpler readback)
 * - SSML prosody for natural intonation
 * 
 * ============================================================================
 */

// ════════════════════════════════════════════════════════════════════════════
// DIGIT WORDS - For spelling out numbers
// ════════════════════════════════════════════════════════════════════════════

const DIGIT_WORDS = {
  '0': 'zero',
  '1': 'one',
  '2': 'two',
  '3': 'three',
  '4': 'four',
  '5': 'five',
  '6': 'six',
  '7': 'seven',
  '8': 'eight',
  '9': 'nine',
};

// Small numbers as words (for house numbers 1-31)
const SMALL_NUMBERS = {
  1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five',
  6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten',
  11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen',
  15: 'fifteen', 16: 'sixteen', 17: 'seventeen', 18: 'eighteen',
  19: 'nineteen', 20: 'twenty', 21: 'twenty-one', 22: 'twenty-two',
  23: 'twenty-three', 24: 'twenty-four', 25: 'twenty-five',
  26: 'twenty-six', 27: 'twenty-seven', 28: 'twenty-eight',
  29: 'twenty-nine', 30: 'thirty', 31: 'thirty-one',
};

// ════════════════════════════════════════════════════════════════════════════
// PHONE NUMBER FORMATTING
// ════════════════════════════════════════════════════════════════════════════

/**
 * Format phone for TTS: "2395652202" -> "two three nine, five six five, two two zero two"
 * @param {string} phoneDigits - digits only
 * @param {Object} options - { useSSML: boolean }
 * @returns {string}
 */
function formatPhoneDigitsForTTS(phoneDigits, options = {}) {
  const digits = (phoneDigits || '').replace(/\D/g, '');
  if (!digits) return '';

  // Group: 3-3-4 for 10 digits, otherwise 3-digit chunks
  let groups;
  if (digits.length === 10) {
    groups = [
      digits.slice(0, 3),
      digits.slice(3, 6),
      digits.slice(6),
    ];
  } else if (digits.length === 11 && digits.startsWith('1')) {
    // Skip country code
    groups = [
      digits.slice(1, 4),
      digits.slice(4, 7),
      digits.slice(7),
    ];
  } else {
    groups = digits.match(/.{1,3}/g) || [digits];
  }

  const spokenGroups = groups.map(group =>
    group.split('').map(d => DIGIT_WORDS[d] || d).join(' ')
  );

  if (options.useSSML) {
    // Add SSML breaks for natural pauses
    return spokenGroups.join('<break time="200ms"/> ');
  }

  // Join with commas for natural pauses
  return spokenGroups.join(', ');
}

/**
 * Last 4 digits for second-attempt confirmation
 * "2395652202" -> "two two zero two"
 */
function formatPhoneLastFourForTTS(phoneDigits) {
  const digits = (phoneDigits || '').replace(/\D/g, '');
  if (digits.length < 4) return formatPhoneDigitsForTTS(digits);
  const last4 = digits.slice(-4);
  return last4.split('').map(d => DIGIT_WORDS[d] || d).join(' ');
}

// ════════════════════════════════════════════════════════════════════════════
// HOUSE NUMBER FORMATTING
// ════════════════════════════════════════════════════════════════════════════

/**
 * Format house number for TTS
 * - Small numbers (1-31): "twenty-three"
 * - Large numbers: digit-by-digit "one two one five five"
 * 
 * @param {string|number} raw
 * @returns {string}
 */
function formatHouseNumberForTTS(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return raw || '';

  const num = parseInt(digits, 10);
  if (Number.isNaN(num)) {
    return digits.split('').map(d => DIGIT_WORDS[d] || d).join(' ');
  }

  // Small numbers as words
  if (num >= 1 && num <= 31) {
    return SMALL_NUMBERS[num] || digits.split('').map(d => DIGIT_WORDS[d] || d).join(' ');
  }

  // Common round numbers
  if (num === 100) return 'one hundred';
  if (num === 200) return 'two hundred';
  if (num === 1000) return 'one thousand';
  if (num === 1600) return 'sixteen hundred';
  if (num === 2000) return 'two thousand';

  // Large numbers: digit-by-digit
  return digits.split('').map(d => DIGIT_WORDS[d] || d).join(' ');
}

// ════════════════════════════════════════════════════════════════════════════
// ADDRESS FORMATTING
// ════════════════════════════════════════════════════════════════════════════

/**
 * Format full address for TTS
 * 
 * @param {Object|string} addressObj - Address object or string
 * @param {Object} options - { useSSML: boolean }
 * @returns {string}
 */
function formatAddressForTTS(addressObj, options = {}) {
  if (!addressObj) return '';

  // Handle string input
  if (typeof addressObj === 'string') {
    // Try to parse house number from start
    const match = addressObj.match(/^(\d+)\s+(.*)$/);
    if (match) {
      const houseNumber = formatHouseNumberForTTS(match[1]);
      return `${houseNumber} ${match[2]}`;
    }
    return addressObj;
  }

  const parts = [];

  if (addressObj.line1) {
    const match = addressObj.line1.match(/^(\d+)\s+(.*)$/);
    if (match) {
      const houseNumber = formatHouseNumberForTTS(match[1]);
      parts.push(`${houseNumber} ${match[2]}`);
    } else {
      parts.push(addressObj.line1);
    }
  }

  if (addressObj.line2) {
    // Suite/Apt numbers
    const suiteMatch = addressObj.line2.match(/(\d+)/);
    if (suiteMatch) {
      const suiteNum = suiteMatch[1].split('').map(d => DIGIT_WORDS[d] || d).join(' ');
      parts.push(addressObj.line2.replace(/\d+/, suiteNum));
    } else {
      parts.push(addressObj.line2);
    }
  }

  if (addressObj.city) {
    parts.push(addressObj.city);
  }

  if (addressObj.state) {
    parts.push(addressObj.state);
  }

  if (addressObj.zip) {
    const zipDigits = addressObj.zip.replace(/\D/g, '');
    if (zipDigits) {
      const zipSpoken = zipDigits.split('').map(d => DIGIT_WORDS[d] || d).join(' ');
      parts.push(zipSpoken);
    }
  }

  if (options.useSSML) {
    return parts.join('<break time="150ms"/> ');
  }

  return parts.join(', ');
}

// ════════════════════════════════════════════════════════════════════════════
// CONFIRMATION LINE BUILDERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Build phone confirmation line based on attempt count
 * 
 * @param {Object} ctx
 * @param {string} ctx.phone - raw phone
 * @param {number} ctx.attempt - 1, 2, or 3+
 * @param {boolean} ctx.callerConfused - if caller said "what?"
 * @param {string} ctx.customerName - optional name for personalization
 * @param {boolean} ctx.useSSML - wrap in SSML
 * @returns {string}
 */
function buildPhoneConfirmation(ctx) {
  const { phone, attempt = 1, callerConfused, customerName, useSSML } = ctx;
  const cleanDigits = (phone || '').replace(/\D/g, '');
  
  if (!cleanDigits) {
    return "What's the best phone number to reach you?";
  }

  const name = customerName ? `, ${customerName}` : '';

  if (attempt <= 1) {
    const spoken = formatPhoneDigitsForTTS(cleanDigits, { useSSML });
    
    if (useSSML) {
      return `<speak>I have your number as ${spoken}<break time="200ms"/><prosody pitch="+10%">Is that correct?</prosody></speak>`;
    }
    return `I have your number as ${spoken}. Is that correct?`;
  }

  if (attempt === 2) {
    const lastFour = formatPhoneLastFourForTTS(cleanDigits);
    
    if (callerConfused) {
      if (useSSML) {
        return `<speak><prosody rate="slow">No problem${name}. The last four digits are ${lastFour}.</prosody><break time="200ms"/><prosody pitch="+10%">Is that right?</prosody></speak>`;
      }
      return `No problem${name}. The last four digits are ${lastFour}. Is that right?`;
    }
    
    return `Just to double check, the last four are ${lastFour}. Correct?`;
  }

  // 3rd+ attempt: ask them to repeat
  return `I want to make sure we don't miss you${name}. What's the best number to reach you?`;
}

/**
 * Build address confirmation line based on attempt count
 * 
 * @param {Object} ctx
 * @param {Object|string} ctx.address - address object or string
 * @param {number} ctx.attempt - 1, 2, or 3+
 * @param {boolean} ctx.isReturningCustomer
 * @param {boolean} ctx.callerConfused
 * @param {string} ctx.customerName
 * @param {boolean} ctx.useSSML
 * @returns {string}
 */
function buildAddressConfirmation(ctx) {
  const { address, attempt = 1, isReturningCustomer, callerConfused, customerName, useSSML } = ctx;
  const spokenAddress = formatAddressForTTS(address, { useSSML });

  if (!spokenAddress) {
    return "What's the full address where we'll be sending the technician?";
  }

  const name = customerName ? `, ${customerName}` : '';

  if (attempt <= 1) {
    if (isReturningCustomer) {
      if (useSSML) {
        return `<speak><prosody pitch="+8%">I still have you at ${spokenAddress}.</prosody><break time="200ms"/>Is that still correct?</speak>`;
      }
      return `I still have you at ${spokenAddress}. Is that still correct?`;
    }
    
    if (useSSML) {
      return `<speak>And the service address is ${spokenAddress}<break time="200ms"/><prosody pitch="+10%">Is that correct?</prosody></speak>`;
    }
    return `And the service address is ${spokenAddress}. Is that correct?`;
  }

  if (attempt === 2) {
    if (callerConfused) {
      if (useSSML) {
        return `<speak><prosody rate="slow">No worries${name}, I'll say it again. ${spokenAddress}.</prosody><break time="200ms"/>Is that right?</speak>`;
      }
      return `No worries${name}, I'll say it again. ${spokenAddress}. Is that right?`;
    }
    return `Just to confirm, that's ${spokenAddress}. Correct?`;
  }

  // 3rd+ attempt
  return `I want to make sure we get this right${name}. Can you please say the full address one more time?`;
}

/**
 * Build time confirmation
 */
function buildTimeConfirmation(ctx) {
  const { time, attempt = 1, customerName, useSSML } = ctx;
  
  if (!time) {
    return "When would be the best time for us to come out?";
  }

  const name = customerName ? `, ${customerName}` : '';

  // Normalize common time phrases
  let spokenTime = time;
  if (/asap|soon|possible/i.test(time)) {
    spokenTime = 'as soon as possible';
  }

  if (attempt <= 1) {
    if (useSSML) {
      return `<speak>Perfect${name}. I have you down for ${spokenTime}.<break time="200ms"/><prosody pitch="+10%">Does that work?</prosody></speak>`;
    }
    return `Perfect${name}. I have you down for ${spokenTime}. Does that work?`;
  }

  return `Just to confirm, we're looking at ${spokenTime}. Is that right?`;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Build a confirmation line for any field type
 * 
 * @param {Object} ctx
 * @param {'phone'|'address'|'time'|'name'} ctx.fieldType
 * @param {*} ctx.value - field value
 * @param {number} ctx.attempt - confirmation attempt (1, 2, 3+)
 * @param {boolean} ctx.isReturningCustomer
 * @param {boolean} ctx.callerConfused - caller said "what?" or similar
 * @param {string} ctx.customerName - for personalization
 * @param {boolean} ctx.useSSML - wrap in SSML for prosody
 * @returns {string}
 */
function buildConfirmationLine(ctx) {
  const { fieldType, value, attempt = 1, isReturningCustomer, callerConfused, customerName, useSSML } = ctx;

  switch (fieldType) {
    case 'phone':
      return buildPhoneConfirmation({
        phone: value,
        attempt,
        callerConfused,
        customerName,
        useSSML
      });

    case 'address':
      return buildAddressConfirmation({
        address: value,
        attempt,
        isReturningCustomer,
        callerConfused,
        customerName,
        useSSML
      });

    case 'time':
      return buildTimeConfirmation({
        time: value,
        attempt,
        customerName,
        useSSML
      });

    case 'name':
      if (!value) return "May I have your name please?";
      return `Got it, ${value}. Nice to meet you!`;

    default:
      return 'Can you please confirm that for me?';
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SSML EMOTION WRAPPERS
// ════════════════════════════════════════════════════════════════════════════

const EMOTION_PROSODY = {
  empathetic: 'pitch="+12%" volume="soft" rate="slow"',
  apologetic: 'pitch="-5%" rate="slow"',
  excited: 'pitch="+15%" rate="fast"',
  confirmation: 'pitch="+10%"',
  gentle: 'pitch="+8%" rate="medium"',
  professional: 'pitch="+5%" rate="medium"'
};

/**
 * Wrap text in SSML with emotion-based prosody
 * 
 * @param {string} text - Plain text
 * @param {string} emotion - empathetic|apologetic|excited|confirmation|gentle|professional
 * @returns {string} - SSML wrapped text
 */
function wrapWithEmotion(text, emotion = 'professional') {
  const prosody = EMOTION_PROSODY[emotion] || EMOTION_PROSODY.professional;
  return `<speak><prosody ${prosody}>${text}</prosody></speak>`;
}

/**
 * Wrap text for empathy/apology situations
 */
function wrapEmpathetic(text) {
  return `<speak><prosody pitch="+12%" volume="soft" rate="slow">${text}</prosody></speak>`;
}

/**
 * Wrap text for positive/excited news
 */
function wrapExcited(text) {
  return `<speak><prosody pitch="+15%" rate="fast">${text}</prosody></speak>`;
}

module.exports = {
  // Main builders
  buildConfirmationLine,
  buildPhoneConfirmation,
  buildAddressConfirmation,
  buildTimeConfirmation,
  
  // Formatters
  formatPhoneDigitsForTTS,
  formatPhoneLastFourForTTS,
  formatHouseNumberForTTS,
  formatAddressForTTS,
  
  // SSML helpers
  wrapWithEmotion,
  wrapEmpathetic,
  wrapExcited,
  EMOTION_PROSODY,
  
  // Constants
  DIGIT_WORDS,
  SMALL_NUMBERS
};

