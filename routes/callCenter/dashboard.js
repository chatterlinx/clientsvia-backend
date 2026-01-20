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

module.exports = router;
