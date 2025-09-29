const passport = require('passport');
// V2 DELETED: Google OAuth authentication - using JWT-only system
// GoogleStrategy import completely eliminated from V2 system
const User = require('../models/v2User');
const Company = require('../models/v2Company');

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

// V2 DELETED: Google OAuth Strategy - using JWT-only authentication system
// Google OAuth authentication eliminated - V2 uses pure JWT authentication
// All Google OAuth functionality has been removed from the V2 system

module.exports = passport;
