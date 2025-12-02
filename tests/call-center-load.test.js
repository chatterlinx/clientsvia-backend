/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALL CENTER MODULE - LOAD TEST
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2 - Phase 5
 * Created: December 1, 2025
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Test the Call Center module under concurrent load to ensure:
 * - Customer recognition is race-proof
 * - APIs respond under 200ms at p95
 * - No data corruption under concurrent writes
 * 
 * TARGETS:
 * ─────────────────────────────────────────────────────────────────────────────
 * - 100+ concurrent calls
 * - Sub-200ms API response at p95
 * - Zero duplicate customers
 * - Zero failed transactions
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const CustomerLookup = require('../services/CustomerLookup');
const CallSummaryService = require('../services/CallSummaryService');
const Customer = require('../models/Customer');
const CustomerEvent = require('../models/CustomerEvent');
const CallSummary = require('../models/CallSummary');
const V2Company = require('../models/v2Company');

// ═══════════════════════════════════════════════════════════════════════════
// TEST CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  CONCURRENT_CALLS: 100,
  UNIQUE_PHONES: 20,  // 100 calls from 20 unique numbers = avg 5 calls/phone
  TIMEOUT_MS: 30000,
  P95_TARGET_MS: 200
};

// ═══════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════

let mongoServer;
let companyId;

// Suppress logs during tests
const originalLog = console.log;
const originalError = console.error;

beforeAll(async () => {
  // Suppress console output
  console.log = jest.fn();
  console.error = jest.fn();
  
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  await mongoose.connect(mongoUri);
  
  // Create test company
  const company = await V2Company.create({
    businessName: 'Load Test Company',
    companyName: 'Load Test',
    aiAgentSettings: { enabled: true }
  });
  companyId = company._id.toString();
  
  originalLog('Test company created:', companyId);
}, 30000);

afterAll(async () => {
  // Restore console
  console.log = originalLog;
  console.error = originalError;
  
  await mongoose.disconnect();
  await mongoServer.stop();
}, 30000);

beforeEach(async () => {
  await Customer.deleteMany({});
  await CustomerEvent.deleteMany({});
  await CallSummary.deleteMany({});
});

// ═══════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function generatePhoneNumber(index) {
  return `+1555${String(index).padStart(7, '0')}`;
}

function calculatePercentile(arr, p) {
  const sorted = arr.slice().sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[index];
}

// ═══════════════════════════════════════════════════════════════════════════
// LOAD TESTS
// ═══════════════════════════════════════════════════════════════════════════

describe('Call Center Load Tests', () => {
  
  test(`${CONFIG.CONCURRENT_CALLS} concurrent customer lookups with ${CONFIG.UNIQUE_PHONES} unique phones`, async () => {
    const durations = [];
    const results = [];
    
    // Generate calls: distribute across unique phones
    const calls = [];
    for (let i = 0; i < CONFIG.CONCURRENT_CALLS; i++) {
      const phoneIndex = i % CONFIG.UNIQUE_PHONES;
      calls.push({
        phone: generatePhoneNumber(phoneIndex),
        callId: `test-call-${i}`
      });
    }
    
    // Execute all calls concurrently
    const startTime = Date.now();
    
    const promises = calls.map(async (call, index) => {
      const callStart = Date.now();
      try {
        const result = await CustomerLookup.getOrCreatePlaceholder(
          companyId,
          call.phone,
          call.callId
        );
        const duration = Date.now() - callStart;
        durations.push(duration);
        results.push({ success: true, result, duration });
      } catch (error) {
        const duration = Date.now() - callStart;
        durations.push(duration);
        results.push({ success: false, error: error.message, duration });
      }
    });
    
    await Promise.all(promises);
    
    const totalDuration = Date.now() - startTime;
    
    // Calculate metrics
    const successCount = results.filter(r => r.success).length;
    const failCount = results.filter(r => !r.success).length;
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const p50 = calculatePercentile(durations, 50);
    const p95 = calculatePercentile(durations, 95);
    const p99 = calculatePercentile(durations, 99);
    
    // Verify customer counts
    const customers = await Customer.find({ companyId });
    const uniqueCustomerCount = customers.length;
    
    // Log results
    originalLog('\n═══════════════════════════════════════════════════════════════════════════');
    originalLog('CUSTOMER LOOKUP LOAD TEST RESULTS');
    originalLog('═══════════════════════════════════════════════════════════════════════════');
    originalLog(`Concurrent Calls:     ${CONFIG.CONCURRENT_CALLS}`);
    originalLog(`Unique Phone Numbers: ${CONFIG.UNIQUE_PHONES}`);
    originalLog(`Total Duration:       ${totalDuration}ms`);
    originalLog(`───────────────────────────────────────────────────────────────────────────`);
    originalLog(`Success Rate:         ${successCount}/${CONFIG.CONCURRENT_CALLS} (${((successCount/CONFIG.CONCURRENT_CALLS)*100).toFixed(1)}%)`);
    originalLog(`Failed:               ${failCount}`);
    originalLog(`───────────────────────────────────────────────────────────────────────────`);
    originalLog(`Avg Response Time:    ${avgDuration.toFixed(1)}ms`);
    originalLog(`P50 Response Time:    ${p50}ms`);
    originalLog(`P95 Response Time:    ${p95}ms ${p95 <= CONFIG.P95_TARGET_MS ? '✅' : '❌'}`);
    originalLog(`P99 Response Time:    ${p99}ms`);
    originalLog(`───────────────────────────────────────────────────────────────────────────`);
    originalLog(`Customers Created:    ${uniqueCustomerCount}`);
    originalLog(`Expected:             ${CONFIG.UNIQUE_PHONES}`);
    originalLog(`Race Condition Test:  ${uniqueCustomerCount === CONFIG.UNIQUE_PHONES ? '✅ PASSED' : '❌ FAILED'}`);
    originalLog('═══════════════════════════════════════════════════════════════════════════\n');
    
    // Assertions
    expect(successCount).toBe(CONFIG.CONCURRENT_CALLS);
    expect(failCount).toBe(0);
    expect(uniqueCustomerCount).toBe(CONFIG.UNIQUE_PHONES); // No duplicates!
    expect(p95).toBeLessThanOrEqual(CONFIG.P95_TARGET_MS);
    
  }, CONFIG.TIMEOUT_MS);
  
  test('verify totalCalls counter accuracy under concurrent load', async () => {
    const phone = generatePhoneNumber(999);
    const callCount = 50;
    
    // Simulate 50 concurrent calls from same number
    const promises = Array(callCount).fill(null).map((_, i) => 
      CustomerLookup.getOrCreatePlaceholder(companyId, phone, `concurrent-call-${i}`)
    );
    
    await Promise.all(promises);
    
    // Verify counter
    const customer = await Customer.findOne({ companyId, phone });
    
    originalLog('\n═══════════════════════════════════════════════════════════════════════════');
    originalLog('TOTAL CALLS COUNTER TEST');
    originalLog('═══════════════════════════════════════════════════════════════════════════');
    originalLog(`Concurrent Calls:     ${callCount}`);
    originalLog(`Recorded totalCalls:  ${customer.totalCalls}`);
    originalLog(`Counter Accuracy:     ${customer.totalCalls === callCount ? '✅ PASSED' : '❌ FAILED'}`);
    originalLog('═══════════════════════════════════════════════════════════════════════════\n');
    
    expect(customer.totalCalls).toBe(callCount);
  }, CONFIG.TIMEOUT_MS);
  
  test('CallSummary creation under concurrent load', async () => {
    const durations = [];
    const callCount = 50;
    
    // Generate test calls
    const calls = Array(callCount).fill(null).map((_, i) => ({
      companyId,
      callId: `load-test-call-${i}-${Date.now()}`,
      twilioSid: `TW${i}${Date.now()}`,
      phone: generatePhoneNumber(i % 10),
      direction: 'inbound',
      startedAt: new Date()
    }));
    
    // Execute concurrently
    const startTime = Date.now();
    
    const promises = calls.map(async (call) => {
      const callStart = Date.now();
      try {
        await CallSummaryService.startCall(call);
        durations.push(Date.now() - callStart);
        return { success: true };
      } catch (error) {
        durations.push(Date.now() - callStart);
        return { success: false, error: error.message };
      }
    });
    
    const results = await Promise.all(promises);
    const totalDuration = Date.now() - startTime;
    
    const successCount = results.filter(r => r.success).length;
    const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
    const p95 = calculatePercentile(durations, 95);
    
    // Verify DB records
    const summaries = await CallSummary.find({ companyId });
    
    originalLog('\n═══════════════════════════════════════════════════════════════════════════');
    originalLog('CALL SUMMARY CREATION LOAD TEST');
    originalLog('═══════════════════════════════════════════════════════════════════════════');
    originalLog(`Concurrent Creates:   ${callCount}`);
    originalLog(`Total Duration:       ${totalDuration}ms`);
    originalLog(`Success Rate:         ${successCount}/${callCount}`);
    originalLog(`Avg Response Time:    ${avgDuration.toFixed(1)}ms`);
    originalLog(`P95 Response Time:    ${p95}ms`);
    originalLog(`Records Created:      ${summaries.length}`);
    originalLog('═══════════════════════════════════════════════════════════════════════════\n');
    
    expect(successCount).toBe(callCount);
    expect(summaries.length).toBe(callCount);
  }, CONFIG.TIMEOUT_MS);
  
});

// ═══════════════════════════════════════════════════════════════════════════
// STRESS TEST (Optional - longer running)
// ═══════════════════════════════════════════════════════════════════════════

describe.skip('Stress Tests (Extended)', () => {
  
  test('500 concurrent calls stress test', async () => {
    const STRESS_CALLS = 500;
    const STRESS_PHONES = 50;
    
    const calls = Array(STRESS_CALLS).fill(null).map((_, i) => ({
      phone: generatePhoneNumber(i % STRESS_PHONES),
      callId: `stress-${i}`
    }));
    
    const startTime = Date.now();
    
    await Promise.all(
      calls.map(call => 
        CustomerLookup.getOrCreatePlaceholder(companyId, call.phone, call.callId)
      )
    );
    
    const totalDuration = Date.now() - startTime;
    const customers = await Customer.find({ companyId });
    
    originalLog(`Stress test: ${STRESS_CALLS} calls in ${totalDuration}ms`);
    originalLog(`Customers: ${customers.length} (expected ${STRESS_PHONES})`);
    
    expect(customers.length).toBe(STRESS_PHONES);
  }, 60000);
  
});

