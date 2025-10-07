/**
 * GLOBAL AI BRAIN SYNC MODULE
 * 
 * Purpose: Sync company instant responses with Global AI Brain template
 * Features:
 * - Compare company vs. global scenarios
 * - Show NEW, UPDATED, UNCHANGED scenarios
 * - Cherry-pick import functionality
 * - Beautiful diff UI with stats
 * 
 * Created: 2025-10-07
 */

class GlobalAIBrainSync {
    constructor(companyId, manager) {
        this.companyId = companyId;
        this.manager = manager; // Reference to InstantResponseCategoriesManager
        console.log(`🧠 [SYNC] Initialized for company: ${companyId}`);
    }

    getAuthToken() {
        return localStorage.getItem('adminToken') ||
               localStorage.getItem('authToken') ||
               sessionStorage.getItem('authToken') ||
               localStorage.getItem('token') ||
               sessionStorage.getItem('token') || '';
    }

    async openSyncModal() {
        try {
            console.log('🧠 [SYNC] Opening sync modal...');
            this.manager.showSuccess('⏳ Comparing with Global AI Brain...');
            
            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.companyId}/sync-global-brain/compare`, {
                credentials: 'include',
                headers: authToken ? { 'Authorization': `Bearer ${authToken}` } : {}
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();
            
            if (!result.success) {
                this.manager.showError(result.message || 'Failed to compare with global template');
                return;
            }

            console.log('✅ [SYNC] Comparison result:', result);
            this.showSyncModal(result);
        } catch (error) {
            console.error('❌ [SYNC] Error comparing with global:', error);
            this.manager.showError('Failed to compare with Global AI Brain');
        }
    }

    showSyncModal(comparisonResult) {
        const { comparison } = comparisonResult;
        const { newScenarios, updatedScenarios, unchangedScenarios, stats } = comparison;

        const modalHTML = `
            <div id="sync-modal" style="display: flex; position: fixed; inset: 0; background: rgba(0,0,0,0.7); z-index: 10000; align-items: center; justify-content: center;">
                <div style="background: white; border-radius: 16px; max-width: 900px; width: 95%; max-height: 90vh; overflow-y: auto; padding: 30px; box-shadow: 0 20px 60px rgba(0,0,0,0.4);">
                    <div style="display: flex; align-items: center; justify-between; margin-bottom: 20px;">
                        <h2 style="font-size: 28px; font-weight: 700; color: #2c3e50; margin: 0;">
                            🧠 Global AI Brain Updates
                        </h2>
                        <button onclick="document.getElementById('sync-modal').remove()" style="background: none; border: none; font-size: 32px; color: #95a5a6; cursor: pointer;">
                            &times;
                        </button>
                    </div>

                    <!-- Stats -->
                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 15px; margin-bottom: 25px;">
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
                            <div style="font-size: 36px; font-weight: 700;">${stats.new}</div>
                            <div style="font-size: 14px; opacity: 0.9;">New Scenarios</div>
                        </div>
                        <div style="background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
                            <div style="font-size: 36px; font-weight: 700;">${stats.updated}</div>
                            <div style="font-size: 14px; opacity: 0.9;">Updated Scenarios</div>
                        </div>
                        <div style="background: linear-gradient(135deg, #4facfe 0%, #00f2fe 100%); color: white; padding: 20px; border-radius: 12px; text-align: center;">
                            <div style="font-size: 36px; font-weight: 700;">${stats.unchanged}</div>
                            <div style="font-size: 14px; opacity: 0.9;">Already Up to Date</div>
                        </div>
                    </div>

                    ${stats.new === 0 && stats.updated === 0 ? `
                        <div style="text-align: center; padding: 40px; background: #f8f9fa; border-radius: 12px;">
                            <i class="fas fa-check-circle" style="font-size: 64px; color: #28a745; margin-bottom: 15px;"></i>
                            <h3 style="color: #2c3e50; margin-bottom: 10px;">You're All Up to Date!</h3>
                            <p style="color: #6c757d;">Your instant responses match the latest Global AI Brain template.</p>
                        </div>
                    ` : `
                        <!-- New Scenarios -->
                        ${newScenarios.length > 0 ? `
                            <div style="margin-bottom: 25px;">
                                <h3 style="font-size: 20px; font-weight: 700; color: #667eea; margin-bottom: 15px;">
                                    ✨ New Scenarios Available (${newScenarios.length})
                                </h3>
                                <div style="max-height: 300px; overflow-y: auto; border: 2px solid #e9ecef; border-radius: 8px; padding: 15px;">
                                    ${newScenarios.map(scenario => `
                                        <label style="display: flex; align-items: start; padding: 12px; background: #f8f9fa; border-radius: 8px; margin-bottom: 10px; cursor: pointer; transition: all 0.2s;">
                                            <input type="checkbox" class="sync-scenario-checkbox" data-scenario-id="${scenario.id}" checked style="margin-right: 12px; margin-top: 4px; width: 18px; height: 18px;">
                                            <div style="flex: 1;">
                                                <div style="font-weight: 600; color: #2c3e50; margin-bottom: 4px;">
                                                    ${scenario.categoryIcon || '⚡'} ${this.escapeHtml(scenario.name)}
                                                </div>
                                                <div style="font-size: 13px; color: #6c757d; margin-bottom: 6px;">
                                                    Category: ${this.escapeHtml(scenario.categoryName)}
                                                </div>
                                                <div style="font-size: 12px; color: #495057;">
                                                    ${scenario.triggers.length} triggers • ${(scenario.keywords || []).length} keywords
                                                </div>
                                            </div>
                                        </label>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}

                        <!-- Updated Scenarios -->
                        ${updatedScenarios.length > 0 ? `
                            <div style="margin-bottom: 25px;">
                                <h3 style="font-size: 20px; font-weight: 700; color: #f5576c; margin-bottom: 15px;">
                                    🔄 Updated Scenarios (${updatedScenarios.length})
                                </h3>
                                <div style="max-height: 300px; overflow-y: auto; border: 2px solid #e9ecef; border-radius: 8px; padding: 15px;">
                                    ${updatedScenarios.map(item => `
                                        <label style="display: flex; align-items: start; padding: 12px; background: #fff3cd; border-radius: 8px; margin-bottom: 10px; cursor: pointer;">
                                            <input type="checkbox" class="sync-scenario-checkbox" data-scenario-id="${item.global.id}" checked style="margin-right: 12px; margin-top: 4px; width: 18px; height: 18px;">
                                            <div style="flex: 1;">
                                                <div style="font-weight: 600; color: #2c3e50; margin-bottom: 4px;">
                                                    ${this.escapeHtml(item.global.name)}
                                                </div>
                                                <div style="font-size: 12px; color: #856404;">
                                                    Changes: ${item.changes.join(', ')}
                                                </div>
                                            </div>
                                        </label>
                                    `).join('')}
                                </div>
                            </div>
                        ` : ''}

                        <!-- Action Buttons -->
                        <div style="display: flex; gap: 12px; justify-content: flex-end; margin-top: 25px;">
                            <button onclick="document.getElementById('sync-modal').remove()" class="btn btn-secondary" style="padding: 12px 24px; font-weight: 600;">
                                Cancel
                            </button>
                            <button onclick="globalAIBrainSync.importSelectedScenarios()" class="btn btn-primary" style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border: none; padding: 12px 24px; font-weight: 600;">
                                <i class="fas fa-download mr-2"></i>Import Selected
                            </button>
                        </div>
                    `}
                </div>
            </div>
        `;

        // Remove existing modal if any
        document.getElementById('sync-modal')?.remove();
        
        // Add new modal
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    async importSelectedScenarios() {
        try {
            const checkboxes = document.querySelectorAll('.sync-scenario-checkbox:checked');
            const scenarioIds = Array.from(checkboxes).map(cb => cb.dataset.scenarioId);

            if (scenarioIds.length === 0) {
                this.manager.showError('Please select at least one scenario to import');
                return;
            }

            console.log(`📥 [SYNC] Importing ${scenarioIds.length} scenarios...`);
            this.manager.showSuccess(`⏳ Importing ${scenarioIds.length} scenarios...`);

            const authToken = this.getAuthToken();
            const response = await fetch(`/api/company/${this.companyId}/sync-global-brain/import`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json',
                    ...(authToken ? { 'Authorization': `Bearer ${authToken}` } : {})
                },
                body: JSON.stringify({ scenarioIds })
            });

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const result = await response.json();

            if (!result.success) {
                this.manager.showError(result.message || 'Failed to import scenarios');
                return;
            }

            console.log('✅ [SYNC] Import successful:', result);
            this.manager.showSuccess(`✅ Successfully imported ${result.stats.imported} scenarios!`);

            // Close modal and reload
            document.getElementById('sync-modal')?.remove();
            await this.manager.loadCategories();
            this.manager.render();
        } catch (error) {
            console.error('❌ [SYNC] Error importing scenarios:', error);
            this.manager.showError('Failed to import scenarios');
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
}

// Export for use in company profile
window.GlobalAIBrainSync = GlobalAIBrainSync;
