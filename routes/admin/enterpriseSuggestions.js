/**
 * ============================================================================
 * ENTERPRISE SUGGESTIONS API - TEST PILOT INTELLIGENCE ENDPOINTS
 * ============================================================================
 * 
 * PURPOSE:
 * RESTful API for Enterprise Test Pilot system. Exposes all intelligence
 * services (analysis, trends, conflicts, costs) to frontend.
 * 
 * ENDPOINTS:
 * 1. GET  /analysis/:testId           - Get detailed analysis for a test
 * 2. POST /apply                      - Apply a suggestion
 * 3. POST /bulk-apply                 - Apply multiple suggestions
 * 4. GET  /trends/:templateId         - Get trend data for template
 * 5. GET  /conflicts/:templateId      - Get detected conflicts
 * 6. GET  /cost-projection/:templateId- Get cost projections
 * 
 * SECURITY:
 * - All routes require JWT authentication
 * - All routes require admin role
 * - Rate limiting applied
 * - Input validation on all endpoints
 * 
 * ARCHITECTURE:
 * - Thin controller layer (routes)
 * - Business logic in services
 * - Consistent error handling
 * - Structured JSON responses
 * 
 * CHECKPOINT STRATEGY:
 * - Log all API requests with context
 * - Track response times
 * - Enhanced error messages
 * - Never mask errors
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const TestPilotAnalysis = require('../../models/TestPilotAnalysis');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const TrendAnalyzer = require('../../services/TrendAnalyzer');
const ConflictDetector = require('../../services/ConflictDetector');
const CostImpactCalculator = require('../../services/CostImpactCalculator');
const TranscriptColorizer = require('../../services/TranscriptColorizer');

// Initialize services
const trendAnalyzer = new TrendAnalyzer();
const conflictDetector = new ConflictDetector();
const costCalculator = new CostImpactCalculator();
const transcriptColorizer = new TranscriptColorizer();

// Admin-only middleware
const adminOnly = requireRole('admin');

/**
 * ============================================================================
 * ENDPOINT 1: GET DETAILED ANALYSIS
 * ============================================================================
 * GET /api/admin/suggestions/analysis/:testId
 * 
 * Returns complete analysis for a specific test, including:
 * - Tier results
 * - LLM analysis
 * - Suggestions with priorities
 * - Conflicts
 * - Cost projections
 * - Color-coded transcript
 * ============================================================================
 */
router.get('/analysis/:testId', authenticateJWT, adminOnly, async (req, res) => {
    console.log('🔵 [API] GET /analysis/:testId - Request received');
    console.log('🔵 [API] Test ID:', req.params.testId);
    
    try {
        const { testId } = req.params;
        
        // ============================================
        // STEP 1: VALIDATE INPUT
        // ============================================
        if (!testId) {
            console.error('❌ [API] Missing testId');
            return res.status(400).json({
                success: false,
                error: 'testId is required'
            });
        }
        
        // ============================================
        // STEP 2: FETCH ANALYSIS
        // ============================================
        console.log('🔵 [API] Fetching analysis from database...');
        
        const analysis = await TestPilotAnalysis.findById(testId);
        
        if (!analysis) {
            console.error('❌ [API] Analysis not found:', testId);
            return res.status(404).json({
                success: false,
                error: 'Analysis not found'
            });
        }
        
        console.log('✅ [API] Analysis found');
        
        // ============================================
        // STEP 3: GENERATE COLOR-CODED TRANSCRIPT
        // ============================================
        console.log('🔵 [API] Generating color-coded transcript...');
        
        const coloredTranscript = transcriptColorizer.exportForFrontend(
            analysis.testPhrase,
            analysis.tierResults,
            analysis.suggestions
        );
        
        console.log('✅ [API] Transcript colorized');
        
        // ============================================
        // STEP 4: RETURN COMPLETE ANALYSIS
        // ============================================
        console.log('✅ [API] Returning complete analysis');
        
        return res.json({
            success: true,
            data: {
                analysis: analysis.toObject(),
                coloredTranscript
            }
        });
        
    } catch (error) {
        console.error('❌ [API ERROR] GET /analysis/:testId failed:', error.message);
        console.error('Stack trace:', error.stack);
        
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch analysis',
            message: error.message
        });
    }
});

/**
 * ============================================================================
 * ENDPOINT 2: APPLY SUGGESTION
 * ============================================================================
 * POST /api/admin/suggestions/apply
 * 
 * Applies a single suggestion to the template
 * 
 * Body: {
 *   analysisId: string,
 *   suggestionId: string,
 *   appliedBy: string
 * }
 * ============================================================================
 */
router.post('/apply', authenticateJWT, adminOnly, async (req, res) => {
    console.log('🔵 [API] POST /apply - Request received');
    
    try {
        const { analysisId, suggestionId, appliedBy } = req.body;
        
        // ============================================
        // STEP 1: VALIDATE INPUT
        // ============================================
        if (!analysisId || !suggestionId) {
            console.error('❌ [API] Missing required fields');
            return res.status(400).json({
                success: false,
                error: 'analysisId and suggestionId are required'
            });
        }
        
        // ============================================
        // STEP 2: FETCH ANALYSIS
        // ============================================
        const analysis = await TestPilotAnalysis.findById(analysisId);
        
        if (!analysis) {
            console.error('❌ [API] Analysis not found:', analysisId);
            return res.status(404).json({
                success: false,
                error: 'Analysis not found'
            });
        }
        
        // ============================================
        // STEP 3: MARK SUGGESTION AS APPLIED
        // ============================================
        console.log('🔵 [API] Marking suggestion as applied...');
        
        analysis.applySuggestion(suggestionId, appliedBy || 'Admin');
        await analysis.save();
        
        console.log('✅ [API] Suggestion applied successfully');
        
        // ============================================
        // STEP 4: RETURN SUCCESS
        // ============================================
        return res.json({
            success: true,
            message: 'Suggestion applied successfully',
            data: {
                analysisId,
                suggestionId,
                status: 'applied'
            }
        });
        
    } catch (error) {
        console.error('❌ [API ERROR] POST /apply failed:', error.message);
        
        return res.status(500).json({
            success: false,
            error: 'Failed to apply suggestion',
            message: error.message
        });
    }
});

/**
 * ============================================================================
 * ENDPOINT 3: BULK APPLY SUGGESTIONS
 * ============================================================================
 * POST /api/admin/suggestions/bulk-apply
 * 
 * Applies multiple suggestions at once
 * 
 * Body: {
 *   analysisId: string,
 *   suggestionIds: string[],
 *   appliedBy: string
 * }
 * ============================================================================
 */
router.post('/bulk-apply', authenticateJWT, adminOnly, async (req, res) => {
    console.log('🔵 [API] POST /bulk-apply - Request received');
    
    try {
        const { analysisId, suggestionIds, appliedBy } = req.body;
        
        // ============================================
        // STEP 1: VALIDATE INPUT
        // ============================================
        if (!analysisId || !Array.isArray(suggestionIds) || suggestionIds.length === 0) {
            console.error('❌ [API] Invalid input');
            return res.status(400).json({
                success: false,
                error: 'analysisId and non-empty suggestionIds array are required'
            });
        }
        
        console.log('🔵 [API] Applying', suggestionIds.length, 'suggestions...');
        
        // ============================================
        // STEP 2: FETCH ANALYSIS
        // ============================================
        const analysis = await TestPilotAnalysis.findById(analysisId);
        
        if (!analysis) {
            console.error('❌ [API] Analysis not found');
            return res.status(404).json({
                success: false,
                error: 'Analysis not found'
            });
        }
        
        // ============================================
        // STEP 3: APPLY ALL SUGGESTIONS
        // ============================================
        const results = {
            success: [],
            failed: []
        };
        
        suggestionIds.forEach(suggestionId => {
            try {
                analysis.applySuggestion(suggestionId, appliedBy || 'Admin');
                results.success.push(suggestionId);
            } catch (error) {
                console.error('❌ [API] Failed to apply suggestion:', suggestionId, error.message);
                results.failed.push({ suggestionId, error: error.message });
            }
        });
        
        await analysis.save();
        
        console.log('✅ [API] Bulk apply complete:', results.success.length, 'success,', results.failed.length, 'failed');
        
        // ============================================
        // STEP 4: RETURN RESULTS
        // ============================================
        return res.json({
            success: true,
            message: `Applied ${results.success.length} of ${suggestionIds.length} suggestions`,
            data: results
        });
        
    } catch (error) {
        console.error('❌ [API ERROR] POST /bulk-apply failed:', error.message);
        
        return res.status(500).json({
            success: false,
            error: 'Failed to bulk apply suggestions',
            message: error.message
        });
    }
});

/**
 * ============================================================================
 * ENDPOINT 4: GET TREND DATA
 * ============================================================================
 * GET /api/admin/suggestions/trends/:templateId
 * 
 * Returns trend data for a template
 * Query params: ?days=30 (optional)
 * ============================================================================
 */
router.get('/trends/:templateId', authenticateJWT, adminOnly, async (req, res) => {
    console.log('🔵 [API] GET /trends/:templateId - Request received');
    
    try {
        const { templateId } = req.params;
        const days = parseInt(req.query.days) || 30;
        
        // ============================================
        // STEP 1: VALIDATE INPUT
        // ============================================
        if (!templateId) {
            console.error('❌ [API] Missing templateId');
            return res.status(400).json({
                success: false,
                error: 'templateId is required'
            });
        }
        
        console.log('🔵 [API] Fetching trends for template:', templateId, 'days:', days);
        
        // ============================================
        // STEP 2: FETCH COMPREHENSIVE TREND REPORT
        // ============================================
        const trendReport = await trendAnalyzer.getComprehensiveTrendReport(templateId, days);
        
        console.log('✅ [API] Trend report generated');
        
        // ============================================
        // STEP 3: RETURN TRENDS
        // ============================================
        return res.json({
            success: true,
            data: trendReport
        });
        
    } catch (error) {
        console.error('❌ [API ERROR] GET /trends/:templateId failed:', error.message);
        
        return res.status(500).json({
            success: false,
            error: 'Failed to fetch trends',
            message: error.message
        });
    }
});

/**
 * ============================================================================
 * ENDPOINT 5: GET CONFLICTS
 * ============================================================================
 * GET /api/admin/suggestions/conflicts/:templateId
 * 
 * Returns detected conflicts for a template
 * Query params: ?mode=AGGRESSIVE|STANDARD|DISABLED (optional)
 * ============================================================================
 */
router.get('/conflicts/:templateId', authenticateJWT, adminOnly, async (req, res) => {
    console.log('🔵 [API] GET /conflicts/:templateId - Request received');
    
    try {
        const { templateId } = req.params;
        const mode = req.query.mode || 'STANDARD';
        
        // ============================================
        // STEP 1: VALIDATE INPUT
        // ============================================
        if (!templateId) {
            console.error('❌ [API] Missing templateId');
            return res.status(400).json({
                success: false,
                error: 'templateId is required'
            });
        }
        
        if (!['AGGRESSIVE', 'STANDARD', 'DISABLED'].includes(mode)) {
            console.error('❌ [API] Invalid mode:', mode);
            return res.status(400).json({
                success: false,
                error: 'mode must be AGGRESSIVE, STANDARD, or DISABLED'
            });
        }
        
        console.log('🔵 [API] Detecting conflicts for template:', templateId, 'mode:', mode);
        
        // ============================================
        // STEP 2: FETCH TEMPLATE
        // ============================================
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        
        if (!template) {
            console.error('❌ [API] Template not found');
            return res.status(404).json({
                success: false,
                error: 'Template not found'
            });
        }
        
        // ============================================
        // STEP 3: DETECT CONFLICTS
        // ============================================
        const conflicts = await conflictDetector.detectAllConflicts(template, mode);
        
        console.log('✅ [API] Detected', conflicts.length, 'conflicts');
        
        // ============================================
        // STEP 4: RETURN CONFLICTS
        // ============================================
        return res.json({
            success: true,
            data: {
                templateId,
                templateName: template.name,
                mode,
                totalConflicts: conflicts.length,
                conflicts
            }
        });
        
    } catch (error) {
        console.error('❌ [API ERROR] GET /conflicts/:templateId failed:', error.message);
        
        return res.status(500).json({
            success: false,
            error: 'Failed to detect conflicts',
            message: error.message
        });
    }
});

/**
 * ============================================================================
 * ENDPOINT 6: GET COST PROJECTION
 * ============================================================================
 * GET /api/admin/suggestions/cost-projection/:templateId
 * 
 * Returns cost projections and ROI analysis
 * Query params: ?days=30&volumeProfile=medium (optional)
 * ============================================================================
 */
router.get('/cost-projection/:templateId', authenticateJWT, adminOnly, async (req, res) => {
    console.log('🔵 [API] GET /cost-projection/:templateId - Request received');
    
    try {
        const { templateId } = req.params;
        const days = parseInt(req.query.days) || 30;
        const volumeProfile = req.query.volumeProfile || 'medium';
        
        // ============================================
        // STEP 1: VALIDATE INPUT
        // ============================================
        if (!templateId) {
            console.error('❌ [API] Missing templateId');
            return res.status(400).json({
                success: false,
                error: 'templateId is required'
            });
        }
        
        if (!['low', 'medium', 'high', 'enterprise'].includes(volumeProfile)) {
            console.error('❌ [API] Invalid volumeProfile');
            return res.status(400).json({
                success: false,
                error: 'volumeProfile must be low, medium, high, or enterprise'
            });
        }
        
        console.log('🔵 [API] Calculating cost projection...');
        
        // ============================================
        // STEP 2: FETCH PENDING SUGGESTIONS
        // ============================================
        const recentAnalyses = await TestPilotAnalysis.find({
            templateId,
            'suggestions.status': 'pending'
        }).limit(10).select('suggestions').lean();
        
        const pendingSuggestions = [];
        recentAnalyses.forEach(analysis => {
            analysis.suggestions?.forEach(suggestion => {
                if (suggestion.status === 'pending') {
                    pendingSuggestions.push(suggestion);
                }
            });
        });
        
        console.log('✅ [API] Found', pendingSuggestions.length, 'pending suggestions');
        
        // ============================================
        // STEP 3: CALCULATE COST PROJECTION
        // ============================================
        const projection = await costCalculator.projectCostSavings(
            templateId,
            days,
            volumeProfile
        );
        
        // ============================================
        // STEP 4: CALCULATE BULK ROI (if suggestions exist)
        // ============================================
        let bulkROI = null;
        
        if (pendingSuggestions.length > 0) {
            bulkROI = costCalculator.calculateBulkROI(
                pendingSuggestions,
                0.10 * pendingSuggestions.length, // Estimate $0.10 per suggestion analysis cost
                volumeProfile
            );
        }
        
        console.log('✅ [API] Cost projection calculated');
        
        // ============================================
        // STEP 5: RETURN PROJECTION
        // ============================================
        return res.json({
            success: true,
            data: {
                templateId,
                volumeProfile,
                timeframe: `${days} days`,
                projection,
                bulkROI,
                pendingSuggestionCount: pendingSuggestions.length
            }
        });
        
    } catch (error) {
        console.error('❌ [API ERROR] GET /cost-projection/:templateId failed:', error.message);
        
        return res.status(500).json({
            success: false,
            error: 'Failed to calculate cost projection',
            message: error.message
        });
    }
});

module.exports = router;

