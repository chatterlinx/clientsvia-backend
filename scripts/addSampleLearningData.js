/**
 * Add sample learning data for testing
 */

const mongoose = require('mongoose');
require('dotenv').config();

const SuggestedKnowledgeEntry = require('../models/SuggestedKnowledgeEntry');
const KnowledgeEntry = require('../models/KnowledgeEntry');

async function addSampleData() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        const companyId = new mongoose.Types.ObjectId('686a680241806a4991f7367f');

        // Create sample suggested knowledge entries
        const suggestions = [
            {
                companyId,
                question: "What are your hours of operation?",
                suggestedAnswer: "We are open Monday through Friday from 8:00 AM to 6:00 PM, and Saturday from 9:00 AM to 4:00 PM. We are closed on Sundays.",
                category: "General",
                confidence: 0.92,
                callId: "call_12345",
                status: "pending"
            },
            {
                companyId,
                question: "Do you offer emergency services?",
                suggestedAnswer: "Yes, we offer 24/7 emergency services for urgent issues. Emergency calls are subject to additional fees.",
                category: "Services",
                confidence: 0.88,
                callId: "call_12346",
                status: "pending"
            },
            {
                companyId,
                question: "What payment methods do you accept?",
                suggestedAnswer: "We accept cash, check, and all major credit cards including Visa, MasterCard, American Express, and Discover. We also offer financing options.",
                category: "Billing",
                confidence: 0.95,
                callId: "call_12347",
                status: "pending"
            }
        ];

        // Add suggestions
        for (const suggestion of suggestions) {
            const existing = await SuggestedKnowledgeEntry.findOne({ 
                companyId, 
                question: suggestion.question 
            });
            
            if (!existing) {
                await SuggestedKnowledgeEntry.create(suggestion);
                console.log(`Added suggestion: ${suggestion.question}`);
            } else {
                console.log(`Suggestion already exists: ${suggestion.question}`);
            }
        }

        // Create sample approved knowledge entries
        const knowledgeEntries = [
            {
                companyId,
                category: "General",
                question: "What is your service area?",
                answer: "We serve the greater metropolitan area including downtown, suburbs, and surrounding counties within a 50-mile radius.",
                keywords: ["service area", "location", "coverage"],
                approved: true
            },
            {
                companyId,
                category: "Services",
                question: "What types of services do you provide?",
                answer: "We provide comprehensive HVAC services including installation, repair, maintenance, and emergency services for both residential and commercial properties.",
                keywords: ["services", "hvac", "installation", "repair"],
                approved: true
            }
        ];

        // Add knowledge entries
        for (const entry of knowledgeEntries) {
            const existing = await KnowledgeEntry.findOne({ 
                companyId, 
                question: entry.question 
            });
            
            if (!existing) {
                await KnowledgeEntry.create(entry);
                console.log(`Added knowledge entry: ${entry.question}`);
            } else {
                console.log(`Knowledge entry already exists: ${entry.question}`);
            }
        }

        console.log('Sample learning data added successfully');
        
    } catch (error) {
        console.error('Error adding sample data:', error);
    } finally {
        await mongoose.disconnect();
        console.log('Disconnected from MongoDB');
    }
}

if (require.main === module) {
    addSampleData();
}

module.exports = { addSampleData };
