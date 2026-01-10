/**
 * Resume Booking Protocol (UI-controlled)
 *
 * After answering an off-rails question during BOOKING, we want to:
 * - Recap what is already collected (optionally including values)
 * - Ask the next slot question exactly as configured in bookingSlots
 *
 * This module is deterministic formatting only (no LLM).
 */

function buildResumeBookingBlock({
  resumeConfig,
  bookingSlots = [],
  collectedSlots = {},
  nextSlot = null, // { slotId, type, label, question }
  nextQuestion = ''
} = {}) {
  const cfg = normalizeResumeConfig(resumeConfig);
  if (!cfg.enabled) return null;

  const normalizedSlots = Array.isArray(bookingSlots) ? bookingSlots : [];
  const { collectedSummary, missingSummary } = summarizeSlots({
    bookingSlots: normalizedSlots,
    collectedSlots,
    includeValues: cfg.includeValues,
    itemTemplate: cfg.includeValues ? cfg.collectedItemTemplateWithValue : cfg.collectedItemTemplate,
    separator: cfg.separator,
    finalSeparator: cfg.finalSeparator
  });

  const nextSlotLabel = (nextSlot?.label || nextSlot?.slotId || nextSlot?.id || nextSlot?.type || '').toString();
  const safeNextQuestion = (nextQuestion || nextSlot?.question || '').toString();

  const out = (cfg.template || '')
    .replaceAll('{collectedSummary}', collectedSummary)
    .replaceAll('{missingSummary}', missingSummary)
    .replaceAll('{nextQuestion}', safeNextQuestion)
    .replaceAll('{nextSlotLabel}', nextSlotLabel);

  return cleanupWhitespace(out);
}

function summarizeSlots({
  bookingSlots,
  collectedSlots,
  includeValues,
  itemTemplate,
  separator,
  finalSeparator
}) {
  const collectedItems = [];
  const missingItems = [];

  const seen = new Set();
  for (const slot of bookingSlots) {
    const slotId = slot?.slotId || slot?.id || null;
    const slotType = slot?.type || null;
    if (!slotId && !slotType) continue;

    const key = slotId || slotType;
    if (seen.has(key)) continue;
    seen.add(key);

    const required = slot?.required !== false;
    if (!required) continue;

    const label = (slot?.label || slotId || slotType || '').toString();
    const value =
      (slotId && collectedSlots?.[slotId] != null ? collectedSlots[slotId] : null) ??
      (slotType && collectedSlots?.[slotType] != null ? collectedSlots[slotType] : null);

    if (value != null && String(value).trim() !== '') {
      collectedItems.push(formatItem({ label, value, includeValues, itemTemplate }));
    } else {
      missingItems.push(label);
    }
  }

  return {
    collectedSummary: joinHumanList(collectedItems, separator, finalSeparator),
    missingSummary: joinHumanList(missingItems, separator, finalSeparator)
  };
}

function formatItem({ label, value, includeValues, itemTemplate }) {
  const safeLabel = String(label || '').trim();
  const safeValue = String(value ?? '').trim();

  // Template is UI-controlled; we only do safe placeholder substitution
  return (itemTemplate || '{label}')
    .replaceAll('{label}', safeLabel)
    .replaceAll('{value}', includeValues ? safeValue : '');
}

function joinHumanList(items, separator = ', ', finalSeparator = ' and ') {
  const arr = Array.isArray(items) ? items.map(x => String(x || '').trim()).filter(Boolean) : [];
  if (arr.length === 0) return '';
  if (arr.length === 1) return arr[0];
  if (arr.length === 2) return `${arr[0]}${finalSeparator}${arr[1]}`;
  return `${arr.slice(0, -1).join(separator)}${finalSeparator}${arr[arr.length - 1]}`;
}

function normalizeResumeConfig(resumeConfig) {
  const cfg = resumeConfig && typeof resumeConfig === 'object' ? resumeConfig : {};

  return {
    enabled: cfg.enabled !== false,
    includeValues: cfg.includeValues === true,
    template: typeof cfg.template === 'string' ? cfg.template : '',
    collectedItemTemplate: typeof cfg.collectedItemTemplate === 'string' ? cfg.collectedItemTemplate : '{label}',
    collectedItemTemplateWithValue:
      typeof cfg.collectedItemTemplateWithValue === 'string' ? cfg.collectedItemTemplateWithValue : '{label}: {value}',
    separator: typeof cfg.separator === 'string' ? cfg.separator : ', ',
    finalSeparator: typeof cfg.finalSeparator === 'string' ? cfg.finalSeparator : ' and '
  };
}

function cleanupWhitespace(s) {
  // keep newlines, but normalize internal spacing
  return String(s || '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ \n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

module.exports = {
  buildResumeBookingBlock,
  // Export helpers for unit tests
  joinHumanList
};

