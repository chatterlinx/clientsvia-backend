// routes/bookingHandler.js
// API endpoints for testing the BookingHandler functionality

const express = require('express');
const router = express.Router();
const { getBookingFlow, handleBookingFlow, getAvailableBookingFlows, validateBookingFlow } = require('../handlers/BookingHandler');

console.log('--- bookingHandler.js router loading ---');

/**
 * @route   GET /api/booking-handler/flow/:companyID/:trade/:serviceType
 * @desc    Get booking flow for specific company, trade, and service type
 * @access  Public
 */
router.get('/flow/:companyID/:trade/:serviceType', async (req, res) => {
    const { companyID, trade, serviceType } = req.params;
    
    console.log(`[API GET booking-handler/flow] Getting flow for company: ${companyID}, trade: ${trade}, serviceType: ${serviceType}`);
    
    try {
        const bookingFlow = await getBookingFlow(companyID, trade, serviceType);
        
        if (!bookingFlow) {
            return res.status(404).json({
                success: false,
                message: `No booking flow found for ${trade} - ${serviceType}`
            });
        }
        
        res.json({
            success: true,
            bookingFlow: bookingFlow,
            stepCount: bookingFlow.flowSteps ? bookingFlow.flowSteps.length : 0
        });
        
    } catch (error) {
        console.error('[API GET booking-handler/flow] Error:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: 'Error retrieving booking flow',
            error: error.message
        });
    }
});

/**
 * @route   POST /api/booking-handler/step
 * @desc    Handle booking flow step progression
 * @access  Public
 */
router.post('/step', async (req, res) => {
    const { companyID, trade, serviceType, currentStep = 0 } = req.body;
    
    console.log(`[API POST booking-handler/step] Handling step ${currentStep} for ${trade} - ${serviceType}`);
    
    try {
        if (!companyID || !trade || !serviceType) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameters: companyID, trade, serviceType'
            });
        }
        
        const stepResult = await handleBookingFlow({
            companyID,
            trade,
            serviceType,
            currentStep: parseInt(currentStep)
        });
        
        res.json({
            success: true,
            ...stepResult
        });
        
    } catch (error) {
        console.error('[API POST booking-handler/step] Error:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: 'Error handling booking flow step',
            error: error.message
        });
    }
});

/**
 * @route   GET /api/booking-handler/available/:companyID
 * @desc    Get all available booking flows for a company
 * @access  Public
 */
router.get('/available/:companyID', async (req, res) => {
    const { companyID } = req.params;
    
    console.log(`[API GET booking-handler/available] Getting available flows for company: ${companyID}`);
    
    try {
        const availableFlows = await getAvailableBookingFlows(companyID);
        
        res.json({
            success: true,
            companyID: companyID,
            flowCount: availableFlows.length,
            availableFlows: availableFlows
        });
        
    } catch (error) {
        console.error('[API GET booking-handler/available] Error:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: 'Error retrieving available booking flows',
            error: error.message
        });
    }
});

/**
 * @route   POST /api/booking-handler/simulate
 * @desc    Simulate a complete booking flow for testing
 * @access  Public
 */
router.post('/simulate', async (req, res) => {
    const { companyID, trade, serviceType, responses = [] } = req.body;
    
    console.log(`[API POST booking-handler/simulate] Simulating flow for ${trade} - ${serviceType}`);
    
    try {
        if (!companyID || !trade || !serviceType) {
            return res.status(400).json({
                success: false,
                message: 'Missing required parameters: companyID, trade, serviceType'
            });
        }
        
        const bookingFlow = await getBookingFlow(companyID, trade, serviceType);
        
        if (!bookingFlow) {
            return res.status(404).json({
                success: false,
                message: `No booking flow found for ${trade} - ${serviceType}`
            });
        }
        
        const simulation = [];
        const totalSteps = bookingFlow.flowSteps ? bookingFlow.flowSteps.length : 0;
        
        // Simulate each step
        for (let step = 0; step < totalSteps; step++) {
            const stepResult = await handleBookingFlow({
                companyID,
                trade,
                serviceType,
                currentStep: step
            });
            
            simulation.push({
                step: step + 1,
                prompt: stepResult.message,
                customerResponse: responses[step] || `[Simulated response for step ${step + 1}]`,
                isLastStep: stepResult.isLastStep
            });
        }
        
        // Get completion message
        const completionResult = await handleBookingFlow({
            companyID,
            trade,
            serviceType,
            currentStep: totalSteps
        });
        
        res.json({
            success: true,
            simulation: {
                companyID,
                trade,
                serviceType,
                flowName: bookingFlow.name || `${trade} ${serviceType} Booking`,
                totalSteps: totalSteps,
                steps: simulation,
                completion: {
                    message: completionResult.completionMessage || completionResult.message,
                    done: completionResult.done
                }
            }
        });
        
    } catch (error) {
        console.error('[API POST booking-handler/simulate] Error:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: 'Error simulating booking flow',
            error: error.message
        });
    }
});

/**
 * @route   POST /api/booking-handler/validate
 * @desc    Validate booking flow configuration
 * @access  Public
 */
router.post('/validate', async (req, res) => {
    const { bookingScript } = req.body;
    
    console.log('[API POST booking-handler/validate] Validating booking script');
    
    try {
        if (!bookingScript) {
            return res.status(400).json({
                success: false,
                message: 'Booking script is required for validation'
            });
        }
        
        const validation = validateBookingFlow(bookingScript);
        
        res.json({
            success: true,
            validation: validation,
            isValid: validation.isValid,
            errors: validation.errors
        });
        
    } catch (error) {
        console.error('[API POST booking-handler/validate] Error:', error.message, error.stack);
        res.status(500).json({
            success: false,
            message: 'Error validating booking flow',
            error: error.message
        });
    }
});

module.exports = router;
