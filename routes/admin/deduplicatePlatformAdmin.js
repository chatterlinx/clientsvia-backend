/**
 * API endpoint to deduplicate Platform Admin companies
 * 
 * DELETE /api/admin/platform-admin-duplicates
 * 
 * This removes duplicate "Platform Admin" companies, keeping only the oldest one.
 * Safe to call multiple times (idempotent).
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const Company = require('../../models/v2Company');
const User = require('../../models/v2User');
const logger = require('../../utils/logger');

// Require admin authentication for all routes
router.use(authenticateJWT);
router.use(requireRole('admin'));

/**
 * DELETE /api/admin/platform-admin-duplicates
 * Remove duplicate Platform Admin companies
 */
router.delete('/platform-admin-duplicates', async (req, res) => {
  try {
    logger.info('[DEDUP] Starting Platform Admin deduplication...');
    
    // Find all Platform Admin companies
    const platformAdminCompanies = await Company.find({
      $or: [
        { companyName: 'Platform Admin' },
        { businessName: 'Platform Admin' },
        { 'metadata.isPlatformAdmin': true }
      ]
    }).sort({ createdAt: 1 }); // Oldest first

    const count = platformAdminCompanies.length;
    
    logger.info(`[DEDUP] Found ${count} Platform Admin companies`);

    // If 0 or 1, nothing to do
    if (count === 0) {
      return res.json({
        success: true,
        message: 'No Platform Admin companies found',
        action: 'none',
        companiesRemaining: 0
      });
    }

    if (count === 1) {
      return res.json({
        success: true,
        message: 'Only 1 Platform Admin exists - no deduplication needed',
        action: 'none',
        canonicalId: platformAdminCompanies[0]._id.toString(),
        companiesRemaining: 1
      });
    }

    // Multiple found - deduplicate!
    const canonical = platformAdminCompanies[0]; // Keep oldest
    const duplicates = platformAdminCompanies.slice(1); // Delete rest
    
    logger.info(`[DEDUP] Canonical Platform Admin: ${canonical._id}`);
    logger.info(`[DEDUP] Duplicates to delete: ${duplicates.length}`);

    // Reassign users from duplicates to canonical
    let totalUsersReassigned = 0;
    const reassignments = [];

    for (const duplicate of duplicates) {
      const usersOnDuplicate = await User.find({ companyId: duplicate._id });
      
      if (usersOnDuplicate.length > 0) {
        logger.info(`[DEDUP] Found ${usersOnDuplicate.length} users on duplicate ${duplicate._id}`);
        
        for (const user of usersOnDuplicate) {
          logger.info(`[DEDUP] Reassigning user ${user.email} to canonical Platform Admin`);
          user.companyId = canonical._id;
          await user.save();
          totalUsersReassigned++;
          
          reassignments.push({
            userId: user._id.toString(),
            email: user.email,
            fromCompanyId: duplicate._id.toString(),
            toCompanyId: canonical._id.toString()
          });
        }
      }
    }

    // Delete duplicate companies
    const deletedCompanyIds = [];
    for (const duplicate of duplicates) {
      logger.info(`[DEDUP] Deleting duplicate: ${duplicate._id}`);
      await Company.findByIdAndDelete(duplicate._id);
      deletedCompanyIds.push(duplicate._id.toString());
    }

    // Verify final state
    const remaining = await Company.find({
      $or: [
        { companyName: 'Platform Admin' },
        { businessName: 'Platform Admin' },
        { 'metadata.isPlatformAdmin': true }
      ]
    });

    logger.info(`[DEDUP] ✅ Deduplication complete!`);
    logger.info(`[DEDUP] Platform Admin companies remaining: ${remaining.length}`);

    res.json({
      success: true,
      message: `Successfully deduplicated Platform Admin companies`,
      action: 'deduplicated',
      summary: {
        totalFound: count,
        canonicalId: canonical._id.toString(),
        canonicalCreatedAt: canonical.createdAt,
        duplicatesDeleted: duplicates.length,
        usersReassigned: totalUsersReassigned,
        companiesRemaining: remaining.length
      },
      details: {
        deletedCompanyIds,
        reassignments
      }
    });

  } catch (error) {
    logger.error('[DEDUP] Deduplication failed:', error);
    res.status(500).json({
      success: false,
      message: 'Deduplication failed',
      error: error.message
    });
  }
});

/**
 * GET /api/admin/platform-admin-status
 * Check Platform Admin status (how many exist)
 */
router.get('/platform-admin-status', async (req, res) => {
  try {
    const platformAdminCompanies = await Company.find({
      $or: [
        { companyName: 'Platform Admin' },
        { businessName: 'Platform Admin' },
        { 'metadata.isPlatformAdmin': true }
      ]
    }).sort({ createdAt: 1 });

    const companies = platformAdminCompanies.map(c => ({
      id: c._id.toString(),
      name: c.companyName || c.businessName,
      createdAt: c.createdAt,
      status: c.accountStatus?.status || 'unknown',
      isPlatformAdmin: c.metadata?.isPlatformAdmin || false
    }));

    // Count users on each
    for (const company of companies) {
      const userCount = await User.countDocuments({ companyId: company.id });
      company.userCount = userCount;
    }

    res.json({
      success: true,
      count: platformAdminCompanies.length,
      status: platformAdminCompanies.length === 0 ? 'none' 
            : platformAdminCompanies.length === 1 ? 'healthy'
            : 'duplicates',
      companies
    });

  } catch (error) {
    logger.error('[DEDUP] Status check failed:', error);
    res.status(500).json({
      success: false,
      message: 'Status check failed',
      error: error.message
    });
  }
});

module.exports = router;

