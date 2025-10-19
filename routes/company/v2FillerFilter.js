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
        const customFillers = (company.aiAgentSettings?.fillerWords?.custom || []).sort();
        
        console.log(`✅ [FILLER FILTER] Inherited: ${inheritedFillers.length}, Custom: ${customFillers.length}`);
        
        res.json({
            success: true,
            inheritedFillers,
            customFillers,
            scanStatus: {
                lastScan: company.aiAgentSettings?.fillerWords?.lastScan || null,
                activeTemplatesScanned: activeTemplateIds.length
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
 * Force scan templates for inherited filler words
 */
router.post('/company/:companyId/configuration/filler-filter/scan', async (req, res) => {
    const { companyId } = req.params;
    
    console.log(`🔇 [FILLER FILTER] SCAN triggered for company: ${companyId}`);
    
    try {
        const company = await v2Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }
        
        // Update last scan timestamp
        if (!company.aiAgentSettings) {
            company.aiAgentSettings = {};
        }
        if (!company.aiAgentSettings.fillerWords) {
            company.aiAgentSettings.fillerWords = {};
        }
        
        company.aiAgentSettings.fillerWords.lastScan = new Date();
        company.markModified('aiAgentSettings');
        await company.save();
        
        console.log(`✅ [FILLER FILTER] Scan completed for company: ${companyId}`);
        
        res.json({
            success: true,
            message: 'Scan completed',
            timestamp: new Date()
        });
        
    } catch (error) {
        console.error('❌ [FILLER FILTER] Scan error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to scan',
            message: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/configuration/filler-filter/custom
 * Add a custom filler word
 */
router.post('/company/:companyId/configuration/filler-filter/custom', async (req, res) => {
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

