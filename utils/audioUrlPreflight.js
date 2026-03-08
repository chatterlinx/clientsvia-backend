/**
 * Audio URL Preflight — validates that an HTTP(S) audio URL is reachable.
 *
 * Used to prevent stale / broken card audio URLs from blocking ElevenLabs
 * synthesis.  When an HTTP URL fails preflight, the caller should treat
 * the audioUrl as null so the TTS synthesis guard runs normally.
 */

const axios = require('axios');
const logger = require('./logger');

/**
 * HEAD-check an HTTP(S) audio URL with a tight timeout.
 *
 * @param {string}  url
 * @param {object}  [opts]
 * @param {number}  [opts.timeoutMs=2000] — ceiling per attempt
 * @returns {Promise<boolean>}  true when reachable (2xx / 3xx), false otherwise
 */
async function isAudioUrlReachable(url, { timeoutMs = 2000 } = {}) {
  if (!url || typeof url !== 'string' || !url.startsWith('http')) return false;
  try {
    await axios.head(url, {
      timeout: timeoutMs,
      maxRedirects: 3,
      validateStatus: (s) => s >= 200 && s < 400,
    });
    return true;
  } catch (err) {
    logger.warn('[AudioPreflight] URL unreachable', {
      url: url.substring(0, 120),
      error: err.message,
      code: err.code || null,
    });
    return false;
  }
}

module.exports = { isAudioUrlReachable };
