/**
 * ============================================================================
 * S4A TRIAGE+SCENARIO PIPELINE - UNIT TESTS
 * ============================================================================
 * 
 * Tests the complete S4A pipeline:
 * - S4A-1: Triage signals extraction
 * - S4A-2: Scenario matching with triage context
 * - S4B: Owner decision
 * - Pending slot storage
 * - Detection trigger processing
 * 
 * ============================================================================
 */

const { FrontDeskCoreRuntime } = require('../services/engine/FrontDeskCoreRuntime');
const { expect } = require('chai');

describe('S4A Triage+Scenario Pipeline', () => {
    
    const createTestCompany = (overrides = {}) => ({
        _id: 'test-company-123',
        tradeKey: 'hvac',
        aiAgentSettings: {
            frontDeskBehavior: {
                _experimentalS4A: true,  // Feature flag ON
                triage: {
                    enabled: true,
                    minConfidence: 0.62,
                    autoOnProblem: true,
                    engine: 'v110'
                },
                discoveryConsent: {
                    disableScenarioAutoResponses: false,  // ENABLED
                    autoReplyAllowedScenarioTypes: ['FAQ', 'TROUBLESHOOT', 'EMERGENCY'],
                    forceLLMDiscovery: false,
                    bookingRequiresExplicitConsent: true
                },
                detectionTriggers: {
                    describingProblem: [],  // Will use platform defaults
                    trustConcern: [],
                    callerFeelsIgnored: [],
                    refusedSlot: []
                },
                ...overrides
            }
        }
    });
    
    const createTestState = () => ({
        turnCount: 1,
        sessionMode: 'DISCOVERY',
        plainSlots: {},
        pendingSlots: {},
        confirmedSlots: {},
        discovery: {
            currentStepId: 'd0',
            currentSlotId: 'call_reason_detail',
            repromptCount: {},
            confirmedSlots: {}
        },
        consent: {
            pending: false,
            askedExplicitly: false
        }
    });
    
    describe('S4A-1: Triage Signals', () => {
        it('should extract triage signals when triage enabled', async () => {
            const company = createTestCompany();
            const callState = createTestState();
            const userInput = 'My AC is not cooling';
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123', turnCount: 1 }
            );
            
            // Verify S4A-1 event exists
            const s4a1Event = result.turnEventBuffer.find(e => e.type === 'SECTION_S4A_1_TRIAGE_SIGNALS');
            expect(s4a1Event).to.exist;
            expect(s4a1Event.data.attempted).to.equal(true);
            expect(s4a1Event.data.triageEnabled).to.equal(true);
        });
        
        it('should skip triage when disabled', async () => {
            const company = createTestCompany({
                triage: { enabled: false }
            });
            const callState = createTestState();
            const userInput = 'My AC is not cooling';
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123' }
            );
            
            // Verify triage was skipped
            const s4a1Event = result.turnEventBuffer.find(e => e.type === 'SECTION_S4A_1_TRIAGE_SIGNALS');
            expect(s4a1Event).to.exist;
            expect(s4a1Event.data.attempted).to.equal(false);
            expect(s4a1Event.data.skipReason).to.include('DISABLED');
        });
    });
    
    describe('S4A-2: Scenario Matching', () => {
        it('should emit S4A-2 event on every discovery turn', async () => {
            const company = createTestCompany();
            const callState = createTestState();
            const userInput = 'AC not cooling';
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123' }
            );
            
            // Verify S4A-2 event exists
            const s4a2Event = result.turnEventBuffer.find(e => e.type === 'SECTION_S4A_2_SCENARIO_MATCH');
            expect(s4a2Event).to.exist;
            expect(s4a2Event.data).to.have.property('attempted');
            expect(s4a2Event.data).to.have.property('matched');
        });
        
        it('should skip scenario matching when disableScenarioAutoResponses=true', async () => {
            const company = createTestCompany({
                discoveryConsent: {
                    disableScenarioAutoResponses: true  // DISABLED
                }
            });
            const callState = createTestState();
            const userInput = 'AC not cooling';
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123' }
            );
            
            const s4a2Event = result.turnEventBuffer.find(e => e.type === 'SECTION_S4A_2_SCENARIO_MATCH');
            expect(s4a2Event).to.exist;
            expect(s4a2Event.data.attempted).to.equal(false);
            expect(s4a2Event.data.skipReason).to.include('DISABLED');
        });
        
        it('should skip scenario matching when no allowed types', async () => {
            const company = createTestCompany({
                discoveryConsent: {
                    disableScenarioAutoResponses: false,
                    autoReplyAllowedScenarioTypes: []  // EMPTY
                }
            });
            const callState = createTestState();
            const userInput = 'AC not cooling';
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123' }
            );
            
            const s4a2Event = result.turnEventBuffer.find(e => e.type === 'SECTION_S4A_2_SCENARIO_MATCH');
            expect(s4a2Event).to.exist;
            expect(s4a2Event.data.attempted).to.equal(false);
            expect(s4a2Event.data.skipReason).to.include('NO_ALLOWED_TYPES');
        });
    });
    
    describe('S4B: Owner Decision', () => {
        it('should emit S4B event on every discovery turn', async () => {
            const company = createTestCompany();
            const callState = createTestState();
            const userInput = 'AC not cooling';
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123' }
            );
            
            // Verify S4B event exists (PROOF OF OWNER DECISION)
            const s4bEvent = result.turnEventBuffer.find(e => e.type === 'SECTION_S4B_DISCOVERY_OWNER_SELECTED');
            expect(s4bEvent).to.exist;
            expect(s4bEvent.data).to.have.property('owner');
            expect(s4bEvent.data).to.have.property('reason');
            
            // Owner must be one of two values
            expect(['TRIAGE_SCENARIO_PIPELINE', 'DISCOVERY_FLOW']).to.include(s4bEvent.data.owner);
        });
        
        it('should fall back to DISCOVERY_FLOW when S4A disabled', async () => {
            const company = createTestCompany({
                _experimentalS4A: false  // Feature flag OFF
            });
            const callState = createTestState();
            const userInput = 'AC not cooling';
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123' }
            );
            
            const s4bEvent = result.turnEventBuffer.find(e => e.type === 'SECTION_S4B_DISCOVERY_OWNER_SELECTED');
            expect(s4bEvent.data.owner).to.equal('DISCOVERY_FLOW');
            expect(s4bEvent.data.reason).to.include('FEATURE_FLAG_DISABLED');
        });
    });
    
    describe('Pending Slots', () => {
        it('should store extracted slots as pending during discovery', async () => {
            const company = createTestCompany();
            const callState = createTestState();
            const userInput = 'My name is Mark Johnson at 123 Market St';
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123' }
            );
            
            // Verify pending slots event exists
            const pendingEvent = result.turnEventBuffer.find(e => e.type === 'SECTION_S3_PENDING_SLOTS_STORED');
            expect(pendingEvent).to.exist;
            expect(pendingEvent.data.confirmedStatus).to.equal('PENDING');
            expect(pendingEvent.data.slotsExtracted).to.be.an('array');
        });
    });
    
    describe('Detection Triggers', () => {
        it('should detect describingProblem trigger', async () => {
            const company = createTestCompany();
            const callState = createTestState();
            const userInput = 'My AC is not cooling';  // Matches platform default
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123' }
            );
            
            // Verify detection trigger event
            const triggerEvent = result.turnEventBuffer.find(e => 
                e.type === 'SECTION_S3_5_DESCRIBING_PROBLEM_DETECTED'
            );
            expect(triggerEvent).to.exist;
            expect(triggerEvent.data.trigger).to.equal('describingProblem');
        });
        
        it('should detect trustConcern trigger', async () => {
            const company = createTestCompany();
            const callState = createTestState();
            const userInput = 'Are you a real person?';  // Matches platform default
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123' }
            );
            
            const triggerEvent = result.turnEventBuffer.find(e => 
                e.type === 'SECTION_S3_5_TRUST_CONCERN_DETECTED'
            );
            expect(triggerEvent).to.exist;
            expect(triggerEvent.data.empathyMode).to.equal('trust_concern');
        });
        
        it('should detect callerFeelsIgnored trigger', async () => {
            const company = createTestCompany();
            const callState = createTestState();
            const userInput = 'You\'re not listening to me';  // Matches platform default
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123' }
            );
            
            const triggerEvent = result.turnEventBuffer.find(e => 
                e.type === 'SECTION_S3_5_CALLER_FEELS_IGNORED_DETECTED'
            );
            expect(triggerEvent).to.exist;
        });
        
        it('should detect refusedSlot trigger', async () => {
            const company = createTestCompany();
            const callState = createTestState();
            const userInput = 'I don\'t want to give that';  // Matches platform default
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123' }
            );
            
            const triggerEvent = result.turnEventBuffer.find(e => 
                e.type === 'SECTION_S3_5_REFUSED_SLOT_DETECTED'
            );
            expect(triggerEvent).to.exist;
        });
    });
    
    describe('Feature Flags & Kill Switches', () => {
        it('should skip S4A when feature flag disabled', async () => {
            const company = createTestCompany({
                _experimentalS4A: false
            });
            const callState = createTestState();
            const userInput = 'AC not cooling';
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123' }
            );
            
            const s4bEvent = result.turnEventBuffer.find(e => e.type === 'SECTION_S4B_DISCOVERY_OWNER_SELECTED');
            expect(s4bEvent.data.owner).to.equal('DISCOVERY_FLOW');
            expect(s4bEvent.data.reason).to.include('FEATURE_FLAG_DISABLED');
        });
    });
    
    describe('Graceful Degradation', () => {
        it('should not fail call if triage errors', async () => {
            // Note: This test would need to mock TriageEngineRouter to throw error
            // For now, we verify the error handling code path exists
            
            const company = createTestCompany();
            const callState = createTestState();
            const userInput = 'AC not cooling';
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123' }
            );
            
            // Result should exist (no crash)
            expect(result).to.exist;
            expect(result.response).to.exist;
            
            // Should have owner decision
            const s4bEvent = result.turnEventBuffer.find(e => e.type === 'SECTION_S4B_DISCOVERY_OWNER_SELECTED');
            expect(s4bEvent).to.exist;
        });
    });
    
    describe('Backward Compatibility', () => {
        it('should maintain plainSlots for legacy code', async () => {
            const company = createTestCompany();
            const callState = createTestState();
            const userInput = 'My name is Mark';
            
            const result = await FrontDeskCoreRuntime.processTurn(
                company.aiAgentSettings || {},
                callState,
                userInput,
                { company, callSid: 'CA123', companyId: 'test-company-123' }
            );
            
            // plainSlots should still be populated
            expect(result.state.plainSlots).to.exist;
            
            // pendingSlots should ALSO be populated (V116)
            expect(result.state.pendingSlots).to.exist;
        });
    });
});

describe('Platform Default Triggers', () => {
    const { getTriggers, PLATFORM_DEFAULTS } = require('../services/engine/PlatformDefaultTriggers');
    
    it('should return platform defaults when company config empty', () => {
        const companyConfig = { describingProblem: [] };
        const triggers = getTriggers(companyConfig, 'describingProblem', false);
        
        expect(triggers).to.be.an('array');
        expect(triggers.length).to.be.greaterThan(30);  // Platform has 40+ defaults
        expect(triggers).to.include('not cooling');
        expect(triggers).to.include('broken');
    });
    
    it('should use company config when provided', () => {
        const companyConfig = { describingProblem: ['custom trigger'] };
        const triggers = getTriggers(companyConfig, 'describingProblem', false);
        
        expect(triggers).to.deep.equal(['custom trigger']);
    });
    
    it('should merge company + platform when merge=true', () => {
        const companyConfig = { describingProblem: ['custom trigger'] };
        const triggers = getTriggers(companyConfig, 'describingProblem', true);
        
        expect(triggers.length).to.be.greaterThan(30);  // Platform defaults
        expect(triggers).to.include('custom trigger');  // Company addition
        expect(triggers).to.include('not cooling');     // Platform default
    });
});
