# 🔊 WORLD-CLASS LOGGING ARCHITECTURE

## Overview

ClientsVia uses a **production-grade Winston logger** with automatic integration to:
- ✅ **Structured file logging** (with rotation)
- ✅ **Sentry error tracking** (automatic for errors)
- ✅ **Admin Notification Center** (automatic for CRITICAL/WARNING errors)
- ✅ **Tenant-scoped logging** (companyId tracking)
- ✅ **Security event flagging**

---

## 📊 Log Levels

| Level   | When to Use | Goes To | Notification Center |
|---------|-------------|---------|---------------------|
| `error` | System/app failures | File + Sentry + Console | ✅ If severity=CRITICAL/WARNING |
| `warn`  | Degraded performance, fallbacks | File + Console | ❌ (unless flagged) |
| `info`  | Normal operations, health checks | File + Console | ❌ |
| `http`  | API requests/responses | File (http.log) | ❌ |
| `debug` | Verbose debugging (dev only) | File + Console (dev) | ❌ |

---

## 🎯 Usage Patterns

### 1. Simple Logging (Replaces console.log)

```javascript
const logger = require('../utils/logger');

// Info (normal operations)
logger.info('Company settings loaded successfully');

// Debug (verbose, dev-only)
logger.debug('Cache hit for key: company:12345');

// Warning (degraded but operational)
logger.warn('Rate limit approaching threshold');

// Error (system failure)
logger.error('Database connection failed', { error: err });
```

### 2. Company-Specific Errors (AUTO-NOTIFIES ADMINS)

**Use this for any company-scoped error that admins need to know about:**

```javascript
const logger = require('../utils/logger');

try {
  // ... company operation ...
} catch (err) {
  // This will:
  // 1. Log to Winston
  // 2. Send to Sentry
  // 3. Create notification in Admin Notification Center
  // 4. Send SMS/Email to admins (if CRITICAL/WARNING)
  logger.companyError({
    companyId: req.params.companyId,
    companyName: company.companyName,
    code: 'TWILIO_GREETING_FAILURE',
    message: 'Failed to generate AI greeting',
    severity: 'WARNING', // or 'CRITICAL'
    error: err,
    meta: { 
      callSid: req.body.CallSid,
      feature: 'ai-agent',
      route: req.originalUrl
    }
  });
}
```

**Severity Guidelines:**
- `CRITICAL`: System down, data loss, security breach → **Immediate admin action required**
- `WARNING`: Degraded performance, fallback triggered, API failure → **Admin should investigate**
- `INFO`: Normal event worth tracking → **No action required**

### 3. Tenant-Scoped Logging

```javascript
// For normal tenant operations (no notification)
logger.tenant(companyId, 'Twilio credentials updated', {
  updatedBy: req.user.id,
  timestamp: Date.now()
});
```

### 4. Security Events

```javascript
// Automatically flagged as security event and sent to Sentry
logger.security('Unauthorized API access attempt', {
  ip: req.ip,
  userId: req.user?.id,
  endpoint: req.originalUrl,
  method: req.method
});
```

### 5. API Request Logging

```javascript
// HTTP request/response logging (for metrics)
logger.api('POST', '/api/company/settings', 200, 45, {
  companyId,
  userId: req.user.id
});
```

### 6. Database Operations

```javascript
// Database performance tracking
logger.db('findOne', 'companies', 12, {
  companyId,
  query: { _id: companyId }
});
```

### 7. Authentication Events

```javascript
// Login attempts (success/failure)
logger.auth('login', userId, true, {
  ip: req.ip,
  userAgent: req.headers['user-agent']
});
```

---

## 🔔 Automatic Admin Notifications

### How It Works

When you use `logger.companyError()` or `logger.error()` with `severity: 'CRITICAL'` or `'WARNING'`:

1. **Winston logs it** to file system
2. **Sentry captures it** for error tracking
3. **AdminNotificationService** is automatically triggered (async, non-blocking)
4. **Notification Center** receives the alert
5. **Admin contacts** receive SMS/Email (configured in Settings tab)
6. **Dashboard shows status** (green ✅ / red ❌)

### Notification Flow

```
logger.companyError({ severity: 'CRITICAL', ... })
         ↓
   Winston Logger
         ↓
AdminNotificationService.sendAlert()
         ↓
   NotificationLog (database)
         ↓
   SMS + Email to Admins
         ↓
   Dashboard Alert (Notification Center tab)
```

### Opt-Out of Notifications

If you want to log an error but NOT notify admins:

```javascript
logger.error('Minor issue, no admin action needed', {
  notifyAdmin: false, // ← Prevents notification
  ...otherMeta
});
```

---

## 🚫 What NOT to Use

### ❌ DON'T: console.log / console.error / console.warn

```javascript
// ❌ BAD - Not structured, not persisted, not tracked
console.log('Something happened');
console.error('Something broke');
```

### ✅ DO: Use Winston logger

```javascript
// ✅ GOOD - Structured, persisted, tracked
logger.info('Something happened');
logger.error('Something broke', { error: err });
```

---

## 📂 Log Files

All logs are stored in `/logs/` directory:

| File | Content | Rotation |
|------|---------|----------|
| `combined.log` | All logs (info+) | 10MB, 5 files |
| `error.log` | Errors only | 10MB, 5 files |
| `http.log` | HTTP requests | 10MB, 3 files |
| `exceptions.log` | Uncaught exceptions | No rotation |
| `rejections.log` | Unhandled promise rejections | No rotation |

---

## 🔍 Metadata Standards

Always include relevant context:

```javascript
logger.error('Operation failed', {
  // Core identification
  companyId: '507f1f77bcf86cd799439011',
  companyName: 'Atlas Air',
  userId: req.user?.id,
  
  // Error details
  code: 'TWILIO_API_FAILURE',
  severity: 'WARNING',
  error: err,
  details: 'Additional context',
  
  // Request context
  requestId: req.headers['x-request-id'],
  route: req.originalUrl,
  method: req.method,
  
  // Feature/module context
  feature: 'ai-agent',
  module: 'greeting',
  
  // Operational context
  timestamp: Date.now(),
  environment: process.env.NODE_ENV
});
```

---

## 🎨 Log Format Standards

### Development (Console)

```
14:32:15 info: Company settings loaded successfully
14:32:16 error: Database connection failed { error: "Connection timeout", companyId: "123" }
```

### Production (File)

```
2025-10-22 14:32:15 [INFO]: Company settings loaded successfully
{
  "companyId": "507f1f77bcf86cd799439011",
  "timestamp": 1729621935000
}

2025-10-22 14:32:16 [ERROR]: Database connection failed
{
  "error": "Connection timeout",
  "companyId": "507f1f77bcf86cd799439011",
  "stack": "Error: Connection timeout\n    at Database.connect (/app/db.js:45:10)"
}
```

---

## 🔐 Security & PII

The logger automatically **redacts sensitive data** via `logRedaction.js`:

- ❌ Passwords
- ❌ API keys/tokens
- ❌ Credit card numbers
- ❌ SSN
- ✅ Phone numbers (hashed in production)
- ✅ Email addresses (allowed for admin notifications)

---

## 🧪 Testing

### Check Logs

```bash
# Tail combined log
tail -f logs/combined.log

# Tail error log
tail -f logs/error.log

# Search for company-specific errors
grep "COMPANY:507f1f77bcf86cd799439011" logs/combined.log
```

### Test Notification Integration

```javascript
// This should trigger admin notification
logger.companyError({
  companyId: testCompanyId,
  companyName: 'Test Company',
  code: 'TEST_NOTIFICATION',
  message: 'Testing notification flow',
  severity: 'WARNING',
  error: new Error('Test error')
});

// Check:
// 1. logs/error.log for entry
// 2. Notification Center dashboard for alert
// 3. Admin phone/email for SMS/email
```

---

## 📊 Performance

- **Winston logging**: < 1ms (async)
- **File writes**: Non-blocking
- **Notifications**: Fire-and-forget (setImmediate)
- **Zero performance impact** on critical paths

---

## 🔧 Configuration

Logger settings are in `utils/logger.js`:

```javascript
// Log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4
};

// File rotation
maxsize: 10485760, // 10MB
maxFiles: 5
```

To change log level in production:

```javascript
// Set via environment variable
LOG_LEVEL=info node server.js

// Or in code
logger.level = 'debug';
```

---

## 🎯 Migration from console.*

We've created an automated migration script:

```bash
# Dry run (preview)
node scripts/migrate-console-to-logger.js --dry-run

# Migrate all files
node scripts/migrate-console-to-logger.js

# Migrate specific file
node scripts/migrate-console-to-logger.js --file=routes/v2twilio.js
```

The script intelligently:
- ✅ Replaces `console.error` → `logger.error`
- ✅ Replaces `console.warn` → `logger.warn`
- ✅ Replaces `console.log` → `logger.info` or `logger.debug` (context-aware)
- ✅ Adds logger import if missing
- ✅ Preserves all metadata
- ✅ Identifies security/tenant contexts

---

## 🏆 Best Practices

### 1. **Always include companyId for tenant operations**

```javascript
// ✅ GOOD
logger.info('Settings updated', { companyId, feature: 'twilio' });

// ❌ BAD
logger.info('Settings updated');
```

### 2. **Use appropriate severity levels**

```javascript
// ✅ GOOD - Admin needs to know immediately
logger.companyError({
  severity: 'CRITICAL',
  code: 'DB_DOWN',
  message: 'Cannot reach database'
});

// ❌ BAD - Wasting admin attention on non-critical events
logger.companyError({
  severity: 'CRITICAL',
  code: 'CACHE_MISS',
  message: 'Cache miss, using DB'
});
```

### 3. **Include actionable context**

```javascript
// ✅ GOOD - Clear what to fix
logger.error('Twilio API failed', {
  code: 'TWILIO_AUTH_FAILURE',
  companyId,
  details: 'Invalid auth token - check Twilio credentials in Settings',
  apiEndpoint: 'https://api.twilio.com/2010-04-01/Accounts'
});

// ❌ BAD - Not actionable
logger.error('Something broke');
```

### 4. **Don't log sensitive data**

```javascript
// ✅ GOOD
logger.info('User authenticated', { userId, timestamp });

// ❌ BAD
logger.info('User authenticated', { userId, password });
```

### 5. **Use structured error codes**

```javascript
// ✅ GOOD - Searchable, trackable
logger.companyError({
  code: 'TWILIO_GREETING_FAILURE',
  message: 'AI greeting generation failed'
});

// ❌ BAD - Not trackable
logger.error('Error in greeting thing');
```

---

## 🚀 Real-World Examples

### Example 1: AI Agent Call Failure

```javascript
// routes/v2twilio.js
router.post('/voice/incoming', async (req, res) => {
  try {
    const company = await getCompanyByPhone(req.body.To);
    const result = await v2AIAgentRuntime.initializeCall(company, req.body);
    
    logger.info('AI agent call initialized', {
      companyId: company._id,
      callSid: req.body.CallSid,
      duration: result.duration
    });
    
    res.type('text/xml').send(result.twiml);
  } catch (err) {
    // Admin will be notified via Notification Center
    logger.companyError({
      companyId: company?._id,
      companyName: company?.companyName,
      code: 'AI_AGENT_INIT_FAILURE',
      message: 'Failed to initialize AI agent for incoming call',
      severity: 'CRITICAL',
      error: err,
      meta: {
        callSid: req.body.CallSid,
        from: req.body.From,
        to: req.body.To
      }
    });
    
    // Return fallback TwiML
    res.type('text/xml').send(generateFallbackTwiML());
  }
});
```

### Example 2: Database Connection Issue

```javascript
// db.js
mongoose.connection.on('error', (err) => {
  logger.error('MongoDB connection error', {
    code: 'DB_CONNECTION_ERROR',
    severity: 'CRITICAL',
    error: err,
    details: 'Check MongoDB Atlas connection string and network',
    notifyAdmin: true
  });
});
```

### Example 3: Rate Limit Breach

```javascript
// middleware/rateLimit.js
if (requests > limit) {
  logger.security('Rate limit exceeded', {
    companyId: req.params.companyId,
    ip: req.ip,
    endpoint: req.originalUrl,
    requests,
    limit,
    severity: 'WARNING'
  });
  
  return res.status(429).json({ error: 'Too many requests' });
}
```

---

## 📖 Related Documentation

- `NOTIFICATION_CONTRACT.md` - Notification event schema
- `ADMIN-DASHBOARD-TABS-GUIDE.md` - Notification Center UI
- `REFACTOR_PROTOCOL.md` - Code quality standards

---

## ✅ Checklist for New Features

When adding new features, ensure:

- [ ] All errors use `logger.error()` instead of `console.error()`
- [ ] Company-scoped errors use `logger.companyError()`
- [ ] All errors include `code`, `severity`, `companyId` (if applicable)
- [ ] Critical failures have `severity: 'CRITICAL'` to trigger admin alerts
- [ ] Security events use `logger.security()`
- [ ] No sensitive data (passwords, tokens) in logs
- [ ] Actionable context included in error metadata

---

**Built with ❤️ for production-grade multi-tenant platforms.**

