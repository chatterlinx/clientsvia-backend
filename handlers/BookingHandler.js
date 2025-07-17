// handlers/BookingHandler.js
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');

/**
 * Get booking flow for a specific company, trade, and service type
 * @param {string} companyID - The company ID
 * @param {string} trade - The trade category (e.g., 'HVAC', 'Plumbing')
 * @param {string} serviceType - The service type (e.g., 'Repair', 'Maintenance')
 * @returns {Object|null} - The booking flow or null if not found
 */
async function getBookingFlow(companyID, trade, serviceType) {
    console.log(`[BookingHandler] Getting booking flow for company: ${companyID}, trade: ${trade}, serviceType: ${serviceType}`);
    
    const db = getDB();
    if (!db) {
        console.error('[BookingHandler] Database not connected');
        throw new Error('Database not connected');
    }

    try {
        const company = await db.collection('companiesCollection').findOne({ 
            $or: [
                { _id: ObjectId.isValid(companyID) ? new ObjectId(companyID) : null },
                { companyID: companyID }
            ]
        });

        if (!company) {
            console.warn(`[BookingHandler] Company not found: ${companyID}`);
            return null;
        }

        if (!company.bookingScripts || !company.bookingScripts.length) {
            console.warn(`[BookingHandler] No booking scripts found for company: ${companyID}`);
            return null;
        }

        // Find the specific booking script for this trade and service type
        // Support both 'trade' and 'tradeType' field names for backward compatibility
        const bookingScript = company.bookingScripts.find(script => 
            (script.tradeType === trade || script.trade === trade) && script.serviceType === serviceType
        );

        if (!bookingScript) {
            console.warn(`[BookingHandler] No booking script found for ${trade} - ${serviceType}`);
            return null;
        }

        console.log(`[BookingHandler] Found booking script for ${trade} - ${serviceType}:`, bookingScript);
        return bookingScript;

    } catch (error) {
        console.error('[BookingHandler] Error getting booking flow:', error.message, error.stack);
        throw error;
    }
}

/**
 * Handle booking flow progression through steps
 * @param {Object} params - Parameters object
 * @param {string} params.companyID - The company ID
 * @param {string} params.trade - The trade category
 * @param {string} params.serviceType - The service type
 * @param {number} params.currentStep - Current step number (0-based)
 * @returns {Object} - Step information or completion status
 */
async function handleBookingFlow({ companyID, trade, serviceType, currentStep = 0 }) {
    console.log(`[BookingHandler] Handling booking flow step ${currentStep} for ${trade} - ${serviceType}`);
    
    try {
        const flow = await getBookingFlow(companyID, trade, serviceType);
        
        if (!flow || !flow.flowSteps) {
            return { 
                error: 'Booking flow not found',
                message: `No booking script configured for ${trade} - ${serviceType}. Please contact support.`
            };
        }

        // Convert flowSteps object to array if needed
        const stepsArray = Array.isArray(flow.flowSteps) ? 
            flow.flowSteps : 
            Object.keys(flow.flowSteps)
                .sort((a, b) => {
                    // Sort by step number (step1, step2, etc.)
                    const aNum = parseInt(a.replace('step', ''));
                    const bNum = parseInt(b.replace('step', ''));
                    return aNum - bNum;
                })
                .map(key => flow.flowSteps[key]);

        // Check if we've completed all steps
        if (currentStep >= stepsArray.length) {
            return { 
                done: true, 
                message: 'Booking flow completed successfully. Thank you!',
                completionMessage: flow.completionMessage || 'Your booking request has been submitted. We will contact you shortly to confirm.'
            };
        }

        // Get current step
        const currentStepData = stepsArray[currentStep];
        const isLastStep = currentStep === stepsArray.length - 1;

        return {
            step: currentStep,
            stepNumber: currentStep + 1,
            totalSteps: stepsArray.length,
            message: typeof currentStepData === 'string' ? currentStepData : (currentStepData.prompt || currentStepData.question || currentStepData),
            isLastStep: isLastStep,
            done: false,
            nextStep: isLastStep ? null : currentStep + 1,
            flowName: flow.name || `${trade} ${serviceType} Booking`,
            placeholders: (typeof currentStepData === 'object' ? currentStepData.placeholders : null) || []
        };

    } catch (error) {
        console.error('[BookingHandler] Error handling booking flow:', error.message, error.stack);
        return {
            error: 'Internal error',
            message: 'Sorry, there was an issue with the booking system. Please try again or contact support.'
        };
    }
}

/**
 * Get all available booking flows for a company
 * @param {string} companyID - The company ID
 * @returns {Array} - Array of available booking flows
 */
async function getAvailableBookingFlows(companyID) {
    console.log(`[BookingHandler] Getting available booking flows for company: ${companyID}`);
    
    try {
        const db = getDB();
        const company = await db.collection('companiesCollection').findOne({ 
            $or: [
                { _id: ObjectId.isValid(companyID) ? new ObjectId(companyID) : null },
                { companyID: companyID }
            ]
        });

        if (!company || !company.bookingScripts) {
            return [];
        }

        return company.bookingScripts.map(script => ({
            tradeType: script.tradeType,
            serviceType: script.serviceType,
            name: script.name || `${script.tradeType} ${script.serviceType}`,
            description: script.description || `Book ${script.serviceType} service for ${script.tradeType}`,
            stepCount: script.flowSteps ? script.flowSteps.length : 0,
            isActive: script.isActive !== false
        }));

    } catch (error) {
        console.error('[BookingHandler] Error getting available booking flows:', error.message, error.stack);
        return [];
    }
}

/**
 * Validate booking flow configuration
 * @param {Object} bookingScript - The booking script to validate
 * @returns {Object} - Validation result
 */
function validateBookingFlow(bookingScript) {
    const errors = [];
    
    if (!bookingScript.tradeType) {
        errors.push('Trade type is required');
    }
    
    if (!bookingScript.serviceType) {
        errors.push('Service type is required');
    }
    
    if (!bookingScript.flowSteps || !Array.isArray(bookingScript.flowSteps) || bookingScript.flowSteps.length === 0) {
        errors.push('At least one flow step is required');
    }
    
    if (bookingScript.flowSteps) {
        bookingScript.flowSteps.forEach((step, index) => {
            if (!step || (typeof step !== 'string' && !step.prompt && !step.question)) {
                errors.push(`Step ${index + 1} must have a prompt or question`);
            }
        });
    }
    
    return {
        isValid: errors.length === 0,
        errors: errors
    };
}

module.exports = { 
    getBookingFlow, 
    handleBookingFlow, 
    getAvailableBookingFlows,
    validateBookingFlow
};
