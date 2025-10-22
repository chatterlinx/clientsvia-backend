/**
 * ============================================================================
 * GLOBAL AI BEHAVIOR TEMPLATES - ADMIN ROUTES
 * ============================================================================
 * 
 * PURPOSE:
 * CRUD operations for AI behavior templates that control how the AI agent
 * responds in different scenarios.
 * 
 * ENDPOINTS:
 * GET    /api/admin/global-behaviors          - List all behaviors
 * GET    /api/admin/global-behaviors/:id      - Get one behavior
 * POST   /api/admin/global-behaviors          - Create new behavior
 * PUT    /api/admin/global-behaviors/:id      - Update behavior
 * DELETE /api/admin/global-behaviors/:id      - Delete behavior
 * POST   /api/admin/global-behaviors/seed     - Seed initial 15 behaviors
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const GlobalAIBehaviorTemplate = require('../../models/GlobalAIBehaviorTemplate');

/**
 * GET ALL BEHAVIORS
 * Returns all active behaviors sorted by sortOrder
 */
router.get('/', async (req, res) => {
    try {
        const behaviors = await GlobalAIBehaviorTemplate.getActiveBehaviors();
        
        res.json({
            success: true,
            count: behaviors.length,
            data: behaviors
        });
    } catch (error) {
        console.error('Error fetching behaviors:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch behaviors',
            error: error.message
        });
    }
});

/**
 * GET ONE BEHAVIOR BY ID
 */
router.get('/:id', async (req, res) => {
    try {
        const behavior = await GlobalAIBehaviorTemplate.findById(req.params.id);
        
        if (!behavior) {
            return res.status(404).json({
                success: false,
                message: 'Behavior not found'
            });
        }
        
        res.json({
            success: true,
            data: behavior
        });
    } catch (error) {
        console.error('Error fetching behavior:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch behavior',
            error: error.message
        });
    }
});

/**
 * CREATE NEW BEHAVIOR
 */
router.post('/', async (req, res) => {
    try {
        const { behaviorId, name, icon, instructions, bestFor, examples } = req.body;
        
        // Check if behaviorId already exists
        const existing = await GlobalAIBehaviorTemplate.findOne({ behaviorId });
        if (existing) {
            return res.status(400).json({
                success: false,
                message: 'Behavior ID already exists'
            });
        }
        
        const newBehavior = new GlobalAIBehaviorTemplate({
            behaviorId,
            name,
            icon: icon || '🎭',
            instructions,
            bestFor: bestFor || '',
            examples: examples || [],
            isActive: true,
            isSystemDefault: false,
            createdBy: 'Admin',
            sortOrder: 999 // New behaviors go to the end
        });
        
        await newBehavior.save();
        
        res.status(201).json({
            success: true,
            message: 'Behavior created successfully',
            data: newBehavior
        });
    } catch (error) {
        console.error('Error creating behavior:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to create behavior',
            error: error.message
        });
    }
});

/**
 * UPDATE BEHAVIOR
 */
router.put('/:id', async (req, res) => {
    try {
        const behavior = await GlobalAIBehaviorTemplate.findById(req.params.id);
        
        if (!behavior) {
            return res.status(404).json({
                success: false,
                message: 'Behavior not found'
            });
        }
        
        // Update fields
        const { name, icon, instructions, bestFor, examples, isActive, sortOrder } = req.body;
        
        if (name) {behavior.name = name;}
        if (icon) {behavior.icon = icon;}
        if (instructions) {behavior.instructions = instructions;}
        if (bestFor !== undefined) {behavior.bestFor = bestFor;}
        if (examples) {behavior.examples = examples;}
        if (isActive !== undefined) {behavior.isActive = isActive;}
        if (sortOrder !== undefined) {behavior.sortOrder = sortOrder;}
        
        behavior.lastModifiedBy = 'Admin';
        
        await behavior.save();
        
        res.json({
            success: true,
            message: 'Behavior updated successfully',
            data: behavior
        });
    } catch (error) {
        console.error('Error updating behavior:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to update behavior',
            error: error.message
        });
    }
});

/**
 * DELETE BEHAVIOR
 */
router.delete('/:id', async (req, res) => {
    try {
        const behavior = await GlobalAIBehaviorTemplate.findById(req.params.id);
        
        if (!behavior) {
            return res.status(404).json({
                success: false,
                message: 'Behavior not found'
            });
        }
        
        // Prevent deletion of system defaults
        if (behavior.isSystemDefault) {
            return res.status(403).json({
                success: false,
                message: 'Cannot delete system default behaviors'
            });
        }
        
        await GlobalAIBehaviorTemplate.findByIdAndDelete(req.params.id);
        
        res.json({
            success: true,
            message: 'Behavior deleted successfully'
        });
    } catch (error) {
        console.error('Error deleting behavior:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to delete behavior',
            error: error.message
        });
    }
});

/**
 * SEED INITIAL 15 BEHAVIORS
 */
router.post('/seed', async (req, res) => {
    try {
        // Check if behaviors already exist
        const existingCount = await GlobalAIBehaviorTemplate.countDocuments();
        if (existingCount > 0) {
            return res.status(400).json({
                success: false,
                message: `Database already contains ${existingCount} behaviors. Clear them first or use update endpoints.`
            });
        }
        
        const defaultBehaviors = [
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
        
        await GlobalAIBehaviorTemplate.insertMany(defaultBehaviors);
        
        res.status(201).json({
            success: true,
            message: `Successfully seeded ${defaultBehaviors.length} default behaviors`,
            count: defaultBehaviors.length
        });
    } catch (error) {
        console.error('Error seeding behaviors:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to seed behaviors',
            error: error.message
        });
    }
});

module.exports = router;

