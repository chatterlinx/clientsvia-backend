/**
 * Default Call Flow Sequence Configuration
 * 
 * This defines the DEFAULT order in which processing steps are executed
 * during an incoming call. Admins can customize this per-company.
 * 
 * DESIGN PHILOSOPHY:
 * - Simple priority numbers (no drag-and-drop)
 * - Easy to understand and modify
 * - Crash-proof (just array sort)
 * - Visual up/down arrows for reordering
 */

const defaultFlowSequence = [
    {
        step: 'spam_filter',
        priority: 1,
        enabled: true,
        name: '🚫 Spam Filter',
        description: 'Phone number blacklist/whitelist check (Layer 0)',
        canDisable: false,  // Spam filter is mandatory
        canReorder: true
    },
    {
        step: 'edge_cases',
        priority: 2,
        enabled: true,
        name: '🚨 Edge Cases',
        description: 'AI telemarketer detection, robocalls, dead air (short-circuits entire flow)',
        canDisable: true,
        canReorder: true
    },
    {
        step: 'transfer_rules',
        priority: 3,
        enabled: true,
        name: '📞 Transfer Rules',
        description: 'Emergency, billing, scheduling transfers (bypasses scenarios)',
        canDisable: true,
        canReorder: true
    },
    {
        step: 'ai_routing',
        priority: 4,
        enabled: true,
        name: '🎯 AI Routing',
        description: '3-tier intelligence: Keywords → Semantic → LLM fallback',
        canDisable: false,  // Core routing is mandatory
        canReorder: true
    },
    {
        step: 'guardrails',
        priority: 5,
        enabled: true,
        name: '🛡️ Guardrails',
        description: 'Content filtering (prices, phone numbers, URLs, medical/legal advice)',
        canDisable: true,
        canReorder: true
    },
    {
        step: 'behavior_rules',
        priority: 6,
        enabled: true,
        name: '🎨 Behavior Rules',
        description: 'Text polishing (ACK_OK, POLITE_PROFESSIONAL, etc.)',
        canDisable: true,
        canReorder: true
    }
];

module.exports = defaultFlowSequence;

