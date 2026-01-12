/**
 * Confirmation request detection (deterministic)
 *
 * Detects when a caller asks to confirm what the agent captured:
 * - "did you get my name right"
 * - "can you repeat my phone number"
 * - "is that address correct"
 *
 * Returns which slot type they are asking to confirm: name | phone | address | time | null
 */

function detectConfirmationRequest(text, { triggers = [] } = {}) {
  if (!text || typeof text !== 'string') return null;
  const t = text.toLowerCase().trim();
  if (!t) return null;

  const trig = Array.isArray(triggers) ? triggers.filter(Boolean).map(s => String(s).toLowerCase()) : [];
  const hasTrigger = trig.length === 0 ? false : trig.some(p => p && t.includes(p));

  // If we don't have triggers (misconfigured), fall back to conservative pattern match.
  // Allow a short gap between "is that" and "right/correct" so phrases like
  // "is that address correct" or "is that phone number right" are caught.
  const fallbackPattern =
    /\b(did you (get|catch)|can you (repeat|confirm|read))\b/i.test(text) ||
    (/\bis that\b/i.test(text) && /\b(right|correct)\b/i.test(text)) ||
    // Common direct asks without "confirm": "what's my phone", "what is my last name"
    /\b(what's|what is)\s+my\b/i.test(text) ||
    /\b(do you have|can you tell me)\s+my\b/i.test(text);
  // If triggers are configured, we treat ANY match as a confirmation request,
  // even if it doesn't match the smaller fallbackPattern set.
  if (!hasTrigger && !fallbackPattern) return null;

  // Slot-type intent from keywords
  if (/\b(name)\b/i.test(text)) return 'name';
  if (/\b(phone|number|callback)\b/i.test(text)) return 'phone';
  if (/\b(address|location|service address)\b/i.test(text)) return 'address';
  if (/\b(time|date|appointment)\b/i.test(text)) return 'time';

  // No explicit slot keyword; treat as generic confirmation request
  return 'unknown';
}

module.exports = { detectConfirmationRequest };

