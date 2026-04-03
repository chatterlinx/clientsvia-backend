'use strict';

/**
 * KC Discovery Engine — Barrel Exports
 *
 * Provides a single import point for the KC engine module.
 * Each export is also importable directly from its own file.
 *
 * Usage:
 *   const { KCDiscoveryRunner, KCBookingIntentDetector } = require('./kc');
 */

module.exports = {
  KCDiscoveryRunner:       require('./KCDiscoveryRunner'),
  KCBookingIntentDetector: require('./KCBookingIntentDetector'),
};
