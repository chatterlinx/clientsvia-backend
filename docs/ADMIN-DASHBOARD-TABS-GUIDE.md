# Admin Dashboard - Complete Tab-by-Tab Guide

**Purpose**: Detailed breakdown of every tab in the Company Profile dashboard  
**Last Updated**: October 20, 2025

---

## 📑 Dashboard Overview

The Company Profile dashboard is the central control center for managing all aspects of a company's AI receptionist. It consists of **10 main tabs**, each serving a specific purpose.

**Access**: `https://clientsvia-backend.onrender.com/company-profile.html?id={companyId}`

---

## Tab Navigation Structure

```
┌─────────────────────────────────────────────────────────────────┐
│  COMPANY PROFILE: Royal Plumbing                                 │
├─────────────────────────────────────────────────────────────────┤
│  [Overview] [Configuration] [AiCore Control Center]             │
│  [AI Performance] [AI Voice Settings] [Twilio Control Center]   │
│  [Spam Filter] [Notes] [Contacts] [Call Archives]               │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1️⃣ Overview Tab

**Purpose**: High-level company information and quick status check

### **Sections**:

#### A. **Company Identity**
- Company Name
- Business Phone (E.164 format)
- Email Address
- Physical Address (street, city, state, zip, country)
- Timezone
- Status Badge (🟢 Active / 🟡 Call Forward / 🔴 Suspended)

#### B. **AI Agent Status**
- **Readiness Score**: 0-100%
  - Variables: 0-100 points
  - Filler Words: 0-100 points
  - Scenarios: 0-100 points (deprecated)
  - Voice: 0-100 points
  - Test Calls: 0-100 points
- **Can Go Live**: Yes/No indicator
- **Blockers**: List of issues preventing go-live

#### C. **Quick Actions**
- Edit Company Profile
- Test AI Agent
- View Call Logs
- Download Configuration

### **Key Files**:
- Frontend: `public/company-profile.html` (Overview section)
- Backend: `GET /api/company/:companyId`
- Service: `services/ConfigurationReadinessService.js`

---

## 2️⃣ Configuration Tab

**Purpose**: Core account settings, Twilio credentials, and phone numbers

### **Sections**:

#### A. **Twilio Credentials**
```javascript
{
  accountSid: "AC18c622...",          // Masked: AC18••••59f2
  authToken: "a1b2c3...",             // Masked: ••••••••2d29
  apiKey: "SK123...",                 // Optional, masked if present
  apiSecret: "xyz..."                 // Optional, masked if present
}
```

**Features**:
- Auto-masking (only last 4 characters visible)
- "Test Connection" button → Verifies credentials
- Save → Clears Redis cache (`company:{id}` + `company-phone:{number}`)

#### B. **Phone Numbers Management**
```javascript
[
  {
    phoneNumber: "+12392322030",
    friendlyName: "Main Office Line",
    status: "active",                 // active | inactive
    isPrimary: true                   // Only ONE can be primary
  },
  {
    phoneNumber: "+12395551234",
    friendlyName: "After Hours Line",
    status: "active",
    isPrimary: false
  }
]
```

**Features**:
- Add/Edit/Remove phone numbers
- Set primary number (required)
- E.164 validation (enforced)
- Auto-generates webhook URL per number

#### C. **Account Status Control**
```javascript
{
  status: "active",                    // active | call_forward | suspended | paused
  callForwardNumber: "+12395652202",   // Required if status=call_forward
  callForwardMessage: "Thank you for calling {Company Name}. We're currently closed...",
  reason: "Holiday Hours",             // Optional admin note
  changedBy: "admin@clientsvia.com",
  changedAt: "2025-10-20T15:30:00Z"
}
```

**Status Options**:
- 🟢 **Active**: Normal AI operation
- 🟡 **Call Forward**: Plays message → Forwards to number
- 🔴 **Suspended**: Service unavailable message → Hang up
- ⚪ **Paused**: Temporary pause message → Hang up

**Placeholder Support**:
- `{Company Name}` → Replaced with company.companyName
- `{Phone}` → Replaced with primary phone number
- `{Website}` → Replaced with company.domain

#### D. **Webhook URLs** (Read-Only)
- Voice: `/api/twilio/v2-voice-webhook/:companyId`
- SMS: `/api/twilio/sms-webhook/:companyId`
- Status: `/api/twilio/status-callback/:companyId`

### **Cache Strategy**:
**CRITICAL**: After ANY Configuration tab save:
```javascript
// Clear BOTH cache keys:
await redisClient.del(`company:${companyId}`);
await redisClient.del(`company-phone:${phoneNumber}`);  // For EACH number
```

Failure to clear = Stale data in production!

### **Key Files**:
- Frontend: `public/company-profile.html` (Configuration section)
- Backend: `PATCH /api/company/:companyId` (lines 850-1050)
- Model: `models/v2Company.js` (twilioConfig + accountStatus)

---

## 3️⃣ AiCore Control Center Tab

**Purpose**: Centralized AI knowledge management and configuration

### **Sub-Tabs**:

#### A. **Variables Sub-Tab**
- **Company Variables**: Placeholders like {Company Name}, {Phone}, {Email}
- **Scan Status**: Shows where variables are used (Q&A, templates, greetings)
- **Validation**: Ensures all variables have values
- **Auto-Replacement**: Variables replaced in real-time during calls

**Data Structure**:
```javascript
aiAgentLogic: {
  placeholders: [
    { id: "companyname", name: "companyname", value: "Royal Plumbing" },
    { id: "phonenumber", name: "phonenumber", value: "+12392322030" },
    { id: "email", name: "email", value: "info@royalplumbing.com" }
  ]
}
```

#### B. **Knowledge Source Priority Sub-Tab**
- **Priority Order**: 1) Company Q&A, 2) Trade Q&A, 3) Templates, 4) In-House Fallback
- **Confidence Thresholds**:
  - Company Q&A: ≥0.8
  - Trade Q&A: ≥0.75
  - Templates: ≥0.7
  - In-House Fallback: ≥0.5 (always responds)
- **Memory Settings**: (Future feature - currently inactive)

**Data Structure**:
```javascript
aiAgentLogic: {
  thresholds: {
    companyQnA: 0.8,
    tradeQnA: 0.75,
    templates: 0.7,
    inHouseFallback: 0.5
  },
  knowledgeSourcePriorities: ["companyQnA", "tradeQnA", "templates", "fallback"]
}
```

#### C. **Company Q&A Sub-Tab**
- **Purpose**: Company-specific Q&A library (highest priority)
- **Features**:
  - Add/Edit/Delete Q&As
  - Category organization (12 categories: Hours, Services, Pricing, etc.)
  - AI-generated keywords for better matching
  - Confidence score preview
- **Process**:
  1. Admin creates Q&A: "What are your hours?" → "We're open Mon-Fri 8am-6pm"
  2. Backend generates keywords using AI
  3. Keywords stored for fast matching
  4. During call: Customer query → Match against keywords → Return answer

**Data Model**: `models/knowledge/CompanyQnA.js`

#### D. **Trade Q&A Sub-Tab**
- **Purpose**: Industry-specific Q&A (e.g., Plumbing, HVAC)
- **Selection**: Company selects 1 trade from global list
- **Source**: Global Trade Categories (managed separately)
- **Scope**: `companyId` + `tradeId`

**Key**: Trade Q&As are SHARED across all companies in the same trade but scoped to ensure isolation.

#### E. **AiCore Templates Sub-Tab**
- **Purpose**: Structured, reusable response templates
- **Types**:
  - Global Templates (shared across platform)
  - Company Templates (company-specific)
- **Cloning**: Companies can clone global templates and customize
- **Variables**: Full variable support

**Data Model**: `models/v2Template.js`

#### F. **Connection Messages Sub-Tab**
- **Purpose**: Configure greetings for Voice, SMS, Web Chat
- **Voice Greeting**:
  - Mode: "realtime" (TTS) or "pre_rendered" (audio file)
  - Text: Customizable message with variables
  - Variation: Professional / Friendly
- **SMS Auto-Reply**: "Thank you for contacting {Company Name}..."
- **Web Chat**: (Future feature)

**Data Structure**:
```javascript
aiAgentLogic: {
  connectionMessages: {
    voice: {
      mode: "realtime",
      text: "Thank you for calling {Company Name}...",
      realtime: { text: "...", variation: "professional" },
      preRendered: { audioUrl: "https://...", s3Key: "..." }
    },
    sms: {
      enabled: true,
      text: "Thank you for contacting {Company Name}..."
    }
  }
}
```

### **Key Files**:
- Frontend: `public/js/ai-agent-settings/` (multiple managers)
- Backend: `routes/company/v2aiKnowledgebase.js`
- Service: `services/knowledge/CompanyKnowledgeService.js`

---

## 4️⃣ AI Performance Tab

**Purpose**: Real-time monitoring and analytics for AI agent performance

### **Sections**:

#### A. **Live Metrics**
- **Response Time**: Average AI response time (<50ms target)
- **Cache Hit Rate**: % of requests served from Redis
- **Success Rate**: % of calls with successful AI responses
- **Active Calls**: Current calls in progress

#### B. **Knowledge Source Breakdown**
- Pie chart showing % of responses from:
  - Company Q&A
  - Trade Q&A
  - Templates
  - Fallback

#### C. **Recent Call Log**
- Last 20 calls with:
  - Timestamp
  - Caller number
  - Duration
  - AI responses count
  - Status (completed/failed)

#### D. **Performance Trends**
- 24-hour chart: Calls per hour
- 7-day chart: Daily call volume
- Response time trend

### **Data Source**: `models/v2AIAgentCallLog.js`

### **Key Files**:
- Frontend: `public/js/ai-agent-settings/PerformanceManager.js`
- Backend: `routes/company/v2aiAgentDiagnostics.js`

---

## 5️⃣ AI Voice Settings Tab

**Purpose**: Configure ElevenLabs TTS voice and settings

### **Sections**:

#### A. **Voice Selection**
- **Load Voices**: Fetches available voices from ElevenLabs
- **Voice Preview**: Play sample for each voice
- **Selection**: Choose voice by ID
- **Popular Voices**:
  - Mark (Natural Conversations) - Default
  - Sarah (Professional Female)
  - Roger (Authoritative Male)

#### B. **Voice Parameters**
```javascript
voiceSettings: {
  stability: 0.5,              // 0.0 - 1.0 (0=variable, 1=consistent)
  similarityBoost: 0.7,        // 0.0 - 1.0 (how close to original voice)
  styleExaggeration: 0,        // 0.0 - 1.0 (emotion intensity)
  speakerBoost: true          // Enhance clarity
}
```

#### C. **API Configuration**
- **API Source**: ClientsVia Global / Own API
- **Model Selection**: eleven_turbo_v2_5 (fastest) / eleven_monolingual_v1 (quality)
- **Output Format**: mp3_44100_128 (standard)
- **Streaming Latency**: 0-4 (0=speed, 4=quality)

#### D. **Test Voice**
- Text input field
- "Generate Voice" button
- Plays audio preview with current settings

### **Key Files**:
- Frontend: `public/js/ai-voice-settings/VoiceSettingsManager.js`
- Backend: `routes/v2elevenLabs.js`
- Service: `services/v2elevenLabsService.js`

---

## 6️⃣ Twilio Control Center Tab

**Purpose**: Real-time Twilio integration monitoring and health checks

### **Sections**:

#### A. **Connection Status**
- **Configured**: Yes/No
- **Connected**: Live ping test to Twilio API
- **Using Global Account**: Yes/No (future feature)
- **Last Checked**: Timestamp

#### B. **Configuration Summary**
- Phone Numbers: List with primary indicator
- Account SID: Masked (last 4 visible)
- Auth Token: Masked
- Voice URL: Webhook endpoint

#### C. **Health Checks** (5 Tests)
1. **Credentials Valid**: Tests authentication
2. **Phone Numbers Active**: Verifies each number
3. **Webhooks Accessible**: Pings webhook URLs
4. **Balance Sufficient**: Checks Twilio balance (if available)
5. **Rate Limits OK**: Monitors API rate limits

**Health Score**: 0-100% (20 points per check)

#### D. **Recent Activity**
- Last 10 calls with status
- SMS activity (if configured)
- Errors/Warnings

#### E. **Recommendations**
AI-powered suggestions:
- "Consider adding a backup phone number"
- "Auth token expires in 30 days"
- "Voice webhook response time slow (>500ms)"

### **Auto-Refresh**: Every 30 seconds

### **Key Files**:
- Frontend: `public/js/ai-agent-settings/TwilioControlCenter.js`
- Backend: `routes/company/v2twilioControl.js`

---

## 7️⃣ Spam Filter Tab

**Purpose**: Smart call filtering and spam protection

### **Sections**:

#### A. **Detection Settings** (3 Checkboxes)
```javascript
{
  checkGlobalSpamDB: false,           // Check against global spam database
  enableFrequencyCheck: false,        // Rate limiting (>5 calls/10 min)
  enableRobocallDetection: false      // AI pattern matching
}
```

#### B. **Blacklist Management**
- Add phone number to blacklist
- Reason field (optional)
- List of blacklisted numbers
- Remove from blacklist

#### C. **Whitelist Management**
- Add trusted numbers (bypass all filters)
- Remove from whitelist

#### D. **Statistics**
- Total Blocked: Lifetime count
- Last 24h: Recent blocks
- Top Spam Numbers: Most frequent blockers

### **Architecture**: See `docs/SPAM-FILTER-ARCHITECTURE.md`

### **Key Files**:
- Frontend: `public/js/ai-agent-settings/SpamFilterManager.js`
- Backend: `routes/admin/callFiltering.js`
- Model: `models/v2Company.js` (callFiltering section)

---

## 8️⃣ Notes Tab

**Purpose**: Internal notes and comments about the company

### **Features**:
- Add/Edit/Delete notes
- Markdown support
- Timestamps and author tracking
- Pin important notes to top
- Search and filter

**Data Structure**:
```javascript
notes: [
  {
    _id: "note123",
    content: "Customer prefers SMS over calls",
    createdBy: "admin@clientsvia.com",
    createdAt: Date,
    isPinned: false
  }
]
```

### **Key Files**:
- Frontend: `public/company-profile.html` (Notes section)
- Backend: `routes/v2notes.js`
- Model: Embedded in `v2Company.notes`

---

## 9️⃣ Contacts Tab

**Purpose**: Manage customer contacts associated with the company

### **Features**:
- Add/Edit/Delete contacts
- Fields: Name, Phone, Email, Notes
- Call history per contact
- Export to CSV

**Data Model**: `models/v2Contact.js`

### **Key Files**:
- Frontend: `public/company-profile.html` (Contacts section)
- Backend: `routes/v2company.js` (contact routes)

---

## 🔟 Call Archives Tab

**Purpose**: Search and analyze historical call data

### **Features**:

#### A. **Advanced Search**
- Date range picker
- Phone number filter
- Duration filter (min/max)
- Status filter (completed/failed/busy/no-answer)
- Full-text search in transcripts

#### B. **Results Display**
- Paginated results (50 per page)
- Columns: Date, From, To, Duration, Status, AI Responses
- Click to expand: Full transcript + AI response breakdown

#### C. **Statistics**
- Total Calls
- Average Duration
- Most Common Source (area code)
- Peak Call Times

#### D. **Export**
- CSV export (all fields)
- JSON export (full data)

### **Key Files**:
- Frontend: `public/admin-call-archives.html`
- Backend: `routes/admin/callArchives.js`
- Model: `models/v2AIAgentCallLog.js`

---

## 🔄 Tab Interconnections

### **Data Flow Between Tabs**:

```
Configuration Tab
     ├─→ Phone Numbers → Used by Twilio Control Center
     ├─→ Account Status → Affects Call Flow
     └─→ Credentials → Validated by Twilio Control Center

AiCore Control Center
     ├─→ Variables → Used in all tabs (greetings, Q&A, templates)
     ├─→ Company Q&A → Primary knowledge source
     ├─→ Trade Q&A → Secondary knowledge source
     ├─→ Connection Messages → Voice greeting in calls
     └─→ Thresholds → Control AI Performance matching

AI Voice Settings
     └─→ Voice Config → Used in all TTS operations

Twilio Control Center
     └─→ Health Status → Displayed in Overview

Spam Filter
     └─→ Blocked Calls → Logged, not in Call Archives

AI Performance
     └─→ Reads data from Call Archives

Call Archives
     └─→ Historical data for all other tabs
```

---

## 💾 Unified Data Storage

All tabs save to the same MongoDB document structure:

```javascript
Company Document (v2Company model):
{
  _id: "68e3f77a9d623b8058c700c4",
  companyName: "Royal Plumbing",
  businessPhone: "+12392322030",
  
  // Configuration Tab
  twilioConfig: { ... },
  accountStatus: { ... },
  
  // AiCore Tabs
  aiAgentLogic: {
    placeholders: [...],
    thresholds: {...},
    connectionMessages: {...},
    voiceSettings: {...}
  },
  
  // Spam Filter Tab
  callFiltering: {
    enabled: true,
    settings: {...},
    blacklist: [...],
    whitelist: [...]
  },
  
  // Notes Tab
  notes: [...],
  
  // Metadata
  createdAt: Date,
  updatedAt: Date
}
```

**Related Collections:**
- `v2Contact` (Contacts Tab)
- `v2AIAgentCallLog` (Call Archives, AI Performance)
- `CompanyQnA` (AiCore Company Q&A)
- `v2Template` (AiCore Templates)

---

## 🎯 Tab Priority Matrix

| Tab | Criticality | Setup Required | User Frequency |
|-----|-------------|----------------|----------------|
| Configuration | 🔴 Critical | Yes (First Step) | Low (one-time) |
| AiCore Control | 🔴 Critical | Yes (Required for AI) | High (ongoing) |
| AI Voice Settings | 🟡 Important | Yes (Affects UX) | Low (one-time) |
| Connection Messages | 🟡 Important | Yes (First impression) | Medium |
| Twilio Control | 🟢 Monitoring | No (Auto-checks) | Low (review only) |
| AI Performance | 🟢 Monitoring | No (Auto-populates) | High (analytics) |
| Spam Filter | 🟡 Important | Optional | Medium |
| Call Archives | 🟢 Monitoring | No (Auto-logs) | Medium (research) |
| Notes | ⚪ Utility | No | Low |
| Contacts | ⚪ Utility | No | Low |

---

**Next**: [Security & Multi-Tenancy →](./SECURITY-ARCHITECTURE.md)

