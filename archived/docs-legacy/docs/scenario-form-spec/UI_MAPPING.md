# UI Element to JSON Path Mapping

**Schema Version:** V22  
**Generated:** 2025-12-22  
**Purpose:** Enable deterministic auto-fill of UI forms via `window.applyScenarioSpec()`

---

## Global Functions Available

```javascript
// Auto-fill scenario form fields
window.applyScenarioSpec(scenarioSpec)

// Auto-fill template settings
window.applyTemplateSpec(templateSpec)

// Export functions
window.exportTemplateJSON(templateId)
window.exportCategoryJSON(templateId, categoryId)
window.exportScenarioJSON(templateId, categoryId, scenarioId)
```

---

## Scenario Editor Form Mapping

### Tab: Basic Info

| UI Element | Selector(s) | JSON Path | Input Type |
|------------|-------------|-----------|------------|
| Scenario Name | `#scenario-name`, `[name="name"]`, `.scenario-name-input` | `scenario.name` | text |
| Scenario ID | `#scenario-id`, `[name="scenarioId"]` | `scenario.scenarioId` | text (readonly after create) |
| Version | `#scenario-version` | `scenario.version` | number (readonly) |
| Status | `#scenario-status`, `[name="status"]` | `scenario.status` | select: draft/live/archived |
| Active Toggle | `#scenario-active`, `[name="isActive"]` | `scenario.isActive` | checkbox |
| Categories | `#scenario-categories`, `.categories-multiselect` | `scenario.categories` | multiselect/tags |
| Admin Notes | `#scenario-notes`, `[name="notes"]`, `.notes-textarea` | `scenario.notes` | textarea |

### Tab: Triggers & Matching

| UI Element | Selector(s) | JSON Path | Input Type |
|------------|-------------|-----------|------------|
| Trigger Phrases | `#scenario-triggers`, `#triggers-input`, `.triggers-textarea` | `scenario.triggers` | textarea (newline-separated) |
| Negative Triggers | `#negative-triggers`, `#scenario-negative-triggers` | `scenario.negativeTriggers` | textarea (newline-separated) |
| Regex Triggers | `#regex-triggers`, `#scenario-regex-triggers` | `scenario.regexTriggers` | textarea (newline-separated) |
| Fast-Match Keywords | `#keywords-input`, `#scenario-keywords` | `scenario.keywords` | textarea (newline-separated) |
| Negative Keywords | `#negative-keywords-input` | `scenario.negativeKeywords` | textarea (newline-separated) |
| Example User Phrases | `#example-phrases`, `#scenario-example-phrases` | `scenario.exampleUserPhrases` | textarea (newline-separated) |
| Negative User Phrases | `#negative-user-phrases` | `scenario.negativeUserPhrases` | textarea (newline-separated) |
| Context Weight | `#context-weight`, `#scenario-context-weight` | `scenario.contextWeight` | slider (0-1) |
| Test Phrases | `#test-phrases`, `#scenario-test-phrases` | `scenario.testPhrases` | textarea (newline-separated) |

### Tab: Replies & Flow

| UI Element | Selector(s) | JSON Path | Input Type |
|------------|-------------|-----------|------------|
| Quick Replies | `#quick-replies`, `#scenario-quick-replies`, `.quick-replies-textarea` | `scenario.quickReplies` | textarea (double-newline separated) |
| Full Replies | `#full-replies`, `#scenario-full-replies`, `.full-replies-textarea` | `scenario.fullReplies` | textarea (double-newline separated) |
| Follow-Up Prompts | `#followup-prompts`, `#scenario-followup-prompts` | `scenario.followUpPrompts` | textarea (double-newline separated) |
| Follow-Up Funnel | `#followup-funnel`, `#scenario-followup-funnel` | `scenario.followUpFunnel` | text |
| Reply Selection Mode | `#reply-selection`, `[name="replySelection"]` | `scenario.replySelection` | select: sequential/random/bandit |
| Scenario Type | `#scenario-type`, `[name="scenarioType"]` | `scenario.scenarioType` | select: INFO_FAQ/ACTION_FLOW/SYSTEM_ACK/SMALL_TALK |
| Reply Strategy | `#reply-strategy`, `[name="replyStrategy"]` | `scenario.replyStrategy` | select: AUTO/FULL_ONLY/QUICK_ONLY/etc. |
| Follow-Up Mode | `#followup-mode`, `[name="followUpMode"]` | `scenario.followUpMode` | select: NONE/ASK_FOLLOWUP_QUESTION/ASK_IF_BOOK/TRANSFER |
| Follow-Up Question Text | `#followup-question-text` | `scenario.followUpQuestionText` | text |
| Transfer Target | `#transfer-target` | `scenario.transferTarget` | text |

### Tab: Entities & Variables

| UI Element | Selector(s) | JSON Path | Input Type |
|------------|-------------|-----------|------------|
| Entities to Capture | `#entity-capture`, `.entity-capture-multiselect` | `scenario.entityCapture` | multiselect |
| Entity Validation Rules | `#entity-validation-json`, `.entity-validation-editor` | `scenario.entityValidation` | JSON editor |
| Dynamic Variable Fallbacks | `#dynamic-variables-json` | `scenario.dynamicVariables` | JSON editor |
| Q&A Training Pairs | `#qna-pairs-json` | `scenario.qnaPairs` | JSON editor (readonly) |
| Conversation Examples | `#examples-json`, `.examples-editor` | `scenario.examples` | JSON editor |

### Tab: Advanced Settings

| UI Element | Selector(s) | JSON Path | Input Type |
|------------|-------------|-----------|------------|
| Minimum Confidence | `#min-confidence`, `#scenario-min-confidence` | `scenario.minConfidence` | slider (0-1) or "inherit" |
| Priority | `#priority`, `#scenario-priority` | `scenario.priority` | number (-10 to 100) |
| Cooldown (seconds) | `#cooldown`, `#scenario-cooldown` | `scenario.cooldownSeconds` | number |
| Channel Restriction | `#channel`, `[name="channel"]` | `scenario.channel` | select: voice/sms/chat/any |
| Language | `#language`, `[name="language"]` | `scenario.language` | select: auto/en/es/fr/etc. |
| Preconditions (JSON) | `#preconditions-json` | `scenario.preconditions` | JSON editor |
| Effects (JSON) | `#effects-json` | `scenario.effects` | JSON editor |
| Sensitive Info Rule | `#sensitive-info-rule` | `scenario.sensitiveInfoRule` | select: platform_default/custom |
| Custom Masking (JSON) | `#custom-masking-json` | `scenario.customMasking` | JSON editor |
| Timed Follow-Up Enabled | `#timed-followup-enabled` | `scenario.timedFollowUp.enabled` | checkbox |
| Timed Follow-Up Delay | `#timed-followup-delay` | `scenario.timedFollowUp.delaySeconds` | number |
| Timed Follow-Up Messages | `#timed-followup-messages` | `scenario.timedFollowUp.messages` | textarea |
| Extension Seconds | `#extension-seconds` | `scenario.timedFollowUp.extensionSeconds` | number |
| Max Consecutive Silences | `#max-consecutive-silences` | `scenario.silencePolicy.maxConsecutive` | number |
| Silence Final Warning | `#silence-final-warning` | `scenario.silencePolicy.finalWarning` | text |

### Tab: Action Hooks

| UI Element | Selector(s) | JSON Path | Input Type |
|------------|-------------|-----------|------------|
| Action Hooks | `#action-hooks`, `.action-hooks-multiselect` | `scenario.actionHooks` | multiselect |
| Handoff Policy | `#handoff-policy`, `[name="handoffPolicy"]` | `scenario.handoffPolicy` | select: never/low_confidence/always_on_keyword |
| Escalation Flags | `#escalation-flags`, `.escalation-flags-multiselect` | `scenario.escalationFlags` | multiselect |

### Tab: Voice & TTS

| UI Element | Selector(s) | JSON Path | Input Type |
|------------|-------------|-----------|------------|
| AI Behavior | `#behavior`, `[name="behavior"]`, `.behavior-select` | `scenario.behavior` | select (dynamic) |
| Tone Level | `#tone-level` | `scenario.toneLevel` | slider (1-5) |
| TTS Pitch Override | `#tts-pitch` | `scenario.ttsOverride.pitch` | text |
| TTS Rate Override | `#tts-rate` | `scenario.ttsOverride.rate` | text |
| TTS Volume Override | `#tts-volume` | `scenario.ttsOverride.volume` | text |

---

## Category Editor Form Mapping

| UI Element | Selector(s) | JSON Path | Input Type |
|------------|-------------|-----------|------------|
| Category ID | `#category-id`, `[name="categoryId"]` | `category.id` | text (readonly after create) |
| Category Name | `#category-name`, `[name="categoryName"]` | `category.name` | text |
| Icon | `#category-icon`, `.icon-picker` | `category.icon` | emoji picker / text |
| Description | `#category-description` | `category.description` | textarea |
| Default Behavior | `#category-behavior` | `category.behavior` | select |
| Active Toggle | `#category-active` | `category.isActive` | checkbox |
| Additional Filler Words | `#category-fillers` | `category.additionalFillerWords` | textarea (newline-separated) |
| Category Synonyms | `#category-synonyms-json` | `category.synonymMap` | JSON editor |

---

## Auto-Fill Implementation

### Setting Text/Number Fields

```javascript
function setFieldValue(fieldId, value) {
    const selectors = [
        `#${fieldId}`,
        `#scenario-${fieldId}`,
        `[name="${fieldId}"]`,
        `.${fieldId}-input`
    ];
    
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
            element.value = value;
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }
    }
    return false;
}
```

### Setting Textarea Arrays (Triggers, Replies)

```javascript
function setTriggersField(triggers) {
    const selectors = ['#scenario-triggers', '#triggers-input', '.triggers-textarea'];
    
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
            element.value = triggers.join('\n');  // Newline-separated
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
    }
    return false;
}

function setRepliesField(type, replies) {
    const selector = type === 'quick' 
        ? '#quick-replies, #scenario-quick-replies' 
        : '#full-replies, #scenario-full-replies';
    
    const element = document.querySelector(selector);
    if (element) {
        element.value = replies.join('\n\n');  // Double-newline for readability
        element.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
    }
    return false;
}
```

### Setting Select Fields

```javascript
function setSelectValue(fieldId, value) {
    const selectors = [
        `#${fieldId}`,
        `#scenario-${fieldId}`,
        `[name="${fieldId}"]`
    ];
    
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.tagName === 'SELECT') {
            element.value = value;
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
    }
    return false;
}
```

### Setting Toggle/Checkbox Fields

```javascript
function setCheckboxValue(fieldId, checked) {
    const selectors = [
        `#${fieldId}`,
        `#scenario-${fieldId}`,
        `[name="${fieldId}"]`
    ];
    
    for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && element.type === 'checkbox') {
            element.checked = checked;
            element.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
        }
    }
    return false;
}
```

---

## Full Auto-Fill Example

```javascript
// ChatGPT generates this spec
const scenarioSpec = {
    name: "AC Not Cooling",
    triggers: ["ac not cooling", "air conditioner not cold", "no cold air"],
    negativeTriggers: ["heater", "furnace"],
    quickReplies: [
        "I'm sorry to hear your AC isn't cooling properly. Let me help you with that.",
        "That sounds uncomfortable, especially in hot weather. Let's get that checked out.",
        // ... 5 more variations
    ],
    fullReplies: [
        "I understand how frustrating it is when your AC isn't cooling properly, especially during warm weather. This is definitely something we can help with. Let me check our schedule for the soonest available appointment. Before I do, can you tell me if you've noticed any unusual sounds or if the unit is running but just not producing cold air?",
        // ... 6 more variations
    ],
    minConfidence: 0.70,
    priority: 60,
    replyStrategy: "AUTO",
    channel: "any"
};

// AI Coder executes this
window.applyScenarioSpec(scenarioSpec);

// Then clicks save
document.querySelector('#btn-save-scenario').click();
```

---

## Notes

1. **Selector Priority:** Try IDs first, then name attributes, then class-based selectors
2. **Event Dispatch:** Always dispatch `change` and `input` events to trigger form validation
3. **Array Parsing:** Most arrays are newline-separated in textareas
4. **JSON Fields:** Use Monaco editor or similar; parse JSON before applying
5. **Dynamic Options:** Some selects (behavior, categories) load options dynamically

