// ============================================================================
// SECURITY HEADERS MIDDLEWARE - Production Hardened
// ============================================================================
// Implements comprehensive security headers using Helmet
// Protects against: XSS, clickjacking, MIME sniffing, and more
// ============================================================================

const helmet = require('helmet');

// ============================================================================
// PRODUCTION SECURITY CONFIGURATION
// ============================================================================

const secureHeaders = helmet({
  // Content Security Policy (CSP) - Prevents XSS attacks
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "base-uri": ["'self'"],
      "font-src": ["'self'", "https:", "data:"],
      "form-action": ["'self'"],
      "frame-ancestors": ["'none'"], // Prevents clickjacking
      "img-src": ["'self'", "data:", "blob:", "https:"],
      "object-src": ["'none'"],
      "script-src": ["'self'"],
      "script-src-attr": ["'none'"],
      "style-src": ["'self'", "https:", "'unsafe-inline'"], // Allow inline styles for UI
      "upgrade-insecure-requests": [],
      "connect-src": ["'self'", "https://api.elevenlabs.io", "https://api.twilio.com"]
    }
  },

  // Referrer Policy - Controls referrer information
  referrerPolicy: { 
    policy: "strict-origin-when-cross-origin" 
  },

  // Cross-Origin Embedder Policy
  crossOriginEmbedderPolicy: {
    policy: "require-corp"
  },

  // Cross-Origin Resource Policy
  crossOriginResourcePolicy: { 
    policy: "same-origin" 
  },

  // Cross-Origin Opener Policy
  crossOriginOpenerPolicy: { 
    policy: "same-origin" 
  },

  // DNS Prefetch Control - Disable DNS prefetching
  dnsPrefetchControl: { 
    allow: false 
  },

  // Download Options - Force save for downloads
  ieNoOpen: true,

  // Frame Guard - Prevents clickjacking (redundant with CSP but good defense in depth)
  frameguard: { 
    action: 'deny' 
  },

  // HSTS - Force HTTPS
  strictTransportSecurity: { 
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },

  // Hide X-Powered-By header
  hidePoweredBy: true,

  // X-Content-Type-Options - Prevent MIME sniffing
  noSniff: true,

  // Origin-Agent-Cluster - Isolate origin
  originAgentCluster: true,

  // Permissions Policy (formerly Feature Policy)
  permittedCrossDomainPolicies: { 
    permittedPolicies: "none" 
  },

  // XSS Filter (legacy browsers)
  xssFilter: true
});

// ============================================================================
// ADDITIONAL CUSTOM HEADERS
// ============================================================================

const additionalSecurityHeaders = (req, res, next) => {
  // Permissions Policy - Control browser features
  res.setHeader('Permissions-Policy', 
    'geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), speaker=()'
  );

  // X-Permitted-Cross-Domain-Policies - Restrict cross-domain policies
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');

  // Expect-CT - Certificate Transparency
  res.setHeader('Expect-CT', 'max-age=86400, enforce');

  // X-Download-Options - Prevent file execution in context of site
  res.setHeader('X-Download-Options', 'noopen');

  // Custom security identifier
  res.setHeader('X-Security-Level', 'production-hardened');

  next();
};

// ============================================================================
// RATE LIMIT RESPONSE HEADERS
// ============================================================================

const addRateLimitHeaders = (req, res, next) => {
  // These will be overwritten by actual rate limiter, but provide defaults
  if (!res.getHeader('RateLimit-Limit')) {
    res.setHeader('RateLimit-Limit', '100');
    res.setHeader('RateLimit-Remaining', '100');
    res.setHeader('RateLimit-Reset', new Date(Date.now() + 60000).toISOString());
  }
  next();
};

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = { 
  secureHeaders,
  additionalSecurityHeaders,
  addRateLimitHeaders
};
