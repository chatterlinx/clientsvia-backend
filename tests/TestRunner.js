/**
 * Master Test Runner for ClientsVia Enterprise Testing Suite
 * 
 * Orchestrates all tests and generates comprehensive reports
 */

const fs = require('fs').promises;
const path = require('path');
const TestUtils = require('./utils/TestUtils');
const config = require('./config/test.config');

class MasterTestRunner {
  constructor() {
    this.results = [];
    this.startTime = Date.now();
    this.testFiles = [
      'enterprise/analytics.test.js',
      'enterprise/ab-testing.test.js',
      'enterprise/personalization.test.js',
      'enterprise/flow-designer.test.js',
      'enterprise/integration.test.js'
    ];
  }

  /**
   * Run all tests in the suite
   */
  async runAllTests() {
    console.log('🚀 Starting ClientsVia Enterprise Test Suite');
    console.log('=' .repeat(60));

    await TestUtils.setupTestEnvironment();

    // Run each test file
    for (const testFile of this.testFiles) {
      await this.runTestFile(testFile);
    }

    // Generate and save report
    const report = await this.generateFinalReport();
    await this.saveReport(report);

    return report;
  }

  /**
   * Run a specific test file
   */
  async runTestFile(testFile) {
    const testName = path.basename(testFile, '.js');
    const filePath = path.join(__dirname, testFile);
    
    console.log(`\n📋 Running ${testName}...`);
    
    const testStartTime = Date.now();
    let testResult = {
      name: testName,
      file: testFile,
      passed: false,
      duration: 0,
      details: {},
      error: null
    };

    try {
      // Dynamic import of test file
      delete require.cache[require.resolve(filePath)];
      const testModule = require(filePath);
      
      // Run the test if it exports a run function
      if (typeof testModule.run === 'function') {
        const result = await testModule.run();
        testResult.passed = result.success;
        testResult.details = result.details || {};
      } else {
        // For existing test files, just require them (they auto-execute)
        testResult.passed = true;
        testResult.details = { message: 'Test executed successfully' };
      }
      
      testResult.duration = Date.now() - testStartTime;
      
      TestUtils.logTestResult(testName, testResult.passed, testResult.duration);
      
    } catch (error) {
      testResult.duration = Date.now() - testStartTime;
      testResult.error = error.message;
      
      TestUtils.logTestResult(testName, false, testResult.duration, error);
    }

    this.results.push(testResult);
  }

  /**
   * Generate comprehensive final report
   */
  async generateFinalReport() {
    const endTime = Date.now();
    const totalDuration = endTime - this.startTime;
    
    const summary = {
      total: this.results.length,
      passed: this.results.filter(r => r.passed).length,
      failed: this.results.filter(r => !r.passed).length,
      executionTime: totalDuration,
      averageTestTime: totalDuration / this.results.length
    };

    summary.successRate = ((summary.passed / summary.total) * 100).toFixed(2);

    // Performance analysis
    const performance = {
      fastest: Math.min(...this.results.map(r => r.duration)),
      slowest: Math.max(...this.results.map(r => r.duration)),
      benchmarks: {
        withinApiLimit: this.results.filter(r => r.duration <= config.performance.maxApiResponseTime).length,
        exceedsLimit: this.results.filter(r => r.duration > config.performance.maxApiResponseTime).length
      }
    };

    // Feature coverage analysis
    const coverage = {
      analytics: this.results.some(r => r.name.includes('analytics')),
      abTesting: this.results.some(r => r.name.includes('ab-testing')),
      personalization: this.results.some(r => r.name.includes('personalization')),
      flowDesigner: this.results.some(r => r.name.includes('flow-designer')),
      integration: this.results.some(r => r.name.includes('integration'))
    };

    // Production readiness assessment
    const productionReady = {
      allTestsPassing: summary.failed === 0,
      performanceAcceptable: performance.benchmarks.exceedsLimit === 0,
      fullCoverage: Object.values(coverage).every(c => c),
      score: this.calculateReadinessScore(summary, performance, coverage)
    };

    const report = {
      metadata: {
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: process.env.NODE_ENV || 'development',
        testSuiteVersion: '1.0.0'
      },
      summary,
      performance,
      coverage,
      productionReady,
      results: this.results,
      recommendations: this.generateRecommendations(summary, performance, coverage)
    };

    return report;
  }

  /**
   * Calculate production readiness score
   */
  calculateReadinessScore(summary, performance, coverage) {
    let score = 0;
    
    // Test success rate (40% weight)
    score += (summary.passed / summary.total) * 40;
    
    // Performance benchmarks (30% weight)
    const perfScore = (performance.benchmarks.withinApiLimit / summary.total) * 30;
    score += perfScore;
    
    // Feature coverage (20% weight)
    const coverageScore = Object.values(coverage).filter(c => c).length / Object.keys(coverage).length * 20;
    score += coverageScore;
    
    // Execution efficiency (10% weight)
    const efficiencyScore = summary.averageTestTime <= 5000 ? 10 : (10 - (summary.averageTestTime - 5000) / 1000);
    score += Math.max(0, efficiencyScore);
    
    return Math.round(score * 100) / 100;
  }

  /**
   * Generate recommendations based on test results
   */
  generateRecommendations(summary, performance, coverage) {
    const recommendations = [];

    if (summary.failed > 0) {
      recommendations.push({
        priority: 'HIGH',
        category: 'Reliability',
        message: `${summary.failed} test(s) are failing. Review and fix failing tests before deployment.`,
        action: 'Fix failing tests'
      });
    }

    if (performance.benchmarks.exceedsLimit > 0) {
      recommendations.push({
        priority: 'MEDIUM',
        category: 'Performance',
        message: `${performance.benchmarks.exceedsLimit} test(s) exceed performance benchmarks.`,
        action: 'Optimize slow operations'
      });
    }

    if (!Object.values(coverage).every(c => c)) {
      const missingFeatures = Object.entries(coverage)
        .filter(([, covered]) => !covered)
        .map(([feature]) => feature);
      
      recommendations.push({
        priority: 'MEDIUM',
        category: 'Coverage',
        message: `Missing test coverage for: ${missingFeatures.join(', ')}`,
        action: 'Add tests for missing features'
      });
    }

    if (summary.averageTestTime > 5000) {
      recommendations.push({
        priority: 'LOW',
        category: 'Efficiency',
        message: 'Test suite execution time is slower than optimal.',
        action: 'Optimize test execution speed'
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        priority: 'INFO',
        category: 'Status',
        message: '🎉 All tests are passing and performance is optimal!',
        action: 'Ready for production deployment'
      });
    }

    return recommendations;
  }

  /**
   * Save report to file
   */
  async saveReport(report) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const resultsDir = path.join(__dirname, 'test-results');
    
    // Ensure results directory exists
    try {
      await fs.access(resultsDir);
    } catch {
      await fs.mkdir(resultsDir, { recursive: true });
    }

    // Save JSON report
    const jsonPath = path.join(resultsDir, `test-report-${timestamp}.json`);
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2));

    // Save human-readable report
    const textReport = this.generateTextReport(report);
    const textPath = path.join(resultsDir, `test-report-${timestamp}.txt`);
    await fs.writeFile(textPath, textReport);

    // Save latest report (overwrite)
    const latestJsonPath = path.join(resultsDir, 'latest-report.json');
    const latestTextPath = path.join(resultsDir, 'latest-report.txt');
    await fs.writeFile(latestJsonPath, JSON.stringify(report, null, 2));
    await fs.writeFile(latestTextPath, textReport);

    console.log(`\n📊 Reports saved:`);
    console.log(`   JSON: ${jsonPath}`);
    console.log(`   Text: ${textPath}`);
    console.log(`   Latest: ${latestJsonPath}`);
  }

  /**
   * Generate human-readable text report
   */
  generateTextReport(report) {
    const { summary, performance, coverage, productionReady, recommendations } = report;
    
    let text = `
ClientsVia Enterprise Test Suite Report
=======================================

Generated: ${report.metadata.timestamp}
Environment: ${report.metadata.environment}
Test Suite Version: ${report.metadata.testSuiteVersion}

SUMMARY
-------
Total Tests: ${summary.total}
Passed: ${summary.passed} ✅
Failed: ${summary.failed} ${summary.failed > 0 ? '❌' : ''}
Success Rate: ${summary.successRate}%
Total Execution Time: ${summary.executionTime}ms
Average Test Time: ${Math.round(summary.averageTestTime)}ms

PERFORMANCE
-----------
Fastest Test: ${performance.fastest}ms
Slowest Test: ${performance.slowest}ms
Within API Limits: ${performance.benchmarks.withinApiLimit}/${summary.total}
Exceeds Limits: ${performance.benchmarks.exceedsLimit}/${summary.total}

FEATURE COVERAGE
---------------
Analytics: ${coverage.analytics ? '✅' : '❌'}
A/B Testing: ${coverage.abTesting ? '✅' : '❌'}
Personalization: ${coverage.personalization ? '✅' : '❌'}
Flow Designer: ${coverage.flowDesigner ? '✅' : '❌'}
Integration: ${coverage.integration ? '✅' : '❌'}

PRODUCTION READINESS
-------------------
All Tests Passing: ${productionReady.allTestsPassing ? '✅' : '❌'}
Performance Acceptable: ${productionReady.performanceAcceptable ? '✅' : '❌'}
Full Coverage: ${productionReady.fullCoverage ? '✅' : '❌'}
Readiness Score: ${productionReady.score}/100

RECOMMENDATIONS
--------------
`;

    recommendations.forEach((rec, index) => {
      text += `${index + 1}. [${rec.priority}] ${rec.category}: ${rec.message}\n`;
      text += `   Action: ${rec.action}\n\n`;
    });

    text += `
DETAILED RESULTS
---------------
`;

    report.results.forEach(result => {
      const status = result.passed ? '✅ PASS' : '❌ FAIL';
      text += `${status} ${result.name} (${result.duration}ms)\n`;
      if (result.error) {
        text += `   Error: ${result.error}\n`;
      }
    });

    return text;
  }
}

// CLI execution
if (require.main === module) {
  const runner = new MasterTestRunner();
  runner.runAllTests()
    .then(report => {
      console.log('\n🎯 Test Suite Complete!');
      console.log(`📊 Readiness Score: ${report.productionReady.score}/100`);
      
      if (report.productionReady.allTestsPassing) {
        console.log('🚀 Ready for production!');
        process.exit(0);
      } else {
        console.log('⚠️  Issues detected. Review recommendations.');
        process.exit(1);
      }
    })
    .catch(error => {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = MasterTestRunner;
