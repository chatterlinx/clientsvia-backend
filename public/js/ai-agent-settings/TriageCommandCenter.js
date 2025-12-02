/**
 * TriageCommandCenter.js
 * 
 * PURPOSE: Full-screen modal for comprehensive triage evaluation
 * - 4 tabs: Overview, Card Analysis, Top 50 Questions, Recommendations
 * - Uses real call data for analysis
 * - One-click apply recommendations
 * - Version history with rollback
 * 
 * @module TriageCommandCenter
 */

class TriageCommandCenter {
  constructor(companyId) {
    this.companyId = companyId;
    this.evaluation = null;
    this.currentTab = 'overview';
    this.isLoading = false;
    this.versions = [];
  }

  /**
   * Open the command center modal
   */
  async open() {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.id = 'triage-command-center-modal';
    modal.innerHTML = this.renderModal();
    document.body.appendChild(modal);

    // Prevent body scroll
    document.body.style.overflow = 'hidden';

    // Bind events
    this.bindEvents();

    // Load quick stats immediately
    await this.loadQuickStats();
  }

  /**
   * Close the modal
   */
  close() {
    const modal = document.getElementById('triage-command-center-modal');
    if (modal) {
      modal.remove();
    }
    document.body.style.overflow = '';
  }

  /**
   * Render the full modal HTML
   */
  renderModal() {
    return `
      <div class="tcc-overlay" onclick="window.triageCommandCenter.close()">
        <div class="tcc-modal" onclick="event.stopPropagation()">
          <!-- Header -->
          <div class="tcc-header">
            <div class="tcc-header-left">
              <h1>🎯 Triage Command Center</h1>
              <span class="tcc-subtitle">Enterprise Evaluation & Optimization</span>
            </div>
            <div class="tcc-header-right">
              <button class="tcc-btn tcc-btn-secondary" onclick="window.triageCommandCenter.showVersionHistory()">
                📜 Version History
              </button>
              <button class="tcc-btn tcc-btn-close" onclick="window.triageCommandCenter.close()">
                ✕
              </button>
            </div>
          </div>

          <!-- Tabs -->
          <div class="tcc-tabs">
            <button class="tcc-tab active" data-tab="overview" onclick="window.triageCommandCenter.switchTab('overview')">
              📊 Overview
            </button>
            <button class="tcc-tab" data-tab="cards" onclick="window.triageCommandCenter.switchTab('cards')">
              🎯 Card Analysis
            </button>
            <button class="tcc-tab" data-tab="questions" onclick="window.triageCommandCenter.switchTab('questions')">
              ❓ Top 50 Questions
            </button>
            <button class="tcc-tab" data-tab="recommendations" onclick="window.triageCommandCenter.switchTab('recommendations')">
              🔧 Recommendations
            </button>
          </div>

          <!-- Business Description Input -->
          <div class="tcc-description-panel">
            <label>📝 Describe your business for better analysis:</label>
            <textarea id="tcc-business-description" placeholder="Example: We are an HVAC company serving Miami-Dade County. We handle AC repair, heating, maintenance, and installations. 24/7 emergency service available. We want to book appointments, answer pricing questions, and only transfer for true emergencies like gas leaks."></textarea>
            <div class="tcc-action-row">
              <button class="tcc-btn tcc-btn-primary" onclick="window.triageCommandCenter.runEvaluation()" id="tcc-run-btn">
                🚀 Run Full Evaluation
              </button>
              <span class="tcc-estimate">Estimated time: ~30 seconds</span>
            </div>
          </div>

          <!-- Content Area -->
          <div class="tcc-content" id="tcc-content">
            <div class="tcc-loading-placeholder">
              <p>Enter your business description and click "Run Full Evaluation" to begin.</p>
              <p style="opacity: 0.6; margin-top: 10px;">The evaluation will analyze your triage cards using real call data from the last 30 days.</p>
            </div>
          </div>
        </div>
      </div>

      <style>
        .tcc-overlay {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          bottom: 0;
          background: rgba(0, 0, 0, 0.8);
          z-index: 10000;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
        }

        .tcc-modal {
          background: #1a1a2e;
          border-radius: 16px;
          width: 100%;
          max-width: 1400px;
          height: 90vh;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          box-shadow: 0 25px 80px rgba(0, 0, 0, 0.5);
        }

        .tcc-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px 30px;
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
          color: white;
        }

        .tcc-header h1 {
          margin: 0;
          font-size: 28px;
          font-weight: 700;
        }

        .tcc-subtitle {
          opacity: 0.8;
          font-size: 14px;
        }

        .tcc-header-right {
          display: flex;
          gap: 10px;
        }

        .tcc-btn {
          padding: 10px 20px;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          border: none;
        }

        .tcc-btn-primary {
          background: #22c55e;
          color: white;
        }

        .tcc-btn-primary:hover {
          background: #16a34a;
        }

        .tcc-btn-primary:disabled {
          background: #4b5563;
          cursor: not-allowed;
        }

        .tcc-btn-secondary {
          background: rgba(255, 255, 255, 0.2);
          color: white;
          border: 1px solid rgba(255, 255, 255, 0.3);
        }

        .tcc-btn-secondary:hover {
          background: rgba(255, 255, 255, 0.3);
        }

        .tcc-btn-close {
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

        .tcc-btn-close:hover {
          background: rgba(255, 255, 255, 0.1);
        }

        .tcc-tabs {
          display: flex;
          background: #16162a;
          border-bottom: 1px solid #2d2d44;
        }

        .tcc-tab {
          flex: 1;
          padding: 15px 20px;
          background: transparent;
          border: none;
          color: #9ca3af;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.2s;
          border-bottom: 3px solid transparent;
        }

        .tcc-tab:hover {
          color: white;
          background: rgba(255, 255, 255, 0.05);
        }

        .tcc-tab.active {
          color: white;
          border-bottom-color: #667eea;
          background: rgba(102, 126, 234, 0.1);
        }

        .tcc-description-panel {
          padding: 20px 30px;
          background: #16162a;
          border-bottom: 1px solid #2d2d44;
        }

        .tcc-description-panel label {
          display: block;
          color: #9ca3af;
          font-size: 14px;
          margin-bottom: 10px;
        }

        .tcc-description-panel textarea {
          width: 100%;
          height: 80px;
          padding: 12px;
          background: #1a1a2e;
          border: 1px solid #2d2d44;
          border-radius: 8px;
          color: white;
          font-size: 14px;
          resize: none;
        }

        .tcc-description-panel textarea:focus {
          outline: none;
          border-color: #667eea;
        }

        .tcc-action-row {
          display: flex;
          align-items: center;
          gap: 15px;
          margin-top: 15px;
        }

        .tcc-estimate {
          color: #6b7280;
          font-size: 13px;
        }

        .tcc-content {
          flex: 1;
          overflow-y: auto;
          padding: 30px;
        }

        .tcc-loading-placeholder {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: #9ca3af;
          text-align: center;
        }

        .tcc-loading-placeholder p {
          margin: 0;
          font-size: 16px;
        }

        /* Grade Display */
        .tcc-grade-display {
          display: flex;
          gap: 20px;
          margin-bottom: 30px;
        }

        .tcc-grade-card {
          flex: 1;
          background: #16162a;
          border-radius: 12px;
          padding: 20px;
          text-align: center;
        }

        .tcc-grade-value {
          font-size: 48px;
          font-weight: 700;
          margin: 10px 0;
        }

        .tcc-grade-a { color: #22c55e; }
        .tcc-grade-b { color: #84cc16; }
        .tcc-grade-c { color: #f59e0b; }
        .tcc-grade-d { color: #f97316; }
        .tcc-grade-f { color: #ef4444; }

        .tcc-grade-label {
          color: #9ca3af;
          font-size: 14px;
        }

        /* Stats Grid */
        .tcc-stats-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 15px;
          margin-bottom: 30px;
        }

        .tcc-stat-card {
          background: #16162a;
          border-radius: 10px;
          padding: 20px;
          text-align: center;
        }

        .tcc-stat-value {
          font-size: 32px;
          font-weight: 700;
          color: white;
        }

        .tcc-stat-label {
          color: #6b7280;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 5px;
        }

        /* Insights Section */
        .tcc-insights {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 20px;
        }

        .tcc-insight-card {
          background: #16162a;
          border-radius: 12px;
          padding: 20px;
        }

        .tcc-insight-card h3 {
          margin: 0 0 15px 0;
          font-size: 16px;
          color: white;
        }

        .tcc-insight-card ul {
          margin: 0;
          padding: 0;
          list-style: none;
        }

        .tcc-insight-card li {
          padding: 8px 0;
          border-bottom: 1px solid #2d2d44;
          color: #d1d5db;
          font-size: 14px;
        }

        .tcc-insight-card li:last-child {
          border-bottom: none;
        }

        /* Card Analysis */
        .tcc-card-item {
          background: #16162a;
          border-radius: 12px;
          margin-bottom: 15px;
          overflow: hidden;
        }

        .tcc-card-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 20px;
          cursor: pointer;
        }

        .tcc-card-header:hover {
          background: rgba(255, 255, 255, 0.02);
        }

        .tcc-card-title {
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .tcc-card-grade {
          padding: 4px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 600;
        }

        .tcc-card-grade-a { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
        .tcc-card-grade-b { background: rgba(132, 204, 22, 0.2); color: #84cc16; }
        .tcc-card-grade-c { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
        .tcc-card-grade-d { background: rgba(249, 115, 22, 0.2); color: #f97316; }
        .tcc-card-grade-f { background: rgba(239, 68, 68, 0.2); color: #ef4444; }

        .tcc-card-details {
          padding: 20px;
          border-top: 1px solid #2d2d44;
          display: none;
        }

        .tcc-card-details.open {
          display: block;
        }

        .tcc-keyword-section {
          margin-bottom: 15px;
        }

        .tcc-keyword-label {
          color: #6b7280;
          font-size: 12px;
          text-transform: uppercase;
          margin-bottom: 8px;
        }

        .tcc-keyword-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .tcc-keyword {
          background: #2d2d44;
          color: white;
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 13px;
        }

        .tcc-keyword.suggested {
          background: rgba(34, 197, 94, 0.2);
          color: #22c55e;
          border: 1px dashed #22c55e;
        }

        .tcc-keyword.remove {
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
          text-decoration: line-through;
        }

        /* Questions Table */
        .tcc-questions-table {
          width: 100%;
          border-collapse: collapse;
        }

        .tcc-questions-table th,
        .tcc-questions-table td {
          padding: 15px;
          text-align: left;
          border-bottom: 1px solid #2d2d44;
        }

        .tcc-questions-table th {
          background: #16162a;
          color: #9ca3af;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .tcc-questions-table td {
          color: white;
          font-size: 14px;
        }

        .tcc-status-badge {
          padding: 4px 10px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
        }

        .tcc-status-covered { background: rgba(34, 197, 94, 0.2); color: #22c55e; }
        .tcc-status-partial { background: rgba(245, 158, 11, 0.2); color: #f59e0b; }
        .tcc-status-missing { background: rgba(239, 68, 68, 0.2); color: #ef4444; }

        /* Recommendations */
        .tcc-rec-section {
          margin-bottom: 30px;
        }

        .tcc-rec-section h3 {
          margin: 0 0 15px 0;
          font-size: 18px;
          color: white;
          display: flex;
          align-items: center;
          gap: 10px;
        }

        .tcc-rec-item {
          background: #16162a;
          border-radius: 10px;
          padding: 20px;
          margin-bottom: 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }

        .tcc-rec-content {
          flex: 1;
        }

        .tcc-rec-title {
          font-size: 15px;
          font-weight: 600;
          color: white;
          margin-bottom: 5px;
        }

        .tcc-rec-description {
          font-size: 13px;
          color: #9ca3af;
        }

        .tcc-rec-actions {
          display: flex;
          gap: 10px;
        }

        .tcc-btn-apply {
          background: #667eea;
          color: white;
          padding: 8px 16px;
          border-radius: 6px;
          border: none;
          font-size: 13px;
          cursor: pointer;
        }

        .tcc-btn-apply:hover {
          background: #5a6fd6;
        }

        .tcc-btn-skip {
          background: transparent;
          color: #6b7280;
          padding: 8px 16px;
          border-radius: 6px;
          border: 1px solid #4b5563;
          font-size: 13px;
          cursor: pointer;
        }

        /* Filter Buttons */
        .tcc-filters {
          display: flex;
          gap: 10px;
          margin-bottom: 20px;
        }

        .tcc-filter-btn {
          background: #2d2d44;
          color: #9ca3af;
          border: none;
          padding: 8px 16px;
          border-radius: 6px;
          font-size: 13px;
          cursor: pointer;
        }

        .tcc-filter-btn.active {
          background: #667eea;
          color: white;
        }

        /* Loading State */
        .tcc-loading {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          height: 100%;
          color: white;
        }

        .tcc-spinner {
          width: 50px;
          height: 50px;
          border: 4px solid #2d2d44;
          border-top-color: #667eea;
          border-radius: 50%;
          animation: tcc-spin 1s linear infinite;
          margin-bottom: 20px;
        }

        @keyframes tcc-spin {
          to { transform: rotate(360deg); }
        }

        /* Version History Modal */
        .tcc-version-modal {
          position: absolute;
          top: 50%;
          left: 50%;
          transform: translate(-50%, -50%);
          background: #1a1a2e;
          border-radius: 12px;
          padding: 30px;
          max-width: 600px;
          width: 90%;
          max-height: 70vh;
          overflow-y: auto;
          z-index: 10001;
        }

        .tcc-version-item {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 15px;
          background: #16162a;
          border-radius: 8px;
          margin-bottom: 10px;
        }

        .tcc-version-info {
          flex: 1;
        }

        .tcc-version-name {
          font-weight: 600;
          color: white;
        }

        .tcc-version-meta {
          font-size: 12px;
          color: #6b7280;
          margin-top: 5px;
        }
      </style>
    `;
  }

  /**
   * Bind event handlers
   */
  bindEvents() {
    // Close on Escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        this.close();
      }
    });
  }

  /**
   * Switch between tabs
   */
  switchTab(tab) {
    this.currentTab = tab;

    // Update tab buttons
    document.querySelectorAll('.tcc-tab').forEach(t => {
      t.classList.remove('active');
      if (t.dataset.tab === tab) {
        t.classList.add('active');
      }
    });

    // Re-render content
    this.renderContent();
  }

  /**
   * Load quick stats without full evaluation
   */
  async loadQuickStats() {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/triage-evaluator/${this.companyId}/quick-stats`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        // Store for display
        this.quickStats = data.stats;
      }
    } catch (error) {
      console.error('[TCC] Failed to load quick stats:', error);
    }
  }

  /**
   * Run full evaluation
   */
  async runEvaluation() {
    const btn = document.getElementById('tcc-run-btn');
    const description = document.getElementById('tcc-business-description').value;

    btn.disabled = true;
    btn.innerHTML = '⏳ Analyzing...';
    this.isLoading = true;

    // Show loading state
    const content = document.getElementById('tcc-content');
    content.innerHTML = `
      <div class="tcc-loading">
        <div class="tcc-spinner"></div>
        <p>Running evaluation with real call data...</p>
        <p style="opacity: 0.6; font-size: 14px;">Analyzing transcripts, testing coverage, generating recommendations...</p>
      </div>
    `;

    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/triage-evaluator/${this.companyId}/evaluate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ businessDescription: description })
      });

      if (!response.ok) {
        throw new Error('Evaluation failed');
      }

      const data = await response.json();
      this.evaluation = data.evaluation;
      this.isLoading = false;

      // Render results
      this.renderContent();

    } catch (error) {
      console.error('[TCC] Evaluation failed:', error);
      content.innerHTML = `
        <div class="tcc-loading">
          <p style="color: #ef4444;">❌ Evaluation failed: ${error.message}</p>
          <button class="tcc-btn tcc-btn-primary" onclick="window.triageCommandCenter.runEvaluation()">
            Retry
          </button>
        </div>
      `;
    } finally {
      btn.disabled = false;
      btn.innerHTML = '🚀 Run Full Evaluation';
    }
  }

  /**
   * Render content based on current tab
   */
  renderContent() {
    const content = document.getElementById('tcc-content');

    if (!this.evaluation) {
      content.innerHTML = `
        <div class="tcc-loading-placeholder">
          <p>Enter your business description and click "Run Full Evaluation" to begin.</p>
          <p style="opacity: 0.6; margin-top: 10px;">The evaluation will analyze your triage cards using real call data from the last 30 days.</p>
        </div>
      `;
      return;
    }

    switch (this.currentTab) {
      case 'overview':
        content.innerHTML = this.renderOverviewTab();
        break;
      case 'cards':
        content.innerHTML = this.renderCardsTab();
        break;
      case 'questions':
        content.innerHTML = this.renderQuestionsTab();
        break;
      case 'recommendations':
        content.innerHTML = this.renderRecommendationsTab();
        break;
    }
  }

  /**
   * Render Overview tab
   */
  renderOverviewTab() {
    const e = this.evaluation;
    const gradeClass = `tcc-grade-${e.grade[0].toLowerCase()}`;

    return `
      <!-- Grade Cards -->
      <div class="tcc-grade-display">
        <div class="tcc-grade-card">
          <div class="tcc-grade-label">Overall Grade</div>
          <div class="tcc-grade-value ${gradeClass}">${e.grade}</div>
          <div class="tcc-grade-label">Score: ${e.gradeScore}/100</div>
        </div>
        <div class="tcc-grade-card">
          <div class="tcc-grade-label">Readiness</div>
          <div class="tcc-grade-value" style="color: ${e.readinessScore >= 80 ? '#22c55e' : e.readinessScore >= 60 ? '#f59e0b' : '#ef4444'}">${e.readinessScore}%</div>
          <div class="tcc-grade-label">Production Ready</div>
        </div>
        <div class="tcc-grade-card">
          <div class="tcc-grade-label">Coverage</div>
          <div class="tcc-grade-value" style="color: #667eea">${e.realCallInsights.callsAnalyzed > 0 ? Math.round((e.top50Questions?.filter(q => q.matchStatus === 'COVERED').length || 0) / (e.top50Questions?.length || 1) * 100) : 0}%</div>
          <div class="tcc-grade-label">Top 50 Questions</div>
        </div>
        <div class="tcc-grade-card">
          <div class="tcc-grade-label">Emergency</div>
          <div class="tcc-grade-value ${e.emergencyCoverage?.grade === 'A' ? 'tcc-grade-a' : e.emergencyCoverage?.grade === 'B' ? 'tcc-grade-b' : 'tcc-grade-f'}">${e.emergencyCoverage?.grade || 'N/A'}</div>
          <div class="tcc-grade-label">${e.emergencyCoverage?.coveragePercentage || 0}% Covered</div>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="tcc-stats-grid">
        <div class="tcc-stat-card">
          <div class="tcc-stat-value">${e.summary.totalCards}</div>
          <div class="tcc-stat-label">Total Cards</div>
        </div>
        <div class="tcc-stat-card">
          <div class="tcc-stat-value" style="color: ${e.summary.disabledCards > 0 ? '#f59e0b' : '#22c55e'}">${e.summary.activeCards}</div>
          <div class="tcc-stat-label">Active Cards</div>
        </div>
        <div class="tcc-stat-card">
          <div class="tcc-stat-value">${e.summary.totalKeywords}</div>
          <div class="tcc-stat-label">Total Keywords</div>
        </div>
        <div class="tcc-stat-card">
          <div class="tcc-stat-value">${e.realCallInsights.callsAnalyzed}</div>
          <div class="tcc-stat-label">Calls Analyzed</div>
        </div>
      </div>

      <!-- Insights -->
      <div class="tcc-insights">
        <div class="tcc-insight-card">
          <h3>✅ Strengths</h3>
          <ul>
            ${(e.cardAnalysis?.overallInsights?.strengths || ['No evaluation data']).map(s => `<li>• ${s}</li>`).join('')}
          </ul>
        </div>
        <div class="tcc-insight-card">
          <h3>🚨 Critical Gaps</h3>
          <ul>
            ${(e.cardAnalysis?.overallInsights?.criticalGaps || ['Run evaluation for insights']).map(s => `<li>• ${s}</li>`).join('')}
          </ul>
        </div>
        <div class="tcc-insight-card">
          <h3>⚡ Quick Wins</h3>
          <ul>
            ${(e.cardAnalysis?.overallInsights?.quickWins || ['Run evaluation for insights']).map(s => `<li>• ${s}</li>`).join('')}
          </ul>
        </div>
        <div class="tcc-insight-card">
          <h3>📊 Real Call Data</h3>
          <ul>
            <li>• Match Rate: ${e.realCallInsights.callsAnalyzed > 0 ? Math.round((e.realCallInsights.callsAnalyzed - e.realCallInsights.unmatchedPhrases.reduce((sum, p) => sum + p.count, 0)) / e.realCallInsights.callsAnalyzed * 100) : 0}%</li>
            <li>• ${e.conflicts?.length || 0} keyword conflicts detected</li>
            <li>• ${e.emergencyCoverage?.missing?.length || 0} emergency scenarios missing</li>
            <li>• ${e.recommendations?.high?.length || 0} high priority fixes</li>
          </ul>
        </div>
      </div>
    `;
  }

  /**
   * Render Cards tab
   */
  renderCardsTab() {
    const cards = this.evaluation.cardAnalysis?.cardAnalysis || [];

    if (cards.length === 0) {
      return '<p style="color: #9ca3af; text-align: center;">No card analysis available. Run evaluation first.</p>';
    }

    return `
      <div class="tcc-filters">
        <button class="tcc-filter-btn active" onclick="window.triageCommandCenter.filterCards('all')">All (${cards.length})</button>
        <button class="tcc-filter-btn" onclick="window.triageCommandCenter.filterCards('needs-improvement')">Needs Work (${cards.filter(c => c.currentGrade === 'C' || c.currentGrade === 'D' || c.currentGrade === 'F').length})</button>
        <button class="tcc-filter-btn" onclick="window.triageCommandCenter.filterCards('good')">Good (${cards.filter(c => c.currentGrade === 'A' || c.currentGrade === 'B').length})</button>
      </div>

      <div id="tcc-cards-list">
        ${cards.map((card, idx) => this.renderCardItem(card, idx)).join('')}
      </div>
    `;
  }

  /**
   * Render a single card item
   */
  renderCardItem(card, idx) {
    const gradeClass = `tcc-card-grade-${card.currentGrade?.toLowerCase() || 'c'}`;

    return `
      <div class="tcc-card-item">
        <div class="tcc-card-header" onclick="window.triageCommandCenter.toggleCard(${idx})">
          <div class="tcc-card-title">
            <span class="tcc-card-grade ${gradeClass}">${card.currentGrade || '?'}</span>
            <span style="color: white; font-weight: 600;">${card.triageLabel}</span>
            <span style="color: #6b7280; font-size: 13px;">${card.keywordQuality}</span>
          </div>
          <span style="color: #6b7280;">▼</span>
        </div>
        <div class="tcc-card-details" id="tcc-card-${idx}">
          <div class="tcc-keyword-section">
            <div class="tcc-keyword-label">Current Keywords</div>
            <div class="tcc-keyword-list">
              ${(card.currentKeywords || []).map(k => `<span class="tcc-keyword">${k}</span>`).join('')}
            </div>
          </div>

          ${card.suggestedKeywordsToAdd?.length > 0 ? `
            <div class="tcc-keyword-section">
              <div class="tcc-keyword-label">💡 Suggested Additions</div>
              <div class="tcc-keyword-list">
                ${card.suggestedKeywordsToAdd.map(k => `<span class="tcc-keyword suggested">+ ${k}</span>`).join('')}
              </div>
            </div>
          ` : ''}

          ${card.suggestedKeywordsToRemove?.length > 0 ? `
            <div class="tcc-keyword-section">
              <div class="tcc-keyword-label">🗑️ Consider Removing</div>
              <div class="tcc-keyword-list">
                ${card.suggestedKeywordsToRemove.map(k => `<span class="tcc-keyword remove">${k}</span>`).join('')}
              </div>
            </div>
          ` : ''}

          <div style="margin-top: 15px; padding: 15px; background: #2d2d44; border-radius: 8px;">
            <p style="margin: 0; color: #9ca3af; font-size: 13px;">
              <strong style="color: white;">Action Review:</strong> ${card.actionReview || 'N/A'}
            </p>
            <p style="margin: 10px 0 0 0; color: #6b7280; font-size: 13px;">
              ${card.reasoning || 'No additional reasoning provided.'}
            </p>
          </div>

          ${card.suggestedKeywordsToAdd?.length > 0 ? `
            <div style="margin-top: 15px;">
              <button class="tcc-btn-apply" onclick="window.triageCommandCenter.applyCardSuggestions('${card.cardId}', ${JSON.stringify(card.suggestedKeywordsToAdd).replace(/"/g, '&quot;')})">
                ✓ Apply Suggestions
              </button>
            </div>
          ` : ''}
        </div>
      </div>
    `;
  }

  /**
   * Toggle card details
   */
  toggleCard(idx) {
    const details = document.getElementById(`tcc-card-${idx}`);
    if (details) {
      details.classList.toggle('open');
    }
  }

  /**
   * Render Questions tab
   */
  renderQuestionsTab() {
    const questions = this.evaluation.cardAnalysis?.top50Questions || [];

    if (questions.length === 0) {
      return '<p style="color: #9ca3af; text-align: center;">No questions generated. Run evaluation first.</p>';
    }

    const covered = questions.filter(q => q.matchStatus === 'COVERED').length;
    const partial = questions.filter(q => q.matchStatus === 'PARTIAL').length;
    const missing = questions.filter(q => q.matchStatus === 'NOT_COVERED').length;

    return `
      <div style="margin-bottom: 20px; display: flex; gap: 20px;">
        <span style="color: #22c55e;">✅ Covered: ${covered}</span>
        <span style="color: #f59e0b;">⚠️ Partial: ${partial}</span>
        <span style="color: #ef4444;">❌ Missing: ${missing}</span>
      </div>

      <div class="tcc-filters">
        <button class="tcc-filter-btn active" onclick="window.triageCommandCenter.filterQuestions('all')">All</button>
        <button class="tcc-filter-btn" onclick="window.triageCommandCenter.filterQuestions('COVERED')">✅ Covered</button>
        <button class="tcc-filter-btn" onclick="window.triageCommandCenter.filterQuestions('NOT_COVERED')">❌ Missing</button>
        <button class="tcc-filter-btn" onclick="window.triageCommandCenter.filterQuestions('PARTIAL')">⚠️ Partial</button>
      </div>

      <table class="tcc-questions-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Question</th>
            <th>Frequency</th>
            <th>Status</th>
            <th>Matched Card</th>
          </tr>
        </thead>
        <tbody id="tcc-questions-body">
          ${questions.map((q, idx) => `
            <tr class="tcc-question-row" data-status="${q.matchStatus}">
              <td>${q.rank || idx + 1}</td>
              <td>"${q.question}"</td>
              <td>${q.frequency || 'Common'}</td>
              <td>
                <span class="tcc-status-badge tcc-status-${q.matchStatus === 'COVERED' ? 'covered' : q.matchStatus === 'PARTIAL' ? 'partial' : 'missing'}">
                  ${q.matchStatus === 'COVERED' ? '✅' : q.matchStatus === 'PARTIAL' ? '⚠️' : '❌'} ${q.matchStatus}
                </span>
              </td>
              <td>${q.matchedCard || q.suggestedCard || '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      ${missing > 0 ? `
        <div style="margin-top: 20px; text-align: center;">
          <button class="tcc-btn tcc-btn-primary" onclick="window.triageCommandCenter.generateCardsForGaps()">
            🔧 Generate Cards for ${missing} Missing Questions
          </button>
        </div>
      ` : ''}
    `;
  }

  /**
   * Render Recommendations tab
   */
  renderRecommendationsTab() {
    const rec = this.evaluation.recommendations || { high: [], medium: [], low: [] };

    return `
      <!-- High Priority -->
      <div class="tcc-rec-section">
        <h3>🔴 High Priority (${rec.high?.length || 0})</h3>
        ${(rec.high || []).map((r, idx) => this.renderRecommendationItem(r, 'high', idx)).join('')}
        ${rec.high?.length === 0 ? '<p style="color: #6b7280;">No high priority recommendations!</p>' : ''}
      </div>

      ${rec.high?.length > 0 ? `
        <div style="margin-bottom: 30px; text-align: center;">
          <button class="tcc-btn tcc-btn-primary" onclick="window.triageCommandCenter.applyAllRecommendations('high')">
            🚀 Apply All High Priority Fixes
          </button>
        </div>
      ` : ''}

      <!-- Medium Priority -->
      <div class="tcc-rec-section">
        <h3>🟡 Medium Priority (${rec.medium?.length || 0})</h3>
        ${(rec.medium || []).map((r, idx) => this.renderRecommendationItem(r, 'medium', idx)).join('')}
        ${rec.medium?.length === 0 ? '<p style="color: #6b7280;">No medium priority recommendations.</p>' : ''}
      </div>

      <!-- Low Priority -->
      <div class="tcc-rec-section">
        <h3>🟢 Nice to Have (${rec.low?.length || 0})</h3>
        ${(rec.low || []).map((r, idx) => this.renderRecommendationItem(r, 'low', idx)).join('')}
        ${rec.low?.length === 0 ? '<p style="color: #6b7280;">No additional recommendations.</p>' : ''}
      </div>
    `;
  }

  /**
   * Render a single recommendation item
   */
  renderRecommendationItem(rec, priority, idx) {
    return `
      <div class="tcc-rec-item" id="tcc-rec-${priority}-${idx}">
        <div class="tcc-rec-content">
          <div class="tcc-rec-title">${rec.title}</div>
          <div class="tcc-rec-description">${rec.description}</div>
        </div>
        <div class="tcc-rec-actions">
          <button class="tcc-btn-apply" onclick="window.triageCommandCenter.applyRecommendation('${priority}', ${idx})">
            Apply
          </button>
          <button class="tcc-btn-skip" onclick="window.triageCommandCenter.skipRecommendation('${priority}', ${idx})">
            Skip
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Apply a single recommendation
   */
  async applyRecommendation(priority, idx) {
    const rec = this.evaluation.recommendations[priority][idx];
    const btn = event.target;
    btn.disabled = true;
    btn.innerHTML = '⏳';

    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/triage-evaluator/${this.companyId}/apply-recommendation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ recommendation: rec })
      });

      if (response.ok) {
        // Mark as applied
        const item = document.getElementById(`tcc-rec-${priority}-${idx}`);
        if (item) {
          item.style.opacity = '0.5';
          item.innerHTML = `
            <div class="tcc-rec-content">
              <div class="tcc-rec-title" style="color: #22c55e;">✓ ${rec.title}</div>
              <div class="tcc-rec-description">Applied successfully</div>
            </div>
          `;
        }
      } else {
        btn.disabled = false;
        btn.innerHTML = 'Apply';
        alert('Failed to apply recommendation');
      }
    } catch (error) {
      btn.disabled = false;
      btn.innerHTML = 'Apply';
      console.error('[TCC] Apply failed:', error);
    }
  }

  /**
   * Skip a recommendation
   */
  skipRecommendation(priority, idx) {
    const item = document.getElementById(`tcc-rec-${priority}-${idx}`);
    if (item) {
      item.remove();
    }
  }

  /**
   * Apply all recommendations of a priority
   */
  async applyAllRecommendations(priority) {
    const recs = this.evaluation.recommendations[priority] || [];
    if (recs.length === 0) return;

    if (!confirm(`Apply all ${recs.length} ${priority} priority recommendations?`)) {
      return;
    }

    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/triage-evaluator/${this.companyId}/apply-all`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ recommendations: recs, priority })
      });

      if (response.ok) {
        const data = await response.json();
        alert(`Applied ${data.applied} recommendations. ${data.failed} failed.`);
        // Re-render
        this.renderContent();
      } else {
        alert('Failed to apply recommendations');
      }
    } catch (error) {
      console.error('[TCC] Apply all failed:', error);
    }
  }

  /**
   * Show version history modal
   */
  async showVersionHistory() {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/triage-evaluator/${this.companyId}/versions`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!response.ok) throw new Error('Failed to load versions');

      const data = await response.json();
      this.versions = data.versions;

      // Create modal
      const modal = document.createElement('div');
      modal.id = 'tcc-version-modal-overlay';
      modal.style.cssText = 'position: absolute; inset: 0; background: rgba(0,0,0,0.5); z-index: 10001; display: flex; align-items: center; justify-content: center;';
      modal.onclick = () => modal.remove();

      modal.innerHTML = `
        <div class="tcc-version-modal" onclick="event.stopPropagation()">
          <h2 style="margin: 0 0 20px 0; color: white;">📜 Version History</h2>
          ${this.versions.length === 0 ? '<p style="color: #6b7280;">No versions yet.</p>' : ''}
          ${this.versions.map(v => `
            <div class="tcc-version-item">
              <div class="tcc-version-info">
                <div class="tcc-version-name">v${v.version}: ${v.versionName}</div>
                <div class="tcc-version-meta">
                  ${v.changeType} • ${new Date(v.appliedAt).toLocaleDateString()} • ${v.appliedBy?.email || 'System'}
                </div>
              </div>
              ${v.status === 'ACTIVE' ? '<span style="color: #22c55e;">✓ Current</span>' : `
                <button class="tcc-btn-apply" onclick="window.triageCommandCenter.rollbackToVersion(${v.version})">
                  Rollback
                </button>
              `}
            </div>
          `).join('')}
          <button class="tcc-btn tcc-btn-secondary" style="margin-top: 20px;" onclick="document.getElementById('tcc-version-modal-overlay').remove()">
            Close
          </button>
        </div>
      `;

      document.querySelector('.tcc-modal').appendChild(modal);

    } catch (error) {
      console.error('[TCC] Load versions failed:', error);
      alert('Failed to load version history');
    }
  }

  /**
   * Rollback to a specific version
   */
  async rollbackToVersion(version) {
    if (!confirm(`Rollback to version ${version}? This will restore all cards to that state.`)) {
      return;
    }

    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/triage-evaluator/${this.companyId}/versions/${version}/rollback`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (response.ok) {
        const data = await response.json();
        alert(`Rolled back to version ${version}. ${data.cardsRestored} cards restored.`);
        document.getElementById('tcc-version-modal-overlay')?.remove();
        // Re-run evaluation
        await this.runEvaluation();
      } else {
        alert('Rollback failed');
      }
    } catch (error) {
      console.error('[TCC] Rollback failed:', error);
    }
  }

  /**
   * Filter cards by grade
   */
  filterCards(filter) {
    // Update button states
    document.querySelectorAll('.tcc-filters .tcc-filter-btn').forEach(btn => {
      btn.classList.remove('active');
      if (btn.textContent.toLowerCase().includes(filter === 'all' ? 'all' : filter === 'needs-improvement' ? 'needs' : 'good')) {
        btn.classList.add('active');
      }
    });

    // Filter cards
    const cards = document.querySelectorAll('.tcc-card-item');
    cards.forEach(card => {
      const grade = card.querySelector('.tcc-card-grade')?.textContent;
      const isGood = grade === 'A' || grade === 'B';
      
      if (filter === 'all') {
        card.style.display = 'block';
      } else if (filter === 'good' && isGood) {
        card.style.display = 'block';
      } else if (filter === 'needs-improvement' && !isGood) {
        card.style.display = 'block';
      } else {
        card.style.display = 'none';
      }
    });
  }

  /**
   * Filter questions by status
   */
  filterQuestions(filter) {
    // Update button states
    document.querySelectorAll('.tcc-filters .tcc-filter-btn').forEach(btn => {
      btn.classList.remove('active');
    });
    event.target.classList.add('active');

    // Filter rows
    const rows = document.querySelectorAll('.tcc-question-row');
    rows.forEach(row => {
      const status = row.dataset.status;
      if (filter === 'all' || status === filter) {
        row.style.display = '';
      } else {
        row.style.display = 'none';
      }
    });
  }
}

// Global instance
window.TriageCommandCenter = TriageCommandCenter;

