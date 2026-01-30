/**
 * Audit Profile Service
 * 
 * Manages audit profiles for Deep Audit.
 * 
 * KEY CONCEPTS:
 * - Each template has ONE active profile
 * - Creating a new profile allows "starting over" with new standards
 * - Old profiles are preserved for historical reference
 * 
 * @module services/deepAudit/auditProfileService
 */
const AuditProfile = require('../../models/AuditProfile');
const ScenarioAuditResult = require('../../models/ScenarioAuditResult');
const logger = require('../../utils/logger');

// ════════════════════════════════════════════════════════════════════════════
// DEFAULT PROFILE CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_PROFILE_CONFIG = {
    name: 'HVAC Global Standard v1 - Tight Dispatcher',
    description: 'Default profile with tight dispatcher standards. Quick replies ≤15 words, full replies ≤25 words, no help desk phrases.',
    
    toneLevel: 'tight_dispatcher',
    
    lengthRules: {
        quickMaxWords: 15,
        fullMaxWords: 25,
        empathyMaxWords: 3
    },
    
    bannedPhrases: [
        "I'd be happy to",
        "Absolutely",
        "Definitely", 
        "Of course",
        "Thanks for",
        "No problem",
        "No worries",
        "Great question",
        "Have you tried",
        "Have you checked"
    ],
    
    placeholderPolicy: {
        allowed: ['callerName', 'companyName', 'techName'],
        forbidden: ['name'],
        strictUnknown: true
    },
    
    blueprintMatchingMode: 'strict',
    minMatchConfidence: 0.75,
    
    scoreBands: {
        perfect: { min: 9, max: 10 },
        good: { min: 7, max: 8 },
        needsWork: { min: 0, max: 6 }
    },
    
    rulesJson: {
        // Full rubric configuration
        enforceDiagnosticQuestion: true,
        enforceBookingMove: true,
        enforceWordLimits: true,
        enforceBannedPhrases: true,
        enforcePlaceholderPolicy: true,
        allowEmptyNoNameVariants: false
    }
};

// ════════════════════════════════════════════════════════════════════════════
// CORE FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Get the active audit profile for a template
 * Creates default if none exists
 * 
 * @param {string} templateId - Global template ID
 * @returns {Object} Active audit profile
 */
async function getActiveAuditProfile(templateId) {
    try {
        // Try to find existing active profile
        let active = await AuditProfile.findOne({ 
            templateId, 
            isActive: true 
        }).lean();
        
        if (active) {
            logger.debug('[AUDIT_PROFILE] Found active profile', {
                templateId,
                auditProfileId: active._id.toString(),
                name: active.name
            });
            return active;
        }
        
        // No active profile - create default
        logger.info('[AUDIT_PROFILE] No active profile found, creating default', { templateId });
        
        const created = await AuditProfile.create({
            templateId,
            ...DEFAULT_PROFILE_CONFIG,
            isActive: true,
            createdBy: 'system'
        });
        
        logger.info('[AUDIT_PROFILE] Created default profile', {
            templateId,
            auditProfileId: created._id.toString()
        });
        
        return created.toObject();
        
    } catch (error) {
        logger.error('[AUDIT_PROFILE] Error getting active profile', {
            templateId,
            error: error.message
        });
        throw error;
    }
}

/**
 * Get audit profile by ID
 * 
 * @param {string} auditProfileId
 * @returns {Object|null} Profile or null
 */
async function getAuditProfileById(auditProfileId) {
    return AuditProfile.findById(auditProfileId).lean();
}

/**
 * List all profiles for a template
 * 
 * @param {string} templateId
 * @returns {Array} List of profiles
 */
async function listProfilesForTemplate(templateId) {
    const profiles = await AuditProfile.find({ templateId })
        .sort({ createdAt: -1 })
        .lean();
    
    // Add stats for each profile
    const profilesWithStats = await Promise.all(
        profiles.map(async (profile) => {
            const stats = await ScenarioAuditResult.getProfileStats(
                templateId, 
                profile._id.toString()
            );
            return { ...profile, stats };
        })
    );
    
    return profilesWithStats;
}

/**
 * Create a new audit profile
 * 
 * @param {Object} params
 * @param {string} params.templateId
 * @param {string} params.name
 * @param {Object} params.config - Override default config
 * @param {string} params.cloneFromProfileId - Clone settings from existing profile
 * @param {string} params.createdBy
 * @returns {Object} Created profile
 */
async function createAuditProfile({
    templateId,
    name,
    description = '',
    config = {},
    cloneFromProfileId = null,
    createdBy = 'admin'
}) {
    let baseConfig = { ...DEFAULT_PROFILE_CONFIG };
    
    // Clone from existing profile if specified
    if (cloneFromProfileId) {
        const source = await AuditProfile.findById(cloneFromProfileId).lean();
        if (source) {
            baseConfig = {
                toneLevel: source.toneLevel,
                lengthRules: source.lengthRules,
                bannedPhrases: source.bannedPhrases,
                placeholderPolicy: source.placeholderPolicy,
                blueprintMatchingMode: source.blueprintMatchingMode,
                minMatchConfidence: source.minMatchConfidence,
                scoreBands: source.scoreBands,
                rulesJson: source.rulesJson
            };
            logger.info('[AUDIT_PROFILE] Cloning from existing profile', {
                sourceProfileId: cloneFromProfileId,
                sourceName: source.name
            });
        }
    }
    
    // Merge with provided config
    const finalConfig = {
        ...baseConfig,
        ...config,
        lengthRules: { ...baseConfig.lengthRules, ...(config.lengthRules || {}) },
        placeholderPolicy: { ...baseConfig.placeholderPolicy, ...(config.placeholderPolicy || {}) },
        scoreBands: { ...baseConfig.scoreBands, ...(config.scoreBands || {}) },
        rulesJson: { ...baseConfig.rulesJson, ...(config.rulesJson || {}) }
    };
    
    const profile = await AuditProfile.create({
        templateId,
        name,
        description,
        isActive: false, // New profiles start inactive
        ...finalConfig,
        createdBy
    });
    
    logger.info('[AUDIT_PROFILE] Created new profile', {
        templateId,
        auditProfileId: profile._id.toString(),
        name,
        clonedFrom: cloneFromProfileId
    });
    
    return profile.toObject();
}

/**
 * Set a profile as active (deactivates all others)
 * 
 * @param {string} templateId
 * @param {string} auditProfileId
 * @returns {Object} Updated profile
 */
async function setActiveProfile(templateId, auditProfileId) {
    // Deactivate all profiles for this template
    await AuditProfile.updateMany(
        { templateId },
        { $set: { isActive: false } }
    );
    
    // Activate the specified profile
    const updated = await AuditProfile.findByIdAndUpdate(
        auditProfileId,
        { $set: { isActive: true } },
        { new: true }
    ).lean();
    
    if (!updated) {
        throw new Error(`Audit profile not found: ${auditProfileId}`);
    }
    
    logger.info('[AUDIT_PROFILE] Activated profile', {
        templateId,
        auditProfileId,
        name: updated.name
    });
    
    return updated;
}

/**
 * Update profile stats after an audit run
 * 
 * @param {string} auditProfileId
 * @param {Object} stats
 */
async function updateProfileStats(auditProfileId, { perfectCount, needsWorkCount }) {
    await AuditProfile.findByIdAndUpdate(auditProfileId, {
        $set: {
            'stats.lastRunAt': new Date(),
            'stats.lastPerfectCount': perfectCount,
            'stats.lastNeedsWorkCount': needsWorkCount
        },
        $inc: { 'stats.totalRuns': 1 }
    });
}

/**
 * Purge all audit results for a profile (admin reset)
 * This forces re-audit of all scenarios
 * 
 * @param {string} templateId
 * @param {string} auditProfileId
 * @returns {number} Number of results deleted
 */
async function purgeProfileResults(templateId, auditProfileId) {
    const deleted = await ScenarioAuditResult.purgeForProfile(templateId, auditProfileId);
    
    logger.warn('[AUDIT_PROFILE] Purged all results for profile', {
        templateId,
        auditProfileId,
        deletedCount: deleted
    });
    
    return deleted;
}

/**
 * Purge audit result for a single scenario
 * This forces re-audit of just that scenario
 * 
 * @param {string} templateId
 * @param {string} scenarioId
 * @param {string} auditProfileId
 * @returns {number} Number of results deleted
 */
async function purgeScenarioResult(templateId, scenarioId, auditProfileId) {
    const deleted = await ScenarioAuditResult.purgeForScenario(
        templateId, 
        scenarioId, 
        auditProfileId
    );
    
    logger.info('[AUDIT_PROFILE] Purged result for scenario', {
        templateId,
        scenarioId,
        auditProfileId,
        deletedCount: deleted
    });
    
    return deleted;
}

/**
 * Delete a profile (must not be active)
 * 
 * @param {string} auditProfileId
 * @returns {boolean} Success
 */
async function deleteProfile(auditProfileId) {
    const profile = await AuditProfile.findById(auditProfileId);
    
    if (!profile) {
        throw new Error(`Profile not found: ${auditProfileId}`);
    }
    
    if (profile.isActive) {
        throw new Error('Cannot delete active profile. Activate another profile first.');
    }
    
    // Delete the profile
    await AuditProfile.findByIdAndDelete(auditProfileId);
    
    // Also delete all results for this profile
    await ScenarioAuditResult.deleteMany({ auditProfileId });
    
    logger.warn('[AUDIT_PROFILE] Deleted profile and results', {
        auditProfileId,
        name: profile.name
    });
    
    return true;
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

module.exports = {
    // Constants
    DEFAULT_PROFILE_CONFIG,
    
    // Core functions
    getActiveAuditProfile,
    getAuditProfileById,
    listProfilesForTemplate,
    createAuditProfile,
    setActiveProfile,
    updateProfileStats,
    
    // Admin functions
    purgeProfileResults,
    purgeScenarioResult,
    deleteProfile
};
