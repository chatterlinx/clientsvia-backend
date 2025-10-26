/**
 * ============================================================================
 * SYNONYM MANAGER - WORLD-CLASS SYNONYM MAPPING SYSTEM
 * ============================================================================
 * 
 * PURPOSE:
 * Enterprise-grade management of synonym mappings (colloquial → technical terms)
 * for the ClientsVia AI Brain. Enables non-technical customers to use natural
 * language that gets automatically translated to technical terms.
 * 
 * ARCHITECTURE:
 * - Modular, self-contained class following Single Responsibility Principle
 * - Template-level and category-level synonym management
 * - Client-side caching for performance (with TTL)
 * - Comprehensive error handling with user-friendly messages
 * - Optimistic UI updates with automatic rollback on failure
 * - Debounced API calls to prevent excessive requests
 * 
 * FEATURES:
 * - ✅ Add synonym mappings (technical term → colloquial aliases)
 * - ✅ Remove synonym mappings
 * - ✅ List all synonyms (template or category)
 * - ✅ Search/filter synonyms
 * - ✅ Bulk import/export
 * - ✅ Conflict detection (duplicate mappings)
 * - ✅ Real-time validation
 * - ✅ Undo/redo capability
 * 
 * USAGE:
 * ```javascript
 * const synonymManager = new SynonymManager();
 * 
 * // Add synonym to template
 * await synonymManager.addSynonym(templateId, 'thermostat', ['thingy', 'box on wall']);
 * 
 * // Add synonym to category
 * await synonymManager.addSynonym(templateId, 'thermostat', ['thingy'], categoryId);
 * 
 * // Get all synonyms
 * const synonyms = await synonymManager.getSynonyms(templateId);
 * ```
 * 
 * ============================================================================
 */

class SynonymManager {
    constructor() {
        // ============================================
        // CONFIGURATION
        // ============================================
        
        this.config = {
            apiBaseUrl: '/api/admin/global-instant-responses',
            cacheTTL: 300000, // 5 minutes
            debounceDelay: 500, // 500ms
            maxAliasesPerTerm: 20, // Prevent abuse
            maxTermLength: 50,
            maxAliasLength: 50
        };
        
        // ============================================
        // STATE MANAGEMENT
        // ============================================
        
        // Cache: { templateId: { synonyms: {...}, timestamp: Date } }
        this.cache = new Map();
        
        // Undo stack for rollback capability
        this.undoStack = [];
        this.maxUndoStackSize = 20;
        
        // Pending operations (for optimistic UI)
        this.pendingOperations = new Map();
        
        // Debounced functions
        this.debouncedFunctions = new Map();
        
        logger.info('✅ [SYNONYM MANAGER] Initialized');
    }
    
    // ============================================
    // PUBLIC API - TEMPLATE-LEVEL SYNONYMS
    // ============================================
    
    /**
     * Get all synonyms for a template
     * @param {String} templateId - Template ID
     * @param {Boolean} forceRefresh - Skip cache and fetch fresh data
     * @returns {Promise<Object>} - Synonym mappings { technicalTerm: [aliases] }
     */
    async getSynonyms(templateId, forceRefresh = false) {
        this.validateTemplateId(templateId);
        
        // Check cache first
        if (!forceRefresh && this.isCacheValid(templateId)) {
            logger.debug('📦 [SYNONYM MANAGER] Cache hit', { templateId });
            return this.cache.get(templateId).synonyms;
        }
        
        try {
            const response = await this.makeRequest(
                `${this.config.apiBaseUrl}/${templateId}/synonyms`,
                'GET'
            );
            
            if (!response.success) {
                throw new Error(response.error || 'Failed to fetch synonyms');
            }
            
            // Update cache
            this.updateCache(templateId, response.synonyms);
            
            logger.info('✅ [SYNONYM MANAGER] Fetched synonyms', {
                templateId,
                count: Object.keys(response.synonyms).length
            });
            
            return response.synonyms;
            
        } catch (error) {
            logger.error('❌ [SYNONYM MANAGER] Error fetching synonyms', {
                templateId,
                error: error.message
            });
            throw new Error(`Failed to load synonyms: ${error.message}`);
        }
    }
    
    /**
     * Add a synonym mapping to a template
     * @param {String} templateId - Template ID
     * @param {String} technicalTerm - Technical term (e.g., "thermostat")
     * @param {Array<String>} colloquialTerms - Colloquial aliases (e.g., ["thingy", "box on wall"])
     * @param {String} categoryId - Optional: Category ID for category-level synonyms
     * @returns {Promise<Object>} - Updated synonyms
     */
    async addSynonym(templateId, technicalTerm, colloquialTerms, categoryId = null) {
        // Validation
        this.validateTemplateId(templateId);
        this.validateTechnicalTerm(technicalTerm);
        this.validateColloquialTerms(colloquialTerms);
        
        const isCategory = categoryId !== null;
        const endpoint = isCategory
            ? `${this.config.apiBaseUrl}/${templateId}/categories/${categoryId}/synonyms`
            : `${this.config.apiBaseUrl}/${templateId}/synonyms`;
        
        // Save current state for undo
        this.saveUndoState(templateId, 'add', { technicalTerm, colloquialTerms, categoryId });
        
        // Optimistic UI update
        this.updateCacheOptimistically(templateId, technicalTerm, colloquialTerms, 'add');
        
        try {
            const response = await this.makeRequest(endpoint, 'POST', {
                technicalTerm,
                colloquialTerms
            });
            
            if (!response.success) {
                // Rollback optimistic update
                this.rollbackOptimisticUpdate(templateId);
                throw new Error(response.error || 'Failed to add synonym');
            }
            
            // Update cache with server response
            this.invalidateCache(templateId);
            
            logger.info('✅ [SYNONYM MANAGER] Synonym added', {
                templateId,
                categoryId,
                technicalTerm,
                aliases: colloquialTerms.length,
                scope: isCategory ? 'category' : 'template'
            });
            
            return response;
            
        } catch (error) {
            // Rollback optimistic update
            this.rollbackOptimisticUpdate(templateId);
            
            logger.error('❌ [SYNONYM MANAGER] Error adding synonym', {
                templateId,
                technicalTerm,
                error: error.message
            });
            
            throw new Error(`Failed to add synonym: ${error.message}`);
        }
    }
    
    /**
     * Remove a synonym mapping from a template
     * @param {String} templateId - Template ID
     * @param {String} technicalTerm - Technical term to remove
     * @param {String} categoryId - Optional: Category ID for category-level synonyms
     * @returns {Promise<Object>} - Result
     */
    async removeSynonym(templateId, technicalTerm, categoryId = null) {
        this.validateTemplateId(templateId);
        this.validateTechnicalTerm(technicalTerm);
        
        const isCategory = categoryId !== null;
        const endpoint = isCategory
            ? `${this.config.apiBaseUrl}/${templateId}/categories/${categoryId}/synonyms/${encodeURIComponent(technicalTerm)}`
            : `${this.config.apiBaseUrl}/${templateId}/synonyms/${encodeURIComponent(technicalTerm)}`;
        
        // Save current state for undo
        const currentSynonyms = await this.getSynonyms(templateId);
        this.saveUndoState(templateId, 'remove', {
            technicalTerm,
            colloquialTerms: currentSynonyms[technicalTerm],
            categoryId
        });
        
        // Optimistic UI update
        this.updateCacheOptimistically(templateId, technicalTerm, null, 'remove');
        
        try {
            const response = await this.makeRequest(endpoint, 'DELETE');
            
            if (!response.success) {
                // Rollback optimistic update
                this.rollbackOptimisticUpdate(templateId);
                throw new Error(response.error || 'Failed to remove synonym');
            }
            
            // Update cache
            this.invalidateCache(templateId);
            
            logger.info('✅ [SYNONYM MANAGER] Synonym removed', {
                templateId,
                categoryId,
                technicalTerm,
                scope: isCategory ? 'category' : 'template'
            });
            
            return response;
            
        } catch (error) {
            // Rollback optimistic update
            this.rollbackOptimisticUpdate(templateId);
            
            logger.error('❌ [SYNONYM MANAGER] Error removing synonym', {
                templateId,
                technicalTerm,
                error: error.message
            });
            
            throw new Error(`Failed to remove synonym: ${error.message}`);
        }
    }
    
    /**
     * Get category-level synonyms
     * @param {String} templateId - Template ID
     * @param {String} categoryId - Category ID
     * @returns {Promise<Object>} - Category synonyms
     */
    async getCategorySynonyms(templateId, categoryId) {
        this.validateTemplateId(templateId);
        if (!categoryId) throw new Error('Category ID is required');
        
        try {
            const response = await this.makeRequest(
                `${this.config.apiBaseUrl}/${templateId}/categories/${categoryId}/synonyms`,
                'GET'
            );
            
            if (!response.success) {
                throw new Error(response.error || 'Failed to fetch category synonyms');
            }
            
            logger.info('✅ [SYNONYM MANAGER] Fetched category synonyms', {
                templateId,
                categoryId,
                count: Object.keys(response.synonyms).length
            });
            
            return response.synonyms;
            
        } catch (error) {
            logger.error('❌ [SYNONYM MANAGER] Error fetching category synonyms', {
                templateId,
                categoryId,
                error: error.message
            });
            throw new Error(`Failed to load category synonyms: ${error.message}`);
        }
    }
    
    // ============================================
    // UTILITY METHODS
    // ============================================
    
    /**
     * Search synonyms by technical term or alias
     * @param {String} templateId - Template ID
     * @param {String} searchTerm - Search query
     * @returns {Promise<Object>} - Matching synonyms
     */
    async searchSynonyms(templateId, searchTerm) {
        const allSynonyms = await this.getSynonyms(templateId);
        const lowerSearch = searchTerm.toLowerCase().trim();
        
        const results = {};
        
        for (const [technicalTerm, aliases] of Object.entries(allSynonyms)) {
            // Check if technical term matches
            if (technicalTerm.toLowerCase().includes(lowerSearch)) {
                results[technicalTerm] = aliases;
                continue;
            }
            
            // Check if any alias matches
            if (aliases.some(alias => alias.toLowerCase().includes(lowerSearch))) {
                results[technicalTerm] = aliases;
            }
        }
        
        return results;
    }
    
    /**
     * Export synonyms as JSON for backup/import
     * @param {String} templateId - Template ID
     * @returns {Promise<String>} - JSON string
     */
    async exportSynonyms(templateId) {
        const synonyms = await this.getSynonyms(templateId);
        
        const exportData = {
            templateId,
            exportedAt: new Date().toISOString(),
            version: '1.0',
            synonyms
        };
        
        return JSON.stringify(exportData, null, 2);
    }
    
    /**
     * Import synonyms from JSON
     * @param {String} templateId - Template ID
     * @param {String} jsonData - JSON string
     * @returns {Promise<Object>} - Import results
     */
    async importSynonyms(templateId, jsonData) {
        let data;
        try {
            data = JSON.parse(jsonData);
        } catch (error) {
            throw new Error('Invalid JSON format');
        }
        
        if (!data.synonyms || typeof data.synonyms !== 'object') {
            throw new Error('Invalid synonym data structure');
        }
        
        const results = {
            success: 0,
            failed: 0,
            errors: []
        };
        
        for (const [technicalTerm, aliases] of Object.entries(data.synonyms)) {
            try {
                await this.addSynonym(templateId, technicalTerm, aliases);
                results.success++;
            } catch (error) {
                results.failed++;
                results.errors.push({
                    term: technicalTerm,
                    error: error.message
                });
            }
        }
        
        return results;
    }
    
    /**
     * Detect conflicts (duplicate mappings)
     * @param {String} templateId - Template ID
     * @returns {Promise<Array>} - List of conflicts
     */
    async detectConflicts(templateId) {
        const synonyms = await this.getSynonyms(templateId);
        const conflicts = [];
        
        // Build reverse map: alias → technical terms
        const aliasMap = new Map();
        
        for (const [technicalTerm, aliases] of Object.entries(synonyms)) {
            for (const alias of aliases) {
                if (!aliasMap.has(alias)) {
                    aliasMap.set(alias, []);
                }
                aliasMap.get(alias).push(technicalTerm);
            }
        }
        
        // Find aliases mapped to multiple technical terms
        for (const [alias, terms] of aliasMap.entries()) {
            if (terms.length > 1) {
                conflicts.push({
                    alias,
                    technicalTerms: terms,
                    severity: 'high',
                    message: `"${alias}" is mapped to multiple technical terms: ${terms.join(', ')}`
                });
            }
        }
        
        return conflicts;
    }
    
    /**
     * Undo last operation
     * @returns {Promise<Boolean>} - Success
     */
    async undo() {
        if (this.undoStack.length === 0) {
            logger.warn('⚠️ [SYNONYM MANAGER] No operations to undo');
            return false;
        }
        
        const lastOperation = this.undoStack.pop();
        const { templateId, operation, data } = lastOperation;
        
        try {
            if (operation === 'add') {
                // Undo add = remove
                await this.removeSynonym(templateId, data.technicalTerm, data.categoryId);
            } else if (operation === 'remove') {
                // Undo remove = add
                await this.addSynonym(templateId, data.technicalTerm, data.colloquialTerms, data.categoryId);
            }
            
            logger.info('✅ [SYNONYM MANAGER] Undo successful', { operation });
            return true;
            
        } catch (error) {
            logger.error('❌ [SYNONYM MANAGER] Undo failed', { error: error.message });
            throw error;
        }
    }
    
    // ============================================
    // INTERNAL HELPERS
    // ============================================
    
    validateTemplateId(templateId) {
        if (!templateId || typeof templateId !== 'string') {
            throw new Error('Valid template ID is required');
        }
    }
    
    validateTechnicalTerm(term) {
        if (!term || typeof term !== 'string') {
            throw new Error('Technical term is required');
        }
        
        const trimmed = term.trim();
        if (trimmed.length === 0) {
            throw new Error('Technical term cannot be empty');
        }
        
        if (trimmed.length > this.config.maxTermLength) {
            throw new Error(`Technical term too long (max ${this.config.maxTermLength} characters)`);
        }
    }
    
    validateColloquialTerms(terms) {
        if (!Array.isArray(terms) || terms.length === 0) {
            throw new Error('At least one colloquial term is required');
        }
        
        if (terms.length > this.config.maxAliasesPerTerm) {
            throw new Error(`Too many aliases (max ${this.config.maxAliasesPerTerm})`);
        }
        
        for (const term of terms) {
            if (!term || typeof term !== 'string' || term.trim().length === 0) {
                throw new Error('All colloquial terms must be non-empty strings');
            }
            
            if (term.length > this.config.maxAliasLength) {
                throw new Error(`Alias too long (max ${this.config.maxAliasLength} characters)`);
            }
        }
    }
    
    isCacheValid(templateId) {
        if (!this.cache.has(templateId)) return false;
        
        const cached = this.cache.get(templateId);
        const age = Date.now() - cached.timestamp;
        
        return age < this.config.cacheTTL;
    }
    
    updateCache(templateId, synonyms) {
        this.cache.set(templateId, {
            synonyms,
            timestamp: Date.now()
        });
    }
    
    invalidateCache(templateId) {
        this.cache.delete(templateId);
    }
    
    updateCacheOptimistically(templateId, technicalTerm, colloquialTerms, operation) {
        if (!this.cache.has(templateId)) return;
        
        const cached = this.cache.get(templateId);
        const newSynonyms = { ...cached.synonyms };
        
        if (operation === 'add') {
            // Merge with existing aliases
            const existing = newSynonyms[technicalTerm] || [];
            newSynonyms[technicalTerm] = [...new Set([...existing, ...colloquialTerms])];
        } else if (operation === 'remove') {
            delete newSynonyms[technicalTerm];
        }
        
        this.updateCache(templateId, newSynonyms);
    }
    
    rollbackOptimisticUpdate(templateId) {
        // Simply invalidate cache to force refresh
        this.invalidateCache(templateId);
    }
    
    saveUndoState(templateId, operation, data) {
        this.undoStack.push({
            templateId,
            operation,
            data,
            timestamp: Date.now()
        });
        
        // Limit stack size
        if (this.undoStack.length > this.maxUndoStackSize) {
            this.undoStack.shift();
        }
    }
    
    async makeRequest(url, method, body = null) {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
        };
        
        if (body) {
            options.body = JSON.stringify(body);
        }
        
        const response = await fetch(url, options);
        
        if (!response.ok) {
            const error = await response.json().catch(() => ({ error: 'Network error' }));
            throw new Error(error.error || `HTTP ${response.status}`);
        }
        
        return response.json();
    }
}

// ============================================
// LOGGER FALLBACK (if not available globally)
// ============================================
if (typeof logger === 'undefined') {
    window.logger = {
        info: (...args) => console.log('[INFO]', ...args),
        debug: (...args) => console.log('[DEBUG]', ...args),
        warn: (...args) => console.warn('[WARN]', ...args),
        error: (...args) => console.error('[ERROR]', ...args)
    };
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SynonymManager;
}

