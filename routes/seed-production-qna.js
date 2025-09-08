// Temporary route to seed production with Q&A data
const express = require('express');
const router = express.Router();

/**
 * @route   POST /api/seed/qna
 * @desc    Seed production with sample Q&A data
 */
router.post('/qna', async (req, res) => {
    try {
        const CompanyQnA = require('../models/knowledge/CompanyQnA');
        
        console.log('🌱 SEED: Starting Q&A seeding...');
        
        // Sample Q&As for HVAC company
        const sampleQnAs = [
            {
                question: "What are your business hours?",
                answer: "We are open Monday through Friday from 8 AM to 6 PM, and Saturday from 9 AM to 4 PM. We are closed on Sundays.",
                companyId: "68813026dd95f599c74e49c7",
                tradeCategories: ["HVAC Residential"],
                keywords: ["business hours", "schedule", "open", "closed"],
                status: "active",
                usageCount: 0
            },
            {
                question: "Do you offer emergency HVAC services?",
                answer: "Yes, we provide 24/7 emergency HVAC services for urgent heating and cooling issues. Emergency service rates apply after hours.",
                companyId: "68813026dd95f599c74e49c7", 
                tradeCategories: ["HVAC Residential"],
                keywords: ["emergency", "24/7", "urgent", "heating", "cooling", "hvac"],
                status: "active",
                usageCount: 0
            },
            {
                question: "What payment methods do you accept?",
                answer: "We accept cash, check, and all major credit cards including Visa, MasterCard, and American Express. We also offer financing options for larger projects.",
                companyId: "68813026dd95f599c74e49c7",
                tradeCategories: ["HVAC Residential"],
                keywords: ["payment", "credit card", "cash", "check", "financing"],
                status: "active", 
                usageCount: 0
            },
            {
                question: "Do you provide plumbing estimates?",
                answer: "Yes, we provide free estimates for all plumbing work. We can schedule an appointment to assess your plumbing needs and provide an accurate quote.",
                companyId: "68813026dd95f599c74e49c7",
                tradeCategories: ["Plumbing"],
                keywords: ["estimate", "free", "plumbing", "quote", "assessment"],
                status: "active",
                usageCount: 0
            },
            {
                question: "What plumbing services do you offer?",
                answer: "We offer comprehensive plumbing services including drain cleaning, pipe repair, water heater installation, leak detection, and bathroom remodeling.",
                companyId: "68813026dd95f599c74e49c7",
                tradeCategories: ["Plumbing"],
                keywords: ["plumbing", "drain", "pipes", "water heater", "leak", "bathroom"],
                status: "active",
                usageCount: 0
            }
        ];
        
        // Check if Q&As already exist
        const existingCount = await CompanyQnA.countDocuments({});
        console.log(`📊 Existing Q&As in database: ${existingCount}`);
        
        if (existingCount > 0) {
            return res.json({
                success: true,
                message: `Database already has ${existingCount} Q&As. Skipping seed.`,
                data: { existing: existingCount }
            });
        }
        
        // Insert sample Q&As
        const insertedQnAs = await CompanyQnA.insertMany(sampleQnAs);
        console.log(`✅ Inserted ${insertedQnAs.length} Q&As`);
        
        res.json({
            success: true,
            message: `Successfully seeded ${insertedQnAs.length} Q&As`,
            data: {
                inserted: insertedQnAs.length,
                qnas: insertedQnAs.map(qna => ({
                    id: qna._id,
                    question: qna.question,
                    tradeCategories: qna.tradeCategories
                }))
            }
        });
        
    } catch (error) {
        console.error('❌ Seed Q&A failed:', error);
        res.status(500).json({
            success: false,
            message: 'Seeding failed',
            error: error.message
        });
    }
});

module.exports = router;
