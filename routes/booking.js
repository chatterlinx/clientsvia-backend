// routes/booking.js
// Enterprise Booking Flow API endpoints

const express = require('express');
const router = express.Router();
const { getDB } = require('../db');
const { ObjectId } = require('mongodb');

console.log('--- Enterprise Booking routes loading ---');

/**
 * @route   POST /api/booking/enterprise-schema
 * @desc    Save enterprise booking flow schema
 * @access  Public
 */
router.post('/enterprise-schema', async (req, res) => {
    try {
        const {
            companyID,
            tradeCategory,
            serviceType,
            sessionTTL,
            priority,
            autoResume,
            idempotencyKey,
            validation,
            auditLog,
            requiredFields,
            flowSteps,
            version
        } = req.body;

        console.log(`[Enterprise Booking] Saving schema for company: ${companyID}, trade: ${tradeCategory}, service: ${serviceType}`);

        // Validation
        if (!companyID || !tradeCategory || !serviceType) {
            return res.status(400).json({
                success: false,
                message: 'CompanyID, trade category, and service type are required'
            });
        }

        if (!flowSteps || !Array.isArray(flowSteps) || flowSteps.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'At least one flow step is required'
            });
        }

        // Validate required system fields
        const systemRequiredFields = ['customerName', 'phoneNumber', 'serviceAddress'];
        const hasAllSystemFields = systemRequiredFields.every(field => 
            flowSteps.some(step => step.field === field)
        );

        if (!hasAllSystemFields) {
            return res.status(400).json({
                success: false,
                message: 'Missing required system fields: customerName, phoneNumber, serviceAddress'
            });
        }

        const db = getDB();
        if (!db) {
            throw new Error('Database not connected');
        }

        // Enterprise booking schema document
        const enterpriseSchema = {
            companyID: companyID,
            schemaId: `${tradeCategory}-${serviceType}`.toLowerCase().replace(/\s+/g, '-'),
            tradeCategory,
            serviceType,
            sessionTTL: sessionTTL || 24,
            priority: priority || 'standard',
            features: {
                autoResume: autoResume === true,
                idempotencyKey: idempotencyKey === true,
                validation: validation === true,
                auditLog: auditLog === true
            },
            requiredFields: requiredFields || [],
            flowSteps: flowSteps.map((step, index) => ({
                step: index + 1,
                field: step.field,
                prompt: step.prompt,
                type: step.type || 'text',
                validation: step.validation || 'none',
                order: index + 1
            })),
            metadata: {
                version: version || '1.0.0',
                createdAt: new Date(),
                updatedAt: new Date(),
                createdBy: 'system',
                isActive: true,
                isEnterprise: true
            },
            // Add enterprise-specific configurations
            policies: {
                maxSessionDuration: sessionTTL * 60 * 60 * 1000, // Convert to milliseconds
                allowDuplicateBookings: false,
                requireAllFields: true,
                autoValidateFields: validation === true,
                enableSessionRecovery: autoResume === true
            },
            audit: {
                trackFieldChanges: auditLog === true,
                trackSessionEvents: auditLog === true,
                retentionPeriodDays: 90
            }
        };

        // Check if schema already exists
        const existingSchema = await db.collection('enterpriseBookingSchemas').findOne({
            companyID: companyID,
            schemaId: enterpriseSchema.schemaId
        });

        let result;
        if (existingSchema) {
            // Update existing schema
            enterpriseSchema.metadata.updatedAt = new Date();
            enterpriseSchema.metadata.version = incrementVersion(existingSchema.metadata.version);
            
            result = await db.collection('enterpriseBookingSchemas').updateOne(
                { _id: existingSchema._id },
                { $set: enterpriseSchema }
            );
            
            console.log(`[Enterprise Booking] Updated schema for ${companyID}/${enterpriseSchema.schemaId}`);
        } else {
            // Create new schema
            result = await db.collection('enterpriseBookingSchemas').insertOne(enterpriseSchema);
            console.log(`[Enterprise Booking] Created new schema for ${companyID}/${enterpriseSchema.schemaId}`);
        }

        // Also update the company's booking scripts for backward compatibility
        await updateCompanyBookingScripts(db, companyID, tradeCategory, serviceType, enterpriseSchema);

        res.json({
            success: true,
            message: 'Enterprise booking schema saved successfully',
            schemaId: enterpriseSchema.schemaId,
            version: enterpriseSchema.metadata.version,
            stepCount: flowSteps.length,
            features: enterpriseSchema.features
        });

    } catch (error) {
        console.error('[Enterprise Booking] Error saving schema:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save enterprise booking schema',
            error: error.message
        });
    }
});

/**
 * @route   GET /api/booking/enterprise-schema/:companyID
 * @desc    Get all enterprise booking schemas for a company
 * @access  Public
 */
router.get('/enterprise-schema/:companyID', async (req, res) => {
    try {
        const { companyID } = req.params;
        
        console.log(`[Enterprise Booking] Getting schemas for company: ${companyID}`);

        const db = getDB();
        if (!db) {
            throw new Error('Database not connected');
        }

        const schemas = await db.collection('enterpriseBookingSchemas')
            .find({ 
                companyID: companyID,
                'metadata.isActive': true 
            })
            .sort({ 'metadata.updatedAt': -1 })
            .toArray();

        res.json({
            success: true,
            companyID: companyID,
            schemas: schemas,
            totalCount: schemas.length
        });

    } catch (error) {
        console.error('[Enterprise Booking] Error getting schemas:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve enterprise booking schemas',
            error: error.message
        });
    }
});

/**
 * @route   GET /api/booking/enterprise-schema/:companyID/:schemaId
 * @desc    Get specific enterprise booking schema
 * @access  Public
 */
router.get('/enterprise-schema/:companyID/:schemaId', async (req, res) => {
    try {
        const { companyID, schemaId } = req.params;
        
        console.log(`[Enterprise Booking] Getting schema: ${companyID}/${schemaId}`);

        const db = getDB();
        if (!db) {
            throw new Error('Database not connected');
        }

        const schema = await db.collection('enterpriseBookingSchemas').findOne({
            companyID: companyID,
            schemaId: schemaId,
            'metadata.isActive': true
        });

        if (!schema) {
            return res.status(404).json({
                success: false,
                message: 'Enterprise booking schema not found'
            });
        }

        res.json({
            success: true,
            schema: schema
        });

    } catch (error) {
        console.error('[Enterprise Booking] Error getting schema:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve enterprise booking schema',
            error: error.message
        });
    }
});

/**
 * @route   POST /api/booking/enterprise-validate
 * @desc    Validate booking data against enterprise schema
 * @access  Public
 */
router.post('/enterprise-validate', async (req, res) => {
    try {
        const { companyID, schemaId, bookingData, sessionId } = req.body;

        console.log(`[Enterprise Booking] Validating booking data for ${companyID}/${schemaId}`);

        const db = getDB();
        if (!db) {
            throw new Error('Database not connected');
        }

        // Get the schema
        const schema = await db.collection('enterpriseBookingSchemas').findOne({
            companyID: companyID,
            schemaId: schemaId,
            'metadata.isActive': true
        });

        if (!schema) {
            return res.status(404).json({
                success: false,
                message: 'Enterprise booking schema not found'
            });
        }

        // Perform validation
        const validationResult = validateBookingData(schema, bookingData);

        // Log validation attempt if audit is enabled
        if (schema.features.auditLog) {
            await logValidationAttempt(db, companyID, schemaId, sessionId, validationResult);
        }

        res.json({
            success: true,
            isValid: validationResult.isValid,
            errors: validationResult.errors,
            warnings: validationResult.warnings,
            completionRate: validationResult.completionRate,
            nextRequiredField: validationResult.nextRequiredField
        });

    } catch (error) {
        console.error('[Enterprise Booking] Error validating booking:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to validate booking data',
            error: error.message
        });
    }
});

// Helper functions

function incrementVersion(currentVersion) {
    const parts = currentVersion.split('.');
    const patch = parseInt(parts[2]) + 1;
    return `${parts[0]}.${parts[1]}.${patch}`;
}

async function updateCompanyBookingScripts(db, companyID, tradeCategory, serviceType, enterpriseSchema) {
    try {
        // Convert enterprise schema to legacy booking script format
        const legacyScript = enterpriseSchema.flowSteps.map(step => step.prompt);

        const bookingScript = {
            tradeType: tradeCategory,
            serviceType: serviceType,
            name: `${tradeCategory} ${serviceType} Booking`,
            description: `Enterprise booking flow for ${tradeCategory} ${serviceType}`,
            flowSteps: legacyScript,
            script: legacyScript, // For backward compatibility
            isActive: true,
            isEnterprise: true,
            enterpriseSchemaId: enterpriseSchema.schemaId,
            lastUpdated: new Date()
        };

        await db.collection('companiesCollection').updateOne(
            { companyID: companyID },
            { 
                $pull: { 
                    bookingScripts: { 
                        tradeType: tradeCategory, 
                        serviceType: serviceType 
                    } 
                } 
            }
        );

        await db.collection('companiesCollection').updateOne(
            { companyID: companyID },
            { $push: { bookingScripts: bookingScript } }
        );

        console.log(`[Enterprise Booking] Updated legacy booking script for ${companyID}`);

    } catch (error) {
        console.error('[Enterprise Booking] Error updating legacy scripts:', error);
        // Don't throw - this is backward compatibility, not critical
    }
}

function validateBookingData(schema, bookingData) {
    const errors = [];
    const warnings = [];
    let completedFields = 0;
    let nextRequiredField = null;

    schema.flowSteps.forEach(step => {
        const fieldValue = bookingData[step.field];
        const isEmpty = !fieldValue || (typeof fieldValue === 'string' && fieldValue.trim() === '');

        if (step.validation === 'required') {
            if (isEmpty) {
                errors.push(`${step.field} is required`);
                if (!nextRequiredField) {
                    nextRequiredField = step.field;
                }
            } else {
                completedFields++;
                // Validate field type if not empty
                if (!validateFieldType(step.type, fieldValue)) {
                    errors.push(`${step.field} must be a valid ${step.type}`);
                }
            }
        } else if (!isEmpty) {
            completedFields++;
            // Validate field type for optional fields too
            if (!validateFieldType(step.type, fieldValue)) {
                warnings.push(`${step.field} format may be incorrect for type ${step.type}`);
            }
        }
    });

    const totalFields = schema.flowSteps.length;
    const completionRate = totalFields > 0 ? (completedFields / totalFields) * 100 : 0;

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        completionRate: Math.round(completionRate),
        nextRequiredField,
        totalFields,
        completedFields
    };
}

function validateFieldType(type, value) {
    switch (type) {
        case 'phone':
            return /^[\+]?[1-9][\d]{0,15}$/.test(value.replace(/[\s\-\(\)]/g, ''));
        case 'email':
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
        case 'number':
            return !isNaN(value) && !isNaN(parseFloat(value));
        case 'date':
            return !isNaN(Date.parse(value));
        case 'time':
            return /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/.test(value);
        default:
            return true; // text, address, and other types are considered valid if not empty
    }
}

async function logValidationAttempt(db, companyID, schemaId, sessionId, validationResult) {
    try {
        const logEntry = {
            companyID,
            schemaId,
            sessionId,
            timestamp: new Date(),
            isValid: validationResult.isValid,
            errorCount: validationResult.errors.length,
            warningCount: validationResult.warnings.length,
            completionRate: validationResult.completionRate,
            type: 'validation'
        };

        await db.collection('enterpriseBookingAuditLog').insertOne(logEntry);
    } catch (error) {
        console.error('[Enterprise Booking] Error logging validation:', error);
        // Don't throw - logging failure shouldn't break validation
    }
}

module.exports = router;
