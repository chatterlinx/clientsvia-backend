/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ADDRESS NORMALIZER
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 2, 2025
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Generate consistent address keys for customer deduplication.
 * 
 * When a husband and wife call from different phones but the same address,
 * this ensures we recognize them as the same household.
 * 
 * Example:
 *   "123 Main Street, Apt 4B" → "123 MAIN ST|MIAMI|FL|33101"
 *   "123 main st #4B"         → "123 MAIN ST|MIAMI|FL|33101"
 *   Both generate the SAME key = same household
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const logger = require('./logger');

// ═══════════════════════════════════════════════════════════════════════════
// STREET SUFFIX NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════

const STREET_SUFFIXES = {
  // Common suffixes
  'STREET': 'ST',
  'STR': 'ST',
  'AVENUE': 'AVE',
  'AVEN': 'AVE',
  'BOULEVARD': 'BLVD',
  'BLVRD': 'BLVD',
  'DRIVE': 'DR',
  'DRIV': 'DR',
  'ROAD': 'RD',
  'LANE': 'LN',
  'COURT': 'CT',
  'CIRCLE': 'CIR',
  'PLACE': 'PL',
  'TERRACE': 'TER',
  'TRAIL': 'TRL',
  'PARKWAY': 'PKWY',
  'HIGHWAY': 'HWY',
  'WAY': 'WAY',
  'EXPRESSWAY': 'EXPY',
  'FREEWAY': 'FWY',
  
  // Directional
  'NORTH': 'N',
  'SOUTH': 'S',
  'EAST': 'E',
  'WEST': 'W',
  'NORTHEAST': 'NE',
  'NORTHWEST': 'NW',
  'SOUTHEAST': 'SE',
  'SOUTHWEST': 'SW'
};

// Unit designators to strip (we ignore units for household matching)
const UNIT_PATTERNS = [
  /\s*(APT|APARTMENT|UNIT|STE|SUITE|#|NO|NUMBER|BLDG|BUILDING|FL|FLOOR|RM|ROOM)\s*[A-Z0-9\-]+\s*$/i,
  /\s*#\s*[A-Z0-9\-]+\s*$/i,
  /\s+[A-Z]$/i  // Single letter at end (e.g., "123 Main St A")
];

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a normalized address key for deduplication
 * 
 * @param {Object} address - Address object
 * @param {string} address.street - Street address
 * @param {string} [address.city] - City
 * @param {string} [address.state] - State (2-letter)
 * @param {string} [address.zip] - ZIP code
 * @returns {string|null} - Normalized key like "123 MAIN ST|MIAMI|FL|33101" or null if invalid
 */
function generateAddressKey(address) {
  if (!address || !address.street) {
    return null;
  }
  
  try {
    const normalizedStreet = normalizeStreet(address.street);
    const normalizedCity = normalizeCity(address.city);
    const normalizedState = normalizeState(address.state);
    const normalizedZip = normalizeZip(address.zip);
    
    if (!normalizedStreet) {
      logger.debug('[ADDRESS_NORMALIZER] Street normalization failed', { street: address.street });
      return null;
    }
    
    // Build key: STREET|CITY|STATE|ZIP
    // Only include parts that exist
    const parts = [normalizedStreet];
    
    if (normalizedCity) parts.push(normalizedCity);
    if (normalizedState) parts.push(normalizedState);
    if (normalizedZip) parts.push(normalizedZip);
    
    const key = parts.join('|');
    
    logger.debug('[ADDRESS_NORMALIZER] Generated key', {
      input: address,
      output: key
    });
    
    return key;
    
  } catch (error) {
    logger.error('[ADDRESS_NORMALIZER] Error generating key', {
      error: error.message,
      address
    });
    return null;
  }
}

/**
 * Normalize street address
 * 
 * @param {string} street - Raw street address
 * @returns {string|null} - Normalized street or null
 */
function normalizeStreet(street) {
  if (!street || typeof street !== 'string') {
    return null;
  }
  
  let normalized = street.trim().toUpperCase();
  
  // Remove unit/apartment designators
  for (const pattern of UNIT_PATTERNS) {
    normalized = normalized.replace(pattern, '');
  }
  
  // Remove punctuation except hyphens in numbers
  normalized = normalized.replace(/[.,#]/g, '');
  
  // Normalize multiple spaces
  normalized = normalized.replace(/\s+/g, ' ').trim();
  
  // Normalize street suffixes
  const words = normalized.split(' ');
  const normalizedWords = words.map(word => {
    return STREET_SUFFIXES[word] || word;
  });
  
  normalized = normalizedWords.join(' ');
  
  // Remove trailing directionals that might be duplicates
  // e.g., "123 N MAIN ST N" → "123 N MAIN ST"
  const lastWord = normalizedWords[normalizedWords.length - 1];
  const secondLastWord = normalizedWords[normalizedWords.length - 2];
  if (['N', 'S', 'E', 'W', 'NE', 'NW', 'SE', 'SW'].includes(lastWord) &&
      ['ST', 'AVE', 'BLVD', 'DR', 'RD', 'LN', 'CT', 'CIR', 'PL', 'TER', 'TRL', 'PKWY', 'HWY', 'WAY'].includes(secondLastWord)) {
    normalized = normalizedWords.slice(0, -1).join(' ');
  }
  
  return normalized || null;
}

/**
 * Normalize city name
 * 
 * @param {string} city - Raw city name
 * @returns {string|null} - Normalized city or null
 */
function normalizeCity(city) {
  if (!city || typeof city !== 'string') {
    return null;
  }
  
  let normalized = city.trim().toUpperCase();
  
  // Remove punctuation
  normalized = normalized.replace(/[.,]/g, '');
  
  // Normalize common abbreviations
  const cityAbbreviations = {
    'SAINT': 'ST',
    'FORT': 'FT',
    'MOUNT': 'MT',
    'NORTH': 'N',
    'SOUTH': 'S',
    'EAST': 'E',
    'WEST': 'W'
  };
  
  const words = normalized.split(' ');
  const normalizedWords = words.map(word => cityAbbreviations[word] || word);
  
  return normalizedWords.join(' ') || null;
}

/**
 * Normalize state
 * 
 * @param {string} state - State (abbreviation or full name)
 * @returns {string|null} - 2-letter state code or null
 */
function normalizeState(state) {
  if (!state || typeof state !== 'string') {
    return null;
  }
  
  const normalized = state.trim().toUpperCase();
  
  // If already 2 letters, return as-is
  if (/^[A-Z]{2}$/.test(normalized)) {
    return normalized;
  }
  
  // State name to abbreviation mapping
  const stateMap = {
    'ALABAMA': 'AL', 'ALASKA': 'AK', 'ARIZONA': 'AZ', 'ARKANSAS': 'AR',
    'CALIFORNIA': 'CA', 'COLORADO': 'CO', 'CONNECTICUT': 'CT', 'DELAWARE': 'DE',
    'FLORIDA': 'FL', 'GEORGIA': 'GA', 'HAWAII': 'HI', 'IDAHO': 'ID',
    'ILLINOIS': 'IL', 'INDIANA': 'IN', 'IOWA': 'IA', 'KANSAS': 'KS',
    'KENTUCKY': 'KY', 'LOUISIANA': 'LA', 'MAINE': 'ME', 'MARYLAND': 'MD',
    'MASSACHUSETTS': 'MA', 'MICHIGAN': 'MI', 'MINNESOTA': 'MN', 'MISSISSIPPI': 'MS',
    'MISSOURI': 'MO', 'MONTANA': 'MT', 'NEBRASKA': 'NE', 'NEVADA': 'NV',
    'NEW HAMPSHIRE': 'NH', 'NEW JERSEY': 'NJ', 'NEW MEXICO': 'NM', 'NEW YORK': 'NY',
    'NORTH CAROLINA': 'NC', 'NORTH DAKOTA': 'ND', 'OHIO': 'OH', 'OKLAHOMA': 'OK',
    'OREGON': 'OR', 'PENNSYLVANIA': 'PA', 'RHODE ISLAND': 'RI', 'SOUTH CAROLINA': 'SC',
    'SOUTH DAKOTA': 'SD', 'TENNESSEE': 'TN', 'TEXAS': 'TX', 'UTAH': 'UT',
    'VERMONT': 'VT', 'VIRGINIA': 'VA', 'WASHINGTON': 'WA', 'WEST VIRGINIA': 'WV',
    'WISCONSIN': 'WI', 'WYOMING': 'WY', 'DISTRICT OF COLUMBIA': 'DC',
    'PUERTO RICO': 'PR', 'GUAM': 'GU', 'VIRGIN ISLANDS': 'VI'
  };
  
  return stateMap[normalized] || null;
}

/**
 * Normalize ZIP code
 * 
 * @param {string} zip - Raw ZIP code
 * @returns {string|null} - 5-digit ZIP or null
 */
function normalizeZip(zip) {
  if (!zip || typeof zip !== 'string') {
    return null;
  }
  
  // Extract digits only
  const digits = zip.replace(/\D/g, '');
  
  // Return first 5 digits (ignore +4)
  if (digits.length >= 5) {
    return digits.substring(0, 5);
  }
  
  return null;
}

/**
 * Compare two addresses for similarity
 * 
 * @param {Object} addr1 - First address
 * @param {Object} addr2 - Second address
 * @returns {Object} - { isMatch: boolean, confidence: number, matchType: string }
 */
function compareAddresses(addr1, addr2) {
  const key1 = generateAddressKey(addr1);
  const key2 = generateAddressKey(addr2);
  
  if (!key1 || !key2) {
    return { isMatch: false, confidence: 0, matchType: 'invalid' };
  }
  
  // Exact match
  if (key1 === key2) {
    return { isMatch: true, confidence: 1.0, matchType: 'exact' };
  }
  
  // Check if street + ZIP match (city might be spelled differently)
  const parts1 = key1.split('|');
  const parts2 = key2.split('|');
  
  const street1 = parts1[0];
  const street2 = parts2[0];
  const zip1 = parts1[parts1.length - 1];
  const zip2 = parts2[parts2.length - 1];
  
  if (street1 === street2 && zip1 === zip2 && /^\d{5}$/.test(zip1)) {
    return { isMatch: true, confidence: 0.95, matchType: 'street_zip' };
  }
  
  // Street only match (same building, different city name spelling)
  if (street1 === street2) {
    return { isMatch: true, confidence: 0.7, matchType: 'street_only' };
  }
  
  return { isMatch: false, confidence: 0, matchType: 'no_match' };
}

/**
 * Extract street number from address
 * 
 * @param {string} street - Street address
 * @returns {string|null} - Street number or null
 */
function extractStreetNumber(street) {
  if (!street) return null;
  
  const match = street.match(/^\s*(\d+[\-\d]*)/);
  return match ? match[1] : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  generateAddressKey,
  normalizeStreet,
  normalizeCity,
  normalizeState,
  normalizeZip,
  compareAddresses,
  extractStreetNumber
};
