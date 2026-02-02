/**
 * ════════════════════════════════════════════════════════════════════════════════
 * PLATFORM CATALOG API ROUTES
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Endpoints:
 * - GET  /api/admin/platform-catalog              - Get full platform catalog
 * - GET  /api/admin/platform-catalog/summary      - Get catalog summary for dashboard
 * - GET  /api/admin/platform-catalog/company/:id  - Get company-specific status
 * - GET  /api/admin/platform-catalog/types        - List available item types
 * - GET  /api/admin/platform-catalog/missing      - Get missing/unconfigured items
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');

const {
    buildPlatformCatalog,
    checkCompanyCatalogStatus,
    getCatalogSummary,
    ITEM_TYPES,
    ITEM_CATEGORIES
} = require('../../services/platform/PlatformCatalog');

const Company = require('../../models/v2Company');

// ════════════════════════════════════════════════════════════════════════════════
// GET FULL PLATFORM CATALOG
// ════════════════════════════════════════════════════════════════════════════════
router.get('/', async (req, res) => {
    try {
        const { tradeKey, type, category } = req.query;
        
        const catalog = buildPlatformCatalog(tradeKey);
        
        // Filter by type if specified
        let items = catalog.items;
        if (type) {
            items = items.filter(i => i.type === type);
        }
        if (category) {
            items = items.filter(i => i.category === category);
        }
        
        res.json({
            success: true,
            version: catalog.version,
            generatedAt: catalog.generatedAt,
            tradeKey: catalog.tradeKey,
            stats: catalog.stats,
            itemTypes: catalog.itemTypes,
            categories: catalog.categories,
            items,
            filters: { type, category }
        });
        
    } catch (error) {
        logger.error('[PLATFORM CATALOG] Error getting catalog:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET CATALOG SUMMARY (for dashboard)
// ════════════════════════════════════════════════════════════════════════════════
router.get('/summary', async (req, res) => {
    try {
        const { tradeKey } = req.query;
        const summary = getCatalogSummary(tradeKey);
        
        res.json({
            success: true,
            ...summary
        });
        
    } catch (error) {
        logger.error('[PLATFORM CATALOG] Error getting summary:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET ITEM TYPES
// ════════════════════════════════════════════════════════════════════════════════
router.get('/types', async (req, res) => {
    try {
        res.json({
            success: true,
            types: Object.entries(ITEM_TYPES).map(([key, value]) => ({
                key,
                label: value,
                description: getTypeDescription(value)
            })),
            categories: Object.entries(ITEM_CATEGORIES).map(([key, value]) => ({
                key,
                label: formatCategoryLabel(value)
            }))
        });
        
    } catch (error) {
        logger.error('[PLATFORM CATALOG] Error getting types:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET COMPANY-SPECIFIC CATALOG STATUS
// ════════════════════════════════════════════════════════════════════════════════
router.get('/company/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { type, category, showMissingOnly } = req.query;
        
        // Load company with all relevant config
        const company = await Company.findById(companyId)
            .select('companyName name trade placeholders aiAgentSettings googleCalendar smsNotifications')
            .lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        const tradeKey = company.trade || null;
        const catalog = await checkCompanyCatalogStatus(company, tradeKey);
        
        // Filter items
        let items = catalog.items;
        if (type) {
            items = items.filter(i => i.type === type);
        }
        if (category) {
            items = items.filter(i => i.category === category);
        }
        if (showMissingOnly === 'true') {
            items = items.filter(i => i.missing || !i.configured);
        }
        
        res.json({
            success: true,
            companyId: catalog.companyId,
            companyName: catalog.companyName,
            tradeKey: catalog.tradeKey,
            companyStats: catalog.companyStats,
            stats: catalog.stats,
            items,
            filters: { type, category, showMissingOnly }
        });
        
    } catch (error) {
        logger.error('[PLATFORM CATALOG] Error getting company status:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET MISSING ITEMS (across all companies or specific)
// ════════════════════════════════════════════════════════════════════════════════
router.get('/missing', async (req, res) => {
    try {
        const { companyId, type } = req.query;
        
        if (companyId) {
            // Single company
            const company = await Company.findById(companyId)
                .select('companyName name trade placeholders aiAgentSettings googleCalendar smsNotifications')
                .lean();
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    error: 'Company not found'
                });
            }
            
            const catalog = await checkCompanyCatalogStatus(company, company.trade);
            let missingItems = catalog.items.filter(i => i.missing || (i.required && !i.configured));
            
            if (type) {
                missingItems = missingItems.filter(i => i.type === type);
            }
            
            return res.json({
                success: true,
                companyId,
                companyName: company.companyName || company.name,
                missingCount: missingItems.length,
                items: missingItems
            });
        }
        
        // All companies summary
        const companies = await Company.find({ isActive: { $ne: false } })
            .select('companyName name trade placeholders aiAgentSettings googleCalendar smsNotifications')
            .lean();
        
        const companySummaries = [];
        
        for (const company of companies) {
            const catalog = await checkCompanyCatalogStatus(company, company.trade);
            const missingItems = catalog.items.filter(i => i.missing || (i.required && !i.configured));
            
            if (missingItems.length > 0) {
                companySummaries.push({
                    companyId: company._id.toString(),
                    companyName: company.companyName || company.name,
                    missingCount: missingItems.length,
                    readiness: catalog.companyStats.readiness,
                    readinessPercent: catalog.companyStats.readinessPercent,
                    missingItems: missingItems.slice(0, 5).map(i => ({
                        id: i.id,
                        label: i.label,
                        type: i.type
                    }))
                });
            }
        }
        
        res.json({
            success: true,
            totalCompanies: companies.length,
            companiesWithMissing: companySummaries.length,
            companies: companySummaries.sort((a, b) => b.missingCount - a.missingCount)
        });
        
    } catch (error) {
        logger.error('[PLATFORM CATALOG] Error getting missing items:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET INTEGRATIONS STATUS
// ════════════════════════════════════════════════════════════════════════════════
router.get('/integrations', async (req, res) => {
    try {
        const { companyId } = req.query;
        
        const catalog = buildPlatformCatalog();
        const integrations = catalog.items.filter(i => i.type === ITEM_TYPES.INTEGRATION);
        
        if (companyId) {
            const company = await Company.findById(companyId)
                .select('companyName googleCalendar smsNotifications aiAgentSettings.voiceSettings')
                .lean();
            
            if (!company) {
                return res.status(404).json({
                    success: false,
                    error: 'Company not found'
                });
            }
            
            // Enrich with company-specific status
            const enrichedIntegrations = integrations.map(integration => {
                let enabled = false;
                let connected = false;
                let status = 'disabled';
                
                if (integration.key === 'googleCalendar') {
                    enabled = company.googleCalendar?.enabled || false;
                    connected = company.googleCalendar?.connected || false;
                    status = connected ? 'connected' : (enabled ? 'enabled' : 'disabled');
                } else if (integration.key === 'smsNotifications') {
                    enabled = company.smsNotifications?.enabled || false;
                    status = enabled ? 'enabled' : 'disabled';
                    connected = enabled;
                } else if (integration.key === 'elevenLabs') {
                    enabled = company.aiAgentSettings?.voiceSettings?.elevenLabsEnabled || false;
                    status = enabled ? 'enabled' : 'disabled';
                    connected = enabled;
                }
                
                return {
                    ...integration,
                    enabled,
                    connected,
                    status
                };
            });
            
            return res.json({
                success: true,
                companyId,
                companyName: company.companyName,
                integrations: enrichedIntegrations
            });
        }
        
        res.json({
            success: true,
            integrations
        });
        
    } catch (error) {
        logger.error('[PLATFORM CATALOG] Error getting integrations:', error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════════

function getTypeDescription(type) {
    const descriptions = {
        [ITEM_TYPES.TOKEN]: 'Dynamic text variables resolved at runtime (e.g., {companyName})',
        [ITEM_TYPES.CONFIG]: 'Configuration fields from the wiring registry',
        [ITEM_TYPES.INTEGRATION]: 'Third-party service connections (Calendar, SMS, Voice)',
        [ITEM_TYPES.RUNTIME_MODULE]: 'Core platform engines and services',
        [ITEM_TYPES.SCENARIO_ENFORCEMENT]: 'Validation rules for scenario compliance'
    };
    return descriptions[type] || type;
}

function formatCategoryLabel(category) {
    return category
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, str => str.toUpperCase())
        .trim();
}

module.exports = router;
