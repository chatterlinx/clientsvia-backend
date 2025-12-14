/**
 * ============================================================================
 * SESSION SERVICE - Conversation Session Management
 * ============================================================================
 * 
 * Manages the lifecycle of conversation sessions across all channels.
 * Every interaction (call, SMS, chat) creates a session that tracks:
 * - Who the customer is
 * - What channel they used
 * - Full transcript
 * - Running summary
 * - Outcome
 * 
 * This is the data that appears in the Call Center.
 * 
 * MULTI-TENANT: All operations require companyId for isolation.
 * 
 * ============================================================================
 */

const ConversationSession = require('../models/ConversationSession');
const CustomerService = require('./CustomerService');
const RunningSummaryService = require('./RunningSummaryService');
const logger = require('../utils/logger');

class SessionService {
    
    // Session timeout in milliseconds (30 minutes for SMS/chat, n/a for voice)
    static SMS_SESSION_TIMEOUT = 30 * 60 * 1000;
    static WEBSITE_SESSION_TIMEOUT = 15 * 60 * 1000;
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SESSION CREATION
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Create a new conversation session
     * Called at the START of each interaction
     * 
     * @param {Object} params
     * @param {string} params.companyId - Company ID
     * @param {string} params.channel - 'voice', 'sms', 'website'
     * @param {Object} params.identifiers - Channel-specific identifiers
     * @param {Object} params.customer - Customer document (optional, will lookup if not provided)
     * @returns {ConversationSession}
     */
    static async create({
        companyId,
        channel,
        identifiers = {},
        customer = null
    }) {
        logger.info('[SESSION SERVICE] Creating new session', { companyId, channel });
        
        // Look up or create customer
        let customerId = null;
        let customerContext = null;
        
        if (customer) {
            customerId = customer._id;
            customerContext = CustomerService.buildContextForAI(customer);
        } else {
            // Try to find customer by phone
            const phone = identifiers.callerPhone || identifiers.smsPhone;
            if (phone) {
                const { customer: foundCustomer, isNew } = await CustomerService.findOrCreate(
                    companyId,
                    { phone },
                    channel
                );
                customerId = foundCustomer._id;
                customerContext = CustomerService.buildContextForAI(foundCustomer);
                
                logger.info('[SESSION SERVICE] Customer lookup result', {
                    customerId,
                    isNew,
                    name: foundCustomer.getDisplayName()
                });
            }
        }
        
        // Build channel identifiers
        const channelIdentifiers = {};
        
        if (channel === 'voice') {
            channelIdentifiers.twilioCallSid = identifiers.callSid;
            channelIdentifiers.callerPhone = identifiers.callerPhone;
            channelIdentifiers.calledNumber = identifiers.calledNumber;
        } else if (channel === 'sms') {
            channelIdentifiers.smsPhone = identifiers.smsPhone;
            channelIdentifiers.smsThreadId = identifiers.smsThreadId || `sms-${identifiers.smsPhone}-${Date.now()}`;
        } else if (channel === 'website') {
            channelIdentifiers.websiteSessionId = identifiers.sessionId;
            channelIdentifiers.visitorIp = identifiers.ip;
            channelIdentifiers.userAgent = identifiers.userAgent;
            channelIdentifiers.pageUrl = identifiers.pageUrl;
        }
        
        const session = new ConversationSession({
            companyId,
            customerId,
            channel,
            channelIdentifiers,
            status: 'active',
            phase: 'greeting',
            startedAt: new Date(),
            lastActivityAt: new Date(),
            runningSummary: customerContext ? [customerContext.summary] : [],
            signals: {
                isCallback: customerContext?.hasRecentVisit || false,
                isVIP: customerContext?.isVIP || false
            }
        });
        
        await session.save();
        
        logger.info('[SESSION SERVICE] ✅ Session created', {
            sessionId: session._id,
            channel,
            customerId,
            hasCustomerContext: !!customerContext
        });
        
        return session;
    }
    
    /**
     * Get or create session for SMS/Website (which can be ongoing)
     * Voice calls always create new sessions
     * 
     * @param {Object} params
     */
    static async getOrCreate({
        companyId,
        channel,
        identifiers = {},
        customer = null
    }) {
        // Voice calls always create new sessions
        if (channel === 'voice') {
            return this.create({ companyId, channel, identifiers, customer });
        }
        
        // For SMS/Website, look for active session
        const phone = identifiers.smsPhone;
        const sessionId = identifiers.sessionId;
        
        if (channel === 'sms' && phone) {
            // Find active SMS session with this phone
            const cutoff = new Date(Date.now() - this.SMS_SESSION_TIMEOUT);
            const existing = await ConversationSession.findOne({
                companyId,
                channel: 'sms',
                'channelIdentifiers.smsPhone': phone,
                status: 'active',
                lastActivityAt: { $gte: cutoff }
            });
            
            if (existing) {
                logger.debug('[SESSION SERVICE] Found existing SMS session', { sessionId: existing._id });
                return existing;
            }
        }
        
        if (channel === 'website' && sessionId) {
            // Find active website session
            const cutoff = new Date(Date.now() - this.WEBSITE_SESSION_TIMEOUT);
            
            // Try to find by MongoDB _id first (frontend sends back session._id)
            const mongoose = require('mongoose');
            if (mongoose.Types.ObjectId.isValid(sessionId)) {
                const byId = await ConversationSession.findOne({
                    _id: sessionId,
                    companyId,
                    channel: 'website',
                    status: 'active',
                    lastActivityAt: { $gte: cutoff }
                });
                
                if (byId) {
                    logger.debug('[SESSION SERVICE] Found existing website session by _id', { 
                        sessionId: byId._id,
                        collectedSlots: byId.collectedSlots,
                        turns: byId.turns?.length
                    });
                    return byId;
                }
            }
            
            // Fallback: look for channelIdentifiers.websiteSessionId (original sessionId)
            const existing = await ConversationSession.findOne({
                companyId,
                channel: 'website',
                'channelIdentifiers.websiteSessionId': sessionId,
                status: 'active',
                lastActivityAt: { $gte: cutoff }
            });
            
            if (existing) {
                logger.debug('[SESSION SERVICE] Found existing website session by websiteSessionId', { 
                    sessionId: existing._id,
                    collectedSlots: existing.collectedSlots
                });
                return existing;
            }
        }
        
        // No active session found, create new
        return this.create({ companyId, channel, identifiers, customer });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // TURN MANAGEMENT
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Add a turn to the session and update running summary
     * Called AFTER each AI response
     * 
     * @param {Object} params
     */
    static async addTurn({
        session,
        userMessage,
        aiResponse,
        metadata = {},
        company = null
    }) {
        if (!session) {
            logger.error('[SESSION SERVICE] addTurn called without session');
            return null;
        }
        
        // Add user message
        session.addTurn('user', userMessage, {
            slotsExtracted: metadata.slotsExtracted
        });
        
        // Add AI response
        session.addTurn('assistant', aiResponse, {
            latencyMs: metadata.latencyMs,
            tokensUsed: metadata.tokensUsed,
            responseSource: metadata.responseSource,
            confidence: metadata.confidence
        });
        
        // ══════════════════════════════════════════════════════════════════════
        // CRITICAL: Update collected slots from AI extraction
        // ══════════════════════════════════════════════════════════════════════
        if (metadata.slotsExtracted && Object.keys(metadata.slotsExtracted).length > 0) {
            session.collectedSlots = { 
                ...session.collectedSlots, 
                ...metadata.slotsExtracted 
            };
            logger.info('[SESSION SERVICE] Slots updated:', metadata.slotsExtracted);
        }
        
        // Update running summary
        const customerContext = session.customerId 
            ? CustomerService.buildContextForAI(await require('../models/Customer').findById(session.customerId))
            : {};
            
        const { bullets } = RunningSummaryService.buildAndFormat({
            previousSummary: session.runningSummary || [],
            customerContext,
            currentTurn: { userMessage, aiResponse, extractedSlots: metadata.slotsExtracted },
            conversationState: {
                phase: session.phase,
                knownSlots: session.collectedSlots,
                signals: session.signals
            },
            company
        });
        
        session.updateSummary(bullets);
        
        // Detect signals from conversation
        const isCallback = RunningSummaryService.detectCallback(customerContext, { userMessage });
        if (isCallback) {
            session.signals.isCallback = true;
        }
        
        await session.save();
        
        logger.debug('[SESSION SERVICE] Turn added', {
            sessionId: session._id,
            turns: session.metrics.totalTurns,
            summary: bullets.length
        });
        
        return session;
    }
    
    /**
     * Update session phase
     */
    static async updatePhase(session, phase) {
        if (!session) return null;
        
        session.phase = phase;
        session.lastActivityAt = new Date();
        await session.save();
        
        logger.debug('[SESSION SERVICE] Phase updated', { sessionId: session._id, phase });
        return session;
    }
    
    /**
     * Update collected slots
     */
    static async updateSlots(session, newSlots) {
        if (!session) return null;
        
        session.collectedSlots = { ...session.collectedSlots, ...newSlots };
        session.lastActivityAt = new Date();
        await session.save();
        
        return session;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SESSION END
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * End a session with outcome
     * 
     * @param {ConversationSession} session
     * @param {string} outcome - 'booked', 'answered', 'transferred', etc.
     * @param {Object} options - { appointmentId, transferredTo }
     */
    static async end(session, outcome, options = {}) {
        if (!session) return null;
        
        session.end(outcome, options.appointmentId);
        
        if (options.transferredTo) {
            session.transferredTo = options.transferredTo;
        }
        
        await session.save();
        
        // Update customer with extracted info
        if (session.customerId && session.collectedSlots) {
            await CustomerService.updateFromConversation(
                await require('../models/Customer').findById(session.customerId),
                session.collectedSlots,
                session._id
            );
        }
        
        logger.info('[SESSION SERVICE] Session ended', {
            sessionId: session._id,
            outcome,
            duration: session.metrics.durationSeconds,
            turns: session.metrics.totalTurns
        });
        
        return session;
    }
    
    /**
     * Mark session as abandoned (customer left without resolution)
     */
    static async abandon(session) {
        return this.end(session, 'abandoned');
    }
    
    /**
     * Mark session as transferred
     */
    static async transfer(session, transferTo) {
        return this.end(session, 'transferred', { transferredTo: transferTo });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // LOOKUP METHODS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Find session by ID
     */
    static async findById(sessionId) {
        return ConversationSession.findById(sessionId).populate('customerId');
    }
    
    /**
     * Find session by Twilio Call SID
     */
    static async findByCallSid(callSid) {
        return ConversationSession.findOne({ 'channelIdentifiers.twilioCallSid': callSid });
    }
    
    /**
     * Find active session by phone (for SMS)
     */
    static async findActiveSMSSession(companyId, phone) {
        const cutoff = new Date(Date.now() - this.SMS_SESSION_TIMEOUT);
        return ConversationSession.findOne({
            companyId,
            channel: 'sms',
            'channelIdentifiers.smsPhone': phone,
            status: 'active',
            lastActivityAt: { $gte: cutoff }
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CALL CENTER QUERIES
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Get sessions for Call Center dashboard
     * 
     * @param {string} companyId
     * @param {Object} filters - { channel, outcome, since, limit, skip }
     */
    static async getForCallCenter(companyId, filters = {}) {
        const query = { companyId };
        
        if (filters.channel && filters.channel !== 'all') {
            query.channel = filters.channel;
        }
        
        if (filters.outcome) {
            query.outcome = filters.outcome;
        }
        
        if (filters.since) {
            query.startedAt = { $gte: filters.since };
        }
        
        const { limit = 50, skip = 0 } = filters;
        
        const sessions = await ConversationSession.find(query)
            .sort({ startedAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('customerId', 'name phoneNumbers metrics')
            .lean();
        
        // Add UI helpers
        return sessions.map(s => ({
            ...s,
            channelIcon: this.getChannelIcon(s.channel),
            displayPhone: s.channelIdentifiers?.callerPhone || 
                         s.channelIdentifiers?.smsPhone || 
                         'Website Visitor',
            customerName: s.customerId?.name?.full || 
                         s.customerId?.name?.first || 
                         'Unknown',
            statusBadge: this.getStatusBadge(s.outcome)
        }));
    }
    
    /**
     * Get channel statistics
     */
    static async getStats(companyId, since = null) {
        const match = { companyId: require('mongoose').Types.ObjectId(companyId) };
        if (since) {
            match.startedAt = { $gte: since };
        }
        
        const stats = await ConversationSession.aggregate([
            { $match: match },
            {
                $group: {
                    _id: null,
                    total: { $sum: 1 },
                    voice: { $sum: { $cond: [{ $eq: ['$channel', 'voice'] }, 1, 0] } },
                    sms: { $sum: { $cond: [{ $eq: ['$channel', 'sms'] }, 1, 0] } },
                    website: { $sum: { $cond: [{ $eq: ['$channel', 'website'] }, 1, 0] } },
                    booked: { $sum: { $cond: [{ $eq: ['$outcome', 'booked'] }, 1, 0] } },
                    answered: { $sum: { $cond: [{ $eq: ['$outcome', 'answered'] }, 1, 0] } },
                    transferred: { $sum: { $cond: [{ $eq: ['$outcome', 'transferred'] }, 1, 0] } },
                    avgDuration: { $avg: '$metrics.durationSeconds' }
                }
            }
        ]);
        
        return stats[0] || {
            total: 0,
            voice: 0,
            sms: 0,
            website: 0,
            booked: 0,
            answered: 0,
            transferred: 0,
            avgDuration: 0
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // UI HELPERS
    // ═══════════════════════════════════════════════════════════════════════════
    
    static getChannelIcon(channel) {
        switch (channel) {
            case 'voice': return '📞';
            case 'sms': return '💬';
            case 'website': return '🌐';
            default: return '📱';
        }
    }
    
    static getStatusBadge(outcome) {
        switch (outcome) {
            case 'booked': return { text: 'Booked', color: 'green', bg: '#dcfce7' };
            case 'answered': return { text: 'Answered', color: 'blue', bg: '#dbeafe' };
            case 'transferred': return { text: 'Transferred', color: 'orange', bg: '#ffedd5' };
            case 'callback_requested': return { text: 'Callback', color: 'yellow', bg: '#fef3c7' };
            case 'abandoned': return { text: 'Abandoned', color: 'red', bg: '#fee2e2' };
            case 'error': return { text: 'Error', color: 'red', bg: '#fee2e2' };
            default: return { text: 'No Action', color: 'gray', bg: '#f3f4f6' };
        }
    }
}

module.exports = SessionService;

