const Sentry = require('@sentry/node');
const logger = require('./logger.js');

// ✅ PRODUCTION FIX: ProfilingIntegration disabled for compatibility
// const { ProfilingIntegration } = require('@sentry/profiling-node');

// Initialize Sentry for error monitoring and performance tracking
function initializeSentry() {
  // Only initialize Sentry if DSN is provided
  if (!process.env.SENTRY_DSN) {
    logger.warn('⚠️  SENTRY_DSN not configured. Error monitoring disabled.');
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    
    // Environment configuration
    environment: process.env.NODE_ENV || 'development',
    
    // Performance monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    profilesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    
    // ✅ PRODUCTION FIX: Simplified integrations for compatibility
    integrations: [
      // Basic integrations that are always available
      // Express and Http integrations disabled for compatibility
    ],
    
    // Configure which errors to capture
    beforeSend(event, hint) {
      // Don't send client-side errors (4xx) to Sentry unless they're security-related
      if (event.request?.url && event.tags?.status_code) {
        const statusCode = parseInt(event.tags.status_code);
        if (statusCode >= 400 && statusCode < 500) {
          // Only capture security-related 4xx errors
          const securityPaths = ['/api/companies', '/api/alerts', '/api/suggestions'];
          const isSecurityEndpoint = securityPaths.some(path => 
            event.request.url.includes(path)
          );
          if (!isSecurityEndpoint) {
            return null; // Don't send to Sentry
          }
        }
      }
      
      return event;
    },
    
    // Set initial tags
    initialScope: {
      tags: {
        component: 'clientsvia-backend',
        platform: 'nodejs',
        multi_tenant: true
      }
    }
  });

  logger.debug('✅ Sentry error monitoring initialized');
}

// Middleware to capture Express requests
function getSentryRequestHandler() {
  if (!process.env.SENTRY_DSN) {
    return (req, res, next) => next(); // No-op if Sentry not configured
  }
  return Sentry.Handlers.requestHandler();
}

// Middleware to capture Express errors
function getSentryErrorHandler() {
  if (!process.env.SENTRY_DSN) {
    return (error, req, res, next) => next(error); // No-op if Sentry not configured
  }
  return Sentry.Handlers.errorHandler();
}

// Helper function to capture custom errors with context
function captureError(error, context = {}) {
  if (!process.env.SENTRY_DSN) {
    logger.error('Error (Sentry disabled):', error);
    return;
  }

  Sentry.withScope((scope) => {
    // Add context information
    if (context.companyId) {
      scope.setTag('company_id', context.companyId);
      scope.setContext('company', { id: context.companyId });
    }
    
    if (context.userId) {
      scope.setUser({ id: context.userId });
    }
    
    if (context.endpoint) {
      scope.setTag('endpoint', context.endpoint);
    }
    
    if (context.operation) {
      scope.setTag('operation', context.operation);
    }
    
    // Add extra data
    if (context.extra) {
      Object.keys(context.extra).forEach(key => {
        scope.setExtra(key, context.extra[key]);
      });
    }
    
    scope.setLevel('error');
    Sentry.captureException(error);
  });
}

// Helper function to capture custom messages/warnings
function captureMessage(message, level = 'info', context = {}) {
  if (!process.env.SENTRY_DSN) {
    logger.debug(`Message (Sentry disabled) [${level}]:`, message);
    return;
  }

  Sentry.withScope((scope) => {
    if (context.companyId) {
      scope.setTag('company_id', context.companyId);
    }
    
    if (context.endpoint) {
      scope.setTag('endpoint', context.endpoint);
    }
    
    scope.setLevel(level);
    Sentry.captureMessage(message);
  });
}

// Security-specific error capture
function captureSecurityEvent(event, details = {}) {
  if (!process.env.SENTRY_DSN) {
    // Don't log here - the caller (logger.security) already logged it
    // This prevents duplicate log entries
    return;
  }

  Sentry.withScope((scope) => {
    scope.setTag('security_event', true);
    scope.setTag('event_type', event);
    scope.setLevel('warning');
    
    scope.setContext('security_details', details);
    
    Sentry.captureMessage(`Security Event: ${event}`, 'warning');
  });
}

module.exports = {
  initializeSentry,
  getSentryRequestHandler,
  getSentryErrorHandler,
  captureError,
  captureMessage,
  captureSecurityEvent,
  Sentry
};
