/**
 * 🔐 Time-Based One-Time Password (TOTP) Implementation
 * Generates 6-digit codes that change every 30 seconds
 * Works like Google Authenticator but built into your platform
 */

class TOTPGenerator {
    constructor(secret = null) {
        this.secret = secret || this.generateSecret();
        this.timeStep = 30; // 30 seconds
        this.digits = 6;
        this.algorithm = 'SHA-1';
    }

    generateSecret() {
        // Generate a random 20-byte secret (160 bits)
        const array = new Uint8Array(20);
        crypto.getRandomValues(array);
        return this.base32Encode(array);
    }

    base32Encode(buffer) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let result = '';
        let bits = 0;
        let value = 0;

        for (let i = 0; i < buffer.length; i++) {
            value = (value << 8) | buffer[i];
            bits += 8;

            while (bits >= 5) {
                result += alphabet[(value >>> (bits - 5)) & 31];
                bits -= 5;
            }
        }

        if (bits > 0) {
            result += alphabet[(value << (5 - bits)) & 31];
        }

        return result;
    }

    base32Decode(str) {
        const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
        let result = new Uint8Array(Math.floor(str.length * 5 / 8));
        let bits = 0;
        let value = 0;
        let index = 0;

        for (let i = 0; i < str.length; i++) {
            const char = str.charAt(i).toUpperCase();
            const charIndex = alphabet.indexOf(char);
            
            if (charIndex === -1) continue;

            value = (value << 5) | charIndex;
            bits += 5;

            if (bits >= 8) {
                result[index++] = (value >>> (bits - 8)) & 255;
                bits -= 8;
            }
        }

        return result.slice(0, index);
    }

    async generateTOTP(timeStamp = null) {
        const time = timeStamp || Math.floor(Date.now() / 1000);
        const timeSlot = Math.floor(time / this.timeStep);
        
        // Convert time slot to 8-byte array
        const timeBuffer = new ArrayBuffer(8);
        const timeView = new DataView(timeBuffer);
        timeView.setUint32(4, timeSlot, false); // Big-endian

        // Decode the secret
        const secretBuffer = this.base32Decode(this.secret);

        // Import the secret as a key
        const key = await crypto.subtle.importKey(
            'raw',
            secretBuffer,
            { name: 'HMAC', hash: 'SHA-1' },
            false,
            ['sign']
        );

        // Generate HMAC
        const signature = await crypto.subtle.sign('HMAC', key, timeBuffer);
        const hmac = new Uint8Array(signature);

        // Dynamic truncation
        const offset = hmac[hmac.length - 1] & 0x0f;
        const code = (
            ((hmac[offset] & 0x7f) << 24) |
            ((hmac[offset + 1] & 0xff) << 16) |
            ((hmac[offset + 2] & 0xff) << 8) |
            (hmac[offset + 3] & 0xff)
        ) % Math.pow(10, this.digits);

        return code.toString().padStart(this.digits, '0');
    }

    async verifyTOTP(token, window = 1) {
        const currentTime = Math.floor(Date.now() / 1000);
        
        // Check current time slot and adjacent ones (to handle clock drift)
        for (let i = -window; i <= window; i++) {
            const testTime = currentTime + (i * this.timeStep);
            const expectedToken = await this.generateTOTP(testTime);
            
            if (token === expectedToken) {
                return true;
            }
        }
        
        return false;
    }

    getTimeRemaining() {
        const currentTime = Math.floor(Date.now() / 1000);
        const timeSlot = Math.floor(currentTime / this.timeStep);
        const nextSlot = (timeSlot + 1) * this.timeStep;
        return nextSlot - currentTime;
    }

    generateQRCode() {
        // Generate QR code data for authenticator apps
        const issuer = 'ClientsVia';
        const accountName = 'Admin';
        const otpAuthURL = `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}?secret=${this.secret}&issuer=${encodeURIComponent(issuer)}`;
        
        return {
            url: otpAuthURL,
            secret: this.secret
        };
    }

    // Save secret to localStorage (encrypted)
    async saveSecret() {
        const encrypted = await this.encryptSecret(this.secret);
        localStorage.setItem('totpSecret', encrypted);
    }

    // Load secret from localStorage (decrypt)
    async loadSecret() {
        const encrypted = localStorage.getItem('totpSecret');
        if (encrypted) {
            this.secret = await this.decryptSecret(encrypted);
            return this.secret;
        }
        return null;
    }

    async encryptSecret(secret) {
        const key = await crypto.subtle.generateKey(
            { name: 'AES-GCM', length: 256 },
            true,
            ['encrypt', 'decrypt']
        );

        const encoder = new TextEncoder();
        const data = encoder.encode(secret);
        const iv = crypto.getRandomValues(new Uint8Array(12));

        const encrypted = await crypto.subtle.encrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            data
        );

        // Export key for storage
        const exportedKey = await crypto.subtle.exportKey('raw', key);

        return JSON.stringify({
            key: Array.from(new Uint8Array(exportedKey)),
            iv: Array.from(iv),
            data: Array.from(new Uint8Array(encrypted))
        });
    }

    async decryptSecret(encryptedData) {
        const parsed = JSON.parse(encryptedData);
        
        const key = await crypto.subtle.importKey(
            'raw',
            new Uint8Array(parsed.key),
            { name: 'AES-GCM' },
            false,
            ['decrypt']
        );

        const decrypted = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: new Uint8Array(parsed.iv) },
            key,
            new Uint8Array(parsed.data)
        );

        const decoder = new TextDecoder();
        return decoder.decode(decrypted);
    }
}

// TOTP UI Component
class TOTPInterface {
    constructor() {
        this.totp = new TOTPGenerator();
        this.currentCode = '';
        this.updateInterval = null;
    }

    async initialize() {
        // Try to load existing secret
        const existingSecret = await this.totp.loadSecret();
        if (!existingSecret) {
            // Generate new secret and save it
            await this.totp.saveSecret();
            console.log('🔐 New TOTP secret generated and saved');
        }

        this.updateCode();
        this.startUpdateTimer();
    }

    async updateCode() {
        this.currentCode = await this.totp.generateTOTP();
        const timeRemaining = this.totp.getTimeRemaining();
        
        // Update UI if element exists
        const codeElement = document.getElementById('totp-code');
        const timerElement = document.getElementById('totp-timer');
        
        if (codeElement) {
            codeElement.textContent = this.currentCode;
        }
        
        if (timerElement) {
            timerElement.textContent = `${timeRemaining}s`;
        }

        console.log(`🔐 TOTP Code: ${this.currentCode} (expires in ${timeRemaining}s)`);
    }

    startUpdateTimer() {
        this.updateInterval = setInterval(() => {
            this.updateCode();
        }, 1000);
    }

    async verify(userCode) {
        return await this.totp.verifyTOTP(userCode);
    }

    getSetupInfo() {
        return this.totp.generateQRCode();
    }

    createUI() {
        return `
            <div class="totp-container bg-gray-900 text-white p-4 rounded-lg border border-green-500">
                <div class="flex items-center mb-3">
                    <i class="fas fa-shield-alt text-green-400 mr-2"></i>
                    <h3 class="font-semibold">Security Code</h3>
                </div>
                <div class="text-center">
                    <div id="totp-code" class="text-2xl font-mono font-bold text-green-400 mb-2">------</div>
                    <div class="text-sm text-gray-400">
                        Expires in <span id="totp-timer" class="text-yellow-400 font-bold">--</span>
                    </div>
                </div>
            </div>
        `;
    }
}

// Export for use in main application
window.TOTPGenerator = TOTPGenerator;
window.TOTPInterface = TOTPInterface;
