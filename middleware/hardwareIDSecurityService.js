/**
 * V2 Hardware ID Security Service
 * Locks platform to specific hardware characteristics
 */

const crypto = require('crypto');
const logger = require('../utils/logger.js');

const os = require('os');

class HardwareIDSecurityService {
    constructor() {
        this.trustedHardwareIDs = new Set();
        this.hardwareLockEnabled = process.env.HARDWARE_LOCK_ENABLED === 'true';
        this.maxTrustedDevices = 3; // Maximum allowed devices
    }

    /**
     * Generate comprehensive hardware fingerprint
     */
    generateServerHardwareID() {
        const networkInterfaces = os.networkInterfaces();
        const macAddresses = [];
        
        // Extract MAC addresses
        for (const interfaceName in networkInterfaces) {
            const addresses = networkInterfaces[interfaceName];
            for (const addr of addresses) {
                if (addr.mac && addr.mac !== '00:00:00:00:00:00') {
                    macAddresses.push(addr.mac);
                }
            }
        }

        const hardwareData = {
            platform: os.platform(),
            arch: os.arch(),
            hostname: os.hostname(),
            macAddresses: macAddresses.sort(),
            cpus: os.cpus().length,
            totalMemory: os.totalmem(),
            homeDir: os.homedir(),
            user: os.userInfo().username
        };

        const hardwareID = crypto.createHash('sha256')
            .update(JSON.stringify(hardwareData))
            .digest('hex');

        logger.info(`🖥️ Server Hardware ID: ${hardwareID.substring(0, 16)}...`);
        return { hardwareID, hardwareData };
    }

    /**
     * Validate client hardware fingerprint against trusted devices
     */
    validateClientHardware(clientFingerprint, userId) {
        if (!this.hardwareLockEnabled) {
            return { valid: true, reason: 'Hardware lock disabled' };
        }

        const trustedKey = `${userId}:${clientFingerprint}`;
        
        if (this.trustedHardwareIDs.has(trustedKey)) {
            return { valid: true, reason: 'Trusted device' };
        }

        // Check if user has reached max devices
        const userDevices = Array.from(this.trustedHardwareIDs)
            .filter(key => key.startsWith(`${userId}:`));

        if (userDevices.length >= this.maxTrustedDevices) {
            return { 
                valid: false, 
                reason: `Maximum trusted devices exceeded (${this.maxTrustedDevices})`,
                requiresApproval: true
            };
        }

        return { 
            valid: false, 
            reason: 'Unknown device - requires approval',
            requiresApproval: true
        };
    }

    /**
     * Register new trusted device
     */
    registerTrustedDevice(userId, clientFingerprint, deviceInfo = {}) {
        const trustedKey = `${userId}:${clientFingerprint}`;
        this.trustedHardwareIDs.add(trustedKey);
        
        logger.info(`🔐 New trusted device registered for ${userId}: ${clientFingerprint.substring(0, 16)}...`);
        
        // Store device info for audit
        const deviceRecord = {
            userId,
            fingerprint: clientFingerprint,
            registeredAt: new Date(),
            deviceInfo,
            lastSeen: new Date()
        };

        return deviceRecord;
    }

    /**
     * Remove trusted device
     */
    removeTrustedDevice(userId, clientFingerprint) {
        const trustedKey = `${userId}:${clientFingerprint}`;
        const removed = this.trustedHardwareIDs.delete(trustedKey);
        
        if (removed) {
            logger.info(`🗑️ Trusted device removed for ${userId}: ${clientFingerprint.substring(0, 16)}...`);
        }
        
        return removed;
    }

    /**
     * Get all trusted devices for user
     */
    getUserTrustedDevices(userId) {
        return Array.from(this.trustedHardwareIDs)
            .filter(key => key.startsWith(`${userId}:`))
            .map(key => ({
                fingerprint: key.split(':')[1],
                registeredAt: new Date() // Would come from persistent storage
            }));
    }

    /**
     * Enhanced client fingerprint validation with multiple factors
     */
    validateEnhancedFingerprint(clientData) {
        const requiredFields = [
            'userAgent', 'screenResolution', 'timezone', 'language', 
            'platform', 'cookieEnabled', 'canvas'
        ];

        const missing = requiredFields.filter(field => !clientData[field]);
        if (missing.length > 0) {
            return {
                valid: false,
                reason: `Missing fingerprint data: ${missing.join(', ')}`
            };
        }

        // Check for common spoofing patterns
        if (clientData.userAgent.includes('HeadlessChrome') || 
            clientData.userAgent.includes('PhantomJS')) {
            return {
                valid: false,
                reason: 'Automated browser detected'
            };
        }

        // Validate screen resolution is reasonable
        const [width, height] = clientData.screenResolution.split('x').map(Number);
        if (width < 800 || height < 600 || width > 7680 || height > 4320) {
            return {
                valid: false,
                reason: 'Suspicious screen resolution'
            };
        }

        return { valid: true };
    }

    /**
     * Generate hardware-based challenge for additional security
     */
    generateHardwareChallenge() {
        const challenge = crypto.randomBytes(32).toString('hex');
        const serverHW = this.generateServerHardwareID();
        
        return {
            challenge,
            serverFingerprint: serverHW.hardwareID.substring(0, 16),
            timestamp: Date.now(),
            expiresAt: Date.now() + (5 * 60 * 1000) // 5 minutes
        };
    }

    /**
     * Verify hardware challenge response
     */
    verifyHardwareChallenge(challenge, clientResponse, clientFingerprint) {
        // Implement challenge-response verification
        const expectedResponse = crypto.createHash('sha256')
            .update(challenge + clientFingerprint)
            .digest('hex');

        return {
            valid: clientResponse === expectedResponse,
            reason: clientResponse === expectedResponse ? 'Valid challenge' : 'Invalid challenge response'
        };
    }

    /**
     * Emergency hardware unlock (for development/recovery)
     */
    emergencyUnlock(masterKey) {
        if (masterKey !== process.env.EMERGENCY_BYPASS_KEY) {
            return { success: false, reason: 'Invalid master key' };
        }

        this.hardwareLockEnabled = false;
        logger.debug('🚨 EMERGENCY HARDWARE UNLOCK ACTIVATED');
        
        return { 
            success: true, 
            reason: 'Hardware lock temporarily disabled',
            expiresIn: '1 hour'
        };
    }
}

module.exports = HardwareIDSecurityService;
