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
 * 
 * V1.2 UPSERT LOGIC:
 * - Inserts any new serviceKeys not in DB
 * - Backfills new V1.2 fields (serviceType, routesTo, triageMode, etc.) on existing services
 * - NEVER overwrites admin customizations (keywords, messages, etc.)
 * - Returns detailed summary: added, updated, skipped
 */
router.post('/template/:templateId/seed', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { industryType, clearExisting, forceUpdate } = req.body;
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
        
        // Clear existing if requested (destructive - use with caution)
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
        
        // Build existing services map for O(1) lookup
        const existingMap = new Map(
            catalog.services.map((s, idx) => [s.serviceKey, { service: s, index: idx }])
        );
        
        // Track changes
        let added = 0;
        let updated = 0;
        let skipped = 0;
        const changes = [];
        
        // V1.2 fields to backfill (only if missing in DB)
        const V12_BACKFILL_FIELDS = [
            'serviceType',
            'routesTo',
            'triageMode',
            'triagePrompts',
            'adminHandler',
            'disabledBehavior',
            'scenarioHints'
        ];
        
        for (const defaultService of defaultServices) {
            const existing = existingMap.get(defaultService.serviceKey);
            
            if (!existing) {
                // NEW SERVICE - Add it
                catalog.services.push({
                    ...defaultService,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                    createdBy: seededBy,
                    updatedBy: seededBy
                });
                added++;
                changes.push({ action: 'added', key: defaultService.serviceKey, type: defaultService.serviceType || 'work' });
                continue;
            }
            
            // EXISTING SERVICE - Backfill V1.2 fields if missing
            const existingService = existing.service;
            let wasUpdated = false;
            const fieldsUpdated = [];
            
            for (const field of V12_BACKFILL_FIELDS) {
                const existingValue = existingService[field];
                const defaultValue = defaultService[field];
                
                // Only backfill if:
                // 1. Field is missing/undefined/null in existing
                // 2. Default has a value
                // 3. OR forceUpdate is true (admin explicitly wants to overwrite)
                const isEmpty = existingValue === undefined || 
                               existingValue === null || 
                               (Array.isArray(existingValue) && existingValue.length === 0);
                
                if ((isEmpty || forceUpdate) && defaultValue !== undefined && defaultValue !== null) {
                    existingService[field] = defaultValue;
                    fieldsUpdated.push(field);
                    wasUpdated = true;
                }
            }
            
            // Backfill keywords ONLY if empty (never overwrite admin customizations)
            if (Array.isArray(defaultService.intentKeywords) && 
                defaultService.intentKeywords.length > 0 &&
                (!Array.isArray(existingService.intentKeywords) || existingService.intentKeywords.length === 0)) {
                existingService.intentKeywords = defaultService.intentKeywords;
                fieldsUpdated.push('intentKeywords');
                wasUpdated = true;
            }
            
            if (wasUpdated) {
                existingService.updatedAt = new Date();
                existingService.updatedBy = seededBy;
                updated++;
                changes.push({ 
                    action: 'updated', 
                    key: defaultService.serviceKey, 
                    fields: fieldsUpdated,
                    type: existingService.serviceType || 'work'
                });
            } else {
                skipped++;
            }
        }
        
        // Update catalog metadata
        catalog.version += 1;
        catalog.updatedAt = new Date();
        catalog.updatedBy = seededBy;
        
        // Calculate service type counts
        const typeCounts = {
            work: catalog.services.filter(s => (s.serviceType || 'work') === 'work').length,
            symptom: catalog.services.filter(s => s.serviceType === 'symptom').length,
            admin: catalog.services.filter(s => s.serviceType === 'admin').length
        };
        
        // Use valid enum values: service_added, service_removed, service_updated, catalog_created, catalog_reset
        // For seed operations, use 'catalog_created' (covers both initial seed and updates)
        if (added > 0 || updated > 0) {
            catalog.changeLog.push({
                action: 'catalog_created',
                details: `V1.2 sync: Added ${added}, Updated ${updated}, Skipped ${skipped}. Types: ${typeCounts.work} work, ${typeCounts.symptom} symptom, ${typeCounts.admin} admin`,
                changedBy: seededBy,
                changedAt: new Date()
            });
        }
        
        await catalog.save();
        
        logger.info('[SERVICE CATALOG] V1.2 seed complete', {
            templateId,
            industry,
            summary: { added, updated, skipped },
            typeCounts,
            totalServices: catalog.services.length
        });
        
        res.json({
            success: true,
            message: added > 0 
                ? `Added ${added} new services, updated ${updated} existing` 
                : (updated > 0 ? `Updated ${updated} services with V1.2 fields` : 'Catalog already up to date'),
            summary: {
                added,
                updated,
                skipped,
                totalDefaults: defaultServices.length,
                totalNow: catalog.services.length
            },
            typeCounts,
            changes: changes.slice(0, 20), // Limit to first 20 for response size
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
        
        // Build a map of catalog services for enrichment (V1.2 - includes serviceType)
        const catalogMap = new Map();
        if (catalog) {
            for (const svc of catalog.services) {
                catalogMap.set(svc.serviceKey, {
                    displayName: svc.displayName,
                    category: svc.category,
                    description: svc.description,
                    declineMessage: svc.declineMessage,
                    // V1.2 fields
                    serviceType: svc.serviceType || 'work',
                    routesTo: svc.routesTo || [],
                    triageMode: svc.triageMode || 'light',
                    triagePrompts: svc.triagePrompts || [],
                    adminHandler: svc.adminHandler || null,
                    disabledBehavior: svc.disabledBehavior || null
                });
            }
        }
        
        // Enrich switchboard services with catalog data (V1.2)
        const enrichedServices = switchboard.services.map(s => {
            const catalogInfo = catalogMap.get(s.serviceKey) || {};
            
            // Compute effectiveSource from sourcePolicy
            // auto = system determines (global unless company has local scenarios)
            // force_global = always global
            // force_companyLocal = always local (requires local scenarios)
            const sourcePolicy = s.sourcePolicy || 'auto';
            let effectiveSource = 'global'; // Default
            if (sourcePolicy === 'force_companyLocal') {
                effectiveSource = 'companyLocal';
            } else if (sourcePolicy === 'auto') {
                // For V1.2, default to global unless we detect local scenarios
                // Future: Actually check for company-local scenarios
                effectiveSource = 'global';
            }
            
            return {
                serviceKey: s.serviceKey,
                enabled: s.enabled,
                sourcePolicy: sourcePolicy,
                effectiveSource: effectiveSource,
                triageEnabled: s.triageEnabled ?? true,
                customDeclineMessage: s.customDeclineMessage,
                additionalKeywords: s.additionalKeywords || [],
                agentNotes: s.agentNotes || '',
                // Enriched from catalog
                displayName: catalogInfo.displayName || s.serviceKey,
                category: catalogInfo.category || 'General',
                description: catalogInfo.description || '',
                defaultDeclineMessage: catalogInfo.declineMessage,
                // V1.2 service type info
                serviceType: catalogInfo.serviceType || 'work',
                routesTo: catalogInfo.routesTo || [],
                triageMode: catalogInfo.triageMode || 'light',
                triagePrompts: catalogInfo.triagePrompts || [],
                adminHandler: catalogInfo.adminHandler || null,
                disabledBehavior: catalogInfo.disabledBehavior || null
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
 * Toggle a single service on/off (V1.2 - uses sourcePolicy, triageEnabled)
 */
router.put('/company/:companyId/toggle/:key', async (req, res) => {
    try {
        const { companyId, key } = req.params;
        const { 
            templateId, 
            enabled, 
            sourcePolicy,      // V1.2: replaces 'source'
            triageEnabled,     // V1.2: for SYMPTOM services
            customDeclineMessage,
            additionalKeywords,
            agentNotes
        } = req.body;
        const updatedBy = req.body.updatedBy || req.user?.email || 'admin';
        
        if (!templateId) {
            return res.status(400).json({ error: 'templateId required' });
        }
        
        // Get switchboard
        const switchboard = await ServiceSwitchboard.findOne({ companyId, templateId });
        if (!switchboard) {
            return res.status(404).json({ error: 'Switchboard not found' });
        }
        
        // Build settings object (only include provided fields)
        const settings = {};
        if (enabled !== undefined) settings.enabled = enabled;
        if (sourcePolicy !== undefined) settings.sourcePolicy = sourcePolicy;
        if (triageEnabled !== undefined) settings.triageEnabled = triageEnabled;
        if (customDeclineMessage !== undefined) settings.customDeclineMessage = customDeclineMessage;
        if (additionalKeywords !== undefined) settings.additionalKeywords = additionalKeywords;
        if (agentNotes !== undefined) settings.agentNotes = agentNotes;
        
        // Update toggle
        await switchboard.setServiceToggle(key, settings, updatedBy);
        
        logger.info('[SERVICE SWITCHBOARD] Toggled service', {
            companyId,
            serviceKey: key,
            enabled,
            sourcePolicy
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
 * Check if a specific service is enabled (for runtime - V1.2)
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
            sourcePolicy: result.sourcePolicy,
            triageEnabled: result.triageEnabled,
            declineMessage: result.declineMessage,
            agentNotes: result.agentNotes
        });
        
    } catch (error) {
        logger.error('[SERVICE SWITCHBOARD] Error checking service', { error: error.message });
        res.status(500).json({ error: error.message });
    }
});

/**
 * GET /company/:companyId/export
 * Export full catalog + switchboard as JSON (V1.2)
 * For review, debugging, and backup
 */
router.get('/company/:companyId/export', async (req, res) => {
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
            const primaryRef = company.aiAgentSettings?.templateReferences?.find(r => r.enabled !== false);
            if (primaryRef) {
                targetTemplateId = primaryRef.templateId;
            }
        }
        
        if (!targetTemplateId) {
            return res.status(400).json({ error: 'No templateId provided' });
        }
        
        // Get template
        const template = await GlobalInstantResponseTemplate.findById(targetTemplateId, 'name');
        
        // Get catalog
        const catalog = await ServiceCatalog.findOne({ templateId: targetTemplateId });
        
        // Get switchboard
        const switchboard = await ServiceSwitchboard.findOne({ companyId, templateId: targetTemplateId });
        
        // Build comprehensive export
        const exportData = {
            exportVersion: '1.2',
            exportedAt: new Date().toISOString(),
            
            company: {
                companyId,
                companyName: company.companyName
            },
            
            template: {
                templateId: targetTemplateId,
                templateName: template?.name || 'Unknown'
            },
            
            catalog: catalog ? {
                version: catalog.version,
                industryType: catalog.industryType,
                serviceCount: catalog.services.length,
                services: catalog.services.map(s => ({
                    serviceKey: s.serviceKey,
                    displayName: s.displayName,
                    category: s.category,
                    serviceType: s.serviceType || 'work',
                    routesTo: s.routesTo || [],
                    triageMode: s.triageMode || 'light',
                    adminHandler: s.adminHandler || null,
                    intentKeywords: s.intentKeywords || [],
                    declineMessage: s.declineMessage
                }))
            } : null,
            
            switchboard: switchboard ? {
                globalEnabled: switchboard.globalEnabled,
                catalogVersion: switchboard.catalogVersion,
                lastSyncedAt: switchboard.lastSyncedAt,
                services: switchboard.services.map(s => ({
                    serviceKey: s.serviceKey,
                    enabled: s.enabled,
                    sourcePolicy: s.sourcePolicy || 'auto',
                    triageEnabled: s.triageEnabled ?? true,
                    customDeclineMessage: s.customDeclineMessage,
                    additionalKeywords: s.additionalKeywords || [],
                    agentNotes: s.agentNotes || ''
                }))
            } : null,
            
            stats: {
                catalog: catalog ? {
                    total: catalog.services.length,
                    work: catalog.services.filter(s => (s.serviceType || 'work') === 'work').length,
                    symptom: catalog.services.filter(s => s.serviceType === 'symptom').length,
                    admin: catalog.services.filter(s => s.serviceType === 'admin').length
                } : null,
                switchboard: switchboard ? {
                    total: switchboard.services.length,
                    enabled: switchboard.services.filter(s => s.enabled).length,
                    disabled: switchboard.services.filter(s => !s.enabled).length
                } : null
            }
        };
        
        logger.info('[SERVICE EXPORT] Exported catalog + switchboard', {
            companyId,
            templateId: targetTemplateId
        });
        
        res.json({
            success: true,
            export: exportData
        });
        
    } catch (error) {
        logger.error('[SERVICE EXPORT] Error exporting', { error: error.message });
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
