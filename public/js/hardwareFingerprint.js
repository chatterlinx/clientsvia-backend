/**
 * 🔒 Ultra-Secure Hardware Fingerprinting
 * Creates a unique signature based on device characteristics
 * Nearly impossible to replicate on another device
 */

class HardwareFingerprint {
    constructor() {
        this.fingerprint = null;
        this.components = {};
    }

    async generateFingerprint() {
        const canvas = this.getCanvasFingerprint();
        const webgl = this.getWebGLFingerprint();
        const audio = await this.getAudioFingerprint();
        const screen = this.getScreenFingerprint();
        const timezone = this.getTimezoneFingerprint();
        const language = this.getLanguageFingerprint();
        const plugins = this.getPluginFingerprint();
        const fonts = await this.getFontFingerprint();

        this.components = {
            canvas,
            webgl,
            audio,
            screen,
            timezone,
            language,
            plugins,
            fonts,
            userAgent: navigator.userAgent,
            platform: navigator.platform,
            cookieEnabled: navigator.cookieEnabled,
            doNotTrack: navigator.doNotTrack,
            hardwareConcurrency: navigator.hardwareConcurrency,
            deviceMemory: navigator.deviceMemory || 'unknown',
            connection: this.getConnectionFingerprint()
        };

        // Create a SHA-256 hash of all components
        this.fingerprint = await this.hashComponents();
        return this.fingerprint;
    }

    getCanvasFingerprint() {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        
        // Draw specific patterns that vary by GPU/driver
        ctx.textBaseline = 'top';
        ctx.font = '14px Arial';
        ctx.fillText('Hardware fingerprint test 🔒', 2, 2);
        
        ctx.fillStyle = 'rgba(102, 204, 0, 0.2)';
        ctx.fillRect(125, 1, 62, 20);
        
        return canvas.toDataURL();
    }

    getWebGLFingerprint() {
        const canvas = document.createElement('canvas');
        const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
        
        if (!gl) return 'no-webgl';

        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        return {
            vendor: gl.getParameter(debugInfo?.UNMASKED_VENDOR_WEBGL || gl.VENDOR),
            renderer: gl.getParameter(debugInfo?.UNMASKED_RENDERER_WEBGL || gl.RENDERER),
            version: gl.getParameter(gl.VERSION),
            shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
            extensions: gl.getSupportedExtensions()?.slice(0, 10) // Limit for performance
        };
    }

    async getAudioFingerprint() {
        return new Promise((resolve) => {
            try {
                const context = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = context.createOscillator();
                const analyser = context.createAnalyser();
                const gainNode = context.createGain();
                
                oscillator.type = 'triangle';
                oscillator.frequency.value = 10000;
                
                gainNode.gain.value = 0; // Silent
                
                oscillator.connect(analyser);
                analyser.connect(gainNode);
                gainNode.connect(context.destination);
                
                oscillator.start();
                
                setTimeout(() => {
                    const data = new Uint8Array(analyser.frequencyBinCount);
                    analyser.getByteFrequencyData(data);
                    oscillator.stop();
                    context.close();
                    
                    const fingerprint = Array.from(data.slice(0, 30)).join(',');
                    resolve(fingerprint);
                }, 100);
            } catch (error) {
                resolve('audio-error');
            }
        });
    }

    getScreenFingerprint() {
        return {
            width: screen.width,
            height: screen.height,
            availWidth: screen.availWidth,
            availHeight: screen.availHeight,
            colorDepth: screen.colorDepth,
            pixelDepth: screen.pixelDepth,
            devicePixelRatio: window.devicePixelRatio,
            orientation: screen.orientation?.type || 'unknown'
        };
    }

    getTimezoneFingerprint() {
        return {
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            timezoneOffset: new Date().getTimezoneOffset(),
            locale: Intl.DateTimeFormat().resolvedOptions().locale
        };
    }

    getLanguageFingerprint() {
        return {
            language: navigator.language,
            languages: navigator.languages?.slice(0, 5)
        };
    }

    getPluginFingerprint() {
        return Array.from(navigator.plugins || [])
            .slice(0, 10)
            .map(plugin => ({
                name: plugin.name,
                filename: plugin.filename
            }));
    }

    async getFontFingerprint() {
        const fonts = [
            'Arial', 'Helvetica', 'Times New Roman', 'Courier New',
            'Verdana', 'Georgia', 'Palatino', 'Garamond',
            'Comic Sans MS', 'Trebuchet MS', 'Arial Black', 'Impact'
        ];

        const availableFonts = [];
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');

        for (const font of fonts) {
            ctx.font = `12px ${font}, monospace`;
            const width = ctx.measureText('mmmmmmmmmmlli').width;
            availableFonts.push({ font, width });
        }

        return availableFonts;
    }

    getConnectionFingerprint() {
        const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
        return conn ? {
            effectiveType: conn.effectiveType,
            type: conn.type,
            downlink: conn.downlink,
            rtt: conn.rtt
        } : null;
    }

    async hashComponents() {
        const data = JSON.stringify(this.components);
        const encoder = new TextEncoder();
        const dataBuffer = encoder.encode(data);
        const hashBuffer = await crypto.subtle.digest('SHA-256', dataBuffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    }

    // Verify if current device matches stored fingerprint
    async verify(storedFingerprint) {
        const currentFingerprint = await this.generateFingerprint();
        return currentFingerprint === storedFingerprint;
    }
}

// Export for use in main application
window.HardwareFingerprint = HardwareFingerprint;
