/**
 * ============================================================================
 * V2 AI KNOWLEDGEBASE ROUTES
 * ============================================================================
 * 
 * PURPOSE: Real-time AI performance monitoring API
 * 
 * ENDPOINTS:
 * GET  /api/company/:companyId/knowledgebase/action-items
 *      → Returns action items (low confidence, fallback, no match calls)
 * 
 * POST /api/company/:companyId/knowledgebase/action-items/:itemId/resolve
 *      → Marks an issue as resolved
 * 
 * DATA SOURCE:
 * - v2AIAgentCallLog (existing collection)
 * - Analyzes calls with:
 *   • confidence < 0.7
 *   • usedFallback: true
 *   • matchedScenario: null
 * 
 * ARCHITECTURE:
 * - Real-time aggregation (no caching for fresh data)
 * - Groups similar questions
 * - Calculates urgency (high/medium/low)
 * - Includes recent call examples
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const v2AIAgentCallLog = require('../../models/v2AIAgentCallLog');
const v2Company = require('../../models/v2Company');

/**
 * GET /api/company/:companyId/knowledgebase/action-items
 * 
 * Returns action items for admin to resolve
 */
router.get('/api/company/:companyId/knowledgebase/action-items', async (req, res) => {
    const { companyId } = req.params;
    
    console.log(`🧠 [KNOWLEDGEBASE API] Fetching action items for company: ${companyId}`);
    
    try {
        // Query call logs for problematic calls
        const problemCalls = await v2AIAgentCallLog.find({
            companyId,
            $or: [
                { 'matchDetails.confidence': { $lt: 0.7 } },
                { usedFallback: true },
                { matchedScenario: null }
            ],
            createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } // Last 30 days
        }).sort({ createdAt: -1 }).limit(500); // Cap at 500 for performance
        
        console.log(`📊 [KNOWLEDGEBASE API] Found ${problemCalls.length} problem calls`);
        
        // Group by similar questions (exact match for now, can enhance with fuzzy matching later)
        const grouped = {};
        
        problemCalls.forEach(call => {
            const question = call.caller?.question || 'Unknown question';
            const key = question.toLowerCase().trim();
            
            if (!grouped[key]) {
                grouped[key] = {
                    _id: `action-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    question: question,
                    count: 0,
                    avgConfidence: 0,
                    confidenceSum: 0,
                    lastOccurrence: call.createdAt,
                    firstOccurrence: call.createdAt,
                    usedFallback: call.usedFallback || false,
                    recentCalls: [],
                    variations: []
                };
            }
            
            grouped[key].count++;
            grouped[key].confidenceSum += (call.matchDetails?.confidence || 0);
            grouped[key].avgConfidence = grouped[key].confidenceSum / grouped[key].count;
            
            // Update timestamps
            if (call.createdAt > grouped[key].lastOccurrence) {
                grouped[key].lastOccurrence = call.createdAt;
            }
            if (call.createdAt < grouped[key].firstOccurrence) {
                grouped[key].firstOccurrence = call.createdAt;
            }
            
            // Store recent calls (max 5)
            if (grouped[key].recentCalls.length < 5) {
                grouped[key].recentCalls.push({
                    timestamp: call.createdAt,
                    question: call.caller?.question,
                    confidence: call.matchDetails?.confidence || 0,
                    aiResponse: call.aiResponse,
                    usedFallback: call.usedFallback
                });
            }
        });
        
        // Convert to array and calculate urgency
        let actionItems = Object.values(grouped).map(item => {
            // Calculate urgency
            let urgency = 'low';
            
            if (item.count >= 10 || item.avgConfidence < 0.4) {
                urgency = 'high';
            } else if (item.count >= 5 || item.avgConfidence < 0.6) {
                urgency = 'medium';
            }
            
            return {
                ...item,
                urgency
            };
        });
        
        // Sort by urgency (high -> medium -> low) then by count
        const urgencyOrder = { high: 3, medium: 2, low: 1 };
        actionItems.sort((a, b) => {
            if (urgencyOrder[a.urgency] !== urgencyOrder[b.urgency]) {
                return urgencyOrder[b.urgency] - urgencyOrder[a.urgency];
            }
            return b.count - a.count;
        });
        
        // Check if company has any resolved issues to filter out
        const company = await v2Company.findById(companyId).select('aiKnowledgebase');
        const resolvedIssues = company?.aiKnowledgebase?.resolvedIssues || [];
        const resolvedQuestions = new Set(resolvedIssues.map(r => r.question.toLowerCase().trim()));
        
        // Filter out resolved issues
        actionItems = actionItems.filter(item => !resolvedQuestions.has(item.question.toLowerCase().trim()));
        
        console.log(`✅ [KNOWLEDGEBASE API] Returning ${actionItems.length} action items`);
        console.log(`📊 [KNOWLEDGEBASE API] Breakdown: ${actionItems.filter(i => i.urgency === 'high').length} high, ${actionItems.filter(i => i.urgency === 'medium').length} medium, ${actionItems.filter(i => i.urgency === 'low').length} low`);
        
        res.json({
            success: true,
            actionItems,
            summary: {
                total: actionItems.length,
                high: actionItems.filter(i => i.urgency === 'high').length,
                medium: actionItems.filter(i => i.urgency === 'medium').length,
                low: actionItems.filter(i => i.urgency === 'low').length
            }
        });
        
    } catch (error) {
        console.error('❌ [KNOWLEDGEBASE API] Error fetching action items:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch action items',
            message: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/knowledgebase/action-items/:itemId/resolve
 * 
 * Marks an issue as resolved (prevents it from appearing again)
 */
router.post('/api/company/:companyId/knowledgebase/action-items/:itemId/resolve', async (req, res) => {
    const { companyId, itemId } = req.params;
    const { question, actionTaken } = req.body;
    
    console.log(`✅ [KNOWLEDGEBASE API] Marking item ${itemId} as resolved for company: ${companyId}`);
    
    try {
        // Add to company's resolved issues
        await v2Company.findByIdAndUpdate(companyId, {
            $push: {
                'aiKnowledgebase.resolvedIssues': {
                    question,
                    resolvedAt: new Date(),
                    resolvedBy: req.user?.email || 'admin',
                    actionTaken: actionTaken || 'Marked as resolved'
                }
            }
        });
        
        console.log(`✅ [KNOWLEDGEBASE API] Issue resolved successfully`);
        
        res.json({
            success: true,
            message: 'Issue marked as resolved'
        });
        
    } catch (error) {
        console.error('❌ [KNOWLEDGEBASE API] Error resolving issue:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to resolve issue',
            message: error.message
        });
    }
});

module.exports = router;

