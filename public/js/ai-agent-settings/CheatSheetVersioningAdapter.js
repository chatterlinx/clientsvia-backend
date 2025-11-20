/**
 * ============================================================================
 * CHEATSHEET VERSIONING ADAPTER
 * ============================================================================
 * 
 * Client-side adapter for CheatSheet versioning API.
 * 
 * PURPOSE:
 * - Wraps the new versioning API endpoints
 * - Provides clean interface for Draft/Live workflow
 * - Handles errors gracefully
 * - Can be gradually integrated into existing CheatSheetManager
 * 
 * USAGE:
 *   const adapter = new CheatSheetVersioningAdapter(companyId);
 *   await adapter.initialize();
 *   
 *   if (adapter.hasDraft()) {
 *     await adapter.saveDraft(config);
 *   } else {
 *     await adapter.createDraft('My New Draft');
 *   }
 * 
 * ============================================================================
 */

class CheatSheetVersioningAdapter {
  
  constructor(companyId) {
    this.companyId = companyId;
    this.baseUrl = '/api/cheatsheet';
    this.token = null;
    this.status = null; // { live, draft }
    this.initialized = false;
  }
  
  // ============================================================================
  // INITIALIZATION
  // ============================================================================
  
  /**
   * Initialize adapter - fetches current status
   */
  async initialize() {
    this.token = localStorage.getItem('adminToken');
    
    if (!this.token) {
      throw new Error('No auth token found');
    }
    
    await this.refreshStatus();
    this.initialized = true;
    
    console.log('[VERSION ADAPTER] Initialized', {
      companyId: this.companyId,
      hasLive: !!this.status?.live,
      hasDraft: !!this.status?.draft
    });
    
    return this.status;
  }
  
  /**
   * Refresh status from API
   */
  async refreshStatus() {
    const response = await fetch(`${this.baseUrl}/status/${this.companyId}`, {
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch status: HTTP ${response.status}`);
    }
    
    const data = await response.json();
    this.status = data.data;
    
    return this.status;
  }
  
  // ============================================================================
  // STATUS CHECKS
  // ============================================================================
  
  hasLive() {
    return !!this.status?.live;
  }
  
  hasDraft() {
    return !!this.status?.draft;
  }
  
  getLive() {
    return this.status?.live || null;
  }
  
  getDraft() {
    return this.status?.draft || null;
  }
  
  getCurrentDraftId() {
    return this.status?.draft?.versionId || null;
  }
  
  getCurrentLiveId() {
    return this.status?.live?.versionId || null;
  }
  
  // ============================================================================
  // DRAFT OPERATIONS
  // ============================================================================
  
  /**
   * Create new draft
   */
  async createDraft(name, options = {}) {
    const { baseVersionId = null, notes = '' } = options;
    
    console.log('[VERSION ADAPTER] Creating draft:', name);
    
    const response = await fetch(`${this.baseUrl}/draft/${this.companyId}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ name, baseVersionId, notes })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to create draft: HTTP ${response.status}`);
    }
    
    const data = await response.json();
    await this.refreshStatus();
    
    console.log('[VERSION ADAPTER] Draft created:', data.data.versionId);
    
    return data.data;
  }
  
  /**
   * Save draft
   */
  async saveDraft(config, options = {}) {
    const draftId = this.getCurrentDraftId();
    
    if (!draftId) {
      throw new Error('No draft to save. Create a draft first.');
    }
    
    const { expectedVersion = null } = options;
    
    console.log('[VERSION ADAPTER] Saving draft:', draftId);
    
    const response = await fetch(
      `${this.baseUrl}/draft/${this.companyId}/${draftId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ config, expectedVersion })
      }
    );
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      
      // Handle version conflict (optimistic concurrency)
      if (response.status === 409) {
        throw new Error('DRAFT_VERSION_CONFLICT: Draft was modified by another user. Please reload.');
      }
      
      throw new Error(errorData.message || `Failed to save draft: HTTP ${response.status}`);
    }
    
    const data = await response.json();
    await this.refreshStatus();
    
    console.log('[VERSION ADAPTER] Draft saved successfully');
    
    return data.data;
  }
  
  /**
   * Discard draft
   */
  async discardDraft() {
    const draftId = this.getCurrentDraftId();
    
    if (!draftId) {
      throw new Error('No draft to discard.');
    }
    
    console.log('[VERSION ADAPTER] Discarding draft:', draftId);
    
    const response = await fetch(
      `${this.baseUrl}/draft/${this.companyId}/${draftId}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${this.token}` }
      }
    );
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to discard draft: HTTP ${response.status}`);
    }
    
    await this.refreshStatus();
    
    console.log('[VERSION ADAPTER] Draft discarded');
    
    return true;
  }
  
  /**
   * Push draft to live
   */
  async pushDraftLive() {
    const draftId = this.getCurrentDraftId();
    
    if (!draftId) {
      throw new Error('No draft to push live.');
    }
    
    console.log('[VERSION ADAPTER] Pushing draft to live:', draftId);
    
    const response = await fetch(
      `${this.baseUrl}/draft/${this.companyId}/${draftId}/push-live`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${this.token}` }
      }
    );
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to push live: HTTP ${response.status}`);
    }
    
    const data = await response.json();
    await this.refreshStatus();
    
    console.log('[VERSION ADAPTER] Draft pushed to live successfully');
    
    return data.data;
  }
  
  // ============================================================================
  // VERSION HISTORY
  // ============================================================================
  
  /**
   * Get version history
   */
  async getVersionHistory(limit = 50) {
    console.log('[VERSION ADAPTER] Fetching version history');
    
    const response = await fetch(
      `${this.baseUrl}/versions/${this.companyId}?limit=${limit}`,
      {
        headers: { 'Authorization': `Bearer ${this.token}` }
      }
    );
    
    if (!response.ok) {
      throw new Error(`Failed to fetch history: HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log('[VERSION ADAPTER] Version history retrieved:', data.data.count);
    
    return data.data.versions;
  }
  
  /**
   * Get specific version (with or without config)
   */
  async getVersion(versionId, includeConfig = false) {
    console.log('[VERSION ADAPTER] Fetching version:', versionId);
    
    const url = `${this.baseUrl}/versions/${this.companyId}/${versionId}?includeConfig=${includeConfig}`;
    
    const response = await fetch(url, {
      headers: { 'Authorization': `Bearer ${this.token}` }
    });
    
    if (!response.ok) {
      throw new Error(`Failed to fetch version: HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    return data.data;
  }
  
  /**
   * Restore archived version (creates new draft)
   */
  async restoreVersion(versionId, name, notes = '') {
    console.log('[VERSION ADAPTER] Restoring version:', versionId);
    
    const response = await fetch(
      `${this.baseUrl}/versions/${this.companyId}/${versionId}/restore`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ name, notes })
      }
    );
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to restore version: HTTP ${response.status}`);
    }
    
    const data = await response.json();
    await this.refreshStatus();
    
    console.log('[VERSION ADAPTER] Version restored as draft');
    
    return data.data;
  }
  
  /**
   * Get version configuration (full config object)
   */
  async getVersionConfig(versionId) {
    console.log('[VERSION ADAPTER] Fetching version config:', versionId);
    
    const response = await fetch(
      `${this.baseUrl}/versions/${this.companyId}/${versionId}`,
      {
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      }
    );
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to fetch version config: HTTP ${response.status}`);
    }
    
    const data = await response.json();
    
    console.log('[VERSION ADAPTER] Version config fetched');
    
    return data.data.config;
  }
  
  /**
   * Delete archived version permanently
   */
  async deleteVersion(versionId) {
    console.log('[VERSION ADAPTER] Deleting version:', versionId);
    
    const response = await fetch(
      `${this.baseUrl}/versions/${this.companyId}/${versionId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${this.token}`
        }
      }
    );
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `Failed to delete version: HTTP ${response.status}`);
    }
    
    console.log('[VERSION ADAPTER] Version deleted successfully');
    
    return true;
  }
  
  // ============================================================================
  // HELPER METHODS
  // ============================================================================
  
  /**
   * Load config for editing
   * Returns draft config if exists, otherwise live config
   */
  async loadConfig() {
    if (this.hasDraft()) {
      const draft = await this.getVersion(this.getCurrentDraftId(), true);
      console.log('[VERSION ADAPTER] Loaded DRAFT config');
      return draft.config;
    } else if (this.hasLive()) {
      const live = await this.getVersion(this.getCurrentLiveId(), true);
      console.log('[VERSION ADAPTER] Loaded LIVE config (read-only)');
      return live.config;
    } else {
      console.log('[VERSION ADAPTER] No config found - using defaults');
      return this.getDefaultConfig();
    }
  }
  
  /**
   * Get default empty config
   */
  getDefaultConfig() {
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
   * Check if we're editing a draft (not live)
   */
  isEditingDraft() {
    return this.hasDraft();
  }
  
  /**
   * Check if we're in read-only mode (viewing live, no draft)
   */
  isReadOnly() {
    return this.hasLive() && !this.hasDraft();
  }
}

// ============================================================================
// EXPORT
// ============================================================================

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CheatSheetVersioningAdapter;
}

// Also attach to window for global access
if (typeof window !== 'undefined') {
  window.CheatSheetVersioningAdapter = CheatSheetVersioningAdapter;
  console.log('✅ [CHEATSHEET VERSIONING ADAPTER] Loaded and available globally');
}

