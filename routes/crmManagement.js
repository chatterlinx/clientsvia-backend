// routes/crmManagement.js
// Comprehensive CRM Management API for ClientsVia Enterprise

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');

// Import models
const Contact = require('../models/Contact');
const ConversationLog = require('../models/ConversationLog');

// Import utilities
const { calculateLeadScore } = require('../utils/contactAnalytics');

// Simple test route
router.get('/test', (req, res) => {
    res.json({ message: 'CRM routes are working!', timestamp: new Date() });
});

/**
 * GET /api/crm/dashboard-stats?companyId=...
 * Get CRM dashboard statistics
 */
router.get('/dashboard-stats', async (req, res) => {
    try {
        const companyId = req.query.companyId;
        
        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }
        
        // Return mock data for now to see if the route works
        const mockStats = {
            totalContacts: 0,
            totalCalls: 0,
            totalRevenue: 0,
            estimatedRevenue: 0,
            contactsByStatus: {},
            pipeline: {
                new_lead: 0,
                contacted: 0,
                quoted: 0,
                customer: 0,
                inactive: 0
            }
        };
        
        console.log(`✅ CRM dashboard stats requested for company: ${companyId}`);
        res.json(mockStats);
        
    } catch (error) {
        console.error('❌ CRM dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to load dashboard stats' });
    }
});

/**
 * GET /api/crm/contacts?companyId=...
 * Get paginated contact list with search and filters
 */
router.get('/contacts', async (req, res) => {
    try {
        const companyId = req.query.companyId;
        
        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }
        
        // Return mock data for now
        const mockData = {
            contacts: [],
            pagination: {
                total: 0,
                pages: 0,
                currentPage: 1,
                limit: 25
            }
        };
        
        console.log(`✅ CRM contacts requested for company: ${companyId}`);
        res.json(mockData);
        
    } catch (error) {
        console.error('❌ CRM contacts error:', error);
        res.status(500).json({ error: 'Failed to load contacts' });
    }
});

/**
 * GET /api/crm/call-history?companyId=...
 * Get call history with audio links and transcripts
 */
router.get('/call-history', async (req, res) => {
    try {
        const companyId = req.query.companyId;
        
        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }
        
        // Return mock data for now
        const mockData = {
            calls: [],
            pagination: {
                total: 0,
                pages: 0,
                currentPage: 1,
                limit: 20
            }
        };
        
        console.log(`✅ CRM call history requested for company: ${companyId}`);
        res.json(mockData);
        
    } catch (error) {
        console.error('❌ CRM call history error:', error);
        res.status(500).json({ error: 'Failed to load call history' });
    }
});

module.exports = router;

/**
 * GET /api/crm/dashboard-stats?companyId=...
 * Get CRM dashboard statistics
 */
router.get('/dashboard-stats', async (req, res) => {
    try {
        const companyId = req.query.companyId;
        
        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }
        
        // Get contact counts by status
        const contactStats = await Contact.aggregate([
            { $match: { companyId } },
            { $group: { _id: '$status', count: { $sum: 1 }, totalValue: { $sum: '$actualValue' } } }
        ]);
        
        // Get total contacts and calls
        const totalContacts = await Contact.countDocuments({ companyId });
        const totalCalls = await Contact.aggregate([
            { $match: { companyId } },
            { $group: { _id: null, totalCalls: { $sum: '$totalCalls' } } }
        ]);
        
        // Calculate total revenue
        const revenueStats = await Contact.aggregate([
            { $match: { companyId } },
            { $group: { _id: null, totalRevenue: { $sum: '$actualValue' }, estimatedValue: { $sum: '$estimatedValue' } } }
        ]);
        
        // Format response
        const stats = {
            totalContacts,
            totalCalls: totalCalls[0]?.totalCalls || 0,
            totalRevenue: revenueStats[0]?.totalRevenue || 0,
            estimatedRevenue: revenueStats[0]?.estimatedValue || 0,
            contactsByStatus: contactStats.reduce((acc, stat) => {
                acc[stat._id] = { count: stat.count, value: stat.totalValue || 0 };
                return acc;
            }, {}),
            pipeline: {
                new_lead: contactStats.find(s => s._id === 'new_lead')?.count || 0,
                contacted: contactStats.find(s => s._id === 'contacted')?.count || 0,
                quoted: contactStats.find(s => s._id === 'quoted')?.count || 0,
                customer: contactStats.find(s => s._id === 'customer')?.count || 0,
                inactive: contactStats.find(s => s._id === 'inactive')?.count || 0
            }
        };
        
        res.json(stats);
        
    } catch (error) {
        console.error('CRM dashboard stats error:', error);
        res.status(500).json({ error: 'Failed to load dashboard statistics' });
    }
});

/**
 * GET /api/crm/contacts
 * Get paginated contact list with search and filters
 */
router.get('/contacts', async (req, res) => {
    try {
        const companyId = req.query.companyId;
        const {
            page = 1,
            limit = 25,
            search = '',
            status = '',
            customerType = '',
            sortBy = 'lastContactDate',
            sortOrder = 'desc'
        } = req.query;
        
        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }
        
        // Build filter query
        const filter = { companyId };
        
        if (search) {
            filter.$or = [
                { firstName: { $regex: search, $options: 'i' } },
                { lastName: { $regex: search, $options: 'i' } },
                { fullName: { $regex: search, $options: 'i' } },
                { primaryPhone: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { 'notes.text': { $regex: search, $options: 'i' } }
            ];
        }
        
        if (status) filter.status = status;
        if (customerType) filter.customerType = customerType;
        
        // Execute query with pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const sortObj = { [sortBy]: sortOrder === 'desc' ? -1 : 1 };
        
        const [contacts, totalCount] = await Promise.all([
            Contact.find(filter)
                .select('firstName lastName fullName primaryPhone email status customerType totalCalls lastContactDate estimatedValue actualValue extractedData')
                .sort(sortObj)
                .skip(skip)
                .limit(parseInt(limit)),
            Contact.countDocuments(filter)
        ]);
        
        // Add lead scores
        const contactsWithScores = contacts.map(contact => ({
            ...contact.toObject(),
            leadScore: calculateLeadScore(contact),
            daysSinceLastContact: contact.lastContactDate ? 
                Math.floor((Date.now() - new Date(contact.lastContactDate)) / (1000 * 60 * 60 * 24)) : null
        }));
        
        res.json({
            contacts: contactsWithScores,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalCount,
                hasNext: skip + contacts.length < totalCount,
                hasPrev: page > 1
            }
        });
        
    } catch (error) {
        console.error('CRM contacts list error:', error);
        res.status(500).json({ error: 'Failed to load contacts' });
    }
});

/**
 * GET /api/crm/contact/:contactId
 * Get detailed contact information including full interaction history
 */
router.get('/contact/:contactId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.user;
        const { contactId } = req.params;
        
        const contact = await Contact.findOne({ _id: contactId, companyId });
        
        if (!contact) {
            return res.status(404).json({ error: 'Contact not found' });
        }
        
        // Get related call logs with audio/transcripts
        const callLogs = await ConversationLog.find({
            companyId,
            'metadata.contactId': contactId
        }).sort({ timestamp: -1 }).limit(50);
        
        const contactDetails = {
            ...contact.toObject(),
            leadScore: calculateLeadScore(contact),
            callHistory: callLogs.map(log => ({
                id: log._id,
                timestamp: log.timestamp,
                duration: log.metadata?.callDuration || 0,
                summary: log.summary,
                audioUrl: log.metadata?.audioUrl,
                transcriptUrl: log.metadata?.transcriptUrl,
                outcome: log.metadata?.outcome || 'answered',
                sentiment: log.metadata?.sentiment || 0
            }))
        };
        
        res.json(contactDetails);
        
    } catch (error) {
        console.error('CRM contact details error:', error);
        res.status(500).json({ error: 'Failed to load contact details' });
    }
});

/**
 * POST /api/crm/contact
 * Create new contact
 */
router.post('/contact', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.user;
        const contactData = { ...req.body, companyId };
        
        // Check for duplicate phone number
        const existingContact = await Contact.findOne({
            companyId,
            primaryPhone: contactData.primaryPhone
        });
        
        if (existingContact) {
            return res.status(409).json({ error: 'Contact with this phone number already exists' });
        }
        
        const contact = new Contact(contactData);
        await contact.save();
        
        res.status(201).json({
            success: true,
            contact: contact.toObject(),
            message: 'Contact created successfully'
        });
        
    } catch (error) {
        console.error('CRM create contact error:', error);
        res.status(500).json({ error: 'Failed to create contact' });
    }
});

/**
 * PUT /api/crm/contact/:contactId
 * Update existing contact
 */
router.put('/contact/:contactId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.user;
        const { contactId } = req.params;
        
        const contact = await Contact.findOneAndUpdate(
            { _id: contactId, companyId },
            { ...req.body, updatedAt: new Date() },
            { new: true }
        );
        
        if (!contact) {
            return res.status(404).json({ error: 'Contact not found' });
        }
        
        res.json({
            success: true,
            contact: contact.toObject(),
            message: 'Contact updated successfully'
        });
        
    } catch (error) {
        console.error('CRM update contact error:', error);
        res.status(500).json({ error: 'Failed to update contact' });
    }
});

/**
 * GET /api/crm/call-history
 * Get call history with audio links and transcripts
 */
router.get('/call-history', async (req, res) => {
    try {
        const companyId = req.query.companyId;
        const {
            page = 1,
            limit = 20,
            search = '',
            dateFilter = 'month',
            outcome = ''
        } = req.query;
        
        if (!companyId) {
            return res.status(400).json({ error: 'Company ID is required' });
        }
        
        // Build date filter
        let dateRange = {};
        const now = new Date();
        switch (dateFilter) {
            case 'today':
                dateRange = { $gte: new Date(now.setHours(0, 0, 0, 0)) };
                break;
            case 'week':
                dateRange = { $gte: new Date(now.setDate(now.getDate() - 7)) };
                break;
            case 'month':
                dateRange = { $gte: new Date(now.setDate(now.getDate() - 30)) };
                break;
            case 'quarter':
                dateRange = { $gte: new Date(now.setDate(now.getDate() - 90)) };
                break;
            default:
                dateRange = {};
        }
        
        // Build search query
        let searchQuery = { companyId };
        if (dateRange.$gte) {
            searchQuery['session.startTime'] = dateRange;
        }
        
        if (search) {
            searchQuery.$or = [
                { 'session.customerPhone': { $regex: search, $options: 'i' } },
                { 'customer.name': { $regex: search, $options: 'i' } },
                { 'analysis.primaryIntent': { $regex: search, $options: 'i' } }
            ];
        }
        
        if (outcome) {
            searchQuery['analysis.resolutionStatus'] = outcome;
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        // Get conversation logs (call history)
        const [callLogs, totalCount] = await Promise.all([
            ConversationLog.find(searchQuery)
                .sort({ 'session.startTime': -1 })
                .skip(skip)
                .limit(parseInt(limit))
                .populate('customer.contactId', 'fullName primaryPhone email'),
            ConversationLog.countDocuments(searchQuery)
        ]);
        
        // Format calls for frontend
        const formattedCalls = callLogs.map(log => ({
            id: log._id,
            conversationId: log.conversationId,
            timestamp: log.session.startTime,
            duration: log.session.duration || 0,
            contactName: log.customer?.name || 'Unknown Caller',
            contactPhone: log.session.customerPhone || '',
            contactEmail: log.session.customerEmail || '',
            summary: log.analysis?.primaryIntent || 'Call completed',
            transcript: log.messages?.map(m => `${m.speaker}: ${m.content.text}`).join('\n') || '',
            audioUrl: log.session.twilioCallSid ? `/api/crm/call-audio/${log.session.twilioCallSid}` : null,
            transcriptUrl: log.conversationId ? `/api/crm/call-transcript/${log.conversationId}` : null,
            outcome: log.analysis?.resolutionStatus || 'completed',
            sentiment: log.analysis?.overallSentiment || 'neutral',
            customerSatisfaction: log.analysis?.customerSatisfaction || null,
            callSid: log.session.twilioCallSid,
            bookingCreated: log.outcomes?.bookingCreated || false,
            followUpRequired: log.outcomes?.followUpRequired || false,
            cost: log.costs?.totalCost || 0,
            agentPerformance: log.analysis?.agentPerformanceScore || null
        }));
        
        res.json({
            calls: formattedCalls,
            pagination: {
                currentPage: parseInt(page),
                totalPages: Math.ceil(totalCount / parseInt(limit)),
                totalCount,
                hasNext: skip + callLogs.length < totalCount,
                hasPrev: page > 1
            }
        });
        
    } catch (error) {
        console.error('CRM call history error:', error);
        res.status(500).json({ error: 'Failed to get call history' });
    }
});

/**
 * GET /api/crm/call-audio/:callSid
 * Get audio recording for a specific call
 */
router.get('/call-audio/:callSid', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.user;
        const { callSid } = req.params;
        
        // Find conversation log
        const conversation = await ConversationLog.findOne({
            companyId,
            'session.twilioCallSid': callSid
        });
        
        if (!conversation) {
            return res.status(404).json({ error: 'Call recording not found' });
        }
        
        // In a real implementation, this would fetch the actual audio from Twilio
        // For now, return a placeholder response
        res.json({
            callSid,
            audioUrl: `https://api.twilio.com/recording/${callSid}.mp3`,
            duration: conversation.session.duration,
            status: 'available',
            message: 'Audio integration with Twilio coming soon'
        });
        
    } catch (error) {
        console.error('Get call audio error:', error);
        res.status(500).json({ error: 'Failed to get call audio' });
    }
});

/**
 * GET /api/crm/call-transcript/:conversationId
 * Get transcript for a specific call
 */
router.get('/call-transcript/:conversationId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.user;
        const { conversationId } = req.params;
        
        // Find conversation log
        const conversation = await ConversationLog.findOne({
            companyId,
            conversationId
        });
        
        if (!conversation) {
            return res.status(404).json({ error: 'Transcript not found' });
        }
        
        // Format transcript
        const transcript = {
            conversationId,
            timestamp: conversation.session.startTime,
            duration: conversation.session.duration,
            customerPhone: conversation.session.customerPhone,
            messages: conversation.messages.map(msg => ({
                timestamp: msg.timestamp,
                speaker: msg.speaker,
                text: msg.content.text,
                confidence: msg.content.confidence,
                intent: msg.intent?.detected
            })),
            analysis: {
                primaryIntent: conversation.analysis?.primaryIntent,
                sentiment: conversation.analysis?.overallSentiment,
                resolutionStatus: conversation.analysis?.resolutionStatus,
                customerSatisfaction: conversation.analysis?.customerSatisfaction
            },
            outcomes: conversation.outcomes
        };
        
        res.json(transcript);
        
    } catch (error) {
        console.error('Get call transcript error:', error);
        res.status(500).json({ error: 'Failed to get call transcript' });
    }
});

/**
 * POST /api/crm/contacts/:id/interactions
 * Add interaction to contact
 */
router.post('/contacts/:id/interactions', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.user;
        const { id } = req.params;
        const interactionData = req.body;
        
        const contact = await Contact.findOne({ _id: id, companyId });
        
        if (!contact) {
            return res.status(404).json({ error: 'Contact not found' });
        }
        
        // Add interaction to contact
        contact.interactions.push({
            ...interactionData,
            timestamp: new Date()
        });
        
        // Update contact stats
        if (interactionData.type === 'call') {
            contact.totalCalls = (contact.totalCalls || 0) + 1;
        }
        contact.lastContactDate = new Date();
        
        await contact.save();
        
        res.json({
            success: true,
            contact,
            message: 'Interaction added successfully'
        });
        
    } catch (error) {
        console.error('Add interaction error:', error);
        res.status(500).json({ error: 'Failed to add interaction' });
    }
});

module.exports = router;
