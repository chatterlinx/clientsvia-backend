/**
 * ============================================================================
 * CHEATSHEET ROUTES - CENTRALIZED EXPORTS
 * ============================================================================
 * 
 * Two separate routers:
 * 1. versions.js - Admin version management (auth required)
 * 2. runtime.js  - Production config reads (internal/public)
 * 
 * Usage in main app:
 *   app.use('/api/cheatsheet', cheatsheetRoutes.versions);
 *   app.use('/runtime-config', cheatsheetRoutes.runtime);
 * ============================================================================
 */

const versions = require('./versions');
const runtime = require('./runtime');

module.exports = {
  versions,
  runtime
};

