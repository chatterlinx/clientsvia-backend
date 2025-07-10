// Quick test script to validate the diagnostic endpoint
const axios = require('axios');

async function testDiagnosticEndpoint() {
  try {
    console.log('Testing diagnostic endpoint...');
    
    // First, try a simple GET to see if the server is responding
    const healthCheck = await axios.get('https://clientsvia-backend.onrender.com/api/twilio/voice', {
      timeout: 10000
    });
    console.log('Health check status:', healthCheck.status);
    
    // Now try the POST to our diagnostic endpoint
    const postData = new URLSearchParams({
      SpeechResult: 'Test speech input',
      CallSid: 'test-call-sid',
      From: '+1234567890'
    });
    
    const response = await axios.post('https://clientsvia-backend.onrender.com/api/twilio/speech-timing-test', postData, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      timeout: 10000
    });
    
    console.log('Diagnostic endpoint status:', response.status);
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
