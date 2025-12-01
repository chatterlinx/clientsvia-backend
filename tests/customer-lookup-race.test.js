/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CUSTOMER LOOKUP RACE CONDITION TESTS
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * These tests verify that the CustomerLookup service handles concurrent calls
 * without creating duplicate customers. This is THE critical test for the
 * race-proof design.
 * 
 * TEST SCENARIO:
 * ─────────────────────────────────────────────────────────────────────────────
 * 100 concurrent calls come in from the same phone number.
 * V1 (broken): 100 customers created
 * V2 (correct): 1 customer created, totalCalls = 100
 * 
 * RUN TESTS:
 * ─────────────────────────────────────────────────────────────────────────────
 * npm test -- tests/customer-lookup-race.test.js
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const Customer = require('../models/Customer');
const CustomerEvent = require('../models/CustomerEvent');
const CustomerLookup = require('../services/CustomerLookup');

// Test configuration
const TEST_CONFIG = {
  // Number of concurrent lookups to simulate
  CONCURRENT_CALLS: 100,
  
  // Test company ID (will be created fresh)
  TEST_COMPANY_ID: null,
  
  // Test phone numbers
  TEST_PHONES: [
    '+13055551234',
    '+17865559999',
    '+12125550000'
  ],
  
  // MongoDB connection (use test database)
  MONGODB_URI: process.env.MONGODB_TEST_URI || process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia_test'
};

// ═══════════════════════════════════════════════════════════════════════════
// TEST SETUP
// ═══════════════════════════════════════════════════════════════════════════

describe('CustomerLookup Race Condition Tests', () => {
  let testCompanyId;
  
  // Connect to database before all tests
  beforeAll(async () => {
    // Connect if not already connected
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(TEST_CONFIG.MONGODB_URI);
    }
    
    // Create a test company ID
    testCompanyId = new mongoose.Types.ObjectId();
    TEST_CONFIG.TEST_COMPANY_ID = testCompanyId;
    
    console.log(`\n🧪 Test Setup Complete`);
    console.log(`   Company ID: ${testCompanyId}`);
    console.log(`   Concurrent Calls: ${TEST_CONFIG.CONCURRENT_CALLS}`);
  });
  
  // Clean up test data after each test
  afterEach(async () => {
    // Delete test customers
    await Customer.deleteMany({ companyId: testCompanyId });
    await CustomerEvent.deleteMany({ companyId: testCompanyId });
  });
  
  // Disconnect after all tests
  afterAll(async () => {
    // Final cleanup
    await Customer.deleteMany({ companyId: testCompanyId });
    await CustomerEvent.deleteMany({ companyId: testCompanyId });
    
    // Don't disconnect if we're part of a larger test suite
    if (process.env.KEEP_CONNECTION !== 'true') {
      await mongoose.disconnect();
    }
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CORE RACE CONDITION TEST
  // ═══════════════════════════════════════════════════════════════════════════
  
  describe('Concurrent Customer Creation', () => {
    
    test('should create exactly 1 customer when 100 concurrent calls arrive', async () => {
      const phone = TEST_CONFIG.TEST_PHONES[0];
      const numCalls = TEST_CONFIG.CONCURRENT_CALLS;
      
      console.log(`\n   📞 Simulating ${numCalls} concurrent calls from ${phone}...`);
      const startTime = Date.now();
      
      // Create array of concurrent lookup promises
      const lookupPromises = Array(numCalls).fill(null).map(() =>
        CustomerLookup.getOrCreatePlaceholder(testCompanyId, phone)
      );
      
      // Execute all lookups concurrently
      const results = await Promise.all(lookupPromises);
      
      const duration = Date.now() - startTime;
      console.log(`   ⏱️  Completed in ${duration}ms`);
      
      // Verify all results returned successfully
      expect(results).toHaveLength(numCalls);
      results.forEach(result => {
        expect(result).toHaveProperty('customer');
        expect(result).toHaveProperty('isNew');
        expect(result.customer).toHaveProperty('customerId');
      });
      
      // Get unique customer IDs from results
      const customerIds = new Set(results.map(r => r.customer._id.toString()));
      
      // THE CRITICAL ASSERTION: Only 1 unique customer ID
      console.log(`   ✅ Unique customer IDs: ${customerIds.size}`);
      expect(customerIds.size).toBe(1);
      
      // Verify database state
      const dbCount = await Customer.countDocuments({ companyId: testCompanyId, phone });
      console.log(`   ✅ Customers in database: ${dbCount}`);
      expect(dbCount).toBe(1);
      
      // Verify total calls was incremented correctly
      const customer = await Customer.findOne({ companyId: testCompanyId, phone });
      console.log(`   ✅ Total calls recorded: ${customer.totalCalls}`);
      expect(customer.totalCalls).toBe(numCalls);
      
      // Verify only 1 "isNew" result (first call)
      const newResults = results.filter(r => r.isNew);
      console.log(`   ✅ New customer events: ${newResults.length}`);
      expect(newResults.length).toBe(1);
    }, 30000);  // 30 second timeout
    
    test('should handle multiple phone numbers concurrently without cross-contamination', async () => {
      const phones = TEST_CONFIG.TEST_PHONES;
      const callsPerPhone = 50;
      
      console.log(`\n   📞 Simulating ${callsPerPhone} calls each to ${phones.length} numbers...`);
      const startTime = Date.now();
      
      // Create mixed array of lookups for all phones
      const lookupPromises = [];
      phones.forEach(phone => {
        for (let i = 0; i < callsPerPhone; i++) {
          lookupPromises.push(
            CustomerLookup.getOrCreatePlaceholder(testCompanyId, phone)
          );
        }
      });
      
      // Shuffle to simulate real concurrent behavior
      lookupPromises.sort(() => Math.random() - 0.5);
      
      // Execute all concurrently
      const results = await Promise.all(lookupPromises);
      
      const duration = Date.now() - startTime;
      console.log(`   ⏱️  Completed in ${duration}ms`);
      
      // Verify correct number of customers created
      const dbCount = await Customer.countDocuments({ companyId: testCompanyId });
      console.log(`   ✅ Total customers in database: ${dbCount}`);
      expect(dbCount).toBe(phones.length);
      
      // Verify each phone has correct call count
      for (const phone of phones) {
        const customer = await Customer.findOne({ companyId: testCompanyId, phone });
        console.log(`   ✅ ${phone}: ${customer.totalCalls} calls`);
        expect(customer.totalCalls).toBe(callsPerPhone);
      }
    }, 30000);
    
    test('should maintain multi-tenant isolation under concurrent load', async () => {
      const phone = TEST_CONFIG.TEST_PHONES[0];
      const company1 = new mongoose.Types.ObjectId();
      const company2 = new mongoose.Types.ObjectId();
      const callsPerCompany = 50;
      
      console.log(`\n   🏢 Simulating ${callsPerCompany} calls to 2 different companies...`);
      
      // Create mixed lookups for both companies
      const lookupPromises = [];
      for (let i = 0; i < callsPerCompany; i++) {
        lookupPromises.push(
          CustomerLookup.getOrCreatePlaceholder(company1, phone),
          CustomerLookup.getOrCreatePlaceholder(company2, phone)
        );
      }
      
      // Shuffle
      lookupPromises.sort(() => Math.random() - 0.5);
      
      // Execute
      const results = await Promise.all(lookupPromises);
      
      // Verify 2 customers created (1 per company)
      const count1 = await Customer.countDocuments({ companyId: company1, phone });
      const count2 = await Customer.countDocuments({ companyId: company2, phone });
      
      console.log(`   ✅ Company 1 customers: ${count1}`);
      console.log(`   ✅ Company 2 customers: ${count2}`);
      
      expect(count1).toBe(1);
      expect(count2).toBe(1);
      
      // Verify call counts
      const customer1 = await Customer.findOne({ companyId: company1, phone });
      const customer2 = await Customer.findOne({ companyId: company2, phone });
      
      console.log(`   ✅ Company 1 call count: ${customer1.totalCalls}`);
      console.log(`   ✅ Company 2 call count: ${customer2.totalCalls}`);
      
      expect(customer1.totalCalls).toBe(callsPerCompany);
      expect(customer2.totalCalls).toBe(callsPerCompany);
      
      // Verify customers are different
      expect(customer1._id.toString()).not.toBe(customer2._id.toString());
      expect(customer1.customerId).not.toBe(customer2.customerId);
      
      // Cleanup
      await Customer.deleteMany({ companyId: { $in: [company1, company2] } });
    }, 30000);
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PHONE NORMALIZATION TESTS
  // ═══════════════════════════════════════════════════════════════════════════
  
  describe('Phone Normalization', () => {
    
    test('should recognize same customer with different phone formats', async () => {
      const phoneFormats = [
        '+13055551234',      // E.164
        '3055551234',        // 10 digits
        '13055551234',       // 11 digits with 1
        '(305) 555-1234',    // Formatted
        '305-555-1234',      // Dashed
        '305.555.1234',      // Dotted
        '1-305-555-1234',    // With country code
        '+1 305 555 1234',   // Spaced
      ];
      
      console.log(`\n   📱 Testing ${phoneFormats.length} phone formats...`);
      
      // Lookup with each format
      for (const format of phoneFormats) {
        await CustomerLookup.getOrCreatePlaceholder(testCompanyId, format);
      }
      
      // Should all resolve to same customer
      const dbCount = await Customer.countDocuments({ companyId: testCompanyId });
      console.log(`   ✅ Customers created: ${dbCount}`);
      expect(dbCount).toBe(1);
      
      // Verify call count equals number of formats
      const customer = await Customer.findOne({ companyId: testCompanyId });
      console.log(`   ✅ Total calls: ${customer.totalCalls}`);
      expect(customer.totalCalls).toBe(phoneFormats.length);
    });
    
    test('should throw on invalid phone number', async () => {
      const invalidPhones = [
        '123',              // Too short
        'abc',              // Letters
        '',                 // Empty
        null,               // Null
        undefined,          // Undefined
      ];
      
      for (const phone of invalidPhones) {
        await expect(
          CustomerLookup.getOrCreatePlaceholder(testCompanyId, phone)
        ).rejects.toThrow();
      }
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // AI CONTEXT TESTS
  // ═══════════════════════════════════════════════════════════════════════════
  
  describe('AI Context Generation', () => {
    
    test('should return correct context for new customer', async () => {
      const phone = '+13055559999';
      
      const context = await CustomerLookup.getAIContext(testCompanyId, phone);
      
      expect(context).toMatchObject({
        isReturning: false,
        isPlaceholder: true,
        name: null,
        totalCalls: 1,
        status: 'placeholder'
      });
      
      expect(context.suggestedGreeting).toBeNull();
    });
    
    test('should return personalized context for returning customer', async () => {
      const phone = '+13055559999';
      
      // First call
      const { customer } = await CustomerLookup.getOrCreatePlaceholder(testCompanyId, phone);
      
      // Enrich with name
      await CustomerLookup.enrichCustomer(customer._id, {
        fullName: 'Sarah Johnson',
        firstName: 'Sarah',
        status: 'customer',
        companyId: testCompanyId
      });
      
      // Second call - get AI context
      const context = await CustomerLookup.getAIContext(testCompanyId, phone);
      
      expect(context.isReturning).toBe(true);
      expect(context.isPlaceholder).toBe(false);
      expect(context.name).toBe('Sarah Johnson');
      expect(context.firstName).toBe('Sarah');
      expect(context.suggestedGreeting).toContain('Sarah');
    });
    
    test('should include access notes in context', async () => {
      const phone = '+13055559999';
      
      const { customer } = await CustomerLookup.getOrCreatePlaceholder(testCompanyId, phone);
      
      // Add address with access info
      await CustomerLookup.enrichCustomer(customer._id, {
        primaryAddress: {
          street: '123 Main St',
          city: 'Miami',
          state: 'FL',
          accessNotes: 'Gate code 1234',
          keyLocation: 'Under the mat',
          alternateContact: {
            name: 'Nataly',
            phone: '+12223334444',
            relationship: 'Neighbor'
          }
        },
        companyId: testCompanyId
      });
      
      const context = await CustomerLookup.getAIContext(testCompanyId, phone);
      
      expect(context.accessNotes).toBe('Gate code 1234');
      expect(context.keyLocation).toBe('Under the mat');
      expect(context.alternateContact).toEqual({
        name: 'Nataly',
        phone: '+12223334444',
        relationship: 'Neighbor'
      });
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // ENRICHMENT TESTS
  // ═══════════════════════════════════════════════════════════════════════════
  
  describe('Customer Enrichment', () => {
    
    test('should update placeholder to lead when name is captured', async () => {
      const phone = '+13055559999';
      
      const { customer } = await CustomerLookup.getOrCreatePlaceholder(testCompanyId, phone);
      expect(customer.status).toBe('placeholder');
      
      // Enrich with name
      const enriched = await CustomerLookup.enrichCustomer(customer._id, {
        fullName: 'John Smith',
        companyId: testCompanyId
      });
      
      expect(enriched.status).toBe('lead');
      expect(enriched.fullName).toBe('John Smith');
    });
    
    test('should log customer_updated event on enrichment', async () => {
      const phone = '+13055559999';
      
      const { customer } = await CustomerLookup.getOrCreatePlaceholder(testCompanyId, phone);
      
      await CustomerLookup.enrichCustomer(customer._id, {
        fullName: 'John Smith',
        email: 'john@example.com',
        companyId: testCompanyId
      });
      
      // Check for event
      const events = await CustomerEvent.find({
        companyId: testCompanyId,
        customerId: customer._id,
        type: 'customer_updated'
      });
      
      expect(events.length).toBeGreaterThan(0);
      expect(events[0].data.updatedFields).toContain('fullName');
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SEARCH TESTS
  // ═══════════════════════════════════════════════════════════════════════════
  
  describe('Customer Search', () => {
    
    beforeEach(async () => {
      // Create test customers
      await CustomerLookup.getOrCreatePlaceholder(testCompanyId, '+13055551111');
      await CustomerLookup.getOrCreatePlaceholder(testCompanyId, '+13055552222');
      await CustomerLookup.getOrCreatePlaceholder(testCompanyId, '+13055553333');
      
      // Wait for database consistency
      await new Promise(resolve => setTimeout(resolve, 100));
    });
    
    test('should find customer by phone', async () => {
      const result = await CustomerLookup.searchCustomers(testCompanyId, {
        query: '+13055551111'
      });
      
      expect(result.total).toBe(1);
      expect(result.customers[0].phone).toBe('+13055551111');
    });
    
    test('should return paginated results', async () => {
      const result = await CustomerLookup.searchCustomers(testCompanyId, {}, {
        page: 1,
        limit: 2
      });
      
      expect(result.customers.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.pages).toBe(2);
    });
  });
  
  // ═══════════════════════════════════════════════════════════════════════════
  // HEALTH CHECK TESTS
  // ═══════════════════════════════════════════════════════════════════════════
  
  describe('Health Check', () => {
    
    test('should return healthy status when MongoDB is connected', async () => {
      const health = await CustomerLookup.healthCheck();
      
      expect(health.status).toBe('HEALTHY');
      expect(health.mongodb).toBe('HEALTHY');
      expect(health.responseTime).toBeDefined();
      expect(health.responseTime).toBeLessThan(5000);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PERFORMANCE BENCHMARK (Optional)
// ═══════════════════════════════════════════════════════════════════════════

describe('Performance Benchmarks', () => {
  let testCompanyId;
  
  beforeAll(async () => {
    if (mongoose.connection.readyState !== 1) {
      await mongoose.connect(TEST_CONFIG.MONGODB_URI);
    }
    testCompanyId = new mongoose.Types.ObjectId();
  });
  
  afterAll(async () => {
    await Customer.deleteMany({ companyId: testCompanyId });
  });
  
  test('should complete 100 sequential lookups in under 5 seconds', async () => {
    const phone = '+13055550001';
    const numLookups = 100;
    
    const startTime = Date.now();
    
    for (let i = 0; i < numLookups; i++) {
      await CustomerLookup.getOrCreatePlaceholder(testCompanyId, phone);
    }
    
    const duration = Date.now() - startTime;
    const avgTime = duration / numLookups;
    
    console.log(`\n   📊 Performance Benchmark:`);
    console.log(`      Total time: ${duration}ms`);
    console.log(`      Avg per lookup: ${avgTime.toFixed(2)}ms`);
    
    expect(duration).toBeLessThan(5000);
    expect(avgTime).toBeLessThan(50);
  }, 10000);
});

