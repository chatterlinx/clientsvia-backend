// ULTRA-MINIMAL TWILIO TEST - No dependencies, minimal TwiML
const express = require('express');
const router = express.Router();

// Minimal initial call handler
router.post('/minimal', (req, res) => {
  console.log(`[MINIMAL] Call received at: ${new Date().toISOString()}`);
  console.log(`[MINIMAL] From: ${req.body.From}, To: ${req.body.To}`);
  
  const response = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>Hello</Say>
  <Hangup/>
</Response>`;
  
  console.log(`[MINIMAL] Response sent at: ${new Date().toISOString()}`);
  res.type('text/xml').send(response);
});

module.exports = router;
