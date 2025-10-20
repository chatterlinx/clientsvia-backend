// ============================================================================
// CALL ARCHIVES ADMIN ROUTES
// ============================================================================
// 📋 PURPOSE: Admin interface for searching, viewing, and exporting call transcripts
// 🎯 FEATURES:
//    - Advanced search (keywords, date range, company, confidence)
//    - Full transcript viewing
//    - Recording playback
//    - Bulk export (CSV, JSON)
//    - SMS delivery tracking
// 🔒 AUTH: Admin only
// ============================================================================

const express = require('express');
const router = express.Router();
const v2AIAgentCallLog = require('../../models/v2AIAgentCallLog');
const v2Company = require('../../models/v2Company');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const mongoose = require('mongoose');

// ============================================================================
// SEARCH CALL ARCHIVES
// ============================================================================
router.get('/admin/call-archives/search', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        console.log(`🔍 [CALL ARCHIVES] CHECKPOINT 1: Search request received`);
        
        const {
            query,           // Text search in transcripts
            companyId,       // Filter by company
            startDate,       // Date range start
            endDate,         // Date range end
            minConfidence,   // Minimum confidence score
            maxConfidence,   // Maximum confidence score
            source,          // AI source (companyQnA, tradeQnA, templates, inHouseFallback)
            sentiment,       // Sentiment filter (positive, neutral, negative)
            page = 1,        // Pagination
            limit = 50       // Results per page
        } = req.query;

        console.log(`🔍 [CALL ARCHIVES] CHECKPOINT 2: Query parameters:`, {
            query: query || 'none',
            companyId: companyId || 'all',
            startDate: startDate || 'none',
            endDate: endDate || 'none',
            page,
            limit
        });

        // ================================================================
        // STEP 1: Build MongoDB query
        // ================================================================
        const filter = {};

        // Company filter
        if (companyId) {
            filter.companyId = companyId;
        }

        // Date range filter
        if (startDate || endDate) {
            filter.createdAt = {};
            if (startDate) filter.createdAt.$gte = new Date(startDate);
            if (endDate) filter.createdAt.$lte = new Date(endDate);
        }

        // Confidence score filter
        if (minConfidence !== undefined || maxConfidence !== undefined) {
            filter.finalConfidenceScore = {};
            if (minConfidence) filter.finalConfidenceScore.$gte = parseFloat(minConfidence);
            if (maxConfidence) filter.finalConfidenceScore.$lte = parseFloat(maxConfidence);
        }

        // Source filter
        if (source) {
            filter.finalMatchedSource = source;
        }

        // Sentiment filter
        if (sentiment) {
            filter['searchMetadata.sentiment'] = sentiment;
        }

        // Text search in transcripts
        if (query) {
            filter.$text = { $search: query };
        }

        console.log(`✅ [CALL ARCHIVES] CHECKPOINT 3: Filter built:`, JSON.stringify(filter, null, 2));

        // ================================================================
        // STEP 2: Execute search with pagination
        // ================================================================
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const [calls, totalCount] = await Promise.all([
            v2AIAgentCallLog.find(filter)
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .populate('companyId', 'companyName contactName phoneNumber')
                .lean(),
            v2AIAgentCallLog.countDocuments(filter)
        ]);

        console.log(`✅ [CALL ARCHIVES] CHECKPOINT 4: Found ${calls.length} calls (${totalCount} total)`);

        // ================================================================
        // STEP 3: Format response
        // ================================================================
        const formattedCalls = calls.map(call => ({
            id: call._id,
            companyId: call.companyId?._id,
            companyName: call.companyId?.companyName || 'Unknown',
            customerPhone: call.customerPhone,
            twilioCallSid: call.twilioCallSid,
            duration: call.callDuration,
            createdAt: call.createdAt,
            
            // AI Performance
            source: call.finalMatchedSource,
            confidence: call.finalConfidenceScore,
            responseTime: call.responseTime,
            
            // Transcript
            hasTranscript: !!call.conversation?.fullTranscript?.plainText,
            transcriptPreview: call.conversation?.fullTranscript?.plainText?.substring(0, 150) || '',
            turnCount: call.conversation?.turns?.length || 0,
            
            // Recording
            hasRecording: !!call.conversation?.recordingUrl,
            recordingUrl: call.conversation?.recordingUrl,
            recordingDuration: call.conversation?.recordingDuration,
            
            // Metadata
            sentiment: call.searchMetadata?.sentiment,
            keywords: call.searchMetadata?.keywords?.slice(0, 5) || [],
            topics: call.searchMetadata?.topics?.slice(0, 3) || []
        }));

        console.log(`✅ [CALL ARCHIVES] CHECKPOINT 5: Response formatted`);

        // ================================================================
        // STEP 4: Return results with pagination metadata
        // ================================================================
        res.json({
            success: true,
            data: {
                calls: formattedCalls,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total: totalCount,
                    pages: Math.ceil(totalCount / parseInt(limit)),
                    hasNext: skip + calls.length < totalCount,
                    hasPrev: parseInt(page) > 1
                },
                filters: {
                    query: query || null,
                    companyId: companyId || null,
                    startDate: startDate || null,
                    endDate: endDate || null,
                    source: source || null,
                    sentiment: sentiment || null
                }
            }
        });

        console.log(`✅ [CALL ARCHIVES] CHECKPOINT 6: Response sent successfully`);

    } catch (error) {
        console.error(`❌ [CALL ARCHIVES] ERROR in search:`, error);
        console.error(`❌ [CALL ARCHIVES] Stack:`, error.stack);
        res.status(500).json({
            success: false,
            message: 'Failed to search call archives',
            error: error.message
        });
    }
});

// ============================================================================
// GET SINGLE CALL DETAILS
// ============================================================================
router.get('/admin/call-archives/:callId', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { callId } = req.params;
        
        console.log(`📞 [CALL ARCHIVES] CHECKPOINT 1: Fetching call: ${callId}`);

        // ================================================================
        // STEP 1: Find call with full details
        // ================================================================
        const call = await v2AIAgentCallLog.findById(callId)
            .populate('companyId', 'companyName contactName phoneNumber email')
            .lean();

        if (!call) {
            console.log(`❌ [CALL ARCHIVES] Call not found: ${callId}`);
            return res.status(404).json({
                success: false,
                message: 'Call not found'
            });
        }

        console.log(`✅ [CALL ARCHIVES] CHECKPOINT 2: Call found`);

        // ================================================================
        // STEP 2: Format detailed response
        // ================================================================
        const response = {
            // Basic Info
            id: call._id,
            companyId: call.companyId?._id,
            companyName: call.companyId?.companyName || 'Unknown',
            companyContact: call.companyId?.contactName,
            companyPhone: call.companyId?.phoneNumber,
            companyEmail: call.companyId?.email,
            
            customerPhone: call.customerPhone,
            twilioCallSid: call.twilioCallSid,
            duration: call.callDuration,
            createdAt: call.createdAt,
            
            // AI Performance
            source: call.finalMatchedSource,
            confidence: call.finalConfidenceScore,
            responseTime: call.responseTime,
            matchedTemplate: call.matchedTemplate,
            scenarioTitle: call.scenarioTitle,
            
            // Full Conversation
            conversation: {
                turns: call.conversation?.turns || [],
                fullTranscript: {
                    plainText: call.conversation?.fullTranscript?.plainText || '',
                    formatted: call.conversation?.fullTranscript?.formatted || '',
                    html: call.conversation?.fullTranscript?.html || '',
                    markdown: call.conversation?.fullTranscript?.markdown || ''
                },
                recordingUrl: call.conversation?.recordingUrl,
                recordingSid: call.conversation?.recordingSid,
                recordingDuration: call.conversation?.recordingDuration,
                recordingStatus: call.conversation?.recordingStatus,
                transcriptionProvider: call.conversation?.transcriptionProvider
            },
            
            // SMS Delivery (if enabled)
            transcriptDelivery: call.conversation?.transcriptDelivery || null,
            
            // Search Metadata
            searchMetadata: {
                keywords: call.searchMetadata?.keywords || [],
                topics: call.searchMetadata?.topics || [],
                sentiment: call.searchMetadata?.sentiment,
                language: call.searchMetadata?.language
            },
            
            // Raw customer query
            customerQuery: call.customerQuery,
            aiResponse: call.aiResponse
        };

        console.log(`✅ [CALL ARCHIVES] CHECKPOINT 3: Response formatted`);

        res.json({
            success: true,
            data: response
        });

        console.log(`✅ [CALL ARCHIVES] CHECKPOINT 4: Response sent successfully`);

    } catch (error) {
        console.error(`❌ [CALL ARCHIVES] ERROR fetching call:`, error);
        console.error(`❌ [CALL ARCHIVES] Stack:`, error.stack);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch call details',
            error: error.message
        });
    }
});

// ============================================================================
// EXPORT CALL ARCHIVES (CSV/JSON)
// ============================================================================
router.post('/admin/call-archives/export', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        console.log(`📤 [CALL ARCHIVES] CHECKPOINT 1: Export request received`);
        
        const {
            format = 'csv',  // 'csv' or 'json'
            filters = {}     // Same filters as search endpoint
        } = req.body;

        console.log(`📤 [CALL ARCHIVES] CHECKPOINT 2: Format: ${format}`);

        // ================================================================
        // STEP 1: Build query (same as search)
        // ================================================================
        const filter = {};
        
        if (filters.companyId) filter.companyId = filters.companyId;
        if (filters.startDate || filters.endDate) {
            filter.createdAt = {};
            if (filters.startDate) filter.createdAt.$gte = new Date(filters.startDate);
            if (filters.endDate) filter.createdAt.$lte = new Date(filters.endDate);
        }
        if (filters.source) filter.finalMatchedSource = filters.source;
        if (filters.sentiment) filter['searchMetadata.sentiment'] = filters.sentiment;

        console.log(`✅ [CALL ARCHIVES] CHECKPOINT 3: Filter built`);

        // ================================================================
        // STEP 2: Fetch all matching calls (limit to 10,000 for safety)
        // ================================================================
        const calls = await v2AIAgentCallLog.find(filter)
            .sort({ createdAt: -1 })
            .limit(10000)
            .populate('companyId', 'companyName')
            .lean();

        console.log(`✅ [CALL ARCHIVES] CHECKPOINT 4: Found ${calls.length} calls to export`);

        // ================================================================
        // STEP 3: Format based on export type
        // ================================================================
        if (format === 'json') {
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', `attachment; filename="call-archives-${Date.now()}.json"`);
            res.json(calls);
        } else {
            // CSV Export
            const csvRows = [
                // Header
                ['ID', 'Company', 'Customer Phone', 'Date', 'Duration', 'Source', 'Confidence', 'Response Time', 'Transcript Preview'].join(',')
            ];

            calls.forEach(call => {
                const row = [
                    call._id,
                    call.companyId?.companyName || 'Unknown',
                    call.customerPhone,
                    new Date(call.createdAt).toISOString(),
                    call.callDuration || 0,
                    call.finalMatchedSource || '',
                    call.finalConfidenceScore || 0,
                    call.responseTime || 0,
                    `"${(call.conversation?.fullTranscript?.plainText || '').substring(0, 100).replace(/"/g, '""')}"`
                ];
                csvRows.push(row.join(','));
            });

            const csvContent = csvRows.join('\n');

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="call-archives-${Date.now()}.csv"`);
            res.send(csvContent);
        }

        console.log(`✅ [CALL ARCHIVES] CHECKPOINT 5: Export sent successfully`);

    } catch (error) {
        console.error(`❌ [CALL ARCHIVES] ERROR in export:`, error);
        console.error(`❌ [CALL ARCHIVES] Stack:`, error.stack);
        res.status(500).json({
            success: false,
            message: 'Failed to export call archives',
            error: error.message
        });
    }
});

// ============================================================================
// GET EXPORT STATISTICS
// ============================================================================
router.get('/admin/call-archives/stats', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        console.log(`📊 [CALL ARCHIVES] CHECKPOINT 1: Fetching statistics...`);

        // ================================================================
        // STEP 1: Aggregate statistics
        // ================================================================
        const [
            totalCalls,
            companiesWithCalls,
            avgConfidence,
            sourceDistribution,
            sentimentDistribution
        ] = await Promise.all([
            // Total calls
            v2AIAgentCallLog.countDocuments({}),
            
            // Unique companies with calls
            v2AIAgentCallLog.distinct('companyId'),
            
            // Average confidence
            v2AIAgentCallLog.aggregate([
                { $group: { _id: null, avgConfidence: { $avg: '$finalConfidenceScore' } } }
            ]),
            
            // Source distribution
            v2AIAgentCallLog.aggregate([
                { $group: { _id: '$finalMatchedSource', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ]),
            
            // Sentiment distribution
            v2AIAgentCallLog.aggregate([
                { $group: { _id: '$searchMetadata.sentiment', count: { $sum: 1 } } },
                { $sort: { count: -1 } }
            ])
        ]);

        console.log(`✅ [CALL ARCHIVES] CHECKPOINT 2: Statistics calculated`);

        // ================================================================
        // STEP 2: Format response
        // ================================================================
        res.json({
            success: true,
            data: {
                totalCalls,
                companiesWithCalls: companiesWithCalls.length,
                avgConfidence: avgConfidence[0]?.avgConfidence || 0,
                sourceDistribution: sourceDistribution.map(s => ({
                    source: s._id,
                    count: s.count
                })),
                sentimentDistribution: sentimentDistribution.map(s => ({
                    sentiment: s._id,
                    count: s.count
                }))
            }
        });

        console.log(`✅ [CALL ARCHIVES] CHECKPOINT 3: Response sent successfully`);

    } catch (error) {
        console.error(`❌ [CALL ARCHIVES] ERROR in stats:`, error);
        console.error(`❌ [CALL ARCHIVES] Stack:`, error.stack);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch statistics',
            error: error.message
        });
    }
});

// ============================================================================
// EXPORT
// ============================================================================
module.exports = router;

