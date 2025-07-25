# Agent Personality Responses Integration - Module 1 Extension

## Overview

This document describes the extension to Module 1 (Agent Personality Configuration) that integrates customizable response categories per company. This extension connects the existing "Agent Personality Responses" tab in the UI with the backend `agentPersonalitySettings.responses` array schema.

## Implementation Components

### 1. Schema Updates

The Company schema already includes a `responses` array within the `agentPersonalitySettings` object:

```javascript
agentPersonalitySettings: {
    voiceTone: { type: String, enum: ['friendly', 'professional', 'playful'], default: 'friendly' },
    speechPace: { type: String, enum: ['slow', 'normal', 'fast'], default: 'normal' },
    bargeInMode: { type: Boolean, default: true },
    acknowledgeEmotion: { type: Boolean, default: true },
    useEmojis: { type: Boolean, default: false },
    // Response categories for customizable agent messages
    responses: [{
        key: { type: String, required: true },
        label: { type: String, required: true },
        description: { type: String, default: '' },
        defaultMessage: { type: String, required: true },
        customMessage: { type: String, default: null },
        useCustom: { type: Boolean, default: false }
    }]
}
```

### 2. API Routes

Added two new routes in `/routes/company/personality.js`:

- `GET /api/company/companies/:id/personality/responses` - Retrieves all response categories for a company
- `PUT /api/company/companies/:id/personality/responses` - Updates response categories for a company

### 3. Frontend Integration

The existing "Agent Personality Responses" tab in `company-profile.html` now connects to these APIs and allows:

- Viewing all available response categories
- Adding new response categories
- Editing existing response categories
- Deleting response categories
- Toggling between default and custom messages
- Previewing responses

### 4. Runtime Agent Logic

Enhanced the `personalityResponses_enhanced.js` utilities to:

- Fetch and cache company-specific responses
- Return custom responses when available (falling back to defaults)
- Clear cache when responses are updated

## Usage Flow

1. **View Responses**: When the "Agent Personality Responses" tab is opened, the system loads all response categories from the API.

2. **Add Response**: Click "Add Response Category" to open a modal where you can enter:
   - Category Key (unique identifier)
   - Display Label (user-friendly name)
   - Icon (FontAwesome class)
   - Description
   - Default Response Template

3. **Edit Response**: Click the edit icon on any category to modify its details.

4. **Delete Response**: Click the trash icon to remove a category.

5. **Toggle Custom/Default**: Use the toggle switch to choose between custom and default message for each category.

6. **Preview**: Click the "Preview" button to see how the response will appear.

## Runtime Behavior

When the AI agent needs a response from a specific category:

1. The system looks for a company-specific custom response for that category
2. If found and `useCustom` is true, it uses the `customMessage`
3. Otherwise, it falls back to the category's `defaultMessage`
4. If no company-specific response exists, it uses the global default response

## Benefits

- **Company-Specific Personality**: Each company can have unique responses that match their brand voice
- **Easy Management**: UI-based editing of responses without code changes
- **Default Fallbacks**: System always has a response even if custom ones aren't set
- **Categorized Responses**: Organized by situation/context for better control

## Technical Notes

- Responses are cached in memory for performance
- The cache is cleared when responses are updated
- Each response category can have its own toggle state
- The UI provides immediate feedback with notifications
- Changes are automatically saved to the database
