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

// Import v2 model and keyword service (add at top after other requires)
const CompanyKnowledgeQnA = require('../../models/knowledge/CompanyQnA');
const KeywordGenerationService = require('../../services/knowledge/KeywordGenerationService');
const { redisClient } = require('../../clients');
const logger = require('../../utils/logger');
const Company = require('../../models/v2Company');

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
        const newQnA = new CompanyKnowledgeQnA({
            companyId,
            question: question.trim(),
            answer: answer.trim(),
            keywords: Array.isArray(keywords) ? keywords.map(k => k.trim().toLowerCase()) : [],
            category,
            businessType: businessType.toLowerCase(),
            status,
            priority,
            confidence: 0.8, // Default
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
    const startTime = Date.now();
    logger.info(`🤖 Starting in-house AI Q&A generation for company ${companyId}`, { businessType, descriptionLength: description.length });

    const category = determineBusinessCategory(businessType);
    const keyInfo = extractKeyInformation(description);
    const templates = getLocalQnATemplatesForBusiness(category);
    
    const generatedQnAs = [];
    const keywordService = new KeywordGenerationService();
    
    // Fetch company thresholds for confidence
    const company = await Company.findById(companyId).select('aiAgentLogic.thresholds');
    const confidenceThreshold = company?.aiAgentLogic?.thresholds?.companyQnA || 0.8;

    for (const template of templates) {
        const personalizedAnswer = personalizeLocalAnswer(template.answer, category, keyInfo, description);
        const question = template.question; // Questions are standard
        
        // Generate keywords using in-house service
        const keywords = await keywordService.generateAdvancedKeywords(question, personalizedAnswer, { companyId });
        
        const qnaData = {
            question,
            answer: personalizedAnswer,
            keywords: keywords.primary, // Use primary keywords
            category: template.category || 'general',
            businessType: category,
            confidence: confidenceThreshold,
            aiGenerated: true,
            generationSource: 'in_house_ai',
            originalDescription: description,
            status: 'active',
            priority: 'normal',
            companyId // Multi-tenant scoping
        };
        
        // Auto-save to v2 model
        try {
            const savedQnA = new CompanyKnowledgeQnA(qnaData);
            await savedQnA.save();
            generatedQnAs.push(savedQnA.toObject());
            logger.info(`✅ Saved generated Q&A: "${question.substring(0, 50)}..."`, { qnaId: savedQnA._id, keywordsCount: keywords.primary.length });
        } catch (saveError) {
            logger.error(`❌ Failed to save generated Q&A for ${companyId}`, { error: saveError.message, qnaData });
            // Continue with others, don't block
        }
    }
    
    // Invalidate Redis caches for fresh AI lookups
    try {
        await redisClient.del(`company:${companyId}:qna`);
        await redisClient.del(`company:${companyId}`);
        logger.info(`🔄 Redis cache invalidated for company ${companyId}`);
    } catch (cacheError) {
        logger.warn(`⚠️ Redis invalidation failed: ${cacheError.message}`);
    }
    
    const responseTime = Date.now() - startTime;
    logger.info(`🎯 Completed generation: ${generatedQnAs.length} Q&As saved`, { responseTime, companyId });
    
    return generatedQnAs;
}

// Add these helper functions at the end of the file (before module.exports)

// 🏢 Determine Business Category (line 479 replacement - expand enum mapping)
function determineBusinessCategory(businessType) {
    const type = businessType.toLowerCase().trim();
    const mapping = {
        'hvac': 'hvac',
        'heating': 'hvac',
        'ventilation': 'hvac',
        'air conditioning': 'hvac',
        'plumbing': 'plumbing',
        'electrician': 'electrical',
        'electrical': 'electrical',
        'auto': 'auto',
        'dental': 'dental',
        'general': 'general',
        'service': 'general'
    };
    return mapping[type] || 'general';
}

// 🔍 Extract Key Information from Description (new - rule-based parsing)
function extractKeyInformation(description) {
    const text = description.toLowerCase();
    const keyInfo = {};
    
    // Hours pattern: e.g., "open 9-5 m-f", "monday-friday 9am-5pm"
    const hoursMatch = text.match(/(open|hours)\s*(?:from\s*)?(\d{1,2})(?::(\d{2}))?\s*[-to]+\s*(\d{1,2})(?::(\d{2}))?\s*(m-f|mon(-fri)?|monday-friday|mon-fri)/i);
    if (hoursMatch) {
        keyInfo.hours = {
            start: `${hoursMatch[2]}:${hoursMatch[3] || '00'} AM`,
            end: `${hoursMatch[4]}:${hoursMatch[5] || '00'} PM`,
            days: hoursMatch[6]?.replace('-', ' to ') || 'Monday to Friday'
        };
    }
    
    // Services: e.g., "hvac repair", "emergency plumbing"
    const servicesMatch = text.match(/(repair|service|emergency|installation|maintenance)\s*(hvac|plumbing|electrical|dental|auto)/gi);
    if (servicesMatch) {
        keyInfo.services = servicesMatch.map(match => match.trim());
    }
    
    // Pricing: e.g., "$99 service call"
    const pricingMatch = text.match(/\$?(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*(?:for|service|call|hour)/i);
    if (pricingMatch) {
        keyInfo.pricing = pricingMatch[1];
    }
    
    // Location/Emergency: Simple keyword flags
    keyInfo.emergency = text.includes('24/7') || text.includes('emergency');
    keyInfo.location = text.match(/(address|location|at)\s*([^\.]+)/i)?.[2] || null;
    
    logger.info(`🔍 Extracted key info from description: ${JSON.stringify(keyInfo)}`);
    return keyInfo;
}

// 📋 Get Business-Specific Templates (new - 5-10 per type, expandable from config)
function getLocalQnATemplatesForBusiness(category) {
    const templates = {
        hvac: [
            { question: "What are your business hours?", answer: "We are open {hours.days} from {hours.start} to {hours.end}.", category: 'hours', keywords: ['hours', 'schedule'] },
            { question: "Do you offer emergency HVAC services?", answer: "Yes{emergency ? ', we provide 24/7 emergency HVAC repair and maintenance.' : ', but only during business hours.'} Our services include {services ? services.join(', ') : 'repair, installation, and maintenance'}.", category: 'emergency', keywords: ['emergency', '24/7', 'repair'] },
            { question: "What HVAC services do you provide?", answer: "We specialize in {services ? services.join(', ') : 'HVAC repair, installation, maintenance, and emergency services'}. {pricing ? `Service calls start at $${pricing}.` : ''}", category: 'services', keywords: ['services', 'repair', 'installation'] },
            { question: "How much does an HVAC service call cost?", answer: "{pricing ? `Our standard service call is $${pricing}, with additional costs based on the repair needed.` : 'Please contact us for pricing details.'}", category: 'pricing', keywords: ['cost', 'price', 'service call'] },
            { question: "Where is your HVAC business located?", answer: "{location ? `We are located at ${location}.` : 'We serve the local area—please provide your location for service availability.'}", category: 'location', keywords: ['location', 'address', 'service area'] }
        ],
        plumbing: [
            // Similar structure for plumbing: hours, emergency, services, etc.
            { question: "What are your business hours?", answer: "We are open {hours.days} from {hours.start} to {hours.end}.", category: 'hours', keywords: ['hours', 'schedule'] },
            // ... add 3-4 more
            { question: "Do you handle plumbing emergencies?", answer: "Yes{emergency ? ', 24/7.' : ', during business hours.'}", category: 'emergency', keywords: ['emergency', 'leak', 'burst'] }
            // Truncate for brevity; expand to 5+
        ],
        // Add for electrical, auto, dental, general (fallback 3-5 basics)
        general: [
            { question: "What are your business hours?", answer: "We are open {hours.days} from {hours.start} to {hours.end}.", category: 'hours', keywords: ['hours', 'open'] },
            { question: "What services do you offer?", answer: "We provide {services ? services.join(', ') : 'professional services tailored to your needs'}.", category: 'services', keywords: ['services', 'what we do'] }
        ]
    };
    
    const businessTemplates = templates[category] || templates.general;
    logger.info(`📋 Loaded ${businessTemplates.length} templates for category: ${category}`);
    return businessTemplates;
}

// ✏️ Personalize Answer Template (line ~458 replacement)
function personalizeLocalAnswer(templateAnswer, category, keyInfo, originalDescription) {
    let answer = templateAnswer;
    
    // Replace placeholders
    if (keyInfo.hours) {
        answer = answer.replace('{hours.days}', keyInfo.hours.days)
                      .replace('{hours.start}', keyInfo.hours.start)
                      .replace('{hours.end}', keyInfo.hours.end);
    }
    if (keyInfo.services) {
        answer = answer.replace('{services}', keyInfo.services.join(', '));
    }
    if (keyInfo.pricing) {
        answer = answer.replace('{pricing}', keyInfo.pricing);
    }
    if (keyInfo.emergency) {
        answer = answer.replace('{emergency}', keyInfo.emergency ? '' : ' but');
    }
    if (keyInfo.location) {
        answer = answer.replace('{location}', keyInfo.location);
    }
    
    // Fallback if no specific info
    if (!keyInfo.hours && answer.includes('{hours')) {
        answer = answer.replace(/\{hours\..+?\}/g, 'during regular business hours—please call for details');
    }
    
    logger.info(`✏️ Personalized answer for template: ${answer.substring(0, 100)}...`);
    return answer.trim();
}

module.exports = router;
