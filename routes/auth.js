const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const passport = require('../config/passport');
const User = require('../models/User');
let Joi;
try {
  Joi = require('joi');
} catch (err) {
  Joi = require('../lib/joi');
}
const { validateBody } = require('../middleware/validate');
const { auditLog } = require('../middleware/audit');
const { authenticateSession } = require('../middleware/auth');
const router = express.Router();

// Placeholder user store
const users = [];

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required()
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required()
});

async function register(req, res) {
  const { email, password } = req.body;
  const hash = await bcrypt.hash(password, 12);
  users.push({ email, password: hash, role: 'admin' });
  auditLog('register', req);
  res.json({ message: 'registered' });
}

router.post('/register', validateBody(registerSchema), register);

async function login(req, res) {
  const { email, password } = req.body;
  const user = users.find(u => u.email === email);
  if (!user) return res.status(401).json({ message: 'Unauthorized' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(401).json({ message: 'Unauthorized' });
  const token = jwt.sign({ email: user.email, role: user.role }, process.env.JWT_SECRET, { expiresIn: '1h' });
  res.cookie('token', token, { httpOnly: true, sameSite: 'strict', secure: true });
  auditLog('login', req);
  res.json({ token });
}

router.post('/login', validateBody(loginSchema), login);

// Google OAuth Routes
router.get('/google', 
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get('/google/callback', 
  passport.authenticate('google', { failureRedirect: '/login' }),
  async (req, res) => {
    try {
      // Generate JWT for the authenticated user
      const token = jwt.sign(
        { userId: req.user._id, email: req.user.email, role: req.user.role },
        process.env.JWT_SECRET,
        { expiresIn: '24h' }
      );

      // Set JWT in httpOnly cookie
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });

      // Update last login
      req.user.lastLogin = new Date();
      await req.user.save();

      auditLog('google_login', req);

      // Redirect to dashboard
      const dashboardUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
      res.redirect(`${dashboardUrl}/dashboard`);
    } catch (error) {
      console.error('Google auth callback error:', error);
      res.redirect('/login?error=auth_failed');
    }
  }
);

// Get current user profile
router.get('/profile', authenticateSession, async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('companyId')
      .select('-googleId');
    
    res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatar: user.avatar,
        role: user.role,
        company: user.companyId,
        lastLogin: user.lastLogin
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Error fetching profile' });
  }
});

// Logout
router.post('/logout', (req, res) => {
  req.logout((err) => {
    if (err) {
      return res.status(500).json({ message: 'Error logging out' });
    }
    res.clearCookie('token');
    res.json({ message: 'Logged out successfully' });
  });
});

module.exports = router;
