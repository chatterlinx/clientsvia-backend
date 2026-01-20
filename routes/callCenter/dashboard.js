/**
 * ============================================================================
 * CALL CENTER DASHBOARD API ROUTES
 * ============================================================================
 * 
 * Provides endpoints for the Call Center Kanban dashboard:
 * - GET /dashboard - Categorized calls for 4-column board
 * - GET /calls - Paginated call list
 * - GET /call/:id - Single call details
 * - PATCH /call/:id/card - Update card data (assign, complete, pin)
 * - GET /customers - Customer directory
 * - GET /vendors - Vendor directory
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const logger = require('../../utils/logger');

// Models
const CallSummary = require('../../models/CallSummary');
const Customer = require('../../models/Customer');
const Vendor = require('../../models/Vendor');
const BlackBoxRecording = require('../../models/BlackBoxRecording');

// Services
const { classifyCaller, buildCardData, CALLER_TYPES } = require('../../services/CallerClassificationService');

// Auth middleware
const { authenticateJWT } = require('../../middleware/auth');

// ============================================================================
// GET /api/call-center/:companyId/dashboard
// ============================================================================
// Returns categorized calls for the 4-column Kanban board

router.get('/:companyId/dashboard', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
        
        // Parallel queries for performance
        const [needsAction, todaysJobs, recentCalls, vendorCalls] = await Promise.all([
            // Column 1: Needs Action (callbacks, urgent, unresolved)
            CallSummary.find({
                companyId: new mongoose.Types.ObjectId(companyId),
                $or: [
                    { 'cardData.status': 'needs_action' },
                    { 'cardData.priority': { $in: ['urgent', 'high'] } },
                    { outcome: 'callback_requested' },
                    { flagged: true }
                ]
            })
                .sort({ createdAt: -1 })
                .limit(20)
                .lean(),
            
            // Column 2: Today's Jobs (scheduled for today)
            CallSummary.find({
                companyId: new mongoose.Types.ObjectId(companyId),
                $or: [
                    { 'cardData.status': 'scheduled' },
                    { outcome: 'booked' },
                    { 'liveProgress.slotsCollected.time': { $exists: true } }
                ],
                createdAt: { $gte: yesterday }
            })
                .sort({ 'liveProgress.slotsCollected.time': 1, createdAt: -1 })
                .limit(20)
                .lean(),
            
            // Column 3: Recent Calls (last 24h, customers)
            CallSummary.find({
                companyId: new mongoose.Types.ObjectId(companyId),
                createdAt: { $gte: yesterday },
                $or: [
                    { callerType: 'customer' },
                    { callerType: { $exists: false } }
                ]
            })
                .sort({ createdAt: -1 })
                .limit(15)
                .lean(),
            
            // Column 4: Vendor Notes
            CallSummary.find({
                companyId: new mongoose.Types.ObjectId(companyId),
                callerType: 'vendor',
                createdAt: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) } // Last 7 days
            })
                .sort({ createdAt: -1 })
                .limit(15)
                .lean()
        ]);
        
        // Enrich cards with missing data
        const enrichCard = (call) => {
            if (!call.cardData) {
                call.cardData = buildCardData(
                    {
                        type: call.callerType || 'customer',
                        subType: call.callerSubType || 'residential',
                        customerName: call.callerName
                    },
                    {
                        summary: call.summary,
                        intent: call.aiExtracted?.intent,
                        urgency: call.aiExtracted?.urgency,
                        outcome: call.outcome
                    }
                );
            }
            return call;
        };
        
        res.json({
            success: true,
            needsAction: needsAction.map(enrichCard),
            today: todaysJobs.map(enrichCard),
            recent: recentCalls.map(enrichCard),
            vendor: vendorCalls.map(enrichCard),
            stats: {
                needsActionCount: needsAction.length,
                todayCount: todaysJobs.length,
                recentCount: recentCalls.length,
                vendorCount: vendorCalls.length,
                generatedAt: new Date()
            }
        });
        
    } catch (error) {
        logger.error('[CALL CENTER] Dashboard load failed', { companyId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to load dashboard', error: error.message });
    }
});

// ============================================================================
// GET /api/call-center/:companyId/calls
// ============================================================================
// Paginated call list with filters

router.get('/:companyId/calls', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const { 
        limit = 50, 
        offset = 0, 
        callerType, 
        status, 
        from, 
        to,
        search 
    } = req.query;
    
    try {
        const query = { companyId: new mongoose.Types.ObjectId(companyId) };
        
        // Filters
        if (callerType) query.callerType = callerType;
        if (status) query['cardData.status'] = status;
        if (from) query.createdAt = { $gte: new Date(from) };
        if (to) query.createdAt = { ...query.createdAt, $lte: new Date(to) };
        if (search) {
            query.$or = [
                { callerName: { $regex: search, $options: 'i' } },
                { from: { $regex: search, $options: 'i' } },
                { summary: { $regex: search, $options: 'i' } },
                { 'cardData.headline': { $regex: search, $options: 'i' } }
            ];
        }
        
        const [calls, total] = await Promise.all([
            CallSummary.find(query)
                .sort({ createdAt: -1 })
                .skip(parseInt(offset))
                .limit(parseInt(limit))
                .lean(),
            CallSummary.countDocuments(query)
        ]);
        
        res.json({
            success: true,
            calls,
            pagination: {
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
                hasMore: parseInt(offset) + calls.length < total
            }
        });
        
    } catch (error) {
        logger.error('[CALL CENTER] Calls list failed', { companyId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to load calls', error: error.message });
    }
});

// ============================================================================
// GET /api/call-center/:companyId/call/:callId
// ============================================================================
// Single call with full details

router.get('/:companyId/call/:callId', authenticateJWT, async (req, res) => {
    const { companyId, callId } = req.params;
    
    try {
        // Try to find by _id first, then by callId field
        let call = await CallSummary.findOne({
            companyId: new mongoose.Types.ObjectId(companyId),
            $or: [
                { _id: mongoose.Types.ObjectId.isValid(callId) ? new mongoose.Types.ObjectId(callId) : null },
                { callId: callId }
            ]
        }).lean();
        
        if (!call) {
            return res.status(404).json({ success: false, message: 'Call not found' });
        }
        
        // Get transcript from Black Box if available
        let transcript = null;
        try {
            const recording = await BlackBoxRecording.findOne({
                companyId: new mongoose.Types.ObjectId(companyId),
                callId: call.callId || call.twilioCallSid
            }).select('transcript').lean();
            
            if (recording?.transcript) {
                transcript = {
                    callerTurns: recording.transcript.callerTurns || [],
                    agentTurns: recording.transcript.agentTurns || []
                };
            }
        } catch (bbErr) {
            logger.debug('[CALL CENTER] Transcript load failed (non-fatal)', { error: bbErr.message });
        }
        
        // Get customer details if linked
        let customer = null;
        if (call.customerId) {
            customer = await Customer.findById(call.customerId)
                .select('name phoneNumbers addresses metrics tags')
                .lean();
        }
        
        // Get vendor details if linked
        let vendor = null;
        if (call.vendorId) {
            vendor = await Vendor.findById(call.vendorId)
                .select('name type phoneNumbers account')
                .lean();
        }
        
        res.json({
            success: true,
            call,
            transcript,
            customer,
            vendor
        });
        
    } catch (error) {
        logger.error('[CALL CENTER] Call detail failed', { companyId, callId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to load call', error: error.message });
    }
});

// ============================================================================
// PATCH /api/call-center/:companyId/call/:callId/card
// ============================================================================
// Update card data (status, assign, pin, etc.)

router.patch('/:companyId/call/:callId/card', authenticateJWT, async (req, res) => {
    const { companyId, callId } = req.params;
    const updates = req.body;
    
    try {
        const allowedFields = [
            'cardData.status',
            'cardData.priority',
            'cardData.pinned',
            'cardData.assignedTo',
            'cardData.assignedToName',
            'cardData.assignedAt',
            'cardData.dueAt',
            'cardData.tags',
            'cardData.headline',
            'cardData.brief',
            'agentNote'
        ];
        
        const updateObj = {};
        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key) || allowedFields.includes(`cardData.${key}`)) {
                const fullKey = key.startsWith('cardData.') ? key : `cardData.${key}`;
                updateObj[fullKey] = value;
            }
        }
        
        // Handle special actions
        if (updates.action === 'complete') {
            updateObj['cardData.status'] = 'completed';
            updateObj['cardData.completedAt'] = new Date();
        } else if (updates.action === 'archive') {
            updateObj['cardData.status'] = 'archived';
        } else if (updates.action === 'assign') {
            updateObj['cardData.assignedTo'] = updates.assignedTo;
            updateObj['cardData.assignedToName'] = updates.assignedToName;
            updateObj['cardData.assignedAt'] = new Date();
        } else if (updates.action === 'pin') {
            updateObj['cardData.pinned'] = true;
        } else if (updates.action === 'unpin') {
            updateObj['cardData.pinned'] = false;
        }
        
        const call = await CallSummary.findOneAndUpdate(
            {
                companyId: new mongoose.Types.ObjectId(companyId),
                $or: [
                    { _id: mongoose.Types.ObjectId.isValid(callId) ? new mongoose.Types.ObjectId(callId) : null },
                    { callId: callId }
                ]
            },
            { $set: updateObj },
            { new: true }
        ).lean();
        
        if (!call) {
            return res.status(404).json({ success: false, message: 'Call not found' });
        }
        
        logger.info('[CALL CENTER] Card updated', { companyId, callId, updates: Object.keys(updateObj) });
        
        res.json({ success: true, call });
        
    } catch (error) {
        logger.error('[CALL CENTER] Card update failed', { companyId, callId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to update card', error: error.message });
    }
});

// ============================================================================
// GET /api/call-center/:companyId/customers
// ============================================================================
// Customer directory with categorization

router.get('/:companyId/customers', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const { type, search, limit = 100 } = req.query;
    
    try {
        const query = { companyId: new mongoose.Types.ObjectId(companyId) };
        
        if (search) {
            query.$or = [
                { 'name.full': { $regex: search, $options: 'i' } },
                { 'name.first': { $regex: search, $options: 'i' } },
                { 'name.last': { $regex: search, $options: 'i' } },
                { 'phoneNumbers.number': { $regex: search, $options: 'i' } }
            ];
        }
        
        const customers = await Customer.find(query)
            .sort({ 'metrics.lastInteractionAt': -1 })
            .limit(parseInt(limit))
            .lean();
        
        // Categorize customers
        const residential = [];
        const commercial = [];
        const vip = [];
        
        for (const customer of customers) {
            // Check if VIP
            if (customer.tags?.includes('vip') || customer.status === 'vip') {
                vip.push(customer);
            }
            // Check if commercial
            else if (
                customer.tags?.some(t => ['commercial', 'business'].includes(t?.toLowerCase())) ||
                customer.addresses?.some(a => a.notes?.toLowerCase().includes('business'))
            ) {
                commercial.push(customer);
            }
            // Default to residential
            else {
                residential.push(customer);
            }
        }
        
        res.json({
            success: true,
            residential: residential.slice(0, 50),
            commercial: commercial.slice(0, 50),
            vip: vip.slice(0, 50),
            counts: {
                residential: residential.length,
                commercial: commercial.length,
                vip: vip.length,
                total: customers.length
            }
        });
        
    } catch (error) {
        logger.error('[CALL CENTER] Customers load failed', { companyId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to load customers', error: error.message });
    }
});

// ============================================================================
// GET /api/call-center/:companyId/vendors
// ============================================================================
// Vendor directory

router.get('/:companyId/vendors', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const { type, search, limit = 100 } = req.query;
    
    try {
        const query = { 
            companyId: new mongoose.Types.ObjectId(companyId),
            status: 'active'
        };
        
        if (type) query.type = type;
        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { aliases: { $regex: search, $options: 'i' } }
            ];
        }
        
        const vendors = await Vendor.find(query)
            .sort({ 'metrics.lastCallAt': -1, name: 1 })
            .limit(parseInt(limit))
            .lean();
        
        // Categorize vendors
        const supplyHouses = vendors.filter(v => v.type === 'supply_house');
        const delivery = vendors.filter(v => v.type === 'delivery');
        const other = vendors.filter(v => !['supply_house', 'delivery'].includes(v.type));
        
        res.json({
            success: true,
            supplyHouses,
            delivery,
            other,
            counts: {
                supplyHouses: supplyHouses.length,
                delivery: delivery.length,
                other: other.length,
                total: vendors.length
            }
        });
        
    } catch (error) {
        logger.error('[CALL CENTER] Vendors load failed', { companyId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to load vendors', error: error.message });
    }
});

// ============================================================================
// POST /api/call-center/:companyId/vendors
// ============================================================================
// Create new vendor

router.post('/:companyId/vendors', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const { name, type, phoneNumbers, aliases, aiInstructions } = req.body;
    
    try {
        if (!name) {
            return res.status(400).json({ success: false, message: 'Vendor name is required' });
        }
        
        const vendor = await Vendor.create({
            companyId: new mongoose.Types.ObjectId(companyId),
            name,
            type: type || 'other',
            phoneNumbers: phoneNumbers || [],
            aliases: aliases || [],
            aiInstructions: aiInstructions || {}
        });
        
        logger.info('[CALL CENTER] Vendor created', { companyId, vendorId: vendor._id, name });
        
        res.status(201).json({ success: true, vendor });
        
    } catch (error) {
        logger.error('[CALL CENTER] Vendor create failed', { companyId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to create vendor', error: error.message });
    }
});

// ============================================================================
// PATCH /api/call-center/:companyId/customer/:customerId
// ============================================================================
// Update customer profile (move to commercial, edit, mark spam)

router.patch('/:companyId/customer/:customerId', authenticateJWT, async (req, res) => {
    const { companyId, customerId } = req.params;
    const updates = req.body;
    
    try {
        const allowedFields = [
            'name.first', 'name.last', 'name.full', 'name.nickname',
            'status', 'tags', 'preferences.preferredTechnicianName',
            'preferences.preferredTimeWindow', 'preferences.specialInstructions'
        ];
        
        const updateObj = {};
        
        // Handle category transfer (residential ↔ commercial)
        if (updates.category) {
            if (updates.category === 'commercial') {
                updateObj.$addToSet = { tags: 'commercial' };
                updateObj.$pull = { tags: 'residential' };
            } else if (updates.category === 'residential') {
                updateObj.$addToSet = { tags: 'residential' };
                updateObj.$pull = { tags: 'commercial' };
            } else if (updates.category === 'vip') {
                updateObj.$addToSet = { tags: 'vip' };
            }
        }
        
        // Handle spam marking
        if (updates.markAsSpam === true) {
            updateObj.$set = updateObj.$set || {};
            updateObj.$set.status = 'blocked';
            updateObj.$addToSet = updateObj.$addToSet || {};
            updateObj.$addToSet.tags = 'spam';
            
            // Also add to company blacklist
            try {
                const Company = require('../../models/v2Company');
                const phone = await Customer.findById(customerId).select('phoneNumbers').lean();
                if (phone?.phoneNumbers?.[0]?.number) {
                    await Company.updateOne(
                        { _id: new mongoose.Types.ObjectId(companyId) },
                        { $addToSet: { 'callFilteringConfig.blacklist': phone.phoneNumbers[0].number } }
                    );
                }
            } catch (blacklistErr) {
                logger.warn('[CALL CENTER] Failed to add to blacklist (non-fatal)', { error: blacklistErr.message });
            }
        }
        
        // Handle unmark spam
        if (updates.markAsSpam === false) {
            updateObj.$set = updateObj.$set || {};
            updateObj.$set.status = 'active';
            updateObj.$pull = updateObj.$pull || {};
            updateObj.$pull.tags = 'spam';
        }
        
        // Handle regular field updates
        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                updateObj.$set = updateObj.$set || {};
                updateObj.$set[key] = value;
            }
        }
        
        if (Object.keys(updateObj).length === 0) {
            return res.status(400).json({ success: false, message: 'No valid updates provided' });
        }
        
        const customer = await Customer.findOneAndUpdate(
            { _id: new mongoose.Types.ObjectId(customerId), companyId: new mongoose.Types.ObjectId(companyId) },
            updateObj,
            { new: true }
        ).lean();
        
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }
        
        logger.info('[CALL CENTER] Customer updated', { 
            companyId, 
            customerId, 
            updates: Object.keys(updates),
            newCategory: updates.category || null,
            markedSpam: updates.markAsSpam || null
        });
        
        res.json({ success: true, customer });
        
    } catch (error) {
        logger.error('[CALL CENTER] Customer update failed', { companyId, customerId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to update customer', error: error.message });
    }
});

// ============================================================================
// DELETE /api/call-center/:companyId/customer/:customerId
// ============================================================================
// Delete customer (soft delete - marks as inactive)

router.delete('/:companyId/customer/:customerId', authenticateJWT, async (req, res) => {
    const { companyId, customerId } = req.params;
    const { permanent } = req.query;
    
    try {
        if (permanent === 'true') {
            // Hard delete (admin only, use with caution)
            await Customer.deleteOne({
                _id: new mongoose.Types.ObjectId(customerId),
                companyId: new mongoose.Types.ObjectId(companyId)
            });
            
            logger.warn('[CALL CENTER] Customer PERMANENTLY deleted', { companyId, customerId });
            
            res.json({ success: true, message: 'Customer permanently deleted' });
        } else {
            // Soft delete (recommended)
            const customer = await Customer.findOneAndUpdate(
                { _id: new mongoose.Types.ObjectId(customerId), companyId: new mongoose.Types.ObjectId(companyId) },
                { 
                    $set: { 
                        status: 'inactive',
                        deletedAt: new Date()
                    },
                    $addToSet: { tags: 'deleted' }
                },
                { new: true }
            ).lean();
            
            if (!customer) {
                return res.status(404).json({ success: false, message: 'Customer not found' });
            }
            
            logger.info('[CALL CENTER] Customer soft deleted', { companyId, customerId });
            
            res.json({ success: true, message: 'Customer marked as inactive', customer });
        }
        
    } catch (error) {
        logger.error('[CALL CENTER] Customer delete failed', { companyId, customerId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to delete customer', error: error.message });
    }
});

// ============================================================================
// POST /api/call-center/:companyId/customer/:customerId/convert-to-vendor
// ============================================================================
// Convert a customer to a vendor (e.g., they're actually a supply house)

router.post('/:companyId/customer/:customerId/convert-to-vendor', authenticateJWT, async (req, res) => {
    const { companyId, customerId } = req.params;
    const { vendorType = 'other', keepCustomerRecord = false } = req.body;
    
    try {
        // Get customer data
        const customer = await Customer.findOne({
            _id: new mongoose.Types.ObjectId(customerId),
            companyId: new mongoose.Types.ObjectId(companyId)
        }).lean();
        
        if (!customer) {
            return res.status(404).json({ success: false, message: 'Customer not found' });
        }
        
        // Create vendor from customer data
        const vendor = await Vendor.create({
            companyId: new mongoose.Types.ObjectId(companyId),
            name: customer.name?.full || customer.name?.first || 'Converted Vendor',
            type: vendorType,
            phoneNumbers: customer.phoneNumbers || [],
            email: customer.emails?.[0]?.address || null,
            address: customer.addresses?.[0] ? {
                street: customer.addresses[0].street,
                city: customer.addresses[0].city,
                state: customer.addresses[0].state,
                zip: customer.addresses[0].zip
            } : null,
            notes: `Converted from customer record on ${new Date().toISOString()}`,
            aliases: [
                customer.name?.first?.toLowerCase(),
                customer.name?.full?.toLowerCase()
            ].filter(Boolean)
        });
        
        // Update related call summaries to point to vendor
        await CallSummary.updateMany(
            { companyId: new mongoose.Types.ObjectId(companyId), customerId: new mongoose.Types.ObjectId(customerId) },
            { 
                $set: { 
                    callerType: 'vendor',
                    callerSubType: vendorType,
                    vendorId: vendor._id
                },
                $unset: { customerId: 1 }
            }
        );
        
        // Handle original customer record
        if (!keepCustomerRecord) {
            await Customer.findByIdAndUpdate(customerId, {
                $set: { 
                    status: 'inactive',
                    convertedToVendorId: vendor._id,
                    convertedAt: new Date()
                },
                $addToSet: { tags: 'converted-to-vendor' }
            });
        }
        
        logger.info('[CALL CENTER] Customer converted to vendor', { 
            companyId, 
            customerId, 
            vendorId: vendor._id,
            vendorType
        });
        
        res.json({ 
            success: true, 
            message: 'Customer converted to vendor',
            vendor,
            originalCustomerId: customerId
        });
        
    } catch (error) {
        logger.error('[CALL CENTER] Customer to vendor conversion failed', { companyId, customerId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to convert customer', error: error.message });
    }
});

// ============================================================================
// PATCH /api/call-center/:companyId/vendor/:vendorId
// ============================================================================
// Update vendor profile

router.patch('/:companyId/vendor/:vendorId', authenticateJWT, async (req, res) => {
    const { companyId, vendorId } = req.params;
    const updates = req.body;
    
    try {
        const allowedFields = [
            'name', 'type', 'aliases', 'phoneNumbers', 'email', 'website',
            'address', 'contacts', 'account', 'aiInstructions', 'status', 'tags', 'notes'
        ];
        
        const updateObj = { $set: {} };
        
        for (const [key, value] of Object.entries(updates)) {
            if (allowedFields.includes(key)) {
                updateObj.$set[key] = value;
            }
        }
        
        // Handle spam marking
        if (updates.markAsSpam === true) {
            updateObj.$set.status = 'blocked';
            updateObj.$addToSet = { tags: 'spam' };
        }
        
        if (Object.keys(updateObj.$set).length === 0 && !updateObj.$addToSet) {
            return res.status(400).json({ success: false, message: 'No valid updates provided' });
        }
        
        const vendor = await Vendor.findOneAndUpdate(
            { _id: new mongoose.Types.ObjectId(vendorId), companyId: new mongoose.Types.ObjectId(companyId) },
            updateObj,
            { new: true }
        ).lean();
        
        if (!vendor) {
            return res.status(404).json({ success: false, message: 'Vendor not found' });
        }
        
        logger.info('[CALL CENTER] Vendor updated', { companyId, vendorId, updates: Object.keys(updates) });
        
        res.json({ success: true, vendor });
        
    } catch (error) {
        logger.error('[CALL CENTER] Vendor update failed', { companyId, vendorId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to update vendor', error: error.message });
    }
});

// ============================================================================
// DELETE /api/call-center/:companyId/vendor/:vendorId
// ============================================================================
// Delete vendor

router.delete('/:companyId/vendor/:vendorId', authenticateJWT, async (req, res) => {
    const { companyId, vendorId } = req.params;
    const { permanent } = req.query;
    
    try {
        if (permanent === 'true') {
            await Vendor.deleteOne({
                _id: new mongoose.Types.ObjectId(vendorId),
                companyId: new mongoose.Types.ObjectId(companyId)
            });
            
            logger.warn('[CALL CENTER] Vendor PERMANENTLY deleted', { companyId, vendorId });
            
            res.json({ success: true, message: 'Vendor permanently deleted' });
        } else {
            const vendor = await Vendor.findOneAndUpdate(
                { _id: new mongoose.Types.ObjectId(vendorId), companyId: new mongoose.Types.ObjectId(companyId) },
                { $set: { status: 'inactive' } },
                { new: true }
            ).lean();
            
            if (!vendor) {
                return res.status(404).json({ success: false, message: 'Vendor not found' });
            }
            
            logger.info('[CALL CENTER] Vendor soft deleted', { companyId, vendorId });
            
            res.json({ success: true, message: 'Vendor marked as inactive', vendor });
        }
        
    } catch (error) {
        logger.error('[CALL CENTER] Vendor delete failed', { companyId, vendorId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to delete vendor', error: error.message });
    }
});

// ============================================================================
// POST /api/call-center/:companyId/vendor/:vendorId/convert-to-customer
// ============================================================================
// Convert a vendor to a customer (e.g., they're actually a residential customer)

router.post('/:companyId/vendor/:vendorId/convert-to-customer', authenticateJWT, async (req, res) => {
    const { companyId, vendorId } = req.params;
    const { category = 'residential', keepVendorRecord = false } = req.body;
    
    try {
        // Get vendor data
        const vendor = await Vendor.findOne({
            _id: new mongoose.Types.ObjectId(vendorId),
            companyId: new mongoose.Types.ObjectId(companyId)
        }).lean();
        
        if (!vendor) {
            return res.status(404).json({ success: false, message: 'Vendor not found' });
        }
        
        // Create customer from vendor data
        const customer = await Customer.create({
            companyId: new mongoose.Types.ObjectId(companyId),
            name: {
                full: vendor.name,
                first: vendor.name.split(' ')[0],
                last: vendor.name.split(' ').slice(1).join(' ') || null
            },
            phoneNumbers: vendor.phoneNumbers || [],
            emails: vendor.email ? [{ address: vendor.email, isPrimary: true }] : [],
            addresses: vendor.address ? [{
                street: vendor.address.street,
                city: vendor.address.city,
                state: vendor.address.state,
                zip: vendor.address.zip,
                isPrimary: true
            }] : [],
            tags: [category],
            aiNotes: [{
                note: `Converted from vendor record on ${new Date().toISOString()}`,
                source: 'system',
                createdAt: new Date()
            }]
        });
        
        // Update related call summaries
        await CallSummary.updateMany(
            { companyId: new mongoose.Types.ObjectId(companyId), vendorId: new mongoose.Types.ObjectId(vendorId) },
            { 
                $set: { 
                    callerType: 'customer',
                    callerSubType: category,
                    customerId: customer._id
                },
                $unset: { vendorId: 1 }
            }
        );
        
        // Handle original vendor record
        if (!keepVendorRecord) {
            await Vendor.findByIdAndUpdate(vendorId, {
                $set: { 
                    status: 'inactive',
                    convertedToCustomerId: customer._id
                }
            });
        }
        
        logger.info('[CALL CENTER] Vendor converted to customer', { 
            companyId, 
            vendorId, 
            customerId: customer._id,
            category
        });
        
        res.json({ 
            success: true, 
            message: 'Vendor converted to customer',
            customer,
            originalVendorId: vendorId
        });
        
    } catch (error) {
        logger.error('[CALL CENTER] Vendor to customer conversion failed', { companyId, vendorId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to convert vendor', error: error.message });
    }
});

// ============================================================================
// POST /api/call-center/:companyId/call/:callId/reclassify
// ============================================================================
// Reclassify a call (change caller type/subtype)

router.post('/:companyId/call/:callId/reclassify', authenticateJWT, async (req, res) => {
    const { companyId, callId } = req.params;
    const { callerType, callerSubType, customerId, vendorId } = req.body;
    
    try {
        const updateObj = {};
        
        if (callerType) updateObj.callerType = callerType;
        if (callerSubType) updateObj.callerSubType = callerSubType;
        if (customerId) {
            updateObj.customerId = new mongoose.Types.ObjectId(customerId);
            updateObj.vendorId = null;
        }
        if (vendorId) {
            updateObj.vendorId = new mongoose.Types.ObjectId(vendorId);
            updateObj.customerId = null;
        }
        
        // Update card color based on new type
        if (callerType === 'vendor') {
            updateObj['cardData.color'] = callerSubType === 'delivery' ? 'orange' : 'yellow';
        } else if (callerSubType === 'commercial') {
            updateObj['cardData.color'] = 'blue';
        } else {
            updateObj['cardData.color'] = 'green';
        }
        
        const call = await CallSummary.findOneAndUpdate(
            {
                companyId: new mongoose.Types.ObjectId(companyId),
                $or: [
                    { _id: mongoose.Types.ObjectId.isValid(callId) ? new mongoose.Types.ObjectId(callId) : null },
                    { callId: callId }
                ]
            },
            { $set: updateObj },
            { new: true }
        ).lean();
        
        if (!call) {
            return res.status(404).json({ success: false, message: 'Call not found' });
        }
        
        logger.info('[CALL CENTER] Call reclassified', { 
            companyId, 
            callId, 
            newType: callerType,
            newSubType: callerSubType
        });
        
        res.json({ success: true, call });
        
    } catch (error) {
        logger.error('[CALL CENTER] Call reclassify failed', { companyId, callId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to reclassify call', error: error.message });
    }
});

// ============================================================================
// POST /api/call-center/:companyId/vendors/seed
// ============================================================================
// Seed common vendors (UPS, FedEx, Tropic Supply, etc.)

router.post('/:companyId/vendors/seed', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const created = await Vendor.seedCommonVendors(new mongoose.Types.ObjectId(companyId));
        
        logger.info('[CALL CENTER] Vendors seeded', { companyId, count: created.length, vendors: created });
        
        res.json({ 
            success: true, 
            message: `Created ${created.length} vendors`,
            created 
        });
        
    } catch (error) {
        logger.error('[CALL CENTER] Vendor seed failed', { companyId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to seed vendors', error: error.message });
    }
});

// ============================================================================
// GET /api/call-center/:companyId/stats
// ============================================================================
// Dashboard statistics

router.get('/:companyId/stats', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const now = new Date();
        const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const thisWeek = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        
        const companyObjId = new mongoose.Types.ObjectId(companyId);
        
        const [
            todayCalls,
            weekCalls,
            monthCalls,
            needsAction,
            todayBooked,
            vendorCalls,
            customerCount,
            vendorCount
        ] = await Promise.all([
            CallSummary.countDocuments({ companyId: companyObjId, createdAt: { $gte: today } }),
            CallSummary.countDocuments({ companyId: companyObjId, createdAt: { $gte: thisWeek } }),
            CallSummary.countDocuments({ companyId: companyObjId, createdAt: { $gte: thisMonth } }),
            CallSummary.countDocuments({ 
                companyId: companyObjId, 
                $or: [
                    { 'cardData.status': 'needs_action' },
                    { 'cardData.priority': { $in: ['urgent', 'high'] } }
                ]
            }),
            CallSummary.countDocuments({ 
                companyId: companyObjId, 
                createdAt: { $gte: today },
                outcome: 'booked'
            }),
            CallSummary.countDocuments({ 
                companyId: companyObjId, 
                createdAt: { $gte: thisWeek },
                callerType: 'vendor'
            }),
            Customer.countDocuments({ companyId: companyObjId }),
            Vendor.countDocuments({ companyId: companyObjId, status: 'active' })
        ]);
        
        res.json({
            success: true,
            stats: {
                calls: {
                    today: todayCalls,
                    thisWeek: weekCalls,
                    thisMonth: monthCalls
                },
                bookings: {
                    today: todayBooked
                },
                actionItems: {
                    needsAction,
                    vendorMessages: vendorCalls
                },
                directory: {
                    customers: customerCount,
                    vendors: vendorCount
                }
            },
            generatedAt: new Date()
        });
        
    } catch (error) {
        logger.error('[CALL CENTER] Stats load failed', { companyId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to load stats', error: error.message });
    }
});

// ============================================================================
// PENDING REVIEW ENDPOINTS
// ============================================================================

// GET /api/call-center/:companyId/pending-review
// Returns items needing human review (unknown callers, duplicates, unclassified)

router.get('/:companyId/pending-review', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    const { type, limit = 100 } = req.query;
    
    try {
        const companyObjId = new mongoose.Types.ObjectId(companyId);
        const items = [];
        
        // Build filter based on type
        let callFilter = { companyId: companyObjId, needsReview: { $ne: false } };
        let customerFilter = { companyId: companyObjId, needsReview: { $ne: false } };
        let vendorFilter = { companyId: companyObjId, needsReview: { $ne: false } };
        
        if (type === 'unknown') {
            callFilter.$or = [
                { callerName: { $in: [null, '', 'Unknown', 'Unknown Caller'] } },
                { callerType: { $in: [null, '', 'unknown'] } }
            ];
        } else if (type === 'unclassified') {
            callFilter.callerType = { $in: [null, '', 'unknown'] };
        } else if (type === 'duplicate') {
            callFilter['cardData.possibleDuplicate'] = true;
        } else if (type === 'low_confidence') {
            callFilter['aiExtracted.confidence'] = { $lt: 0.7 };
        }
        
        // Get calls needing review
        const calls = await CallSummary.find({
            ...callFilter,
            $or: [
                { needsReview: true },
                { callerType: { $in: [null, '', 'unknown'] } },
                { callerName: { $in: [null, '', 'Unknown', 'Unknown Caller'] } },
                { 'cardData.status': 'needs_review' }
            ]
        })
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .lean();
        
        // Add type and review reason
        for (const call of calls) {
            let reviewReason = 'Needs classification';
            
            if (!call.callerName || call.callerName === 'Unknown' || call.callerName === 'Unknown Caller') {
                reviewReason = 'Unknown caller name';
            } else if (!call.callerType || call.callerType === 'unknown') {
                reviewReason = 'Unclassified caller type';
            } else if (call.cardData?.possibleDuplicate) {
                reviewReason = 'Possible duplicate';
            } else if (call.aiExtracted?.confidence && call.aiExtracted.confidence < 0.7) {
                reviewReason = 'Low confidence classification';
            }
            
            items.push({
                ...call,
                type: 'call',
                reviewReason,
                name: call.callerName || 'Unknown',
                phone: call.phone || call.liveProgress?.slotsCollected?.phone
            });
        }
        
        // Get customers needing review (placeholder status, no name)
        const customers = await Customer.find({
            companyId: companyObjId,
            $or: [
                { status: 'placeholder' },
                { 'name.full': { $in: [null, '', 'Unknown'] } },
                { 'name.first': { $in: [null, ''] } },
                { needsReview: true }
            ]
        })
            .sort({ createdAt: -1 })
            .limit(20)
            .lean();
        
        for (const customer of customers) {
            items.push({
                ...customer,
                type: 'customer',
                reviewReason: customer.status === 'placeholder' ? 'Placeholder record' : 'Incomplete profile',
                name: customer.name?.full || customer.name?.first || 'Unknown',
                phone: customer.phoneNumbers?.[0]?.number
            });
        }
        
        // Find possible duplicate matches for items
        for (const item of items) {
            if (item.phone) {
                const possibleMatches = await Customer.find({
                    companyId: companyObjId,
                    _id: { $ne: item._id },
                    'phoneNumbers.number': item.phone,
                    status: { $ne: 'placeholder' }
                })
                    .limit(3)
                    .lean();
                
                if (possibleMatches.length > 0) {
                    item.possibleMatches = possibleMatches.map(m => ({
                        _id: m._id,
                        name: m.name?.full || m.name?.first,
                        phone: m.phoneNumbers?.[0]?.number
                    }));
                    if (!item.reviewReason.includes('duplicate')) {
                        item.reviewReason = 'Possible duplicate';
                    }
                }
            }
        }
        
        // Sort by priority (duplicates first, then unknown, then others)
        items.sort((a, b) => {
            const priorityOrder = { 'Possible duplicate': 0, 'Unknown caller name': 1, 'Unclassified caller type': 2 };
            return (priorityOrder[a.reviewReason] ?? 3) - (priorityOrder[b.reviewReason] ?? 3);
        });
        
        logger.info('[CALL CENTER] Pending review loaded', { 
            companyId, 
            totalItems: items.length,
            calls: calls.length,
            customers: customers.length
        });
        
        res.json({
            success: true,
            data: items.slice(0, parseInt(limit)),
            total: items.length
        });
        
    } catch (error) {
        logger.error('[CALL CENTER] Pending review load failed', { companyId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to load pending reviews', error: error.message });
    }
});

// GET /api/call-center/:companyId/pending-review/count
// Returns just the count (lightweight for badge updates)

router.get('/:companyId/pending-review/count', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const companyObjId = new mongoose.Types.ObjectId(companyId);
        
        const [callCount, customerCount] = await Promise.all([
            CallSummary.countDocuments({
                companyId: companyObjId,
                needsReview: { $ne: false },
                $or: [
                    { needsReview: true },
                    { callerType: { $in: [null, '', 'unknown'] } },
                    { callerName: { $in: [null, '', 'Unknown', 'Unknown Caller'] } },
                    { 'cardData.status': 'needs_review' }
                ]
            }),
            Customer.countDocuments({
                companyId: companyObjId,
                $or: [
                    { status: 'placeholder' },
                    { 'name.full': { $in: [null, '', 'Unknown'] } },
                    { needsReview: true }
                ]
            })
        ]);
        
        res.json({
            success: true,
            count: callCount + customerCount,
            breakdown: { calls: callCount, customers: customerCount }
        });
        
    } catch (error) {
        logger.error('[CALL CENTER] Pending count failed', { companyId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to get pending count', error: error.message });
    }
});

// POST /api/call-center/:companyId/pending-review/mark-all-reviewed
// Mark all pending items as reviewed

router.post('/:companyId/pending-review/mark-all-reviewed', authenticateJWT, async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const companyObjId = new mongoose.Types.ObjectId(companyId);
        const reviewedAt = new Date();
        const reviewedBy = req.user?._id || req.user?.id;
        
        const [callsUpdated, customersUpdated] = await Promise.all([
            CallSummary.updateMany(
                {
                    companyId: companyObjId,
                    $or: [
                        { needsReview: true },
                        { callerType: { $in: [null, '', 'unknown'] } },
                        { callerName: { $in: [null, '', 'Unknown', 'Unknown Caller'] } }
                    ]
                },
                {
                    $set: {
                        needsReview: false,
                        reviewedAt,
                        reviewedBy
                    }
                }
            ),
            Customer.updateMany(
                {
                    companyId: companyObjId,
                    $or: [
                        { status: 'placeholder' },
                        { needsReview: true }
                    ]
                },
                {
                    $set: {
                        needsReview: false,
                        reviewedAt,
                        reviewedBy
                    }
                }
            )
        ]);
        
        logger.info('[CALL CENTER] All items marked as reviewed', { 
            companyId, 
            callsUpdated: callsUpdated.modifiedCount,
            customersUpdated: customersUpdated.modifiedCount
        });
        
        res.json({
            success: true,
            message: 'All items marked as reviewed',
            updated: {
                calls: callsUpdated.modifiedCount,
                customers: customersUpdated.modifiedCount
            }
        });
        
    } catch (error) {
        logger.error('[CALL CENTER] Mark all reviewed failed', { companyId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to mark all reviewed', error: error.message });
    }
});

// POST /api/call-center/:companyId/customer/:customerId/merge
// Merge one customer record into another

router.post('/:companyId/customer/:customerId/merge', authenticateJWT, async (req, res) => {
    const { companyId, customerId } = req.params;
    const { targetId } = req.body;
    
    if (!targetId) {
        return res.status(400).json({ success: false, message: 'targetId is required' });
    }
    
    try {
        const companyObjId = new mongoose.Types.ObjectId(companyId);
        const sourceObjId = new mongoose.Types.ObjectId(customerId);
        const targetObjId = new mongoose.Types.ObjectId(targetId);
        
        // Get both records
        const [source, target] = await Promise.all([
            Customer.findOne({ _id: sourceObjId, companyId: companyObjId }).lean(),
            Customer.findOne({ _id: targetObjId, companyId: companyObjId })
        ]);
        
        if (!source || !target) {
            return res.status(404).json({ success: false, message: 'One or both customers not found' });
        }
        
        // Merge phone numbers (add any new ones)
        if (source.phoneNumbers?.length) {
            for (const phone of source.phoneNumbers) {
                const exists = target.phoneNumbers?.some(p => p.number === phone.number);
                if (!exists) {
                    target.phoneNumbers = target.phoneNumbers || [];
                    target.phoneNumbers.push(phone);
                }
            }
        }
        
        // Merge addresses (add any new ones)
        if (source.addresses?.length) {
            for (const addr of source.addresses) {
                const exists = target.addresses?.some(a => 
                    a.street === addr.street && a.city === addr.city
                );
                if (!exists) {
                    target.addresses = target.addresses || [];
                    target.addresses.push(addr);
                }
            }
        }
        
        // Merge AI notes
        if (source.aiNotes?.length) {
            target.aiNotes = target.aiNotes || [];
            target.aiNotes.push(...source.aiNotes);
        }
        
        // Update all call summaries to point to target
        await CallSummary.updateMany(
            { companyId: companyObjId, customerId: sourceObjId },
            { $set: { customerId: targetObjId } }
        );
        
        // Save merged target
        target.mergedFrom = target.mergedFrom || [];
        target.mergedFrom.push({
            customerId: sourceObjId,
            mergedAt: new Date(),
            mergedBy: req.user?._id || req.user?.id
        });
        await target.save();
        
        // Soft delete source
        await Customer.findByIdAndUpdate(sourceObjId, {
            $set: {
                status: 'merged',
                mergedInto: targetObjId,
                mergedAt: new Date()
            }
        });
        
        logger.info('[CALL CENTER] Customers merged', { 
            companyId, 
            sourceId: customerId, 
            targetId,
            sourceName: source.name?.full,
            targetName: target.name?.full
        });
        
        res.json({
            success: true,
            message: 'Records merged successfully',
            mergedInto: target
        });
        
    } catch (error) {
        logger.error('[CALL CENTER] Customer merge failed', { companyId, customerId, targetId, error: error.message });
        res.status(500).json({ success: false, message: 'Failed to merge customers', error: error.message });
    }
});

module.exports = router;
