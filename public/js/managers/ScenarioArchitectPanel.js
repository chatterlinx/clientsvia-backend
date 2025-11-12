/**
 * ============================================================================
 * SCENARIO ARCHITECT PANEL - PERSISTENT AI CO-PILOT
 * ============================================================================
 * 
 * Purpose: Inline AI assistant for scenario drafting (replaces green modal UX)
 * 
 * Features:
 * - Persistent panel (bottom 1/3 of Edit Scenario modal)
 * - Multi-turn conversation with clarifying questions
 * - Real-time draft generation with 30+ field mapping
 * - Checklist validation summary
 * - No modal closures - conversation persists across applies
 * 
 * Delegates to existing engine:
 * - callScenarioAssistantAPI() for backend communication
 * - applyScenarioAIDraft() for form field mapping
 * - Uses window.aiAssistantState for state management
 * 
 * ============================================================================
 */

class ScenarioArchitectPanel {
    constructor() {
        this._log('Initializing ScenarioArchitectPanel...');
        
        // Reuse existing global state (single source of truth)
        this.state = window.aiAssistantState || {
            description: '',
            conversationLog: [],
            lastDraft: null,
        };
        window.aiAssistantState = this.state;
        
        // DOM element references
        this.panelEl = document.getElementById('scenario-architect-panel');
        this.chatEl = document.getElementById('scenario-architect-chat');
        this.statusEl = document.getElementById('scenario-architect-status');
        this.checklistEl = document.getElementById('scenario-architect-checklist');
        this.inputEl = document.getElementById('scenario-architect-input');
        this.sendBtn = document.getElementById('scenario-architect-send-btn');
        this.applyBtn = document.getElementById('scenario-architect-apply-btn');
        this.toggleBtn = document.getElementById('scenario-architect-toggle');
        
        // Validation
        if (!this.panelEl) {
            console.error('🧠 [SCENARIO ARCHITECT PANEL] ❌ Panel element not found in DOM. Aborting.');
            return;
        }
        
        // Attach event listeners
        this._attachEvents();
        
        // Initialize UI state
        this._resetPanel();
        
        this._log('✅ Initialized successfully');
    }
    
    /**
     * Attach all event listeners
     */
    _attachEvents() {
        this._log('Attaching event listeners...', {
            sendBtn: !!this.sendBtn,
            applyBtn: !!this.applyBtn,
            toggleBtn: !!this.toggleBtn,
            inputEl: !!this.inputEl
        });
        
        if (this.sendBtn) {
            this.sendBtn.addEventListener('click', () => {
                this._log('🎯 Send button clicked!');
                this.handleSend();
            });
            this._log('✅ Send button listener attached');
        } else {
            this._log('❌ Send button not found - cannot attach listener');
        }
        
        if (this.applyBtn) {
            this.applyBtn.addEventListener('click', () => {
                this._log('🎯 Apply button clicked!');
                this.handleApplyDraft();
            });
            this._log('✅ Apply button listener attached');
        }
        
        if (this.toggleBtn) {
            this.toggleBtn.addEventListener('click', () => this.togglePanel());
            this._log('✅ Toggle button listener attached');
        }
        
        // Allow Enter key to send (Shift+Enter for newlines)
        if (this.inputEl) {
            this.inputEl.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    this.handleSend();
                }
            });
            this._log('✅ Input keydown listener attached');
        }
    }
    
    /**
     * Reset panel to initial state
     */
    _resetPanel() {
        if (this.chatEl) this.chatEl.innerHTML = '';
        if (this.statusEl) this.statusEl.textContent = '';
        if (this.checklistEl) this.checklistEl.innerHTML = '';
        if (this.inputEl) this.inputEl.value = '';
        if (this.applyBtn) this.applyBtn.style.display = 'none';
        if (this.sendBtn) this.sendBtn.textContent = '✨ Generate Draft';
    }
    
    /**
     * Handle send button click (Generate Draft / Continue)
     */
    async handleSend() {
        this._log('🚀 handleSend() called');
        
        const text = (this.inputEl?.value || '').trim();
        this._log('Input text:', { text, hasDescription: !!this.state.description });
        
        // First message must exist
        if (!text && !this.state.description) {
            this._setStatus('Please describe what this scenario should handle.', 'error');
            this._log('⚠️ No text provided');
            return;
        }
        
        // Capture description or append answer to conversation
        if (!this.state.description) {
            this.state.description = text;
            this._log('Description captured', { length: text.length });
        } else if (text) {
            this.state.conversationLog.push({ role: 'user', content: text });
            this._log('User answer added to conversation', { turn: this.state.conversationLog.length });
        }
        
        // Clear input
        if (this.inputEl) this.inputEl.value = '';
        
        // Show loading state
        this._setStatus('🤔 Thinking...', 'info');
        if (this.sendBtn) {
            this.sendBtn.disabled = true;
            this.sendBtn.textContent = '⏳ Processing...';
        }
        
        try {
            // Delegate to engine (panel mode)
            await window.generateScenarioAIDraftPanelMode(this);
        } catch (err) {
            this._log('❌ Error during draft generation', err);
            this._setStatus(`Error: ${err.message || 'Unknown error'}`, 'error');
        } finally {
            if (this.sendBtn) {
                this.sendBtn.disabled = false;
            }
        }
    }
    
    /**
     * Handle Apply Draft button click
     */
    handleApplyDraft() {
        if (!window.aiAssistantDraft) {
            this._setStatus('No draft available to apply yet.', 'error');
            return;
        }
        
        this._log('Applying draft to form...');
        
        // Delegate to existing 30+ field mapper
        window.applyScenarioAIDraft();
        
        // Update status (don't close panel - this is the key UX improvement)
        this._setStatus('✅ Draft applied to form. You can keep refining or edit manually above.', 'success');
        
        // Keep apply button visible in case user wants to re-apply after refinement
        // But update button text
        if (this.sendBtn) {
            this.sendBtn.textContent = '🔄 Refine Draft';
        }
    }
    
    /**
     * Render conversation chat history
     */
    renderChat() {
        if (!this.chatEl) return;
        
        if (this.state.conversationLog.length === 0) {
            this.chatEl.innerHTML = '<div style="color: #6c757d; font-style: italic; text-align: center; padding: 20px;">No conversation yet. Describe your scenario below to start.</div>';
            return;
        }
        
        const html = this.state.conversationLog.map(msg => {
            const label = msg.role === 'assistant' ? '🤖 AI' : '👤 You';
            const bgColor = msg.role === 'assistant' ? '#e8f4f8' : '#f0f0f0';
            const textColor = msg.role === 'assistant' ? '#0c4a6e' : '#374151';
            
            return `
                <div style="margin-bottom: 12px; padding: 10px 14px; border-radius: 8px; background: ${bgColor}; color: ${textColor}; font-size: 14px; line-height: 1.5;">
                    <strong style="font-weight: 700;">${label}:</strong> ${this._escapeHtml(msg.content)}
                </div>
            `;
        }).join('');
        
        this.chatEl.innerHTML = html;
        this.chatEl.scrollTop = this.chatEl.scrollHeight;
    }
    
    /**
     * Render AI validation checklist summary
     */
    renderChecklist(checklistSummary) {
        if (!this.checklistEl || !checklistSummary) {
            if (this.checklistEl) this.checklistEl.innerHTML = '';
            return;
        }
        
        const coverage = checklistSummary.coverageScore 
            ? Math.round(checklistSummary.coverageScore * 100) 
            : 90;
        
        let html = `
            <div style="padding: 14px; background: #ecfdf5; border-left: 4px solid #10b981; border-radius: 8px; font-size: 13px; margin-bottom: 12px;">
                <strong style="color: #047857; font-size: 14px;">✅ AI Checklist (${coverage}% complete):</strong><br/>
        `;
        
        if (checklistSummary.settingsNeedingAttention && checklistSummary.settingsNeedingAttention.length > 0) {
            html += '<ul style="margin: 10px 0 0; padding-left: 20px; color: #047857;">';
            checklistSummary.settingsNeedingAttention.forEach(item => {
                html += `<li style="margin-bottom: 6px;"><strong>${this._escapeHtml(item.field)}:</strong> ${this._escapeHtml(item.reason)}</li>`;
            });
            html += '</ul>';
            html += '<p style="margin: 10px 0 0; color: #666; font-style: italic;">Review these before applying. You can tweak them after applying the draft.</p>';
        } else {
            html += '<p style="margin: 10px 0 0; color: #047857;"><em>✨ All settings look good! Ready to apply.</em></p>';
        }
        
        html += '</div>';
        
        this.checklistEl.innerHTML = html;
    }
    
    /**
     * Set status message with type styling
     */
    _setStatus(text, type = 'info') {
        if (!this.statusEl) return;
        
        const colors = {
            info: { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
            success: { bg: '#d1fae5', border: '#10b981', text: '#047857' },
            error: { bg: '#fee2e2', border: '#f87171', text: '#991b1b' },
        };
        
        const style = colors[type] || colors.info;
        
        this.statusEl.style.background = style.bg;
        this.statusEl.style.borderLeft = `4px solid ${style.border}`;
        this.statusEl.style.color = style.text;
        this.statusEl.style.padding = '12px';
        this.statusEl.style.borderRadius = '8px';
        this.statusEl.style.marginBottom = '12px';
        this.statusEl.style.fontSize = '13px';
        this.statusEl.style.display = 'block';
        this.statusEl.textContent = text;
    }
    
    /**
     * Toggle panel visibility (collapse/expand)
     */
    togglePanel() {
        if (!this.panelEl) return;
        
        const isCollapsed = this.panelEl.dataset.collapsed === 'true';
        
        if (isCollapsed) {
            this.panelEl.dataset.collapsed = 'false';
            this.panelEl.style.flex = '1 0 250px';
            if (this.toggleBtn) this.toggleBtn.textContent = 'Hide';
            this._log('Panel expanded');
        } else {
            this.panelEl.dataset.collapsed = 'true';
            this.panelEl.style.flex = '0 0 auto';
            if (this.toggleBtn) this.toggleBtn.textContent = 'Show AI Architect';
            this._log('Panel collapsed');
        }
    }
    
    /**
     * Focus panel input (called from "Ask AI to Draft" button)
     */
    focus() {
        if (!this.panelEl || !this.inputEl) return;
        
        // Expand if collapsed
        if (this.panelEl.dataset.collapsed === 'true') {
            this.togglePanel();
        }
        
        // Scroll panel into view
        this.panelEl.scrollIntoView({ behavior: 'smooth', block: 'end' });
        
        // Focus input
        this.inputEl.focus();
        
        this._log('Panel focused');
    }
    
    /**
     * Escape HTML for safe rendering
     */
    _escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Show scenario suggestions (called when panel first opens)
     */
    showSuggestions(suggestions, context = {}) {
        if (!Array.isArray(suggestions) || suggestions.length === 0) {
            this._log('⚠️ No suggestions to show');
            return;
        }
        
        this._log('💡 Showing suggestions', { count: suggestions.length, context });
        
        // Build suggestions HTML
        const categoryName = context.categoryName || 'this category';
        const templateName = context.templateName || 'current template';
        
        let html = `
            <div style="padding: 16px; background: #f0f9ff; border: 2px solid #0ea5e9; border-radius: 10px; margin-bottom: 16px;">
                <div style="font-weight: 600; color: #0c4a6e; margin-bottom: 12px; font-size: 15px;">
                    💡 Scenario Suggestions for "${categoryName}"
                </div>
                <div style="color: #475569; font-size: 13px; margin-bottom: 16px;">
                    Click any suggestion to generate, or type your own below:
                </div>
                <div style="display: grid; gap: 8px;">
        `;
        
        suggestions.forEach((suggestion, index) => {
            const safeId = `suggestion-${index}`;
            html += `
                <button 
                    id="${safeId}"
                    onclick="window.scenarioArchitectPanel.selectSuggestion('${this._escapeHtml(suggestion)}')"
                    style="
                        text-align: left; 
                        padding: 12px 16px; 
                        background: white; 
                        border: 2px solid #e0e7ff; 
                        border-radius: 8px; 
                        cursor: pointer; 
                        transition: all 0.2s;
                        font-size: 14px;
                        color: #1e293b;
                        font-weight: 500;
                    "
                    onmouseover="this.style.background='#eff6ff'; this.style.borderColor='#3b82f6';"
                    onmouseout="this.style.background='white'; this.style.borderColor='#e0e7ff';"
                >
                    ${index + 1}. ${this._escapeHtml(suggestion)}
                </button>
            `;
        });
        
        html += `
                </div>
            </div>
        `;
        
        // Display in chat area
        if (this.chatEl) {
            this.chatEl.innerHTML = html;
        }
        
        // Update status
        this._setStatus(`💡 ${suggestions.length} suggestions ready! Click one to generate, or type your own scenario below.`, 'info');
    }
    
    /**
     * Handle suggestion selection
     */
    selectSuggestion(suggestionText) {
        this._log('✅ Suggestion selected', { text: suggestionText });
        
        // Set as description
        this.state.description = suggestionText;
        
        // Update input to show what was selected
        if (this.inputEl) {
            this.inputEl.value = suggestionText;
        }
        
        // Clear suggestions display
        if (this.chatEl) {
            this.chatEl.innerHTML = `
                <div style="padding: 12px; background: #ecfdf5; border-left: 4px solid #10b981; border-radius: 8px; margin-bottom: 12px;">
                    <strong style="color: #047857;">✅ Selected:</strong> ${this._escapeHtml(suggestionText)}
                </div>
            `;
        }
        
        // Update status
        this._setStatus('🤔 Analyzing your scenario...', 'info');
        
        // Automatically trigger generation
        setTimeout(() => {
            this.handleSend();
        }, 500);
    }
    
    /**
     * Console logging with namespace
     */
    _log(msg, data) {
        if (data) {
            console.log('🧠 [SCENARIO ARCHITECT PANEL]', msg, data);
        } else {
            console.log('🧠 [SCENARIO ARCHITECT PANEL]', msg);
        }
    }
}

// Export for use in HTML
if (typeof window !== 'undefined') {
    window.ScenarioArchitectPanel = ScenarioArchitectPanel;
}

