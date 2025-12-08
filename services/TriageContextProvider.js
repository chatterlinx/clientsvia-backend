/**
 * ============================================================================
 * TRIAGE CONTEXT PROVIDER
 * ============================================================================
 * 
 * Provides triage card context to the Hybrid LLM so it can:
 * 1. Ask the RIGHT diagnostic questions (from our scenarios)
 * 2. Give accurate explanations (from our playbooks)
 * 3. Know urgency levels (emergency vs routine)
 * 4. Route correctly (repair vs maintenance, tech dispatch vs advice)
 * 
 * This is what makes the AI actually SMART about the business,
 * not just "winging it" with generic responses.
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const TriageCard = require('../models/TriageCard');

// Cache for triage cards (per company, 5 min TTL)
const cardCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

class TriageContextProvider {
    
    /**
     * Find matching triage context for caller's issue description
     * 
     * @param {string} companyId - Company ID
     * @param {string} issueDescription - What the caller said about their issue
     * @returns {Promise<Object>} Triage context for LLM
     */
    static async getTriageContext(companyId, issueDescription) {
        if (!companyId || !issueDescription) {
            return this.getDefaultContext();
        }
        
        try {
            // Get active triage cards for this company
            const cards = await this.getActiveCards(companyId);
            
            if (!cards.length) {
                logger.debug('[TRIAGE CONTEXT] No triage cards for company', { companyId });
                return this.getDefaultContext();
            }
            
            // Find matching cards based on keywords
            const matches = this.findMatchingCards(issueDescription, cards);
            
            if (!matches.length) {
                logger.debug('[TRIAGE CONTEXT] No matching cards for issue', { 
                    companyId, 
                    issuePreview: issueDescription.substring(0, 50) 
                });
                return this.getDefaultContext();
            }
            
            // Build context from best match(es)
            const context = this.buildContextFromCards(matches, issueDescription);
            
            logger.info('[TRIAGE CONTEXT] ✅ Context found', {
                companyId,
                matchedCards: matches.length,
                urgency: context.urgency,
                hasQuestions: context.diagnosticQuestions?.length > 0,
                hasExplanation: !!context.explanation
            });
            
            return context;
            
        } catch (error) {
            logger.error('[TRIAGE CONTEXT] Error getting context:', error.message);
            return this.getDefaultContext();
        }
    }
    
    /**
     * Get active triage cards for a company (cached)
     */
    static async getActiveCards(companyId) {
        const cacheKey = `cards:${companyId}`;
        const cached = cardCache.get(cacheKey);
        
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
            return cached.cards;
        }
        
        const cards = await TriageCard.find({
            companyId,
            active: true
        }).sort({ priority: -1 }).lean();
        
        cardCache.set(cacheKey, { cards, timestamp: Date.now() });
        return cards;
    }
    
    /**
     * Find cards that match the issue description
     */
    static findMatchingCards(issueDescription, cards) {
        const normalized = issueDescription.toLowerCase();
        const matches = [];
        
        for (const card of cards) {
            const keywords = card.quickRuleConfig?.keywordsMustHave || [];
            const exclude = card.quickRuleConfig?.keywordsExclude || [];
            
            // Check if any exclude keywords match
            const hasExclude = exclude.some(kw => 
                kw && normalized.includes(kw.toLowerCase())
            );
            if (hasExclude) continue;
            
            // Check if any must-have keywords match
            const matchedKeywords = keywords.filter(kw => 
                kw && normalized.includes(kw.toLowerCase())
            );
            
            if (matchedKeywords.length > 0) {
                matches.push({
                    card,
                    matchedKeywords,
                    matchScore: matchedKeywords.length
                });
            }
        }
        
        // Sort by match score (most keywords matched = best match)
        return matches.sort((a, b) => b.matchScore - a.matchScore);
    }
    
    /**
     * Build LLM context from matched cards
     */
    static buildContextFromCards(matches, issueDescription) {
        // Use the best match (most keywords matched)
        const bestMatch = matches[0];
        const card = bestMatch.card;
        
        // Determine urgency based on action and keywords
        let urgency = 'normal';
        const normalized = issueDescription.toLowerCase();
        
        // Emergency keywords
        if (/gas leak|smell gas|carbon monoxide|smoke|fire|flood|no heat.*cold|freezing/i.test(normalized)) {
            urgency = 'emergency';
        } else if (/water leak|blank thermostat|not turning on|no cool|no power/i.test(normalized)) {
            urgency = 'urgent';
        } else if (/maintenance|tune-?up|check|cleaning|regular/i.test(normalized)) {
            urgency = 'routine';
        }
        
        // Get explanation from card
        const explanation = card.quickRuleConfig?.explanation || 
            card.actionPlaybooks?.explainAndPush?.explanationLines?.[0] ||
            null;
        
        // Get diagnostic questions from card (if any)
        const diagnosticQuestions = this.extractDiagnosticQuestions(card, normalized);
        
        // Get recommended action
        const recommendedAction = card.quickRuleConfig?.action || 'DIRECT_TO_3TIER';
        
        // Build closing/push lines
        const pushLines = card.actionPlaybooks?.explainAndPush?.pushLines || 
            card.frontlinePlaybook?.explainAndPushLines || [];
        
        // Get objection handling (for when caller pushes back)
        const objections = card.frontlinePlaybook?.objectionHandling?.map(oh => ({
            callerSays: oh.customer,
            agentSays: oh.agent
        })) || [];
        
        return {
            matched: true,
            cardId: card._id?.toString(),
            cardName: card.displayName || card.triageLabel,
            urgency,
            recommendedAction,
            explanation,
            diagnosticQuestions,
            pushLines,
            objections,
            matchedKeywords: bestMatch.matchedKeywords,
            
            // Service type suggestion based on urgency
            suggestedServiceType: urgency === 'routine' ? 'maintenance' : 'repair'
        };
    }
    
    /**
     * Extract diagnostic questions based on the issue
     */
    static extractDiagnosticQuestions(card, normalizedIssue) {
        const questions = [];
        
        // Common diagnostic questions based on issue type
        if (/thermostat.*blank|no display|screen.*off/i.test(normalizedIssue)) {
            questions.push(
                "When did you first notice the thermostat was blank?",
                "Have you tried checking the batteries in the thermostat?",
                "Is the unit making any sounds at all, or is it completely silent?",
                "Did anything happen before it went blank - like a power surge or storm?"
            );
        } else if (/water.*leak|leaking|dripping/i.test(normalizedIssue)) {
            questions.push(
                "Where exactly is the water leaking from - the indoor unit, outdoor unit, or somewhere else?",
                "How much water are we talking about - a small puddle or significant flooding?",
                "Is the AC still running, or has it shut off?",
                "How long has the water been leaking?"
            );
        } else if (/not cool|no cool|not cold|warm air|blowing warm/i.test(normalizedIssue)) {
            questions.push(
                "Is the unit running but just not cooling, or is it not turning on at all?",
                "When was the last time the filters were changed?",
                "Is the thermostat set to cool and lower than the room temperature?",
                "Do you hear the outdoor unit running when the AC is on?"
            );
        } else if (/noise|loud|strange sound|making sound/i.test(normalizedIssue)) {
            questions.push(
                "Can you describe the noise - is it a grinding, squealing, banging, or rattling sound?",
                "Is the noise coming from the indoor unit, outdoor unit, or vents?",
                "Is the system still cooling while making the noise?",
                "When did the noise start?"
            );
        } else if (/smell|odor/i.test(normalizedIssue)) {
            questions.push(
                "Can you describe the smell - is it musty, burning, or chemical-like?",
                "Is the smell only when the AC is running, or all the time?",
                "Have you noticed any visible issues like smoke or leaking?"
            );
        }
        
        // If no specific questions, use generic diagnostic
        if (questions.length === 0) {
            questions.push(
                "When did you first notice the issue?",
                "Is this a new problem or has it been happening for a while?",
                "Is the system still running, or has it shut off completely?"
            );
        }
        
        // Only return first 2-3 questions to keep it conversational
        return questions.slice(0, 3);
    }
    
    /**
     * Get default context when no match found
     */
    static getDefaultContext() {
        return {
            matched: false,
            urgency: 'normal',
            recommendedAction: 'DIRECT_TO_3TIER',
            explanation: null,
            diagnosticQuestions: [
                "Can you tell me more about the issue you're experiencing?",
                "When did you first notice the problem?"
            ],
            pushLines: [],
            objections: [],
            suggestedServiceType: null
        };
    }
    
    /**
     * Clear cache for a company (call when cards are updated)
     */
    static clearCache(companyId) {
        cardCache.delete(`cards:${companyId}`);
        logger.debug('[TRIAGE CONTEXT] Cache cleared', { companyId });
    }
}

module.exports = TriageContextProvider;

