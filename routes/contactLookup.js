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

/**
 * POST /api/contact-lookup/live-call-update
 * Update contact during live call with real-time data
 */
router.post('/live-call-update', auth, async (req, res) => {
    try {
        const { phoneNumber, callSid, callData } = req.body;
        const { companyId } = req.user;
        
        if (!phoneNumber || !callSid) {
            return res.status(400).json({ error: 'Phone number and call SID required' });
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
            // Create new contact during live call
            contact = new Contact({
                companyId,
                primaryPhone: phoneNumber,
                fullName: callData.callerName || 'Live Caller',
                status: 'new_lead',
                leadSource: 'live_call',
                customerType: 'residential'
            });
        }
        
        // Update live call data
        if (callData.callerName && !contact.fullName) {
            contact.fullName = callData.callerName;
        }
        
        // Add or update current interaction
        const existingInteractionIndex = contact.interactions.findIndex(
            interaction => interaction.twilioCallSid === callSid
        );
        
        const currentInteraction = {
            type: 'call',
            direction: 'inbound',
            timestamp: new Date(),
            summary: callData.summary || 'Call in progress',
            outcome: callData.outcome || 'in_progress',
            twilioCallSid: callSid,
            duration: callData.duration || 0,
            agentNotes: callData.notes || '',
            metadata: {
                ...callData.metadata,
                isLiveCall: true,
                lastUpdate: new Date()
            }
        };
        
        if (existingInteractionIndex >= 0) {
            // Update existing interaction
            contact.interactions[existingInteractionIndex] = currentInteraction;
        } else {
            // Add new interaction
            contact.interactions.push(currentInteraction);
        }
        
        // Update contact metadata
        contact.lastContactDate = new Date();
        if (callData.extractedData) {
            contact.extractedData = { ...contact.extractedData, ...callData.extractedData };
        }
        
        await contact.save();
        
        res.json({
            success: true,
            contactId: contact._id,
            contactName: contact.fullName,
            isNewContact: existingInteractionIndex < 0,
            message: 'Live call data updated successfully'
        });
        
    } catch (error) {
        console.error('Live call update error:', error);
        res.status(500).json({ error: 'Failed to update live call data' });
    }
});

/**
 * POST /api/contact-lookup/call-completed
 * Finalize contact record when call completes
 */
router.post('/call-completed', auth, async (req, res) => {
    try {
        const { phoneNumber, callSid, finalData } = req.body;
        const { companyId } = req.user;
        
        if (!phoneNumber || !callSid) {
            return res.status(400).json({ error: 'Phone number and call SID required' });
        }
        
        // Clean phone number
        const cleanPhone = phoneNumber.replace(/\D/g, '');
        
        // Find contact
        const contact = await Contact.findOne({
            companyId,
            $or: [
                { primaryPhone: { $regex: cleanPhone, $options: 'i' } },
                { alternatePhone: { $regex: cleanPhone, $options: 'i' } }
            ]
        });
        
        if (!contact) {
            return res.status(404).json({ error: 'Contact not found' });
        }
        
        // Find and finalize the interaction
        const interactionIndex = contact.interactions.findIndex(
            interaction => interaction.twilioCallSid === callSid
        );
        
        if (interactionIndex >= 0) {
            // Update final call data
            contact.interactions[interactionIndex] = {
                ...contact.interactions[interactionIndex],
                duration: finalData.duration || contact.interactions[interactionIndex].duration,
                summary: finalData.summary || contact.interactions[interactionIndex].summary,
                outcome: finalData.outcome || 'completed',
                agentNotes: finalData.notes || contact.interactions[interactionIndex].agentNotes,
                metadata: {
                    ...contact.interactions[interactionIndex].metadata,
                    ...finalData.metadata,
                    isLiveCall: false,
                    completedAt: new Date()
                }
            };
            
            // Update contact totals
            contact.totalCalls = (contact.totalCalls || 0) + 1;
            contact.lastContactDate = new Date();
            
            // Update extracted data
            if (finalData.extractedData) {
                contact.extractedData = { ...contact.extractedData, ...finalData.extractedData };
            }
            
            // Update status if needed
            if (finalData.newStatus) {
                contact.status = finalData.newStatus;
            }
            
            await contact.save();
            
            res.json({
                success: true,
                contactId: contact._id,
                finalCallDuration: contact.interactions[interactionIndex].duration,
                message: 'Call completed and contact updated'
            });
        } else {
            res.status(404).json({ error: 'Call interaction not found' });
        }
        
    } catch (error) {
        console.error('Call completion error:', error);
        res.status(500).json({ error: 'Failed to finalize call data' });
    }
});

module.exports = router;
