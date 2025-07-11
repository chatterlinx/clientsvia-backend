const express = require('express');
const twilio = require('twilio');
const Company = require('../models/Company');
const { redisClient } = require('../clients');
const { normalizePhoneNumber, extractDigits, numbersMatch } = require('../utils/phone');

const router = express.Router();

/**
 * @route POST /api/twilio-test-step2/voice
 * @description A webhook to test database and cache lookup latency.
 * It performs a company lookup and then responds with a simple message.
 */
router.post('/voice', async (req, res) => {
  const startTime = Date.now();
  console.log(`[Twilio Test Step 2] Received call at ${new Date().toISOString()}`);
  const twiml = new twilio.twiml.VoiceResponse();

  try {
    const calledNumber = normalizePhoneNumber(req.body.To);
    if (!calledNumber) {
      throw new Error("Could not normalize phone number from: " + req.body.To);
    }

    console.log(`[Twilio Test Step 2] Looking up company for: ${calledNumber}`);
    
    // Simplified version of getCompanyByPhoneNumber for testing
    const cacheKey = `company-phone:${calledNumber}`;
    let company = null;
    let foundInCache = false;

    const cachedCompany = await redisClient.get(cacheKey);
    if (cachedCompany) {
      company = JSON.parse(cachedCompany);
      foundInCache = true;
    } else {
      const digits = extractDigits(calledNumber);
      const digitsNoCountry = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
      const searchNumbers = [calledNumber, digits, digitsNoCountry].filter(Boolean);
      
      company = await Company.findOne({ 'twilioConfig.phoneNumber': { $in: searchNumbers } }).lean().exec();
      
      if (!company) {
        const allCompanies = await Company.find({ 'twilioConfig.phoneNumber': { $ne: null } }).lean().exec();
        company = allCompanies.find(c => numbersMatch(c.twilioConfig.phoneNumber, calledNumber));
      }
    }

    const lookupTime = Date.now() - startTime;
    console.log(`[Twilio Test Step 2] DB/Cache lookup took ${lookupTime}ms.`);

    if (company) {
      console.log(`[Twilio Test Step 2] Found company: ${company.companyName}. Found in cache: ${foundInCache}`);
      twiml.say(`Company lookup successful. Found ${company.companyName}.`);
    } else {
      console.log(`[Twilio Test Step 2] Could not find company for number: ${calledNumber}`);
      twiml.say('Company lookup failed. Could not find a matching company.');
    }

  } catch (error) {
    console.error('[Twilio Test Step 2] An error occurred:', error);
    twiml.say('An error occurred during the test.');
  }

  twiml.hangup();
  res.type('text/xml');
  res.send(twiml.toString());
  
  const totalTime = Date.now() - startTime;
  console.log(`[Twilio Test Step 2] Sent TwiML response. Total processing time: ${totalTime}ms.`);
});

module.exports = router;
