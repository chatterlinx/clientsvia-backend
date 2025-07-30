# Security Documentation - ClientsVia AI Platform

## 🔒 Enterprise Security Architecture

ClientsVia implements **bank-level security** with multiple layers of protection designed for single-developer enterprise environments with aggressive security requirements.

## Security Features Overview

### 1. Single-Session Lockout System
**Aggressive session management ensuring only one active session per user**

#### Implementation
- **Session Termination**: New login kills all previous sessions
- **Real-time Monitoring**: Active session tracking in Redis
- **Conflict Detection**: Immediate detection of concurrent login attempts
- **Automatic Cleanup**: Expired session removal

#### Technical Details
```javascript
// Session conflict detection
const sessionConflict = await singleSessionManager.checkSessionConflict(userId, deviceId);
if (sessionConflict) {
  await singleSessionManager.terminateAllSessions(userId);
  // Log security event
}
```

#### Configuration
```env
# Single session settings
SESSION_TIMEOUT=900000  # 15 minutes
MAX_SESSIONS_PER_USER=1
FORCE_LOGOUT_ON_NEW_LOGIN=true
```

### 2. Hardware ID Security
**Device-level security binding users to specific hardware**

#### Features
- **Device Fingerprinting**: Unique hardware identification
- **Server-Client Binding**: Two-way hardware verification
- **Auto-approval**: Streamlined for single-user environments
- **Hardware Lock**: Prevents session hijacking

#### Implementation
```javascript
// Hardware ID generation (client-side)
const hardwareId = await generateHardwareFingerprint();

// Server validation
const isValidDevice = await hardwareIDService.validateDevice(userId, hardwareId);
```

#### Security Benefits
- **Session Hijacking Prevention**: Sessions tied to specific hardware
- **Location Verification**: Hardware changes trigger re-authentication
- **Audit Trail**: Complete device usage logging

### 3. GeoIP Security
**Location-based access control and impossible travel detection**

#### Features
- **Country Allow-list**: Configurable allowed countries
- **Impossible Travel Detection**: Suspicious location changes
- **IP Validation**: Real-time geolocation checking
- **Emergency Override**: Admin bypass capabilities

#### Configuration
```env
ALLOWED_COUNTRIES=US,CA,GB,AU,DE,FR
GEOIP_ENABLED=true
IMPOSSIBLE_TRAVEL_THRESHOLD=1000  # km/hour
```

#### Implementation
```javascript
// GeoIP validation
const geoValidation = await geoIPService.validateLocation(req.ip, userId);
if (!geoValidation.allowed) {
  return res.status(403).json({ error: 'Access denied from this location' });
}
```

### 4. JWT Authentication & Token Management
**Short-lived tokens with automatic refresh**

#### Token Configuration
- **Access Token Lifetime**: 15 minutes
- **Refresh Token**: 7 days
- **Automatic Renewal**: Frontend auto-refresh
- **Secure Storage**: HTTP-only cookies

#### Implementation
```javascript
// Token generation
const token = jwt.sign(
  { userId, deviceId, hardwareId },
  process.env.JWT_SECRET,
  { expiresIn: '15m' }
);

// Auto-refresh mechanism
setInterval(async () => {
  await refreshAuthToken();
}, 12 * 60 * 1000); // 12 minutes
```

### 5. Redis Session Store
**Persistent, scalable session management**

#### Features
- **Session Persistence**: Survives server restarts
- **Real-time Tracking**: Active session monitoring
- **Automatic Cleanup**: TTL-based session expiration
- **Scalability**: Redis cluster support

#### Configuration
```javascript
const sessionConfig = {
  store: new RedisStore({ client: redisClient }),
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    maxAge: 15 * 60 * 1000 // 15 minutes
  }
};
```

### 6. Emergency Bypass System
**Administrative access for critical situations**

#### Use Cases
- **Server-level Access**: When normal authentication fails
- **Emergency Maintenance**: Critical system updates
- **Account Recovery**: User lockout situations
- **Security Incident Response**: Immediate access needs

#### Implementation
```javascript
// Emergency bypass validation
const emergencyAccess = req.headers['x-emergency-bypass'];
if (emergencyAccess === process.env.EMERGENCY_BYPASS_KEY) {
  // Grant emergency access with audit logging
  await auditLogger.logEmergencyAccess(req);
  return next();
}
```

#### Security Measures
- **Unique Key**: Ultra-secure emergency key
- **Audit Logging**: All bypass usage logged
- **Time-limited**: Emergency access expires
- **Single-use**: Keys rotate after use

## Security Middleware Stack

### Request Flow
```
1. Rate Limiting → Prevent DoS attacks
2. Helmet Security Headers → XSS, CSRF protection
3. CORS Validation → Origin verification
4. GeoIP Check → Location validation
5. Hardware ID Validation → Device verification
6. JWT Authentication → Token validation
7. Single Session Check → Concurrent session prevention
8. Route Authorization → Permission validation
```

### Middleware Configuration
```javascript
// Security middleware stack
app.use(helmet()); // Security headers
app.use(rateLimit); // Rate limiting
app.use(cors(corsOptions)); // CORS
app.use(geoIPSecurityService); // GeoIP validation
app.use(hardwareIDSecurityService); // Hardware validation
app.use(authMiddleware); // JWT authentication
app.use(singleSessionManager); // Session management
```

## Security Monitoring & Audit

### 1. Audit Trail
All security events are logged with:
- **Timestamp**: Precise event timing
- **User ID**: Associated user
- **IP Address**: Source IP
- **Location**: GeoIP data
- **Device Info**: Hardware fingerprint
- **Action**: Specific security event
- **Outcome**: Success/failure

### 2. Security Events
Monitored events include:
- **Login Attempts**: Success/failure
- **Session Conflicts**: Concurrent login detection
- **Device Changes**: New hardware detection
- **Location Changes**: GeoIP variations
- **Emergency Access**: Bypass usage
- **Token Refresh**: Authentication renewal

### 3. Real-time Monitoring
```javascript
// Security event logging
const securityEvent = {
  userId: req.user.id,
  event: 'SESSION_CONFLICT',
  ip: req.ip,
  location: geoData,
  deviceId: req.deviceId,
  timestamp: new Date(),
  severity: 'HIGH'
};

await auditLogger.logSecurityEvent(securityEvent);
```

## Security Configuration

### Environment Variables
```env
# Core Security
JWT_SECRET=ultra-secure-jwt-secret-key
EMERGENCY_BYPASS_KEY=ultra-secure-emergency-key-2025
HARDWARE_LOCK_ENABLED=true

# Session Management
SESSION_SECRET=secure-session-secret
SESSION_TIMEOUT=900000
REDIS_URL=redis://localhost:6379

# GeoIP Security
ALLOWED_COUNTRIES=US,CA,GB,AU,DE,FR
GEOIP_ENABLED=true
IMPOSSIBLE_TRAVEL_THRESHOLD=1000

# Rate Limiting
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX=100
```

### Production Security Checklist
- [ ] **HTTPS Only**: SSL/TLS encryption
- [ ] **Environment Variables**: All secrets in environment
- [ ] **Rate Limiting**: DoS protection enabled
- [ ] **Session Security**: Redis store configured
- [ ] **GeoIP Validation**: Location restrictions active
- [ ] **Hardware Binding**: Device security enabled
- [ ] **Audit Logging**: Security events tracked
- [ ] **Emergency Access**: Bypass system tested

## Threat Model & Mitigations

### 1. Session Hijacking
**Threat**: Attacker steals session tokens
**Mitigation**: Hardware ID binding + short-lived tokens

### 2. Credential Theft
**Threat**: Stolen login credentials
**Mitigation**: Single-session lockout + device binding

### 3. Location Spoofing
**Threat**: VPN/proxy to bypass GeoIP
**Mitigation**: Impossible travel detection + hardware binding

### 4. Brute Force Attacks
**Threat**: Password guessing attacks
**Mitigation**: Rate limiting + account lockout

### 5. Insider Threats
**Threat**: Malicious internal access
**Mitigation**: Audit trails + emergency bypass monitoring

## Security Best Practices

### For Administrators
1. **Regular Key Rotation**: Update secrets periodically
2. **Monitor Audit Logs**: Review security events daily
3. **Emergency Procedures**: Know bypass procedures
4. **Backup Security**: Secure configuration backups

### For Developers
1. **Secure Coding**: Follow OWASP guidelines
2. **Input Validation**: Sanitize all inputs
3. **Error Handling**: Don't leak sensitive information
4. **Dependency Updates**: Keep packages current

### For Operations
1. **Infrastructure Security**: Secure hosting environment
2. **Network Security**: Firewall configuration
3. **Database Security**: MongoDB security settings
4. **Monitoring**: Real-time security alerts

## Compliance & Standards

### Standards Compliance
- **OWASP Top 10**: Protection against common vulnerabilities
- **NIST Cybersecurity Framework**: Comprehensive security approach
- **SOC 2 Type II**: Security controls and processes

### Data Protection
- **Encryption at Rest**: Database encryption
- **Encryption in Transit**: HTTPS/TLS
- **Data Isolation**: Multi-tenant separation
- **Audit Trails**: Complete activity logging

---

**Security Contact**: security@clientsvia.com  
**Emergency**: Use emergency bypass key  
**Last Updated**: January 2025
