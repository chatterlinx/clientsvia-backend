const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');
const Company = require('../models/Company');

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user._id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id).populate('companyId');
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Google OAuth Strategy
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  callbackURL: process.env.GOOGLE_CALLBACK_URL || "/api/auth/google/callback"
}, async (accessToken, refreshToken, profile, done) => {
  try {
    const email = profile.emails[0].value;
    const domain = email.split('@')[1];
    
    // Check if user already exists
    let user = await User.findOne({ 
      $or: [
        { googleId: profile.id },
        { email: email }
      ]
    });

    if (user) {
      // Update existing user
      user.googleId = profile.id;
      user.name = profile.displayName;
      user.avatar = profile.photos[0]?.value;
      user.lastLogin = new Date();
      await user.save();
      return done(null, user);
    }

    // Multi-tenant logic: Check if domain is allowed
    const allowedDomains = process.env.ALLOWED_DOMAINS ? 
      process.env.ALLOWED_DOMAINS.split(',').map(d => d.trim()) : [];
    
    // Admin email whitelist for Google OAuth
    const adminEmails = process.env.ADMIN_GOOGLE_EMAILS ? 
      process.env.ADMIN_GOOGLE_EMAILS.split(',').map(e => e.trim().toLowerCase()) : [];
    
    // Check if this is an admin login attempt
    const isAdminAttempt = adminEmails.length > 0 && adminEmails.includes(email.toLowerCase());
    
    if (allowedDomains.length > 0 && !allowedDomains.includes(domain) && !isAdminAttempt) {
      return done(new Error(`Domain ${domain} is not authorized for this application`), null);
    }
    
    // For admin users, check email whitelist
    if (isAdminAttempt) {
      // This is an authorized admin - create/update with admin role
      if (user) {
        user.googleId = profile.id;
        user.name = profile.displayName;
        user.avatar = profile.photos[0]?.value;
        user.role = 'admin'; // Ensure admin role
        user.lastLogin = new Date();
        await user.save();
        return done(null, user);
      }
      
      // Create new admin user
      user = new User({
        googleId: profile.id,
        email: email,
        name: profile.displayName,
        avatar: profile.photos[0]?.value,
        role: 'admin', // Set admin role
        allowedDomains: [domain],
        lastLogin: new Date()
      });
      
      await user.save();
      return done(null, user);
    }

    // Try to find associated company by domain
    let company = null;
    if (domain) {
      company = await Company.findOne({ 
        $or: [
          { 'contact.email': { $regex: `@${domain}$`, $options: 'i' } },
          { 'allowedDomains': domain }
        ]
      });
    }

    // Create new user
    user = new User({
      googleId: profile.id,
      email: email,
      name: profile.displayName,
      avatar: profile.photos[0]?.value,
      companyId: company ? company._id : null,
      allowedDomains: [domain],
      lastLogin: new Date()
    });

    await user.save();
    return done(null, user);

  } catch (error) {
    console.error('Google OAuth error:', error);
    return done(error, null);
  }
}));

module.exports = passport;
