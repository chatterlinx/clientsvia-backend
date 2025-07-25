# 🎭 Agent Personality Configuration Module
_Complete per-company control over AI agent voice, tone, behavior_

**Generated:** 2025-07-24 23:40:00 UTC

---

## 🧬 Step 1: MongoDB Schema Patch (Company.js)

```js
// models/Company.js

agentPersonalitySettings: {
  voiceTone: { type: String, enum: ['friendly', 'professional', 'playful'], default: 'friendly' },
  speechPace: { type: String, enum: ['slow', 'normal', 'fast'], default: 'normal' },
  bargeInMode: { type: Boolean, default: true },
  acknowledgeEmotion: { type: Boolean, default: true },
  useEmojis: { type: Boolean, default: false }
},
```

---

## 🔧 Step 2: Express API Routes (routes/company/personality.js)

```js
// routes/company/personality.js - Agent Personality Settings API
const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');

console.log('✅ Agent Personality routes loading...');

/**
 * @route   GET /api/company/companies/:id/personality
 * @desc    Get company agent personality settings
 * @access  Private (per company)
 */
router.get('/companies/:id/personality', async (req, res) => {
  try {
    const company = await Company.findById(req.params.id).lean();
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Return personality settings with defaults if not set
    const personalitySettings = company.agentPersonalitySettings || {
      voiceTone: 'friendly',
      speechPace: 'normal',
      bargeInMode: true,
      acknowledgeEmotion: true,
      useEmojis: false
    };
    
    console.log(`✅ Personality settings loaded for ${company.companyName}`);
    res.json(personalitySettings);
  } catch (error) {
    console.error('❌ Error fetching personality settings:', error);
    res.status(500).json({ error: 'Failed to fetch personality settings' });
  }
});

/**
 * @route   PUT /api/company/companies/:id/personality
 * @desc    Save company agent personality settings
 * @access  Private (per company)
 */
router.put('/companies/:id/personality', async (req, res) => {
  try {
    const {
      voiceTone,
      speechPace,
      bargeInMode,
      acknowledgeEmotion,
      useEmojis
    } = req.body;

    // Validate input
    const validTones = ['friendly', 'professional', 'playful'];
    const validPaces = ['slow', 'normal', 'fast'];
    
    if (voiceTone && !validTones.includes(voiceTone)) {
      return res.status(400).json({ error: 'Invalid voice tone' });
    }
    
    if (speechPace && !validPaces.includes(speechPace)) {
      return res.status(400).json({ error: 'Invalid speech pace' });
    }

    // Prepare update object
    const personalityUpdate = {
      agentPersonalitySettings: {
        voiceTone: voiceTone || 'friendly',
        speechPace: speechPace || 'normal',
        bargeInMode: bargeInMode !== undefined ? Boolean(bargeInMode) : true,
        acknowledgeEmotion: acknowledgeEmotion !== undefined ? Boolean(acknowledgeEmotion) : true,
        useEmojis: useEmojis !== undefined ? Boolean(useEmojis) : false
      }
    };

    const company = await Company.findByIdAndUpdate(
      req.params.id,
      personalityUpdate,
      { new: true }
    );

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    console.log(`✅ Personality settings saved for ${company.companyName}`);
    console.log(`🎭 Voice: ${personalityUpdate.agentPersonalitySettings.voiceTone}, Pace: ${personalityUpdate.agentPersonalitySettings.speechPace}`);
    
    res.json({ 
      success: true,
      message: 'Personality settings saved successfully',
      settings: company.agentPersonalitySettings
    });
  } catch (error) {
    console.error('❌ Error saving personality settings:', error);
    res.status(500).json({ error: 'Failed to save personality settings' });
  }
});

module.exports = router;
```

**Route Registration (index.js):**
```js
const companyPersonalityRoutes = require('./routes/company/personality');
app.use('/api/company', companyPersonalityRoutes);
```

---

## 🎨 Step 3: Frontend HTML UI (company-profile.html)

```html
<!-- 🎭 AGENT PERSONALITY CONFIGURATION - Module 1: Voice & Behavior Control -->
<div class="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
    <div class="border-b border-gray-200 bg-gradient-to-r from-pink-50 to-rose-50 px-4 py-3 rounded-t-lg">
        <h3 class="text-lg font-medium text-gray-800 flex items-center">
            <i class="fas fa-theater-masks mr-2 text-pink-600"></i>Agent Personality
            <span class="ml-2 px-2 py-1 bg-pink-100 text-pink-800 text-xs font-medium rounded-full">Module 1</span>
        </h3>
        <p class="text-sm text-gray-600 mt-1">Configure voice tone, speech pace, and behavioral characteristics</p>
    </div>
    
    <div class="p-6">
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Left Column: Voice Settings -->
            <div class="space-y-4">
                <h4 class="text-md font-semibold text-gray-700 border-b pb-2">
                    <i class="fas fa-microphone mr-2 text-pink-600"></i>Voice Configuration
                </h4>
                
                <!-- Voice Tone -->
                <div>
                    <label for="voiceToneSelect" class="form-label">Voice Tone</label>
                    <select id="voiceToneSelect" class="form-select">
                        <option value="friendly">Friendly - Warm and approachable</option>
                        <option value="professional">Professional - Business-focused</option>
                        <option value="playful">Playful - Light and engaging</option>
                    </select>
                    <p class="text-xs text-gray-500 mt-1">Controls word choice and phrasing style</p>
                </div>

                <!-- Speech Pace -->
                <div>
                    <label for="speechPaceSelect" class="form-label">Speech Pace</label>
                    <select id="speechPaceSelect" class="form-select">
                        <option value="slow">Slow - Deliberate and clear</option>
                        <option value="normal">Normal - Standard pace</option>
                        <option value="fast">Fast - Quick and efficient</option>
                    </select>
                    <p class="text-xs text-gray-500 mt-1">Adjusts TTS speed for ElevenLabs or Google</p>
                </div>
            </div>

            <!-- Right Column: Behavior Settings -->
            <div class="space-y-4">
                <h4 class="text-md font-semibold text-gray-700 border-b pb-2">
                    <i class="fas fa-user-cog mr-2 text-rose-600"></i>Behavior Controls
                </h4>
                
                <!-- Interactive Behaviors -->
                <div class="space-y-3">
                    <label class="flex items-center p-3 bg-blue-50 rounded-lg border border-blue-200">
                        <input type="checkbox" id="bargeInToggle" class="form-checkbox">
                        <div class="ml-3">
                            <span class="text-sm font-medium text-gray-900">Allow Barge-In</span>
                            <p class="text-xs text-gray-500">Caller can interrupt AI while speaking</p>
                        </div>
                    </label>

                    <label class="flex items-center p-3 bg-yellow-50 rounded-lg border border-yellow-200">
                        <input type="checkbox" id="emotionToggle" class="form-checkbox">
                        <div class="ml-3">
                            <span class="text-sm font-medium text-gray-900">Acknowledge Emotion</span>
                            <p class="text-xs text-gray-500">Respond to frustration, urgency, etc.</p>
                        </div>
                    </label>

                    <label class="flex items-center p-3 bg-green-50 rounded-lg border border-green-200">
                        <input type="checkbox" id="emojiToggle" class="form-checkbox">
                        <div class="ml-3">
                            <span class="text-sm font-medium text-gray-900">Use Emojis</span>
                            <p class="text-xs text-gray-500">Add emojis in SMS/email (👍 😊 ❌)</p>
                        </div>
                    </label>
                </div>
            </div>
        </div>

        <!-- Action Buttons -->
        <div class="mt-6 pt-4 border-t border-gray-200 flex justify-between items-center">
            <div class="flex items-center space-x-4">
                <button type="button" onclick="previewPersonality()" class="bg-pink-600 hover:bg-pink-700 text-white font-medium py-2 px-4 rounded-md shadow-sm transition duration-150 ease-in-out">
                    <i class="fas fa-play mr-2"></i>Preview Voice
                </button>
                <button type="button" onclick="resetPersonalityDefaults()" class="bg-gray-600 hover:bg-gray-700 text-white font-medium py-2 px-4 rounded-md shadow-sm transition duration-150 ease-in-out">
                    <i class="fas fa-undo mr-2"></i>Reset Defaults
                </button>
            </div>
            <div class="flex items-center space-x-3">
                <span id="personality-settings-saved" class="text-green-600 text-sm hidden">
                    <i class="fas fa-check-circle mr-1"></i>Personality Saved!
                </span>
                <button type="button" onclick="saveAgentPersonalitySettings()" class="bg-rose-600 hover:bg-rose-700 text-white font-medium py-2 px-6 rounded-md shadow-sm transition duration-150 ease-in-out">
                    <i class="fas fa-save mr-2"></i>Save Personality
                </button>
            </div>
        </div>
    </div>
</div>
```

---

## 🎨 Alternative: Simplified UI Implementation

For a more streamlined approach, here's a minimal version that can be easily embedded:

```html
<!-- Agent Personality Config Section -->
<div class="mt-10 border-t border-gray-200 pt-6">
  <h3 class="text-lg font-semibold text-gray-800 mb-3">🎭 Agent Personality</h3>

  <label class="block text-sm font-medium text-gray-700 mb-1">Voice Tone</label>
  <select id="voiceToneSelect" class="form-select mb-3">
    <option value="friendly">Friendly</option>
    <option value="professional">Professional</option>
    <option value="playful">Playful</option>
  </select>

  <label class="block text-sm font-medium text-gray-700 mb-1">Speech Pace</label>
  <select id="speechPaceSelect" class="form-select mb-3">
    <option value="slow">Slow</option>
    <option value="normal">Normal</option>
    <option value="fast">Fast</option>
  </select>

  <label class="flex items-center mb-2">
    <input type="checkbox" id="bargeInToggle" class="mr-2">
    Allow caller to interrupt AI while speaking (Barge-In)
  </label>

  <label class="flex items-center mb-2">
    <input type="checkbox" id="emotionToggle" class="mr-2">
    AI should acknowledge emotion (urgency, frustration)
  </label>

  <label class="flex items-center mb-4">
    <input type="checkbox" id="emojiToggle" class="mr-2">
    Use emojis in SMS/email (👍 😊 ❌)
  </label>

  <button 
    onclick="saveAgentPersonalitySettings(currentCompanyId)" 
    class="bg-indigo-600 text-white px-4 py-2 rounded hover:bg-indigo-700"
  >
    💾 Save Personality Settings
  </button>
</div>

<script>
async function loadAgentPersonalitySettings(companyId) {
  const res = await fetch(`/api/company/companies/${companyId}/personality`);
  const data = await res.json();

  document.getElementById('voiceToneSelect').value = data.voiceTone || 'friendly';
  document.getElementById('speechPaceSelect').value = data.speechPace || 'normal';
  document.getElementById('bargeInToggle').checked = data.bargeInMode ?? true;
  document.getElementById('emotionToggle').checked = data.acknowledgeEmotion ?? true;
  document.getElementById('emojiToggle').checked = data.useEmojis ?? false;
}

async function saveAgentPersonalitySettings(companyId) {
  const body = {
    voiceTone: document.getElementById('voiceToneSelect').value,
    speechPace: document.getElementById('speechPaceSelect').value,
    bargeInMode: document.getElementById('bargeInToggle').checked,
    acknowledgeEmotion: document.getElementById('emotionToggle').checked,
    useEmojis: document.getElementById('emojiToggle').checked
  };

  const res = await fetch(`/api/company/companies/${companyId}/personality`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  alert(res.ok ? "✅ Settings saved!" : "❌ Save failed.");
}
</script>
```

**Key Differences:**
- **Simpler Layout**: Single column, minimal spacing
- **Basic Styling**: Uses existing form classes without custom gradients
- **Streamlined JS**: Direct fetch calls with simple alerts
- **Easy Integration**: Can be dropped into any existing form or tab

---

## 📜 Step 4: JavaScript Functions (company-profile.html)

```js
// 🎭 AGENT PERSONALITY SETTINGS FUNCTIONS - Module 1

// Load agent personality settings
async function loadAgentPersonalitySettings() {
    const companyId = getCurrentCompanyId();
    if (!companyId) return;

    try {
        const response = await fetch(`/api/company/companies/${companyId}/personality`);
        if (!response.ok) {
            console.log('Using default personality settings');
            return;
        }
        
        const data = await response.json();
        
        document.getElementById('voiceToneSelect').value = data.voiceTone || 'friendly';
        document.getElementById('speechPaceSelect').value = data.speechPace || 'normal';
        document.getElementById('bargeInToggle').checked = data.bargeInMode ?? true;
        document.getElementById('emotionToggle').checked = data.acknowledgeEmotion ?? true;
        document.getElementById('emojiToggle').checked = data.useEmojis ?? false;
        
        console.log('✅ Personality settings loaded');
    } catch (error) {
        console.error('❌ Failed to load personality settings:', error);
    }
}

// Save agent personality settings
async function saveAgentPersonalitySettings() {
    const companyId = getCurrentCompanyId();
    if (!companyId) return;

    const personalityData = {
        voiceTone: document.getElementById('voiceToneSelect').value,
        speechPace: document.getElementById('speechPaceSelect').value,
        bargeInMode: document.getElementById('bargeInToggle').checked,
        acknowledgeEmotion: document.getElementById('emotionToggle').checked,
        useEmojis: document.getElementById('emojiToggle').checked
    };

    try {
        const response = await fetch(`/api/company/companies/${companyId}/personality`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(personalityData)
        });

        if (response.ok) {
            // Show success message
            const savedIndicator = document.getElementById('personality-settings-saved');
            savedIndicator.classList.remove('hidden');
            setTimeout(() => savedIndicator.classList.add('hidden'), 3000);
            
            console.log('✅ Personality settings saved');
            alert('✅ Personality settings saved successfully!');
        } else {
            throw new Error('Failed to save settings');
        }
    } catch (error) {
        console.error('❌ Failed to save personality settings:', error);
        alert(`❌ Failed to save personality settings: ${error.message}`);
    }
}

// Preview personality voice
async function previewPersonality() {
    const voiceTone = document.getElementById('voiceToneSelect').value;
    const speechPace = document.getElementById('speechPaceSelect').value;
    
    // Generate sample text based on voice tone
    let sampleText = "";
    switch(voiceTone) {
        case 'friendly':
            sampleText = "Hi there! Thanks for calling. I'm here to help make your day better. How can I assist you?";
            break;
        case 'professional':
            sampleText = "Good day. Thank you for contacting us. I'm ready to assist you with your needs. How may I help?";
            break;
        case 'playful':
            sampleText = "Hey! What's up? Ready to get things done? I'm excited to help you out today!";
            break;
    }
    
    alert(`🎭 Voice Preview (${voiceTone} tone, ${speechPace} pace):\n\n"${sampleText}"\n\nNote: Full TTS preview will be available in production.`);
}

// Reset personality to defaults
function resetPersonalityDefaults() {
    if (!confirm('Reset personality settings to defaults?')) return;
    
    document.getElementById('voiceToneSelect').value = 'friendly';
    document.getElementById('speechPaceSelect').value = 'normal';
    document.getElementById('bargeInToggle').checked = true;
    document.getElementById('emotionToggle').checked = true;
    document.getElementById('emojiToggle').checked = false;
    
    console.log('✅ Personality settings reset to defaults');
}
```

**Page Initialization:**
```js
// Add to AI Agent tab click handler
loadAgentPersonalitySettings(); // Module 1: Load personality settings
```

---

## 🚀 Implementation Summary

### ✅ Features Delivered
- **Voice Configuration**: Tone selection (friendly/professional/playful) and speech pace (slow/normal/fast)
- **Behavior Controls**: Barge-in mode, emotion acknowledgment, emoji usage toggles
- **Enterprise UI**: Beautiful pink/rose gradient theme, consistent with existing design
- **Full API**: Complete GET/PUT endpoints with validation and error handling
- **User Experience**: Preview voice, reset defaults, save confirmation

### 🔧 Technical Architecture
- **Database**: MongoDB schema with enum validation and sensible defaults
- **Backend**: Express.js routes with comprehensive error handling
- **Frontend**: Responsive Tailwind CSS design with interactive JavaScript
- **Integration**: Seamlessly integrated into existing AI Agent Logic Tab

### 📊 Business Impact
- **Per-Company Customization**: Each company can define their AI agent's personality
- **Professional Flexibility**: Support for different business styles and customer bases  
- **User-Friendly Controls**: Non-technical admins can easily configure agent behavior
- **Scalable Foundation**: Ready for TTS integration and advanced voice controls

### 🔜 Future Enhancements
- Live TTS preview with ElevenLabs/Google integration
- Advanced voice characteristics (pitch, emphasis, pauses)
- Personality presets for different industries
- A/B testing for personality optimization

---

**Module Status: ✅ COMPLETE**  
**Next Module:** 📚 Knowledge Q&A Source Controls

This module establishes the foundation for sophisticated AI agent personality management in your enterprise platform. Companies now have unprecedented control over their AI agent's voice and behavior characteristics.
