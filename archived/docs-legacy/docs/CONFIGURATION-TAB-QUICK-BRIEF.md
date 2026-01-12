# ⚡ Configuration Tab - Quick Brief

**Last Updated:** October 6, 2025 | **Status:** Production-Ready ✅

---

## 🎯 What It Does

The **Configuration Tab** manages all company-level Twilio and account settings. Second most critical tab after AI Agent Logic.

---

## 🧩 4 Main Components

### 1. **Twilio Credentials** 🔐
- Stores: Account SID, Auth Token, API Keys
- **Security:** Masked in UI (shows last 4 chars only)
- **Location:** `twilioConfig` in MongoDB

### 2. **Phone Numbers** 📞
- Manage multiple phone numbers per company
- Set primary number for routing
- **Format Required:** E.164 (`+12395551234`)
- **Minimum:** 1 phone number always required

### 3. **Account Status Control** 🚨
Three status types:
- **🟢 Active:** Normal AI agent operation
- **🟡 Call Forward:** Forward to external number + custom message
- **🔴 Suspended:** Block all calls

**Key Feature:** Custom forward message with `{Company Name}` placeholder

### 4. **Webhooks** 🔗
- Auto-generated URLs for Twilio integration
- Format: `/api/twilio/v2-voice-webhook/{companyId}`

---

## 🔄 How It Works

```
User Changes Settings
    ↓
Frontend Validation
    ↓
API: PATCH /api/company/:companyId
    ↓
MongoDB Update
    ↓
Redis Cache Clear (CRITICAL!)
    ↓
Real-Time Update Complete
```

---

## 🚨 CRITICAL: Cache Strategy

**THE MOST IMPORTANT THING TO KNOW:**

Twilio webhooks use cache key: `company-phone:+12392322030`

**When saving ANY configuration change, you MUST clear:**
```javascript
await redisClient.del(`company:${companyId}`);
await redisClient.del(`company-phone:${phoneNumber}`); // ← CRITICAL!
```

**Why:** If you don't clear the phone-based cache, Twilio will use stale data and changes won't appear in real-time.

---

## 📁 Key Files

| File | Purpose | Lines |
|------|---------|-------|
| `public/js/company-profile-modern.js` | Frontend logic | 1147-3300 |
| `routes/v2company.js` | API endpoints | Account status routes |
| `routes/v2twilio.js` | Webhook handlers | Status check at line 270 |
| `models/v2Company.js` | Data schema | `accountStatus` field |

---

## 🔧 Common Issues & Fixes

### Issue 1: Changes Not Appearing in Real-Time ⚠️
**Symptom:** User updates call forward message, old message still plays  
**Cause:** Cache not cleared with correct key format  
**Fix:** Clear `company-phone:${phoneNumber}` cache key

### Issue 2: Phone Validation Failing
**Symptom:** Cannot save phone number  
**Cause:** Wrong format  
**Fix:** Use E.164 format: `+12395551234`

### Issue 3: Placeholder Not Replacing
**Symptom:** `{Company Name}` shows literally in message  
**Cause:** Regex not matching  
**Fix:** Check `routes/v2twilio.js` line 298 - supports both `{Company Name}` and `{CompanyName}`

---

## 🧪 Quick Test

```bash
# 1. Update call forward message in UI
# 2. Click "Update Account Status"
# 3. Check logs for cache clearing:
🗑️ Cleared cache key: company-phone:+12392322030

# 4. Make test call immediately
# 5. New message should play ✅
```

---

## 📊 Data Structure

```javascript
{
    twilioConfig: {
        accountSid: "AC18c622...",
        authToken: "token_here",
        phoneNumbers: [
            {
                phoneNumber: "+12392322030",
                friendlyName: "Primary",
                status: "active",
                isPrimary: true
            }
        ]
    },
    accountStatus: {
        status: "call_forward",
        callForwardNumber: "+12395652202",
        callForwardMessage: "Thank you for calling {Company Name}...",
        reason: "Maintenance",
        changedBy: "admin@clientsvia.com",
        changedAt: Date,
        history: [...]
    }
}
```

---

## ✅ Key Functions

**Frontend:**
- `populateConfigTab()` - Load settings
- `saveAccountStatus()` - Save status + clear cache
- `renderPhoneNumbers()` - Display phone list

**Backend:**
- `PATCH /api/company/:companyId/account-status` - Save status
- `getCompanyByPhoneNumber()` - Twilio lookup (uses cache!)

---

## 🎯 Success Checklist

Before considering Configuration Tab "working":
- [ ] Credentials load and save correctly
- [ ] Phone numbers add/remove/set primary
- [ ] Account status changes apply in real-time
- [ ] Call forward message plays with placeholder replaced
- [ ] Webhooks display correct URLs
- [ ] Cache clears on every update

---

## 💡 Quick Tips

1. **Always clear phone-based cache:** `company-phone:${phoneNumber}`
2. **E.164 format required:** `+12395551234`
3. **Placeholder is case-insensitive:** `{Company Name}` or `{CompanyName}`
4. **Test immediately after changes:** Real-time updates should work
5. **Check logs for cache clearing:** Should see `🗑️ Cleared cache key:`

---

## 📞 Emergency Troubleshooting

**If nothing works:**
```bash
# 1. Clear ALL Redis cache
redis-cli FLUSHALL

# 2. Restart server
pm2 restart all

# 3. Test with fresh browser session (clear localStorage)
```

---

## 🔗 Full Documentation

For complete details, see: `CONFIGURATION-TAB-ARCHITECTURE.md`

---

**END OF QUICK BRIEF**

*Use this for rapid AI onboarding. For deep troubleshooting, refer to full architecture doc.*
