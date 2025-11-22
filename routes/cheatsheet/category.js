/**
 * ============================================================================
 * CHEATSHEET CATEGORY ROUTES
 * ============================================================================
 * 
 * API route for setting and locking a company's CheatSheet category.
 * Once set, the category is locked and cannot be changed (without override).
 * 
 * SCOPE:
 * - Version History → Local Configurations feature only
 * - Does NOT affect agent runtime
 * 
 * ROUTE:
 * - POST /api/cheatsheet/category - Set and lock category
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const Company = require('../../models/v2Company');
const GlobalCategory = require('../../models/GlobalCategory');
const { authenticateJWT: authMiddleware } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// ============================================================================
// MIDDLEWARE
// ============================================================================

/**
 * Extract user email from authenticated request
 */
function getUserEmail(req) {
  return req.user?.email || req.user?.username || 'System';
}

// ============================================================================
// ROUTES
// ============================================================================

/**
 * POST /api/cheatsheet/category
 * Set and lock company's CheatSheet category
 */
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { companyId, categoryId } = req.body;
    
    // Validate input
    if (!companyId || !categoryId) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: 'companyId and categoryId are required'
      });
    }
    
    // Validate company exists
    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'COMPANY_NOT_FOUND',
        message: 'Company not found'
      });
    }
    
    // Validate category exists
    const category = await GlobalCategory.findById(categoryId);
    if (!category) {
      return res.status(404).json({
        success: false,
        error: 'CATEGORY_NOT_FOUND',
        message: 'Category not found'
      });
    }
    
    // Check if category is already set
    if (company.cheatSheetCategoryId) {
      // If trying to set to a different category → reject (locked)
      if (company.cheatSheetCategoryId.toString() !== categoryId.toString()) {
        return res.status(409).json({
          success: false,
          error: 'CATEGORY_LOCKED',
          message: 'Category is already set and locked. Cannot be changed without admin override.'
        });
      }
      
      // If setting to the same category → idempotent, return success
      logger.debug('CHEATSHEET_CATEGORY_ALREADY_SET', {
        companyId,
        categoryId
      });
      
      return res.json({
        success: true,
        data: {
          companyId,
          categoryId
        }
      });
    }
    
    // Set category (first time)
    company.cheatSheetCategoryId = categoryId;
    await company.save();
    
    logger.info('CHEATSHEET_CATEGORY_SET', {
      companyId,
      categoryId,
      categoryName: category.name,
      setBy: getUserEmail(req)
    });
    
    res.json({
      success: true,
      data: {
        companyId,
        categoryId
      }
    });
    
  } catch (err) {
    logger.error('CHEATSHEET_CATEGORY_SET_ERROR', {
      companyId: req.body.companyId,
      categoryId: req.body.categoryId,
      error: err.message,
      stack: err.stack
    });
    
    res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'Failed to set category'
    });
  }
});

// ============================================================================
// ERROR HANDLER (Catch-all)
// ============================================================================

router.use((err, req, res, next) => {
  logger.error('CHEATSHEET_CATEGORY_UNHANDLED_ERROR', {
    method: req.method,
    path: req.path,
    error: err.message,
    stack: err.stack
  });
  
  res.status(500).json({
    success: false,
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred'
  });
});

// ============================================================================
// EXPORT
// ============================================================================

module.exports = router;

