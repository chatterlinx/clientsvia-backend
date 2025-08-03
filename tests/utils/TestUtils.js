/**
 * Test Utilities for ClientsVia Enterprise Testing Suite
 * 
 * Common testing functions and helpers
 */

const config = require('../config/test.config');
const mockData = require('../config/mock-data');

class TestUtils {
  /**
   * Make HTTP request with timeout and retries
   */
  static async makeRequest(url, options = {}) {
    const defaultOptions = {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      timeout: config.timeout,
      ...options
    };

    for (let attempt = 1; attempt <= config.retries; attempt++) {
      try {
        const response = await fetch(url, defaultOptions);
        const data = await response.json();
        
        return {
          status: response.status,
          ok: response.ok,
          data,
          headers: response.headers
        };
      } catch (error) {
        if (attempt === config.retries) {
          throw new Error(`Request failed after ${config.retries} attempts: ${error.message}`);
        }
        await this.sleep(1000 * attempt); // Exponential backoff
      }
    }
  }

  /**
   * Sleep for specified milliseconds
   */
  static sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Assert conditions with custom messages
   */
  static assert(condition, message) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  /**
   * Assert API response structure
   */
  static assertApiResponse(response, expectedStatus = 200) {
    this.assert(response.status === expectedStatus, 
      `Expected status ${expectedStatus}, got ${response.status}`);
    this.assert(response.data, 'Response should have data');
  }

  /**
   * Assert performance benchmarks
   */
  static assertPerformance(duration, maxDuration, operation) {
    this.assert(duration <= maxDuration, 
      `${operation} took ${duration}ms, expected <= ${maxDuration}ms`);
  }

  /**
   * Generate test report
   */
  static generateReport(testResults) {
    const totalTests = testResults.length;
    const passedTests = testResults.filter(r => r.passed).length;
    const failedTests = totalTests - passedTests;
    const successRate = (passedTests / totalTests * 100).toFixed(2);

    const report = {
      summary: {
        total: totalTests,
        passed: passedTests,
        failed: failedTests,
        successRate: `${successRate}%`,
        executionTime: testResults.reduce((sum, r) => sum + r.duration, 0)
      },
      details: testResults,
      timestamp: new Date().toISOString()
    };

    return report;
  }

  /**
   * Log test results with colors
   */
  static logTestResult(testName, passed, duration, error = null) {
    const status = passed ? '✅ PASS' : '❌ FAIL';
    const time = `(${duration}ms)`;
    
    console.log(`${status} ${testName} ${time}`);
    
    if (error) {
      console.log(`   Error: ${error.message}`);
    }
  }

  /**
   * Validate data structure
   */
  static validateStructure(data, expectedStructure, path = '') {
    for (const [key, expectedType] of Object.entries(expectedStructure)) {
      const currentPath = path ? `${path}.${key}` : key;
      
      if (!(key in data)) {
        throw new Error(`Missing property: ${currentPath}`);
      }
      
      const actualType = typeof data[key];
      
      if (expectedType === 'array' && !Array.isArray(data[key])) {
        throw new Error(`Expected array at ${currentPath}, got ${actualType}`);
      } else if (expectedType === 'object' && (actualType !== 'object' || data[key] === null)) {
        throw new Error(`Expected object at ${currentPath}, got ${actualType}`);
      } else if (typeof expectedType === 'string' && actualType !== expectedType) {
        throw new Error(`Expected ${expectedType} at ${currentPath}, got ${actualType}`);
      } else if (typeof expectedType === 'object' && expectedType !== null) {
        this.validateStructure(data[key], expectedType, currentPath);
      }
    }
  }

  /**
   * Mock authentication for testing
   */
  static mockAuth() {
    return {
      userId: config.testData.userId,
      token: config.auth.testToken || 'mock-token-12345',
      session: config.auth.testSession || 'mock-session-67890'
    };
  }

  /**
   * Clean test data
   */
  static async cleanTestData() {
    // This would clean up any test data from database
    // Implementation depends on your database setup
    console.log('🧹 Cleaning test data...');
  }

  /**
   * Setup test environment
   */
  static async setupTestEnvironment() {
    console.log('🔧 Setting up test environment...');
    
    // Check if server is running
    try {
      const response = await this.makeRequest(`${config.baseUrl}/health`);
      console.log('✅ Server is running');
    } catch (error) {
      console.warn('⚠️  Server might not be running:', error.message);
    }
  }

  /**
   * Generate random test data
   */
  static generateTestData(type) {
    const generators = {
      companyId: () => '507f1f77bcf86cd799439' + Math.random().toString().substr(2, 3),
      userId: () => '507f1f77bcf86cd799439' + Math.random().toString().substr(2, 3),
      email: () => `test${Date.now()}@example.com`,
      phone: () => `+1${Math.floor(Math.random() * 9000000000) + 1000000000}`,
      testName: () => `Test ${Date.now()}`,
      percentage: () => Math.floor(Math.random() * 100),
      timestamp: () => new Date().toISOString()
    };

    return generators[type] ? generators[type]() : null;
  }

  /**
   * Compare test results with baseline
   */
  static compareWithBaseline(currentResults, baselineResults) {
    const comparison = {
      performance: {
        improvement: currentResults.executionTime < baselineResults.executionTime,
        change: currentResults.executionTime - baselineResults.executionTime
      },
      reliability: {
        improvement: currentResults.successRate > baselineResults.successRate,
        change: currentResults.successRate - baselineResults.successRate
      }
    };

    return comparison;
  }
}

module.exports = TestUtils;
