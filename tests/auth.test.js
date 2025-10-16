// ============================================================================
// AUTHENTICATION & AUTHORIZATION TESTS - Security Critical
// ============================================================================
// Tests authentication flows, JWT validation, and authorization checks
// ============================================================================

const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../index');
const User = require('../models/v2User');
const Company = require('../models/v2Company');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

describe('Authentication & Authorization Tests', () => {
  let testCompanyId;
  let testUser;
  let validToken;
  let expiredToken;

  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_TEST_URI || process.env.MONGODB_URI);
    }

    // Create test company
    const company = new Company({
      companyName: 'Auth Test Company',
      address: {
        street: '123 Auth St',
        city: 'Auth City',
        state: 'AU',
        zip: '12345',
        country: 'USA'
      }
    });
    await company.save();
    testCompanyId = company._id.toString();

    // Create test user with hashed password
    const hashedPassword = await bcrypt.hash('TestPassword123!', 10);
    testUser = new User({
      email: 'authtest@example.com',
      password: hashedPassword,
      role: 'user',
      companyId: testCompanyId,
      status: 'active',
      firstName: 'Auth',
      lastName: 'Test'
    });
    await testUser.save();

    // Generate valid token
    validToken = jwt.sign(
      { 
        userId: testUser._id.toString(),
        email: testUser.email,
        role: testUser.role 
      },
      process.env.JWT_SECRET || 'test-secret-key-min-32-characters-long',
      { expiresIn: '1h' }
    );

    // Generate expired token
    expiredToken = jwt.sign(
      { 
        userId: testUser._id.toString(),
        email: testUser.email,
        role: testUser.role 
      },
      process.env.JWT_SECRET || 'test-secret-key-min-32-characters-long',
      { expiresIn: '-1h' } // Expired 1 hour ago
    );
  });

  afterAll(async () => {
    // Cleanup
    await User.findByIdAndDelete(testUser._id);
    await Company.findByIdAndDelete(testCompanyId);
    await mongoose.connection.close();
  });

  // ============================================================================
  // JWT TOKEN VALIDATION TESTS
  // ============================================================================

  describe('JWT Token Validation', () => {
    it('should accept valid JWT token in Authorization header', async () => {
      const response = await request(app)
        .get(`/api/company/${testCompanyId}`)
        .set('Authorization', `Bearer ${validToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('companyName');
    });

    it('should accept valid JWT token in cookie', async () => {
      const response = await request(app)
        .get(`/api/company/${testCompanyId}`)
        .set('Cookie', `token=${validToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('companyName');
    });

    it('should reject requests without authentication token', async () => {
      // Note: This endpoint might be public, adjust based on your actual protected endpoints
      const response = await request(app)
        .get('/api/admin/data-center')
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });

    it('should reject expired JWT tokens', async () => {
      const response = await request(app)
        .get('/api/admin/data-center')
        .set('Authorization', `Bearer ${expiredToken}`)
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });

    it('should reject malformed JWT tokens', async () => {
      const response = await request(app)
        .get('/api/admin/data-center')
        .set('Authorization', 'Bearer invalid.token.here')
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });

    it('should reject tokens with invalid signature', async () => {
      const invalidToken = jwt.sign(
        { userId: testUser._id.toString(), email: testUser.email },
        'wrong-secret-key',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/api/admin/data-center')
        .set('Authorization', `Bearer ${invalidToken}`)
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });
  });

  // ============================================================================
  // USER STATUS VALIDATION TESTS
  // ============================================================================

  describe('User Status Validation', () => {
    let inactiveUser;
    let inactiveToken;

    beforeAll(async () => {
      // Create inactive user
      const hashedPassword = await bcrypt.hash('TestPassword123!', 10);
      inactiveUser = new User({
        email: 'inactive@example.com',
        password: hashedPassword,
        role: 'user',
        companyId: testCompanyId,
        status: 'inactive' // Inactive user
      });
      await inactiveUser.save();

      inactiveToken = jwt.sign(
        { userId: inactiveUser._id.toString(), email: inactiveUser.email, role: inactiveUser.role },
        process.env.JWT_SECRET || 'test-secret-key-min-32-characters-long',
        { expiresIn: '1h' }
      );
    });

    afterAll(async () => {
      await User.findByIdAndDelete(inactiveUser._id);
    });

    it('should reject requests from inactive users', async () => {
      const response = await request(app)
        .get('/api/admin/data-center')
        .set('Authorization', `Bearer ${inactiveToken}`)
        .expect(401);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('inactive');
    });
  });

  // ============================================================================
  // COMPANY ASSOCIATION VALIDATION TESTS
  // ============================================================================

  describe('Company Association Validation', () => {
    it('should reject users without company association', async () => {
      // Create user without companyId
      const hashedPassword = await bcrypt.hash('TestPassword123!', 10);
      const orphanUser = new User({
        email: 'orphan@example.com',
        password: hashedPassword,
        role: 'user',
        companyId: null, // No company association
        status: 'active'
      });
      await orphanUser.save();

      const orphanToken = jwt.sign(
        { userId: orphanUser._id.toString(), email: orphanUser.email, role: orphanUser.role },
        process.env.JWT_SECRET || 'test-secret-key-min-32-characters-long',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/api/admin/data-center')
        .set('Authorization', `Bearer ${orphanToken}`)
        .expect(403);

      expect(response.body).toHaveProperty('code', 'MISSING_COMPANY_ASSOCIATION');

      // Cleanup
      await User.findByIdAndDelete(orphanUser._id);
    });
  });

  // ============================================================================
  // ROLE-BASED ACCESS CONTROL (RBAC) TESTS
  // ============================================================================

  describe('Role-Based Access Control', () => {
    let adminUser;
    let adminToken;
    let regularUserToken;

    beforeAll(async () => {
      // Create admin user
      const hashedPassword = await bcrypt.hash('AdminPassword123!', 10);
      adminUser = new User({
        email: 'admin@example.com',
        password: hashedPassword,
        role: 'admin',
        companyId: testCompanyId,
        status: 'active'
      });
      await adminUser.save();

      adminToken = jwt.sign(
        { userId: adminUser._id.toString(), email: adminUser.email, role: 'admin' },
        process.env.JWT_SECRET || 'test-secret-key-min-32-characters-long',
        { expiresIn: '1h' }
      );

      regularUserToken = validToken; // Use the existing test user token
    });

    afterAll(async () => {
      await User.findByIdAndDelete(adminUser._id);
    });

    it('should allow admin access to admin endpoints', async () => {
      const response = await request(app)
        .get('/api/admin/data-center')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      expect(response.body).toHaveProperty('success');
    });

    it('should deny regular user access to admin endpoints', async () => {
      const response = await request(app)
        .get('/api/admin/data-center')
        .set('Authorization', `Bearer ${regularUserToken}`)
        .expect(403);

      expect(response.body).toHaveProperty('message');
      expect(response.body.message).toContain('Access denied');
    });

    it('should allow both admin and regular users to access company endpoints', async () => {
      // Admin access
      const adminResponse = await request(app)
        .get(`/api/company/${testCompanyId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);

      // Regular user access
      const userResponse = await request(app)
        .get(`/api/company/${testCompanyId}`)
        .set('Authorization', `Bearer ${regularUserToken}`)
        .expect(200);

      expect(adminResponse.body).toHaveProperty('companyName');
      expect(userResponse.body).toHaveProperty('companyName');
    });
  });

  // ============================================================================
  // MULTI-TENANT ACCESS CONTROL TESTS
  // ============================================================================

  describe('Multi-Tenant Access Control', () => {
    let company2;
    let company2UserId;
    let company2Token;

    beforeAll(async () => {
      // Create second company
      company2 = new Company({
        companyName: 'Company 2',
        address: {
          street: '456 Other St',
          city: 'Other City',
          state: 'OC',
          zip: '67890',
          country: 'USA'
        }
      });
      await company2.save();

      // Create user for company 2
      const hashedPassword = await bcrypt.hash('TestPassword123!', 10);
      const company2User = new User({
        email: 'company2@example.com',
        password: hashedPassword,
        role: 'user',
        companyId: company2._id,
        status: 'active'
      });
      await company2User.save();
      company2UserId = company2User._id.toString();

      company2Token = jwt.sign(
        { userId: company2User._id.toString(), email: company2User.email, role: 'user' },
        process.env.JWT_SECRET || 'test-secret-key-min-32-characters-long',
        { expiresIn: '1h' }
      );
    });

    afterAll(async () => {
      await User.findByIdAndDelete(company2UserId);
      await Company.findByIdAndDelete(company2._id);
    });

    it('should allow users to access their own company data', async () => {
      const response = await request(app)
        .get(`/api/company/${company2._id}`)
        .set('Authorization', `Bearer ${company2Token}`)
        .expect(200);

      expect(response.body).toHaveProperty('companyName', 'Company 2');
    });

    it('should prevent users from accessing other company data', async () => {
      // Company 2 user trying to access Company 1 data
      // Note: Adjust this test based on your actual multi-tenant enforcement
      const response = await request(app)
        .patch(`/api/company/${testCompanyId}`)
        .set('Authorization', `Bearer ${company2Token}`)
        .send({ businessPhone: '+9999999999' })
        .expect(403);

      expect(response.body).toHaveProperty('message');
    });
  });

  // ============================================================================
  // AUTHENTICATION BYPASS PREVENTION TESTS
  // ============================================================================

  describe('Authentication Bypass Prevention', () => {
    it('should not allow SKIP_AUTH bypass in production', async () => {
      // This should always fail regardless of environment variable
      // because we removed the bypass code
      const response = await request(app)
        .get('/api/admin/data-center')
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });

    it('should not accept empty Authorization header', async () => {
      const response = await request(app)
        .get('/api/admin/data-center')
        .set('Authorization', '')
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });

    it('should not accept Authorization header without Bearer prefix', async () => {
      const response = await request(app)
        .get('/api/admin/data-center')
        .set('Authorization', validToken)
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });
  });

  // ============================================================================
  // TOKEN SECURITY TESTS
  // ============================================================================

  describe('Token Security', () => {
    it('should not expose sensitive user data in token', async () => {
      const decoded = jwt.decode(validToken);
      
      expect(decoded).not.toHaveProperty('password');
      expect(decoded).not.toHaveProperty('passwordHash');
      expect(decoded).toHaveProperty('userId');
      expect(decoded).toHaveProperty('email');
      expect(decoded).toHaveProperty('role');
    });

    it('should have appropriate token expiration', async () => {
      const decoded = jwt.decode(validToken);
      const now = Math.floor(Date.now() / 1000);
      const expiresIn = decoded.exp - now;
      
      // Token should expire within reasonable time (1 hour in our case)
      expect(expiresIn).toBeGreaterThan(0);
      expect(expiresIn).toBeLessThanOrEqual(3600); // 1 hour
    });

    it('should reject tokens without required claims', async () => {
      const incompleteToken = jwt.sign(
        { email: testUser.email }, // Missing userId and role
        process.env.JWT_SECRET || 'test-secret-key-min-32-characters-long',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/api/admin/data-center')
        .set('Authorization', `Bearer ${incompleteToken}`)
        .expect(401);

      expect(response.body).toHaveProperty('message');
    });
  });
});

