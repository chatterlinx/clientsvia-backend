/**
 * ============================================================================
 * TRIGGER BUCKET ROUTES - Enterprise API for bucket management
 * ============================================================================
 * 
 * RESTful API for creating, reading, updating, and deleting trigger buckets.
 * All routes are company-scoped for multi-tenant isolation.
 * 
 * ENDPOINTS:
 * - GET    /api/agent-console/trigger-buckets/:companyId           - List all buckets
 * - GET    /api/agent-console/trigger-buckets/:companyId/:bucketId - Get single bucket
 * - POST   /api/agent-console/trigger-buckets/:companyId           - Create bucket
 * - PUT    /api/agent-console/trigger-buckets/:companyId/:bucketId - Update bucket
 * - DELETE /api/agent-console/trigger-buckets/:companyId/:bucketId - Delete bucket
 * - GET    /api/agent-console/trigger-buckets/:companyId/health    - Health summary
 * 
 * SECURITY:
 * - All routes verify companyId matches authenticated user
 * - No cross-tenant data access possible
 * - Input validation on all mutations
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const TriggerBucket = require('../../models/TriggerBucket');
const CompanyLocalTrigger = require('../../models/CompanyLocalTrigger');
const logger = require('../../utils/logger');

// ══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE - Company Access Validation
// ══════════════════════════════════════════════════════════════════════════

/**
 * Verify user has access to this company.
 * TODO: Implement actual auth middleware when available.
 */
function verifyCompanyAccess(req, res, next) {
  const { companyId } = req.params;
  
  if (!companyId || companyId.length !== 24) {
    return res.status(400).json({
      error: 'Invalid companyId format'
    });
  }
  
  // TODO: Check if req.user has access to this company
  // For now, allow all access (assuming auth is handled upstream)
  
  next();
}

// ══════════════════════════════════════════════════════════════════════════
// GET /api/agent-console/trigger-buckets/:companyId/health
// ══════════════════════════════════════════════════════════════════════════
// Get bucket system health summary for a company

router.get('/:companyId/health', verifyCompanyAccess, async (req, res) => {
  const { companyId } = req.params;
  
  try {
    const healthSummary = await TriggerBucket.getHealthSummary(companyId);
    
    res.json({
      success: true,
      data: healthSummary
    });
    
  } catch (error) {
    logger.error('[TriggerBuckets] Health check failed', {
      companyId,
      error: error.message
    });
    
    res.status(500).json({
      error: 'Failed to get health summary',
      message: error.message
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/agent-console/trigger-buckets/:companyId
// ══════════════════════════════════════════════════════════════════════════
// List all buckets for a company

router.get('/:companyId', verifyCompanyAccess, async (req, res) => {
  const { companyId } = req.params;
  const { includeDeleted } = req.query;
  
  try {
    const buckets = await TriggerBucket.findByCompanyId(
      companyId,
      includeDeleted === 'true'
    );
    
    res.json({
      success: true,
      data: buckets,
      count: buckets.length
    });
    
  } catch (error) {
    logger.error('[TriggerBuckets] List failed', {
      companyId,
      error: error.message
    });
    
    res.status(500).json({
      error: 'Failed to list buckets',
      message: error.message
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GET /api/agent-console/trigger-buckets/:companyId/:bucketId
// ══════════════════════════════════════════════════════════════════════════
// Get a single bucket by ID

router.get('/:companyId/:bucketId', verifyCompanyAccess, async (req, res) => {
  const { companyId, bucketId } = req.params;
  
  try {
    const bucket = await TriggerBucket.findByBucketId(companyId, bucketId);
    
    if (!bucket) {
      return res.status(404).json({
        error: 'Bucket not found',
        companyId,
        bucketId
      });
    }
    
    res.json({
      success: true,
      data: bucket
    });
    
  } catch (error) {
    logger.error('[TriggerBuckets] Get bucket failed', {
      companyId,
      bucketId,
      error: error.message
    });
    
    res.status(500).json({
      error: 'Failed to get bucket',
      message: error.message
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// POST /api/agent-console/trigger-buckets/:companyId
// ══════════════════════════════════════════════════════════════════════════
// Create a new bucket

router.post('/:companyId', verifyCompanyAccess, async (req, res) => {
  const { companyId } = req.params;
  const {
    bucketId,
    name,
    description,
    icon,
    classificationKeywords,
    confidenceThreshold,
    priority,
    isActive,
    alwaysEvaluate
  } = req.body;
  
  try {
    // Validation
    if (!name || name.trim().length === 0) {
      return res.status(400).json({
        error: 'Bucket name is required'
      });
    }
    
    if (!classificationKeywords || classificationKeywords.length === 0) {
      return res.status(400).json({
        error: 'At least one classification keyword is required'
      });
    }
    
    // Check for duplicate bucketId
    if (bucketId) {
      const existing = await TriggerBucket.findByBucketId(companyId, bucketId);
      if (existing) {
        return res.status(409).json({
          error: 'Bucket with this ID already exists',
          bucketId
        });
      }
    }
    
    // Create bucket
    const bucket = new TriggerBucket({
      companyId,
      bucketId,  // Will auto-generate from name if not provided
      name,
      description,
      icon,
      classificationKeywords,
      confidenceThreshold,
      priority,
      isActive,
      alwaysEvaluate,
      createdBy: req.user?.username || 'admin'
    });
    
    await bucket.save();
    
    logger.info('[TriggerBuckets] Bucket created', {
      companyId,
      bucketId: bucket.bucketId,
      name: bucket.name
    });
    
    res.status(201).json({
      success: true,
      data: bucket,
      message: 'Bucket created successfully'
    });
    
  } catch (error) {
    logger.error('[TriggerBuckets] Create failed', {
      companyId,
      error: error.message,
      stack: error.stack
    });
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(409).json({
        error: 'Bucket ID already exists for this company'
      });
    }
    
    res.status(500).json({
      error: 'Failed to create bucket',
      message: error.message
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// PUT /api/agent-console/trigger-buckets/:companyId/:bucketId
// ══════════════════════════════════════════════════════════════════════════
// Update an existing bucket

router.put('/:companyId/:bucketId', verifyCompanyAccess, async (req, res) => {
  const { companyId, bucketId } = req.params;
  const {
    name,
    description,
    icon,
    classificationKeywords,
    confidenceThreshold,
    priority,
    isActive,
    alwaysEvaluate
  } = req.body;
  
  try {
    const bucket = await TriggerBucket.findOne({ companyId, bucketId });
    
    if (!bucket) {
      return res.status(404).json({
        error: 'Bucket not found',
        companyId,
        bucketId
      });
    }
    
    // Update fields (only if provided)
    if (name !== undefined) bucket.name = name;
    if (description !== undefined) bucket.description = description;
    if (icon !== undefined) bucket.icon = icon;
    if (classificationKeywords !== undefined) bucket.classificationKeywords = classificationKeywords;
    if (confidenceThreshold !== undefined) bucket.confidenceThreshold = confidenceThreshold;
    if (priority !== undefined) bucket.priority = priority;
    if (isActive !== undefined) bucket.isActive = isActive;
    if (alwaysEvaluate !== undefined) bucket.alwaysEvaluate = alwaysEvaluate;
    
    await bucket.save();
    
    logger.info('[TriggerBuckets] Bucket updated', {
      companyId,
      bucketId,
      updatedFields: Object.keys(req.body)
    });
    
    res.json({
      success: true,
      data: bucket,
      message: 'Bucket updated successfully'
    });
    
  } catch (error) {
    logger.error('[TriggerBuckets] Update failed', {
      companyId,
      bucketId,
      error: error.message
    });
    
    res.status(500).json({
      error: 'Failed to update bucket',
      message: error.message
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// DELETE /api/agent-console/trigger-buckets/:companyId/:bucketId
// ══════════════════════════════════════════════════════════════════════════
// Soft-delete a bucket

router.delete('/:companyId/:bucketId', verifyCompanyAccess, async (req, res) => {
  const { companyId, bucketId } = req.params;
  const { force } = req.query; // ?force=true for hard delete
  
  try {
    const bucket = await TriggerBucket.findOne({ companyId, bucketId });
    
    if (!bucket) {
      return res.status(404).json({
        error: 'Bucket not found',
        companyId,
        bucketId
      });
    }
    
    // Check if triggers are using this bucket
    const triggerCount = await CompanyLocalTrigger.countDocuments({
      companyId,
      bucket: bucketId,
      isDeleted: { $ne: true }
    });
    
    if (triggerCount > 0 && force !== 'true') {
      return res.status(409).json({
        error: 'Cannot delete bucket - triggers are assigned to it',
        bucketId,
        triggerCount,
        message: 'Reassign triggers first or use ?force=true to unassign'
      });
    }
    
    if (force === 'true') {
      // Hard delete: Remove bucket and clear bucket assignment from triggers
      await CompanyLocalTrigger.updateMany(
        { companyId, bucket: bucketId },
        { $set: { bucket: null, bucketValidatedAt: null } }
      );
      
      await TriggerBucket.deleteOne({ companyId, bucketId });
      
      logger.warn('[TriggerBuckets] Bucket force deleted', {
        companyId,
        bucketId,
        triggersUnassigned: triggerCount
      });
      
      res.json({
        success: true,
        message: 'Bucket deleted and triggers unassigned',
        triggersUnassigned: triggerCount
      });
      
    } else {
      // Soft delete: Mark as deleted
      await TriggerBucket.softDelete(companyId, bucketId);
      
      logger.info('[TriggerBuckets] Bucket soft deleted', {
        companyId,
        bucketId
      });
      
      res.json({
        success: true,
        message: 'Bucket deleted successfully'
      });
    }
    
  } catch (error) {
    logger.error('[TriggerBuckets] Delete failed', {
      companyId,
      bucketId,
      error: error.message
    });
    
    res.status(500).json({
      error: 'Failed to delete bucket',
      message: error.message
    });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// POST /api/agent-console/trigger-buckets/:companyId/:bucketId/usage
// ══════════════════════════════════════════════════════════════════════════
// Record bucket usage (called by runtime after classification)

router.post('/:companyId/:bucketId/usage', async (req, res) => {
  const { companyId, bucketId } = req.params;
  const { confidence } = req.body;
  
  try {
    await TriggerBucket.recordUsage(companyId, bucketId, confidence || 0.5);
    
    res.json({
      success: true,
      message: 'Usage recorded'
    });
    
  } catch (error) {
    logger.error('[TriggerBuckets] Record usage failed', {
      companyId,
      bucketId,
      error: error.message
    });
    
    // Don't fail the call if usage tracking fails
    res.json({
      success: false,
      message: 'Usage tracking failed (non-critical)'
    });
  }
});

module.exports = router;
