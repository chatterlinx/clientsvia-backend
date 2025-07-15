/**
 * Enhanced Q&A and Intent Classification System
 * Based on research findings from "5 tips to optimize your LLM intent classification prompts"
 * 
 * Key Improvements:
 * 1. Better description prefixes and suffixes
 * 2. Improved None intent handling
 * 3. Enhanced scoring for pricing questions
 * 4. Repetition detection and escalation
 */

/**
 * Enhanced Q&A Entry Structure with Better Descriptions
 */
function createOptimizedPricingQAs() {
  return [
    {
      question: 'service_call_cost',
      // Optimized description with prefix and specific keywords
      description: 'Trigger this action when the user asks about service call fees, diagnostic costs, or visit charges.',
      keywords: [
        'service call cost',
        'diagnostic fee', 
        'visit fee',
        'trip charge',
        'how much service call',
        'cost to come out',
        'technician visit cost',
        'what do you charge to come out',
        'service fee'
      ],
      answer: 'Our service call is just $49, which covers the technician visit and diagnostic to identify the issue. If we proceed with any repairs, this fee is often applied toward the work. Would you like to schedule a diagnostic visit?',
      category: 'Pricing',
      intent_type: 'service_call_pricing',
      confidence_threshold: 0.4
    },
    {
      question: 'ac_service_price',
      description: 'Trigger this action when the user asks about full AC service, tune-up, or maintenance pricing.',
      keywords: [
        'ac serviced',
        'how much ac service',
        'ac tune-up cost',
        'full service cost',
        'maintenance package price',
        'how much to service ac',
        'ac maintenance cost',
        'annual service cost',
        'hvac service price',
        'tune up price',
        'yearly maintenance'
      ],
      answer: 'A full AC service or tune-up starts at $89 and includes coil cleaning, refrigerant check, filter inspection, electrical connections check, and performance testing. The initial $49 service call fee is included in this price. Most tune-ups take 1-2 hours. Would you like to schedule your AC service?',
      category: 'Pricing',
      intent_type: 'maintenance_pricing',
      confidence_threshold: 0.4
    },
    {
      question: 'repair_pricing',
      description: 'Trigger this action when the user asks about repair costs, fix pricing, or replacement estimates.',
      keywords: [
        'repair cost',
        'how much repair',
        'fix cost',
        'replacement price',
        'part cost',
        'labor cost',
        'repair estimate',
        'how much to fix',
        'cost of repairs',
        'replacement cost',
        'what do you charge for repairs',
        'repair pricing',
        'how much for repairs'
      ],
      answer: 'Repair costs vary based on the specific issue and parts needed. Common repairs range from $150-$800, with most falling between $250-$450. Our $49 service call includes diagnosis, and if you approve the repair, this fee goes toward the total cost. We provide upfront pricing before any work begins.',
      category: 'Pricing', 
      intent_type: 'repair_pricing',
      confidence_threshold: 0.4
    },
    {
      question: 'none_intent',
      description: 'When the user asks about something unrelated to HVAC services or pricing.',
      keywords: ['general', 'other', 'unrelated'],
      answer: null,
      category: 'None',
      intent_type: 'none',
      confidence_threshold: 0.3
    }
  ];
}

/**
 * Enhanced Intent Classification with Research-Based Optimizations
 */
function classifyPricingIntent(userInput, qaPairs = null) {
  if (!qaPairs) {
    qaPairs = createOptimizedPricingQAs();
  }
  
  const normalizedInput = userInput.toLowerCase().trim();
  const inputWords = normalizedInput.split(/\s+/).filter(w => w.length > 2);
  
  console.log(`🔍 [INTENT CLASSIFICATION] Input: "${userInput}"`);
  console.log(`📊 [INTENT CLASSIFICATION] Available intents: ${qaPairs.length}`);
  
  // Enhanced scoring system based on research findings
  const scores = qaPairs.map(qa => {
    let score = 0;
    let matchDetails = [];
    
    // 1. Exact keyword matching (highest weight)
    const exactMatches = qa.keywords.filter(keyword => 
      normalizedInput.includes(keyword.toLowerCase())
    );
    score += exactMatches.length * 3;
    if (exactMatches.length > 0) {
      matchDetails.push(`exact: [${exactMatches.join(', ')}]`);
    }
    
    // 2. Word overlap scoring
    const qaWords = qa.keywords.flatMap(k => k.toLowerCase().split(/\s+/));
    const wordMatches = inputWords.filter(word => qaWords.includes(word));
    score += wordMatches.length * 2;
    if (wordMatches.length > 0) {
      matchDetails.push(`words: [${wordMatches.join(', ')}]`);
    }
    
    // 3. Intent-specific bonus scoring
    if (qa.intent_type === 'service_call_pricing') {
      // Boost for service call specific terms
      const serviceCallTerms = ['service', 'call', 'visit', 'come', 'out', 'diagnostic'];
      const serviceBonus = inputWords.filter(word => serviceCallTerms.includes(word)).length;
      score += serviceBonus * 1.5;
      if (serviceBonus > 0) matchDetails.push(`service_bonus: ${serviceBonus}`);
    }
    
    if (qa.intent_type === 'maintenance_pricing') {
      // Boost for maintenance specific terms
      const maintenanceTerms = ['serviced', 'maintenance', 'tune-up', 'tuneup', 'service', 'annual'];
      const maintenanceBonus = inputWords.filter(word => maintenanceTerms.includes(word)).length;
      score += maintenanceBonus * 1.5;
      if (maintenanceBonus > 0) matchDetails.push(`maintenance_bonus: ${maintenanceBonus}`);
    }
    
    if (qa.intent_type === 'repair_pricing') {
      // Boost for repair specific terms
      const repairTerms = ['repair', 'fix', 'broken', 'replace', 'replacement'];
      const repairBonus = inputWords.filter(word => repairTerms.includes(word)).length;
      score += repairBonus * 1.5;
      if (repairBonus > 0) matchDetails.push(`repair_bonus: ${repairBonus}`);
    }
    
    // 4. Penalize none intent unless very low match
    if (qa.intent_type === 'none' && score > 1) {
      score *= 0.1; // Heavy penalty
    }
    
    console.log(`   📋 "${qa.question}" - Score: ${score.toFixed(2)} (${matchDetails.join(', ') || 'no matches'})`);
    
    return {
      qa,
      score,
      confidence: Math.min(score / 10, 1), // Normalize to 0-1
      matchDetails
    };
  });
  
  // Sort by score and apply confidence thresholds
  scores.sort((a, b) => b.score - a.score);
  
  const bestMatch = scores[0];
  const secondBest = scores[1];
  
  console.log(`🎯 [INTENT RESULT] Best: "${bestMatch.qa.question}" (${bestMatch.score.toFixed(2)}) | Second: "${secondBest?.qa.question}" (${secondBest?.score.toFixed(2) || 0})`);
  
  // Apply confidence threshold
  if (bestMatch.confidence >= bestMatch.qa.confidence_threshold) {
    return {
      intent: bestMatch.qa.intent_type,
      question: bestMatch.qa.question,
      answer: bestMatch.qa.answer,
      confidence: bestMatch.confidence,
      matchDetails: bestMatch.matchDetails
    };
  }
  
  // Fall back to none intent
  return {
    intent: 'none',
    question: 'none_intent',
    answer: null,
    confidence: 0,
    matchDetails: []
  };
}

/**
 * Repetition Detection and Escalation
 */
class ConversationMemory {
  constructor() {
    this.questionHistory = [];
    this.intentHistory = [];
    this.repetitionThreshold = 2;
  }
  
  addQuestion(userInput, intent, answer) {
    this.questionHistory.push({
      input: userInput,
      intent: intent,
      answer: answer,
      timestamp: Date.now()
    });
    
    this.intentHistory.push(intent);
    
    // Keep only last 5 interactions
    if (this.questionHistory.length > 5) {
      this.questionHistory.shift();
      this.intentHistory.shift();
    }
  }
  
  detectRepetition(currentIntent) {
    if (this.intentHistory.length < 2) return false;
    
    // Check if same intent was asked recently
    const recentIntents = this.intentHistory.slice(-3);
    const repetitionCount = recentIntents.filter(intent => intent === currentIntent).length;
    
    return repetitionCount >= this.repetitionThreshold;
  }
  
  generateEscalationResponse(intent, originalAnswer) {
    const escalationResponses = {
      'service_call_pricing': `I understand you're asking about our service call pricing again. To clarify: our $49 service call covers the technician visit and full diagnostic. This fee is applied toward any approved repairs. Would you like me to break down what's included in the diagnostic, or do you have specific concerns about the pricing?`,
      
      'maintenance_pricing': `I notice you're asking about AC service pricing again. Our $89 tune-up includes comprehensive maintenance: coil cleaning, refrigerant check, filter inspection, electrical testing, and performance optimization. The $49 service call is included in this price. Would you like details about what makes our service worth this investment, or do you need information about payment options?`,
      
      'repair_pricing': `You've asked about repair costs a few times. I want to make sure I'm giving you the right information. Repair prices vary widely ($150-$800) because they depend on the specific issue and parts needed. Would it help if I explained how we determine pricing, or would you prefer to schedule a diagnostic so we can give you an exact quote for your specific situation?`
    };
    
    return escalationResponses[intent] || originalAnswer;
  }
}

/**
 * Test the Enhanced System
 */
function testEnhancedPricingSystem() {
  console.log('🧪 Testing Enhanced Intent Classification System...\n');
  
  const memory = new ConversationMemory();
  
  const testCases = [
    'How much is your service call?',
    'How much is your AC serviced?', 
    'What do you charge for repairs?',
    'How much does it cost to come out?',
    'What does AC maintenance cost?',
    // Repetition tests
    'How much is your service call?', // Repeat
    'What are your service call fees?', // Similar repeat
    'Tell me about your rates', // General
  ];
  
  testCases.forEach((testInput, index) => {
    console.log(`🎯 Test ${index + 1}: "${testInput}"`);
    
    const result = classifyPricingIntent(testInput);
    
    if (result.intent !== 'none') {
      // Check for repetition
      const isRepetition = memory.detectRepetition(result.intent);
      
      let finalAnswer = result.answer;
      if (isRepetition) {
        finalAnswer = memory.generateEscalationResponse(result.intent, result.answer);
        console.log(`   🔄 Repetition detected for intent: ${result.intent}`);
      }
      
      console.log(`   ✅ Intent: ${result.intent} (confidence: ${(result.confidence * 100).toFixed(1)}%)`);
      console.log(`   📝 Answer: ${finalAnswer?.substring(0, 100)}...`);
      
      memory.addQuestion(testInput, result.intent, finalAnswer);
    } else {
      console.log(`   ❌ No matching intent found`);
    }
    
    console.log();
  });
  
  console.log('🎉 Enhanced system testing complete!');
}

module.exports = {
  classifyPricingIntent,
  ConversationMemory,
  createOptimizedPricingQAs,
  testEnhancedPricingSystem
};

// Run test if called directly
if (require.main === module) {
  testEnhancedPricingSystem();
}
