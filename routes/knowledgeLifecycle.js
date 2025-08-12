/**
 * Knowledge Lifecycle Management Routes
 * Enterprise-grade knowledge management with governance, audit trails, and SLA tracking
 * Replaces: Self-Learning Knowledge Base
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const Company = require('../models/Company');
const KnowledgeLifecycleItem = require('../models/KnowledgeLifecycleItem');
const logger = require('../utils/logger');

/**
 * GET /api/knowledge-lifecycle/:companyId/items
 * Get all knowledge lifecycle items with filtering and pagination
 */
router.get('/:companyId/items', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { 
            status, 
            category, 
            source, 
            page = 1, 
            limit = 50,
            reviewStatus,
            priority,
            tags
        } = req.query;

        const filter = { companyId };
        
        if (status) filter.status = status;
        if (category) filter.category = category;
        if (source) filter.sourceOfTruth = source;
        if (reviewStatus) filter.reviewStatus = reviewStatus;
        if (priority) filter.priority = priority;
        if (tags) filter.tags = { $in: tags.split(',') };

        const options = {
            page: parseInt(page),
            limit: parseInt(limit),
            sort: { updatedAt: -1, priority: -1 },
            populate: ['owner', 'reviewedBy', 'approvedBy']
        };

        const items = await KnowledgeLifecycleItem.paginate(filter, options);

        logger.info('Knowledge lifecycle items retrieved', {
            companyId,
            count: items.docs.length,
            total: items.totalDocs,
            filter
        });

        res.json({
            success: true,
            data: {
                items: items.docs,
                pagination: {
                    page: items.page,
                    pages: items.totalPages,
                    total: items.totalDocs,
                    limit: items.limit
                }
            }
        });

    } catch (error) {
        logger.error('Error retrieving knowledge lifecycle items', { error: error.message, companyId: req.params.companyId });
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve knowledge lifecycle items',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * POST /api/knowledge-lifecycle/:companyId/items
 * Create new knowledge lifecycle item with enterprise validation
 */
router.post('/:companyId/items', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { 
            question, 
            answer, 
            category, 
            priority = 'medium',
            tags = [],
            sourceOfTruth,
            validThrough,
            reviewEveryDays = 90,
            metadata = {}
        } = req.body;

        // Enterprise validation
        if (!question || question.length < 10) {
            return res.status(400).json({
                success: false,
                error: 'Question must be at least 10 characters long'
            });
        }

        if (!answer || answer.length < 20) {
            return res.status(400).json({
                success: false,
                error: 'Answer must be at least 20 characters long'
            });
        }

        if (!category) {
            return res.status(400).json({
                success: false,
                error: 'Category is required for knowledge governance'
            });
        }

        if (!sourceOfTruth) {
            return res.status(400).json({
                success: false,
                error: 'Source of truth is required for audit compliance'
            });
        }

        // Create knowledge lifecycle item
        const knowledgeItem = new KnowledgeLifecycleItem({
            companyId,
            question,
            answer,
            category,
            priority,
            tags,
            sourceOfTruth,
            validThrough: validThrough ? new Date(validThrough) : undefined,
            reviewEveryDays,
            owner: req.user.id,
            status: 'pending_review',
            reviewStatus: 'needs_review',
            metadata,
            auditTrail: [{
                action: 'created',
                performedBy: req.user.id,
                performedAt: new Date(),
                details: 'Knowledge item created via API'
            }],
            createdAt: new Date(),
            updatedAt: new Date()
        });

        await knowledgeItem.save();

        // Log creation for governance
        logger.info('Knowledge lifecycle item created', {
            companyId,
            itemId: knowledgeItem._id,
            category,
            priority,
            sourceOfTruth,
            owner: req.user.id
        });

        res.status(201).json({
            success: true,
            data: knowledgeItem,
            message: 'Knowledge lifecycle item created successfully'
        });

    } catch (error) {
        logger.error('Error creating knowledge lifecycle item', { error: error.message, companyId: req.params.companyId });
        res.status(500).json({
            success: false,
            error: 'Failed to create knowledge lifecycle item',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * PUT /api/knowledge-lifecycle/:companyId/items/:itemId/approve
 * Approve knowledge item with enterprise audit trail
 */
router.put('/:companyId/items/:itemId/approve', authenticateJWT, async (req, res) => {
    try {
        const { companyId, itemId } = req.params;
        const { approvalNotes, modifications = {} } = req.body;

        const knowledgeItem = await KnowledgeLifecycleItem.findOne({
            _id: itemId,
            companyId
        });

        if (!knowledgeItem) {
            return res.status(404).json({
                success: false,
                error: 'Knowledge item not found'
            });
        }

        // Apply modifications if provided
        if (modifications.question) knowledgeItem.question = modifications.question;
        if (modifications.answer) knowledgeItem.answer = modifications.answer;
        if (modifications.category) knowledgeItem.category = modifications.category;
        if (modifications.tags) knowledgeItem.tags = modifications.tags;

        // Update approval status
        knowledgeItem.status = 'approved';
        knowledgeItem.reviewStatus = 'approved';
        knowledgeItem.approvedBy = req.user.id;
        knowledgeItem.approvedAt = new Date();
        knowledgeItem.nextReviewDate = new Date(Date.now() + (knowledgeItem.reviewEveryDays * 24 * 60 * 60 * 1000));
        knowledgeItem.updatedAt = new Date();

        // Add to audit trail
        knowledgeItem.auditTrail.push({
            action: 'approved',
            performedBy: req.user.id,
            performedAt: new Date(),
            details: approvalNotes || 'Knowledge item approved',
            modifications: Object.keys(modifications).length > 0 ? modifications : undefined
        });

        await knowledgeItem.save();

        // Update company knowledge governance metrics
        await updateKnowledgeGovernanceMetrics(companyId);

        logger.info('Knowledge lifecycle item approved', {
            companyId,
            itemId,
            approvedBy: req.user.id,
            modifications: Object.keys(modifications)
        });

        res.json({
            success: true,
            data: knowledgeItem,
            message: 'Knowledge item approved successfully'
        });

    } catch (error) {
        logger.error('Error approving knowledge item', { error: error.message, companyId: req.params.companyId });
        res.status(500).json({
            success: false,
            error: 'Failed to approve knowledge item',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /api/knowledge-lifecycle/:companyId/governance-dashboard
 * Enterprise knowledge governance dashboard
 */
router.get('/:companyId/governance-dashboard', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;

        // Get governance metrics
        const [
            totalItems,
            pendingReview,
            approvedItems,
            expiredItems,
            recentActivity,
            complianceStatus
        ] = await Promise.all([
            KnowledgeLifecycleItem.countDocuments({ companyId }),
            KnowledgeLifecycleItem.countDocuments({ companyId, reviewStatus: 'needs_review' }),
            KnowledgeLifecycleItem.countDocuments({ companyId, status: 'approved' }),
            KnowledgeLifecycleItem.countDocuments({ 
                companyId, 
                validThrough: { $lt: new Date() },
                status: 'approved' 
            }),
            KnowledgeLifecycleItem.find({ companyId })
                .sort({ updatedAt: -1 })
                .limit(10)
                .populate('owner', 'name email'),
            calculateComplianceStatus(companyId)
        ]);

        // Calculate SLA metrics
        const slaMetrics = await calculateSLAMetrics(companyId);

        // Get category distribution
        const categoryStats = await KnowledgeLifecycleItem.aggregate([
            { $match: { companyId: require('mongoose').Types.ObjectId(companyId) } },
            { $group: { _id: '$category', count: { $sum: 1 } } },
            { $sort: { count: -1 } }
        ]);

        const dashboardData = {
            overview: {
                totalItems,
                pendingReview,
                approvedItems,
                expiredItems,
                approvalRate: totalItems > 0 ? ((approvedItems / totalItems) * 100).toFixed(1) : '0'
            },
            slaMetrics,
            complianceStatus,
            categoryDistribution: categoryStats,
            recentActivity: recentActivity.map(item => ({
                id: item._id,
                question: item.question.substring(0, 100) + '...',
                action: item.auditTrail[item.auditTrail.length - 1]?.action,
                performedBy: item.owner?.name,
                performedAt: item.updatedAt,
                status: item.status
            })),
            alerts: await generateGovernanceAlerts(companyId)
        };

        logger.info('Knowledge governance dashboard accessed', { companyId });

        res.json({
            success: true,
            data: dashboardData
        });

    } catch (error) {
        logger.error('Error retrieving governance dashboard', { error: error.message, companyId: req.params.companyId });
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve governance dashboard',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * Helper function to update knowledge governance metrics
 */
async function updateKnowledgeGovernanceMetrics(companyId) {
    try {
        const company = await Company.findById(companyId);
        if (!company) return;

        const stats = await KnowledgeLifecycleItem.aggregate([
            { $match: { companyId: require('mongoose').Types.ObjectId(companyId) } },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    approved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
                    pending: { $sum: { $cond: [{ $eq: ['$reviewStatus', 'needs_review'] }, 1, 0] } },
                    expired: { $sum: { $cond: [{ $lt: ['$validThrough', new Date()] }, 1, 0] } }
                }
            }
        ]);

        if (stats.length > 0) {
            const metric = stats[0];
            
            if (!company.enterpriseMetrics) company.enterpriseMetrics = {};
            if (!company.enterpriseMetrics.knowledgeGovernance) company.enterpriseMetrics.knowledgeGovernance = {};
            
            company.enterpriseMetrics.knowledgeGovernance = {
                totalItems: metric.total,
                approvedItems: metric.approved,
                pendingItems: metric.pending,
                expiredItems: metric.expired,
                approvalRate: metric.total > 0 ? ((metric.approved / metric.total) * 100).toFixed(1) : 0,
                lastUpdated: new Date()
            };

            await company.save();
        }
    } catch (error) {
        logger.error('Error updating knowledge governance metrics', { error: error.message, companyId });
    }
}

/**
 * Helper function to calculate SLA metrics
 */
async function calculateSLAMetrics(companyId) {
    try {
        const items = await KnowledgeLifecycleItem.find({ companyId }).lean();
        
        const now = new Date();
        const slaTargets = {
            reviewTime: 48, // hours
            approvalTime: 72 // hours
        };

        let reviewSLACompliant = 0;
        let approvalSLACompliant = 0;
        let totalReviewed = 0;
        let totalApproved = 0;

        items.forEach(item => {
            if (item.reviewStatus !== 'needs_review') {
                totalReviewed++;
                const reviewTime = (new Date(item.updatedAt) - new Date(item.createdAt)) / (1000 * 60 * 60);
                if (reviewTime <= slaTargets.reviewTime) {
                    reviewSLACompliant++;
                }
            }

            if (item.status === 'approved' && item.approvedAt) {
                totalApproved++;
                const approvalTime = (new Date(item.approvedAt) - new Date(item.createdAt)) / (1000 * 60 * 60);
                if (approvalTime <= slaTargets.approvalTime) {
                    approvalSLACompliant++;
                }
            }
        });

        return {
            reviewSLA: {
                target: `${slaTargets.reviewTime} hours`,
                compliance: totalReviewed > 0 ? ((reviewSLACompliant / totalReviewed) * 100).toFixed(1) : '100',
                compliant: reviewSLACompliant,
                total: totalReviewed
            },
            approvalSLA: {
                target: `${slaTargets.approvalTime} hours`,
                compliance: totalApproved > 0 ? ((approvalSLACompliant / totalApproved) * 100).toFixed(1) : '100',
                compliant: approvalSLACompliant,
                total: totalApproved
            }
        };
    } catch (error) {
        logger.error('Error calculating SLA metrics', { error: error.message, companyId });
        return {
            reviewSLA: { target: '48 hours', compliance: '0', compliant: 0, total: 0 },
            approvalSLA: { target: '72 hours', compliance: '0', compliant: 0, total: 0 }
        };
    }
}

/**
 * Helper function to calculate compliance status
 */
async function calculateComplianceStatus(companyId) {
    try {
        const now = new Date();
        const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

        const [expiredCount, reviewsDue, recentApprovals] = await Promise.all([
            KnowledgeLifecycleItem.countDocuments({
                companyId,
                validThrough: { $lt: now },
                status: 'approved'
            }),
            KnowledgeLifecycleItem.countDocuments({
                companyId,
                nextReviewDate: { $lt: now },
                status: 'approved'
            }),
            KnowledgeLifecycleItem.countDocuments({
                companyId,
                approvedAt: { $gte: thirtyDaysAgo },
                status: 'approved'
            })
        ]);

        let complianceScore = 100;
        const issues = [];

        if (expiredCount > 0) {
            complianceScore -= Math.min(expiredCount * 5, 30);
            issues.push(`${expiredCount} expired knowledge items`);
        }

        if (reviewsDue > 0) {
            complianceScore -= Math.min(reviewsDue * 3, 20);
            issues.push(`${reviewsDue} items overdue for review`);
        }

        return {
            score: Math.max(complianceScore, 0),
            status: complianceScore >= 90 ? 'excellent' : complianceScore >= 70 ? 'good' : complianceScore >= 50 ? 'needs_attention' : 'critical',
            issues,
            recentApprovals
        };
    } catch (error) {
        logger.error('Error calculating compliance status', { error: error.message, companyId });
        return {
            score: 0,
            status: 'unknown',
            issues: ['Error calculating compliance'],
            recentApprovals: 0
        };
    }
}

/**
 * Helper function to generate governance alerts
 */
async function generateGovernanceAlerts(companyId) {
    try {
        const alerts = [];
        const now = new Date();
        const sevenDaysFromNow = new Date(now.getTime() + (7 * 24 * 60 * 60 * 1000));

        // Check for items expiring soon
        const expiringSoon = await KnowledgeLifecycleItem.countDocuments({
            companyId,
            validThrough: { $gt: now, $lt: sevenDaysFromNow },
            status: 'approved'
        });

        if (expiringSoon > 0) {
            alerts.push({
                type: 'warning',
                title: 'Items Expiring Soon',
                message: `${expiringSoon} knowledge items will expire within 7 days`,
                action: 'Review and update expiring items',
                priority: 'medium'
            });
        }

        // Check for pending reviews
        const pendingReviews = await KnowledgeLifecycleItem.countDocuments({
            companyId,
            reviewStatus: 'needs_review'
        });

        if (pendingReviews > 10) {
            alerts.push({
                type: 'error',
                title: 'Review Backlog',
                message: `${pendingReviews} items pending review`,
                action: 'Process pending reviews to maintain SLA',
                priority: 'high'
            });
        }

        return alerts;
    } catch (error) {
        logger.error('Error generating governance alerts', { error: error.message, companyId });
        return [];
    }
}

module.exports = router;
