// ============================================================================
// BEHAVIOR SEEDER — Auto-Seeds Default AI Behavior Templates
// ============================================================================
//
// PURPOSE:
// Ensures the GlobalAIBehaviorTemplate collection is never empty.
// Runs at startup (BEFORE health check). Idempotent — skips if data exists.
//
// WHY THIS EXISTS:
// The original seed endpoint was retired (returns 410). The 15 default
// behavior templates were dead code below the early return. This seeder
// extracts them into a startup-safe, self-healing mechanism.
//
// CALLED FROM: index.js (startup sequence, before health check)
//
// RULES:
// 1. Only inserts when collection is EMPTY (0 documents)
// 2. Never overwrites or modifies existing behaviors
// 3. Logs clearly on seed vs skip
// 4. Failures are non-fatal — server still starts (health check will alert)
//
// ============================================================================

const logger = require('../../utils/logger');
const GlobalAIBehaviorTemplate = require('../../models/GlobalAIBehaviorTemplate');

// ============================================================================
// DEFAULT BEHAVIOR TEMPLATES — The 15 system defaults
// ============================================================================
// These are the canonical behavior templates that every deployment needs.
// Each maps to a distinct AI personality for handling different caller states.
// ============================================================================

const DEFAULT_BEHAVIORS = [
    {
        behaviorId: 'empathetic_reassuring',
        name: 'Empathetic & Reassuring',
        icon: '😊',
        instructions: 'Calm, slow pace, validating feelings, brief reassurance then practical next step. Avoid platitudes; be specific and human.',
        bestFor: 'Upset, grief, distressed, crying',
        examples: ['Caller is upset', 'Caller is grieving', 'Caller is distressed'],
        sortOrder: 1,
        isSystemDefault: true
    },
    {
        behaviorId: 'professional_efficient',
        name: 'Professional & Efficient',
        icon: '👔',
        instructions: 'Clear, direct, efficient communication. Get to the point quickly while maintaining courtesy. Focus on facts and solutions.',
        bestFor: 'Business calls, routine inquiries, professional contexts',
        examples: ['Business inquiry', 'Service request', 'Information lookup'],
        sortOrder: 2,
        isSystemDefault: true
    },
    {
        behaviorId: 'friendly_warm',
        name: 'Friendly & Warm',
        icon: '🤗',
        instructions: 'Warm, welcoming, personable approach. Use conversational language, show genuine interest, create a comfortable atmosphere.',
        bestFor: 'New customers, general inquiries, relationship building',
        examples: ['First time caller', 'General questions', 'Friendly conversation'],
        sortOrder: 3,
        isSystemDefault: true
    },
    {
        behaviorId: 'urgent_action',
        name: 'Urgent & Action-Oriented',
        icon: '🚨',
        instructions: 'Fast pace, short sentences, decisive verbs, immediate action. Use "right away," "immediately," "I will connect you now."',
        bestFor: 'Emergencies, ASAP requests, urgent needs',
        examples: ['Emergency situation', 'Urgent request', 'Time-sensitive issue'],
        sortOrder: 4,
        isSystemDefault: true
    },
    {
        behaviorId: 'apologetic_solution',
        name: 'Apologetic & Solution-Focused',
        icon: '🙏',
        instructions: 'Acknowledge the issue, sincere apology, then pivot to solution. Focus on what you can do, not what went wrong.',
        bestFor: 'Complaints, service failures, mistakes',
        examples: ['Service complaint', 'Billing error', 'Missed appointment'],
        sortOrder: 5,
        isSystemDefault: true
    },
    {
        behaviorId: 'calm_patient',
        name: 'Calm & Patient',
        icon: '🧘',
        instructions: 'Slow, patient, never rushed. Repeat information clearly, give time for understanding, accommodate confusion.',
        bestFor: 'Elderly callers, confused callers, language barriers',
        examples: ['Elderly caller', 'Confused customer', 'Multiple questions'],
        sortOrder: 6,
        isSystemDefault: true
    },
    {
        behaviorId: 'enthusiastic_positive',
        name: 'Enthusiastic & Positive',
        icon: '🎉',
        instructions: 'High energy, positive language, celebrate good news, express genuine excitement. Use exclamation points sparingly but meaningfully.',
        bestFor: 'Good news, celebrations, positive interactions',
        examples: ['Booking confirmation', 'Special occasion', 'Positive feedback'],
        sortOrder: 7,
        isSystemDefault: true
    },
    {
        behaviorId: 'firm_clear',
        name: 'Firm & Clear Boundaries',
        icon: '💪',
        instructions: 'Professional but firm. State boundaries clearly, no room for negotiation. Polite but assertive.',
        bestFor: 'Policy enforcement, inappropriate requests, boundary setting',
        examples: ['Inappropriate request', 'Policy violation', 'Boundary needed'],
        sortOrder: 8,
        isSystemDefault: true
    },
    {
        behaviorId: 'educational_informative',
        name: 'Educational & Informative',
        icon: '📚',
        instructions: 'Teach and explain clearly. Break down complex topics, use examples, check for understanding. Be patient and thorough.',
        bestFor: 'How-to questions, explanations, first-time users',
        examples: ['Process explanation', 'Feature walkthrough', 'Educational inquiry'],
        sortOrder: 9,
        isSystemDefault: true
    },
    {
        behaviorId: 'consultative_advisory',
        name: 'Consultative & Advisory',
        icon: '🤝',
        instructions: 'Act as trusted advisor. Ask clarifying questions, understand needs, provide recommendations. Guide decision-making.',
        bestFor: 'Complex decisions, recommendations, guidance needed',
        examples: ['Service selection', 'Expert advice', 'Recommendation request'],
        sortOrder: 10,
        isSystemDefault: true
    },
    {
        behaviorId: 'safety_emergency',
        name: 'Safety & Emergency Protocol',
        icon: '🚨',
        instructions: 'Immediate action protocol. Stay calm, get critical info fast, escalate immediately. Safety first, everything else second.',
        bestFor: 'Medical emergencies, safety hazards, critical situations',
        examples: ['Medical emergency', 'Safety hazard', 'Critical issue'],
        sortOrder: 11,
        isSystemDefault: true
    },
    {
        behaviorId: 'accessibility_adaptive',
        name: 'Accessibility & Adaptive',
        icon: '♿',
        instructions: 'Adapt to accessibility needs. Speak clearly, offer alternative formats, accommodate special requirements without making caller feel different.',
        bestFor: 'Hearing impaired, vision impaired, special needs',
        examples: ['Hearing difficulty', 'Vision impairment', 'Special accommodation'],
        sortOrder: 12,
        isSystemDefault: true
    },
    {
        behaviorId: 'casual_conversational',
        name: 'Casual & Conversational',
        icon: '💬',
        instructions: 'Relaxed, conversational, like talking to a friend. Use contractions, casual language, be relatable.',
        bestFor: 'Small talk, off-topic, casual interactions',
        examples: ['Small talk', 'Weather chat', 'Casual conversation'],
        sortOrder: 13,
        isSystemDefault: true
    },
    {
        behaviorId: 'formal_respectful',
        name: 'Formal & Respectful',
        icon: '🎩',
        instructions: 'Formal language, respectful address, professional distance. Use titles, avoid contractions, maintain decorum.',
        bestFor: 'VIP clients, formal contexts, professional settings',
        examples: ['VIP caller', 'Formal inquiry', 'Executive contact'],
        sortOrder: 14,
        isSystemDefault: true
    },
    {
        behaviorId: 'nurturing_supportive',
        name: 'Nurturing & Supportive',
        icon: '🌱',
        instructions: 'Supportive, encouraging, builds confidence. Acknowledge efforts, provide positive reinforcement, be patient and understanding.',
        bestFor: 'Nervous callers, first attempts, learning situations',
        examples: ['Nervous caller', 'First time user', 'Learning process'],
        sortOrder: 15,
        isSystemDefault: true
    }
];

// ============================================================================
// SEEDER FUNCTION
// ============================================================================

/**
 * Ensure default behavior templates exist in the database.
 * Idempotent: only inserts when collection is completely empty.
 * Non-fatal: logs errors but never throws (server must still start).
 *
 * @returns {Promise<{seeded: boolean, count: number, error: string|null}>}
 */
async function ensureBehaviorsSeeded() {
    try {
        const existingCount = await GlobalAIBehaviorTemplate.countDocuments();

        if (existingCount > 0) {
            console.log(`[BEHAVIOR SEEDER] ✅ Skipped — ${existingCount} behaviors already exist`);
            logger.info('[BEHAVIOR SEEDER] Skipped — behaviors already populated', { existingCount });
            return { seeded: false, count: existingCount, error: null };
        }

        // Collection is empty — seed the defaults
        console.log(`[BEHAVIOR SEEDER] 🌱 Seeding ${DEFAULT_BEHAVIORS.length} default behavior templates...`);
        logger.info('[BEHAVIOR SEEDER] Seeding default behaviors', { count: DEFAULT_BEHAVIORS.length });

        await GlobalAIBehaviorTemplate.insertMany(DEFAULT_BEHAVIORS);

        console.log(`[BEHAVIOR SEEDER] ✅ Successfully seeded ${DEFAULT_BEHAVIORS.length} behaviors`);
        logger.info('[BEHAVIOR SEEDER] Seed complete', { count: DEFAULT_BEHAVIORS.length });

        return { seeded: true, count: DEFAULT_BEHAVIORS.length, error: null };

    } catch (error) {
        // Non-fatal — server must still start. Health check will alert.
        console.error(`[BEHAVIOR SEEDER] ❌ Seed failed: ${error.message}`);
        logger.error('[BEHAVIOR SEEDER] Seed failed', { error: error.message, stack: error.stack });

        return { seeded: false, count: 0, error: error.message };
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    ensureBehaviorsSeeded,
    DEFAULT_BEHAVIORS
};
