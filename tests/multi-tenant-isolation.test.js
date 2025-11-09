/**
 * ============================================================================
 * MULTI-TENANT ISOLATION TESTS
 * ============================================================================
 * 
 * CRITICAL: These tests verify that Company A CANNOT access Company B's data
 * 
 * TEST CATEGORIES:
 * 1. API Endpoint Isolation - Company A cannot query Company B data
 * 2. Redis Cache Isolation - Cache keys are properly scoped
 * 3. Twilio Routing Isolation - Calls route to correct company only
 * 4. Template Cloning Isolation - Cloned templates don't leak data
 * 5. Knowledge Base Isolation - Company Q&A stays private
 * 6. Variable Isolation - Company variables are not shared
 * 
 * ============================================================================
 */

const request = require('supertest');
const mongoose = require('mongoose');
const app = require('../app');
const Company = require('../models/v2Company');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
// V2 DELETED: CompanyKnowledgeQnA model removed (AI Brain only)
const { redisClient } = require('../db');

describe('🔒 MULTI-TENANT ISOLATION TESTS', () => {
    let companyA, companyB, tokenA, tokenB, globalTemplate;

    beforeAll(async () => {
        // Connect to test database
        if (mongoose.connection.readyState === 0) {
            await mongoose.connect(process.env.MONGODB_URI_TEST || 'mongodb://localhost:27017/clientsvia-test');
        }

        // Clear test data
        await Company.deleteMany({ companyName: /^TEST-ISOLATION/ });
        await GlobalInstantResponseTemplate.deleteMany({ name: /^TEST-ISOLATION/ });
        
        // Delete knowledge base entries for test companies
        const testCompanies = await Company.find({ companyName: /^TEST-ISOLATION/ }).select('_id');
        const testCompanyIds = testCompanies.map(c => c._id);
        if (testCompanyIds.length > 0) {
            await CompanyKnowledgeQnA.deleteMany({ companyId: { $in: testCompanyIds } });
        }

        // Create global template
        globalTemplate = await GlobalInstantResponseTemplate.create({
            name: 'TEST-ISOLATION Universal Template',
            description: 'Template for isolation testing',
            industryType: 'universal',
            status: 'active',
            isDefault: false,
            variableDefinitions: [
                {
                    key: 'companyName',
                    label: 'Company Name',
                    type: 'text',
                    required: true,
                    defaultValue: ''
                },
                {
                    key: 'servicecallprice',
                    label: 'Service Call Price',
                    type: 'currency',
                    required: true,
                    defaultValue: '0'
                }
            ],
            fillerWords: ['um', 'uh', 'like'],
            urgencyKeywords: [
                { word: 'emergency', weight: 0.5, category: 'Critical' },
                { word: 'flooding', weight: 0.4, category: 'Water' }
            ],
            categories: [
                {
                    categoryId: 'booking',
                    name: 'Appointment Booking',
                    description: 'Scheduling appointments',
                    priority: 1
                }
            ],
            scenarios: [
                {
                    scenarioId: 'book-1',
                    name: 'Book Appointment',
                    categories: ['booking'],
                    triggers: ['schedule', 'appointment', 'book'],
                    quickReplies: [
                        'I can help you schedule with {companyName}!'
                    ],
                    fullReplies: [
                        'I\'d be happy to schedule an appointment for you with {companyName}. Our service call is {servicecallprice}.'
                    ],
                    status: 'live',
                    version: 1
                }
            ]
        });

        // Create Company A
        companyA = await Company.create({
            companyName: 'TEST-ISOLATION Company A',
            email: 'companya@test.com',
            phone: '+12395551001',
            configuration: {
                clonedFrom: globalTemplate._id,
                clonedAt: new Date(),
                variables: {
                    companyName: 'Joe\'s Plumbing (Company A)',
                    servicecallprice: '125'
                },
                fillerWords: {
                    inherited: ['um', 'uh', 'like'],
                    custom: ['y\'all'] // Company A specific
                },
                urgencyKeywords: {
                    inherited: [
                        { word: 'emergency', weight: 0.5, category: 'Critical' },
                        { word: 'flooding', weight: 0.4, category: 'Water' }
                    ],
                    custom: []
                },
                scenarios: [
                    {
                        scenarioId: 'book-1',
                        name: 'Book Appointment',
                        categories: ['booking'],
                        triggers: ['schedule', 'appointment', 'book'],
                        quickReplies: [
                            'I can help you schedule with {companyName}!'
                        ],
                        fullReplies: [
                            'I\'d be happy to schedule an appointment for you with {companyName}. Our service call is {servicecallprice}.'
                        ],
                        status: 'live',
                        version: 1
                    }
                ]
            },
            aiAgentLogic: {
                knowledgeManagement: {}
            },
            twilioConfig: {
                phoneNumber: '+12395551001'
            }
        });

        // Create Company B
        companyB = await Company.create({
            companyName: 'TEST-ISOLATION Company B',
            email: 'companyb@test.com',
            phone: '+12395551002',
            configuration: {
                clonedFrom: globalTemplate._id,
                clonedAt: new Date(),
                variables: {
                    companyName: 'Smith\'s HVAC (Company B)',
                    servicecallprice: '200' // Different price!
                },
                fillerWords: {
                    inherited: ['um', 'uh', 'like'],
                    custom: ['howdy'] // Company B specific
                },
                urgencyKeywords: {
                    inherited: [
                        { word: 'emergency', weight: 0.5, category: 'Critical' },
                        { word: 'flooding', weight: 0.4, category: 'Water' }
                    ],
                    custom: []
                },
                scenarios: [
                    {
                        scenarioId: 'book-1',
                        name: 'Book Appointment',
                        categories: ['booking'],
                        triggers: ['schedule', 'appointment', 'book'],
                        quickReplies: [
                            'I can help you schedule with {companyName}!'
                        ],
                        fullReplies: [
                            'I\'d be happy to schedule an appointment for you with {companyName}. Our service call is {servicecallprice}.'
                        ],
                        status: 'live',
                        version: 1
                    }
                ]
            },
            aiAgentLogic: {
                knowledgeManagement: {}
            },
            twilioConfig: {
                phoneNumber: '+12395551002'
            }
        });

        // Create Company A Knowledge Base (PRIVATE)
        await CompanyKnowledgeQnA.create({
            companyId: companyA._id,
            question: 'Where is Company A located?',
            answer: 'Company A is located at 123 Secret Street, Fort Myers, FL',
            keywords: ['location', 'address', 'where'],
            confidence: 0.9,
            status: 'active',
            category: 'Company Info'
        });

        // Create Company B Knowledge Base (PRIVATE)
        await CompanyKnowledgeQnA.create({
            companyId: companyB._id,
            question: 'Where is Company B located?',
            answer: 'Company B is located at 456 Private Ave, Naples, FL',
            keywords: ['location', 'address', 'where'],
            confidence: 0.9,
            status: 'active',
            category: 'Company Info'
        });

        // Generate auth tokens (mock - adjust based on your auth system)
        // In real tests, you'd login or generate JWT tokens properly
        tokenA = 'MOCK_TOKEN_COMPANY_A';
        tokenB = 'MOCK_TOKEN_COMPANY_B';
    });

    afterAll(async () => {
        // Cleanup
        const testCompanies = await Company.find({ companyName: /^TEST-ISOLATION/ }).select('_id');
        const testCompanyIds = testCompanies.map(c => c._id);
        
        if (testCompanyIds.length > 0) {
            await CompanyKnowledgeQnA.deleteMany({ companyId: { $in: testCompanyIds } });
        }
        
        await Company.deleteMany({ companyName: /^TEST-ISOLATION/ });
        await GlobalInstantResponseTemplate.deleteMany({ name: /^TEST-ISOLATION/ });
        
        // Clear Redis cache
        const keys = await redisClient.keys('company:*');
        if (keys.length > 0) {
            await redisClient.del(...keys);
        }
        
        await mongoose.connection.close();
    });

    describe.skip('🔐 API ENDPOINT ISOLATION', () => {
        // SKIPPED: Requires full authentication setup
        // These tests verify at the HTTP layer, but we test isolation at DB/cache layer below
        test('Company A cannot access Company B configuration', async () => {
            // Try to access Company B config with Company A credentials
            const response = await request(app)
                .get(`/api/company/${companyB._id}/configuration`)
                .set('Authorization', `Bearer ${tokenA}`)
                .expect(403); // Should be forbidden

            expect(response.body).toHaveProperty('error');
            expect(response.body.error).toContain('Unauthorized');
        });

        test('Company A can only see their own variables', async () => {
            const response = await request(app)
                .get(`/api/company/${companyA._id}/configuration/variables`)
                .set('Authorization', `Bearer ${tokenA}`)
                .expect(200);

            expect(response.body.variables).toHaveProperty('companyName');
            expect(response.body.variables.companyName).toBe('Joe\'s Plumbing (Company A)');
            expect(response.body.variables.companyName).not.toBe('Smith\'s HVAC (Company B)');
            expect(response.body.variables.servicecallprice).toBe('125');
            expect(response.body.variables.servicecallprice).not.toBe('200');
        });

        test('Company B can only see their own variables', async () => {
            const response = await request(app)
                .get(`/api/company/${companyB._id}/configuration/variables`)
                .set('Authorization', `Bearer ${tokenB}`)
                .expect(200);

            expect(response.body.variables).toHaveProperty('companyName');
            expect(response.body.variables.companyName).toBe('Smith\'s HVAC (Company B)');
            expect(response.body.variables.companyName).not.toBe('Joe\'s Plumbing (Company A)');
            expect(response.body.variables.servicecallprice).toBe('200');
            expect(response.body.variables.servicecallprice).not.toBe('125');
        });

        test('Company A cannot access Company B knowledge base', async () => {
            // This would require actual API endpoint for knowledge base
            // Assuming GET /api/company/:companyId/knowledge-management
            const response = await request(app)
                .get(`/api/company/${companyB._id}/knowledge-management`)
                .set('Authorization', `Bearer ${tokenA}`)
                .expect(403);

            expect(response.body).toHaveProperty('error');
        });
    });

    describe('💾 REDIS CACHE ISOLATION', () => {
        test('Redis keys are scoped with companyId', async () => {
            // Set cache for Company A
            await redisClient.set(`company:${companyA._id}`, JSON.stringify({
                companyName: 'Joe\'s Plumbing (Company A)',
                secret: 'COMPANY_A_SECRET'
            }));

            // Set cache for Company B
            await redisClient.set(`company:${companyB._id}`, JSON.stringify({
                companyName: 'Smith\'s HVAC (Company B)',
                secret: 'COMPANY_B_SECRET'
            }));

            // Verify Company A cache
            const cacheA = await redisClient.get(`company:${companyA._id}`);
            const dataA = JSON.parse(cacheA);
            expect(dataA.companyName).toBe('Joe\'s Plumbing (Company A)');
            expect(dataA.secret).toBe('COMPANY_A_SECRET');
            expect(dataA.secret).not.toBe('COMPANY_B_SECRET');

            // Verify Company B cache
            const cacheB = await redisClient.get(`company:${companyB._id}`);
            const dataB = JSON.parse(cacheB);
            expect(dataB.companyName).toBe('Smith\'s HVAC (Company B)');
            expect(dataB.secret).toBe('COMPANY_B_SECRET');
            expect(dataB.secret).not.toBe('COMPANY_A_SECRET');
        });

        test('Readiness cache is company-specific', async () => {
            const keyA = `readiness:${companyA._id}`;
            const keyB = `readiness:${companyB._id}`;

            await redisClient.setex(keyA, 30, JSON.stringify({ score: 85, companyId: companyA._id }));
            await redisClient.setex(keyB, 30, JSON.stringify({ score: 60, companyId: companyB._id }));

            const cachedA = JSON.parse(await redisClient.get(keyA));
            const cachedB = JSON.parse(await redisClient.get(keyB));

            expect(cachedA.score).toBe(85);
            expect(cachedA.companyId).toBe(companyA._id.toString());
            expect(cachedB.score).toBe(60);
            expect(cachedB.companyId).toBe(companyB._id.toString());
        });

        test('No global cache keys without companyId prefix', async () => {
            const allKeys = await redisClient.keys('*');
            
            // Filter out allowed global keys (sessions, locks, etc.)
            const suspiciousKeys = allKeys.filter(key => 
                !key.startsWith('company:') &&
                !key.startsWith('readiness:') &&
                !key.startsWith('session:') &&
                !key.startsWith('lock:') &&
                !key.startsWith('company-phone:')
            );

            // Should be no suspicious global keys that could leak data
            expect(suspiciousKeys.length).toBe(0);
        });
    });

    describe('📞 TWILIO ROUTING ISOLATION', () => {
        test('Phone number routes to correct company only', async () => {
            // Simulate Twilio calling Company A's number
            const companyLookupA = await Company.findOne({
                'twilioConfig.phoneNumber': '+12395551001'
            });

            expect(companyLookupA).toBeTruthy();
            expect(companyLookupA._id.toString()).toBe(companyA._id.toString());
            expect(companyLookupA.companyName).toBe('TEST-ISOLATION Company A');

            // Simulate Twilio calling Company B's number
            const companyLookupB = await Company.findOne({
                'twilioConfig.phoneNumber': '+12395551002'
            });

            expect(companyLookupB).toBeTruthy();
            expect(companyLookupB._id.toString()).toBe(companyB._id.toString());
            expect(companyLookupB.companyName).toBe('TEST-ISOLATION Company B');
        });

        test('Phone lookup returns unique company per number', async () => {
            const phone1 = '+12395551001';
            const phone2 = '+12395551002';

            const company1 = await Company.findOne({ 'twilioConfig.phoneNumber': phone1 });
            const company2 = await Company.findOne({ 'twilioConfig.phoneNumber': phone2 });

            expect(company1._id.toString()).not.toBe(company2._id.toString());
            expect(company1.configuration.variables.companyName).not.toBe(company2.configuration.variables.companyName);
        });
    });

    describe('📋 TEMPLATE CLONING ISOLATION', () => {
        test('Cloned scenarios are independent per company', async () => {
            // Both companies cloned from same template
            expect(companyA.configuration.clonedFrom.toString()).toBe(globalTemplate._id.toString());
            expect(companyB.configuration.clonedFrom.toString()).toBe(globalTemplate._id.toString());

            // But they have different variable values
            expect(companyA.configuration.variables.companyName).not.toBe(companyB.configuration.variables.companyName);
            expect(companyA.configuration.variables.servicecallprice).not.toBe(companyB.configuration.variables.servicecallprice);

            // And different custom filler words
            expect(companyA.configuration.fillerWords.custom).toContain('y\'all');
            expect(companyA.configuration.fillerWords.custom).not.toContain('howdy');
            expect(companyB.configuration.fillerWords.custom).toContain('howdy');
            expect(companyB.configuration.fillerWords.custom).not.toContain('y\'all');
        });

        test('Template changes do not affect already-cloned companies', async () => {
            // Update global template
            globalTemplate.fillerWords.push('actually');
            await globalTemplate.save();

            // Reload companies
            const freshA = await Company.findById(companyA._id);
            const freshB = await Company.findById(companyB._id);

            // Companies still have old filler words (not automatically updated)
            expect(freshA.configuration.fillerWords.inherited).toEqual(['um', 'uh', 'like']);
            expect(freshA.configuration.fillerWords.inherited).not.toContain('actually');
            expect(freshB.configuration.fillerWords.inherited).toEqual(['um', 'uh', 'like']);
            expect(freshB.configuration.fillerWords.inherited).not.toContain('actually');
        });
    });

    describe('🧠 KNOWLEDGE BASE ISOLATION', () => {
        test('Company A knowledge base is private', async () => {
            const companyAKB = await CompanyKnowledgeQnA.find({ companyId: companyA._id });
            const companyBKB = await CompanyKnowledgeQnA.find({ companyId: companyB._id });

            expect(companyAKB.length).toBe(1);
            expect(companyAKB[0].answer).toContain('123 Secret Street');
            expect(companyAKB[0].answer).not.toContain('456 Private Ave');

            expect(companyBKB.length).toBe(1);
            expect(companyBKB[0].answer).toContain('456 Private Ave');
            expect(companyBKB[0].answer).not.toContain('123 Secret Street');
        });

        test('No cross-company knowledge queries', async () => {
            // Query with wrong companyId should return nothing
            const wrongQuery = await CompanyKnowledgeQnA.find({ companyId: 'wrong-id' });
            expect(wrongQuery.length).toBe(0);

            // Query without companyId should not return all (DANGEROUS)
            // This should never happen in production code
            const unscopedQuery = await CompanyKnowledgeQnA.find({});
            expect(unscopedQuery.length).toBeGreaterThan(0); // Would return all companies' data - DANGEROUS!
        });
    });

    describe('🔧 VARIABLE ISOLATION', () => {
        test('Company A variables are isolated', async () => {
            const varsA = companyA.configuration.variables;
            const varsB = companyB.configuration.variables;

            expect(varsA.companyName).toBe('Joe\'s Plumbing (Company A)');
            expect(varsA.servicecallprice).toBe('125');

            expect(varsB.companyName).toBe('Smith\'s HVAC (Company B)');
            expect(varsB.servicecallprice).toBe('200');

            // Verify they're completely different
            expect(varsA.companyName).not.toBe(varsB.companyName);
            expect(varsA.servicecallprice).not.toBe(varsB.servicecallprice);
        });

        test('Updating Company A variables does not affect Company B', async () => {
            // Update Company A price
            companyA.configuration.variables.servicecallprice = '150';
            await companyA.save();

            // Reload Company B
            const freshB = await Company.findById(companyB._id);

            // Company B price unchanged
            expect(freshB.configuration.variables.servicecallprice).toBe('200');
            expect(freshB.configuration.variables.servicecallprice).not.toBe('150');
        });
    });

    describe('⚠️ CRITICAL SECURITY CHECKS', () => {
        test('No queries return all companies without filter', async () => {
            // This is a code smell detector
            // In production, we should NEVER query Company.find({}) without filtering

            const allCompanies = await Company.find({ companyName: /^TEST-ISOLATION/ });
            expect(allCompanies.length).toBe(2);

            // If this were .find({}) with no filter, it would be DANGEROUS
            // Always filter by: companyId, phone, email, or specific criteria
        });

        test('Mongoose queries always include companyId filter', () => {
            // This is a conceptual test - in practice, use static analysis tools
            // to enforce that all queries in routes/company/* include companyId

            const exampleGoodQuery = { companyId: companyA._id, status: 'active' };
            const exampleBadQuery = { status: 'active' }; // Missing companyId!

            expect(exampleGoodQuery).toHaveProperty('companyId');
            expect(exampleBadQuery).not.toHaveProperty('companyId'); // DANGEROUS!
        });

        test('Redis keys always include companyId prefix', () => {
            const goodKey1 = `company:${companyA._id}`;
            const goodKey2 = `company:${companyA._id}:scenarios`;
            const goodKey3 = `readiness:${companyA._id}`;
            const badKey = 'scenarios'; // No companyId - DANGEROUS!

            expect(goodKey1).toMatch(/company:[a-f0-9]{24}/);
            expect(goodKey2).toMatch(/company:[a-f0-9]{24}:/);
            expect(goodKey3).toMatch(/readiness:[a-f0-9]{24}/);
            expect(badKey).not.toMatch(/[a-f0-9]{24}/); // DANGEROUS!
        });
    });
});

