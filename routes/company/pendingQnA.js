// routes/company/pendingQnA.js
// Enhanced AI Agent Logic - Pending Q&A Management Routes
// Multi-tenant, Production-grade Implementation

const express = require('express');
const router = express.Router();
const PendingQnA = require('../../models/PendingQnA');
const Company = require('../../models/Company');
const knowledgeBaseService = require('../../services/knowledgeBaseService');
const { ObjectId } = require('mongodb');

// =============================================
// 🚀 GET PENDING Q&AS FOR COMPANY
// =============================================

router.get('/companies/:companyId/pending-qnas', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid company ID format' 
            });
        }

        console.log(`[AI Agent Logic] 📥 Loading pending Q&As for company: ${companyId}`);

        const pendingQnAs = await PendingQnA.find({
            companyId: new ObjectId(companyId),
            status: 'pending'
        })
        .sort({ 
            priority: -1,           // High priority first
            frequency: -1,          // Most frequent first  
            createdAt: -1          // Most recent first
        })
        .limit(100);               // Prevent overwhelming UI

        console.log(`[AI Agent Logic] ✅ Found ${pendingQnAs.length} pending Q&As`);

        res.json(pendingQnAs);

    } catch (error) {
        console.error('[AI Agent Logic] ❌ Error loading pending Q&As:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to load pending Q&As',
            details: error.message 
        });
    }
});

// =============================================
// 🚀 APPROVE PENDING Q&A
// =============================================

router.post('/companies/:companyId/pending-qnas/:qnaId/approve', async (req, res) => {
    try {
        const { companyId, qnaId } = req.params;
        
        if (!ObjectId.isValid(companyId) || !ObjectId.isValid(qnaId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid ID format' 
            });
        }

        console.log(`[AI Agent Logic] ✅ Approving Q&A: ${qnaId} for company: ${companyId}`);

        // Find and approve the Q&A
        const qna = await PendingQnA.findOne({
            _id: new ObjectId(qnaId),
            companyId: new ObjectId(companyId),
            status: 'pending'
        });

        if (!qna) {
            return res.status(404).json({ 
                success: false, 
                error: 'Pending Q&A not found' 
            });
        }

        // Approve the Q&A
        await qna.approve('admin'); // TODO: Get actual user from auth

        // Add to company's knowledge base
        try {
            await knowledgeBaseService.addToCompanyKnowledgeBase(
                companyId, 
                qna.question, 
                qna.proposedAnswer,
                {
                    category: 'AI Agent Auto-Learning',
                    confidence: qna.aiAgentContext?.confidence || 0.8,
                    frequency: qna.frequency,
                    keywords: qna.tags || []
                }
            );
            console.log(`[AI Agent Logic] ✅ Q&A added to knowledge base: ${qnaId}`);
        } catch (kbError) {
            console.error(`[AI Agent Logic] ⚠️ Knowledge base update failed:`, kbError);
            // Continue with approval even if KB update fails
        }

        console.log(`[AI Agent Logic] ✅ Q&A approved successfully: ${qnaId}`);

        res.json({ 
            success: true, 
            message: 'Q&A approved successfully',
            qnaId: qnaId
        });

    } catch (error) {
        console.error('[AI Agent Logic] ❌ Error approving Q&A:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to approve Q&A',
            details: error.message 
        });
    }
});

// =============================================
// 🚀 REJECT PENDING Q&A
// =============================================

router.post('/companies/:companyId/pending-qnas/:qnaId/reject', async (req, res) => {
    try {
        const { companyId, qnaId } = req.params;
        const { notes } = req.body;
        
        if (!ObjectId.isValid(companyId) || !ObjectId.isValid(qnaId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid ID format' 
            });
        }

        console.log(`[AI Agent Logic] ❌ Rejecting Q&A: ${qnaId} for company: ${companyId}`);

        // Find and reject the Q&A
        const qna = await PendingQnA.findOne({
            _id: new ObjectId(qnaId),
            companyId: new ObjectId(companyId),
            status: 'pending'
        });

        if (!qna) {
            return res.status(404).json({ 
                success: false, 
                error: 'Pending Q&A not found' 
            });
        }

        // Reject the Q&A
        await qna.reject('admin', notes || ''); // TODO: Get actual user from auth

        console.log(`[AI Agent Logic] ✅ Q&A rejected successfully: ${qnaId}`);

        res.json({ 
            success: true, 
            message: 'Q&A rejected successfully',
            qnaId: qnaId
        });

    } catch (error) {
        console.error('[AI Agent Logic] ❌ Error rejecting Q&A:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to reject Q&A',
            details: error.message 
        });
    }
});

// =============================================
// 🚀 BULK APPROVE HIGH-CONFIDENCE Q&AS
// =============================================

router.post('/companies/:companyId/pending-qnas/bulk-approve', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { qnaIds, minConfidence = 0.85 } = req.body;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid company ID format' 
            });
        }

        console.log(`[AI Agent Logic] 🚀 Bulk approving Q&As for company: ${companyId}`);
        console.log(`[AI Agent Logic] 📋 Approving ${qnaIds?.length || 0} Q&As with min confidence: ${minConfidence}`);

        let query = {
            companyId: new ObjectId(companyId),
            status: 'pending',
            'aiAgentContext.confidence': { $gte: minConfidence }
        };

        // If specific IDs provided, filter by them
        if (qnaIds && qnaIds.length > 0) {
            query._id = { $in: qnaIds.map(id => new ObjectId(id)) };
        }

        // Find all matching Q&As
        const qnasToApprove = await PendingQnA.find(query);

        console.log(`[AI Agent Logic] 📊 Found ${qnasToApprove.length} Q&As to approve`);

        // Approve each one
        const approvedIds = [];
        const knowledgeBaseErrors = [];
        
        for (const qna of qnasToApprove) {
            await qna.approve('admin'); // TODO: Get actual user from auth
            approvedIds.push(qna._id.toString());
            
            // Add to company knowledge base
            try {
                await knowledgeBaseService.addToCompanyKnowledgeBase(
                    companyId,
                    qna.question,
                    qna.proposedAnswer,
                    {
                        category: 'AI Agent Auto-Learning',
                        confidence: qna.aiAgentContext?.confidence || 0.8,
                        frequency: qna.frequency,
                        keywords: qna.tags || []
                    }
                );
            } catch (kbError) {
                knowledgeBaseErrors.push({ qnaId: qna._id.toString(), error: kbError.message });
                console.error(`[AI Agent Logic] ⚠️ KB update failed for ${qna._id}:`, kbError);
            }
        }

        console.log(`[AI Agent Logic] ✅ Bulk approved ${approvedIds.length} Q&As successfully`);
        if (knowledgeBaseErrors.length > 0) {
            console.log(`[AI Agent Logic] ⚠️ ${knowledgeBaseErrors.length} knowledge base updates failed`);
        }

        res.json({ 
            success: true, 
            message: `${approvedIds.length} Q&As approved successfully`,
            approvedIds: approvedIds,
            count: approvedIds.length,
            knowledgeBaseErrors: knowledgeBaseErrors.length > 0 ? knowledgeBaseErrors : undefined
        });

    } catch (error) {
        console.error('[AI Agent Logic] ❌ Error bulk approving Q&As:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to bulk approve Q&As',
            details: error.message 
        });
    }
});

// =============================================
// 🚀 GET LEARNING STATISTICS
// =============================================

router.get('/companies/:companyId/learning-stats', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { since } = req.query;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid company ID format' 
            });
        }

        console.log(`[AI Agent Logic] 📊 Getting learning stats for company: ${companyId}`);

        // Parse since date or default to last 30 days
        const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        const stats = await PendingQnA.getStatsForCompany(companyId, sinceDate);

        // Calculate additional metrics
        const totalProcessed = stats.totalApproved + stats.totalRejected;
        const avgConfidenceScore = await PendingQnA.aggregate([
            { 
                $match: { 
                    companyId: new ObjectId(companyId),
                    status: { $in: ['approved', 'rejected'] },
                    createdAt: { $gte: sinceDate }
                }
            },
            {
                $group: {
                    _id: null,
                    avgConfidence: { $avg: '$aiAgentContext.confidence' }
                }
            }
        ]);

        // Get knowledge base stats
        const kbStats = await knowledgeBaseService.getKnowledgeBaseStats(companyId);

        const finalStats = {
            totalApproved: stats.totalApproved,
            totalRejected: stats.totalRejected,
            totalPending: stats.totalPending,
            averageConfidence: avgConfidenceScore[0]?.avgConfidence || 0,
            learningRate: Math.round(totalProcessed / 30), // Per day average
            approvalRate: stats.approvalRate,
            pendingRate: stats.pendingRate,
            highPriorityCount: stats.highPriority,
            knowledgeBase: kbStats
        };

        console.log(`[AI Agent Logic] ✅ Learning stats calculated:`, finalStats);

        res.json(finalStats);

    } catch (error) {
        console.error('[AI Agent Logic] ❌ Error getting learning stats:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to get learning statistics',
            details: error.message 
        });
    }
});

// =============================================
// 🚀 UPDATE LEARNING SETTINGS
// =============================================

router.put('/companies/:companyId/learning-settings', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { 
            autoLearningEnabled, 
            learningApprovalMode, 
            learningConfidenceThreshold, 
            maxPendingQnAs 
        } = req.body;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid company ID format' 
            });
        }

        console.log(`[AI Agent Logic] 💾 Updating learning settings for company: ${companyId}`);

        // Validate inputs
        if (learningConfidenceThreshold && (learningConfidenceThreshold < 0 || learningConfidenceThreshold > 1)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Learning confidence threshold must be between 0 and 1' 
            });
        }

        if (maxPendingQnAs && (maxPendingQnAs < 10 || maxPendingQnAs > 500)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Max pending Q&As must be between 10 and 500' 
            });
        }

        // Update company settings
        const updateData = {};
        if (autoLearningEnabled !== undefined) updateData['agentIntelligenceSettings.autoLearningEnabled'] = autoLearningEnabled;
        if (learningApprovalMode !== undefined) updateData['agentIntelligenceSettings.learningApprovalMode'] = learningApprovalMode;
        if (learningConfidenceThreshold !== undefined) updateData['agentIntelligenceSettings.learningConfidenceThreshold'] = learningConfidenceThreshold;
        if (maxPendingQnAs !== undefined) updateData['agentIntelligenceSettings.maxPendingQnAs'] = maxPendingQnAs;

        const company = await Company.findByIdAndUpdate(
            companyId,
            { $set: updateData },
            { new: true, runValidators: true }
        );

        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found' 
            });
        }

        console.log(`[AI Agent Logic] ✅ Learning settings updated successfully`);

        res.json({ 
            success: true, 
            message: 'Learning settings updated successfully',
            settings: company.agentIntelligenceSettings
        });

    } catch (error) {
        console.error('[AI Agent Logic] ❌ Error updating learning settings:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to update learning settings',
            details: error.message 
        });
    }
});

// =============================================
// 🚀 EXPORT KNOWLEDGE BASE
// =============================================

router.get('/companies/:companyId/export-knowledge-base', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid company ID format' 
            });
        }

        console.log(`[AI Agent Logic] 📤 Exporting knowledge base for company: ${companyId}`);

        // Get all approved Q&As
        const approvedQnAs = await PendingQnA.find({
            companyId: new ObjectId(companyId),
            status: 'approved'
        }).select('question proposedAnswer frequency aiAgentContext createdAt approvedAt');

        // Format for export
        const exportData = {
            companyId: companyId,
            exportDate: new Date().toISOString(),
            totalQnAs: approvedQnAs.length,
            qnas: approvedQnAs.map(qna => ({
                question: qna.question,
                answer: qna.proposedAnswer,
                frequency: qna.frequency,
                confidence: qna.aiAgentContext?.confidence || 0,
                source: qna.aiAgentContext?.source || 'unknown',
                createdAt: qna.createdAt,
                approvedAt: qna.reviewedAt
            }))
        };

        console.log(`[AI Agent Logic] ✅ Exporting ${exportData.totalQnAs} approved Q&As`);

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename=knowledge-base-${companyId}-${Date.now()}.json`);
        res.json(exportData);

    } catch (error) {
        console.error('[AI Agent Logic] ❌ Error exporting knowledge base:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to export knowledge base',
            details: error.message 
        });
    }
});

// =============================================
// 🚀 RESET LEARNING STATISTICS
// =============================================

router.post('/companies/:companyId/reset-learning-stats', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        if (!ObjectId.isValid(companyId)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Invalid company ID format' 
            });
        }

        console.log(`[AI Agent Logic] 🔄 Resetting learning stats for company: ${companyId}`);

        // Delete all approved and rejected Q&As (keep pending)
        const result = await PendingQnA.deleteMany({
            companyId: new ObjectId(companyId),
            status: { $in: ['approved', 'rejected'] }
        });

        console.log(`[AI Agent Logic] ✅ Reset complete - deleted ${result.deletedCount} processed Q&As`);

        res.json({ 
            success: true, 
            message: 'Learning statistics reset successfully',
            deletedCount: result.deletedCount
        });

    } catch (error) {
        console.error('[AI Agent Logic] ❌ Error resetting learning stats:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Failed to reset learning statistics',
            details: error.message 
        });
    }
});

module.exports = router;
