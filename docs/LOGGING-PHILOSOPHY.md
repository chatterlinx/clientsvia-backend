# 🔍 LOGGING PHILOSOPHY - MAXIMUM VISIBILITY

**Core Principle:** More checkpoints, more visibility, faster debugging. **NEVER mask errors.**

---

## 🎯 Guiding Principles

### 1. **Errors Are Gold - Never Hide Them**
```javascript
// ✅ GOOD - Expose everything
try {
  await operation();
} catch (error) {
  logger.error('Operation failed', {
    code: 'OPERATION_FAILURE',
    severity: 'WARNING',
    error: error.message,
    stack: error.stack,
    companyId,
    context: { /* all relevant data */ }
  });
  // Still handle gracefully, but LOG EVERYTHING
}

// ❌ BAD - Silent failure
try {
  await operation();
} catch (error) {
  // Nothing - error disappears into the void
}
```

### 2. **Checkpoints Everywhere**
```javascript
// ✅ GOOD - Breadcrumb trail
logger.debug('🔍 CHECKPOINT 1: Starting company lookup');
const company = await getCompany(companyId);
logger.debug('🔍 CHECKPOINT 2: Company found', { companyId });

logger.debug('🔍 CHECKPOINT 3: Fetching Twilio credentials');
const credentials = await getTwilioCredentials(company);
logger.debug('🔍 CHECKPOINT 4: Credentials loaded', { hasSid: !!credentials.sid });

logger.debug('🔍 CHECKPOINT 5: Initializing call');
// ... operation ...
logger.debug('🔍 CHECKPOINT 6: Call initialized successfully');

// If it fails at CHECKPOINT 4, you KNOW it's credentials
// No guessing, no wasted hours
```

### 3. **Context Is King**
```javascript
// ✅ GOOD - Rich context
logger.error('Twilio API call failed', {
  code: 'TWILIO_API_FAILURE',
  companyId,
  companyName,
  endpoint: 'https://api.twilio.com/2010-04-01/Accounts',
  accountSid: credentials.accountSid,
  callSid: req.body.CallSid,
  from: req.body.From,
  to: req.body.To,
  error: error.message,
  stack: error.stack,
  twilioErrorCode: error.code,
  twilioErrorMessage: error.moreInfo
});

// ❌ BAD - Useless
logger.error('API failed');
```

### 4. **Production Is Where Bugs Live**
Development is clean. **Production is chaos.** Log aggressively:

```javascript
// Production logging - MORE is better
logger.info('Request received', { method, url, companyId });
logger.debug('Parsing request body', { bodySize: JSON.stringify(req.body).length });
logger.debug('Validating input', { fields: Object.keys(req.body) });
logger.debug('Database query started', { collection, query });
logger.debug('Database query completed', { resultCount, duration });
logger.info('Response sent', { statusCode, duration });
```

If there's a bug, **you want a MOVIE, not a snapshot.**

### 5. **Performance Context Matters**
```javascript
// ✅ GOOD - Track slow operations
const start = Date.now();
const result = await expensiveOperation();
const duration = Date.now() - start;

if (duration > 1000) {
  logger.warn('Slow operation detected', {
    code: 'SLOW_OPERATION',
    operation: 'expensiveOperation',
    duration,
    threshold: 1000,
    companyId,
    // Add context to investigate WHY it was slow
    resultSize: result.length,
    cacheHit: result.fromCache
  });
}
```

### 6. **Security Events Are Sacred**
```javascript
// ✅ ALWAYS log security events
logger.security('Rate limit exceeded', {
  ip: req.ip,
  userId: req.user?.id,
  companyId: req.params.companyId,
  endpoint: req.originalUrl,
  requestCount: rateLimitInfo.count,
  limit: rateLimitInfo.limit,
  resetTime: rateLimitInfo.reset
});

logger.security('Unauthorized access attempt', {
  ip: req.ip,
  userId: req.user?.id,
  targetCompanyId: req.params.companyId,
  userCompanyId: req.user?.companyId,
  endpoint: req.originalUrl,
  method: req.method
});
```

Security events = potential attacks. **You need forensics.**

---

## 🚫 What NOT to Do

### ❌ Never Swallow Errors
```javascript
// BAD
try {
  await criticalOperation();
} catch (err) {
  // Silent death
}

// WORSE
try {
  await criticalOperation();
} catch (err) {
  console.log('oops'); // Useless
}
```

### ❌ Never Generic Log Messages
```javascript
// BAD
logger.error('Something went wrong');
logger.error('Error occurred');
logger.error('Failed');

// GOOD
logger.error('Twilio API authentication failed - check accountSid and authToken', {
  code: 'TWILIO_AUTH_FAILURE',
  accountSid: credentials.accountSid.slice(0, 8) + '...',
  endpoint: 'https://api.twilio.com/2010-04-01/Accounts',
  error: error.message
});
```

### ❌ Never Remove Debug Logs from Production
```javascript
// BAD - Removes visibility
if (process.env.NODE_ENV !== 'production') {
  logger.debug('Processing payment', { amount, currency });
}

// GOOD - Debug logs are cheap, visibility is priceless
logger.debug('Processing payment', { amount, currency, companyId });
```

Winston already handles log levels. In production, set `LOG_LEVEL=info` if debug is too noisy. **Don't remove the logs from code.**

---

## 📊 Logging Levels - When to Use What

### `logger.error()` - Something Broke
- System failures
- API errors (3rd party services)
- Database errors
- Validation failures that block operations
- **Always** include error codes, stack traces, context

### `logger.warn()` - Degraded But Functional
- Fallback triggered
- Slow operations
- Approaching rate limits
- Non-critical failures (retries will handle it)
- Security events (suspicious but not blocking)

### `logger.info()` - Normal Operations Worth Tracking
- Requests received/completed
- Key business events (booking created, payment processed)
- System state changes
- Successful operations with timing

### `logger.debug()` - Breadcrumb Trail
- Checkpoints ("CHECKPOINT 1: Starting...")
- Variable states
- Decision points ("Using cached value")
- Internal flow ("Entering function X")
- **Use liberally** - these save hours of debugging

### `logger.http()` - Request/Response Tracking
- API calls (incoming/outgoing)
- Response codes
- Timing
- Payloads (sanitized)

---

## 🎯 Real-World Example: Maximum Visibility

### ❌ BAD - Useless When It Breaks
```javascript
router.post('/api/twilio/voice', async (req, res) => {
  try {
    const company = await getCompany(req.body.To);
    const greeting = await generateGreeting(company);
    res.send(greeting);
  } catch (error) {
    logger.error('Call failed');
    res.status(500).send('Error');
  }
});
```

**When this breaks at 3am, you have ZERO information.**

### ✅ GOOD - Full Visibility
```javascript
router.post('/api/twilio/voice', async (req, res) => {
  const requestId = req.headers['x-request-id'] || generateId();
  const startTime = Date.now();
  
  logger.info('📞 [TWILIO] Incoming call', {
    requestId,
    callSid: req.body.CallSid,
    from: req.body.From,
    to: req.body.To,
    callStatus: req.body.CallStatus
  });
  
  try {
    logger.debug('🔍 CHECKPOINT 1: Looking up company by phone', {
      requestId,
      phone: req.body.To
    });
    
    const company = await getCompany(req.body.To);
    
    if (!company) {
      logger.warn('⚠️ No company found for phone number', {
        requestId,
        phone: req.body.To,
        from: req.body.From
      });
      // Still log, still handle
      return res.status(404).send('Company not found');
    }
    
    logger.debug('🔍 CHECKPOINT 2: Company found', {
      requestId,
      companyId: company._id,
      companyName: company.companyName
    });
    
    logger.debug('🔍 CHECKPOINT 3: Generating AI greeting', {
      requestId,
      companyId: company._id,
      aiEnabled: company.aiSettings?.enabled
    });
    
    const greeting = await generateGreeting(company, req.body);
    
    logger.debug('🔍 CHECKPOINT 4: Greeting generated', {
      requestId,
      companyId: company._id,
      greetingLength: greeting.length
    });
    
    const duration = Date.now() - startTime;
    logger.info('✅ [TWILIO] Call handled successfully', {
      requestId,
      companyId: company._id,
      duration,
      greetingType: greeting.includes('Say') ? 'text' : 'audio'
    });
    
    res.send(greeting);
    
  } catch (error) {
    const duration = Date.now() - startTime;
    
    // Rich error context
    logger.error('❌ [TWILIO] Call handling failed', {
      code: 'TWILIO_CALL_FAILURE',
      severity: 'CRITICAL',
      requestId,
      companyId: company?._id,
      companyName: company?.companyName,
      callSid: req.body.CallSid,
      from: req.body.From,
      to: req.body.To,
      duration,
      error: error.message,
      stack: error.stack,
      checkpoint: 'See debug logs for last checkpoint'
    });
    
    // Notify admin (self-diagnostic)
    logger.companyError({
      companyId: company?._id,
      companyName: company?.companyName,
      code: 'TWILIO_CALL_FAILURE',
      message: 'Failed to handle incoming call',
      severity: 'CRITICAL',
      error,
      meta: { requestId, callSid: req.body.CallSid }
    });
    
    res.status(500).send('Error processing call');
  }
});
```

**Now when it breaks:**
- You see which checkpoint it failed at
- You have all context (company, call details, timing)
- Admin gets notified via Notification Center
- You can fix it in minutes instead of hours

---

## 🏆 Best Practices

### 1. **Use Request IDs**
```javascript
const requestId = req.headers['x-request-id'] || generateId();
// Include requestId in EVERY log for that request
// You can trace the entire request flow
```

### 2. **Log Entry/Exit of Important Functions**
```javascript
async function processPayment(companyId, amount) {
  logger.debug('→ processPayment() ENTRY', { companyId, amount });
  
  try {
    // ... logic ...
    logger.debug('← processPayment() EXIT', { companyId, success: true });
    return result;
  } catch (error) {
    logger.error('← processPayment() EXCEPTION', {
      companyId,
      amount,
      error: error.message
    });
    throw error;
  }
}
```

### 3. **Time Everything Important**
```javascript
const timers = {};
timers.dbQuery = Date.now();
const results = await db.query();
logger.debug('DB query completed', {
  duration: Date.now() - timers.dbQuery,
  resultCount: results.length
});
```

### 4. **Log Before AND After State Changes**
```javascript
logger.debug('Company settings BEFORE update', {
  companyId,
  old: company.settings
});

company.settings = newSettings;
await company.save();

logger.info('Company settings UPDATED', {
  companyId,
  old: oldSettings,
  new: newSettings,
  changed: Object.keys(diff)
});
```

### 5. **Include "What Worked" Not Just "What Failed"**
```javascript
// Not just errors
logger.info('✅ Cache hit', { key, age: cacheAge });
logger.info('✅ Fallback successful', { from: 'primary', to: 'backup' });
logger.info('✅ Retry succeeded', { attempt: 2, totalAttempts: 3 });

// Success context helps you understand the happy path too
```

---

## 🎬 Summary

**Philosophy:** 
- **Errors are gold** - expose everything
- **Checkpoints everywhere** - breadcrumb trail
- **Context is king** - rich metadata
- **Production is chaos** - log aggressively
- **Never mask** - visibility over silence

**Result:**
- Bugs found in minutes, not hours
- Production issues visible immediately
- Admin sees problems in Notification Center
- Full audit trail for compliance
- Confidence in production deployments

---

**Built for production reality, not development dreams.** 🎯

