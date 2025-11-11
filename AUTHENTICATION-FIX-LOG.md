# 🔐 Authentication Fix Log - AI Scenario Assistant

## Issue
**Error**: `POST /api/admin/scenario-assistant/draft` returns `401 Unauthorized`

**Root Cause**: The route was using `authenticateSingleSession` middleware, which checks for sessions in Redis. However, the admin UI doesn't send session tokens; it sends JWT tokens in the `Authorization` header or `httpOnly` cookies.

## Solution Applied

### Before (Broken)
```javascript
const { authenticateSingleSession, requireRole } = require('../../middleware/auth');

router.post('/draft', authenticateSingleSession, requireRole('admin'), async (req, res) => {
  // ...
});
```

### After (Fixed)
```javascript
const { authenticateJWT, requireRole } = require('../../middleware/auth');

// Apply JWT auth + admin role requirement to ALL routes
router.use(authenticateJWT);
router.use(requireRole('admin'));

router.post('/draft', async (req, res) => {
  // ...
});
```

## What Changed

1. **Import**: `authenticateSingleSession` → `authenticateJWT`
2. **Middleware Application**: Moved to router-level with `router.use()` instead of inline
3. **Pattern Consistency**: Now matches the exact pattern used in `routes/admin/llmLearningV2.js`

## How It Works Now

1. ✅ Request comes in with JWT token (in Authorization header or httpOnly cookie)
2. ✅ `authenticateJWT` middleware validates the token
3. ✅ `requireRole('admin')` checks if user has admin role
4. ✅ Route handler processes the request
5. ✅ Response sent successfully (200 OK or 400 validation error, not 401)

## Testing

To test the fix:
1. Deploy to Render
2. Open admin UI
3. Go to scenario editor
4. Click "Ask AI to Draft Scenario"
5. Enter a description
6. Click "Generate Draft"
7. Should see LLM response (or clarifying questions), not 401 error

## Files Modified

- `routes/admin/llmScenarioAssistant.js` - Moved from inline middleware to router-level

## Related Issues

- This was blocking Phase C.1 conversational scenario assistant
- Now fully functional with proper authentication

