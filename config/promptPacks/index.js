const PROMPT_PACKS = {
    universal_v1: {
        id: 'universal_v1',
        tradeKey: 'universal',
        version: 'v1',
        label: 'Universal Defaults v1',
        description: 'Safe defaults used only when explicitly selected by a company.',
        // V83 FIX: Use colons instead of dots - Mongoose Maps don't allow dots in keys
        prompts: {
            'booking:universal:guardrails:missing_prompt_fallback': 'Would you like to schedule a service visit?',
            'booking:universal:interruption:system_header': `You are the BOOKING INTERRUPTION brain for a service business call.

Your ONLY job is to handle quick interruptions or clarifications WHILE a booking form is in progress, then immediately return the caller to the active booking question.

You are NOT doing discovery, NOT doing troubleshooting, and NOT changing the booking flow.

You will receive:
- The caller’s latest message
- The current booking mode (e.g. BOOKING)
- The active slot (e.g. name, phone, address, time)
- The slots collected so far (e.g. name = Mark)
- A “returnToQuestion” string: the exact booking question you must return to (e.g. “What’s the best phone number to reach you?”)

Follow these rules STRICTLY:

1) ONE TURN = ONE JOB
- Do NOT ask about more than one slot in a single reply.
- If the active slot is "phone", only talk about the phone number.
- If you must clarify something, clarify it once, then go back to the active question.

2) ALWAYS RESPECT returnToQuestion
- If “returnToQuestion” is provided, the LAST sentence of your reply MUST be that question verbatim (or with only tiny natural variations).
- Do NOT invent a different booking question.

3) HANDLE SHORT CLARIFICATIONS LIKE “Mark?” CORRECTLY
- Treat short messages like “Mark?”, “Yes?”, “Hello?”, “What?” as clarification checks, not new slots.
- If name is already filled, briefly acknowledge and return to the active booking question.

4) NO DRAMA, NO THERAPY LANGUAGE
- Do NOT say things like:
  - “I understand it can be confusing…”
  - “I know this is frustrating…”
  - “I apologize for any confusion…” (unless the system clearly made a mistake)
- Stay neutral, clear, and businesslike.

5) USE CURRENT SLOT STATE
- If name is already collected and confirmed, do NOT ask for last name unless explicitly missing.
- If the active slot is “phone”, do NOT go back to “What’s your name?”.

6) BE CONCISE
- One short acknowledgment sentence (if needed).
- One clean booking question at the end.
- Avoid repetition of the same question twice in a row.

FORMAT:
- Plain conversational text, no bullets, no emojis.
- Maximum 2 short paragraphs.

If the caller's message is completely unrelated AND there is a returnToQuestion, briefly acknowledge and then restate returnToQuestion.`,
            'booking:universal:interruption:ack_with_name': 'Got it, {name}.',
            'booking:universal:interruption:ack_short': 'Thanks for confirming.',
            'booking:universal:interruption:generic_ack': 'No problem.',
            'booking:universal:interruption:prohibit_phrases': [
                'I understand it can be confusing',
                'I know this is frustrating',
                'I apologize for any confusion'
            ].join('\n')
        }
    },
    hvac_v1: {
        id: 'hvac_v1',
        tradeKey: 'hvac',
        version: 'v1',
        label: 'HVAC Service Flow v1',
        description: 'Service consent + triage prompts for HVAC.',
        prompts: {
            'booking:hvac:service:non_urgent_consent': 'Got it — service on your AC. Would you like me to schedule a technician?',
            'booking:hvac:service:urgent_triage_question': 'Got it — is it completely not cooling at all, or just not keeping up?',
            'booking:hvac:service:post_triage_consent': 'Thanks, that helps. Would you like me to schedule a technician to come out and take a look?',
            'booking:hvac:service:consent_clarify': 'Just to confirm, would you like to book a service visit?'
        }
    },
    hvac_v2: {
        id: 'hvac_v2',
        tradeKey: 'hvac',
        version: 'v2',
        label: 'HVAC Service Flow v2',
        description: 'Refined HVAC prompts with clearer consent wording.',
        prompts: {
            'booking:hvac:service:non_urgent_consent': 'Got it — service on your AC. Should I schedule a technician to come out?',
            'booking:hvac:service:urgent_triage_question': 'Got it — is it not cooling at all, or just not keeping up?',
            'booking:hvac:service:post_triage_consent': 'Thanks, that helps. Would you like me to book a technician to take a look?',
            'booking:hvac:service:consent_clarify': 'Just to confirm, should we schedule a service visit?'
        }
    },
    plumbing_v1: {
        id: 'plumbing_v1',
        tradeKey: 'plumbing',
        version: 'v1',
        label: 'Plumbing Service Flow v1',
        description: 'Service consent + triage prompts for plumbing.',
        prompts: {
            'booking:plumbing:service:non_urgent_consent': 'Got it — plumbing service for an existing issue. Would you like me to schedule a technician?',
            'booking:plumbing:service:urgent_triage_question': 'Got it — is there active leaking or flooding right now, or can it wait for a regular appointment?',
            'booking:plumbing:service:post_triage_consent': 'Thanks, that helps. Would you like me to schedule a technician to come out and take a look?',
            'booking:plumbing:service:consent_clarify': 'Just to confirm, would you like to book a service visit?'
        }
    },
    electrical_v1: {
        id: 'electrical_v1',
        tradeKey: 'electrical',
        version: 'v1',
        label: 'Electrical Service Flow v1',
        description: 'Service consent + triage prompts for electrical.',
        prompts: {
            'booking:electrical:service:non_urgent_consent': 'Got it — electrical service for an existing issue. Would you like me to schedule a technician?',
            'booking:electrical:service:urgent_triage_question': 'Got it — is there sparking, burning smell, or a power loss right now, or can it wait for a regular appointment?',
            'booking:electrical:service:post_triage_consent': 'Thanks, that helps. Would you like me to schedule a technician to come out and take a look?',
            'booking:electrical:service:consent_clarify': 'Just to confirm, would you like to book a service visit?'
        }
    },
    appliance_v1: {
        id: 'appliance_v1',
        tradeKey: 'appliance',
        version: 'v1',
        label: 'Appliance Service Flow v1',
        description: 'Service consent + triage prompts for appliance repair.',
        prompts: {
            'booking:appliance:service:non_urgent_consent': 'Got it — appliance service for an existing issue. Would you like me to schedule a technician?',
            'booking:appliance:service:urgent_triage_question': 'Got it — is the appliance completely down or leaking, or is it still running but not working correctly?',
            'booking:appliance:service:post_triage_consent': 'Thanks, that helps. Would you like me to schedule a technician to come out and take a look?',
            'booking:appliance:service:consent_clarify': 'Just to confirm, would you like to book a service visit?'
        }
    }
};

function getPromptPackById(packId) {
    if (!packId) return null;
    return PROMPT_PACKS[packId] || null;
}

function getLatestPackIdForTrade(tradeKey) {
    const normalized = String(tradeKey || 'universal').trim().toLowerCase();
    const packs = Object.values(PROMPT_PACKS).filter(p => String(p.tradeKey || '').toLowerCase() === normalized);
    if (packs.length === 0) return null;

    const parseVersion = (value) => {
        const match = /v(\d+)/i.exec(String(value || ''));
        return match ? Number(match[1]) : 0;
    };

    const sorted = packs.sort((a, b) => parseVersion(b.version) - parseVersion(a.version));
    return sorted[0]?.id || null;
}

function getPromptPackRegistry() {
    const packs = Object.values(PROMPT_PACKS);
    const byTrade = packs.reduce((acc, pack) => {
        const key = pack.showAsTradeKey || pack.tradeKey || 'universal';
        acc[key] = acc[key] || [];
        acc[key].push(pack.id);
        return acc;
    }, {});

    const latestByTrade = Object.keys(byTrade).reduce((acc, trade) => {
        acc[trade] = getLatestPackIdForTrade(trade);
        return acc;
    }, {});

    return { packs: PROMPT_PACKS, byTrade, latestByTrade };
}

module.exports = {
    PROMPT_PACKS,
    getPromptPackById,
    getPromptPackRegistry,
    getLatestPackIdForTrade
};
