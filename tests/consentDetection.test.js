/**
 * consentDetection.test.js
 * 
 * V116: Tests for token-based consent detection in determineLane()
 * Verifies that natural consent phrases like "yes, please" are recognized,
 * while longer utterances with non-consent words are rejected.
 */

// Replicate the exact consent logic from FrontDeskRuntime.determineLane()
function isConsentMatch(userInput) {
    const CONSENT_WORDS = new Set([
        'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay',
        'please', 'thanks', 'thank', 'you', 'absolutely',
        'definitely', 'right', 'correct', 'go', 'ahead',
        'sounds', 'good', 'great', 'that', 'works', 'fine',
        'do', 'it', 'lets', "let's", 'can', 'we', 'alright'
    ]);
    
    const cleanedForConsent = (userInput || '').toLowerCase().trim()
        .replace(/[^a-z'\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
    
    const tokens = cleanedForConsent.split(' ').filter(t => t.length > 0);
    
    return tokens.length > 0 
        && tokens.length <= 4 
        && tokens.every(t => CONSENT_WORDS.has(t));
}

describe('V116 Consent Detection (token-based)', () => {
    // ═══════════════════════════════════════════════════════════════════
    // MUST MATCH — natural consent phrases
    // ═══════════════════════════════════════════════════════════════════
    const shouldMatch = [
        'yes',
        'Yes.',
        'yes, please',
        'Yes, please.',
        'yeah',
        'yeah sure',
        'yep',
        'sure',
        'Sure!',
        'ok',
        'okay',
        'ok thanks',
        'OK, thanks!',
        'please',
        'absolutely',
        'definitely',
        'sounds good',
        'Sounds good!',
        'that works',
        'go ahead',
        'lets do it',
        "let's do it",
        'alright',
        'great',
        'fine',
        'yes please thanks',
        'yeah that works',
    ];
    
    test.each(shouldMatch)('"%s" → consent = true', (input) => {
        expect(isConsentMatch(input)).toBe(true);
    });
    
    // ═══════════════════════════════════════════════════════════════════
    // MUST NOT MATCH — real content, not just consent
    // ═══════════════════════════════════════════════════════════════════
    const shouldNotMatch = [
        'yes my AC is broken',
        'yeah I need someone to come look at my furnace',
        'ok so the problem is the thermostat',
        'sure but first let me explain',
        'no',
        'no thanks',
        'not right now',
        'I need to think about it',
        '',
        '   ',
        'my name is mark and my system is not pulling',
    ];
    
    test.each(shouldNotMatch)('"%s" → consent = false', (input) => {
        expect(isConsentMatch(input)).toBe(false);
    });
});
