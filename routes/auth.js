const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { authenticateJWT, authenticateSingleSession } = require('../middleware/auth');
const sessionManager = require('../middleware/singleSessionManager');
const logger = require('../utils/logger');
// Import configured passport (this loads the strategies)
require('../config/passport');
const passport = require('passport');

/**
 * POST /api/auth/register - Register a new admin user
 * For development/setup purposes
 */
router.post('/register', async (req, res) => {
    try {
        const { email, name, password, role = 'admin' } = req.body;
        
        if (!email || !name || !password) {
            return res.status(400).json({ 
                message: 'Email, name, and password are required' 
            });
        }
        
        // Check if user already exists
        const existingUser = await User.findOne({ email: email.toLowerCase() });
        if (existingUser) {
            return res.status(400).json({ 
                message: 'User already exists with this email' 
            });
        }
        
        // Hash password
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);
        
        // Create new user
        const newUser = new User({
            email: email.toLowerCase(),
            name,
            password: hashedPassword,
            role,
            status: 'active'
        });
        
        await newUser.save();
        
        // Log user creation
        logger.auth('User registered', { 
            userId: newUser._id, 
            email: newUser.email, 
            role: newUser.role 
        });
        
        res.status(201).json({
            success: true,
            message: 'User registered successfully',
            user: {
                id: newUser._id,
                email: newUser.email,
                name: newUser.name,
                role: newUser.role
            }
        });
        
    } catch (err) {
        logger.error('Registration error:', err);
        res.status(500).json({ 
            message: 'Server error during registration',
            error: err.message 
        });
    }
});

/**
 * POST /api/auth/login - Authenticate user and return JWT token
 */
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.status(400).json({ 
                message: 'Email and password are required' 
            });
        }
        
        // Find user by email
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) {
            logger.auth('Login failed - user not found', { email });
            return res.status(401).json({ 
                message: 'Invalid email or password' 
            });
        }
        
        // Check if user is active
        if (user.status !== 'active') {
            logger.auth('Login failed - user inactive', { userId: user._id, email });
            return res.status(401).json({ 
                message: 'Account is inactive' 
            });
        }
        
        // Check password
        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            logger.auth('Login failed - invalid password', { userId: user._id, email });
            return res.status(401).json({ 
                message: 'Invalid email or password' 
            });
        }
        
        // Update last login
        user.lastLogin = new Date();
        await user.save();
        
        // Create single session (kills all existing sessions)
        const deviceInfo = {
            userAgent: req.headers['user-agent'],
            ipAddress: req.ip || req.connection.remoteAddress,
            location: req.headers['cf-ipcountry'] || 'Unknown'
        };
        
        const sessionResult = sessionManager.createSession(user._id.toString(), deviceInfo);
        
        // Log successful login with session info
        logger.auth('Login successful - new session created', { 
            userId: user._id, 
            email: user.email, 
            role: user.role,
            sessionId: sessionResult.sessionId,
            location: deviceInfo.location
        });
        
        res.json({
            success: true,
            message: 'Login successful - all other sessions terminated',
            token: sessionResult.token,
            sessionId: sessionResult.sessionId,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                role: user.role,
                lastLogin: user.lastLogin,
                companyId: user.companyId
            }
        });
        
    } catch (err) {
        logger.error('Login error:', err);
        res.status(500).json({ 
            message: 'Server error during login',
            error: err.message 
        });
    }
});

/**
 * GET /api/auth/me - Get current user profile
 */
router.get('/me', authenticateJWT, async (req, res) => {
    try {
        res.json({
            success: true,
            user: {
                id: req.user._id,
                email: req.user.email,
                name: req.user.name,
                role: req.user.role,
                lastLogin: req.user.lastLogin,
                companyId: req.user.companyId
            }
        });
    } catch (err) {
        logger.error('Profile fetch error:', err);
        res.status(500).json({ 
            message: 'Server error fetching profile',
            error: err.message 
        });
    }
});

/**
 * POST /api/auth/logout - Logout user (client-side token removal)
 */
router.post('/logout', authenticateSingleSession, async (req, res) => {
    try {
        const sessionId = req.sessionInfo?.sessionId;
        
        if (sessionId) {
            // Kill the specific session
            sessionManager.activeSessions.delete(sessionId);
            
            logger.auth('User logged out - session terminated', {
                userId: req.user._id,
                sessionId: sessionId
            });
        }

        res.json({
            success: true,
            message: 'Logged out successfully - session terminated'
        });

    } catch (error) {
        logger.error('Logout error:', error);
        res.status(500).json({ message: 'Logout failed' });
    }
});

/**
 * Google OAuth Routes
 */

// Middleware to check if Google OAuth is configured
const requireGoogleOAuth = (req, res, next) => {
    const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    if (!googleConfigured) {
        return res.status(503).json({
            error: 'Google OAuth not configured',
            message: 'Google OAuth is not available. Please contact administrator.'
        });
    }
    next();
};

/**
 * GET /api/auth/google - Initiate Google OAuth flow
 */
router.get('/google', requireGoogleOAuth,
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

/**
 * GET /api/auth/google/callback - Handle Google OAuth callback
 */
router.get('/google/callback', requireGoogleOAuth,
    passport.authenticate('google', { failureRedirect: '/login.html?error=oauth_failed' }),
    async (req, res) => {
        try {
            const user = req.user;
            
            // Generate JWT token for the authenticated user
            const token = jwt.sign(
                { 
                    userId: user._id, 
                    email: user.email, 
                    role: user.role 
                },
                process.env.JWT_SECRET,
                { expiresIn: '24h' }
            );
            
            // Log successful OAuth login
            logger.auth('Google OAuth login successful', { 
                userId: user._id, 
                email: user.email, 
                role: user.role,
                method: 'google_oauth'
            });
            
            // Set JWT token as cookie for frontend
            res.cookie('authToken', token, {
                httpOnly: true,
                secure: process.env.NODE_ENV === 'production',
                sameSite: 'strict',
                maxAge: 24 * 60 * 60 * 1000 // 24 hours
            });
            
            // Redirect to dashboard
            res.redirect('/index.html?auth=success');
            
        } catch (err) {
            logger.error('Google OAuth callback error:', err);
            res.redirect('/login.html?error=oauth_error');
        }
    }
);

/**
 * GET /api/auth/google/status - Check Google OAuth configuration
 */
router.get('/google/status', (req, res) => {
    const googleConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
    
    res.json({
        googleOAuthEnabled: googleConfigured,
        message: googleConfigured ? 
            'Google OAuth is configured and available' : 
            'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.'
    });
});

/**
 * Emergency bypass routes for server-level access
 * Only accessible from localhost with master key
 */

// Emergency bypass login (server access only)
router.post('/emergency-bypass', async (req, res) => {
    try {
        // Only allow from localhost
        const clientIP = req.ip || req.connection.remoteAddress;
        if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(clientIP)) {
            return res.status(403).json({ message: 'Emergency bypass only available from localhost' });
        }

        const { masterKey, userId } = req.body;
        
        if (masterKey !== process.env.EMERGENCY_BYPASS_KEY) {
            return res.status(403).json({ message: 'Invalid master key' });
        }

        // Generate emergency bypass token
        const bypassToken = sessionManager.emergencyBypass(userId);
        
        logger.auth('🚨 EMERGENCY BYPASS activated', { 
            userId, 
            clientIP,
            timestamp: new Date()
        });

        res.json({
            success: true,
            message: 'Emergency bypass granted',
            token: bypassToken,
            warning: 'This token expires in 1 hour'
        });

    } catch (error) {
        logger.error('Emergency bypass error:', error);
        res.status(500).json({ message: 'Emergency bypass failed' });
    }
});

// Get active sessions (admin only)
router.get('/sessions', authenticateSingleSession, async (req, res) => {
    try {
        if (req.user.role !== 'admin' && !req.user.emergency) {
            return res.status(403).json({ message: 'Admin access required' });
        }

        const sessions = sessionManager.getAllActiveSessions();
        res.json({
            success: true,
            activeSessions: sessions,
            totalSessions: sessions.length
        });

    } catch (error) {
        console.error('Get sessions error:', error);
        res.status(500).json({ error: 'Failed to get active sessions' });
    }
});

// Kill all sessions (emergency use)
router.post('/kill-all-sessions', authenticateSingleSession, async (req, res) => {
    try {
        if (req.user.role !== 'admin' && !req.user.emergency) {
            return res.status(403).json({ message: 'Admin access required' });
        }

        const { userId } = req.body;
        const killedCount = sessionManager.killAllUserSessions(userId);

        logger.auth('🧹 All sessions killed by admin', { 
            adminId: req.user._id,
            targetUserId: userId,
            killedCount
        });

        res.json({
            success: true,
            message: `Killed ${killedCount} sessions for user ${userId}`,
            killedCount
        });

    } catch (error) {
        console.error('Kill sessions error:', error);
        res.status(500).json({ error: 'Failed to kill sessions' });
    }
});

// Token refresh endpoint
router.post('/refresh', async (req, res) => {
    try {
        const token = getTokenFromRequest(req);
        
        if (!token) {
            return res.status(401).json({ message: 'Token required for refresh' });
        }

        const refreshResult = sessionManager.refreshSession(token);
        
        if (!refreshResult.success) {
            return res.status(401).json({ message: refreshResult.error });
        }

        res.json({
            success: true,
            token: refreshResult.token,
            message: 'Token refreshed successfully'
        });

    } catch (error) {
        logger.error('Token refresh error:', error);
        res.status(500).json({ message: 'Token refresh failed' });
    }
});

module.exports = router;
