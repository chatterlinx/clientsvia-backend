/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADDRESS NORMALIZER
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2 - Deduplication
 * Created: December 2, 2025
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Normalize addresses for comparison to prevent duplicate customer entries
 * when multiple household members call with the same address.
 * 
 * NORMALIZATION RULES:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Uppercase everything
 * 2. Remove punctuation
 * 3. Standardize street suffixes (Street → ST, Avenue → AVE)
 * 4. Standardize directionals (North → N, Southwest → SW)
 * 5. Remove unit/apt/suite for primary matching
 * 6. Trim and collapse whitespace
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════
// STREET SUFFIX MAPPINGS (USPS Standard)
// ═══════════════════════════════════════════════════════════════════════════

const STREET_SUFFIXES = {
  'STREET': 'ST',
  'STREETS': 'ST',
  'STR': 'ST',
  'AVENUE': 'AVE',
  'AVENU': 'AVE',
  'AVEN': 'AVE',
  'AVENUS': 'AVE',
  'BOULEVARD': 'BLVD',
  'BOUL': 'BLVD',
  'BLVRD': 'BLVD',
  'DRIVE': 'DR',
  'DRIV': 'DR',
  'DRV': 'DR',
  'ROAD': 'RD',
  'LANE': 'LN',
  'COURT': 'CT',
  'CIRCLE': 'CIR',
  'PLACE': 'PL',
  'PLAZA': 'PLZ',
  'TERRACE': 'TER',
  'TRAIL': 'TRL',
  'PARKWAY': 'PKWY',
  'HIGHWAY': 'HWY',
  'EXPRESSWAY': 'EXPY',
  'FREEWAY': 'FWY',
  'WAY': 'WAY',
  'POINT': 'PT',
  'ALLEY': 'ALY',
  'CROSSING': 'XING',
  'COVE': 'CV',
  'SQUARE': 'SQ',
  'LOOP': 'LOOP',
  'PATH': 'PATH',
  'PASS': 'PASS',
  'PIKE': 'PIKE',
  'RUN': 'RUN',
  'WALK': 'WALK'
};

// ═══════════════════════════════════════════════════════════════════════════
// DIRECTIONAL MAPPINGS
// ═══════════════════════════════════════════════════════════════════════════

const DIRECTIONALS = {
  'NORTH': 'N',
  'SOUTH': 'S',
  'EAST': 'E',
  'WEST': 'W',
  'NORTHEAST': 'NE',
  'NORTHWEST': 'NW',
  'SOUTHEAST': 'SE',
  'SOUTHWEST': 'SW'
};

// ═══════════════════════════════════════════════════════════════════════════
// UNIT DESIGNATORS (to strip for primary matching)
// ═══════════════════════════════════════════════════════════════════════════

const UNIT_DESIGNATORS = [
  'APT', 'APARTMENT', 'UNIT', 'SUITE', 'STE', 'ROOM', 'RM',
  'FLOOR', 'FL', 'BUILDING', 'BLDG', '#', 'NO', 'NUMBER'
];

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize an address for comparison
 * 
 * @param {Object|string} address - Address object or string
 * @returns {string} - Normalized address string for comparison
 */
function normalizeAddress(address) {
  if (!address) return null;
  
  let addressString;
  
  // Handle object vs string input
  if (typeof address === 'object') {
    // Build address string from object
    const parts = [
      address.street,
      address.city,
      address.state,
      address.zip
    ].filter(Boolean);
    addressString = parts.join(' ');
  } else {
    addressString = String(address);
  }
  
  if (!addressString || addressString.trim().length === 0) {
    return null;
  }
  
  // Step 1: Uppercase
  let normalized = addressString.toUpperCase();
  
  // Step 2: Remove punctuation (except #)
  normalized = normalized.replace(/[.,;:'"!?()]/g, '');
  
  // Step 3: Replace # with empty (we'll strip unit numbers anyway)
  normalized = normalized.replace(/#/g, ' ');
  
  // Step 4: Collapse whitespace
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  // Step 5: Standardize street suffixes
  const words = normalized.split(' ');
  const standardizedWords = words.map(word => {
    // Check street suffixes
    if (STREET_SUFFIXES[word]) {
      return STREET_SUFFIXES[word];
    }
    // Check directionals
    if (DIRECTIONALS[word]) {
      return DIRECTIONALS[word];
    }
    return word;
  });
  
  // Step 6: Remove unit designators and their values
  const cleanedWords = [];
  let skipNext = false;
  
  for (let i = 0; i < standardizedWords.length; i++) {
    const word = standardizedWords[i];
    
    if (skipNext) {
      skipNext = false;
      continue;
    }
    
    // Check if this is a unit designator
    const isUnitDesignator = UNIT_DESIGNATORS.some(ud => 
      word === ud || word.startsWith(ud)
    );
    
    if (isUnitDesignator) {
      // Skip this word and potentially the next (the unit number)
      const nextWord = standardizedWords[i + 1];
      if (nextWord && /^[A-Z0-9-]+$/.test(nextWord)) {
        skipNext = true;
      }
      continue;
    }
    
    cleanedWords.push(word);
  }
  
  return cleanedWords.join(' ');
}

/**
 * Normalize just the street address (for tighter matching)
 * 
 * @param {string} street - Street address only
 * @returns {string} - Normalized street
 */
function normalizeStreet(street) {
  if (!street) return null;
  
  let normalized = street.toUpperCase();
  normalized = normalized.replace(/[.,;:'"!?()#]/g, '');
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  const words = normalized.split(' ');
  const standardizedWords = words.map(word => {
    if (STREET_SUFFIXES[word]) return STREET_SUFFIXES[word];
    if (DIRECTIONALS[word]) return DIRECTIONALS[word];
    return word;
  });
  
  // Remove unit designators
  const cleanedWords = [];
  let skipNext = false;
  
  for (let i = 0; i < standardizedWords.length; i++) {
    const word = standardizedWords[i];
    if (skipNext) { skipNext = false; continue; }
    
    const isUnitDesignator = UNIT_DESIGNATORS.some(ud => word === ud || word.startsWith(ud));
    if (isUnitDesignator) {
      const nextWord = standardizedWords[i + 1];
      if (nextWord && /^[A-Z0-9-]+$/.test(nextWord)) skipNext = true;
      continue;
    }
    cleanedWords.push(word);
  }
  
  return cleanedWords.join(' ');
}

/**
 * Generate a comparison key for an address
 * Used for fast lookups in database
 * 
 * @param {Object} address - Address object with street, city, state, zip
 * @returns {string|null} - Comparison key or null
 */
function generateAddressKey(address) {
  if (!address || !address.street) return null;
  
  const normalizedStreet = normalizeStreet(address.street);
  const city = (address.city || '').toUpperCase().trim();
  const state = (address.state || '').toUpperCase().trim();
  const zip = (address.zip || '').replace(/\D/g, '').substring(0, 5);
  
  // Key format: STREET|CITY|STATE|ZIP5
  // Only include parts that exist
  const parts = [normalizedStreet];
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (zip) parts.push(zip);
  
  return parts.join('|');
}

/**
 * Check if two addresses match
 * 
 * @param {Object} addr1 - First address
 * @param {Object} addr2 - Second address
 * @param {Object} options - Matching options
 * @returns {Object} - { matches: boolean, confidence: number, matchType: string }
 */
function addressesMatch(addr1, addr2, options = {}) {
  const {
    requireZip = false,
    requireCity = true,
    fuzzyStreet = false
  } = options;
  
  if (!addr1 || !addr2) {
    return { matches: false, confidence: 0, matchType: 'none' };
  }
  
  const street1 = normalizeStreet(addr1.street);
  const street2 = normalizeStreet(addr2.street);
  const city1 = (addr1.city || '').toUpperCase().trim();
  const city2 = (addr2.city || '').toUpperCase().trim();
  const state1 = (addr1.state || '').toUpperCase().trim();
  const state2 = (addr2.state || '').toUpperCase().trim();
  const zip1 = (addr1.zip || '').replace(/\D/g, '').substring(0, 5);
  const zip2 = (addr2.zip || '').replace(/\D/g, '').substring(0, 5);
  
  // Must have streets to compare
  if (!street1 || !street2) {
    return { matches: false, confidence: 0, matchType: 'no_street' };
  }
  
  // Street must match
  const streetMatches = street1 === street2;
  if (!streetMatches) {
    return { matches: false, confidence: 0, matchType: 'street_mismatch' };
  }
  
  // Calculate confidence based on what else matches
  let confidence = 0.5; // Base: street matches
  let matchType = 'street_only';
  
  // City match
  if (city1 && city2) {
    if (city1 === city2) {
      confidence += 0.2;
      matchType = 'street_city';
    } else if (requireCity) {
      return { matches: false, confidence: 0, matchType: 'city_mismatch' };
    }
  }
  
  // State match
  if (state1 && state2 && state1 === state2) {
    confidence += 0.1;
    matchType = 'street_city_state';
  }
  
  // Zip match (strongest signal)
  if (zip1 && zip2) {
    if (zip1 === zip2) {
      confidence += 0.2;
      matchType = 'full_match';
    } else if (requireZip) {
      return { matches: false, confidence: 0, matchType: 'zip_mismatch' };
    }
  }
  
  return {
    matches: confidence >= 0.7,  // Require at least street + city
    confidence,
    matchType
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  normalizeAddress,
  normalizeStreet,
  generateAddressKey,
  addressesMatch,
  STREET_SUFFIXES,
  DIRECTIONALS,
  UNIT_DESIGNATORS
};

