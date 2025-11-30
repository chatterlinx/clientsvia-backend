/**
 * ============================================================================
 * MURMURHASH3 - FAST NON-CRYPTOGRAPHIC HASH
 * ============================================================================
 * 
 * PURPOSE: Generate version hashes for cache keys
 * ARCHITECTURE: MurmurHash3 32-bit implementation
 * PERFORMANCE: ~1μs per hash
 * 
 * USE CASE:
 *   const hash = murmurhash('my-string-to-hash');
 *   // Returns: 'a3f2b8c1' (8-char hex string)
 * 
 * WHY MURMURHASH vs MD5/SHA:
 * - 10x faster than MD5
 * - Good distribution (low collision rate)
 * - Non-cryptographic (we don't need security, just uniqueness)
 * 
 * ============================================================================
 */

/**
 * MurmurHash3 32-bit implementation
 * 
 * @param {string} key - String to hash
 * @param {number} seed - Hash seed (default: 0)
 * @returns {string} 8-character hex hash
 */
function murmurhash(key, seed = 0) {
  const remainder = key.length & 3; // key.length % 4
  const bytes = key.length - remainder;
  let h1 = seed;
  const c1 = 0xcc9e2d51;
  const c2 = 0x1b873593;
  let i = 0;
  let k1, h1b;
  
  // Process 4-byte blocks
  while (i < bytes) {
    k1 = 
      ((key.charCodeAt(i) & 0xff)) |
      ((key.charCodeAt(++i) & 0xff) << 8) |
      ((key.charCodeAt(++i) & 0xff) << 16) |
      ((key.charCodeAt(++i) & 0xff) << 24);
    ++i;
    
    k1 = ((((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16))) & 0xffffffff;
    k1 = (k1 << 15) | (k1 >>> 17);
    k1 = ((((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16))) & 0xffffffff;
    
    h1 ^= k1;
    h1 = (h1 << 13) | (h1 >>> 19);
    h1b = ((((h1 & 0xffff) * 5) + ((((h1 >>> 16) * 5) & 0xffff) << 16))) & 0xffffffff;
    h1 = (((h1b & 0xffff) + 0x6b64) + ((((h1b >>> 16) + 0xe654) & 0xffff) << 16));
  }
  
  // Process remaining bytes
  k1 = 0;
  
  switch (remainder) {
    case 3:
      k1 ^= (key.charCodeAt(i + 2) & 0xff) << 16;
      // fall through
    case 2:
      k1 ^= (key.charCodeAt(i + 1) & 0xff) << 8;
      // fall through
    case 1:
      k1 ^= (key.charCodeAt(i) & 0xff);
      k1 = (((k1 & 0xffff) * c1) + ((((k1 >>> 16) * c1) & 0xffff) << 16)) & 0xffffffff;
      k1 = (k1 << 15) | (k1 >>> 17);
      k1 = (((k1 & 0xffff) * c2) + ((((k1 >>> 16) * c2) & 0xffff) << 16)) & 0xffffffff;
      h1 ^= k1;
  }
  
  // Finalization
  h1 ^= key.length;
  h1 ^= h1 >>> 16;
  h1 = (((h1 & 0xffff) * 0x85ebca6b) + ((((h1 >>> 16) * 0x85ebca6b) & 0xffff) << 16)) & 0xffffffff;
  h1 ^= h1 >>> 13;
  h1 = ((((h1 & 0xffff) * 0xc2b2ae35) + ((((h1 >>> 16) * 0xc2b2ae35) & 0xffff) << 16))) & 0xffffffff;
  h1 ^= h1 >>> 16;
  
  // Convert to hex string (8 characters)
  return (h1 >>> 0).toString(16).padStart(8, '0');
}

/**
 * Hash an object (converts to JSON first)
 * 
 * @param {Object} obj - Object to hash
 * @returns {string} 8-character hex hash
 */
function murmurhashObject(obj) {
  const json = JSON.stringify(obj);
  return murmurhash(json);
}

module.exports = { murmurhash, murmurhashObject };

