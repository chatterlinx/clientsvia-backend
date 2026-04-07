/**
 * ============================================================================
 * GLOBALSHARE API ROUTES
 * Secure Gateway for Shared Resources Across All Companies
 * ============================================================================
 * 
 * ARCHITECTURE:
 * - MongoDB (AdminSettings) = Source of truth (persistent storage)
 * - Redis = Runtime cache (O(1) lookups for 1000+ concurrent calls)
 * - Memory fallback = When Redis unavailable
 * 
 * PERFORMANCE:
 * - Lookup: <1ms (Redis SET SISMEMBER operation)
 * - Search: <10ms with fuzzy matching
 * - Bulk add: ~100ms for 1000 names
 * 
 * SECURITY:
 * - JWT authentication required
 * - No company-specific data (truly global)
 * - Guardrails prevent cross-contamination
 * 
 * ENDPOINTS:
 * - GET /api/admin/globalshare/stats
 * - GET /api/admin/globalshare/first-names
 * - GET /api/admin/globalshare/first-names/search?q=john
 * - POST /api/admin/globalshare/first-names/bulk-add
 * - GET /api/admin/globalshare/last-names
 * - GET /api/admin/globalshare/last-names/search?q=smith
 * - POST /api/admin/globalshare/last-names/bulk-add
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const GlobalHubService = require('../../services/GlobalHubService');
const AdminSettings = require('../../models/AdminSettings');

// 🔒 All routes require authentication
router.use(authenticateJWT);

// ════════════════════════════════════════════════════════════════════════════
// GET /api/admin/globalshare/stats
// Get counts for all dictionaries
// ════════════════════════════════════════════════════════════════════════════

router.get('/stats', async (req, res) => {
  try {
    logger.info('[GlobalShare API] Getting stats');
    
    const firstCount = await GlobalHubService.getFirstNamesCount();
    const lastCount = await GlobalHubService.getLastNamesCount();
    
    res.json({
      firstNames: firstCount,
      lastNames: lastCount,
      total: firstCount + lastCount,
      status: {
        redis: require('../../clients').redisClient?.isReady || false
      }
    });
    
  } catch (error) {
    logger.error('[GlobalShare API] Stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// FIRST NAMES ROUTES
// ════════════════════════════════════════════════════════════════════════════

router.get('/first-names', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    
    logger.info('[GlobalShare API] Getting first names', { limit });
    
    const allNames = await GlobalHubService.getFirstNames();
    const totalCount = allNames.length;
    const names = allNames.slice(0, limit);
    
    res.json({
      names,
      totalCount,
      limit,
      hasMore: totalCount > limit
    });
    
  } catch (error) {
    logger.error('[GlobalShare API] Get first names error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/first-names/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    
    if (!query.trim()) {
      return res.json({ results: [], query });
    }
    
    logger.info('[GlobalShare API] Searching first names', { query });
    
    const allNames = await GlobalHubService.getFirstNames();
    const queryLower = query.toLowerCase();
    
    // Exact match first
    const exactMatches = allNames.filter(name => 
      name.toLowerCase() === queryLower
    ).map(name => ({
      name,
      matchType: 'exact',
      similarity: 1.0
    }));
    
    // Fuzzy matches (starts with)
    const startsWithMatches = allNames.filter(name => 
      name.toLowerCase().startsWith(queryLower) && 
      name.toLowerCase() !== queryLower
    ).map(name => ({
      name,
      matchType: 'fuzzy',
      similarity: 0.9
    }));
    
    // Contains matches
    const containsMatches = allNames.filter(name => 
      name.toLowerCase().includes(queryLower) && 
      !name.toLowerCase().startsWith(queryLower)
    ).map(name => ({
      name,
      matchType: 'fuzzy',
      similarity: 0.7
    }));
    
    const results = [
      ...exactMatches,
      ...startsWithMatches.slice(0, 20),
      ...containsMatches.slice(0, 10)
    ];
    
    res.json({
      results,
      query,
      totalMatches: results.length
    });
    
  } catch (error) {
    logger.error('[GlobalShare API] Search first names error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/first-names/bulk-add', async (req, res) => {
  try {
    const { names } = req.body;
    
    if (!Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ error: 'Invalid names array' });
    }
    
    logger.info('[GlobalShare API] Bulk adding first names', { count: names.length });
    
    // Get current names from AdminSettings
    const settings = await AdminSettings.getSettings();
    const currentNames = new Set(
      (settings?.globalHub?.dictionaries?.firstNames || []).map(n => n.toLowerCase())
    );
    
    // Normalize and deduplicate
    const newNames = [];
    let duplicates = 0;
    
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      
      const titleCase = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
      const lowerKey = titleCase.toLowerCase();
      
      if (currentNames.has(lowerKey)) {
        duplicates++;
      } else {
        currentNames.add(lowerKey);
        newNames.push(titleCase);
      }
    }
    
    if (newNames.length === 0) {
      return res.json({
        added: 0,
        duplicates,
        totalCount: currentNames.size,
        message: 'No new names to add (all were duplicates)'
      });
    }
    
    // Add to existing list
    const allNames = [
      ...(settings?.globalHub?.dictionaries?.firstNames || []),
      ...newNames
    ].sort((a, b) => a.localeCompare(b));
    
    // Save to MongoDB using atomic $set (prevents race condition with concurrent saves)
    const now = new Date();
    await AdminSettings.findOneAndUpdate(
      {},
      { $set: {
        'globalHub.dictionaries.firstNames': allNames,
        'globalHub.dictionaries.firstNamesUpdatedAt': now,
        'globalHub.dictionaries.firstNamesUpdatedBy': req.user?.email || 'api'
      }},
      { upsert: true }
    );
    
    // Sync to Redis immediately
    await GlobalHubService.syncFirstNamesToRedis(allNames);
    
    logger.info('[GlobalShare API] Bulk add complete', {
      added: newNames.length,
      duplicates,
      totalCount: allNames.length
    });
    
    res.json({
      added: newNames.length,
      duplicates,
      totalCount: allNames.length,
      message: `Added ${newNames.length} new names successfully`
    });
    
  } catch (error) {
    logger.error('[GlobalShare API] Bulk add first names error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// LAST NAMES ROUTES
// ════════════════════════════════════════════════════════════════════════════

router.get('/last-names', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 200;
    
    logger.info('[GlobalShare API] Getting last names', { limit });
    
    const allNames = await GlobalHubService.getLastNames();
    const totalCount = allNames.length;
    const names = allNames.slice(0, limit);
    
    res.json({
      names,
      totalCount,
      limit,
      hasMore: totalCount > limit
    });
    
  } catch (error) {
    logger.error('[GlobalShare API] Get last names error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.get('/last-names/search', async (req, res) => {
  try {
    const query = req.query.q || '';
    
    if (!query.trim()) {
      return res.json({ results: [], query });
    }
    
    logger.info('[GlobalShare API] Searching last names', { query });
    
    const allNames = await GlobalHubService.getLastNames();
    const queryLower = query.toLowerCase();
    
    // Exact match first
    const exactMatches = allNames.filter(name => 
      name.toLowerCase() === queryLower
    ).map(name => ({
      name,
      matchType: 'exact',
      similarity: 1.0
    }));
    
    // Fuzzy matches (starts with)
    const startsWithMatches = allNames.filter(name => 
      name.toLowerCase().startsWith(queryLower) && 
      name.toLowerCase() !== queryLower
    ).map(name => ({
      name,
      matchType: 'fuzzy',
      similarity: 0.9
    }));
    
    // Contains matches
    const containsMatches = allNames.filter(name => 
      name.toLowerCase().includes(queryLower) && 
      !name.toLowerCase().startsWith(queryLower)
    ).map(name => ({
      name,
      matchType: 'fuzzy',
      similarity: 0.7
    }));
    
    const results = [
      ...exactMatches,
      ...startsWithMatches.slice(0, 20),
      ...containsMatches.slice(0, 10)
    ];
    
    res.json({
      results,
      query,
      totalMatches: results.length
    });
    
  } catch (error) {
    logger.error('[GlobalShare API] Search last names error:', error);
    res.status(500).json({ error: error.message });
  }
});

router.post('/last-names/bulk-add', async (req, res) => {
  try {
    const { names } = req.body;
    
    if (!Array.isArray(names) || names.length === 0) {
      return res.status(400).json({ error: 'Invalid names array' });
    }
    
    logger.info('[GlobalShare API] Bulk adding last names', { count: names.length });
    
    // Get current names from AdminSettings
    const settings = await AdminSettings.getSettings();
    const currentNames = new Set(
      (settings?.globalHub?.dictionaries?.lastNames || []).map(n => n.toLowerCase())
    );
    
    // Normalize and deduplicate
    const newNames = [];
    let duplicates = 0;
    
    for (const name of names) {
      const trimmed = name.trim();
      if (!trimmed) continue;
      
      const titleCase = trimmed.charAt(0).toUpperCase() + trimmed.slice(1).toLowerCase();
      const lowerKey = titleCase.toLowerCase();
      
      if (currentNames.has(lowerKey)) {
        duplicates++;
      } else {
        currentNames.add(lowerKey);
        newNames.push(titleCase);
      }
    }
    
    if (newNames.length === 0) {
      return res.json({
        added: 0,
        duplicates,
        totalCount: currentNames.size,
        message: 'No new names to add (all were duplicates)'
      });
    }
    
    // Add to existing list
    const allNames = [
      ...(settings?.globalHub?.dictionaries?.lastNames || []),
      ...newNames
    ].sort((a, b) => a.localeCompare(b));
    
    // Save to MongoDB using atomic $set (prevents race condition with concurrent saves)
    const now = new Date();
    await AdminSettings.findOneAndUpdate(
      {},
      { $set: {
        'globalHub.dictionaries.lastNames': allNames,
        'globalHub.dictionaries.lastNamesUpdatedAt': now,
        'globalHub.dictionaries.lastNamesUpdatedBy': req.user?.email || 'api'
      }},
      { upsert: true }
    );
    
    // Sync to Redis immediately
    await GlobalHubService.syncLastNamesToRedis(allNames);
    
    logger.info('[GlobalShare API] Bulk add complete', {
      added: newNames.length,
      duplicates,
      totalCount: allNames.length
    });
    
    res.json({
      added: newNames.length,
      duplicates,
      totalCount: allNames.length,
      message: `Added ${newNames.length} new surnames successfully`
    });
    
  } catch (error) {
    logger.error('[GlobalShare API] Bulk add last names error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// CONVERSATION SIGNALS ROUTES
// ════════════════════════════════════════════════════════════════════════════

const VALID_SIGNAL_GROUPS = ['affirmatives','negatives','bookingPhrases','exitPhrases','transferPhrases'];

/**
 * GET /api/admin/globalshare/signals
 * Returns all 5 signal groups with their current phrase lists.
 * If a group has never been saved to the DB, returns the built-in defaults.
 */
router.get('/signals', async (req, res) => {
    try {
        logger.info('[GlobalShare API] Getting conversation signals');
        const settings = await AdminSettings.getSettings();
        const s = settings?.globalHub?.signals || {};
        const defaults = {
            affirmatives:   GlobalHubService.DEFAULT_AFFIRMATIVES,
            negatives:      GlobalHubService.DEFAULT_NEGATIVES,
            bookingPhrases: GlobalHubService.DEFAULT_BOOKING_PHRASES,
            exitPhrases:    GlobalHubService.DEFAULT_EXIT_PHRASES,
            transferPhrases: GlobalHubService.DEFAULT_TRANSFER_PHRASES
        };

        const result = {};
        for (const group of VALID_SIGNAL_GROUPS) {
            result[group] = s[group]?.length > 0 ? s[group] : [...defaults[group]];
        }
        result.lastUpdatedAt = s.lastUpdatedAt || null;
        result.lastUpdatedBy = s.lastUpdatedBy || null;

        res.json(result);
    } catch (error) {
        logger.error('[GlobalShare API] Get signals error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * PATCH /api/admin/globalshare/signals/:group
 * Save one signal group. Body: { phrases: string[] }
 * Immediately updates the module cache and Redis — live on next call.
 */
router.patch('/signals/:group', async (req, res) => {
    try {
        const { group } = req.params;
        if (!VALID_SIGNAL_GROUPS.includes(group)) {
            return res.status(400).json({ error: `Unknown signal group: ${group}. Valid groups: ${VALID_SIGNAL_GROUPS.join(', ')}` });
        }

        const { phrases } = req.body;
        if (!Array.isArray(phrases)) {
            return res.status(400).json({ error: 'phrases must be an array of strings' });
        }

        // Normalize: trim + deduplicate + filter empty
        const clean = [...new Set(phrases.map(p => (p || '').trim().toLowerCase()).filter(Boolean))];

        logger.info('[GlobalShare API] Saving signals', { group, count: clean.length });
        await GlobalHubService.saveSignals(group, clean, req.user?.email || 'api');

        res.json({ success: true, group, count: clean.length, phrases: clean });
    } catch (error) {
        logger.error('[GlobalShare API] Save signals error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/admin/globalshare/signals/test
 * Test a phrase against all signal groups.
 * Body: { phrase: string }
 * Returns which groups would match, helping admins verify their lists.
 */
router.post('/signals/test', async (req, res) => {
    try {
        const { phrase } = req.body;
        if (!phrase || !phrase.trim()) {
            return res.status(400).json({ error: 'phrase is required' });
        }

        const input = phrase.trim().toLowerCase().replace(/[^a-z'\s]/g, ' ').replace(/\s+/g, ' ').trim();

        const _hasPhrase = (list, p) => {
            if (p.includes(' ')) return input.includes(p);
            return input.split(/\s+/).includes(p);
        };

        const yesRe = GlobalHubService.getYesRegex();
        const noRe  = GlobalHubService.getNoRegex();

        const results = {
            phrase,
            normalized: input,
            matches: {
                affirmatives:   yesRe ? yesRe.test(input) : false,
                negatives:      noRe  ? noRe.test(input)  : false,
                bookingPhrases: GlobalHubService.getSignals('bookingPhrases').some(p => p.includes(' ') ? input.includes(p) : input.split(/\s+/).includes(p)),
                exitPhrases:    GlobalHubService.getSignals('exitPhrases').some(p => p.includes(' ') ? input.includes(p) : input.split(/\s+/).includes(p)),
                transferPhrases: GlobalHubService.getSignals('transferPhrases').some(p => p.includes(' ') ? input.includes(p) : input.split(/\s+/).includes(p))
            }
        };

        // Which specific phrases matched?
        results.matchedPhrases = {};
        for (const group of ['bookingPhrases','exitPhrases','transferPhrases']) {
            const list = GlobalHubService.getSignals(group);
            results.matchedPhrases[group] = list.filter(p =>
                p.includes(' ') ? input.includes(p) : input.split(/\s+/).includes(p)
            );
        }

        res.json(results);
    } catch (error) {
        logger.error('[GlobalShare API] Test signals error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ════════════════════════════════════════════════════════════════════════════
// PHRASE INTELLIGENCE ROUTES
// Global English-language rules for reducing caller phrases to routing cores.
// Used by PhraseReducerService for Tier 3 scoring in KC phrase quality.
// ════════════════════════════════════════════════════════════════════════════

const PhraseReducerService = require('../../services/phraseIntelligence/PhraseReducerService');

/**
 * GET /api/admin/globalshare/phrase-intelligence
 * Returns the current phrase intelligence config (or defaults if never saved).
 */
router.get('/phrase-intelligence', async (req, res) => {
    try {
        logger.info('[GlobalShare API] Getting phrase intelligence config');
        const settings = await AdminSettings.getSettings();
        const pi = settings?.globalHub?.phraseIntelligence || {};

        res.json({
            intentNormalizers: pi.intentNormalizers?.length > 0
                ? pi.intentNormalizers
                : PhraseReducerService.DEFAULT_INTENT_NORMALIZERS,
            synonymGroups: pi.synonymGroups?.length > 0
                ? pi.synonymGroups
                : PhraseReducerService.DEFAULT_SYNONYM_GROUPS,
            stopWords: pi.stopWords?.length > 0
                ? pi.stopWords
                : PhraseReducerService.DEFAULT_STOP_WORDS,
            dangerWords: pi.dangerWords?.length > 0
                ? pi.dangerWords
                : PhraseReducerService.DEFAULT_DANGER_WORDS,
            updatedAt: pi.updatedAt || settings?.globalHub?.phraseIntelligenceUpdatedAt || null,
            updatedBy: pi.updatedBy || settings?.globalHub?.phraseIntelligenceUpdatedBy || null,
        });
    } catch (error) {
        logger.error('[GlobalShare API] Get phrase intelligence error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * PATCH /api/admin/globalshare/phrase-intelligence/:section
 * Save one section of the phrase intelligence config.
 * section: 'intentNormalizers' | 'synonymGroups' | 'stopWords' | 'dangerWords'
 */
const VALID_PI_SECTIONS = ['intentNormalizers', 'synonymGroups', 'stopWords', 'dangerWords', 'cuePhrases'];

router.patch('/phrase-intelligence/:section', async (req, res) => {
    try {
        const { section } = req.params;
        if (!VALID_PI_SECTIONS.includes(section)) {
            return res.status(400).json({ error: `Unknown section: ${section}. Valid: ${VALID_PI_SECTIONS.join(', ')}` });
        }

        const { data } = req.body;
        if (!Array.isArray(data)) {
            return res.status(400).json({ error: 'data must be an array' });
        }

        logger.info('[GlobalShare API] Saving phrase intelligence section', { section, count: data.length });

        const now = new Date();
        await AdminSettings.findOneAndUpdate(
            {},
            { $set: {
                [`globalHub.phraseIntelligence.${section}`]: data,
                'globalHub.phraseIntelligenceUpdatedAt': now,
                'globalHub.phraseIntelligenceUpdatedBy': req.user?.email || 'api'
            }},
            { upsert: true }
        );

        // Invalidate the in-memory cache so next reduce() picks up changes
        PhraseReducerService.invalidateCache();

        // If stop words changed, also invalidate the shared StopWords module
        if (section === 'stopWords') {
            const StopWords = require('../../utils/stopWords');
            StopWords.invalidateCache().catch(() => {});
        }

        res.json({ success: true, section, count: data.length });
    } catch (error) {
        logger.error('[GlobalShare API] Save phrase intelligence error:', error);
        res.status(500).json({ error: error.message });
    }
});

/**
 * POST /api/admin/globalshare/phrase-intelligence/test
 * Test the reducer on a phrase with optional section content.
 * Body: { phrase: string, sectionContent?: string }
 * Returns the full reduction breakdown.
 */
router.post('/phrase-intelligence/test', async (req, res) => {
    try {
        const { phrase, sectionContent } = req.body;
        if (!phrase || !phrase.trim()) {
            return res.status(400).json({ error: 'phrase is required' });
        }

        logger.info('[GlobalShare API] Testing phrase reducer', { phrase });

        const result = await PhraseReducerService.reduce(phrase, sectionContent || '');

        res.json({
            ...result,
            note: 'Stage 1: protected entities from section content | Stage 2: intent normalization | Stage 3: stop word removal'
        });
    } catch (error) {
        logger.error('[GlobalShare API] Phrase intelligence test error:', error);
        res.status(500).json({ error: error.message });
    }
});

module.exports = router;
