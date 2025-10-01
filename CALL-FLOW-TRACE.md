# 📞 **TWILIO CALL FLOW - COMPLETE TRACE**

## **🎯 INCOMING CALL ROUTE DISTRIBUTION**

### **Option 1: Generic Webhook (Phone Number Lookup)**
```
POST /api/twilio/voice
├── Looks up company by phone number
└── Routes to V2 AI Agent system
```

### **Option 2: Company-Specific Webhook (Direct Route)**
```
POST /api/twilio/voice/:companyID
├── Looks up company by ID
└── Routes to V2 AI Agent system
```

---

## **🚀 V2 AI AGENT INITIALIZATION FLOW**

### **Step 1: Webhook Hit** (`routes/v2twilio.js:232-368`)
```javascript
router.post('/voice', async (req, res) => {
  // 🚨 CRITICAL CHECKPOINT: Log EVERYTHING
  console.log('🚨 WEBHOOK HIT: /api/twilio/voice');
  console.log('🚨 FULL REQUEST BODY:', req.body);
  
  // 1️⃣ NORMALIZE & LOOKUP
  const calledNumber = normalizePhoneNumber(req.body.To);
  let company = await getCompanyByPhoneNumber(calledNumber);
  
  // 2️⃣ INITIALIZE V2 AI AGENT
  const { initializeCall } = require('../services/v2AIAgentRuntime');
  const initResult = await initializeCall(
    company._id.toString(),
    req.body.CallSid,
    req.body.From,
    req.body.To
  );
  
  // initResult contains:
  // - greeting: "Thanks for calling! How can I help you today?"
  // - voiceSettings: { voiceId, stability, similarityBoost, etc. }
  // - callState: { callId, from, to, companyId, stage: 'greeting' }
});
```

---

### **Step 2: V2 AI Agent Runtime** (`services/v2AIAgentRuntime.js:24-76`)
```javascript
static async initializeCall(companyID, callId, from, to) {
  console.log(`[V2 AGENT] 🚀 Initializing call for company ${companyID}`);
  
  // 1️⃣ LOAD COMPANY V2 CONFIGURATION
  const company = await Company.findById(companyID);
  
  // 2️⃣ VALIDATE V2 AI AGENT LOGIC IS ENABLED
  if (!company.aiAgentLogic?.enabled) {
    return {
      greeting: "Configuration error: Company must configure V2 Agent Personality",
      callState: { stage: 'configuration_error' }
    };
  }
  
  // 3️⃣ GENERATE V2 GREETING
  const greeting = this.generateV2Greeting(company);
  
  // 4️⃣ RETURN INITIALIZATION RESULT
  return {
    greeting,                                    // ✅ GREETING HERE!
    voiceSettings: company.aiAgentLogic.voiceSettings,  // ✅ ELEVENLABS SETTINGS HERE!
    personality: company.aiAgentLogic.agentPersonality,
    callState: { callId, from, to, stage: 'greeting' }
  };
}
```

---

### **Step 3: Generate V2 Greeting** (`services/v2AIAgentRuntime.js:83-124`)
```javascript
static generateV2Greeting(company) {
  console.log(`[V2 GREETING] 🎭 Generating greeting for ${company.businessName}`);
  
  const aiLogic = company.aiAgentLogic;
  let greeting = null;
  
  // V2 PRIORITY ORDER:
  // 1️⃣ Check V2 Agent Personality opening phrases
  if (aiLogic.agentPersonality?.conversationPatterns?.openingPhrases?.length > 0) {
    const phrases = aiLogic.agentPersonality.conversationPatterns.openingPhrases;
    greeting = phrases[0]; // ✅ USE FIRST OPENING PHRASE!
    console.log(`✅ V2 GREETING: Using V2 opening phrase: "${greeting}"`);
  }
  
  // 2️⃣ Use tone-based static greeting
  else {
    const tone = aiLogic.agentPersonality?.corePersonality?.voiceTone || 'friendly';
    
    switch (tone) {
      case 'professional':
        greeting = "Thank you for calling. How may I assist you today?";
        break;
      case 'authoritative':
        greeting = "How can I help you?";
        break;
      case 'empathetic':
        greeting = "Hi there! I'm here to help you with whatever you need.";
        break;
      default: // friendly
        greeting = "Thanks for calling! How can I help you today?";
    }
  }
  
  // 3️⃣ Return clean greeting (no placeholders)
  greeting = this.buildPureResponse(greeting, company);
  return greeting;
}
```

---

### **Step 4: Apply ElevenLabs Voice** (`routes/v2twilio.js:299-333`)
```javascript
// Use V2 Voice Settings for TTS
const elevenLabsVoice = initResult.voiceSettings?.voiceId;

if (elevenLabsVoice && initResult.greeting) {
  try {
    console.log(`[TTS START] Starting AI Agent Logic greeting TTS synthesis...`);
    
    // ✅ SYNTHESIZE WITH ELEVENLABS!
    const buffer = await synthesizeSpeech({
      text: initResult.greeting,                          // ✅ GREETING TEXT
      voiceId: elevenLabsVoice,                           // ✅ FROM AI VOICE SETTINGS
      stability: company.aiAgentLogic?.voiceSettings?.stability,
      similarity_boost: company.aiAgentLogic?.voiceSettings?.similarityBoost,
      style: company.aiAgentLogic?.voiceSettings?.styleExaggeration,
      model_id: company.aiAgentLogic?.voiceSettings?.aiModel,
      company
    });
    
    // Save audio and play it
    const fileName = `ai_greet_${Date.now()}.mp3`;
    const audioDir = path.join(__dirname, '../public/audio');
    fs.writeFileSync(path.join(audioDir, fileName), buffer);
    
    gather.play(`${req.protocol}://${req.get('host')}/audio/${fileName}`);
    
  } catch (err) {
    console.error('AI Agent Logic TTS failed, using Say:', err);
    gather.say(escapeTwiML(initResult.greeting));  // ✅ FALLBACK TO TWILIO TTS
  }
} else {
  // No ElevenLabs configured - use Twilio Say
  gather.say(escapeTwiML(initResult.greeting));
}
```

---

## **🎯 CRITICAL CONFIGURATION PATHS**

### **✅ WHERE GREETING COMES FROM:**
```
v2Company.aiAgentLogic.agentPersonality.conversationPatterns.openingPhrases[0]
├── Priority 1: First opening phrase in Agent Personality
└── Priority 2: Tone-based static greeting (friendly/professional/authoritative/empathetic)
```

### **✅ WHERE ELEVENLABS SETTINGS COME FROM:**
```
v2Company.aiAgentLogic.voiceSettings
├── voiceId (required)
├── stability (optional, default: 0.5)
├── similarityBoost (optional, default: 0.75)
├── styleExaggeration (optional, default: 0)
└── aiModel (optional, default: 'eleven_multilingual_v2')
```

---

## **🔍 TROUBLESHOOTING CHECKLIST**

### **❌ "Configuration error" messages:**
- [ ] `company.aiAgentLogic.enabled` must be `true`
- [ ] `company.aiAgentLogic.agentPersonality` must exist
- [ ] Company must have a valid phone number in `twilio.phoneNumber`

### **❌ No ElevenLabs voice (uses Twilio TTS instead):**
- [ ] `company.aiAgentLogic.voiceSettings.voiceId` must be set
- [ ] Check ElevenLabs API key in environment variables
- [ ] Check console for `[TTS START]` and `[TTS COMPLETE]` logs

### **❌ Generic greeting instead of custom:**
- [ ] Check `company.aiAgentLogic.agentPersonality.conversationPatterns.openingPhrases`
- [ ] Ensure array is not empty
- [ ] Verify first element contains your greeting

---

## **🎤 EXAMPLE CALL FLOW LOG**

```
🚨 WEBHOOK HIT: /api/twilio/voice at 2025-10-01T12:34:56.789Z
🚨 FULL REQUEST BODY: { From: '+15551234567', To: '+15559876543', CallSid: 'CAxxxxx' }

[CALL START] New call initiated at: 2025-10-01T12:34:56.789Z
[PHONE LOOKUP] Searching for company with phone: +15559876543
✅ Company found: Atlas Air (ID: 670a1b2c3d4e5f6g7h8i9j0k)

[V2 AGENT] 🚀 Initializing call for company 670a1b2c3d4e5f6g7h8i9j0k
✅ V2 AGENT: Found V2 configuration for Atlas Air

[V2 GREETING] 🎭 Generating greeting for Atlas Air
✅ V2 GREETING: Using V2 opening phrase: "Good morning! Thank you for calling Atlas Air. How can I help you today?"

🎤 V2 AGENT: Generated greeting: "Good morning! Thank you for calling Atlas Air. How can I help you today?"

[TTS START] Starting AI Agent Logic greeting TTS synthesis...
[TTS COMPLETE] AI Agent Logic greeting TTS completed in 342ms

[Twilio Voice] Sending AI Agent Logic TwiML: <Response><Gather...><Play>https://...</Play></Gather></Response>
```

---

## **🚀 WHAT HAPPENS AFTER GREETING?**

After the greeting plays, Twilio waits for the caller to speak, then routes to:

```
POST /api/twilio/v2-agent-respond/:companyId
└── Calls v2AIAgentRuntime.processUserInput()
    └── Calls v2priorityDrivenKnowledgeRouter.routeQuery()
        ├── Priority 1: Company Q&A (0.8 threshold)
        ├── Priority 2: Trade Q&A (0.75 threshold)
        ├── Priority 3: Templates (0.7 threshold)
        └── Priority 4: In-House Fallback (0.5 threshold - always respond)
```

---

## **✅ VERIFICATION STEPS**

1. **Check if greeting is configured:**
   ```javascript
   db.companies.findOne({ _id: ObjectId('YOUR_COMPANY_ID') }, { 
     'aiAgentLogic.agentPersonality.conversationPatterns.openingPhrases': 1 
   })
   ```

2. **Check if ElevenLabs is configured:**
   ```javascript
   db.companies.findOne({ _id: ObjectId('YOUR_COMPANY_ID') }, { 
     'aiAgentLogic.voiceSettings.voiceId': 1 
   })
   ```

3. **Check if AI Agent Logic is enabled:**
   ```javascript
   db.companies.findOne({ _id: ObjectId('YOUR_COMPANY_ID') }, { 
     'aiAgentLogic.enabled': 1 
   })
   ```

---

## **📝 SUMMARY**

✅ **Greeting Source:** `company.aiAgentLogic.agentPersonality.conversationPatterns.openingPhrases[0]`  
✅ **Voice Settings:** `company.aiAgentLogic.voiceSettings` (ElevenLabs)  
✅ **Entry Point:** `POST /api/twilio/voice` (phone lookup) OR `POST /api/twilio/voice/:companyID` (direct)  
✅ **Knowledge Router:** After greeting, routes to `v2priorityDrivenKnowledgeRouter` for Q&A matching  

---

**🔥 The system is complete and fully integrated!**

