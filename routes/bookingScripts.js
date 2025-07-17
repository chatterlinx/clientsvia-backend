const express = require('express');
const router = express.Router();
const Company = require('../models/Company');

// GET /api/booking-scripts/templates - Get predefined booking script templates
router.get('/templates', async (req, res) => {
    try {
        const templates = {
            hvac: {
                repair: [
                    "Confirm the specific HVAC issue you're experiencing",
                    "Check availability for emergency or standard service",
                    "Verify customer contact information and address",
                    "Provide estimated arrival time and service cost range",
                    "Confirm appointment and send confirmation details"
                ],
                maintenance: [
                    "Schedule routine maintenance appointment",
                    "Confirm system type and last service date",
                    "Verify customer contact information",
                    "Provide maintenance checklist and pricing",
                    "Confirm appointment and send reminder"
                ],
                installation: [
                    "Assess installation requirements and space",
                    "Provide equipment options and pricing",
                    "Schedule installation consultation",
                    "Confirm customer information and preferences",
                    "Send detailed quote and timeline"
                ]
            },
            plumbing: {
                repair: [
                    "Identify the plumbing emergency or issue",
                    "Check for immediate availability",
                    "Confirm customer location and contact details",
                    "Provide emergency service rates and ETA",
                    "Confirm service call and dispatch technician"
                ],
                maintenance: [
                    "Schedule preventive plumbing maintenance",
                    "Review previous service history",
                    "Confirm customer contact information",
                    "Explain maintenance benefits and pricing",
                    "Book appointment and send confirmation"
                ],
                installation: [
                    "Discuss new plumbing installation needs",
                    "Schedule on-site assessment",
                    "Verify property details and access",
                    "Provide installation timeline and estimate",
                    "Confirm consultation appointment"
                ]
            },
            electrical: {
                repair: [
                    "Assess electrical problem urgency",
                    "Check electrician availability",
                    "Verify safety concerns and location",
                    "Provide emergency rates and arrival time",
                    "Confirm service call and safety instructions"
                ],
                maintenance: [
                    "Schedule electrical system inspection",
                    "Review electrical panel and wiring age",
                    "Confirm customer contact information",
                    "Explain inspection process and benefits",
                    "Book appointment and provide preparation tips"
                ],
                installation: [
                    "Discuss electrical installation project",
                    "Review electrical code requirements",
                    "Schedule detailed consultation",
                    "Verify permits and timeline needs",
                    "Confirm consultation and provide checklist"
                ]
            }
        };
        
        res.json(templates);
    } catch (error) {
        console.error('Error fetching booking script templates:', error);
        res.status(500).json({ error: 'Failed to fetch templates' });
    }
});

// POST /api/booking-scripts/test - Test a booking script
router.post('/test', async (req, res) => {
    try {
        const { script, tradeType, serviceType } = req.body;
        
        if (!script || !Array.isArray(script)) {
            return res.status(400).json({ error: 'Invalid script format' });
        }
        
        // Simulate test results
        const testResults = {
            status: 'success',
            message: 'Booking script test completed successfully',
            tradeType: tradeType || 'unknown',
            serviceType: serviceType || 'unknown',
            stepCount: script.length,
            estimatedDuration: script.length * 30, // 30 seconds per step
            suggestions: []
        };
        
        // Add suggestions based on script analysis
        if (script.length < 3) {
            testResults.suggestions.push('Consider adding more steps for better customer experience');
        }
        
        if (script.length > 8) {
            testResults.suggestions.push('Script might be too long - consider consolidating steps');
        }
        
        const hasContactVerification = script.some(step => 
            step.toLowerCase().includes('contact') || step.toLowerCase().includes('phone') || step.toLowerCase().includes('email')
        );
        
        if (!hasContactVerification) {
            testResults.suggestions.push('Consider adding a contact verification step');
        }
        
        res.json(testResults);
    } catch (error) {
        console.error('Error testing booking script:', error);
        res.status(500).json({ error: 'Failed to test script' });
    }
});

// POST /api/booking-scripts - Save booking scripts for a company
router.post('/', async (req, res) => {
    try {
        const { companyId, tradeType, serviceType, script } = req.body;
        
        if (!companyId || !tradeType || !serviceType || !script) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Initialize bookingScripts array if it doesn't exist
        if (!company.bookingScripts) {
            company.bookingScripts = [];
        }
        
        // Find existing script for this trade/service combination
        const existingIndex = company.bookingScripts.findIndex(
            bs => bs.tradeType === tradeType && bs.serviceType === serviceType
        );
        
        const bookingScript = {
            tradeType,
            serviceType,
            script,
            lastUpdated: new Date(),
            isActive: true
        };
        
        if (existingIndex >= 0) {
            // Update existing script
            company.bookingScripts[existingIndex] = bookingScript;
        } else {
            // Add new script
            company.bookingScripts.push(bookingScript);
        }
        
        await company.save();
        
        res.json({
            success: true,
            message: 'Booking script saved successfully',
            script: bookingScript
        });
        
    } catch (error) {
        console.error('Error saving booking script:', error);
        res.status(500).json({ error: 'Failed to save booking script' });
    }
});

// GET /api/booking-scripts/:companyId - Get all booking scripts for a company
router.get('/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        res.json({
            companyId,
            bookingScripts: company.bookingScripts || []
        });
        
    } catch (error) {
        console.error('Error fetching booking scripts:', error);
        res.status(500).json({ error: 'Failed to fetch booking scripts' });
    }
});

// GET /api/booking-scripts/:companyId/:tradeType/:serviceType - Get specific booking script
router.get('/:companyId/:tradeType/:serviceType', async (req, res) => {
    try {
        const { companyId, tradeType, serviceType } = req.params;
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        const bookingScript = company.bookingScripts?.find(
            bs => bs.tradeType === tradeType && bs.serviceType === serviceType
        );
        
        if (!bookingScript) {
            return res.status(404).json({ error: 'Booking script not found' });
        }
        
        res.json(bookingScript);
        
    } catch (error) {
        console.error('Error fetching booking script:', error);
        res.status(500).json({ error: 'Failed to fetch booking script' });
    }
});

// DELETE /api/booking-scripts/:companyId/:tradeType/:serviceType - Delete specific booking script
router.delete('/:companyId/:tradeType/:serviceType', async (req, res) => {
    try {
        const { companyId, tradeType, serviceType } = req.params;
        
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        if (!company.bookingScripts) {
            return res.status(404).json({ error: 'No booking scripts found' });
        }
        
        const initialLength = company.bookingScripts.length;
        company.bookingScripts = company.bookingScripts.filter(
            bs => !(bs.tradeType === tradeType && bs.serviceType === serviceType)
        );
        
        if (company.bookingScripts.length === initialLength) {
            return res.status(404).json({ error: 'Booking script not found' });
        }
        
        await company.save();
        
        res.json({
            success: true,
            message: 'Booking script deleted successfully'
        });
        
    } catch (error) {
        console.error('Error deleting booking script:', error);
        res.status(500).json({ error: 'Failed to delete booking script' });
    }
});

module.exports = router;
