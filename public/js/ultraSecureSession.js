/**
 * 🛡️ Ultra-Secure Session Manager
 * Multi-layered session security with anomaly detection
 * Designed for single-user ultra-high security scenarios
 */

class UltraSecureSession {
    constructor() {
        this.sessionId = null;
        this.securityLayers = {
            hardware: null,
            biometric: null,
            totp: null,
            location: null,
            network: null
        };
        this.anomalyThreshold = 0.8;
        this.maxAnomalies = 3;
        this.currentAnomalies = 0;
        this.lastActivity = Date.now();
        this.sessionTimeout = 30 * 60 * 1000; // 30 minutes
        this.hardTimeout = 4 * 60 * 60 * 1000; // 4 hours max session
    }

    async initializeSession() {
        console.log('🔐 Initializing ultra-secure session...');
        
        // Generate unique session ID
        this.sessionId = await this.generateSecureSessionId();
        
        // Initialize all security layers
        await this.initializeSecurityLayers();
        
        // Start monitoring
        this.startSecurityMonitoring();
        
        console.log('✅ Ultra-secure session initialized');
        return this.sessionId;
    }

    async generateSecureSessionId() {
        // Combine multiple entropy sources
        const timestamp = Date.now();
        const random = crypto.getRandomValues(new Uint8Array(32));
        const performance = window.performance.now();
        
        const combined = `${timestamp}-${Array.from(random).join('')}-${performance}`;
        
        // Hash the combined entropy
        const encoder = new TextEncoder();
        const data = encoder.encode(combined);
        const hashBuffer = await crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    async initializeSecurityLayers() {
        // Hardware fingerprinting
        if (window.HardwareFingerprint) {
            const hwFp = new HardwareFingerprint();
            this.securityLayers.hardware = await hwFp.generateFingerprint();
            localStorage.setItem('hwFingerprint', this.securityLayers.hardware);
        }

        // Biometric analysis
        if (window.BiometricAnalyzer) {
            const biometric = new BiometricAnalyzer();
            biometric.startLearning();
            this.securityLayers.biometric = biometric;
        }

        // TOTP
        if (window.TOTPInterface) {
            const totp = new TOTPInterface();
            await totp.initialize();
            this.securityLayers.totp = totp;
        }

        // Location/Network fingerprinting
        this.securityLayers.location = await this.getLocationFingerprint();
        this.securityLayers.network = await this.getNetworkFingerprint();
    }

    async getLocationFingerprint() {
        return new Promise((resolve) => {
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    (position) => {
                        resolve({
                            latitude: Math.round(position.coords.latitude * 100) / 100, // Fuzzy location
                            longitude: Math.round(position.coords.longitude * 100) / 100,
                            accuracy: position.coords.accuracy
                        });
                    },
                    () => resolve(null),
                    { timeout: 5000, enableHighAccuracy: false }
                );
            } else {
                resolve(null);
            }
        });
    }

    async getNetworkFingerprint() {
        try {
            // Get external IP and basic network info
            const response = await fetch('https://api.ipify.org?format=json');
            const data = await response.json();
            
            return {
                ip: data.ip,
                connection: navigator.connection ? {
                    effectiveType: navigator.connection.effectiveType,
                    type: navigator.connection.type
                } : null,
                userAgent: navigator.userAgent
            };
        } catch (error) {
            return null;
        }
    }

    startSecurityMonitoring() {
        // Monitor for security anomalies
        setInterval(() => {
            this.performSecurityCheck();
        }, 60000); // Check every minute

        // Monitor user activity
        ['click', 'keydown', 'mousemove'].forEach(event => {
            document.addEventListener(event, () => {
                this.lastActivity = Date.now();
            });
        });

        // Session timeout monitoring
        setInterval(() => {
            this.checkSessionTimeout();
        }, 30000); // Check every 30 seconds

        // Tab visibility monitoring (security breach if user switches tabs)
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                console.warn('⚠️ Security alert: Tab lost focus');
                this.recordAnomaly('tab_hidden');
            }
        });

        // Window focus monitoring
        window.addEventListener('blur', () => {
            console.warn('⚠️ Security alert: Window lost focus');
            this.recordAnomaly('window_blur');
        });

        // Dev tools detection
        setInterval(() => {
            this.detectDevTools();
        }, 1000);
    }

    async performSecurityCheck() {
        const currentTime = Date.now();
        let anomalies = [];

        // Check hardware fingerprint
        if (this.securityLayers.hardware && window.HardwareFingerprint) {
            const hwFp = new HardwareFingerprint();
            const currentHw = await hwFp.generateFingerprint();
            if (currentHw !== this.securityLayers.hardware) {
                anomalies.push('hardware_mismatch');
            }
        }

        // Check network changes
        const currentNetwork = await this.getNetworkFingerprint();
        if (this.securityLayers.network && currentNetwork) {
            if (currentNetwork.ip !== this.securityLayers.network.ip) {
                anomalies.push('ip_change');
            }
        }

        // Check for rapid requests (potential automation)
        const requestCount = this.getRecentRequestCount();
        if (requestCount > 50) { // More than 50 requests per minute
            anomalies.push('high_request_rate');
        }

        // Process anomalies
        anomalies.forEach(anomaly => {
            this.recordAnomaly(anomaly);
        });

        if (anomalies.length > 0) {
            console.warn('🚨 Security anomalies detected:', anomalies);
        }
    }

    recordAnomaly(type) {
        this.currentAnomalies++;
        
        console.warn(`🚨 Security anomaly detected: ${type} (${this.currentAnomalies}/${this.maxAnomalies})`);
        
        // Store anomaly
        const anomalies = JSON.parse(localStorage.getItem('securityAnomalies') || '[]');
        anomalies.push({
            type,
            timestamp: Date.now(),
            sessionId: this.sessionId
        });
        localStorage.setItem('securityAnomalies', JSON.stringify(anomalies.slice(-100))); // Keep last 100

        // Trigger security response
        if (this.currentAnomalies >= this.maxAnomalies) {
            this.triggerSecurityLockdown();
        }
    }

    triggerSecurityLockdown() {
        console.error('🔒 SECURITY LOCKDOWN TRIGGERED - Multiple anomalies detected');
        
        // Clear all authentication data
        this.destroySession();
        
        // Show security alert
        this.showSecurityAlert();
        
        // Redirect to login
        setTimeout(() => {
            window.location.href = '/login.html';
        }, 3000);
    }

    showSecurityAlert() {
        // Create modal alert
        const alertModal = document.createElement('div');
        alertModal.innerHTML = `
            <div class="fixed inset-0 bg-red-900 bg-opacity-90 flex items-center justify-center z-50">
                <div class="bg-white p-8 rounded-lg shadow-2xl max-w-md text-center border-4 border-red-500">
                    <div class="text-red-500 text-6xl mb-4">
                        <i class="fas fa-shield-alt"></i>
                    </div>
                    <h2 class="text-2xl font-bold text-red-600 mb-4">SECURITY BREACH DETECTED</h2>
                    <p class="text-gray-700 mb-6">
                        Multiple security anomalies have been detected. Your session has been terminated for security reasons.
                    </p>
                    <div class="text-sm text-gray-500">
                        Redirecting to login in 3 seconds...
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(alertModal);
    }

    checkSessionTimeout() {
        const now = Date.now();
        const inactiveTime = now - this.lastActivity;
        const sessionAge = now - (this.sessionStartTime || now);

        // Check inactivity timeout
        if (inactiveTime > this.sessionTimeout) {
            console.warn('⏰ Session expired due to inactivity');
            this.destroySession();
            return false;
        }

        // Check hard timeout
        if (sessionAge > this.hardTimeout) {
            console.warn('⏰ Session expired due to maximum time limit');
            this.destroySession();
            return false;
        }

        return true;
    }

    detectDevTools() {
        // Multiple methods to detect developer tools
        const threshold = 160;
        
        // Method 1: Console detection
        let devtools = {open: false, orientation: null};
        
        setInterval(() => {
            if (window.outerHeight - window.innerHeight > threshold || 
                window.outerWidth - window.innerWidth > threshold) {
                if (!devtools.open) {
                    devtools.open = true;
                    this.recordAnomaly('devtools_detected');
                }
            } else {
                devtools.open = false;
            }
        }, 500);

        // Method 2: Console.clear detection
        let cleared = false;
        Object.defineProperty(console, 'clear', {
            get() {
                cleared = true;
                return () => {};
            }
        });

        setInterval(() => {
            if (cleared) {
                this.recordAnomaly('console_cleared');
                cleared = false;
            }
        }, 1000);
    }

    getRecentRequestCount() {
        // Track API requests (simplified)
        const requests = JSON.parse(sessionStorage.getItem('recentRequests') || '[]');
        const oneMinuteAgo = Date.now() - 60000;
        return requests.filter(timestamp => timestamp > oneMinuteAgo).length;
    }

    trackRequest() {
        const requests = JSON.parse(sessionStorage.getItem('recentRequests') || '[]');
        requests.push(Date.now());
        
        // Keep only last hour of requests
        const oneHourAgo = Date.now() - 3600000;
        const filtered = requests.filter(timestamp => timestamp > oneHourAgo);
        
        sessionStorage.setItem('recentRequests', JSON.stringify(filtered));
    }

    async validateTOTP(code) {
        if (!this.securityLayers.totp) return false;
        return await this.securityLayers.totp.verify(code);
    }

    async validateBiometric() {
        if (!this.securityLayers.biometric) return true; // Skip if not available
        
        const stored = this.securityLayers.biometric.loadProfile();
        if (!stored) return true; // No profile yet
        
        const current = this.securityLayers.biometric.generateProfile();
        if (!current) return true; // Not enough data
        
        return this.securityLayers.biometric.verify(stored);
    }

    destroySession() {
        // Clear all session data
        this.sessionId = null;
        this.currentAnomalies = 0;
        
        // Clear stored authentication
        localStorage.removeItem('adminToken');
        localStorage.removeItem('authToken');
        localStorage.removeItem('companyId');
        sessionStorage.clear();
        
        // Clear security layers
        this.securityLayers = {
            hardware: null,
            biometric: null,
            totp: null,
            location: null,
            network: null
        };
        
        console.log('🔒 Session destroyed for security');
    }

    getSecurityScore() {
        let score = 0;
        let maxScore = 0;

        // Hardware fingerprint
        if (this.securityLayers.hardware) {
            score += 25;
        }
        maxScore += 25;

        // Biometric
        if (this.securityLayers.biometric) {
            score += 30;
        }
        maxScore += 30;

        // TOTP
        if (this.securityLayers.totp) {
            score += 25;
        }
        maxScore += 25;

        // Network/Location
        if (this.securityLayers.network || this.securityLayers.location) {
            score += 20;
        }
        maxScore += 20;

        return Math.round((score / maxScore) * 100);
    }

    getSecurityStatus() {
        return {
            sessionId: this.sessionId ? this.sessionId.substring(0, 8) + '...' : null,
            securityScore: this.getSecurityScore(),
            anomalies: this.currentAnomalies,
            lastActivity: new Date(this.lastActivity).toLocaleTimeString(),
            activeLayers: Object.keys(this.securityLayers).filter(layer => 
                this.securityLayers[layer] !== null
            )
        };
    }
}

// Export for use in main application
window.UltraSecureSession = UltraSecureSession;
