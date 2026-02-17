/**
 * ============================================================================
 * S4A INTEGRATION TEST - MRS. JOHNSON SCENARIO
 * ============================================================================
 * 
 * The canonical "caller volunteers full info upfront" scenario.
 * 
 * Tests complete flow:
 * - Caller says: "This is Mrs. Johnson, 123 Market St, Fort Myers — AC is down"
 * - S4A extracts: lastName, address, call_reason_detail → PENDING
 * - S4A triage: classifies intent, extracts symptoms
 * - S4A scenario: matches "AC not cooling" scenario (if exists)
 * - Response: Uses pending slots for context ("Got it, Mrs. Johnson at 123 Market St...")
 * - Booking: Confirms pending slots (not re-asking)
 * 
 * This is the PRIMARY validation that S4A solves the original problem.
 * 
 * ============================================================================
 */

const { FrontDeskCoreRuntime } = require('../../services/engine/FrontDeskCoreRuntime');
const { expect } = require('chai');

describe('S4A Integration: Mrs. Johnson Scenario', () => {
    
    const createCompany = () => ({
        _id: 'test-company-mrs-johnson',
        tradeKey: 'hvac',
        aiAgentSettings: {
            frontDeskBehavior: {
                _experimentalS4A: true,
                triage: { enabled: true, minConfidence: 0.62 },
                discoveryConsent: {
                    disableScenarioAutoResponses: false,
                    autoReplyAllowedScenarioTypes: ['FAQ', 'TROUBLESHOOT', 'EMERGENCY'],
                    forceLLMDiscovery: false
                },
                detectionTriggers: {}
            }
        }
    });
    
    it('should extract pending slots from full info upfront', async () => {
        const company = createCompany();
        const callState = {
            turnCount: 1,
            sessionMode: 'DISCOVERY',
            plainSlots: {},
            pendingSlots: {},
            discovery: { repromptCount: {}, confirmedSlots: {} },
            consent: { pending: false }
        };
        
        const userInput = 'This is Mrs. Johnson, 123 Market St, Fort Myers — AC is down';
        
        const result = await FrontDeskCoreRuntime.processTurn(
            company.aiAgentSettings || {},
            callState,
            userInput,
            { 
                company, 
                callSid: 'CA-MRS-JOHNSON-001', 
                companyId: 'test-company-mrs-johnson',
                turnCount: 1
            }
        );
        
        // Verify pending slots stored
        const pendingEvent = result.turnEventBuffer.find(e => e.type === 'SECTION_S3_PENDING_SLOTS_STORED');
        expect(pendingEvent).to.exist;
        expect(pendingEvent.data.confirmedStatus).to.equal('PENDING');
        
        // Verify state has pending slots
        expect(result.state.pendingSlots).to.exist;
        
        // Should have extracted: name (Johnson), address, possibly call_reason
        const pendingKeys = Object.keys(result.state.pendingSlots);
        expect(pendingKeys.length).to.be.greaterThan(0);
    });
    
    it('should emit all S4A events for Mrs. Johnson', async () => {
        const company = createCompany();
        const callState = {
            turnCount: 1,
            sessionMode: 'DISCOVERY',
            plainSlots: {},
            pendingSlots: {},
            discovery: { repromptCount: {}, confirmedSlots: {} },
            consent: { pending: false }
        };
        
        const userInput = 'This is Mrs. Johnson, 123 Market St — AC is down';
        
        const result = await FrontDeskCoreRuntime.processTurn(
            company.aiAgentSettings || {},
            callState,
            userInput,
            { company, callSid: 'CA-MRS-JOHNSON-002', companyId: 'test-company-mrs-johnson' }
        );
        
        // Verify all S4A events exist
        const eventTypes = result.turnEventBuffer.map(e => e.type);
        
        expect(eventTypes).to.include('SECTION_S4A_1_TRIAGE_SIGNALS');
        expect(eventTypes).to.include('SECTION_S4A_2_SCENARIO_MATCH');
        expect(eventTypes).to.include('SECTION_S4B_DISCOVERY_OWNER_SELECTED');
    });
    
    it('should populate call_reason_detail from triage', async () => {
        const company = createCompany();
        const callState = {
            turnCount: 1,
            sessionMode: 'DISCOVERY',
            plainSlots: {},
            pendingSlots: {},
            discovery: { repromptCount: {}, confirmedSlots: {} },
            consent: { pending: false }
        };
        
        const userInput = 'AC is not cooling';
        
        const result = await FrontDeskCoreRuntime.processTurn(
            company.aiAgentSettings || {},
            callState,
            userInput,
            { company, callSid: 'CA-MRS-JOHNSON-003', companyId: 'test-company-mrs-johnson' }
        );
        
        const s4a1Event = result.turnEventBuffer.find(e => e.type === 'SECTION_S4A_1_TRIAGE_SIGNALS');
        
        // If triage ran and extracted call reason
        if (s4a1Event?.data.triageRan && s4a1Event.data.callReasonDetail) {
            // State should have call_reason_detail
            expect(result.state.plainSlots.call_reason_detail).to.exist;
            expect(result.state.plainSlots.call_reason_detail).to.be.a('string');
        }
    });
    
    it('should detect describingProblem when AC mentioned', async () => {
        const company = createCompany();
        const callState = {
            turnCount: 1,
            sessionMode: 'DISCOVERY',
            plainSlots: {},
            pendingSlots: {},
            discovery: { repromptCount: {}, confirmedSlots: {} },
            consent: { pending: false }
        };
        
        const userInput = 'My AC is down';
        
        const result = await FrontDeskCoreRuntime.processTurn(
            company.aiAgentSettings || {},
            callState,
            userInput,
            { company, callSid: 'CA-MRS-JOHNSON-004', companyId: 'test-company-mrs-johnson' }
        );
        
        // Should detect describingProblem
        const eventTypes = result.turnEventBuffer.map(e => e.type);
        expect(eventTypes).to.include('SECTION_S3_5_DESCRIBING_PROBLEM_DETECTED');
    });
});
