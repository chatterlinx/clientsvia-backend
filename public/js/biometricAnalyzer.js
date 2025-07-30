/**
 * 🔒 Behavioral Biometric Authentication
 * Analyzes typing patterns, mouse behavior, and interaction timing
 * Each person has a unique "digital signature" in how they interact
 */

class BiometricAnalyzer {
    constructor() {
        this.typingPattern = [];
        this.mousePattern = [];
        this.interactionPattern = [];
        this.profile = null;
        this.isLearning = false;
        this.minSamples = 20; // Minimum samples to create profile
    }

    startLearning() {
        this.isLearning = true;
        this.attachEventListeners();
        console.log('🧠 Learning your behavioral patterns...');
    }

    attachEventListeners() {
        // Typing pattern analysis
        let keyDownTime = {};
        let lastKeyTime = 0;

        document.addEventListener('keydown', (e) => {
            const now = performance.now();
            keyDownTime[e.code] = now;
            
            if (lastKeyTime > 0) {
                const interval = now - lastKeyTime;
                this.typingPattern.push({
                    interval,
                    key: e.code,
                    timestamp: now
                });
            }
            lastKeyTime = now;
        });

        document.addEventListener('keyup', (e) => {
            const now = performance.now();
            const downTime = keyDownTime[e.code];
            
            if (downTime) {
                const holdTime = now - downTime;
                this.typingPattern.push({
                    holdTime,
                    key: e.code,
                    timestamp: now
                });
                delete keyDownTime[e.code];
            }
        });

        // Mouse behavior analysis
        let lastMouseTime = 0;
        let mousePositions = [];

        document.addEventListener('mousemove', (e) => {
            const now = performance.now();
            
            if (lastMouseTime > 0) {
                const timeDiff = now - lastMouseTime;
                const distance = this.calculateDistance(
                    mousePositions[mousePositions.length - 1] || { x: 0, y: 0 },
                    { x: e.clientX, y: e.clientY }
                );
                
                this.mousePattern.push({
                    velocity: distance / timeDiff,
                    acceleration: this.calculateAcceleration(mousePositions, { x: e.clientX, y: e.clientY }, timeDiff),
                    direction: this.calculateDirection(mousePositions[mousePositions.length - 1] || { x: 0, y: 0 }, { x: e.clientX, y: e.clientY }),
                    timestamp: now
                });
            }
            
            mousePositions.push({ x: e.clientX, y: e.clientY, time: now });
            if (mousePositions.length > 10) mousePositions.shift(); // Keep last 10 positions
            
            lastMouseTime = now;
        });

        // Click pattern analysis
        document.addEventListener('click', (e) => {
            this.interactionPattern.push({
                type: 'click',
                position: { x: e.clientX, y: e.clientY },
                timestamp: performance.now(),
                element: e.target.tagName
            });
        });

        // Scroll pattern analysis
        document.addEventListener('scroll', (e) => {
            this.interactionPattern.push({
                type: 'scroll',
                scrollTop: window.pageYOffset,
                timestamp: performance.now()
            });
        });
    }

    calculateDistance(pos1, pos2) {
        return Math.sqrt(Math.pow(pos2.x - pos1.x, 2) + Math.pow(pos2.y - pos1.y, 2));
    }

    calculateDirection(pos1, pos2) {
        return Math.atan2(pos2.y - pos1.y, pos2.x - pos1.x);
    }

    calculateAcceleration(positions, currentPos, timeDiff) {
        if (positions.length < 2) return 0;
        
        const prev = positions[positions.length - 1];
        const prevPrev = positions[positions.length - 2];
        
        const velocity1 = this.calculateDistance(prevPrev, prev) / timeDiff;
        const velocity2 = this.calculateDistance(prev, currentPos) / timeDiff;
        
        return (velocity2 - velocity1) / timeDiff;
    }

    generateProfile() {
        if (this.typingPattern.length < this.minSamples) {
            return null; // Not enough data
        }

        // Analyze typing patterns
        const typingStats = this.analyzeTypingPattern();
        const mouseStats = this.analyzeMousePattern();
        const interactionStats = this.analyzeInteractionPattern();

        this.profile = {
            typing: typingStats,
            mouse: mouseStats,
            interaction: interactionStats,
            created: Date.now(),
            sampleCount: this.typingPattern.length
        };

        console.log('🎯 Behavioral profile created:', this.profile);
        return this.profile;
    }

    analyzeTypingPattern() {
        const intervals = this.typingPattern
            .filter(p => p.interval)
            .map(p => p.interval);
        
        const holdTimes = this.typingPattern
            .filter(p => p.holdTime)
            .map(p => p.holdTime);

        return {
            avgInterval: this.average(intervals),
            stdInterval: this.standardDeviation(intervals),
            avgHoldTime: this.average(holdTimes),
            stdHoldTime: this.standardDeviation(holdTimes),
            rhythm: this.calculateRhythm(intervals)
        };
    }

    analyzeMousePattern() {
        const velocities = this.mousePattern.map(p => p.velocity);
        const accelerations = this.mousePattern.map(p => p.acceleration);

        return {
            avgVelocity: this.average(velocities),
            stdVelocity: this.standardDeviation(velocities),
            avgAcceleration: this.average(accelerations),
            stdAcceleration: this.standardDeviation(accelerations),
            smoothness: this.calculateSmoothness(velocities)
        };
    }

    analyzeInteractionPattern() {
        const clickTimes = this.interactionPattern
            .filter(p => p.type === 'click')
            .map(p => p.timestamp);
        
        const intervals = [];
        for (let i = 1; i < clickTimes.length; i++) {
            intervals.push(clickTimes[i] - clickTimes[i-1]);
        }

        return {
            avgClickInterval: this.average(intervals),
            stdClickInterval: this.standardDeviation(intervals),
            totalClicks: clickTimes.length,
            scrollCount: this.interactionPattern.filter(p => p.type === 'scroll').length
        };
    }

    average(arr) {
        return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
    }

    standardDeviation(arr) {
        const avg = this.average(arr);
        const squareDiffs = arr.map(value => Math.pow(value - avg, 2));
        return Math.sqrt(this.average(squareDiffs));
    }

    calculateRhythm(intervals) {
        // Analyze consistency of typing rhythm
        const avg = this.average(intervals);
        const deviations = intervals.map(interval => Math.abs(interval - avg));
        return 1 / (1 + this.average(deviations)); // Higher = more consistent
    }

    calculateSmoothness(velocities) {
        // Analyze smoothness of mouse movement
        let abruptChanges = 0;
        for (let i = 1; i < velocities.length; i++) {
            if (Math.abs(velocities[i] - velocities[i-1]) > 50) {
                abruptChanges++;
            }
        }
        return 1 - (abruptChanges / velocities.length); // Higher = smoother
    }

    // Verify current behavior against stored profile
    verify(storedProfile, threshold = 0.85) {
        if (!this.profile || !storedProfile) return false;

        const typingScore = this.compareTypingPattern(this.profile.typing, storedProfile.typing);
        const mouseScore = this.compareMousePattern(this.profile.mouse, storedProfile.mouse);
        const interactionScore = this.compareInteractionPattern(this.profile.interaction, storedProfile.interaction);

        const overallScore = (typingScore + mouseScore + interactionScore) / 3;
        
        console.log('🔍 Biometric verification scores:', {
            typing: typingScore,
            mouse: mouseScore,
            interaction: interactionScore,
            overall: overallScore,
            threshold: threshold
        });

        return overallScore >= threshold;
    }

    compareTypingPattern(current, stored) {
        const intervalDiff = Math.abs(current.avgInterval - stored.avgInterval) / stored.avgInterval;
        const holdTimeDiff = Math.abs(current.avgHoldTime - stored.avgHoldTime) / stored.avgHoldTime;
        const rhythmDiff = Math.abs(current.rhythm - stored.rhythm);

        return Math.max(0, 1 - ((intervalDiff + holdTimeDiff + rhythmDiff) / 3));
    }

    compareMousePattern(current, stored) {
        const velocityDiff = Math.abs(current.avgVelocity - stored.avgVelocity) / stored.avgVelocity;
        const smoothnessDiff = Math.abs(current.smoothness - stored.smoothness);

        return Math.max(0, 1 - ((velocityDiff + smoothnessDiff) / 2));
    }

    compareInteractionPattern(current, stored) {
        const clickDiff = Math.abs(current.avgClickInterval - stored.avgClickInterval) / stored.avgClickInterval;
        
        return Math.max(0, 1 - clickDiff);
    }

    saveProfile() {
        if (this.profile) {
            localStorage.setItem('biometricProfile', JSON.stringify(this.profile));
            console.log('💾 Biometric profile saved');
        }
    }

    loadProfile() {
        const stored = localStorage.getItem('biometricProfile');
        if (stored) {
            this.profile = JSON.parse(stored);
            console.log('📁 Biometric profile loaded');
            return this.profile;
        }
        return null;
    }
}

// Export for use in main application
window.BiometricAnalyzer = BiometricAnalyzer;
