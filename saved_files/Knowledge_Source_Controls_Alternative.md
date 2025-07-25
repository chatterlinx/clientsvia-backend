# 📚 Agent Knowledge Base Source Controls Module

> Enable developers/admins to manage where the AI pulls answers from and in what order:
> Company Q&A → Trade Q&A → Semantic Vector → LLM

---

## 🧠 Purpose

Let the admin fine-tune how the agent prioritizes knowledge sources:
- Disable fallback to LLM if needed
- Set minimum confidence thresholds
- Control semantic matching activation
- Define fallback order

---

## ✅ Mongoose Schema Patch (Company.js)

```js
knowledgeSourceSettings: {
  allowCompanyQnA: { type: Boolean, default: true },
  allowTradeQnA: { type: Boolean, default: true },
  allowSemanticSearch: { type: Boolean, default: true },
  allowLLMFallback: { type: Boolean, default: true },
  semanticThreshold: { type: Number, default: 0.65 },
  fallbackOrder: {
    type: [String],
    default: ['companyQnA', 'tradeQnA', 'semantic', 'llm']
  }
}
```

## 💻 Admin UI (HTML + JS)

### HTML
```html
<div class="mt-6 border-t border-gray-200 pt-6">
  <h3 class="text-md font-medium text-gray-700 mb-3">Knowledge Base Source Controls</h3>
  
  <div class="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
    <label><input type="checkbox" id="src-company" /> Company Q&A</label>
    <label><input type="checkbox" id="src-trade" /> Trade Q&A</label>
    <label><input type="checkbox" id="src-semantic" /> Semantic Matching</label>
    <label><input type="checkbox" id="src-llm" /> LLM Fallback</label>
  </div>

  <label class="block mt-4 text-sm">
    Semantic Confidence Threshold
    <input type="number" id="semantic-threshold" min="0" max="1" step="0.01"
      class="mt-1 w-full border px-2 py-1 rounded" />
  </label>

  <label class="block mt-4 text-sm">
    Fallback Order (comma-separated):
    <input type="text" id="fallback-order"
      class="mt-1 w-full border px-2 py-1 rounded"
      placeholder="companyQnA,tradeQnA,semantic,llm" />
  </label>

  <button onclick="saveKnowledgeSettings(currentCompanyId)" class="mt-4 px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700">💾 Save Knowledge Settings</button>
</div>
```

### JavaScript
```js
async function loadKnowledgeSettings(companyId) {
  const res = await fetch(`/api/company/companies/${companyId}`);
  const company = await res.json();
  const s = company.knowledgeSourceSettings || {};

  document.getElementById("src-company").checked = s.allowCompanyQnA ?? true;
  document.getElementById("src-trade").checked = s.allowTradeQnA ?? true;
  document.getElementById("src-semantic").checked = s.allowSemanticSearch ?? true;
  document.getElementById("src-llm").checked = s.allowLLMFallback ?? true;
  document.getElementById("semantic-threshold").value = s.semanticThreshold ?? 0.65;
  document.getElementById("fallback-order").value = (s.fallbackOrder || ['companyQnA','tradeQnA','semantic','llm']).join(',');
}

async function saveKnowledgeSettings(companyId) {
  const body = {
    knowledgeSourceSettings: {
      allowCompanyQnA: document.getElementById("src-company").checked,
      allowTradeQnA: document.getElementById("src-trade").checked,
      allowSemanticSearch: document.getElementById("src-semantic").checked,
      allowLLMFallback: document.getElementById("src-llm").checked,
      semanticThreshold: parseFloat(document.getElementById("semantic-threshold").value),
      fallbackOrder: document.getElementById("fallback-order").value.split(',').map(s => s.trim())
    }
  };

  const res = await fetch(`/api/company/companies/${companyId}/knowledge-source`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  alert(res.ok ? '✅ Saved!' : '❌ Save failed');
}
```

## 🌐 API Route (Express)

```js
// routes/company/knowledgeSource.js
const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');

router.post('/companies/:id/knowledge-source', async (req, res) => {
  try {
    const settings = req.body.knowledgeSourceSettings;
    const company = await Company.findByIdAndUpdate(req.params.id, { knowledgeSourceSettings: settings }, { new: true });
    if (!company) return res.status(404).json({ error: 'Company not found' });
    res.json({ success: true, company });
  } catch (err) {
    console.error('Error saving knowledge source settings:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
```

Mount it:

```js
app.use('/api/company', require('./routes/company/knowledgeSource'));
```

✅ Now you're fully wired to allow per-company knowledge strategy tuning via HTML.

Next step: implement qaEngine.js to respect these flags when resolving queries.
