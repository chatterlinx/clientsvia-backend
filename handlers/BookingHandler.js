// handlers/BookingHandler.js
// V2 Booking Handler - Production Ready

const { getDB } = require('../db');
const { ObjectId } = require('mongodb');
const crypto = require('crypto');

/**
 * Get v2 booking schema for a specific company, trade, and service type
 */
async function getV2BookingSchema(companyID, trade, serviceType) {
    console.log(`[V2 Booking] Getting schema for ${companyID}/${trade}/${serviceType}`);
    
    const db = getDB();
    if (!db) {throw new Error('Database not connected');}

    try {
        const schemaId = `${trade}-${serviceType}`.toLowerCase().replace(/\s+/g, '-');
        
        const schema = await db.collection('v2BookingSchemas').findOne({
            companyID,
            schemaId,
            'metadata.isActive': true
        });

        if (schema) {
            console.log(`[V2 Booking] Found v2 schema`);
            return schema;
        }

        return await getLegacyBookingFlow(companyID, trade, serviceType);
    } catch (error) {
        console.error('[V2 Booking] Error:', error);
        throw error;
    }
}

/**
 * Legacy booking flow getter (backward compatibility)
 */
async function getLegacyBookingFlow(companyID, trade, serviceType) {
    const db = getDB();
    const company = await db.collection('companiesCollection').findOne({ 
        $or: [
            { _id: ObjectId.isValid(companyID) ? new ObjectId(companyID) : null },
            { companyID }
        ]
    });

    if (!company?.bookingScripts?.length) {return null;}

    return company.bookingScripts.find(script => 
        (script.tradeType === trade || script.trade === trade) && script.serviceType === serviceType
    );
}

/**
 * Create v2 booking session with idempotency
 */
async function createOrResumeBookingSession({ companyID, trade, serviceType, sessionId, idempotencyKey }) {
    const db = getDB();
    if (!db) {throw new Error('Database not connected');}

    try {
        const schema = await getV2BookingSchema(companyID, trade, serviceType);
        if (!schema) {throw new Error(`No booking schema found`);}

        const newSessionId = generateSessionId();
        const now = new Date();
        const expiresAt = new Date(now.getTime() + (24 * 60 * 60 * 1000));

        const newSession = {
            sessionId: newSessionId,
            companyID,
            schemaId: schema.schemaId || `${trade}-${serviceType}`,
            tradeCategory: trade,
            serviceType,
            idempotencyKey,
            currentStep: 0,
            collectedData: {},
            isActive: true,
            isCompleted: false,
            createdAt: now,
            updatedAt: now,
            expiresAt,
            features: schema.features || {},
            auditLog: []
        };

        await db.collection('v2BookingSessions').insertOne(newSession);
        
        return {
            sessionId: newSessionId,
            isNew: true,
            currentStep: 0,
            collectedData: {},
            schema,
            expiresAt
        };
    } catch (error) {
        console.error('[V2 Booking] Session error:', error);
        throw error;
    }
}

function generateSessionId() {
    return `bs_${  crypto.randomBytes(16).toString('hex')}`;
}

// Legacy exports for backward compatibility
async function getBookingFlow(companyID, trade, serviceType) {
    return await getLegacyBookingFlow(companyID, trade, serviceType);
}

async function handleBookingFlow({ companyID, trade, serviceType, currentStep = 0 }) {
    try {
        const flow = await getLegacyBookingFlow(companyID, trade, serviceType);
        
        if (!flow?.flowSteps) {
            return { 
                error: 'Booking flow not found',
                message: `No booking script configured for ${trade} - ${serviceType}.`
            };
        }

        const stepsArray = Array.isArray(flow.flowSteps) ? flow.flowSteps : 
            Object.keys(flow.flowSteps).sort().map(key => flow.flowSteps[key]);

        if (currentStep >= stepsArray.length) {
            return { 
                done: true, 
                message: 'Booking completed successfully!',
                completionMessage: flow.completionMessage || 'Thank you! We will contact you shortly.'
            };
        }

        const currentStepData = stepsArray[currentStep];
        const isLastStep = currentStep === stepsArray.length - 1;

        return {
            step: currentStep,
            stepNumber: currentStep + 1,
            totalSteps: stepsArray.length,
            message: typeof currentStepData === 'string' ? currentStepData : 
                    (currentStepData.prompt || currentStepData.question || currentStepData),
            isLastStep,
            done: false,
            nextStep: isLastStep ? null : currentStep + 1,
            flowName: flow.name || `${trade} ${serviceType} Booking`
        };
    } catch (error) {
        console.error('[Legacy Booking] Error:', error);
        return {
            error: 'Internal error',
            message: 'Booking system temporarily unavailable.'
        };
    }
}

async function getAvailableBookingFlows(companyID) {
    try {
        const db = getDB();
        const flows = [];

        const company = await db.collection('companiesCollection').findOne({ 
            $or: [
                { _id: ObjectId.isValid(companyID) ? new ObjectId(companyID) : null },
                { companyID }
            ]
        });

        if (company?.bookingScripts) {
            company.bookingScripts.forEach(script => {
                flows.push({
                    tradeType: script.tradeType,
                    serviceType: script.serviceType,
                    name: script.name || `${script.tradeType} ${script.serviceType}`,
                    description: script.description || `Book ${script.serviceType} service`,
                    stepCount: script.flowSteps?.length || 0,
                    isActive: script.isActive !== false,
                    isV2: script.isV2 || false
                });
            });
        }

        return flows;
    } catch (error) {
        console.error('[Booking Flows] Error:', error);
        return [];
    }
}

function validateBookingFlow(bookingScript) {
    const errors = [];
    
    if (!bookingScript.tradeType && !bookingScript.tradeCategory) {
        errors.push('Trade type is required');
    }
    
    if (!bookingScript.serviceType) {
        errors.push('Service type is required');
    }
    
    if (!bookingScript.flowSteps?.length) {
        errors.push('At least one flow step is required');
    }
    
    return {
        isValid: errors.length === 0,
        errors
    };
}

module.exports = { 
    getBookingFlow, 
    handleBookingFlow, 
    getAvailableBookingFlows,
    validateBookingFlow,
    getV2BookingSchema,
    createOrResumeBookingSession
};
