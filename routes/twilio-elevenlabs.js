// Clean Twilio + ElevenLabs Conversational AI Integration
// Uses Twilio Media Streams for bidirectional audio + ElevenLabs Conversational AI
const express = require('express');
const twilio = require('twilio');
const WebSocket = require('ws');
const Company = require('../models/Company');
const { normalizePhoneNumber, extractDigits, numbersMatch } = require('../utils/phone');
const { applyPlaceholders } = require('../utils/placeholders');

const router = express.Router();

// Store for WebSocket connections
const streamConnections = new Map();

// Helper function to get company data
async function getCompanyByPhoneNumber(phoneNumber) {
  try {
    const digits = extractDigits(phoneNumber);
    const digitsNoCountry = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
    const searchNumbers = [phoneNumber, digits, digitsNoCountry].filter(Boolean);

    let company = await Company.findOne({ 'twilioConfig.phoneNumber': { $in: searchNumbers } }).exec();
    if (!company) {
      const all = await Company.find({ 'twilioConfig.phoneNumber': { $ne: null } }).exec();
      company = all.find((c) => numbersMatch(c.twilioConfig.phoneNumber, phoneNumber));
    }
    return company;
  } catch (err) {
    console.error('Error fetching company:', err);
    return null;
  }
}

// Initial voice endpoint - starts Media Stream to ElevenLabs
router.post('/voice', async (req, res) => {
  try {
    console.log('[ElevenLabs Voice] Incoming call:', req.body);
    const calledNumber = normalizePhoneNumber(req.body.To);
    const company = await getCompanyByPhoneNumber(calledNumber);

    const twiml = new twilio.twiml.VoiceResponse();

    if (!company) {
      twiml.say('Sorry, we are experiencing technical difficulties. Please try again later.');
      twiml.hangup();
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    // Get the ElevenLabs agent ID from company settings
    const agentId = company.aiSettings?.elevenLabs?.agentId;
    if (!agentId) {
      twiml.say('Service is not configured. Please contact support.');
      twiml.hangup();
      res.type('text/xml');
      res.send(twiml.toString());
      return;
    }

    // Connect to our WebSocket endpoint which bridges to ElevenLabs
    const connect = twiml.connect();
    connect.stream({
      url: `wss://${req.get('host')}/stream?company=${company._id}&agent=${agentId}`
    });

    res.type('text/xml');
    res.send(twiml.toString());
  } catch (err) {
    console.error('[ElevenLabs Voice] Error:', err);
    const twiml = new twilio.twiml.VoiceResponse();
    twiml.say('Sorry, we are experiencing technical difficulties.');
    twiml.hangup();
    res.type('text/xml');
    res.send(twiml.toString());
  }
});

// Function to setup WebSocket server (called from main server)
function setupWebSocketServer(server) {
  const wss = new WebSocket.Server({ 
    server,
    path: '/stream'
  });

  wss.on('connection', async (twilioWs, req) => {
    console.log('[Stream] Twilio connected');
    
    // Parse query parameters
    const url = new URL(req.url, `http://${req.headers.host}`);
    const companyId = url.searchParams.get('company');
    const agentId = url.searchParams.get('agent');
    
    if (!companyId || !agentId) {
      console.error('[Stream] Missing company or agent ID');
      twilioWs.close();
      return;
    }

    // Get company data for ElevenLabs API key
    const company = await Company.findById(companyId);
    if (!company) {
      console.error('[Stream] Company not found');
      twilioWs.close();
      return;
    }

    const elevenLabsApiKey = company.aiSettings?.elevenLabs?.apiKey || process.env.ELEVENLABS_API_KEY;
    if (!elevenLabsApiKey) {
      console.error('[Stream] ElevenLabs API key not configured');
      twilioWs.close();
      return;
    }

    // Connect to ElevenLabs Conversational AI
    const elevenLabsWs = new WebSocket(`wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}`, {
      headers: {
        'xi-api-key': elevenLabsApiKey
      }
    });

    let streamSid = null;

    // Handle Twilio messages
    twilioWs.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        
        switch (message.event) {
          case 'connected':
            console.log('[Stream] Twilio stream connected');
            break;
            
          case 'start':
            streamSid = message.start.streamSid;
            console.log(`[Stream] Started with SID: ${streamSid}`);
            
            // Initialize ElevenLabs conversation
            const initMessage = {
              type: 'conversation_initiation_client_data',
              conversation_config_override: {
                agent: {
                  prompt: {
                    prompt: company.agentSetup?.agentPrompt || "You are a helpful customer service agent."
                  },
                  first_message: company.agentSetup?.agentGreeting || "Hello! How can I help you today?",
                  language: "en"
                },
                tts: {
                  voice_id: company.aiSettings?.elevenLabs?.voiceId || "21m00Tcm4TlvDq8ikWAM"
                }
              }
            };
            
            if (elevenLabsWs.readyState === WebSocket.OPEN) {
              elevenLabsWs.send(JSON.stringify(initMessage));
            }
            break;
            
          case 'media':
            // Forward audio to ElevenLabs
            if (elevenLabsWs.readyState === WebSocket.OPEN) {
              elevenLabsWs.send(JSON.stringify({
                user_audio_chunk: message.media.payload
              }));
            }
            break;
            
          case 'stop':
            console.log('[Stream] Twilio stream stopped');
            elevenLabsWs.close();
            break;
        }
      } catch (err) {
        console.error('[Stream] Error processing Twilio message:', err);
      }
    });

    // Handle ElevenLabs messages
    elevenLabsWs.on('open', () => {
      console.log('[Stream] ElevenLabs connected');
    });

    elevenLabsWs.on('message', (data) => {
      try {
        const message = JSON.parse(data);
        
        switch (message.type) {
          case 'audio':
            // Forward audio back to Twilio
            if (twilioWs.readyState === WebSocket.OPEN && streamSid) {
              const twilioMessage = {
                event: 'media',
                streamSid: streamSid,
                media: {
                  payload: message.audio_event.audio_base_64
                }
              };
              twilioWs.send(JSON.stringify(twilioMessage));
            }
            break;
            
          case 'user_transcript':
            console.log('[Stream] User said:', message.user_transcription_event.user_transcript);
            break;
            
          case 'agent_response':
            console.log('[Stream] Agent response:', message.agent_response_event.agent_response);
            break;
        }
      } catch (err) {
        console.error('[Stream] Error processing ElevenLabs message:', err);
      }
    });

    // Handle disconnections
    twilioWs.on('close', () => {
      console.log('[Stream] Twilio disconnected');
      elevenLabsWs.close();
    });

    elevenLabsWs.on('close', () => {
      console.log('[Stream] ElevenLabs disconnected');
      twilioWs.close();
    });

    elevenLabsWs.on('error', (err) => {
      console.error('[Stream] ElevenLabs error:', err);
      twilioWs.close();
    });

    twilioWs.on('error', (err) => {
      console.error('[Stream] Twilio error:', err);
      elevenLabsWs.close();
    });
  });

  console.log('[ElevenLabs] WebSocket server setup complete');
}

module.exports = { router, setupWebSocketServer };
