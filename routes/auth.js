const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const User = require('../models/User');
const { authenticateJWT } = require('../middleware/auth');
const logger = require('../utils/logger');
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
        
        // Generate JWT token
        const token = jwt.sign(
            { 
                userId: user._id, 
                email: user.email, 
                role: user.role 
            },
            process.env.JWT_SECRET,
            { expiresIn: '24h' }
        );
        
        // Log successful login
        logger.auth('Login successful', { 
            userId: user._id, 
            email: user.email, 
            role: user.role 
        });
        
        res.json({
            success: true,
            message: 'Login successful',
            token,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                role: user.role,
                lastLogin: user.lastLogin
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
router.post('/logout', authenticateJWT, async (req, res) => {
    try {
        // Log logout
        logger.auth('User logged out', { 
            userId: req.user._id, 
            email: req.user.email 
        });
        
        res.json({
            success: true,
            message: 'Logged out successfully'
        });
        
    } catch (err) {
        logger.error('Logout error:', err);
        res.status(500).json({ 
            message: 'Server error during logout',
            error: err.message 
        });
    }
});

/**
 * Google OAuth Routes
 */

/**
 * GET /api/auth/google - Initiate Google OAuth flow
 */
router.get('/google', 
    passport.authenticate('google', { scope: ['profile', 'email'] })
);

/**
 * GET /api/auth/google/callback - Handle Google OAuth callback
 */
router.get('/google/callback',
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

module.exports = router;
