/**
 * ============================================================================
 * AICORE KNOWLEDGEBASE MANAGER
 * ============================================================================
 * 
 * PURPOSE: Real-time AI performance monitoring & action item dashboard
 * 
 * WHAT IT DOES:
 * - Monitors EVERY call 24/7 (never stops scanning)
 * - Detects when AI is confused (low confidence, fallback, no match)
 * - Groups similar questions together
 * - Prioritizes by urgency (High/Medium/Low)
 * - Shows admin clear action items to fix issues
 * - Links directly to Templates/Variables/Scenarios to resolve
 * 
 * ARCHITECTURE:
 * - Reads from existing v2AIAgentCallLog (no new collections)
 * - Calculates urgency based on frequency + confidence
 * - Updates in real-time
 * - Simple mark-as-resolved workflow
 * 
 * INTEGRATES WITH:
 * - AiCore Templates (to create new scenarios)
 * - Variables (to update missing data)
 * - AiCore Live Scenarios (to test fixes)
 * 
 * ============================================================================
 */

class AiCoreKnowledgebaseManager {
    constructor(parentManager) {
        this.parentManager = parentManager;
        this.companyId = parentManager.companyId;
        this.container = document.getElementById('aicore-knowledgebase-container');
        
        this.actionItems = [];
        this.isLoading = false;
        this.autoRefreshInterval = null;
        
        console.log('🧠 [KNOWLEDGEBASE] Initialized');
    }
    
    /**
     * Load action items from call logs
     */
    async load() {
        console.log('🧠 [KNOWLEDGEBASE] Loading action items...');
        
        this.isLoading = true;
        this.renderLoading();
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/knowledgebase/action-items`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const data = await response.json();
            this.actionItems = data.actionItems || [];
            
            console.log(`✅ [KNOWLEDGEBASE] Loaded ${this.actionItems.length} action items`);
            
            this.render();
            this.startAutoRefresh();
            
        } catch (error) {
            console.error('❌ [KNOWLEDGEBASE] Load failed:', error);
            this.renderError('Failed to load knowledgebase. Please refresh.');
        } finally {
            this.isLoading = false;
        }
    }
    
    /**
     * Render the main dashboard
     */
    render() {
        const highPriority = this.actionItems.filter(item => item.urgency === 'high');
        const mediumPriority = this.actionItems.filter(item => item.urgency === 'medium');
        const lowPriority = this.actionItems.filter(item => item.urgency === 'low');
        
        const totalCalls = this.actionItems.reduce((sum, item) => sum + item.count, 0);
        const totalIssues = this.actionItems.length;
        
        this.container.innerHTML = `
            <!-- HERO HEADER -->
            <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 32px; border-radius: 12px; margin-bottom: 24px; color: white;">
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div>
                        <h2 style="font-size: 28px; font-weight: 700; margin: 0 0 8px 0;">
                            🧠 AI Performance Monitor
                        </h2>
                        <p style="font-size: 16px; opacity: 0.95; margin: 0;">
                            Real-time monitoring & action items for continuous improvement
                        </p>
                    </div>
                    <button onclick="aiCoreKnowledgebaseManager.refresh()" 
                            style="background: rgba(255,255,255,0.2); border: 2px solid rgba(255,255,255,0.4); color: white; padding: 12px 24px; border-radius: 8px; font-weight: 600; cursor: pointer; transition: all 0.2s;"
                            onmouseover="this.style.background='rgba(255,255,255,0.3)'"
                            onmouseout="this.style.background='rgba(255,255,255,0.2)'">
                        <i class="fas fa-sync-alt mr-2"></i>Refresh
                    </button>
                </div>
            </div>
            
            <!-- STATUS CARDS -->
            <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 16px; margin-bottom: 32px;">
                <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px; text-align: center;">
                    <div style="font-size: 36px; font-weight: 700; color: ${totalCalls > 0 ? '#10b981' : '#6b7280'};">
                        ${totalCalls}
                    </div>
                    <div style="font-size: 14px; color: #6b7280; margin-top: 4px;">
                        Calls Analyzed
                    </div>
                </div>
                
                <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px; text-align: center;">
                    <div style="font-size: 36px; font-weight: 700; color: ${totalIssues > 0 ? '#ef4444' : '#10b981'};">
                        ${totalIssues}
                    </div>
                    <div style="font-size: 14px; color: #6b7280; margin-top: 4px;">
                        Action Items
                    </div>
                </div>
                
                <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px; text-align: center;">
                    <div style="font-size: 36px; font-weight: 700; color: ${highPriority.length > 0 ? '#f59e0b' : '#10b981'};">
                        ${highPriority.length}
                    </div>
                    <div style="font-size: 14px; color: #6b7280; margin-top: 4px;">
                        High Priority
                    </div>
                </div>
                
                <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px; text-align: center;">
                    <div style="font-size: 36px; font-weight: 700; color: #10b981;">
                        <i class="fas fa-circle-check"></i>
                    </div>
                    <div style="font-size: 14px; color: #6b7280; margin-top: 4px;">
                        Live Monitoring
                    </div>
                </div>
            </div>
            
            ${this.actionItems.length === 0 ? this.renderEmptyState() : `
                <!-- ACTION ITEMS LIST -->
                <div style="background: white; border: 2px solid #e5e7eb; border-radius: 12px; padding: 24px;">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
                        <h3 style="font-size: 20px; font-weight: 700; color: #1f2937; margin: 0;">
                            📋 Action Items for Admin
                        </h3>
                        <select onchange="aiCoreKnowledgebaseManager.sortItems(this.value)" 
                                style="padding: 8px 12px; border: 2px solid #e5e7eb; border-radius: 8px; font-size: 14px; cursor: pointer;">
                            <option value="urgency">Sort by: Urgency</option>
                            <option value="count">Sort by: Frequency</option>
                            <option value="recent">Sort by: Recent</option>
                        </select>
                    </div>
                    
                    ${highPriority.length > 0 ? `
                        <div style="margin-bottom: 24px;">
                            <h4 style="font-size: 16px; font-weight: 600; color: #ef4444; margin: 0 0 12px 0;">
                                🔥 HIGH PRIORITY (${highPriority.length})
                            </h4>
                            ${highPriority.map((item, idx) => this.renderActionItem(item, idx, 'high')).join('')}
                        </div>
                    ` : ''}
                    
                    ${mediumPriority.length > 0 ? `
                        <div style="margin-bottom: 24px;">
                            <h4 style="font-size: 16px; font-weight: 600; color: #f59e0b; margin: 0 0 12px 0;">
                                ⚠️ MEDIUM PRIORITY (${mediumPriority.length})
                            </h4>
                            ${mediumPriority.map((item, idx) => this.renderActionItem(item, idx, 'medium')).join('')}
                        </div>
                    ` : ''}
                    
                    ${lowPriority.length > 0 ? `
                        <div>
                            <h4 style="font-size: 16px; font-weight: 600; color: #10b981; margin: 0 0 12px 0;">
                                🟢 LOW PRIORITY (${lowPriority.length})
                            </h4>
                            ${lowPriority.map((item, idx) => this.renderActionItem(item, idx, 'low')).join('')}
                        </div>
                    ` : ''}
                </div>
            `}
        `;
    }
    
    /**
     * Render single action item card
     */
    renderActionItem(item, index, urgency) {
        const urgencyColors = {
            high: { bg: '#fef2f2', border: '#ef4444', text: '#991b1b' },
            medium: { bg: '#fffbeb', border: '#f59e0b', text: '#92400e' },
            low: { bg: '#f0fdf4', border: '#10b981', text: '#065f46' }
        };
        
        const colors = urgencyColors[urgency];
        
        return `
            <div style="background: ${colors.bg}; border: 2px solid ${colors.border}; border-radius: 12px; padding: 20px; margin-bottom: 12px;">
                <!-- Header -->
                <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 12px;">
                    <div style="flex: 1;">
                        <div style="font-size: 18px; font-weight: 600; color: #1f2937; margin-bottom: 8px;">
                            ⚠️ AI Confused by: "${this.escapeHtml(item.question)}"
                        </div>
                        <div style="display: flex; gap: 16px; font-size: 14px; color: #6b7280;">
                            <span><strong>Frequency:</strong> ${item.count} times</span>
                            <span><strong>Avg Confidence:</strong> ${(item.avgConfidence * 100).toFixed(0)}%</span>
                            <span><strong>Last Seen:</strong> ${this.formatTimestamp(item.lastOccurrence)}</span>
                        </div>
                    </div>
                    <div style="background: ${colors.text}; color: white; padding: 6px 12px; border-radius: 6px; font-size: 12px; font-weight: 600; text-transform: uppercase;">
                        ${urgency}
                    </div>
                </div>
                
                <!-- Variations Detected -->
                ${item.variations && item.variations.length > 0 ? `
                    <div style="margin-bottom: 12px; padding: 12px; background: white; border-radius: 8px;">
                        <div style="font-size: 14px; font-weight: 600; color: #1f2937; margin-bottom: 8px;">
                            📝 Similar Questions Detected:
                        </div>
                        <div style="display: flex; flex-wrap: wrap; gap: 8px;">
                            ${item.variations.slice(0, 5).map(v => `
                                <span style="background: #f3f4f6; padding: 6px 12px; border-radius: 6px; font-size: 13px; color: #374151;">
                                    "${this.escapeHtml(v.question)}" (${v.count}×)
                                </span>
                            `).join('')}
                            ${item.variations.length > 5 ? `<span style="color: #6b7280; font-size: 13px;">+${item.variations.length - 5} more</span>` : ''}
                        </div>
                    </div>
                ` : ''}
                
                <!-- Recommendation -->
                <div style="margin-bottom: 12px; padding: 12px; background: white; border-radius: 8px;">
                    <div style="font-size: 14px; font-weight: 600; color: #1f2937; margin-bottom: 8px;">
                        💡 Recommended Action:
                    </div>
                    <div style="font-size: 14px; color: #374151;">
                        ${this.getRecommendation(item)}
                    </div>
                </div>
                
                <!-- Recent Call Examples -->
                ${item.recentCalls && item.recentCalls.length > 0 ? `
                    <div style="margin-bottom: 16px; padding: 12px; background: white; border-radius: 8px;">
                        <div style="font-size: 14px; font-weight: 600; color: #1f2937; margin-bottom: 8px;">
                            🎧 Recent Call Examples:
                        </div>
                        ${item.recentCalls.slice(0, 2).map(call => `
                            <div style="padding: 8px; background: #f9fafb; border-left: 3px solid #6366f1; margin-bottom: 8px; border-radius: 4px;">
                                <div style="font-size: 13px; color: #6b7280; margin-bottom: 4px;">
                                    ${this.formatTimestamp(call.timestamp)} • Confidence: ${(call.confidence * 100).toFixed(0)}%
                                </div>
                                <div style="font-size: 14px; color: #1f2937;">
                                    "${this.escapeHtml(call.question)}"
                                </div>
                                ${call.aiResponse ? `
                                    <div style="font-size: 13px; color: #6b7280; margin-top: 4px; font-style: italic;">
                                        AI: ${this.escapeHtml(call.aiResponse.substring(0, 100))}${call.aiResponse.length > 100 ? '...' : ''}
                                    </div>
                                ` : ''}
                            </div>
                        `).join('')}
                    </div>
                ` : ''}
                
                <!-- Action Buttons -->
                <div style="display: flex; gap: 12px;">
                    <button onclick="aiCoreKnowledgebaseManager.goToTemplates('${item._id}')"
                            style="flex: 1; background: linear-gradient(to right, #667eea, #764ba2); color: white; padding: 12px 20px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: opacity 0.2s;"
                            onmouseover="this.style.opacity='0.9'"
                            onmouseout="this.style.opacity='1'">
                        <i class="fas fa-brain mr-2"></i>Create Scenario in Templates
                    </button>
                    <button onclick="aiCoreKnowledgebaseManager.markResolved('${item._id}')"
                            style="flex: 1; background: #10b981; color: white; padding: 12px 20px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: opacity 0.2s;"
                            onmouseover="this.style.opacity='0.9'"
                            onmouseout="this.style.opacity='1'">
                        <i class="fas fa-check-circle mr-2"></i>Mark as Resolved
                    </button>
                    <button onclick="aiCoreKnowledgebaseManager.ignoreIssue('${item._id}')"
                            style="background: #6b7280; color: white; padding: 12px 20px; border: none; border-radius: 8px; font-weight: 600; cursor: pointer; transition: opacity 0.2s;"
                            onmouseover="this.style.opacity='0.9'"
                            onmouseout="this.style.opacity='1'">
                        <i class="fas fa-times mr-2"></i>Ignore
                    </button>
                </div>
            </div>
        `;
    }
    
    /**
     * Render empty state
     */
    renderEmptyState() {
        return `
            <div style="text-align: center; padding: 60px 20px; background: white; border: 2px solid #e5e7eb; border-radius: 12px;">
                <div style="font-size: 72px; margin-bottom: 16px;">🎉</div>
                <h3 style="font-size: 24px; font-weight: 700; color: #1f2937; margin: 0 0 8px 0;">
                    All Clear! AI is Performing Perfectly!
                </h3>
                <p style="font-size: 16px; color: #6b7280; margin: 0 0 16px 0;">
                    No knowledge gaps detected. Your AI is answering all questions with high confidence.
                </p>
                <div style="background: #f0fdf4; border: 2px solid #10b981; border-radius: 8px; padding: 16px; display: inline-block; margin-top: 16px;">
                    <div style="font-size: 14px; color: #065f46; font-weight: 600;">
                        ✅ Monitoring is active 24/7
                    </div>
                    <div style="font-size: 13px; color: #047857; margin-top: 4px;">
                        Any issues will appear here automatically
                    </div>
                </div>
            </div>
        `;
    }
    
    /**
     * Render loading state
     */
    renderLoading() {
        this.container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px;">
                <i class="fas fa-spinner fa-spin" style="font-size: 48px; color: #6366f1; margin-bottom: 16px;"></i>
                <div style="font-size: 18px; color: #6b7280;">Analyzing call logs...</div>
            </div>
        `;
    }
    
    /**
     * Render error state
     */
    renderError(message) {
        this.container.innerHTML = `
            <div style="text-align: center; padding: 60px 20px; background: #fef2f2; border: 2px solid #ef4444; border-radius: 12px;">
                <i class="fas fa-exclamation-triangle" style="font-size: 48px; color: #ef4444; margin-bottom: 16px;"></i>
                <div style="font-size: 18px; color: #991b1b; font-weight: 600;">${message}</div>
            </div>
        `;
    }
    
    /**
     * Get recommendation based on issue type
     */
    getRecommendation(item) {
        if (item.avgConfidence < 0.4) {
            return `Create a new scenario in <strong>AiCore Templates</strong> to handle this specific question. AI confidence is very low (${(item.avgConfidence * 100).toFixed(0)}%).`;
        } else if (item.count >= 10) {
            return `This question is asked frequently (${item.count} times). Add a dedicated scenario to improve response quality.`;
        } else if (item.usedFallback) {
            return `AI is using fallback response, which means it couldn't find any matching scenario. Create a new template.`;
        } else {
            return `Review similar variations and create a scenario that covers all these question patterns.`;
        }
    }
    
    /**
     * Navigate to Templates tab
     */
    goToTemplates(itemId) {
        console.log(`🚀 [KNOWLEDGEBASE] Navigate to Templates for item: ${itemId}`);
        
        // Switch to AiCore Templates tab
        this.parentManager.switchSubTab('aicore-templates');
        
        // TODO: Pass context about what scenario to create
        // For now, just switch tabs
    }
    
    /**
     * Mark issue as resolved
     */
    async markResolved(itemId) {
        console.log(`✅ [KNOWLEDGEBASE] Marking ${itemId} as resolved`);
        
        try {
            const response = await fetch(`/api/company/${this.companyId}/knowledgebase/action-items/${itemId}/resolve`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('adminToken')}`,
                    'Content-Type': 'application/json'
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to mark as resolved');
            }
            
            // Remove from UI
            this.actionItems = this.actionItems.filter(item => item._id !== itemId);
            this.render();
            
            this.showToast('✅ Issue marked as resolved!', 'success');
            
        } catch (error) {
            console.error('❌ [KNOWLEDGEBASE] Mark resolved failed:', error);
            this.showToast('Failed to mark as resolved', 'error');
        }
    }
    
    /**
     * Ignore issue (hide it)
     */
    async ignoreIssue(itemId) {
        console.log(`❌ [KNOWLEDGEBASE] Ignoring ${itemId}`);
        
        // Just remove from UI (don't persist)
        this.actionItems = this.actionItems.filter(item => item._id !== itemId);
        this.render();
        
        this.showToast('Issue hidden from list', 'info');
    }
    
    /**
     * Refresh data
     */
    async refresh() {
        console.log('🔄 [KNOWLEDGEBASE] Refreshing...');
        await this.load();
        this.showToast('Data refreshed!', 'success');
    }
    
    /**
     * Sort items
     */
    sortItems(sortBy) {
        console.log(`🔄 [KNOWLEDGEBASE] Sorting by: ${sortBy}`);
        
        switch (sortBy) {
            case 'urgency':
                // Already sorted by urgency in render()
                break;
            case 'count':
                this.actionItems.sort((a, b) => b.count - a.count);
                break;
            case 'recent':
                this.actionItems.sort((a, b) => new Date(b.lastOccurrence) - new Date(a.lastOccurrence));
                break;
        }
        
        this.render();
    }
    
    /**
     * Start auto-refresh (every 60 seconds)
     */
    startAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
        }
        
        this.autoRefreshInterval = setInterval(() => {
            console.log('🔄 [KNOWLEDGEBASE] Auto-refresh...');
            this.load();
        }, 60000); // 1 minute
        
        console.log('🔄 [KNOWLEDGEBASE] Auto-refresh enabled (60s)');
    }
    
    /**
     * Stop auto-refresh
     */
    stopAutoRefresh() {
        if (this.autoRefreshInterval) {
            clearInterval(this.autoRefreshInterval);
            this.autoRefreshInterval = null;
            console.log('🛑 [KNOWLEDGEBASE] Auto-refresh stopped');
        }
    }
    
    /**
     * Format timestamp
     */
    formatTimestamp(timestamp) {
        const date = new Date(timestamp);
        const now = new Date();
        const diff = now - date;
        
        // Less than 1 hour ago
        if (diff < 3600000) {
            const minutes = Math.floor(diff / 60000);
            return `${minutes} min${minutes !== 1 ? 's' : ''} ago`;
        }
        
        // Less than 24 hours ago
        if (diff < 86400000) {
            const hours = Math.floor(diff / 3600000);
            return `${hours} hour${hours !== 1 ? 's' : ''} ago`;
        }
        
        // Otherwise, show date
        return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
    }
    
    /**
     * Escape HTML
     */
    escapeHtml(text) {
        if (!text) return '';
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }
    
    /**
     * Show toast notification
     */
    showToast(message, type = 'info') {
        const colors = {
            success: '#10b981',
            error: '#ef4444',
            info: '#6366f1'
        };
        
        const toast = document.createElement('div');
        toast.style.cssText = `
            position: fixed;
            bottom: 24px;
            right: 24px;
            background: ${colors[type]};
            color: white;
            padding: 16px 24px;
            border-radius: 8px;
            font-weight: 600;
            z-index: 10000;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
            animation: slideIn 0.3s ease-out;
        `;
        toast.textContent = message;
        
        document.body.appendChild(toast);
        
        setTimeout(() => {
            toast.style.animation = 'slideOut 0.3s ease-in';
            setTimeout(() => toast.remove(), 300);
        }, 3000);
    }
}

