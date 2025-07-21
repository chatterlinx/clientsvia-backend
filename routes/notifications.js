// routes/notifications.js
// Enhanced Notification Log API Routes
// Spartan Coder - Bulletproof Gold Standard Implementation
// STRICTLY CONFINED TO AI AGENT LOGIC TAB

const express = require('express');
const router = express.Router();
const NotificationLog = require('../models/NotificationLog');
const notificationService = require('../services/notificationService');
const mongoose = require('mongoose');
const { Parser } = require('json2csv');
const moment = require('moment');

/**
 * GET /api/notifications/logs
 * Enhanced notification logs with advanced filtering, pagination, and company isolation
 */
router.get('/logs', async (req, res) => {
    try {
        const { 
            search, 
            status, 
            type, 
            timeframe = '24h',
            companyId,
            limit = 50,
            offset = 0,
            sortBy = 'createdAt',
            sortOrder = 'desc'
        } = req.query;

        // Build query with AI Agent Logic isolation
        const query = {
            'metadata.fromAgent': true // Ensure AI Agent Logic isolation
        };

        // Company isolation for multi-tenant security
        if (companyId) {
            query['metadata.companyId'] = new mongoose.Types.ObjectId(companyId);
        }

        // Status filter
        if (status && status !== 'all') {
            query.status = status;
        }

        // Type filter (sms, email, event_hook)
        if (type && type !== 'all') {
            query.type = type;
        }

        // Timeframe filter
        if (timeframe) {
            const timeframes = {
                '1h': 1 * 60 * 60 * 1000,
                '6h': 6 * 60 * 60 * 1000,
                '24h': 24 * 60 * 60 * 1000,
                '7d': 7 * 24 * 60 * 60 * 1000,
                '30d': 30 * 24 * 60 * 60 * 1000
            };
            
            const milliseconds = timeframes[timeframe];
            if (milliseconds) {
                query.createdAt = { $gte: new Date(Date.now() - milliseconds) };
            }
        }

        // Search functionality with multiple fields
        if (search && search.trim()) {
            const searchRegex = { $regex: search.trim(), $options: 'i' };
            query.$or = [
                { recipient: searchRegex },
                { subject: searchRegex },
                { message: searchRegex },
                { 'aiAgentContext.eventType': searchRegex }
            ];
        }

        // Pagination settings
        const limitNum = Math.min(parseInt(limit) || 50, 100); // Cap at 100
        const offsetNum = Math.max(parseInt(offset) || 0, 0);

        // Sort settings
        const sortObj = {};
        sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;

        // Execute query with pagination
        const [logs, total] = await Promise.all([
            NotificationLog.find(query)
                .sort(sortObj)
                .skip(offsetNum)
                .limit(limitNum)
                .select('createdAt type recipient subject message status templateKey errorMessage aiAgentContext.processingTime aiAgentContext.source aiAgentContext.eventType')
                .lean(),
            NotificationLog.countDocuments(query)
        ]);

        // Format response for frontend
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
                    limit: limitNum,
                    offset: offsetNum,
                    hasMore: (offsetNum + limitNum) < total,
                    currentPage: Math.floor(offsetNum / limitNum) + 1,
                    totalPages: Math.ceil(total / limitNum)
                },
                filters: {
                    search,
                    status,
                    type,
                    timeframe,
                    companyId
                }
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('[NOTIFICATION-API] Error fetching notification logs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch notification logs',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * GET /api/notifications/stats
 * Get notification statistics for AI Agent Logic dashboard
 */
router.get('/stats', async (req, res) => {
    try {
        const { timeframe = '24h', companyId } = req.query;
        
        // Parse timeframe
        const timeframes = {
            '1h': 1 * 60 * 60 * 1000,
            '6h': 6 * 60 * 60 * 1000,
            '24h': 24 * 60 * 60 * 1000,
            '7d': 7 * 24 * 60 * 60 * 1000,
            '30d': 30 * 24 * 60 * 60 * 1000
        };
        
        const milliseconds = timeframes[timeframe];
        if (!milliseconds) {
            return res.status(400).json({
                success: false,
                error: 'Invalid timeframe. Use: 1h, 6h, 24h, 7d, 30d'
            });
        }
        
        const since = new Date(Date.now() - milliseconds);
        
        // Get AI Agent Logic specific stats
        const stats = await NotificationLog.getAIAgentStats(since, companyId);
        
        res.json({
            success: true,
            data: {
                timeframe,
                companyId: companyId || 'all',
                stats,
                timestamp: new Date().toISOString()
            }
        });

    } catch (error) {
        console.error('[NOTIFICATION-API] Error fetching notification stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch notification statistics',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * POST /api/notifications/test/sample-data
 * Generate sample notification data for testing
 */
router.post('/test/sample-data', async (req, res) => {
    try {
        const { companyId = '686a680241806a4991f7367f' } = req.body;
        
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
                    companyId: new mongoose.Types.ObjectId(companyId),
                    sessionId: `test-session-${Date.now()}-1`
                },
                aiAgentContext: {
                    source: 'agent_event_hooks',
                    eventType: 'booking_confirmed',
                    processingTime: Math.floor(Math.random() * 1000) + 500,
                    success: true,
                    sessionId: `test-session-${Date.now()}-1`,
                    conversationStep: 'booking_completion',
                    confidenceScore: 0.95,
                    intentDetected: 'schedule_service'
                }
            },
            {
                type: 'email',
                recipient: 'customer@example.com',
                subject: 'Booking Confirmation - Your Service Company',
                message: 'Your appointment has been scheduled. We will arrive tomorrow at 2 PM.',
                templateKey: 'booking_confirmed',
                status: 'sent',
                metadata: {
                    fromAgent: true,
                    companyId: new mongoose.Types.ObjectId(companyId),
                    sessionId: `test-session-${Date.now()}-2`
                },
                aiAgentContext: {
                    source: 'notification_service',
                    eventType: 'booking_confirmed',
                    processingTime: Math.floor(Math.random() * 1500) + 800,
                    success: true,
                    sessionId: `test-session-${Date.now()}-2`,
                    conversationStep: 'email_confirmation',
                    confidenceScore: 0.88,
                    intentDetected: 'schedule_service'
                }
            },
            {
                type: 'event_hook',
                recipient: 'system',
                subject: 'AI Agent Event: fallback_message',
                message: 'Customer inquiry escalated to human agent due to complex pricing question.',
                templateKey: 'fallback_message',
                status: 'completed',
                metadata: {
                    fromAgent: true,
                    companyId: new mongoose.Types.ObjectId(companyId),
                    sessionId: `test-session-${Date.now()}-3`
                },
                aiAgentContext: {
                    source: 'agent_event_hooks',
                    eventType: 'fallback_message',
                    processingTime: Math.floor(Math.random() * 800) + 300,
                    success: true,
                    sessionId: `test-session-${Date.now()}-3`,
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
                eventType: log.aiAgentContext?.eventType,
                timestamp: log.createdAt
            }))
        });
        
    } catch (error) {
        console.error('[NOTIFICATION-API] Error generating sample data:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate sample data',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * POST /api/notifications/sms
 * Send SMS notification via Twilio
 */
router.post('/sms', async (req, res) => {
  try {
    const { to, templateKey, data, options } = req.body;
    
    if (!to || !templateKey) {
      return res.status(400).json({
        success: false,
        error: 'Phone number and template key are required'
      });
    }
    
    const result = await notificationService.sendSMS(to, templateKey, data, options);
    
    res.json({
      success: result.success,
      ...result
    });
  } catch (error) {
    console.error('[Notification API] SMS error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send SMS notification'
    });
  }
});

// Send email notification
router.post('/email', async (req, res) => {
  try {
    const { to, subject, templateKey, data, options } = req.body;
    
    if (!to || !templateKey) {
      return res.status(400).json({
        success: false,
        error: 'Email address and template key are required'
      });
    }
    
    const emailSubject = subject || notificationService.generateSubject(templateKey, data);
    const result = await notificationService.sendEmail(to, emailSubject, templateKey, data, options);
    
    res.json({
      success: result.success,
      ...result
    });
  } catch (error) {
    console.error('[Notification API] Email error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send email notification'
    });
  }
});

// Send smart notification (chooses best channel)
router.post('/send', async (req, res) => {
  try {
    const { contact, templateKey, data, options } = req.body;
    
    if (!contact || !templateKey) {
      return res.status(400).json({
        success: false,
        error: 'Contact information and template key are required'
      });
    }
    
    const result = await notificationService.sendNotification(contact, templateKey, data, options);
    
    res.json({
      success: result.success,
      ...result
    });
  } catch (error) {
    console.error('[Notification API] Send error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send notification'
    });
  }
});

// Send bulk notifications
router.post('/bulk', async (req, res) => {
  try {
    const { contacts, templateKey, data, options } = req.body;
    
    if (!Array.isArray(contacts) || !templateKey) {
      return res.status(400).json({
        success: false,
        error: 'Contacts array and template key are required'
      });
    }
    
    const result = await notificationService.sendBulkNotifications(contacts, templateKey, data, options);
    
    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    console.error('[Notification API] Bulk send error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send bulk notifications'
    });
  }
});

// Preview message without sending
router.post('/preview', (req, res) => {
  try {
    const { templateKey, data, channel } = req.body;
    
    if (!templateKey) {
      return res.status(400).json({
        success: false,
        error: 'Template key is required'
      });
    }
    
    const smsMessage = notificationService.formatMessage(templateKey, data, 'sms');
    const emailMessage = notificationService.formatMessage(templateKey, data, 'email');
    const subject = notificationService.generateSubject(templateKey, data);
    
    const preview = {
      templateKey,
      data,
      sms: smsMessage,
      email: {
        subject,
        body: emailMessage
      }
    };
    
    if (channel) {
      // Return only specific channel
      if (channel === 'sms') {
        preview.message = smsMessage;
      } else if (channel === 'email') {
        preview.message = emailMessage;
        preview.subject = subject;
      }
    }
    
    res.json({
      success: true,
      preview
    });
  } catch (error) {
    console.error('[Notification API] Preview error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to generate preview'
    });
  }
});

// Get notification statistics
router.get('/stats', (req, res) => {
  try {
    const { timeframe = '24h' } = req.query;
    
    const stats = notificationService.getStats(timeframe);
    
    res.json({
      success: true,
      timeframe,
      stats
    });
  } catch (error) {
    console.error('[Notification API] Stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get statistics'
    });
  }
});

// Get available templates
router.get('/templates', (req, res) => {
  try {
    const templates = notificationService.getAvailableTemplates();
    
    res.json({
      success: true,
      templates,
      count: templates.length
    });
  } catch (error) {
    console.error('[Notification API] Templates error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get templates'
    });
  }
});

// Get specific template
router.get('/templates/:templateKey', (req, res) => {
  try {
    const { templateKey } = req.params;
    
    const template = notificationService.templates[templateKey];
    
    if (!template) {
      return res.status(404).json({
        success: false,
        error: 'Template not found'
      });
    }
    
    res.json({
      success: true,
      templateKey,
      template
    });
  } catch (error) {
    console.error('[Notification API] Template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get template'
    });
  }
});

// Add or update template (admin only)
router.put('/templates/:templateKey', (req, res) => {
  try {
    const { templateKey } = req.params;
    const { template } = req.body;
    
    if (!template || !template.sms || !template.email) {
      return res.status(400).json({
        success: false,
        error: 'Template must include both SMS and email versions'
      });
    }
    
    notificationService.addTemplate(templateKey, template);
    
    res.json({
      success: true,
      message: 'Template updated successfully',
      templateKey
    });
  } catch (error) {
    console.error('[Notification API] Update template error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update template'
    });
  }
});

// Test notifications with sample data
router.post('/test', async (req, res) => {
  try {
    const { templateKey, contact } = req.body;
    
    // Sample test data
    const testData = {
      companyName: 'Test Company',
      customerName: 'John Doe',
      serviceType: 'Test Service',
      appointmentTime: 'Today at 2:00 PM',
      address: '123 Test St, Test City',
      phone: '(555) 123-4567',
      customerPhone: '+15555551234',
      amount: '100.00',
      invoiceNumber: 'TEST-001'
    };
    
    const testContact = contact || {
      name: 'Test User',
      phone: '+15555551234',
      email: 'test@example.com'
    };
    
    const result = await notificationService.sendNotification(
      testContact,
      templateKey || 'bookingConfirmation',
      testData,
      { preferSMS: false } // Use email for testing
    );
    
    res.json({
      success: true,
      testData,
      testContact,
      result
    });
  } catch (error) {
    console.error('[Notification API] Test error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to run test'
    });
  }
});

// Health check
router.get('/health', (req, res) => {
  try {
    const stats = notificationService.getStats('1h');
    
    res.json({
      success: true,
      status: 'healthy',
      service: 'notifications',
      templatesCount: notificationService.getAvailableTemplates().length,
      recentMessages: stats.total,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message
    });
  }
});

/**
 * GET /api/notifications/logs/export
 * Enterprise CSV export with advanced filtering and company isolation
 */
router.get('/logs/export', async (req, res) => {
  try {
    const { 
      range = '24h',
      companyId,
      type,
      status,
      search
    } = req.query;

    // Build time range filter with enhanced options
    const timeRanges = {
      '1h': moment().subtract(1, 'hours'),
      '6h': moment().subtract(6, 'hours'),
      '24h': moment().subtract(24, 'hours'),
      '7d': moment().subtract(7, 'days'),
      '30d': moment().subtract(30, 'days'),
      '90d': moment().subtract(90, 'days'),
      'all': moment().subtract(1, 'years') // Reasonable limit for exports
    };

    const startDate = timeRanges[range] || timeRanges['24h'];

    // Build query with AI Agent Logic isolation and filters
    const query = {
      'metadata.fromAgent': true, // Ensure AI Agent Logic isolation
      createdAt: { $gte: startDate.toDate() }
    };

    // Add company filter for multi-tenant security
    if (companyId) {
      query['metadata.companyId'] = new mongoose.Types.ObjectId(companyId);
    }

    // Add additional filters
    if (type && type !== 'all') {
      query.type = type;
    }

    if (status && status !== 'all') {
      query.status = status;
    }

    // Add search functionality
    if (search && search.trim()) {
      const searchRegex = { $regex: search.trim(), $options: 'i' };
      query.$or = [
        { recipient: searchRegex },
        { subject: searchRegex },
        { message: searchRegex },
        { 'aiAgentContext.eventType': searchRegex }
      ];
    }

    console.log(`[NOTIFICATION-EXPORT] Exporting logs for range: ${range}, filters:`, {
      companyId,
      type,
      status,
      hasSearch: !!search
    });

    // Fetch logs with selected fields for export
    const logs = await NotificationLog.find(query)
      .sort({ createdAt: -1 })
      .limit(10000) // Reasonable export limit
      .select('createdAt type recipient subject message status templateKey errorMessage aiAgentContext metadata')
      .lean();

    if (!logs.length) {
      return res.status(404).json({ 
        success: false,
        error: 'No notification logs found in selected range and filters.',
        filters: { range, companyId, type, status, search }
      });
    }

    // Define enhanced CSV fields for comprehensive export
    const fields = [
      { 
        label: 'Timestamp', 
        value: row => moment(row.createdAt).format('YYYY-MM-DD HH:mm:ss UTC')
      },
      { 
        label: 'Date', 
        value: row => moment(row.createdAt).format('YYYY-MM-DD')
      },
      { 
        label: 'Time', 
        value: row => moment(row.createdAt).format('HH:mm:ss')
      },
      { label: 'Type', value: 'type' },
      { label: 'Status', value: 'status' },
      { label: 'Recipient', value: 'recipient' },
      { label: 'Subject', value: 'subject' },
      { 
        label: 'Message', 
        value: row => row.message ? row.message.substring(0, 500) + (row.message.length > 500 ? '...' : '') : ''
      },
      { label: 'Template', value: 'templateKey' },
      { label: 'Error', value: 'errorMessage' },
      { 
        label: 'Event Type', 
        value: row => row.aiAgentContext?.eventType || ''
      },
      { 
        label: 'Processing Time (ms)', 
        value: row => row.aiAgentContext?.processingTime || ''
      },
      { 
        label: 'Source', 
        value: row => row.aiAgentContext?.source || ''
      },
      { 
        label: 'Session ID', 
        value: row => row.metadata?.sessionId || ''
      },
      { 
        label: 'Trace ID', 
        value: row => row.metadata?.traceId || ''
      },
      { 
        label: 'Company ID', 
        value: row => row.metadata?.companyId || ''
      }
    ];

    // Generate CSV with enhanced error handling
    const parser = new Parser({ 
      fields,
      header: true,
      delimiter: ',',
      quote: '"',
      escapedQuote: '""'
    });

    const csv = parser.parse(logs);

    // Generate descriptive filename with filters and sanitization
    const timestamp = moment().format('YYYY-MM-DD_HH-mm-ss');
    const filters = [range];
    if (companyId) filters.push(`company-${companyId.slice(-6)}`);
    if (type && type !== 'all') {
      // Sanitize type field for filename safety
      const safeType = type.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 20);
      if (safeType) filters.push(safeType);
    }
    if (status && status !== 'all') {
      // Sanitize status field for filename safety
      const safeStatus = status.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 20);
      if (safeStatus) filters.push(safeStatus);
    }
    
    const filename = `notification_logs_${filters.join('_')}_${timestamp}.csv`;

    // Set response headers for file download
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    // Add UTF-8 BOM for Excel compatibility
    const csvWithBOM = '\uFEFF' + csv;

    console.log(`[NOTIFICATION-EXPORT] Successfully exported ${logs.length} logs to ${filename}`);

    res.status(200).send(csvWithBOM);

  } catch (error) {
    console.error('[NOTIFICATION-EXPORT] Export failed:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export notification logs',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

module.exports = router;
