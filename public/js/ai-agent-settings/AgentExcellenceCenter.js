/**
 * AgentExcellenceCenter.js
 * 
 * PURPOSE: Full-screen dashboard for AI Agent Excellence metrics
 * - Overall score with transparent formula
 * - Category breakdown with real metrics
 * - Revenue per call tracking
 * - LLM-generated improvement suggestions (with one-click apply)
 * - Weekly learning report
 * 
 * PHILOSOPHY: 
 * - Never auto-apply - all changes require human approval
 * - Transparent scoring - formula visible on hover
 * - Revenue-focused - show the money impact
 * 
 * @module AgentExcellenceCenter
 */

class AgentExcellenceCenter {
  constructor(companyId) {
    this.companyId = companyId;
    this.score = null;
    this.suggestions = null;
    this.history = [];
    this.isLoading = false;
  }

  /**
   * Open the excellence center modal
   */
  async open() {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.id = 'excellence-center-modal';
    modal.innerHTML = this.renderModal();
    document.body.appendChild(modal);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Load data
    await this.loadData();
  }

  /**
   * Close the modal
   */
  close() {
    const modal = document.getElementById('excellence-center-modal');
    if (modal) {
      modal.remove();
    }
    document.body.style.overflow = '';
  }

  /**
   * Load all data
   */
  async loadData() {
    this.isLoading = true;
    this.renderContent();

    try {
      const token = localStorage.getItem('adminToken');
      
      const [scoreRes, historyRes, suggestionsRes] = await Promise.all([
        fetch(`/api/admin/agent-excellence/${this.companyId}/score`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/admin/agent-excellence/${this.companyId}/history?days=30`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`/api/admin/agent-excellence/${this.companyId}/suggestions`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      if (scoreRes.ok) {
        const data = await scoreRes.json();
        this.score = data.score;
        this.formula = data.formula;
      }

      if (historyRes.ok) {
        const data = await historyRes.json();
        this.history = data.history || [];
      }

      if (suggestionsRes.ok) {
        const data = await suggestionsRes.json();
        this.suggestions = data.suggestions || [];
        this.weeklySummary = data.weeklySummary;
        this.learnings = data.learnings || [];
      }

    } catch (error) {
      console.error('[EXCELLENCE] Failed to load data:', error);
    }

    this.isLoading = false;
    this.renderContent();
  }

  /**
   * Render the modal shell
   */
  renderModal() {
    return `
      <div class="exc-overlay" onclick="window.agentExcellenceCenter.close()">
        <div class="exc-modal" onclick="event.stopPropagation()">
          <!-- Header -->
          <div class="exc-header">
            <div class="exc-header-left">
              <h1>🧠 AI Agent Excellence Center</h1>
              <span class="exc-subtitle">Performance Intelligence & Continuous Improvement</span>
            </div>
            <div class="exc-header-right">
              <button class="exc-btn exc-btn-secondary" onclick="window.agentExcellenceCenter.refreshSuggestions()">
                🔄 Refresh Analysis
              </button>
              <button class="exc-btn exc-btn-close" onclick="window.agentExcellenceCenter.close()">
                ✕
              </button>
            </div>
          </div>

          <!-- Content Area -->
          <div class="exc-content" id="exc-content">
            <div class="exc-loading">
              <div class="exc-spinner"></div>
              <p>Loading excellence data...</p>
            </div>
          </div>
        </div>
      </div>

      <style>
        .exc-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.85);
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .exc-modal {
          background: #0f172a;
          border-radius: 16px;
          width: 100%;
          max-width: 1400px;
          height: 90vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
        }

        .exc-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 24px 30px;
          background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%);
          color: white;
        }

        .exc-header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 700;
        }

        .exc-subtitle {
          opacity: 0.8;
          font-size: 14px;
        }

        .exc-header-right {
          display: flex;
          gap: 10px;
        }

        .exc-btn {
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }

        .exc-btn-primary {
          background: #22c55e;
          color: white;
        }

        .exc-btn-secondary {
          background: rgba(255, 255, 255, 0.15);
          color: white;
          border: 1px solid rgba(255, 255, 255, 0.3);
        }

        .exc-btn-secondary:hover {
          background: rgba(255, 255, 255, 0.25);
        }

        .exc-btn-close {
          background: transparent;
          color: white;
          font-size: 20px;
          width: 40px;
          height: 40px;
          padding: 0;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .exc-content {
          flex: 1;
          overflow-y: auto;
          padding: 30px;
        }

        .exc-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: white;
        }

        .exc-spinner {
          width: 50px;
          height: 50px;
          border: 4px solid #1e293b;
          border-top-color: #7c3aed;
          border-radius: 50%;
          animation: exc-spin 1s linear infinite;
          margin-bottom: 20px;
        }

        @keyframes exc-spin {
          to { transform: rotate(360deg); }
        }

        /* Score Display */
        .exc-score-hero {
          display: flex;
          gap: 30px;
          margin-bottom: 30px;
        }

        .exc-score-main {
          flex: 0 0 300px;
          background: linear-gradient(135deg, #1e3a8a 0%, #7c3aed 100%);
          border-radius: 20px;
          padding: 40px;
          text-align: center;
          color: white;
        }

        .exc-score-label {
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 1px;
          opacity: 0.8;
          margin-bottom: 10px;
        }

        .exc-score-value {
          font-size: 80px;
          font-weight: 800;
          line-height: 1;
          margin-bottom: 10px;
        }

        .exc-score-trend {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 6px 12px;
          background: rgba(255, 255, 255, 0.2);
          border-radius: 20px;
          font-size: 14px;
        }

        .exc-score-trend.up { color: #4ade80; }
        .exc-score-trend.down { color: #f87171; }
        .exc-score-trend.stable { color: #fbbf24; }

        .exc-revenue-card {
          flex: 1;
          background: #1e293b;
          border-radius: 16px;
          padding: 30px;
        }

        .exc-revenue-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .exc-revenue-title {
          color: #94a3b8;
          font-size: 14px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .exc-revenue-value {
          font-size: 48px;
          font-weight: 700;
          color: #22c55e;
        }

        .exc-revenue-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 20px;
        }

        .exc-metric-card {
          background: #0f172a;
          border-radius: 12px;
          padding: 20px;
          text-align: center;
        }

        .exc-metric-value {
          font-size: 28px;
          font-weight: 700;
          color: white;
        }

        .exc-metric-label {
          font-size: 12px;
          color: #64748b;
          margin-top: 5px;
        }

        /* Categories Grid */
        .exc-categories {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
          margin-bottom: 30px;
        }

        .exc-category-card {
          background: #1e293b;
          border-radius: 12px;
          padding: 20px;
          position: relative;
          overflow: hidden;
        }

        .exc-category-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 15px;
        }

        .exc-category-name {
          color: white;
          font-size: 16px;
          font-weight: 600;
        }

        .exc-category-score {
          font-size: 24px;
          font-weight: 700;
        }

        .exc-category-score.excellent { color: #22c55e; }
        .exc-category-score.good { color: #3b82f6; }
        .exc-category-score.needs-work { color: #f59e0b; }
        .exc-category-score.critical { color: #ef4444; }

        .exc-category-bar {
          height: 6px;
          background: #0f172a;
          border-radius: 3px;
          overflow: hidden;
          margin-bottom: 12px;
        }

        .exc-category-progress {
          height: 100%;
          border-radius: 3px;
          transition: width 0.5s ease;
        }

        .exc-category-details {
          color: #94a3b8;
          font-size: 13px;
        }

        .exc-category-weight {
          position: absolute;
          top: 10px;
          right: 10px;
          font-size: 11px;
          color: #64748b;
          background: #0f172a;
          padding: 3px 8px;
          border-radius: 4px;
        }

        /* Suggestions Section */
        .exc-section {
          margin-bottom: 30px;
        }

        .exc-section-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .exc-section-title {
          color: white;
          font-size: 20px;
          font-weight: 700;
        }

        .exc-suggestion-card {
          background: #1e293b;
          border-radius: 12px;
          padding: 20px;
          margin-bottom: 15px;
          display: flex;
          gap: 20px;
        }

        .exc-suggestion-rank {
          flex: 0 0 50px;
          height: 50px;
          background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%);
          border-radius: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 20px;
          font-weight: 700;
          color: white;
        }

        .exc-suggestion-rank.high { background: linear-gradient(135deg, #dc2626 0%, #f87171 100%); }
        .exc-suggestion-rank.medium { background: linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%); }
        .exc-suggestion-rank.low { background: linear-gradient(135deg, #22c55e 0%, #4ade80 100%); }

        .exc-suggestion-content {
          flex: 1;
        }

        .exc-suggestion-title {
          color: white;
          font-size: 16px;
          font-weight: 600;
          margin-bottom: 8px;
        }

        .exc-suggestion-description {
          color: #94a3b8;
          font-size: 14px;
          margin-bottom: 12px;
        }

        .exc-suggestion-impact {
          display: inline-block;
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
          padding: 4px 12px;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 600;
        }

        .exc-suggestion-actions {
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 10px;
        }

        .exc-btn-apply {
          background: #7c3aed;
          color: white;
          padding: 10px 20px;
          border-radius: 8px;
          border: none;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
        }

        .exc-btn-apply:hover {
          background: #6d28d9;
        }

        .exc-btn-skip {
          background: transparent;
          color: #64748b;
          padding: 8px 16px;
          border-radius: 8px;
          border: 1px solid #334155;
          font-size: 13px;
          cursor: pointer;
        }

        /* Formula Tooltip */
        .exc-formula-trigger {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          color: #64748b;
          font-size: 12px;
          cursor: help;
          padding: 4px 8px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 4px;
        }

        .exc-formula-tooltip {
          display: none;
          position: absolute;
          top: 100%;
          left: 0;
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 8px;
          padding: 15px;
          width: 400px;
          z-index: 1000;
          color: #94a3b8;
          font-size: 13px;
          line-height: 1.6;
        }

        .exc-formula-trigger:hover .exc-formula-tooltip {
          display: block;
        }

        /* Weekly Summary */
        .exc-summary-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 20px;
        }

        .exc-summary-card {
          background: #1e293b;
          border-radius: 12px;
          padding: 20px;
        }

        .exc-summary-card h4 {
          color: white;
          font-size: 14px;
          margin: 0 0 15px 0;
        }

        .exc-summary-card ul {
          margin: 0;
          padding: 0 0 0 20px;
          color: #94a3b8;
          font-size: 13px;
        }

        .exc-summary-card li {
          margin-bottom: 8px;
        }

        .exc-summary-card.highlights h4 { color: #22c55e; }
        .exc-summary-card.concerns h4 { color: #f59e0b; }
        .exc-summary-card.recommendations h4 { color: #3b82f6; }
      </style>
    `;
  }

  /**
   * Render content based on loaded data
   */
  renderContent() {
    const content = document.getElementById('exc-content');
    if (!content) return;

    if (this.isLoading) {
      content.innerHTML = `
        <div class="exc-loading">
          <div class="exc-spinner"></div>
          <p>Loading excellence data...</p>
        </div>
      `;
      return;
    }

    if (!this.score) {
      content.innerHTML = `
        <div class="exc-loading">
          <p style="color: #94a3b8;">No score data available. Make some calls first!</p>
        </div>
      `;
      return;
    }

    content.innerHTML = `
      <!-- Score Hero Section -->
      ${this.renderScoreHero()}

      <!-- Categories Grid -->
      ${this.renderCategories()}

      <!-- Improvement Suggestions -->
      ${this.renderSuggestions()}

      <!-- Weekly Summary -->
      ${this.renderWeeklySummary()}
    `;
  }

  /**
   * Render score hero section
   */
  renderScoreHero() {
    const score = this.score;
    const trendClass = score.trend === 'UP' ? 'up' : score.trend === 'DOWN' ? 'down' : 'stable';
    const trendIcon = score.trend === 'UP' ? '↑' : score.trend === 'DOWN' ? '↓' : '→';
    const trendText = score.trend === 'UP' ? `+${score.trendDelta}` : score.trend === 'DOWN' ? score.trendDelta : 'Stable';

    return `
      <div class="exc-score-hero">
        <div class="exc-score-main">
          <div class="exc-score-label">Overall Agent Score</div>
          <div class="exc-score-value">${Math.round(score.overall)}</div>
          <div class="exc-score-trend ${trendClass}">
            ${trendIcon} ${trendText} from last week
          </div>
          <div style="margin-top: 15px; position: relative;">
            <div class="exc-formula-trigger">
              ℹ️ How is this calculated?
              <div class="exc-formula-tooltip">
                <strong>Transparent Scoring Formula:</strong><br><br>
                ${this.formula?.formula || 'Loading...'}
                <br><br>
                <em>${this.formula?.explanation || ''}</em>
              </div>
            </div>
          </div>
        </div>

        <div class="exc-revenue-card">
          <div class="exc-revenue-header">
            <div>
              <div class="exc-revenue-title">Revenue Per Call</div>
              <div class="exc-revenue-value">$${score.revenue?.revenuePerCall || 0}</div>
            </div>
            <div style="text-align: right;">
              <div style="color: #64748b; font-size: 12px;">Estimated Revenue</div>
              <div style="color: white; font-size: 24px; font-weight: 600;">$${(score.revenue?.estimatedRevenue || 0).toLocaleString()}</div>
            </div>
          </div>
          <div class="exc-revenue-grid">
            <div class="exc-metric-card">
              <div class="exc-metric-value">${score.revenue?.totalCalls || 0}</div>
              <div class="exc-metric-label">Calls Handled</div>
            </div>
            <div class="exc-metric-card">
              <div class="exc-metric-value">${score.revenue?.totalBookings || 0}</div>
              <div class="exc-metric-label">Bookings Made</div>
            </div>
            <div class="exc-metric-card">
              <div class="exc-metric-value">${Math.round((score.categories?.bookingFlow?.metrics?.bookingRate || 0) * 100)}%</div>
              <div class="exc-metric-label">Booking Rate</div>
            </div>
            <div class="exc-metric-card">
              <div class="exc-metric-value">${Math.round((score.categories?.callOutcomes?.metrics?.hangupRate || 0) * 100)}%</div>
              <div class="exc-metric-label">Hangup Rate</div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render categories grid
   */
  renderCategories() {
    const categories = [
      { key: 'bookingFlow', name: 'Booking Flow', icon: '📅', weight: '20%' },
      { key: 'triageAccuracy', name: 'Triage Accuracy', icon: '🎯', weight: '20%' },
      { key: 'knowledgeCompleteness', name: 'Knowledge', icon: '📚', weight: '20%' },
      { key: 'customerMemory', name: 'Customer Memory', icon: '🧠', weight: '15%' },
      { key: 'callOutcomes', name: 'Call Outcomes', icon: '📊', weight: '15%' },
      { key: 'frontlineIntelligence', name: 'Frontline Intel', icon: '🤖', weight: '10%' }
    ];

    return `
      <div class="exc-categories">
        ${categories.map(cat => {
          const data = this.score.categories?.[cat.key] || {};
          const score = data.score || 0;
          const scoreClass = score >= 90 ? 'excellent' : score >= 75 ? 'good' : score >= 60 ? 'needs-work' : 'critical';
          const barColor = score >= 90 ? '#22c55e' : score >= 75 ? '#3b82f6' : score >= 60 ? '#f59e0b' : '#ef4444';
          
          return `
            <div class="exc-category-card">
              <div class="exc-category-weight">${cat.weight}</div>
              <div class="exc-category-header">
                <div class="exc-category-name">${cat.icon} ${cat.name}</div>
                <div class="exc-category-score ${scoreClass}">${score}</div>
              </div>
              <div class="exc-category-bar">
                <div class="exc-category-progress" style="width: ${score}%; background: ${barColor};"></div>
              </div>
              <div class="exc-category-details">${data.details || 'No data yet'}</div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  /**
   * Render suggestions section
   */
  renderSuggestions() {
    if (!this.suggestions || this.suggestions.length === 0) {
      return `
        <div class="exc-section">
          <div class="exc-section-header">
            <h3 class="exc-section-title">🎯 Top Improvements</h3>
            <button class="exc-btn exc-btn-secondary" onclick="window.agentExcellenceCenter.refreshSuggestions()">
              Generate Suggestions
            </button>
          </div>
          <div style="background: #1e293b; border-radius: 12px; padding: 40px; text-align: center; color: #64748b;">
            No suggestions available yet. Click "Generate Suggestions" to analyze your agent.
          </div>
        </div>
      `;
    }

    return `
      <div class="exc-section">
        <div class="exc-section-header">
          <h3 class="exc-section-title">🎯 Top ${this.suggestions.length} Improvements</h3>
        </div>
        ${this.suggestions.map((s, idx) => `
          <div class="exc-suggestion-card" id="exc-suggestion-${idx}">
            <div class="exc-suggestion-rank ${s.priority?.toLowerCase()}">#${s.rank || idx + 1}</div>
            <div class="exc-suggestion-content">
              <div class="exc-suggestion-title">${s.title}</div>
              <div class="exc-suggestion-description">${s.description}</div>
              <div class="exc-suggestion-impact">${s.predictedImpact || 'Impact TBD'}</div>
            </div>
            <div class="exc-suggestion-actions">
              ${s.status === 'APPLIED' ? `
                <span style="color: #22c55e; font-weight: 600;">✓ Applied</span>
              ` : `
                <button class="exc-btn-apply" onclick="window.agentExcellenceCenter.applySuggestion(${idx})">
                  Apply
                </button>
                <button class="exc-btn-skip" onclick="window.agentExcellenceCenter.skipSuggestion(${idx})">
                  Skip
                </button>
              `}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  /**
   * Render weekly summary
   */
  renderWeeklySummary() {
    if (!this.weeklySummary) {
      return '';
    }

    return `
      <div class="exc-section">
        <div class="exc-section-header">
          <h3 class="exc-section-title">📊 Weekly Intelligence Report</h3>
        </div>
        
        ${this.weeklySummary.headline ? `
          <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 20px; text-align: center;">
            <div style="font-size: 20px; font-weight: 600; color: white;">"${this.weeklySummary.headline}"</div>
          </div>
        ` : ''}
        
        <div class="exc-summary-grid">
          <div class="exc-summary-card highlights">
            <h4>✅ Highlights</h4>
            <ul>
              ${(this.weeklySummary.highlights || ['No highlights yet']).map(h => `<li>${h}</li>`).join('')}
            </ul>
          </div>
          
          <div class="exc-summary-card concerns">
            <h4>⚠️ Concerns</h4>
            <ul>
              ${(this.weeklySummary.concerns || ['No concerns identified']).map(c => `<li>${c}</li>`).join('')}
            </ul>
          </div>
          
          <div class="exc-summary-card recommendations">
            <h4>💡 Recommendations</h4>
            <ul>
              ${(this.weeklySummary.recommendations || ['Run analysis for recommendations']).map(r => `<li>${r}</li>`).join('')}
            </ul>
          </div>
        </div>
        
        ${this.learnings && this.learnings.length > 0 ? `
          <div style="background: #1e293b; border-radius: 12px; padding: 20px; margin-top: 20px;">
            <h4 style="color: white; margin: 0 0 15px 0;">🧠 What Agent Learned This Week</h4>
            <ul style="margin: 0; padding: 0 0 0 20px; color: #94a3b8;">
              ${this.learnings.map(l => `<li>${l.description} <em style="color: #64748b;">(${l.example})</em></li>`).join('')}
            </ul>
          </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Apply a suggestion
   */
  async applySuggestion(index) {
    const btn = event.target;
    btn.disabled = true;
    btn.innerHTML = '⏳';

    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/agent-excellence/${this.companyId}/apply-suggestion`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ suggestionIndex: index })
      });

      if (response.ok) {
        const card = document.getElementById(`exc-suggestion-${index}`);
        if (card) {
          const actions = card.querySelector('.exc-suggestion-actions');
          if (actions) {
            actions.innerHTML = '<span style="color: #22c55e; font-weight: 600;">✓ Applied</span>';
          }
        }
        this.suggestions[index].status = 'APPLIED';
      } else {
        btn.disabled = false;
        btn.innerHTML = 'Apply';
        alert('Failed to apply suggestion');
      }
    } catch (error) {
      btn.disabled = false;
      btn.innerHTML = 'Apply';
      console.error('[EXCELLENCE] Apply failed:', error);
    }
  }

  /**
   * Skip a suggestion
   */
  skipSuggestion(index) {
    const card = document.getElementById(`exc-suggestion-${index}`);
    if (card) {
      card.style.opacity = '0.5';
      card.querySelector('.exc-suggestion-actions').innerHTML = '<span style="color: #64748b;">Skipped</span>';
    }
  }

  /**
   * Refresh/generate suggestions
   */
  async refreshSuggestions() {
    const btn = event.target;
    btn.disabled = true;
    btn.innerHTML = '⏳ Analyzing...';

    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/agent-excellence/${this.companyId}/generate-suggestions`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        this.suggestions = data.suggestions || [];
        this.weeklySummary = data.weeklySummary;
        this.learnings = data.learnings || [];
        this.renderContent();
      } else {
        alert('Failed to generate suggestions');
      }
    } catch (error) {
      console.error('[EXCELLENCE] Refresh failed:', error);
      alert('Failed to refresh: ' + error.message);
    } finally {
      btn.disabled = false;
      btn.innerHTML = '🔄 Refresh Analysis';
    }
  }
}

// Global instance
window.AgentExcellenceCenter = AgentExcellenceCenter;

