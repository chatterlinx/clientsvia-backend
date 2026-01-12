function makeCompanyWithDescribingProblem(describingProblem) {
  return {
    aiAgentSettings: {
      frontDeskBehavior: {
        detectionTriggers: {
          describingProblem
        }
      }
    }
  };
}

// Mirrors ConversationEngine booking interrupt logic at a unit-test granularity.
// (We keep this test focused on the heuristic itself so it’s stable and fast.)
function looksLikeBookingInterruptQuestion({ userText, company }) {
  const userTextTrimmed = (userText || '').trim();
  const userTextLower = userTextTrimmed.toLowerCase();

  const hasQuestionMark = userTextTrimmed.includes('?');
  const startsWithQuestionWord = /^(what|when|where|why|how|can you|could you|do you|does|are you|will you)\b/i.test(userTextTrimmed);
  const hasInterruptKeywords = /\b(soonest|earliest|available|price|cost|how much|warranty|hours|open|close)\b/i.test(userTextLower);

  const looksLikeSlotAnswer =
    /^(my name|name is|i'm|it's|call me|yes|yeah|no|nope)/i.test(userTextTrimmed) ||
    /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(userTextTrimmed) ||
    /^\d+\s+\w+/.test(userTextTrimmed);

  const detectionTriggers = company?.aiAgentSettings?.frontDeskBehavior?.detectionTriggers || {};
  const describingProblem = Array.isArray(detectionTriggers.describingProblem) ? detectionTriggers.describingProblem : [];
  const hasProblemMarker =
    describingProblem.length > 0
      ? describingProblem.some(p => userTextLower.includes((p || '').toString().toLowerCase()))
      : /\b(thermostat|not working|not cooling|blank screen|won't start|no power|leak|broken)\b/i.test(userTextLower);

  const hasQuestionIntentAnywhere =
    /\b(why|how|what)\b/i.test(userTextLower) ||
    /\b(do you know|can you tell me|help me understand)\b/i.test(userTextLower);

  const looksLikeQuestion =
    (hasQuestionMark || startsWithQuestionWord || hasInterruptKeywords || (hasQuestionIntentAnywhere && hasProblemMarker)) &&
    !looksLikeSlotAnswer;

  return looksLikeQuestion;
}

describe('BOOKING interrupt detection', () => {
  test('detects off-rails troubleshooting phrased as a statement (no question mark, no leading question word)', () => {
    const company = makeCompanyWithDescribingProblem(['thermostat', 'not working']);
    expect(
      looksLikeBookingInterruptQuestion({
        userText: "I need to understand why my thermostat is not working you guys been here three times already",
        company
      })
    ).toBe(true);
  });

  test('does NOT treat name statements as a booking interrupt', () => {
    const company = makeCompanyWithDescribingProblem(['thermostat', 'not working']);
    expect(
      looksLikeBookingInterruptQuestion({
        userText: "my name is Mark",
        company
      })
    ).toBe(false);
  });
});

