// Super simple DTMF test using existing working minimal route
const express = require('express');
const router = express.Router();

// DTMF test that should work instantly
router.post('/dtmf-test', (req, res) => {
  console.log(`[DTMF-TEST] DTMF test called at: ${new Date().toISOString()}`);
  
  const response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Gather input="dtmf" action="/api/simple-test/dtmf-result" method="POST" timeout="10" numDigits="1">
    <Say>Press any number key now.</Say>
  </Gather>
  <Hangup/>
</Response>`;
  
  console.log(`[DTMF-TEST] Response sent at: ${new Date().toISOString()}`);
  res.type('text/xml').send(response);
});

// Result handler
router.post('/dtmf-result', (req, res) => {
  console.log(`[DTMF-TEST] Result received at: ${new Date().toISOString()}`);
  console.log(`[DTMF-TEST] Digits pressed: "${req.body.Digits}"`);
  
  const response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>You pressed ${req.body.Digits}. Test complete.</Say>
  <Hangup/>
</Response>`;
  
  res.type('text/xml').send(response);
});

module.exports = router;
