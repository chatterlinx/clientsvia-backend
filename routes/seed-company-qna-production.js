/**
 * 🚀 PRODUCTION COMPANY Q&A SEEDING ENDPOINT
 * Creates sample Company Q&A data for testing Priority #1 Source
 * Uses Mongoose + Redis architecture for enterprise performance
 */

const express = require('express');
const router = express.Router();
const CompanyQnA = require('../models/knowledge/CompanyQnA');
const Company = require('../models/Company');
const { authenticateJWT } = require('../middleware/auth');

// Sample Company Q&A data for testing AI agent responses
const sampleQnAs = [
  {
    question: "What are your business hours?",
    answer: "We are open Monday through Friday from 8 AM to 6 PM, and Saturday from 9 AM to 3 PM. We're closed on Sundays except for emergency calls.",
    category: "general",
    priority: "high",
    confidence: 0.95,
    tradeCategories: ["HVAC Residential", "Plumbing Residential"]
  },
  {
    question: "Do you offer emergency services?",
    answer: "Yes, we provide 24/7 emergency services for urgent issues like no heat, no hot water, or major leaks. Emergency service calls have a premium rate.",
    category: "emergency",
    priority: "critical",
    confidence: 0.98,
    tradeCategories: ["HVAC Residential", "Plumbing Residential"]
  },
  {
    question: "What payment methods do you accept?",
    answer: "We accept cash, check, all major credit cards (Visa, MasterCard, American Express), and we also offer financing options for larger projects.",
    category: "pricing",
    priority: "high",
    confidence: 0.92
  },
  {
    question: "Do you provide free estimates?",
    answer: "Yes, we provide free estimates for most services. For complex projects or emergency calls, there may be a diagnostic fee that is applied toward the final cost if you proceed with the work.",
    category: "pricing",
    priority: "high",
    confidence: 0.90
  },
  {
    question: "Are you licensed and insured?",
    answer: "Yes, we are fully licensed, bonded, and insured. Our license numbers are available upon request, and we carry comprehensive liability and workers' compensation insurance.",
    category: "general",
    priority: "high",
    confidence: 0.95
  },
  {
    question: "How quickly can you respond to service calls?",
    answer: "For regular service calls, we typically schedule within 24-48 hours. For emergency calls, we respond within 2-4 hours depending on the severity and location.",
    category: "scheduling",
    priority: "high",
    confidence: 0.88,
    tradeCategories: ["HVAC Residential", "Plumbing Residential"]
  }
];

/**
 * @route   POST /api/seed-company-qna/:companyId
 * @desc    Seed Company Q&A data for testing Priority #1 Source
 * @access  Protected (JWT)
 */
router.post('/seed-company-qna/:companyId', authenticateJWT, async (req, res) => {
  try {
    console.log('🚀 PRODUCTION: Starting Company Q&A seeding process...');
    
    const { companyId } = req.params;
    const { clearExisting = true } = req.body;
    
    // Validate company exists
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Company not found',
        companyId
      });
    }
    
    console.log(`🏢 PRODUCTION: Using company: ${company.companyName} (${companyId})`);
    
    // Clear existing Q&As if requested
    let existingCount = 0;
    if (clearExisting) {
      existingCount = await CompanyQnA.countDocuments({ companyId });
      console.log(`📊 PRODUCTION: Found ${existingCount} existing Q&As for this company`);
      
      if (existingCount > 0) {
        console.log('🧹 PRODUCTION: Clearing existing Q&As...');
        await CompanyQnA.deleteMany({ companyId });
        console.log('✅ PRODUCTION: Existing Q&As cleared');
      }
    }
    
    console.log('📝 PRODUCTION: Creating new Company Q&As with auto-generated keywords...');
    
    // Create Q&As with automatic keyword generation
    const createdQnAs = [];
    const results = {
      processed: 0,
      success: 0,
      errors: 0,
      details: []
    };
    
    for (const [index, qnaData] of sampleQnAs.entries()) {
      try {
        results.processed++;
        console.log(`📝 PRODUCTION: Creating Q&A ${index + 1}/${sampleQnAs.length}: "${qnaData.question}"`);
        
        const qna = new CompanyQnA({
          ...qnaData,
          companyId: companyId,
          status: 'active',
          createdBy: req.user._id,
          lastModifiedBy: req.user._id
        });
        
        // Save (this triggers automatic keyword generation via middleware)
        const savedQnA = await qna.save();
        createdQnAs.push(savedQnA);
        results.success++;
        
        const keywordCount = savedQnA.keywords ? savedQnA.keywords.length : 0;
        const keywords = savedQnA.keywords ? savedQnA.keywords.slice(0, 5).join(', ') : 'none';
        
        console.log(`   ✅ PRODUCTION: Created with ${keywordCount} auto-generated keywords: [${keywords}...]`);
        
        results.details.push({
          question: qnaData.question,
          keywordCount,
          keywords: savedQnA.keywords,
          id: savedQnA._id
        });
        
      } catch (error) {
        results.errors++;
        console.error(`❌ PRODUCTION: Failed to create Q&A "${qnaData.question}":`, error.message);
        
        results.details.push({
          question: qnaData.question,
          error: error.message
        });
      }
    }
    
    // Clear Redis cache for this company (following established pattern)
    try {
      const { redisClient } = require('../clients');
      if (redisClient && redisClient.isReady) {
        await redisClient.del(`knowledge:company:${companyId}:*`);
        await redisClient.del(`company:${companyId}`);
        console.log(`🗑️ PRODUCTION: Redis cache cleared for company ${companyId}`);
      }
    } catch (cacheError) {
      console.warn('⚠️ PRODUCTION: Cache clear failed:', cacheError.message);
    }
    
    console.log('\n🎉 PRODUCTION: Company Q&A seeding completed!');
    
    // Test query to verify data
    const testQuery = await CompanyQnA.find({ companyId }).limit(3);
    console.log(`✅ PRODUCTION: Successfully retrieved ${testQuery.length} Q&As from database`);
    
    res.json({
      success: true,
      message: 'Company Q&A seeding completed successfully',
      results: {
        company: {
          id: companyId,
          name: company.companyName
        },
        existing: {
          cleared: clearExisting,
          count: existingCount
        },
        created: results,
        verification: {
          retrievedCount: testQuery.length,
          sampleEntries: testQuery.map(q => ({
            id: q._id,
            question: q.question,
            keywordCount: q.keywords ? q.keywords.length : 0
          }))
        }
      },
      nextSteps: [
        `Open Company Profile for company: ${company.companyName}`,
        'Navigate to AI Agent Logic → Company Q&A tab',
        'Verify Q&As are displayed',
        'Test "Add New Q&A" functionality',
        'Test AI Agent Priority Flow'
      ]
    });
    
  } catch (error) {
    console.error('❌ PRODUCTION: Company Q&A seeding failed:', error);
    
    res.status(500).json({
      success: false,
      error: 'Company Q&A seeding failed',
      details: error.message,
      checkpoint: 'Production seeding endpoint error'
    });
  }
});

/**
 * @route   POST /api/test-save-company-qna/:companyId
 * @desc    Test Company Q&A save functionality (bypasses auth for debugging)
 * @access  Public (for debugging only)
 */
router.post('/test-save-company-qna/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { question, answer, category = 'general' } = req.body;
    
    console.log('🧪 PRODUCTION TEST: Testing Company Q&A save functionality');
    console.log('🧪 PRODUCTION TEST: Company ID:', companyId);
    console.log('🧪 PRODUCTION TEST: Question:', question);
    console.log('🧪 PRODUCTION TEST: Answer:', answer);
    
    if (!question || !answer) {
      return res.status(400).json({
        success: false,
        error: 'Question and answer are required',
        received: { question: !!question, answer: !!answer }
      });
    }
    
    // Validate company exists
    const Company = require('../models/Company');
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Company not found',
        companyId
      });
    }
    
    console.log(`🧪 PRODUCTION TEST: Company found: ${company.companyName}`);
    
    // Create Q&A directly using the service
    const CompanyKnowledgeService = require('../services/knowledge/CompanyKnowledgeService');
    const knowledgeService = new CompanyKnowledgeService();
    
    const qnaData = {
      question: question.trim(),
      answer: answer.trim(),
      category,
      status: 'active',
      priority: 'normal'
    };
    
    console.log('🧪 PRODUCTION TEST: Creating Q&A with data:', qnaData);
    
    const result = await knowledgeService.createQnA(companyId, qnaData, null);
    
    console.log('🧪 PRODUCTION TEST: Service result:', result);
    
    if (result.success) {
      // Test retrieval immediately
      const retrievalTest = await knowledgeService.getCompanyQnAs(companyId, { limit: 5 });
      
      res.json({
        success: true,
        message: 'Company Q&A test save successful',
        created: {
          id: result.data._id,
          question: result.data.question,
          keywordCount: result.data.keywords ? result.data.keywords.length : 0,
          keywords: result.data.keywords ? result.data.keywords.slice(0, 5) : []
        },
        verification: {
          totalQnAs: retrievalTest.data ? retrievalTest.data.length : 0,
          retrievalSuccess: retrievalTest.success
        },
        company: {
          id: companyId,
          name: company.companyName
        }
      });
    } else {
      res.status(400).json({
        success: false,
        error: 'Failed to create Q&A',
        details: result.error,
        serviceResult: result
      });
    }
    
  } catch (error) {
    console.error('🧪 PRODUCTION TEST: Company Q&A save test failed:', error);
    
    res.status(500).json({
      success: false,
      error: 'Company Q&A save test failed',
      details: error.message,
      stack: error.stack
    });
  }
});

/**
 * @route   GET /api/test-company-qna/:companyId
 * @desc    Test Company Q&A retrieval for debugging
 * @access  Protected (JWT)
 */
router.get('/test-company-qna/:companyId', authenticateJWT, async (req, res) => {
  try {
    const { companyId } = req.params;
    
    console.log(`🔍 PRODUCTION: Testing Company Q&A retrieval for ${companyId}`);
    
    // Direct database query
    const qnas = await CompanyQnA.find({ companyId }).sort({ createdAt: -1 });
    
    console.log(`📊 PRODUCTION: Found ${qnas.length} Q&As in database`);
    
    // Test the service layer
    const CompanyKnowledgeService = require('../services/knowledge/CompanyKnowledgeService');
    const knowledgeService = new CompanyKnowledgeService();
    
    const serviceResult = await knowledgeService.getCompanyQnAs(companyId, {
      page: 1,
      limit: 10,
      status: 'active'
    });
    
    console.log(`📊 PRODUCTION: Service layer returned ${serviceResult.data ? serviceResult.data.length : 0} Q&As`);
    
    res.json({
      success: true,
      directQuery: {
        count: qnas.length,
        entries: qnas.map(q => ({
          id: q._id,
          question: q.question,
          keywordCount: q.keywords ? q.keywords.length : 0,
          keywords: q.keywords ? q.keywords.slice(0, 5) : [],
          status: q.status
        }))
      },
      serviceLayer: {
        success: serviceResult.success,
        count: serviceResult.data ? serviceResult.data.length : 0,
        pagination: serviceResult.pagination,
        error: serviceResult.error
      }
    });
    
  } catch (error) {
    console.error('❌ PRODUCTION: Company Q&A test failed:', error);
    
    res.status(500).json({
      success: false,
      error: 'Company Q&A test failed',
      details: error.message
    });
  }
});

module.exports = router;
