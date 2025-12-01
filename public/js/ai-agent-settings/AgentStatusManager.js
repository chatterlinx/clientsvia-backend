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
    this.autoRefreshSeconds = 30;
    
    console.log('[AGENT STATUS] Manager initialized', { companyId });
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
   * Fetch system health
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
   * Render the complete dashboard
   */
  render(status, metrics, health) {
    const container = document.getElementById('agent-status-container');
    if (!container) {
      console.error('[AGENT STATUS] Container not found');
      return;
    }

    container.innerHTML = `
      <!-- System Status Overview -->
      ${this.renderStatusOverview(status, health)}

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
    const { calls, performance, routing, tokens } = metrics.metrics;

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
            <div style="font-size: 32px; font-weight: 700; color: #1f2937;">${calls.total}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 5px;">${calls.avgPerHour}/hr avg</div>
          </div>

          <!-- Latency -->
          <div style="background: #f9fafb; border-radius: 8px; padding: 20px; border-left: 4px solid ${getStatusColor(performance.status)};">
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Avg Latency</div>
            <div style="font-size: 32px; font-weight: 700; color: ${getStatusColor(performance.status)};">${performance.avgLatency}ms</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 5px;">Target: ${performance.target}ms</div>
          </div>

          <!-- Routing Accuracy -->
          <div style="background: #f9fafb; border-radius: 8px; padding: 20px; border-left: 4px solid ${getStatusColor(routing.status)};">
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Routing Accuracy</div>
            <div style="font-size: 32px; font-weight: 700; color: ${getStatusColor(routing.status)};">${routing.accuracy}%</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 5px;">${routing.correctRoutes} correct / ${routing.incorrectRoutes} errors</div>
          </div>

          <!-- Cost -->
          <div style="background: #f9fafb; border-radius: 8px; padding: 20px;">
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Estimated Cost</div>
            <div style="font-size: 32px; font-weight: 700; color: #1f2937;">$${tokens.estimatedCost}</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 5px;">${tokens.total.toLocaleString()} tokens</div>
          </div>
        </div>

        <!-- Emotion Distribution -->
        <div style="margin-top: 25px; padding-top: 25px; border-top: 1px solid #e5e7eb;">
          <h4 style="margin: 0 0 15px 0; font-size: 16px; font-weight: 600; color: #1f2937;">Emotion Detection Distribution</h4>
          ${this.renderEmotionDistribution(metrics.metrics.emotions)}
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

    return `
      <div style="display: grid; grid-template-columns: repeat(7, 1fr); gap: 15px;">
        ${emotions.map(({ emotion, count, percentage }) => `
          <div style="text-align: center;">
            <div style="font-size: 36px; margin-bottom: 8px;">${emotionIcons[emotion] || '❓'}</div>
            <div style="font-size: 18px; font-weight: 700; color: #1f2937;">${percentage}%</div>
            <div style="font-size: 12px; color: #6b7280; margin-top: 3px;">${emotion}</div>
            <div style="font-size: 11px; color: #9ca3af;">(${count})</div>
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
   * Render prompt configuration section
   */
  renderPromptConfig(activePrompt) {
    if (!activePrompt) {
      return `
        <div style="background: #fef3c7; border-radius: 12px; padding: 25px; margin-bottom: 25px; border-left: 4px solid #f59e0b;">
          <div style="font-size: 16px; font-weight: 600; color: #92400e; margin-bottom: 8px;">⚠️ No Active Prompt</div>
          <div style="font-size: 14px; color: #78350f;">No prompt version is currently deployed. The agent is using default configuration.</div>
        </div>
      `;
    }

    return `
      <div style="background: white; border-radius: 12px; padding: 25px; margin-bottom: 25px; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
        <h3 style="margin: 0 0 20px 0; font-size: 20px; font-weight: 700; color: #1f2937;">
          📝 Active Prompt Configuration
        </h3>
        
        <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px;">
          <div>
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Version</div>
            <div style="font-size: 18px; font-weight: 700; color: #1f2937;">${activePrompt.version}</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Version Hash</div>
            <div style="font-size: 18px; font-weight: 700; color: #1f2937; font-family: monospace;">${activePrompt.versionHash.substring(0, 8)}</div>
          </div>
          <div>
            <div style="font-size: 12px; color: #6b7280; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px;">Triage Cards</div>
            <div style="font-size: 18px; font-weight: 700; color: #1f2937;">${activePrompt.triageCardsCount} cards</div>
          </div>
        </div>
        
        <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #e5e7eb;">
          <div style="font-size: 12px; color: #6b7280; margin-bottom: 5px;">Deployed At</div>
          <div style="font-size: 14px; color: #1f2937;">${new Date(activePrompt.deployedAt).toLocaleString()}</div>
        </div>
      </div>
    `;
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
   */
  startAutoRefresh() {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }

    this.refreshInterval = setInterval(async () => {
      console.log('[AGENT STATUS] Auto-refreshing...');
      await this.init();
    }, this.autoRefreshSeconds * 1000);
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

    if (!token) {
      diagnosticReport += '❌ CRITICAL: No auth token found. User needs to log in again.\n';
    }
    if (!navigator.onLine) {
      diagnosticReport += '❌ CRITICAL: Browser is offline. Check internet connection.\n';
    }

    diagnosticReport += `
📋 COPY THIS ENTIRE REPORT and send it to your developer for analysis.

═══════════════════════════════════════════════════════════════════
END OF REPORT
═══════════════════════════════════════════════════════════════════
`;

    return diagnosticReport;
  }

  /**
   * Cleanup on destroy
   */
  destroy() {
    this.stopAutoRefresh();
  }
}

// Export to window for global access
window.AgentStatusManager = AgentStatusManager;

console.log('✅ [AGENT STATUS MANAGER] Loaded and available globally');

