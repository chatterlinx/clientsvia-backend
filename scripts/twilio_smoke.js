// Simulate the ai-agent-respond deterministic path (Phase 3)
// This script stubs the effectiveConfigResolver to use the hvac starter pack
// and invokes qnaMatcher.tryAnswer, then builds TwiML as the route would.

const path = require('path');
const twilio = require('twilio');

// Resolve module paths
const resolverPath = path.join(__dirname, '..', 'server', 'services', 'effectiveConfigResolver.js');
const hvacPackPath = path.join(__dirname, '..', 'server', 'presets', 'starterPack.hvac_v1.json');
const qnaMatcherPath = path.join(__dirname, '..', 'server', 'services', 'qnaMatcher.js');

// Load hvac pack
const hvacPack = require(hvacPackPath);

// Stub resolver in the require cache before loading qnaMatcher
require.cache[require.resolve(resolverPath)] = {
  id: resolverPath,
  filename: resolverPath,
  loaded: true,
  exports: {
    getEffectiveSettings: async (companyId) => {
      return { config: hvacPack };
    }
  }
};

(async function(){
  try {
    const qnaMatcher = require(qnaMatcherPath);
    const tests = [
      'How much is your service call? ',
      'I want to speak to a person',
      'My AC is not cooling',
      'What size filter do I need?'
    ];

    for (const t of tests) {
      console.log('\n--- Test:', t, '---');
      const hit = await qnaMatcher.tryAnswer('fakeCompany', t);
      if (hit.ok) {
        console.log('Deterministic hit -> source:', hit.source);
        // Build TwiML similar to route: speak answer, then gather
        const twiml = new twilio.twiml.VoiceResponse();
        // Simple TTS via <Say>
        twiml.say(hit.answer);
        const gather = twiml.gather({ input: 'speech dtmf', numDigits: 1, timeout: 5, action: '/api/twilio/ai-agent-respond/fakeCompany' });
        console.log('Twiml:\n', twiml.toString());
      } else {
        console.log('No deterministic match');
      }
    }

    process.exit(0);
  } catch (e) {
    console.error('Smoke test failed:', e);
    process.exit(2);
  }
})();
