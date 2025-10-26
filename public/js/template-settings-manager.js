/**
 * ============================================================================
 * TEMPLATE SETTINGS MANAGER - Filler Words & Synonyms
 * ============================================================================
 * 
 * This file manages the Template Settings tab functionality, including:
 * - Filler word management (add, remove, search, export, import)
 * - Synonym mapping management (add, remove, export, import)
 * - Real-time UI updates
 * - Integration with FillerManager and SynonymManager classes
 * 
 * Load this file AFTER the manager classes are loaded.
 */

// ============================================
// GLOBAL STATE
// ============================================

let currentTemplateIdForSettings = null;
let loadedFillerWords = [];
let loadedSynonyms = new Map();

// ============================================
// INITIALIZATION
// ============================================

/**
 * Initialize Template Settings when Settings tab is opened
 */
function initializeTemplateSettings() {
    currentTemplateIdForSettings = window.activeTemplateId || window.currentDashboardTemplateId;
    
    if (!currentTemplateIdForSettings) {
        console.warn('⚠️ [TEMPLATE SETTINGS] No template selected');
        return;
    }
    
    console.log('🎨 [TEMPLATE SETTINGS] Initializing for template:', currentTemplateIdForSettings);
    
    // Load filler words and synonyms
    loadFillerWordsForTemplate();
    loadSynonymsForTemplate();
}

// ============================================
// FILLER WORDS MANAGEMENT
// ============================================

/**
 * Load filler words from API
 */
async function loadFillerWordsForTemplate() {
    const templateId = currentTemplateIdForSettings;
    if (!templateId) return;
    
    try {
        console.log('📥 [FILLER WORDS] Loading for template:', templateId);
        
        const token = localStorage.getItem('adminToken');
        const response = await fetch(`/api/admin/global-instant-responses/${templateId}/fillers`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        loadedFillerWords = result.data.fillers || [];
        
        console.log(`✅ [FILLER WORDS] Loaded ${loadedFillerWords.length} words`);
        
        renderFillerWords(loadedFillerWords);
        updateFillerWordsStats();
        
    } catch (error) {
        console.error('❌ [FILLER WORDS] Failed to load:', error);
        showFillerWordsError(error.message);
    }
}

/**
 * Render filler words in UI
 */
function renderFillerWords(words) {
    const container = document.getElementById('filler-words-container');
    if (!container) return;
    
    if (words.length === 0) {
        container.innerHTML = `
            <div class="text-center w-full text-gray-500 py-8">
                <i class="fas fa-inbox text-4xl mb-3"></i>
                <p>No filler words yet. Click "Add Word" to get started.</p>
            </div>
        `;
        return;
    }
    
    // Render as tags
    container.innerHTML = words.map(word => `
        <div class="inline-flex items-center gap-2 px-3 py-2 bg-gray-200 hover:bg-gray-300 rounded-lg text-sm font-medium text-gray-800 transition-all">
            <span>${word}</span>
            <button onclick="removeFillerWord('${word}')" class="text-red-600 hover:text-red-800 transition-colors">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

/**
 * Update stats (total count, filtered count)
 */
function updateFillerWordsStats() {
    document.getElementById('filler-count').textContent = loadedFillerWords.length;
    // Filtered count would be updated by search function
}

/**
 * Add a filler word
 */
async function addFillerWord() {
    const word = prompt('Enter a filler word to add (e.g., "um", "uh", "like"):');
    
    if (!word || word.trim() === '') {
        return;
    }
    
    const normalizedWord = word.trim().toLowerCase();
    
    // Check if already exists
    if (loadedFillerWords.includes(normalizedWord)) {
        alert(`"${normalizedWord}" is already in the filler list!`);
        return;
    }
    
    try {
        console.log('➕ [FILLER WORDS] Adding:', normalizedWord);
        
        const token = localStorage.getItem('adminToken');
        const response = await fetch(`/api/admin/global-instant-responses/${currentTemplateIdForSettings}/fillers`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fillerWords: [normalizedWord] })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        console.log('✅ [FILLER WORDS] Added successfully');
        
        // Reload
        await loadFillerWordsForTemplate();
        
        alert(`✅ Added "${normalizedWord}" to filler list!`);
        
    } catch (error) {
        console.error('❌ [FILLER WORDS] Failed to add:', error);
        alert(`❌ Failed to add: ${error.message}`);
    }
}

/**
 * Remove a filler word
 */
async function removeFillerWord(word) {
    if (!confirm(`Remove "${word}" from filler list?`)) {
        return;
    }
    
    try {
        console.log('➖ [FILLER WORDS] Removing:', word);
        
        const token = localStorage.getItem('adminToken');
        const response = await fetch(`/api/admin/global-instant-responses/${currentTemplateIdForSettings}/fillers`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ fillerWords: [word] })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        console.log('✅ [FILLER WORDS] Removed successfully');
        
        // Reload
        await loadFillerWordsForTemplate();
        
    } catch (error) {
        console.error('❌ [FILLER WORDS] Failed to remove:', error);
        alert(`❌ Failed to remove: ${error.message}`);
    }
}

/**
 * Search filler words
 */
function searchFillerWords() {
    const searchTerm = document.getElementById('filler-search').value.toLowerCase();
    
    if (!searchTerm) {
        renderFillerWords(loadedFillerWords);
        document.getElementById('filler-filtered-count').textContent = loadedFillerWords.length;
        return;
    }
    
    const filtered = loadedFillerWords.filter(word => word.includes(searchTerm));
    renderFillerWords(filtered);
    document.getElementById('filler-filtered-count').textContent = filtered.length;
}

/**
 * Export filler words
 */
function exportFillerWords() {
    const data = {
        templateId: currentTemplateIdForSettings,
        exportedAt: new Date().toISOString(),
        fillerWords: loadedFillerWords
    };
    
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `filler-words-${currentTemplateIdForSettings}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('✅ [FILLER WORDS] Exported successfully');
}

/**
 * Show error
 */
function showFillerWordsError(message) {
    const container = document.getElementById('filler-words-container');
    if (!container) return;
    
    container.innerHTML = `
        <div class="text-center w-full text-red-500 py-8">
            <i class="fas fa-exclamation-triangle text-4xl mb-3"></i>
            <p>Error: ${message}</p>
            <button onclick="loadFillerWordsForTemplate()" class="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors">
                <i class="fas fa-redo mr-2"></i>
                Retry
            </button>
        </div>
    `;
}

// ============================================
// SYNONYM MANAGEMENT
// ============================================

/**
 * Load synonyms from API
 */
async function loadSynonymsForTemplate() {
    const templateId = currentTemplateIdForSettings;
    if (!templateId) return;
    
    try {
        console.log('📥 [SYNONYMS] Loading for template:', templateId);
        
        const token = localStorage.getItem('adminToken');
        const response = await fetch(`/api/admin/global-instant-responses/${templateId}/synonyms`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        // Convert to Map
        loadedSynonyms = new Map();
        if (result.data.synonymMap) {
            if (result.data.synonymMap instanceof Map) {
                loadedSynonyms = new Map(result.data.synonymMap);
            } else if (typeof result.data.synonymMap === 'object') {
                for (const [term, aliases] of Object.entries(result.data.synonymMap)) {
                    if (Array.isArray(aliases)) {
                        loadedSynonyms.set(term, aliases);
                    }
                }
            }
        }
        
        console.log(`✅ [SYNONYMS] Loaded ${loadedSynonyms.size} mappings`);
        
        renderSynonyms(loadedSynonyms);
        updateSynonymsStats();
        
    } catch (error) {
        console.error('❌ [SYNONYMS] Failed to load:', error);
        showSynonymsError(error.message);
    }
}

/**
 * Render synonyms in UI
 */
function renderSynonyms(synonymMap) {
    const container = document.getElementById('synonyms-container');
    if (!container) return;
    
    if (synonymMap.size === 0) {
        container.innerHTML = `
            <div class="text-center w-full text-gray-500 py-8">
                <i class="fas fa-inbox text-4xl mb-3 text-purple-400"></i>
                <p>No synonym mappings yet. Add one above to get started.</p>
            </div>
        `;
        return;
    }
    
    // Render as cards
    const html = [];
    for (const [technicalTerm, colloquialTerms] of synonymMap.entries()) {
        html.push(`
            <div class="bg-white border-2 border-purple-200 rounded-lg p-4 hover:shadow-md transition-all">
                <div class="flex items-start justify-between mb-3">
                    <div class="flex-1">
                        <div class="text-sm text-gray-500 mb-1">Technical Term:</div>
                        <div class="text-lg font-bold text-purple-700">${technicalTerm}</div>
                    </div>
                    <button onclick="removeSynonymMapping('${technicalTerm}')" 
                            class="px-3 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded-lg text-sm font-semibold transition-colors">
                        <i class="fas fa-trash mr-1"></i>
                        Remove
                    </button>
                </div>
                <div class="text-sm text-gray-500 mb-2">Colloquial Terms (${colloquialTerms.length}):</div>
                <div class="flex flex-wrap gap-2">
                    ${colloquialTerms.map(term => `
                        <span class="px-2 py-1 bg-pink-100 text-pink-800 rounded text-xs font-medium">
                            ${term}
                        </span>
                    `).join('')}
                </div>
            </div>
        `);
    }
    
    container.innerHTML = html.join('');
}

/**
 * Update synonym stats
 */
function updateSynonymsStats() {
    const totalAliases = Array.from(loadedSynonyms.values()).reduce((sum, arr) => sum + arr.length, 0);
    
    document.getElementById('synonym-count').textContent = loadedSynonyms.size;
    document.getElementById('synonym-alias-count').textContent = totalAliases;
}

/**
 * Add synonym mapping
 */
async function addSynonymMapping() {
    const technicalTerm = document.getElementById('synonym-technical-term').value.trim().toLowerCase();
    const colloquialTermsInput = document.getElementById('synonym-colloquial-terms').value.trim().toLowerCase();
    
    if (!technicalTerm || !colloquialTermsInput) {
        alert('❌ Please fill in both fields!\n\nTechnical term: e.g., "thermostat"\nColloquial terms: e.g., "thingy, box on wall"');
        return;
    }
    
    // Split colloquial terms by comma
    const colloquialTerms = colloquialTermsInput.split(',').map(t => t.trim()).filter(t => t.length > 0);
    
    if (colloquialTerms.length === 0) {
        alert('❌ Please provide at least one colloquial term!');
        return;
    }
    
    try {
        console.log(`➕ [SYNONYMS] Adding mapping: "${technicalTerm}" → [${colloquialTerms.join(', ')}]`);
        
        const token = localStorage.getItem('adminToken');
        const response = await fetch(`/api/admin/global-instant-responses/${currentTemplateIdForSettings}/synonyms`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                technicalTerm,
                colloquialTerms
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        console.log('✅ [SYNONYMS] Added successfully');
        
        // Clear inputs
        document.getElementById('synonym-technical-term').value = '';
        document.getElementById('synonym-colloquial-terms').value = '';
        
        // Reload
        await loadSynonymsForTemplate();
        
        alert(`✅ Added synonym mapping!\n\n"${technicalTerm}" will now match:\n${colloquialTerms.map(t => `  • "${t}"`).join('\n')}`);
        
    } catch (error) {
        console.error('❌ [SYNONYMS] Failed to add:', error);
        alert(`❌ Failed to add: ${error.message}`);
    }
}

/**
 * Remove synonym mapping
 */
async function removeSynonymMapping(technicalTerm) {
    if (!confirm(`Remove synonym mapping for "${technicalTerm}"?`)) {
        return;
    }
    
    try {
        console.log('➖ [SYNONYMS] Removing mapping:', technicalTerm);
        
        const token = localStorage.getItem('adminToken');
        const response = await fetch(`/api/admin/global-instant-responses/${currentTemplateIdForSettings}/synonyms/${encodeURIComponent(technicalTerm)}`, {
            method: 'DELETE',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        console.log('✅ [SYNONYMS] Removed successfully');
        
        // Reload
        await loadSynonymsForTemplate();
        
    } catch (error) {
        console.error('❌ [SYNONYMS] Failed to remove:', error);
        alert(`❌ Failed to remove: ${error.message}`);
    }
}

/**
 * Export synonyms
 */
function exportSynonyms() {
    const synonymsObject = {};
    for (const [term, aliases] of loadedSynonyms.entries()) {
        synonymsObject[term] = aliases;
    }
    
    const data = {
        templateId: currentTemplateIdForSettings,
        exportedAt: new Date().toISOString(),
        synonymMap: synonymsObject
    };
    
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `synonyms-${currentTemplateIdForSettings}-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('✅ [SYNONYMS] Exported successfully');
}

/**
 * Import synonyms
 */
function importSynonyms() {
    alert('Import feature coming soon! For now, use the Add Mapping button to add synonyms manually.');
}

/**
 * Show error
 */
function showSynonymsError(message) {
    const container = document.getElementById('synonyms-container');
    if (!container) return;
    
    container.innerHTML = `
        <div class="text-center w-full text-red-500 py-8">
            <i class="fas fa-exclamation-triangle text-4xl mb-3"></i>
            <p>Error: ${message}</p>
            <button onclick="loadSynonymsForTemplate()" class="mt-4 px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg font-semibold transition-colors">
                <i class="fas fa-redo mr-2"></i>
                Retry
            </button>
        </div>
    `;
}

// ============================================
// MODALS (if needed)
// ============================================

/**
 * Show add filler word modal (currently using prompt, but could be enhanced)
 */
function showAddFillerWordModal() {
    addFillerWord();
}

/**
 * Reset filler words to defaults (placeholder)
 */
function resetFillerWordsToDefaults() {
    alert('Reset to Defaults feature coming soon!');
}

// ============================================
// CATEGORY-LEVEL MANAGEMENT
// ============================================

// Temporary storage for category form
let tempCategoryFillers = [];
let tempCategorySynonyms = new Map();

/**
 * Add filler to category (client-side only, saves when form submitted)
 */
function addCategoryFiller() {
    const input = document.getElementById('category-filler-input');
    if (!input) return;
    
    const fillers = input.value.split(',').map(f => f.trim().toLowerCase()).filter(f => f.length > 0);
    
    if (fillers.length === 0) {
        alert('Please enter at least one filler word!');
        return;
    }
    
    // Add to temp storage (deduplicate)
    fillers.forEach(filler => {
        if (!tempCategoryFillers.includes(filler)) {
            tempCategoryFillers.push(filler);
        }
    });
    
    // Clear input
    input.value = '';
    
    // Re-render
    renderCategoryFillers();
    
    console.log('✅ [CATEGORY FILLER] Added:', fillers);
}

/**
 * Remove filler from category
 */
function removeCategoryFiller(filler) {
    tempCategoryFillers = tempCategoryFillers.filter(f => f !== filler);
    renderCategoryFillers();
    console.log('➖ [CATEGORY FILLER] Removed:', filler);
}

/**
 * Render category fillers
 */
function renderCategoryFillers() {
    const container = document.getElementById('category-fillers-display');
    if (!container) return;
    
    if (tempCategoryFillers.length === 0) {
        container.innerHTML = '<div class="text-sm text-gray-500 py-2">No additional fillers yet</div>';
        return;
    }
    
    container.innerHTML = tempCategoryFillers.map(filler => `
        <div class="inline-flex items-center gap-2 px-3 py-1 bg-gray-200 rounded-lg text-sm font-medium text-gray-800">
            <span>${filler}</span>
            <button type="button" onclick="removeCategoryFiller('${filler}')" class="text-red-600 hover:text-red-800">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `).join('');
}

/**
 * Add synonym to category (client-side only)
 */
function addCategorySynonym() {
    const technicalInput = document.getElementById('category-synonym-technical');
    const colloquialInput = document.getElementById('category-synonym-colloquial');
    
    if (!technicalInput || !colloquialInput) return;
    
    const technical = technicalInput.value.trim().toLowerCase();
    const colloquialStr = colloquialInput.value.trim().toLowerCase();
    
    if (!technical || !colloquialStr) {
        alert('Please fill in both fields!');
        return;
    }
    
    const colloquial = colloquialStr.split(',').map(c => c.trim()).filter(c => c.length > 0);
    
    if (colloquial.length === 0) {
        alert('Please provide at least one colloquial term!');
        return;
    }
    
    // Add to temp storage (merge if exists)
    if (tempCategorySynonyms.has(technical)) {
        const existing = tempCategorySynonyms.get(technical);
        tempCategorySynonyms.set(technical, [...new Set([...existing, ...colloquial])]);
    } else {
        tempCategorySynonyms.set(technical, colloquial);
    }
    
    // Clear inputs
    technicalInput.value = '';
    colloquialInput.value = '';
    
    // Re-render
    renderCategorySynonyms();
    
    console.log('✅ [CATEGORY SYNONYM] Added:', technical, '→', colloquial);
}

/**
 * Remove synonym from category
 */
function removeCategorySynonym(technical) {
    tempCategorySynonyms.delete(technical);
    renderCategorySynonyms();
    console.log('➖ [CATEGORY SYNONYM] Removed:', technical);
}

/**
 * Render category synonyms
 */
function renderCategorySynonyms() {
    const container = document.getElementById('category-synonyms-display');
    if (!container) return;
    
    if (tempCategorySynonyms.size === 0) {
        container.innerHTML = '<div class="text-sm text-gray-500 py-2">No category synonyms yet</div>';
        return;
    }
    
    const html = [];
    for (const [technical, colloquial] of tempCategorySynonyms.entries()) {
        html.push(`
            <div class="bg-white border border-purple-200 rounded-lg p-3">
                <div class="flex items-start justify-between">
                    <div class="flex-1">
                        <div class="text-xs text-gray-500">Technical:</div>
                        <div class="font-bold text-purple-700">${technical}</div>
                        <div class="text-xs text-gray-500 mt-1">Colloquial:</div>
                        <div class="flex flex-wrap gap-1 mt-1">
                            ${colloquial.map(c => `<span class="px-2 py-0.5 bg-pink-100 text-pink-800 rounded text-xs">${c}</span>`).join('')}
                        </div>
                    </div>
                    <button type="button" onclick="removeCategorySynonym('${technical}')" class="px-2 py-1 bg-red-100 hover:bg-red-200 text-red-700 rounded text-xs font-semibold">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
        `);
    }
    
    container.innerHTML = html.join('');
}

/**
 * Load category data into form (when editing)
 */
function loadCategoryDataIntoForm(category) {
    // Load existing fillers
    tempCategoryFillers = category.additionalFillerWords || [];
    renderCategoryFillers();
    
    // Load existing synonyms
    tempCategorySynonyms = new Map();
    if (category.synonymMap) {
        if (category.synonymMap instanceof Map) {
            tempCategorySynonyms = new Map(category.synonymMap);
        } else if (typeof category.synonymMap === 'object') {
            for (const [term, aliases] of Object.entries(category.synonymMap)) {
                if (Array.isArray(aliases)) {
                    tempCategorySynonyms.set(term, aliases);
                }
            }
        }
    }
    renderCategorySynonyms();
    
    console.log('✅ [CATEGORY] Loaded data:', {
        fillers: tempCategoryFillers.length,
        synonyms: tempCategorySynonyms.size
    });
}

/**
 * Clear category form (when opening new category)
 */
function clearCategoryForm() {
    tempCategoryFillers = [];
    tempCategorySynonyms = new Map();
    renderCategoryFillers();
    renderCategorySynonyms();
    console.log('🔄 [CATEGORY] Form cleared');
}

/**
 * Get category data for saving
 */
function getCategoryFormData() {
    const synonymsObject = {};
    for (const [term, aliases] of tempCategorySynonyms.entries()) {
        synonymsObject[term] = aliases;
    }
    
    return {
        additionalFillerWords: tempCategoryFillers,
        synonymMap: synonymsObject
    };
}

// ============================================
// EXPORTS
// ============================================

// Make functions globally available
window.initializeTemplateSettings = initializeTemplateSettings;
window.loadFillerWordsForTemplate = loadFillerWordsForTemplate;
window.loadSynonymsForTemplate = loadSynonymsForTemplate;
window.addFillerWord = addFillerWord;
window.removeFillerWord = removeFillerWord;
window.searchFillerWords = searchFillerWords;
window.exportFillerWords = exportFillerWords;
window.showAddFillerWordModal = showAddFillerWordModal;
window.resetFillerWordsToDefaults = resetFillerWordsToDefaults;
window.addSynonymMapping = addSynonymMapping;
window.removeSynonymMapping = removeSynonymMapping;
window.exportSynonyms = exportSynonyms;
window.importSynonyms = importSynonyms;

// Category-level functions
window.addCategoryFiller = addCategoryFiller;
window.removeCategoryFiller = removeCategoryFiller;
window.addCategorySynonym = addCategorySynonym;
window.removeCategorySynonym = removeCategorySynonym;
window.loadCategoryDataIntoForm = loadCategoryDataIntoForm;
window.clearCategoryForm = clearCategoryForm;
window.getCategoryFormData = getCategoryFormData;

console.log('✅ [TEMPLATE SETTINGS] Manager loaded');

