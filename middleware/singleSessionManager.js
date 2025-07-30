/**
 * Enterprise Single Session Security Manager
 * Top-notch security with Redis, GeoIP, Hardware ID, and Forced Re-auth
 */

const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const RedisSessionStore = require('./redisSessionStore');
const GeoIPSecurityService = require('./geoIPSecurityService');
const HardwareIDSecurityService = require('./hardwareIDSecurityService');

class EnterpriseSingleSessionManager {
    constructor() {
        // Enterprise components
        this.redisStore = new RedisSessionStore();
        this.geoIPService = new GeoIPSecurityService();
        this.hardwareService = new HardwareIDSecurityService();
        
        // Security settings
        this.sessionTimeout = 15 * 60; // 15 minutes
        this.maxLoginAttempts = 3;
        this.forceReauthInterval = 4 * 60 * 60 * 1000; // 4 hours
        this.suspiciousActivityThreshold = 5;
        
        // Rate limiting
        this.loginAttempts = new Map();
        
        console.log('🛡️ Enterprise Single Session Manager initialized');
    }

    /**
     * Create enterprise session with full security validation
     */
    async createSession(userId, deviceInfo = {}) {
        try {
            // Step 1: Rate limiting check
            const rateLimitCheck = this.checkRateLimit(deviceInfo.ipAddress);
            if (!rateLimitCheck.allowed) {
                throw new Error(`Rate limit exceeded: ${rateLimitCheck.reason}`);
            }

            // Step 2: GeoIP validation
            const geoValidation = await this.geoIPService.validateLoginLocation(
                deviceInfo.ipAddress, 
                userId, 
                deviceInfo.lastKnownLocation
            );
            
            if (!geoValidation.allowed) {
                await this.redisStore.logSecurityEvent('blocked_login_geo', {
                    userId,
                    ip: deviceInfo.ipAddress,
                    location: geoValidation.location,
                    warnings: geoValidation.warnings
                });
                throw new Error(`Login blocked: ${geoValidation.warnings.join(', ')}`);
            }

            // Step 3: Hardware validation
            const hardwareValidation = this.hardwareService.validateClientHardware(
                deviceInfo.deviceFingerprint, 
                userId
            );
            
            if (!hardwareValidation.valid && hardwareValidation.requiresApproval) {
                // For single-user platform, auto-approve new devices
                this.hardwareService.registerTrustedDevice(userId, deviceInfo.deviceFingerprint, deviceInfo);
                console.log(`🔐 Auto-approved new device for single-user platform: ${userId}`);
            }

            // Step 4: Kill all existing sessions (aggressive lockout)
            const killedCount = await this.killAllUserSessions(userId);

            // Step 5: Generate unique session ID and fingerprint
            const sessionId = crypto.randomUUID();
            const enhancedFingerprint = this.generateEnhancedFingerprint(deviceInfo);
            
            // Step 6: Create session data
            const sessionData = {
                sessionId,
                userId,
                deviceFingerprint: enhancedFingerprint,
                createdAt: new Date(),
                lastActivity: new Date(),
                lastReauth: new Date(),
                ipAddress: deviceInfo.ipAddress,
                userAgent: deviceInfo.userAgent,
                location: geoValidation.location,
                securityLevel: this.calculateSecurityLevel(geoValidation, hardwareValidation),
                loginCount: 1,
                geoRisk: geoValidation.risk
            };

            // Step 7: Store in Redis with TTL
            await this.redisStore.setSession(sessionId, sessionData, this.sessionTimeout);

            // Step 8: Generate short-lived JWT
            const token = jwt.sign({
                userId,
                sessionId,
                deviceFingerprint: enhancedFingerprint,
                securityLevel: sessionData.securityLevel,
                iat: Math.floor(Date.now() / 1000)
            }, process.env.JWT_SECRET, { 
                expiresIn: '15m'
            });

            // Step 9: Log security event
            await this.redisStore.logSecurityEvent('successful_login', {
                userId,
                sessionId,
                ip: deviceInfo.ipAddress,
                location: geoValidation.location,
                killedSessions: killedCount,
                securityLevel: sessionData.securityLevel
            });

            console.log(`🔐 Enterprise session created for ${userId}: ${sessionId}`);
            console.log(`📍 Location: ${geoValidation.location.city}, ${geoValidation.location.country} (${geoValidation.risk} risk)`);
            console.log(`🖥️ Device: ${enhancedFingerprint.substring(0, 10)}... (Security Level: ${sessionData.securityLevel})`);
            console.log(`💀 Killed ${killedCount} existing sessions`);

            return { token, sessionId, sessionData, geoValidation };

        } catch (error) {
            console.error('Enterprise session creation failed:', error);
            throw error;
        }
    }

    /**
     * Enterprise session validation with forced re-auth check
     */
    async validateSession(token) {
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const session = await this.redisStore.getSession(decoded.sessionId);

            if (!session) {
                throw new Error('Session not found - likely terminated');
            }

            if (session.userId !== decoded.userId) {
                throw new Error('Session user mismatch');
            }

            if (session.deviceFingerprint !== decoded.deviceFingerprint) {
                throw new Error('Device fingerprint mismatch - possible hijack');
            }

            // Check for forced re-auth requirement
            const timeSinceReauth = Date.now() - new Date(session.lastReauth).getTime();
            if (timeSinceReauth > this.forceReauthInterval) {
                throw new Error('Forced re-authentication required');
            }

            // Update last activity and extend session
            session.lastActivity = new Date();
            await this.redisStore.setSession(decoded.sessionId, session, this.sessionTimeout);

            return { valid: true, session, decoded };

        } catch (error) {
            // Log suspicious validation failures
            if (error.message.includes('mismatch') || error.message.includes('hijack')) {
                await this.redisStore.logSecurityEvent('session_validation_failed', {
                    error: error.message,
                    timestamp: new Date()
                });
            }
            return { valid: false, error: error.message };
        }
    }

    /**
     * Kill all sessions using Redis
     */
    async killAllUserSessions(userId) {
        return await this.redisStore.killAllUserSessions(userId);
    }

    /**
     * Rate limiting check
     */
    checkRateLimit(ipAddress) {
        const key = `login:${ipAddress}`;
        const attempts = this.loginAttempts.get(key) || { count: 0, lastAttempt: 0 };
        const now = Date.now();
        
        // Reset counter after 1 hour
        if (now - attempts.lastAttempt > 60 * 60 * 1000) {
            attempts.count = 0;
        }

        if (attempts.count >= this.maxLoginAttempts) {
            return {
                allowed: false,
                reason: `Too many login attempts from ${ipAddress}. Try again later.`
            };
        }

        attempts.count++;
        attempts.lastAttempt = now;
        this.loginAttempts.set(key, attempts);

        return { allowed: true };
    }

    /**
     * Generate enhanced device fingerprint
     */
    generateEnhancedFingerprint(deviceInfo) {
        const baseFingerprint = this.generateDeviceFingerprint(deviceInfo);
        const timestamp = Math.floor(Date.now() / (24 * 60 * 60 * 1000)); // Daily rotation
        
        return crypto.createHash('sha256')
            .update(baseFingerprint + timestamp.toString())
            .digest('hex');
    }

    /**
     * Calculate security level based on validation results
     */
    calculateSecurityLevel(geoValidation, hardwareValidation) {
        let score = 100;

        if (geoValidation.risk === 'high') score -= 40;
        else if (geoValidation.risk === 'medium') score -= 20;

        if (geoValidation.location.isVPN || geoValidation.location.isProxy) score -= 15;
        if (!hardwareValidation.valid) score -= 25;
        if (geoValidation.warnings.length > 0) score -= 10;

        if (score >= 85) return 'high';
        if (score >= 70) return 'medium';
        return 'low';
    }

    /**
     * Force re-authentication for user
     */
    async forceReauth(userId, reason = 'Security policy') {
        const killedCount = await this.killAllUserSessions(userId);
        
        await this.redisStore.logSecurityEvent('forced_reauth', {
            userId,
            reason,
            killedSessions: killedCount
        });

        console.log(`🔒 Forced re-auth for ${userId}: ${reason} (${killedCount} sessions killed)`);
        return killedCount;
    }

    /**
     * Get enterprise session analytics
     */
    async getSessionAnalytics() {
        const sessions = await this.redisStore.getAllActiveSessions();
        
        return {
            totalActiveSessions: sessions.length,
            securityLevels: {
                high: sessions.filter(s => s.securityLevel === 'high').length,
                medium: sessions.filter(s => s.securityLevel === 'medium').length,
                low: sessions.filter(s => s.securityLevel === 'low').length
            },
            geoRisks: {
                high: sessions.filter(s => s.geoRisk === 'high').length,
                medium: sessions.filter(s => s.geoRisk === 'medium').length,
                low: sessions.filter(s => s.geoRisk === 'low').length
            },
            averageSessionAge: sessions.reduce((acc, s) => acc + s.age, 0) / sessions.length || 0
        };
    }

    /**
     * Cleanup expired sessions
     */
    cleanupExpiredSessions() {
        const now = Date.now();
        let cleanedCount = 0;

        for (const [sessionId, session] of this.activeSessions.entries()) {
            const age = now - session.lastActivity.getTime();
            if (age > this.sessionTimeout) {
                this.activeSessions.delete(sessionId);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`🧹 Cleaned up ${cleanedCount} expired sessions`);
        }

        return cleanedCount;
    }

    /**
     * Get all active sessions (for admin)
     */
    getAllActiveSessions() {
        const sessions = [];
        for (const [sessionId, session] of this.activeSessions.entries()) {
            sessions.push({
                sessionId,
                userId: session.userId,
                location: session.location,
                lastActivity: session.lastActivity,
                age: Date.now() - session.createdAt.getTime()
            });
        }
        return sessions;
    }

    /**
     * Emergency bypass for server-level access
     */
    emergencyBypass(userId) {
        console.log(`🚨 EMERGENCY BYPASS activated for user: ${userId}`);
        const bypassToken = jwt.sign({
            userId,
            sessionId: 'EMERGENCY_BYPASS',
            deviceFingerprint: 'SERVER_ACCESS',
            emergency: true,
            iat: Math.floor(Date.now() / 1000)
        }, process.env.JWT_SECRET, { expiresIn: '1h' });

        return bypassToken;
    }

    /**
     * Refresh token for active session
     */
    refreshSession(currentToken) {
        try {
            const decoded = jwt.verify(currentToken, process.env.JWT_SECRET);
            const session = this.activeSessions.get(decoded.sessionId);

            if (!session) {
                throw new Error('Session not found for refresh');
            }

            // Generate new token with same session ID
            const newToken = jwt.sign({
                userId: decoded.userId,
                sessionId: decoded.sessionId,
                deviceFingerprint: decoded.deviceFingerprint,
                iat: Math.floor(Date.now() / 1000)
            }, process.env.JWT_SECRET, { 
                expiresIn: '15m' // Shorter-lived tokens
            });

            // Update session activity
            session.lastActivity = new Date();
            session.lastRefresh = new Date();
            this.activeSessions.set(decoded.sessionId, session);

            console.log(`🔄 Token refreshed for session: ${decoded.sessionId}`);
            return { success: true, token: newToken, session };

        } catch (error) {
            return { success: false, error: error.message };
        }
    }
}

// Singleton instance
const sessionManager = new EnterpriseSingleSessionManager();

// Cleanup expired sessions every 30 minutes
setInterval(() => {
    sessionManager.cleanupExpiredSessions();
}, 30 * 60 * 1000);

module.exports = sessionManager;
