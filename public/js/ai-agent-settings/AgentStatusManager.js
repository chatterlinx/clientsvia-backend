/**
 * ============================================================================
 * AGENT STATUS MANAGER - ENTERPRISE VISIBILITY DASHBOARD
 * ============================================================================
 * 
 * PURPOSE: Provide complete transparency into live agent runtime configuration
 * DISPLAYS: Active components, performance metrics, system health
 * 
 * UI SECTIONS:
 * 1. System Status Overview (operational/degraded/down)
 * 2. Active Components Registry (all orchestration components)
 * 3. Performance Metrics (24h rolling window)
 * 4. Health Checks (database, redis, LLM, components)
 * 5. Live Prompt Configuration (version, hash, cards count)
 * 
 * ============================================================================
 */

class AgentStatusManager {
  constructor(companyId) {
    this.companyId = companyId;
    this.refreshInterval = null;
    this.backgroundInterval = null; // NEW: Always-on background health check
    this.autoRefreshSeconds = 60; // Reduced from 30 to prevent server overload
    this.backgroundRefreshSeconds = 120; // Reduced from 60 to prevent resource exhaustion
    
    console.log('[AGENT STATUS] Manager initialized', { companyId });
    
    // Start background health monitoring immediately (runs even when tab is closed)
    this.startBackgroundMonitoring();
  }

  /**
   * Initialize the dashboard
   */
  async init() {
    try {
      console.log('[AGENT STATUS] Loading dashboard...');
      
      // Load all data
      const [status, metrics, health] = await Promise.all([
        this.fetchStatus(),
        this.fetchMetrics('24h'),
        this.fetchHealth()
      ]);

      // Render the dashboard
      this.render(status, metrics, health);

      // Start auto-refresh
      this.startAutoRefresh();

      console.log('[AGENT STATUS] Dashboard loaded successfully');
    } catch (error) {
      console.error('[AGENT STATUS] Failed to initialize dashboard', error);
      this.renderError(error.message);
    }
  }

  /**
   * Fetch live agent status
   */
  async fetchStatus() {
    const token = localStorage.getItem('adminToken');
    const response = await fetch(`/api/admin/agent-status/${this.companyId}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch status: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Fetch performance metrics
   */
  async fetchMetrics(timeRange = '24h') {
    const token = localStorage.getItem('adminToken');
    const response = await fetch(`/api/admin/agent-status/${this.companyId}/metrics?timeRange=${timeRange}`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch metrics: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Fetch system health (company-specific)
   */
  async fetchHealth() {
    const token = localStorage.getItem('adminToken');
    const response = await fetch(`/api/admin/agent-status/${this.companyId}/health`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch health: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Fetch platform-wide health (NEW: uses Notification Center integration)
   * This endpoint is ALWAYS available and runs independently of UI state
   */
  async fetchPlatformHealth() {
    const token = localStorage.getItem('adminToken');
    const response = await fetch(`/api/admin/agent-status/platform/health`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch platform health: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Render the complete dashboard
   */
  async render(status, metrics, health) {
    // Use instance properties if parameters not passed
    status = status || this.status;
    metrics = metrics || this.metrics;
    health = health || this.health || { status: 'unknown' };
    
    const container = document.getElementById('agent-status-container');
    if (!container) {
      console.error('[AGENT STATUS] Container not found');
      return;
    }

    // Update tab indicator color based on health status
    this.updateTabIndicator(health?.status || 'unknown');

    // Render LLM config (async)
    const llmConfigHtml = await this.renderLLMConfig();

    container.innerHTML = `
      <!-- System Status Overview -->
      ${this.renderStatusOverview(status, health)}

      <!-- 🧠 AI AGENT EXCELLENCE CENTER - Quick Access -->
      <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); border-radius: 12px; padding: 20px; margin-bottom: 25px; display: flex; justify-content: space-between; align-items: center; border: 1px solid #334155;">
        <div>
          <h3 style="margin: 0 0 5px 0; font-size: 18px; font-weight: 700; color: white; display: flex; align-items: center; gap: 10px;">
            🧠 AI Agent Excellence Center
            <span style="background: linear-gradient(135deg, #7c3aed, #a855f7); padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;">
              NEW
            </span>
          </h3>
          <p style="margin: 0; font-size: 13px; color: #94a3b8;">
            Performance intelligence, improvement suggestions, and revenue tracking
          </p>
        </div>
        <button 
          onclick="window.agentStatusManager.openExcellenceCenter()"
          style="background: linear-gradient(135deg, #7c3aed 0%, #a855f7 100%); color: white; border: none; padding: 12px 24px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: all 0.2s;"
          onmouseover="this.style.transform='translateY(-2px)'; this.style.boxShadow='0 4px 15px rgba(124,58,237,0.4)';"
          onmouseout="this.style.transform='translateY(0)'; this.style.boxShadow='none';">
          📊 View Excellence Score
        </button>
      </div>

      <!-- 🤖 LLM CONFIGURATION - THE HEART OF LLM-0 -->
      ${llmConfigHtml}

      <!-- Performance Metrics -->
      ${this.renderMetrics(metrics)}

      <!-- Active Components Registry -->
      ${this.renderComponents(status.components)}

      <!-- Prompt Configuration -->
      ${this.renderPromptConfig(status.activePrompt)}

      <!-- Health Checks -->
      ${this.renderHealthChecks(health)}

      <!-- Auto-Refresh Control -->
      ${this.renderRefreshControl()}
    `;
  }

  /**
   * Render status overview section
   */
  renderStatusOverview(status, health) {
    const statusColor = health.status === 'healthy' ? 'green' : health.status === 'degraded' ? 'orange' : 'red';
    const statusIcon = health.status === 'healthy' ? '✅' : health.status === 'degraded' ? '⚠️' : '❌';

    return `
      <div style="background: linear-gradient(135deg, ${health.status === 'healthy' ? '#667eea 0%, #764ba2' : health.status === 'degraded' ? '#f59e0b 0%, #d97706' : '#dc2626 0%, #991b1b'} 100%); color: white; padding: 30px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 4px 15px rgba(0,0,0,0.1);">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h2 style="margin: 0 0 10px 0; font-size: 28px; font-weight: 700;">
              🤖 Live Agent Status
            </h2>
            <p style="margin: 0; font-size: 16px; opacity: 0.9;">
              Real-time visibility into ${status.companyName}'s AI agent configuration
            </p>
            ${health.status !== 'healthy' ? `
              <button onclick="window.agentStatusManager.showTroubleshootingModal()" style="margin-top: 15px; background: rgba(255,255,255,0.2); backdrop-filter: blur(10px); border: 2px solid rgba(255,255,255,0.3); color: white; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
                🔧 View Troubleshooting Details
              </button>
            ` : ''}
          </div>
          <div style="text-align: right;">
            <div style="font-size: 48px; line-height: 1;">${statusIcon}</div>
            <div style="font-size: 18px; font-weight: 600; margin-top: 8px; text-transform: uppercase; letter-spacing: 1px;">
              ${health.status}
            </div>
          </div>
        </div>
        <div style="margin-top: 20px; padding-top: 20px; border-top: 1px solid rgba(255,255,255,0.2); display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
          <div>
            <div style="font-size: 12px; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.5px;">Orchestration Mode</div>
            <div style="font-size: 20px; font-weight: 600; margin-top: 5px;">${status.orchestrationMode}</div>
          </div>
          <div>
            <div style="font-size: 12px; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.5px;">Last Updated</div>
            <div style="font-size: 20px; font-weight: 600; margin-top: 5px;">${new Date(status.timestamp).toLocaleTimeString()}</div>
          </div>
          <div>
            <div style="font-size: 12px; opacity: 0.8; text-transform: uppercase; letter-spacing: 0.5px;">Active Components</div>
            <div style="font-size: 20px; font-weight: 600; margin-top: 5px;">${this.countActiveComponents(status.components)}</div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render performance metrics section
   */
  renderMetrics(metrics) {
    // Safe defaults for all metrics
    const metricsData = metrics?.metrics || {};
    const calls = metricsData.calls || { total: 0, avgPerHour: 0 };
    const performance = metricsData.performance || { status: 'good', avgLatency: 0, target: 500 };
    const routing = metricsData.routing || { status: 'good', accuracy: 100, correctRoutes: 0, incorrectRoutes: 0 };
    const tokens = metricsData.tokens || { estimatedCost: '0.00', total: 0 };
    const emotions = metricsData.emotions || [];

    const getStatusColor = (status) => {
      return status === 'good' ? '#10b981' : status === 'warning' ? '#f59e0b' : '#ef4444';
    };

    return `
      <div style="background: white; border-radius: 12px; padding: 25px; margin-bottom: 25px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <h3 style="margin: 0 0 20px 0; font-size: 20px; font-weight: 700; color: #1f2937;">
          📊 Performance Metrics (Last 24 Hours)
        </h3>
        
        <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;">
          <!-- Calls -->
          <div style="background: #f9fafb; border-radius: 8px; padding: 20px;">
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Total Calls</div>
            <div style="font-size: 32px; font-weight: 700; color: #1f2937;">${calls.total || 0}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 5px;">${calls.avgPerHour || 0}/hr avg</div>
          </div>

          <!-- Latency -->
          <div style="background: #f9fafb; border-radius: 8px; padding: 20px; border-left: 4px solid ${getStatusColor(performance.status)};">
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Avg Latency</div>
            <div style="font-size: 32px; font-weight: 700; color: ${getStatusColor(performance.status)};">${performance.avgLatency || 0}ms</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 5px;">Target: ${performance.target || 500}ms</div>
          </div>

          <!-- Routing Accuracy -->
          <div style="background: #f9fafb; border-radius: 8px; padding: 20px; border-left: 4px solid ${getStatusColor(routing.status)};">
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Routing Accuracy</div>
            <div style="font-size: 32px; font-weight: 700; color: ${getStatusColor(routing.status)};">${routing.accuracy || 100}%</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 5px;">${routing.correctRoutes || 0} correct / ${routing.incorrectRoutes || 0} errors</div>
          </div>

          <!-- Cost -->
          <div style="background: #f9fafb; border-radius: 8px; padding: 20px;">
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Estimated Cost</div>
            <div style="font-size: 32px; font-weight: 700; color: #1f2937;">$${tokens.estimatedCost || '0.00'}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 5px;">${(tokens.total || 0).toLocaleString()} tokens</div>
          </div>
        </div>

        <!-- Emotion Distribution -->
        <div style="margin-top: 25px; padding-top: 25px; border-top: 1px solid #e5e7eb;">
          <h4 style="margin: 0 0 15px 0; font-size: 16px; font-weight: 600; color: #1f2937;">Emotion Detection Distribution</h4>
          ${this.renderEmotionDistribution(emotions)}
        </div>
      </div>
    `;
  }

  /**
   * Render emotion distribution chart
   */
  renderEmotionDistribution(emotions) {
    const emotionIcons = {
      NEUTRAL: '😐',
      FRUSTRATED: '😤',
      ANGRY: '😡',
      PANICKED: '😱',
      HUMOROUS: '😄',
      STRESSED: '😰',
      SAD: '😢'
    };

    // Ensure emotions is an array
    const emotionArray = Array.isArray(emotions) ? emotions : [];
    
    if (emotionArray.length === 0) {
      return `
        <div style="text-align: center; padding: 20px; color: #6b7280;">
          <div style="font-size: 36px; margin-bottom: 8px;">📊</div>
          <div>No emotion data yet. Make some test calls!</div>
        </div>
      `;
    }

    return `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(80px, 1fr)); gap: 15px;">
        ${emotionArray.map(({ emotion, count, percentage }) => `
          <div style="text-align: center;">
            <div style="font-size: 36px; margin-bottom: 8px;">${emotionIcons[emotion] || '❓'}</div>
            <div style="font-size: 18px; font-weight: 700; color: #1f2937;">${percentage || 0}%</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 3px;">${emotion || 'UNKNOWN'}</div>
            <div style="font-size: 11px; color: #9ca3af;">(${count || 0})</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  /**
   * Render active components section
   */
  renderComponents(components) {
    return `
      <div style="background: white; border-radius: 12px; padding: 25px; margin-bottom: 25px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <h3 style="margin: 0 0 20px 0; font-size: 20px; font-weight: 700; color: #1f2937;">
          ⚙️ Active Orchestration Components
        </h3>
        
        ${Object.entries(components).map(([category, categoryComponents]) => `
          <div style="margin-bottom: 25px;">
            <h4 style="margin: 0 0 15px 0; font-size: 14px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 1px;">
              ${category}
            </h4>
            <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
              ${Object.values(categoryComponents).map(component => this.renderComponentCard(component)).join('')}
            </div>
          </div>
        `).join('')}
      </div>
    `;
  }

  /**
   * Render individual component card
   */
  renderComponentCard(component) {
    const statusColor = component.enabled ? '#10b981' : '#9ca3af';
    const statusIcon = component.enabled ? '✅' : '⏸️';

    return `
      <div style="background: #f9fafb; border-radius: 8px; padding: 18px; border-left: 4px solid ${statusColor};">
        <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 10px;">
          <div style="font-size: 16px; font-weight: 600; color: #1f2937;">${component.name}</div>
          <div style="font-size: 20px;">${statusIcon}</div>
        </div>
        <div style="font-size: 13px; color: #6b7280; margin-bottom: 12px; line-height: 1.5;">
          ${component.description}
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 11px;">
          <div>
            <div style="color: #9ca3af; margin-bottom: 3px;">Target</div>
            <div style="color: #1f2937; font-weight: 600;">${component.performance.target}</div>
          </div>
          <div>
            <div style="color: #9ca3af; margin-bottom: 3px;">Status</div>
            <div style="color: ${statusColor}; font-weight: 600; text-transform: uppercase;">
              ${component.enabled ? 'Active' : 'Disabled'}
            </div>
          </div>
        </div>
      </div>
    `;
  }

  /**
   * Render prompt configuration section with clickable troubleshooting
   */
  renderPromptConfig(activePrompt) {
    if (!activePrompt) {
      return `
        <div style="background: #e0f2fe; border-radius: 12px; padding: 25px; margin-bottom: 25px; border-left: 4px solid #0284c7;">
          <div style="font-size: 16px; font-weight: 600; color: #0369a1; margin-bottom: 8px;">ℹ️ No Live Version Published</div>
          <div style="font-size: 14px; color: #075985;">
            Go to <strong>Cheat Sheet → Version Console</strong> to publish a draft version as live.
            <br><br>
            The agent can still operate using template defaults, but for customized behavior, publish your configuration.
          </div>
        </div>
      `;
    }

    // Determine the source label
    const sourceLabel = activePrompt.source === 'CheatSheetVersion' ? '📋 Live CheatSheet' : '📝 Prompt Version';
    const sourceBadgeColor = activePrompt.source === 'CheatSheetVersion' ? '#10b981' : '#6b7280';

    // Build config items array for clickable list
    const configItems = [];
    
    if (activePrompt.source === 'CheatSheetVersion') {
      // Triage Cards
      configItems.push({
        name: 'Triage Cards',
        icon: activePrompt.hasTriageCards ? '✅' : '❌',
        status: activePrompt.triageStatus || (activePrompt.hasTriageCards ? 'ACTIVE' : 'MISSING'),
        count: activePrompt.triageCardsCount || 0,
        activeCount: activePrompt.activeTriageCardsCount,
        details: activePrompt.triageCardsCount > 0 
          ? `${activePrompt.activeTriageCardsCount || 0} active / ${activePrompt.triageCardsCount} total`
          : 'No cards configured',
        troubleshooting: activePrompt.triageTroubleshooting,
        tabId: 'triage-cards-tab',
        color: activePrompt.triageStatus === 'ACTIVE' ? '#10b981' : activePrompt.triageStatus === 'INACTIVE' ? '#f59e0b' : '#ef4444'
      });
      
      // Frontline-Intel
      configItems.push({
        name: 'Frontline-Intel',
        icon: activePrompt.hasFrontlineIntel ? '✅' : '❌',
        status: activePrompt.frontlineStatus || (activePrompt.hasFrontlineIntel ? 'CONFIGURED' : 'MISSING'),
        details: activePrompt.hasFrontlineIntel ? 'Script configured' : 'No script configured',
        troubleshooting: activePrompt.frontlineTroubleshooting,
        tabId: 'frontline-intel-tab',
        color: activePrompt.hasFrontlineIntel ? '#10b981' : '#ef4444'
      });
      
      // Booking Rules
      configItems.push({
        name: 'Booking Rules',
        icon: activePrompt.hasBookingRules ? '✅' : '❌',
        status: activePrompt.bookingStatus || (activePrompt.hasBookingRules ? 'CONFIGURED' : 'MISSING'),
        details: activePrompt.hasBookingRules ? 'Rules configured' : 'No rules configured',
        troubleshooting: activePrompt.bookingTroubleshooting,
        tabId: 'booking-rules-tab',
        color: activePrompt.hasBookingRules ? '#10b981' : '#ef4444'
      });
    }

    return `
      <div style="background: white; border-radius: 12px; padding: 25px; margin-bottom: 25px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
          <h3 style="margin: 0; font-size: 20px; font-weight: 700; color: #1f2937;">
            ${sourceLabel} Configuration
          </h3>
          <span style="background: ${sourceBadgeColor}; color: white; padding: 4px 12px; border-radius: 20px; font-size: 12px; font-weight: 600;">
            LIVE
          </span>
        </div>
        
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-bottom: 20px;">
          <div>
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Version</div>
            <div style="font-size: 18px; font-weight: 700; color: #1f2937;">${activePrompt.version || 'N/A'}</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Version ID</div>
            <div style="font-size: 14px; font-weight: 700; color: #1f2937; font-family: monospace;">${activePrompt.versionHash || activePrompt.versionId?.substring(0, 12) || 'N/A'}</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Published At</div>
            <div style="font-size: 14px; font-weight: 700; color: #1f2937;">${activePrompt.deployedAt ? new Date(activePrompt.deployedAt).toLocaleString() : 'Unknown'}</div>
          </div>
        </div>
        
        ${activePrompt.source === 'CheatSheetVersion' ? `
        <!-- Clickable Configuration Items -->
        <div style="border-top: 1px solid #e5e7eb; padding-top: 20px;">
          <h4 style="margin: 0 0 15px 0; font-size: 14px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px;">
            🔧 Configuration Status (Click to fix)
          </h4>
          <div style="display: flex; flex-direction: column; gap: 12px;">
            ${configItems.map(item => `
              <div 
                onclick="window.agentStatusManager.navigateToTab('${item.tabId}')" 
                style="display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background: ${item.status === 'ACTIVE' || item.status === 'CONFIGURED' ? '#f0fdf4' : item.status === 'INACTIVE' ? '#fefce8' : '#fef2f2'}; border-radius: 8px; cursor: pointer; transition: all 0.2s; border-left: 4px solid ${item.color};"
                onmouseover="this.style.transform='translateX(5px)'; this.style.boxShadow='0 2px 8px rgba(0,0,0,0.1)';"
                onmouseout="this.style.transform='translateX(0)'; this.style.boxShadow='none';"
              >
                <div style="display: flex; align-items: center; gap: 12px;">
                  <span style="font-size: 24px;">${item.icon}</span>
                  <div>
                    <div style="font-size: 15px; font-weight: 600; color: #1f2937;">${item.name}</div>
                    <div style="font-size: 13px; color: #6b7280;">${item.details}</div>
                    ${item.troubleshooting ? `
                      <div style="font-size: 12px; color: ${item.color}; margin-top: 4px; font-weight: 500;">
                        💡 ${item.troubleshooting}
                      </div>
                    ` : ''}
                  </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px;">
                  <span style="background: ${item.color}; color: white; padding: 4px 10px; border-radius: 20px; font-size: 11px; font-weight: 600; text-transform: uppercase;">
                    ${item.status}
                  </span>
                  <span style="font-size: 18px; color: #9ca3af;">▶</span>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        ` : ''}
      </div>
    `;
  }

  /**
   * Navigate to a specific tab in the Control Plane
   */
  navigateToTab(tabId) {
    console.log('[AGENT STATUS] Navigating to tab:', tabId);
    
    // Try to find and click the tab
    const tab = document.getElementById(tabId);
    if (tab) {
      tab.click();
      // Scroll to the tab content
      setTimeout(() => {
        const tabContent = document.querySelector(`[data-tab-content="${tabId}"]`);
        if (tabContent) {
          tabContent.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 100);
    } else {
      console.warn('[AGENT STATUS] Tab not found:', tabId);
      // Show a toast notification
      this.showNotification(`Navigate to "${tabId.replace('-tab', '').replace(/-/g, ' ')}" tab to configure`, 'info');
    }
  }

  /**
   * Show notification toast
   */
  showNotification(message, type = 'info') {
    const colors = {
      info: '#3b82f6',
      success: '#10b981',
      warning: '#f59e0b',
      error: '#ef4444'
    };
    
    const toast = document.createElement('div');
    toast.style.cssText = `
      position: fixed;
      bottom: 20px;
      right: 20px;
      background: ${colors[type]};
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10000;
      animation: slideIn 0.3s ease;
    `;
    toast.textContent = message;
    document.body.appendChild(toast);
    
    setTimeout(() => {
      toast.style.animation = 'slideOut 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }

  /**
   * Render health checks section
   */
  renderHealthChecks(health) {
    const getStatusColor = (status) => {
      return status === 'healthy' ? '#10b981' : status === 'degraded' ? '#f59e0b' : '#ef4444';
    };

    const getStatusIcon = (status) => {
      return status === 'healthy' ? '✅' : status === 'degraded' ? '⚠️' : '❌';
    };

    return `
      <div style="background: white; border-radius: 12px; padding: 25px; margin-bottom: 25px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <h3 style="margin: 0 0 20px 0; font-size: 20px; font-weight: 700; color: #1f2937;">
          🏥 System Health Checks
        </h3>
        
        <div style="display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px;">
          ${Object.entries(health.checks).map(([name, check]) => `
            <div style="background: #f9fafb; border-radius: 8px; padding: 18px; border-left: 4px solid ${getStatusColor(check.status)};">
              <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                <div style="font-size: 16px; font-weight: 600; color: #1f2937; text-transform: capitalize;">${name}</div>
                <div style="font-size: 20px;">${getStatusIcon(check.status)}</div>
              </div>
              <div style="font-size: 13px; color: #6b7280;">${check.message}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  /**
   * Render LLM Configuration section - THE HEART OF LLM-0
   */
  async renderLLMConfig() {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/agent-status/${this.companyId}/llm-config`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!response.ok) {
        console.warn('[AGENT STATUS] Failed to load LLM config');
        return '';
      }
      
      const data = await response.json();
      const { llmConfig, modelOptions } = data;
      const currentModel = modelOptions.find(m => m.id === llmConfig.routingModel) || modelOptions[0];
      
      return `
        <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); border-radius: 12px; padding: 25px; margin-bottom: 25px; color: white; box-shadow: 0 4px 15px rgba(30, 27, 75, 0.3);">
          <div style="display: flex; justify-content: space-between; align-items: start; margin-bottom: 20px;">
            <div>
              <h3 style="margin: 0 0 8px 0; font-size: 20px; font-weight: 700; display: flex; align-items: center; gap: 10px;">
                🤖 LLM Configuration
                <span style="background: rgba(255,255,255,0.2); padding: 3px 10px; border-radius: 12px; font-size: 11px; font-weight: 600;">
                  BRAIN POWER
                </span>
              </h3>
              <p style="margin: 0; font-size: 14px; opacity: 0.8;">
                The AI model powering your Frontline-Intel routing decisions
              </p>
            </div>
            <button 
              onclick="window.agentStatusManager.showLLMConfigModal()"
              style="background: white; color: #1e1b4b; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; display: flex; align-items: center; gap: 8px; transition: transform 0.2s;"
              onmouseover="this.style.transform='scale(1.05)'"
              onmouseout="this.style.transform='scale(1)'"
            >
              ⚙️ Configure
            </button>
          </div>
          
          <div style="display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 20px;">
            <div style="background: rgba(255,255,255,0.1); border-radius: 10px; padding: 18px;">
              <div style="font-size: 12px; opacity: 0.7; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Current Model</div>
              <div style="font-size: 20px; font-weight: 700;">${currentModel.name}</div>
              ${currentModel.recommended ? '<div style="font-size: 11px; color: #86efac; margin-top: 4px;">✓ Recommended</div>' : ''}
            </div>
            <div style="background: rgba(255,255,255,0.1); border-radius: 10px; padding: 18px;">
              <div style="font-size: 12px; opacity: 0.7; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Speed</div>
              <div style="font-size: 20px; font-weight: 700;">${currentModel.speed}</div>
              <div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">avg response time</div>
            </div>
            <div style="background: rgba(255,255,255,0.1); border-radius: 10px; padding: 18px;">
              <div style="font-size: 12px; opacity: 0.7; margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.5px;">Cost</div>
              <div style="font-size: 20px; font-weight: 700;">${currentModel.cost}</div>
              <div style="font-size: 11px; opacity: 0.7; margin-top: 4px;">estimated usage</div>
            </div>
          </div>
          
          <div style="margin-top: 18px; padding-top: 18px; border-top: 1px solid rgba(255,255,255,0.15); font-size: 13px; opacity: 0.8;">
            💡 <strong>Tip:</strong> ${currentModel.description}
          </div>
        </div>
      `;
    } catch (error) {
      console.error('[AGENT STATUS] Error rendering LLM config:', error);
      return '';
    }
  }

  /**
   * Open the AI Agent Excellence Center
   */
  async openExcellenceCenter() {
    try {
      // Dynamically load the AgentExcellenceCenter module if not already loaded
      if (!window.AgentExcellenceCenter) {
        const script = document.createElement('script');
        script.src = '/js/ai-agent-settings/AgentExcellenceCenter.js';
        document.head.appendChild(script);
        
        // Wait for script to load
        await new Promise((resolve, reject) => {
          script.onload = resolve;
          script.onerror = reject;
        });
      }
      
      // Create and open the excellence center
      window.agentExcellenceCenter = new window.AgentExcellenceCenter(this.companyId);
      await window.agentExcellenceCenter.open();
      
    } catch (error) {
      console.error('[AGENT STATUS] Failed to open Excellence Center:', error);
      this.showNotification('Failed to open Excellence Center: ' + error.message, 'error');
    }
  }

  /**
   * Show LLM Configuration Modal
   */
  async showLLMConfigModal() {
    try {
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/agent-status/${this.companyId}/llm-config`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      const data = await response.json();
      const { llmConfig, modelOptions } = data;
      
      const modal = document.createElement('div');
      modal.id = 'llm-config-modal';
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.7); display: flex;
        align-items: center; justify-content: center;
        z-index: 10000; padding: 20px;
      `;
      
      modal.innerHTML = `
        <div style="background: white; border-radius: 16px; max-width: 600px; width: 100%; max-height: 90vh; overflow: hidden; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
          <!-- Header -->
          <div style="background: linear-gradient(135deg, #1e1b4b 0%, #312e81 100%); color: white; padding: 24px;">
            <h2 style="margin: 0 0 8px 0; font-size: 24px; font-weight: 700;">🤖 Configure LLM Model</h2>
            <p style="margin: 0; opacity: 0.8; font-size: 14px;">Choose the AI model for Frontline-Intel routing</p>
          </div>
          
          <!-- Content -->
          <div style="padding: 24px; max-height: 400px; overflow-y: auto;">
            ${modelOptions.map(model => `
              <label 
                style="display: block; padding: 18px; margin-bottom: 12px; border: 2px solid ${model.id === llmConfig.routingModel ? '#6366f1' : '#e5e7eb'}; border-radius: 12px; cursor: pointer; transition: all 0.2s; ${model.deprecated ? 'opacity: 0.6;' : ''}"
                onmouseover="this.style.borderColor='#6366f1'"
                onmouseout="this.style.borderColor='${model.id === llmConfig.routingModel ? '#6366f1' : '#e5e7eb'}'"
              >
                <div style="display: flex; justify-content: space-between; align-items: start;">
                  <div style="display: flex; align-items: center; gap: 12px;">
                    <input 
                      type="radio" 
                      name="llm-model" 
                      value="${model.id}" 
                      ${model.id === llmConfig.routingModel ? 'checked' : ''}
                      style="width: 20px; height: 20px; accent-color: #6366f1;"
                    >
                    <div>
                      <div style="font-size: 16px; font-weight: 600; color: #1f2937; display: flex; align-items: center; gap: 8px;">
                        ${model.name}
                        ${model.recommended ? '<span style="background: #dcfce7; color: #166534; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;">RECOMMENDED</span>' : ''}
                        ${model.deprecated ? '<span style="background: #fee2e2; color: #991b1b; padding: 2px 8px; border-radius: 10px; font-size: 10px; font-weight: 600;">LEGACY</span>' : ''}
                      </div>
                      <div style="font-size: 13px; color: #6b7280; margin-top: 4px;">${model.description}</div>
                    </div>
                  </div>
                </div>
                <div style="display: flex; gap: 20px; margin-top: 12px; margin-left: 32px;">
                  <div style="font-size: 12px; color: #6b7280;">
                    <span style="font-weight: 600; color: #1f2937;">Speed:</span> ${model.speed}
                  </div>
                  <div style="font-size: 12px; color: #6b7280;">
                    <span style="font-weight: 600; color: #1f2937;">Cost:</span> ${model.cost}
                  </div>
                </div>
              </label>
            `).join('')}
          </div>
          
          <!-- Footer -->
          <div style="padding: 20px 24px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; background: #f9fafb;">
            <div style="font-size: 13px; color: #6b7280;">
              💡 Changes take effect immediately
            </div>
            <div style="display: flex; gap: 12px;">
              <button 
                onclick="document.getElementById('llm-config-modal').remove()" 
                style="background: #6b7280; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;"
              >
                Cancel
              </button>
              <button 
                onclick="window.agentStatusManager.saveLLMConfig()" 
                style="background: #6366f1; color: white; border: none; padding: 10px 20px; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer;"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      `;
      
      document.body.appendChild(modal);
      
    } catch (error) {
      console.error('[AGENT STATUS] Error showing LLM config modal:', error);
      this.showNotification('Failed to load LLM configuration', 'error');
    }
  }

  /**
   * Save LLM Configuration
   */
  async saveLLMConfig() {
    try {
      const selectedModel = document.querySelector('input[name="llm-model"]:checked')?.value;
      
      if (!selectedModel) {
        this.showNotification('Please select a model', 'warning');
        return;
      }
      
      const token = localStorage.getItem('adminToken');
      const response = await fetch(`/api/admin/agent-status/${this.companyId}/llm-config`, {
        method: 'PUT',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ routingModel: selectedModel })
      });
      
      const data = await response.json();
      
      if (data.success) {
        this.showNotification(`LLM model updated to ${selectedModel}`, 'success');
        document.getElementById('llm-config-modal')?.remove();
        // Refresh the dashboard to show new model
        await this.init();
      } else {
        this.showNotification(data.error || 'Failed to update LLM config', 'error');
      }
      
    } catch (error) {
      console.error('[AGENT STATUS] Error saving LLM config:', error);
      this.showNotification('Failed to save LLM configuration', 'error');
    }
  }

  /**
   * Render auto-refresh control
   */
  renderRefreshControl() {
    return `
      <div style="text-align: center; padding: 20px; background: #f9fafb; border-radius: 8px;">
        <div style="font-size: 13px; color: #6b7280; margin-bottom: 10px;">
          🔄 Auto-refresh enabled (every ${this.autoRefreshSeconds} seconds)
        </div>
        <button onclick="window.agentStatusManager.refresh()" style="background: #667eea; color: white; border: none; padding: 10px 24px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer; transition: all 0.2s;">
          Refresh Now
        </button>
      </div>
    `;
  }

  /**
   * Render error state
   */
  renderError(message) {
    const container = document.getElementById('agent-status-container');
    if (!container) return;

    container.innerHTML = `
      <div style="background: #fee2e2; border-radius: 12px; padding: 30px; border-left: 4px solid #ef4444;">
        <div style="font-size: 20px; font-weight: 600; color: #991b1b; margin-bottom: 10px;">❌ Failed to Load Agent Status</div>
        <div style="font-size: 14px; color: #7f1d1d;">${message}</div>
        <div style="display: flex; gap: 12px; margin-top: 20px;">
          <button onclick="window.agentStatusManager.init()" style="background: #ef4444; color: white; border: none; padding: 10px 24px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;">
            Retry
          </button>
          <button onclick="window.agentStatusManager.showTroubleshootingModal()" style="background: #1f2937; color: white; border: none; padding: 10px 24px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;">
            🔧 Troubleshooting Details
          </button>
        </div>
      </div>
    `;
  }

  /**
   * Manually refresh dashboard
   */
  async refresh() {
    console.log('[AGENT STATUS] Manual refresh triggered');
    await this.init();
  }

  /**
   * Start auto-refresh interval
   * FIXED: Call refresh() not init() to prevent interval stacking
   */
  startAutoRefresh() {
    // Guard: Don't create multiple intervals
    if (this.refreshInterval) {
      return; // Already running
    }

    this.refreshInterval = setInterval(async () => {
      console.log('[AGENT STATUS] Auto-refreshing...');
      await this.refresh(); // Use refresh(), NOT init() - prevents interval stacking
    }, this.autoRefreshSeconds * 1000);
  }
  
  /**
   * Refresh data without reinitializing
   */
  async refresh() {
    try {
      const [status, metrics, health] = await Promise.all([
        this.fetchStatus(),
        this.fetchMetrics(),
        this.fetchHealth()
      ]);
      
      this.status = status;
      this.metrics = metrics;
      this.health = health;
      
      this.render();
    } catch (error) {
      console.error('[AGENT STATUS] Refresh failed:', error.message);
    }
  }

  /**
   * Stop auto-refresh
   */
  stopAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
    }
  }

  /**
   * Start background health monitoring (runs even when tab is closed)
   * This keeps the tab indicator always up-to-date
   */
  startBackgroundMonitoring() {
    // Silent start - no console spam
    
    // Initial check
    this.updateTabHealth();
    
    // Set up interval
    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval);
    }
    
    this.backgroundInterval = setInterval(async () => {
      await this.updateTabHealth();
    }, this.backgroundRefreshSeconds * 1000);
  }

  /**
   * Update tab health indicator in background
   */
  async updateTabHealth() {
    try {
      const health = await this.fetchPlatformHealth();
      
      // Update tab indicator with current health status
      this.updateTabIndicator(health.status);
      // Silent success - no console spam
    } catch (error) {
      // Only log real errors, not network blips
      if (error.message && !error.message.includes('fetch')) {
        console.warn('[AGENT STATUS] Health check error:', error.message);
      }
      this.updateTabIndicator('down');
    }
  }

  /**
   * Stop background monitoring
   */
  stopBackgroundMonitoring() {
    if (this.backgroundInterval) {
      clearInterval(this.backgroundInterval);
      this.backgroundInterval = null;
    }
  }

  /**
   * Count active components
   */
  countActiveComponents(components) {
    let count = 0;
    for (const category of Object.values(components)) {
      for (const component of Object.values(category)) {
        if (component.enabled) count++;
      }
    }
    return count;
  }

  /**
   * Show troubleshooting modal with full diagnostic details
   */
  async showTroubleshootingModal() {
    console.log('[AGENT STATUS] Opening troubleshooting modal');

    // Collect comprehensive diagnostic data
    const diagnostics = await this.collectDiagnostics();

    // Create modal
    const modal = document.createElement('div');
    modal.id = 'troubleshooting-modal';
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.8);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      padding: 20px;
    `;

    modal.innerHTML = `
      <div style="background: white; border-radius: 16px; max-width: 900px; width: 100%; max-height: 90vh; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);">
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #dc2626 0%, #991b1b 100%); color: white; padding: 24px; display: flex; justify-content: space-between; align-items: center;">
          <div>
            <h2 style="margin: 0; font-size: 24px; font-weight: 700;">🔧 Troubleshooting Diagnostics</h2>
            <p style="margin: 8px 0 0 0; font-size: 14px; opacity: 0.9;">Copy and paste this to your developer for analysis</p>
          </div>
          <button onclick="document.getElementById('troubleshooting-modal').remove()" style="background: rgba(255,255,255,0.2); border: none; color: white; width: 36px; height: 36px; border-radius: 50%; cursor: pointer; font-size: 20px; line-height: 1;">
            ×
          </button>
        </div>

        <!-- Content -->
        <div style="flex: 1; overflow-y: auto; padding: 24px;">
          <div style="background: #f9fafb; border-radius: 8px; padding: 20px; font-family: 'Courier New', monospace; font-size: 13px; line-height: 1.6; white-space: pre-wrap; word-wrap: break-word; color: #1f2937; border: 1px solid #e5e7eb;">
${diagnostics}
          </div>
        </div>

        <!-- Footer -->
        <div style="padding: 20px 24px; border-top: 1px solid #e5e7eb; display: flex; justify-content: space-between; align-items: center; background: #f9fafb;">
          <div style="font-size: 13px; color: #6b7280;">
            💡 Share this entire report with your developer
          </div>
          <div style="display: flex; gap: 12px;">
            <button onclick="navigator.clipboard.writeText(document.querySelector('#troubleshooting-modal pre').textContent); this.innerHTML='✅ Copied!'; setTimeout(() => this.innerHTML='📋 Copy to Clipboard', 2000);" style="background: #3b82f6; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;">
              📋 Copy to Clipboard
            </button>
            <button onclick="document.getElementById('troubleshooting-modal').remove()" style="background: #6b7280; color: white; border: none; padding: 10px 20px; border-radius: 6px; font-size: 14px; font-weight: 600; cursor: pointer;">
              Close
            </button>
          </div>
        </div>
      </div>
    `;

    // Wrap content in <pre> for clipboard copying
    const contentDiv = modal.querySelector('div[style*="font-family"]');
    const pre = document.createElement('pre');
    pre.textContent = diagnostics;
    pre.style.cssText = 'margin: 0; white-space: pre-wrap; word-wrap: break-word;';
    contentDiv.innerHTML = '';
    contentDiv.appendChild(pre);

    document.body.appendChild(modal);
  }

  /**
   * Collect comprehensive diagnostic information
   */
  async collectDiagnostics() {
    const timestamp = new Date().toISOString();
    const token = localStorage.getItem('adminToken');
    
    let diagnosticReport = `
═══════════════════════════════════════════════════════════════════
AGENT STATUS TROUBLESHOOTING REPORT
═══════════════════════════════════════════════════════════════════
Generated: ${timestamp}
Company ID: ${this.companyId}
Browser: ${navigator.userAgent}
URL: ${window.location.href}

═══════════════════════════════════════════════════════════════════
1. AUTHENTICATION CHECK
═══════════════════════════════════════════════════════════════════
Auth Token Present: ${token ? 'YES' : 'NO'}
Token Length: ${token ? token.length + ' characters' : 'N/A'}
Token Preview: ${token ? token.substring(0, 20) + '...' : 'N/A'}

═══════════════════════════════════════════════════════════════════
2. API ENDPOINT TESTS
═══════════════════════════════════════════════════════════════════
`;

    // Test each API endpoint
    const endpointResults = [];
    const endpoints = [
      { name: 'Status', url: `/api/admin/agent-status/${this.companyId}` },
      { name: 'Metrics', url: `/api/admin/agent-status/${this.companyId}/metrics?timeRange=24h` },
      { name: 'Health', url: `/api/admin/agent-status/${this.companyId}/health` }
    ];

    for (const endpoint of endpoints) {
      try {
        const response = await fetch(endpoint.url, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const responseText = await response.text();
        let responseData;
        try {
          responseData = JSON.parse(responseText);
        } catch {
          responseData = responseText;
        }

        // Store for analysis
        endpointResults.push({
          name: endpoint.name,
          url: endpoint.url,
          status: response.status,
          data: responseData,
          error: response.status >= 400 ? { status: response.status, statusText: response.statusText } : null
        });

        diagnosticReport += `
[${endpoint.name} Endpoint]
URL: ${endpoint.url}
Status: ${response.status} ${response.statusText}
Response Headers:
${Array.from(response.headers.entries()).map(([k, v]) => `  ${k}: ${v}`).join('\n')}

Response Body:
${JSON.stringify(responseData, null, 2)}

`;
      } catch (error) {
        // Store error for analysis
        endpointResults.push({
          name: endpoint.name,
          url: endpoint.url,
          error: { message: error.message, stack: error.stack }
        });

        diagnosticReport += `
[${endpoint.name} Endpoint]
URL: ${endpoint.url}
❌ ERROR: ${error.message}
Stack: ${error.stack}

`;
      }
    }

    diagnosticReport += `
═══════════════════════════════════════════════════════════════════
3. BROWSER CONSOLE LOGS (Last 50)
═══════════════════════════════════════════════════════════════════
`;

    // Capture console logs if available
    if (window.consoleHistory && window.consoleHistory.length > 0) {
      diagnosticReport += window.consoleHistory.slice(-50).join('\n');
    } else {
      diagnosticReport += '(Console logging not captured - check browser console manually)';
    }

    diagnosticReport += `

═══════════════════════════════════════════════════════════════════
4. NETWORK ERRORS
═══════════════════════════════════════════════════════════════════
`;

    // Check for network errors in Performance API
    if (window.performance && window.performance.getEntriesByType) {
      const resources = window.performance.getEntriesByType('resource');
      const failedResources = resources.filter(r => r.name.includes('agent-status'));
      
      if (failedResources.length > 0) {
        failedResources.forEach(r => {
          diagnosticReport += `
Failed Resource: ${r.name}
Duration: ${r.duration}ms
Transfer Size: ${r.transferSize} bytes
`;
        });
      } else {
        diagnosticReport += 'No failed agent-status resources detected';
      }
    }

    diagnosticReport += `

═══════════════════════════════════════════════════════════════════
5. COMPONENT LOAD STATUS
═══════════════════════════════════════════════════════════════════
AgentStatusManager Class: ${typeof window.AgentStatusManager !== 'undefined' ? 'LOADED ✓' : 'MISSING ✗'}
Manager Instance: ${window.agentStatusManager ? 'EXISTS ✓' : 'MISSING ✗'}
Auto-Refresh Active: ${this.refreshInterval ? 'YES' : 'NO'}

═══════════════════════════════════════════════════════════════════
6. BROWSER ENVIRONMENT
═══════════════════════════════════════════════════════════════════
Window Width: ${window.innerWidth}px
Window Height: ${window.innerHeight}px
Online Status: ${navigator.onLine ? 'ONLINE' : 'OFFLINE'}
Cookies Enabled: ${navigator.cookieEnabled ? 'YES' : 'NO'}
Local Storage Available: ${typeof localStorage !== 'undefined' ? 'YES' : 'NO'}

═══════════════════════════════════════════════════════════════════
7. RECOMMENDED ACTIONS
═══════════════════════════════════════════════════════════════════
`;

    // Analyze all collected data and provide intelligent recommendations
    const analysis = this.analyzeErrors(endpointResults, token);
    diagnosticReport += analysis;

    diagnosticReport += `

═══════════════════════════════════════════════════════════════════
8. QUICK REFERENCE & LINKS
═══════════════════════════════════════════════════════════════════
📋 Copy Report: Use "Copy to Clipboard" button in modal
🔗 Render Dashboard: https://dashboard.render.com/web/srv-cskr6r3v2p9s73el05p0
🗄️ MongoDB Atlas: https://cloud.mongodb.com
🔴 Redis: Check REDIS_URL in Render environment variables
📧 Developer: Paste this report for instant diagnosis

═══════════════════════════════════════════════════════════════════
END OF REPORT
═══════════════════════════════════════════════════════════════════
`;

    return diagnosticReport;
  }

  /**
   * Analyze errors and provide intelligent fix recommendations
   */
  analyzeErrors(endpoints, token) {
    let analysis = '\n';
    let criticalIssues = [];
    let warnings = [];
    let suggestions = [];

    // Check authentication
    if (!token) {
      criticalIssues.push({
        issue: 'No Authentication Token',
        impact: 'Cannot make API requests',
        fix: 'Log out and log back in to get a fresh token'
      });
    }

    // Check network
    if (!navigator.onLine) {
      criticalIssues.push({
        issue: 'Browser Offline',
        impact: 'No internet connectivity',
        fix: 'Check your internet connection and try again'
      });
    }

    // Analyze each endpoint response
    endpoints.forEach(endpoint => {
      if (endpoint.error) {
        if (endpoint.error.status === 401) {
          criticalIssues.push({
            issue: `Authentication Failed (${endpoint.name})`,
            impact: 'Token expired or invalid',
            fix: 'Refresh the page or log out and log back in'
          });
        } else if (endpoint.error.status >= 500) {
          criticalIssues.push({
            issue: `Server Error (${endpoint.name})`,
            impact: 'Backend service is down or malfunctioning',
            fix: 'Check Render logs at https://dashboard.render.com'
          });
        } else if (endpoint.error.status === 404) {
          warnings.push({
            issue: `Endpoint Not Found (${endpoint.name})`,
            impact: 'API route may not be registered',
            fix: 'Check that the route is registered in index.js'
          });
        }
      } else if (endpoint.data) {
        // Analyze response data for specific issues
        if (endpoint.data.checks) {
          // Health endpoint analysis
          if (endpoint.data.checks.redis && endpoint.data.checks.redis.status === 'down') {
            const redisMsg = endpoint.data.checks.redis.message;
            
            if (redisMsg.includes('not initialized')) {
              criticalIssues.push({
                issue: 'Redis Not Initialized',
                impact: 'Cache unavailable, performance degraded',
                fix: 'Check REDIS_URL environment variable in Render dashboard'
              });
            } else if (redisMsg.includes('is not a function')) {
              criticalIssues.push({
                issue: 'Redis Method Mismatch',
                impact: 'Using wrong Redis client API version',
                fix: 'Update Redis client calls to use v5+ syntax (set with EX option)'
              });
            } else if (redisMsg.includes('ECONNREFUSED') || redisMsg.includes('connection')) {
              criticalIssues.push({
                issue: 'Redis Connection Failed',
                impact: 'Cannot connect to Redis server',
                fix: 'Verify REDIS_URL is correct and Redis service is running'
              });
            } else {
              warnings.push({
                issue: 'Redis Unhealthy',
                impact: redisMsg,
                fix: 'Check Render logs for Redis connection errors'
              });
            }
          }

          if (endpoint.data.checks.database && endpoint.data.checks.database.status !== 'healthy') {
            criticalIssues.push({
              issue: 'Database Connection Failed',
              impact: 'Cannot access MongoDB',
              fix: 'Check MONGODB_URI environment variable and MongoDB Atlas status'
            });
          }

          if (endpoint.data.checks.llm && endpoint.data.checks.llm.status !== 'healthy') {
            warnings.push({
              issue: 'LLM Configuration Issue',
              impact: endpoint.data.checks.llm.message,
              fix: 'Add OPENAI_API_KEY to Render environment variables'
            });
          }
        }

        // Check metrics for anomalies
        if (endpoint.data.metrics) {
          if (endpoint.data.metrics.routing && endpoint.data.metrics.routing.status === 'critical') {
            if (endpoint.data.metrics.calls.total === 0) {
              suggestions.push({
                issue: 'No Call Data Yet',
                impact: 'Routing accuracy shows critical because no calls have been made',
                fix: 'Make a test call to your Twilio number to populate metrics'
              });
            } else {
              warnings.push({
                issue: 'Low Routing Accuracy',
                impact: `Only ${endpoint.data.metrics.routing.accuracy}% accuracy`,
                fix: 'Review routing decision logs and tune prompts'
              });
            }
          }
        }
      }
    });

    // Build the analysis section
    if (criticalIssues.length > 0) {
      analysis += '\n🚨 CRITICAL ISSUES (Fix These First):\n';
      analysis += '─'.repeat(67) + '\n';
      criticalIssues.forEach((item, i) => {
        analysis += `\n${i + 1}. ${item.issue}\n`;
        analysis += `   Impact: ${item.impact}\n`;
        analysis += `   ✅ Fix: ${item.fix}\n`;
      });
    }

    if (warnings.length > 0) {
      analysis += '\n\n⚠️  WARNINGS (Should Fix Soon):\n';
      analysis += '─'.repeat(67) + '\n';
      warnings.forEach((item, i) => {
        analysis += `\n${i + 1}. ${item.issue}\n`;
        analysis += `   Impact: ${item.impact}\n`;
        analysis += `   ✅ Fix: ${item.fix}\n`;
      });
    }

    if (suggestions.length > 0) {
      analysis += '\n\n💡 SUGGESTIONS (Optional Improvements):\n';
      analysis += '─'.repeat(67) + '\n';
      suggestions.forEach((item, i) => {
        analysis += `\n${i + 1}. ${item.issue}\n`;
        analysis += `   Impact: ${item.impact}\n`;
        analysis += `   ✅ Fix: ${item.fix}\n`;
      });
    }

    if (criticalIssues.length === 0 && warnings.length === 0) {
      analysis += '\n✅ NO ISSUES DETECTED\n';
      analysis += '─'.repeat(67) + '\n';
      analysis += 'All systems appear to be functioning correctly.\n';
      if (suggestions.length === 0) {
        analysis += 'If you\'re still seeing errors, check the API endpoint responses above.\n';
      }
    }

    return analysis;
  }

  /**
   * Update tab indicator color based on health status
   */
  updateTabIndicator(status) {
    const indicator = document.getElementById('agent-status-indicator');
    if (!indicator) return;

    const statusMap = {
      'healthy': '🟢',
      'degraded': '🟡',
      'down': '🔴'
    };

    indicator.textContent = statusMap[status] || '🔴';
  }

  /**
   * Cleanup on destroy
   */
  destroy() {
    this.stopAutoRefresh();
    this.stopBackgroundMonitoring();
  }
}

// Export to window for global access
window.AgentStatusManager = AgentStatusManager;

console.log('✅ [AGENT STATUS MANAGER] Loaded and available globally');


