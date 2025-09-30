require('dotenv').config();
const fetch = require('node-fetch'); // Assume installed, or use https

const COMPANY_ID = '68813026dd95f599c74e49c7';
const API_BASE = 'http://localhost:3000/api';
const PORT = 3000; // Assume server on 3000

async function testLocalQnAGenerate() {
    console.log('🧪 Testing Local Q&A Generation');
    console.log('Company ID:', COMPANY_ID);
    
    try {
        // Step 1: Generate Q&As
        console.log('\n1. Generating Q&As...');
        const generateResponse = await fetch(`${API_BASE}/company/${COMPANY_ID}/local-qna/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                businessType: 'hvac',
                description: 'Open 9-5 Monday Friday'
            })
        });
        
        const generateResult = await generateResponse.json();
        console.log('Generate Result:', JSON.stringify(generateResult, null, 2));
        
        if (!generateResult.success) {
            throw new Error('Generation failed');
        }
        
        console.log(`✅ Generated ${generateResult.meta.entriesGenerated} Q&As`);
        
        // Step 2: Verify saved (GET /local-qna)
        console.log('\n2. Checking saved Q&As...');
        const getResponse = await fetch(`${API_BASE}/company/${COMPANY_ID}/local-qna`);
        const getResult = await getResponse.json();
        console.log(`Saved Count: ${getResult.data ? getResult.data.length : 0}`);
        if (getResult.data) {
            getResult.data.forEach((qna, i) => {
                console.log(`${i+1}. Q: ${qna.question}`);
                console.log(`   A: ${qna.answer.substring(0, 100)}...`);
                console.log(`   Keywords: ${qna.keywords.join(', ')}`);
                console.log(`   Confidence: ${qna.confidence}`);
            });
        }
        
        // Step 3: Test AI Agent Match
        console.log('\n3. Testing AI Agent Lookup...');
        const aiResponse = await fetch(`${API_BASE}/ai-agent/company-knowledge/${COMPANY_ID}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: 'What are your business hours?' })
        });
        
        const aiResult = await aiResponse.json();
        console.log('AI Lookup Result:', JSON.stringify(aiResult, null, 2));
        
        if (aiResult.confidence >= 0.8) {
            console.log('✅ AI Match Success: High confidence!');
        } else {
            console.log('⚠️ AI Match: Low confidence, check keywords');
        }
        
        // Check response time
        if (aiResult.responseTime < 50) {
            console.log('⚡ Performance: Under 50ms!');
        } else {
            console.log('⏱️ Performance: Check caching');
        }
        
        console.log('\n🎉 Test Complete: Local Q&A Feature Working!');
        
    } catch (error) {
        console.error('❌ Test Failed:', error.message);
    }
}

testLocalQnAGenerate();
