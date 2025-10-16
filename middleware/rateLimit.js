const rateLimit = require('express-rate-limit');

// ============================================================================
// TIERED RATE LIMITING - PRODUCTION SECURITY
// ============================================================================

// Standard API rate limit (for public/unauthenticated endpoints)
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 50, // 50 requests per minute per IP (reduced from 100)
  standardHeaders: true,
  legacyHeaders: false,
  message: { 
    success: false,
    message: "Too many requests from this IP. Please try again in a minute.",
    retryAfter: 60
  },
  // Skip rate limiting for health checks
  skip: (req) => req.path === '/health' || req.path === '/healthz'
});

// Authenticated API rate limit (higher limit for logged-in users)
const authenticatedApiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 200, // 200 requests per minute for authenticated users
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Rate limit exceeded. Please slow down your requests.",
    retryAfter: 60
  },
  // Key by user ID instead of IP for authenticated requests
  keyGenerator: (req) => {
    return req.user?.id || req.ip;
  }
});

// Strict rate limit for sensitive operations (auth, admin)
const strictLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 requests per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many attempts. Please try again later.",
    retryAfter: 900
  }
});

// Twilio webhook rate limit (allow high traffic from Twilio)
const twilioWebhookLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 500, // 500 requests per minute (Twilio can be chatty)
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Webhook rate limit exceeded",
    retryAfter: 60
  },
  // Skip rate limiting for known Twilio IPs (optional enhancement)
  skip: (req) => {
    // Twilio's IP ranges - this is a simplified check
    // In production, maintain a list of Twilio IP ranges
    const twilioUserAgent = req.headers['user-agent'];
    return twilioUserAgent && twilioUserAgent.includes('TwilioProxy');
  }
});

module.exports = { 
  apiLimiter,
  authenticatedApiLimiter,
  strictLimiter,
  twilioWebhookLimiter
};
