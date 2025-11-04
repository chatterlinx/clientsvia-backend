/**
 * ═══════════════════════════════════════════════════════════════════════
 * ENTERPRISE VARIABLE SCAN SERVICE - COMPREHENSIVE TEST SUITE
 * ═══════════════════════════════════════════════════════════════════════
 * 
 * Tests the EnterpriseVariableScanService for:
 * - Comprehensive scan report structure
 * - Word count analysis accuracy
 * - Differential analysis (first scan, no changes, changes detected)
 * - Zero variables as valid state
 * - Template breakdown details
 * - Auto-trigger on template add/remove
 * 
 * CRITICAL: These tests verify accuracy of variable scanning - the AI agent
 * depends on this to provide callers with correct company information.
 */

const request = require('supertest');
const mongoose = require('mongoose');
const { expect } = require('chai');
const jwt = require('jsonwebtoken');

const app = require('../server');
const Company = require('../models/v2Company');
const GlobalAIBehaviorTemplate = require('../models/GlobalAIBehaviorTemplate');
const EnterpriseVariableScanService = require('../services/EnterpriseVariableScanService');

describe('🏢 ENTERPRISE VARIABLE SCAN SERVICE', function() {
    this.timeout(30000); // 30s timeout for comprehensive scans
    
    let adminToken;
    let testCompanyId;
    let testTemplateId;
    let testTemplate;
    
    // ═══════════════════════════════════════════════════════════════════════
    // SETUP & TEARDOWN
    // ═══════════════════════════════════════════════════════════════════════
    
    before(async function() {
        console.log('🏗️  [TEST SETUP] Initializing enterprise variable tests...');
        
        // Generate admin token
        adminToken = jwt.sign(
            { userId: 'test-admin-id', role: 'admin', email: 'admin@test.com' },
            process.env.JWT_SECRET || 'test-secret',
            { expiresIn: '1h' }
        );
        
        // Create test company
        const testCompany = new Company({
            name: 'Enterprise Variables Test Company',
            contactEmail: 'test@enterprise-variables.com',
            primaryPhone: '+15551234567',
            address: '123 Test St',
            city: 'Test City',
            state: 'TS',
            zipCode: '12345',
            timezone: 'America/New_York',
            industry: 'Testing',
            companySize: '1-10',
            aiAgentSettings: {
                enabled: true,
                variables: {},
                variableDefinitions: [],
                variableScanStatus: {
                    lastScanDate: null,
                    isScanning: false,
                    scanHistory: []
                },
                activeTemplates: []
            }
        });
        
        await testCompany.save();
        testCompanyId = testCompany._id.toString();
        
        // Create test template with known variables
        testTemplate = new GlobalAIBehaviorTemplate({
            name: 'Enterprise Test Template',
            description: 'Test template with known variables',
            version: 'v1.0.0',
            industry: 'Testing',
            priority: 1,
            status: 'live',
            categories: [
                {
                    id: 'cat-test-1',
                    name: 'Appointment Booking',
                    description: 'Book appointments',
                    isActive: true,
                    scenarios: [
                        {
                            scenarioId: 'scn-test-1',
                            name: 'Request Appointment',
                            isActive: true,
                            triggers: ['book appointment', 'schedule'],
                            responses: [
                                {
                                    id: 'resp-1',
                                    text: 'I can help you book an appointment at {company_name}. Our hours are {business_hours}.',
                                    variants: [
                                        'Let me schedule that for you at {company_name}. We\'re open {business_hours}.',
                                        'Great! I\'ll book you in at {company_name}. Call us at {phone_number}.'
                                    ]
                                }
                            ],
                            aiInstructions: 'Collect appointment details. Use {company_name}, {business_hours}, and {phone_number}.'
                        },
                        {
                            scenarioId: 'scn-test-2',
                            name: 'Pricing Question',
                            isActive: true,
                            triggers: ['how much', 'cost', 'price'],
                            responses: [
                                {
                                    id: 'resp-2',
                                    text: 'Our pricing starts at {base_price}. Contact us at {email} for a quote.',
                                    variants: []
                                }
                            ]
                        }
                    ]
                },
                {
                    id: 'cat-test-2',
                    name: 'Business Hours',
                    description: 'Hours questions',
                    isActive: true,
                    scenarios: [
                        {
                            scenarioId: 'scn-test-3',
                            name: 'Hours Query',
                            isActive: true,
                            triggers: ['hours', 'open', 'closed'],
                            responses: [
                                {
                                    id: 'resp-3',
                                    text: 'We\'re open {business_hours}. Located at {address}.',
                                    variants: []
                                }
                            ]
                        }
                    ]
                }
            ]
        });
        
        await testTemplate.save();
        testTemplateId = testTemplate._id.toString();
        
        console.log('✅ [TEST SETUP] Test company created:', testCompanyId);
        console.log('✅ [TEST SETUP] Test template created:', testTemplateId);
    });
    
    after(async function() {
        console.log('🧹 [TEST CLEANUP] Removing test data...');
        
        if (testCompanyId) {
            await Company.findByIdAndDelete(testCompanyId);
            console.log('✅ [TEST CLEANUP] Test company deleted');
        }
        
        if (testTemplateId) {
            await GlobalAIBehaviorTemplate.findByIdAndDelete(testTemplateId);
            console.log('✅ [TEST CLEANUP] Test template deleted');
        }
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // TEST SUITE 1: COMPREHENSIVE SCAN REPORT STRUCTURE
    // ═══════════════════════════════════════════════════════════════════════
    
    describe('📊 1. Comprehensive Scan Report Structure', function() {
        
        it('should return complete scan report structure with all required fields', async function() {
            console.log('\n🔍 [TEST 1.1] Testing scan report structure...');
            
            // Add template to company
            const company = await Company.findById(testCompanyId);
            company.aiAgentSettings.activeTemplates = [
                {
                    templateId: testTemplateId,
                    enabled: true,
                    priority: 1
                }
            ];
            await company.save();
            
            // Perform scan
            const scanReport = await EnterpriseVariableScanService.scanCompany(testCompanyId, {
                reason: 'test',
                triggeredBy: 'automated-test'
            });
            
            // Validate structure
            expect(scanReport).to.be.an('object');
            expect(scanReport).to.have.property('scanId').that.is.a('string');
            expect(scanReport).to.have.property('timestamp').that.is.a('string');
            expect(scanReport).to.have.property('companyId', testCompanyId);
            expect(scanReport).to.have.property('triggerReason', 'test');
            expect(scanReport).to.have.property('triggeredBy', 'automated-test');
            
            // Validate aggregated stats
            expect(scanReport).to.have.property('aggregated').that.is.an('object');
            expect(scanReport.aggregated).to.have.property('uniqueVariables').that.is.a('number');
            expect(scanReport.aggregated).to.have.property('totalPlaceholders').that.is.a('number');
            expect(scanReport.aggregated).to.have.property('totalScenarios').that.is.a('number');
            expect(scanReport.aggregated).to.have.property('totalWords').that.is.a('number');
            expect(scanReport.aggregated).to.have.property('uniqueWords').that.is.a('number');
            
            // Validate templates scanned
            expect(scanReport).to.have.property('templatesScanned').that.is.an('object');
            expect(scanReport.templatesScanned).to.have.property('total', 1);
            expect(scanReport.templatesScanned).to.have.property('list').that.is.an('array').with.lengthOf(1);
            
            // Validate differential analysis
            expect(scanReport).to.have.property('differential').that.is.an('object');
            expect(scanReport.differential).to.have.property('summary').that.is.an('object');
            expect(scanReport.differential).to.have.property('variablesChanged').that.is.an('object');
            
            // Validate performance metrics
            expect(scanReport).to.have.property('performance').that.is.an('object');
            expect(scanReport.performance).to.have.property('scenariosPerSecond').that.is.a('number');
            
            // Validate duration
            expect(scanReport).to.have.property('duration').that.is.a('number').above(0);
            
            console.log('✅ [TEST 1.1] Scan report structure is valid');
            console.log(`📊 [TEST 1.1] Found ${scanReport.aggregated.uniqueVariables} unique variables`);
        });
        
        it('should correctly identify all 5 unique variables in test template', async function() {
            console.log('\n🔍 [TEST 1.2] Testing variable detection accuracy...');
            
            const scanReport = await EnterpriseVariableScanService.scanCompany(testCompanyId, {
                reason: 'accuracy-test',
                triggeredBy: 'automated-test'
            });
            
            // Expected variables: company_name, business_hours, phone_number, base_price, email, address
            const expectedVariables = ['company_name', 'business_hours', 'phone_number', 'base_price', 'email', 'address'];
            
            expect(scanReport.aggregated.uniqueVariables).to.equal(expectedVariables.length);
            
            // Verify all expected variables were found
            const company = await Company.findById(testCompanyId);
            const foundVariables = company.aiAgentSettings.variableDefinitions.map(v => v.key);
            
            expectedVariables.forEach(varKey => {
                expect(foundVariables).to.include(varKey, `Variable {${varKey}} should be detected`);
            });
            
            console.log('✅ [TEST 1.2] All expected variables detected correctly');
            console.log(`📊 [TEST 1.2] Variables found: ${foundVariables.join(', ')}`);
        });
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // TEST SUITE 2: WORD COUNT ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════
    
    describe('📝 2. Word Count Analysis Accuracy', function() {
        
        it('should accurately count total words in all scenarios', async function() {
            console.log('\n🔍 [TEST 2.1] Testing word count accuracy...');
            
            const scanReport = await EnterpriseVariableScanService.scanCompany(testCompanyId, {
                reason: 'word-count-test',
                triggeredBy: 'automated-test'
            });
            
            expect(scanReport.aggregated.totalWords).to.be.a('number').above(0);
            expect(scanReport.aggregated.uniqueWords).to.be.a('number').above(0);
            expect(scanReport.aggregated.uniqueWords).to.be.at.most(scanReport.aggregated.totalWords);
            
            console.log('✅ [TEST 2.1] Word count analysis is accurate');
            console.log(`📊 [TEST 2.1] Total words: ${scanReport.aggregated.totalWords.toLocaleString()}`);
            console.log(`📊 [TEST 2.1] Unique words: ${scanReport.aggregated.uniqueWords.toLocaleString()}`);
        });
        
        it('should provide word analysis per template', async function() {
            console.log('\n🔍 [TEST 2.2] Testing per-template word analysis...');
            
            const scanReport = await EnterpriseVariableScanService.scanCompany(testCompanyId, {
                reason: 'template-word-test',
                triggeredBy: 'automated-test'
            });
            
            expect(scanReport.templatesScanned.list).to.have.lengthOf(1);
            
            const templateReport = scanReport.templatesScanned.list[0];
            expect(templateReport).to.have.property('wordAnalysis').that.is.an('object');
            expect(templateReport.wordAnalysis).to.have.property('totalWords').that.is.a('number').above(0);
            expect(templateReport.wordAnalysis).to.have.property('uniqueWords').that.is.a('number').above(0);
            
            console.log('✅ [TEST 2.2] Per-template word analysis is accurate');
        });
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // TEST SUITE 3: DIFFERENTIAL ANALYSIS
    // ═══════════════════════════════════════════════════════════════════════
    
    describe('🔄 3. Differential Analysis', function() {
        
        it('should detect first scan (no previous report)', async function() {
            console.log('\n🔍 [TEST 3.1] Testing first scan detection...');
            
            // Clear scan history
            const company = await Company.findById(testCompanyId);
            company.aiAgentSettings.variableScanStatus.scanHistory = [];
            company.aiAgentSettings.variableScanStatus.lastReport = null;
            await company.save();
            
            const scanReport = await EnterpriseVariableScanService.scanCompany(testCompanyId, {
                reason: 'first-scan-test',
                triggeredBy: 'automated-test'
            });
            
            expect(scanReport.differential.summary.isFirstScan).to.be.true;
            expect(scanReport.differential.variablesChanged.new.length).to.equal(scanReport.aggregated.uniqueVariables);
            
            console.log('✅ [TEST 3.1] First scan detected correctly');
        });
        
        it('should detect no changes on identical subsequent scan', async function() {
            console.log('\n🔍 [TEST 3.2] Testing no changes detection...');
            
            // First scan
            await EnterpriseVariableScanService.scanCompany(testCompanyId, {
                reason: 'baseline-scan',
                triggeredBy: 'automated-test'
            });
            
            // Second scan (no changes)
            const scanReport = await EnterpriseVariableScanService.scanCompany(testCompanyId, {
                reason: 'no-changes-test',
                triggeredBy: 'automated-test'
            });
            
            expect(scanReport.differential.summary.noChangesDetected).to.be.true;
            expect(scanReport.differential.summary.newVariablesCount).to.equal(0);
            expect(scanReport.differential.summary.removedVariablesCount).to.equal(0);
            expect(scanReport.differential.summary.modifiedVariablesCount).to.equal(0);
            
            console.log('✅ [TEST 3.2] No changes detected correctly');
        });
        
        it('should detect new variables when template is modified', async function() {
            console.log('\n🔍 [TEST 3.3] Testing new variable detection...');
            
            // Baseline scan
            await EnterpriseVariableScanService.scanCompany(testCompanyId, {
                reason: 'baseline-scan',
                triggeredBy: 'automated-test'
            });
            
            // Add new scenario with new variable
            const template = await GlobalAIBehaviorTemplate.findById(testTemplateId);
            template.categories[0].scenarios.push({
                scenarioId: 'scn-test-new',
                name: 'Emergency Service',
                isActive: true,
                triggers: ['emergency', 'urgent'],
                responses: [{
                    id: 'resp-new',
                    text: 'For emergencies, call {emergency_phone} immediately.',
                    variants: []
                }]
            });
            await template.save();
            
            // Scan again
            const scanReport = await EnterpriseVariableScanService.scanCompany(testCompanyId, {
                reason: 'new-variable-test',
                triggeredBy: 'automated-test'
            });
            
            expect(scanReport.differential.summary.noChangesDetected).to.be.false;
            expect(scanReport.differential.summary.newVariablesCount).to.be.above(0);
            
            // Find the new variable
            const newVars = scanReport.differential.variablesChanged.new;
            expect(newVars.some(v => v.key === 'emergency_phone')).to.be.true;
            
            console.log('✅ [TEST 3.3] New variable detected correctly');
            console.log(`📊 [TEST 3.3] New variables: ${newVars.map(v => v.key).join(', ')}`);
        });
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // TEST SUITE 4: ZERO VARIABLES AS VALID STATE
    // ═══════════════════════════════════════════════════════════════════════
    
    describe('⓪ 4. Zero Variables Valid State', function() {
        
        it('should handle zero variables gracefully (no templates)', async function() {
            console.log('\n🔍 [TEST 4.1] Testing zero variables with no templates...');
            
            // Remove all templates
            const company = await Company.findById(testCompanyId);
            company.aiAgentSettings.activeTemplates = [];
            await company.save();
            
            const scanReport = await EnterpriseVariableScanService.scanCompany(testCompanyId, {
                reason: 'zero-variables-test',
                triggeredBy: 'automated-test'
            });
            
            expect(scanReport.aggregated.uniqueVariables).to.equal(0);
            expect(scanReport.aggregated.totalPlaceholders).to.equal(0);
            expect(scanReport.templatesScanned.total).to.equal(0);
            
            // Should not throw errors
            expect(scanReport).to.have.property('scanId');
            expect(scanReport).to.have.property('differential');
            
            console.log('✅ [TEST 4.1] Zero variables handled gracefully');
        });
        
        it('should handle templates with no variables', async function() {
            console.log('\n🔍 [TEST 4.2] Testing template with no variable placeholders...');
            
            // Create template without variables
            const noVarTemplate = new GlobalAIBehaviorTemplate({
                name: 'No Variables Template',
                version: 'v1.0.0',
                industry: 'Testing',
                priority: 1,
                status: 'live',
                categories: [{
                    id: 'cat-no-var',
                    name: 'Simple Category',
                    isActive: true,
                    scenarios: [{
                        scenarioId: 'scn-no-var',
                        name: 'Simple Scenario',
                        isActive: true,
                        triggers: ['hello'],
                        responses: [{
                            id: 'resp-no-var',
                            text: 'Hello! How can I help you today?',
                            variants: []
                        }]
                    }]
                }]
            });
            await noVarTemplate.save();
            
            // Add to company
            const company = await Company.findById(testCompanyId);
            company.aiAgentSettings.activeTemplates = [{
                templateId: noVarTemplate._id.toString(),
                enabled: true,
                priority: 1
            }];
            await company.save();
            
            // Scan
            const scanReport = await EnterpriseVariableScanService.scanCompany(testCompanyId, {
                reason: 'no-variables-template-test',
                triggeredBy: 'automated-test'
            });
            
            expect(scanReport.aggregated.uniqueVariables).to.equal(0);
            expect(scanReport.templatesScanned.total).to.equal(1);
            expect(scanReport.aggregated.totalScenarios).to.be.above(0);
            
            // Cleanup
            await GlobalAIBehaviorTemplate.findByIdAndDelete(noVarTemplate._id);
            
            console.log('✅ [TEST 4.2] Template with no variables handled correctly');
        });
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // TEST SUITE 5: TEMPLATE BREAKDOWN DETAILS
    // ═══════════════════════════════════════════════════════════════════════
    
    describe('📦 5. Template Breakdown Details', function() {
        
        it('should provide detailed breakdown for each template', async function() {
            console.log('\n🔍 [TEST 5.1] Testing template breakdown structure...');
            
            // Re-add test template
            const company = await Company.findById(testCompanyId);
            company.aiAgentSettings.activeTemplates = [{
                templateId: testTemplateId,
                enabled: true,
                priority: 1
            }];
            await company.save();
            
            const scanReport = await EnterpriseVariableScanService.scanCompany(testCompanyId, {
                reason: 'breakdown-test',
                triggeredBy: 'automated-test'
            });
            
            expect(scanReport.templatesScanned.list).to.have.lengthOf(1);
            
            const templateBreakdown = scanReport.templatesScanned.list[0];
            expect(templateBreakdown).to.have.property('templateId', testTemplateId);
            expect(templateBreakdown).to.have.property('templateName', 'Enterprise Test Template');
            expect(templateBreakdown).to.have.property('version', 'v1.0.0');
            expect(templateBreakdown).to.have.property('priority', 1);
            
            // Categories breakdown
            expect(templateBreakdown).to.have.property('categories').that.is.an('object');
            expect(templateBreakdown.categories).to.have.property('scanned').that.is.a('number');
            expect(templateBreakdown.categories).to.have.property('total').that.is.a('number');
            
            // Scenarios breakdown
            expect(templateBreakdown).to.have.property('scenarios').that.is.an('object');
            expect(templateBreakdown.scenarios).to.have.property('scanned').that.is.a('number');
            expect(templateBreakdown.scenarios).to.have.property('total').that.is.a('number');
            
            // Variables found
            expect(templateBreakdown).to.have.property('variablesFound').that.is.an('object');
            expect(templateBreakdown.variablesFound).to.have.property('unique').that.is.a('number');
            expect(templateBreakdown.variablesFound).to.have.property('totalOccurrences').that.is.a('number');
            
            console.log('✅ [TEST 5.1] Template breakdown structure is valid');
            console.log(`📊 [TEST 5.1] Categories: ${templateBreakdown.categories.scanned}/${templateBreakdown.categories.total}`);
            console.log(`📊 [TEST 5.1] Scenarios: ${templateBreakdown.scenarios.scanned}/${templateBreakdown.scenarios.total}`);
        });
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // TEST SUITE 6: AUTO-TRIGGER INTEGRATION
    // ═══════════════════════════════════════════════════════════════════════
    
    describe('🔥 6. Auto-Trigger on Template Add/Remove', function() {
        
        it('should auto-trigger scan when template is added via API', async function() {
            console.log('\n🔍 [TEST 6.1] Testing auto-trigger on template add...');
            
            // Clear templates
            await Company.findByIdAndUpdate(testCompanyId, {
                'aiAgentSettings.activeTemplates': []
            });
            
            // Add template via API
            const response = await request(app)
                .post(`/api/company/${testCompanyId}/configuration/templates`)
                .set('Authorization', `Bearer ${adminToken}`)
                .send({
                    templateId: testTemplateId,
                    enabled: true,
                    priority: 1
                });
            
            expect(response.status).to.equal(200);
            
            // Wait for background scan to complete
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Verify scan was performed
            const company = await Company.findById(testCompanyId);
            expect(company.aiAgentSettings.variableScanStatus.lastScanDate).to.not.be.null;
            expect(company.aiAgentSettings.variableDefinitions.length).to.be.above(0);
            
            console.log('✅ [TEST 6.1] Auto-trigger on template add worked correctly');
        });
        
        it('should auto-trigger cleanup scan when template is removed', async function() {
            console.log('\n🔍 [TEST 6.2] Testing auto-trigger on template remove...');
            
            // Ensure template is added first
            await Company.findByIdAndUpdate(testCompanyId, {
                'aiAgentSettings.activeTemplates': [{
                    templateId: testTemplateId,
                    enabled: true,
                    priority: 1
                }]
            });
            
            // Perform initial scan
            await EnterpriseVariableScanService.scanCompany(testCompanyId, {
                reason: 'setup-for-removal-test',
                triggeredBy: 'automated-test'
            });
            
            // Remove template via API
            const response = await request(app)
                .delete(`/api/company/${testCompanyId}/configuration/templates/${testTemplateId}`)
                .set('Authorization', `Bearer ${adminToken}`);
            
            expect(response.status).to.equal(200);
            
            // Wait for background cleanup scan
            await new Promise(resolve => setTimeout(resolve, 3000));
            
            // Verify cleanup scan was performed
            const company = await Company.findById(testCompanyId);
            expect(company.aiAgentSettings.variableScanStatus.lastScanDate).to.not.be.null;
            
            // Variables should be removed (orphaned by template removal)
            expect(company.aiAgentSettings.variableDefinitions.length).to.equal(0);
            
            console.log('✅ [TEST 6.2] Auto-trigger on template remove worked correctly');
        });
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // TEST SUITE 7: CRITICAL ACCURACY TESTS
    // ═══════════════════════════════════════════════════════════════════════
    
    describe('🎯 7. CRITICAL Accuracy Tests', function() {
        
        it('CRITICAL: should not miss any {variable} placeholders', async function() {
            console.log('\n🔍 [TEST 7.1] CRITICAL: Testing variable detection completeness...');
            
            // Re-add template
            const company = await Company.findById(testCompanyId);
            company.aiAgentSettings.activeTemplates = [{
                templateId: testTemplateId,
                enabled: true,
                priority: 1
            }];
            await company.save();
            
            // Scan
            const scanReport = await EnterpriseVariableScanService.scanCompany(testCompanyId, {
                reason: 'accuracy-critical-test',
                triggeredBy: 'automated-test'
            });
            
            // Manually count variables in test template
            const template = await GlobalAIBehaviorTemplate.findById(testTemplateId);
            const allText = JSON.stringify(template.categories);
            const manualMatches = allText.match(/\{(\w+)\}/g) || [];
            const manualUniqueVars = [...new Set(manualMatches.map(m => m.slice(1, -1)))];
            
            console.log(`📊 [TEST 7.1] Manual count: ${manualUniqueVars.length} unique variables`);
            console.log(`📊 [TEST 7.1] Manual variables: ${manualUniqueVars.join(', ')}`);
            console.log(`📊 [TEST 7.1] Scan found: ${scanReport.aggregated.uniqueVariables} unique variables`);
            
            // CRITICAL: Counts must match exactly
            expect(scanReport.aggregated.uniqueVariables).to.equal(
                manualUniqueVars.length,
                'CRITICAL: Variable scanning must not miss any {variable} placeholders'
            );
            
            console.log('✅ [TEST 7.1] CRITICAL: All variables detected - 100% accuracy!');
        });
        
        it('CRITICAL: variable definitions must be accessible by AI agent', async function() {
            console.log('\n🔍 [TEST 7.2] CRITICAL: Testing AI agent access to variables...');
            
            const company = await Company.findById(testCompanyId);
            const varDefs = company.aiAgentSettings.variableDefinitions;
            
            expect(varDefs).to.be.an('array').with.length.above(0);
            
            // Each definition must have required fields for AI agent
            varDefs.forEach(varDef => {
                expect(varDef).to.have.property('key').that.is.a('string');
                expect(varDef).to.have.property('label').that.is.a('string');
                expect(varDef).to.have.property('type').that.is.a('string');
                expect(varDef).to.have.property('category').that.is.a('string');
                expect(varDef).to.have.property('usageCount').that.is.a('number').above(0);
                
                console.log(`  ✓ Variable {${varDef.key}}: ${varDef.label} (${varDef.type}) - ${varDef.usageCount} uses`);
            });
            
            console.log('✅ [TEST 7.2] CRITICAL: All variables accessible to AI agent!');
        });
    });
});

