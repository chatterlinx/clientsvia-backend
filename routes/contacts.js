// routes/contacts.js
const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');
const Company = require('../models/Company');
const { body, validationResult, param } = require('express-validator');
const { 
    calculateLeadScore, 
    getContactPriority, 
    generateContactInsights, 
    getRecommendedActions,
    generateCompanyContactAnalytics 
} = require('../utils/contactAnalytics');

// Middleware to validate company access
const validateCompanyAccess = async (req, res, next) => {
    try {
        const { companyId } = req.params;
        
        if (!companyId || !companyId.match(/^[0-9a-fA-F]{24}$/)) {
            return res.status(400).json({ error: 'Invalid company ID format' });
        }
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        req.company = company;
        next();
    } catch (error) {
        console.error('[CONTACTS API] Company validation error:', error);
        res.status(500).json({ error: 'Server error during company validation' });
    }
};

// GET /api/contacts/:companyId - List all contacts for a company
router.get('/:companyId', validateCompanyAccess, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { status, limit = 50, page = 1, search } = req.query;
        
        console.log(`[CONTACTS API] GET /api/contacts/${companyId} - Listing contacts`);
        
        let query = { companyId };
        
        // Filter by status if provided
        if (status && ['new_lead', 'contacted', 'quoted', 'customer', 'inactive'].includes(status)) {
            query.status = status;
        }
        
        // Search functionality
        if (search) {
            query.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { firstName: { $regex: search, $options: 'i' } },
                { lastName: { $regex: search, $options: 'i' } },
                { primaryPhone: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } }
            ];
        }
        
        const skip = (parseInt(page) - 1) * parseInt(limit);
        
        const [contacts, total] = await Promise.all([
            Contact.find(query)
                .sort({ lastContactDate: -1 })
                .limit(parseInt(limit))
                .skip(skip)
                .lean(),
            Contact.countDocuments(query)
        ]);
        
        // Add computed fields
        const enrichedContacts = contacts.map(contact => ({
            ...contact,
            displayName: contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || contact.primaryPhone,
            latestServiceRequest: contact.serviceRequests?.[contact.serviceRequests.length - 1] || null,
            totalInteractions: contact.interactions?.length || 0,
            totalCalls: contact.interactions?.filter(i => i.type === 'call').length || 0
        }));
        
        res.json({
            success: true,
            data: {
                contacts: enrichedContacts,
                pagination: {
                    page: parseInt(page),
                    limit: parseInt(limit),
                    total,
                    pages: Math.ceil(total / parseInt(limit))
                }
            }
        });
        
    } catch (error) {
        console.error('[CONTACTS API] Error listing contacts:', error);
        res.status(500).json({ error: 'Failed to retrieve contacts' });
    }
});

// GET /api/contacts/:companyId/:contactId - Get specific contact
router.get('/:companyId/:contactId', 
    validateCompanyAccess,
    param('contactId').isMongoId().withMessage('Invalid contact ID'),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }
            
            const { companyId, contactId } = req.params;
            
            console.log(`[CONTACTS API] GET /api/contacts/${companyId}/${contactId} - Getting contact details`);
            
            const contact = await Contact.findOne({ _id: contactId, companyId });
            
            if (!contact) {
                return res.status(404).json({ error: 'Contact not found' });
            }
            
            res.json({
                success: true,
                data: contact
            });
            
        } catch (error) {
            console.error('[CONTACTS API] Error getting contact:', error);
            res.status(500).json({ error: 'Failed to retrieve contact' });
        }
    }
);

// POST /api/contacts/:companyId - Create new contact
router.post('/:companyId',
    validateCompanyAccess,
    [
        body('primaryPhone').notEmpty().withMessage('Primary phone is required'),
        body('firstName').optional().trim().isLength({ max: 100 }),
        body('lastName').optional().trim().isLength({ max: 100 }),
        body('email').optional().isEmail().normalizeEmail(),
        body('status').optional().isIn(['new_lead', 'contacted', 'quoted', 'customer', 'inactive'])
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }
            
            const { companyId } = req.params;
            const contactData = req.body;
            
            console.log(`[CONTACTS API] POST /api/contacts/${companyId} - Creating contact:`, contactData);
            
            // Check if contact already exists with this phone
            const existingContact = await Contact.findByPhone(companyId, contactData.primaryPhone);
            if (existingContact) {
                return res.status(409).json({ 
                    error: 'Contact already exists with this phone number',
                    existingContact: existingContact._id
                });
            }
            
            // Create new contact
            const newContact = new Contact({
                companyId,
                ...contactData,
                leadSource: contactData.leadSource || 'phone_call'
            });
            
            await newContact.save();
            
            console.log(`[CONTACTS API] ✅ Contact created: ${newContact._id}`);
            
            res.status(201).json({
                success: true,
                data: newContact
            });
            
        } catch (error) {
            console.error('[CONTACTS API] Error creating contact:', error);
            res.status(500).json({ error: 'Failed to create contact' });
        }
    }
);

// PATCH /api/contacts/:companyId/:contactId - Update contact
router.patch('/:companyId/:contactId',
    validateCompanyAccess,
    param('contactId').isMongoId().withMessage('Invalid contact ID'),
    [
        body('firstName').optional().trim().isLength({ max: 100 }),
        body('lastName').optional().trim().isLength({ max: 100 }),
        body('email').optional().isEmail().normalizeEmail(),
        body('status').optional().isIn(['new_lead', 'contacted', 'quoted', 'customer', 'inactive']),
        body('primaryPhone').optional().notEmpty()
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }
            
            const { companyId, contactId } = req.params;
            const updateData = req.body;
            
            console.log(`[CONTACTS API] PATCH /api/contacts/${companyId}/${contactId} - Updating contact`);
            
            const contact = await Contact.findOne({ _id: contactId, companyId });
            if (!contact) {
                return res.status(404).json({ error: 'Contact not found' });
            }
            
            // Update fields
            Object.assign(contact, updateData);
            await contact.save();
            
            console.log(`[CONTACTS API] ✅ Contact updated: ${contactId}`);
            
            res.json({
                success: true,
                data: contact
            });
            
        } catch (error) {
            console.error('[CONTACTS API] Error updating contact:', error);
            res.status(500).json({ error: 'Failed to update contact' });
        }
    }
);

// POST /api/contacts/:companyId/:contactId/interactions - Add interaction
router.post('/:companyId/:contactId/interactions',
    validateCompanyAccess,
    param('contactId').isMongoId().withMessage('Invalid contact ID'),
    [
        body('type').isIn(['call', 'chat', 'sms', 'email', 'appointment']).withMessage('Invalid interaction type'),
        body('summary').optional().trim().isLength({ max: 500 }),
        body('outcome').optional().isIn(['answered', 'booking', 'transferred', 'message', 'follow_up_needed']),
        body('twilioCallSid').optional().trim()
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }
            
            const { companyId, contactId } = req.params;
            const interactionData = req.body;
            
            console.log(`[CONTACTS API] POST /api/contacts/${companyId}/${contactId}/interactions - Adding interaction`);
            
            const contact = await Contact.findOne({ _id: contactId, companyId });
            if (!contact) {
                return res.status(404).json({ error: 'Contact not found' });
            }
            
            await contact.addInteraction(interactionData);
            
            console.log(`[CONTACTS API] ✅ Interaction added to contact: ${contactId}`);
            
            res.status(201).json({
                success: true,
                data: contact
            });
            
        } catch (error) {
            console.error('[CONTACTS API] Error adding interaction:', error);
            res.status(500).json({ error: 'Failed to add interaction' });
        }
    }
);

// POST /api/contacts/:companyId/:contactId/service-requests - Add service request
router.post('/:companyId/:contactId/service-requests',
    validateCompanyAccess,
    param('contactId').isMongoId().withMessage('Invalid contact ID'),
    [
        body('serviceType').notEmpty().withMessage('Service type is required'),
        body('description').optional().trim().isLength({ max: 500 }),
        body('urgency').optional().isIn(['routine', 'urgent', 'emergency']),
        body('preferredTimeSlots').optional().isArray()
    ],
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }
            
            const { companyId, contactId } = req.params;
            const serviceData = req.body;
            
            console.log(`[CONTACTS API] POST /api/contacts/${companyId}/${contactId}/service-requests - Adding service request`);
            
            const contact = await Contact.findOne({ _id: contactId, companyId });
            if (!contact) {
                return res.status(404).json({ error: 'Contact not found' });
            }
            
            await contact.addServiceRequest(serviceData);
            
            console.log(`[CONTACTS API] ✅ Service request added to contact: ${contactId}`);
            
            res.status(201).json({
                success: true,
                data: contact
            });
            
        } catch (error) {
            console.error('[CONTACTS API] Error adding service request:', error);
            res.status(500).json({ error: 'Failed to add service request' });
        }
    }
);

// GET /api/contacts/:companyId/by-phone/:phone - Find contact by phone
router.get('/:companyId/by-phone/:phone',
    validateCompanyAccess,
    param('phone').notEmpty().withMessage('Phone number is required'),
    async (req, res) => {
        try {
            const errors = validationResult(req);
            if (!errors.isEmpty()) {
                return res.status(400).json({ errors: errors.array() });
            }
            
            const { companyId, phone } = req.params;
            
            console.log(`[CONTACTS API] GET /api/contacts/${companyId}/by-phone/${phone} - Finding contact by phone`);
            
            const contact = await Contact.findByPhone(companyId, phone);
            
            if (!contact) {
                return res.status(404).json({ error: 'Contact not found' });
            }
            
            res.json({
                success: true,
                data: contact
            });
            
        } catch (error) {
            console.error('[CONTACTS API] Error finding contact by phone:', error);
            res.status(500).json({ error: 'Failed to find contact' });
        }
    }
);

// GET /api/contacts/:companyId/stats - Get contact statistics
router.get('/:companyId/stats', validateCompanyAccess, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log(`[CONTACTS API] GET /api/contacts/${companyId}/stats - Getting contact statistics`);
        
        const [
            totalContacts,
            newLeads,
            customers,
            recentContacts,
            totalInteractions
        ] = await Promise.all([
            Contact.countDocuments({ companyId }),
            Contact.countDocuments({ companyId, status: 'new_lead' }),
            Contact.countDocuments({ companyId, status: 'customer' }),
            Contact.countDocuments({ 
                companyId, 
                lastContactDate: { $gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } 
            }),
            Contact.aggregate([
                { $match: { companyId: require('mongoose').Types.ObjectId(companyId) } },
                { $unwind: { path: '$interactions', preserveNullAndEmptyArrays: true } },
                { $group: { _id: null, total: { $sum: 1 } } }
            ])
        ]);
        
        res.json({
            success: true,
            data: {
                totalContacts,
                newLeads,
                customers,
                recentContacts,
                totalInteractions: totalInteractions[0]?.total || 0,
                conversionRate: totalContacts > 0 ? ((customers / totalContacts) * 100).toFixed(1) : 0
            }
        });
        
    } catch (error) {
        console.error('[CONTACTS API] Error getting contact stats:', error);
        res.status(500).json({ error: 'Failed to get contact statistics' });
    }
});

// GET /api/contacts/:companyId/analytics - Get company contact analytics
router.get('/:companyId/analytics', validateCompanyAccess, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log(`[CONTACTS API] GET /api/contacts/${companyId}/analytics - Getting analytics`);
        
        const contacts = await Contact.find({ companyId }).sort({ lastContactDate: -1 });
        const analytics = generateCompanyContactAnalytics(contacts);
        
        // Add scheduling-specific analytics
        const schedulingRules = req.company.agentSetup?.schedulingRules || [];
        const pendingAppointments = contacts.reduce((count, contact) => {
            return count + (contact.serviceRequests?.filter(req => req.status === 'pending').length || 0);
        }, 0);
        
        const scheduledAppointments = contacts.reduce((count, contact) => {
            return count + (contact.serviceRequests?.filter(req => req.status === 'scheduled').length || 0);
        }, 0);
        
        analytics.schedulingMetrics = {
            totalSchedulingRules: schedulingRules.length,
            serviceTypes: schedulingRules.map(rule => rule.serviceName),
            pendingAppointments,
            scheduledAppointments,
            conversionRate: pendingAppointments > 0 ? 
                ((scheduledAppointments / (pendingAppointments + scheduledAppointments)) * 100).toFixed(1) : 0
        };
        
        res.json({
            success: true,
            data: analytics
        });
        
    } catch (error) {
        console.error('[CONTACTS API] Error getting analytics:', error);
        res.status(500).json({ error: 'Failed to get contact analytics' });
    }
});

// GET /api/contacts/:companyId/scheduling/test - Test scheduling logic for a service
router.get('/:companyId/scheduling/test', validateCompanyAccess, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { serviceType } = req.query;
        
        if (!serviceType) {
            return res.status(400).json({ error: 'Service type is required' });
        }
        
        console.log(`[SCHEDULING TEST] Testing availability for ${serviceType}`);
        
        const { findBestAvailableSlot, getAllAvailableSlots } = require('../services/schedulingService');
        
        // Create a test contact for scheduling
        const testContact = {
            displayName: 'Test Contact',
            extractedData: { hasEmergency: false }
        };
        
        // Test best available slot
        const bestSlot = await findBestAvailableSlot(req.company, testContact, serviceType);
        
        // Get multiple options
        const allSlots = await getAllAvailableSlots(req.company, serviceType, 5);
        
        res.json({
            success: true,
            data: {
                serviceType,
                bestAvailableSlot: bestSlot,
                availableOptions: allSlots,
                schedulingRule: req.company.agentSetup?.schedulingRules?.find(
                    rule => rule.serviceName.toLowerCase() === serviceType.toLowerCase()
                )
            }
        });
        
    } catch (error) {
        console.error('[SCHEDULING TEST] Error:', error);
        res.status(500).json({ error: 'Failed to test scheduling logic' });
    }
});

// GET /api/contacts/:companyId/insights/:contactId - Get detailed insights for a specific contact
router.get('/:companyId/insights/:contactId', validateCompanyAccess, async (req, res) => {
    try {
        const { companyId, contactId } = req.params;
        
        console.log(`[CONTACTS API] GET /api/contacts/${companyId}/insights/${contactId} - Getting contact insights`);
        
        const contact = await Contact.findOne({ _id: contactId, companyId });
        if (!contact) {
            return res.status(404).json({ error: 'Contact not found' });
        }
        
        const leadScore = calculateLeadScore(contact);
        const priority = getContactPriority(contact);
        const insights = generateContactInsights(contact);
        const recommendedActions = getRecommendedActions(contact);
        
        // Call pattern analysis
        const calls = contact.interactions?.filter(i => i.type === 'call') || [];
        const callAnalysis = {
            totalCalls: calls.length,
            avgDuration: calls.length > 0 ? 
                calls.reduce((sum, call) => sum + (call.duration || 0), 0) / calls.length : 0,
            outcomeBreakdown: {},
            timePatterns: {}
        };
        
        // Analyze call outcomes
        calls.forEach(call => {
            callAnalysis.outcomeBreakdown[call.outcome] = 
                (callAnalysis.outcomeBreakdown[call.outcome] || 0) + 1;
        });
        
        // Analyze time patterns (hour of day)
        calls.forEach(call => {
            const hour = new Date(call.timestamp).getHours();
            const timeSlot = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
            callAnalysis.timePatterns[timeSlot] = 
                (callAnalysis.timePatterns[timeSlot] || 0) + 1;
        });
        
        // Service request analysis
        const serviceAnalysis = {
            totalRequests: contact.serviceRequests?.length || 0,
            pendingRequests: contact.serviceRequests?.filter(req => req.status === 'pending').length || 0,
            completedRequests: contact.serviceRequests?.filter(req => req.status === 'completed').length || 0,
            averageValue: contact.actualValue || 0,
            serviceTypes: {}
        };
        
        // Analyze service types
        (contact.serviceRequests || []).forEach(request => {
            serviceAnalysis.serviceTypes[request.serviceType] = 
                (serviceAnalysis.serviceTypes[request.serviceType] || 0) + 1;
        });
        
        res.json({
            success: true,
            data: {
                contact: {
                    _id: contact._id,
                    displayName: contact.displayName,
                    primaryPhone: contact.primaryPhone,
                    email: contact.email,
                    status: contact.status,
                    createdAt: contact.createdAt,
                    lastContactDate: contact.lastContactDate
                },
                scoring: {
                    leadScore,
                    priority,
                    insights,
                    recommendedActions
                },
                callAnalysis,
                serviceAnalysis,
                extractedData: contact.extractedData,
                timeline: contact.interactions?.sort((a, b) => 
                    new Date(b.timestamp) - new Date(a.timestamp)
                ).slice(0, 20) || []
            }
        });
        
    } catch (error) {
        console.error('[CONTACTS API] Error getting contact insights:', error);
        res.status(500).json({ error: 'Failed to get contact insights' });
    }
});

// POST /api/contacts/:companyId/:contactId/appointments - Create appointment
router.post('/:companyId/:contactId/appointments', validateCompanyAccess, async (req, res) => {
    try {
        const { companyId, contactId } = req.params;
        const { serviceRequestId, appointmentSlot } = req.body;
        
        console.log(`[APPOINTMENTS] Creating appointment for contact ${contactId}`);
        
        const contact = await Contact.findOne({ _id: contactId, companyId });
        if (!contact) {
            return res.status(404).json({ error: 'Contact not found' });
        }
        
        const { createAppointmentBooking } = require('../services/schedulingService');
        const result = await createAppointmentBooking(contact, serviceRequestId, appointmentSlot, req.company);
        
        if (result.success) {
            res.json({
                success: true,
                data: result.appointment
            });
        } else {
            res.status(400).json({
                success: false,
                error: result.error
            });
        }
        
    } catch (error) {
        console.error('[APPOINTMENTS] Error creating appointment:', error);
        res.status(500).json({ error: 'Failed to create appointment' });
    }
});

// GET /api/contacts/:companyId/:contactId/scheduling-options - Get available appointment slots
router.get('/:companyId/:contactId/scheduling-options', validateCompanyAccess, async (req, res) => {
    try {
        const { companyId, contactId } = req.params;
        const { serviceType } = req.query;
        
        console.log(`[SCHEDULING OPTIONS] Getting options for contact ${contactId}, service: ${serviceType}`);
        
        const contact = await Contact.findOne({ _id: contactId, companyId });
        if (!contact) {
            return res.status(404).json({ error: 'Contact not found' });
        }
        
        const { getAllAvailableSlots, findBestAvailableSlot } = require('../services/schedulingService');
        
        const bestSlot = await findBestAvailableSlot(req.company, contact, serviceType);
        const allSlots = await getAllAvailableSlots(req.company, serviceType, 10);
        
        res.json({
            success: true,
            data: {
                bestRecommendation: bestSlot,
                availableSlots: allSlots,
                contact: {
                    name: contact.displayName,
                    priority: getContactPriority(contact),
                    hasEmergency: contact.extractedData?.hasEmergency || false
                }
            }
        });
        
    } catch (error) {
        console.error('[SCHEDULING OPTIONS] Error getting options:', error);
        res.status(500).json({ error: 'Failed to get scheduling options' });
    }
});

module.exports = router;
