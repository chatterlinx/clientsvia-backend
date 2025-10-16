// ============================================================================
// API INTEGRATION TESTS - Production Readiness
// ============================================================================
// Tests critical API endpoints for functionality and security
// ============================================================================

const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../index');
const Company = require('../models/v2Company');
const User = require('../models/v2User');
const jwt = require('jsonwebtoken');

describe('API Integration Tests', () => {
  let authToken;
  let testCompanyId;
  let testUserId;

  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_TEST_URI || process.env.MONGODB_URI);
    }

    // Create test company
    const testCompany = new Company({
      companyName: 'Test Company API',
      address: {
        street: '123 Test St',
        city: 'Test City',
        state: 'TS',
        zip: '12345',
        country: 'USA'
      },
      tradeCategories: ['HVAC']
    });
    await testCompany.save();
    testCompanyId = testCompany._id.toString();

    // Create test user
    const testUser = new User({
      email: 'test@example.com',
      password: 'hashedPassword123',
      role: 'user',
      companyId: testCompanyId,
      status: 'active'
    });
    await testUser.save();
    testUserId = testUser._id.toString();

    // Generate auth token
    authToken = jwt.sign(
      { userId: testUserId, email: testUser.email, role: testUser.role },
      process.env.JWT_SECRET || 'test-secret-key-min-32-characters-long',
      { expiresIn: '1h' }
    );
  });

  afterAll(async () => {
    // Cleanup test data
    await Company.findByIdAndDelete(testCompanyId);
    await User.findByIdAndDelete(testUserId);
    
    // Close database connection
    await mongoose.connection.close();
  });

  // ============================================================================
  // HEALTH CHECK TESTS
  // ============================================================================

  describe('GET /health', () => {
    it('should return 200 and health status', async () => {
      const response = await request(app)
        .get('/health')
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('services');
      expect(response.body.services).toHaveProperty('mongodb');
      expect(response.body.services).toHaveProperty('redis');
    });

    it('should include system metrics', async () => {
      const response = await request(app)
        .get('/health')
        .expect(200);

      expect(response.body).toHaveProperty('system');
      expect(response.body.system).toHaveProperty('memory');
      expect(response.body.system).toHaveProperty('uptime');
    });
  });

  describe('GET /healthz', () => {
    it('should return simple health check', async () => {
      const response = await request(app)
        .get('/healthz')
        .expect(200);

      expect(response.body).toHaveProperty('ok', true);
    });
  });

  // ============================================================================
  // COMPANY API TESTS
  // ============================================================================

  describe('GET /api/company/:id', () => {
    it('should return company data when valid ID provided', async () => {
      const response = await request(app)
        .get(`/api/company/${testCompanyId}`)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('companyName', 'Test Company API');
      expect(response.body).toHaveProperty('tradeCategories');
    });

    it('should return 400 for invalid company ID format', async () => {
      const response = await request(app)
        .get('/api/company/invalid-id')
        .expect(400);

      expect(response.body).toHaveProperty('message', 'Invalid company ID format');
    });

    it('should return 404 for non-existent company', async () => {
      const fakeId = new mongoose.Types.ObjectId();
      await request(app)
        .get(`/api/company/${fakeId}`)
        .expect(404);
    });

    it('should cache company data in Redis', async () => {
      // First request (cache miss)
      const response1 = await request(app)
        .get(`/api/company/${testCompanyId}`)
        .expect(200);

      // Second request (should hit cache)
      const response2 = await request(app)
        .get(`/api/company/${testCompanyId}`)
        .expect(200);

      expect(response1.body).toEqual(response2.body);
    });
  });

  describe('PATCH /api/company/:id', () => {
    it('should update company data', async () => {
      const updateData = {
        businessPhone: '+1234567890',
        businessEmail: 'test@company.com'
      };

      const response = await request(app)
        .patch(`/api/company/${testCompanyId}`)
        .send(updateData)
        .expect('Content-Type', /json/)
        .expect(200);

      expect(response.body).toHaveProperty('businessPhone', '+1234567890');
      expect(response.body).toHaveProperty('businessEmail', 'test@company.com');
    });

    it('should validate company ID format', async () => {
      await request(app)
        .patch('/api/company/invalid-id')
        .send({ businessPhone: '+1234567890' })
        .expect(400);
    });

    it('should clear cache after update', async () => {
      const updateData = { businessWebsite: 'https://example.com' };

      await request(app)
        .patch(`/api/company/${testCompanyId}`)
        .send(updateData)
        .expect(200);

      // Verify the update is reflected
      const response = await request(app)
        .get(`/api/company/${testCompanyId}`)
        .expect(200);

      expect(response.body).toHaveProperty('businessWebsite', 'https://example.com');
    });
  });

  // ============================================================================
  // RATE LIMITING TESTS
  // ============================================================================

  describe('Rate Limiting', () => {
    it('should enforce rate limits on API endpoints', async () => {
      const requests = [];
      
      // Send 60 requests (limit is 50/min)
      for (let i = 0; i < 60; i++) {
        requests.push(
          request(app)
            .get('/health')
            .then(res => res.status)
        );
      }

      const results = await Promise.all(requests);
      
      // Some requests should be rate limited (429)
      const rateLimited = results.filter(status => status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);
    }, 15000); // Increase timeout for this test

    it('should include rate limit headers', async () => {
      const response = await request(app)
        .get(`/api/company/${testCompanyId}`)
        .expect(200);

      // Check for rate limit headers
      expect(response.headers).toHaveProperty('ratelimit-limit');
      expect(response.headers).toHaveProperty('ratelimit-remaining');
    });
  });

  // ============================================================================
  // MULTI-TENANT ISOLATION TESTS
  // ============================================================================

  describe('Multi-Tenant Isolation', () => {
    let company2Id;

    beforeAll(async () => {
      // Create second test company
      const company2 = new Company({
        companyName: 'Test Company 2',
        address: {
          street: '456 Test Ave',
          city: 'Test City',
          state: 'TS',
          zip: '67890',
          country: 'USA'
        },
        tradeCategories: ['Plumbing']
      });
      await company2.save();
      company2Id = company2._id.toString();
    });

    afterAll(async () => {
      await Company.findByIdAndDelete(company2Id);
    });

    it('should return different data for different companies', async () => {
      const response1 = await request(app)
        .get(`/api/company/${testCompanyId}`)
        .expect(200);

      const response2 = await request(app)
        .get(`/api/company/${company2Id}`)
        .expect(200);

      expect(response1.body._id).not.toEqual(response2.body._id);
      expect(response1.body.companyName).toEqual('Test Company API');
      expect(response2.body.companyName).toEqual('Test Company 2');
    });

    it('should have separate cache keys for different companies', async () => {
      // Request both companies
      await request(app).get(`/api/company/${testCompanyId}`).expect(200);
      await request(app).get(`/api/company/${company2Id}`).expect(200);

      // Update company 1
      await request(app)
        .patch(`/api/company/${testCompanyId}`)
        .send({ businessPhone: '+1111111111' })
        .expect(200);

      // Company 2 should still have old data (different cache key)
      const response2 = await request(app)
        .get(`/api/company/${company2Id}`)
        .expect(200);

      expect(response2.body.businessPhone).not.toEqual('+1111111111');
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    it('should return 500 for database errors', async () => {
      // Temporarily disconnect database
      await mongoose.connection.close();

      const response = await request(app)
        .get(`/api/company/${testCompanyId}`)
        .expect(500);

      expect(response.body).toHaveProperty('message');

      // Reconnect database
      await mongoose.connect(process.env.MONGODB_TEST_URI || process.env.MONGODB_URI);
    });

    it('should handle malformed JSON', async () => {
      const response = await request(app)
        .patch(`/api/company/${testCompanyId}`)
        .set('Content-Type', 'application/json')
        .send('{ invalid json }')
        .expect(400);

      expect(response.body).toHaveProperty('message');
    });

    it('should return proper error messages', async () => {
      const response = await request(app)
        .get('/api/company/000000000000000000000000')
        .expect(404);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('not found');
    });
  });
});

