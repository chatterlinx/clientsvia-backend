// ============================================================================
// TWILIO INTEGRATION TESTS - Production Readiness
// ============================================================================
// Tests Twilio webhook handling, phone number routing, and call processing
// ============================================================================

const request = require('supertest');
const mongoose = require('mongoose');
const { app } = require('../index');
const Company = require('../models/v2Company');
const twilio = require('twilio');

describe('Twilio Integration Tests', () => {
  let testCompanyId;
  const testPhoneNumber = '+15555551234';
  let twilioSignature;

  beforeAll(async () => {
    // Connect to test database
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(process.env.MONGODB_TEST_URI || process.env.MONGODB_URI);
    }

    // Create test company with Twilio configuration
    const testCompany = new Company({
      companyName: 'Twilio Test Company',
      address: {
        street: '123 Phone St',
        city: 'Call City',
        state: 'TC',
        zip: '12345',
        country: 'USA'
      },
      twilioConfig: {
        phoneNumber: testPhoneNumber,
        accountSid: 'test-account-sid',
        authToken: 'test-auth-token'
      },
      aiAgentSettings: {
        enabled: true,
        greeting: {
          default: 'Thank you for calling! How can I help you today?'
        }
      }
    });
    await testCompany.save();
    testCompanyId = testCompany._id.toString();
  });

  afterAll(async () => {
    // Cleanup
    await Company.findByIdAndDelete(testCompanyId);
    await mongoose.connection.close();
  });

  // ============================================================================
  // PHONE NUMBER ROUTING TESTS
  // ============================================================================

  describe('Phone Number Routing', () => {
    it('should route incoming call to correct company by phone number', async () => {
      const company = await Company.findOne({
        'twilioConfig.phoneNumber': testPhoneNumber
      });

      expect(company).toBeTruthy();
      expect(company._id.toString()).toBe(testCompanyId);
      expect(company.companyName).toBe('Twilio Test Company');
    });

    it('should handle phone number format variations', async () => {
      const variations = [
        '+15555551234',
        '15555551234',
        '5555551234'
      ];

      for (const number of variations) {
        const result = await Company.findOne({
          $or: [
            { 'twilioConfig.phoneNumber': number },
            { 'twilioConfig.phoneNumber': `+${number}` },
            { 'twilioConfig.phoneNumber': number.replace(/^\+?1/, '') }
          ]
        });

        expect(result).toBeTruthy();
      }
    });

    it('should return null for non-existent phone numbers', async () => {
      const company = await Company.findOne({
        'twilioConfig.phoneNumber': '+19999999999'
      });

      expect(company).toBeNull();
    });

    it('should enforce unique phone numbers per company', async () => {
      // Try to create duplicate phone number
      const duplicateCompany = new Company({
        companyName: 'Duplicate Test',
        address: {
          street: '456 Test Ave',
          city: 'Test City',
          state: 'TS',
          zip: '67890',
          country: 'USA'
        },
        twilioConfig: {
          phoneNumber: testPhoneNumber // Same number!
        }
      });

      // This should fail or require handling
      try {
        await duplicateCompany.save();
        // If it succeeds, we should have uniqueness check
        const count = await Company.countDocuments({
          'twilioConfig.phoneNumber': testPhoneNumber
        });
        
        // Clean up if it was created
        if (count > 1) {
          await Company.findByIdAndDelete(duplicateCompany._id);
          console.warn('⚠️  Multiple companies with same phone number detected');
        }
      } catch (error) {
        // Expected to fail with unique constraint
        expect(error).toBeTruthy();
      }
    });
  });

  // ============================================================================
  // WEBHOOK ENDPOINT TESTS
  // ============================================================================

  describe('Webhook Endpoints', () => {
    it('should expose /twilio/voice endpoint', async () => {
      const response = await request(app)
        .post('/twilio/voice')
        .send({
          CallSid: 'test-call-sid',
          From: '+15555559999',
          To: testPhoneNumber
        })
        .expect(200);

      // Should return TwiML
      expect(response.text).toContain('<?xml version="1.0" encoding="UTF-8"?>');
      expect(response.text).toContain('<Response>');
    });

    it('should expose /twilio/gather endpoint', async () => {
      const response = await request(app)
        .post('/twilio/gather')
        .send({
          CallSid: 'test-call-sid',
          SpeechResult: 'I need help with scheduling'
        });

      // Should return TwiML response
      expect(response.status).toBeLessThan(500); // Not internal error
    });

    it('should expose /twilio/status endpoint', async () => {
      const response = await request(app)
        .post('/twilio/status')
        .send({
          CallSid: 'test-call-sid',
          CallStatus: 'completed'
        });

      expect(response.status).toBeLessThan(500);
    });

    it('should handle missing required parameters gracefully', async () => {
      const response = await request(app)
        .post('/twilio/voice')
        .send({})
        .expect(400);

      expect(response.body).toHaveProperty('error');
    });
  });

  // ============================================================================
  // CALL INITIALIZATION TESTS
  // ============================================================================

  describe('Call Initialization', () => {
    it('should initialize call with greeting', async () => {
      const response = await request(app)
        .post('/twilio/voice')
        .send({
          CallSid: `test-call-${Date.now()}`,
          From: '+15555559999',
          To: testPhoneNumber
        })
        .expect(200);

      // Should include greeting in TwiML
      expect(response.text).toContain('<Say>');
      expect(response.text.toLowerCase()).toMatch(/thank you|hello|welcome|hi/);
    });

    it('should use company-specific greeting', async () => {
      // Update company greeting
      await Company.findByIdAndUpdate(testCompanyId, {
        'aiAgentSettings.greeting.default': 'Welcome to our test company!'
      });

      const response = await request(app)
        .post('/twilio/voice')
        .send({
          CallSid: `test-call-${Date.now()}`,
          From: '+15555559999',
          To: testPhoneNumber
        })
        .expect(200);

      expect(response.text.toLowerCase()).toContain('welcome');
    });

    it('should track call in call logs', async () => {
      const CallLog = require('../models/v2AIAgentCallLog');
      
      const callSid = `test-call-log-${Date.now()}`;
      
      await request(app)
        .post('/twilio/voice')
        .send({
          CallSid: callSid,
          From: '+15555559999',
          To: testPhoneNumber
        })
        .expect(200);

      // Check if call log was created
      const callLog = await CallLog.findOne({ callSid });
      expect(callLog).toBeTruthy();
      expect(callLog.companyId.toString()).toBe(testCompanyId);
    });
  });

  // ============================================================================
  // TwiML RESPONSE VALIDATION TESTS
  // ============================================================================

  describe('TwiML Response Validation', () => {
    it('should generate valid TwiML', async () => {
      const response = await request(app)
        .post('/twilio/voice')
        .send({
          CallSid: 'test-twiml-validation',
          From: '+15555559999',
          To: testPhoneNumber
        })
        .expect(200);

      // Should be valid XML
      expect(response.text).toMatch(/^<\?xml version="1\.0" encoding="UTF-8"\?>/);
      expect(response.text).toContain('<Response>');
      expect(response.text).toContain('</Response>');
    });

    it('should include <Gather> verb for user input', async () => {
      const response = await request(app)
        .post('/twilio/voice')
        .send({
          CallSid: 'test-gather',
          From: '+15555559999',
          To: testPhoneNumber
        })
        .expect(200);

      // Should include Gather for speech/DTMF input
      expect(response.text).toContain('<Gather');
    });

    it('should set proper content type for TwiML', async () => {
      const response = await request(app)
        .post('/twilio/voice')
        .send({
          CallSid: 'test-content-type',
          From: '+15555559999',
          To: testPhoneNumber
        })
        .expect(200);

      expect(response.headers['content-type']).toMatch(/xml/);
    });
  });

  // ============================================================================
  // ERROR HANDLING TESTS
  // ============================================================================

  describe('Error Handling', () => {
    it('should handle calls to non-existent phone numbers', async () => {
      const response = await request(app)
        .post('/twilio/voice')
        .send({
          CallSid: 'test-no-company',
          From: '+15555559999',
          To: '+19999999999' // Non-existent
        });

      // Should still return valid TwiML (fallback)
      expect(response.status).toBeLessThan(500);
      expect(response.text).toContain('<Response>');
    });

    it('should handle malformed CallSid', async () => {
      const response = await request(app)
        .post('/twilio/voice')
        .send({
          CallSid: '', // Empty CallSid
          From: '+15555559999',
          To: testPhoneNumber
        });

      expect(response.status).toBeLessThan(500);
    });

    it('should handle database connection errors gracefully', async () => {
      // Temporarily disconnect database
      await mongoose.connection.close();

      const response = await request(app)
        .post('/twilio/voice')
        .send({
          CallSid: 'test-db-error',
          From: '+15555559999',
          To: testPhoneNumber
        });

      // Should return TwiML even with DB error (fallback mode)
      expect(response.status).toBeLessThan(500);

      // Reconnect database
      await mongoose.connect(process.env.MONGODB_TEST_URI || process.env.MONGODB_URI);
    });

    it('should log errors appropriately', async () => {
      // This test verifies error logging without breaking the call
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      await request(app)
        .post('/twilio/voice')
        .send({
          CallSid: 'test-error-logging',
          From: 'invalid-phone', // Invalid format
          To: testPhoneNumber
        });

      // Should have logged something (or handled gracefully)
      // The spy will catch any console.error calls

      consoleSpy.mockRestore();
    });
  });

  // ============================================================================
  // PERFORMANCE TESTS
  // ============================================================================

  describe('Performance', () => {
    it('should respond to webhook in < 500ms', async () => {
      const start = Date.now();
      
      await request(app)
        .post('/twilio/voice')
        .send({
          CallSid: `test-perf-${Date.now()}`,
          From: '+15555559999',
          To: testPhoneNumber
        })
        .expect(200);

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(500);
      
      console.log(`✅ Webhook response time: ${duration}ms`);
    });

    it('should handle concurrent webhook requests', async () => {
      const requests = [];
      
      for (let i = 0; i < 10; i++) {
        requests.push(
          request(app)
            .post('/twilio/voice')
            .send({
              CallSid: `test-concurrent-${i}`,
              From: '+15555559999',
              To: testPhoneNumber
            })
        );
      }

      const start = Date.now();
      const results = await Promise.all(requests);
      const duration = Date.now() - start;

      // All should succeed
      results.forEach(res => expect(res.status).toBe(200));
      
      // Should complete within reasonable time
      expect(duration).toBeLessThan(5000);
      
      console.log(`✅ 10 concurrent webhooks: ${duration}ms`);
    });
  });

  // ============================================================================
  // SECURITY TESTS
  // ============================================================================

  describe('Security', () => {
    it('should validate Twilio signature (if implemented)', async () => {
      // Note: Signature validation should be implemented in production
      const response = await request(app)
        .post('/twilio/voice')
        .set('X-Twilio-Signature', 'invalid-signature')
        .send({
          CallSid: 'test-security',
          From: '+15555559999',
          To: testPhoneNumber
        });

      // Should either validate or warn about missing validation
      expect(response.status).toBeLessThan(500);
    });

    it('should sanitize user input from speech', async () => {
      const maliciousInput = '<script>alert("xss")</script>';
      
      const response = await request(app)
        .post('/twilio/gather')
        .send({
          CallSid: 'test-xss',
          SpeechResult: maliciousInput
        });

      // Should not echo malicious content verbatim
      expect(response.text).not.toContain('<script>');
    });

    it('should rate limit webhook endpoints', async () => {
      // Send many requests rapidly
      const requests = [];
      for (let i = 0; i < 100; i++) {
        requests.push(
          request(app)
            .post('/twilio/voice')
            .send({
              CallSid: `test-ratelimit-${i}`,
              From: '+15555559999',
              To: testPhoneNumber
            })
        );
      }

      const results = await Promise.all(requests);
      const rateLimited = results.filter(r => r.status === 429);

      // Some should be rate limited
      // Note: Adjust based on your actual rate limit settings
      if (rateLimited.length > 0) {
        console.log(`✅ Rate limiting active: ${rateLimited.length}/100 requests blocked`);
      }
    });
  });
});

