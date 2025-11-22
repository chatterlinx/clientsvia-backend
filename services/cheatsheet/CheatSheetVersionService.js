/**
 * ============================================================================
 * CHEATSHEET VERSION SERVICE
 * ============================================================================
 * 
 * Business logic layer for CheatSheet version management.
 * Enforces invariants, handles transactions, manages state transitions.
 * 
 * KEY RESPONSIBILITIES:
 * 1. Create/Save/Delete drafts
 * 2. Push draft live (atomic transaction)
 * 3. Restore archived versions
 * 4. Maintain version history
 * 5. Enforce "one live, one draft per company" rule
 * 6. Generate checksums for integrity
 * 7. Audit logging for all operations
 * 
 * CRITICAL INVARIANTS (enforced by this service):
 * - At most ONE live version per company
 * - At most ONE draft version per company
 * - Live config is READ-ONLY (create draft to edit)
 * - Status transitions: draft → live → archived (one way)
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const crypto = require('crypto');
const CheatSheetVersion = require('../../models/cheatsheet/CheatSheetVersion');
const CheatSheetAuditLog = require('../../models/cheatsheet/CheatSheetAuditLog');
const Company = require('../../models/v2Company');
const logger = require('../../utils/logger');
const {
  DraftNotFoundError,
  DraftAlreadyExistsError,
  DraftVersionConflictError,
  NoLiveConfigError,
  LiveConfigNotFoundError,
  CannotEditLiveError,
  VersionNotFoundError,
  InvalidVersionStatusError,
  ConfigTooLargeError,
  TransactionFailedError,
  InconsistentStateError
} = require('../../utils/errors/CheatSheetErrors');

class CheatSheetVersionService {
  
  // ============================================================================
  // DRAFT OPERATIONS
  // ============================================================================
  
  /**
   * Create draft from live config (or from scratch)
   * 
   * @param {string} companyId - Company ID
   * @param {string} name - Draft name
   * @param {string} userEmail - User creating draft
   * @param {string|null} baseVersionId - Optional: clone from specific version
   * @param {object} metadata - Optional: request metadata (IP, user agent)
   * @returns {Promise<object>} Created draft
   * @throws {DraftAlreadyExistsError} If draft already exists
   * @throws {VersionNotFoundError} If baseVersionId invalid
   */
  async createDraft(companyId, name, userEmail, baseVersionId = null, metadata = {}) {
    logger.info('CHEATSHEET_VERSION_CREATE_DRAFT', {
      companyId,
      name,
      userEmail,
      baseVersionId
    });
    
    try {
      // GUARD: Only one draft per company
      const existingDraft = await CheatSheetVersion.findOne({
        companyId,
        status: 'draft'
      });
      
      if (existingDraft) {
        throw new DraftAlreadyExistsError(companyId, existingDraft.versionId);
      }
      
      // Get base config (from live, specific version, or empty)
      let baseConfig = this._getDefaultConfig();
      
      if (baseVersionId) {
        const baseVersion = await CheatSheetVersion.findOne({
          companyId,
          versionId: baseVersionId
        });
        if (!baseVersion) {
          throw new VersionNotFoundError(companyId, baseVersionId);
        }
        baseConfig = baseVersion.config.toObject();
      } else {
        // Clone from current live (if exists)
        const live = await CheatSheetVersion.findOne({
          companyId,
          status: 'live'
        });
        if (live) {
          baseConfig = live.config.toObject();
        }
      }
      
      // Validate config size
      this._validateConfigSize(baseConfig);
      
      // Create draft
      const draft = await CheatSheetVersion.create({
        companyId,
        status: 'draft',
        versionId: this._generateVersionId('draft'),
        name,
        createdBy: userEmail,
        config: baseConfig,
        checksum: this._generateChecksum(baseConfig)
      });
      
      // Update company pointer
      await Company.updateOne(
        { _id: companyId },
        { $set: { 'aiAgentSettings.cheatSheetMeta.draftVersionId': draft.versionId } }
      );
      
      // Audit log
      await CheatSheetAuditLog.logAction({
        companyId,
        versionId: draft.versionId,
        action: 'create_draft',
        actor: userEmail,
        actorIp: metadata.ip || null,
        actorUserAgent: metadata.userAgent || null,
        newState: { name, baseVersionId },
        metadata: { clonedFrom: baseVersionId || 'live' },
        success: true
      });
      
      logger.info('CHEATSHEET_VERSION_DRAFT_CREATED', {
        companyId,
        draftVersionId: draft.versionId,
        name
      });
      
      return draft;
      
    } catch (err) {
      // Audit log failure
      await CheatSheetAuditLog.logAction({
        companyId,
        versionId: 'unknown',
        action: 'create_draft',
        actor: userEmail,
        actorIp: metadata.ip || null,
        metadata: { name, baseVersionId },
        success: false,
        errorMessage: err.message
      });
      
      throw err;
    }
  }
  
  /**
   * Save draft (update config only)
   * 
   * @param {string} companyId - Company ID
   * @param {string} draftVersionId - Draft version ID
   * @param {object} config - Updated config
   * @param {string} userEmail - User saving draft
   * @param {number|null} expectedVersion - Optional: __v for optimistic concurrency
   * @param {object} metadata - Optional: request metadata
   * @returns {Promise<object>} Updated draft
   * @throws {DraftNotFoundError} If draft doesn't exist
   * @throws {DraftVersionConflictError} If version conflict
   * @throws {ConfigTooLargeError} If config exceeds size limit
   */
  async saveDraft(companyId, draftVersionId, config, userEmail, expectedVersion = null, metadata = {}) {
    logger.info('CHEATSHEET_VERSION_SAVE_DRAFT', {
      companyId,
      draftVersionId,
      userEmail,
      expectedVersion
    });
    
    try {
      const draft = await CheatSheetVersion.findOne({
        companyId,
        versionId: draftVersionId,
        status: 'draft'
      });
      
      if (!draft) {
        throw new DraftNotFoundError(companyId, draftVersionId);
      }
      
      // Optimistic concurrency check
      if (expectedVersion !== null && draft.__v !== expectedVersion) {
        throw new DraftVersionConflictError(
          companyId,
          draftVersionId,
          expectedVersion,
          draft.__v
        );
      }
      
      // Validate config size
      this._validateConfigSize(config);
      
      // Store previous state for audit
      const previousState = {
        checksum: draft.checksum,
        version: draft.__v
      };
      
      // Update draft
      draft.config = config;
      draft.checksum = this._generateChecksum(config);
      await draft.save();
      
      // Audit log
      await CheatSheetAuditLog.logAction({
        companyId,
        versionId: draftVersionId,
        action: 'save_draft',
        actor: userEmail,
        actorIp: metadata.ip || null,
        actorUserAgent: metadata.userAgent || null,
        previousState,
        newState: { checksum: draft.checksum, version: draft.__v },
        success: true
      });
      
      logger.info('CHEATSHEET_VERSION_DRAFT_SAVED', {
        companyId,
        draftVersionId,
        checksum: draft.checksum
      });
      
      return draft;
      
    } catch (err) {
      // Audit log failure
      await CheatSheetAuditLog.logAction({
        companyId,
        versionId: draftVersionId,
        action: 'save_draft',
        actor: userEmail,
        actorIp: metadata.ip || null,
        success: false,
        errorMessage: err.message
      });
      
      throw err;
    }
  }
  
  /**
   * Discard draft (delete)
   * 
   * @param {string} companyId - Company ID
   * @param {string} draftVersionId - Draft version ID
   * @param {string} userEmail - User discarding draft
   * @param {object} metadata - Optional: request metadata
   * @returns {Promise<void>}
   * @throws {DraftNotFoundError} If draft doesn't exist
   */
  async discardDraft(companyId, draftVersionId, userEmail, metadata = {}) {
    logger.info('CHEATSHEET_VERSION_DISCARD_DRAFT', {
      companyId,
      draftVersionId,
      userEmail
    });
    
    try {
      const draft = await CheatSheetVersion.findOne({
        companyId,
        versionId: draftVersionId,
        status: 'draft'
      });
      
      if (!draft) {
        throw new DraftNotFoundError(companyId, draftVersionId);
      }
      
      const previousState = {
        name: draft.name,
        checksum: draft.checksum
      };
      
      // Hard delete (Option 1)
      await draft.deleteOne();
      
      // OR Archive it (Option 2 - safer)
      // draft.status = 'archived';
      // draft.archivedAt = new Date();
      // await draft.save();
      
      // Clear company pointer
      await Company.updateOne(
        { _id: companyId },
        { $set: { 'aiAgentSettings.cheatSheetMeta.draftVersionId': null } }
      );
      
      // Audit log
      await CheatSheetAuditLog.logAction({
        companyId,
        versionId: draftVersionId,
        action: 'discard_draft',
        actor: userEmail,
        actorIp: metadata.ip || null,
        actorUserAgent: metadata.userAgent || null,
        previousState,
        success: true
      });
      
      logger.info('CHEATSHEET_VERSION_DRAFT_DISCARDED', {
        companyId,
        draftVersionId
      });
      
    } catch (err) {
      // Audit log failure
      await CheatSheetAuditLog.logAction({
        companyId,
        versionId: draftVersionId,
        action: 'discard_draft',
        actor: userEmail,
        actorIp: metadata.ip || null,
        success: false,
        errorMessage: err.message
      });
      
      throw err;
    }
  }
  
  // ============================================================================
  // PUSH LIVE (ATOMIC TRANSACTION)
  // ============================================================================
  
  /**
   * Push draft to live (atomic operation)
   * 
   * This is the CRITICAL operation that requires transactions.
   * All 3 steps happen atomically or none happen:
   * 1. Old live → archived
   * 2. Draft → live
   * 3. Company pointers updated
   * 
   * @param {string} companyId - Company ID
   * @param {string} draftVersionId - Draft version ID
   * @param {string} userEmail - User pushing live
   * @param {object} metadata - Optional: request metadata
   * @returns {Promise<object>} Newly live version
   * @throws {DraftNotFoundError} If draft doesn't exist
   * @throws {TransactionFailedError} If transaction fails
   */
  async pushDraftLive(companyId, draftVersionId, userEmail, metadata = {}) {
    logger.info('CHEATSHEET_VERSION_PUSH_LIVE', {
      companyId,
      draftVersionId,
      userEmail
    });
    
    const session = await mongoose.startSession();
    let previousLiveVersionId = null;
    
    try {
      await session.withTransaction(async () => {
        // Fetch draft and current live (within transaction)
        const [draft, currentLive] = await Promise.all([
          CheatSheetVersion.findOne({
            companyId,
            versionId: draftVersionId,
            status: 'draft'
          }).session(session),
          CheatSheetVersion.findOne({
            companyId,
            status: 'live'
          }).session(session)
        ]);
        
        if (!draft) {
          throw new DraftNotFoundError(companyId, draftVersionId);
        }
        
        // Step 1: Archive old live (if exists)
        if (currentLive) {
          previousLiveVersionId = currentLive.versionId;
          currentLive.status = 'archived';
          currentLive.archivedAt = new Date();
          await currentLive.save({ session });
          
          logger.debug('CHEATSHEET_VERSION_LIVE_ARCHIVED', {
            companyId,
            archivedVersionId: currentLive.versionId
          });
        }
        
        // Step 2: Promote draft to live
        draft.status = 'live';
        draft.activatedAt = new Date();
        await draft.save({ session });
        
        logger.debug('CHEATSHEET_VERSION_DRAFT_PROMOTED', {
          companyId,
          newLiveVersionId: draft.versionId
        });
        
        // Step 3: Update company pointers
        await Company.updateOne(
          { _id: companyId },
          {
            $set: {
              'aiAgentSettings.cheatSheetMeta.liveVersionId': draft.versionId,
              'aiAgentSettings.cheatSheetMeta.draftVersionId': null
            }
          },
          { session }
        );
        
        logger.debug('CHEATSHEET_VERSION_COMPANY_POINTERS_UPDATED', {
          companyId,
          newLiveVersionId: draft.versionId
        });
      });
      
      // Transaction successful - audit log
      await CheatSheetAuditLog.logAction({
        companyId,
        versionId: draftVersionId,
        action: 'push_live',
        actor: userEmail,
        actorIp: metadata.ip || null,
        actorUserAgent: metadata.userAgent || null,
        previousState: { liveVersionId: previousLiveVersionId },
        newState: { liveVersionId: draftVersionId },
        metadata: { archivedVersionId: previousLiveVersionId },
        success: true
      });
      
      logger.info('CHEATSHEET_VERSION_PUSH_LIVE_SUCCESS', {
        companyId,
        newLiveVersionId: draftVersionId,
        previousLiveVersionId
      });
      
      // Fetch and return the newly live version
      const newLive = await CheatSheetVersion.findOne({
        companyId,
        versionId: draftVersionId,
        status: 'live'
      });
      
      // Update GlobalConfigReference to point to new live (if company shared to global)
      const GlobalConfigReference = require('../../models/GlobalConfigReference');
      const updateResult = await GlobalConfigReference.updateOne(
        { companyId, cheatSheetVersionId: { $exists: true } },
        { $set: { cheatSheetVersionId: newLive._id } }
      ).catch(err => {
        logger.debug('GLOBAL_CONFIG_UPDATE_FAILED', { companyId, error: err.message });
        return { modifiedCount: 0 };
      });
      
      if (updateResult.modifiedCount > 0) {
        logger.info('GLOBAL_CONFIG_REFERENCE_UPDATED', { 
          companyId, 
          newLiveVersionId: newLive._id 
        });
      } else {
        logger.debug('GLOBAL_CONFIG_REFERENCE_NOT_PRESENT', { companyId });
      }
      
      return newLive;
      
    } catch (err) {
      // Transaction failed - audit log
      await CheatSheetAuditLog.logAction({
        companyId,
        versionId: draftVersionId,
        action: 'push_live',
        actor: userEmail,
        actorIp: metadata.ip || null,
        success: false,
        errorMessage: err.message
      });
      
      logger.error('CHEATSHEET_VERSION_PUSH_LIVE_FAILED', {
        companyId,
        draftVersionId,
        error: err.message
      });
      
      throw new TransactionFailedError('push_live', err);
      
    } finally {
      session.endSession();
    }
  }
  
  // ============================================================================
  // VERSION HISTORY & RESTORE
  // ============================================================================
  
  /**
   * Get version history for a company
   * 
   * @param {string} companyId - Company ID
   * @param {number} limit - Max versions to return
   * @returns {Promise<Array>} Version history
   */
  async getVersionHistory(companyId, limit = 50) {
    return await CheatSheetVersion.find({
      companyId,
      status: { $in: ['live', 'archived'] }
    })
    .sort({ activatedAt: -1, createdAt: -1 })
    .limit(limit)
    .select('-config') // Don't return full config (too large)
    .lean();
  }
  
  /**
   * Restore version (create draft from archived version)
   * 
   * @param {string} companyId - Company ID
   * @param {string} versionId - Version to restore
   * @param {string} newName - Name for new draft
   * @param {string} userEmail - User restoring version
   * @param {object} metadata - Optional: request metadata
   * @returns {Promise<object>} Created draft
   * @throws {VersionNotFoundError} If version doesn't exist
   * @throws {DraftAlreadyExistsError} If draft already exists
   */
  async restoreVersion(companyId, versionId, newName, userEmail, metadata = {}) {
    logger.info('CHEATSHEET_VERSION_RESTORE', {
      companyId,
      versionId,
      newName,
      userEmail
    });
    
    try {
      const version = await CheatSheetVersion.findOne({
        companyId,
        versionId
      });
      
      if (!version) {
        throw new VersionNotFoundError(companyId, versionId);
      }
      
      // Create draft from this version
      const draft = await this.createDraft(
        companyId,
        newName,
        userEmail,
        versionId,
        metadata
      );
      
      // Additional audit log for restore action
      await CheatSheetAuditLog.logAction({
        companyId,
        versionId: draft.versionId,
        action: 'restore_version',
        actor: userEmail,
        actorIp: metadata.ip || null,
        actorUserAgent: metadata.userAgent || null,
        metadata: { restoredFrom: versionId, restoredFromName: version.name },
        success: true
      });
      
      logger.info('CHEATSHEET_VERSION_RESTORED', {
        companyId,
        restoredVersionId: versionId,
        newDraftId: draft.versionId
      });
      
      return draft;
      
    } catch (err) {
      // Audit log failure
      await CheatSheetAuditLog.logAction({
        companyId,
        versionId,
        action: 'restore_version',
        actor: userEmail,
        actorIp: metadata.ip || null,
        success: false,
        errorMessage: err.message
      });
      
      throw err;
    }
  }
  
  // ============================================================================
  // STATUS QUERIES
  // ============================================================================
  
  /**
   * Get live and draft status for a company
   * 
   * @param {string} companyId - Company ID
   * @returns {Promise<object>} Status object with live and draft info
   */
  async getStatus(companyId) {
    const [live, draft] = await Promise.all([
      CheatSheetVersion.findOne({ companyId, status: 'live' })
        .select('-config')
        .lean(),
      CheatSheetVersion.findOne({ companyId, status: 'draft' })
        .select('-config')
        .lean()
    ]);
    
    return {
      live: live ? this._formatVersionSummary(live) : null,
      draft: draft ? this._formatVersionSummary(draft) : null
    };
  }
  
  /**
   * Get specific version by ID
   * 
   * @param {string} companyId - Company ID
   * @param {string} versionId - Version ID
   * @param {boolean} includeConfig - Whether to include full config
   * @returns {Promise<object>} Version document
   * @throws {VersionNotFoundError} If version doesn't exist
   */
  async getVersion(companyId, versionId, includeConfig = false) {
    const query = CheatSheetVersion.findOne({ companyId, versionId });
    
    if (!includeConfig) {
      query.select('-config');
    }
    
    const version = await query.lean();
    
    if (!version) {
      throw new VersionNotFoundError(companyId, versionId);
    }
    
    return version;
  }
  
  // ============================================================================
  // HELPER METHODS
  // ============================================================================
  
  /**
   * Generate version ID
   * @private
   */
  _generateVersionId(prefix = 'version') {
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');
    return `${prefix}-${timestamp}-${random}`;
  }
  
  /**
   * Generate checksum for config
   * @private
   */
  _generateChecksum(config) {
    return crypto
      .createHash('sha256')
      .update(JSON.stringify(config))
      .digest('hex')
      .substring(0, 16);
  }
  
  /**
   * Validate config size
   * @private
   * @throws {ConfigTooLargeError} If config exceeds limit
   */
  _validateConfigSize(config) {
    const size = JSON.stringify(config).length;
    const maxSize = 5 * 1024 * 1024; // 5MB
    
    if (size > maxSize) {
      const sizeMB = (size / 1024 / 1024).toFixed(2);
      const maxSizeMB = 5;
      throw new ConfigTooLargeError(sizeMB, maxSizeMB);
    }
  }
  
  /**
   * Get default empty config
   * @private
   */
  _getDefaultConfig() {
    return {
      schemaVersion: 1,
      triage: {},
      frontlineIntel: {},
      transferRules: {},
      edgeCases: {},
      behavior: {},
      guardrails: {},
      bookingRules: [],
      companyContacts: [],
      links: [],
      calculators: []
    };
  }
  
  /**
   * Format version summary for API responses
   * @private
   */
  _formatVersionSummary(version) {
    return {
      versionId: version.versionId,
      name: version.name,
      status: version.status,
      createdBy: version.createdBy,
      createdAt: version.createdAt,
      activatedAt: version.activatedAt,
      checksum: version.checksum,
      schemaVersion: version.config?.schemaVersion || 1,
      stats: {
        bookingRules: version.config?.bookingRules?.length || 0,
        companyContacts: version.config?.companyContacts?.length || 0,
        links: version.config?.links?.length || 0,
        calculators: version.config?.calculators?.length || 0
      }
    };
  }
}

// ============================================================================
// EXPORT SINGLETON
// ============================================================================
module.exports = new CheatSheetVersionService();

