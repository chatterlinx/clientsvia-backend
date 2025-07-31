// routes/contactLookup.js
// Contact Lookup API for Real-time Caller Identification

const express = require('express');
const router = express.Router();
const Contact = require('../models/Contact');
const auth = require('../middleware/auth');

/**
 * GET /api/contact-lookup/phone/:phoneNumber
 * Look up contact by phone number for real-time caller identification
 */
router.get('/phone/:phoneNumber', auth, async (req, res) => {
    try {
        const { phoneNumber } = req.params;
        const { companyId } = req.user;
        
        if (!phoneNumber) {
            return res.status(400).json({ error: 'Phone number is required' });
        }
        
        // Clean phone number (remove non-digits)
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        
        // Search for contact by primary or alternate phone
        const contact = await Contact.findOne({
            companyId,
            $or: [
                { primaryPhone: { $regex: cleanPhone, $options: 'i' } },
                { alternatePhone: { $regex: cleanPhone, $options: 'i' } }
            ]
        }).select('firstName lastName fullName primaryPhone email status customerType lastContactDate totalCalls extractedData');
        
        if (!contact) {
            return res.status(404).json({ 
                found: false,
                message: 'Contact not found',
                phoneNumber: phoneNumber
            });
        }
        
        // Calculate caller insights
        const daysSinceLastContact = contact.lastContactDate ? 
            Math.floor((Date.now() - new Date(contact.lastContactDate)) / (1000 * 60 * 60 * 24)) : null;
        
        const callerInfo = {
            found: true,
            contact: {
                id: contact._id,
                name: contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim(),
                firstName: contact.firstName,
                lastName: contact.lastName,
                phone: contact.primaryPhone,
                email: contact.email,
                status: contact.status,
                customerType: contact.customerType,
                totalCalls: contact.totalCalls || 0,
                lastContactDaysAgo: daysSinceLastContact,
                hasEmergency: contact.extractedData?.hasEmergency || false,
                sentimentScore: contact.extractedData?.sentimentScore || 0
            },
            placeholders: {
                '{callername}': contact.fullName || contact.firstName || 'Customer',
                '{customerstatus}': contact.status || 'new_lead',
                '{customertype}': contact.customerType || 'residential',
                '{lastcontact}': daysSinceLastContact ? `${daysSinceLastContact} days ago` : 'First time caller'
            }
        };
        
        res.json(callerInfo);
        
    } catch (error) {
        console.error('Contact lookup error:', error);
        res.status(500).json({ error: 'Failed to lookup contact' });
    }
});

/**
 * POST /api/contact-lookup/update-interaction
 * Update contact interaction history during/after call
 */
router.post('/update-interaction', auth, async (req, res) => {
    try {
        const { phoneNumber, interaction } = req.body;
        const { companyId } = req.user;
        
        if (!phoneNumber || !interaction) {
            return res.status(400).json({ error: 'Phone number and interaction data required' });
        }
        
        // Clean phone number
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        
        // Find or create contact
        let contact = await Contact.findOne({
            companyId,
            $or: [
                { primaryPhone: { $regex: cleanPhone, $options: 'i' } },
                { alternatePhone: { $regex: cleanPhone, $options: 'i' } }
            ]
        });
        
        if (!contact) {
            // Create new contact
            contact = new Contact({
                companyId,
                primaryPhone: phoneNumber,
                fullName: interaction.callerName || 'Unknown Caller',
                status: 'new_lead',
                leadSource: 'phone_call'
            });
        }
        
        // Add interaction
        contact.interactions.push({
            type: 'call',
            direction: 'inbound',
            timestamp: new Date(),
            duration: interaction.duration || 0,
            summary: interaction.summary || '',
            outcome: interaction.outcome || 'answered',
            twilioCallSid: interaction.callSid,
            agentNotes: interaction.notes || '',
            metadata: interaction.metadata || {}
        });
        
        // Update totals
        contact.totalCalls = (contact.totalCalls || 0) + 1;
        contact.lastContactDate = new Date();
        
        // Update extracted data if provided
        if (interaction.extractedData) {
            contact.extractedData = { ...contact.extractedData, ...interaction.extractedData };
        }
        
        await contact.save();
        
        res.json({
            success: true,
            contactId: contact._id,
            message: 'Interaction recorded successfully'
        });
        
    } catch (error) {
        console.error('Update interaction error:', error);
        res.status(500).json({ error: 'Failed to update interaction' });
    }
});

/**
 * GET /api/contact-lookup/recent-callers
 * Get recent callers for the company
 */
router.get('/recent-callers', auth, async (req, res) => {
    try {
        const { companyId } = req.user;
        const limit = parseInt(req.query.limit) || 10;
        
        const recentContacts = await Contact.find({ companyId })
            .sort({ lastContactDate: -1 })
            .limit(limit)
            .select('firstName lastName fullName primaryPhone status totalCalls lastContactDate customerType');
        
        const callers = recentContacts.map(contact => ({
            id: contact._id,
            name: contact.fullName || `${contact.firstName || ''} ${contact.lastName || ''}`.trim() || 'Unknown',
            phone: contact.primaryPhone,
            status: contact.status,
            customerType: contact.customerType,
            totalCalls: contact.totalCalls || 0,
            lastContact: contact.lastContactDate
        }));
        
        res.json({ callers });
        
    } catch (error) {
        console.error('Recent callers error:', error);
        res.status(500).json({ error: 'Failed to fetch recent callers' });
    }
});

module.exports = router;
