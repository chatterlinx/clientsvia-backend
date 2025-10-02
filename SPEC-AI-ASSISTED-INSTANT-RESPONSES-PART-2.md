# 🎯 AI-ASSISTED INSTANT RESPONSES - SPECIFICATION PART 2
## Backend Components Continued

---

### **Component 3: Instant Response Matcher**

**File:** `/services/v2InstantResponseMatcher.js` (NEW)

```javascript
// ============================================================================
// INSTANT RESPONSE MATCHER
// 📋 DESCRIPTION: Ultra-fast matching engine for instant responses
// 🎯 PURPOSE: Match caller queries against triggers in < 5ms
// 🔧 FEATURES:
//     - Word-boundary matching (default, recommended)
//     - Exact matching
//     - Contains matching
//     - Starts-with matching
//     - Performance tracking
// 📝 PERFORMANCE TARGET: < 5ms per match
// ⚠️  CRITICAL NOTES:
//     - All matching uses RegExp for speed
//     - Case-insensitive by default
//     - Returns first match (highest priority)
//     - No external dependencies
// ============================================================================

const logger = require('../utils/logger');

class InstantResponseMatcher {
    
    /**
     * Constructor
     * @param {Array} instantResponses - Array of instant response objects
     */
    constructor(instantResponses) {
        if (!Array.isArray(instantResponses)) {
            throw new Error('InstantResponseMatcher requires an array of instant responses');
        }
        
        this.instantResponses = instantResponses.filter(ir => ir.isActive !== false);
        this.matchCache = new Map();  // Cache for regex patterns
        this.stats = {
            totalMatches: 0,
            totalMisses: 0,
            avgResponseTime: 0
        };
        
        // Pre-compile regex patterns for all triggers
        this._precompilePatterns();
    }
    
    /**
     * 🚀 Pre-compile regex patterns for performance
     * @private
     */
    _precompilePatterns() {
        this.instantResponses.forEach(ir => {
            const pattern = this._buildPattern(ir.trigger, ir.matchType);
            this.matchCache.set(ir._id.toString(), pattern);
        });
        
        logger.info(`[MATCHER] Pre-compiled ${this.matchCache.size} regex patterns`);
    }
    
    /**
     * 🔍 Main matching method (sub-5ms target)
     * @param {string} query - The caller's query
     * @returns {Object} Match result
     */
    match(query) {
        const startTime = Date.now();
        
        if (!query || typeof query !== 'string') {
            return {
                matched: false,
                response: null,
                matchedResponse: null,
                matchType: null,
                responseTime: `${Date.now() - startTime}ms`,
                error: 'Invalid query'
            };
        }
        
        const queryLower = query.toLowerCase().trim();
        
        // Try to match against each instant response
        for (const ir of this.instantResponses) {
            const pattern = this.matchCache.get(ir._id.toString());
            
            if (pattern && pattern.test(queryLower)) {
                const responseTime = Date.now() - startTime;
                this.stats.totalMatches++;
                this._updateAvgResponseTime(responseTime);
                
                logger.info(`[MATCHER] ✅ Match found: "${ir.trigger}" in "${query}" (${responseTime}ms)`);
                
                return {
                    matched: true,
                    response: ir.response,
                    matchedResponse: ir,
                    matchType: ir.matchType,
                    trigger: ir.trigger,
                    category: ir.category,
                    responseTime: `${responseTime}ms`,
                    confidence: 1.0  // Instant responses always 1.0 confidence
                };
            }
        }
        
        // No match found
        const responseTime = Date.now() - startTime;
        this.stats.totalMisses++;
        
        logger.info(`[MATCHER] ⚠️ No match found for "${query}" (${responseTime}ms)`);
        
        return {
            matched: false,
            response: null,
            matchedResponse: null,
            matchType: null,
            responseTime: `${responseTime}ms`
        };
    }
    
    /**
     * 🏗️ Build regex pattern based on match type
     * @param {string} trigger - The trigger word/phrase
     * @param {string} matchType - Match type (word-boundary, exact, contains, starts-with)
     * @returns {RegExp} Compiled regex pattern
     * @private
     */
    _buildPattern(trigger, matchType) {
        // Escape special regex characters in trigger
        const escapedTrigger = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        switch (matchType) {
            case 'word-boundary':
                // Match trigger as whole word(s) with word boundaries
                // Example: "hello" matches "hello" and "hello there" but not "helloworld"
                return new RegExp(`\\b${escapedTrigger}\\b`, 'i');
            
            case 'exact':
                // Match entire query exactly (after trimming and lowercasing)
                return new RegExp(`^${escapedTrigger}$`, 'i');
            
            case 'contains':
                // Match trigger anywhere in query
                // Example: "hello" matches "helloworld" and "say hello"
                return new RegExp(escapedTrigger, 'i');
            
            case 'starts-with':
                // Match trigger at start of query
                // Example: "hello" matches "hello there" but not "say hello"
                return new RegExp(`^${escapedTrigger}`, 'i');
            
            default:
                // Default to word-boundary if unknown match type
                logger.warn(`[MATCHER] Unknown match type: ${matchType}, defaulting to word-boundary`);
                return new RegExp(`\\b${escapedTrigger}\\b`, 'i');
        }
    }
    
    /**
     * 📊 Update average response time
     * @param {number} responseTime - Response time in ms
     * @private
     */
    _updateAvgResponseTime(responseTime) {
        const totalResponses = this.stats.totalMatches + this.stats.totalMisses;
        this.stats.avgResponseTime = 
            (this.stats.avgResponseTime * (totalResponses - 1) + responseTime) / totalResponses;
    }
    
    /**
     * 📈 Get performance statistics
     * @returns {Object} Performance stats
     */
    getStats() {
        return {
            totalMatches: this.stats.totalMatches,
            totalMisses: this.stats.totalMisses,
            avgResponseTime: `${this.stats.avgResponseTime.toFixed(2)}ms`,
            matchRate: this.stats.totalMatches + this.stats.totalMisses > 0
                ? ((this.stats.totalMatches / (this.stats.totalMatches + this.stats.totalMisses)) * 100).toFixed(2) + '%'
                : '0%',
            totalResponses: this.instantResponses.length,
            activeResponses: this.instantResponses.filter(ir => ir.isActive !== false).length
        };
    }
    
    /**
     * 🧪 Test a query against a specific trigger (for admin testing)
     * @param {string} query - The query to test
     * @param {string} trigger - The trigger to test against
     * @param {string} matchType - Match type to use
     * @returns {Object} Test result
     */
    static testMatch(query, trigger, matchType = 'word-boundary') {
        const startTime = Date.now();
        const queryLower = query.toLowerCase().trim();
        const triggerLower = trigger.toLowerCase().trim();
        
        // Escape special regex characters
        const escapedTrigger = triggerLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        
        let pattern;
        switch (matchType) {
            case 'word-boundary':
                pattern = new RegExp(`\\b${escapedTrigger}\\b`, 'i');
                break;
            case 'exact':
                pattern = new RegExp(`^${escapedTrigger}$`, 'i');
                break;
            case 'contains':
                pattern = new RegExp(escapedTrigger, 'i');
                break;
            case 'starts-with':
                pattern = new RegExp(`^${escapedTrigger}`, 'i');
                break;
            default:
                pattern = new RegExp(`\\b${escapedTrigger}\\b`, 'i');
        }
        
        const matched = pattern.test(queryLower);
        const responseTime = Date.now() - startTime;
        
        return {
            matched,
            query: query,
            trigger: trigger,
            matchType: matchType,
            responseTime: `${responseTime}ms`,
            pattern: pattern.toString(),
            explanation: matched
                ? `✅ "${trigger}" matches in "${query}" using ${matchType} matching`
                : `❌ "${trigger}" does NOT match in "${query}" using ${matchType} matching`
        };
    }
}

module.exports = InstantResponseMatcher;
```

---

### **Component 4: API Routes**

**File:** `/routes/company/v2instantResponses.js` (NEW)

```javascript
// ============================================================================
// INSTANT RESPONSES API ROUTES
// 📋 DESCRIPTION: REST API for managing instant responses
// 🎯 PURPOSE: CRUD operations for instant responses
// 🔧 ENDPOINTS:
//     - GET    /api/company/:companyId/instant-responses (list)
//     - POST   /api/company/:companyId/instant-responses (create)
//     - PUT    /api/company/:companyId/instant-responses/:id (update)
//     - DELETE /api/company/:companyId/instant-responses/:id (delete)
//     - POST   /api/company/:companyId/instant-responses/test (test matcher)
//     - GET    /api/company/:companyId/instant-responses/export (export JSON)
//     - POST   /api/company/:companyId/instant-responses/import (import JSON)
//     - POST   /api/company/:companyId/instant-responses/copy-from/:sourceCompanyId (copy)
//     - GET    /api/company/:companyId/instant-responses/suggest-variations (suggest)
//     - GET    /api/company/:companyId/instant-responses/stats (statistics)
// ⚠️  CRITICAL NOTES:
//     - All routes require authentication
//     - CompanyId must match logged-in user's company (or be super admin)
//     - All changes are logged for audit trail
// ============================================================================

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Company = require('../../models/v2Company');
const InstantResponseTemplate = require('../../models/InstantResponseTemplate');
const VariationSuggestionEngine = require('../../services/variationSuggestionEngine');
const InstantResponseMatcher = require('../../services/v2InstantResponseMatcher');
const auth = require('../../middleware/auth');
const logger = require('../../utils/logger');

// ============================================================================
// MIDDLEWARE: Verify company access
// ============================================================================

async function verifyCompanyAccess(req, res, next) {
    try {
        const { companyId } = req.params;
        
        // Validate companyId format
        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid company ID format'
            });
        }
        
        // Check if company exists
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Check if user has access to this company
        // TODO: Implement proper access control based on your auth system
        // For now, assuming user has access if authenticated
        
        req.company = company;
        next();
    } catch (error) {
        logger.error('[INSTANT-RESPONSES API] Error verifying company access:', error);
        res.status(500).json({
            success: false,
            error: 'Internal server error'
        });
    }
}

// ============================================================================
// ROUTE: GET /api/company/:companyId/instant-responses
// PURPOSE: List all instant responses for a company
// ============================================================================

router.get('/:companyId/instant-responses', auth, verifyCompanyAccess, async (req, res) => {
    try {
        const { company } = req;
        const { category, isActive, sortBy = 'createdAt', order = 'desc' } = req.query;
        
        let instantResponses = company.instantResponses || [];
        
        // Filter by category
        if (category && category !== 'all') {
            instantResponses = instantResponses.filter(ir => ir.category === category);
        }
        
        // Filter by active status
        if (isActive !== undefined) {
            const isActiveBoolean = isActive === 'true';
            instantResponses = instantResponses.filter(ir => ir.isActive === isActiveBoolean);
        }
        
        // Sort
        instantResponses.sort((a, b) => {
            const aVal = a[sortBy];
            const bVal = b[sortBy];
            
            if (order === 'desc') {
                return aVal > bVal ? -1 : 1;
            } else {
                return aVal > bVal ? 1 : -1;
            }
        });
        
        logger.info(`[INSTANT-RESPONSES API] Listed ${instantResponses.length} instant responses for company ${company._id}`);
        
        res.json({
            success: true,
            data: instantResponses,
            total: instantResponses.length,
            filters: { category, isActive, sortBy, order }
        });
        
    } catch (error) {
        logger.error('[INSTANT-RESPONSES API] Error listing instant responses:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list instant responses'
        });
    }
});

// ============================================================================
// ROUTE: POST /api/company/:companyId/instant-responses
// PURPOSE: Create new instant response
// ============================================================================

router.post('/:companyId/instant-responses', auth, verifyCompanyAccess, async (req, res) => {
    try {
        const { company } = req;
        const { trigger, response, matchType, category, notes } = req.body;
        
        // Validation
        if (!trigger || !response) {
            return res.status(400).json({
                success: false,
                error: 'Trigger and response are required'
            });
        }
        
        // Check for duplicate trigger
        const duplicate = company.instantResponses.find(
            ir => ir.trigger.toLowerCase() === trigger.toLowerCase() && ir.isActive !== false
        );
        
        if (duplicate) {
            return res.status(400).json({
                success: false,
                error: 'A similar trigger already exists',
                existingTrigger: duplicate
            });
        }
        
        // Create new instant response
        const newInstantResponse = {
            _id: new mongoose.Types.ObjectId(),
            trigger: trigger.toLowerCase().trim(),
            response: response.trim(),
            matchType: matchType || 'word-boundary',
            category: category || 'custom',
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date(),
            createdBy: req.user?.username || 'unknown',
            notes: notes || '',
            stats: {
                totalMatches: 0,
                lastTriggered: null,
                avgResponseTime: null
            }
        };
        
        company.instantResponses.push(newInstantResponse);
        await company.save();
        
        logger.info(`[INSTANT-RESPONSES API] ✅ Created instant response for company ${company._id}: "${trigger}"`);
        
        res.status(201).json({
            success: true,
            data: newInstantResponse,
            message: 'Instant response created successfully'
        });
        
    } catch (error) {
        logger.error('[INSTANT-RESPONSES API] Error creating instant response:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to create instant response'
        });
    }
});

// ============================================================================
// ROUTE: PUT /api/company/:companyId/instant-responses/:id
// PURPOSE: Update existing instant response
// ============================================================================

router.put('/:companyId/instant-responses/:id', auth, verifyCompanyAccess, async (req, res) => {
    try {
        const { company } = req;
        const { id } = req.params;
        const { trigger, response, matchType, category, notes, isActive } = req.body;
        
        // Find instant response
        const instantResponse = company.instantResponses.id(id);
        if (!instantResponse) {
            return res.status(404).json({
                success: false,
                error: 'Instant response not found'
            });
        }
        
        // Update fields
        if (trigger !== undefined) instantResponse.trigger = trigger.toLowerCase().trim();
        if (response !== undefined) instantResponse.response = response.trim();
        if (matchType !== undefined) instantResponse.matchType = matchType;
        if (category !== undefined) instantResponse.category = category;
        if (notes !== undefined) instantResponse.notes = notes;
        if (isActive !== undefined) instantResponse.isActive = isActive;
        
        instantResponse.updatedAt = new Date();
        
        await company.save();
        
        logger.info(`[INSTANT-RESPONSES API] ✅ Updated instant response ${id} for company ${company._id}`);
        
        res.json({
            success: true,
            data: instantResponse,
            message: 'Instant response updated successfully'
        });
        
    } catch (error) {
        logger.error('[INSTANT-RESPONSES API] Error updating instant response:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update instant response'
        });
    }
});

// ============================================================================
// ROUTE: DELETE /api/company/:companyId/instant-responses/:id
// PURPOSE: Delete instant response
// ============================================================================

router.delete('/:companyId/instant-responses/:id', auth, verifyCompanyAccess, async (req, res) => {
    try {
        const { company } = req;
        const { id } = req.params;
        
        // Find and remove instant response
        const instantResponse = company.instantResponses.id(id);
        if (!instantResponse) {
            return res.status(404).json({
                success: false,
                error: 'Instant response not found'
            });
        }
        
        // Use MongoDB's pull to remove subdocument
        company.instantResponses.pull(id);
        await company.save();
        
        logger.info(`[INSTANT-RESPONSES API] ✅ Deleted instant response ${id} for company ${company._id}`);
        
        res.json({
            success: true,
            message: 'Instant response deleted successfully'
        });
        
    } catch (error) {
        logger.error('[INSTANT-RESPONSES API] Error deleting instant response:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete instant response'
        });
    }
});

// ============================================================================
// ROUTE: POST /api/company/:companyId/instant-responses/test
// PURPOSE: Test matcher with query (no save)
// ============================================================================

router.post('/:companyId/instant-responses/test', auth, verifyCompanyAccess, async (req, res) => {
    try {
        const { company } = req;
        const { query, trigger, matchType } = req.body;
        
        if (!query) {
            return res.status(400).json({
                success: false,
                error: 'Query is required'
            });
        }
        
        // If testing specific trigger
        if (trigger && matchType) {
            const testResult = InstantResponseMatcher.testMatch(query, trigger, matchType);
            return res.json({
                success: true,
                data: testResult
            });
        }
        
        // Test against all company instant responses
        const matcher = new InstantResponseMatcher(company.instantResponses || []);
        const matchResult = matcher.match(query);
        
        res.json({
            success: true,
            data: matchResult,
            stats: matcher.getStats()
        });
        
    } catch (error) {
        logger.error('[INSTANT-RESPONSES API] Error testing matcher:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to test matcher'
        });
    }
});

// ============================================================================
// ROUTE: GET /api/company/:companyId/instant-responses/export
// PURPOSE: Export instant responses to JSON
// ============================================================================

router.get('/:companyId/instant-responses/export', auth, verifyCompanyAccess, async (req, res) => {
    try {
        const { company } = req;
        
        const exportData = {
            exportedFrom: {
                companyId: company._id,
                companyName: company.companyName || company.businessName,
                exportedAt: new Date(),
                exportedBy: req.user?.username || 'unknown'
            },
            instantResponses: company.instantResponses.map(ir => ({
                trigger: ir.trigger,
                response: ir.response,
                matchType: ir.matchType,
                category: ir.category,
                notes: ir.notes,
                isActive: ir.isActive
            })),
            totalCount: company.instantResponses.length,
            version: '1.0.0'
        };
        
        logger.info(`[INSTANT-RESPONSES API] ✅ Exported ${exportData.totalCount} instant responses for company ${company._id}`);
        
        res.json({
            success: true,
            data: exportData
        });
        
    } catch (error) {
        logger.error('[INSTANT-RESPONSES API] Error exporting instant responses:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to export instant responses'
        });
    }
});

// ============================================================================
// ROUTE: POST /api/company/:companyId/instant-responses/import
// PURPOSE: Import instant responses from JSON
// ============================================================================

router.post('/:companyId/instant-responses/import', auth, verifyCompanyAccess, async (req, res) => {
    try {
        const { company } = req;
        const { instantResponses, overwrite = false } = req.body;
        
        if (!Array.isArray(instantResponses)) {
            return res.status(400).json({
                success: false,
                error: 'instantResponses must be an array'
            });
        }
        
        if (overwrite) {
            // Replace all existing instant responses
            company.instantResponses = [];
        }
        
        // Import each instant response
        let imported = 0;
        let skipped = 0;
        
        for (const ir of instantResponses) {
            // Check for duplicate if not overwriting
            if (!overwrite) {
                const duplicate = company.instantResponses.find(
                    existing => existing.trigger.toLowerCase() === ir.trigger.toLowerCase()
                );
                if (duplicate) {
                    skipped++;
                    continue;
                }
            }
            
            company.instantResponses.push({
                _id: new mongoose.Types.ObjectId(),
                trigger: ir.trigger.toLowerCase().trim(),
                response: ir.response.trim(),
                matchType: ir.matchType || 'word-boundary',
                category: ir.category || 'custom',
                isActive: ir.isActive !== false,
                createdAt: new Date(),
                updatedAt: new Date(),
                createdBy: req.user?.username || 'imported',
                notes: ir.notes || 'Imported from JSON',
                stats: {
                    totalMatches: 0,
                    lastTriggered: null,
                    avgResponseTime: null
                }
            });
            
            imported++;
        }
        
        await company.save();
        
        logger.info(`[INSTANT-RESPONSES API] ✅ Imported ${imported} instant responses for company ${company._id} (${skipped} skipped)`);
        
        res.json({
            success: true,
            imported,
            skipped,
            total: company.instantResponses.length,
            message: `Successfully imported ${imported} instant responses`
        });
        
    } catch (error) {
        logger.error('[INSTANT-RESPONSES API] Error importing instant responses:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to import instant responses'
        });
    }
});

// ============================================================================
// ROUTE: POST /api/company/:companyId/instant-responses/copy-from/:sourceCompanyId
// PURPOSE: Copy instant responses from another company
// ============================================================================

router.post('/:companyId/instant-responses/copy-from/:sourceCompanyId', auth, verifyCompanyAccess, async (req, res) => {
    try {
        const { company } = req;
        const { sourceCompanyId } = req.params;
        const { overwrite = false, replaceCompanyName = true } = req.body;
        
        // Validate source company ID
        if (!mongoose.Types.ObjectId.isValid(sourceCompanyId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid source company ID'
            });
        }
        
        // Load source company
        const sourceCompany = await Company.findById(sourceCompanyId)
            .select('instantResponses companyName businessName');
        
        if (!sourceCompany) {
            return res.status(404).json({
                success: false,
                error: 'Source company not found'
            });
        }
        
        if (overwrite) {
            company.instantResponses = [];
        }
        
        // Copy instant responses
        let copied = 0;
        let skipped = 0;
        
        const sourceCompanyName = sourceCompany.companyName || sourceCompany.businessName;
        const targetCompanyName = company.companyName || company.businessName;
        
        for (const ir of sourceCompany.instantResponses) {
            // Check for duplicate if not overwriting
            if (!overwrite) {
                const duplicate = company.instantResponses.find(
                    existing => existing.trigger.toLowerCase() === ir.trigger.toLowerCase()
                );
                if (duplicate) {
                    skipped++;
                    continue;
                }
            }
            
            let response = ir.response;
            if (replaceCompanyName && sourceCompanyName && targetCompanyName) {
                response = response.replace(new RegExp(sourceCompanyName, 'gi'), targetCompanyName);
            }
            
            company.instantResponses.push({
                _id: new mongoose.Types.ObjectId(),
                trigger: ir.trigger,
                response: response,
                matchType: ir.matchType,
                category: ir.category,
                isActive: ir.isActive,
                createdAt: new Date(),
                updatedAt: new Date(),
                createdBy: req.user?.username || 'copied',
                notes: `Copied from ${sourceCompanyName || sourceCompanyId}`,
                stats: {
                    totalMatches: 0,
                    lastTriggered: null,
                    avgResponseTime: null
                }
            });
            
            copied++;
        }
        
        // Update metadata
        company.instantResponseTemplates = company.instantResponseTemplates || {};
        company.instantResponseTemplates.lastImportedFrom = sourceCompanyId;
        company.instantResponseTemplates.lastImportedAt = new Date();
        
        await company.save();
        
        logger.info(`[INSTANT-RESPONSES API] ✅ Copied ${copied} instant responses from company ${sourceCompanyId} to ${company._id} (${skipped} skipped)`);
        
        res.json({
            success: true,
            copied,
            skipped,
            total: company.instantResponses.length,
            sourceCompany: sourceCompanyName,
            message: `Successfully copied ${copied} instant responses`
        });
        
    } catch (error) {
        logger.error('[INSTANT-RESPONSES API] Error copying instant responses:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to copy instant responses'
        });
    }
});

// ============================================================================
// ROUTE: GET /api/company/:companyId/instant-responses/suggest-variations
// PURPOSE: Suggest variations for a trigger (in-house, no LLM)
// ============================================================================

router.get('/:companyId/instant-responses/suggest-variations', auth, verifyCompanyAccess, async (req, res) => {
    try {
        const { trigger } = req.query;
        
        if (!trigger) {
            return res.status(400).json({
                success: false,
                error: 'Trigger is required'
            });
        }
        
        const suggestions = VariationSuggestionEngine.suggestVariations(trigger);
        
        res.json({
            success: true,
            data: suggestions
        });
        
    } catch (error) {
        logger.error('[INSTANT-RESPONSES API] Error suggesting variations:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to suggest variations'
        });
    }
});

// ============================================================================
// ROUTE: GET /api/company/:companyId/instant-responses/stats
// PURPOSE: Get statistics for instant responses
// ============================================================================

router.get('/:companyId/instant-responses/stats', auth, verifyCompanyAccess, async (req, res) => {
    try {
        const { company } = req;
        
        const instantResponses = company.instantResponses || [];
        
        // Calculate statistics
        const stats = {
            total: instantResponses.length,
            active: instantResponses.filter(ir => ir.isActive !== false).length,
            inactive: instantResponses.filter(ir => ir.isActive === false).length,
            byCategory: {},
            byMatchType: {},
            totalMatches: 0,
            avgResponseTime: null
        };
        
        // Group by category
        instantResponses.forEach(ir => {
            stats.byCategory[ir.category] = (stats.byCategory[ir.category] || 0) + 1;
            stats.byMatchType[ir.matchType] = (stats.byMatchType[ir.matchType] || 0) + 1;
            if (ir.stats?.totalMatches) {
                stats.totalMatches += ir.stats.totalMatches;
            }
        });
        
        // Calculate average response time
        const responseTimes = instantResponses
            .filter(ir => ir.stats?.avgResponseTime)
            .map(ir => ir.stats.avgResponseTime);
        
        if (responseTimes.length > 0) {
            stats.avgResponseTime = (responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length).toFixed(2) + 'ms';
        }
        
        res.json({
            success: true,
            data: stats
        });
        
    } catch (error) {
        logger.error('[INSTANT-RESPONSES API] Error getting stats:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get stats'
        });
    }
});

module.exports = router;
```

**Mount in app.js:**

```javascript
// Add this to /app.js

// Instant Responses Routes (Priority 0 System)
const v2instantResponsesRoutes = require('./routes/company/v2instantResponses');
app.use('/api/company', v2instantResponsesRoutes);
```

---

**CONTINUED IN NEXT FILE DUE TO LENGTH...**

---

## 📄 Next Sections Include:

- Priority Router Integration (how to add queryInstantResponses)
- Frontend Components (InstantResponsesManager.js)
- Testing Requirements
- Deployment Checklist
- Complete File Structure
- Code Standards

**Would you like me to continue with Part 3?**
