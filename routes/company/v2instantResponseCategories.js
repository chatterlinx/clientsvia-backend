/**
 * INSTANT RESPONSE CATEGORIES API ROUTES
 * 
 * Purpose: CRUD operations for instant response categories and Q&As
 * - Category management (create, read, update, delete)
 * - Q&A management within categories (add, edit, delete)
 * - AI generation (suggest Q&As, generate variations)
 * - Bulk operations (import, export)
 * 
 * Authentication: All routes require company admin authentication
 * 
 * Base Path: /api/company/:companyId/instant-response-categories
 * 
 * Created: 2025-10-02
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const InstantResponseCategory = require('../../models/InstantResponseCategory');
const KeywordGenerationService = require('../../services/knowledge/KeywordGenerationService');
const smartVariationGenerator = require('../../services/smartVariationGenerator');
const aiResponseSuggestionService = require('../../services/aiResponseSuggestionService');
const Joi = require('joi');
const { authenticateJWT } = require('../../middleware/auth');

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Validate company exists and user has access
 */
async function validateCompanyAccess(req, res, next) {
  try {
    const { companyId } = req.params;
    
    // For now, just validate it's a valid ObjectId
    if (!companyId || !companyId.match(/^[0-9a-fA-F]{24}$/)) {
      return res.status(400).json({
        success: false,
        error: 'Invalid company ID'
      });
    }
    
    next();
  } catch (error) {
    console.error('[InstantResponseCategories] Company validation error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to validate company access'
    });
  }
}

/**
 * Validate category data
 */
const categorySchema = Joi.object({
  name: Joi.string().trim().min(3).max(50).required(),
  description: Joi.string().trim().min(10).max(500).required(),
  icon: Joi.string().optional(),
  color: Joi.string().pattern(/^#[0-9A-F]{6}$/i).optional(),
  enabled: Joi.boolean().optional()
});

function validateCategory(req, res, next) {
  const { error } = categorySchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: error.details[0].message
    });
  }
  next();
}

/**
 * Validate Q&A data
 */
const qnaSchema = Joi.object({
  triggers: Joi.array().items(Joi.string().trim().min(2).max(200)).min(1).max(20).required(),
  response: Joi.string().trim().min(5).max(500).required(),
  keywords: Joi.array().items(Joi.string()).optional(),
  timing: Joi.object({
    enabled: Joi.boolean().optional(),
    waitSeconds: Joi.number().min(10).max(600).optional(),
    followUpMessage: Joi.string().max(500).allow('').optional(),
    secondFollowUp: Joi.object({
      enabled: Joi.boolean().optional(),
      waitSeconds: Joi.number().min(10).max(600).optional(),
      message: Joi.string().max(500).allow('').optional()
    }).optional(),
    maxFollowUps: Joi.number().min(1).max(5).optional(),
    escalationAction: Joi.string().valid('none', 'leave_voicemail', 'transfer', 'end_call').optional(),
    escalationMessage: Joi.string().max(500).allow('').optional()
  }).optional(),
  contextAware: Joi.boolean().optional(),
  toneVariation: Joi.object({
    enabled: Joi.boolean().optional(),
    tone: Joi.string().valid('friendly', 'professional', 'empathetic', 'casual', 'formal').optional()
  }).optional(),
  priority: Joi.number().min(1).max(100).optional(),
  enabled: Joi.boolean().optional(),
  notes: Joi.string().max(1000).allow('').optional()
});

function validateQnA(req, res, next) {
  const { error } = qnaSchema.validate(req.body);
  if (error) {
    return res.status(400).json({
      success: false,
      error: error.details[0].message
    });
  }
  next();
}

// ============================================================================
// CATEGORY CRUD
// ============================================================================

/**
 * GET /:companyId/instant-response-categories
 * Get all categories for a company
 */
router.get('/:companyId/instant-response-categories', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { includeDisabled = 'false', includeQnAs = 'true' } = req.query;

    console.log(`📁 [Categories] Loading for company: ${companyId}`);

    const categories = await InstantResponseCategory.getCompanyCategories(
      companyId,
      includeDisabled === 'true'
    );

    // Optionally strip Q&As for lighter payload
    const response = includeQnAs === 'false'
      ? categories.map(cat => {
          const { qnas, ...rest } = cat;
          return rest;
        })
      : categories;

    res.status(200).json({
      success: true,
      data: response,
      meta: {
        total: categories.length,
        enabled: categories.filter(c => c.enabled).length
      }
    });
  } catch (error) {
    console.error('[Categories] Load error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to load categories'
    });
  }
});

/**
 * POST /:companyId/instant-response-categories/suggest-response
 * AI-powered response suggestion based on context
 * NOTE: Must come BEFORE /:categoryId routes to avoid route collision
 */
router.post('/:companyId/instant-response-categories/suggest-response', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { categoryName, categoryDescription, mainTrigger, variations } = req.body;

    if (!mainTrigger) {
      return res.status(400).json({
        success: false,
        error: 'Main trigger is required'
      });
    }

    console.log(`✨ [AI Suggest] Generating response for: "${mainTrigger}"`);
    console.log(`✨ [AI Suggest] Category: ${categoryName || 'N/A'}`);

    // Get company name for personalization
    const Company = require('../../models/v2Company');
    const company = await Company.findById(companyId).select('companyName').lean();
    const companyName = company?.companyName || '[Company Name]';

    // Generate AI response suggestion
    const suggestedResponse = aiResponseSuggestionService.suggestResponse({
      categoryName: categoryName || '',
      categoryDescription: categoryDescription || '',
      mainTrigger,
      variations: variations || [],
      companyName
    });

    console.log(`✨ [AI Suggest] Generated: "${suggestedResponse}"`);

    res.status(200).json({
      success: true,
      data: {
        response: suggestedResponse
      },
      message: 'AI response generated successfully'
    });
  } catch (error) {
    console.error('[AI Suggest] Error:', error);
    console.error('[AI Suggest] Stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to generate AI response suggestion'
    });
  }
});

/**
 * POST /:companyId/instant-response-categories/generate-variations
 * Generate 8 variations of a trigger phrase
 * NOTE: Must come BEFORE /:categoryId routes to avoid route collision
 */
router.post('/:companyId/instant-response-categories/generate-variations', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { trigger, count = 8 } = req.body;

    if (!trigger) {
      return res.status(400).json({
        success: false,
        error: 'Trigger phrase is required'
      });
    }

    console.log(`✨ [SmartGen] Generating ${count} variations for: "${trigger}"`);

    // Use Smart Variation Generator (algorithmic, no hidden dictionaries)
    let variations = [];
    
    try {
      console.log(`✨ [SmartGen] Calling smart variation generator...`);
      
      // Generate variations using linguistic patterns
      variations = smartVariationGenerator.generateVariations(trigger, count);
      
      console.log(`✨ [SmartGen] Generated ${variations.length} variations`);
      console.log(`✨ [SmartGen] Sample variations:`, variations.slice(0, 3));
      
    } catch (error) {
      console.error('❌ [SmartGen] Generator error:', error.message);
      console.error('❌ [SmartGen] Stack:', error.stack);
      
      // Fallback: Basic case variations
      const base = trigger.trim();
      variations = [
        base.toLowerCase(),
        base.toUpperCase(),
        base.charAt(0).toUpperCase() + base.slice(1).toLowerCase(),
      ].filter((v, i, arr) => arr.indexOf(v) === i) // Remove duplicates
       .filter(v => v !== base) // Remove original
       .slice(0, count);
      
      console.log(`✨ [SmartGen] Fallback generated ${variations.length} variations`);
    }

    // Final safety check: If no variations generated, create basic fallback
    if (variations.length === 0) {
      console.warn('[AI] No variations generated! Creating emergency fallback...');
      const base = trigger.trim();
      variations = [
        base.toLowerCase(),
        base.toUpperCase(),
        base.charAt(0).toUpperCase() + base.slice(1).toLowerCase(),
      ].filter(v => v !== base) // Remove exact match
       .slice(0, Math.min(count, 3));
      
      console.log(`✨ [AI] Emergency fallback: ${variations.length} variations`);
    }
    
    console.log(`✨ [AI] FINAL RESULT: Returning ${variations.length} variations`);
    console.log(`✨ [AI] Variations:`, variations);

    res.status(200).json({
      success: true,
      data: variations,
      message: `Generated ${variations.length} variations`
    });
  } catch (error) {
    console.error('[AI] Generate variations error:', error);
    console.error('[AI] Error stack:', error.stack);
    res.status(500).json({
      success: false,
      error: 'Failed to generate variations'
    });
  }
});

/**
 * GET /:companyId/instant-response-categories/:categoryId
 * Get a specific category with all Q&As
 */
router.get('/:companyId/instant-response-categories/:categoryId', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const { companyId, categoryId } = req.params;

    const category = await InstantResponseCategory.findOne({
      _id: categoryId,
      companyId
    }).lean();

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    res.status(200).json({
      success: true,
      data: category
    });
  } catch (error) {
    console.error('[Categories] Get error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get category'
    });
  }
});

/**
 * POST /:companyId/instant-response-categories
 * Create a new category
 */
router.post('/:companyId/instant-response-categories', authenticateJWT, validateCompanyAccess, validateCategory, async (req, res) => {
  try {
    const { companyId } = req.params;
    const { name, description, icon, color, enabled } = req.body;

    console.log(`➕ [Categories] Creating: ${name}`);

    // Check for duplicate name
    const existing = await InstantResponseCategory.findOne({
      companyId,
      name: { $regex: new RegExp(`^${name}$`, 'i') }
    });

    if (existing) {
      return res.status(409).json({
        success: false,
        error: 'A category with this name already exists'
      });
    }

    // Create category
    const category = new InstantResponseCategory({
      companyId,
      name,
      description,
      icon: icon || '⚡',
      color: color || '#4F46E5',
      enabled: enabled !== undefined ? enabled : true,
      qnas: []
    });

    await category.save();

    res.status(201).json({
      success: true,
      data: category,
      message: 'Category created successfully'
    });
  } catch (error) {
    console.error('[Categories] Create error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create category'
    });
  }
});

/**
 * PUT /:companyId/instant-response-categories/:categoryId
 * Update a category
 */
router.put('/:companyId/instant-response-categories/:categoryId', authenticateJWT, validateCompanyAccess, validateCategory, async (req, res) => {
  try {
    const { companyId, categoryId } = req.params;
    const { name, description, icon, color, enabled } = req.body;

    console.log(`✏️ [Categories] Updating: ${categoryId}`);

    const category = await InstantResponseCategory.findOne({
      _id: categoryId,
      companyId
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    // Check for duplicate name (excluding current category)
    if (name !== category.name) {
      const duplicate = await InstantResponseCategory.findOne({
        companyId,
        _id: { $ne: categoryId },
        name: { $regex: new RegExp(`^${name}$`, 'i') }
      });

      if (duplicate) {
        return res.status(409).json({
          success: false,
          error: 'A category with this name already exists'
        });
      }
    }

    // Update fields
    category.name = name;
    category.description = description;
    if (icon !== undefined) category.icon = icon;
    if (color !== undefined) category.color = color;
    if (enabled !== undefined) category.enabled = enabled;

    await category.save();

    res.status(200).json({
      success: true,
      data: category,
      message: 'Category updated successfully'
    });
  } catch (error) {
    console.error('[Categories] Update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update category'
    });
  }
});

/**
 * DELETE /:companyId/instant-response-categories/:categoryId
 * Delete a category
 */
router.delete('/:companyId/instant-response-categories/:categoryId', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const { companyId, categoryId } = req.params;

    console.log(`🗑️ [Categories] Deleting: ${categoryId}`);

    const result = await InstantResponseCategory.deleteOne({
      _id: categoryId,
      companyId
    });

    if (result.deletedCount === 0) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    res.status(200).json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    console.error('[Categories] Delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete category'
    });
  }
});

// ============================================================================
// Q&A CRUD (WITHIN CATEGORIES)
// ============================================================================

/**
 * POST /:companyId/instant-response-categories/:categoryId/qnas
 * Add a Q&A to a category
 */
router.post('/:companyId/instant-response-categories/:categoryId/qnas', authenticateJWT, validateCompanyAccess, validateQnA, async (req, res) => {
  try {
    const { companyId, categoryId } = req.params;
    const qnaData = req.body;

    console.log(`➕ [Q&A] Adding to category: ${categoryId}`);

    const category = await InstantResponseCategory.findOne({
      _id: categoryId,
      companyId
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    // Auto-generate keywords if not provided
    if (!qnaData.keywords || qnaData.keywords.length === 0) {
      const keywordService = new KeywordGenerationService();
      const triggerText = qnaData.triggers.join(' ');
      const generated = await keywordService.generateAdvancedKeywords(triggerText, qnaData.response, { companyId });
      qnaData.keywords = generated.primary || [];
    }

    // Add Q&A
    const newQnA = category.addQnA(qnaData);
    await category.save();

    res.status(201).json({
      success: true,
      data: newQnA,
      message: 'Q&A added successfully'
    });
  } catch (error) {
    console.error('[Q&A] Add error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to add Q&A'
    });
  }
});

/**
 * PUT /:companyId/instant-response-categories/:categoryId/qnas/:qnaId
 * Update a Q&A
 */
router.put('/:companyId/instant-response-categories/:categoryId/qnas/:qnaId', authenticateJWT, validateCompanyAccess, validateQnA, async (req, res) => {
  try {
    const { companyId, categoryId, qnaId } = req.params;
    const updates = req.body;

    console.log(`✏️ [Q&A] Updating: ${qnaId}`);

    const category = await InstantResponseCategory.findOne({
      _id: categoryId,
      companyId
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    // Regenerate keywords if triggers or response changed
    const qna = category.findQnAById(qnaId);
    if (qna && (updates.triggers || updates.response)) {
      const keywordService = new KeywordGenerationService();
      const triggerText = (updates.triggers || qna.triggers).join(' ');
      const responseText = updates.response || qna.response;
      const generated = await keywordService.generateAdvancedKeywords(triggerText, responseText, { companyId });
      updates.keywords = generated.primary || [];
    }

    const updatedQnA = category.updateQnA(qnaId, updates);

    if (!updatedQnA) {
      return res.status(404).json({
        success: false,
        error: 'Q&A not found'
      });
    }

    await category.save();

    res.status(200).json({
      success: true,
      data: updatedQnA,
      message: 'Q&A updated successfully'
    });
  } catch (error) {
    console.error('[Q&A] Update error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update Q&A'
    });
  }
});

/**
 * DELETE /:companyId/instant-response-categories/:categoryId/qnas/:qnaId
 * Delete a Q&A
 */
router.delete('/:companyId/instant-response-categories/:categoryId/qnas/:qnaId', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const { companyId, categoryId, qnaId } = req.params;

    console.log(`🗑️ [Q&A] Deleting: ${qnaId}`);

    const category = await InstantResponseCategory.findOne({
      _id: categoryId,
      companyId
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    const deleted = category.deleteQnA(qnaId);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Q&A not found'
      });
    }

    await category.save();

    res.status(200).json({
      success: true,
      message: 'Q&A deleted successfully'
    });
  } catch (error) {
    console.error('[Q&A] Delete error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete Q&A'
    });
  }
});

// ============================================================================
// AI GENERATION ENDPOINTS
// ============================================================================

/**
 * POST /:companyId/instant-response-categories/:categoryId/generate-qnas
 * Generate 10 Q&As based on category name and description
 */
router.post('/:companyId/instant-response-categories/:categoryId/generate-qnas', authenticateJWT, validateCompanyAccess, async (req, res) => {
  try {
    const { companyId, categoryId } = req.params;
    const { count = 10 } = req.body;

    console.log(`✨ [AI] Generating ${count} Q&As for category: ${categoryId}`);

    const category = await InstantResponseCategory.findOne({
      _id: categoryId,
      companyId
    });

    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'Category not found'
      });
    }

    // TODO: Implement AI generation logic
    // For now, return placeholder
    const placeholderQnAs = Array.from({ length: Math.min(count, 10) }, (_, i) => ({
      triggers: [`[AI Generated Trigger ${i + 1} based on: ${category.name}]`],
      response: `[AI Generated Response ${i + 1} for category: ${category.description}]`,
      keywords: [],
      priority: 50,
      enabled: true
    }));

    res.status(200).json({
      success: true,
      data: placeholderQnAs,
      message: `Generated ${placeholderQnAs.length} Q&A suggestions`,
      note: 'AI generation will be implemented in Phase 2'
    });
  } catch (error) {
    console.error('[AI] Generate Q&As error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate Q&As'
    });
  }
});

// ============================================================================
// EXPORT ROUTER
// ============================================================================

module.exports = router;

