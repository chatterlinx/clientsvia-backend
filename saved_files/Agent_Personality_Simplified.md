# 🎭 Agent Personality Configuration - Simplified Version

## MongoDB Schema

```js
// models/Company.js
agentPersonalitySettings: {
  voiceTone: { type: String, enum: ['friendly', 'professional', 'playful'], default: 'friendly' },
  speechPace: { type: String, enum: ['slow', 'normal', 'fast'], default: 'normal' },
  bargeInMode: { type: Boolean, default: true },
  acknowledgeEmotion: { type: Boolean, default: true },
  useEmojis: { type: Boolean, default: false }
}
```

## HTML UI (Simplified Version)

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
```

## JavaScript Functions

```js
async function loadAgentPersonalitySettings(companyId) {
  const res = await fetch(`/api/company/${companyId}/personality`);
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

  const res = await fetch(`/api/company/${companyId}/personality`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  alert(res.ok ? "✅ Settings saved!" : "❌ Save failed.");
}
```

## Express API Routes

```js
// routes/company/personality.js

const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');

router.get('/:id/personality', async (req, res) => {
  const company = await Company.findById(req.params.id).lean();
  if (!company) return res.status(404).json({ error: 'Not found' });
  res.json(company.agentPersonalitySettings || {});
});

router.put('/:id/personality', async (req, res) => {
  const update = { agentPersonalitySettings: req.body };
  const company = await Company.findByIdAndUpdate(req.params.id, update, { new: true });
  if (!company) return res.status(404).json({ error: 'Update failed' });
  res.json({ success: true });
});

module.exports = router;
```

## Route Registration

```js
// In your app.js or index.js
app.use('/api/company', require('./routes/company/personality'));
```

✅ Agent Personality settings are now admin-editable in your UI and saved per company in MongoDB.
