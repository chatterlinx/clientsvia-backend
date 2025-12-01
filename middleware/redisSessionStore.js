/**
 * V2 Redis Session Store
 * Replaces in-memory storage with persistent, scalable Redis
 * 
 * GRACEFUL DEGRADATION:
 * - If REDIS_URL is not configured, operates in memory-only mode
 * - All methods safely handle the null client case
 * - Sessions won't persist across restarts without Redis
 */

const redis = require('redis');
const logger = require('../utils/logger.js');

const crypto = require('crypto');

// Check if Redis is configured
const REDIS_ENABLED = !!process.env.REDIS_URL;

class RedisSessionStore {
    constructor() {
        this.enabled = REDIS_ENABLED;
        this.client = null;
        
        // In-memory fallback when Redis is not configured
        this.memoryStore = new Map();
        
        if (!REDIS_ENABLED) {
            logger.warn('[REDIS SESSION STORE] ⚠️ REDIS_URL not configured - using MEMORY-ONLY mode');
            logger.warn('[REDIS SESSION STORE] Sessions will NOT persist across restarts');
            return;
        }
        
        this.client = redis.createClient({ 
            url: process.env.REDIS_URL,
            socket: {
                connectTimeout: 60000,
                lazyConnect: true,
                reconnectDelay: 1000,
                reconnectAttempts: 10,
                keepAlive: 30000,
            },
            retry_unfulfilled_commands: true,
            enable_offline_queue: false
        });

        this.client.on('error', (err) => {
            logger.security('Redis Session Store Error:', err);
        });

        this.client.on('connect', () => {
            logger.security('✅ Redis Session Store connected');
        });

        this.client.on('ready', () => {
            logger.security('🔥 Redis Session Store ready for v2 operations');
        });

        // Connect to Redis
        this.connect();
    }

    async connect() {
        // Skip if Redis not configured
        if (!this.client) return;
        
        try {
            if (!this.client.isOpen) {
                await this.client.connect();
            }
        } catch (error) {
            logger.error('Redis connection failed:', error);
        }
    }

    /**
     * Store session with TTL
     * Falls back to memory store if Redis not configured
     */
    async setSession(sessionId, sessionData, ttlSeconds = 3600) {
        const key = `session:${sessionId}`;
        
        // Memory-only mode
        if (!this.client) {
            this.memoryStore.set(key, {
                data: sessionData,
                expiresAt: Date.now() + (ttlSeconds * 1000)
            });
            logger.security(`💾 Session stored in MEMORY: ${sessionId} (TTL: ${ttlSeconds}s)`);
            return true;
        }
        
        // Redis mode
        try {
            await this.connect();
            await this.client.setEx(key, ttlSeconds, JSON.stringify(sessionData));
            logger.security(`💾 Session stored in Redis: ${sessionId} (TTL: ${ttlSeconds}s)`);
            return true;
        } catch (error) {
            logger.security('Redis setSession error:', error);
            // Fallback to memory on Redis error
            this.memoryStore.set(key, {
                data: sessionData,
                expiresAt: Date.now() + (ttlSeconds * 1000)
            });
            return true;
        }
    }

    /**
     * Get session from Redis
     * Falls back to memory store if Redis not configured
     */
    async getSession(sessionId) {
        const key = `session:${sessionId}`;
        
        // Memory-only mode
        if (!this.client) {
            const cached = this.memoryStore.get(key);
            if (!cached) return null;
            
            // Check expiration
            if (Date.now() > cached.expiresAt) {
                this.memoryStore.delete(key);
                return null;
            }
            
            const session = cached.data;
            session.lastActivity = new Date();
            return session;
        }
        
        // Redis mode
        try {
            await this.connect();
            const data = await this.client.get(key);
            
            if (!data) {return null;}
            
            const session = JSON.parse(data);
            // Update last activity timestamp
            session.lastActivity = new Date();
            await this.setSession(sessionId, session, 3600);
            
            return session;
        } catch (error) {
            logger.security('Redis getSession error:', error);
            return null;
        }
    }

    /**
     * Delete session from Redis
     * Falls back to memory store if Redis not configured
     */
    async deleteSession(sessionId) {
        const key = `session:${sessionId}`;
        
        // Memory-only mode
        if (!this.client) {
            const existed = this.memoryStore.has(key);
            this.memoryStore.delete(key);
            logger.security(`🗑️ Session deleted from MEMORY: ${sessionId}`);
            return existed;
        }
        
        // Redis mode
        try {
            await this.connect();
            const result = await this.client.del(key);
            logger.security(`🗑️ Session deleted from Redis: ${sessionId}`);
            return result > 0;
        } catch (error) {
            logger.security('Redis deleteSession error:', error);
            return false;
        }
    }

    /**
     * Kill all sessions for a user
     * Falls back to memory store if Redis not configured
     */
    async killAllUserSessions(userId) {
        // Memory-only mode
        if (!this.client) {
            let killedCount = 0;
            for (const [key, cached] of this.memoryStore.entries()) {
                if (key.startsWith('session:') && cached.data.userId === userId) {
                    this.memoryStore.delete(key);
                    killedCount++;
                    logger.security(`💀 Killed memory session: ${key} for user ${userId}`);
                }
            }
            return killedCount;
        }
        
        // Redis mode
        try {
            await this.connect();
            const pattern = `session:*`;
            const keys = await this.client.keys(pattern);
            let killedCount = 0;

            for (const key of keys) {
                const data = await this.client.get(key);
                if (data) {
                    const session = JSON.parse(data);
                    if (session.userId === userId) {
                        await this.client.del(key);
                        killedCount++;
                        logger.security(`💀 Killed Redis session: ${key} for user ${userId}`);
                    }
                }
            }

            return killedCount;
        } catch (error) {
            logger.security('Redis killAllUserSessions error:', error);
            return 0;
        }
    }

    /**
     * Get all active sessions
     * Falls back to memory store if Redis not configured
     */
    async getAllActiveSessions() {
        // Memory-only mode
        if (!this.client) {
            const sessions = [];
            const now = Date.now();
            
            for (const [key, cached] of this.memoryStore.entries()) {
                if (key.startsWith('session:') && now < cached.expiresAt) {
                    const session = cached.data;
                    sessions.push({
                        sessionId: key.replace('session:', ''),
                        userId: session.userId,
                        location: session.location,
                        lastActivity: session.lastActivity,
                        ttl: Math.floor((cached.expiresAt - now) / 1000),
                        age: session.createdAt ? Date.now() - new Date(session.createdAt).getTime() : 0
                    });
                }
            }
            return sessions;
        }
        
        // Redis mode
        try {
            await this.connect();
            const pattern = `session:*`;
            const keys = await this.client.keys(pattern);
            const sessions = [];

            for (const key of keys) {
                const data = await this.client.get(key);
                if (data) {
                    const session = JSON.parse(data);
                    const ttl = await this.client.ttl(key);
                    sessions.push({
                        sessionId: key.replace('session:', ''),
                        userId: session.userId,
                        location: session.location,
                        lastActivity: session.lastActivity,
                        ttl,
                        age: Date.now() - new Date(session.createdAt).getTime()
                    });
                }
            }

            return sessions;
        } catch (error) {
            logger.security('Redis getAllActiveSessions error:', error);
            return [];
        }
    }

    /**
     * Store audit log in Redis
     * Falls back to memory store if Redis not configured
     */
    async logSecurityEvent(event, data) {
        const logKey = `security_log:${Date.now()}:${crypto.randomUUID()}`;
        const logData = {
            event,
            data,
            timestamp: new Date().toISOString(),
            ip: data.ip || 'unknown'
        };
        
        // Memory-only mode - limited retention (auto-cleanup older than 1 hour)
        if (!this.client) {
            this.memoryStore.set(logKey, {
                data: logData,
                expiresAt: Date.now() + (60 * 60 * 1000) // 1 hour in memory
            });
            logger.security(`🔍 Security event logged (memory): ${event}`);
            return;
        }
        
        // Redis mode
        try {
            await this.connect();
            // Store log with 30-day TTL
            await this.client.setEx(logKey, 30 * 24 * 60 * 60, JSON.stringify(logData));
            logger.security(`🔍 Security event logged: ${event}`);
        } catch (error) {
            logger.security('Redis security log error:', error);
        }
    }

    /**
     * Check for suspicious activity patterns
     * Falls back to memory store if Redis not configured
     */
    async checkSuspiciousActivity(userId, currentIP) {
        const oneHourAgo = Date.now() - (60 * 60 * 1000);
        
        // Memory-only mode
        if (!this.client) {
            const recentLogins = [];
            
            for (const [key, cached] of this.memoryStore.entries()) {
                if (key.startsWith('security_log:') && Date.now() < cached.expiresAt) {
                    const log = cached.data;
                    if (log.data.userId === userId && 
                        new Date(log.timestamp).getTime() > oneHourAgo &&
                        log.event === 'login') {
                        recentLogins.push(log);
                    }
                }
            }
            
            const uniqueIPs = [...new Set(recentLogins.map(l => l.data.ip))];
            if (uniqueIPs.length > 3) {
                return {
                    suspicious: true,
                    reason: 'Multiple IP addresses in short time',
                    details: { uniqueIPs, loginCount: recentLogins.length }
                };
            }
            return { suspicious: false };
        }
        
        // Redis mode
        try {
            await this.connect();
            const pattern = `security_log:*`;
            const keys = await this.client.keys(pattern);
            
            const recentLogins = [];

            for (const key of keys) {
                const data = await this.client.get(key);
                if (data) {
                    const log = JSON.parse(data);
                    if (log.data.userId === userId && 
                        new Date(log.timestamp).getTime() > oneHourAgo &&
                        log.event === 'login') {
                        recentLogins.push(log);
                    }
                }
            }

            // Check for multiple IPs in short time
            const uniqueIPs = [...new Set(recentLogins.map(l => l.data.ip))];
            if (uniqueIPs.length > 3) {
                return {
                    suspicious: true,
                    reason: 'Multiple IP addresses in short time',
                    details: { uniqueIPs, loginCount: recentLogins.length }
                };
            }

            return { suspicious: false };
        } catch (error) {
            logger.security('Suspicious activity check error:', error);
            return { suspicious: false };
        }
    }
    
    /**
     * Check if Redis is enabled
     */
    isEnabled() {
        return this.enabled;
    }
}

module.exports = RedisSessionStore;
