/**
 * Test Configuration for ClientsVia Enterprise Testing Suite
 * 
 * Centralized configuration for all test environments and scenarios
 */

const config = {
  // Base configuration
  baseUrl: process.env.TEST_BASE_URL || 'http://localhost:3000',
  timeout: parseInt(process.env.TEST_TIMEOUT) || 10000,
  retries: parseInt(process.env.TEST_RETRIES) || 3,
  
  // Test environment settings
  environment: {
    development: {
      apiUrl: 'http://localhost:3000',
      useAuth: false,
      useMockData: true,
      logLevel: 'debug'
    },
    integration: {
      apiUrl: 'http://localhost:3000',
      useAuth: true,
      useMockData: false,
      logLevel: 'info'
    },
    production: {
      apiUrl: process.env.PRODUCTION_URL || 'https://api.clientsvia.com',
      useAuth: true,
      useMockData: false,
      logLevel: 'error'
    }
  },
  
  // Test data configuration
  testData: {
    companyId: process.env.TEST_COMPANY_ID || '507f1f77bcf86cd799439011',
    userId: process.env.TEST_USER_ID || '507f1f77bcf86cd799439012',
    testEmail: 'test@clientsvia.com',
    testPhone: '+1234567890'
  },
  
  // Performance benchmarks
  performance: {
    maxApiResponseTime: 2000, // 2 seconds
    maxFrontendLoadTime: 3000, // 3 seconds
    maxDbQueryTime: 500, // 500ms
    maxTestSuiteTime: 300000 // 5 minutes
  },
  
  // Feature flags for testing
  features: {
    analytics: true,
    abTesting: true,
    personalization: true,
    flowDesigner: true,
    realTimeUpdates: true,
    exportFunctionality: true
  },
  
  // Test endpoints
  endpoints: {
    // Unauthenticated test endpoints
    health: '/api/ai-agent-logic/test/health',
    analytics: '/api/ai-agent-logic/test/analytics',
    
    // Authenticated endpoints
    save: '/api/ai-agent-logic/save',
    abTesting: '/api/ai-agent-logic/ab-testing',
    personalization: '/api/ai-agent-logic/personalization',
    flowDesigner: '/api/ai-agent-logic/flow-designer',
    analyticsExport: '/api/ai-agent-logic/analytics/export'
  },
  
  // Authentication configuration
  auth: {
    testToken: process.env.TEST_AUTH_TOKEN,
    testSession: process.env.TEST_SESSION_ID,
    mockUser: {
      id: '507f1f77bcf86cd799439012',
      email: 'test@clientsvia.com',
      role: 'admin'
    }
  },
  
  // Database configuration
  database: {
    testDbUrl: process.env.TEST_DB_URL || 'mongodb://localhost:27017/clientsvia_test',
    collections: {
      companies: 'companies',
      users: 'users',
      sessions: 'sessions',
      analytics: 'analytics'
    }
  }
};

module.exports = config;
