/**
 * STT Profile API Routes
 * 
 * CRUD operations for Speech-to-Text profiles
 * Scoped by templateId - one profile per template
 * 
 * @module routes/admin/sttProfile
 */

const express = require('express');
const router = express.Router();
const STTProfile = require('../../models/STTProfile');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const logger = require('../../utils/logger');
const STTPreprocessor = require('../../services/STTPreprocessor');

// ============================================================================
// GET PROFILE BY TEMPLATE ID
// ============================================================================

/**
 * GET /api/admin/stt-profile/:templateId
 * Get STT profile for a template (creates default if not exists)
 */
router.get('/:templateId', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId } = req.params;
        
        let profile = await STTProfile.findOne({ templateId, isActive: true });
        
        // Create default profile if none exists
        if (!profile) {
            const template = await GlobalInstantResponseTemplate.findById(templateId);
            if (!template) {
                return res.status(404).json({ 
                    success: false, 
                    error: 'Template not found' 
                });
            }
            
            profile = await STTProfile.createDefaultForTemplate(template);
            logger.info('[STT PROFILE API] Created default profile for template', {
                templateId,
                templateName: template.name
            });
        }
        
        res.json({
            success: true,
            data: profile
        });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to get profile', {
            templateId: req.params.templateId,
            error: error.message
        });
        res.status(500).json({ 
            success: false, 
            error: error.message 
        });
    }
});

// ============================================================================
// UPDATE PROVIDER SETTINGS
// ============================================================================

/**
 * PATCH /api/admin/stt-profile/:templateId/provider
 * Update provider configuration
 */
router.patch('/:templateId/provider', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId } = req.params;
        const providerSettings = req.body;
        
        const profile = await STTProfile.findOneAndUpdate(
            { templateId, isActive: true },
            { 
                $set: { 
                    provider: providerSettings,
                    updatedBy: req.user._id
                }
            },
            { new: true }
        );
        
        if (!profile) {
            return res.status(404).json({ 
                success: false, 
                error: 'Profile not found' 
            });
        }
        
        // Clear cache
        STTPreprocessor.clearCache(templateId);
        
        logger.info('[STT PROFILE API] Updated provider settings', {
            templateId,
            provider: providerSettings.type
        });
        
        res.json({ success: true, data: profile });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to update provider', {
            error: error.message
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// FILLER MANAGEMENT
// ============================================================================

/**
 * POST /api/admin/stt-profile/:templateId/fillers
 * Add a new filler word/phrase
 */
router.post('/:templateId/fillers', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId } = req.params;
        const { phrase, scope = 'template' } = req.body;
        
        if (!phrase || phrase.trim().length === 0) {
            return res.status(400).json({ 
                success: false, 
                error: 'Phrase is required' 
            });
        }
        
        const normalizedPhrase = phrase.toLowerCase().trim();
        
        const profile = await STTProfile.findOne({ templateId, isActive: true });
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        // Check for duplicate
        if (profile.fillers.some(f => f.phrase === normalizedPhrase)) {
            return res.status(400).json({ 
                success: false, 
                error: 'Filler already exists' 
            });
        }
        
        profile.fillers.push({
            phrase: normalizedPhrase,
            scope,
            enabled: true,
            addedBy: req.user.email || 'admin'
        });
        
        profile.updatedBy = req.user._id;
        await profile.save();
        
        STTPreprocessor.clearCache(templateId);
        
        res.json({ success: true, data: profile });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to add filler', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/admin/stt-profile/:templateId/fillers/:phrase
 * Remove a filler
 */
router.delete('/:templateId/fillers/:phrase', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId, phrase } = req.params;
        const normalizedPhrase = decodeURIComponent(phrase).toLowerCase().trim();
        
        const profile = await STTProfile.findOneAndUpdate(
            { templateId, isActive: true },
            { 
                $pull: { fillers: { phrase: normalizedPhrase } },
                $set: { updatedBy: req.user._id }
            },
            { new: true }
        );
        
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        STTPreprocessor.clearCache(templateId);
        
        res.json({ success: true, data: profile });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to remove filler', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * PATCH /api/admin/stt-profile/:templateId/fillers/:phrase/toggle
 * Toggle filler enabled/disabled
 */
router.patch('/:templateId/fillers/:phrase/toggle', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId, phrase } = req.params;
        const normalizedPhrase = decodeURIComponent(phrase).toLowerCase().trim();
        
        const profile = await STTProfile.findOne({ templateId, isActive: true });
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        const filler = profile.fillers.find(f => f.phrase === normalizedPhrase);
        if (!filler) {
            return res.status(404).json({ success: false, error: 'Filler not found' });
        }
        
        filler.enabled = !filler.enabled;
        profile.updatedBy = req.user._id;
        await profile.save();
        
        STTPreprocessor.clearCache(templateId);
        
        res.json({ success: true, data: profile });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to toggle filler', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// VOCABULARY MANAGEMENT
// ============================================================================

/**
 * POST /api/admin/stt-profile/:templateId/vocabulary
 * Add a boosted keyword
 */
router.post('/:templateId/vocabulary', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId } = req.params;
        const { phrase, type = 'manual', source = '', boostWeight = 5 } = req.body;
        
        if (!phrase || phrase.trim().length === 0) {
            return res.status(400).json({ success: false, error: 'Phrase is required' });
        }
        
        const profile = await STTProfile.findOne({ templateId, isActive: true });
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        // Check for duplicate
        const normalized = phrase.toLowerCase().trim();
        if (profile.vocabulary.boostedKeywords.some(k => k.phrase.toLowerCase() === normalized)) {
            return res.status(400).json({ success: false, error: 'Keyword already exists' });
        }
        
        profile.vocabulary.boostedKeywords.push({
            phrase: phrase.trim(),
            type,
            source: source || 'Manual addition',
            boostWeight: Math.min(10, Math.max(1, boostWeight)),
            enabled: true
        });
        
        profile.updatedBy = req.user._id;
        await profile.save();
        
        STTPreprocessor.clearCache(templateId);
        
        res.json({ success: true, data: profile });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to add vocabulary', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/admin/stt-profile/:templateId/vocabulary/:phrase
 * Remove a boosted keyword
 */
router.delete('/:templateId/vocabulary/:phrase', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId, phrase } = req.params;
        const normalizedPhrase = decodeURIComponent(phrase).toLowerCase().trim();
        
        const profile = await STTProfile.findOne({ templateId, isActive: true });
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        profile.vocabulary.boostedKeywords = profile.vocabulary.boostedKeywords.filter(
            k => k.phrase.toLowerCase() !== normalizedPhrase
        );
        
        profile.updatedBy = req.user._id;
        await profile.save();
        
        STTPreprocessor.clearCache(templateId);
        
        res.json({ success: true, data: profile });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to remove vocabulary', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/admin/stt-profile/:templateId/vocabulary/sync
 * Re-sync vocabulary from template
 */
router.post('/:templateId/vocabulary/sync', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId } = req.params;
        
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            return res.status(404).json({ success: false, error: 'Template not found' });
        }
        
        const profile = await STTProfile.syncFromTemplate(templateId, template);
        
        STTPreprocessor.clearCache(templateId);
        
        logger.info('[STT PROFILE API] Synced vocabulary from template', {
            templateId,
            keywordCount: profile.vocabulary.boostedKeywords.length
        });
        
        res.json({ success: true, data: profile });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to sync vocabulary', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// CORRECTIONS MANAGEMENT
// ============================================================================

/**
 * POST /api/admin/stt-profile/:templateId/corrections
 * Add a mishear correction
 */
router.post('/:templateId/corrections', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId } = req.params;
        const { heard, normalized, context = [], notes = '' } = req.body;
        
        if (!heard || !normalized) {
            return res.status(400).json({ 
                success: false, 
                error: 'Both "heard" and "normalized" are required' 
            });
        }
        
        const profile = await STTProfile.findOne({ templateId, isActive: true });
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        // Check for duplicate
        const normalizedHeard = heard.toLowerCase().trim();
        if (profile.corrections.some(c => c.heard === normalizedHeard)) {
            return res.status(400).json({ success: false, error: 'Correction already exists for this word' });
        }
        
        profile.corrections.push({
            heard: normalizedHeard,
            normalized: normalized.trim(),
            context: Array.isArray(context) ? context.map(c => c.toLowerCase().trim()) : [],
            enabled: true,
            notes
        });
        
        profile.updatedBy = req.user._id;
        await profile.save();
        
        STTPreprocessor.clearCache(templateId);
        
        res.json({ success: true, data: profile });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to add correction', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/admin/stt-profile/:templateId/corrections/:heard
 * Remove a correction
 */
router.delete('/:templateId/corrections/:heard', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId, heard } = req.params;
        const normalizedHeard = decodeURIComponent(heard).toLowerCase().trim();
        
        const profile = await STTProfile.findOneAndUpdate(
            { templateId, isActive: true },
            { 
                $pull: { corrections: { heard: normalizedHeard } },
                $set: { updatedBy: req.user._id }
            },
            { new: true }
        );
        
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        STTPreprocessor.clearCache(templateId);
        
        res.json({ success: true, data: profile });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to remove correction', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// IMPOSSIBLE WORDS MANAGEMENT
// ============================================================================

/**
 * POST /api/admin/stt-profile/:templateId/impossible-words
 * Add an impossible word
 */
router.post('/:templateId/impossible-words', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId } = req.params;
        const { word, reason = '', suggestCorrection = '' } = req.body;
        
        if (!word) {
            return res.status(400).json({ success: false, error: 'Word is required' });
        }
        
        const profile = await STTProfile.findOne({ templateId, isActive: true });
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        const normalizedWord = word.toLowerCase().trim();
        if (profile.impossibleWords.some(iw => iw.word === normalizedWord)) {
            return res.status(400).json({ success: false, error: 'Impossible word already exists' });
        }
        
        profile.impossibleWords.push({
            word: normalizedWord,
            reason,
            suggestCorrection: suggestCorrection.toLowerCase().trim() || null,
            enabled: true
        });
        
        profile.updatedBy = req.user._id;
        await profile.save();
        
        STTPreprocessor.clearCache(templateId);
        
        res.json({ success: true, data: profile });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to add impossible word', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/admin/stt-profile/:templateId/impossible-words/:word
 * Remove an impossible word
 */
router.delete('/:templateId/impossible-words/:word', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId, word } = req.params;
        const normalizedWord = decodeURIComponent(word).toLowerCase().trim();
        
        const profile = await STTProfile.findOneAndUpdate(
            { templateId, isActive: true },
            { 
                $pull: { impossibleWords: { word: normalizedWord } },
                $set: { updatedBy: req.user._id }
            },
            { new: true }
        );
        
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        STTPreprocessor.clearCache(templateId);
        
        res.json({ success: true, data: profile });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to remove impossible word', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// SUGGESTIONS MANAGEMENT
// ============================================================================

/**
 * GET /api/admin/stt-profile/:templateId/suggestions
 * Get pending suggestions
 */
router.get('/:templateId/suggestions', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId } = req.params;
        const { status = 'pending' } = req.query;
        
        const profile = await STTProfile.findOne({ templateId, isActive: true });
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        const suggestions = profile.suggestions
            .filter(s => status === 'all' || s.status === status)
            .sort((a, b) => b.count - a.count);
        
        res.json({ success: true, data: suggestions });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to get suggestions', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/admin/stt-profile/:templateId/suggestions/:index/approve
 * Approve a suggestion
 */
router.post('/:templateId/suggestions/:index/approve', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId, index } = req.params;
        const approvalData = req.body;
        
        const profile = await STTProfile.findOne({ templateId, isActive: true });
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        const result = profile.approveSuggestion(parseInt(index), {
            ...approvalData,
            approvedBy: req.user.email || 'admin'
        });
        
        if (!result.success) {
            return res.status(400).json({ success: false, error: result.error });
        }
        
        profile.updatedBy = req.user._id;
        await profile.save();
        
        STTPreprocessor.clearCache(templateId);
        
        logger.info('[STT PROFILE API] Approved suggestion', {
            templateId,
            type: result.type,
            addedTo: result.addedTo
        });
        
        res.json({ success: true, data: profile, result });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to approve suggestion', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/admin/stt-profile/:templateId/suggestions/:index/ignore
 * Ignore a suggestion
 */
router.post('/:templateId/suggestions/:index/ignore', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId, index } = req.params;
        
        const profile = await STTProfile.findOne({ templateId, isActive: true });
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        const suggestion = profile.suggestions[parseInt(index)];
        if (!suggestion) {
            return res.status(404).json({ success: false, error: 'Suggestion not found' });
        }
        
        suggestion.status = 'ignored';
        suggestion.reviewedBy = req.user.email || 'admin';
        suggestion.reviewedAt = new Date();
        
        await profile.save();
        
        res.json({ success: true, data: profile });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to ignore suggestion', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// TEST ENDPOINT
// ============================================================================

/**
 * POST /api/admin/stt-profile/:templateId/test
 * Test STT preprocessing with sample text
 */
router.post('/:templateId/test', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId } = req.params;
        const { text } = req.body;
        
        if (!text) {
            return res.status(400).json({ success: false, error: 'Text is required' });
        }
        
        const result = await STTPreprocessor.process(text, templateId, {});
        
        res.json({
            success: true,
            data: {
                input: text,
                output: result.cleaned,
                transformations: result.transformations,
                metrics: result.metrics,
                suggestions: result.suggestions
            }
        });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Test failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// METRICS ENDPOINT
// ============================================================================

/**
 * GET /api/admin/stt-profile/:templateId/metrics
 * Get profile metrics
 */
router.get('/:templateId/metrics', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId } = req.params;
        
        const profile = await STTProfile.findOne(
            { templateId, isActive: true },
            { metrics: 1, vocabulary: 1, fillers: 1, corrections: 1, suggestions: 1 }
        );
        
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        res.json({
            success: true,
            data: {
                metrics: profile.metrics,
                counts: {
                    fillers: profile.fillers.length,
                    enabledFillers: profile.fillers.filter(f => f.enabled).length,
                    keywords: profile.vocabulary.boostedKeywords.length,
                    enabledKeywords: profile.vocabulary.boostedKeywords.filter(k => k.enabled).length,
                    corrections: profile.corrections.length,
                    enabledCorrections: profile.corrections.filter(c => c.enabled).length,
                    pendingSuggestions: profile.suggestions.filter(s => s.status === 'pending').length
                }
            }
        });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to get metrics', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// SEED COMMON CORRECTIONS (Address/Number Recognition)
// ============================================================================

/**
 * POST /api/admin/stt-profile/:templateId/seed-address-corrections
 * Seed common address and number corrections for better STT accuracy
 */
router.post('/:templateId/seed-address-corrections', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId } = req.params;
        
        // Common number mishearings (spoken → digits)
        const commonCorrections = [
            // Number sequences often mishear
            { heard: "twelve one five five", normalized: "12155", context: ["address", "street"], notes: "Common address number" },
            { heard: "to one five five", normalized: "2155", context: ["address"], notes: "STT often hears 'to' as number" },
            { heard: "one two one five five", normalized: "12155", context: ["address"], notes: "Spelled out numbers" },
            { heard: "three one two", normalized: "312", context: ["address", "suite"], notes: "Suite/unit number" },
            { heard: "don't be", normalized: "", context: [], notes: "STT noise - delete this" },
            { heard: "twelve dash", normalized: "12-", context: ["address"], notes: "Hyphenated number start" },
            { heard: "dash one five five", normalized: "-155", context: ["address"], notes: "Hyphenated number end" },
            
            // Common phone number mishears
            { heard: "to three nine", normalized: "239", context: ["phone", "area code"], notes: "Area code mishear" },
            { heard: "two three nine", normalized: "239", context: ["phone"], notes: "Area code" },
            { heard: "five six five", normalized: "565", context: ["phone"], notes: "Phone segment" },
            { heard: "to to o to", normalized: "2202", context: ["phone"], notes: "Phone number ending" },
            
            // Suite/Apartment with letters
            { heard: "sweet", normalized: "suite", context: ["address"], notes: "Suite mishear" },
            { heard: "sweets", normalized: "suites", context: ["address"], notes: "Suites mishear" },
            { heard: "apt", normalized: "apartment", context: ["address"], notes: "Abbreviation" },
            { heard: "unit number", normalized: "unit", context: ["address"], notes: "Redundant" },
            { heard: "for b", normalized: "4B", context: ["suite", "unit"], notes: "Unit 4B" },
            { heard: "for bee", normalized: "4B", context: ["suite", "unit"], notes: "Unit 4B" },
            { heard: "four b", normalized: "4B", context: ["suite", "unit"], notes: "Unit 4B" },
            { heard: "four bee", normalized: "4B", context: ["suite", "unit"], notes: "Unit 4B" },
            { heard: "for slash b", normalized: "4/B", context: ["suite"], notes: "Unit 4/B" },
            { heard: "four slash b", normalized: "4/B", context: ["suite"], notes: "Unit 4/B" },
            { heard: "for dash b", normalized: "4-B", context: ["suite"], notes: "Unit 4-B" },
            { heard: "four dash b", normalized: "4-B", context: ["suite"], notes: "Unit 4-B" },
            { heard: "a as in apple", normalized: "A", context: ["suite", "unit"], notes: "Letter A" },
            { heard: "b as in boy", normalized: "B", context: ["suite", "unit"], notes: "Letter B" },
            { heard: "c as in charlie", normalized: "C", context: ["suite", "unit"], notes: "Letter C" },
            { heard: "d as in david", normalized: "D", context: ["suite", "unit"], notes: "Letter D" },
            
            // Street types
            { heard: "parkway", normalized: "Parkway", context: ["street"], notes: "Street type" },
            { heard: "metro", normalized: "Metro", context: ["street", "address"], notes: "Street name" },
            { heard: "boulevard", normalized: "Boulevard", context: ["street"], notes: "Street type" },
            { heard: "avenue", normalized: "Avenue", context: ["street"], notes: "Street type" },
            { heard: "st", normalized: "Street", context: ["address"], notes: "Street abbreviation" },
            { heard: "ave", normalized: "Avenue", context: ["address"], notes: "Avenue abbreviation" },
            { heard: "blvd", normalized: "Boulevard", context: ["address"], notes: "Boulevard abbreviation" },
            { heard: "dr", normalized: "Drive", context: ["address"], notes: "Drive abbreviation" },
            { heard: "ln", normalized: "Lane", context: ["address"], notes: "Lane abbreviation" },
            { heard: "ct", normalized: "Court", context: ["address"], notes: "Court abbreviation" },
            { heard: "cir", normalized: "Circle", context: ["address"], notes: "Circle abbreviation" },
            { heard: "pl", normalized: "Place", context: ["address"], notes: "Place abbreviation" },
            
            // Directions
            { heard: "n", normalized: "North", context: ["address", "direction"], notes: "North abbreviation" },
            { heard: "s", normalized: "South", context: ["address", "direction"], notes: "South abbreviation" },
            { heard: "e", normalized: "East", context: ["address", "direction"], notes: "East abbreviation" },
            { heard: "w", normalized: "West", context: ["address", "direction"], notes: "West abbreviation" },
            { heard: "ne", normalized: "Northeast", context: ["address"], notes: "Direction" },
            { heard: "nw", normalized: "Northwest", context: ["address"], notes: "Direction" },
            { heard: "se", normalized: "Southeast", context: ["address"], notes: "Direction" },
            { heard: "sw", normalized: "Southwest", context: ["address"], notes: "Direction" },
            
            // ASAP/Urgency
            { heard: "a sap", normalized: "ASAP", context: ["time", "schedule"], notes: "ASAP mishear" },
            { heard: "as soon", normalized: "ASAP", context: ["time"], notes: "Urgency" },
            { heard: "asap", normalized: "ASAP", context: ["time"], notes: "ASAP" }
        ];
        
        let profile = await STTProfile.findOne({ templateId, isActive: true });
        
        if (!profile) {
            profile = await STTProfile.createForTemplate(templateId);
        }
        
        // Add corrections that don't already exist
        let added = 0;
        let skipped = 0;
        
        for (const correction of commonCorrections) {
            const normalizedHeard = correction.heard.toLowerCase().trim();
            const exists = profile.corrections.some(c => c.heard === normalizedHeard);
            
            if (!exists) {
                profile.corrections.push({
                    heard: normalizedHeard,
                    normalized: correction.normalized,
                    context: correction.context,
                    enabled: true,
                    notes: correction.notes
                });
                added++;
            } else {
                skipped++;
            }
        }
        
        if (added > 0) {
            profile.updatedBy = req.user._id;
            await profile.save();
            STTPreprocessor.clearCache(templateId);
        }
        
        logger.info('[STT PROFILE API] Seeded address corrections', { templateId, added, skipped });
        
        res.json({
            success: true,
            message: `Added ${added} corrections, skipped ${skipped} duplicates`,
            totalCorrections: profile.corrections.length
        });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to seed corrections', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// DEEPGRAM COMPARISON (Black Box Analysis)
// ============================================================================

/**
 * POST /api/admin/stt-profile/compare/:callId
 * Compare Twilio vs Deepgram transcription for a Black Box recording
 * Returns vocabulary suggestions to improve STT accuracy
 */
router.post('/compare/:callId', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { callId } = req.params;
        const { companyId } = req.body;
        
        if (!companyId) {
            return res.status(400).json({ success: false, error: 'companyId required' });
        }
        
        // Lazy load comparison service
        let STTComparisonService;
        try {
            STTComparisonService = require('../../services/stt/STTComparisonService');
        } catch (e) {
            return res.status(500).json({ 
                success: false, 
                error: 'STT Comparison service not available' 
            });
        }
        
        const result = await STTComparisonService.compareTranscriptions(callId, companyId);
        
        logger.info('[STT PROFILE API] Comparison complete', {
            callId,
            companyId,
            success: result.success,
            suggestionsCount: result.vocabularySuggestions?.summary?.totalSuggestions || 0
        });
        
        res.json(result);
        
    } catch (error) {
        logger.error('[STT PROFILE API] Comparison failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * POST /api/admin/stt-profile/compare-batch
 * Batch compare multiple calls
 */
router.post('/compare-batch', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { callIds, companyId } = req.body;
        
        if (!companyId || !callIds || !Array.isArray(callIds)) {
            return res.status(400).json({ 
                success: false, 
                error: 'companyId and callIds array required' 
            });
        }
        
        // Limit batch size
        const limitedCallIds = callIds.slice(0, 10);
        
        let STTComparisonService;
        try {
            STTComparisonService = require('../../services/stt/STTComparisonService');
        } catch (e) {
            return res.status(500).json({ 
                success: false, 
                error: 'STT Comparison service not available' 
            });
        }
        
        const result = await STTComparisonService.analyzeMultiple(limitedCallIds, companyId);
        
        res.json(result);
        
    } catch (error) {
        logger.error('[STT PROFILE API] Batch comparison failed', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// GET PROVIDER STATUS/OPTIONS
// ============================================================================

/**
 * GET /api/admin/stt-profile/providers/status
 * Get available STT providers and their status
 */
router.get('/providers/status', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        // Lazy load to avoid errors if not installed
        let STTProviderFactory;
        try {
            STTProviderFactory = require('../../services/stt/STTProviderFactory');
        } catch (e) {
            // Factory not available yet
            return res.json({
                success: true,
                providers: [
                    {
                        type: 'twilio',
                        name: 'Twilio (Current)',
                        description: 'Built-in STT with Twilio Voice',
                        cost: 'FREE',
                        accuracy: '~80%',
                        available: true,
                        recommended: false
                    },
                    {
                        type: 'deepgram',
                        name: 'Deepgram Nova-2',
                        description: 'Premium accuracy STT',
                        cost: '$0.0043/min',
                        accuracy: '~95%',
                        available: !!process.env.DEEPGRAM_API_KEY,
                        recommended: true,
                        setupRequired: !process.env.DEEPGRAM_API_KEY ? 'Add DEEPGRAM_API_KEY to environment' : null
                    },
                    {
                        type: 'google',
                        name: 'Google Cloud Speech',
                        description: 'Enterprise-grade (coming soon)',
                        cost: '$0.006/15sec',
                        accuracy: '~90%',
                        available: false,
                        setupRequired: 'Coming soon'
                    }
                ],
                health: {
                    twilio: { status: 'healthy', message: 'Built-in' },
                    deepgram: { 
                        status: process.env.DEEPGRAM_API_KEY ? 'configured' : 'unconfigured',
                        message: process.env.DEEPGRAM_API_KEY ? 'API key set' : 'DEEPGRAM_API_KEY not set'
                    },
                    google: { status: 'unavailable', message: 'Coming soon' }
                }
            });
        }
        
        const providers = STTProviderFactory.getProviderOptions();
        const health = await STTProviderFactory.healthCheck();
        
        res.json({
            success: true,
            providers,
            health
        });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to get provider status', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
