// Quick test script to validate the diagnostic endpoint
const axios = require('axios');

async function testDiagnosticEndpoint() {
  try {
    console.log('Testing diagnostic endpoint...');
    
    const response = await axios.post('https://backend.clientsvia.com/api/twilio/speech-timing-test', {
      SpeechResult: 'Test speech input',
      CallSid: 'test-call-sid',
      From: '+1234567890'
    }, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });
    
    console.log('Response status:', response.status);
    console.log('Response data:', response.data);
    
  } catch (error) {
    console.error('Error testing endpoint:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

testDiagnosticEndpoint();
