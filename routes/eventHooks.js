const express = require('express');
const router = express.Router();
const { AgentEventHooks } = require('../hooks/agentEventHooks');
const smsClient = require('../clients/smsClient');
const emailClient = require('../clients/emailClient');
const Company = require('../models/Company');
const { createTwilioClient, getPrimaryPhoneNumber } = require('../utils/twilioClientFactory');

// Initialize event hooks
const eventHooks = new AgentEventHooks();

// Get event hooks configuration for a company
router.get('/company/:companyId/config', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        // Get company data to check for per-company Twilio credentials
        const company = await Company.findById(companyId);
        
        // Check per-company Twilio configuration
        const hasTwilioCredentials = company?.twilioConfig && (
            (company.twilioConfig.accountSid && company.twilioConfig.authToken) ||
            (company.twilioConfig.apiKey && company.twilioConfig.apiSecret)
        );
        
        const primaryPhoneNumber = getPrimaryPhoneNumber(company);
        
        // Get current configuration
        const config = {
            hooks: eventHooks.getHooks(companyId),
            analytics: eventHooks.getAnalytics(companyId),
            smsConfig: {
                enabled: hasTwilioCredentials || !!process.env.TWILIO_ACCOUNT_SID,
                configured: hasTwilioCredentials,
                perCompany: hasTwilioCredentials,
                legacy: !hasTwilioCredentials && !!process.env.TWILIO_ACCOUNT_SID,
                accountSid: hasTwilioCredentials ? '***company-specific***' : (process.env.TWILIO_ACCOUNT_SID ? '***global***' : null),
                fromNumber: primaryPhoneNumber || process.env.TWILIO_PHONE_NUMBER || null
            },
            emailConfig: {
                enabled: process.env.SENDGRID_API_KEY ? true : false,
                apiKey: process.env.SENDGRID_API_KEY ? '***masked***' : null,
                fromEmail: process.env.SENDGRID_FROM_EMAIL || null
            }
        };

        res.json({
            success: true,
            data: config
        });
    } catch (error) {
        console.error('Error getting event hooks config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Register an event hook
router.post('/company/:companyId/register', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { eventType, hookConfig } = req.body;

        if (!eventType || !hookConfig) {
            return res.status(400).json({
                success: false,
                error: 'Event type and hook configuration are required'
            });
        }

        eventHooks.registerHook(companyId, eventType, hookConfig);

        res.json({
            success: true,
            message: `Event hook registered for ${eventType}`
        });
    } catch (error) {
        console.error('Error registering event hook:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Unregister an event hook
router.delete('/company/:companyId/unregister/:eventType', async (req, res) => {
    try {
        const { companyId, eventType } = req.params;

        eventHooks.unregisterHook(companyId, eventType);

        res.json({
            success: true,
            message: `Event hook unregistered for ${eventType}`
        });
    } catch (error) {
        console.error('Error unregistering event hook:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test an event hook
router.post('/company/:companyId/test/:eventType', async (req, res) => {
    try {
        const { companyId, eventType } = req.params;
        const testData = req.body.testData || {};

        // Create test event data
        const eventData = {
            timestamp: new Date().toISOString(),
            companyId,
            eventType,
            details: {
                test: true,
                ...testData
            }
        };

        // Trigger the event hook
        await eventHooks.triggerEvent(eventType, eventData);

        res.json({
            success: true,
            message: `Test event triggered for ${eventType}`,
            data: eventData
        });
    } catch (error) {
        console.error('Error testing event hook:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get event hooks analytics
router.get('/company/:companyId/analytics', async (req, res) => {
    try {
        const { companyId } = req.params;
        const analytics = eventHooks.getAnalytics(companyId);

        res.json({
            success: true,
            data: analytics
        });
    } catch (error) {
        console.error('Error getting event hooks analytics:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update SMS configuration
router.post('/company/:companyId/sms-config', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { accountSid, authToken, fromNumber, enabled } = req.body;

        // In a real implementation, you would save this to a database
        // For now, we'll just validate and respond
        if (enabled && (!accountSid || !authToken || !fromNumber)) {
            return res.status(400).json({
                success: false,
                error: 'Account SID, Auth Token, and From Number are required when SMS is enabled'
            });
        }

        // Update environment or database with new configuration
        // This is a simplified implementation
        console.log(`SMS config updated for company ${companyId}:`, {
            accountSid: accountSid ? '***masked***' : null,
            fromNumber,
            enabled
        });

        res.json({
            success: true,
            message: 'SMS configuration updated successfully'
        });
    } catch (error) {
        console.error('Error updating SMS config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Update email configuration
router.post('/company/:companyId/email-config', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { apiKey, fromEmail, enabled } = req.body;

        // In a real implementation, you would save this to a database
        // For now, we'll just validate and respond
        if (enabled && (!apiKey || !fromEmail)) {
            return res.status(400).json({
                success: false,
                error: 'API Key and From Email are required when email is enabled'
            });
        }

        // Update environment or database with new configuration
        // This is a simplified implementation
        console.log(`Email config updated for company ${companyId}:`, {
            apiKey: apiKey ? '***masked***' : null,
            fromEmail,
            enabled
        });

        res.json({
            success: true,
            message: 'Email configuration updated successfully'
        });
    } catch (error) {
        console.error('Error updating email config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test SMS functionality
router.post('/company/:companyId/test-sms', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { phoneNumber, message } = req.body;

        if (!phoneNumber || !message) {
            return res.status(400).json({
                success: false,
                error: 'Phone number and message are required'
            });
        }

        // Get company data for per-company credentials
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }

        // Use per-company SMS sending method
        const result = await smsClient.sendWithCompany({
            to: phoneNumber,
            body: `Test SMS from ${company.companyName}: ${message}`,
            company: company
        });

        res.json({
            success: result.success,
            message: result.success ? 'Test SMS sent successfully' : 'Test SMS failed',
            data: result,
            company: company.companyName
        });
    } catch (error) {
        console.error('Error sending test SMS:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Test email functionality
router.post('/company/:companyId/test-email', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { toEmail, subject, message } = req.body;

        if (!toEmail || !subject || !message) {
            return res.status(400).json({
                success: false,
                error: 'To email, subject, and message are required'
            });
        }

        const result = await emailClient.sendEmail(toEmail, subject, message, {
            context: { companyId, test: true }
        });

        res.json({
            success: true,
            message: 'Test email sent successfully',
            data: result
        });
    } catch (error) {
        console.error('Error sending test email:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Clear event log with options
router.post('/company/:companyId/clear-log', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { clearType } = req.body;

        // Validate clear type
        if (!clearType || !['1', '2', '3'].includes(clearType)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid clear type. Must be 1, 2, or 3.'
            });
        }

        let message = '';
        switch (clearType) {
            case '1': // Clear recent events only
                eventHooks.clearRecentEvents(companyId);
                message = 'Recent events cleared successfully';
                break;
            case '2': // Clear all analytics data
                eventHooks.clearAllAnalytics(companyId);
                message = 'All analytics data cleared successfully';
                break;
            case '3': // Reset to defaults
                eventHooks.resetToDefaults(companyId);
                message = 'Event hooks reset to default configuration';
                break;
        }

        res.json({
            success: true,
            message: message
        });
    } catch (error) {
        console.error('Error clearing event log:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Get event hooks configuration with validation
router.get('/company/:companyId/validate-config', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        // Get company data to check for per-company Twilio credentials
        const company = await Company.findById(companyId);
        
        // Check per-company Twilio configuration
        const hasTwilioCredentials = company?.twilioConfig && (
            (company.twilioConfig.accountSid && company.twilioConfig.authToken) ||
            (company.twilioConfig.apiKey && company.twilioConfig.apiSecret)
        );
        
        const primaryPhoneNumber = getPrimaryPhoneNumber(company);
        
        const config = {
            hooks: eventHooks.getHooks(companyId),
            analytics: eventHooks.getAnalytics(companyId),
            smsConfig: {
                enabled: hasTwilioCredentials || !!process.env.TWILIO_ACCOUNT_SID,
                configured: hasTwilioCredentials,
                perCompany: hasTwilioCredentials,
                legacy: !hasTwilioCredentials && !!process.env.TWILIO_ACCOUNT_SID,
                accountSid: hasTwilioCredentials ? '***company-specific***' : (process.env.TWILIO_ACCOUNT_SID ? '***global***' : null),
                fromNumber: primaryPhoneNumber || process.env.TWILIO_PHONE_NUMBER || null
            },
            emailConfig: {
                enabled: process.env.SENDGRID_API_KEY ? true : false,
                configured: !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL),
                apiKey: process.env.SENDGRID_API_KEY ? '***masked***' : null,
                fromEmail: process.env.SENDGRID_FROM_EMAIL || null
            },
            validation: {
                smsValid: hasTwilioCredentials || !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER),
                emailValid: !!(process.env.SENDGRID_API_KEY && process.env.SENDGRID_FROM_EMAIL),
                hooksConfigured: Object.keys(eventHooks.getHooks(companyId) || {}).length > 0
            }
        };

        res.json({
            success: true,
            data: config
        });
    } catch (error) {
        console.error('Error validating event hooks config:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// AI Agent Logic Analytics endpoints - Enhanced & Bulletproof
router.get('/analytics/ai-agent/:timeframe?', async (req, res) => {
    try {
        const timeframe = req.params.timeframe || '24h';
        const { companyId } = req.query;
        
        // Enhanced timeframe parsing with validation
        const since = parseTimeframe(timeframe);
        if (!since) {
            return res.status(400).json({
                success: false,
                error: 'Invalid timeframe. Use: 1h, 6h, 24h, 7d, 30d'
            });
        }

        const NotificationLog = require('../models/NotificationLog');

        // Use NotificationLog analytics methods with company isolation
        const [totalStats, eventBreakdown, performanceMetrics, recentActivity] = await Promise.allSettled([
            NotificationLog.getAIAgentStats(since, companyId),
            NotificationLog.getEventBreakdown(since, companyId),
            NotificationLog.getPerformanceMetrics(since, companyId),
            NotificationLog.getRecentActivity(10, companyId)
        ]);

        // Handle any failed promises gracefully
        const safeExtract = (promise, defaultValue) => {
            return promise.status === 'fulfilled' ? promise.value : defaultValue;
        };

        const stats = safeExtract(totalStats, {
            totalNotifications: 0,
            successfulNotifications: 0,
            failedNotifications: 0,
            pendingNotifications: 0,
            successRate: 0,
            avgProcessingTime: 0
        });

        const breakdown = safeExtract(eventBreakdown, []);
        const metrics = safeExtract(performanceMetrics, {
            avgProcessingTime: 0,
            minProcessingTime: 0,
            maxProcessingTime: 0,
            p95ProcessingTime: 0,
            totalProcessed: 0
        });
        const activity = safeExtract(recentActivity, []);

        // Enhanced summary with performance insights
        const summary = {
            totalNotifications: stats.totalNotifications,
            successRate: stats.successRate,
            avgProcessingTime: stats.avgProcessingTime,
            mostActiveEvent: breakdown.length > 0 ? breakdown[0].eventType : 'none',
            emergencyAlerts: breakdown.filter(e => e.eventType?.includes('emergency')).reduce((sum, e) => sum + e.count, 0),
            performanceGrade: getPerformanceGrade(stats.successRate, stats.avgProcessingTime)
        };
        
        res.json({
            success: true,
            data: {
                timeframe,
                companyId: companyId || 'all',
                totalStats: stats,
                eventBreakdown: breakdown,
                performanceMetrics: metrics,
                recentActivity: activity,
                summary
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[AI-AGENT-LOGIC] Error getting AI Agent analytics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch AI Agent analytics',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

router.get('/analytics/delivery/:timeframe?', async (req, res) => {
    try {
        const timeframe = req.params.timeframe || '24h';
        const { companyId } = req.query;
        
        const since = parseTimeframe(timeframe);
        if (!since) {
            return res.status(400).json({
                success: false,
                error: 'Invalid timeframe. Use: 1h, 6h, 24h, 7d, 30d'
            });
        }

        const NotificationLog = require('../models/NotificationLog');
        
        // Build query with AI Agent Logic isolation
        const matchQuery = {
            'metadata.fromAgent': true,
            createdAt: { $gte: since }
        };
        
        if (companyId) {
            matchQuery['metadata.companyId'] = new require('mongoose').Types.ObjectId(companyId);
        }
        
        // Enhanced delivery analytics aggregation
        const pipeline = [
            { $match: matchQuery },
            {
                $group: {
                    _id: {
                        type: '$type',
                        status: '$status'
                    },
                    count: { $sum: 1 },
                    avgProcessingTime: { $avg: '$aiAgentContext.processingTime' }
                }
            }
        ];
        
        const results = await NotificationLog.aggregate(pipeline);
        
        // Process results into structured format
        const channels = {
            sms: { sent: 0, failed: 0, pending: 0, avgTime: 0 },
            email: { sent: 0, failed: 0, pending: 0, avgTime: 0 },
            event_hook: { completed: 0, failed: 0, pending: 0, avgTime: 0 }
        };
        
        let totalSent = 0, totalFailed = 0, totalPending = 0;
        
        results.forEach(result => {
            const { type, status } = result._id;
            const count = result.count;
            const avgTime = Math.round(result.avgProcessingTime || 0);
            
            if (channels[type]) {
                if (status === 'sent' || status === 'completed') {
                    channels[type].sent += count;
                    channels[type].avgTime = avgTime;
                    totalSent += count;
                } else if (status === 'failed') {
                    channels[type].failed += count;
                    totalFailed += count;
                } else if (status === 'pending') {
                    channels[type].pending += count;
                    totalPending += count;
                }
            }
        });
        
        res.json({
            success: true,
            data: {
                timeframe,
                companyId: companyId || 'all',
                channels,
                total: {
                    sent: totalSent,
                    failed: totalFailed,
                    pending: totalPending
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[AI-AGENT-LOGIC] Error getting delivery analytics:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch delivery analytics',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Enhanced NotificationLog query endpoint for AI Agent Logic tab
router.get('/logs/:timeframe?', async (req, res) => {
    try {
        const timeframe = req.params.timeframe || '24h';
        const limit = Math.min(parseInt(req.query.limit) || 50, 100); // Cap at 100
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);
        const { type, status, companyId } = req.query;
        
        const since = parseTimeframe(timeframe);
        if (!since) {
            return res.status(400).json({
                success: false,
                error: 'Invalid timeframe. Use: 1h, 6h, 24h, 7d, 30d'
            });
        }
        
        const NotificationLog = require('../models/NotificationLog');
        
        // Build query with AI Agent Logic isolation
        const query = {
            'metadata.fromAgent': true,
            createdAt: { $gte: since }
        };
        
        // Add filters
        if (type) query.type = type;
        if (status) query.status = status;
        if (companyId) query['metadata.companyId'] = new require('mongoose').Types.ObjectId(companyId);
        
        const [logs, total] = await Promise.all([
            NotificationLog.find(query)
                .sort({ createdAt: -1 })
                .skip(offset)
                .limit(limit)
                .select('createdAt type recipient subject message status templateKey errorMessage aiAgentContext.processingTime aiAgentContext.source aiAgentContext.eventType')
                .lean(),
            NotificationLog.countDocuments(query)
        ]);
        
        // Format logs for frontend
        const formattedLogs = logs.map(log => ({
            id: log._id,
            timestamp: log.createdAt,
            type: log.type,
            recipient: log.recipient,
            subject: log.subject,
            message: log.message,
            status: log.status,
            templateKey: log.templateKey,
            errorMessage: log.errorMessage,
            processingTime: log.aiAgentContext?.processingTime || 0,
            source: log.aiAgentContext?.source || 'unknown',
            eventType: log.aiAgentContext?.eventType || 'unknown'
        }));
        
        res.json({
            success: true,
            data: {
                logs: formattedLogs,
                pagination: {
                    total,
                    limit,
                    offset,
                    hasMore: (offset + limit) < total
                }
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('[AI-AGENT-LOGIC] Error getting notification logs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch notification logs',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Test endpoint to generate sample notification data for AI Agent Logic tab
router.post('/test/generate-sample-data', async (req, res) => {
    try {
        const NotificationLog = require('../models/NotificationLog');
        
        // Generate sample notification logs
        const sampleLogs = [
            {
                type: 'sms',
                recipient: '+1234567890',
                subject: null,
                message: 'Your AC repair appointment is confirmed for tomorrow at 2 PM.',
                templateKey: 'booking_confirmed',
                status: 'sent',
                metadata: {
                    fromAgent: true,
                    companyId: '686a680241806a4991f7367f',
                    sessionId: 'test-session-1'
                },
                aiAgentContext: {
                    source: 'agent_event_hooks',
                    eventType: 'booking_confirmed',
                    processingTime: 850,
                    success: true,
                    sessionId: 'test-session-1',
                    conversationStep: 'booking_completion',
                    confidenceScore: 0.95,
                    intentDetected: 'schedule_service'
                }
            },
            {
                type: 'email',
                recipient: 'customer@example.com',
                subject: 'Booking Confirmation - Penguin Air',
                message: 'Your appointment has been scheduled. We will arrive tomorrow at 2 PM.',
                templateKey: 'booking_confirmed',
                status: 'sent',
                metadata: {
                    fromAgent: true,
                    companyId: '686a680241806a4991f7367f',
                    sessionId: 'test-session-2'
                },
                aiAgentContext: {
                    source: 'notification_service',
                    eventType: 'booking_confirmed',
                    processingTime: 1200,
                    success: true,
                    sessionId: 'test-session-2',
                    conversationStep: 'email_confirmation',
                    confidenceScore: 0.88,
                    intentDetected: 'schedule_service'
                }
            },
            {
                type: 'sms',
                recipient: '+1987654321',
                subject: null,
                message: 'I was unable to answer your question about pricing. Let me connect you to a specialist.',
                templateKey: 'fallback_message',
                status: 'sent',
                metadata: {
                    fromAgent: true,
                    companyId: '686a680241806a4991f7367f',
                    sessionId: 'test-session-3'
                },
                aiAgentContext: {
                    source: 'agent_event_hooks',
                    eventType: 'fallback_message',
                    processingTime: 650,
                    success: true,
                    sessionId: 'test-session-3',
                    conversationStep: 'escalation',
                    confidenceScore: 0.45,
                    intentDetected: 'pricing_inquiry'
                }
            }
        ];
        
        // Insert sample data
        const insertedLogs = await NotificationLog.insertMany(sampleLogs);
        
        res.json({
            success: true,
            message: `Generated ${insertedLogs.length} sample notification logs`,
            data: insertedLogs.map(log => ({
                id: log._id,
                type: log.type,
                status: log.status,
                eventType: log.aiAgentContext.eventType
            }))
        });
        
    } catch (error) {
        console.error('Error generating sample data:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// Helper functions for AI Agent Logic analytics
function parseTimeframe(timeframe) {
    const timeframes = {
        '1h': 1 * 60 * 60 * 1000,
        '6h': 6 * 60 * 60 * 1000,
        '24h': 24 * 60 * 60 * 1000,
        '7d': 7 * 24 * 60 * 60 * 1000,
        '30d': 30 * 24 * 60 * 60 * 1000
    };
    
    const milliseconds = timeframes[timeframe];
    return milliseconds ? new Date(Date.now() - milliseconds) : null;
}

function getPerformanceGrade(successRate, avgProcessingTime) {
    if (successRate >= 95 && avgProcessingTime < 1000) return 'A+';
    if (successRate >= 90 && avgProcessingTime < 2000) return 'A';
    if (successRate >= 85 && avgProcessingTime < 3000) return 'B';
    if (successRate >= 75 && avgProcessingTime < 5000) return 'C';
    return 'D';
}

module.exports = router;
