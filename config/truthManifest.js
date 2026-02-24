/**
 * ============================================================================
 * TRUTH MANIFEST — Required Files & Expected UI Inventory
 * ============================================================================
 * 
 * This file defines what MUST exist for Truth to be COMPLETE.
 * 
 * RULE: Truth status is COMPLETE only when:
 * 1. All REQUIRED_FILES exist
 * 2. All REQUIRED_MODALS are found in HTML
 * 3. All JS controllers exist for their HTML pages
 * 
 * When new files/modals are added to Agent Console, UPDATE THIS MANIFEST.
 * This prevents "NEW_X_FOUND" surprises - the manifest IS the source of truth.
 * 
 * ============================================================================
 */

/**
 * Required frontend files - must all exist for COMPLETE status
 */
const REQUIRED_FILES = [
  // Pages (HTML)
  'index.html',
  'agent2.html',
  'triggers.html',
  'booking.html',
  'global-hub.html',
  'calendar.html',
  
  // Controllers (JS)
  'index.js',
  'agent2.js',
  'triggers.js',
  'booking.js',
  'global-hub.js',
  'calendar.js',
  
  // Shared assets
  'styles.css',
  'lib/auth.js',
  'shared/truthButton.js'
];

/**
 * Required modals - IDs that must exist in HTML for COMPLETE status
 * Only include actual modal containers, not sub-elements like close buttons
 */
const REQUIRED_MODALS = [
  // agent2.html modals
  { id: 'modal-greeting-rule', page: 'agent2.html', purpose: 'Greeting interceptor rule editor' },
  
  // triggers.html modals
  { id: 'modal-trigger-edit', page: 'triggers.html', purpose: 'Trigger editor modal' },
  { id: 'modal-create-group', page: 'triggers.html', purpose: 'Create trigger group modal' },
  { id: 'modal-gpt-settings', page: 'triggers.html', purpose: 'LLM/GPT settings modal' },
  { id: 'modal-approval', page: 'triggers.html', purpose: 'Trigger approval workflow modal' },
  
  // global-hub.html modals
  { id: 'modal-firstnames', page: 'global-hub.html', purpose: 'First names dictionary modal' }
];

/**
 * Modal IDs to ignore (sub-elements, close buttons, etc.)
 * These are not standalone modals, just parts of modals
 */
const IGNORED_MODAL_IDS = [
  'modal-approval-close',
  'modal-gpt-close',
  'modal-group-close',
  'modal-trigger-close',
  'modal-trigger-title'
];

/**
 * Page-to-controller mapping for verification
 */
const PAGE_CONTROLLER_MAP = {
  'index.html': 'index.js',
  'agent2.html': 'agent2.js',
  'triggers.html': 'triggers.js',
  'booking.html': 'booking.js',
  'global-hub.html': 'global-hub.js',
  'calendar.html': 'calendar.js'
};

/**
 * Backend directories to scan for hardcoded speech
 */
const SPEECH_SCAN_DIRECTORIES = [
  'services/engine',
  'services/engine/agent2',
  'services/engine/booking',
  'routes',
  'routes/admin',
  'routes/agentConsole'
];

/**
 * Keys that indicate speech text in code (for scanner)
 */
const SPEECH_VARIABLE_PATTERNS = [
  'replyText',
  'responseText',
  'nextPrompt',
  'greeting',
  'greetingText',
  'holdMessage',
  'fallbackText',
  'recoveryMessage',
  'confirmationMessage',
  'askName',
  'askPhone',
  'askEmail'
];

module.exports = {
  REQUIRED_FILES,
  REQUIRED_MODALS,
  IGNORED_MODAL_IDS,
  PAGE_CONTROLLER_MAP,
  SPEECH_SCAN_DIRECTORIES,
  SPEECH_VARIABLE_PATTERNS,
  
  // Metadata
  manifestVersion: '1.0.0',
  lastUpdated: '2026-02-24'
};
