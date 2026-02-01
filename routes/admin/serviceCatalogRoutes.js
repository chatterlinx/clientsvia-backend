/**
 * ============================================================================
 * SERVICE CATALOG & SWITCHBOARD ROUTES - Jan 2026
 * ============================================================================
 * 
 * PURPOSE:
 * API endpoints for managing:
 * - Service Catalog (template-level service definitions)
 * - Service Switchboard (company-level service toggles)
 * 
 * BASE PATH: /api/admin/service-catalog
 * 
 * ENDPOINTS:
 * 
 * CATALOG (Template-level):
 * GET    /template/:templateId                 - Get catalog for template
 * POST   /template/:templateId/seed            - Seed with default services
 * POST   /template/:templateId/service         - Add a service
 * PUT    /template/:templateId/service/:key    - Update a service
 * DELETE /template/:templateId/service/:key    - Remove a service
 * 
 * SWITCHBOARD (Company-level):
 * GET    /company/:companyId                   - Get company's switchboard
 * POST   /company/:companyId/sync              - Sync from catalog
 * PUT    /company/:companyId/toggle/:key       - Toggle a service
 * PUT    /company/:companyId/bulk              - Bulk update services
 * GET    /company/:companyId/check/:key        - Check if service enabled
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const logger = require('../../utils/logger');

// Models
const ServiceCatalog = require('../../models/ServiceCatalog');
const ServiceSwitchboard = require('../../models/ServiceSwitchboard');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const v2Company = require('../../models/v2Company');

// Default services
const { getHVACDefaultServices, getServiceStats } = require('../../services/serviceCatalog/hvacDefaultServices');

// ============================================================================
// CATALOG ROUTES (Template-level)
// ============================================================================

/**
 * GET /template/:templateId
 * Get the service catalog for a template
 */
router.get('/template/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        
        // Validate templateId
        if (!mongoose.Types.ObjectId.isValid(templateId)) {
            return res.status(400).json({ error: 'Invalid templateId' });
        }
        
        // Get the template
        const template = await GlobalInstantResponseTemplate.findById(templateId, 'name templateType industryLabel');
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Get or create catalog
        let catalog = await ServiceCatalog.findOne({ templateId });
        
        if (!catalog) {
            // Create empty catalog
            catalog = await ServiceCatalog.getOrCreateForTemplate(
                templateId,
                template.name,
                template.templateType || template.industryLabel || 'universal'
            );
        }
        
        logger.info('[SERVICE CATALOG] Retrieved catalog', {
            templateId,
            templateName: template.name,
            serviceCount: catalog.services.length
        });
        
        res.json({
            success: true,
            catalog: {
                _id: catalog._id,
                templateId: catalog.templateId,
                templateName: catalog.templateName,
                industryType: catalog.industryType,
                version: catalog.version,
                services: catalog.services,
                coverageTarget: catalog.coverageTarget,
                stats: catalog.getCoverageStats(),
                lastPublishedAt: catalog.lastPublishedAt,
                updatedAt: catalog.updatedAt
            }
        });
        
    } catch (error) {
        logger.error('[SERVICE CATALOG] Error getting catalog', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /template/:templateId/seed
 * Seed catalog with default services (HVAC or industry-specific)
 */
router.post('/template/:templateId/seed', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { industryType, clearExisting } = req.body;
        const seededBy = req.body.seededBy || req.user?.email || 'Platform Admin';
        
        // Validate templateId
        if (!mongoose.Types.ObjectId.isValid(templateId)) {
            return res.status(400).json({ error: 'Invalid templateId' });
        }
        
        // Get the template
        const template = await GlobalInstantResponseTemplate.findById(templateId, 'name templateType industryLabel');
        if (!template) {
            return res.status(404).json({ error: 'Template not found' });
        }
        
        // Get or create catalog
        let catalog = await ServiceCatalog.getOrCreateForTemplate(
            templateId,
            template.name,
            industryType || template.templateType || 'universal'
        );
        
        // Clear existing if requested
        if (clearExisting) {
            catalog.services = [];
            catalog.changeLog.push({
                action: 'catalog_reset',
                details: 'Cleared all services before seeding',
                changedBy: seededBy,
                changedAt: new Date()
            });
        }
        
        // Get default services based on industry
        let defaultServices = [];
        const industry = (industryType || template.templateType || 'hvac').toLowerCase();
        
        if (industry === 'hvac' || industry === 'universal') {
            defaultServices = getHVACDefaultServices();
        } else {
            // Future: Add other industry defaults
            defaultServices = getHVACDefaultServices(); // Fallback to HVAC for now
        }
        
        // Add services that don't already exist
        let addedCount = 0;
        const existingKeys = new Set(catalog.services.map(s => s.serviceKey));
        
        for (const service of defaultServices) {
            if (!existingKeys.has(service.serviceKey)) {
                catalog.services.push({
                    ...service,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    createdBy: seededBy,
                    updatedBy: seededBy
                });
                addedCount++;
            }
        }
        
        // Update catalog
        catalog.version += 1;
        catalog.updatedAt = new Date();
        catalog.updatedBy = seededBy;
        
        catalog.changeLog.push({
            action: 'catalog_created',
            details: `Seeded ${addedCount} services from ${industry} defaults`,
            changedBy: seededBy,
            changedAt: new Date()
        });
        
        await catalog.save();
        
        logger.info('[SERVICE CATALOG] Seeded catalog', {
            templateId,
            industry,
            addedCount,
            totalServices: catalog.services.length
        });
        
        res.json({
            success: true,
            message: `Seeded ${addedCount} services`,
            catalog: {
                _id: catalog._id,
                templateId: catalog.templateId,
                version: catalog.version,
                serviceCount: catalog.services.length,
                stats: catalog.getCoverageStats()
            }
        });
        
    } catch (error) {
        logger.error('[SERVICE CATALOG] Error seeding catalog', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /template/:templateId/service
 * Add a new service to the catalog
 */
router.post('/template/:templateId/service', async (req, res) => {
    try {
        const { templateId } = req.params;
        const serviceData = req.body;
        const addedBy = req.body.addedBy || req.user?.email || 'Platform Admin';
        
        // Validate required fields
        if (!serviceData.serviceKey || !serviceData.displayName) {
            return res.status(400).json({ 
                error: 'Missing required fields: serviceKey and displayName' 
            });
        }
        
        // Normalize serviceKey
        serviceData.serviceKey = serviceData.serviceKey.toLowerCase().replace(/\s+/g, '_');
        
        // Get catalog
        const catalog = await ServiceCatalog.findOne({ templateId });
        if (!catalog) {
            return res.status(404).json({ error: 'Catalog not found' });
        }
        
        // Add service
        await ServiceCatalog.addService(templateId, serviceData, addedBy);
        
        // Reload catalog
        const updatedCatalog = await ServiceCatalog.findOne({ templateId });
        
        logger.info('[SERVICE CATALOG] Added service', {
            templateId,
            serviceKey: serviceData.serviceKey,
            displayName: serviceData.displayName
        });
        
        res.json({
            success: true,
            message: `Added service: ${serviceData.displayName}`,
            service: updatedCatalog.getService(serviceData.serviceKey),
            catalogVersion: updatedCatalog.version
        });
        
    } catch (error) {
        logger.error('[SERVICE CATALOG] Error adding service', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /template/:templateId/service/:key
 * Update an existing service
 */
router.put('/template/:templateId/service/:key', async (req, res) => {
    try {
        const { templateId, key } = req.params;
        const updates = req.body;
        const updatedBy = req.body.updatedBy || req.user?.email || 'Platform Admin';
        
        // Get catalog
        const catalog = await ServiceCatalog.findOne({ templateId });
        if (!catalog) {
            return res.status(404).json({ error: 'Catalog not found' });
        }
        
        // Check if service exists
        const service = catalog.getService(key);
        if (!service) {
            return res.status(404).json({ error: `Service "${key}" not found` });
        }
        
        // Update service
        await catalog.updateService(key, updates, updatedBy);
        
        logger.info('[SERVICE CATALOG] Updated service', {
            templateId,
            serviceKey: key,
            updates: Object.keys(updates)
        });
        
        res.json({
            success: true,
            message: `Updated service: ${key}`,
            service: catalog.getService(key),
            catalogVersion: catalog.version
        });
        
    } catch (error) {
        logger.error('[SERVICE CATALOG] Error updating service', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * DELETE /template/:templateId/service/:key
 * Remove a service from the catalog
 */
router.delete('/template/:templateId/service/:key', async (req, res) => {
    try {
        const { templateId, key } = req.params;
        const removedBy = req.query.removedBy || req.user?.email || 'Platform Admin';
        
        // Get catalog
        const catalog = await ServiceCatalog.findOne({ templateId });
        if (!catalog) {
            return res.status(404).json({ error: 'Catalog not found' });
        }
        
        // Remove service
        await catalog.removeService(key, removedBy);
        
        logger.info('[SERVICE CATALOG] Removed service', {
            templateId,
            serviceKey: key
        });
        
        res.json({
            success: true,
            message: `Removed service: ${key}`,
            catalogVersion: catalog.version
        });
        
    } catch (error) {
        logger.error('[SERVICE CATALOG] Error removing service', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// ============================================================================
// SWITCHBOARD ROUTES (Company-level)
// ============================================================================

/**
 * GET /company/:companyId
 * Get company's service switchboard (enriched with catalog data)
 */
router.get('/company/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { templateId } = req.query;
        
        // Validate companyId
        if (!mongoose.Types.ObjectId.isValid(companyId)) {
            return res.status(400).json({ error: 'Invalid companyId' });
        }
        
        // Get company
        const company = await v2Company.findById(companyId, 'companyName aiAgentSettings.templateReferences');
        if (!company) {
            return res.status(404).json({ error: 'Company not found' });
        }
        
        // Determine templateId
        let targetTemplateId = templateId;
        if (!targetTemplateId) {
            // Use primary template from company
            const primaryRef = company.aiAgentSettings?.templateReferences?.find(r => r.enabled !== false);
            if (primaryRef) {
                targetTemplateId = primaryRef.templateId;
            }
        }
        
        if (!targetTemplateId) {
            return res.status(400).json({ 
                error: 'No templateId provided and company has no templates bound' 
            });
        }
        
        // Get template name
        const template = await GlobalInstantResponseTemplate.findById(targetTemplateId, 'name');
        
        // Get or create switchboard
        const switchboard = await ServiceSwitchboard.getOrCreateForCompany(
            companyId,
            targetTemplateId,
            {
                companyName: company.companyName,
                templateName: template?.name || 'Unknown'
            }
        );
        
        // Get catalog for additional context (display names, categories)
        const catalog = await ServiceCatalog.findOne({ templateId: targetTemplateId });
        
        // Build a map of catalog services for enrichment
        const catalogMap = new Map();
        if (catalog) {
            for (const svc of catalog.services) {
                catalogMap.set(svc.serviceKey, {
                    displayName: svc.displayName,
                    category: svc.category,
                    description: svc.description,
                    declineMessage: svc.declineMessage
                });
            }
        }
        
        // Enrich switchboard services with catalog data
        const enrichedServices = switchboard.services.map(s => {
            const catalogInfo = catalogMap.get(s.serviceKey) || {};
            return {
                serviceKey: s.serviceKey,
                enabled: s.enabled,
                source: s.source,
                customDeclineMessage: s.customDeclineMessage,
                // Enriched from catalog
                displayName: catalogInfo.displayName || s.serviceKey,
                category: catalogInfo.category || 'General',
                description: catalogInfo.description || '',
                defaultDeclineMessage: catalogInfo.declineMessage
            };
        });
        
        // Sort by category, then by displayName
        enrichedServices.sort((a, b) => {
            if (a.category !== b.category) {
                return a.category.localeCompare(b.category);
            }
            return a.displayName.localeCompare(b.displayName);
        });
        
        logger.info('[SERVICE SWITCHBOARD] Retrieved switchboard', {
            companyId,
            templateId: targetTemplateId,
            enabledCount: switchboard.stats.enabledCount,
            disabledCount: switchboard.stats.disabledCount
        });
        
        res.json({
            success: true,
            switchboard: {
                ...switchboard.toExport(),
                services: enrichedServices // Replace with enriched version
            },
            catalogAvailable: !!catalog,
            catalogVersion: catalog?.version || 0,
            needsSync: catalog ? (switchboard.catalogVersion !== catalog.version) : false
        });
        
    } catch (error) {
        logger.error('[SERVICE SWITCHBOARD] Error getting switchboard', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /company/:companyId/sync
 * Sync switchboard from catalog (adds new services)
 */
router.post('/company/:companyId/sync', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { templateId } = req.body;
        const syncedBy = req.body.syncedBy || req.user?.email || 'admin';
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        // Get catalog
        const catalog = await ServiceCatalog.findOne({ templateId });
        if (!catalog) {
            return res.status(404).json({ error: 'Catalog not found' });
        }
        
        // Get switchboard
        const switchboard = await ServiceSwitchboard.findOne({ companyId, templateId });
        if (!switchboard) {
            return res.status(404).json({ error: 'Switchboard not found' });
        }
        
        // Sync
        const result = await switchboard.syncFromCatalog(catalog, syncedBy);
        
        logger.info('[SERVICE SWITCHBOARD] Synced from catalog', {
            companyId,
            templateId,
            addedCount: result.addedCount,
            removedKeys: result.removedKeys
        });
        
        res.json({
            success: true,
            message: `Synced: ${result.addedCount} services added`,
            addedCount: result.addedCount,
            removedKeys: result.removedKeys,
            catalogVersion: switchboard.catalogVersion
        });
        
    } catch (error) {
        logger.error('[SERVICE SWITCHBOARD] Error syncing', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /company/:companyId/toggle/:key
 * Toggle a single service on/off
 */
router.put('/company/:companyId/toggle/:key', async (req, res) => {
    try {
        const { companyId, key } = req.params;
        const { templateId, enabled, source, customDeclineMessage } = req.body;
        const updatedBy = req.body.updatedBy || req.user?.email || 'admin';
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        // Get switchboard
        const switchboard = await ServiceSwitchboard.findOne({ companyId, templateId });
        if (!switchboard) {
            return res.status(404).json({ error: 'Switchboard not found' });
        }
        
        // Update toggle
        await switchboard.setServiceToggle(key, {
            enabled,
            source,
            customDeclineMessage
        }, updatedBy);
        
        logger.info('[SERVICE SWITCHBOARD] Toggled service', {
            companyId,
            serviceKey: key,
            enabled,
            source
        });
        
        res.json({
            success: true,
            message: `Service "${key}" ${enabled ? 'enabled' : 'disabled'}`,
            toggle: switchboard.getServiceToggle(key),
            stats: switchboard.stats
        });
        
    } catch (error) {
        logger.error('[SERVICE SWITCHBOARD] Error toggling service', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * PUT /company/:companyId/bulk
 * Bulk update multiple services
 */
router.put('/company/:companyId/bulk', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { templateId, updates } = req.body;
        const updatedBy = req.body.updatedBy || req.user?.email || 'admin';
        
        if (!templateId || !Array.isArray(updates)) {
            return res.status(400).json({ error: 'templateId and updates array required' });
        }
        
        // Bulk update
        const switchboard = await ServiceSwitchboard.bulkUpdateServices(
            companyId,
            templateId,
            updates,
            updatedBy
        );
        
        logger.info('[SERVICE SWITCHBOARD] Bulk updated', {
            companyId,
            templateId,
            updateCount: updates.length
        });
        
        res.json({
            success: true,
            message: `Updated ${updates.length} services`,
            stats: switchboard.stats
        });
        
    } catch (error) {
        logger.error('[SERVICE SWITCHBOARD] Error bulk updating', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /company/:companyId/check/:key
 * Check if a specific service is enabled (for runtime)
 */
router.get('/company/:companyId/check/:key', async (req, res) => {
    try {
        const { companyId, key } = req.params;
        const { templateId } = req.query;
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId query param required' });
        }
        
        const result = await ServiceSwitchboard.checkService(companyId, templateId, key);
        
        if (!result) {
            return res.json({
                success: true,
                serviceKey: key,
                found: false,
                enabled: null,
                message: 'Service not found in catalog or switchboard'
            });
        }
        
        res.json({
            success: true,
            serviceKey: key,
            found: true,
            enabled: result.enabled,
            source: result.source,
            declineMessage: result.declineMessage
        });
        
    } catch (error) {
        logger.error('[SERVICE SWITCHBOARD] Error checking service', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /defaults/hvac
 * Get HVAC default services (for reference)
 */
router.get('/defaults/hvac', (req, res) => {
    res.json({
        success: true,
        industryType: 'hvac',
        services: getHVACDefaultServices(),
        stats: getServiceStats()
    });
});

module.exports = router;
