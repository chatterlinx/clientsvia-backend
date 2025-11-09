// ============================================================================
// PERFORMANCE TESTS - Sub-25ms Response Time Validation
// ============================================================================
// Validates that cached queries meet sub-25ms performance targets
// Tests Redis caching effectiveness and Mongoose query optimization
// ============================================================================

const mongoose = require('mongoose');
const Company = require('../models/v2Company');
const { redisClient } = require('../clients');
const AIBrain3tierllm = require('../services/AIBrain3tierllm');

describe('Performance Tests - Sub-25ms Target', () => {
  let testCompanyId;
  let router;

  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_TEST_URI || process.env.MONGODB_URI);
    }

    // Create test company with comprehensive data
    const testCompany = new Company({
      companyName: 'Performance Test Company',
      address: {
        street: '123 Speed St',
        city: 'Fast City',
        state: 'FC',
        zip: '12345',
        country: 'USA'
      },
      tradeCategories: ['HVAC', 'Plumbing'],
      aiAgentLogic: {
        enabled: true,
        thresholds: {
          companyQnA: 0.8,
          tradeQnA: 0.75,
          templates: 0.7,
          inHouseFallback: 0.5
        },
        knowledgeManagement: {
          companyQnA: [
            {
              id: 'test-1',
              question: 'What are your business hours?',
              answer: 'We are open 24/7 for emergencies',
              keywords: ['hours', 'open', 'schedule'],
              confidence: 0.9,
              status: 'active'
            }
          ],
          tradeQnA: [
            {
              id: 'trade-1',
              question: 'How much does HVAC maintenance cost?',
              answer: 'HVAC maintenance starts at $125',
              keywords: ['hvac', 'maintenance', 'cost'],
              tradeCategory: 'HVAC',
              confidence: 0.85,
              status: 'active'
            }
          ]
        }
      }
    });
    await testCompany.save();
    testCompanyId = testCompany._id.toString();

    // Initialize AI Brain (singleton instance)
    router = AIBrain3tierllm;
  });

  afterAll(async () => {
    // Cleanup
    await Company.findByIdAndDelete(testCompanyId);
    
    // Clear Redis cache
    try {
      await redisClient.del(`company:${testCompanyId}`);
      await redisClient.del(`company:${testCompanyId}:priorities`);
    } catch (error) {
      // Ignore Redis errors in cleanup
    }
    
    await mongoose.connection.close();
  });

  // ============================================================================
  // REDIS CACHE PERFORMANCE TESTS
  // ============================================================================

  describe('Redis Cache Performance', () => {
    it('should retrieve cached company data in < 5ms', async () => {
      // Pre-populate cache
      const company = await Company.findById(testCompanyId).lean();
      await redisClient.setEx(`company:${testCompanyId}`, 3600, JSON.stringify(company));

      // Measure cache retrieval
      const start = Date.now();
      const cached = await redisClient.get(`company:${testCompanyId}`);
      const duration = Date.now() - start;

      expect(cached).toBeTruthy();
      expect(duration).toBeLessThan(5); // Redis should be < 5ms
      
      console.log(`✅ Redis cache retrieval: ${duration}ms`);
    });

    it('should set cache entry in < 5ms', async () => {
      const testData = { test: 'data', timestamp: Date.now() };
      
      const start = Date.now();
      await redisClient.setEx(`test-key-${Date.now()}`, 60, JSON.stringify(testData));
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5); // Redis writes should be < 5ms
      
      console.log(`✅ Redis cache write: ${duration}ms`);
    });

    it('should handle cache miss gracefully', async () => {
      const start = Date.now();
      const result = await redisClient.get(`non-existent-key-${Date.now()}`);
      const duration = Date.now() - start;

      expect(result).toBeNull();
      expect(duration).toBeLessThan(5); // Even cache miss should be fast
      
      console.log(`✅ Redis cache miss: ${duration}ms`);
    });
  });

  // ============================================================================
  // MONGOOSE QUERY PERFORMANCE TESTS
  // ============================================================================

  describe('Mongoose Query Performance', () => {
    it('should retrieve company by ID in < 50ms (cold)', async () => {
      // Clear cache to force database query
      await redisClient.del(`company:${testCompanyId}`);

      const start = Date.now();
      const company = await Company.findById(testCompanyId).lean();
      const duration = Date.now() - start;

      expect(company).toBeTruthy();
      expect(duration).toBeLessThan(50); // First query (cold) < 50ms
      
      console.log(`✅ Mongoose cold query: ${duration}ms`);
    });

    it('should retrieve company by ID in < 25ms (warm)', async () => {
      // First query to warm up
      await Company.findById(testCompanyId).lean();

      // Second query (warm)
      const start = Date.now();
      const company = await Company.findById(testCompanyId).lean();
      const duration = Date.now() - start;

      expect(company).toBeTruthy();
      expect(duration).toBeLessThan(25); // Warm query < 25ms
      
      console.log(`✅ Mongoose warm query: ${duration}ms`);
    });

    it('should use indexes for phone number lookup', async () => {
      // Ensure company has phone number
      await Company.findByIdAndUpdate(testCompanyId, {
        'twilioConfig.phoneNumber': '+15555551234'
      });

      const start = Date.now();
      const company = await Company.findOne({
        'twilioConfig.phoneNumber': '+15555551234'
      }).lean();
      const duration = Date.now() - start;

      expect(company).toBeTruthy();
      expect(duration).toBeLessThan(25); // Indexed query < 25ms
      
      console.log(`✅ Indexed phone lookup: ${duration}ms`);
    });
  });

  // ============================================================================
  // AI KNOWLEDGE ROUTING PERFORMANCE TESTS
  // ============================================================================

  describe('AI Knowledge Routing Performance', () => {
    it('should route cached queries in < 25ms', async () => {
      const query = 'What are your business hours?';

      // First query to populate cache
      await router.query(testCompanyId, query);

      // Second query (should hit cache)
      const start = Date.now();
      const result = await router.query(testCompanyId, query);
      const duration = Date.now() - start;

      expect(result).toHaveProperty('success');
      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(25); // Cached routing < 25ms
      
      console.log(`✅ Cached knowledge routing: ${duration}ms`);
    });

    it('should match company Q&A in < 100ms (cold)', async () => {
      const query = 'When are you open?';
      
      // Clear cache
      router.clearCache();
      await redisClient.del(`query:${testCompanyId}:companyQnA:*`);

      const start = Date.now();
      const result = await router.query(testCompanyId, query);
      const duration = Date.now() - start;

      expect(result).toHaveProperty('response');
      expect(duration).toBeLessThan(100); // Cold query < 100ms
      
      console.log(`✅ Cold knowledge routing: ${duration}ms`);
    });

    it('should handle high-frequency queries efficiently', async () => {
      const queries = [
        'What are your hours?',
        'How much does it cost?',
        'Where are you located?',
        'Do you offer emergency service?'
      ];

      const durations = [];

      for (const query of queries) {
        const start = Date.now();
        await router.query(testCompanyId, query);
        const duration = Date.now() - start;
        durations.push(duration);
      }

      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const maxDuration = Math.max(...durations);

      expect(avgDuration).toBeLessThan(50); // Average < 50ms
      expect(maxDuration).toBeLessThan(100); // Max < 100ms
      
      console.log(`✅ Avg query time: ${avgDuration.toFixed(2)}ms (max: ${maxDuration}ms)`);
    });
  });

  // ============================================================================
  // CONCURRENT REQUEST PERFORMANCE TESTS
  // ============================================================================

  describe('Concurrent Request Performance', () => {
    it('should handle 10 concurrent queries efficiently', async () => {
      const queries = Array(10).fill('What are your hours?');

      const start = Date.now();
      const results = await Promise.all(
        queries.map(query => router.query(testCompanyId, query))
      );
      const duration = Date.now() - start;

      expect(results.length).toBe(10);
      results.forEach(result => {
        expect(result).toHaveProperty('success');
      });

      const avgPerQuery = duration / 10;
      expect(avgPerQuery).toBeLessThan(50); // Average < 50ms per query
      
      console.log(`✅ 10 concurrent queries: ${duration}ms total (${avgPerQuery.toFixed(2)}ms avg)`);
    });

    it('should handle 50 concurrent cache reads', async () => {
      // Pre-populate cache
      await redisClient.setEx(`test-concurrent-${testCompanyId}`, 60, JSON.stringify({ test: 'data' }));

      const reads = Array(50).fill(`test-concurrent-${testCompanyId}`);

      const start = Date.now();
      const results = await Promise.all(
        reads.map(key => redisClient.get(key))
      );
      const duration = Date.now() - start;

      expect(results.length).toBe(50);
      results.forEach(result => expect(result).toBeTruthy());

      expect(duration).toBeLessThan(100); // 50 concurrent reads < 100ms total
      
      console.log(`✅ 50 concurrent cache reads: ${duration}ms`);
    });
  });

  // ============================================================================
  // MEMORY EFFICIENCY TESTS
  // ============================================================================

  describe('Memory Efficiency', () => {
    it('should not create memory leaks in repeated queries', async () => {
      const initialMemory = process.memoryUsage().heapUsed;

      // Execute 1000 queries
      for (let i = 0; i < 1000; i++) {
        await router.query(testCompanyId, `Query ${i}`);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = (finalMemory - initialMemory) / 1024 / 1024; // MB

      // Memory increase should be minimal (< 10MB for 1000 queries)
      expect(memoryIncrease).toBeLessThan(10);
      
      console.log(`✅ Memory increase after 1000 queries: ${memoryIncrease.toFixed(2)}MB`);
    });

    it('should clear cache effectively', async () => {
      // Populate cache with 100 entries
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(
          redisClient.setEx(`test-clear-${i}`, 60, JSON.stringify({ index: i }))
        );
      }
      await Promise.all(promises);

      // Clear all test keys
      const keys = await redisClient.keys('test-clear-*');
      expect(keys.length).toBeGreaterThan(0);

      if (keys.length > 0) {
        await redisClient.del(...keys);
      }

      // Verify all cleared
      const remainingKeys = await redisClient.keys('test-clear-*');
      expect(remainingKeys.length).toBe(0);
      
      console.log(`✅ Cleared ${keys.length} cache entries`);
    });
  });

  // ============================================================================
  // PERFORMANCE SUMMARY
  // ============================================================================

  describe('Performance Summary', () => {
    it('should generate performance report', async () => {
      const metrics = router.getPerformanceMetrics();

      console.log(`\n${  '='.repeat(80)}`);
      console.log('PERFORMANCE TEST SUMMARY');
      console.log('='.repeat(80));
      console.log(`Total queries executed: ${metrics.totalQueries}`);
      console.log(`Average response time: ${metrics.avgResponseTime.toFixed(2)}ms`);
      console.log(`Success rate: ${(metrics.successRate * 100).toFixed(2)}%`);
      console.log(`Cache size: ${metrics.cacheSize} entries`);
      console.log(`${'='.repeat(80)  }\n`);

      expect(metrics.avgResponseTime).toBeLessThan(50);
      expect(metrics.successRate).toBeGreaterThan(0.8);
    });
  });
});

