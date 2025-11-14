/**
 * ============================================================================
 * TRIAGE BUILDER - ADMIN ROUTE
 * ============================================================================
 * 
 * Purpose: LLM-powered content generator for Service Type Triage packages
 * 
 * Endpoint: POST /api/admin/triage-builder/generate
 * 
 * Flow:
 * 1. Admin describes a triage situation (e.g., "Customer wants maintenance but AC not cooling")
 * 2. LLM generates complete triage package with 3 sections:
 *    - Frontline-Intel procedural block
 *    - Cheat Sheet triage map
 *    - Response Library (human-like lines)
 * 3. Admin reviews and manually copies/pastes into Frontline-Intel
 * 
 * CRITICAL: LLM is for CONTENT AUTHORING only, NOT runtime call decisions.
 * No impact on live calls; purely admin-side tooling.
 * ============================================================================
 */

const express = require('express');
const logger = require('../../utils/logger');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const { generateTriagePackage } = require('../../services/TriageBuilderService');

const router = express.Router();

// ============================================================================
// ADMIN-ONLY PROTECTION
// ============================================================================
// Apply JWT auth + admin role requirement to ALL routes in this file
router.use(authenticateJWT);
router.use(requireRole('admin'));

// ============================================================================
// POST /api/admin/triage-builder/generate
// ============================================================================
// Generate a complete triage package using LLM
//
// Request Body:
// {
//   "trade": "HVAC",
//   "situation": "Customer wants maintenance but AC not cooling",
//   "serviceTypes": ["REPAIR", "MAINTENANCE", "EMERGENCY", "OTHER"] // optional
// }
//
// Response:
// {
//   "success": true,
//   "frontlineIntelSection": "...",
//   "cheatSheetTriageMap": "...",
//   "responseLibrary": ["...", "...", "..."]
// }
// ============================================================================

router.post('/generate', async (req, res) => {
    const { trade, situation, serviceTypes } = req.body;

    logger.info('[TRIAGE BUILDER API] Generate request received', {
        trade,
        situationLength: situation?.length,
        serviceTypes,
        userId: req.user?.id
    });

    // ========================================================================
    // VALIDATION
    // ========================================================================

    // Validate trade
    if (!trade || typeof trade !== 'string' || trade.trim().length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Field "trade" is required and must be a non-empty string (e.g., "HVAC", "Plumbing", "Dental")'
        });
    }

    // Validate situation
    if (!situation || typeof situation !== 'string' || situation.trim().length === 0) {
        return res.status(400).json({
            success: false,
            error: 'Field "situation" is required and must be a non-empty string describing the triage scenario'
        });
    }

    // Validate/default serviceTypes
    let validServiceTypes;
    if (!serviceTypes || !Array.isArray(serviceTypes) || serviceTypes.length === 0) {
        // Default to common service types
        validServiceTypes = ['REPAIR', 'MAINTENANCE', 'EMERGENCY', 'OTHER'];
        logger.debug('[TRIAGE BUILDER API] No serviceTypes provided, using defaults', {
            defaults: validServiceTypes
        });
    } else {
        // Validate each service type is a string
        validServiceTypes = serviceTypes
            .filter(st => st && typeof st === 'string')
            .map(st => st.trim().toUpperCase());

        if (validServiceTypes.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Field "serviceTypes" must be an array of non-empty strings if provided'
            });
        }
    }

    // ========================================================================
    // GENERATE TRIAGE PACKAGE
    // ========================================================================

    try {
        const triagePackage = await generateTriagePackage(
            trade.trim(),
            situation.trim(),
            validServiceTypes
        );

        logger.info('[TRIAGE BUILDER API] Triage package generated successfully', {
            trade: trade.trim(),
            frontlineLength: triagePackage.frontlineIntelSection.length,
            cheatSheetLength: triagePackage.cheatSheetTriageMap.length,
            responseCount: triagePackage.responseLibrary.length
        });

        return res.json({
            success: true,
            frontlineIntelSection: triagePackage.frontlineIntelSection,
            cheatSheetTriageMap: triagePackage.cheatSheetTriageMap,
            responseLibrary: triagePackage.responseLibrary
        });

    } catch (error) {
        logger.error('[TRIAGE BUILDER API] Generation failed', {
            error: error.message,
            trade: trade.trim(),
            situationLength: situation.trim().length
        });

        return res.status(500).json({
            success: false,
            error: error.message || 'Failed to generate triage package'
        });
    }
});

module.exports = router;

