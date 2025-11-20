/**
 * ============================================================================
 * CHEATSHEET ROUTES - MAIN ROUTER EXPORT
 * ============================================================================
 * 
 * Exports the versions router directly as the main router.
 * Both version management and runtime routes are in versions.js.
 * 
 * Routes included:
 * - /status/:companyId (GET) - Get version status
 * - /draft/:companyId (POST, PATCH, DELETE) - Draft management
 * - /draft/:companyId/:versionId/push-live (POST) - Push to live
 * - /versions/:companyId (GET) - Version history
 * - /versions/:companyId/:versionId (GET, POST) - Specific version ops
 * 
 * Usage in main app:
 *   app.use('/api/cheatsheet', require('./routes/cheatsheet'));
 * ============================================================================
 */

module.exports = require('./versions');

