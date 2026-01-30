/**
 * Deep Audit Service Index
 * 
 * Centralized exports for all Deep Audit functionality.
 * 
 * @module services/deepAudit
 */

// Models
const AuditProfile = require('../../models/AuditProfile');
const ScenarioAuditResult = require('../../models/ScenarioAuditResult');
const ScenarioFixLedger = require('../../models/ScenarioFixLedger');

// Services
const scenarioHash = require('./scenarioHash');
const auditProfileService = require('./auditProfileService');

module.exports = {
    // Models (for direct access if needed)
    AuditProfile,
    ScenarioAuditResult,
    ScenarioFixLedger,
    
    // Hashing utilities
    hashScenarioContent: scenarioHash.hashScenarioContent,
    getScenarioContentSnapshot: scenarioHash.getScenarioContentSnapshot,
    generateAuditCacheKey: scenarioHash.generateAuditCacheKey,
    generateAuditCacheKeyFromScenario: scenarioHash.generateAuditCacheKeyFromScenario,
    CONTENT_FIELDS: scenarioHash.CONTENT_FIELDS,
    
    // Profile management
    getActiveAuditProfile: auditProfileService.getActiveAuditProfile,
    getAuditProfileById: auditProfileService.getAuditProfileById,
    listProfilesForTemplate: auditProfileService.listProfilesForTemplate,
    createAuditProfile: auditProfileService.createAuditProfile,
    setActiveProfile: auditProfileService.setActiveProfile,
    updateProfileStats: auditProfileService.updateProfileStats,
    
    // Admin functions
    purgeProfileResults: auditProfileService.purgeProfileResults,
    purgeScenarioResult: auditProfileService.purgeScenarioResult,
    deleteProfile: auditProfileService.deleteProfile,
    
    // Default config
    DEFAULT_PROFILE_CONFIG: auditProfileService.DEFAULT_PROFILE_CONFIG
};
