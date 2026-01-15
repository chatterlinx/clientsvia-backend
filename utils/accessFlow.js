function normalizeAnswer(text) {
  return String(text || '').trim().toLowerCase();
}

function isAffirmative(text) {
  return /^(yes|yeah|yep|sure|correct|right|affirmative|ok|okay|yup|uh huh|mhm)/i.test(String(text || '').trim());
}

function isNegative(text) {
  return /^(no|nope|nah|negative|not really|not|don't|do not|isn't|is not)/i.test(String(text || '').trim());
}

function normalizePropertyType(text) {
  const lower = normalizeAnswer(text);
  if (!lower) return null;

  if (/(condo|townhome|town home)/i.test(lower)) return 'condo/townhome';
  if (/(apartment|apt|unit\s+apartment)/i.test(lower)) return 'apartment';
  if (/(mobile home|trailer)/i.test(lower)) return 'mobile_home';
  if (/(commercial|business|office|store|retail|warehouse)/i.test(lower)) return 'commercial';
  if (/(house|single family|home)/i.test(lower)) return 'house';
  if (/(other|not sure|dont know|don't know|unsure)/i.test(lower)) return 'other';

  return null;
}

function parseGateAccessType(text) {
  const lower = normalizeAnswer(text);
  if (!lower) return [];
  const hasCode = /(code|keypad|pin)/i.test(lower);
  const hasGuard = /(guard|security|front gate|gate attendant)/i.test(lower);
  if (hasCode && hasGuard) return ['code', 'guard'];
  if (hasCode) return ['code'];
  if (hasGuard) return ['guard'];
  return [];
}

function normalizeUnitValue(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  return raw.replace(/^(unit|apt|apartment|suite|ste|#)\s*/i, '').trim();
}

function buildAccessSnapshot(addressMeta = {}) {
  return {
    property: {
      type: addressMeta.propertyType || null,
      unit: addressMeta.unit || null,
      unitNotApplicable: addressMeta.unitNotApplicable || false
    },
    access: {
      gatedCommunity: addressMeta.access?.gatedCommunity ?? null,
      gateAccessType: Array.isArray(addressMeta.access?.gateAccessType) ? addressMeta.access.gateAccessType : [],
      gateCode: addressMeta.access?.gateCode || null,
      gateGuardNotifyRequired: addressMeta.access?.gateGuardNotifyRequired || false,
      gateGuardNotes: addressMeta.access?.gateGuardNotes || null,
      additionalInstructions: addressMeta.access?.additionalInstructions || null,
      unitResolution: addressMeta.access?.unitResolution || null,
      accessResolution: addressMeta.access?.accessResolution || null
    }
  };
}

module.exports = {
  isAffirmative,
  isNegative,
  normalizePropertyType,
  parseGateAccessType,
  normalizeUnitValue,
  buildAccessSnapshot
};
