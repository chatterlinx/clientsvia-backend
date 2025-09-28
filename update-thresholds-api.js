// Quick API call to update thresholds
const https = require('https');

const data = JSON.stringify({
  thresholds: {
    companyQnA: 0.55,
    tradeQnA: 0.75,
    templates: 0.7,
    inHouseFallback: 0.5
  }
});

const options = {
  hostname: 'clientsvia-backend.onrender.com',
  port: 443,
  path: '/api/company/68813026dd95f599c74e49c7',
  method: 'PATCH',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  
  let responseData = '';
  res.on('data', (chunk) => {
    responseData += chunk;
  });
  
  res.on('end', () => {
    console.log('Response:', responseData);
  });
});

req.on('error', (error) => {
  console.error('Error:', error);
});

req.write(data);
req.end();

console.log('🎯 Updating company thresholds via API...');
