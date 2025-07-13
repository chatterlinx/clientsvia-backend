/**
 * Agent Efficiency Test Suite
 * Tests the agent's ability to efficiently access all platform services
 */

const { 
  answerQuestion, 
  AgentDataAccess, 
  generateWorkflowAwareResponse 
} = require('../services/agent');
const Contact = require('../models/Contact');
const Workflow = require('../models/Workflow');
const Action = require('../models/Action');
const { getDB } = require('../db');

describe('Agent Efficiency and Service Access', () => {
  let testCompanyId;
  let testContact;
  let testWorkflow;
  let dataAccess;

  beforeEach(async () => {
    // Set up test data
    const db = getDB();
    
    // Create test company
    const company = await db.collection('companiesCollection').insertOne({
      companyName: 'Test HVAC Company',
      agentSetup: {
        categories: ['HVAC Repair', 'Maintenance', 'Installation'],
        schedulingRules: [
          {
            serviceName: 'HVAC Repair',
            duration: 120,
            availableSlots: ['09:00-11:00', '13:00-15:00']
          }
        ],
        placeholders: [
          { key: 'COMPANY_NAME', value: 'Test HVAC Company' },
          { key: 'PHONE', value: '555-0123' }
        ]
      },
      aiSettings: {
        llmFallbackEnabled: true,
        personality: 'professional'
      }
    });
    testCompanyId = company.insertedId.toString();

    // Create test contact
    testContact = new Contact({
      phoneNumber: '+15551234567',
      displayName: 'John Doe',
      interactions: [{
        twilioCallSid: 'test-call-sid-123',
        timestamp: new Date(),
        type: 'incoming_call'
      }],
      serviceRequests: []
    });
    await testContact.save();

    // Create test workflow
    testWorkflow = new Workflow({
      companyId: testCompanyId,
      name: 'Emergency Response Workflow',
      description: 'Handles emergency service requests',
      isActive: true,
      triggers: [
        {
          type: 'emergency',
          keywords: ['emergency', 'urgent', 'broken']
        },
        {
          type: 'service_request',
          keywords: ['schedule', 'appointment', 'repair']
        }
      ],
      actions: [
        {
          type: 'send_notification',
          config: {
            message: 'Emergency service request received',
            urgency: 'high'
          }
        }
      ]
    });
    await testWorkflow.save();

    // Initialize data access
    dataAccess = new AgentDataAccess(testCompanyId);
  });

  afterEach(async () => {
    // Clean up test data
    const db = getDB();
    await db.collection('companiesCollection').deleteOne({ _id: testCompanyId });
    await Contact.deleteOne({ _id: testContact._id });
    await Workflow.deleteOne({ _id: testWorkflow._id });
  });

  describe('AgentDataAccess Efficiency', () => {
    test('should efficiently cache and access company data', async () => {
      const startTime = Date.now();
      
      // First call - should fetch from database
      const company1 = await dataAccess.getCompany();
      const time1 = Date.now() - startTime;
      
      // Second call - should use cache
      const company2 = await dataAccess.getCompany();
      const time2 = Date.now() - startTime - time1;
      
      expect(company1).toEqual(company2);
      expect(time2).toBeLessThan(time1); // Cache should be faster
      expect(company1.companyName).toBe('Test HVAC Company');
    });

    test('should efficiently find contacts by call SID', async () => {
      const contact = await dataAccess.getContactByCallSid('test-call-sid-123');
      
      expect(contact).toBeTruthy();
      expect(contact.displayName).toBe('John Doe');
      expect(contact.phoneNumber).toBe('+15551234567');
    });

    test('should efficiently access active workflows', async () => {
      const workflows = await dataAccess.getActiveWorkflows();
      
      expect(workflows).toBeTruthy();
      expect(workflows.length).toBeGreaterThan(0);
      expect(workflows[0].name).toBe('Emergency Response Workflow');
    });

    test('should detect workflow triggers efficiently', async () => {
      const contact = await dataAccess.getContactByCallSid('test-call-sid-123');
      
      // Test emergency trigger
      const emergencyTriggers = await dataAccess.checkForWorkflowTriggers(
        'I have an emergency with my heater!',
        contact,
        'test-call-sid-123'
      );
      
      expect(emergencyTriggers.length).toBeGreaterThan(0);
      expect(emergencyTriggers[0].trigger.type).toBe('emergency');
      
      // Test service request trigger
      const serviceTriggers = await dataAccess.checkForWorkflowTriggers(
        'I need to schedule a repair appointment',
        contact,
        'test-call-sid-123'
      );
      
      expect(serviceTriggers.length).toBeGreaterThan(0);
      expect(serviceTriggers[0].trigger.type).toBe('service_request');
    });
  });

  describe('Complete Agent Response Flow', () => {
    test('should handle emergency request with workflow integration', async () => {
      const question = 'Emergency! My heater is broken and not working at all!';
      
      const startTime = Date.now();
      const response = await answerQuestion(
        testCompanyId,
        question,
        'concise',
        [],
        '',
        'professional',
        'HVAC services',
        '',
        'test-call-sid-123'
      );
      const responseTime = Date.now() - startTime;
      
      expect(response).toBeTruthy();
      expect(response.text).toBeTruthy();
      expect(responseTime).toBeLessThan(5000); // Should respond within 5 seconds
      
      // Should indicate emergency handling
      expect(response.text.toLowerCase()).toMatch(/emergency|urgent|immediately/);
    });

    test('should handle scheduling request with contact context', async () => {
      const question = 'I need to schedule a maintenance appointment for my HVAC system';
      
      const startTime = Date.now();
      const response = await answerQuestion(
        testCompanyId,
        question,
        'detailed',
        [],
        '',
        'friendly',
        'HVAC maintenance and repair services',
        '',
        'test-call-sid-123'
      );
      const responseTime = Date.now() - startTime;
      
      expect(response).toBeTruthy();
      expect(response.text).toBeTruthy();
      expect(responseTime).toBeLessThan(3000); // Should respond within 3 seconds
      
      // Should indicate scheduling capability
      expect(response.text.toLowerCase()).toMatch(/schedule|appointment|maintenance/);
    });

    test('should handle general inquiry efficiently', async () => {
      const question = 'What HVAC services do you offer?';
      
      const startTime = Date.now();
      const response = await answerQuestion(
        testCompanyId,
        question,
        'concise',
        [],
        '',
        'professional',
        'Complete HVAC services including repair, maintenance, and installation',
        '',
        'test-call-sid-123'
      );
      const responseTime = Date.now() - startTime;
      
      expect(response).toBeTruthy();
      expect(response.text).toBeTruthy();
      expect(responseTime).toBeLessThan(2000); // Should respond within 2 seconds
    });
  });

  describe('Workflow-Aware Response Generation', () => {
    test('should generate workflow-aware emergency response', async () => {
      const contact = await dataAccess.getContactByCallSid('test-call-sid-123');
      
      const response = await generateWorkflowAwareResponse(
        dataAccess,
        'Emergency! My AC broke down completely!',
        contact,
        'test-call-sid-123'
      );
      
      expect(response).toBeTruthy();
      expect(response.toLowerCase()).toMatch(/emergency|escalated|immediately/);
    });

    test('should generate workflow-aware service request response', async () => {
      const contact = await dataAccess.getContactByCallSid('test-call-sid-123');
      
      const response = await generateWorkflowAwareResponse(
        dataAccess,
        'I need to schedule a repair for tomorrow',
        contact,
        'test-call-sid-123'
      );
      
      expect(response).toBeTruthy();
      expect(response.toLowerCase()).toMatch(/service request|schedule|appointment/);
    });
  });

  describe('Performance Benchmarks', () => {
    test('should access all services within performance thresholds', async () => {
      const benchmarks = {};
      
      // Benchmark company data access
      let start = Date.now();
      await dataAccess.getCompany();
      benchmarks.companyAccess = Date.now() - start;
      
      // Benchmark contact lookup
      start = Date.now();
      await dataAccess.getContactByCallSid('test-call-sid-123');
      benchmarks.contactLookup = Date.now() - start;
      
      // Benchmark workflow access
      start = Date.now();
      await dataAccess.getActiveWorkflows();
      benchmarks.workflowAccess = Date.now() - start;
      
      // Benchmark complete response generation
      start = Date.now();
      await answerQuestion(
        testCompanyId,
        'What are your hours?',
        'concise',
        [],
        '',
        'friendly',
        '',
        '',
        'test-call-sid-123'
      );
      benchmarks.completeResponse = Date.now() - start;
      
      console.log('Performance Benchmarks:', benchmarks);
      
      // Assert performance thresholds
      expect(benchmarks.companyAccess).toBeLessThan(100); // < 100ms
      expect(benchmarks.contactLookup).toBeLessThan(200); // < 200ms
      expect(benchmarks.workflowAccess).toBeLessThan(300); // < 300ms
      expect(benchmarks.completeResponse).toBeLessThan(3000); // < 3s
    });
  });

  describe('Multi-Service Integration', () => {
    test('should seamlessly integrate all services in single response', async () => {
      const question = 'Emergency! Schedule urgent repair for broken heater ASAP!';
      
      const response = await answerQuestion(
        testCompanyId,
        question,
        'detailed',
        [],
        'Welcome to Test HVAC Company. We provide 24/7 emergency services.',
        'professional',
        'Emergency HVAC repair, maintenance, and installation services',
        'Q: Do you provide emergency service? A: Yes, we offer 24/7 emergency HVAC services.',
        'test-call-sid-123'
      );
      
      expect(response).toBeTruthy();
      expect(response.text).toBeTruthy();
      
      // Should demonstrate integration of:
      // 1. Contact management (found by call SID)
      // 2. Workflow triggers (emergency detected)
      // 3. Scheduling intelligence (urgent appointment)
      // 4. Knowledge base (company capabilities)
      // 5. Agent personality (professional tone)
      
      const text = response.text.toLowerCase();
      expect(text).toMatch(/emergency|urgent/); // Workflow integration
      expect(text).toMatch(/heater|repair/); // Service understanding
    });
  });
});

/**
 * AGENT EFFICIENCY SUMMARY:
 * 
 * The enhanced agent now has streamlined access to:
 * 
 * 1. COMPANY DATA - Cached access to all company settings, agent setup, scheduling rules
 * 2. CONTACT MANAGEMENT - Efficient lookup by call SID, service request tracking
 * 3. WORKFLOW ORCHESTRATION - Automatic workflow triggers, execution, and responses
 * 4. SCHEDULING INTELLIGENCE - Real-time availability, booking, and coordination
 * 5. KNOWLEDGE BASE - Fast Q&A matching, fuzzy search, contextual responses
 * 6. AI PROCESSING - Optimized prompts, response generation, and personality integration
 * 
 * PERFORMANCE TARGETS:
 * - Company data access: < 100ms (cached after first load)
 * - Contact lookup: < 200ms
 * - Workflow processing: < 300ms  
 * - Complete response: < 3 seconds
 * 
 * INTEGRATION BENEFITS:
 * - Single data access layer eliminates redundant database calls
 * - Workflow triggers automatically detected and executed
 * - Contact context enhances personalization and service quality
 * - Scheduling intelligence provides real availability information
 * - All services work together seamlessly for optimal customer experience
 */
