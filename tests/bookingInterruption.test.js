const { callLLM0, mockLLMOnce, resetLLM } = require('./helpers/mockLLM');
const HybridReceptionistLLM = require('../services/HybridReceptionistLLM');

const DEFAULT_RETURN_QUESTION = "What's the best phone number to reach you?";

function buildCompany(overrides = {}) {
  const baseCompany = {
    _id: '000000000000000000000000',
    name: 'Test HVAC Company',
    trade: 'hvac',
    aiAgentSettings: {
      frontDeskBehavior: {
        bookingInterruption: {
          enabled: true,
          oneSlotPerTurn: true,
          forceReturnToQuestionAsLastLine: true,
          allowEmpathyLanguage: false,
          maxSentences: 2,
          shortClarificationPatterns: ['mark?', 'yes?', 'hello?', 'what?']
        },
        bookingPromptsMap: {
          'booking.universal.interruption.system_header':
            'You handle quick interruptions during booking and then continue the booking flow.',
          'booking.universal.interruption.generic_ack': 'Got it.',
          'booking.universal.interruption.ack_with_name': 'Got it, {name}.',
          'booking.universal.interruption.ack_short': 'Thanks for confirming.',
          'booking.universal.interruption.prohibit_phrases':
            'I understand it can be confusing\nI know this is frustrating'
        },
        forbiddenPhrases: []
        // promptPacks REMOVED Jan 2026
      }
    }
  };

  const merged = {
    ...baseCompany,
    ...overrides,
    aiAgentSettings: {
      ...baseCompany.aiAgentSettings,
      ...(overrides.aiAgentSettings || {}),
      frontDeskBehavior: {
        ...baseCompany.aiAgentSettings.frontDeskBehavior,
        ...(overrides.aiAgentSettings?.frontDeskBehavior || {})
      }
    }
  };

  const overrideFdb = overrides.aiAgentSettings?.frontDeskBehavior || {};
  merged.aiAgentSettings.frontDeskBehavior.bookingPromptsMap = {
    ...baseCompany.aiAgentSettings.frontDeskBehavior.bookingPromptsMap,
    ...(overrideFdb.bookingPromptsMap || {})
  };
  merged.aiAgentSettings.frontDeskBehavior.bookingInterruption = {
    ...baseCompany.aiAgentSettings.frontDeskBehavior.bookingInterruption,
    ...(overrideFdb.bookingInterruption || {})
  };

  return merged;
}

async function runBookingInterruption({
  company,
  userInput,
  returnToQuestion = DEFAULT_RETURN_QUESTION,
  activeSlotId = 'phone',
  collectedSlots = {}
}) {
  return HybridReceptionistLLM.processConversation({
    company,
    callContext: {
      callId: 'test-call',
      companyId: company._id,
      mode: 'BOOKING',
      enterpriseContext: {
        mode: 'BOOKING_INTERRUPTION',
        discoverySummary: 'Scheduling service',
        keyFacts: [],
        collectedSlots,
        nextSlotQuestion: returnToQuestion,
        activeSlotId,
        nameMeta: {}
      }
    },
    currentMode: 'booking',
    knownSlots: collectedSlots,
    conversationHistory: [],
    userInput,
    behaviorConfig: company.aiAgentSettings?.frontDeskBehavior || {}
  });
}

function mockLlmReply(content) {
  mockLLMOnce(content);
}

describe('Booking interruption behavior (structural guardrails)', () => {
  beforeEach(() => {
    resetLLM();
  });

  test('“Mark?” clarification: short ack + phone question, no drama, no slot mixing', async () => {
    const company = buildCompany();
    const collectedSlots = { name: 'Mark', partialName: 'Mark' };

    const result = await runBookingInterruption({
      company,
      userInput: 'Mark?',
      collectedSlots
    });

    expect(callLLM0).not.toHaveBeenCalled();

    const reply = result.reply || '';
    const normalized = reply.toLowerCase();

    expect(reply.trim().endsWith(DEFAULT_RETURN_QUESTION)).toBe(true);
    expect(normalized.includes('confusing')).toBe(false);
    expect(normalized.includes('frustrating')).toBe(false);
    expect(normalized.includes('mark')).toBe(true);
    expect(normalized.includes("what's your name")).toBe(false);
    expect(normalized.includes('full name')).toBe(false);

    const phoneMatches = (normalized.match(/phone number|best phone/g) || []).length;
    expect(phoneMatches).toBeGreaterThanOrEqual(1);
    expect(phoneMatches).toBeLessThanOrEqual(2);
  });

  test('Engine filters multi-slot LLM draft and enforces returnToQuestion', async () => {
    const company = buildCompany();
    const collectedSlots = { name: 'Mark' };
    const draft =
      "I’ll need your full name and your phone number. What's your full name? What's the best phone number to reach you?";

    mockLlmReply(JSON.stringify({ ack: draft }));

    const result = await runBookingInterruption({
      company,
      userInput: 'Sure.',
      collectedSlots
    });

    const reply = result.reply || '';
    const normalized = reply.toLowerCase();

    expect(reply.trim().endsWith(DEFAULT_RETURN_QUESTION)).toBe(true);
    expect(normalized.includes("what's your full name")).toBe(false);
    expect(normalized.includes('phone')).toBe(true);
  });

  test('Prohibited phrases are removed but returnToQuestion remains', async () => {
    const company = buildCompany({
      aiAgentSettings: {
        frontDeskBehavior: {
          bookingPromptsMap: {
            'booking.universal.interruption.prohibit_phrases':
              'I understand it can be confusing\nI know this is frustrating'
          }
        }
      }
    });

    const draft =
      "I understand it can be confusing, but I’ll help you. What's the best phone number to reach you?";

    mockLlmReply(JSON.stringify({ ack: draft }));

    const result = await runBookingInterruption({
      company,
      userInput: 'Mark?',
      collectedSlots: { name: 'Mark' }
    });

    const reply = result.reply || '';
    const normalized = reply.toLowerCase();

    expect(normalized.includes('i understand it can be confusing')).toBe(false);
    expect(reply.trim().endsWith(DEFAULT_RETURN_QUESTION)).toBe(true);
  });
});
