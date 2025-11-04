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
            this.templatesUsed = data.templatesUsed || [];
            
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
     * Render template cards (NEW - matches Live Scenarios architecture)
     */
    renderScanReport() {
        if (!this.templatesUsed || this.templatesUsed.length === 0) {
            return `
                <div style="background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
                    <h3 style="font-size: 16px; font-weight: 700; color: #92400e; margin-bottom: 8px; display: flex; align-items: center; gap: 8px;">
                        📘 Active Templates
                    </h3>
                    <p style="font-size: 14px; color: #78350f; margin: 0;">
                        <strong>No templates activated.</strong> Activate a template in the <strong>AiCore Templates</strong> tab to inherit filler words.
                    </p>
                </div>
            `;
        }
        
        return `
            <div style="margin-bottom: 32px;">
                <h3 style="font-size: 18px; font-weight: 600; color: #111827; margin-bottom: 16px;">
                    📘 Active Templates (${this.templatesUsed.length})
                </h3>
                <div style="display: grid; gap: 16px;">
                    ${this.templatesUsed.map(template => `
                        <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px; transition: all 0.2s;"
                             onmouseover="this.style.borderColor='#6366f1'; this.style.boxShadow='0 4px 12px rgba(99, 102, 241, 0.1)'"
                             onmouseout="this.style.borderColor='#e5e7eb'; this.style.boxShadow='none'">
                            
                            <!-- Template Header -->
                            <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                                <div>
                                    <h4 style="font-size: 16px; font-weight: 600; color: #111827; margin: 0 0 4px 0;">
                                        📘 ${this.escapeHtml(template.templateName)}
                                    </h4>
                                    <div style="font-size: 12px; color: #6b7280;">
                                        <code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px; font-family: monospace;">
                                            ID: ${this.escapeHtml(template.templateId)}
                                        </code>
                                        <span style="margin: 0 8px; color: #d1d5db;">•</span>
                                        <span style="font-weight: 500;">Version: ${this.escapeHtml(template.version || 'v1.0.0')}</span>
                                    </div>
                                </div>
                            </div>
                            
                            <!-- Template Stats -->
                            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 16px;">
                                <div style="text-align: center; padding: 12px; background: #fef3c7; border-radius: 8px;">
                                    <div style="font-size: 24px; font-weight: 700; color: #92400e;">
                                        ${template.categoriesCount || 0}
                                    </div>
                                    <div style="font-size: 12px; color: #78350f; margin-top: 4px;">
                                        Categories
                                    </div>
                                </div>
                                
                                <div style="text-align: center; padding: 12px; background: #dbeafe; border-radius: 8px;">
                                    <div style="font-size: 24px; font-weight: 700; color: #1e40af;">
                                        ${template.scenariosCount || 0}
                                    </div>
                                    <div style="font-size: 12px; color: #1e3a8a; margin-top: 4px;">
                                        Scenarios
                                    </div>
                                </div>
                                
                                <div style="text-align: center; padding: 12px; background: #dcfce7; border-radius: 8px;">
                                    <div style="font-size: 24px; font-weight: 700; color: #15803d;">
                                        ${template.fillersCount || 0}
                                    </div>
                                    <div style="font-size: 12px; color: #166534; margin-top: 4px;">
                                        Filler Words
                                    </div>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }
    
    /**
     * Escape HTML for safe rendering
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * TAB 2: Filler Words Table
     */
    renderFillerTable(container) {
        // Combine and sort all fillers
        const allFillers = [
            ...this.inheritedFillers.map(f => ({ word: f, type: 'inherited' })),
            ...this.customFillers.map(f => ({ word: f, type: 'custom' }))
        ].sort((a, b) => a.word.localeCompare(b.word));
        
        // Always show the header with "+ Add Custom Filler" button
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
                    style="padding: 12px 24px; background: #10b981; color: white; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.1); transition: all 0.2s;"
                    onmouseover="this.style.background='#059669'"
                    onmouseout="this.style.background='#10b981'">
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
                        ${allFillers.length === 0 ? `
                            <tr>
                                <td colspan="4" style="padding: 60px 20px; text-align: center;">
                                    <div style="font-size: 48px; margin-bottom: 16px;">🔇</div>
                                    <h3 style="font-size: 20px; font-weight: 700; color: #111827; margin: 0 0 8px 0;">No Filler Words Yet</h3>
                                    <p style="font-size: 14px; color: #6b7280; margin: 0 0 24px 0; max-width: 500px; margin-left: auto; margin-right: auto;">
                                        Filler words are automatically inherited from Global AI Brain templates when you activate them. You can also add custom company-specific filler words using the "+ Add Custom Filler" button above.
                                    </p>
                                    <div style="display: flex; gap: 12px; justify-content: center; align-items: center; font-size: 13px; color: #9ca3af;">
                                        <span>💡 Tip: Go to "AiCore Templates" → Activate a template → Return here and run "Force Scan"</span>
                                    </div>
                                </td>
                            </tr>
                        ` : allFillers.map((filler, index) => `
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
                                            style="padding: 8px 16px; background: #ef4444; color: white; border: none; border-radius: 6px; font-size: 12px; font-weight: 600; cursor: pointer; transition: all 0.2s;"
                                            onmouseover="this.style.background='#dc2626'"
                                            onmouseout="this.style.background='#ef4444'">
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
     * Force scan for filler words with real-time modal logging
     */
    async forceScan() {
        console.log('🔇 [FILLER FILTER] Force scan triggered');
        
        // Show modal
        this.showScanModal();
        
        try {
            this.updateScanModal('Starting scan...', 10);
            
            const token = localStorage.getItem('adminToken');
            this.updateScanModal('Connecting to server...', 20);
            
            const response = await fetch(`/api/company/${this.companyId}/configuration/filler-filter/scan`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });
            
            this.updateScanModal('Processing response...', 60);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const result = await response.json();
            
            this.updateScanModal('Scan complete!', 100);
            
            // Show detailed scan results
            this.showScanResults(result);
            
            // Reload data to reflect changes
            setTimeout(() => {
                this.load();
            }, 2000);
            
        } catch (error) {
            console.error('❌ [FILLER FILTER] Scan failed:', error);
            this.showScanError(error.message);
        }
    }

    /**
     * Show scan modal
     */
    showScanModal() {
        const modalHTML = `
            <div id="filler-scan-modal" style="position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; background: rgba(0,0,0,0.7); display: flex; align-items: center; justify-content: center; z-index: 10000;">
                <div style="background: white; border-radius: 16px; padding: 32px; max-width: 600px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
                    <div style="text-align: center;">
                        <div style="font-size: 48px; margin-bottom: 16px;">⚡</div>
                        <h3 style="font-size: 24px; font-weight: 700; margin: 0 0 24px 0; color: #1e293b;">Force Scan In Progress</h3>
                        
                        <div id="scan-progress-container" style="margin-bottom: 24px;">
                            <div style="background: #e2e8f0; border-radius: 8px; height: 12px; overflow: hidden;">
                                <div id="scan-progress-bar" style="background: linear-gradient(90deg, #6366f1, #8b5cf6); height: 100%; width: 0%; transition: width 0.3s ease;"></div>
                            </div>
                            <p id="scan-status-text" style="margin: 12px 0 0 0; color: #64748b; font-size: 14px;">Initializing...</p>
                        </div>
                        
                        <div id="scan-log-container" style="display: none; background: #f8fafc; border-radius: 8px; padding: 16px; max-height: 300px; overflow-y: auto; text-align: left; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.6; color: #334155;">
                            <!-- Log lines appear here -->
                        </div>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    /**
     * Update scan modal progress
     */
    updateScanModal(message, progress) {
        const progressBar = document.getElementById('scan-progress-bar');
        const statusText = document.getElementById('scan-status-text');
        
        if (progressBar) {
            progressBar.style.width = `${progress}%`;
        }
        
        if (statusText) {
            statusText.textContent = message;
        }
    }

    /**
     * Show scan results in modal
     */
    showScanResults(result) {
        const logContainer = document.getElementById('scan-log-container');
        const statusText = document.getElementById('scan-status-text');
        const progressContainer = document.getElementById('scan-progress-container');
        
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        
        if (logContainer && result.scanLog) {
            logContainer.style.display = 'block';
            logContainer.innerHTML = result.scanLog.map(line => {
                return `<div style="margin-bottom: 4px;">${this.escapeHtml(line)}</div>`;
            }).join('');
        }
        
        // Add close button
        const modal = document.getElementById('filler-scan-modal');
        if (modal) {
            const closeButtonHTML = `
                <div style="text-align: center; margin-top: 24px;">
                    <button onclick="document.getElementById('filler-scan-modal').remove()" style="padding: 12px 32px; background: #6366f1; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
                        Close
                    </button>
                </div>
            `;
            modal.querySelector('div > div').insertAdjacentHTML('beforeend', closeButtonHTML);
        }
        
        // Auto-close after 10 seconds
        setTimeout(() => {
            const modalElement = document.getElementById('filler-scan-modal');
            if (modalElement) {
                modalElement.remove();
            }
        }, 10000);
    }

    /**
     * Show scan error in modal
     */
    showScanError(errorMessage) {
        const logContainer = document.getElementById('scan-log-container');
        const progressContainer = document.getElementById('scan-progress-container');
        
        if (progressContainer) {
            progressContainer.style.display = 'none';
        }
        
        if (logContainer) {
            logContainer.style.display = 'block';
            logContainer.innerHTML = `
                <div style="color: #dc2626; font-weight: 600;">❌ Scan Failed</div>
                <div style="margin-top: 8px;">${this.escapeHtml(errorMessage)}</div>
            `;
        }
        
        // Add close button
        const modal = document.getElementById('filler-scan-modal');
        if (modal) {
            const closeButtonHTML = `
                <div style="text-align: center; margin-top: 24px;">
                    <button onclick="document.getElementById('filler-scan-modal').remove()" style="padding: 12px 32px; background: #dc2626; color: white; border: none; border-radius: 8px; font-size: 16px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
                        Close
                    </button>
                </div>
            `;
            modal.querySelector('div > div').insertAdjacentHTML('beforeend', closeButtonHTML);
        }
    }

    /**
     * Escape HTML for safe display
     */
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    /**
     * Add custom filler word
     */
    async addCustomFiller() {
        console.log('🔇 [FILLER FILTER] ADD CUSTOM - Step 1: Function called');
        
        const word = prompt('Enter a custom filler word to add:');
        console.log('🔇 [FILLER FILTER] ADD CUSTOM - Step 2: User entered:', word);
        
        if (!word || !word.trim()) {
            console.log('⚠️ [FILLER FILTER] ADD CUSTOM - Cancelled or empty input');
            return;
        }
        
        const cleanWord = word.trim().toLowerCase();
        console.log('🔇 [FILLER FILTER] ADD CUSTOM - Step 3: Clean word:', cleanWord);
        
        // Check if already exists
        if (this.inheritedFillers.includes(cleanWord) || this.customFillers.includes(cleanWord)) {
            console.log('⚠️ [FILLER FILTER] ADD CUSTOM - Word already exists');
            alert(`"${cleanWord}" already exists in the filler list.`);
            return;
        }
        
        try {
            console.log('🔇 [FILLER FILTER] ADD CUSTOM - Step 4: Sending to API...');
            const token = localStorage.getItem('adminToken');
            console.log('🔇 [FILLER FILTER] ADD CUSTOM - Step 5: Token exists?', !!token);
            
            const url = `/api/company/${this.companyId}/configuration/filler-filter/custom`;
            console.log('🔇 [FILLER FILTER] ADD CUSTOM - Step 6: URL:', url);
            
            const response = await fetch(url, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ word: cleanWord })
            });
            
            console.log('🔇 [FILLER FILTER] ADD CUSTOM - Step 7: Response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('❌ [FILLER FILTER] ADD CUSTOM - Error response:', errorText);
                throw new Error(`HTTP ${response.status}: ${errorText}`);
            }
            
            const result = await response.json();
            console.log('✅ [FILLER FILTER] ADD CUSTOM - Step 8: Success!', result);
            
            // Reload data
            console.log('🔇 [FILLER FILTER] ADD CUSTOM - Step 9: Reloading data...');
            await this.load();
            console.log('✅ [FILLER FILTER] ADD CUSTOM - Step 10: Complete!');
            
        } catch (error) {
            console.error('❌ [FILLER FILTER] ADD CUSTOM - Fatal error:', error);
            console.error('❌ [FILLER FILTER] ADD CUSTOM - Error stack:', error.stack);
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

