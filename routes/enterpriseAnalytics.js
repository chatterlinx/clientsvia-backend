/**
 * Enterprise Analytics Routes
 * Advanced analytics for enterprise-grade insights and reporting
 * Includes: booking rate, transfer rate, cost per call, time to first slot, 
 * top no-match phrases, source win rate, and comprehensive dashboards
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const Company = require('../models/Company');
const ConversationLog = require('../models/ConversationLog');
const KnowledgeLifecycleItem = require('../models/KnowledgeLifecycleItem');
const logger = require('../utils/logger');

/**
 * GET /api/enterprise-analytics/:companyId/dashboard
 * Comprehensive enterprise analytics dashboard
 */
router.get('/:companyId/dashboard', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { timeframe = '7d' } = req.query;

        // Calculate date range
        const endDate = new Date();
        const startDate = new Date();
        const days = parseInt(timeframe.replace('d', '')) || 7;
        startDate.setDate(endDate.getDate() - days);

        // Get comprehensive analytics
        const [
            conversationMetrics,
            bookingMetrics,
            costMetrics,
            sourceMetrics,
            knowledgeMetrics,
            performanceMetrics
        ] = await Promise.all([
            getConversationMetrics(companyId, startDate, endDate),
            getBookingMetrics(companyId, startDate, endDate),
            getCostMetrics(companyId, startDate, endDate),
            getSourceWinRateMetrics(companyId, startDate, endDate),
            getKnowledgeMetrics(companyId, startDate, endDate),
            getPerformanceMetrics(companyId, startDate, endDate)
        ]);

        const analytics = {
            overview: {
                timeframe: `${days} days`,
                startDate: startDate.toISOString(),
                endDate: endDate.toISOString(),
                lastUpdated: new Date().toISOString()
            },
            conversationMetrics,
            bookingMetrics,
            costMetrics,
            sourceMetrics,
            knowledgeMetrics,
            performanceMetrics,
            alerts: await generateAnalyticsAlerts(companyId, {
                conversationMetrics,
                bookingMetrics,
                costMetrics
            })
        };

        logger.info('Enterprise analytics dashboard accessed', { 
            companyId, 
            timeframe,
            metricsCount: Object.keys(analytics).length 
        });

        res.json({
            success: true,
            data: analytics
        });

    } catch (error) {
        logger.error('Enterprise analytics dashboard error', { 
            error: error.message, 
            companyId: req.params.companyId 
        });
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve enterprise analytics',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /api/enterprise-analytics/:companyId/booking-funnel
 * Detailed booking funnel analysis
 */
router.get('/:companyId/booking-funnel', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { timeframe = '7d' } = req.query;

        const endDate = new Date();
        const startDate = new Date();
        const days = parseInt(timeframe.replace('d', '')) || 7;
        startDate.setDate(endDate.getDate() - days);

        // Get booking funnel data from conversation logs
        const funnelData = await ConversationLog.aggregate([
            {
                $match: {
                    companyId: require('mongoose').Types.ObjectId(companyId),
                    timestamp: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: null,
                    totalConversations: { $sum: 1 },
                    bookingIntentDetected: {
                        $sum: {
                            $cond: [
                                { $regexMatch: { input: '$intent', regex: /book|schedule|appointment/i } },
                                1,
                                0
                            ]
                        }
                    },
                    slotOffered: {
                        $sum: {
                            $cond: [
                                { $regexMatch: { input: '$response', regex: /available.*slot|time.*available/i } },
                                1,
                                0
                            ]
                        }
                    },
                    bookingCompleted: {
                        $sum: {
                            $cond: [
                                { $eq: ['$outcome', 'booking_completed'] },
                                1,
                                0
                            ]
                        }
                    },
                    transferredToHuman: {
                        $sum: {
                            $cond: [
                                { $eq: ['$outcome', 'transferred'] },
                                1,
                                0
                            ]
                        }
                    },
                    averageTimeToSlot: {
                        $avg: {
                            $cond: [
                                { $and: [
                                    { $exists: '$timeToFirstSlot' },
                                    { $gt: ['$timeToFirstSlot', 0] }
                                ]},
                                '$timeToFirstSlot',
                                null
                            ]
                        }
                    }
                }
            }
        ]);

        const metrics = funnelData[0] || {
            totalConversations: 0,
            bookingIntentDetected: 0,
            slotOffered: 0,
            bookingCompleted: 0,
            transferredToHuman: 0,
            averageTimeToSlot: 0
        };

        // Calculate rates
        const bookingRate = metrics.totalConversations > 0 
            ? ((metrics.bookingCompleted / metrics.totalConversations) * 100).toFixed(1)
            : '0';

        const transferRate = metrics.totalConversations > 0
            ? ((metrics.transferredToHuman / metrics.totalConversations) * 100).toFixed(1)
            : '0';

        const slotOfferRate = metrics.bookingIntentDetected > 0
            ? ((metrics.slotOffered / metrics.bookingIntentDetected) * 100).toFixed(1)
            : '0';

        const conversionRate = metrics.slotOffered > 0
            ? ((metrics.bookingCompleted / metrics.slotOffered) * 100).toFixed(1)
            : '0';

        const funnelAnalysis = {
            funnel: {
                totalConversations: metrics.totalConversations,
                bookingIntentDetected: metrics.bookingIntentDetected,
                slotOffered: metrics.slotOffered,
                bookingCompleted: metrics.bookingCompleted,
                transferredToHuman: metrics.transferredToHuman
            },
            rates: {
                bookingRate: parseFloat(bookingRate),
                transferRate: parseFloat(transferRate),
                slotOfferRate: parseFloat(slotOfferRate),
                conversionRate: parseFloat(conversionRate)
            },
            performance: {
                averageTimeToFirstSlot: Math.round(metrics.averageTimeToSlot || 0),
                timeframe: `${days} days`
            }
        };

        logger.info('Booking funnel analysis accessed', { companyId, timeframe });

        res.json({
            success: true,
            data: funnelAnalysis
        });

    } catch (error) {
        logger.error('Booking funnel analysis error', { 
            error: error.message, 
            companyId: req.params.companyId 
        });
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve booking funnel analysis',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /api/enterprise-analytics/:companyId/no-match-analysis
 * Analysis of queries that didn't match knowledge base
 */
router.get('/:companyId/no-match-analysis', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { timeframe = '7d', limit = 20 } = req.query;

        const endDate = new Date();
        const startDate = new Date();
        const days = parseInt(timeframe.replace('d', '')) || 7;
        startDate.setDate(endDate.getDate() - days);

        // Get no-match phrases analysis
        const noMatchAnalysis = await ConversationLog.aggregate([
            {
                $match: {
                    companyId: require('mongoose').Types.ObjectId(companyId),
                    timestamp: { $gte: startDate, $lte: endDate },
                    $or: [
                        { confidence: { $lt: 0.7 } },
                        { source: 'llm_fallback' },
                        { outcome: 'no_match' }
                    ]
                }
            },
            {
                $group: {
                    _id: '$query',
                    count: { $sum: 1 },
                    averageConfidence: { $avg: '$confidence' },
                    lastOccurrence: { $max: '$timestamp' },
                    sources: { $addToSet: '$source' },
                    intents: { $addToSet: '$intent' }
                }
            },
            {
                $sort: { count: -1 }
            },
            {
                $limit: parseInt(limit)
            }
        ]);

        // Get total queries for percentage calculation
        const totalQueries = await ConversationLog.countDocuments({
            companyId: require('mongoose').Types.ObjectId(companyId),
            timestamp: { $gte: startDate, $lte: endDate }
        });

        const topNoMatchPhrases = noMatchAnalysis.map(item => ({
            phrase: item._id,
            count: item.count,
            percentage: totalQueries > 0 ? ((item.count / totalQueries) * 100).toFixed(2) : '0',
            averageConfidence: Math.round((item.averageConfidence || 0) * 100),
            lastOccurrence: item.lastOccurrence,
            sources: item.sources,
            suggestedCategory: suggestCategory(item._id),
            potentialKnowledgeGap: item.count >= 3 // Flag as gap if asked 3+ times
        }));

        logger.info('No-match analysis accessed', { companyId, timeframe, phrasesFound: topNoMatchPhrases.length });

        res.json({
            success: true,
            data: {
                topNoMatchPhrases,
                summary: {
                    totalNoMatchQueries: noMatchAnalysis.reduce((sum, item) => sum + item.count, 0),
                    totalQueries,
                    noMatchRate: totalQueries > 0 
                        ? ((noMatchAnalysis.reduce((sum, item) => sum + item.count, 0) / totalQueries) * 100).toFixed(2)
                        : '0',
                    timeframe: `${days} days`
                }
            }
        });

    } catch (error) {
        logger.error('No-match analysis error', { 
            error: error.message, 
            companyId: req.params.companyId 
        });
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve no-match analysis',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * Helper function to get conversation metrics
 */
async function getConversationMetrics(companyId, startDate, endDate) {
    try {
        const metrics = await ConversationLog.aggregate([
            {
                $match: {
                    companyId: require('mongoose').Types.ObjectId(companyId),
                    timestamp: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: null,
                    totalConversations: { $sum: 1 },
                    avgConfidence: { $avg: '$confidence' },
                    avgResponseTime: { $avg: '$responseTime' },
                    successfulResolutions: {
                        $sum: {
                            $cond: [
                                { $in: ['$outcome', ['resolved', 'booking_completed']] },
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);

        const result = metrics[0] || {
            totalConversations: 0,
            avgConfidence: 0,
            avgResponseTime: 0,
            successfulResolutions: 0
        };

        return {
            totalConversations: result.totalConversations,
            avgConfidence: Math.round((result.avgConfidence || 0) * 100),
            avgResponseTime: Math.round(result.avgResponseTime || 0),
            successRate: result.totalConversations > 0 
                ? Math.round((result.successfulResolutions / result.totalConversations) * 100)
                : 0
        };
    } catch (error) {
        logger.error('Error getting conversation metrics', { error: error.message, companyId });
        return { totalConversations: 0, avgConfidence: 0, avgResponseTime: 0, successRate: 0 };
    }
}

/**
 * Helper function to get booking metrics
 */
async function getBookingMetrics(companyId, startDate, endDate) {
    try {
        const bookingData = await ConversationLog.aggregate([
            {
                $match: {
                    companyId: require('mongoose').Types.ObjectId(companyId),
                    timestamp: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: null,
                    totalConversations: { $sum: 1 },
                    bookingsCompleted: {
                        $sum: {
                            $cond: [{ $eq: ['$outcome', 'booking_completed'] }, 1, 0]
                        }
                    },
                    transfersToHuman: {
                        $sum: {
                            $cond: [{ $eq: ['$outcome', 'transferred'] }, 1, 0]
                        }
                    },
                    avgTimeToFirstSlot: {
                        $avg: {
                            $cond: [
                                { $gt: ['$timeToFirstSlot', 0] },
                                '$timeToFirstSlot',
                                null
                            ]
                        }
                    }
                }
            }
        ]);

        const result = bookingData[0] || {
            totalConversations: 0,
            bookingsCompleted: 0,
            transfersToHuman: 0,
            avgTimeToFirstSlot: 0
        };

        return {
            bookingRate: result.totalConversations > 0 
                ? Math.round((result.bookingsCompleted / result.totalConversations) * 100)
                : 0,
            transferRate: result.totalConversations > 0
                ? Math.round((result.transfersToHuman / result.totalConversations) * 100)
                : 0,
            avgTimeToFirstSlot: Math.round(result.avgTimeToFirstSlot || 0),
            totalBookings: result.bookingsCompleted,
            totalTransfers: result.transfersToHuman
        };
    } catch (error) {
        logger.error('Error getting booking metrics', { error: error.message, companyId });
        return { bookingRate: 0, transferRate: 0, avgTimeToFirstSlot: 0, totalBookings: 0, totalTransfers: 0 };
    }
}

/**
 * Helper function to get cost metrics
 */
async function getCostMetrics(companyId, startDate, endDate) {
    try {
        const costData = await ConversationLog.aggregate([
            {
                $match: {
                    companyId: require('mongoose').Types.ObjectId(companyId),
                    timestamp: { $gte: startDate, $lte: endDate },
                    cost: { $exists: true, $gt: 0 }
                }
            },
            {
                $group: {
                    _id: null,
                    totalCost: { $sum: '$cost' },
                    avgCostPerCall: { $avg: '$cost' },
                    totalCalls: { $sum: 1 },
                    minCost: { $min: '$cost' },
                    maxCost: { $max: '$cost' }
                }
            }
        ]);

        const result = costData[0] || {
            totalCost: 0,
            avgCostPerCall: 0,
            totalCalls: 0,
            minCost: 0,
            maxCost: 0
        };

        return {
            totalCost: Math.round((result.totalCost || 0) * 100) / 100, // Round to 2 decimal places
            avgCostPerCall: Math.round((result.avgCostPerCall || 0) * 100) / 100,
            totalCalls: result.totalCalls,
            costRange: {
                min: Math.round((result.minCost || 0) * 100) / 100,
                max: Math.round((result.maxCost || 0) * 100) / 100
            }
        };
    } catch (error) {
        logger.error('Error getting cost metrics', { error: error.message, companyId });
        return { totalCost: 0, avgCostPerCall: 0, totalCalls: 0, costRange: { min: 0, max: 0 } };
    }
}

/**
 * Helper function to get source win rate metrics
 */
async function getSourceWinRateMetrics(companyId, startDate, endDate) {
    try {
        const sourceData = await ConversationLog.aggregate([
            {
                $match: {
                    companyId: require('mongoose').Types.ObjectId(companyId),
                    timestamp: { $gte: startDate, $lte: endDate },
                    source: { $exists: true }
                }
            },
            {
                $group: {
                    _id: '$source',
                    count: { $sum: 1 },
                    avgConfidence: { $avg: '$confidence' },
                    successRate: {
                        $avg: {
                            $cond: [
                                { $in: ['$outcome', ['resolved', 'booking_completed']] },
                                1,
                                0
                            ]
                        }
                    }
                }
            },
            {
                $sort: { count: -1 }
            }
        ]);

        const totalQueries = sourceData.reduce((sum, item) => sum + item.count, 0);

        const sourceWinRates = sourceData.map(item => ({
            source: item._id || 'unknown',
            count: item.count,
            percentage: totalQueries > 0 ? Math.round((item.count / totalQueries) * 100) : 0,
            avgConfidence: Math.round((item.avgConfidence || 0) * 100),
            successRate: Math.round((item.successRate || 0) * 100)
        }));

        return {
            sourceWinRates,
            totalQueries,
            topSource: sourceWinRates[0]?.source || 'none'
        };
    } catch (error) {
        logger.error('Error getting source win rate metrics', { error: error.message, companyId });
        return { sourceWinRates: [], totalQueries: 0, topSource: 'none' };
    }
}

/**
 * Helper function to get knowledge metrics
 */
async function getKnowledgeMetrics(companyId, startDate, endDate) {
    try {
        const totalItems = await KnowledgeLifecycleItem.countDocuments({ companyId });
        const activeItems = await KnowledgeLifecycleItem.countDocuments({ 
            companyId, 
            status: 'approved',
            $or: [
                { validThrough: { $exists: false } },
                { validThrough: { $gt: new Date() } }
            ]
        });

        const recentlyUsed = await KnowledgeLifecycleItem.countDocuments({
            companyId,
            lastUsed: { $gte: startDate }
        });

        return {
            totalItems,
            activeItems,
            recentlyUsed,
            utilizationRate: totalItems > 0 ? Math.round((recentlyUsed / totalItems) * 100) : 0
        };
    } catch (error) {
        logger.error('Error getting knowledge metrics', { error: error.message, companyId });
        return { totalItems: 0, activeItems: 0, recentlyUsed: 0, utilizationRate: 0 };
    }
}

/**
 * Helper function to get performance metrics
 */
async function getPerformanceMetrics(companyId, startDate, endDate) {
    try {
        const performanceData = await ConversationLog.aggregate([
            {
                $match: {
                    companyId: require('mongoose').Types.ObjectId(companyId),
                    timestamp: { $gte: startDate, $lte: endDate }
                }
            },
            {
                $group: {
                    _id: {
                        date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } }
                    },
                    conversations: { $sum: 1 },
                    avgResponseTime: { $avg: '$responseTime' },
                    avgConfidence: { $avg: '$confidence' }
                }
            },
            {
                $sort: { '_id.date': 1 }
            }
        ]);

        return {
            dailyTrends: performanceData.map(day => ({
                date: day._id.date,
                conversations: day.conversations,
                avgResponseTime: Math.round(day.avgResponseTime || 0),
                avgConfidence: Math.round((day.avgConfidence || 0) * 100)
            }))
        };
    } catch (error) {
        logger.error('Error getting performance metrics', { error: error.message, companyId });
        return { dailyTrends: [] };
    }
}

/**
 * Helper function to generate analytics alerts
 */
async function generateAnalyticsAlerts(companyId, metrics) {
    const alerts = [];

    // Alert for low booking rate
    if (metrics.bookingMetrics.bookingRate < 15) {
        alerts.push({
            type: 'warning',
            title: 'Low Booking Rate',
            message: `Booking rate is ${metrics.bookingMetrics.bookingRate}%, below recommended 15%`,
            suggestion: 'Review booking flow and agent responses',
            priority: 'medium'
        });
    }

    // Alert for high transfer rate
    if (metrics.bookingMetrics.transferRate > 25) {
        alerts.push({
            type: 'error',
            title: 'High Transfer Rate',
            message: `Transfer rate is ${metrics.bookingMetrics.transferRate}%, above recommended 25%`,
            suggestion: 'Expand knowledge base and improve agent responses',
            priority: 'high'
        });
    }

    // Alert for high cost per call
    if (metrics.costMetrics.avgCostPerCall > 2.0) {
        alerts.push({
            type: 'warning',
            title: 'High Cost Per Call',
            message: `Average cost per call is $${metrics.costMetrics.avgCostPerCall}, above target`,
            suggestion: 'Optimize LLM usage and response efficiency',
            priority: 'medium'
        });
    }

    return alerts;
}

/**
 * Helper function to suggest category for no-match phrases
 */
function suggestCategory(phrase) {
    const categoryKeywords = {
        'pricing': ['cost', 'price', 'charge', 'fee', 'rate', 'expensive', 'cheap'],
        'scheduling': ['appointment', 'schedule', 'time', 'available', 'book', 'when'],
        'services': ['service', 'repair', 'fix', 'install', 'maintenance', 'replace'],
        'emergency': ['emergency', 'urgent', 'immediate', 'asap', 'now', 'broken'],
        'location': ['area', 'location', 'where', 'address', 'near', 'local'],
        'support': ['help', 'support', 'problem', 'issue', 'trouble', 'question']
    };

    const lowerPhrase = phrase.toLowerCase();
    
    for (const [category, keywords] of Object.entries(categoryKeywords)) {
        if (keywords.some(keyword => lowerPhrase.includes(keyword))) {
            return category;
        }
    }
    
    return 'general';
}

module.exports = router;
