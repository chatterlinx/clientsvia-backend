/**
 * bookingClarification.js
 *
 * Deterministic detection for "meta clarification" questions during BOOKING slot collection.
 * Example: "is that what you want?" / "what do you mean?"
 *
 * IMPORTANT:
 * - Triggers are UI-controlled and stored per company.
 * - This is NOT trade Q&A; it should NOT route to scenarios.
 */

function detectBookingClarification(userText, triggers = []) {
    if (!userText || typeof userText !== 'string') return false;
    if (!Array.isArray(triggers) || triggers.length === 0) return false;

    const t = userText.toLowerCase();
    return triggers.some(p => {
        if (!p) return false;
        const needle = String(p).toLowerCase().trim();
        if (!needle) return false;
        return t.includes(needle);
    });
}

module.exports = {
    detectBookingClarification
};

