// ============================================================================
// ENVIRONMENT VARIABLE VALIDATION - PRODUCTION SAFETY
// ============================================================================
// Purpose: Validate all required environment variables on server startup
// Prevents deployment with missing or invalid configuration
// ============================================================================

const logger = require('./logger');


/**
 * Validate all required environment variables
 * @throws {Error} If any required variable is missing or invalid
 */
function validateEnvironment() {
  logger.debug('[ENV VALIDATION] 🔍 Starting environment variable validation...');
  
  const errors = [];
  const warnings = [];
  
  // ============================================================================
  // CRITICAL VARIABLES - Server will not start without these
  // ============================================================================
  
  const criticalVars = {
    MONGODB_URI: {
      validator: (val) => val && (val.startsWith('mongodb://') || val.startsWith('mongodb+srv://')),
      message: 'Must be a valid MongoDB connection string'
    },
    JWT_SECRET: {
      validator: (val) => val && val.length >= 32,
      message: 'Must be at least 32 characters for security'
    },
    SESSION_SECRET: {
      validator: (val) => val && val.length >= 32,
      message: 'Must be at least 32 characters for security'
    },
    NODE_ENV: {
      validator: (val) => ['development', 'staging', 'production'].includes(val),
      message: 'Must be one of: development, staging, production'
    }
  };
  
  // Validate critical variables
  for (const [varName, config] of Object.entries(criticalVars)) {
    const value = process.env[varName];
    
    if (!value) {
      errors.push(`❌ CRITICAL: ${varName} is not set`);
    } else if (config.validator && !config.validator(value)) {
      errors.push(`❌ CRITICAL: ${varName} is invalid - ${config.message}`);
    } else {
      logger.info(`✅ ${varName} validated`);
    }
  }
  
  // ============================================================================
  // IMPORTANT VARIABLES - Server will start but with degraded functionality
  // ============================================================================
  
  const importantVars = {
    REDIS_URL: {
      validator: (val) => !val || val.startsWith('redis://') || val.startsWith('rediss://'),
      message: 'Must be a valid Redis connection string (redis:// or rediss://)',
      fallback: 'Redis caching will be disabled'
    },
    TWILIO_ACCOUNT_SID: {
      validator: (val) => !val || (val.length >= 30 && val.startsWith('AC')),
      message: 'Must be a valid Twilio Account SID (starts with AC)',
      fallback: 'Phone calls will not work'
    },
    TWILIO_AUTH_TOKEN: {
      validator: (val) => !val || val.length >= 30,
      message: 'Must be a valid Twilio Auth Token',
      fallback: 'Phone calls will not work'
    },
    ELEVENLABS_API_KEY: {
      validator: (val) => !val || val.length >= 20,
      message: 'Must be a valid ElevenLabs API key',
      fallback: 'Voice synthesis will not work'
    },
    SENDGRID_API_KEY: {
      validator: (val) => !val || (val.startsWith('SG.') && val.length >= 50),
      message: 'Must be a valid SendGrid API key (starts with SG.)',
      fallback: 'Email notifications will not work'
    }
  };
  
  // Validate important variables
  for (const [varName, config] of Object.entries(importantVars)) {
    const value = process.env[varName];
    
    if (!value) {
      warnings.push(`⚠️  ${varName} is not set - ${config.fallback}`);
    } else if (config.validator && !config.validator(value)) {
      warnings.push(`⚠️  ${varName} is invalid - ${config.message}`);
    } else {
      logger.info(`✅ ${varName} validated`);
    }
  }
  
  // ============================================================================
  // SECURITY CHECKS
  // ============================================================================
  
  // Check for insecure SKIP_AUTH in production
  if (process.env.NODE_ENV === 'production') {
    if (process.env.SKIP_AUTH === 'true') {
      errors.push('❌ CRITICAL SECURITY: SKIP_AUTH is enabled in production! This bypasses all authentication.');
    }
    
    // Verify secure cookies in production
    if (process.env.COOKIE_SECURE !== 'true' && process.env.COOKIE_SECURE !== undefined) {
      warnings.push('⚠️  COOKIE_SECURE should be "true" in production');
    }
  }
  
  // Check for default/weak secrets
  const weakSecrets = ['secret', 'password', 'changeme', '12345', 'test'];
  const jwtSecret = (process.env.JWT_SECRET || '').toLowerCase();
  const sessionSecret = (process.env.SESSION_SECRET || '').toLowerCase();
  
  if (weakSecrets.some(weak => jwtSecret.includes(weak))) {
    errors.push('❌ CRITICAL SECURITY: JWT_SECRET contains a weak/default value');
  }
  
  if (weakSecrets.some(weak => sessionSecret.includes(weak))) {
    errors.push('❌ CRITICAL SECURITY: SESSION_SECRET contains a weak/default value');
  }
  
  // ============================================================================
  // REDIS CONFIGURATION CHECK (REDIS_URL ONLY - no HOST/PORT fallback)
  // ============================================================================
  
  if (!process.env.REDIS_URL) {
    warnings.push('⚠️  REDIS_URL is not set - Redis caching will be disabled');
  } else {
    logger.debug('✅ REDIS_URL configured');
  }
  
  // Warn if deprecated Redis env vars still exist
  if (process.env.REDIS_HOST) {
    warnings.push('⚠️  REDIS_HOST is deprecated - use REDIS_URL only. Delete REDIS_HOST from environment.');
  }
  if (process.env.REDIS_PORT) {
    warnings.push('⚠️  REDIS_PORT is deprecated - use REDIS_URL only. Delete REDIS_PORT from environment.');
  }
  if (process.env.REDIS_PASSWORD) {
    warnings.push('⚠️  REDIS_PASSWORD is deprecated - use REDIS_URL only. Delete REDIS_PASSWORD from environment.');
  }
  
  // ============================================================================
  // SENTRY CONFIGURATION CHECK
  // ============================================================================
  
  if (!process.env.SENTRY_DSN) {
    warnings.push('⚠️  SENTRY_DSN is not set - Error monitoring will be disabled');
  } else {
    logger.debug('✅ Sentry error monitoring configured');
  }
  
  // ============================================================================
  // REPORT RESULTS
  // ============================================================================
  
  logger.info(`\n${  '='.repeat(80)}`);
  logger.info('ENVIRONMENT VALIDATION RESULTS');
  logger.info('='.repeat(80));
  
  if (errors.length === 0 && warnings.length === 0) {
    logger.info('✅ All environment variables validated successfully!');
    logger.info('🚀 Server is ready for production deployment');
  } else {
    if (warnings.length > 0) {
      logger.info('\n⚠️  WARNINGS:');
      warnings.forEach(warning => logger.info(`   ${warning}`));
    }
    
    if (errors.length > 0) {
      logger.info('\n❌ CRITICAL ERRORS:');
      errors.forEach(error => logger.info(`   ${error}`));
    }
  }
  
  logger.info(`${'='.repeat(80)  }\n`);
  
  // ============================================================================
  // THROW ERROR IF CRITICAL ISSUES FOUND
  // ============================================================================
  
  if (errors.length > 0) {
    const errorMessage = `Environment validation failed with ${errors.length} critical error(s). Server startup aborted.`;
    
    // Log to file if logger is available
    if (logger && logger.error) {
      logger.error(errorMessage, { errors, warnings });
    }
    
    throw new Error(`${errorMessage  }\n\nPlease fix the errors above and restart the server.\nSee env.example for configuration details.`);
  }
  
  // Log warnings to file
  if (warnings.length > 0 && logger && logger.warn) {
    logger.warn(`Environment validation completed with ${warnings.length} warning(s)`, { warnings });
  }
  
  return {
    success: true,
    errors,
    warnings
  };
}

/**
 * Get environment configuration summary (safe for logging)
 * Masks sensitive values
 */
function getEnvironmentSummary() {
  const maskValue = (value) => {
    if (!value) {return '[NOT SET]';}
    if (value.length <= 4) {return '****';}
    return `${value.substring(0, 4)}...${value.substring(value.length - 4)}`;
  };
  
  return {
    NODE_ENV: process.env.NODE_ENV || '[NOT SET]',
    PORT: process.env.PORT || '[NOT SET]',
    MONGODB_URI: process.env.MONGODB_URI ? maskValue(process.env.MONGODB_URI) : '[NOT SET]',
    REDIS_URL: process.env.REDIS_URL ? maskValue(process.env.REDIS_URL) : '[NOT SET]',
    JWT_SECRET: process.env.JWT_SECRET ? '[CONFIGURED]' : '[NOT SET]',
    SESSION_SECRET: process.env.SESSION_SECRET ? '[CONFIGURED]' : '[NOT SET]',
    TWILIO_ACCOUNT_SID: process.env.TWILIO_ACCOUNT_SID ? maskValue(process.env.TWILIO_ACCOUNT_SID) : '[NOT SET]',
    ELEVENLABS_API_KEY: process.env.ELEVENLABS_API_KEY ? '[CONFIGURED]' : '[NOT SET]',
    SENDGRID_API_KEY: process.env.SENDGRID_API_KEY ? '[CONFIGURED]' : '[NOT SET]',
    SENTRY_DSN: process.env.SENTRY_DSN ? '[CONFIGURED]' : '[NOT SET]',
    SKIP_AUTH: process.env.SKIP_AUTH || 'false'
  };
}

module.exports = {
  validateEnvironment,
  getEnvironmentSummary
};

