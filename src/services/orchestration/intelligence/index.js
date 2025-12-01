/**
 * ============================================================================
 * INTELLIGENCE LAYER - EXPORTS
 * ============================================================================
 * 
 * PURPOSE: Emotion detection and context analysis
 * 
 * COMPONENTS:
 * - EmotionDetector: Pattern-based emotion classification
 * 
 * USAGE:
 * const { EmotionDetector } = require('./intelligence');
 * 
 * const emotion = EmotionDetector.analyze("I'm so frustrated!", callerHistory);
 * // Returns: { primary: "FRUSTRATED", intensity: 0.85, signals: [...] }
 * 
 * ============================================================================
 */

module.exports = {
  EmotionDetector: require('./EmotionDetector')
};

