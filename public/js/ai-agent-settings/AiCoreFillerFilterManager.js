/**
 * ============================================================================
 * AICORE FILLER FILTER MANAGER
 * ============================================================================
 * 
 * PURPOSE: Modern filler words management with template inheritance
 * 
 * FEATURES:
 * - Auto-scan templates for inherited filler words
 * - Company-specific custom filler additions
 * - 2-tab system: Overview & Status | Filler Words Table
 * - Real-time stats and monitoring
 * - Clean separation: Inherited (read-only) vs Custom (editable)
 * 
 * ARCHITECTURE:
 * - Inherited fillers from active templates (cannot edit)
 * - Custom fillers specific to this company (can add/remove)
 * - Background scanning like Variables system
 * 
 * ============================================================================
 */

class AiCoreFillerFilterManager {
    constructor(companyId) {
        console.log('🔇 [FILLER FILTER] Checkpoint 1: Constructor called');
        this.companyId = companyId;
        this.inheritedFillers = [];
        this.customFillers = [];
        this.scanStatus = null;
        this.currentTab = 'overview-status';
        this.isScanning = false;
        console.log('✅ [FILLER FILTER] Checkpoint 2: Initialized for company:', companyId);
    }

    /**
     * Load filler filter data
     */
    async load() {
        console.log('🔇 [FILLER FILTER] Checkpoint 3: Loading filler filter data...');
        
        try {
            const token = localStorage.getItem('adminToken');
            if (!token) {
                console.error('❌ [FILLER FILTER] Checkpoint 4: No auth token found');
                throw new Error('Authentication required');
            }
            
            console.log('✅ [FILLER FILTER] Checkpoint 4: Auth token present');
            console.log('🔇 [FILLER FILTER] Checkpoint 5: Fetching from API...');
            
            const response = await fetch(`/api/company/${this.companyId}/configuration/filler-filter`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            console.log('✅ [FILLER FILTER] Checkpoint 6: Response received - Status:', response.status);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            console.log('🔇 [FILLER FILTER] Checkpoint 7: Parsing JSON...');
            const data = await response.json();
            console.log('✅ [FILLER FILTER] Checkpoint 8: Data parsed:', data);
            
            this.inheritedFillers = data.inheritedFillers || [];
            this.customFillers = data.customFillers || [];
            this.scanStatus = data.scanStatus || {};
            
            console.log('🔇 [FILLER FILTER] Checkpoint 9: Rendering UI...');
            this.render();
            console.log('✅ [FILLER FILTER] Checkpoint 10: Load complete');
            
        } catch (error) {
            console.error('❌ [FILLER FILTER] Checkpoint ERROR:', error);
            console.error('❌ [FILLER FILTER] Full error object:', error);
            this.renderError(error.message);
        }
    }

    /**
     * Render the complete UI
     */
    render() {
        console.log('🔇 [FILLER FILTER] Checkpoint 11: Starting render - Current tab:', this.currentTab);
        
        const container = document.getElementById('ai-settings-aicore-filler-filter-content');
        if (!container) {
            console.error('❌ [FILLER FILTER] Container not found! Expected: ai-settings-aicore-filler-filter-content');
            return;
        }
        
        console.log('✅ [FILLER FILTER] Checkpoint 12: Container found');
        
        container.innerHTML = `
            <div class="filler-filter-dashboard">
                <!-- Tab Navigation -->
                <div style="display: flex; gap: 12px; margin-bottom: 24px; border-bottom: 2px solid #e5e7eb; padding-bottom: 12px;">
                    <button class="filler-filter-tab-btn ${this.currentTab === 'overview-status' ? 'active' : ''}" 
                            onclick="window.aiCoreFillerFilterManager.switchTab('overview-status')" 
                            style="padding: 10px 20px; font-size: 14px; font-weight: ${this.currentTab === 'overview-status' ? '600' : '500'}; color: ${this.currentTab === 'overview-status' ? '#6366f1' : '#6b7280'}; background: ${this.currentTab === 'overview-status' ? '#eef2ff' : 'transparent'}; border: none; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
                        📊 Overview & Status
                    </button>
                    <button class="filler-filter-tab-btn ${this.currentTab === 'filler-table' ? 'active' : ''}" 
                            onclick="window.aiCoreFillerFilterManager.switchTab('filler-table')" 
                            style="padding: 10px 20px; font-size: 14px; font-weight: ${this.currentTab === 'filler-table' ? '600' : '500'}; color: ${this.currentTab === 'filler-table' ? '#6366f1' : '#6b7280'}; background: ${this.currentTab === 'filler-table' ? '#eef2ff' : 'transparent'}; border: none; border-radius: 6px; cursor: pointer; transition: all 0.2s;">
                        📝 Filler Words Table
                    </button>
                </div>
                
                <!-- Tab Content -->
                <div id="filler-filter-tab-content"></div>
            </div>
        `;
        
        console.log('✅ [FILLER FILTER] Checkpoint 13: Tab navigation rendered');
        console.log('🔇 [FILLER FILTER] Checkpoint 13.5: Container innerHTML length:', container.innerHTML.length);
        console.log('🔇 [FILLER FILTER] Checkpoint 13.6: Container visible?', container.style.display !== 'none');
        
        // Render current tab content
        this.renderTabContent();
        
        console.log('✅ [FILLER FILTER] Checkpoint 14: UI rendered successfully');
        console.log('🔇 [FILLER FILTER] Checkpoint 14.5: Final innerHTML length:', container.innerHTML.length);
    }

    /**
     * Switch between tabs
     */
    switchTab(tab) {
        console.log(`🔇 [FILLER FILTER] Switching to tab: ${tab}`);
        this.currentTab = tab;
        this.render();
    }

    /**
     * Render current tab content
     */
    renderTabContent() {
        const contentContainer = document.getElementById('filler-filter-tab-content');
        if (!contentContainer) return;
        
        switch (this.currentTab) {
            case 'overview-status':
                this.renderOverviewStatus(contentContainer);
                break;
            case 'filler-table':
                this.renderFillerTable(contentContainer);
                break;
        }
    }

    /**
     * TAB 1: Overview & Status
     */
    renderOverviewStatus(container) {
        const totalInherited = this.inheritedFillers.length;
        const totalCustom = this.customFillers.length;
        const totalFillers = totalInherited + totalCustom;
        const lastScan = this.scanStatus?.lastScan;
        const lastScanText = lastScan ? this.getTimeAgo(new Date(lastScan)) : 'Never';
        
        // Health status
        const isHealthy = totalFillers > 0;
        const healthIcon = isHealthy ? '🟢' : '🔴';
        const healthText = isHealthy ? 'ACTIVE' : 'NO FILTERS';
        
        container.innerHTML = `
            <!-- Health Check Card -->
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); border-radius: 12px; box-shadow: 0 4px 6px rgba(0,0,0,0.1); padding: 24px; margin-bottom: 24px; color: white;">
                <div style="display: flex; align-items: center; justify-content: between; gap: 24px;">
                    <div style="flex: 1;">
                        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;">
                            <span style="font-size: 48px;">${healthIcon}</span>
                            <div>
                                <h2 style="font-size: 28px; font-weight: 700; margin: 0;">FILLER FILTER ${healthText}</h2>
                                <p style="font-size: 14px; opacity: 0.9; margin: 0;">Intelligent Speech Cleanup System</p>
                            </div>
                        </div>
                        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; font-size: 14px;">
                            <div>
                                <div style="opacity: 0.8;">Last Scan</div>
                                <div style="font-size: 18px; font-weight: 700;">${lastScanText}</div>
                            </div>
                            <div>
                                <div style="opacity: 0.8;">Inherited Filters</div>
                                <div style="font-size: 18px; font-weight: 700;">${totalInherited} from templates</div>
                            </div>
                            <div>
                                <div style="opacity: 0.8;">Custom Filters</div>
                                <div style="font-size: 18px; font-weight: 700;">${totalCustom} company-specific</div>
                            </div>
                        </div>
                    </div>
                    <div>
                        <button 
                            onclick="window.aiCoreFillerFilterManager.forceScan()"
                            style="padding: 16px 32px; background: white; color: #6366f1; border: none; border-radius: 8px; font-size: 16px; font-weight: 700; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s;"
                            ${this.isScanning ? 'disabled' : ''}
                        >
                            <span style="font-size: 24px; display: block; margin-bottom: 4px;">⚡</span>
                            ${this.isScanning ? 'Scanning...' : 'Force Scan'}
                        </button>
                    </div>
                </div>
            </div>
            
            <!-- Stats Grid -->
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 20px; margin-bottom: 24px;">
                <!-- Total Filters Card -->
                <div style="background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 24px;">
                    <div style="font-size: 14px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
                        Total Active Filters
                    </div>
                    <div style="font-size: 48px; font-weight: 700; color: #6366f1; margin-bottom: 8px;">
                        ${totalFillers}
                    </div>
                    <div style="font-size: 12px; color: #6b7280;">
                        ${totalInherited} inherited + ${totalCustom} custom
                    </div>
                </div>
                
                <!-- Inherited Card -->
                <div style="background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 24px;">
                    <div style="font-size: 14px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
                        Inherited from Templates
                    </div>
                    <div style="font-size: 48px; font-weight: 700; color: #6b7280; margin-bottom: 8px;">
                        ${totalInherited}
                    </div>
                    <div style="font-size: 12px; color: #6b7280;">
                        🔒 Read-only (from Global AI Brain)
                    </div>
                </div>
                
                <!-- Custom Card -->
                <div style="background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 24px;">
                    <div style="font-size: 14px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">
                        Custom Additions
                    </div>
                    <div style="font-size: 48px; font-weight: 700; color: #10b981; margin-bottom: 8px;">
                        ${totalCustom}
                    </div>
                    <div style="font-size: 12px; color: #6b7280;">
                        ✏️ Editable (company-specific)
                    </div>
                </div>
            </div>
            
            <!-- Scan Report -->
            ${this.renderScanReport()}
            
            <!-- Info Banner -->
            <div style="background: linear-gradient(135deg, #f3f4f6 0%, #e5e7eb 100%); border-radius: 12px; padding: 24px; border-left: 4px solid #6366f1;">
                <h3 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 12px; display: flex; align-items: center; gap: 8px;">
                    💡 How Filler Filter Works
                </h3>
                <p style="font-size: 14px; color: #4b5563; line-height: 1.6; margin-bottom: 12px;">
                    The Filler Filter system automatically removes common speech patterns (like "um", "uh", "you know", "like") 
                    from customer input before the AI processes it. This dramatically improves accuracy and understanding.
                </p>
                <p style="font-size: 14px; color: #4b5563; line-height: 1.6; margin-bottom: 12px;">
                    <strong>Example:</strong> "Um, I need to, like, book an appointment" → "I need to book an appointment"
                </p>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-top: 16px;">
                    <div style="padding: 16px; background: white; border-radius: 8px;">
                        <div style="font-weight: 700; color: #6b7280; margin-bottom: 8px;">🔒 Inherited Fillers</div>
                        <div style="font-size: 13px; color: #6b7280; line-height: 1.5;">
                            Come from your active Global AI Brain templates. These are read-only and managed centrally.
                        </div>
                    </div>
                    <div style="padding: 16px; background: white; border-radius: 8px;">
                        <div style="font-weight: 700; color: #10b981; margin-bottom: 8px;">✏️ Custom Fillers</div>
                        <div style="font-size: 13px; color: #6b7280; line-height: 1.5;">
                            Company-specific additions for industry jargon or regional speech patterns unique to your business.
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    /**
     * Render scan report
     */
    renderScanReport() {
        const scanReport = this.scanStatus?.scanReport || [];
        
        if (scanReport.length === 0) {
            return `
                <div style="background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
                    <h3 style="font-size: 16px; font-weight: 700; color: #92400e; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                        📋 Last Scan Report
                    </h3>
                    <p style="font-size: 14px; color: #78350f; margin: 0;">
                        <strong>No templates activated.</strong> Activate a template in the <strong>AiCore Templates</strong> tab to inherit filler words.
                    </p>
                </div>
            `;
        }
        
        return `
            <div style="background: white; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 24px; margin-bottom: 24px;">
                <h3 style="font-size: 18px; font-weight: 700; color: #111827; margin-bottom: 16px; display: flex; align-items: center; gap: 8px;">
                    📋 Last Scan Report
                </h3>
                <div style="display: flex; flex-direction: column; gap: 12px;">
                    ${scanReport.map(report => `
                        <div style="padding: 16px; background: ${report.fillers > 0 ? '#d1fae5' : '#fee2e2'}; border-left: 4px solid ${report.fillers > 0 ? '#10b981' : '#ef4444'}; border-radius: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 8px;">
                                <div style="flex: 1;">
                                    <p style="font-size: 15px; font-weight: 700; color: #111827; margin: 0 0 4px 0;">
                                        ${report.fillers > 0 ? '✅' : '⚠️'} ${report.templateName}
                                    </p>
                                    <p style="font-size: 13px; color: #6b7280; margin: 0;">
                                        Scanned: <strong>${report.categories} categories</strong>, 
                                        <strong>${report.scenarios} scenarios</strong>
                                    </p>
                                </div>
                                <div style="text-align: right;">
                                    <div style="font-size: 24px; font-weight: 700; color: ${report.fillers > 0 ? '#10b981' : '#ef4444'};">
                                        ${report.fillers}
                                    </div>
                                    <div style="font-size: 11px; color: #6b7280; text-transform: uppercase; font-weight: 600;">
                                        fillers
                                    </div>
                                </div>
                            </div>
                            ${report.fillers === 0 ? `
                                <p style="font-size: 12px; color: #991b1b; margin: 8px 0 0 0; padding-top: 8px; border-top: 1px solid #fecaca;">
                                    💡 This template has no filler words defined. Add custom fillers below to improve AI accuracy.
                                </p>
                            ` : ''}
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    /**
     * TAB 2: Filler Words Table
     */
    renderFillerTable(container) {
        if (this.inheritedFillers.length === 0 && this.customFillers.length === 0) {
            this.renderEmptyState(container);
            return;
        }
        
        // Combine and sort all fillers
        const allFillers = [
            ...this.inheritedFillers.map(f => ({ word: f, type: 'inherited' })),
            ...this.customFillers.map(f => ({ word: f, type: 'custom' }))
        ].sort((a, b) => a.word.localeCompare(b.word));
        
        container.innerHTML = `
            <!-- Table Header -->
            <div style="background: white; border-radius: 12px 12px 0 0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); padding: 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #e5e7eb;">
                <div>
                    <h3 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0;">
                        Filler Words (${allFillers.length})
                    </h3>
                    <p style="font-size: 14px; color: #6b7280; margin: 4px 0 0 0;">
                        ${this.inheritedFillers.length} inherited + ${this.customFillers.length} custom
                    </p>
                </div>
                <button 
                    onclick="window.aiCoreFillerFilterManager.addCustomFiller()"
                    style="padding: 12px 24px; background: #10b981; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.1);">
                    + Add Custom Filler
                </button>
            </div>
            
            <!-- Table -->
            <div style="background: white; border-radius: 0 0 12px 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden;">
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr style="background: #f9fafb; border-bottom: 2px solid #e5e7eb;">
                            <th style="text-align: left; padding: 16px; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">
                                Filler Word
                            </th>
                            <th style="text-align: center; padding: 16px; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">
                                Type
                            </th>
                            <th style="text-align: center; padding: 16px; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">
                                Source
                            </th>
                            <th style="text-align: center; padding: 16px; font-size: 12px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; width: 120px;">
                                Actions
                            </th>
                        </tr>
                    </thead>
                    <tbody>
                        ${allFillers.map((filler, index) => `
                            <tr style="border-bottom: 1px solid #f3f4f6; ${filler.type === 'inherited' ? 'background: #f9fafb;' : ''}">
                                <td style="padding: 16px; font-size: 15px; font-weight: ${filler.type === 'custom' ? '600' : '500'}; color: ${filler.type === 'custom' ? '#111827' : '#6b7280'};">
                                    ${filler.type === 'inherited' ? '🔒' : '✏️'} "${filler.word}"
                                </td>
                                <td style="padding: 16px; text-align: center;">
                                    <span style="display: inline-block; padding: 6px 12px; background: ${filler.type === 'inherited' ? '#f3f4f6' : '#d1fae5'}; color: ${filler.type === 'inherited' ? '#6b7280' : '#10b981'}; font-size: 12px; font-weight: 700; border-radius: 12px; text-transform: uppercase; letter-spacing: 0.5px;">
                                        ${filler.type}
                                    </span>
                                </td>
                                <td style="padding: 16px; text-align: center; font-size: 13px; color: #6b7280;">
                                    ${filler.type === 'inherited' ? 'Global AI Brain' : 'Company-Specific'}
                                </td>
                                <td style="padding: 16px; text-align: center;">
                                    ${filler.type === 'custom' ? `
                                        <button 
                                            onclick="window.aiCoreFillerFilterManager.removeCustomFiller('${filler.word}')"
                                            style="padding: 8px 16px; background: #ef4444; color: white; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer;">
                                            Remove
                                        </button>
                                    ` : `
                                        <span style="font-size: 12px; color: #9ca3af;">Read-only</span>
                                    `}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        `;
    }

    /**
     * Render empty state
     */
    renderEmptyState(container) {
        container.innerHTML = `
            <div style="display: flex; align-items: center; justify-content: center; min-height: 400px;">
                <div style="text-align: center; max-width: 600px; padding: 40px;">
                    <div style="font-size: 80px; margin-bottom: 24px; opacity: 0.3;">🔇</div>
                    
                    <h3 style="font-size: 24px; font-weight: 700; color: #111827; margin-bottom: 12px;">
                        No Filler Words Yet
                    </h3>
                    
                    <p style="font-size: 16px; color: #6b7280; line-height: 1.6; margin-bottom: 32px;">
                        We checked, but there are no filler words configured. Filler words are automatically 
                        inherited from Global AI Brain templates when you activate them.
                    </p>
                    
                    <button 
                        onclick="window.aiCoreFillerFilterManager.switchTab('overview-status')"
                        style="padding: 12px 24px; background: #6366f1; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;">
                        Go to Overview & Status
                    </button>
                </div>
            </div>
        `;
    }

    /**
     * Force scan for filler words
     */
    async forceScan() {
        console.log('🔇 [FILLER FILTER] Force scan triggered');
        this.isScanning = true;
        this.render();
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/company/${this.companyId}/configuration/filler-filter/scan`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            // Reload data
            await this.load();
            
        } catch (error) {
            console.error('❌ [FILLER FILTER] Scan failed:', error);
            alert('Failed to scan for filler words. Please try again.');
        } finally {
            this.isScanning = false;
            this.render();
        }
    }

    /**
     * Add custom filler word
     */
    async addCustomFiller() {
        const word = prompt('Enter a custom filler word to add:');
        if (!word || !word.trim()) return;
        
        const cleanWord = word.trim().toLowerCase();
        
        // Check if already exists
        if (this.inheritedFillers.includes(cleanWord) || this.customFillers.includes(cleanWord)) {
            alert(`"${cleanWord}" already exists in the filler list.`);
            return;
        }
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/company/${this.companyId}/configuration/filler-filter/custom`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ word: cleanWord })
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            // Reload data
            await this.load();
            
        } catch (error) {
            console.error('❌ [FILLER FILTER] Failed to add custom filler:', error);
            alert('Failed to add custom filler. Please try again.');
        }
    }

    /**
     * Remove custom filler word
     */
    async removeCustomFiller(word) {
        if (!confirm(`Remove custom filler "${word}"?`)) return;
        
        try {
            const token = localStorage.getItem('adminToken');
            const response = await fetch(`/api/company/${this.companyId}/configuration/filler-filter/custom/${encodeURIComponent(word)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            // Reload data
            await this.load();
            
        } catch (error) {
            console.error('❌ [FILLER FILTER] Failed to remove custom filler:', error);
            alert('Failed to remove custom filler. Please try again.');
        }
    }

    /**
     * Helper: Get time ago text
     */
    getTimeAgo(date) {
        const seconds = Math.floor((new Date() - date) / 1000);
        
        if (seconds < 60) return 'Just now';
        if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
        if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
        return `${Math.floor(seconds / 86400)}d ago`;
    }

    /**
     * Render error state
     */
    renderError(message) {
        const container = document.getElementById('ai-settings-filler-filter-content');
        if (!container) return;
        
        container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px;">
                <div style="font-size: 64px; margin-bottom: 16px;">⚠️</div>
                <h3 style="font-size: 20px; font-weight: 700; color: #111827; margin-bottom: 8px;">Failed to Load Filler Filter</h3>
                <p style="font-size: 14px; color: #6b7280; margin-bottom: 24px;">${message}</p>
                <button onclick="window.aiCoreFillerFilterManager.load()" style="padding: 12px 24px; background: #6366f1; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;">
                    Try Again
                </button>
            </div>
        `;
    }
}

// Expose globally for onclick handlers
window.AiCoreFillerFilterManager = AiCoreFillerFilterManager;

