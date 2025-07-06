function normalizePhoneNumber(number) {
  if (!number) return null;
  const digits = String(number).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return digits.startsWith('+') ? digits : `+${digits}`;
}

function extractDigits(number) {
  if (!number) return '';
  return String(number).replace(/\D/g, '');
}

function numbersMatch(a, b) {
  const stripCountry = (digits) =>
    digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  const da = stripCountry(extractDigits(a));
  const db = stripCountry(extractDigits(b));
  return da && db && da === db;
}

module.exports = { normalizePhoneNumber, extractDigits, numbersMatch };
