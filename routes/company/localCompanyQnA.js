/**
 * 🏢 LOCAL COMPANY Q&A ROUTES - V2 CLEAN SYSTEM
 * 
 * Complete CRUD operations for Local Company Q&A management
 * - Multi-tenant isolation per companyId
 * - AI-powered Q&A generation based on business type
 * - Full admin edit/delete capabilities
 * - Enterprise-grade performance and caching
 * - Zero legacy contamination
 */

const express = require('express');
const router = express.Router();
const LocalCompanyQnA = require('../../models/LocalCompanyQnA');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');
const { v4: uuidv4 } = require('uuid');

/**
 * 📋 GET ALL LOCAL COMPANY Q&AS
 * GET /api/company/:companyId/local-qna
 */
router.get('/:companyId/local-qna', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const { status = 'active', businessType, category, limit = 50 } = req.query;

    try {
        logger.info(`📋 Loading Local Company Q&As for company ${companyId}`);

        const query = { companyId };
        
        if (status !== 'all') {
            query.status = status;
        }
        
        if (businessType) {
            query.businessType = businessType;
        }
        
        if (category) {
            query.category = category;
        }

        const qnas = await LocalCompanyQnA.find(query)
            .populate('createdBy', 'email name')
            .populate('lastModifiedBy', 'email name')
            .sort({ priority: -1, confidence: -1, createdAt: -1 })
            .limit(parseInt(limit))
            .lean();

        const responseTime = Date.now() - startTime;
        
        logger.info(`✅ Local Company Q&As loaded successfully for company ${companyId}`, {
            count: qnas.length,
            responseTime
        });

        res.json({
            success: true,
            message: 'Local Company Q&As loaded successfully',
            data: qnas,
            meta: {
                responseTime,
                entriesFound: qnas.length,
                collection: 'LocalCompanyQnA',
                companyId,
                filters: { status, businessType, category }
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Error loading Local Company Q&As for company ${companyId}`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to load Local Company Q&As',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * 📝 CREATE NEW LOCAL COMPANY Q&A
 * POST /api/company/:companyId/local-qna
 */
router.post('/:companyId/local-qna', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const { 
        question, 
        answer, 
        keywords = [], 
        category = 'general',
        businessType = 'general',
        status = 'active',
        priority = 'normal',
        aiGenerated = false,
        generationSource = 'admin_created',
        originalDescription
    } = req.body;

    try {
        logger.info(`📝 Creating new Local Company Q&A for company ${companyId}`);

        // Validation
        if (!question || !answer) {
            return res.status(400).json({
                success: false,
                message: 'Question and answer are required',
                error: 'MISSING_REQUIRED_FIELDS'
            });
        }

        // Create new Q&A
        const newQnA = new LocalCompanyQnA({
            companyId,
            question: question.trim(),
            answer: answer.trim(),
            keywords: Array.isArray(keywords) ? keywords.map(k => k.trim().toLowerCase()) : [],
            category,
            businessType: businessType.toLowerCase(),
            status,
            priority,
            aiGenerated,
            generationSource,
            originalDescription,
            createdBy: req.user.id,
            lastModifiedBy: req.user.id
        });

        const savedQnA = await newQnA.save();
        
        // Populate user references
        await savedQnA.populate('createdBy', 'email name');
        await savedQnA.populate('lastModifiedBy', 'email name');

        const responseTime = Date.now() - startTime;
        
        logger.info(`✅ Local Company Q&A created successfully for company ${companyId}`, {
            qnaId: savedQnA._id,
            responseTime
        });

        res.status(201).json({
            success: true,
            message: 'Local Company Q&A created successfully',
            data: savedQnA,
            meta: {
                responseTime,
                companyId,
                qnaId: savedQnA._id
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Error creating Local Company Q&A for company ${companyId}`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to create Local Company Q&A',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * ✏️ UPDATE LOCAL COMPANY Q&A
 * PUT /api/company/:companyId/local-qna/:qnaId
 */
router.put('/:companyId/local-qna/:qnaId', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, qnaId } = req.params;
    const updateData = req.body;

    try {
        logger.info(`✏️ Updating Local Company Q&A ${qnaId} for company ${companyId}`);

        // Find and update Q&A
        const updatedQnA = await LocalCompanyQnA.findOneAndUpdate(
            { _id: qnaId, companyId },
            {
                ...updateData,
                lastModifiedBy: req.user.id,
                updatedAt: new Date()
            },
            { 
                new: true, 
                runValidators: true 
            }
        ).populate('createdBy', 'email name')
         .populate('lastModifiedBy', 'email name');

        if (!updatedQnA) {
            return res.status(404).json({
                success: false,
                message: 'Local Company Q&A not found',
                error: 'QNA_NOT_FOUND'
            });
        }

        const responseTime = Date.now() - startTime;
        
        logger.info(`✅ Local Company Q&A updated successfully`, {
            qnaId,
            companyId,
            responseTime
        });

        res.json({
            success: true,
            message: 'Local Company Q&A updated successfully',
            data: updatedQnA,
            meta: {
                responseTime,
                companyId,
                qnaId
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Error updating Local Company Q&A ${qnaId}`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to update Local Company Q&A',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * 🗑️ DELETE LOCAL COMPANY Q&A
 * DELETE /api/company/:companyId/local-qna/:qnaId
 */
router.delete('/:companyId/local-qna/:qnaId', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId, qnaId } = req.params;
    const { permanent = false } = req.query;

    try {
        logger.info(`🗑️ Deleting Local Company Q&A ${qnaId} for company ${companyId}`, {
            permanent
        });

        if (permanent === 'true') {
            // Permanent deletion
            const deletedQnA = await LocalCompanyQnA.findOneAndDelete({
                _id: qnaId,
                companyId
            });

            if (!deletedQnA) {
                return res.status(404).json({
                    success: false,
                    message: 'Local Company Q&A not found',
                    error: 'QNA_NOT_FOUND'
                });
            }

            logger.info(`✅ Local Company Q&A permanently deleted`, { qnaId, companyId });
        } else {
            // Soft deletion (archive)
            const archivedQnA = await LocalCompanyQnA.findOneAndUpdate(
                { _id: qnaId, companyId },
                { 
                    status: 'archived',
                    lastModifiedBy: req.user.id,
                    updatedAt: new Date()
                },
                { new: true }
            );

            if (!archivedQnA) {
                return res.status(404).json({
                    success: false,
                    message: 'Local Company Q&A not found',
                    error: 'QNA_NOT_FOUND'
                });
            }

            logger.info(`✅ Local Company Q&A archived`, { qnaId, companyId });
        }

        const responseTime = Date.now() - startTime;

        res.json({
            success: true,
            message: permanent === 'true' ? 
                'Local Company Q&A permanently deleted' : 
                'Local Company Q&A archived',
            meta: {
                responseTime,
                companyId,
                qnaId,
                permanent: permanent === 'true'
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Error deleting Local Company Q&A ${qnaId}`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to delete Local Company Q&A',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * 🤖 AI-POWERED Q&A GENERATION
 * POST /api/company/:companyId/local-qna/generate
 */
router.post('/:companyId/local-qna/generate', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;
    const { businessType, description } = req.body;

    try {
        logger.info(`🤖 Generating AI Q&As for company ${companyId}`, {
            businessType,
            descriptionLength: description?.length
        });

        if (!businessType || !description) {
            return res.status(400).json({
                success: false,
                message: 'Business type and description are required',
                error: 'MISSING_REQUIRED_FIELDS'
            });
        }

        // Generate AI Q&A entries using business-specific logic
        const generatedQnAs = await generateLocalCompanyQnAs(businessType, description, companyId);

        const responseTime = Date.now() - startTime;
        
        logger.info(`✅ AI Q&As generated successfully for company ${companyId}`, {
            count: generatedQnAs.length,
            responseTime
        });

        res.json({
            success: true,
            message: 'AI Q&As generated successfully',
            data: generatedQnAs,
            meta: {
                responseTime,
                entriesGenerated: generatedQnAs.length,
                companyId,
                businessType
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Error generating AI Q&As for company ${companyId}`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to generate AI Q&As',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * 📊 GET LOCAL COMPANY Q&A STATISTICS
 * GET /api/company/:companyId/local-qna/stats
 */
router.get('/:companyId/local-qna/stats', authenticateJWT, async (req, res) => {
    const startTime = Date.now();
    const { companyId } = req.params;

    try {
        logger.info(`📊 Loading Local Company Q&A stats for company ${companyId}`);

        const stats = await LocalCompanyQnA.getCompanyStats(companyId);
        
        const totalCount = await LocalCompanyQnA.countDocuments({ companyId });
        const activeCount = await LocalCompanyQnA.countDocuments({ companyId, status: 'active' });
        
        const responseTime = Date.now() - startTime;

        res.json({
            success: true,
            message: 'Local Company Q&A statistics loaded',
            data: {
                total: totalCount,
                active: activeCount,
                byStatus: stats,
                responseTime
            },
            meta: {
                responseTime,
                companyId
            }
        });

    } catch (error) {
        const responseTime = Date.now() - startTime;
        logger.error(`❌ Error loading Local Company Q&A stats for company ${companyId}`, {
            error: error.message,
            responseTime
        });

        res.status(500).json({
            success: false,
            message: 'Failed to load statistics',
            error: error.message,
            meta: { responseTime }
        });
    }
});

/**
 * 🤖 AI Q&A GENERATION LOGIC - BUSINESS-TYPE AWARE
 */
async function generateLocalCompanyQnAs(businessType, description, companyId) {
    const category = determineBusinessCategory(businessType);
    
    // Extract key information from description
    const keyInfo = extractKeyInformation(description);
    
    // Get business-specific templates
    const templates = getLocalQnATemplatesForBusiness(category);
    
    const generatedQnAs = [];
    
    for (const template of templates) {
        const qna = {
            question: template.question,
            answer: personalizeLocalAnswer(template.answer, category, keyInfo, description),
            keywords: template.keywords,
            category: template.category || 'general',
            businessType: category,
            confidence: 0.8,
            aiGenerated: true,
            generationSource: 'ai_generated',
            originalDescription: description,
            status: 'active',
            priority: 'normal'
        };
        
        generatedQnAs.push(qna);
    }
    
    return generatedQnAs;
}

/**
 * 🏢 Determine Business Category
 */
function determineBusinessCategory(businessType) {
    const type = businessType.toLowerCase();
    
    if (type.includes('dental')) return 'dental';
    if (type.includes('hvac')) return 'hvac';
    if (type.includes('plumb')) return 'plumbing';
    if (type.includes('electric')) return 'electrical';
    if (type.includes('auto')) return 'auto';
    
    return 'general';
}

/**
 * 📋 Get Business-Specific Q&A Templates
 */
function getLocalQnATemplatesForBusiness(category) {
    const businessTemplates = {
        'dental': [
            {
                question: "What are your office hours?",
                answer: "Our office hours are [HOURS]. We also offer [EMERGENCY_SERVICE] for dental emergencies.",
                keywords: ["hours", "open", "closed", "schedule", "appointment", "when", "office hours"],
                category: "hours"
            },
            {
                question: "Do you accept my insurance?",
                answer: "We accept most major dental insurance plans. Please call us with your insurance information and we'll verify your coverage.",
                keywords: ["insurance", "coverage", "accept", "plan", "dental insurance", "benefits"],
                category: "insurance"
            },
            {
                question: "What areas do you serve?",
                answer: "We serve [SERVICE_AREA] and surrounding areas. Contact us to confirm if we serve your location.",
                keywords: ["area", "location", "serve", "coverage", "where", "distance"],
                category: "location"
            },
            {
                question: "Do you handle dental emergencies?",
                answer: "Yes, we provide [EMERGENCY_SERVICE]. Please call us immediately for urgent dental issues.",
                keywords: ["emergency", "urgent", "pain", "tooth", "dental emergency", "after hours"],
                category: "emergency"
            }
        ],
        'hvac': [
            {
                question: "What are your service hours?",
                answer: "Our service hours are [HOURS]. We also offer [EMERGENCY_SERVICE] for HVAC emergencies.",
                keywords: ["hours", "open", "closed", "schedule", "time", "when", "availability"],
                category: "hours"
            },
            {
                question: "Do you offer emergency HVAC services?",
                answer: "Yes, we provide [EMERGENCY_SERVICE] for heating and cooling emergencies.",
                keywords: ["emergency", "urgent", "24/7", "after hours", "weekend", "holiday", "hvac"],
                category: "emergency"
            },
            {
                question: "What areas do you serve?",
                answer: "We serve [SERVICE_AREA] and surrounding areas for all HVAC needs.",
                keywords: ["area", "location", "serve", "coverage", "where", "distance", "travel"],
                category: "location"
            },
            {
                question: "Do you provide free estimates?",
                answer: "Yes, we offer free estimates for HVAC installations and major repairs.",
                keywords: ["estimate", "quote", "free", "cost", "price", "consultation", "evaluation"],
                category: "pricing"
            }
        ],
        'plumbing': [
            {
                question: "What are your service hours?",
                answer: "Our service hours are [HOURS]. We also offer [EMERGENCY_SERVICE] for plumbing emergencies.",
                keywords: ["hours", "open", "closed", "schedule", "time", "when", "availability"],
                category: "hours"
            },
            {
                question: "Do you handle plumbing emergencies?",
                answer: "Yes, we provide [EMERGENCY_SERVICE] for urgent plumbing issues like leaks and clogs.",
                keywords: ["emergency", "urgent", "24/7", "leak", "clog", "burst pipe", "plumbing"],
                category: "emergency"
            },
            {
                question: "What areas do you serve?",
                answer: "We serve [SERVICE_AREA] and surrounding areas for all plumbing services.",
                keywords: ["area", "location", "serve", "coverage", "where", "distance", "travel"],
                category: "location"
            }
        ],
        'general': [
            {
                question: "What are your hours of operation?",
                answer: "Our business hours are [HOURS]. We also offer [EMERGENCY_SERVICE] when needed.",
                keywords: ["hours", "open", "closed", "schedule", "time", "when", "availability"],
                category: "hours"
            },
            {
                question: "What areas do you serve?",
                answer: "We serve [SERVICE_AREA] and surrounding areas. Contact us to confirm service availability.",
                keywords: ["area", "location", "serve", "coverage", "where", "distance", "travel"],
                category: "location"
            },
            {
                question: "Are you licensed and insured?",
                answer: "Yes, we are fully licensed and insured for your protection and peace of mind.",
                keywords: ["licensed", "insured", "certified", "bonded", "qualified", "credentials"],
                category: "services"
            }
        ]
    };

    return businessTemplates[category] || businessTemplates['general'];
}

/**
 * 🔍 Extract Key Information from Description
 */
function extractKeyInformation(description) {
    const keyInfo = {
        hours: null,
        emergency: false,
        serviceArea: 'our local area'
    };

    const descriptionLower = description.toLowerCase();
    
    // Extract service area
    if (descriptionLower.includes('county')) {
        const countyMatch = description.match(/(\w+\s+county)/i);
        if (countyMatch) keyInfo.serviceArea = countyMatch[1];
    } else if (descriptionLower.includes('area')) {
        const areaMatch = description.match(/(\w+\s+area)/i);
        if (areaMatch) keyInfo.serviceArea = areaMatch[1];
    } else if (descriptionLower.includes('city') || descriptionLower.includes('town')) {
        const cityMatch = description.match(/(\w+(?:\s+\w+)?)\s+(?:city|town)/i);
        if (cityMatch) keyInfo.serviceArea = cityMatch[1];
    }

    // Extract hours
    const hoursMatch = description.match(/(\d{1,2})-(\d{1,2})|(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/i);
    if (hoursMatch) {
        keyInfo.hours = hoursMatch[0];
    }

    // Check for emergency service
    if (/emergency|24\/7|after hours/i.test(description)) {
        keyInfo.emergency = true;
    }

    return keyInfo;
}

/**
 * 🎯 Personalize Answer with Business-Specific Information
 */
function personalizeLocalAnswer(answer, category, keyInfo, description) {
    let personalizedAnswer = answer;

    // Replace service area
    personalizedAnswer = personalizedAnswer.replace('[SERVICE_AREA]', keyInfo.serviceArea);

    // Replace hours
    if (keyInfo.hours) {
        personalizedAnswer = personalizedAnswer.replace('[HOURS]', keyInfo.hours);
    } else {
        const defaultHours = category === 'dental' ? 
            'Monday through Friday 8 AM to 5 PM' : 
            'Monday through Friday 8 AM to 6 PM';
        personalizedAnswer = personalizedAnswer.replace('[HOURS]', defaultHours);
    }

    // Replace emergency service
    let emergencyService = 'emergency service availability';
    if (category === 'dental') {
        emergencyService = 'emergency dental care for urgent situations';
    } else if (category === 'hvac' || category === 'plumbing' || category === 'electrical') {
        emergencyService = '24/7 emergency service';
    }
    
    personalizedAnswer = personalizedAnswer.replace('[EMERGENCY_SERVICE]', emergencyService);

    return personalizedAnswer;
}

module.exports = router;
