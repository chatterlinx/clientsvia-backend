# 📞 TWILIO CONTROL CENTER - ARCHITECTURE DOCUMENTATION

## 🎯 Overview

The **Twilio Control Center** is a modern, centralized dashboard for managing telephony integrations within the AI Agent Settings tab. It provides real-time connection status, health monitoring, call routing configuration, and activity tracking.

---

## 🏗️ Architecture

### **Design Principles**
1. **Clean Isolation** - 100% separate from legacy AI Agent Logic (to be deleted)
2. **Modular Components** - Each section is self-contained and reusable
3. **Real-Time Updates** - Auto-refresh every 30 seconds
4. **Enterprise-Grade** - Production-ready with error handling and validation
5. **Future-Proof** - Ready for multi-provider expansion

### **Technology Stack**
- **Backend**: Node.js + Express + Mongoose
- **Frontend**: Vanilla JavaScript (ES6+ Classes)
- **Styling**: Custom CSS with glassmorphism
- **Data Flow**: REST API → JavaScript Classes → DOM Rendering

---

## 📂 File Structure

```
backend/
├── routes/company/
│   └── v2twilioControl.js        # API routes (6 endpoints)
├── models/
│   └── v2Company.js               # Mongoose schema (twilioConfig)
└── app.js                         # Route registration

frontend/
├── public/
│   ├── css/
│   │   └── twilio-control-center.css  # Isolated styles
│   ├── js/ai-agent-settings/
│   │   └── TwilioControlCenter.js     # Main JavaScript class
│   └── company-profile.html           # Integration point
```

---

## 🔌 API Endpoints

### **Base Path**: `/api/company/:companyId/twilio-control`

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/status` | Get Twilio connection status |
| `GET` | `/config` | Get full Twilio configuration (masked credentials) |
| `PATCH` | `/routing` | Update call routing settings |
| `POST` | `/test-call` | Initiate a test call to verify Twilio |
| `GET` | `/activity` | Get recent call activity (last 10) |
| `GET` | `/health` | Calculate health score (0-100) |

### **Authentication**
All endpoints require JWT authentication via `authenticateJWT` middleware.

---

## 📊 Data Model

### **Company.twilioConfig Schema**

```javascript
{
  // Credentials (from Profile Configuration)
  accountSid: String,
  authToken: String,      // Encrypted in DB
  phoneNumber: String,
  phoneNumbers: [{        // Support multiple numbers
    phoneNumber: String,
    label: String,
    status: String
  }],
  
  // Call Routing Settings (managed in Twilio Control Center)
  callRoutingMode: String,  // 'ai-agent' | 'voicemail' | 'forward'
  forwardNumber: String,
  recordingEnabled: Boolean,
  whisperMessage: String,
  
  // Metadata
  lastUpdated: Date
}
```

---

## 🎨 Frontend Components

### **TwilioControlCenter Class**

**Location**: `/public/js/ai-agent-settings/TwilioControlCenter.js`

**Responsibilities:**
- Load Twilio data from API
- Render UI components
- Handle user interactions
- Auto-refresh every 30 seconds

**Public Methods:**
```javascript
class TwilioControlCenter {
  constructor(companyId)
  async initialize()           // Load and render
  async refresh()              // Reload all data
  async saveRouting()          // Save routing settings
  async testConnection()       // Make test call
  startAutoRefresh()          // Enable 30s refresh
  stopAutoRefresh()           // Disable refresh
  destroy()                   // Cleanup
}
```

### **UI Sections**

1. **Header**
   - Twilio logo
   - Title and description
   - Health status badge

2. **Status Cards (3 cards)**
   - **Connection Status**: Live connection indicator with pulsing green/red dot
   - **Phone Number**: Current number with "Change Number" button
   - **Credentials**: Masked SID and Auth Token with "Edit in Profile" button

3. **Call Routing**
   - Radio buttons: AI Agent | Voicemail | Forward
   - Forward number input (conditional)
   - Recording toggle
   - "Save Routing Settings" button

4. **Activity Timeline**
   - Last 5 call events
   - Call direction (inbound/outbound)
   - Status, duration, timestamp
   - "View Full History" button

5. **Action Buttons**
   - Test Twilio Connection
   - Refresh
   - View Logs

---

## 🔄 Data Flow

### **Initialization**
```
User clicks "AI Agent Settings" tab
  ↓
Event listener fires
  ↓
TwilioControlCenter.initialize()
  ↓
loadAllData() (parallel fetch)
  ├── GET /status
  ├── GET /config
  ├── GET /health
  └── GET /activity
  ↓
render() (all components)
  ↓
startAutoRefresh() (30s interval)
```

### **Saving Routing Settings**
```
User changes routing mode
  ↓
User clicks "Save Routing Settings"
  ↓
saveRouting()
  ↓
PATCH /routing with new settings
  ↓
Company.twilioConfig updated
  ↓
Redis cache cleared
  ↓
refresh() to show new data
```

### **Test Call**
```
User clicks "Test Twilio Connection"
  ↓
Prompt for test phone number
  ↓
POST /test-call with number
  ↓
Twilio API: calls.create()
  ↓
TwiML: "This is a test call..."
  ↓
Alert: "Test call initiated!"
```

---

## 🎯 Health Scoring

**Score Range**: 0-100

**Components** (20 points each):
1. ✅ Account SID configured
2. ✅ Auth Token configured
3. ✅ Phone Number configured
4. ✅ Voice Settings configured (from AI Voice Settings tab)
5. ✅ Call Routing configured

**Status Thresholds**:
- **80-100**: Operational (green)
- **60-79**: Degraded (yellow)
- **0-59**: Error (red)

---

## 🔐 Security

### **Credentials Protection**
- Auth Token **never exposed** in full in API responses
- Masked format: `AC••••••4567` or `••••••••••••••••`
- JWT required for all API calls
- Redis cache cleared on credential updates

### **Multi-Tenant Isolation**
- All API calls scoped by `companyId`
- No cross-company data leakage
- Company access validation in middleware

---

## 🚀 Future Enhancements

### **Phase 1** (Current) ✅
- Connection status
- Health score
- Call routing
- Activity timeline
- Test calls

### **Phase 2** (Planned)
- Multiple phone numbers management
- Advanced call rules (business hours, IVR routing)
- Call analytics dashboard
- Webhook configuration UI

### **Phase 3** (Future)
- Multi-provider support (Plivo, SignalWire, Bandwidth)
- A/B testing for call routing
- Predictive analytics
- Voice quality monitoring

---

## 🧪 Testing

### **Manual Testing Checklist**
- [ ] Load Twilio Control Center (no errors in console)
- [ ] Connection status shows correct state
- [ ] Health score calculates correctly
- [ ] Phone number displays properly
- [ ] Credentials are masked
- [ ] Change routing mode (AI Agent → Voicemail → Forward)
- [ ] Save routing settings (persists after refresh)
- [ ] Test call (successful call initiated)
- [ ] Activity timeline shows recent calls
- [ ] Auto-refresh works (30s interval)
- [ ] Error handling (invalid phone number, missing credentials)

### **API Testing**
```bash
# Get status
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:5000/api/company/672123ac1cb93e4faf2e1ff6/twilio-control/status

# Get health
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:5000/api/company/672123ac1cb93e4faf2e1ff6/twilio-control/health

# Update routing
curl -X PATCH -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"mode":"ai-agent","recordingEnabled":true}' \
  http://localhost:5000/api/company/672123ac1cb93e4faf2e1ff6/twilio-control/routing
```

---

## 📝 Deployment Notes

### **Render Deployment**
1. Push to GitHub (triggers auto-deploy)
2. Render pulls latest code
3. Backend restart (30-60 seconds)
4. Frontend served via Express static

### **Database Migration**
No migration needed - `twilioConfig` schema already exists in v2Company model. New fields added:
- `callRoutingMode`
- `forwardNumber`
- `recordingEnabled`
- `whisperMessage`
- `lastUpdated`

### **Rollback Plan**
If issues occur:
1. Revert Git commit: `git revert <commit-hash>`
2. Push to GitHub: `git push origin main`
3. Render auto-deploys previous version
4. No data loss (new fields are optional)

---

## 📞 Support

**For issues or questions:**
- Check console logs (browser + server)
- Review error messages in UI
- Verify Twilio credentials in Profile Configuration
- Test with `curl` commands to isolate backend vs frontend issues

**Common Issues:**
- **"Twilio not configured"**: Add credentials in Profile Configuration tab
- **"Test call failed"**: Check Twilio Account SID/Auth Token validity
- **"Connection failed"**: Verify network access to Twilio API
- **"No activity"**: Company has no call logs yet

---

## 🎨 Design System

**Colors:**
- **Twilio Red**: `#F22F46` (primary brand)
- **Success Green**: `#28a745`
- **Warning Yellow**: `#ffc107`
- **Error Red**: `#dc3545`
- **Neutral Gray**: `#6c757d`

**Typography:**
- **Headers**: 700 weight, 24px
- **Body**: 400 weight, 14px
- **Monospace**: 'Courier New' (for credentials)

**Spacing:**
- **Container**: 24px padding
- **Cards**: 20px padding
- **Gaps**: 12-20px between elements

---

## ✅ Checklist: Before Going Live

- [x] Backend API endpoints tested
- [x] Frontend UI renders correctly
- [x] Auto-refresh works
- [x] Save routing persists
- [x] Test call successful
- [x] Health score accurate
- [x] Error handling implemented
- [x] Security validated (JWT, masked credentials)
- [x] Multi-tenant isolation verified
- [x] Documentation complete
- [ ] Manual testing by admin
- [ ] Production deployment
- [ ] Monitor Render logs for errors

---

**Built with 💪 by Marc & AI Assistant**
**Version**: 1.0.0
**Last Updated**: October 13, 2025

