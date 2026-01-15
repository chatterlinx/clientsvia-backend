const CITY_PREFIXES = [
  "that's in ",
  "that is in ",
  "its in ",
  "it's in ",
  "in "
];

function normalizeCityStatePhrase(raw) {
  if (!raw) return '';
  let text = String(raw).trim();
  const lower = text.toLowerCase();

  for (const prefix of CITY_PREFIXES) {
    if (lower.startsWith(prefix)) {
      text = text.slice(prefix.length).trim();
      break;
    }
  }

  text = text.replace(/^[,.\s]+/, '').replace(/[.,\s]+$/, '');
  return text;
}

function parseCityStatePhrase(raw) {
  const cleaned = normalizeCityStatePhrase(raw);
  if (!cleaned) return { city: null, state: null };

  const commaIndex = cleaned.indexOf(',');
  if (commaIndex !== -1) {
    const city = cleaned.slice(0, commaIndex).trim();
    const state = cleaned.slice(commaIndex + 1).trim();
    return { city: city || null, state: state || null };
  }

  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const state = parts.pop();
    const city = parts.join(' ');
    return { city: city || null, state: state || null };
  }

  return { city: cleaned, state: null };
}

function combineAddressParts(street, city, state) {
  const safeStreet = String(street || '').trim().replace(/[.,\s]+$/, '');
  const parts = [safeStreet, city, state].filter(Boolean);
  return parts.join(', ').trim();
}

module.exports = {
  normalizeCityStatePhrase,
  parseCityStatePhrase,
  combineAddressParts
};
