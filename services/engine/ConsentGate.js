class ConsentGate {
    static ask({ state }) {
        const consentQuestion = 'Would you like me to schedule a service appointment?';

        return {
            response: consentQuestion,
            matchSource: 'CONSENT_GATE',
            state: {
                ...state,
                lane: 'DISCOVERY',
                consent: {
                    pending: true,
                    askedExplicitly: true
                }
            }
        };
    }

    static evaluate({ company, userInput, state }) {
        if (!(state?.consent?.pending === true && state?.consent?.askedExplicitly === true)) {
            return { granted: false, pending: state?.consent?.pending === true };
        }

        const text = (userInput || '').toLowerCase().trim();
        if (!text) {
            return { granted: false, pending: true };
        }

        const configuredYesWords = company?.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.consentYesWords;
        const fallbackYesWords = ['yes', 'yeah', 'yep', 'yup', 'sure', 'please', 'ok', 'okay', 'absolutely'];
        const yesSet = new Set(
            Array.isArray(configuredYesWords) && configuredYesWords.length > 0
                ? configuredYesWords.map((w) => `${w}`.toLowerCase().trim()).filter(Boolean)
                : fallbackYesWords
        );
        const noSet = new Set(['no', 'nope', 'nah', 'not now']);
        const cleaned = text.replace(/[^a-z'\s]/g, ' ').replace(/\s+/g, ' ').trim();
        const tokens = cleaned.split(' ').filter(Boolean);

        const isYes = tokens.length > 0 && tokens.length <= 3 && tokens.every((t) => yesSet.has(t));
        const isNo = tokens.length > 0 && tokens.length <= 3 && tokens.every((t) => noSet.has(t));

        if (isYes) {
            return { granted: true, pending: false };
        }
        if (isNo) {
            return { granted: false, pending: false };
        }
        return { granted: false, pending: true };
    }
}

module.exports = { ConsentGate };
