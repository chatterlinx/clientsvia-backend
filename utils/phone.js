function normalizePhoneNumber(number) {
  if (!number) {return null;}
  const digits = String(number).replace(/\D/g, '');
  if (!digits) {return null;}
  if (digits.length === 10) {return `+1${digits}`;}
  if (digits.length === 11 && digits.startsWith('1')) {return `+${digits}`;}
  return digits.startsWith('+') ? digits : `+${digits}`;
}

/**
 * Extract a US phone number from free-form text.
 *
 * Returns a human-friendly formatted number:
 * - 10 digits: "(AAA) BBB-CCCC"
 * - 11 digits starting with 1: "(AAA) BBB-CCCC"
 * - 7 digits: "BBB-CCCC" (local; area code missing)
 *
 * NOTE: For 11 digits NOT starting with 1, we assume the *extra* digit is a typo.
 * In real calls the extra digit is far more commonly at the end (double-tap),
 * so we prefer the FIRST 10 digits (not the last 10).
 */
function extractPhoneFromText(text) {
  if (!text || typeof text !== 'string') return null;

  // Remove common words that might confuse extraction
  const cleaned = text.replace(/\b(phone|number|is|my|the|at|reach|me|call)\b/gi, ' ');
  const digits = cleaned.replace(/\D/g, '');
  if (!digits) return null;

  const format10 = (ten) => ten.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');

  // 10 digits - perfect US phone number
  if (digits.length === 10) return format10(digits);

  // 11 digits starting with 1 - US with country code
  if (digits.length === 11 && digits.startsWith('1')) return format10(digits.slice(1));

  // 11 digits NOT starting with 1 - likely typo (extra digit)
  // Prefer first 10 digits (common "extra digit at end" behavior).
  if (digits.length === 11 && !digits.startsWith('1')) return format10(digits.slice(0, 10));

  // 7 digits - local number (missing area code)
  if (digits.length === 7) return digits.replace(/(\d{3})(\d{4})/, '$1-$2');

  // 8-9 digits are partial; 12+ digits are too many/ambiguous
  return null;
}

function extractDigits(number) {
  if (!number) {return '';}
  return String(number).replace(/\D/g, '');
}

function numbersMatch(a, b) {
  const stripCountry = (digits) =>
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  const da = stripCountry(extractDigits(a));
  const db = stripCountry(extractDigits(b));
  return da && db && da === db;
}

module.exports = { normalizePhoneNumber, extractPhoneFromText, extractDigits, numbersMatch };
