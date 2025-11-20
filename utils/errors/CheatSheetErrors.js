/**
 * ============================================================================
 * CHEATSHEET CUSTOM ERROR CLASSES
 * ============================================================================
 * 
 * Enterprise-grade error handling for CheatSheet versioning system.
 * Each error has:
 * - Unique error code (for API/UI error mapping)
 * - Human-readable message
 * - Structured details (for logging/debugging)
 * 
 * Usage:
 *   throw new DraftNotFoundError(companyId, draftVersionId);
 * 
 * Benefits:
 * - UI can show friendly messages based on error.code
 * - Logs can filter/alert on specific error types
 * - Debugging is 10x faster with structured errors
 * ============================================================================
 */

/**
 * Base CheatSheet Error
 * All CheatSheet errors extend this class
 */
class CheatSheetError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'CheatSheetError';
    this.code = code;
    this.details = details;
    this.timestamp = new Date().toISOString();
    
    // Maintain proper stack trace (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
  
  toJSON() {
    return {
      error: this.code,
      message: this.message,
      details: this.details,
      timestamp: this.timestamp
    };
  }
}

// ============================================================================
// DRAFT-RELATED ERRORS
// ============================================================================

/**
 * Draft Not Found
 * Thrown when trying to access a draft that doesn't exist
 */
class DraftNotFoundError extends CheatSheetError {
  constructor(companyId, draftVersionId) {
    super(
      'DRAFT_NOT_FOUND',
      `Draft ${draftVersionId} not found for company ${companyId}`,
      { companyId, draftVersionId }
    );
    this.name = 'DraftNotFoundError';
  }
}

/**
 * Draft Already Exists
 * Thrown when trying to create a second draft (only one draft per company allowed)
 */
class DraftAlreadyExistsError extends CheatSheetError {
  constructor(companyId, existingDraftId) {
    super(
      'DRAFT_ALREADY_EXISTS',
      `Company ${companyId} already has an active draft: ${existingDraftId}`,
      { companyId, existingDraftId }
    );
    this.name = 'DraftAlreadyExistsError';
  }
}

/**
 * Draft Version Conflict
 * Thrown when two admins try to edit the same draft simultaneously
 */
class DraftVersionConflictError extends CheatSheetError {
  constructor(companyId, draftVersionId, expectedVersion, actualVersion) {
    super(
      'DRAFT_VERSION_CONFLICT',
      `Draft ${draftVersionId} was modified by another user. Please reload and try again.`,
      { companyId, draftVersionId, expectedVersion, actualVersion }
    );
    this.name = 'DraftVersionConflictError';
  }
}

// ============================================================================
// LIVE CONFIG ERRORS
// ============================================================================

/**
 * No Live Config
 * Thrown when company has no live config set (must have one for production)
 */
class NoLiveConfigError extends CheatSheetError {
  constructor(companyId) {
    super(
      'NO_LIVE_CONFIG',
      `Company ${companyId} has no live configuration set`,
      { companyId }
    );
    this.name = 'NoLiveConfigError';
  }
}

/**
 * Live Config Not Found
 * Thrown when liveVersionId points to non-existent version
 */
class LiveConfigNotFoundError extends CheatSheetError {
  constructor(companyId, liveVersionId) {
    super(
      'LIVE_CONFIG_NOT_FOUND',
      `Live config ${liveVersionId} not found for company ${companyId}`,
      { companyId, liveVersionId }
    );
    this.name = 'LiveConfigNotFoundError';
  }
}

/**
 * Cannot Edit Live Directly
 * Thrown when trying to modify live config (must create draft first)
 */
class CannotEditLiveError extends CheatSheetError {
  constructor(companyId, liveVersionId) {
    super(
      'CANNOT_EDIT_LIVE',
      `Cannot edit live config directly. Create a draft first.`,
      { companyId, liveVersionId }
    );
    this.name = 'CannotEditLiveError';
  }
}

// ============================================================================
// VERSION ERRORS
// ============================================================================

/**
 * Version Not Found
 * Thrown when trying to access a version that doesn't exist
 */
class VersionNotFoundError extends CheatSheetError {
  constructor(companyId, versionId) {
    super(
      'VERSION_NOT_FOUND',
      `Version ${versionId} not found for company ${companyId}`,
      { companyId, versionId }
    );
    this.name = 'VersionNotFoundError';
  }
}

/**
 * Invalid Version Status
 * Thrown when version has invalid status
 */
class InvalidVersionStatusError extends CheatSheetError {
  constructor(versionId, currentStatus, expectedStatus) {
    super(
      'INVALID_VERSION_STATUS',
      `Version ${versionId} has status '${currentStatus}', expected '${expectedStatus}'`,
      { versionId, currentStatus, expectedStatus }
    );
    this.name = 'InvalidVersionStatusError';
  }
}

// ============================================================================
// VALIDATION ERRORS
// ============================================================================

/**
 * Config Too Large
 * Thrown when config exceeds size limits
 */
class ConfigTooLargeError extends CheatSheetError {
  constructor(sizeMB, maxSizeMB) {
    super(
      'CONFIG_TOO_LARGE',
      `Configuration too large: ${sizeMB}MB (max ${maxSizeMB}MB)`,
      { sizeMB, maxSizeMB }
    );
    this.name = 'ConfigTooLargeError';
  }
}

/**
 * Invalid Config Schema
 * Thrown when config doesn't match expected schema
 */
class InvalidConfigSchemaError extends CheatSheetError {
  constructor(validationErrors) {
    super(
      'INVALID_CONFIG_SCHEMA',
      `Configuration validation failed: ${validationErrors.join(', ')}`,
      { validationErrors }
    );
    this.name = 'InvalidConfigSchemaError';
  }
}

/**
 * Unsupported Schema Version
 * Thrown when config has schema version we can't handle
 */
class UnsupportedSchemaVersionError extends CheatSheetError {
  constructor(schemaVersion, supportedVersions) {
    super(
      'UNSUPPORTED_SCHEMA_VERSION',
      `Config schema version ${schemaVersion} not supported (supported: ${supportedVersions.join(', ')})`,
      { schemaVersion, supportedVersions }
    );
    this.name = 'UnsupportedSchemaVersionError';
  }
}

// ============================================================================
// TRANSACTION/CONSISTENCY ERRORS
// ============================================================================

/**
 * Transaction Failed
 * Thrown when MongoDB transaction fails
 */
class TransactionFailedError extends CheatSheetError {
  constructor(operation, originalError) {
    super(
      'TRANSACTION_FAILED',
      `Transaction failed during ${operation}: ${originalError.message}`,
      { operation, originalError: originalError.message }
    );
    this.name = 'TransactionFailedError';
  }
}

/**
 * Inconsistent State
 * Thrown when data consistency check fails
 */
class InconsistentStateError extends CheatSheetError {
  constructor(description, details) {
    super(
      'INCONSISTENT_STATE',
      `Data inconsistency detected: ${description}`,
      details
    );
    this.name = 'InconsistentStateError';
  }
}

// ============================================================================
// EXPORTS
// ============================================================================
module.exports = {
  CheatSheetError,
  
  // Draft errors
  DraftNotFoundError,
  DraftAlreadyExistsError,
  DraftVersionConflictError,
  
  // Live config errors
  NoLiveConfigError,
  LiveConfigNotFoundError,
  CannotEditLiveError,
  
  // Version errors
  VersionNotFoundError,
  InvalidVersionStatusError,
  
  // Validation errors
  ConfigTooLargeError,
  InvalidConfigSchemaError,
  UnsupportedSchemaVersionError,
  
  // Transaction errors
  TransactionFailedError,
  InconsistentStateError
};

