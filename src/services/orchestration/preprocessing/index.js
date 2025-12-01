/**
 * ============================================================================
 * PREPROCESSING LAYER - EXPORTS
 * ============================================================================
 * 
 * PURPOSE: Text cleaning and normalization before intelligent processing
 * 
 * COMPONENTS:
 * - FillerStripper: Remove filler words ("um", "uh", "like")
 * - TranscriptNormalizer: Standardize spelling and punctuation
 * 
 * USAGE:
 * const { FillerStripper, TranscriptNormalizer } = require('./preprocessing');
 * 
 * let text = "uh my like a/c is um broken";
 * text = FillerStripper.clean(text);        // "my a/c is broken"
 * text = TranscriptNormalizer.normalize(text); // "my AC is broken"
 * 
 * ============================================================================
 */

module.exports = {
  FillerStripper: require('./FillerStripper'),
  TranscriptNormalizer: require('./TranscriptNormalizer')
};

