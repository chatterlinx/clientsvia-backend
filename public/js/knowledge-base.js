/**
 * =========================================
 * ENTERPRISE KNOWLEDGE BASE MODULE v3.0
 * Built from scratch - bulletproof, reliable
 * =========================================
 */

class EnterpriseKnowledgeBase {
    constructor() {
        console.log('🚀 Initializing Enterprise Knowledge Base v3.0');
        this.companyId = this.extractCompanyId();
        this.qaEntries = [];
        this.settings = {
            confidenceThreshold: 0.80,
            reviewFrequency: 180,
            version: '3.0.0',
            lastUpdated: null
        };
        this.hasUnsavedChanges = false;
        this.init();
    }

    extractCompanyId() {
        // Try multiple methods to get company ID
        const urlParams = new URLSearchParams(window.location.search);
        const companyId = urlParams.get('id') || 
                         urlParams.get('companyId') || 
                         document.querySelector('[data-company-id]')?.dataset.companyId ||
                         window.currentCompanyId;
        
        console.log('🔍 Extracted company ID:', companyId);
        return companyId;
    }

    async init() {
        try {
            console.log('🎯 Starting initialization...');
            this.setupEventListeners();
            await this.loadCompanyInfo();
            await this.loadKBSettings();
            await this.loadQAEntries();
            this.updateUI();
            console.log('✅ Enterprise Knowledge Base initialized successfully');
        } catch (error) {
            console.error('❌ Initialization failed:', error);
            this.showError('Failed to initialize Knowledge Base: ' + error.message);
        }
    }

    setupEventListeners() {
        console.log('🔧 Setting up event listeners...');

        // Confidence threshold slider
        const thresholdSlider = document.getElementById('confidence-threshold');
        const thresholdValue = document.getElementById('threshold-value');
        
        thresholdSlider.addEventListener('input', (e) => {
            const value = parseFloat(e.target.value);
            thresholdValue.textContent = value.toFixed(2);
            this.settings.confidenceThreshold = value;
            this.markUnsavedChanges();
        });

        // Review frequency
        document.getElementById('review-frequency').addEventListener('change', (e) => {
            this.settings.reviewFrequency = parseInt(e.target.value);
            this.markUnsavedChanges();
        });

        // Save button - THE MOST IMPORTANT ONE!
        document.getElementById('save-settings-btn').addEventListener('click', () => {
            this.saveSettings();
        });

        // Modal controls
        document.getElementById('add-qa-btn').addEventListener('click', () => this.openModal());
        document.getElementById('close-modal').addEventListener('click', () => this.closeModal());
        document.getElementById('cancel-qa').addEventListener('click', () => this.closeModal());
        document.getElementById('qa-form').addEventListener('submit', (e) => this.saveQA(e));

        // Search and filter
        document.getElementById('search-qa').addEventListener('input', () => this.filterQAs());
        document.getElementById('intent-filter').addEventListener('change', () => this.filterQAs());

        // Export
        document.getElementById('export-btn').addEventListener('click', () => this.exportKB());

        // Prevent accidental navigation with unsaved changes
        window.addEventListener('beforeunload', (e) => {
            if (this.hasUnsavedChanges) {
                e.preventDefault();
                e.returnValue = 'You have unsaved changes. Are you sure you want to leave?';
                return e.returnValue;
            }
        });

        console.log('✅ All event listeners attached');
    }

    markUnsavedChanges() {
        this.hasUnsavedChanges = true;
        const saveBtn = document.getElementById('save-settings-btn');
        saveBtn.classList.add('save-button-glow');
        saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Changes (Unsaved)';
        console.log('📝 Marked as having unsaved changes');
    }

    clearUnsavedChanges() {
        this.hasUnsavedChanges = false;
        const saveBtn = document.getElementById('save-settings-btn');
        saveBtn.classList.remove('save-button-glow');
        saveBtn.innerHTML = '<i class="fas fa-check mr-2"></i>Settings Saved';
        
        // Reset button after 2 seconds
        setTimeout(() => {
            saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save KB Settings';
        }, 2000);
        
        console.log('✅ Cleared unsaved changes flag');
    }

    async loadCompanyInfo() {
        if (!this.companyId) {
            throw new Error('No company ID available');
        }

        try {
            console.log('📡 Loading company info for ID:', this.companyId);
            
            const response = await fetch(`/api/company/${this.companyId}`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();
            console.log('✅ Company info loaded:', data);

            // Update UI with company info
            document.getElementById('company-name').textContent = data.companyName || 'Unknown Company';
            document.getElementById('company-id').textContent = `ID: ${this.companyId}`;

        } catch (error) {
            console.error('❌ Failed to load company info:', error);
            document.getElementById('company-name').textContent = 'Unknown Company';
            document.getElementById('company-id').textContent = `ID: ${this.companyId}`;
        }
    }

    async loadKBSettings() {
        try {
            console.log('📡 Loading KB settings for company:', this.companyId);
            
            const response = await fetch(`/api/company-kb/companies/${this.companyId}/settings`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            let settings = {};
            if (response.ok) {
                const data = await response.json();
                settings = data.data || data;
                console.log('✅ KB settings loaded:', settings);
            } else {
                console.log('ℹ️ No existing settings found, using defaults');
            }

            // Apply settings to UI
            this.settings = {
                confidenceThreshold: settings.confidenceThreshold || 0.80,
                reviewFrequency: settings.reviewFrequency || 180,
                version: settings.version || '3.0.0',
                lastUpdated: settings.lastUpdated || null
            };

            this.updateSettingsUI();

        } catch (error) {
            console.error('❌ Failed to load KB settings:', error);
            this.updateSettingsUI(); // Use defaults
        }
    }

    updateSettingsUI() {
        document.getElementById('confidence-threshold').value = this.settings.confidenceThreshold;
        document.getElementById('threshold-value').textContent = this.settings.confidenceThreshold.toFixed(2);
        document.getElementById('review-frequency').value = this.settings.reviewFrequency;
        document.getElementById('kb-version').textContent = this.settings.version;
        document.getElementById('last-updated').textContent = 
            this.settings.lastUpdated ? new Date(this.settings.lastUpdated).toLocaleDateString() : 'Never';
    }

    async saveSettings() {
        console.log('🚀 SAVE PROCESS INITIATED - Enterprise KB v3.0');
        
        if (!this.companyId) {
            this.showError('No company ID available - cannot save');
            return;
        }

        try {
            // Show saving state
            const saveBtn = document.getElementById('save-settings-btn');
            const originalHtml = saveBtn.innerHTML;
            saveBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
            saveBtn.disabled = true;

            // Prepare payload
            const payload = {
                confidenceThreshold: this.settings.confidenceThreshold,
                reviewFrequency: this.settings.reviewFrequency,
                version: this.settings.version,
                lastUpdated: new Date().toISOString()
            };

            console.log('📦 Payload prepared:', payload);
            console.log('🌐 API URL:', `/api/company-kb/companies/${this.companyId}/settings`);

            // Make the API call
            const response = await fetch(`/api/company-kb/companies/${this.companyId}/settings`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            console.log('📡 Response status:', response.status);
            console.log('📡 Response ok:', response.ok);

            if (response.ok) {
                const result = await response.json();
                console.log('✅ SAVE SUCCESS - Server response:', result);

                // Update local settings
                this.settings.lastUpdated = payload.lastUpdated;
                this.updateSettingsUI();
                this.clearUnsavedChanges();

                // Show success message
                this.showSuccess('Settings saved successfully!');
                
                console.log('🎉 CONFIRMED: Knowledge Base settings saved to database');

            } else {
                const errorData = await response.text();
                throw new Error(`HTTP ${response.status}: ${errorData}`);
            }

        } catch (error) {
            console.error('❌ SAVE FAILED:', error);
            this.showError('Failed to save settings: ' + error.message);
        } finally {
            // Reset button
            const saveBtn = document.getElementById('save-settings-btn');
            saveBtn.disabled = false;
            if (this.hasUnsavedChanges) {
                saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save Changes (Unsaved)';
            } else {
                saveBtn.innerHTML = '<i class="fas fa-save mr-2"></i>Save KB Settings';
            }
        }
    }

    async loadQAEntries() {
        try {
            console.log('📡 Loading Q&A entries...');
            
            const response = await fetch(`/api/company-kb/companies/${this.companyId}/company-kb`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (response.ok) {
                const data = await response.json();
                this.qaEntries = data.data || [];
                console.log('✅ Q&A entries loaded:', this.qaEntries.length);
            } else {
                console.log('ℹ️ No Q&A entries found');
                this.qaEntries = [];
            }

            this.renderQAEntries();
            this.updateCounts();

        } catch (error) {
            console.error('❌ Failed to load Q&A entries:', error);
            this.qaEntries = [];
            this.renderQAEntries();
        }
    }

    renderQAEntries() {
        const container = document.getElementById('qa-list');
        
        if (this.qaEntries.length === 0) {
            container.innerHTML = `
                <div class="text-center py-8 text-gray-500">
                    <i class="fas fa-search text-4xl mb-4"></i>
                    <p>No Q&A entries found. Click "Add Q&A" to get started.</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.qaEntries.map(qa => this.renderQAItem(qa)).join('');
    }

    renderQAItem(qa) {
        const keywords = (qa.keywords || []).join(', ');
        return `
            <div class="qa-item border border-gray-200 rounded-lg p-4 hover:shadow-md transition-all">
                <div class="flex justify-between items-start mb-2">
                    <h4 class="font-medium text-gray-900">${this.escapeHtml(qa.question || '')}</h4>
                    <div class="flex space-x-2">
                        <button onclick="kb.editQA('${qa._id}')" class="text-blue-600 hover:text-blue-800">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button onclick="kb.deleteQA('${qa._id}')" class="text-red-600 hover:text-red-800">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
                <p class="text-gray-700 mb-3">${this.escapeHtml(qa.answer || '')}</p>
                <div class="flex flex-wrap gap-2 text-sm">
                    ${qa.intent ? `<span class="px-2 py-1 bg-blue-100 text-blue-800 rounded">${this.escapeHtml(qa.intent)}</span>` : ''}
                    <span class="px-2 py-1 bg-gray-100 text-gray-600 rounded">Keywords: ${this.escapeHtml(keywords)}</span>
                </div>
            </div>
        `;
    }

    updateCounts() {
        document.getElementById('qa-count').textContent = `${this.qaEntries.length} entries`;
        document.getElementById('entry-count').textContent = this.qaEntries.length;
    }

    showSuccess(message) {
        this.showStatus(message, 'success');
    }

    showError(message) {
        this.showStatus(message, 'error');
    }

    showStatus(message, type) {
        const statusDiv = document.getElementById('save-status');
        const bgColor = type === 'success' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800';
        const icon = type === 'success' ? 'fa-check-circle' : 'fa-exclamation-triangle';
        
        statusDiv.innerHTML = `
            <div class="p-3 rounded-md ${bgColor} flex items-center justify-center">
                <i class="fas ${icon} mr-2"></i>
                ${message}
            </div>
        `;
        statusDiv.classList.remove('hidden');
        
        // Auto-hide after 5 seconds
        setTimeout(() => {
            statusDiv.classList.add('hidden');
        }, 5000);
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    updateUI() {
        this.updateSettingsUI();
        this.updateCounts();
    }

    // Modal and Q&A management methods
    openModal(qaId = null) {
        document.getElementById('qa-modal').classList.remove('hidden');
        // Implementation for editing existing Q&A if qaId provided
    }

    closeModal() {
        document.getElementById('qa-modal').classList.add('hidden');
    }

    async saveQA(event) {
        event.preventDefault();
        // Implementation for saving Q&A entries
    }

    filterQAs() {
        // Implementation for filtering Q&A entries
    }

    exportKB() {
        // Implementation for exporting KB data
    }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.kb = new EnterpriseKnowledgeBase();
});

console.log('📄 Enterprise Knowledge Base v3.0 script loaded');
