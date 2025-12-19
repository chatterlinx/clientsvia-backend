/**
 * ============================================================================
 * CUSTOMER SERVICE - Customer Lookup, Creation, and Management
 * ============================================================================
 * 
 * This is the SINGLE ENTRY POINT for all customer operations.
 * All channels (voice, SMS, website) use this service.
 * 
 * CORE FUNCTIONS:
 * - findByPhone(companyId, phoneNumber) - Primary lookup
 * - findByEmail(companyId, email) - Secondary lookup
 * - findBySession(companyId, sessionId) - Temporary session lookup
 * - findOrCreate(companyId, identifier) - Get or create customer
 * - updateFromConversation(customer, extractedData) - Learn from calls
 * 
 * MULTI-TENANT: All operations require companyId for isolation.
 * 
 * ============================================================================
 */

const Customer = require('../models/Customer');
const logger = require('../utils/logger');

class CustomerService {
    
    // ═══════════════════════════════════════════════════════════════════════════
    // LOOKUP METHODS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Find customer by phone number
     * This is the PRIMARY lookup method (used for voice calls and SMS)
     * 
     * @param {string} companyId - Company ID for multi-tenant isolation
     * @param {string} phoneNumber - Phone number (any format, will be normalized)
     * @returns {Customer|null}
     */
    static async findByPhone(companyId, phoneNumber) {
        if (!companyId || !phoneNumber) {
            logger.warn('[CUSTOMER SERVICE] findByPhone called without companyId or phoneNumber');
            return null;
        }
        
        const normalized = Customer.normalizePhone(phoneNumber);
        
        logger.debug('[CUSTOMER SERVICE] Looking up customer by phone', {
            companyId,
            phoneNumber: normalized
        });
        
        const customer = await Customer.findOne({
            companyId,
            'phoneNumbers.number': normalized
        });
        
        if (customer) {
            // Update last used timestamp on the phone number
            const phone = customer.phoneNumbers.find(p => p.number === normalized);
            if (phone) {
                phone.lastUsedAt = new Date();
                await customer.save();
            }
            
            logger.info('[CUSTOMER SERVICE] ✅ Found customer by phone', {
                companyId,
                customerId: customer._id,
                name: customer.getDisplayName(),
                totalInteractions: customer.metrics.totalInteractions
            });
        } else {
            logger.debug('[CUSTOMER SERVICE] No customer found for phone', { companyId, phoneNumber: normalized });
        }
        
        return customer;
    }
    
    /**
     * Find customer by email
     * Used for website chat when email is provided
     * 
     * @param {string} companyId
     * @param {string} email
     * @returns {Customer|null}
     */
    static async findByEmail(companyId, email) {
        if (!companyId || !email) return null;
        
        const normalized = email.toLowerCase().trim();
        
        logger.debug('[CUSTOMER SERVICE] Looking up customer by email', { companyId, email: normalized });
        
        const customer = await Customer.findOne({
            companyId,
            'emails.address': normalized
        });
        
        if (customer) {
            logger.info('[CUSTOMER SERVICE] ✅ Found customer by email', {
                companyId,
                customerId: customer._id,
                name: customer.getDisplayName()
            });
        }
        
        return customer;
    }
    
    /**
     * Find customer by temporary session ID
     * Used for website visitors who haven't provided contact info yet
     * 
     * @param {string} companyId
     * @param {string} sessionId
     * @returns {Customer|null}
     */
    static async findBySession(companyId, sessionId) {
        if (!companyId || !sessionId) return null;
        
        logger.debug('[CUSTOMER SERVICE] Looking up customer by session', { companyId, sessionId });
        
        const customer = await Customer.findOne({
            companyId,
            'temporarySessions.sessionId': sessionId,
            'temporarySessions.expiresAt': { $gt: new Date() }
        });
        
        return customer;
    }
    
    /**
     * Find customer by any identifier (phone, email, or session)
     * Tries all lookup methods in priority order
     * 
     * @param {string} companyId
     * @param {Object} identifiers - { phone, email, sessionId }
     * @returns {Customer|null}
     */
    static async findByAnyIdentifier(companyId, identifiers = {}) {
        const { phone, email, sessionId } = identifiers;
        
        // Priority 1: Phone (most reliable)
        if (phone) {
            const customer = await this.findByPhone(companyId, phone);
            if (customer) return customer;
        }
        
        // Priority 2: Email
        if (email) {
            const customer = await this.findByEmail(companyId, email);
            if (customer) return customer;
        }
        
        // Priority 3: Session (temporary)
        if (sessionId) {
            const customer = await this.findBySession(companyId, sessionId);
            if (customer) return customer;
        }
        
        return null;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CREATE METHODS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Create a new customer
     * 
     * @param {string} companyId
     * @param {Object} data - Initial customer data
     * @param {string} channel - How they first contacted us (voice, sms, website)
     * @returns {Customer}
     */
    static async create(companyId, data = {}, channel = 'voice') {
        logger.info('[CUSTOMER SERVICE] Creating new customer', { companyId, channel, data });
        
        const customerData = {
            companyId,
            firstContactAt: new Date(),
            metrics: {
                totalInteractions: 1,
                lastInteractionAt: new Date(),
                lastInteractionChannel: channel,
                totalCalls: channel === 'voice' ? 1 : 0,
                totalSMS: channel === 'sms' ? 1 : 0,
                totalWebChats: channel === 'website' ? 1 : 0
            }
        };
        
        // Add phone if provided
        if (data.phone) {
            const normalized = Customer.normalizePhone(data.phone);
            customerData.phoneNumbers = [{
                number: normalized,
                label: 'Primary',
                isPrimary: true,
                addedAt: new Date(),
                lastUsedAt: new Date()
            }];
        }
        
        // Add email if provided
        if (data.email) {
            customerData.emails = [{
                address: data.email.toLowerCase().trim(),
                label: 'Primary',
                isPrimary: true,
                addedAt: new Date()
            }];
        }
        
        // Add name if provided
        if (data.name) {
            const nameParts = data.name.trim().split(' ');
            customerData.name = {
                full: data.name.trim(),
                first: nameParts[0],
                last: nameParts.slice(1).join(' ') || null
            };
        }
        
        // Add address if provided
        if (data.address) {
            customerData.addresses = [{
                street: data.address,
                isPrimary: true,
                createdAt: new Date()
            }];
        }
        
        // Add temporary session if no real identifier
        if (data.sessionId && !data.phone && !data.email) {
            customerData.temporarySessions = [{
                sessionId: data.sessionId,
                channel: channel === 'website' ? 'website' : 'app',
                createdAt: new Date(),
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours
            }];
        }
        
        const customer = new Customer(customerData);
        await customer.save();
        
        logger.info('[CUSTOMER SERVICE] ✅ Created new customer', {
            companyId,
            customerId: customer._id,
            channel,
            hasPhone: !!data.phone,
            hasEmail: !!data.email,
            hasName: !!data.name
        });
        
        return customer;
    }
    
    /**
     * Find existing customer or create new one
     * This is the MAIN method used by all channels
     * 
     * @param {string} companyId
     * @param {Object} identifiers - { phone, email, sessionId }
     * @param {string} channel - voice, sms, website
     * @returns {{ customer: Customer, isNew: boolean }}
     */
    static async findOrCreate(companyId, identifiers = {}, channel = 'voice') {
        // ═══════════════════════════════════════════════════════════════════
        // V33 FIX: Don't create customer with no identifiers
        // This prevents duplicate key errors on (companyId, phone: null)
        // ═══════════════════════════════════════════════════════════════════
        const hasValidIdentifier = identifiers.phone || identifiers.email || identifiers.sessionId;
        
        if (!hasValidIdentifier) {
            logger.debug('[CUSTOMER SERVICE] No valid identifier provided, skipping customer creation', {
                companyId,
                channel,
                identifiers
            });
            return { customer: null, isNew: false };
        }
        
        // Try to find existing customer
        let customer = await this.findByAnyIdentifier(companyId, identifiers);
        
        if (customer) {
            // Record this interaction
            try {
                customer.recordInteraction(channel);
                await customer.save();
            } catch (saveErr) {
                logger.warn('[CUSTOMER SERVICE] Failed to update customer interaction (non-fatal)', {
                    error: saveErr.message,
                    customerId: customer._id
                });
            }
            
            return { customer, isNew: false };
        }
        
        // Create new customer (with try-catch for duplicate key errors)
        try {
            customer = await this.create(companyId, identifiers, channel);
            return { customer, isNew: true };
        } catch (createErr) {
            // Handle duplicate key error gracefully
            if (createErr.code === 11000) {
                logger.warn('[CUSTOMER SERVICE] Duplicate key error during customer creation, trying to find existing', {
                    error: createErr.message,
                    companyId,
                    identifiers
                });
                
                // Race condition - customer was created by another request, try to find it
                customer = await this.findByAnyIdentifier(companyId, identifiers);
                if (customer) {
                    return { customer, isNew: false };
                }
            }
            
            // For other errors, log and return null (non-fatal)
            logger.error('[CUSTOMER SERVICE] Failed to create customer (non-fatal)', {
                error: createErr.message,
                companyId,
                identifiers
            });
            return { customer: null, isNew: false };
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // UPDATE METHODS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Update customer from conversation data
     * Called after each conversation to learn more about the customer
     * 
     * @param {Customer} customer
     * @param {Object} extractedData - Data extracted from conversation
     * @param {string} sessionId - ConversationSession ID for tracking
     */
    static async updateFromConversation(customer, extractedData = {}, sessionId = null) {
        if (!customer) return null;
        
        let updated = false;
        
        // Update name if we learned it
        if (extractedData.name && !customer.name.full) {
            const nameParts = extractedData.name.trim().split(' ');
            customer.name = {
                full: extractedData.name.trim(),
                first: nameParts[0],
                last: nameParts.slice(1).join(' ') || null
            };
            updated = true;
            logger.debug('[CUSTOMER SERVICE] Learned customer name', { name: extractedData.name });
        }
        
        // Add phone if we learned it
        if (extractedData.phone) {
            const normalized = Customer.normalizePhone(extractedData.phone);
            const exists = customer.phoneNumbers.find(p => p.number === normalized);
            if (!exists) {
                customer.addPhone(extractedData.phone);
                updated = true;
                logger.debug('[CUSTOMER SERVICE] Learned customer phone', { phone: normalized });
            }
        }
        
        // Add email if we learned it
        if (extractedData.email) {
            const normalized = extractedData.email.toLowerCase().trim();
            const exists = customer.emails.find(e => e.address === normalized);
            if (!exists) {
                customer.emails.push({
                    address: normalized,
                    label: customer.emails.length === 0 ? 'Primary' : 'Other',
                    isPrimary: customer.emails.length === 0,
                    addedAt: new Date()
                });
                updated = true;
                logger.debug('[CUSTOMER SERVICE] Learned customer email', { email: normalized });
            }
        }
        
        // Add address if we learned it
        if (extractedData.address && customer.addresses.length === 0) {
            customer.addresses.push({
                street: extractedData.address,
                city: extractedData.city || null,
                state: extractedData.state || null,
                zip: extractedData.zip || null,
                isPrimary: true,
                createdAt: new Date()
            });
            updated = true;
            logger.debug('[CUSTOMER SERVICE] Learned customer address', { address: extractedData.address });
        }
        
        // Update preferences if mentioned
        if (extractedData.preferredTechnician) {
            customer.preferences.preferredTechnicianName = extractedData.preferredTechnician;
            updated = true;
        }
        
        if (extractedData.preferredTime) {
            customer.preferences.preferredTimeWindow = extractedData.preferredTime;
            updated = true;
        }
        
        // Add AI notes if any insights were extracted
        if (extractedData.aiNotes && extractedData.aiNotes.length > 0) {
            for (const note of extractedData.aiNotes) {
                customer.aiNotes.push({
                    note,
                    source: 'ai_extracted',
                    createdAt: new Date(),
                    sessionId
                });
            }
            updated = true;
        }
        
        if (updated) {
            await customer.save();
            logger.info('[CUSTOMER SERVICE] Updated customer from conversation', {
                customerId: customer._id,
                fields: Object.keys(extractedData)
            });
        }
        
        return customer;
    }
    
    /**
     * Add a service visit to customer history
     * 
     * @param {Customer} customer
     * @param {Object} visitData
     */
    static async addVisit(customer, visitData) {
        if (!customer) return null;
        
        customer.visits.push({
            date: visitData.date || new Date(),
            technicianName: visitData.technicianName,
            technicianId: visitData.technicianId,
            issueDescription: visitData.issue,
            resolution: visitData.resolution,
            notes: visitData.notes,
            appointmentId: visitData.appointmentId,
            wasCallback: visitData.wasCallback || false,
            invoiceAmount: visitData.invoiceAmount
        });
        
        customer.metrics.totalBookings = (customer.metrics.totalBookings || 0) + 1;
        
        await customer.save();
        
        logger.info('[CUSTOMER SERVICE] Added visit to customer', {
            customerId: customer._id,
            technicianName: visitData.technicianName
        });
        
        return customer;
    }
    
    /**
     * Merge a temporary session customer with a real identifier
     * Used when website visitor provides their phone/email
     * 
     * @param {string} companyId
     * @param {string} sessionId
     * @param {Object} realIdentifiers - { phone, email }
     */
    static async mergeSessionWithIdentifier(companyId, sessionId, realIdentifiers) {
        const { phone, email } = realIdentifiers;
        
        if (!phone && !email) {
            logger.warn('[CUSTOMER SERVICE] Cannot merge session without real identifier');
            return null;
        }
        
        // Find the session customer
        const sessionCustomer = await this.findBySession(companyId, sessionId);
        if (!sessionCustomer) {
            logger.debug('[CUSTOMER SERVICE] No session customer to merge');
            return null;
        }
        
        // Check if real identifier already exists
        let existingCustomer = null;
        if (phone) existingCustomer = await this.findByPhone(companyId, phone);
        if (!existingCustomer && email) existingCustomer = await this.findByEmail(companyId, email);
        
        if (existingCustomer) {
            // Merge session customer data into existing customer
            logger.info('[CUSTOMER SERVICE] Merging session into existing customer', {
                sessionCustomerId: sessionCustomer._id,
                existingCustomerId: existingCustomer._id
            });
            
            // Merge AI notes
            if (sessionCustomer.aiNotes.length > 0) {
                existingCustomer.aiNotes.push(...sessionCustomer.aiNotes);
            }
            
            // Merge metrics
            existingCustomer.metrics.totalWebChats = 
                (existingCustomer.metrics.totalWebChats || 0) + 
                (sessionCustomer.metrics.totalWebChats || 0);
            existingCustomer.metrics.totalInteractions = 
                (existingCustomer.metrics.totalInteractions || 0) + 
                (sessionCustomer.metrics.totalInteractions || 0);
            
            await existingCustomer.save();
            
            // Delete the session customer
            await Customer.deleteOne({ _id: sessionCustomer._id });
            
            return existingCustomer;
        } else {
            // Convert session customer to real customer
            logger.info('[CUSTOMER SERVICE] Converting session customer to real customer', {
                customerId: sessionCustomer._id
            });
            
            if (phone) sessionCustomer.addPhone(phone);
            if (email) {
                sessionCustomer.emails.push({
                    address: email.toLowerCase().trim(),
                    label: 'Primary',
                    isPrimary: true,
                    addedAt: new Date()
                });
            }
            
            // Clear temporary sessions
            sessionCustomer.temporarySessions = [];
            
            await sessionCustomer.save();
            
            return sessionCustomer;
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // QUERY METHODS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Get recent customers for a company
     * 
     * @param {string} companyId
     * @param {number} limit
     */
    static async getRecent(companyId, limit = 50) {
        return Customer.find({ companyId })
            .sort({ 'metrics.lastInteractionAt': -1 })
            .limit(limit)
            .lean();
    }
    
    /**
     * Search customers by name
     * 
     * @param {string} companyId
     * @param {string} query
     */
    static async searchByName(companyId, query) {
        return Customer.find({
            companyId,
            $text: { $search: query }
        })
        .limit(20)
        .lean();
    }
    
    /**
     * Get customer count for a company
     * 
     * @param {string} companyId
     */
    static async getCount(companyId) {
        return Customer.countDocuments({ companyId });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CONTEXT BUILDING (For AI)
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Build customer context for AI prompt injection
     * This is what makes the AI "know" the customer
     * 
     * @param {Customer} customer
     * @returns {Object} Context object for AI
     */
    static buildContextForAI(customer) {
        if (!customer) {
            return {
                isKnown: false,
                summary: 'New caller - no previous history'
            };
        }
        
        const context = {
            isKnown: true,
            isReturning: customer.isReturning(),
            customerId: customer._id,
            
            // Identity
            name: customer.getDisplayName(),
            fullName: customer.name.full,
            firstName: customer.name.first,
            
            // Contact
            phone: customer.getPrimaryPhone(),
            
            // Location
            address: customer.getPrimaryAddress(),
            
            // History
            totalInteractions: customer.metrics.totalInteractions,
            totalBookings: customer.metrics.totalBookings,
            lastInteraction: customer.metrics.lastInteractionAt,
            lastChannel: customer.metrics.lastInteractionChannel,
            
            // Recent visit info
            hasRecentVisit: customer.hasRecentVisit(14),
            lastVisit: customer.getLastVisit(),
            
            // Preferences
            preferredTechnician: customer.preferences.preferredTechnicianName,
            preferredTime: customer.preferences.preferredTimeWindow,
            
            // Equipment (if any)
            equipment: customer.equipment.length > 0 ? customer.equipment : null,
            
            // AI Notes (most recent 5)
            notes: customer.aiNotes.slice(-5).map(n => n.note),
            
            // Status
            isVIP: customer.status === 'vip',
            tags: customer.tags
        };
        
        // Build a natural language summary
        const summaryParts = [];
        
        if (customer.isReturning()) {
            summaryParts.push(`Returning customer (${customer.metrics.totalInteractions} total interactions)`);
        } else {
            summaryParts.push('First-time caller');
        }
        
        if (customer.name.first) {
            summaryParts.push(`Name: ${customer.getDisplayName()}`);
        }
        
        if (customer.hasRecentVisit(14)) {
            const lastVisit = customer.getLastVisit();
            const daysAgo = Math.floor((Date.now() - lastVisit.date) / (1000 * 60 * 60 * 24));
            summaryParts.push(`Recent visit ${daysAgo} day(s) ago${lastVisit.technicianName ? ` by ${lastVisit.technicianName}` : ''}`);
        }
        
        if (customer.preferences.preferredTechnicianName) {
            summaryParts.push(`Prefers technician: ${customer.preferences.preferredTechnicianName}`);
        }
        
        if (customer.preferences.preferredTimeWindow) {
            summaryParts.push(`Prefers: ${customer.preferences.preferredTimeWindow}`);
        }
        
        if (customer.aiNotes.length > 0) {
            const recentNotes = customer.aiNotes.slice(-3).map(n => n.note);
            summaryParts.push(`Notes: ${recentNotes.join('; ')}`);
        }
        
        context.summary = summaryParts.join(' | ');
        
        return context;
    }
}

module.exports = CustomerService;

