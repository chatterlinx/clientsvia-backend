/**
 * BehaviorEngine.js - Applies behavior rules and policies to agent responses
 * 
 * Handles:
 * - Silence policy (warnings and hangups)
 * - Barge-in behavior
 * - Emotion acknowledgment
 * - Escalation handling
 * - Voice tone and pace control
 * - Response decoration based on company settings
 */

// LLMClient removed - using pure in-house system

class BehaviorEngine {
  /**
   * Apply behavior rules to a response
   * @param {Object} config - Company AI configuration
   * @param {Object} callState - Current call state (silences, interruptions, etc.)
   * @param {Object} answer - The answer object with text and metadata
   * @param {Object} context - Additional context (intent, emotion, etc.)
   * @returns {Object} Enhanced response with behavior controls
   */
  static async apply(config, callState, answer, context = {}) {
    try {
      const behaviors = config.behaviorControls || {};
      const agentPersonality = config.agentPersonality || {};
      
      let finalText = answer.text;
      let shouldEscalate = false;
      let shouldHangup = false;
      let controlFlags = {};

      // Handle silence policy
      if (behaviors.silencePolicy?.enabled) {
        const silenceResult = this.handleSilencePolicy(behaviors.silencePolicy, callState);
        if (silenceResult.action === 'warn') {
          finalText = silenceResult.message;
        } else if (silenceResult.action === 'hangup') {
          shouldHangup = true;
          finalText = silenceResult.message;
        }
      }

      // Handle emotion acknowledgment
      if (behaviors.emotionAcknowledgment?.enabled && context.detectedEmotion) {
        finalText = await this.addEmotionAcknowledgment(
          finalText, 
          context.detectedEmotion, 
          behaviors.emotionAcknowledgment,
          config
        );
      }

      // Handle escalation policy
      if (behaviors.escalationPolicy?.enabled) {
        const escalationResult = this.checkEscalation(
          answer, 
          context, 
          behaviors.escalationPolicy
        );
        if (escalationResult.shouldEscalate) {
          shouldEscalate = true;
          finalText = escalationResult.message || behaviors.escalationPolicy.message;
        }
      }

      // Apply agent personality to response
      if (agentPersonality.enabled && !shouldEscalate && !shouldHangup) {
        finalText = this.applyPersonality(finalText, agentPersonality);
      }

      // Set voice control flags
      controlFlags = {
        pace: agentPersonality.voice?.pace || 'normal',
        tone: agentPersonality.voice?.tone || 'neutral',
        volume: agentPersonality.voice?.volume || 'normal',
        bargeInEnabled: behaviors.bargeInHandling?.enabled || false,
        maxSpeechDuration: behaviors.bargeInHandling?.maxSpeechDuration || 30000
      };

      return {
        text: finalText,
        shouldEscalate,
        shouldHangup,
        controlFlags,
        metadata: {
          originalText: answer.text,
          appliedBehaviors: this.getAppliedBehaviors(behaviors, context),
          callState: callState,
          companyID: context.companyID // Ensure company isolation
        }
      };
    } catch (error) {
      console.error('Error in BehaviorEngine.apply:', error);
      throw error;
    }
  }

  /**
   * Handle silence policy logic
   */
  static handleSilencePolicy(silencePolicy, callState) {
    const silenceCount = callState.consecutiveSilences || 0;
    const maxSilences = silencePolicy.maxSilences || 3;
    const warningThreshold = silencePolicy.warningThreshold || 2;

    if (silenceCount >= maxSilences) {
      return {
        action: 'hangup',
        message: silencePolicy.hangupMessage || 
          "I haven't heard from you. I'll end this call now. Please call back when you're ready to speak."
      };
    } else if (silenceCount >= warningThreshold) {
      return {
        action: 'warn',
        message: silencePolicy.warningMessage || 
          "I'm still here. Are you there? Please let me know how I can help you."
      };
    }

    return { action: 'continue' };
  }

  /**
   * Add emotion acknowledgment to response
   */
  static async addEmotionAcknowledgment(text, emotion, emotionConfig, config) {
    const acknowledgments = emotionConfig.responses || {
      frustrated: "I understand you're frustrated. Let me help you with that.",
      angry: "I hear that you're upset. I want to make this right for you.",
      confused: "I can sense some confusion. Let me clarify that for you.",
      happy: "I'm glad to hear the positive tone! Let me help you further.",
      neutral: ""
    };

    const ack = acknowledgments[emotion] || acknowledgments.neutral;
    if (!ack) return text;

    // If personality is enabled, adjust acknowledgment tone
    if (config.agentPersonality?.enabled) {
      const adjustedAck = this.applyPersonality(ack, config.agentPersonality);
      return `${adjustedAck} ${text}`;
    }

    return `${ack} ${text}`;
  }

  /**
   * Check if response should trigger escalation
   */
  static checkEscalation(answer, context, escalationPolicy) {
    const score = answer.score || 0;
    const confidenceFloor = escalationPolicy.confidenceFloor || 0.3;
    const keywords = escalationPolicy.keywords || ['speak to human', 'manager', 'supervisor'];

    // Low confidence score
    if (score < confidenceFloor) {
      return {
        shouldEscalate: true,
        reason: 'low_confidence',
        message: escalationPolicy.lowConfidenceMessage
      };
    }

    // Keyword-based escalation
    const userText = context.userText?.toLowerCase() || '';
    const hasEscalationKeyword = keywords.some(keyword => 
      userText.includes(keyword.toLowerCase())
    );

    if (hasEscalationKeyword) {
      return {
        shouldEscalate: true,
        reason: 'keyword_trigger',
        message: escalationPolicy.keywordMessage
      };
    }

    // Multiple failed attempts
    const failedAttempts = context.failedAttempts || 0;
    const maxAttempts = escalationPolicy.maxFailedAttempts || 3;
    
    if (failedAttempts >= maxAttempts) {
      return {
        shouldEscalate: true,
        reason: 'max_attempts',
        message: escalationPolicy.maxAttemptsMessage
      };
    }

    return { shouldEscalate: false };
  }

  /**
   * Apply agent personality to response text
   */
  static applyPersonality(text, personality) {
    if (!personality.enabled) return text;

    const style = personality.style || 'professional';
    const enthusiasm = personality.enthusiasm || 'moderate';
    
    // Simple personality application - in production this could use LLM
    switch (style) {
      case 'friendly':
        if (enthusiasm === 'high') {
          return text.replace(/\./g, '! ').replace(/\s+/g, ' ').trim();
        }
        return text.replace(/^/, 'Thanks for asking! ');
        
      case 'professional':
        return text;
        
      case 'casual':
        return text.replace(/\bcannot\b/g, "can't")
                  .replace(/\bdo not\b/g, "don't")
                  .replace(/\bwill not\b/g, "won't");
                  
      case 'technical':
        return `Based on our analysis: ${text}`;
        
      default:
        return text;
    }
  }

  /**
   * Get list of behaviors that were applied
   */
  static getAppliedBehaviors(behaviors, context) {
    const applied = [];
    
    if (behaviors.silencePolicy?.enabled && context.silenceDetected) {
      applied.push('silence_policy');
    }
    
    if (behaviors.emotionAcknowledgment?.enabled && context.detectedEmotion) {
      applied.push('emotion_acknowledgment');
    }
    
    if (behaviors.bargeInHandling?.enabled && context.bargeInDetected) {
      applied.push('barge_in_handling');
    }
    
    return applied;
  }

  /**
   * Handle barge-in behavior
   */
  static handleBargeIn(config, context) {
    const bargeInConfig = config.behaviorControls?.bargeInHandling;
    
    if (!bargeInConfig?.enabled) {
      return { allowed: false };
    }

    const strategy = bargeInConfig.strategy || 'polite';
    
    switch (strategy) {
      case 'immediate':
        return { 
          allowed: true, 
          message: null 
        };
        
      case 'polite':
        return { 
          allowed: true, 
          message: bargeInConfig.politeMessage || "Sorry, let me listen to what you're saying." 
        };
        
      case 'disabled':
        return { 
          allowed: false,
          message: bargeInConfig.disabledMessage || "Please let me finish, then I'll be happy to help."
        };
        
      default:
        return { allowed: true };
    }
  }

  /**
   * Update call state with behavior tracking
   */
  static updateCallState(currentState, newEvents) {
    const updated = { ...currentState };
    
    // Track consecutive silences
    if (newEvents.silence) {
      updated.consecutiveSilences = (updated.consecutiveSilences || 0) + 1;
      updated.lastSilenceTime = new Date();
    } else if (newEvents.userSpoke) {
      updated.consecutiveSilences = 0;
    }
    
    // Track interruptions
    if (newEvents.bargeIn) {
      updated.interruptionCount = (updated.interruptionCount || 0) + 1;
      updated.lastInterruptionTime = new Date();
    }
    
    // Track failed attempts
    if (newEvents.noMatch) {
      updated.failedAttempts = (updated.failedAttempts || 0) + 1;
    } else if (newEvents.successfulMatch) {
      updated.failedAttempts = 0;
    }
    
    // Track emotion
    if (newEvents.emotion) {
      updated.detectedEmotion = newEvents.emotion;
      updated.emotionHistory = updated.emotionHistory || [];
      updated.emotionHistory.push({
        emotion: newEvents.emotion,
        timestamp: new Date(),
        confidence: newEvents.emotionConfidence || 0
      });
      
      // Keep only last 5 emotions
      if (updated.emotionHistory.length > 5) {
        updated.emotionHistory = updated.emotionHistory.slice(-5);
      }
    }
    
    return updated;
  }
}

module.exports = {
  apply: async (config, callState, answer, context) => {
    return await BehaviorEngine.apply(config, callState, answer, context);
  },
  updateCallState: (currentState, newEvents) => {
    return BehaviorEngine.updateCallState(currentState, newEvents);
  },
  handleBargeIn: (config, context) => {
    return BehaviorEngine.handleBargeIn(config, context);
  },
  BehaviorEngine
};
