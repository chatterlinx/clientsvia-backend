/**
 * ============================================================================
 * QUICK ANSWERS MANAGER - Frontend UI for Common Question Responses
 * ============================================================================
 * 
 * FRESH IMPLEMENTATION - NO LEGACY CONNECTION
 * 
 * Part of Mission Control - allows admins to configure instant responses
 * to common caller questions like hours, pricing, service area, etc.
 * 
 * ============================================================================
 */

class QuickAnswersManager {
    constructor(companyId) {
        this.companyId = companyId;
        this.answers = [];
        this.isDirty = false;
        console.log('[QUICK ANSWERS] Manager initialized');
    }

    // ════════════════════════════════════════════════════════════════════════
    // API METHODS
    // ════════════════════════════════════════════════════════════════════════

    getToken() {
        return localStorage.getItem('adminToken') || 
               localStorage.getItem('token') || 
               sessionStorage.getItem('token');
    }

    async load() {
        try {
            console.log('[QUICK ANSWERS] Loading for company:', this.companyId);
            const token = this.getToken();
            
            const response = await fetch(`/api/admin/quick-answers/${this.companyId}`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) {
                if (response.status === 401) {
                    console.warn('[QUICK ANSWERS] Auth failed - using empty list');
                    this.answers = [];
                    return this.answers;
                }
                throw new Error(`Failed to load: ${response.status}`);
            }
            
            const result = await response.json();
            this.answers = result.data || [];
            console.log('[QUICK ANSWERS] Loaded:', this.answers.length, 'answers');
            
            return this.answers;
        } catch (error) {
            console.error('[QUICK ANSWERS] Load error:', error);
            this.answers = [];
            return this.answers;
        }
    }

    async add(questionData) {
        try {
            const token = this.getToken();
            const response = await fetch(`/api/admin/quick-answers/${this.companyId}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(questionData)
            });
            
            if (!response.ok) throw new Error('Failed to add');
            
            const result = await response.json();
            this.answers.push(result.data);
            this.showNotification('✅ Quick answer added!', 'success');
            return result.data;
        } catch (error) {
            console.error('[QUICK ANSWERS] Add error:', error);
            this.showNotification('❌ Failed to add: ' + error.message, 'error');
            throw error;
        }
    }

    async update(answerId, updates) {
        try {
            const token = this.getToken();
            const response = await fetch(`/api/admin/quick-answers/${this.companyId}/${answerId}`, {
                method: 'PUT',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(updates)
            });
            
            if (!response.ok) throw new Error('Failed to update');
            
            // Update local copy
            const idx = this.answers.findIndex(a => a.id === answerId);
            if (idx !== -1) {
                this.answers[idx] = { ...this.answers[idx], ...updates };
            }
            
            this.showNotification('✅ Updated!', 'success');
            return true;
        } catch (error) {
            console.error('[QUICK ANSWERS] Update error:', error);
            this.showNotification('❌ Failed to update', 'error');
            throw error;
        }
    }

    async delete(answerId) {
        try {
            const token = this.getToken();
            const response = await fetch(`/api/admin/quick-answers/${this.companyId}/${answerId}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${token}` }
            });
            
            if (!response.ok) throw new Error('Failed to delete');
            
            this.answers = this.answers.filter(a => a.id !== answerId);
            this.showNotification('✅ Deleted!', 'success');
            return true;
        } catch (error) {
            console.error('[QUICK ANSWERS] Delete error:', error);
            this.showNotification('❌ Failed to delete', 'error');
            throw error;
        }
    }

    async seed() {
        try {
            const token = this.getToken();
            const response = await fetch(`/api/admin/quick-answers/${this.companyId}/seed`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ overwrite: this.answers.length === 0 })
            });
            
            if (!response.ok) {
                const result = await response.json();
                throw new Error(result.message || 'Failed to seed');
            }
            
            const result = await response.json();
            this.answers = result.data;
            this.showNotification(`✅ Added ${result.data.length} default answers!`, 'success');
            return result.data;
        } catch (error) {
            console.error('[QUICK ANSWERS] Seed error:', error);
            this.showNotification('❌ ' + error.message, 'error');
            throw error;
        }
    }

    async testMatch(phrase) {
        try {
            const token = this.getToken();
            const response = await fetch(`/api/admin/quick-answers/${this.companyId}/match`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ phrase })
            });
            
            if (!response.ok) throw new Error('Failed to test');
            
            return await response.json();
        } catch (error) {
            console.error('[QUICK ANSWERS] Test error:', error);
            throw error;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // RENDER METHODS
    // ════════════════════════════════════════════════════════════════════════

    render(container) {
        const categoryIcons = {
            hours: '🕐',
            pricing: '💰',
            service_area: '📍',
            services: '🔧',
            policies: '📋',
            general: '💬'
        };

        const html = `
            <div class="quick-answers-panel" style="padding: 16px;">
                
                <!-- Header -->
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                    <div>
                        <h3 style="margin: 0; color: #58a6ff; font-size: 1.1rem; display: flex; align-items: center; gap: 8px;">
                            ❓ Quick Answers
                            <span style="font-size: 0.75rem; padding: 2px 8px; background: #238636; color: white; border-radius: 10px;">
                                ${this.answers.length}
                            </span>
                        </h3>
                        <p style="margin: 4px 0 0 0; color: #8b949e; font-size: 0.8rem;">
                            Instant responses to common caller questions
                        </p>
                    </div>
                    <div style="display: flex; gap: 8px;">
                        ${this.answers.length === 0 ? `
                            <button onclick="window.quickAnswersManager.seedAndRerender()" 
                                style="padding: 8px 16px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;">
                                🌱 Add Defaults
                            </button>
                        ` : ''}
                        <button onclick="window.quickAnswersManager.showAddModal()" 
                            style="padding: 8px 16px; background: #58a6ff; color: white; border: none; border-radius: 6px; cursor: pointer; font-size: 0.85rem;">
                            + Add Answer
                        </button>
                    </div>
                </div>

                <!-- Test Box -->
                <div style="background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 12px; margin-bottom: 16px;">
                    <div style="display: flex; gap: 8px;">
                        <input type="text" id="qa-test-input" 
                            placeholder="Test a phrase... e.g. 'what are your hours?'"
                            style="flex: 1; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; font-size: 0.9rem;">
                        <button onclick="window.quickAnswersManager.runTest()" 
                            style="padding: 10px 20px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer;">
                            🧪 Test
                        </button>
                    </div>
                    <div id="qa-test-result" style="margin-top: 10px; display: none;"></div>
                </div>

                <!-- Answers List -->
                <div id="qa-list" style="display: flex; flex-direction: column; gap: 12px;">
                    ${this.answers.length === 0 ? `
                        <div style="text-align: center; padding: 40px; color: #8b949e;">
                            <div style="font-size: 3rem; margin-bottom: 12px;">❓</div>
                            <div style="font-size: 1rem; margin-bottom: 8px;">No Quick Answers configured</div>
                            <div style="font-size: 0.85rem;">Click "Add Defaults" to start with common questions</div>
                        </div>
                    ` : this.answers.map(qa => `
                        <div class="qa-item" data-id="${qa.id}" style="
                            background: #161b22; 
                            border: 1px solid ${qa.enabled ? '#30363d' : '#6e7681'}; 
                            border-radius: 8px; 
                            padding: 14px;
                            opacity: ${qa.enabled ? '1' : '0.6'};
                        ">
                            <div style="display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 8px;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span style="font-size: 1.2rem;">${categoryIcons[qa.category] || '💬'}</span>
                                    <span style="color: #c9d1d9; font-weight: 600;">${this.escapeHtml(qa.question)}</span>
                                </div>
                                <div style="display: flex; gap: 6px;">
                                    <button onclick="window.quickAnswersManager.toggleEnabled('${qa.id}', ${!qa.enabled})" 
                                        title="${qa.enabled ? 'Disable' : 'Enable'}"
                                        style="background: none; border: none; cursor: pointer; font-size: 1rem;">
                                        ${qa.enabled ? '✅' : '⏸️'}
                                    </button>
                                    <button onclick="window.quickAnswersManager.showEditModal('${qa.id}')" 
                                        title="Edit"
                                        style="background: none; border: none; cursor: pointer; font-size: 1rem;">
                                        ✏️
                                    </button>
                                    <button onclick="window.quickAnswersManager.confirmDelete('${qa.id}')" 
                                        title="Delete"
                                        style="background: none; border: none; cursor: pointer; font-size: 1rem;">
                                        🗑️
                                    </button>
                                </div>
                            </div>
                            <div style="color: #8b949e; font-size: 0.9rem; margin-bottom: 8px; padding-left: 28px;">
                                "${this.escapeHtml(qa.answer)}"
                            </div>
                            <div style="display: flex; flex-wrap: wrap; gap: 4px; padding-left: 28px;">
                                ${(qa.triggers || []).slice(0, 5).map(t => `
                                    <span style="font-size: 0.75rem; padding: 2px 8px; background: #21262d; border-radius: 10px; color: #8b949e;">
                                        ${this.escapeHtml(t)}
                                    </span>
                                `).join('')}
                                ${(qa.triggers || []).length > 5 ? `
                                    <span style="font-size: 0.75rem; padding: 2px 8px; background: #21262d; border-radius: 10px; color: #58a6ff;">
                                        +${qa.triggers.length - 5} more
                                    </span>
                                ` : ''}
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        container.innerHTML = html;
        window.quickAnswersManager = this;
    }

    async runTest() {
        const input = document.getElementById('qa-test-input');
        const resultDiv = document.getElementById('qa-test-result');
        
        if (!input.value.trim()) {
            this.showNotification('Enter a phrase to test', 'warning');
            return;
        }

        resultDiv.style.display = 'block';
        resultDiv.innerHTML = '<span style="color: #8b949e;">Testing...</span>';

        try {
            const result = await this.testMatch(input.value);
            
            if (result.data.matched) {
                const match = result.data.bestMatch;
                resultDiv.innerHTML = `
                    <div style="padding: 12px; background: #0d1117; border-radius: 6px; border-left: 3px solid #238636;">
                        <div style="color: #3fb950; font-weight: 600; margin-bottom: 8px;">✅ Match Found!</div>
                        <div style="color: #8b949e; font-size: 0.85rem; margin-bottom: 4px;">
                            Matched: <strong style="color: #c9d1d9;">${this.escapeHtml(match.question)}</strong>
                        </div>
                        <div style="color: #58a6ff; font-size: 0.9rem;">
                            AI would say: "${this.escapeHtml(match.answer)}"
                        </div>
                        <div style="margin-top: 8px;">
                            <span style="font-size: 0.75rem; color: #8b949e;">Matched triggers: </span>
                            ${match.matchedTriggers.map(t => `
                                <span style="font-size: 0.75rem; padding: 2px 6px; background: #238636; color: white; border-radius: 4px; margin-left: 4px;">
                                    ${this.escapeHtml(t)}
                                </span>
                            `).join('')}
                        </div>
                    </div>
                `;
            } else {
                resultDiv.innerHTML = `
                    <div style="padding: 12px; background: #0d1117; border-radius: 6px; border-left: 3px solid #f0883e;">
                        <div style="color: #f0883e; font-weight: 600; margin-bottom: 8px;">⚠️ No Match</div>
                        <div style="color: #8b949e; font-size: 0.85rem;">
                            ${result.data.suggestion}
                        </div>
                        <button onclick="window.quickAnswersManager.showAddModal('${this.escapeHtml(input.value)}')" 
                            style="margin-top: 10px; padding: 6px 12px; background: #58a6ff; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 0.85rem;">
                            + Add Answer for This Question
                        </button>
                    </div>
                `;
            }
        } catch (error) {
            resultDiv.innerHTML = `<span style="color: #f85149;">Error: ${error.message}</span>`;
        }
    }

    showAddModal(prefillQuestion = '') {
        const modal = document.createElement('div');
        modal.id = 'qa-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center;
            z-index: 10000;
        `;
        
        modal.innerHTML = `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 24px; width: 500px; max-width: 90%;">
                <h3 style="margin: 0 0 20px 0; color: #58a6ff;">➕ Add Quick Answer</h3>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Question</label>
                    <input type="text" id="qa-modal-question" value="${this.escapeHtml(prefillQuestion)}"
                        placeholder="What are your hours?"
                        style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                </div>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Answer</label>
                    <textarea id="qa-modal-answer" rows="3"
                        placeholder="We're open Monday through Friday, 8 AM to 5 PM..."
                        style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;"></textarea>
                </div>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                        Trigger Phrases <span style="color: #8b949e; font-weight: normal;">(comma-separated)</span>
                    </label>
                    <input type="text" id="qa-modal-triggers"
                        placeholder="hours, what time, when open"
                        style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Category</label>
                    <select id="qa-modal-category" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        <option value="hours">🕐 Hours</option>
                        <option value="pricing">💰 Pricing</option>
                        <option value="service_area">📍 Service Area</option>
                        <option value="services">🔧 Services</option>
                        <option value="policies">📋 Policies</option>
                        <option value="general" selected>💬 General</option>
                    </select>
                </div>
                
                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button onclick="document.getElementById('qa-modal').remove()"
                        style="padding: 10px 20px; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; cursor: pointer;">
                        Cancel
                    </button>
                    <button onclick="window.quickAnswersManager.submitAdd()"
                        style="padding: 10px 20px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        Add Answer
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
        document.getElementById('qa-modal-question').focus();
    }

    async submitAdd() {
        const question = document.getElementById('qa-modal-question').value.trim();
        const answer = document.getElementById('qa-modal-answer').value.trim();
        const triggersRaw = document.getElementById('qa-modal-triggers').value;
        const category = document.getElementById('qa-modal-category').value;
        
        if (!question || !answer) {
            this.showNotification('Question and answer are required', 'warning');
            return;
        }
        
        const triggers = triggersRaw.split(',').map(t => t.trim()).filter(t => t);
        
        try {
            await this.add({ question, answer, triggers, category });
            document.getElementById('qa-modal').remove();
            this.rerender();
        } catch (e) {
            // Error already shown
        }
    }

    showEditModal(answerId) {
        const qa = this.answers.find(a => a.id === answerId);
        if (!qa) return;
        
        const modal = document.createElement('div');
        modal.id = 'qa-modal';
        modal.style.cssText = `
            position: fixed; top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center;
            z-index: 10000;
        `;
        
        modal.innerHTML = `
            <div style="background: #161b22; border: 1px solid #30363d; border-radius: 12px; padding: 24px; width: 500px; max-width: 90%;">
                <h3 style="margin: 0 0 20px 0; color: #58a6ff;">✏️ Edit Quick Answer</h3>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Question</label>
                    <input type="text" id="qa-modal-question" value="${this.escapeHtml(qa.question)}"
                        style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                </div>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Answer</label>
                    <textarea id="qa-modal-answer" rows="3"
                        style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9; resize: vertical;">${this.escapeHtml(qa.answer)}</textarea>
                </div>
                
                <div style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">
                        Trigger Phrases <span style="color: #8b949e; font-weight: normal;">(comma-separated)</span>
                    </label>
                    <input type="text" id="qa-modal-triggers" value="${(qa.triggers || []).join(', ')}"
                        style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                </div>
                
                <div style="margin-bottom: 20px;">
                    <label style="display: block; margin-bottom: 6px; color: #c9d1d9; font-weight: 500;">Category</label>
                    <select id="qa-modal-category" style="width: 100%; padding: 10px; background: #0d1117; border: 1px solid #30363d; border-radius: 6px; color: #c9d1d9;">
                        <option value="hours" ${qa.category === 'hours' ? 'selected' : ''}>🕐 Hours</option>
                        <option value="pricing" ${qa.category === 'pricing' ? 'selected' : ''}>💰 Pricing</option>
                        <option value="service_area" ${qa.category === 'service_area' ? 'selected' : ''}>📍 Service Area</option>
                        <option value="services" ${qa.category === 'services' ? 'selected' : ''}>🔧 Services</option>
                        <option value="policies" ${qa.category === 'policies' ? 'selected' : ''}>📋 Policies</option>
                        <option value="general" ${qa.category === 'general' ? 'selected' : ''}>💬 General</option>
                    </select>
                </div>
                
                <div style="display: flex; justify-content: flex-end; gap: 10px;">
                    <button onclick="document.getElementById('qa-modal').remove()"
                        style="padding: 10px 20px; background: #21262d; color: #c9d1d9; border: 1px solid #30363d; border-radius: 6px; cursor: pointer;">
                        Cancel
                    </button>
                    <button onclick="window.quickAnswersManager.submitEdit('${answerId}')"
                        style="padding: 10px 20px; background: #238636; color: white; border: none; border-radius: 6px; cursor: pointer; font-weight: 600;">
                        Save Changes
                    </button>
                </div>
            </div>
        `;
        
        document.body.appendChild(modal);
    }

    async submitEdit(answerId) {
        const question = document.getElementById('qa-modal-question').value.trim();
        const answer = document.getElementById('qa-modal-answer').value.trim();
        const triggersRaw = document.getElementById('qa-modal-triggers').value;
        const category = document.getElementById('qa-modal-category').value;
        
        if (!question || !answer) {
            this.showNotification('Question and answer are required', 'warning');
            return;
        }
        
        const triggers = triggersRaw.split(',').map(t => t.trim()).filter(t => t);
        
        try {
            await this.update(answerId, { question, answer, triggers, category });
            document.getElementById('qa-modal').remove();
            this.rerender();
        } catch (e) {
            // Error already shown
        }
    }

    async toggleEnabled(answerId, enabled) {
        try {
            await this.update(answerId, { enabled });
            this.rerender();
        } catch (e) {
            // Error already shown
        }
    }

    async confirmDelete(answerId) {
        const qa = this.answers.find(a => a.id === answerId);
        if (!qa) return;
        
        if (!confirm(`Delete quick answer "${qa.question}"?`)) return;
        
        try {
            await this.delete(answerId);
            this.rerender();
        } catch (e) {
            // Error already shown
        }
    }

    async seedAndRerender() {
        try {
            await this.seed();
            this.rerender();
        } catch (e) {
            // Error already shown
        }
    }

    rerender() {
        const container = document.querySelector('.quick-answers-panel')?.parentElement;
        if (container) {
            this.render(container);
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text || '';
        return div.innerHTML;
    }

    showNotification(message, type = 'info') {
        const colors = { success: '#238636', error: '#f85149', warning: '#f0883e', info: '#58a6ff' };
        
        const notification = document.createElement('div');
        notification.style.cssText = `
            position: fixed; top: 20px; right: 20px; padding: 12px 20px;
            background: ${colors[type]}; color: white; border-radius: 8px;
            font-weight: 500; z-index: 10001; box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        `;
        notification.textContent = message;
        document.body.appendChild(notification);
        
        setTimeout(() => notification.remove(), 3000);
    }
}

// Export globally
window.QuickAnswersManager = QuickAnswersManager;
console.log('[QUICK ANSWERS] ✅ Manager loaded globally');

