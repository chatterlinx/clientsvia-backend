/**
 * ============================================================================
 * COUNTER MODEL
 * ============================================================================
 * Atomic counter for auto-incrementing sequences per scope.
 * Used for generating unique, sequential displayIds for triggers.
 * 
 * Each counter is identified by a unique key (e.g., "trigger_displayId_<companyId>")
 * and stores the current sequence value.
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');

const counterSchema = new mongoose.Schema({
  _id: {
    type: String,
    required: true
  },
  seq: {
    type: Number,
    default: 0
  }
});

/**
 * Get the next sequence number for a given counter key.
 * Uses findOneAndUpdate with upsert for atomic increment.
 * 
 * @param {string} counterKey - Unique identifier for the counter (e.g., "trigger_displayId_<companyId>")
 * @returns {Promise<number>} - The next sequence number
 */
counterSchema.statics.getNextSequence = async function(counterKey) {
  const counter = await this.findOneAndUpdate(
    { _id: counterKey },
    { $inc: { seq: 1 } },
    { new: true, upsert: true }
  );
  return counter.seq;
};

/**
 * Get the current sequence number without incrementing.
 * 
 * @param {string} counterKey - Unique identifier for the counter
 * @returns {Promise<number>} - The current sequence number (0 if not exists)
 */
counterSchema.statics.getCurrentSequence = async function(counterKey) {
  const counter = await this.findOne({ _id: counterKey });
  return counter ? counter.seq : 0;
};

module.exports = mongoose.model('Counter', counterSchema);
