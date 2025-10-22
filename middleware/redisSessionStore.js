/**
 * V2 Redis Session Store
 * Replaces in-memory storage with persistent, scalable Redis
 */

const redis = require('redis');
const logger = require('../utils/logger.js');

const crypto = require('crypto');

class RedisSessionStore {
    constructor() {
        this.client = redis.createClient({ 
            url: process.env.REDIS_URL || 'redis://localhost:6379',
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
     */
    async setSession(sessionId, sessionData, ttlSeconds = 3600) {
        try {
            await this.connect();
            const key = `session:${sessionId}`;
            await this.client.setEx(key, ttlSeconds, JSON.stringify(sessionData));
            logger.security(`💾 Session stored in Redis: ${sessionId} (TTL: ${ttlSeconds}s)`);
            return true;
        } catch (error) {
            logger.security('Redis setSession error:', error);
            return false;
        }
    }

    /**
     * Get session from Redis
     */
    async getSession(sessionId) {
        try {
            await this.connect();
            const key = `session:${sessionId}`;
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
     */
    async deleteSession(sessionId) {
        try {
            await this.connect();
            const key = `session:${sessionId}`;
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
     */
    async killAllUserSessions(userId) {
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
     */
    async getAllActiveSessions() {
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
     */
    async logSecurityEvent(event, data) {
        try {
            await this.connect();
            const logKey = `security_log:${Date.now()}:${crypto.randomUUID()}`;
            const logData = {
                event,
                data,
                timestamp: new Date().toISOString(),
                ip: data.ip || 'unknown'
            };
            
            // Store log with 30-day TTL
            await this.client.setEx(logKey, 30 * 24 * 60 * 60, JSON.stringify(logData));
            logger.security(`🔍 Security event logged: ${event}`);
        } catch (error) {
            logger.security('Redis security log error:', error);
        }
    }

    /**
     * Check for suspicious activity patterns
     */
    async checkSuspiciousActivity(userId, currentIP) {
        try {
            await this.connect();
            const pattern = `security_log:*`;
            const keys = await this.client.keys(pattern);
            
            const recentLogins = [];
            const oneHourAgo = Date.now() - (60 * 60 * 1000);

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
}

module.exports = RedisSessionStore;
