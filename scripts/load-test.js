#!/usr/bin/env node

// ============================================================================
// LOAD TESTING SCRIPT - Production Validation
// ============================================================================
// Simulates production load to validate performance under stress
// Tests: API endpoints, database, Redis cache, AI routing
// ============================================================================

require('dotenv').config();
const axios = require('axios');
const mongoose = require('mongoose');

// Color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Base URL (default to localhost for testing)
  baseUrl: process.env.LOAD_TEST_URL || 'http://localhost:3000',
  
  // Load test parameters
  concurrentUsers: parseInt(process.env.LOAD_TEST_USERS || '50', 10),
  requestsPerUser: parseInt(process.env.LOAD_TEST_REQUESTS || '20', 10),
  rampUpTime: parseInt(process.env.LOAD_TEST_RAMPUP || '5000', 10), // ms
  
  // Test company ID (must exist in database)
  testCompanyId: process.env.LOAD_TEST_COMPANY_ID || null,
  
  // Performance thresholds
  thresholds: {
    avgResponseTime: 100, // ms
    maxResponseTime: 500, // ms
    errorRate: 0.05, // 5%
    successRate: 0.95 // 95%
  }
};

// ============================================================================
// METRICS COLLECTION
// ============================================================================

class MetricsCollector {
  constructor() {
    this.requests = [];
    this.errors = [];
    this.startTime = null;
    this.endTime = null;
  }

  recordRequest(endpoint, duration, status, success, error = null) {
    this.requests.push({
      endpoint,
      duration,
      status,
      success,
      error,
      timestamp: Date.now()
    });

    if (!success) {
      this.errors.push({ endpoint, error, timestamp: Date.now() });
    }
  }

  start() {
    this.startTime = Date.now();
  }

  end() {
    this.endTime = Date.now();
  }

  getStats() {
    const totalRequests = this.requests.length;
    const successfulRequests = this.requests.filter(r => r.success).length;
    const failedRequests = totalRequests - successfulRequests;
    
    const durations = this.requests.filter(r => r.success).map(r => r.duration);
    const avgResponseTime = durations.length > 0 
      ? durations.reduce((a, b) => a + b, 0) / durations.length 
      : 0;
    
    const maxResponseTime = durations.length > 0 ? Math.max(...durations) : 0;
    const minResponseTime = durations.length > 0 ? Math.min(...durations) : 0;
    
    const successRate = totalRequests > 0 ? successfulRequests / totalRequests : 0;
    const errorRate = totalRequests > 0 ? failedRequests / totalRequests : 0;
    
    const totalDuration = this.endTime - this.startTime;
    const requestsPerSecond = totalRequests / (totalDuration / 1000);

    return {
      totalRequests,
      successfulRequests,
      failedRequests,
      avgResponseTime,
      maxResponseTime,
      minResponseTime,
      successRate,
      errorRate,
      requestsPerSecond,
      totalDuration,
      errors: this.errors
    };
  }

  printReport() {
    const stats = this.getStats();

    console.log('\n' + colors.blue + '='.repeat(80) + colors.reset);
    console.log(colors.blue + 'LOAD TEST RESULTS' + colors.reset);
    console.log(colors.blue + '='.repeat(80) + colors.reset + '\n');

    console.log(`${colors.cyan}Total Requests:${colors.reset}       ${stats.totalRequests}`);
    console.log(`${colors.green}Successful:${colors.reset}           ${stats.successfulRequests} (${(stats.successRate * 100).toFixed(2)}%)`);
    console.log(`${colors.red}Failed:${colors.reset}               ${stats.failedRequests} (${(stats.errorRate * 100).toFixed(2)}%)`);
    console.log();
    console.log(`${colors.cyan}Response Times:${colors.reset}`);
    console.log(`  Average:              ${stats.avgResponseTime.toFixed(2)}ms`);
    console.log(`  Minimum:              ${stats.minResponseTime.toFixed(2)}ms`);
    console.log(`  Maximum:              ${stats.maxResponseTime.toFixed(2)}ms`);
    console.log();
    console.log(`${colors.cyan}Throughput:${colors.reset}`);
    console.log(`  Requests/second:      ${stats.requestsPerSecond.toFixed(2)}`);
    console.log(`  Total duration:       ${(stats.totalDuration / 1000).toFixed(2)}s`);
    console.log();

    // Performance evaluation
    console.log(colors.cyan + 'Performance Evaluation:' + colors.reset);
    
    const avgPass = stats.avgResponseTime <= CONFIG.thresholds.avgResponseTime;
    const maxPass = stats.maxResponseTime <= CONFIG.thresholds.maxResponseTime;
    const successPass = stats.successRate >= CONFIG.thresholds.successRate;
    const errorPass = stats.errorRate <= CONFIG.thresholds.errorRate;

    console.log(`  Avg response time:    ${avgPass ? colors.green + '✅ PASS' : colors.red + '❌ FAIL'} ${colors.reset}(${stats.avgResponseTime.toFixed(2)}ms / ${CONFIG.thresholds.avgResponseTime}ms threshold)`);
    console.log(`  Max response time:    ${maxPass ? colors.green + '✅ PASS' : colors.red + '❌ FAIL'} ${colors.reset}(${stats.maxResponseTime.toFixed(2)}ms / ${CONFIG.thresholds.maxResponseTime}ms threshold)`);
    console.log(`  Success rate:         ${successPass ? colors.green + '✅ PASS' : colors.red + '❌ FAIL'} ${colors.reset}(${(stats.successRate * 100).toFixed(2)}% / ${CONFIG.thresholds.successRate * 100}% threshold)`);
    console.log(`  Error rate:           ${errorPass ? colors.green + '✅ PASS' : colors.red + '❌ FAIL'} ${colors.reset}(${(stats.errorRate * 100).toFixed(2)}% / ${CONFIG.thresholds.errorRate * 100}% threshold)`);

    console.log();

    if (stats.errors.length > 0) {
      console.log(colors.red + 'Errors:' + colors.reset);
      const errorSummary = {};
      stats.errors.forEach(err => {
        const key = `${err.endpoint}: ${err.error}`;
        errorSummary[key] = (errorSummary[key] || 0) + 1;
      });
      Object.entries(errorSummary).forEach(([error, count]) => {
        console.log(`  ${count}x ${error}`);
      });
      console.log();
    }

    console.log(colors.blue + '='.repeat(80) + colors.reset + '\n');

    // Overall pass/fail
    const overallPass = avgPass && maxPass && successPass && errorPass;
    if (overallPass) {
      console.log(colors.green + '🎉 LOAD TEST PASSED - System ready for production!' + colors.reset + '\n');
      return true;
    } else {
      console.log(colors.red + '❌ LOAD TEST FAILED - Performance issues detected' + colors.reset + '\n');
      return false;
    }
  }
}

// ============================================================================
// TEST SCENARIOS
// ============================================================================

class LoadTester {
  constructor(config, metrics) {
    this.config = config;
    this.metrics = metrics;
  }

  async testHealthEndpoint() {
    const start = Date.now();
    try {
      const response = await axios.get(`${this.config.baseUrl}/health`, {
        timeout: 5000
      });
      const duration = Date.now() - start;
      
      this.metrics.recordRequest(
        '/health',
        duration,
        response.status,
        response.status === 200
      );
      
      return true;
    } catch (error) {
      const duration = Date.now() - start;
      this.metrics.recordRequest(
        '/health',
        duration,
        error.response?.status || 0,
        false,
        error.message
      );
      return false;
    }
  }

  async testCompanyEndpoint(companyId) {
    const start = Date.now();
    try {
      const response = await axios.get(
        `${this.config.baseUrl}/api/company/${companyId}`,
        { timeout: 5000 }
      );
      const duration = Date.now() - start;
      
      this.metrics.recordRequest(
        `/api/company/${companyId}`,
        duration,
        response.status,
        response.status === 200
      );
      
      return true;
    } catch (error) {
      const duration = Date.now() - start;
      this.metrics.recordRequest(
        `/api/company/${companyId}`,
        duration,
        error.response?.status || 0,
        false,
        error.message
      );
      return false;
    }
  }

  async runUserSimulation(userId, companyId) {
    console.log(`${colors.cyan}User ${userId}:${colors.reset} Starting simulation...`);
    
    const requests = this.config.requestsPerUser;
    let successCount = 0;

    for (let i = 0; i < requests; i++) {
      // Mix of different endpoints
      const endpointType = Math.random();
      
      let success;
      if (endpointType < 0.5) {
        // 50% health checks
        success = await this.testHealthEndpoint();
      } else {
        // 50% company data
        success = await this.testCompanyEndpoint(companyId);
      }

      if (success) successCount++;

      // Small random delay between requests (10-100ms)
      await new Promise(resolve => setTimeout(resolve, Math.random() * 90 + 10));
    }

    const successRate = (successCount / requests * 100).toFixed(2);
    console.log(`${colors.cyan}User ${userId}:${colors.reset} Completed ${successCount}/${requests} requests (${successRate}%)`);
  }

  async runLoadTest() {
    console.log(colors.yellow + '\nStarting load test...' + colors.reset);
    console.log(`Base URL: ${this.config.baseUrl}`);
    console.log(`Concurrent users: ${this.config.concurrentUsers}`);
    console.log(`Requests per user: ${this.config.requestsPerUser}`);
    console.log(`Ramp-up time: ${this.config.rampUpTime}ms\n`);

    // Get or create test company
    let companyId = this.config.testCompanyId;
    if (!companyId) {
      companyId = await this.createTestCompany();
    }

    if (!companyId) {
      throw new Error('No test company available');
    }

    console.log(`Using test company: ${companyId}\n`);

    this.metrics.start();

    // Ramp up users gradually
    const delayBetweenUsers = this.config.rampUpTime / this.config.concurrentUsers;
    const userPromises = [];

    for (let i = 0; i < this.config.concurrentUsers; i++) {
      // Start user simulation
      userPromises.push(this.runUserSimulation(i + 1, companyId));
      
      // Wait before starting next user
      if (i < this.config.concurrentUsers - 1) {
        await new Promise(resolve => setTimeout(resolve, delayBetweenUsers));
      }
    }

    // Wait for all users to complete
    await Promise.all(userPromises);

    this.metrics.end();

    return this.metrics.printReport();
  }

  async createTestCompany() {
    try {
      console.log(`${colors.yellow}Creating test company via API...${colors.reset}`);
      
      const response = await axios.post(
        `${this.config.baseUrl}/api/companies`,
        {
          companyName: `Load Test Company ${Date.now()}`,
          address: {
            street: '123 Test St',
            city: 'Test City',
            state: 'TS',
            zip: '12345',
            country: 'USA'
          }
        },
        { timeout: 10000 }
      );

      if (response.data && response.data._id) {
        console.log(`${colors.green}✅ Test company created: ${response.data._id}${colors.reset}`);
        return response.data._id;
      }
    } catch (error) {
      console.error(`${colors.red}Failed to create test company:${colors.reset}`, error.message);
    }

    return null;
  }
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log(colors.blue + '\n' + '='.repeat(80) + colors.reset);
  console.log(colors.blue + 'CLIENTSVIA LOAD TESTING TOOL' + colors.reset);
  console.log(colors.blue + '='.repeat(80) + colors.reset);

  // Validate configuration
  if (!CONFIG.baseUrl) {
    console.error(colors.red + 'Error: Base URL not configured' + colors.reset);
    process.exit(1);
  }

  // Test server availability
  try {
    console.log(`\n${colors.yellow}Testing server availability...${colors.reset}`);
    const healthCheck = await axios.get(`${CONFIG.baseUrl}/health`, { timeout: 5000 });
    console.log(`${colors.green}✅ Server is online${colors.reset}`);
    console.log(`${colors.cyan}Environment:${colors.reset} ${healthCheck.data.environment}`);
    console.log(`${colors.cyan}MongoDB:${colors.reset} ${healthCheck.data.services.mongodb.status}`);
    console.log(`${colors.cyan}Redis:${colors.reset} ${healthCheck.data.services.redis.status}`);
  } catch (error) {
    console.error(colors.red + `❌ Server unavailable: ${error.message}` + colors.reset);
    console.error(colors.yellow + 'Please ensure the server is running before load testing' + colors.reset);
    process.exit(1);
  }

  // Initialize metrics and tester
  const metrics = new MetricsCollector();
  const tester = new LoadTester(CONFIG, metrics);

  try {
    // Run load test
    const passed = await tester.runLoadTest();
    
    // Exit with appropriate code
    process.exit(passed ? 0 : 1);
    
  } catch (error) {
    console.error(colors.red + '\nLoad test failed with error:' + colors.reset);
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  main();
}

module.exports = { LoadTester, MetricsCollector };

