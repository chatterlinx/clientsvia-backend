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
        
        // Ensure vocabulary structure exists
        profile.vocabulary = profile.vocabulary || {};
        profile.vocabulary.boostedKeywords = profile.vocabulary.boostedKeywords || [];
        
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
        
        // Ensure corrections array exists
        profile.corrections = profile.corrections || [];
        
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
// SPEAKING CORRECTIONS (what AI says, not what it hears)
// ============================================================================

/**
 * POST /api/admin/stt-profile/:templateId/speaking-corrections
 * Add a speaking correction rule
 */
router.post('/:templateId/speaking-corrections', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId } = req.params;
        const { dontSay, sayInstead, reason = '' } = req.body;
        
        if (!dontSay || !sayInstead) {
            return res.status(400).json({ success: false, error: 'Both dontSay and sayInstead are required' });
        }
        
        const profile = await STTProfile.findOne({ templateId, isActive: true });
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        // Initialize array if needed
        profile.speakingCorrections = profile.speakingCorrections || [];
        
        const normalizedDontSay = dontSay.toLowerCase().trim();
        if (profile.speakingCorrections.some(sc => sc.dontSay.toLowerCase() === normalizedDontSay)) {
            return res.status(400).json({ success: false, error: 'Speaking rule already exists for this word' });
        }
        
        profile.speakingCorrections.push({
            dontSay: dontSay.trim(),
            sayInstead: sayInstead.trim(),
            reason,
            enabled: true
        });
        
        if (req.user && req.user._id) {
            profile.updatedBy = req.user._id;
        }
        await profile.save();
        
        logger.info('[STT PROFILE API] Added speaking correction', { templateId, dontSay, sayInstead });
        
        res.json({ success: true, data: profile });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to add speaking correction', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

/**
 * DELETE /api/admin/stt-profile/:templateId/speaking-corrections/:dontSay
 * Remove a speaking correction
 */
router.delete('/:templateId/speaking-corrections/:dontSay', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId, dontSay } = req.params;
        const normalizedDontSay = decodeURIComponent(dontSay).toLowerCase().trim();
        
        const profile = await STTProfile.findOneAndUpdate(
            { templateId, isActive: true },
            { 
                $pull: { speakingCorrections: { dontSay: { $regex: new RegExp(`^${normalizedDontSay}$`, 'i') } } },
                $set: { updatedBy: req.user?._id }
            },
            { new: true }
        );
        
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        logger.info('[STT PROFILE API] Removed speaking correction', { templateId, dontSay });
        
        res.json({ success: true, data: profile });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to remove speaking correction', { error: error.message });
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
// Retired seed endpoint (Address/Number Recognition)
// ============================================================================

/**
 * POST /api/admin/stt-profile/:templateId/seed-address-corrections
 * Retired seed endpoint
 */
router.post('/:templateId/seed-address-corrections', authenticateJWT, requireRole('admin'), async (req, res) => {
    return res.status(410).json({
        success: false,
        error: 'Seed endpoint retired. Manage corrections via the admin UI.'
    });
    try {
        const { templateId } = req.params;
        
        // ============================================================================
        // COMPREHENSIVE ADDRESS CORRECTIONS (~100+ rules)
        // ============================================================================
        const commonCorrections = [
            
            // ════════════════════════════════════════════════════════════════════════
            // 1️⃣ APARTMENT / UNIT / SUITE NORMALIZATION
            // ════════════════════════════════════════════════════════════════════════
            // Normalize all variants to clean format: Apt 4B, Ste 200, Unit 3A
            { heard: "apartment", normalized: "Apt", context: ["address"], notes: "Apartment → Apt" },
            { heard: "apt", normalized: "Apt", context: ["address"], notes: "Already abbreviated" },
            { heard: "app", normalized: "Apt", context: ["address"], notes: "Partial abbreviation" },
            { heard: "a p t", normalized: "Apt", context: ["address"], notes: "Spelled out" },
            { heard: "suite", normalized: "Ste", context: ["address"], notes: "Suite → Ste" },
            { heard: "sweet", normalized: "Ste", context: ["address"], notes: "Suite mishear" },
            { heard: "suit", normalized: "Ste", context: ["address"], notes: "Suite mishear" },
            { heard: "unit", normalized: "Unit", context: ["address"], notes: "Unit stays as Unit" },
            { heard: "you knit", normalized: "Unit", context: ["address"], notes: "Unit mishear" },
            { heard: "you net", normalized: "Unit", context: ["address"], notes: "Unit mishear" },
            { heard: "number", normalized: "#", context: ["address"], notes: "Number → #" },
            { heard: "pound", normalized: "#", context: ["address"], notes: "Pound sign" },
            { heard: "hashtag", normalized: "#", context: ["address"], notes: "Modern slang" },
            
            // Unit with letters
            { heard: "apartment 4 b", normalized: "Apt 4B", context: ["address"], notes: "Full unit" },
            { heard: "apartment four bee", normalized: "Apt 4B", context: ["address"], notes: "Spelled out" },
            { heard: "unit 3", normalized: "Unit 3", context: ["address"], notes: "Simple unit" },
            { heard: "unit three a", normalized: "Unit 3A", context: ["address"], notes: "Unit with letter" },
            { heard: "suite 200", normalized: "Ste 200", context: ["address"], notes: "Suite number" },
            { heard: "sweet 200", normalized: "Ste 200", context: ["address"], notes: "Suite mishear" },
            { heard: "for b", normalized: "4B", context: ["suite", "unit"], notes: "Unit 4B" },
            { heard: "for bee", normalized: "4B", context: ["suite", "unit"], notes: "Unit 4B" },
            { heard: "four b", normalized: "4B", context: ["suite", "unit"], notes: "Unit 4B" },
            { heard: "four bee", normalized: "4B", context: ["suite", "unit"], notes: "Unit 4B" },
            { heard: "three a", normalized: "3A", context: ["suite", "unit"], notes: "Unit 3A" },
            { heard: "three ay", normalized: "3A", context: ["suite", "unit"], notes: "Unit 3A" },
            { heard: "number 15", normalized: "#15", context: ["address"], notes: "Number format" },
            
            // NATO alphabet for unit letters
            { heard: "a as in apple", normalized: "A", context: ["suite", "unit"], notes: "Letter A" },
            { heard: "b as in boy", normalized: "B", context: ["suite", "unit"], notes: "Letter B" },
            { heard: "c as in charlie", normalized: "C", context: ["suite", "unit"], notes: "Letter C" },
            { heard: "d as in david", normalized: "D", context: ["suite", "unit"], notes: "Letter D" },
            { heard: "e as in echo", normalized: "E", context: ["suite", "unit"], notes: "Letter E" },
            { heard: "f as in frank", normalized: "F", context: ["suite", "unit"], notes: "Letter F" },
            
            // ════════════════════════════════════════════════════════════════════════
            // 2️⃣ ORDINALS (1st, 2nd, 3rd, 21st, etc.)
            // ════════════════════════════════════════════════════════════════════════
            { heard: "first", normalized: "1st", context: ["address", "street"], notes: "Ordinal" },
            { heard: "second", normalized: "2nd", context: ["address", "street"], notes: "Ordinal" },
            { heard: "third", normalized: "3rd", context: ["address", "street"], notes: "Ordinal" },
            { heard: "fourth", normalized: "4th", context: ["address", "street"], notes: "Ordinal" },
            { heard: "fifth", normalized: "5th", context: ["address", "street"], notes: "Ordinal" },
            { heard: "sixth", normalized: "6th", context: ["address", "street"], notes: "Ordinal" },
            { heard: "seventh", normalized: "7th", context: ["address", "street"], notes: "Ordinal" },
            { heard: "eighth", normalized: "8th", context: ["address", "street"], notes: "Ordinal" },
            { heard: "ninth", normalized: "9th", context: ["address", "street"], notes: "Ordinal" },
            { heard: "tenth", normalized: "10th", context: ["address", "street"], notes: "Ordinal" },
            { heard: "eleventh", normalized: "11th", context: ["address", "street"], notes: "Ordinal" },
            { heard: "twelfth", normalized: "12th", context: ["address", "street"], notes: "Ordinal" },
            { heard: "thirteenth", normalized: "13th", context: ["address", "street"], notes: "Ordinal" },
            { heard: "twentieth", normalized: "20th", context: ["address", "street"], notes: "Ordinal" },
            { heard: "twenty first", normalized: "21st", context: ["address", "street"], notes: "Ordinal" },
            { heard: "twenty second", normalized: "22nd", context: ["address", "street"], notes: "Ordinal" },
            { heard: "twenty third", normalized: "23rd", context: ["address", "street"], notes: "Ordinal" },
            { heard: "twenty fourth", normalized: "24th", context: ["address", "street"], notes: "Ordinal" },
            { heard: "twenty fifth", normalized: "25th", context: ["address", "street"], notes: "Ordinal" },
            { heard: "thirtieth", normalized: "30th", context: ["address", "street"], notes: "Ordinal" },
            { heard: "thirty first", normalized: "31st", context: ["address", "street"], notes: "Ordinal" },
            
            // ════════════════════════════════════════════════════════════════════════
            // 3️⃣ ZERO, DOUBLE, TRIPLE (Phone & Address Numbers)
            // ════════════════════════════════════════════════════════════════════════
            { heard: "oh", normalized: "0", context: ["phone", "address", "number"], notes: "Oh → 0" },
            { heard: "zero", normalized: "0", context: ["phone", "address"], notes: "Zero" },
            { heard: "double zero", normalized: "00", context: ["phone", "address"], notes: "Double zero" },
            { heard: "double one", normalized: "11", context: ["phone", "address"], notes: "Double one" },
            { heard: "double two", normalized: "22", context: ["phone", "address"], notes: "Double two" },
            { heard: "double three", normalized: "33", context: ["phone", "address"], notes: "Double three" },
            { heard: "double four", normalized: "44", context: ["phone", "address"], notes: "Double four" },
            { heard: "double five", normalized: "55", context: ["phone", "address"], notes: "Double five" },
            { heard: "double six", normalized: "66", context: ["phone", "address"], notes: "Double six" },
            { heard: "double seven", normalized: "77", context: ["phone", "address"], notes: "Double seven" },
            { heard: "double eight", normalized: "88", context: ["phone", "address"], notes: "Double eight" },
            { heard: "double nine", normalized: "99", context: ["phone", "address"], notes: "Double nine" },
            { heard: "triple zero", normalized: "000", context: ["phone", "address"], notes: "Triple zero" },
            { heard: "triple five", normalized: "555", context: ["phone"], notes: "Triple five" },
            
            // Common number mishearings
            { heard: "twelve one five five", normalized: "12155", context: ["address"], notes: "Address number" },
            { heard: "to one five five", normalized: "2155", context: ["address"], notes: "STT mishear" },
            { heard: "one two one five five", normalized: "12155", context: ["address"], notes: "Spelled out" },
            { heard: "three one two", normalized: "312", context: ["address", "suite"], notes: "Suite number" },
            { heard: "don't be", normalized: "", context: [], notes: "STT noise - delete" },
            { heard: "twelve dash", normalized: "12-", context: ["address"], notes: "Hyphenated" },
            
            // Phone numbers
            { heard: "to three nine", normalized: "239", context: ["phone"], notes: "Area code" },
            { heard: "two three nine", normalized: "239", context: ["phone"], notes: "Area code" },
            { heard: "five six five", normalized: "565", context: ["phone"], notes: "Phone segment" },
            { heard: "to to o to", normalized: "2202", context: ["phone"], notes: "Phone ending" },
            
            // ════════════════════════════════════════════════════════════════════════
            // 4️⃣ STREET TYPES (All Common Variants)
            // ════════════════════════════════════════════════════════════════════════
            { heard: "street", normalized: "Street", context: ["address"], notes: "Street" },
            { heard: "st", normalized: "Street", context: ["address", "end"], notes: "St → Street (at end)" },
            { heard: "avenue", normalized: "Avenue", context: ["address"], notes: "Avenue" },
            { heard: "ave", normalized: "Avenue", context: ["address"], notes: "Ave → Avenue" },
            { heard: "boulevard", normalized: "Boulevard", context: ["address"], notes: "Boulevard" },
            { heard: "blvd", normalized: "Boulevard", context: ["address"], notes: "Blvd → Boulevard" },
            { heard: "drive", normalized: "Drive", context: ["address"], notes: "Drive" },
            { heard: "dr", normalized: "Drive", context: ["address"], notes: "Dr → Drive" },
            { heard: "road", normalized: "Road", context: ["address"], notes: "Road" },
            { heard: "rd", normalized: "Road", context: ["address"], notes: "Rd → Road" },
            { heard: "lane", normalized: "Lane", context: ["address"], notes: "Lane" },
            { heard: "ln", normalized: "Lane", context: ["address"], notes: "Ln → Lane" },
            { heard: "court", normalized: "Court", context: ["address"], notes: "Court" },
            { heard: "ct", normalized: "Court", context: ["address"], notes: "Ct → Court" },
            { heard: "circle", normalized: "Circle", context: ["address"], notes: "Circle" },
            { heard: "cir", normalized: "Circle", context: ["address"], notes: "Cir → Circle" },
            { heard: "place", normalized: "Place", context: ["address"], notes: "Place" },
            { heard: "pl", normalized: "Place", context: ["address"], notes: "Pl → Place" },
            { heard: "way", normalized: "Way", context: ["address"], notes: "Way" },
            { heard: "parkway", normalized: "Parkway", context: ["address"], notes: "Parkway" },
            { heard: "pkwy", normalized: "Parkway", context: ["address"], notes: "Pkwy → Parkway" },
            { heard: "highway", normalized: "Highway", context: ["address"], notes: "Highway" },
            { heard: "hwy", normalized: "Highway", context: ["address"], notes: "Hwy → Highway" },
            { heard: "trail", normalized: "Trail", context: ["address"], notes: "Trail" },
            { heard: "trl", normalized: "Trail", context: ["address"], notes: "Trl → Trail" },
            { heard: "terrace", normalized: "Terrace", context: ["address"], notes: "Terrace" },
            { heard: "ter", normalized: "Terrace", context: ["address"], notes: "Ter → Terrace" },
            { heard: "expressway", normalized: "Expressway", context: ["address"], notes: "Expressway" },
            { heard: "expwy", normalized: "Expressway", context: ["address"], notes: "Expwy → Expressway" },
            { heard: "metro", normalized: "Metro", context: ["address"], notes: "Metro (common name)" },
            
            // ════════════════════════════════════════════════════════════════════════
            // 5️⃣ DIRECTIONS (Full and Abbreviated)
            // ════════════════════════════════════════════════════════════════════════
            { heard: "north", normalized: "N", context: ["address", "direction"], notes: "North → N" },
            { heard: "south", normalized: "S", context: ["address", "direction"], notes: "South → S" },
            { heard: "east", normalized: "E", context: ["address", "direction"], notes: "East → E" },
            { heard: "west", normalized: "W", context: ["address", "direction"], notes: "West → W" },
            { heard: "northeast", normalized: "NE", context: ["address"], notes: "Northeast → NE" },
            { heard: "northwest", normalized: "NW", context: ["address"], notes: "Northwest → NW" },
            { heard: "southeast", normalized: "SE", context: ["address"], notes: "Southeast → SE" },
            { heard: "southwest", normalized: "SW", context: ["address"], notes: "Southwest → SW" },
            
            // ════════════════════════════════════════════════════════════════════════
            // 6️⃣ SPANISH / LATINO PATTERNS (Florida Market)
            // ════════════════════════════════════════════════════════════════════════
            { heard: "calle", normalized: "Calle", context: ["address"], notes: "Spanish: Street" },
            { heard: "avenida", normalized: "Avenida", context: ["address"], notes: "Spanish: Avenue" },
            { heard: "norte", normalized: "N", context: ["address", "direction"], notes: "Spanish: North" },
            { heard: "sur", normalized: "S", context: ["address", "direction"], notes: "Spanish: South" },
            { heard: "este", normalized: "E", context: ["address", "direction"], notes: "Spanish: East" },
            { heard: "oeste", normalized: "W", context: ["address", "direction"], notes: "Spanish: West" },
            { heard: "apartamento", normalized: "Apt", context: ["address"], notes: "Spanish: Apartment" },
            { heard: "numero", normalized: "#", context: ["address"], notes: "Spanish: Number" },
            { heard: "piso", normalized: "Floor", context: ["address"], notes: "Spanish: Floor" },
            { heard: "edificio", normalized: "Building", context: ["address"], notes: "Spanish: Building" },
            
            // ════════════════════════════════════════════════════════════════════════
            // 7️⃣ TIME / URGENCY
            // ════════════════════════════════════════════════════════════════════════
            { heard: "a sap", normalized: "ASAP", context: ["time"], notes: "ASAP mishear" },
            { heard: "as soon", normalized: "ASAP", context: ["time"], notes: "Urgency" },
            { heard: "asap", normalized: "ASAP", context: ["time"], notes: "ASAP" },
            { heard: "today", normalized: "today", context: ["time"], notes: "Same day" },
            { heard: "tomorrow", normalized: "tomorrow", context: ["time"], notes: "Next day" },
            { heard: "this week", normalized: "this week", context: ["time"], notes: "This week" },
            
            // ════════════════════════════════════════════════════════════════════════
            // 8️⃣ HVAC / AC / AIR CONDITIONING (Critical for service intent)
            // ════════════════════════════════════════════════════════════════════════
            // STT often transcribes "AC" as "a c" or "a.c." or "A.C."
            { heard: "a c", normalized: "AC", context: ["service", "hvac"], notes: "AC mishear" },
            { heard: "a c service", normalized: "AC service", context: ["service"], notes: "AC service request" },
            { heard: "a c repair", normalized: "AC repair", context: ["service"], notes: "AC repair request" },
            { heard: "a c maintenance", normalized: "AC maintenance", context: ["service"], notes: "AC maintenance" },
            { heard: "a c unit", normalized: "AC unit", context: ["service"], notes: "AC unit" },
            { heard: "a c system", normalized: "AC system", context: ["service"], notes: "AC system" },
            { heard: "a.c.", normalized: "AC", context: ["service"], notes: "AC with periods" },
            { heard: "a. c.", normalized: "AC", context: ["service"], notes: "AC with spaces and periods" },
            { heard: "air con", normalized: "air conditioning", context: ["service"], notes: "Abbreviation" },
            { heard: "air cond", normalized: "air conditioning", context: ["service"], notes: "Abbreviation" },
            { heard: "h vac", normalized: "HVAC", context: ["service"], notes: "HVAC mishear" },
            { heard: "h v a c", normalized: "HVAC", context: ["service"], notes: "HVAC spelled out" },
            { heard: "h.v.a.c.", normalized: "HVAC", context: ["service"], notes: "HVAC with periods" },
            { heard: "heating and cooling", normalized: "HVAC", context: ["service"], notes: "HVAC description" },
            { heard: "heat and air", normalized: "HVAC", context: ["service"], notes: "HVAC informal" },
            { heard: "furnace", normalized: "furnace", context: ["service", "hvac"], notes: "Heating system" },
            { heard: "heater", normalized: "heater", context: ["service", "hvac"], notes: "Heating system" },
            { heard: "condenser", normalized: "condenser", context: ["service", "hvac"], notes: "AC component" },
            { heard: "compressor", normalized: "compressor", context: ["service", "hvac"], notes: "AC component" },
            { heard: "thermostat", normalized: "thermostat", context: ["service", "hvac"], notes: "Temperature control" },
            { heard: "thermal stat", normalized: "thermostat", context: ["service"], notes: "Thermostat mishear" }
        ];
        
        let profile = await STTProfile.findOne({ templateId, isActive: true });
        
        if (!profile) {
            return res.status(404).json({ success: false, error: 'STT Profile not found. Please create one first.' });
        }
        
        // Ensure corrections array exists
        profile.corrections = profile.corrections || [];
        
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

// ============================================================================
// Retired seed endpoint (HVAC vocabulary)
// ============================================================================

/**
 * POST /api/admin/stt-profile/:templateId/seed-hvac-keywords
 * Retired seed endpoint
 */
router.post('/:templateId/seed-hvac-keywords', authenticateJWT, requireRole('admin'), async (req, res) => {
    return res.status(410).json({
        success: false,
        error: 'Seed endpoint retired. Manage keywords via the admin UI.'
    });
    try {
        const { templateId } = req.params;
        
        // HVAC-specific keywords for boosting
        const hvacKeywords = [
            // Equipment
            { phrase: 'air conditioner', boostWeight: 8, notes: 'Core term' },
            { phrase: 'AC', boostWeight: 10, notes: 'Abbreviation - most common' },
            { phrase: 'HVAC', boostWeight: 10, notes: 'Industry term' },
            { phrase: 'furnace', boostWeight: 8, notes: 'Heating' },
            { phrase: 'heat pump', boostWeight: 8, notes: 'Heating/cooling' },
            { phrase: 'thermostat', boostWeight: 9, notes: 'Control device' },
            { phrase: 'ductwork', boostWeight: 7, notes: 'Air distribution' },
            { phrase: 'compressor', boostWeight: 7, notes: 'Component' },
            { phrase: 'condenser', boostWeight: 7, notes: 'Outdoor unit' },
            { phrase: 'evaporator', boostWeight: 7, notes: 'Indoor coil' },
            { phrase: 'air handler', boostWeight: 7, notes: 'Indoor unit' },
            { phrase: 'blower', boostWeight: 7, notes: 'Fan component' },
            { phrase: 'refrigerant', boostWeight: 8, notes: 'Coolant' },
            { phrase: 'freon', boostWeight: 8, notes: 'Common name' },
            { phrase: 'R410A', boostWeight: 7, notes: 'Refrigerant type' },
            { phrase: 'capacitor', boostWeight: 7, notes: 'Component' },
            { phrase: 'contactor', boostWeight: 7, notes: 'Component' },
            
            // Services
            { phrase: 'maintenance', boostWeight: 9, notes: 'Service type' },
            { phrase: 'tune up', boostWeight: 9, notes: 'Service' },
            { phrase: 'tune-up', boostWeight: 9, notes: 'Service hyphenated' },
            { phrase: 'repair', boostWeight: 9, notes: 'Service type' },
            { phrase: 'installation', boostWeight: 8, notes: 'Service type' },
            { phrase: 'replacement', boostWeight: 8, notes: 'Service type' },
            { phrase: 'duct cleaning', boostWeight: 8, notes: 'Service' },
            { phrase: 'filter change', boostWeight: 7, notes: 'Service' },
            { phrase: 'emergency', boostWeight: 10, notes: 'Urgency' },
            { phrase: 'no heat', boostWeight: 9, notes: 'Problem' },
            { phrase: 'no AC', boostWeight: 9, notes: 'Problem' },
            { phrase: 'no cooling', boostWeight: 9, notes: 'Problem' },
            { phrase: 'not working', boostWeight: 8, notes: 'Problem' },
            { phrase: 'broken', boostWeight: 8, notes: 'Problem' },
            { phrase: 'leaking', boostWeight: 8, notes: 'Problem' },
            { phrase: 'frozen', boostWeight: 8, notes: 'Problem' },
            { phrase: 'ice on', boostWeight: 7, notes: 'Problem indicator' },
            { phrase: 'strange noise', boostWeight: 7, notes: 'Problem' },
            { phrase: 'making noise', boostWeight: 7, notes: 'Problem' },
            { phrase: 'bad smell', boostWeight: 7, notes: 'Problem' },
            { phrase: 'blowing warm air', boostWeight: 8, notes: 'Problem' },
            { phrase: 'not blowing cold', boostWeight: 8, notes: 'Problem' },
            
            // Booking
            { phrase: 'appointment', boostWeight: 9, notes: 'Booking' },
            { phrase: 'schedule', boostWeight: 9, notes: 'Booking' },
            { phrase: 'book', boostWeight: 8, notes: 'Booking' },
            { phrase: 'technician', boostWeight: 8, notes: 'Person' },
            { phrase: 'tech', boostWeight: 8, notes: 'Abbreviation' },
            { phrase: 'today', boostWeight: 8, notes: 'Time' },
            { phrase: 'tomorrow', boostWeight: 8, notes: 'Time' },
            { phrase: 'as soon as possible', boostWeight: 8, notes: 'Urgency' },
            { phrase: 'ASAP', boostWeight: 8, notes: 'Urgency abbrev' },
            { phrase: 'morning', boostWeight: 7, notes: 'Time' },
            { phrase: 'afternoon', boostWeight: 7, notes: 'Time' },
            { phrase: 'evening', boostWeight: 7, notes: 'Time' },
        ];
        
        const profile = await STTProfile.findOne({ templateId, isActive: true });
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        // Add keywords that don't exist yet
        let added = 0;
        let skipped = 0;
        const existing = profile.vocabulary?.boostedKeywords || [];
        const existingPhrases = new Set(existing.map(k => k.phrase.toLowerCase()));
        
        for (const kw of hvacKeywords) {
            if (!existingPhrases.has(kw.phrase.toLowerCase())) {
                existing.push({
                    phrase: kw.phrase,
                    boostWeight: kw.boostWeight,
                    enabled: true,
                    addedBy: req.user.email || 'admin',
                    notes: kw.notes
                });
                added++;
            } else {
                skipped++;
            }
        }
        
        profile.vocabulary = profile.vocabulary || {};
        profile.vocabulary.boostedKeywords = existing;
        profile.updatedBy = req.user._id;
        await profile.save();
        
        // Clear cache
        STTPreprocessor.clearCache(templateId);
        
        logger.info('[STT PROFILE API] Seeded HVAC keywords', { templateId, added, skipped });
        
        res.json({ 
            success: true, 
            message: `Added ${added} keywords, skipped ${skipped} duplicates`,
            added,
            skipped,
            totalKeywords: existing.length
        });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to seed keywords', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// CLEAN BAD FILLERS - Remove words that should NEVER be stripped
// ============================================================================

/**
 * POST /api/admin/stt-profile/:templateId/clean-bad-fillers
 * Remove confirmation words, pronouns, grammar words that cause loops
 */
router.post('/:templateId/clean-bad-fillers', authenticateJWT, requireRole('admin'), async (req, res) => {
    try {
        const { templateId } = req.params;
        
        // Words that should NEVER be fillers (from STTPreprocessor.js)
        const PROTECTED_WORDS = new Set([
            // Confirmations
            'yes', 'no', 'yeah', 'yep', 'nope', 'yup', 'nah',
            'okay', 'ok', 'alright', 'sure', 'correct', 'right',
            'absolutely', 'definitely', 'certainly', 'exactly',
            
            // Pronouns
            'you', 'we', 'they', 'he', 'she', 'it', 'me', 'us', 'them',
            'your', 'my', 'our', 'their', 'his', 'her', 'its', 'i',
            
            // Question words
            'what', 'when', 'where', 'who', 'how', 'why', 'which',
            
            // Negation
            'not', 'dont', "don't", 'never', 'none', 'nothing',
            
            // Essential verbs
            'do', 'does', 'did', 'done',
            'is', 'are', 'was', 'were', 'be', 'been', 'being',
            'have', 'has', 'had',
            'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must',
            'need', 'want', 'get', 'got',
            
            // Conjunctions & articles
            'and', 'or', 'but', 'if', 'then', 'so', 'because',
            'the', 'a', 'an',
            
            // Numbers
            'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'zero'
        ]);
        
        const profile = await STTProfile.findOne({ templateId, isActive: true });
        if (!profile) {
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        const originalFillers = profile.fillerWords || [];
        const cleanedFillers = originalFillers.filter(f => {
            const phrase = (f.phrase || '').toLowerCase().trim();
            return !PROTECTED_WORDS.has(phrase);
        });
        
        const removed = originalFillers.length - cleanedFillers.length;
        const removedWords = originalFillers
            .filter(f => PROTECTED_WORDS.has((f.phrase || '').toLowerCase().trim()))
            .map(f => f.phrase);
        
        profile.fillerWords = cleanedFillers;
        if (req.user && req.user._id) {
            profile.updatedBy = req.user._id;
        }
        await profile.save();
        
        // Clear cache
        try {
            STTPreprocessor.clearCache(templateId);
        } catch (cacheErr) {
            logger.warn('[STT PROFILE API] Cache clear failed (non-fatal)', { error: cacheErr.message });
        }
        
        logger.info('[STT PROFILE API] Cleaned bad fillers', { 
            templateId, 
            removed, 
            remaining: cleanedFillers.length,
            removedWords 
        });
        
        res.json({ 
            success: true, 
            message: `Removed ${removed} bad fillers, ${cleanedFillers.length} remaining`,
            removed,
            remaining: cleanedFillers.length,
            removedWords
        });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to clean fillers', { error: error.message });
        res.status(500).json({ success: false, error: error.message });
    }
});

// ============================================================================
// Retired seed endpoint (comprehensive setup)
// ============================================================================

/**
 * POST /api/admin/stt-profile/:templateId/seed-all
 * Retired seed endpoint
 */
router.post('/:templateId/seed-all', authenticateJWT, requireRole('admin'), async (req, res) => {
    return res.status(410).json({
        success: false,
        error: 'Seed endpoint retired. Manage STT settings via the admin UI.'
    });
    try {
        const { templateId } = req.params;
        logger.info('[STT PROFILE API] Seed-all CHECKPOINT 1: Starting', { templateId });
        
        const results = { keywords: 0, corrections: 0, fillersRemoved: 0 };
        
        const profile = await STTProfile.findOne({ templateId, isActive: true });
        if (!profile) {
            logger.warn('[STT PROFILE API] Seed-all: Profile not found', { templateId });
            return res.status(404).json({ success: false, error: 'Profile not found' });
        }
        
        logger.info('[STT PROFILE API] Seed-all CHECKPOINT 2: Profile found');
        
        // 1. CLEAN BAD FILLERS
        const PROTECTED_WORDS = new Set([
            'yes', 'no', 'yeah', 'yep', 'nope', 'yup', 'nah', 'okay', 'ok', 'alright', 'sure', 'correct', 'right',
            'you', 'we', 'they', 'he', 'she', 'it', 'me', 'us', 'them', 'your', 'my', 'our', 'their', 'i',
            'what', 'when', 'where', 'who', 'how', 'why', 'which',
            'not', 'dont', "don't", 'never', 'none', 'nothing',
            'do', 'does', 'did', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had',
            'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'need', 'want', 'get', 'got',
            'and', 'or', 'but', 'if', 'then', 'so', 'because', 'the', 'a', 'an',
            'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'zero'
        ]);
        
        const originalFillers = profile.fillerWords || [];
        profile.fillerWords = originalFillers.filter(f => !PROTECTED_WORDS.has((f.phrase || '').toLowerCase().trim()));
        results.fillersRemoved = originalFillers.length - profile.fillerWords.length;
        
        logger.info('[STT PROFILE API] Seed-all CHECKPOINT 3: Fillers cleaned', { fillersRemoved: results.fillersRemoved });
        
        // 2. SEED KEYWORDS (HVAC for now - template-specific in future)
        const hvacKeywords = [
            { phrase: 'air conditioner', boostWeight: 8 }, { phrase: 'AC', boostWeight: 10 },
            { phrase: 'HVAC', boostWeight: 10 }, { phrase: 'furnace', boostWeight: 8 },
            { phrase: 'heat pump', boostWeight: 8 }, { phrase: 'thermostat', boostWeight: 9 },
            { phrase: 'compressor', boostWeight: 7 }, { phrase: 'condenser', boostWeight: 7 },
            { phrase: 'refrigerant', boostWeight: 8 }, { phrase: 'freon', boostWeight: 8 },
            { phrase: 'maintenance', boostWeight: 9 }, { phrase: 'tune up', boostWeight: 9 },
            { phrase: 'repair', boostWeight: 9 }, { phrase: 'installation', boostWeight: 8 },
            { phrase: 'emergency', boostWeight: 10 }, { phrase: 'no heat', boostWeight: 9 },
            { phrase: 'no AC', boostWeight: 9 }, { phrase: 'no cooling', boostWeight: 9 },
            { phrase: 'not working', boostWeight: 8 }, { phrase: 'broken', boostWeight: 8 },
            { phrase: 'leaking', boostWeight: 8 }, { phrase: 'frozen', boostWeight: 8 },
            { phrase: 'appointment', boostWeight: 9 }, { phrase: 'schedule', boostWeight: 9 },
            { phrase: 'technician', boostWeight: 8 }, { phrase: 'today', boostWeight: 8 },
            { phrase: 'tomorrow', boostWeight: 8 }, { phrase: 'ASAP', boostWeight: 8 },
            { phrase: 'service', boostWeight: 9 }, { phrase: 'air conditioning', boostWeight: 9 }
        ];
        
        profile.vocabulary = profile.vocabulary || {};
        profile.vocabulary.boostedKeywords = profile.vocabulary.boostedKeywords || [];
        const existingPhrases = new Set((profile.vocabulary.boostedKeywords || []).map(k => (k.phrase || '').toLowerCase()));
        
        for (const kw of hvacKeywords) {
            if (!existingPhrases.has(kw.phrase.toLowerCase())) {
                profile.vocabulary.boostedKeywords.push({ ...kw, enabled: true, addedBy: 'seed' });
                results.keywords++;
            }
        }
        
        logger.info('[STT PROFILE API] Seed-all CHECKPOINT 4: Keywords seeded', { keywordsAdded: results.keywords });
        
        // 3. SEED COMMON CORRECTIONS (using correct field names: heard/normalized)
        const commonCorrections = [
            { heard: 'condition in', normalized: 'conditioning', context: ['air'], notes: 'air conditioning mishear' },
            { heard: 'thermal stat', normalized: 'thermostat', context: [], notes: 'thermostat mishear' },
            { heard: 'air condition', normalized: 'air conditioning', context: [], notes: 'missing "ing"' },
            { heard: 'fridge rant', normalized: 'refrigerant', context: [], notes: 'refrigerant mishear' },
            { heard: 'condition are', normalized: 'conditioner', context: ['air'], notes: 'air conditioner mishear' },
            { heard: 'hey vac', normalized: 'HVAC', context: [], notes: 'HVAC mishear' }
        ];
        
        profile.corrections = profile.corrections || [];
        const existingCorrections = new Set((profile.corrections || []).map(c => (c.heard || '').toLowerCase()));
        
        for (const corr of commonCorrections) {
            if (!existingCorrections.has(corr.heard.toLowerCase())) {
                profile.corrections.push({ 
                    heard: corr.heard,
                    normalized: corr.normalized,
                    context: corr.context || [],
                    notes: corr.notes || '',
                    enabled: true 
                });
                results.corrections++;
            }
        }
        
        logger.info('[STT PROFILE API] Seed-all CHECKPOINT 5: Corrections seeded', { correctionsAdded: results.corrections });
        
        // Safely set updatedBy
        if (req.user && req.user._id) {
            profile.updatedBy = req.user._id;
        }
        
        logger.info('[STT PROFILE API] Seed-all CHECKPOINT 6: Saving profile...', { 
            hasUser: !!req.user,
            userId: req.user?._id 
        });
        await profile.save();
        logger.info('[STT PROFILE API] Seed-all CHECKPOINT 7: Profile saved successfully');
        
        // Clear cache
        try {
            STTPreprocessor.clearCache(templateId);
            logger.info('[STT PROFILE API] Seed-all CHECKPOINT 8: Cache cleared');
        } catch (cacheErr) {
            logger.warn('[STT PROFILE API] Seed-all: Cache clear failed (non-fatal)', { error: cacheErr.message });
        }
        
        logger.info('[STT PROFILE API] Seeded all defaults', { templateId, results });
        
        res.json({ 
            success: true, 
            message: `Seeded: ${results.keywords} keywords, ${results.corrections} corrections, removed ${results.fillersRemoved} bad fillers`,
            results
        });
        
    } catch (error) {
        logger.error('[STT PROFILE API] Failed to seed all', { 
            error: error.message,
            stack: error.stack,
            name: error.name
        });
        res.status(500).json({ success: false, error: error.message });
    }
});

module.exports = router;
