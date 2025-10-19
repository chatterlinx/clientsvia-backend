/**
 * ============================================================================
 * V2 FILLER FILTER ROUTES
 * ============================================================================
 * 
 * PURPOSE: Modern filler words management with template inheritance
 * 
 * ENDPOINTS:
 * GET    /api/company/:companyId/configuration/filler-filter
 *        → Get inherited + custom filler words
 * 
 * POST   /api/company/:companyId/configuration/filler-filter/scan
 *        → Force scan templates for inherited filler words
 * 
 * POST   /api/company/:companyId/configuration/filler-filter/custom
 *        → Add a custom filler word
 * 
 * DELETE /api/company/:companyId/configuration/filler-filter/custom/:word
 *        → Remove a custom filler word
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const v2Company = require('../../models/v2Company');
const GlobalAIBehaviorTemplate = require('../../models/GlobalAIBehaviorTemplate');
const { redisClient } = require('../../clients/index');

/**
 * GET /api/company/:companyId/configuration/filler-filter
 * Get all filler words (inherited + custom)
 */
router.get('/company/:companyId/configuration/filler-filter', async (req, res) => {
    const { companyId } = req.params;
    
    console.log(`🔇 [FILLER FILTER] GET for company: ${companyId}`);
    
    try {
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        // Get active template IDs
        const activeTemplateIds = company.aiAgentSettings?.activeTemplates || [];
        
        console.log(`🔇 [FILLER FILTER] Active templates: ${activeTemplateIds.length}`);
        
        let inheritedFillers = [];
        
        // Fetch inherited filler words from active templates
        if (activeTemplateIds.length > 0) {
            const templates = await GlobalAIBehaviorTemplate.find({
                _id: { $in: activeTemplateIds }
            }).select('fillerWords categories');
            
            console.log(`🔇 [FILLER FILTER] Found ${templates.length} active templates`);
            
            // Merge all filler words from all templates
            const allFillers = new Set();
            
            // Get fillerWords from template root level
            templates.forEach(template => {
                if (template.fillerWords && Array.isArray(template.fillerWords)) {
                    template.fillerWords.forEach(word => {
                        if (word && typeof word === 'string') {
                            allFillers.add(word.toLowerCase().trim());
                        }
                    });
                }
                
                // ALSO scan scenarios for any embedded filler references
                // (Future enhancement: extract fillers from scenario trigger words)
            });
            
            console.log(`🔇 [FILLER FILTER] Extracted ${allFillers.size} unique inherited fillers`);
            
            inheritedFillers = Array.from(allFillers).sort();
        }
        
        // Get custom filler words (company-specific)
        console.log(`🔇 [FILLER FILTER DEBUG] company.aiAgentSettings:`, company.aiAgentSettings ? 'EXISTS' : 'NULL');
        console.log(`🔇 [FILLER FILTER DEBUG] company.aiAgentSettings.fillerWords:`, company.aiAgentSettings?.fillerWords ? 'EXISTS' : 'NULL');
        console.log(`🔇 [FILLER FILTER DEBUG] company.aiAgentSettings.fillerWords.custom:`, company.aiAgentSettings?.fillerWords?.custom);
        
        const customFillers = (company.aiAgentSettings?.fillerWords?.custom || []).sort();
        
        console.log(`🔇 [FILLER FILTER DEBUG] Final customFillers array:`, customFillers);
        
        // Build detailed scan report
        const scanReport = [];
        if (activeTemplateIds.length > 0) {
            templates.forEach(template => {
                const templateFillers = template.fillerWords || [];
                const categoryCount = template.categories ? template.categories.length : 0;
                const scenarioCount = template.categories ? 
                    template.categories.reduce((sum, cat) => sum + (cat.scenarios ? cat.scenarios.length : 0), 0) : 0;
                
                scanReport.push({
                    templateName: template.name || 'Unknown Template',
                    templateId: template._id.toString(),
                    categories: categoryCount,
                    scenarios: scenarioCount,
                    fillers: templateFillers.length
                });
            });
        }
        
        console.log(`✅ [FILLER FILTER] Inherited: ${inheritedFillers.length}, Custom: ${customFillers.length}`);
        console.log(`📋 [FILLER FILTER] Scan report:`, scanReport);
        
        res.json({
            success: true,
            inheritedFillers,
            customFillers,
            scanStatus: {
                lastScan: company.aiAgentSettings?.fillerWords?.lastScan || null,
                activeTemplatesScanned: activeTemplateIds.length,
                scanReport
            }
        });
        
    } catch (error) {
        console.error('❌ [FILLER FILTER] Error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch filler filter data',
            message: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/configuration/filler-filter/scan
 * Force scan templates for inherited filler words with detailed logging
 */
router.post('/company/:companyId/configuration/filler-filter/scan', async (req, res) => {
    const { companyId } = req.params;
    const scanStartTime = Date.now();
    
    console.log(`🔇 [FILLER FILTER SCAN] ━━━ STARTING FORCE SCAN ━━━`);
    console.log(`🔇 [FILLER FILTER SCAN] Company ID: ${companyId}`);
    console.log(`🔇 [FILLER FILTER SCAN] Timestamp: ${new Date().toISOString()}`);
    
    try {
        // Step 1: Find company
        console.log(`🔇 [SCAN STEP 1/6] Fetching company data...`);
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ 
                success: false, 
                error: 'Company not found',
                scanLog: ['❌ Company not found in database']
            });
        }
        console.log(`✅ [SCAN STEP 1/6] Company found: ${company.companyName}`);
        
        // Step 2: Get active templates
        console.log(`🔇 [SCAN STEP 2/6] Checking active templates...`);
        const activeTemplateIds = company.aiAgentSettings?.activeTemplates || [];
        console.log(`📊 [SCAN STEP 2/6] Active templates count: ${activeTemplateIds.length}`);
        
        if (activeTemplateIds.length === 0) {
            console.log(`⚠️ [SCAN STEP 2/6] NO ACTIVE TEMPLATES - Scan aborted`);
            
            // Record scan in history
            const scanHistoryEntry = {
                scanDate: new Date(),
                templatesScanned: [],
                totalFillersFound: 0,
                newFillersAdded: 0,
                newFillers: [],
                status: 'no_templates',
                message: 'No active templates to scan',
                triggeredBy: 'manual'
            };
            
            if (!company.aiAgentSettings) company.aiAgentSettings = {};
            if (!company.aiAgentSettings.fillerWords) company.aiAgentSettings.fillerWords = {};
            if (!company.aiAgentSettings.fillerWords.scanHistory) company.aiAgentSettings.fillerWords.scanHistory = [];
            
            company.aiAgentSettings.fillerWords.scanHistory.push(scanHistoryEntry);
            company.markModified('aiAgentSettings');
            await company.save();
            
            return res.json({
                success: true,
                status: 'no_templates',
                message: 'No active templates to scan',
                scanReport: {
                    templatesScanned: [],
                    totalFillersFound: 0,
                    newFillersAdded: 0,
                    newFillers: [],
                    scanDuration: Date.now() - scanStartTime
                },
                scanLog: [
                    '🔍 Starting filler word scan...',
                    '✅ Company found: ' + company.companyName,
                    '⚠️ No active templates found',
                    '📋 Scan Status: NO TEMPLATES',
                    '⏱️ Scan completed in ' + (Date.now() - scanStartTime) + 'ms'
                ]
            });
        }
        
        // Step 3: Fetch templates from database
        console.log(`🔇 [SCAN STEP 3/6] Fetching template data from Global AI Brain...`);
        const templates = await GlobalAIBehaviorTemplate.find({
            _id: { $in: activeTemplateIds }
        }).select('name fillerWords categories');
        
        console.log(`✅ [SCAN STEP 3/6] Retrieved ${templates.length} templates`);
        
        // Step 4: Extract filler words from all templates
        console.log(`🔇 [SCAN STEP 4/6] Extracting filler words from templates...`);
        
        const templatesScanned = [];
        const allFillersFound = new Set();
        
        templates.forEach((template, index) => {
            console.log(`   📄 [Template ${index + 1}/${templates.length}] Scanning: ${template.name}`);
            
            const templateFillers = template.fillerWords || [];
            const categoryCount = template.categories ? template.categories.length : 0;
            const scenarioCount = template.categories ? 
                template.categories.reduce((sum, cat) => sum + (cat.scenarios ? cat.scenarios.length : 0), 0) : 0;
            
            console.log(`      Categories: ${categoryCount} | Scenarios: ${scenarioCount} | Fillers: ${templateFillers.length}`);
            
            templateFillers.forEach(word => {
                if (word && typeof word === 'string') {
                    allFillersFound.add(word.toLowerCase().trim());
                }
            });
            
            templatesScanned.push({
                templateId: template._id.toString(),
                templateName: template.name,
                categoriesCount: categoryCount,
                scenariosCount: scenarioCount,
                fillersFound: templateFillers.length,
                fillerWords: templateFillers
            });
        });
        
        console.log(`✅ [SCAN STEP 4/6] Total unique fillers extracted: ${allFillersFound.size}`);
        
        // Step 5: Compare with existing inherited fillers
        console.log(`🔇 [SCAN STEP 5/6] Analyzing changes...`);
        const existingInherited = company.aiAgentSettings?.fillerWords?.inherited || [];
        const existingInheritedSet = new Set(existingInherited.map(w => w.toLowerCase().trim()));
        
        const newFillers = Array.from(allFillersFound).filter(word => !existingInheritedSet.has(word));
        
        console.log(`   📊 Existing inherited fillers: ${existingInherited.length}`);
        console.log(`   📊 New fillers found: ${newFillers.length}`);
        
        if (newFillers.length > 0) {
            console.log(`   🆕 New fillers: ${newFillers.join(', ')}`);
        } else {
            console.log(`   ✅ No new fillers - all ${allFillersFound.size} fillers are already registered`);
        }
        
        // Step 6: Update company with new inherited fillers
        console.log(`🔇 [SCAN STEP 6/6] Updating company record...`);
        
        if (!company.aiAgentSettings) company.aiAgentSettings = {};
        if (!company.aiAgentSettings.fillerWords) company.aiAgentSettings.fillerWords = {};
        if (!company.aiAgentSettings.fillerWords.scanHistory) company.aiAgentSettings.fillerWords.scanHistory = [];
        
        // Update inherited fillers list
        company.aiAgentSettings.fillerWords.inherited = Array.from(allFillersFound).sort();
        
        // Record scan in history
        const scanHistoryEntry = {
            scanDate: new Date(),
            templatesScanned,
            totalFillersFound: allFillersFound.size,
            newFillersAdded: newFillers.length,
            newFillers,
            status: allFillersFound.size === 0 ? 'no_fillers' : 'success',
            message: allFillersFound.size === 0 ? 
                'Scan completed - no filler words found in templates' : 
                `Scan completed - ${allFillersFound.size} total fillers (${newFillers.length} new)`,
            triggeredBy: 'manual'
        };
        
        company.aiAgentSettings.fillerWords.scanHistory.push(scanHistoryEntry);
        
        // Keep only last 50 scans
        if (company.aiAgentSettings.fillerWords.scanHistory.length > 50) {
            company.aiAgentSettings.fillerWords.scanHistory = 
                company.aiAgentSettings.fillerWords.scanHistory.slice(-50);
        }
        
        company.markModified('aiAgentSettings');
        await company.save();
        
        console.log(`✅ [SCAN STEP 6/6] Company record updated`);
        console.log(`✅ [FILLER FILTER SCAN] ━━━ SCAN COMPLETE ━━━`);
        console.log(`⏱️ [FILLER FILTER SCAN] Duration: ${Date.now() - scanStartTime}ms`);
        
        // Build detailed scan log for UI
        const scanLog = [
            '🔍 Starting filler word scan...',
            `✅ Company found: ${company.companyName}`,
            `📊 Active templates: ${templates.length}`,
            ''
        ];
        
        templates.forEach((template, index) => {
            const templateData = templatesScanned[index];
            scanLog.push(`📄 Template ${index + 1}: ${template.name}`);
            scanLog.push(`   ├─ Categories: ${templateData.categoriesCount}`);
            scanLog.push(`   ├─ Scenarios: ${templateData.scenariosCount}`);
            scanLog.push(`   └─ Fillers: ${templateData.fillersFound}`);
            if (templateData.fillersFound > 0) {
                scanLog.push(`      ${templateData.fillerWords.slice(0, 10).join(', ')}${templateData.fillersFound > 10 ? '...' : ''}`);
            }
            scanLog.push('');
        });
        
        scanLog.push(`📊 Total unique fillers found: ${allFillersFound.size}`);
        scanLog.push(`🆕 New fillers added: ${newFillers.length}`);
        
        if (newFillers.length > 0) {
            scanLog.push(`   ${newFillers.join(', ')}`);
        } else if (allFillersFound.size > 0) {
            scanLog.push(`   ✅ All ${allFillersFound.size} fillers are already registered`);
        }
        
        scanLog.push('');
        scanLog.push(`✅ Scan Status: ${scanHistoryEntry.status.toUpperCase()}`);
        scanLog.push(`⏱️ Scan completed in ${Date.now() - scanStartTime}ms`);
        
        res.json({
            success: true,
            status: scanHistoryEntry.status,
            message: scanHistoryEntry.message,
            scanReport: {
                templatesScanned,
                totalFillersFound: allFillersFound.size,
                newFillersAdded: newFillers.length,
                newFillers,
                scanDuration: Date.now() - scanStartTime
            },
            scanLog
        });
        
    } catch (error) {
        console.error('❌ [FILLER FILTER SCAN] Fatal error:', error);
        console.error(error.stack);
        
        res.status(500).json({
            success: false,
            status: 'error',
            error: 'Failed to complete scan',
            message: error.message,
            scanLog: [
                '🔍 Starting filler word scan...',
                '❌ Error occurred during scan',
                `Error: ${error.message}`,
                '⏱️ Scan aborted after ' + (Date.now() - scanStartTime) + 'ms'
            ]
        });
    }
});

/**
 * POST /api/company/:companyId/configuration/filler-filter/custom
 * Add a custom filler word
 */
router.post('/company/:companyId/configuration/filler-filter/custom', async (req, res) => {
    console.log(`🔥 [FILLER FILTER] ━━━ POST CUSTOM FILLER ROUTE HIT ━━━`);
    console.log(`🔥 [FILLER FILTER] Full URL: ${req.originalUrl}`);
    console.log(`🔥 [FILLER FILTER] Method: ${req.method}`);
    console.log(`🔥 [FILLER FILTER] Params:`, req.params);
    console.log(`🔥 [FILLER FILTER] Body:`, req.body);
    
    const { companyId } = req.params;
    const { word } = req.body;
    
    console.log(`🔇 [FILLER FILTER] ADD custom filler for company: ${companyId} - "${word}"`);
    
    try {
        if (!word || !word.trim()) {
            return res.status(400).json({ success: false, error: 'Word is required' });
        }
        
        const cleanWord = word.trim().toLowerCase();
        
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        // Initialize if needed
        if (!company.aiAgentSettings) {
            company.aiAgentSettings = {};
        }
        if (!company.aiAgentSettings.fillerWords) {
            company.aiAgentSettings.fillerWords = {};
        }
        if (!company.aiAgentSettings.fillerWords.custom) {
            company.aiAgentSettings.fillerWords.custom = [];
        }
        
        // Check if already exists
        if (company.aiAgentSettings.fillerWords.custom.includes(cleanWord)) {
            return res.status(400).json({ success: false, error: 'Word already exists' });
        }
        
        // Add to custom list
        company.aiAgentSettings.fillerWords.custom.push(cleanWord);
        company.markModified('aiAgentSettings');
        await company.save();
        
        console.log(`✅ [FILLER FILTER] Added custom filler: "${cleanWord}"`);
        
        // 🔥 CRITICAL: Clear Redis cache to force fresh data load
        try {
            if (redisClient) {
                await redisClient.del(`company:${companyId}`);
                console.log(`✅ [FILLER FILTER] Redis cache cleared for company:${companyId}`);
            }
        } catch (redisError) {
            console.error('⚠️ [FILLER FILTER] Redis cache clear failed (non-fatal):', redisError.message);
        }
        
        res.json({
            success: true,
            message: 'Custom filler added',
            word: cleanWord
        });
        
    } catch (error) {
        console.error('❌ [FILLER FILTER] Add error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to add custom filler',
            message: error.message
        });
    }
});

/**
 * DELETE /api/company/:companyId/configuration/filler-filter/custom/:word
 * Remove a custom filler word
 */
router.delete('/company/:companyId/configuration/filler-filter/custom/:word', async (req, res) => {
    const { companyId, word } = req.params;
    
    console.log(`🔇 [FILLER FILTER] REMOVE custom filler for company: ${companyId} - "${word}"`);
    
    try {
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        const customFillers = company.aiAgentSettings?.fillerWords?.custom || [];
        const index = customFillers.indexOf(word);
        
        if (index === -1) {
            return res.status(404).json({ success: false, error: 'Custom filler not found' });
        }
        
        // Remove from array
        customFillers.splice(index, 1);
        company.markModified('aiAgentSettings');
        await company.save();
        
        console.log(`✅ [FILLER FILTER] Removed custom filler: "${word}"`);
        
        // 🔥 CRITICAL: Clear Redis cache to force fresh data load
        try {
            if (redisClient) {
                await redisClient.del(`company:${companyId}`);
                console.log(`✅ [FILLER FILTER] Redis cache cleared for company:${companyId}`);
            }
        } catch (redisError) {
            console.error('⚠️ [FILLER FILTER] Redis cache clear failed (non-fatal):', redisError.message);
        }
        
        res.json({
            success: true,
            message: 'Custom filler removed',
            word
        });
        
    } catch (error) {
        console.error('❌ [FILLER FILTER] Remove error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to remove custom filler',
            message: error.message
        });
    }
});

module.exports = router;

