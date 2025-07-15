/**
 * Test Enhanced Q&A Matching for Thermostat Issues
 * This test verifies the improved semantic matching will properly handle "my thermostat is blank"
 */

// Mock Q&A entries (similar to what would be in database)
const mockQAEntries = [
    {
        question: "Why is my thermostat screen blank?",
        answer: "Often that's just dead batteries or a tripped breaker, but if the screen stays blank after you swap batteries, there might be a wiring issue. Let me know if you'd like help with next steps or if there's something else you want to ask about your system.",
        keywords: "thermostat, blank screen, batteries, power, wiring"
    },
    {
        question: "What are your service hours?",
        answer: "We're available 24/7 for emergency service. Regular service hours are Monday-Friday 8AM-6PM.",
        keywords: "hours, schedule, availability"
    },
    {
        question: "How much does a service call cost?",
        answer: "Our service call fee is $89, which is waived if you proceed with any recommended repairs.",
        keywords: "price, cost, service call, fee"
    }
];

// Enhanced Q&A matching function (extracted from agent.js)
function extractQuickAnswerFromQA(qaEntries, question, threshold = 0.15) {
    if (!qaEntries || qaEntries.length === 0) return null;
    
    const qLower = question.toLowerCase().trim();
    let bestMatch = null;
    let bestScore = 0;
    
    // Enhanced semantic synonym mapping with more thermostat variations
    const synonymMap = {
        'blank': ['not working', 'dead', 'dark', 'empty', 'black', 'screen blank', 'display blank', 'no display', 'off', 'nothing showing'],
        'not working': ['blank', 'broken', 'dead', 'down', 'out', 'failed', 'malfunctioning', 'won\'t work', 'doesn\'t work'],
        'broken': ['not working', 'dead', 'damaged', 'faulty', 'out of order', 'busted', 'messed up'],
        'dead': ['blank', 'not working', 'no power', 'won\'t turn on', 'lifeless', 'unresponsive'],
        'screen': ['display', 'monitor', 'panel', 'interface', 'readout', 'lcd'],
        'thermostat': ['temperature control', 'temp control', 'hvac control', 'climate control', 'stat', 'unit'],
        'fix': ['repair', 'service', 'maintenance', 'troubleshoot', 'check', 'look at'],
        'price': ['cost', 'charge', 'fee', 'rate', 'how much', 'expense', 'bill'],
        'hours': ['schedule', 'time', 'open', 'available', 'when', 'operating hours'],
        'emergency': ['urgent', '24/7', 'after hours', 'weekend', 'immediate', 'asap', 'right now']
    };
    
    for (const entry of qaEntries) {
        const entryQuestion = (entry.question || '').toLowerCase();
        const entryAnswer = entry.answer || '';
        const fullEntryText = entryQuestion + ' ' + entryAnswer.toLowerCase();
        
        // Get question words and expand with synonyms
        const questionWords = qLower.split(' ').filter(word => word.length > 2);
        const expandedWords = new Set(questionWords);
        
        questionWords.forEach(word => {
            if (synonymMap[word]) {
                synonymMap[word].forEach(synonym => expandedWords.add(synonym));
            }
            // Check if word is a synonym of any key
            Object.entries(synonymMap).forEach(([key, synonyms]) => {
                if (synonyms.includes(word)) {
                    expandedWords.add(key);
                    synonyms.forEach(syn => expandedWords.add(syn));
                }
            });
        });
        
        // Enhanced matching with synonyms and patterns
        let matchCount = 0;
        let bonusScore = 0;
        
        Array.from(expandedWords).forEach(word => {
            if (fullEntryText.includes(word)) {
                matchCount += entryQuestion.includes(word) ? 2 : 1; // Question matches worth more
            }
        });
        
        // Enhanced pattern bonuses for common issues
        const patterns = [
            { pattern: /(my|the)?\s*(thermostat|stat|unit)\s*(is\s*)?(blank|not working|dead|screen|display)/, boost: 4 },
            { pattern: /(blank|dead|not working|dark|empty)\s*(thermostat|screen|display)/, boost: 4 },
            { pattern: /(thermostat|temp|stat)\s*(blank|not working|dead|screen|won't|doesn't)/, boost: 3 },
            { pattern: /(price|cost|charge)\s*(service|repair|call|visit)/, boost: 2 },
            { pattern: /(emergency|urgent|24\/7|after hours|weekend|immediate)/, boost: 2 },
            { pattern: /(blank|dead|not working|dark)\s*(screen|display|panel)/, boost: 3 }
        ];
        
        patterns.forEach(({ pattern, boost }) => {
            if (pattern.test(qLower) && pattern.test(fullEntryText)) {
                bonusScore += boost;
            }
        });
        
        // Calculate final score
        const baseScore = questionWords.length > 0 ? matchCount / questionWords.length : 0;
        const finalScore = baseScore + (bonusScore * 0.1); // Add bonus as percentage
        
        if (finalScore > threshold && finalScore > bestScore && entryAnswer.length > 10) {
            bestScore = finalScore;
            bestMatch = entryAnswer;
            console.log(`[Enhanced Q&A Match] Found match with score ${Math.round(finalScore * 100)}% for: "${entry.question}"`);
        }
    }
    
    return bestMatch;
}

// Test Cases
console.log('🧪 TESTING ENHANCED Q&A MATCHING');
console.log('='.repeat(50));

const testQueries = [
    "my thermostat is blank",
    "thermostat screen not working", 
    "the thermostat screen is dead",
    "my stat is blank",
    "thermostat display is dark",
    "what are your hours",
    "how much for service call"
];

testQueries.forEach(query => {
    console.log(`\n📝 Testing: "${query}"`);
    const result = extractQuickAnswerFromQA(mockQAEntries, query);
    
    if (result) {
        console.log(`✅ MATCHED: ${result.substring(0, 80)}...`);
    } else {
        console.log(`❌ NO MATCH FOUND`);
    }
    console.log('-'.repeat(40));
});

console.log('\n🎯 EXPECTED RESULTS:');
console.log('- All thermostat queries should match the blank screen Q&A');
console.log('- "hours" should match service hours Q&A');  
console.log('- "service call" should match pricing Q&A');
console.log('\n🚀 Enhanced matching should significantly improve Q&A accuracy!');
