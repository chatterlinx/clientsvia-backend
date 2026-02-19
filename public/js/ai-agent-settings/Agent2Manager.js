/**
 * ============================================================================
 * AGENT 2.0 MANAGER (Control Plane UI)
 * ============================================================================
 *
 * Goals:
 * - Clean, isolated UI surface (no dependency on FrontDeskBehaviorManager)
 * - UI-only truth: edits save to company.aiAgentSettings.agent2
 * - Modular, section-by-section build (Discovery first)
 *
 * NOTE:
 * This UI does not change live call runtime yet. It establishes:
 * - Config namespace + UI controls
 * - Simulator (local) for fast iteration
 *
 * ============================================================================
 */

class Agent2Manager {
  static UI_BUILD = 'AGENT2_UI_V0.9';

  constructor(companyId) {
    this.companyId = companyId;
    this.config = null;
    this.isDirty = false;
    this._container = null;
    this._activeTab = 'config'; // 'config', 'greetings', or 'callReview'
    this._calls = [];
    this._callsLoading = false;
    this._selectedCall = null;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // API
  // ──────────────────────────────────────────────────────────────────────────
  _getToken() {
    return localStorage.getItem('adminToken') ||
      localStorage.getItem('token') ||
      sessionStorage.getItem('token');
  }

  async load() {
    const token = this._getToken();
    if (!token) {
      this.config = this.getDefaultConfig();
      return this.config;
    }

    const res = await fetch(`/api/admin/agent2/${this.companyId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });

    if (!res.ok) {
      this.config = this.getDefaultConfig();
      return this.config;
    }

    const json = await res.json();
    this.config = json?.data || this.getDefaultConfig();
    return this.config;
  }

  async save() {
    const token = this._getToken();
    if (!token) {
      alert('Missing auth token. Please re-login.');
      return;
    }

    const res = await fetch(`/api/admin/agent2/${this.companyId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(this.config || {})
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Save failed (${res.status}): ${text}`);
    }

    const json = await res.json();
    this.config = json?.data || this.config;
    this.isDirty = false;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Defaults
  // ──────────────────────────────────────────────────────────────────────────
  getDefaultConfig() {
    return {
      enabled: false,
      discovery: {
        enabled: false,
        style: {
          ackWord: 'Ok.',
          forbidPhrases: ['Got it'],
          bridge: { enabled: false, maxPerTurn: 1, lines: ['Ok — one second.'] },
          systemDelay: {
            enabled: true,
            firstLine: "I'm sorry — looks like my system's moving a little slow. Thanks for your patience!",
            transferLine: "I'm so sorry — looks like my system isn't responding. Let me transfer you to a service advisor right away."
          },
          robotChallenge: {
            enabled: true,
            line: "Please, I am here to help you! You can speak to me naturally and ask anything you need — How can I help you?"
          },
          whenInDoubt: {
            enabled: true,
            transferLine: "Ok, to ensure you get the best help, I'm transferring you to a service advisor who can assist with your service needs. Please hold."
          }
        },
        playbook: {
          version: 'v1',
          allowedScenarioTypes: ['FAQ', 'TROUBLESHOOT', 'PRICING', 'SERVICE', 'UNKNOWN'],
          minScenarioScore: 0.72,
          fallback: {
            noMatchAnswer: 'Ok. How can I help you today?',
            noMatchWhenReasonCaptured: "Ok. I'm sorry about that.",
            noMatchClarifierQuestion: "Just so I help you the right way — is the system not running at all right now, or is it running but not cooling?",
            afterAnswerQuestion: 'Would you like to schedule a visit, or do you have a question I can help with?'
          },
          rules: []
        },
        updatedAt: null
      },
      meta: { uiBuild: Agent2Manager.UI_BUILD }
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ──────────────────────────────────────────────────────────────────────────
  escapeHtml(str) {
    return `${str ?? ''}`
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  _setDirty(v = true) {
    this.isDirty = v === true;
    const badge = document.getElementById('a2-dirty-badge');
    if (badge) {
      badge.textContent = this.isDirty ? 'UNSAVED' : 'SAVED';
      badge.style.background = this.isDirty ? '#f59e0b' : '#238636';
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // UI
  // ──────────────────────────────────────────────────────────────────────────
  render(container) {
    if (!container) return;
    if (!this.config) this.config = this.getDefaultConfig();
    this._container = container;

    const isConfigTab = this._activeTab === 'config';
    const isGreetingsTab = this._activeTab === 'greetings';
    const isCallReviewTab = this._activeTab === 'callReview';

    container.innerHTML = `
      <div style="padding: 20px; background: #0d1117; color: #e6edf3;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid #30363d; padding-bottom:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:10px;">
              <h2 style="margin:0; font-size:1.5rem; color:#22d3ee;">Agent 2.0</h2>
              <span id="a2-dirty-badge" style="font-size:0.75rem; padding:3px 8px; border-radius:999px; background:${this.isDirty ? '#f59e0b' : '#238636'}; color:white; ${isCallReviewTab ? 'display:none;' : ''}">
                ${this.isDirty ? 'UNSAVED' : 'SAVED'}
              </span>
              <span style="font-size:0.7rem; padding:3px 8px; background:#21262d; border:1px solid #30363d; border-radius:999px; color:#c9d1d9;">
                UI Build: ${this.escapeHtml(Agent2Manager.UI_BUILD)}
              </span>
            </div>
            <div style="margin-top:6px; color:#8b949e; font-size:0.9rem;">
              ${isConfigTab ? 'Clean, isolated config surface. Discovery is built and locked before Booking.' : isGreetingsTab ? 'Agent 2.0 owns greetings when enabled. Legacy greeting rules are ignored.' : 'Enterprise call review console. Click a call to see details, transcript, and raw events.'}
            </div>
          </div>
          <div style="display:flex; gap:10px; ${isCallReviewTab ? 'display:none;' : ''}">
            <button id="a2-export-json" style="padding:8px 14px; background:#1f6feb; color:white; border:none; border-radius:8px; cursor:pointer;">
              Export JSON
            </button>
            <button id="a2-reset" style="padding:8px 14px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:8px; cursor:pointer;">
              Reset
            </button>
            <button id="a2-save" style="padding:8px 14px; background:#238636; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:700;">
              Save
            </button>
          </div>
        </div>

        <!-- TAB NAVIGATION -->
        <div style="display:flex; gap:4px; margin-bottom:16px; border-bottom:1px solid #30363d;">
          <button id="a2-tab-config" class="a2-tab-btn" style="padding:10px 20px; background:${isConfigTab ? '#0b1220' : 'transparent'}; color:${isConfigTab ? '#22d3ee' : '#8b949e'}; border:none; border-bottom:${isConfigTab ? '2px solid #22d3ee' : '2px solid transparent'}; cursor:pointer; font-weight:${isConfigTab ? '700' : '400'}; font-size:0.95rem;">
            Configuration
          </button>
          <button id="a2-tab-greetings" class="a2-tab-btn" style="padding:10px 20px; background:${isGreetingsTab ? '#0b1220' : 'transparent'}; color:${isGreetingsTab ? '#22d3ee' : '#8b949e'}; border:none; border-bottom:${isGreetingsTab ? '2px solid #22d3ee' : '2px solid transparent'}; cursor:pointer; font-weight:${isGreetingsTab ? '700' : '400'}; font-size:0.95rem;">
            Greetings
          </button>
          <button id="a2-tab-callReview" class="a2-tab-btn" style="padding:10px 20px; background:${isCallReviewTab ? '#0b1220' : 'transparent'}; color:${isCallReviewTab ? '#22d3ee' : '#8b949e'}; border:none; border-bottom:${isCallReviewTab ? '2px solid #22d3ee' : '2px solid transparent'}; cursor:pointer; font-weight:${isCallReviewTab ? '700' : '400'}; font-size:0.95rem;">
            Call Review
          </button>
        </div>

        <!-- TAB CONTENT -->
        <div id="a2-tab-content">
          ${isConfigTab ? this.renderConfigTab() : isGreetingsTab ? this.renderGreetingsTab() : this.renderCallReviewTab()}
        </div>
      </div>

      <!-- CALL DETAIL MODAL -->
      ${this.renderCallDetailModal()}
    `;

    this.attach(container);
    
    // If on call review tab, load calls
    if (isCallReviewTab && this._calls.length === 0 && !this._callsLoading) {
      this.loadCalls();
    }
  }

  renderConfigTab() {
    return `
      ${this.renderStatusCard()}
      ${this.renderStyleCard()}
      ${this.renderVocabularyCard()}
      ${this.renderClarifiersCard()}
      ${this.renderPlaybookCard()}
      ${this.renderSimulatorCard()}
    `;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GREETINGS TAB (V122 - Agent 2.0 Owned)
  // ══════════════════════════════════════════════════════════════════════════
  renderGreetingsTab() {
    return `
      ${this.renderCallStartGreetingCard()}
      ${this.renderGreetingInterceptorCard()}
      ${this.renderBridgeSettingsCard()}
    `;
  }

  renderCallStartGreetingCard() {
    const greetings = this.config?.greetings || {};
    const callStart = greetings.callStart || {};
    const enabled = callStart.enabled !== false;
    const text = callStart.text || "Thank you for calling. How can I help you today?";
    const audioUrl = callStart.audioUrl || '';

    return `
      <div class="a2-card" style="background:#0b1220; border:1px solid #1f2937; border-radius:16px; padding:24px; margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div>
            <h3 style="margin:0; font-size:1.15rem; color:#22d3ee;">Call Start Greeting</h3>
            <div style="color:#6e7681; font-size:0.85rem; margin-top:4px;">First thing the agent says when the call connects (before caller speaks).</div>
          </div>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="a2-callstart-enabled" ${enabled ? 'checked' : ''} style="width:18px; height:18px; accent-color:#22d3ee;">
            <span style="color:#c9d1d9; font-size:0.9rem;">Enabled</span>
          </label>
        </div>
        
        <div style="margin-bottom:16px;">
          <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Greeting Text (TTS)</label>
          <textarea id="a2-callstart-text" rows="2" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px; color:#c9d1d9; font-size:0.95rem; resize:vertical;">${this.escapeHtml(text)}</textarea>
        </div>
        
        <div>
          <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Audio URL (optional — if provided, plays instead of TTS)</label>
          <input type="text" id="a2-callstart-audioUrl" value="${this.escapeHtml(audioUrl)}" placeholder="https://example.com/greeting.mp3" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px; color:#c9d1d9; font-size:0.95rem;">
        </div>
      </div>
    `;
  }

  renderGreetingInterceptorCard() {
    const greetings = this.config?.greetings || {};
    const interceptor = greetings.interceptor || {};
    const enabled = interceptor.enabled !== false;
    const maxWords = typeof interceptor.maxWordsToQualify === 'number' ? interceptor.maxWordsToQualify : 2;
    const blockIntent = interceptor.blockIfContainsIntentWords !== false;
    const intentWords = Array.isArray(interceptor.intentWords) ? interceptor.intentWords : [];
    const rules = Array.isArray(interceptor.rules) ? interceptor.rules : [];

    const rulesRows = rules.map((rule, idx) => {
      const ruleEnabled = rule.enabled !== false;
      const priority = rule.priority || 100;
      const matchMode = rule.matchMode || 'EXACT';
      const triggers = Array.isArray(rule.triggers) ? rule.triggers.join(', ') : '';
      const responseText = rule.responseText || '';
      const hasAudio = rule.audioUrl && rule.audioUrl.trim();

      return `
        <tr class="a2-greeting-rule-row" data-idx="${idx}" style="cursor:pointer; border-bottom:1px solid #21262d;">
          <td style="padding:12px 8px; text-align:center;">
            <input type="checkbox" class="a2-greeting-rule-enabled" data-idx="${idx}" ${ruleEnabled ? 'checked' : ''} style="width:16px; height:16px; accent-color:#22d3ee;">
          </td>
          <td style="padding:12px 8px; color:#c9d1d9; text-align:center;">${priority}</td>
          <td style="padding:12px 8px;">
            <span style="padding:3px 8px; background:${matchMode === 'EXACT' ? '#238636' : '#f59e0b'}22; color:${matchMode === 'EXACT' ? '#238636' : '#f59e0b'}; border-radius:4px; font-size:0.8rem;">${matchMode}</span>
          </td>
          <td style="padding:12px 8px; color:#c9d1d9; font-family:monospace; font-size:0.9rem;">${this.escapeHtml(triggers)}</td>
          <td style="padding:12px 8px; color:#8b949e; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${this.escapeHtml(responseText.substring(0, 50))}${responseText.length > 50 ? '...' : ''}</td>
          <td style="padding:12px 8px; text-align:center;">
            ${hasAudio ? '<span style="color:#22d3ee;">🔊</span>' : '<span style="color:#6e7681;">—</span>'}
          </td>
        </tr>
      `;
    }).join('');

    return `
      <div class="a2-card" style="background:#0b1220; border:1px solid #1f2937; border-radius:16px; padding:24px; margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div>
            <h3 style="margin:0; font-size:1.15rem; color:#22d3ee;">Greeting Interceptor</h3>
            <div style="color:#6e7681; font-size:0.85rem; margin-top:4px;">Responds to short caller greetings like "hi", "good morning". Runs BEFORE trigger cards.</div>
          </div>
          <div style="display:flex; gap:12px; align-items:center;">
            <button id="a2-greeting-seed" style="padding:8px 14px; background:#1f6feb; color:white; border:none; border-radius:8px; cursor:pointer; font-size:0.85rem;">
              Seed From Global
            </button>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" id="a2-interceptor-enabled" ${enabled ? 'checked' : ''} style="width:18px; height:18px; accent-color:#22d3ee;">
              <span style="color:#c9d1d9; font-size:0.9rem;">Enabled</span>
            </label>
          </div>
        </div>

        <!-- SHORT-ONLY GATE SETTINGS -->
        <div style="background:#161b22; border:1px solid #30363d; border-radius:12px; padding:16px; margin-bottom:16px;">
          <div style="color:#f59e0b; font-size:0.85rem; font-weight:600; margin-bottom:12px;">⚠️ Short-Only Gate (prevents hijacking real intent)</div>
          <div style="display:flex; gap:24px; flex-wrap:wrap;">
            <div>
              <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Max Words to Qualify</label>
              <input type="number" id="a2-interceptor-maxWords" value="${maxWords}" min="1" max="10" style="width:80px; background:#0d1117; border:1px solid #30363d; border-radius:6px; padding:8px; color:#c9d1d9; text-align:center;">
              <div style="color:#6e7681; font-size:0.75rem; margin-top:4px;">Greeting only fires if input ≤ this many words</div>
            </div>
            <div style="flex:1; min-width:200px;">
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer; margin-bottom:8px;">
                <input type="checkbox" id="a2-interceptor-blockIntent" ${blockIntent ? 'checked' : ''} style="width:16px; height:16px; accent-color:#22d3ee;">
                <span style="color:#c9d1d9; font-size:0.9rem;">Block if contains intent words</span>
              </label>
              <div style="color:#6e7681; font-size:0.75rem;">Prevents "hi my ac is broken" from triggering a greeting response</div>
            </div>
          </div>
        </div>

        <!-- INTENT WORDS -->
        <div style="margin-bottom:16px;">
          <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Intent Words (comma-separated)</label>
          <textarea id="a2-interceptor-intentWords" rows="2" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px; color:#c9d1d9; font-size:0.85rem; font-family:monospace; resize:vertical;">${this.escapeHtml(intentWords.join(', '))}</textarea>
          <div style="color:#6e7681; font-size:0.75rem; margin-top:4px;">If input contains any of these words, greeting is blocked and falls through to trigger cards.</div>
        </div>

        <!-- RULES TABLE -->
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div style="color:#c9d1d9; font-weight:600;">Greeting Rules</div>
          <button id="a2-greeting-add" style="padding:6px 14px; background:#238636; color:white; border:none; border-radius:6px; cursor:pointer; font-size:0.85rem;">
            + Add Rule
          </button>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:0.9rem;">
            <thead>
              <tr style="background:#161b22; border-bottom:1px solid #30363d;">
                <th style="padding:10px 8px; text-align:center; color:#8b949e; font-weight:600; width:60px;">On</th>
                <th style="padding:10px 8px; text-align:center; color:#8b949e; font-weight:600; width:70px;">Priority</th>
                <th style="padding:10px 8px; text-align:left; color:#8b949e; font-weight:600; width:80px;">Match</th>
                <th style="padding:10px 8px; text-align:left; color:#8b949e; font-weight:600;">Triggers</th>
                <th style="padding:10px 8px; text-align:left; color:#8b949e; font-weight:600;">Response</th>
                <th style="padding:10px 8px; text-align:center; color:#8b949e; font-weight:600; width:50px;">Audio</th>
              </tr>
            </thead>
            <tbody id="a2-greeting-rules-tbody">
              ${rulesRows || '<tr><td colspan="6" style="padding:20px; text-align:center; color:#6e7681;">No greeting rules configured.</td></tr>'}
            </tbody>
          </table>
        </div>
      </div>

      <!-- GREETING RULE MODAL -->
      <div id="a2-greeting-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); z-index:10000; align-items:center; justify-content:center;">
        <div style="background:#0d1117; border:1px solid #30363d; border-radius:16px; padding:24px; max-width:600px; width:90%; max-height:90vh; overflow-y:auto;">
          <h3 style="margin:0 0 20px 0; color:#22d3ee;">Edit Greeting Rule</h3>
          <div id="a2-greeting-modal-content"></div>
          <div style="display:flex; gap:12px; margin-top:20px;">
            <button id="a2-greeting-modal-save" style="flex:1; padding:12px; background:#238636; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600;">Save</button>
            <button id="a2-greeting-modal-delete" style="padding:12px 20px; background:#da3633; color:white; border:none; border-radius:8px; cursor:pointer;">Delete</button>
            <button id="a2-greeting-modal-cancel" style="padding:12px 20px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:8px; cursor:pointer;">Cancel</button>
          </div>
        </div>
      </div>
    `;
  }

  renderGreetingRuleModal(idx) {
    const greetings = this.config?.greetings || {};
    const interceptor = greetings.interceptor || {};
    const rules = Array.isArray(interceptor.rules) ? interceptor.rules : [];
    const rule = idx >= 0 && idx < rules.length ? rules[idx] : {
      id: `greeting.custom.${Date.now()}`,
      enabled: true,
      priority: 50,
      matchMode: 'EXACT',
      triggers: [],
      responseText: '',
      audioUrl: ''
    };

    const triggers = Array.isArray(rule.triggers) ? rule.triggers.join(', ') : '';

    return `
      <div style="margin-bottom:16px;">
        <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Rule ID</label>
        <input type="text" id="a2-greeting-modal-id" value="${this.escapeHtml(rule.id || '')}" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9;">
      </div>
      <div style="display:flex; gap:16px; margin-bottom:16px;">
        <div style="flex:1;">
          <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Priority</label>
          <input type="number" id="a2-greeting-modal-priority" value="${rule.priority || 50}" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9;">
        </div>
        <div style="flex:1;">
          <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Match Mode</label>
          <select id="a2-greeting-modal-matchMode" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9;">
            <option value="EXACT" ${rule.matchMode === 'EXACT' ? 'selected' : ''}>EXACT (full match)</option>
            <option value="FUZZY" ${rule.matchMode === 'FUZZY' ? 'selected' : ''}>FUZZY (contains)</option>
          </select>
        </div>
        <div>
          <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Enabled</label>
          <input type="checkbox" id="a2-greeting-modal-enabled" ${rule.enabled !== false ? 'checked' : ''} style="width:20px; height:20px; accent-color:#22d3ee; margin-top:8px;">
        </div>
      </div>
      <div style="margin-bottom:16px;">
        <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Triggers (comma-separated phrases)</label>
        <input type="text" id="a2-greeting-modal-triggers" value="${this.escapeHtml(triggers)}" placeholder="hi, hello, hey" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9;">
        <div style="color:#6e7681; font-size:0.75rem; margin-top:4px;">What the caller says to trigger this greeting response.</div>
      </div>
      <div style="margin-bottom:16px;">
        <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Response Text (TTS)</label>
        <textarea id="a2-greeting-modal-responseText" rows="2" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; resize:vertical;">${this.escapeHtml(rule.responseText || '')}</textarea>
      </div>
      <div>
        <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Audio URL (optional — if provided, plays instead of TTS)</label>
        <input type="text" id="a2-greeting-modal-audioUrl" value="${this.escapeHtml(rule.audioUrl || '')}" placeholder="https://example.com/greeting.mp3" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9;">
      </div>
    `;
  }

  renderBridgeSettingsCard() {
    const style = this.config?.discovery?.style || {};
    const bridge = style.bridge || {};
    const enabled = bridge.enabled === true;
    const maxPerTurn = bridge.maxPerTurn || 1;
    const lines = Array.isArray(bridge.lines) ? bridge.lines : ['Ok — one second.'];

    return `
      <div class="a2-card" style="background:#0b1220; border:1px solid #1f2937; border-radius:16px; padding:24px; margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div>
            <h3 style="margin:0; font-size:1.15rem; color:#22d3ee;">Bridge / Micro Filler</h3>
            <div style="color:#6e7681; font-size:0.85rem; margin-top:4px;">Short phrases to fill latency gaps ("Ok — one second."). Edits existing config at discovery.style.bridge.</div>
          </div>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="a2-bridge-enabled" ${enabled ? 'checked' : ''} style="width:18px; height:18px; accent-color:#22d3ee;">
            <span style="color:#c9d1d9; font-size:0.9rem;">Enabled</span>
          </label>
        </div>
        
        <div style="display:flex; gap:24px; margin-bottom:16px;">
          <div>
            <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Max Per Turn</label>
            <input type="number" id="a2-bridge-maxPerTurn" value="${maxPerTurn}" min="1" max="3" style="width:80px; background:#161b22; border:1px solid #30363d; border-radius:6px; padding:8px; color:#c9d1d9; text-align:center;">
          </div>
        </div>
        
        <div>
          <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Bridge Lines (one per line)</label>
          <textarea id="a2-bridge-lines" rows="3" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px; color:#c9d1d9; font-size:0.95rem; resize:vertical;">${this.escapeHtml(lines.join('\n'))}</textarea>
          <div style="color:#6e7681; font-size:0.75rem; margin-top:4px;">One line per row. These are randomly selected when a bridge is needed.</div>
        </div>
      </div>
    `;
  }

  renderCallReviewTab() {
    if (this._callsLoading) {
      return `
        <div style="text-align:center; padding:60px; color:#8b949e;">
          <div style="font-size:2rem; margin-bottom:12px;">⏳</div>
          <div>Loading calls...</div>
        </div>
      `;
    }

    if (this._calls.length === 0) {
      return `
        <div style="text-align:center; padding:60px; color:#8b949e;">
          <div style="font-size:2rem; margin-bottom:12px;">📞</div>
          <div>No calls found. Make a test call to see it here.</div>
          <button id="a2-refresh-calls" style="margin-top:16px; padding:10px 20px; background:#1f6feb; color:white; border:none; border-radius:8px; cursor:pointer;">
            Refresh
          </button>
        </div>
      `;
    }

    const callCards = this._calls.map((call, idx) => {
      const date = new Date(call.startTime || call.createdAt);
      const timeStr = date.toLocaleString();
      const duration = call.duration ? `${Math.round(call.duration)}s` : '--';
      const turns = call.turnCount || call.turns || '--';
      const from = call.from || call.callerPhone || 'Unknown';
      const status = call.status || 'completed';
      const statusColor = status === 'completed' ? '#238636' : (status === 'in-progress' ? '#f59e0b' : '#6e7681');
      
      // LLM usage
      const llmCalls = call.llmCalls || 0;
      const llmCost = call.llmCostUsd || 0;
      const hasLlmUsage = llmCalls > 0 || llmCost > 0;
      const costFormatted = llmCost > 0 ? `$${llmCost.toFixed(4)}` : '$0';
      const cost1000 = llmCost > 0 ? `$${(llmCost * 1000).toFixed(2)}` : '$0';
      
      // Color based on cost (green=cheap/none, yellow=moderate, red=expensive)
      const costColor = llmCost === 0 ? '#4ade80' : llmCost < 0.01 ? '#fbbf24' : '#f43f5e';
      
      return `
        <div class="a2-call-card" data-call-idx="${idx}" style="background:#0b1220; border:1px solid #1f2937; border-radius:12px; padding:16px; cursor:pointer; transition:all 0.15s;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            <div>
              <div style="font-weight:700; color:#e5e7eb; font-size:1rem;">${this.escapeHtml(from)}</div>
              <div style="color:#8b949e; font-size:0.85rem; margin-top:4px;">${timeStr}</div>
            </div>
            <div style="text-align:right;">
              <span style="padding:4px 10px; background:${statusColor}22; color:${statusColor}; border-radius:999px; font-size:0.75rem; font-weight:600;">
                ${status.toUpperCase()}
              </span>
            </div>
          </div>
          <div style="display:flex; gap:16px; margin-top:12px; color:#8b949e; font-size:0.85rem; flex-wrap:wrap;">
            <div><span style="color:#6e7681;">Duration:</span> ${duration}</div>
            <div><span style="color:#6e7681;">Turns:</span> ${turns}</div>
            ${hasLlmUsage ? `
              <div style="display:flex; align-items:center; gap:4px;">
                <span style="color:#6e7681;">LLM:</span>
                <span style="color:${costColor}; font-weight:600;">${llmCalls}×</span>
                <span style="color:${costColor};">${costFormatted}</span>
              </div>
            ` : `
              <div style="color:#4ade80;">
                <span style="font-size:0.75rem;">✓ No LLM</span>
              </div>
            `}
          </div>
          ${hasLlmUsage ? `
            <div style="margin-top:8px; padding:8px 12px; background:#1a1f2e; border-radius:8px; font-size:0.75rem;">
              <span style="color:#6e7681;">Cost projection:</span>
              <span style="color:${costColor}; font-weight:600; margin-left:6px;">1K calls = ${cost1000}</span>
            </div>
          ` : ''}
        </div>
      `;
    }).join('');

    return `
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
        <div style="color:#8b949e; font-size:0.9rem;">
          Showing ${this._calls.length} recent calls
        </div>
        <button id="a2-refresh-calls" style="padding:8px 16px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:8px; cursor:pointer;">
          Refresh
        </button>
      </div>
      <div style="display:grid; grid-template-columns: repeat(auto-fill, minmax(450px, 1fr)); gap:12px; max-width:950px;">
        ${callCards}
      </div>
    `;
  }

  renderCallDetailModal() {
    return `
      <div id="a2-call-modal" style="display:none; position:fixed; inset:0; background:rgba(0,0,0,0.8); z-index:9999; overflow:auto;">
        <div style="max-width:900px; margin:40px auto; background:#0d1117; border:1px solid #30363d; border-radius:16px; overflow:hidden;">
          <div style="display:flex; justify-content:space-between; align-items:center; padding:16px 20px; background:#161b22; border-bottom:1px solid #30363d;">
            <div style="font-weight:700; color:#e5e7eb; font-size:1.1rem;">Call Details</div>
            <button id="a2-call-modal-close" style="background:none; border:none; color:#8b949e; font-size:1.5rem; cursor:pointer; padding:4px 8px;">&times;</button>
          </div>
          <div id="a2-call-modal-content" style="padding:20px; max-height:70vh; overflow:auto;">
            <!-- Populated dynamically -->
          </div>
        </div>
      </div>
    `;
  }

  async loadCalls() {
    this._callsLoading = true;
    this.render(this._container);

    try {
      const token = this._getToken();
      const res = await fetch(`/api/admin/agent2/calls/${this.companyId}?limit=50`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        const json = await res.json();
        this._calls = json.data || json.calls || [];
      } else {
        this._calls = [];
      }
    } catch (e) {
      console.error('Failed to load calls:', e);
      this._calls = [];
    }

    this._callsLoading = false;
    this.render(this._container);
  }

  async loadCallDetails(callSid) {
    try {
      const token = this._getToken();
      const res = await fetch(`/api/admin/agent2/calls/${this.companyId}/${callSid}/events`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (res.ok) {
        const json = await res.json();
        return { events: json.data || [], meta: json.meta || {} };
      }
    } catch (e) {
      console.error('Failed to load call events:', e);
    }
    return { events: [], meta: {} };
  }

  openCallModal(call) {
    this._selectedCall = call;
    const modal = document.getElementById('a2-call-modal');
    const content = document.getElementById('a2-call-modal-content');
    if (!modal || !content) return;

    // Show loading state
    content.innerHTML = `
      <div style="text-align:center; padding:40px; color:#8b949e;">
        <div style="font-size:1.5rem; margin-bottom:12px;">⏳</div>
        <div>Loading call details...</div>
      </div>
    `;
    modal.style.display = 'block';

    // Load events
    this.loadCallDetails(call.callSid).then(({ events, meta }) => {
      // Merge meta into call for richer display
      const enrichedCall = { ...call, ...meta };
      this.renderCallModalContent(enrichedCall, events, content);
    });
  }

  renderCallModalContent(call, events, container) {
    const date = new Date(call.startTime || call.createdAt || call.startedAt);
    const from = call.from || call.callerPhone || 'Unknown';
    const to = call.to || call.toPhone || 'Unknown';
    const duration = call.duration ? `${Math.round(call.duration)} seconds` : (call.durationMs ? `${Math.round(call.durationMs / 1000)} seconds` : '--');
    const recordingUrl = call.recordingUrl || null;

    // Build transcript from events (pass call meta which may have pre-built transcript)
    const transcript = this.buildTranscript(events, call);
    
    // Analyze call for problems and turn summaries
    const { turnSummaries, problems } = this.analyzeCall(events);
    
    // Calculate LLM usage from events if not in meta
    const llmStats = this.calculateLlmUsage(events, call);
    
    // Key events for debugging
    const keyEvents = events.filter(e => 
      ['CALL_START', 'A2_GATE', 'A2_DISCOVERY_GATE', 'A2_PATH_SELECTED', 'A2_RESPONSE_READY', 'A2_TRIGGER_EVAL', 'A2_SCENARIO_EVAL', 'A2_MIC_OWNER_PROOF', 'GREETING_EVALUATED', 'GREETING_INTERCEPTED', 'CORE_RUNTIME_OWNER_RESULT', 'TWIML_SENT', 'SLOTS_EXTRACTED', 'CALL_END'].includes(e.type)
    );

    container.innerHTML = `
      <!-- CALL INFO + ACTIONS ROW -->
      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
        <div style="background:#0b1220; border:1px solid #1f2937; border-radius:12px; padding:16px;">
          <div style="color:#8b949e; font-size:0.8rem; margin-bottom:8px;">CALL INFO</div>
          <div style="display:grid; gap:6px; font-size:0.85rem;">
            <div><span style="color:#6e7681;">From:</span> <span style="color:#e5e7eb;">${this.escapeHtml(from)}</span></div>
            <div><span style="color:#6e7681;">To:</span> <span style="color:#e5e7eb;">${this.escapeHtml(to)}</span></div>
            <div><span style="color:#6e7681;">Time:</span> <span style="color:#e5e7eb;">${date.toLocaleString()}</span></div>
            <div><span style="color:#6e7681;">Duration:</span> <span style="color:#e5e7eb;">${duration}</span></div>
            <div><span style="color:#6e7681;">CallSid:</span> <span style="color:#e5e7eb; font-family:monospace; font-size:0.75rem;">${this.escapeHtml(call.callSid || '')}</span></div>
            ${call.awHash ? `<div><span style="color:#6e7681;">Config:</span> <span style="color:#a5b4fc; font-family:monospace; font-size:0.75rem;">${this.escapeHtml(call.awHash.substring(0, 16))}...</span></div>` : ''}
          </div>
        </div>
        <div style="background:#0b1220; border:1px solid #1f2937; border-radius:12px; padding:16px;">
          <div style="color:#8b949e; font-size:0.8rem; margin-bottom:8px;">ACTIONS</div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            ${recordingUrl ? `
              <a href="${this.escapeHtml(recordingUrl)}" target="_blank" style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:#238636; color:white; border-radius:8px; text-decoration:none; font-size:0.85rem;">
                <span>🎧</span> Listen to Recording
              </a>
            ` : ''}
            <button id="a2-play-transcript" style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:#1f6feb; color:white; border:none; border-radius:8px; cursor:pointer; font-size:0.85rem;">
              <span>▶</span> Play Transcript (TTS)
            </button>
            <button id="a2-export-events" style="display:flex; align-items:center; gap:8px; padding:8px 12px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:8px; cursor:pointer; font-size:0.85rem;">
              <span>📋</span> Export Raw Events
            </button>
          </div>
        </div>
      </div>

      <!-- LLM COST ANALYSIS -->
      <div style="background:#0b1220; border:1px solid ${llmStats.totalCalls > 0 ? '#92400e' : '#166534'}; border-radius:12px; padding:16px; margin-bottom:16px;">
        <div style="color:#8b949e; font-size:0.8rem; margin-bottom:10px;">LLM TOKEN USAGE</div>
        ${llmStats.totalCalls > 0 ? `
          <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap:12px;">
            <div style="background:#1a1f2e; padding:12px; border-radius:8px;">
              <div style="color:#6e7681; font-size:0.7rem; margin-bottom:4px;">LLM CALLS</div>
              <div style="color:#fbbf24; font-size:1.4rem; font-weight:700;">${llmStats.totalCalls}</div>
            </div>
            <div style="background:#1a1f2e; padding:12px; border-radius:8px;">
              <div style="color:#6e7681; font-size:0.7rem; margin-bottom:4px;">THIS CALL</div>
              <div style="color:#f43f5e; font-size:1.4rem; font-weight:700;">$${llmStats.totalCost.toFixed(4)}</div>
            </div>
            <div style="background:#1a1f2e; padding:12px; border-radius:8px;">
              <div style="color:#6e7681; font-size:0.7rem; margin-bottom:4px;">1,000 CALLS</div>
              <div style="color:#f43f5e; font-size:1.4rem; font-weight:700;">$${(llmStats.totalCost * 1000).toFixed(2)}</div>
            </div>
            <div style="background:#1a1f2e; padding:12px; border-radius:8px;">
              <div style="color:#6e7681; font-size:0.7rem; margin-bottom:4px;">LLM LATENCY</div>
              <div style="color:#60a5fa; font-size:1.4rem; font-weight:700;">${llmStats.totalMs}ms</div>
            </div>
          </div>
          ${llmStats.events.length > 0 ? `
            <div style="margin-top:12px; padding-top:12px; border-top:1px solid #1f2937;">
              <div style="color:#6e7681; font-size:0.75rem; margin-bottom:8px;">LLM Events:</div>
              ${llmStats.events.map(e => `
                <div style="display:flex; justify-content:space-between; padding:6px 10px; background:#0d1117; border-radius:6px; margin-bottom:4px; font-size:0.8rem;">
                  <span style="color:#fbbf24;">${this.escapeHtml(e.type)}</span>
                  <span style="color:#8b949e;">Turn ${e.turn || '?'} · ${e.model || 'unknown'} · ${e.tokens || '?'} tokens · $${(e.cost || 0).toFixed(4)}</span>
                </div>
              `).join('')}
            </div>
          ` : ''}
        ` : `
          <div style="display:flex; align-items:center; gap:12px; padding:12px; background:#0d2818; border:1px solid #166534; border-radius:8px;">
            <span style="color:#4ade80; font-size:1.5rem;">✓</span>
            <div>
              <div style="color:#4ade80; font-weight:600;">Zero LLM Usage</div>
              <div style="color:#6e7681; font-size:0.8rem;">This call used only deterministic responses (trigger cards, greetings, booking flow)</div>
            </div>
          </div>
        `}
      </div>

      <!-- PROBLEMS DETECTED (Top priority - what's wrong?) -->
      <div style="background:#0b1220; border:1px solid #1f2937; border-radius:12px; padding:16px; margin-bottom:16px;">
        <div style="color:#8b949e; font-size:0.8rem; margin-bottom:10px;">PROBLEMS DETECTED (${problems.length})</div>
        ${this.renderProblemsDetected(problems)}
      </div>

      <!-- TRUTH LINE (Turn-by-turn mic owner + path) -->
      <div style="background:#0b1220; border:1px solid #1f2937; border-radius:12px; padding:16px; margin-bottom:16px;">
        <div style="color:#8b949e; font-size:0.8rem; margin-bottom:10px;">TURN-BY-TURN TRUTH LINE</div>
        <div style="font-size:0.75rem; color:#6e7681; margin-bottom:8px;">
          <span style="color:#4ade80;">● AGENT2</span> · 
          <span style="color:#fbbf24;">● GREETING</span> · 
          <span style="color:#f43f5e;">● LEGACY/OTHER</span>
        </div>
        ${this.renderTruthLine(turnSummaries)}
      </div>

      <!-- TRANSCRIPT -->
      <div style="background:#0b1220; border:1px solid #1f2937; border-radius:12px; padding:16px; margin-bottom:16px;">
        <div style="color:#8b949e; font-size:0.8rem; margin-bottom:12px;">TRANSCRIPT</div>
        <div id="a2-transcript-container" style="max-height:250px; overflow:auto;">
          ${transcript.length > 0 ? transcript.map(t => `
            <div style="margin-bottom:10px; padding:10px; background:${t.role === 'caller' ? '#1a1f2e' : '#0d2818'}; border-radius:8px;">
              <div style="font-size:0.7rem; color:${t.role === 'caller' ? '#60a5fa' : '#4ade80'}; margin-bottom:4px; font-weight:600;">
                ${t.role === 'caller' ? '📞 CALLER' : '🤖 AGENT'} ${t.turn !== undefined ? `(Turn ${t.turn})` : ''}
              </div>
              <div style="color:#e5e7eb; font-size:0.85rem; line-height:1.4;">${this.escapeHtml(t.text)}</div>
            </div>
          `).join('') : `
            <div style="color:#6e7681; text-align:center; padding:20px;">No transcript available</div>
          `}
        </div>
      </div>

      <!-- RAW EVENTS -->
      <div style="background:#0b1220; border:1px solid #1f2937; border-radius:12px; padding:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div style="color:#8b949e; font-size:0.8rem;">RAW EVENTS (${events.length} total, ${keyEvents.length} key)</div>
          <button id="a2-toggle-all-events" style="padding:4px 10px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:6px; cursor:pointer; font-size:0.75rem;">
            Show All
          </button>
        </div>
        <div id="a2-events-container" style="max-height:250px; overflow:auto; font-family:monospace; font-size:0.75rem;">
          ${keyEvents.map(e => `
            <div style="margin-bottom:6px; padding:6px 8px; background:#161b22; border-radius:6px; border-left:3px solid ${this.getEventColor(e.type)};">
              <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:2px;">
                <span style="color:${this.getEventColor(e.type)}; font-weight:600; font-size:0.75rem;">${e.type}</span>
                <span style="color:#6e7681; font-size:0.65rem;">Turn ${e.turn ?? '--'}</span>
              </div>
              <div style="color:#8b949e; font-size:0.7rem; white-space:pre-wrap; word-break:break-all;">${this.escapeHtml(JSON.stringify(e.data || {}, null, 2).substring(0, 200))}${JSON.stringify(e.data || {}).length > 200 ? '...' : ''}</div>
            </div>
          `).join('')}
        </div>
        <div id="a2-all-events-container" style="display:none; max-height:400px; overflow:auto; font-family:monospace; font-size:0.7rem; margin-top:12px;">
          <pre style="color:#8b949e; white-space:pre-wrap; word-break:break-all;">${this.escapeHtml(JSON.stringify(events, null, 2))}</pre>
        </div>
      </div>
    `;

    // Attach modal event handlers
    this.attachCallModalHandlers(call, events, transcript);
  }

  buildTranscript(events, meta = {}) {
    const transcript = [];
    
    // If BlackBox has pre-built transcript, use it (has full text, not previews)
    if (meta?.transcript?.callerTurns?.length || meta?.transcript?.agentTurns?.length) {
      const callerTurns = meta.transcript.callerTurns || [];
      const agentTurns = meta.transcript.agentTurns || [];
      
      // Add greeting (turn 0 agent)
      const greeting = events.find(e => e.type === 'GREETING_SENT');
      if (greeting?.data?.text) {
        transcript.push({ role: 'agent', text: greeting.data.text, turn: 0 });
      }
      
      // Merge caller and agent turns
      callerTurns.forEach(t => {
        if (t.text) transcript.push({ role: 'caller', text: t.text, turn: t.turn ?? 1 });
      });
      agentTurns.forEach(t => {
        if (t.text && t.turn > 0) transcript.push({ role: 'agent', text: t.text, turn: t.turn ?? 1 });
      });
      
      // Sort by turn, caller before agent
      transcript.sort((a, b) => {
        if (a.turn !== b.turn) return a.turn - b.turn;
        return a.role === 'caller' ? -1 : 1;
      });
      
      return transcript;
    }
    
    // Fallback: build from events by processing chronologically
    // Events are already sorted by time (t field)
    
    // Step 1: Add greeting as Turn 0 agent response
    const greeting = events.find(e => e.type === 'GREETING_SENT');
    if (greeting?.data?.text) {
      transcript.push({ role: 'agent', text: greeting.data.text, turn: 0, order: 0 });
    }
    
    // Step 2: Collect all caller inputs and agent responses with timestamps
    const callerInputs = [];
    const agentResponses = [];
    
    events.forEach(e => {
      const t = e.t || 0;
      
      // Caller input events
      if (e.type === 'GATHER_FINAL' || e.type === 'INPUT_TEXT_FINALIZED') {
        const text = e.data?.text || e.data?.finalPreview || e.data?.speechResult || '';
        if (text && text.length > 0) {
          callerInputs.push({ text, t, eventTurn: e.turn });
        }
      }
      
      // Agent response events (prefer A2_RESPONSE_READY, fallback to others)
      if (e.type === 'A2_RESPONSE_READY' && e.data?.responsePreview) {
        agentResponses.push({ text: e.data.responsePreview, t, eventTurn: e.turn, priority: 1 });
      } else if (e.type === 'CORE_RUNTIME_OWNER_RESULT' && e.data?.responsePreview) {
        agentResponses.push({ text: e.data.responsePreview, t, eventTurn: e.turn, priority: 2 });
      } else if (e.type === 'AGENT_RESPONSE_BUILT' && e.data?.text) {
        agentResponses.push({ text: e.data.text, t, eventTurn: e.turn, priority: 3 });
      }
    });
    
    // Step 3: Dedupe caller inputs (same text within short window = duplicate)
    const uniqueCallerInputs = [];
    callerInputs.forEach(input => {
      const isDupe = uniqueCallerInputs.some(existing => 
        existing.text === input.text && Math.abs(existing.t - input.t) < 2000
      );
      if (!isDupe) {
        uniqueCallerInputs.push(input);
      }
    });
    
    // Step 4: Assign turn numbers based on chronological order
    uniqueCallerInputs.sort((a, b) => a.t - b.t);
    uniqueCallerInputs.forEach((input, idx) => {
      const turn = idx + 1; // Turn 1, 2, 3...
      transcript.push({ role: 'caller', text: input.text, turn, order: input.t });
    });
    
    // Step 5: For each agent response, find which turn it belongs to
    // (the agent response comes AFTER the caller input in the same turn)
    const usedTurns = new Set();
    agentResponses.sort((a, b) => a.priority - b.priority); // Process higher priority first
    
    agentResponses.forEach(resp => {
      // Find the caller turn this response follows
      let matchedTurn = null;
      for (let i = uniqueCallerInputs.length - 1; i >= 0; i--) {
        const callerInput = uniqueCallerInputs[i];
        if (resp.t > callerInput.t) {
          matchedTurn = i + 1;
          break;
        }
      }
      
      if (matchedTurn && !usedTurns.has(matchedTurn)) {
        transcript.push({ role: 'agent', text: resp.text, turn: matchedTurn, order: resp.t });
        usedTurns.add(matchedTurn);
      }
    });

    // Step 6: Sort by order (timestamp), with greeting first
    transcript.sort((a, b) => {
      // Greeting (turn 0) always first
      if (a.turn === 0 && b.turn !== 0) return -1;
      if (b.turn === 0 && a.turn !== 0) return 1;
      // Then by turn number
      if (a.turn !== b.turn) return a.turn - b.turn;
      // Within same turn: caller before agent
      return a.role === 'caller' ? -1 : 1;
    });

    return transcript;
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CALL DIAGNOSTICS - Analyze events to detect problems
  // ════════════════════════════════════════════════════════════════════════════

  analyzeCall(events) {
    const problems = [];
    const turnSummaries = [];
    
    // Group events by turn - infer turn numbers from event sequence if not set
    const turns = { 0: [] };
    let inferredTurn = 0;
    
    events.forEach((e, idx) => {
      // Caller input events mark start of a new turn (1, 2, 3...)
      if (e.type === 'GATHER_FINAL' || e.type === 'INPUT_TEXT_FINALIZED') {
        inferredTurn++;
        if (!turns[inferredTurn]) turns[inferredTurn] = [];
      }
      
      // Use event's turn if valid and reasonable, otherwise use inferred
      const eventTurn = (e.turn && e.turn > 0 && e.turn <= inferredTurn + 1) ? e.turn : inferredTurn;
      
      // Turn 0 events: greeting, call start (before any caller input)
      if (e.type === 'GREETING_SENT' || e.type === 'CALL_START') {
        turns[0].push(e);
      } else {
        if (!turns[eventTurn]) turns[eventTurn] = [];
        turns[eventTurn].push(e);
      }
    });

    // Analyze each turn
    Object.keys(turns).sort((a, b) => Number(a) - Number(b)).forEach(turnNum => {
      const turnEvents = turns[turnNum];
      const turn = Number(turnNum);
      
      // Skip empty turns
      if (turnEvents.length === 0) return;
      
      const summary = this.analyzeTurn(turn, turnEvents, events);
      turnSummaries.push(summary);
      
      // Collect problems from this turn
      if (summary.problems) {
        summary.problems.forEach(p => problems.push({ turn, ...p }));
      }
    });

    // Cross-turn analysis
    this.analyzeCrossTurnProblems(turnSummaries, events, problems);

    return { turnSummaries, problems };
  }

  analyzeTurn(turn, turnEvents, allEvents) {
    const summary = {
      turn,
      micOwner: null,
      path: null,
      matchedCard: null,
      matchedOn: null,
      pendingQuestion: false,
      scenarioTried: false,
      latencyMs: null,
      slowestSection: null,
      problems: []
    };

    // Find key events for this turn
    const a2Gate = turnEvents.find(e => e.type === 'A2_GATE' || e.type === 'A2_DISCOVERY_GATE');
    const a2Path = turnEvents.find(e => e.type === 'A2_PATH_SELECTED');
    const a2Response = turnEvents.find(e => e.type === 'A2_RESPONSE_READY');
    const a2Trigger = turnEvents.find(e => e.type === 'A2_TRIGGER_EVAL');
    const a2Scenario = turnEvents.find(e => e.type === 'A2_SCENARIO_EVAL');
    const greetingEval = turnEvents.find(e => e.type === 'GREETING_EVALUATED');
    const greetingIntercept = turnEvents.find(e => e.type === 'GREETING_INTERCEPTED');
    const micProof = turnEvents.find(e => e.type === 'A2_MIC_OWNER_PROOF');
    const twimlSent = turnEvents.find(e => e.type === 'TWIML_SENT');
    const coreResult = turnEvents.find(e => e.type === 'CORE_RUNTIME_OWNER_RESULT');

    // Mic Owner - determine who actually responded
    if (micProof) {
      if (micProof.data?.agent2Ran && micProof.data?.agent2Responded) {
        summary.micOwner = 'AGENT2';
      } else if (micProof.data?.greetingIntercepted) {
        summary.micOwner = 'GREETING';
      } else {
        summary.micOwner = micProof.data?.finalResponder || 'UNKNOWN';
      }
    } else if (a2Path || a2Response) {
      summary.micOwner = 'AGENT2';
    } else if (greetingIntercept) {
      summary.micOwner = 'GREETING';
    } else if (coreResult) {
      const src = coreResult.data?.matchSource || '';
      if (src.includes('Agent2') || src === 'AGENT2') {
        summary.micOwner = 'AGENT2';
      } else {
        summary.micOwner = src || 'LEGACY';
      }
    }

    // Path - from A2_PATH_SELECTED event
    if (a2Path?.data?.path) {
      summary.path = a2Path.data.path;
    }

    // Matched card - from A2_TRIGGER_EVAL or A2_PATH_SELECTED
    if (a2Trigger?.data?.matched && a2Trigger?.data?.cardId) {
      summary.matchedCard = a2Trigger.data.cardLabel || a2Trigger.data.cardId;
      summary.matchedOn = a2Trigger.data.matchedOn;
    } else if (a2Path?.data?.path === 'TRIGGER_CARD') {
      summary.matchedCard = a2Path.data.reason?.replace('Matched card: ', '') || 'trigger';
      summary.matchedOn = a2Path.data.matchedOn;
    }

    // Scenario tried
    if (a2Scenario) {
      summary.scenarioTried = a2Scenario.data?.tried === true;
      if (summary.scenarioTried && a2Scenario.data?.enabled === false) {
        summary.problems.push({
          type: 'SCENARIO_LEAK',
          severity: 'warning',
          message: 'ScenarioEngine tried while disabled'
        });
      }
    }

    // Latency
    if (twimlSent?.data?.timings) {
      const timings = twimlSent.data.timings;
      summary.latencyMs = timings.totalMs || timings.total;
      // Find slowest section
      let slowest = { name: null, ms: 0 };
      Object.entries(timings).forEach(([k, v]) => {
        if (k !== 'totalMs' && k !== 'total' && typeof v === 'number' && v > slowest.ms) {
          slowest = { name: k, ms: v };
        }
      });
      summary.slowestSection = slowest.name;
      
      // Flag slow turns
      if (summary.latencyMs > 1500) {
        summary.problems.push({
          type: 'SLOW_TURN',
          severity: 'warning',
          message: `Latency ${summary.latencyMs}ms (>${1500}ms threshold)`
        });
      }
    }

    // Double-ack detection - use A2_RESPONSE_READY or CORE_RUNTIME_OWNER_RESULT
    const response = a2Response?.data?.responsePreview || coreResult?.data?.responsePreview || '';
    if (/\bOk\.\s*Ok\b/i.test(response) || /\bAlright\.\s*Alright\b/i.test(response)) {
      summary.problems.push({
        type: 'DOUBLE_ACK',
        severity: 'error',
        message: `Double acknowledgment detected: "${response.substring(0, 50)}..."`
      });
    }

    // Greeting hijack detection (long utterance but greeting fired)
    if (greetingIntercept && greetingEval?.data?.inputWordCount > 3) {
      summary.problems.push({
        type: 'GREETING_HIJACK',
        severity: 'error',
        message: `Greeting matched on ${greetingEval.data.inputWordCount}-word utterance`
      });
    }

    // Name confidence missing
    const slotsExtracted = turnEvents.find(e => e.type === 'SLOTS_EXTRACTED');
    if (turn >= 2 && slotsExtracted?.data?.extractedSlots?.name && !slotsExtracted.data.extractedSlots.name.confidence) {
      summary.problems.push({
        type: 'NAME_NO_CONFIDENCE',
        severity: 'info',
        message: 'Name extracted but confidence not set'
      });
    }

    return summary;
  }

  analyzeCrossTurnProblems(turnSummaries, events, problems) {
    // Check for repeated follow-up questions
    const responses = events
      .filter(e => e.type === 'A2_RESPONSE_READY' || e.type === 'CORE_RUNTIME_OWNER_RESULT')
      .map(e => e.data?.responsePreview || '');
    
    const seen = new Set();
    responses.forEach((r, idx) => {
      // Extract questions (sentences ending with ?)
      const questions = r.match(/[^.!?]*\?/g) || [];
      questions.forEach(q => {
        const normalized = q.toLowerCase().trim();
        if (normalized.length > 20 && seen.has(normalized)) {
          problems.push({
            turn: idx,
            type: 'REPEATED_QUESTION',
            severity: 'warning',
            message: `Same question asked twice: "${q.substring(0, 50)}..."`
          });
        }
        seen.add(normalized);
      });
    });

    // Check for name extracted but never used
    const nameExtracted = events.find(e => 
      e.type === 'SLOTS_EXTRACTED' && e.data?.extractedSlots?.name
    );
    const nameUsed = events.find(e => 
      (e.type === 'A2_TURN' || e.type === 'A2_RESPONSE_READY') && e.data?.usedCallerName === true
    );
    if (nameExtracted && !nameUsed && turnSummaries.length > 2) {
      problems.push({
        turn: null,
        type: 'NAME_NOT_USED',
        severity: 'info',
        message: 'Caller name extracted but never used in responses'
      });
    }
  }

  calculateLlmUsage(events, call) {
    // First check if we have pre-computed stats from BlackBox
    if (call.llmCalls > 0 || call.llmCostUsd > 0) {
      return {
        totalCalls: call.llmCalls || 0,
        totalCost: call.llmCostUsd || 0,
        totalMs: call.llmTotalMs || 0,
        events: []
      };
    }
    
    // Fall back to calculating from events
    const llmEvents = events.filter(e => 
      e.type === 'LLM_RESPONSE' || 
      e.type === 'TIER3_FALLBACK' || 
      e.type === 'TIER3_LLM_FALLBACK_CALLED'
    );
    
    let totalCost = 0;
    let totalMs = 0;
    const llmDetails = [];
    
    llmEvents.forEach(e => {
      const cost = e.data?.costUsd || e.data?.cost || 0;
      const ms = e.data?.latencyMs || e.data?.ms || 0;
      const tokens = e.data?.tokens || e.data?.tokensUsed || 0;
      const model = e.data?.model || e.data?.llmModel || e.data?.brain || 'unknown';
      
      totalCost += cost;
      totalMs += ms;
      
      llmDetails.push({
        type: e.type,
        turn: e.turn,
        model,
        tokens,
        cost,
        ms
      });
    });
    
    return {
      totalCalls: llmEvents.length,
      totalCost,
      totalMs,
      events: llmDetails
    };
  }

  renderTruthLine(turnSummaries) {
    if (turnSummaries.length === 0) {
      return '<div style="color:#6e7681; text-align:center; padding:12px;">No turn data available</div>';
    }

    return turnSummaries.map(s => {
      const micColor = s.micOwner === 'AGENT2' || s.micOwner === 'AGENT2_DISCOVERY' ? '#4ade80' : 
                       s.micOwner === 'GREETING' ? '#fbbf24' : '#f43f5e';
      const pathBadge = s.path ? `<span style="padding:2px 6px; background:#1f2937; border-radius:4px; font-size:0.7rem;">${s.path}</span>` : '';
      const cardBadge = s.matchedCard ? `<span style="padding:2px 6px; background:#0d3320; color:#4ade80; border-radius:4px; font-size:0.7rem;">${this.escapeHtml(s.matchedCard)}</span>` : '';
      const matchedOnBadge = s.matchedOn ? `<span style="color:#6e7681; font-size:0.7rem;">(on: ${this.escapeHtml(s.matchedOn)})</span>` : '';
      const latencyBadge = s.latencyMs ? `<span style="color:${s.latencyMs > 1500 ? '#f43f5e' : s.latencyMs > 800 ? '#fbbf24' : '#4ade80'}; font-size:0.75rem;">${s.latencyMs}ms</span>` : '';
      const scenarioBadge = s.scenarioTried ? '<span style="padding:2px 6px; background:#7c2d12; color:#fbbf24; border-radius:4px; font-size:0.65rem;">SCENARIO</span>' : '';

      return `
        <div style="display:flex; align-items:center; gap:8px; padding:8px; background:#0d1117; border-radius:6px; margin-bottom:4px; flex-wrap:wrap;">
          <span style="color:#6e7681; font-weight:600; min-width:50px;">Turn ${s.turn}</span>
          <span style="color:${micColor}; font-weight:600; font-size:0.8rem;">● ${s.micOwner || '?'}</span>
          ${pathBadge}
          ${cardBadge}
          ${matchedOnBadge}
          ${scenarioBadge}
          <span style="flex:1;"></span>
          ${latencyBadge}
          ${s.slowestSection ? `<span style="color:#6e7681; font-size:0.65rem;">(${s.slowestSection})</span>` : ''}
        </div>
      `;
    }).join('');
  }

  renderProblemsDetected(problems) {
    if (problems.length === 0) {
      return `
        <div style="display:flex; align-items:center; gap:8px; padding:12px; background:#0d2818; border:1px solid #166534; border-radius:8px; color:#4ade80;">
          <span style="font-size:1.2rem;">✓</span>
          <span>No problems detected</span>
        </div>
      `;
    }

    const severityColors = {
      error: { bg: '#450a0a', border: '#991b1b', text: '#fca5a5', icon: '✗' },
      warning: { bg: '#451a03', border: '#92400e', text: '#fcd34d', icon: '⚠' },
      info: { bg: '#0c1929', border: '#1e40af', text: '#93c5fd', icon: 'ℹ' }
    };

    return problems.map(p => {
      const style = severityColors[p.severity] || severityColors.info;
      const turnLabel = p.turn !== null ? `Turn ${p.turn}: ` : '';
      return `
        <div style="display:flex; align-items:flex-start; gap:8px; padding:10px; background:${style.bg}; border:1px solid ${style.border}; border-radius:8px; margin-bottom:6px;">
          <span style="color:${style.text}; font-size:1rem;">${style.icon}</span>
          <div>
            <div style="color:${style.text}; font-weight:600; font-size:0.85rem;">${p.type.replace(/_/g, ' ')}</div>
            <div style="color:#9ca3af; font-size:0.8rem; margin-top:2px;">${turnLabel}${this.escapeHtml(p.message)}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  getEventColor(type) {
    const colors = {
      'CALL_START': '#22d3ee',
      'CALL_END': '#f43f5e',
      'A2_GATE': '#a78bfa',
      'A2_DISCOVERY_GATE': '#a78bfa',
      'A2_PATH_SELECTED': '#60a5fa',
      'A2_RESPONSE_READY': '#4ade80',
      'A2_TRIGGER_EVAL': '#34d399',
      'A2_SCENARIO_EVAL': '#fbbf24',
      'A2_MIC_OWNER_PROOF': '#c084fc',
      'GREETING_EVALUATED': '#fb923c',
      'GREETING_INTERCEPTED': '#fbbf24',
      'CORE_RUNTIME_OWNER_RESULT': '#fbbf24',
      'TWIML_SENT': '#6ee7b7',
      'INPUT_TEXT_FINALIZED': '#93c5fd',
      'GREETING_SENT': '#c4b5fd',
      'SLOTS_EXTRACTED': '#a5b4fc'
    };
    return colors[type] || '#6e7681';
  }

  attachCallModalHandlers(call, events, transcript) {
    const modal = document.getElementById('a2-call-modal');
    
    // Close modal
    document.getElementById('a2-call-modal-close')?.addEventListener('click', () => {
      modal.style.display = 'none';
      window.speechSynthesis.cancel();
    });
    modal?.addEventListener('click', (e) => {
      if (e.target.id === 'a2-call-modal') {
        modal.style.display = 'none';
        window.speechSynthesis.cancel();
      }
    });

    // Play transcript TTS
    document.getElementById('a2-play-transcript')?.addEventListener('click', () => {
      this.playTranscript(transcript);
    });

    // Export events
    document.getElementById('a2-export-events')?.addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(events, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `raw-events-${call.callSid}.json`;
      a.click();
      URL.revokeObjectURL(url);
    });

    // Toggle all events
    document.getElementById('a2-toggle-all-events')?.addEventListener('click', (e) => {
      const allContainer = document.getElementById('a2-all-events-container');
      const keyContainer = document.getElementById('a2-events-container');
      if (allContainer.style.display === 'none') {
        allContainer.style.display = 'block';
        keyContainer.style.display = 'none';
        e.target.textContent = 'Show Key Only';
      } else {
        allContainer.style.display = 'none';
        keyContainer.style.display = 'block';
        e.target.textContent = 'Show All';
      }
    });
  }

  playTranscript(transcript) {
    if (transcript.length === 0) {
      alert('No transcript to play.');
      return;
    }

    window.speechSynthesis.cancel();
    const btn = document.getElementById('a2-play-transcript');
    const originalHTML = btn?.innerHTML || '';
    
    let idx = 0;
    const playNext = () => {
      if (idx >= transcript.length) {
        if (btn) {
          btn.innerHTML = originalHTML;
          btn.style.background = '#1f6feb';
        }
        return;
      }

      const item = transcript[idx];
      const utterance = new SpeechSynthesisUtterance(item.text);
      utterance.rate = 1.0;
      
      // Different voice/pitch for caller vs agent
      if (item.role === 'caller') {
        utterance.pitch = 1.2;
      } else {
        utterance.pitch = 0.9;
      }

      // Try to get voices
      const voices = window.speechSynthesis.getVoices();
      if (item.role === 'agent') {
        const agentVoice = voices.find(v => v.name.includes('Samantha') || v.name.includes('Karen')) || voices.find(v => v.lang.startsWith('en'));
        if (agentVoice) utterance.voice = agentVoice;
      }

      utterance.onend = () => {
        idx++;
        setTimeout(playNext, 500); // Small pause between turns
      };

      if (btn) {
        btn.innerHTML = `<span>⏹</span> Playing... (${idx + 1}/${transcript.length})`;
        btn.style.background = '#6e7681';
      }

      window.speechSynthesis.speak(utterance);
    };

    playNext();
  }

  renderCard(title, subtitle, bodyHtml) {
    return `
      <div style="background:#0b1220; border:1px solid #1f2937; border-radius:14px; padding:16px; margin-bottom:14px;">
        <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:12px;">
          <div>
            <div style="font-weight:800; color:#e5e7eb; font-size:1.05rem;">${title}</div>
            ${subtitle ? `<div style="margin-top:4px; color:#94a3b8; font-size:0.85rem; line-height:1.5;">${subtitle}</div>` : ''}
          </div>
        </div>
        <div style="margin-top:12px;">
          ${bodyHtml}
        </div>
      </div>
    `;
  }

  renderStatusCard() {
    const enabled = this.config.enabled === true;
    const dEnabled = this.config.discovery?.enabled === true;
    return this.renderCard(
      'Status',
      'This only controls Agent 2.0 configuration. Runtime takeover is a later, explicit step.',
      `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <label style="display:flex; align-items:center; gap:10px; padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:12px;">
            <input id="a2-enabled" type="checkbox" ${enabled ? 'checked' : ''} />
            <div>
              <div style="font-weight:700;">Enable Agent 2.0 (master)</div>
              <div style="color:#8b949e; font-size:12px;">Stores config under <code style="background:#111827; padding:2px 6px; border-radius:6px;">aiAgentSettings.agent2</code></div>
            </div>
          </label>
          <label style="display:flex; align-items:center; gap:10px; padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:12px;">
            <input id="a2-discovery-enabled" type="checkbox" ${dEnabled ? 'checked' : ''} />
            <div>
              <div style="font-weight:700;">Enable Agent 2.0 Discovery</div>
              <div style="color:#8b949e; font-size:12px;">UI-only until we wire runtime behind an explicit gate.</div>
            </div>
          </label>
        </div>
      `
    );
  }

  renderStyleCard() {
    const style = this.config.discovery?.style || {};
    const forbid = Array.isArray(style.forbidPhrases) ? style.forbidPhrases.join('\n') : '';

    // Build style lines array for table display
    const styleLines = this._getStyleLines();

    const tableRows = styleLines.map((line, idx) => {
      const hasAudio = !!line.audioUrl;
      const audioBadge = hasAudio
        ? '<span style="background:#1f6feb; color:white; padding:2px 8px; border-radius:6px; font-size:10px; font-weight:600;">AUDIO</span>'
        : '<span style="background:#6e7681; color:#c9d1d9; padding:2px 8px; border-radius:6px; font-size:10px;">NO AUDIO</span>';
      const enabledBadge = line.enabled
        ? ''
        : '<span style="background:#6e7681; color:#c9d1d9; padding:2px 8px; border-radius:6px; font-size:10px; margin-left:6px;">OFF</span>';
      const textPreview = (line.text || '').length > 60 ? line.text.substring(0, 60) + '...' : (line.text || '(empty)');
      const rowOpacity = line.enabled ? '1' : '0.5';

      return `
        <tr class="a2-style-row" data-line-id="${line.id}" style="cursor:pointer; opacity:${rowOpacity};">
          <td style="padding:10px; border-bottom:1px solid #21262d; color:#7ee787; font-family:monospace; font-size:12px;">${this.escapeHtml(line.id)}</td>
          <td style="padding:10px; border-bottom:1px solid #21262d; font-weight:600;">${this.escapeHtml(line.label)}${enabledBadge}</td>
          <td style="padding:10px; border-bottom:1px solid #21262d; color:#8b949e; font-size:13px;">${this.escapeHtml(textPreview)}</td>
          <td style="padding:10px; border-bottom:1px solid #21262d; text-align:center;">${audioBadge}</td>
        </tr>
      `;
    }).join('');

    return this.renderCard(
      'Discovery Style & Safety',
      'Click a row to edit. These are spoken lines the agent uses for greetings, delays, and transfers.',
      `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:16px;">
          <div>
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Ack word (prefix for responses)</label>
            <input id="a2-style-ackWord" value="${this.escapeHtml(style.ackWord || 'Ok.')}"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px;" />
          </div>
          <div>
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Forbidden phrases (one per line)</label>
            <textarea id="a2-style-forbid" rows="2"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; resize:vertical;">${this.escapeHtml(forbid)}</textarea>
          </div>
        </div>

        <div style="overflow-x:auto;">
          <table style="width:100%; border-collapse:collapse; font-size:14px;">
            <thead>
              <tr style="background:#161b22; color:#8b949e; text-align:left;">
                <th style="padding:10px; border-bottom:1px solid #30363d; width:140px;">Type</th>
                <th style="padding:10px; border-bottom:1px solid #30363d;">Label</th>
                <th style="padding:10px; border-bottom:1px solid #30363d;">Text Preview</th>
                <th style="padding:10px; border-bottom:1px solid #30363d; width:80px; text-align:center;">Audio</th>
              </tr>
            </thead>
            <tbody>
              ${tableRows}
            </tbody>
          </table>
        </div>

        <div id="a2-style-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:9999; align-items:center; justify-content:center;">
          <div style="background:#0d1117; border:1px solid #30363d; border-radius:16px; width:90%; max-width:600px; max-height:90vh; overflow-y:auto; padding:24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid #30363d; padding-bottom:16px;">
              <h3 style="margin:0; color:#e5e7eb; font-size:1.25rem;">Edit Style Line</h3>
              <button id="a2-style-modal-close" style="background:transparent; border:none; color:#8b949e; font-size:24px; cursor:pointer; padding:4px 8px;">X</button>
            </div>
            <div id="a2-style-modal-content"></div>
          </div>
        </div>
      `
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VOCABULARY CARD (HARD_NORMALIZE + SOFT_HINT)
  // ══════════════════════════════════════════════════════════════════════════
  renderVocabularyCard() {
    const vocab = this.config.discovery?.vocabulary || {};
    const entries = Array.isArray(vocab.entries) ? vocab.entries : [];
    
    const tableRows = entries.map((entry, idx) => {
      const typeColor = entry.type === 'HARD_NORMALIZE' ? '#22c55e' : '#8b5cf6';
      const typeBadge = entry.type === 'HARD_NORMALIZE' 
        ? '<span style="background:#22c55e22; color:#22c55e; padding:2px 8px; border-radius:6px; font-size:10px; font-weight:600;">NORMALIZE</span>'
        : '<span style="background:#8b5cf622; color:#8b5cf6; padding:2px 8px; border-radius:6px; font-size:10px; font-weight:600;">HINT</span>';
      const matchBadge = entry.matchMode === 'EXACT'
        ? '<span style="background:#3b82f622; color:#3b82f6; padding:2px 6px; border-radius:4px; font-size:10px;">EXACT</span>'
        : '<span style="background:#6b728022; color:#9ca3af; padding:2px 6px; border-radius:4px; font-size:10px;">CONTAINS</span>';
      const enabledBadge = entry.enabled !== false ? '' : '<span style="background:#6e7681; color:#c9d1d9; padding:2px 6px; border-radius:4px; font-size:10px; margin-left:6px;">OFF</span>';
      const rowOpacity = entry.enabled !== false ? '1' : '0.5';
      
      return `
        <tr class="a2-vocab-row" data-vocab-idx="${idx}" style="cursor:pointer; opacity:${rowOpacity};">
          <td style="padding:8px; border-bottom:1px solid #21262d;">${entry.priority || 100}</td>
          <td style="padding:8px; border-bottom:1px solid #21262d;">${typeBadge}${enabledBadge}</td>
          <td style="padding:8px; border-bottom:1px solid #21262d;">${matchBadge}</td>
          <td style="padding:8px; border-bottom:1px solid #21262d; font-family:monospace; color:#f59e0b;">"${this.escapeHtml(entry.from || '')}"</td>
          <td style="padding:8px; border-bottom:1px solid #21262d; font-family:monospace; color:#22d3ee;">"${this.escapeHtml(entry.to || '')}"</td>
          <td style="padding:8px; border-bottom:1px solid #21262d; color:#6b7280; font-size:12px;">${this.escapeHtml(entry.notes || '')}</td>
        </tr>
      `;
    }).join('');

    return this.renderCard(
      'Vocabulary (Normalization + Hints)',
      'HARD_NORMALIZE corrects mishears before matching. SOFT_HINT adds contextual hints without changing text.',
      `
        <div style="display:flex; align-items:center; gap:16px; margin-bottom:16px; padding:12px; background:#161b22; border:1px solid #30363d; border-radius:10px;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input id="a2-vocab-enabled" type="checkbox" ${vocab.enabled === true ? 'checked' : ''} />
            <span style="color:#e5e7eb; font-weight:600;">Enable Vocabulary Processing</span>
          </label>
          <div style="flex:1;"></div>
          <button id="a2-vocab-add" style="padding:6px 14px; background:#238636; color:white; border:none; border-radius:6px; cursor:pointer; font-size:13px;">+ Add Entry</button>
        </div>

        ${entries.length === 0 ? `
          <div style="text-align:center; padding:40px; color:#8b949e; background:#0d1117; border:1px dashed #30363d; border-radius:10px;">
            <div style="font-size:1.5rem; margin-bottom:8px;">📝</div>
            <div>No vocabulary entries yet. Click "+ Add Entry" to create one.</div>
          </div>
        ` : `
          <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:13px;">
              <thead>
                <tr style="background:#161b22; color:#8b949e; text-align:left;">
                  <th style="padding:8px; border-bottom:1px solid #30363d; width:60px;">Priority</th>
                  <th style="padding:8px; border-bottom:1px solid #30363d; width:100px;">Type</th>
                  <th style="padding:8px; border-bottom:1px solid #30363d; width:80px;">Match</th>
                  <th style="padding:8px; border-bottom:1px solid #30363d;">From</th>
                  <th style="padding:8px; border-bottom:1px solid #30363d;">To</th>
                  <th style="padding:8px; border-bottom:1px solid #30363d;">Notes</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
          </div>
        `}

        <div id="a2-vocab-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:9999; align-items:center; justify-content:center;">
          <div style="background:#0d1117; border:1px solid #30363d; border-radius:16px; width:90%; max-width:550px; max-height:90vh; overflow-y:auto; padding:24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid #30363d; padding-bottom:16px;">
              <h3 style="margin:0; color:#e5e7eb; font-size:1.25rem;">Edit Vocabulary Entry</h3>
              <button id="a2-vocab-modal-close" style="background:transparent; border:none; color:#8b949e; font-size:24px; cursor:pointer; padding:4px 8px;">X</button>
            </div>
            <div id="a2-vocab-modal-content"></div>
          </div>
        </div>
      `
    );
  }

  renderVocabularyEntryModal(idx) {
    const vocab = this.config.discovery?.vocabulary || {};
    const entries = Array.isArray(vocab.entries) ? vocab.entries : [];
    const entry = idx === -1 ? { enabled: true, priority: 100, type: 'HARD_NORMALIZE', matchMode: 'EXACT', from: '', to: '', notes: '' } : entries[idx];
    const isNew = idx === -1;

    return `
      <input type="hidden" id="a2-vocab-modal-idx" value="${idx}" />

      <div style="margin-bottom:16px; padding:12px; background:#161b22; border:1px solid #30363d; border-radius:10px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input id="a2-vocab-modal-enabled" type="checkbox" ${entry.enabled !== false ? 'checked' : ''} />
          <span style="color:#e5e7eb; font-weight:600;">Enabled</span>
        </label>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:16px;">
        <div>
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Type</label>
          <select id="a2-vocab-modal-type" style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:10px;">
            <option value="HARD_NORMALIZE" ${entry.type === 'HARD_NORMALIZE' ? 'selected' : ''}>HARD_NORMALIZE (replace text)</option>
            <option value="SOFT_HINT" ${entry.type === 'SOFT_HINT' ? 'selected' : ''}>SOFT_HINT (add hint only)</option>
          </select>
        </div>
        <div>
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Match Mode</label>
          <select id="a2-vocab-modal-matchMode" style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:10px;">
            <option value="EXACT" ${entry.matchMode === 'EXACT' ? 'selected' : ''}>EXACT (word boundary)</option>
            <option value="CONTAINS" ${entry.matchMode !== 'EXACT' ? 'selected' : ''}>CONTAINS (substring)</option>
          </select>
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Priority (lower = higher priority)</label>
        <input id="a2-vocab-modal-priority" type="number" value="${entry.priority || 100}"
          style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:10px;" />
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">From (pattern to match)</label>
        <input id="a2-vocab-modal-from" value="${this.escapeHtml(entry.from || '')}"
          placeholder="e.g., acee, thingy on the wall"
          style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:10px;" />
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">To (replacement or hint token)</label>
        <input id="a2-vocab-modal-to" value="${this.escapeHtml(entry.to || '')}"
          placeholder="e.g., ac, maybe_thermostat"
          style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:10px;" />
      </div>

      <div style="margin-bottom:20px;">
        <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Notes (optional)</label>
        <input id="a2-vocab-modal-notes" value="${this.escapeHtml(entry.notes || '')}"
          placeholder="e.g., Common STT mishear"
          style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:10px;" />
      </div>

      <div style="display:flex; gap:10px;">
        ${!isNew ? `
          <button id="a2-vocab-modal-delete" style="padding:10px 16px; background:#da3633; color:white; border:none; border-radius:8px; cursor:pointer;">Delete</button>
        ` : ''}
        <div style="flex:1;"></div>
        <button id="a2-vocab-modal-cancel" style="padding:10px 16px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:8px; cursor:pointer;">Cancel</button>
        <button id="a2-vocab-modal-save" style="padding:10px 16px; background:#238636; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600;">${isNew ? 'Add' : 'Save'}</button>
      </div>
    `;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CLARIFIERS CARD (disambiguation questions)
  // ══════════════════════════════════════════════════════════════════════════
  renderClarifiersCard() {
    const clarifiers = this.config.discovery?.clarifiers || {};
    const entries = Array.isArray(clarifiers.entries) ? clarifiers.entries : [];
    
    const tableRows = entries.map((entry, idx) => {
      const enabledBadge = entry.enabled !== false ? '' : '<span style="background:#6e7681; color:#c9d1d9; padding:2px 6px; border-radius:4px; font-size:10px; margin-left:6px;">OFF</span>';
      const rowOpacity = entry.enabled !== false ? '1' : '0.5';
      const questionPreview = (entry.question || '').length > 50 ? entry.question.substring(0, 50) + '...' : (entry.question || '(empty)');
      
      return `
        <tr class="a2-clarifier-row" data-clarifier-idx="${idx}" style="cursor:pointer; opacity:${rowOpacity};">
          <td style="padding:8px; border-bottom:1px solid #21262d; font-family:monospace; color:#7ee787; font-size:12px;">${this.escapeHtml(entry.id || '')}</td>
          <td style="padding:8px; border-bottom:1px solid #21262d; font-family:monospace; color:#8b5cf6;">${this.escapeHtml(entry.hintTrigger || '')}</td>
          <td style="padding:8px; border-bottom:1px solid #21262d; color:#8b949e; font-size:13px;">${this.escapeHtml(questionPreview)}${enabledBadge}</td>
          <td style="padding:8px; border-bottom:1px solid #21262d; font-family:monospace; color:#22d3ee;">${this.escapeHtml(entry.locksTo || '-')}</td>
        </tr>
      `;
    }).join('');

    return this.renderCard(
      'Clarifiers (Disambiguation Questions)',
      'When a SOFT_HINT is triggered but no card matches, ask a clarifying question before guessing wrong.',
      `
        <div style="display:flex; align-items:center; gap:16px; margin-bottom:16px; padding:12px; background:#161b22; border:1px solid #30363d; border-radius:10px;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input id="a2-clarifiers-enabled" type="checkbox" ${clarifiers.enabled === true ? 'checked' : ''} />
            <span style="color:#e5e7eb; font-weight:600;">Enable Clarifier Questions</span>
          </label>
          <div style="display:flex; align-items:center; gap:8px; margin-left:20px;">
            <label style="color:#8b949e; font-size:12px;">Max asks/call:</label>
            <input id="a2-clarifiers-maxAsks" type="number" min="1" max="5" value="${clarifiers.maxAsksPerCall || 2}"
              style="width:60px; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:6px; padding:6px; text-align:center;" />
          </div>
          <div style="flex:1;"></div>
          <button id="a2-clarifier-add" style="padding:6px 14px; background:#238636; color:white; border:none; border-radius:6px; cursor:pointer; font-size:13px;">+ Add Clarifier</button>
        </div>

        ${entries.length === 0 ? `
          <div style="text-align:center; padding:40px; color:#8b949e; background:#0d1117; border:1px dashed #30363d; border-radius:10px;">
            <div style="font-size:1.5rem; margin-bottom:8px;">❓</div>
            <div>No clarifiers yet. Click "+ Add Clarifier" to create one.</div>
          </div>
        ` : `
          <div style="overflow-x:auto;">
            <table style="width:100%; border-collapse:collapse; font-size:13px;">
              <thead>
                <tr style="background:#161b22; color:#8b949e; text-align:left;">
                  <th style="padding:8px; border-bottom:1px solid #30363d; width:150px;">ID</th>
                  <th style="padding:8px; border-bottom:1px solid #30363d; width:150px;">Hint Trigger</th>
                  <th style="padding:8px; border-bottom:1px solid #30363d;">Question</th>
                  <th style="padding:8px; border-bottom:1px solid #30363d; width:100px;">Locks To</th>
                </tr>
              </thead>
              <tbody>
                ${tableRows}
              </tbody>
            </table>
          </div>
        `}

        <div id="a2-clarifier-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:9999; align-items:center; justify-content:center;">
          <div style="background:#0d1117; border:1px solid #30363d; border-radius:16px; width:90%; max-width:600px; max-height:90vh; overflow-y:auto; padding:24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid #30363d; padding-bottom:16px;">
              <h3 style="margin:0; color:#e5e7eb; font-size:1.25rem;">Edit Clarifier</h3>
              <button id="a2-clarifier-modal-close" style="background:transparent; border:none; color:#8b949e; font-size:24px; cursor:pointer; padding:4px 8px;">X</button>
            </div>
            <div id="a2-clarifier-modal-content"></div>
          </div>
        </div>
      `
    );
  }

  renderClarifierModal(idx) {
    const clarifiers = this.config.discovery?.clarifiers || {};
    const entries = Array.isArray(clarifiers.entries) ? clarifiers.entries : [];
    const entry = idx === -1 ? { id: '', enabled: true, hintTrigger: '', question: '', locksTo: '', priority: 100 } : entries[idx];
    const isNew = idx === -1;

    return `
      <input type="hidden" id="a2-clarifier-modal-idx" value="${idx}" />

      <div style="margin-bottom:16px; padding:12px; background:#161b22; border:1px solid #30363d; border-radius:10px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input id="a2-clarifier-modal-enabled" type="checkbox" ${entry.enabled !== false ? 'checked' : ''} />
          <span style="color:#e5e7eb; font-weight:600;">Enabled</span>
        </label>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-bottom:16px;">
        <div>
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Clarifier ID</label>
          <input id="a2-clarifier-modal-id" value="${this.escapeHtml(entry.id || '')}"
            placeholder="e.g., clarify.thermostat"
            style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:10px;" />
        </div>
        <div>
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Priority</label>
          <input id="a2-clarifier-modal-priority" type="number" value="${entry.priority || 100}"
            style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:10px;" />
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Hint Trigger (vocabulary SOFT_HINT token)</label>
        <input id="a2-clarifier-modal-hintTrigger" value="${this.escapeHtml(entry.hintTrigger || '')}"
          placeholder="e.g., maybe_thermostat"
          style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:10px;" />
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Question (what the agent asks to clarify)</label>
        <textarea id="a2-clarifier-modal-question" rows="3"
          placeholder="e.g., Ok. When you say the thing on the wall, do you mean the thermostat?"
          style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:10px; resize:vertical;">${this.escapeHtml(entry.question || '')}</textarea>
      </div>

      <div style="margin-bottom:20px;">
        <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Locks To (component name if user confirms)</label>
        <input id="a2-clarifier-modal-locksTo" value="${this.escapeHtml(entry.locksTo || '')}"
          placeholder="e.g., thermostat"
          style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:10px;" />
      </div>

      <div style="display:flex; gap:10px;">
        ${!isNew ? `
          <button id="a2-clarifier-modal-delete" style="padding:10px 16px; background:#da3633; color:white; border:none; border-radius:8px; cursor:pointer;">Delete</button>
        ` : ''}
        <div style="flex:1;"></div>
        <button id="a2-clarifier-modal-cancel" style="padding:10px 16px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:8px; cursor:pointer;">Cancel</button>
        <button id="a2-clarifier-modal-save" style="padding:10px 16px; background:#238636; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600;">${isNew ? 'Add' : 'Save'}</button>
      </div>
    `;
  }

  _getStyleLines() {
    const style = this.config.discovery?.style || {};
    return [
      {
        id: 'bridge',
        label: 'Bridge line (dead-air filler)',
        enabled: style.bridge?.enabled === true,
        text: Array.isArray(style.bridge?.lines) ? style.bridge.lines[0] || '' : '',
        audioUrl: style.bridge?.audioUrl || '',
        configPath: 'bridge'
      },
      {
        id: 'robot_challenge',
        label: 'Robot challenge response',
        enabled: style.robotChallenge?.enabled === true,
        text: style.robotChallenge?.line || '',
        audioUrl: style.robotChallenge?.audioUrl || '',
        configPath: 'robotChallenge'
      },
      {
        id: 'delay_first',
        label: 'System delay - first line',
        enabled: style.systemDelay?.enabled === true,
        text: style.systemDelay?.firstLine || '',
        audioUrl: style.systemDelay?.firstLineAudioUrl || '',
        configPath: 'systemDelay.firstLine'
      },
      {
        id: 'delay_transfer',
        label: 'System delay - transfer fallback',
        enabled: style.systemDelay?.enabled === true,
        text: style.systemDelay?.transferLine || '',
        audioUrl: style.systemDelay?.transferLineAudioUrl || '',
        configPath: 'systemDelay.transferLine'
      },
      {
        id: 'when_in_doubt',
        label: 'When in doubt - transfer',
        enabled: style.whenInDoubt?.enabled === true,
        text: style.whenInDoubt?.transferLine || '',
        audioUrl: style.whenInDoubt?.audioUrl || '',
        configPath: 'whenInDoubt'
      }
    ];
  }

  renderStyleLineModal(lineId) {
    const lines = this._getStyleLines();
    const line = lines.find(l => l.id === lineId);
    if (!line) return '<div style="color:#f85149;">Line not found</div>';

    return `
      <input type="hidden" id="a2-style-modal-lineId" value="${lineId}" />

      <div style="margin-bottom:16px; padding:12px; background:#161b22; border:1px solid #30363d; border-radius:10px;">
        <div style="display:flex; align-items:center; gap:12px;">
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input id="a2-style-modal-enabled" type="checkbox" ${line.enabled ? 'checked' : ''} />
            <span style="color:#e5e7eb; font-weight:600;">Enabled</span>
          </label>
          <div style="flex:1;"></div>
          <div style="color:#8b949e; font-size:12px;">${this.escapeHtml(line.id)}</div>
        </div>
      </div>

      <div style="margin-bottom:16px;">
        <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">${this.escapeHtml(line.label)}</label>
        <textarea id="a2-style-modal-text" rows="4"
          placeholder="Enter the line the agent will speak..."
          style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:12px; resize:vertical;">${this.escapeHtml(line.text)}</textarea>
      </div>

      <div style="margin-bottom:20px;">
        <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Audio URL (agent plays this instead of TTS if set)</label>
        <div style="display:flex; gap:8px; align-items:center;">
          <input id="a2-style-modal-audioUrl" value="${this.escapeHtml(line.audioUrl)}"
            placeholder="Click 'Generate MP3' or paste a URL"
            style="flex:1; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:10px 12px; font-family:monospace; font-size:12px;" />
          <button id="a2-style-modal-play" style="padding:10px 14px; background:#1f6feb; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600; white-space:nowrap; display:${line.audioUrl ? 'block' : 'none'};">
            ▶ Play
          </button>
          <button id="a2-style-modal-generate" style="padding:10px 16px; background:#238636; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600; white-space:nowrap;">
            Generate MP3
          </button>
        </div>
        <div id="a2-style-modal-audio-status" style="margin-top:6px; color:#6e7681; font-size:11px;">
          ${line.audioUrl ? 'Audio URL set' : 'No audio yet — click Generate MP3'}
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:12px;">
        <button id="a2-style-modal-cancel" style="padding:12px 20px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:10px; cursor:pointer;">
          Cancel
        </button>
        <button id="a2-style-modal-save" style="padding:12px 20px; background:#238636; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:600;">
          Save Changes
        </button>
      </div>
    `;
  }

  renderPlaybookCard() {
    const pb = this.config.discovery?.playbook || {};
    const rules = Array.isArray(pb.rules) ? pb.rules : [];
    const allowedTypes = Array.isArray(pb.allowedScenarioTypes) ? pb.allowedScenarioTypes : [];
    const fallback = pb.fallback || {};

    const rows = rules.map((r, idx) => {
      const keywords = Array.isArray(r.match?.keywords) ? r.match.keywords.join(', ') : '';
      const hasAnswer = !!(r.answer?.answerText || '').trim();
      const hasAudio = !!(r.answer?.audioUrl || '').trim();
      const isEnabled = r.enabled !== false;
      const priority = typeof r.priority === 'number' ? r.priority : 100;
      const enabledBadge = isEnabled
        ? ''
        : '<span style="background:#f8514940; color:#f85149; padding:2px 6px; border-radius:4px; font-size:10px; margin-right:4px;">OFF</span>';
      const answerBadge = hasAnswer
        ? '<span style="background:#238636; color:white; padding:2px 6px; border-radius:4px; font-size:10px;">TEXT</span>'
        : '<span style="background:#6e7681; color:#c9d1d9; padding:2px 6px; border-radius:4px; font-size:10px;">EMPTY</span>';
      const audioBadge = hasAudio
        ? '<span style="background:#1f6feb; color:white; padding:2px 6px; border-radius:4px; font-size:10px; margin-left:4px;">AUDIO</span>'
        : '';
      const rowOpacity = isEnabled ? '1' : '0.5';
      return `
        <tr class="a2-rule-row" data-idx="${idx}" style="border-bottom:1px solid #1f2937; cursor:pointer; transition:background 0.15s; opacity:${rowOpacity};">
          <td style="padding:12px; color:#94a3b8; font-family:monospace;">${priority}</td>
          <td style="padding:12px; font-family:monospace; color:#22d3ee;">${enabledBadge}${this.escapeHtml(r.id || '---')}</td>
          <td style="padding:12px; color:#e5e7eb; font-weight:600;">${this.escapeHtml(r.label || 'Untitled')}</td>
          <td style="padding:12px; color:#94a3b8; font-size:13px;">${this.escapeHtml(keywords || '---')}</td>
          <td style="padding:12px;">${answerBadge}${audioBadge}</td>
          <td style="padding:12px; color:#94a3b8; font-size:13px; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">
            ${this.escapeHtml(r.followUp?.question || '---')}
          </td>
          <td style="padding:12px; text-align:center;">
            <button class="a2-rule-delete" data-idx="${idx}"
              style="background:#f8514940; color:#f85149; border:1px solid #f85149; padding:6px 10px; border-radius:8px; cursor:pointer; font-size:12px;">
              Delete
            </button>
          </td>
        </tr>
      `;
    }).join('');

    return this.renderCard(
      'Trigger Cards (Answer-first)',
      'Click a row to edit. Each card has keywords that trigger a direct answer. No scenario search needed.',
      `
        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap; margin-bottom:12px;">
          <div style="flex:1; min-width:240px;">
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Global allowed scenario types (comma separated)</label>
            <input id="a2-allowed-types" value="${this.escapeHtml(allowedTypes.join(', '))}"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; font-family:monospace;" />
          </div>
          <div style="width:180px;">
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Min score (fallback)</label>
            <input id="a2-min-score" type="number" step="0.01" min="0" max="1"
              value="${this.escapeHtml(pb.minScenarioScore ?? 0.72)}"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px;" />
          </div>
          <div style="align-self:flex-end; display:flex; gap:8px;">
            <button id="a2-load-samples" style="padding:10px 16px; background:#6e40c9; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:600;">
              Load 50 Sample Cards
            </button>
            <button id="a2-generate-all-audio" style="padding:10px 16px; background:#1f6feb; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:600;">
              Generate All Audio
            </button>
            <button id="a2-add-rule" style="padding:10px 16px; background:#238636; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:600;">
              + Add Trigger Card
            </button>
          </div>
        </div>

        <div style="margin-top:12px; display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:12px;">
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Fallback when no trigger matches (no reason captured)</label>
            <textarea id="a2-fallback-noMatchAnswer" rows="2"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; resize:vertical;"
              placeholder="Ok. How can I help you today?">${this.escapeHtml(fallback.noMatchAnswer || '')}</textarea>
          </div>
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:12px;">
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Default follow-up question after answering</label>
            <textarea id="a2-fallback-afterAnswerQuestion" rows="2"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; resize:vertical;"
              placeholder="Would you like to schedule a visit, or do you have a question I can help with?">${this.escapeHtml(fallback.afterAnswerQuestion || '')}</textarea>
          </div>
        </div>

        <div style="margin-top:12px; display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:12px;">
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Fallback when reason IS captured but no trigger matches</label>
            <textarea id="a2-fallback-noMatchWhenReasonCaptured" rows="2"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; resize:vertical;"
              placeholder="Ok. I'm sorry about that.">${this.escapeHtml(fallback.noMatchWhenReasonCaptured || '')}</textarea>
          </div>
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:12px;">
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Clarifier question (reason captured, no match)</label>
            <textarea id="a2-fallback-noMatchClarifierQuestion" rows="2"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; resize:vertical;"
              placeholder="Just so I help you the right way...">${this.escapeHtml(fallback.noMatchClarifierQuestion || '')}</textarea>
          </div>
        </div>

        <div style="margin-top:16px; border:1px solid #1f2937; border-radius:12px; overflow:hidden;">
          <table style="width:100%; border-collapse:collapse;">
            <thead style="background:#0b1220;">
              <tr style="border-bottom:1px solid #1f2937;">
                <th style="text-align:left; padding:12px; color:#94a3b8; font-size:12px; width:50px;">Pri</th>
                <th style="text-align:left; padding:12px; color:#94a3b8; font-size:12px; width:140px;">Rule ID</th>
                <th style="text-align:left; padding:12px; color:#94a3b8; font-size:12px; width:160px;">Label</th>
                <th style="text-align:left; padding:12px; color:#94a3b8; font-size:12px;">Keywords</th>
                <th style="text-align:left; padding:12px; color:#94a3b8; font-size:12px; width:100px;">Answer</th>
                <th style="text-align:left; padding:12px; color:#94a3b8; font-size:12px;">Follow-up</th>
                <th style="text-align:center; padding:12px; color:#94a3b8; font-size:12px; width:80px;">---</th>
              </tr>
            </thead>
            <tbody>
              ${rows || '<tr><td colspan="7" style="padding:20px; color:#94a3b8; text-align:center;">No trigger cards yet. Click "+ Add Trigger Card" to create one.</td></tr>'}
            </tbody>
          </table>
        </div>

        <div id="a2-rule-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:9999; align-items:center; justify-content:center;">
          <div style="background:#0d1117; border:1px solid #30363d; border-radius:16px; width:90%; max-width:700px; max-height:90vh; overflow-y:auto; padding:24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid #30363d; padding-bottom:16px;">
              <h3 style="margin:0; color:#e5e7eb; font-size:1.25rem;">Edit Trigger Card</h3>
              <button id="a2-modal-close" style="background:transparent; border:none; color:#8b949e; font-size:24px; cursor:pointer; padding:4px 8px;">X</button>
            </div>
            <div id="a2-modal-content"></div>
          </div>
        </div>

        <div id="a2-audio-generator-modal" style="display:none; position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.8); z-index:9999; align-items:center; justify-content:center;">
          <div style="background:#0d1117; border:1px solid #30363d; border-radius:16px; width:90%; max-width:800px; max-height:90vh; overflow-y:auto; padding:24px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px; border-bottom:1px solid #30363d; padding-bottom:16px;">
              <div>
                <h3 style="margin:0; color:#7ee787; font-size:1.25rem;">Instant Audio Generator</h3>
                <div style="color:#8b949e; font-size:12px; margin-top:4px;">Generate cached MP3s for Trigger Card answers. Uses your company's voice settings.</div>
              </div>
              <div style="display:flex; gap:12px; align-items:center;">
                <button id="a2-audio-generate-all" style="padding:10px 16px; background:#238636; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600;">
                  Generate All
                </button>
                <button id="a2-audio-generator-close" style="background:transparent; border:none; color:#8b949e; font-size:24px; cursor:pointer; padding:4px 8px;">X</button>
              </div>
            </div>
            <div id="a2-audio-generator-content"></div>
            <div style="margin-top:20px; text-align:right;">
              <button id="a2-audio-generator-done" style="padding:12px 24px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:10px; cursor:pointer;">
                Done
              </button>
            </div>
          </div>
        </div>
      `
    );
  }

  renderRuleModal(idx) {
    const rules = this.config.discovery?.playbook?.rules || [];
    const r = rules[idx] || {};
    const keywords = Array.isArray(r.match?.keywords) ? r.match.keywords.join(', ') : '';
    const negKeywords = Array.isArray(r.match?.negativeKeywords) ? r.match.negativeKeywords.join(', ') : '';
    const phrases = Array.isArray(r.match?.phrases) ? r.match.phrases.join('\n') : '';
    const typeAllow = Array.isArray(r.match?.scenarioTypeAllowlist) ? r.match.scenarioTypeAllowlist.join(', ') : '';
    const answerText = r.answer?.answerText || '';
    const audioUrl = r.answer?.audioUrl || '';
    const followUp = r.followUp?.question || '';
    const nextAction = r.followUp?.nextAction || 'CONTINUE';
    const isEnabled = r.enabled !== false;
    const priority = typeof r.priority === 'number' ? r.priority : 100;

    return `
      <input type="hidden" id="a2-modal-idx" value="${idx}" />

      <div style="display:flex; align-items:center; gap:16px; margin-bottom:16px; padding:12px; background:#161b22; border:1px solid #30363d; border-radius:10px;">
        <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
          <input id="a2-modal-enabled" type="checkbox" ${isEnabled ? 'checked' : ''} />
          <span style="color:#e5e7eb; font-weight:600;">Enabled</span>
        </label>
        <div style="flex:1;"></div>
        <div style="display:flex; align-items:center; gap:8px;">
          <label style="color:#8b949e; font-size:12px;">Priority:</label>
          <input id="a2-modal-priority" type="number" min="1" max="999" value="${priority}"
            style="width:70px; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; text-align:center;" />
          <span style="color:#6e7681; font-size:11px;">(lower = first)</span>
        </div>
      </div>

      <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px; margin-bottom:16px;">
        <div>
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Rule ID</label>
          <input id="a2-modal-id" value="${this.escapeHtml(r.id || '')}"
            style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:12px; font-family:monospace;" />
        </div>
        <div>
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Label (display name)</label>
          <input id="a2-modal-label" value="${this.escapeHtml(r.label || '')}"
            style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:12px;" />
        </div>
      </div>

      <div style="background:#161b22; border:1px solid #30363d; border-radius:12px; padding:16px; margin-bottom:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div style="font-weight:700; color:#22d3ee;">Matching</div>
          <button id="a2-modal-gpt-prefill" style="padding:8px 14px; background:#6e40c9; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600; font-size:12px;">
            GPT-4 Prefill
          </button>
        </div>
        <div style="margin-bottom:12px;">
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Keywords (comma separated) - All words must appear in caller's speech</label>
          <input id="a2-modal-keywords" value="${this.escapeHtml(keywords)}"
            placeholder="thermostat blank, ac not cooling, schedule today"
            style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:12px;" />
          <small style="color:#64748b; font-size:11px;">Flexible: "thermostat blank" matches "my thermostat is blank right now"</small>
        </div>
        <div style="margin-bottom:12px;">
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Phrases (one per line) - exact phrase match</label>
          <textarea id="a2-modal-phrases" rows="3"
            placeholder="how much is\nwhat does it cost\nwhat's the price"
            style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:12px; resize:vertical;">${this.escapeHtml(phrases)}</textarea>
        </div>
        <div>
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Negative keywords (comma separated) - do NOT match if these appear</label>
          <input id="a2-modal-negKeywords" value="${this.escapeHtml(negKeywords)}"
            placeholder="cancel, refund, complaint"
            style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:12px;" />
        </div>
      </div>

      <div style="background:#161b22; border:1px solid #30363d; border-radius:12px; padding:16px; margin-bottom:16px;">
        <div style="font-weight:700; color:#22d3ee; margin-bottom:12px;">Answer</div>
        <div style="margin-bottom:12px;">
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Answer Text (TTS will read this)</label>
          <textarea id="a2-modal-answerText" rows="4"
            placeholder="Our service call is $89, which includes the diagnostic. If we do the repair, the diagnostic fee is waived."
            style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:12px; resize:vertical;">${this.escapeHtml(answerText)}</textarea>
        </div>
        <div>
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Audio URL (agent plays this instead of TTS if set)</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input id="a2-modal-audioUrl" value="${this.escapeHtml(audioUrl)}"
              placeholder="Click 'Generate MP3' or paste a URL"
              style="flex:1; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:10px 12px; font-family:monospace; font-size:12px;" />
            <button id="a2-modal-play-audio" style="padding:10px 14px; background:#1f6feb; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600; white-space:nowrap; display:none;">
              ▶ Play
            </button>
            <button id="a2-modal-generate-audio" style="padding:10px 16px; background:#238636; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600; white-space:nowrap;">
              Generate MP3
            </button>
          </div>
          <div id="a2-modal-audio-status" style="margin-top:6px; color:#6e7681; font-size:11px;">
            Checking...
          </div>
        </div>
      </div>

      <div style="background:#161b22; border:1px solid #30363d; border-radius:12px; padding:16px; margin-bottom:16px;">
        <div style="font-weight:700; color:#22d3ee; margin-bottom:12px;">Follow-up</div>
        <div style="margin-bottom:12px;">
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Follow-up Question (asked after the answer)</label>
          <textarea id="a2-modal-followup" rows="2"
            placeholder="Would you like to schedule a repair visit, or were you looking for a maintenance tune-up?"
            style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:12px; resize:vertical;">${this.escapeHtml(followUp)}</textarea>
        </div>
        <div>
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Next Action</label>
          <select id="a2-modal-nextAction"
            style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:12px;">
            ${this._renderNextActionOption('CONTINUE', nextAction)}
            ${this._renderNextActionOption('OFFER_SCHEDULE_OR_ADVISOR', nextAction)}
            ${this._renderNextActionOption('OFFER_REPAIR_VS_MAINTENANCE', nextAction)}
            ${this._renderNextActionOption('TRANSFER_SERVICE_ADVISOR', nextAction)}
          </select>
        </div>
      </div>

      <div style="background:#161b22; border:1px solid #30363d; border-radius:12px; padding:16px; margin-bottom:20px;">
        <div style="font-weight:700; color:#8b949e; margin-bottom:12px;">Advanced (optional)</div>
        <div>
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Type Allowlist (for scenario fallback, comma separated)</label>
          <input id="a2-modal-types" value="${this.escapeHtml(typeAllow)}"
            placeholder="PRICING, FAQ"
            style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:12px; font-family:monospace;" />
        </div>
      </div>

      <div style="display:flex; justify-content:flex-end; gap:12px;">
        <button id="a2-modal-cancel" style="padding:12px 20px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:10px; cursor:pointer;">
          Cancel
        </button>
        <button id="a2-modal-save" style="padding:12px 20px; background:#238636; color:white; border:none; border-radius:10px; cursor:pointer; font-weight:600;">
          Save Changes
        </button>
      </div>
    `;
  }

  _renderNextActionOption(value, selected) {
    const sel = value === selected ? 'selected' : '';
    const labels = {
      CONTINUE: 'Continue (one clarifier)',
      OFFER_SCHEDULE_OR_ADVISOR: 'Offer: schedule vs advisor',
      OFFER_REPAIR_VS_MAINTENANCE: 'Ask: repair vs maintenance',
      TRANSFER_SERVICE_ADVISOR: 'Transfer: service advisor'
    };
    return `<option value="${value}" ${sel}>${this.escapeHtml(labels[value] || value)}</option>`;
  }

  renderSimulatorCard() {
    return this.renderCard(
      'Simulator (local)',
      'Paste an example caller message and see which playbook rule would fire. This is UI-only and does not call the LLM.',
      `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div>
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Caller text</label>
            <textarea id="a2-sim-input" rows="6"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:12px; padding:10px; resize:vertical;"
              placeholder="hi my name is nicole ..."></textarea>
            <button id="a2-sim-run"
              style="margin-top:10px; padding:10px 14px; background:#1f6feb; color:white; border:none; border-radius:10px; cursor:pointer;">
              Simulate
            </button>
          </div>
          <div>
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Planned response (proof JSON)</label>
            <textarea id="a2-sim-output" rows="10" readonly
              style="width:100%; background:#0b1220; color:#cbd5e1; border:1px solid #1f2937; border-radius:12px; padding:10px; font-family:monospace; font-size:12px; resize:vertical;"
            ></textarea>
            <div style="display:flex; gap:8px; margin-top:10px;">
              <button id="a2-sim-copy"
                style="padding:10px 14px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:10px; cursor:pointer;">
                Copy JSON
              </button>
              <button id="a2-sim-play"
                style="padding:10px 14px; background:#238636; color:white; border:none; border-radius:10px; cursor:pointer; display:flex; align-items:center; gap:6px;">
                <span style="font-size:14px;">&#9658;</span> Play Response
              </button>
            </div>
          </div>
        </div>
      `
    );
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Event handlers
  // ──────────────────────────────────────────────────────────────────────────
  attach(container) {
    const onAnyChange = () => this._setDirty(true);

    // TAB NAVIGATION
    container.querySelector('#a2-tab-config')?.addEventListener('click', () => {
      if (this._activeTab !== 'config') {
        this._activeTab = 'config';
        this.render(container);
      }
    });
    container.querySelector('#a2-tab-greetings')?.addEventListener('click', () => {
      if (this._activeTab !== 'greetings') {
        this._activeTab = 'greetings';
        this.render(container);
      }
    });
    container.querySelector('#a2-tab-callReview')?.addEventListener('click', () => {
      if (this._activeTab !== 'callReview') {
        this._activeTab = 'callReview';
        this.render(container);
      }
    });

    // ══════════════════════════════════════════════════════════════════════════
    // GREETINGS TAB HANDLERS
    // ══════════════════════════════════════════════════════════════════════════
    
    // Call Start Greeting
    container.querySelector('#a2-callstart-enabled')?.addEventListener('change', (e) => {
      this.config.greetings = this.config.greetings || {};
      this.config.greetings.callStart = this.config.greetings.callStart || {};
      this.config.greetings.callStart.enabled = e.target.checked;
      onAnyChange();
    });
    container.querySelector('#a2-callstart-text')?.addEventListener('input', (e) => {
      this.config.greetings = this.config.greetings || {};
      this.config.greetings.callStart = this.config.greetings.callStart || {};
      this.config.greetings.callStart.text = e.target.value;
      onAnyChange();
    });
    container.querySelector('#a2-callstart-audioUrl')?.addEventListener('input', (e) => {
      this.config.greetings = this.config.greetings || {};
      this.config.greetings.callStart = this.config.greetings.callStart || {};
      this.config.greetings.callStart.audioUrl = e.target.value.trim();
      onAnyChange();
    });

    // Greeting Interceptor settings
    container.querySelector('#a2-interceptor-enabled')?.addEventListener('change', (e) => {
      this.config.greetings = this.config.greetings || {};
      this.config.greetings.interceptor = this.config.greetings.interceptor || {};
      this.config.greetings.interceptor.enabled = e.target.checked;
      onAnyChange();
    });
    container.querySelector('#a2-interceptor-maxWords')?.addEventListener('input', (e) => {
      this.config.greetings = this.config.greetings || {};
      this.config.greetings.interceptor = this.config.greetings.interceptor || {};
      this.config.greetings.interceptor.maxWordsToQualify = parseInt(e.target.value, 10) || 2;
      onAnyChange();
    });
    container.querySelector('#a2-interceptor-blockIntent')?.addEventListener('change', (e) => {
      this.config.greetings = this.config.greetings || {};
      this.config.greetings.interceptor = this.config.greetings.interceptor || {};
      this.config.greetings.interceptor.blockIfContainsIntentWords = e.target.checked;
      onAnyChange();
    });
    container.querySelector('#a2-interceptor-intentWords')?.addEventListener('input', (e) => {
      this.config.greetings = this.config.greetings || {};
      this.config.greetings.interceptor = this.config.greetings.interceptor || {};
      this.config.greetings.interceptor.intentWords = e.target.value.split(',').map(w => w.trim()).filter(Boolean);
      onAnyChange();
    });

    // Greeting rules table row clicks
    container.querySelectorAll('.a2-greeting-rule-row').forEach(row => {
      row.addEventListener('click', (e) => {
        if (e.target.type === 'checkbox') return;
        const idx = parseInt(row.getAttribute('data-idx'), 10);
        this._openGreetingModal(idx);
      });
      row.addEventListener('mouseover', () => { row.style.background = '#161b22'; });
      row.addEventListener('mouseout', () => { row.style.background = 'transparent'; });
    });

    // Greeting rule enabled toggles
    container.querySelectorAll('.a2-greeting-rule-enabled').forEach(cb => {
      cb.addEventListener('change', (e) => {
        const idx = parseInt(cb.getAttribute('data-idx'), 10);
        this.config.greetings = this.config.greetings || {};
        this.config.greetings.interceptor = this.config.greetings.interceptor || {};
        this.config.greetings.interceptor.rules = this.config.greetings.interceptor.rules || [];
        if (this.config.greetings.interceptor.rules[idx]) {
          this.config.greetings.interceptor.rules[idx].enabled = e.target.checked;
          onAnyChange();
        }
      });
    });

    // Add greeting rule button
    container.querySelector('#a2-greeting-add')?.addEventListener('click', () => {
      this._openGreetingModal(-1);
    });

    // Seed From Global button
    container.querySelector('#a2-greeting-seed')?.addEventListener('click', async () => {
      const mode = confirm('Replace existing rules? (OK = Replace, Cancel = Merge)') ? 'replace' : 'merge';
      try {
        const token = this._getToken();
        const res = await fetch(`/api/admin/agent2/${this.companyId}/greetings/seed-from-global?mode=${mode}`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          }
        });
        const json = await res.json();
        if (json.success) {
          this.config.greetings = json.data;
          onAnyChange();
          this.render(container);
          alert(`Seeded ${json.meta?.legacyRulesImported || 0} rules from global config.`);
        } else {
          alert('Seed failed: ' + (json.message || 'Unknown error'));
        }
      } catch (e) {
        alert('Seed error: ' + e.message);
      }
    });

    // Greeting modal buttons
    container.querySelector('#a2-greeting-modal-save')?.addEventListener('click', () => {
      this._saveGreetingModal();
      onAnyChange();
      this.render(container);
    });
    container.querySelector('#a2-greeting-modal-delete')?.addEventListener('click', () => {
      this._deleteGreetingRule();
      onAnyChange();
      this.render(container);
    });
    container.querySelector('#a2-greeting-modal-cancel')?.addEventListener('click', () => {
      this._closeGreetingModal();
    });

    // Bridge settings
    container.querySelector('#a2-bridge-enabled')?.addEventListener('change', (e) => {
      this.config.discovery = this.config.discovery || {};
      this.config.discovery.style = this.config.discovery.style || {};
      this.config.discovery.style.bridge = this.config.discovery.style.bridge || {};
      this.config.discovery.style.bridge.enabled = e.target.checked;
      onAnyChange();
    });
    container.querySelector('#a2-bridge-maxPerTurn')?.addEventListener('input', (e) => {
      this.config.discovery = this.config.discovery || {};
      this.config.discovery.style = this.config.discovery.style || {};
      this.config.discovery.style.bridge = this.config.discovery.style.bridge || {};
      this.config.discovery.style.bridge.maxPerTurn = parseInt(e.target.value, 10) || 1;
      onAnyChange();
    });
    container.querySelector('#a2-bridge-lines')?.addEventListener('input', (e) => {
      this.config.discovery = this.config.discovery || {};
      this.config.discovery.style = this.config.discovery.style || {};
      this.config.discovery.style.bridge = this.config.discovery.style.bridge || {};
      this.config.discovery.style.bridge.lines = e.target.value.split('\n').map(l => l.trim()).filter(Boolean);
      onAnyChange();
    });

    // CALL REVIEW TAB HANDLERS
    container.querySelector('#a2-refresh-calls')?.addEventListener('click', () => {
      this._calls = [];
      this.loadCalls();
    });

    container.querySelectorAll('.a2-call-card').forEach((card) => {
      card.addEventListener('click', () => {
        const idx = Number(card.getAttribute('data-call-idx'));
        const call = this._calls[idx];
        if (call) this.openCallModal(call);
      });
      card.addEventListener('mouseover', () => { card.style.borderColor = '#30363d'; card.style.background = '#161b22'; });
      card.addEventListener('mouseout', () => { card.style.borderColor = '#1f2937'; card.style.background = '#0b1220'; });
    });

    // CONFIG TAB HANDLERS (existing)
    const enabled = container.querySelector('#a2-enabled');
    const dEnabled = container.querySelector('#a2-discovery-enabled');
    enabled?.addEventListener('change', (e) => { this.config.enabled = e.target.checked; onAnyChange(); });
    dEnabled?.addEventListener('change', (e) => { this.config.discovery.enabled = e.target.checked; onAnyChange(); });

    container.querySelector('#a2-reset')?.addEventListener('click', () => {
      if (!confirm('Reset Agent 2.0 config to defaults?')) return;
      this.config = this.getDefaultConfig();
      this.isDirty = true;
      this.render(container);
    });

    container.querySelector('#a2-export-json')?.addEventListener('click', async () => {
      const payload = JSON.stringify(this.config || {}, null, 2);
      await navigator.clipboard.writeText(payload);
      alert('Copied Agent 2.0 JSON to clipboard.');
    });

    container.querySelector('#a2-save')?.addEventListener('click', async () => {
      try {
        this._readFormIntoConfig(container);
        await this.save();
        this.render(container);
        alert('Saved Agent 2.0 config.');
      } catch (e) {
        console.error(e);
        alert(`Save failed: ${e.message || e}`);
      }
    });

    container.querySelectorAll('#a2-style-ackWord, #a2-style-forbid, #a2-allowed-types, #a2-min-score')
      .forEach((el) => el?.addEventListener('input', onAnyChange));
    container.querySelectorAll('#a2-fallback-noMatchAnswer, #a2-fallback-afterAnswerQuestion')
      .forEach((el) => el?.addEventListener('input', onAnyChange));
    container.querySelectorAll('#a2-fallback-noMatchWhenReasonCaptured, #a2-fallback-noMatchClarifierQuestion')
      .forEach((el) => el?.addEventListener('input', onAnyChange));

    // Style lines table - click row to open modal
    container.querySelectorAll('.a2-style-row').forEach((row) => {
      row.addEventListener('click', () => {
        const lineId = row.getAttribute('data-line-id');
        this._openStyleModal(lineId);
      });
      row.addEventListener('mouseover', () => { row.style.background = '#161b22'; });
      row.addEventListener('mouseout', () => { row.style.background = 'transparent'; });
    });

    container.querySelector('#a2-style-modal-close')?.addEventListener('click', () => this._closeStyleModal());
    container.querySelector('#a2-style-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'a2-style-modal') this._closeStyleModal();
    });

    container.querySelector('#a2-add-rule')?.addEventListener('click', () => {
      const rules = this.config.discovery.playbook.rules || [];
      const newIdx = rules.length;
      rules.push({
        id: `trigger_${Date.now()}`,
        label: 'New Trigger Card',
        match: { keywords: [], phrases: [], negativeKeywords: [], scenarioTypeAllowlist: [] },
        answer: { answerText: '', audioUrl: '' },
        followUp: { question: '', nextAction: 'CONTINUE' }
      });
      this.config.discovery.playbook.rules = rules;
      this.isDirty = true;
      this.render(container);
      setTimeout(() => this._openModal(newIdx), 50);
    });

    container.querySelector('#a2-generate-all-audio')?.addEventListener('click', () => this._openAudioGenerator());

    container.querySelector('#a2-load-samples')?.addEventListener('click', () => {
      if (!confirm('This will add 50 sample HVAC trigger cards. Existing cards will be kept. Continue?')) return;
      this._loadSampleCards();
      this.render(container);
    });

    container.querySelectorAll('.a2-rule-delete').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const idx = Number(btn.getAttribute('data-idx'));
        if (!confirm('Delete this trigger card?')) return;
        const rules = this.config.discovery.playbook.rules || [];
        rules.splice(idx, 1);
        this.config.discovery.playbook.rules = rules;
        this.isDirty = true;
        this.render(container);
      });
    });

    container.querySelectorAll('.a2-rule-row').forEach((row) => {
      row.addEventListener('click', (e) => {
        if (e.target.closest('.a2-rule-delete')) return;
        const idx = Number(row.getAttribute('data-idx'));
        this._openModal(idx);
      });
      row.addEventListener('mouseover', () => { row.style.background = '#161b22'; });
      row.addEventListener('mouseout', () => { row.style.background = 'transparent'; });
    });

    container.querySelector('#a2-modal-close')?.addEventListener('click', () => this._closeModal());
    container.querySelector('#a2-rule-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'a2-rule-modal') this._closeModal();
    });

    container.querySelector('#a2-sim-run')?.addEventListener('click', () => {
      this._readFormIntoConfig(container);
      const input = container.querySelector('#a2-sim-input')?.value || '';
      const plan = this.simulate(input);
      const out = container.querySelector('#a2-sim-output');
      if (out) out.value = JSON.stringify(plan, null, 2);
    });

    container.querySelector('#a2-sim-copy')?.addEventListener('click', async () => {
      const out = container.querySelector('#a2-sim-output');
      const text = out?.value || '';
      if (!text) return;
      await navigator.clipboard.writeText(text);
      alert('Copied simulator JSON.');
    });

    // Play Response button - uses browser TTS to speak the planned response
    container.querySelector('#a2-sim-play')?.addEventListener('click', () => {
      const out = container.querySelector('#a2-sim-output');
      const text = out?.value || '';
      if (!text) {
        alert('Run the simulator first to generate a response.');
        return;
      }
      
      try {
        const plan = JSON.parse(text);
        const responseText = plan.spokenPreview || plan.response || plan.plannedResponse || '';
        if (!responseText) {
          alert('No response text to play.');
          return;
        }
        
        // Cancel any ongoing speech
        window.speechSynthesis.cancel();
        
        const utterance = new SpeechSynthesisUtterance(responseText);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        
        // Try to use a natural-sounding voice if available
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(v => v.name.includes('Samantha') || v.name.includes('Karen') || v.name.includes('Google')) 
                           || voices.find(v => v.lang.startsWith('en'));
        if (preferredVoice) utterance.voice = preferredVoice;
        
        // Update button state while playing
        const btn = container.querySelector('#a2-sim-play');
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '<span style="font-size:14px;">&#9632;</span> Playing...';
        btn.style.background = '#6e7681';
        
        utterance.onend = () => {
          btn.innerHTML = originalHTML;
          btn.style.background = '#238636';
        };
        utterance.onerror = () => {
          btn.innerHTML = originalHTML;
          btn.style.background = '#238636';
        };
        
        window.speechSynthesis.speak(utterance);
      } catch (e) {
        alert('Could not parse response JSON.');
      }
    });

    // ══════════════════════════════════════════════════════════════════════════
    // VOCABULARY HANDLERS
    // ══════════════════════════════════════════════════════════════════════════
    container.querySelector('#a2-vocab-enabled')?.addEventListener('change', (e) => {
      this.config.discovery = this.config.discovery || {};
      this.config.discovery.vocabulary = this.config.discovery.vocabulary || {};
      this.config.discovery.vocabulary.enabled = e.target.checked;
      onAnyChange();
    });

    container.querySelector('#a2-vocab-add')?.addEventListener('click', () => {
      this._openVocabModal(-1);
    });

    container.querySelectorAll('.a2-vocab-row').forEach((row) => {
      row.addEventListener('click', () => {
        const idx = Number(row.getAttribute('data-vocab-idx'));
        this._openVocabModal(idx);
      });
      row.addEventListener('mouseover', () => { row.style.background = '#161b22'; });
      row.addEventListener('mouseout', () => { row.style.background = 'transparent'; });
    });

    container.querySelector('#a2-vocab-modal-close')?.addEventListener('click', () => this._closeVocabModal());
    container.querySelector('#a2-vocab-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'a2-vocab-modal') this._closeVocabModal();
    });

    // ══════════════════════════════════════════════════════════════════════════
    // CLARIFIERS HANDLERS
    // ══════════════════════════════════════════════════════════════════════════
    container.querySelector('#a2-clarifiers-enabled')?.addEventListener('change', (e) => {
      this.config.discovery = this.config.discovery || {};
      this.config.discovery.clarifiers = this.config.discovery.clarifiers || {};
      this.config.discovery.clarifiers.enabled = e.target.checked;
      onAnyChange();
    });

    container.querySelector('#a2-clarifiers-maxAsks')?.addEventListener('input', (e) => {
      this.config.discovery = this.config.discovery || {};
      this.config.discovery.clarifiers = this.config.discovery.clarifiers || {};
      this.config.discovery.clarifiers.maxAsksPerCall = Number(e.target.value) || 2;
      onAnyChange();
    });

    container.querySelector('#a2-clarifier-add')?.addEventListener('click', () => {
      this._openClarifierModal(-1);
    });

    container.querySelectorAll('.a2-clarifier-row').forEach((row) => {
      row.addEventListener('click', () => {
        const idx = Number(row.getAttribute('data-clarifier-idx'));
        this._openClarifierModal(idx);
      });
      row.addEventListener('mouseover', () => { row.style.background = '#161b22'; });
      row.addEventListener('mouseout', () => { row.style.background = 'transparent'; });
    });

    container.querySelector('#a2-clarifier-modal-close')?.addEventListener('click', () => this._closeClarifierModal());
    container.querySelector('#a2-clarifier-modal')?.addEventListener('click', (e) => {
      if (e.target.id === 'a2-clarifier-modal') this._closeClarifierModal();
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // GREETING MODAL
  // ══════════════════════════════════════════════════════════════════════════
  _greetingModalIdx = -1;

  _openGreetingModal(idx) {
    const modal = document.getElementById('a2-greeting-modal');
    const content = document.getElementById('a2-greeting-modal-content');
    if (!modal || !content) return;

    this._greetingModalIdx = idx;
    content.innerHTML = this.renderGreetingRuleModal(idx);
    modal.style.display = 'flex';
  }

  _closeGreetingModal() {
    const modal = document.getElementById('a2-greeting-modal');
    if (modal) modal.style.display = 'none';
    this._greetingModalIdx = -1;
  }

  _saveGreetingModal() {
    const idx = this._greetingModalIdx;

    const rule = {
      id: (document.getElementById('a2-greeting-modal-id')?.value || '').trim() || `greeting.custom.${Date.now()}`,
      enabled: document.getElementById('a2-greeting-modal-enabled')?.checked !== false,
      priority: parseInt(document.getElementById('a2-greeting-modal-priority')?.value, 10) || 50,
      matchMode: document.getElementById('a2-greeting-modal-matchMode')?.value || 'EXACT',
      triggers: (document.getElementById('a2-greeting-modal-triggers')?.value || '')
        .split(',')
        .map(t => t.trim().toLowerCase())
        .filter(Boolean),
      responseText: (document.getElementById('a2-greeting-modal-responseText')?.value || '').trim(),
      audioUrl: (document.getElementById('a2-greeting-modal-audioUrl')?.value || '').trim()
    };

    if (!rule.triggers.length) {
      alert('At least one trigger is required.');
      return;
    }
    if (!rule.responseText && !rule.audioUrl) {
      alert('Response text or audio URL is required.');
      return;
    }

    this.config.greetings = this.config.greetings || {};
    this.config.greetings.interceptor = this.config.greetings.interceptor || {};
    this.config.greetings.interceptor.rules = this.config.greetings.interceptor.rules || [];

    if (idx === -1) {
      this.config.greetings.interceptor.rules.push(rule);
    } else {
      this.config.greetings.interceptor.rules[idx] = rule;
    }

    this._closeGreetingModal();
  }

  _deleteGreetingRule() {
    const idx = this._greetingModalIdx;
    if (idx === -1) {
      this._closeGreetingModal();
      return;
    }

    if (!confirm('Delete this greeting rule?')) return;

    const rules = this.config.greetings?.interceptor?.rules || [];
    rules.splice(idx, 1);

    this._closeGreetingModal();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // VOCABULARY MODAL
  // ══════════════════════════════════════════════════════════════════════════
  _openVocabModal(idx) {
    const modal = document.getElementById('a2-vocab-modal');
    const content = document.getElementById('a2-vocab-modal-content');
    if (!modal || !content) return;

    content.innerHTML = this.renderVocabularyEntryModal(idx);
    modal.style.display = 'flex';

    document.getElementById('a2-vocab-modal-cancel')?.addEventListener('click', () => this._closeVocabModal());
    document.getElementById('a2-vocab-modal-save')?.addEventListener('click', () => this._saveVocabModal());
    document.getElementById('a2-vocab-modal-delete')?.addEventListener('click', () => this._deleteVocabEntry());
    document.getElementById('a2-vocab-modal-close')?.addEventListener('click', () => this._closeVocabModal());
  }

  _closeVocabModal() {
    const modal = document.getElementById('a2-vocab-modal');
    if (modal) modal.style.display = 'none';
  }

  _saveVocabModal() {
    const idxEl = document.getElementById('a2-vocab-modal-idx');
    if (!idxEl) return;
    const idx = Number(idxEl.value);

    const entry = {
      enabled: document.getElementById('a2-vocab-modal-enabled')?.checked !== false,
      priority: Number(document.getElementById('a2-vocab-modal-priority')?.value) || 100,
      type: document.getElementById('a2-vocab-modal-type')?.value || 'HARD_NORMALIZE',
      matchMode: document.getElementById('a2-vocab-modal-matchMode')?.value || 'EXACT',
      from: (document.getElementById('a2-vocab-modal-from')?.value || '').trim(),
      to: (document.getElementById('a2-vocab-modal-to')?.value || '').trim(),
      notes: (document.getElementById('a2-vocab-modal-notes')?.value || '').trim()
    };

    if (!entry.from || !entry.to) {
      alert('From and To fields are required.');
      return;
    }

    this.config.discovery = this.config.discovery || {};
    this.config.discovery.vocabulary = this.config.discovery.vocabulary || {};
    this.config.discovery.vocabulary.entries = this.config.discovery.vocabulary.entries || [];

    if (idx === -1) {
      this.config.discovery.vocabulary.entries.push(entry);
    } else {
      this.config.discovery.vocabulary.entries[idx] = entry;
    }

    this.isDirty = true;
    this._closeVocabModal();
    if (this._container) this.render(this._container);
  }

  _deleteVocabEntry() {
    const idxEl = document.getElementById('a2-vocab-modal-idx');
    if (!idxEl) return;
    const idx = Number(idxEl.value);

    if (idx === -1) return;
    if (!confirm('Delete this vocabulary entry?')) return;

    const entries = this.config.discovery?.vocabulary?.entries || [];
    entries.splice(idx, 1);

    this.isDirty = true;
    this._closeVocabModal();
    if (this._container) this.render(this._container);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CLARIFIER MODAL
  // ══════════════════════════════════════════════════════════════════════════
  _openClarifierModal(idx) {
    const modal = document.getElementById('a2-clarifier-modal');
    const content = document.getElementById('a2-clarifier-modal-content');
    if (!modal || !content) return;

    content.innerHTML = this.renderClarifierModal(idx);
    modal.style.display = 'flex';

    document.getElementById('a2-clarifier-modal-cancel')?.addEventListener('click', () => this._closeClarifierModal());
    document.getElementById('a2-clarifier-modal-save')?.addEventListener('click', () => this._saveClarifierModal());
    document.getElementById('a2-clarifier-modal-delete')?.addEventListener('click', () => this._deleteClarifierEntry());
    document.getElementById('a2-clarifier-modal-close')?.addEventListener('click', () => this._closeClarifierModal());
  }

  _closeClarifierModal() {
    const modal = document.getElementById('a2-clarifier-modal');
    if (modal) modal.style.display = 'none';
  }

  _saveClarifierModal() {
    const idxEl = document.getElementById('a2-clarifier-modal-idx');
    if (!idxEl) return;
    const idx = Number(idxEl.value);

    const entry = {
      id: (document.getElementById('a2-clarifier-modal-id')?.value || '').trim(),
      enabled: document.getElementById('a2-clarifier-modal-enabled')?.checked !== false,
      priority: Number(document.getElementById('a2-clarifier-modal-priority')?.value) || 100,
      hintTrigger: (document.getElementById('a2-clarifier-modal-hintTrigger')?.value || '').trim(),
      question: (document.getElementById('a2-clarifier-modal-question')?.value || '').trim(),
      locksTo: (document.getElementById('a2-clarifier-modal-locksTo')?.value || '').trim()
    };

    if (!entry.id || !entry.hintTrigger || !entry.question) {
      alert('ID, Hint Trigger, and Question are required.');
      return;
    }

    this.config.discovery = this.config.discovery || {};
    this.config.discovery.clarifiers = this.config.discovery.clarifiers || {};
    this.config.discovery.clarifiers.entries = this.config.discovery.clarifiers.entries || [];

    if (idx === -1) {
      this.config.discovery.clarifiers.entries.push(entry);
    } else {
      this.config.discovery.clarifiers.entries[idx] = entry;
    }

    this.isDirty = true;
    this._closeClarifierModal();
    if (this._container) this.render(this._container);
  }

  _deleteClarifierEntry() {
    const idxEl = document.getElementById('a2-clarifier-modal-idx');
    if (!idxEl) return;
    const idx = Number(idxEl.value);

    if (idx === -1) return;
    if (!confirm('Delete this clarifier?')) return;

    const entries = this.config.discovery?.clarifiers?.entries || [];
    entries.splice(idx, 1);

    this.isDirty = true;
    this._closeClarifierModal();
    if (this._container) this.render(this._container);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Style Line Modal
  // ──────────────────────────────────────────────────────────────────────────
  _openStyleModal(lineId) {
    const modal = document.getElementById('a2-style-modal');
    const content = document.getElementById('a2-style-modal-content');
    if (!modal || !content) return;

    content.innerHTML = this.renderStyleLineModal(lineId);
    modal.style.display = 'flex';

    document.getElementById('a2-style-modal-cancel')?.addEventListener('click', () => this._closeStyleModal());
    document.getElementById('a2-style-modal-save')?.addEventListener('click', () => this._saveStyleModal());
    document.getElementById('a2-style-modal-close')?.addEventListener('click', () => this._closeStyleModal());
    document.getElementById('a2-style-modal-generate')?.addEventListener('click', () => this._generateStyleAudio());
    document.getElementById('a2-style-modal-play')?.addEventListener('click', () => this._playStyleAudio());

    // Show/hide play button when URL changes
    document.getElementById('a2-style-modal-audioUrl')?.addEventListener('input', () => {
      const playBtn = document.getElementById('a2-style-modal-play');
      const audioUrl = (document.getElementById('a2-style-modal-audioUrl')?.value || '').trim();
      if (playBtn) {
        playBtn.style.display = audioUrl ? 'block' : 'none';
      }
    });
  }

  _closeStyleModal() {
    const modal = document.getElementById('a2-style-modal');
    if (modal) modal.style.display = 'none';
  }

  _saveStyleModal() {
    const lineIdEl = document.getElementById('a2-style-modal-lineId');
    if (!lineIdEl) return;
    const lineId = lineIdEl.value;

    const enabled = document.getElementById('a2-style-modal-enabled')?.checked === true;
    const text = (document.getElementById('a2-style-modal-text')?.value || '').trim();
    const audioUrl = (document.getElementById('a2-style-modal-audioUrl')?.value || '').trim();

    const style = this.config.discovery.style = this.config.discovery.style || {};

    switch (lineId) {
      case 'bridge':
        style.bridge = style.bridge || {};
        style.bridge.enabled = enabled;
        style.bridge.lines = text ? [text] : [];
        style.bridge.audioUrl = audioUrl;
        break;
      case 'robot_challenge':
        style.robotChallenge = style.robotChallenge || {};
        style.robotChallenge.enabled = enabled;
        style.robotChallenge.line = text;
        style.robotChallenge.audioUrl = audioUrl;
        break;
      case 'delay_first':
        style.systemDelay = style.systemDelay || {};
        style.systemDelay.enabled = enabled;
        style.systemDelay.firstLine = text;
        style.systemDelay.firstLineAudioUrl = audioUrl;
        break;
      case 'delay_transfer':
        style.systemDelay = style.systemDelay || {};
        style.systemDelay.enabled = enabled;
        style.systemDelay.transferLine = text;
        style.systemDelay.transferLineAudioUrl = audioUrl;
        break;
      case 'when_in_doubt':
        style.whenInDoubt = style.whenInDoubt || {};
        style.whenInDoubt.enabled = enabled;
        style.whenInDoubt.transferLine = text;
        style.whenInDoubt.audioUrl = audioUrl;
        break;
    }

    this.isDirty = true;
    this._closeStyleModal();
    if (this._container) this.render(this._container);
  }

  async _generateStyleAudio() {
    const generateBtn = document.getElementById('a2-style-modal-generate');
    const statusEl = document.getElementById('a2-style-modal-audio-status');
    const textEl = document.getElementById('a2-style-modal-text');
    const lineIdEl = document.getElementById('a2-style-modal-lineId');
    const text = (textEl?.value || '').trim();
    const lineId = lineIdEl?.value || 'STYLE_LINE';

    if (!text) {
      alert('Enter text first');
      return;
    }

    if (generateBtn) {
      generateBtn.disabled = true;
      generateBtn.textContent = 'Generating...';
    }
    if (statusEl) {
      statusEl.innerHTML = 'Generating audio...';
    }

    try {
      const token = this._getToken();
      const res = await fetch(`/api/admin/front-desk-behavior/${this.companyId}/instant-audio/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          kind: `STYLE_${lineId.toUpperCase()}`,
          text,
          force: true
        })
      });

      const json = await res.json();

      if (json.success) {
        if (statusEl) {
          statusEl.innerHTML = '<span style="color:#7ee787;">Audio generated!</span>';
        }
        if (generateBtn) {
          generateBtn.textContent = 'Regenerate';
          generateBtn.disabled = false;
        }
        const playBtn = document.getElementById('a2-style-modal-play');
        if (playBtn && json.url) {
          playBtn.style.display = 'block';
        }
        const audioUrlEl = document.getElementById('a2-style-modal-audioUrl');
        if (audioUrlEl && json.url) {
          audioUrlEl.value = json.url;
        }
      } else {
        throw new Error(json.error || 'Generation failed');
      }
    } catch (e) {
      console.error('Style audio generation failed:', e);
      if (statusEl) {
        statusEl.innerHTML = `<span style="color:#f85149;">Error: ${e.message || 'Generation failed'}</span>`;
      }
      if (generateBtn) {
        generateBtn.textContent = 'Generate MP3';
        generateBtn.disabled = false;
      }
    }
  }

  _playStyleAudio() {
    const playBtn = document.getElementById('a2-style-modal-play');
    const audioUrlEl = document.getElementById('a2-style-modal-audioUrl');
    const audioUrl = (audioUrlEl?.value || '').trim();

    if (!audioUrl) {
      alert('No audio URL. Generate MP3 first or paste a URL.');
      return;
    }

    if (this._currentAudio) {
      this._currentAudio.pause();
      this._currentAudio = null;
      if (playBtn) playBtn.textContent = '▶ Play';
      return;
    }

    const audio = new Audio(audioUrl);
    this._currentAudio = audio;
    if (playBtn) playBtn.textContent = '⏹ Stop';

    audio.onended = () => {
      this._currentAudio = null;
      if (playBtn) playBtn.textContent = '▶ Play';
    };

    audio.onerror = () => {
      this._currentAudio = null;
      if (playBtn) playBtn.textContent = '▶ Play';
      alert('Failed to play audio.');
    };

    audio.play().catch(err => {
      console.error('Audio play failed:', err);
      this._currentAudio = null;
      if (playBtn) playBtn.textContent = '▶ Play';
    });
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Trigger Card Modal
  // ──────────────────────────────────────────────────────────────────────────
  _openModal(idx) {
    const modal = document.getElementById('a2-rule-modal');
    const content = document.getElementById('a2-modal-content');
    if (!modal || !content) return;

    content.innerHTML = this.renderRuleModal(idx);
    modal.style.display = 'flex';

    document.getElementById('a2-modal-cancel')?.addEventListener('click', () => this._closeModal());
    document.getElementById('a2-modal-save')?.addEventListener('click', () => this._saveModal());
    document.getElementById('a2-modal-close')?.addEventListener('click', () => this._closeModal());
    document.getElementById('a2-modal-generate-audio')?.addEventListener('click', () => this._generateAudio());
    document.getElementById('a2-modal-gpt-prefill')?.addEventListener('click', () => this._gptPrefill());
    document.getElementById('a2-modal-play-audio')?.addEventListener('click', () => this._playAudio());

    let audioCheckTimeout = null;
    document.getElementById('a2-modal-answerText')?.addEventListener('input', () => {
      clearTimeout(audioCheckTimeout);
      audioCheckTimeout = setTimeout(() => this._checkAudioStatus(), 500);
    });

    // Show/hide play button when URL changes
    document.getElementById('a2-modal-audioUrl')?.addEventListener('input', () => {
      const playBtn = document.getElementById('a2-modal-play-audio');
      const audioUrl = (document.getElementById('a2-modal-audioUrl')?.value || '').trim();
      if (playBtn) {
        playBtn.style.display = audioUrl ? 'block' : 'none';
      }
    });

    this._checkAudioStatus();
  }

  _closeModal() {
    const modal = document.getElementById('a2-rule-modal');
    if (modal) modal.style.display = 'none';
  }

  _saveModal() {
    const idxEl = document.getElementById('a2-modal-idx');
    if (!idxEl) return;
    const idx = Number(idxEl.value);
    const rules = this.config.discovery?.playbook?.rules || [];
    if (!rules[idx]) rules[idx] = {};

    rules[idx].enabled = document.getElementById('a2-modal-enabled')?.checked !== false;
    const priorityVal = Number(document.getElementById('a2-modal-priority')?.value);
    rules[idx].priority = Number.isFinite(priorityVal) && priorityVal > 0 ? priorityVal : 100;

    rules[idx].id = (document.getElementById('a2-modal-id')?.value || '').trim();
    rules[idx].label = (document.getElementById('a2-modal-label')?.value || '').trim();

    rules[idx].match = rules[idx].match || {};
    rules[idx].match.keywords = (document.getElementById('a2-modal-keywords')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    rules[idx].match.phrases = (document.getElementById('a2-modal-phrases')?.value || '').split('\n').map(s => s.trim()).filter(Boolean);
    rules[idx].match.negativeKeywords = (document.getElementById('a2-modal-negKeywords')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
    rules[idx].match.scenarioTypeAllowlist = (document.getElementById('a2-modal-types')?.value || '').split(',').map(s => s.trim()).filter(Boolean);

    rules[idx].answer = rules[idx].answer || {};
    rules[idx].answer.answerText = (document.getElementById('a2-modal-answerText')?.value || '').trim();
    rules[idx].answer.audioUrl = (document.getElementById('a2-modal-audioUrl')?.value || '').trim();

    rules[idx].followUp = rules[idx].followUp || {};
    rules[idx].followUp.question = (document.getElementById('a2-modal-followup')?.value || '').trim();
    rules[idx].followUp.nextAction = document.getElementById('a2-modal-nextAction')?.value || 'CONTINUE';

    this.config.discovery.playbook.rules = rules;
    this.isDirty = true;
    this._closeModal();
    if (this._container) this.render(this._container);
  }

  async _checkAudioStatus() {
    const statusEl = document.getElementById('a2-modal-audio-status');
    const generateBtn = document.getElementById('a2-modal-generate-audio');
    const playBtn = document.getElementById('a2-modal-play-audio');
    const answerTextEl = document.getElementById('a2-modal-answerText');
    const audioUrlEl = document.getElementById('a2-modal-audioUrl');
    const text = (answerTextEl?.value || '').trim();
    const savedAudioUrl = (audioUrlEl?.value || '').trim();

    // Show/hide play button based on whether there's a URL in the input
    const updatePlayButton = () => {
      const currentUrl = (audioUrlEl?.value || '').trim();
      if (currentUrl && playBtn) {
        playBtn.style.display = 'block';
        playBtn.setAttribute('data-audio-url', currentUrl);
      } else if (playBtn) {
        playBtn.style.display = 'none';
      }
    };

    // Always show play button if there's a URL
    updatePlayButton();

    if (!text) {
      if (statusEl) {
        statusEl.innerHTML = 'Enter answer text to generate audio';
      }
      if (generateBtn) {
        generateBtn.disabled = true;
        generateBtn.style.opacity = '0.5';
      }
      return;
    }

    if (generateBtn) {
      generateBtn.disabled = false;
      generateBtn.style.opacity = '1';
    }

    if (statusEl) {
      statusEl.innerHTML = 'Checking if audio matches current text...';
    }

    try {
      const token = this._getToken();
      const res = await fetch(`/api/admin/front-desk-behavior/${this.companyId}/instant-audio/status`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          items: [{ kind: 'TRIGGER_CARD_ANSWER', text }]
        })
      });

      const json = await res.json();
      const item = json?.items?.[0];

      if (item?.exists) {
        // Audio file exists for current text
        if (statusEl) {
          statusEl.innerHTML = `<span style="color:#7ee787;">Audio matches current text</span>`;
        }
        if (generateBtn) {
          generateBtn.textContent = 'Regenerate';
        }
        // Update URL if different (keeps it in sync)
        if (audioUrlEl && item.url && audioUrlEl.value !== item.url) {
          audioUrlEl.value = item.url;
          updatePlayButton();
        }
      } else if (savedAudioUrl) {
        // There's a URL but no matching audio for current text
        if (statusEl) {
          statusEl.innerHTML = `<span style="color:#f0883e;">Text changed — regenerate to update audio</span>`;
        }
        if (generateBtn) {
          generateBtn.textContent = 'Regenerate';
        }
      } else {
        // No audio at all
        if (statusEl) {
          statusEl.innerHTML = 'No audio yet — click Generate MP3';
        }
        if (generateBtn) {
          generateBtn.textContent = 'Generate MP3';
        }
      }
    } catch (e) {
      console.error('Audio status check failed:', e);
      if (statusEl) {
        statusEl.innerHTML = savedAudioUrl 
          ? 'Could not verify audio status' 
          : 'Error checking audio status';
      }
    }
  }

  _playAudio() {
    const playBtn = document.getElementById('a2-modal-play-audio');
    const audioUrlEl = document.getElementById('a2-modal-audioUrl');
    const audioUrl = (audioUrlEl?.value || '').trim();

    if (!audioUrl) {
      alert('No audio URL. Generate MP3 first or paste a URL.');
      return;
    }

    // If already playing, stop
    if (this._currentAudio) {
      this._currentAudio.pause();
      this._currentAudio = null;
      if (playBtn) playBtn.textContent = '▶ Play';
      return;
    }

    const audio = new Audio(audioUrl);
    this._currentAudio = audio;
    if (playBtn) playBtn.textContent = '⏹ Stop';

    audio.onended = () => {
      this._currentAudio = null;
      if (playBtn) playBtn.textContent = '▶ Play';
    };

    audio.onerror = () => {
      this._currentAudio = null;
      if (playBtn) playBtn.textContent = '▶ Play';
      alert('Failed to play audio. The file may not exist or the URL is invalid.');
    };

    audio.play().catch(err => {
      console.error('Audio play failed:', err);
      this._currentAudio = null;
      if (playBtn) playBtn.textContent = '▶ Play';
    });
  }

  async _generateAudio() {
    const generateBtn = document.getElementById('a2-modal-generate-audio');
    const statusEl = document.getElementById('a2-modal-audio-status');
    const answerTextEl = document.getElementById('a2-modal-answerText');
    const text = (answerTextEl?.value || '').trim();

    if (!text) {
      alert('Enter answer text first');
      return;
    }

    if (generateBtn) {
      generateBtn.disabled = true;
      generateBtn.textContent = 'Generating...';
    }
    if (statusEl) {
      statusEl.innerHTML = '<span style="color:#58a6ff;">Generating audio...</span>';
    }

    try {
      const token = this._getToken();
      const res = await fetch(`/api/admin/front-desk-behavior/${this.companyId}/instant-audio/generate`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          kind: 'TRIGGER_CARD_ANSWER',
          text,
          force: true
        })
      });

      const json = await res.json();

      if (json.success) {
        if (statusEl) {
          statusEl.innerHTML = `
            <span style="color:#7ee787;">Audio generated!</span>
            <span style="color:#6e7681; margin-left:8px; font-size:11px;">${json.fileName || ''}</span>
          `;
        }
        if (generateBtn) {
          generateBtn.textContent = 'Regenerate MP3';
          generateBtn.disabled = false;
        }
        const playBtn = document.getElementById('a2-modal-play-audio');
        if (playBtn && json.url) {
          playBtn.style.display = 'block';
          playBtn.setAttribute('data-audio-url', json.url);
        }
        const audioUrlEl = document.getElementById('a2-modal-audioUrl');
        if (audioUrlEl && json.url) {
          audioUrlEl.value = json.url;
        }
      } else {
        throw new Error(json.error || 'Generation failed');
      }
    } catch (e) {
      console.error('Audio generation failed:', e);
      if (statusEl) {
        statusEl.innerHTML = `<span style="color:#f85149;">Error: ${e.message || 'Generation failed'}</span>`;
      }
      if (generateBtn) {
        generateBtn.textContent = 'Generate MP3';
        generateBtn.disabled = false;
      }
    }
  }

  async _gptPrefill() {
    const keywordsEl = document.getElementById('a2-modal-keywords');
    const keywords = (keywordsEl?.value || '').trim();

    if (!keywords) {
      alert('Enter at least one keyword first, then click GPT-4 Prefill.');
      return;
    }

    const btn = document.getElementById('a2-modal-gpt-prefill');
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Generating...';
    }

    try {
      const token = this._getToken();
      const res = await fetch(`/api/admin/agent2/${this.companyId}/gpt-prefill`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ keywords })
      });

      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || 'GPT prefill failed');
      }

      const data = json.data || {};

      if (data.label) {
        const el = document.getElementById('a2-modal-label');
        if (el) el.value = data.label;
      }
      if (data.phrases && Array.isArray(data.phrases)) {
        const el = document.getElementById('a2-modal-phrases');
        if (el) el.value = data.phrases.join('\n');
      }
      if (data.negativeKeywords && Array.isArray(data.negativeKeywords)) {
        const el = document.getElementById('a2-modal-negKeywords');
        if (el) el.value = data.negativeKeywords.join(', ');
      }
      if (data.answerText) {
        const el = document.getElementById('a2-modal-answerText');
        if (el) el.value = data.answerText;
      }
      if (data.followUpQuestion) {
        const el = document.getElementById('a2-modal-followup');
        if (el) el.value = data.followUpQuestion;
      }

      this._checkAudioStatus();

      if (btn) {
        btn.textContent = 'Done!';
        setTimeout(() => {
          btn.textContent = 'GPT-4 Prefill';
          btn.disabled = false;
        }, 1500);
      }
    } catch (e) {
      console.error('GPT prefill failed:', e);
      alert('GPT prefill failed: ' + (e.message || 'Unknown error'));
      if (btn) {
        btn.textContent = 'GPT-4 Prefill';
        btn.disabled = false;
      }
    }
  }

  async _openAudioGenerator() {
    const modal = document.getElementById('a2-audio-generator-modal');
    const content = document.getElementById('a2-audio-generator-content');
    if (!modal || !content) return;

    const rules = this.config.discovery?.playbook?.rules || [];
    const cardsWithText = rules.filter(r => r.enabled !== false && (r.answer?.answerText || '').trim());

    if (cardsWithText.length === 0) {
      alert('No enabled trigger cards with answer text found.');
      return;
    }

    content.innerHTML = '<div style="color:#8b949e; text-align:center; padding:20px;">Loading audio status...</div>';
    modal.style.display = 'flex';

    document.getElementById('a2-audio-generator-close')?.addEventListener('click', () => this._closeAudioGenerator());
    document.getElementById('a2-audio-generator-done')?.addEventListener('click', () => this._closeAudioGenerator());
    document.getElementById('a2-audio-generate-all')?.addEventListener('click', () => this._generateAllAudio());
    modal.addEventListener('click', (e) => {
      if (e.target.id === 'a2-audio-generator-modal') this._closeAudioGenerator();
    });

    await this._refreshAudioGeneratorList();
  }

  _closeAudioGenerator() {
    const modal = document.getElementById('a2-audio-generator-modal');
    if (modal) modal.style.display = 'none';
  }

  async _refreshAudioGeneratorList() {
    const content = document.getElementById('a2-audio-generator-content');
    if (!content) return;

    const rules = this.config.discovery?.playbook?.rules || [];
    const cardsWithText = rules.filter(r => r.enabled !== false && (r.answer?.answerText || '').trim());

    const items = cardsWithText.map(r => ({
      kind: 'TRIGGER_CARD_ANSWER',
      text: (r.answer?.answerText || '').trim()
    }));

    let statuses = [];
    try {
      const token = this._getToken();
      const res = await fetch(`/api/admin/front-desk-behavior/${this.companyId}/instant-audio/status`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ items })
      });
      const json = await res.json();
      statuses = json?.items || [];
    } catch (e) {
      console.error('Failed to get audio statuses:', e);
    }

    const rows = cardsWithText.map((r, idx) => {
      const text = (r.answer?.answerText || '').trim();
      const status = statuses[idx] || {};
      const exists = status.exists === true;
      const statusBadge = exists
        ? '<span style="background:#238636; color:white; padding:4px 10px; border-radius:6px; font-size:11px;">READY</span>'
        : '<span style="background:#6e7681; color:#c9d1d9; padding:4px 10px; border-radius:6px; font-size:11px;">MISSING</span>';
      const btnText = exists ? 'Regenerate' : 'Generate MP3';
      const btnColor = exists ? '#21262d' : '#238636';
      const btnBorder = exists ? '1px solid #30363d' : 'none';

      return `
        <div style="padding:16px; background:#161b22; border:1px solid #30363d; border-radius:12px; margin-bottom:12px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:16px;">
            <div style="flex:1; min-width:0;">
              <div style="color:#8b949e; font-size:11px; text-transform:uppercase; margin-bottom:4px;">
                ${this.escapeHtml(r.label || r.id || 'Untitled')}
              </div>
              <div style="color:#e5e7eb; font-size:13px; line-height:1.5; word-break:break-word;">
                ${this.escapeHtml(text.length > 120 ? text.substring(0, 120) + '...' : text)}
              </div>
            </div>
            <div style="display:flex; flex-direction:column; align-items:flex-end; gap:8px; flex-shrink:0;">
              <div>${statusBadge}</div>
              <button class="a2-audio-gen-single" data-idx="${idx}"
                style="padding:8px 14px; background:${btnColor}; color:white; border:${btnBorder}; border-radius:8px; cursor:pointer; font-size:12px; white-space:nowrap;">
                ${btnText}
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');

    content.innerHTML = rows || '<div style="color:#8b949e; text-align:center; padding:20px;">No cards with answer text.</div>';

    content.querySelectorAll('.a2-audio-gen-single').forEach((btn) => {
      btn.addEventListener('click', async (e) => {
        const idx = Number(btn.getAttribute('data-idx'));
        const card = cardsWithText[idx];
        if (!card) return;

        btn.disabled = true;
        btn.textContent = 'Generating...';

        try {
          const token = this._getToken();
          const res = await fetch(`/api/admin/front-desk-behavior/${this.companyId}/instant-audio/generate`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              kind: 'TRIGGER_CARD_ANSWER',
              text: (card.answer?.answerText || '').trim(),
              force: true
            })
          });

          const json = await res.json();
          if (json.success && json.url) {
            const ruleIdx = rules.findIndex(r => r.id === card.id);
            if (ruleIdx >= 0 && this.config.discovery?.playbook?.rules?.[ruleIdx]) {
              this.config.discovery.playbook.rules[ruleIdx].answer = this.config.discovery.playbook.rules[ruleIdx].answer || {};
              this.config.discovery.playbook.rules[ruleIdx].answer.audioUrl = json.url;
              this.isDirty = true;
              this._setDirty(true);
            }
          }

          await this._refreshAudioGeneratorList();
        } catch (err) {
          console.error('Generate single failed:', err);
          btn.textContent = 'Error';
          btn.disabled = false;
        }
      });
    });
  }

  async _generateAllAudio() {
    const generateAllBtn = document.getElementById('a2-audio-generate-all');
    if (generateAllBtn) {
      generateAllBtn.disabled = true;
      generateAllBtn.textContent = 'Generating...';
    }

    const rules = this.config.discovery?.playbook?.rules || [];
    const cardsWithText = rules.filter(r => r.enabled !== false && (r.answer?.answerText || '').trim());

    for (const card of cardsWithText) {
      try {
        const token = this._getToken();
        const res = await fetch(`/api/admin/front-desk-behavior/${this.companyId}/instant-audio/generate`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            kind: 'TRIGGER_CARD_ANSWER',
            text: (card.answer?.answerText || '').trim(),
            force: false
          })
        });

        const json = await res.json();
        if (json.success && json.url) {
          const ruleIdx = rules.findIndex(r => r.id === card.id);
          if (ruleIdx >= 0 && this.config.discovery?.playbook?.rules?.[ruleIdx]) {
            this.config.discovery.playbook.rules[ruleIdx].answer = this.config.discovery.playbook.rules[ruleIdx].answer || {};
            this.config.discovery.playbook.rules[ruleIdx].answer.audioUrl = json.url;
            this.isDirty = true;
            this._setDirty(true);
          }
        }
      } catch (err) {
        console.error('Generate all - single item failed:', err, card.id);
      }
    }

    if (generateAllBtn) {
      generateAllBtn.textContent = 'Generate All';
      generateAllBtn.disabled = false;
    }

    await this._refreshAudioGeneratorList();
  }

  _loadSampleCards() {
    // ═══════════════════════════════════════════════════════════════════════════════
    // KEYWORD MATCHING STRATEGY (V2 - Word-Based)
    // ═══════════════════════════════════════════════════════════════════════════════
    //
    // KEYWORDS use WORD-BASED matching:
    //   - ALL words in keyword must appear in caller's speech
    //   - Words can have other words in between (flexible)
    //   - Example: "thermostat blank" matches "my thermostat is blank right now"
    //
    // PHRASES use SUBSTRING matching:
    //   - Exact phrase must appear in caller's speech
    //   - Use when word ORDER matters
    //   - Example: "how much" matches "how much does it cost"
    //
    // NEGATIVE KEYWORDS block matches:
    //   - If ALL negative words found, card is skipped
    //   - Use to prevent false positives
    //   - Example: "cancel today" prevents scheduling card from matching cancellations
    //
    // BEST PRACTICES:
    //   - Use 2-3 word keywords for specificity
    //   - Avoid single common words ("today", "now", "noise")
    //   - Test your keywords mentally: would this phrase ONLY mean this intent?
    //
    // ═══════════════════════════════════════════════════════════════════════════════
    const sampleCards = [
      // ========== PRICING (1-10) ==========
      {
        id: 'pricing.service_call',
        enabled: true,
        priority: 10,
        label: 'Service call fee',
        match: { keywords: ['service call', 'diagnostic fee', 'trip charge', 'service fee'], phrases: ['how much to come out', 'what do you charge'], negativeKeywords: ['cancel', 'refund'] },
        answer: { answerText: 'Our service call is $89, which includes the diagnostic. If we do the repair, the diagnostic fee is waived.', audioUrl: '' },
        followUp: { question: 'Would you like to schedule a repair visit?', nextAction: 'CONTINUE' }
      },
      {
        id: 'pricing.tune_up',
        enabled: true,
        priority: 11,
        label: 'Tune-up pricing',
        match: { keywords: ['tune up', 'tune-up', 'maintenance cost', 'checkup price'], phrases: ['how much is a tune up', 'maintenance price'], negativeKeywords: [] },
        answer: { answerText: 'Our tune-up is $79 for one system. If you have two systems, we can do both for $139.', audioUrl: '' },
        followUp: { question: 'Would you like to schedule a tune-up?', nextAction: 'CONTINUE' }
      },
      {
        id: 'pricing.freon',
        enabled: true,
        priority: 12,
        label: 'Freon/refrigerant cost',
        match: { keywords: ['freon', 'refrigerant', 'r22', 'r410a', 'coolant cost'], phrases: ['how much is freon', 'refrigerant price'], negativeKeywords: [] },
        answer: { answerText: 'Refrigerant pricing depends on the type your system uses. R-410A is around $85 per pound, while R-22 is more expensive due to limited supply. The technician can check your system and give you an exact quote.', audioUrl: '' },
        followUp: { question: 'Would you like to schedule someone to take a look?', nextAction: 'CONTINUE' }
      },
      {
        id: 'pricing.new_system',
        enabled: true,
        priority: 13,
        label: 'New system pricing',
        match: { keywords: ['new unit', 'new system', 'replacement cost', 'new ac price', 'new furnace price'], phrases: ['how much for a new', 'cost to replace'], negativeKeywords: [] },
        answer: { answerText: 'New system pricing varies based on the size of your home and the equipment you choose. We offer free in-home estimates so we can give you an accurate quote.', audioUrl: '' },
        followUp: { question: 'Would you like to schedule a free estimate?', nextAction: 'CONTINUE' }
      },
      {
        id: 'pricing.after_hours',
        enabled: true,
        priority: 14,
        label: 'After-hours/emergency pricing',
        match: { keywords: ['after hours', 'emergency fee', 'weekend rate', 'holiday rate', 'overtime'], phrases: ['extra charge for after hours', 'emergency service cost'], negativeKeywords: [] },
        answer: { answerText: 'We do have an after-hours fee of $49 for evenings, weekends, and holidays. This is in addition to the regular service call fee.', audioUrl: '' },
        followUp: { question: 'Do you need service right away, or can it wait until regular hours?', nextAction: 'CONTINUE' }
      },
      {
        id: 'pricing.duct_cleaning',
        enabled: true,
        priority: 15,
        label: 'Duct cleaning pricing',
        match: { keywords: ['duct cleaning', 'air duct', 'clean ducts', 'ductwork cleaning'], phrases: ['how much to clean ducts'], negativeKeywords: [] },
        answer: { answerText: 'Duct cleaning starts at $299 for a standard home. Larger homes or homes with more vents may be a bit more. We can give you an exact quote when we know more about your setup.', audioUrl: '' },
        followUp: { question: 'Would you like to schedule a duct cleaning?', nextAction: 'CONTINUE' }
      },
      {
        id: 'pricing.filter',
        enabled: true,
        priority: 16,
        label: 'Filter pricing',
        match: { keywords: ['filter price', 'filter cost', 'air filter'], phrases: ['how much are filters', 'cost of a filter'], negativeKeywords: [] },
        answer: { answerText: 'Standard filters range from $15 to $35 depending on size and quality. Our technicians can also bring the right filter on a service call if you need one replaced.', audioUrl: '' },
        followUp: { question: 'Would you like to schedule a service visit?', nextAction: 'CONTINUE' }
      },
      {
        id: 'pricing.thermostat',
        enabled: true,
        priority: 17,
        label: 'Thermostat pricing',
        match: { keywords: ['thermostat price', 'thermostat cost', 'smart thermostat', 'new thermostat'], phrases: ['how much for a thermostat'], negativeKeywords: [] },
        answer: { answerText: 'Basic thermostats start around $89 installed. Smart thermostats like Nest or Ecobee run between $249 and $349 installed.', audioUrl: '' },
        followUp: { question: 'Would you like to schedule a thermostat installation?', nextAction: 'CONTINUE' }
      },
      {
        id: 'pricing.capacitor',
        enabled: true,
        priority: 18,
        label: 'Capacitor replacement',
        match: { keywords: ['capacitor', 'capacitor price', 'capacitor cost'], phrases: ['how much to replace capacitor'], negativeKeywords: [] },
        answer: { answerText: 'A capacitor replacement is typically between $150 and $250 including parts and labor. The exact price depends on the type your system needs.', audioUrl: '' },
        followUp: { question: 'Is your unit not starting or making a humming noise?', nextAction: 'CONTINUE' }
      },
      {
        id: 'pricing.blower_motor',
        enabled: true,
        priority: 19,
        label: 'Blower motor replacement',
        match: { keywords: ['blower motor', 'fan motor', 'motor replacement'], phrases: ['how much for a blower motor'], negativeKeywords: [] },
        answer: { answerText: 'Blower motor replacements typically range from $400 to $700 depending on the motor type. Variable speed motors cost more than single-speed.', audioUrl: '' },
        followUp: { question: 'Would you like to schedule a diagnostic to confirm the issue?', nextAction: 'CONTINUE' }
      },

      // ========== SCHEDULING (11-20) ==========
      // STRATEGY: Use 2-3 word keyword combos + full phrases. Avoid single common words.
      {
        id: 'schedule.today',
        enabled: true,
        priority: 20,
        label: 'Same-day appointment',
        match: { 
          keywords: ['come out today', 'someone today', 'appointment today', 'service today', 'technician today', 'same day service', 'same day appointment'], 
          phrases: ['can you come today', 'available today', 'send someone today', 'need someone today', 'as soon as possible', 'need help today', 'can someone come out today'], 
          negativeKeywords: ['cancel today', 'not today', 'cant do today'] 
        },
        answer: { answerText: 'Let me check our schedule for today. We do our best to accommodate same-day requests.', audioUrl: '' },
        followUp: { question: 'What time works best for you — morning or afternoon?', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.tomorrow',
        enabled: true,
        priority: 21,
        label: 'Tomorrow appointment',
        match: { 
          keywords: ['come tomorrow', 'appointment tomorrow', 'someone tomorrow', 'service tomorrow'], 
          phrases: ['can you come tomorrow', 'available tomorrow', 'schedule for tomorrow', 'need someone tomorrow'], 
          negativeKeywords: ['cancel tomorrow', 'not tomorrow'] 
        },
        answer: { answerText: 'We usually have good availability for tomorrow. Let me get some details to get you scheduled.', audioUrl: '' },
        followUp: { question: 'Do you prefer morning or afternoon?', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.weekend',
        enabled: true,
        priority: 22,
        label: 'Weekend appointment',
        match: { 
          keywords: ['come saturday', 'come sunday', 'weekend appointment', 'saturday appointment', 'sunday appointment'], 
          phrases: ['available on saturday', 'come on sunday', 'do you work weekends', 'open on weekends', 'schedule for saturday'], 
          negativeKeywords: [] 
        },
        answer: { answerText: 'Yes, we do offer weekend appointments. There is an additional $49 after-hours fee for weekend service.', audioUrl: '' },
        followUp: { question: 'Would you like to schedule for this weekend?', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.evening',
        enabled: true,
        priority: 23,
        label: 'Evening appointment',
        match: { 
          keywords: ['evening appointment', 'after work appointment', 'late appointment', 'after 5 pm', 'after five'], 
          phrases: ['come in the evening', 'available after work', 'do you have evening hours', 'appointment after 5'], 
          negativeKeywords: [] 
        },
        answer: { answerText: 'We do have evening appointments available. Our last appointment slot is typically 5 or 6 PM depending on the day.', audioUrl: '' },
        followUp: { question: 'What day works best for an evening appointment?', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.reschedule',
        enabled: true,
        priority: 24,
        label: 'Reschedule appointment',
        match: { 
          keywords: ['reschedule appointment', 'change appointment', 'move appointment', 'different time', 'change my time'], 
          phrases: ['need to reschedule', 'change my appointment', 'move my appointment', 'can i reschedule'], 
          negativeKeywords: [] 
        },
        answer: { answerText: 'No problem, I can help you reschedule. Let me pull up your appointment.', audioUrl: '' },
        followUp: { question: 'What day and time works better for you?', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.cancel',
        enabled: true,
        priority: 25,
        label: 'Cancel appointment',
        match: { 
          keywords: ['cancel appointment', 'cancel my appointment', 'cancel service'], 
          phrases: ['need to cancel', 'cancel my appointment', 'want to cancel', 'canceling my appointment'], 
          negativeKeywords: [] 
        },
        answer: { answerText: "I understand. I can cancel that appointment for you. There's no cancellation fee.", audioUrl: '' },
        followUp: { question: 'Is there anything else I can help you with today?', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.confirm',
        enabled: true,
        priority: 26,
        label: 'Confirm appointment',
        match: { 
          keywords: ['confirm appointment', 'verify appointment', 'check appointment', 'appointment confirmation'], 
          phrases: ['confirm my appointment', 'is my appointment still on', 'still have an appointment', 'checking on my appointment'], 
          negativeKeywords: [] 
        },
        answer: { answerText: 'Let me check on your appointment. Can you give me the name or phone number on the account?', audioUrl: '' },
        followUp: { question: '', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.eta',
        enabled: true,
        priority: 27,
        label: 'Technician ETA',
        match: { 
          keywords: ['technician eta', 'tech on the way', 'where is tech', 'where is technician', 'tech running late'], 
          phrases: ['when will the technician be here', 'is the tech on the way', 'how long until tech arrives', 'where is my technician'], 
          negativeKeywords: [] 
        },
        answer: { answerText: "Let me check on your technician's status. Can you confirm the address or phone number on the account?", audioUrl: '' },
        followUp: { question: '', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.hours',
        enabled: true,
        priority: 28,
        label: 'Business hours',
        match: { 
          keywords: ['business hours', 'office hours', 'what time open', 'what time close', 'hours of operation'], 
          phrases: ['what are your hours', 'when do you open', 'when do you close', 'are you open now'], 
          negativeKeywords: [] 
        },
        answer: { answerText: "Our office is open Monday through Friday, 8 AM to 5 PM. We also offer after-hours emergency service with an additional fee.", audioUrl: '' },
        followUp: { question: 'Would you like to schedule an appointment?', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.service_area',
        enabled: true,
        priority: 29,
        label: 'Service area',
        match: { 
          keywords: ['service area', 'what areas', 'service my area', 'come to my area'], 
          phrases: ['do you service', 'do you come to', 'what areas do you cover', 'do you service my zip code', 'what zip codes'], 
          negativeKeywords: [] 
        },
        answer: { answerText: "We service most areas within a 30-mile radius of our office. If you give me your zip code, I can confirm we cover your area.", audioUrl: '' },
        followUp: { question: 'What is your zip code?', nextAction: 'CONTINUE' }
      },

      // ========== PROBLEMS/SYMPTOMS (21-35) ==========
      // STRATEGY: Use specific problem descriptions, not single symptoms
      {
        id: 'problem.not_cooling',
        enabled: true,
        priority: 30,
        label: 'AC not cooling',
        match: { 
          keywords: ['ac not cooling', 'not cooling down', 'no cold air', 'blowing warm', 'blowing hot', 'ac not working', 'unit not cooling'], 
          phrases: ['blowing warm air', 'not getting cold', 'ac wont cool', 'house not cooling', 'air conditioner not working'], 
          negativeKeywords: ['not heating'] 
        },
        answer: { answerText: "I'm sorry to hear that. There are a few things that could cause this — it could be the thermostat, refrigerant, or a component issue. We can send a technician to diagnose the problem.", audioUrl: '' },
        followUp: { question: 'Is the system running at all, or is it completely off?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.not_heating',
        enabled: true,
        priority: 31,
        label: 'Furnace not heating',
        match: { 
          keywords: ['not heating', 'no heat', 'furnace not working', 'heater not working', 'heat not working', 'no warm air'], 
          phrases: ['blowing cold air from furnace', 'not getting warm', 'furnace wont heat', 'heater wont turn on', 'house is cold'], 
          negativeKeywords: ['not cooling'] 
        },
        answer: { answerText: "I understand, that's uncomfortable. This could be an igniter, thermostat, or gas valve issue. We should have a technician take a look.", audioUrl: '' },
        followUp: { question: 'Is the system turning on at all?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.strange_noise',
        enabled: true,
        priority: 32,
        label: 'Strange noise',
        match: { 
          keywords: ['making noise', 'loud noise', 'banging noise', 'squealing noise', 'grinding noise', 'rattling noise', 'humming noise', 'weird noise'], 
          phrases: ['making a noise', 'sounds weird', 'hearing a sound', 'unit is loud', 'strange sound coming from'], 
          negativeKeywords: [] 
        },
        answer: { answerText: "Strange noises can indicate a variety of issues — from a loose part to a failing motor. It's best to have it checked before it gets worse.", audioUrl: '' },
        followUp: { question: 'Is the system still running, or did it stop?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.water_leak',
        enabled: true,
        priority: 33,
        label: 'Water leak',
        match: { 
          keywords: ['water leak', 'leaking water', 'water around unit', 'water puddle', 'ac dripping', 'unit leaking'], 
          phrases: ['water coming from', 'water on the floor', 'puddle of water', 'water under ac', 'ac is leaking water'], 
          negativeKeywords: ['refrigerant leak'] 
        },
        answer: { answerText: "Water leaks usually mean a clogged drain line or frozen evaporator coil. Turn off the system to prevent water damage and we'll send someone out.", audioUrl: '' },
        followUp: { question: 'Would you like to schedule service today?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.frozen',
        enabled: true,
        priority: 34,
        label: 'Frozen unit/ice',
        match: { 
          keywords: ['unit frozen', 'coils frozen', 'ice on unit', 'ice on coils', 'iced over', 'freezing up'], 
          phrases: ['ice on the unit', 'coils are frozen', 'ac is frozen', 'ice building up', 'unit keeps freezing'], 
          negativeKeywords: [] 
        },
        answer: { answerText: "A frozen unit usually indicates low airflow or low refrigerant. Turn the system off and let it thaw. Running it frozen can damage the compressor.", audioUrl: '' },
        followUp: { question: 'Would you like to schedule a technician to find the cause?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.wont_turn_on',
        enabled: true,
        priority: 35,
        label: 'System won\'t turn on',
        match: { keywords: ['wont turn on', 'not turning on', 'dead', 'no power', 'nothing happens'], phrases: ['system is dead', 'nothing is working'], negativeKeywords: [] },
        answer: { answerText: "If the system isn't turning on at all, it could be a breaker issue, thermostat, or a safety switch. Check your breaker first, and if that's not it, we can send someone out.", audioUrl: '' },
        followUp: { question: 'Have you checked the circuit breaker yet?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.short_cycling',
        enabled: true,
        priority: 36,
        label: 'Short cycling',
        match: { keywords: ['short cycling', 'turning on and off', 'keeps shutting off', 'starts and stops'], phrases: ['runs for a few minutes then stops', 'keeps turning off'], negativeKeywords: [] },
        answer: { answerText: "Short cycling can be caused by an oversized unit, thermostat issue, or overheating. It puts extra stress on the system, so it's good to get it checked.", audioUrl: '' },
        followUp: { question: 'Would you like to schedule a diagnostic?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.bad_smell',
        enabled: true,
        priority: 37,
        label: 'Bad smell',
        match: { keywords: ['smell', 'odor', 'stink', 'burning smell', 'musty'], phrases: ['smells like burning', 'weird smell'], negativeKeywords: [] },
        answer: { answerText: "A burning smell could indicate an electrical issue — turn off the system if it smells like burning. A musty smell usually means mold in the ducts or drain pan.", audioUrl: '' },
        followUp: { question: 'Can you describe the smell — is it more burning or musty?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.high_bill',
        enabled: true,
        priority: 38,
        label: 'High energy bill',
        match: { keywords: ['high bill', 'electric bill', 'energy bill', 'expensive to run'], phrases: ['bill went up', 'using too much electricity'], negativeKeywords: [] },
        answer: { answerText: "Higher bills can be caused by a system running inefficiently — dirty coils, low refrigerant, or an aging unit. A tune-up can help identify the issue.", audioUrl: '' },
        followUp: { question: 'When was the last time the system was serviced?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.uneven_temp',
        enabled: true,
        priority: 39,
        label: 'Uneven temperatures',
        match: { keywords: ['uneven', 'hot spots', 'cold spots', 'one room', 'some rooms'], phrases: ['some rooms are hot', 'upstairs is hotter'], negativeKeywords: [] },
        answer: { answerText: "Uneven temperatures can be caused by ductwork issues, improper airflow, or an undersized system. We can do an assessment to find the cause.", audioUrl: '' },
        followUp: { question: 'Is this a new issue, or has it always been this way?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.thermostat',
        enabled: true,
        priority: 40,
        label: 'Thermostat issue',
        match: { keywords: ['thermostat', 'thermostat blank', 'thermostat not working'], phrases: ['thermostat is blank', 'cant change temperature'], negativeKeywords: ['price', 'cost', 'new thermostat'] },
        answer: { answerText: "Thermostat issues can be as simple as dead batteries or as complex as wiring problems. Check the batteries first — if that doesn't help, we can send someone out.", audioUrl: '' },
        followUp: { question: 'Is the thermostat screen blank, or is it on but not responding?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.breaker_tripping',
        enabled: true,
        priority: 41,
        label: 'Breaker tripping',
        match: { keywords: ['breaker', 'tripping', 'keeps tripping', 'circuit breaker'], phrases: ['breaker keeps tripping', 'blowing the breaker'], negativeKeywords: [] },
        answer: { answerText: "A tripping breaker usually indicates an electrical issue with the unit — possibly a short or a failing compressor. Don't keep resetting it; we should have it checked.", audioUrl: '' },
        followUp: { question: 'Would you like to schedule a diagnostic?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.humidity',
        enabled: true,
        priority: 42,
        label: 'Humidity issues',
        match: { keywords: ['humidity', 'humid', 'sticky', 'muggy', 'moisture'], phrases: ['too humid', 'house feels sticky'], negativeKeywords: [] },
        answer: { answerText: "High humidity even with AC running can indicate an oversized unit or airflow issues. A properly sized system should remove humidity as it cools.", audioUrl: '' },
        followUp: { question: 'Would you like to schedule someone to take a look?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.outdoor_unit',
        enabled: true,
        priority: 43,
        label: 'Outdoor unit issue',
        match: { keywords: ['outdoor unit', 'outside unit', 'condenser', 'fan not spinning'], phrases: ['outside unit not running', 'fan stopped'], negativeKeywords: [] },
        answer: { answerText: "If the outdoor unit isn't running, it could be a capacitor, contactor, or compressor issue. Check that the breaker is on, and if so, we'll need to diagnose it.", audioUrl: '' },
        followUp: { question: 'Is the breaker for the outdoor unit on?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.weak_airflow',
        enabled: true,
        priority: 44,
        label: 'Weak airflow',
        match: { keywords: ['weak airflow', 'low airflow', 'no airflow', 'barely blowing'], phrases: ['not much air coming out', 'airflow is weak'], negativeKeywords: [] },
        answer: { answerText: "Weak airflow is often caused by a dirty filter, blocked ducts, or a failing blower motor. When was the filter last changed?", audioUrl: '' },
        followUp: { question: 'Have you checked or replaced the air filter recently?', nextAction: 'CONTINUE' }
      },

      // ========== GENERAL/FAQ (36-50) ==========
      {
        id: 'faq.maintenance_plan',
        enabled: true,
        priority: 50,
        label: 'Maintenance plan',
        match: { keywords: ['maintenance plan', 'service plan', 'membership', 'annual plan', 'preventive maintenance'], phrases: ['do you have a maintenance plan', 'tell me about your service plan'], negativeKeywords: [] },
        answer: { answerText: "Yes, we offer a maintenance plan that includes two tune-ups per year, priority scheduling, and discounts on repairs. It's $189 per year for one system.", audioUrl: '' },
        followUp: { question: 'Would you like more details about the plan?', nextAction: 'CONTINUE' }
      },
      {
        id: 'faq.financing',
        enabled: true,
        priority: 51,
        label: 'Financing options',
        match: { keywords: ['financing', 'payment plan', 'finance', 'monthly payments'], phrases: ['do you offer financing', 'can I make payments'], negativeKeywords: [] },
        answer: { answerText: "Yes, we offer financing through several partners with options for 0% interest on approved credit. We can go over the options during your estimate.", audioUrl: '' },
        followUp: { question: 'Would you like to schedule a free estimate?', nextAction: 'CONTINUE' }
      },
      {
        id: 'faq.warranty',
        enabled: true,
        priority: 52,
        label: 'Warranty',
        match: { keywords: ['warranty', 'guarantee', 'covered', 'under warranty'], phrases: ['is this under warranty', 'do you offer a warranty'], negativeKeywords: [] },
        answer: { answerText: "Most new equipment comes with a manufacturer warranty, typically 5-10 years on parts. We also warranty our labor for one year on all repairs.", audioUrl: '' },
        followUp: { question: 'Is this regarding a recent repair or a new installation?', nextAction: 'CONTINUE' }
      },
      {
        id: 'faq.brands',
        enabled: true,
        priority: 53,
        label: 'Brands serviced',
        match: { keywords: ['brand', 'make', 'carrier', 'trane', 'lennox', 'goodman', 'rheem'], phrases: ['what brands do you service', 'do you work on'], negativeKeywords: [] },
        answer: { answerText: "We service all major brands including Carrier, Trane, Lennox, Goodman, Rheem, and more. Our technicians are trained on all types of equipment.", audioUrl: '' },
        followUp: { question: 'What brand is your system?', nextAction: 'CONTINUE' }
      },
      {
        id: 'faq.experience',
        enabled: true,
        priority: 54,
        label: 'Company experience',
        match: { keywords: ['how long', 'experience', 'been in business', 'established'], phrases: ['how long have you been in business'], negativeKeywords: [] },
        answer: { answerText: "We've been serving the area for over 20 years. Our technicians are licensed, insured, and background-checked.", audioUrl: '' },
        followUp: { question: 'Is there anything specific I can help you with today?', nextAction: 'CONTINUE' }
      },
      {
        id: 'faq.licensed',
        enabled: true,
        priority: 55,
        label: 'Licensed/insured',
        match: { keywords: ['licensed', 'insured', 'bonded', 'certified'], phrases: ['are you licensed', 'are you insured'], negativeKeywords: [] },
        answer: { answerText: "Yes, we are fully licensed, bonded, and insured. All our technicians are also EPA certified.", audioUrl: '' },
        followUp: { question: 'Would you like to schedule service?', nextAction: 'CONTINUE' }
      },
      {
        id: 'faq.estimate',
        enabled: true,
        priority: 56,
        label: 'Free estimate',
        match: { keywords: ['estimate', 'quote', 'free estimate', 'free quote'], phrases: ['can I get an estimate', 'how much would it cost'], negativeKeywords: [] },
        answer: { answerText: "We offer free estimates for new system installations. For repairs, our $89 diagnostic fee covers the assessment and you'll know the repair cost before we do any work.", audioUrl: '' },
        followUp: { question: 'Are you looking at a repair or a new system?', nextAction: 'CONTINUE' }
      },
      {
        id: 'faq.filter_change',
        enabled: true,
        priority: 57,
        label: 'How often change filter',
        match: { keywords: ['how often', 'filter change', 'replace filter'], phrases: ['how often should I change', 'when to replace filter'], negativeKeywords: ['price', 'cost'] },
        answer: { answerText: "We recommend changing your filter every 1-3 months depending on the type. If you have pets or allergies, change it monthly.", audioUrl: '' },
        followUp: { question: 'Do you need help getting the right filter size?', nextAction: 'CONTINUE' }
      },
      {
        id: 'faq.system_age',
        enabled: true,
        priority: 58,
        label: 'System age/replace',
        match: { keywords: ['how old', 'system age', 'replace', 'last'], phrases: ['how long do systems last', 'when should I replace'], negativeKeywords: [] },
        answer: { answerText: "Most systems last 15-20 years with proper maintenance. If yours is over 15 years and needing frequent repairs, it may be more cost-effective to replace.", audioUrl: '' },
        followUp: { question: 'How old is your current system?', nextAction: 'CONTINUE' }
      },
      {
        id: 'faq.second_opinion',
        enabled: true,
        priority: 59,
        label: 'Second opinion',
        match: { keywords: ['second opinion', 'another opinion', 'verify', 'check quote'], phrases: ['get a second opinion', 'someone else said'], negativeKeywords: [] },
        answer: { answerText: "Absolutely, we're happy to provide a second opinion. We can send a technician to evaluate and give you an honest assessment.", audioUrl: '' },
        followUp: { question: 'Would you like to schedule that diagnostic?', nextAction: 'CONTINUE' }
      },
      {
        id: 'faq.payment',
        enabled: true,
        priority: 60,
        label: 'Payment methods',
        match: { keywords: ['payment', 'pay', 'credit card', 'cash', 'check', 'accept'], phrases: ['how can I pay', 'what payment methods'], negativeKeywords: [] },
        answer: { answerText: "We accept cash, check, and all major credit cards. Payment is due when the service is completed.", audioUrl: '' },
        followUp: { question: 'Is there anything else I can help you with?', nextAction: 'CONTINUE' }
      },
      {
        id: 'speak.advisor',
        enabled: true,
        priority: 61,
        label: 'Speak to a person',
        match: { keywords: ['speak to someone', 'talk to a person', 'human', 'representative', 'manager', 'supervisor'], phrases: ['can I speak to', 'talk to a real person', 'transfer me'], negativeKeywords: [] },
        answer: { answerText: "I'd be happy to connect you with someone. Let me transfer you now.", audioUrl: '' },
        followUp: { question: '', nextAction: 'TRANSFER_SERVICE_ADVISOR' }
      },
      {
        id: 'faq.callback',
        enabled: true,
        priority: 62,
        label: 'Request callback',
        match: { keywords: ['call me back', 'callback', 'return call', 'call back'], phrases: ['have someone call me', 'can you call me back'], negativeKeywords: [] },
        answer: { answerText: "Sure, I can have someone call you back. What's the best number and time to reach you?", audioUrl: '' },
        followUp: { question: '', nextAction: 'CONTINUE' }
      },
      // ═══════════════════════════════════════════════════════════════════════════════
      // GREETING CARDS REMOVED — Greetings are handled by GreetingInterceptor
      // ═══════════════════════════════════════════════════════════════════════════════
      // DO NOT add greeting cards here. Single-word keywords like "hi", "hello" will
      // hijack real intent. Example: "Hi, my AC isn't cooling" would match "hi" and
      // fire the greeting card instead of the AC problem card.
      //
      // Greetings are handled separately in Global Settings → Greeting Responses,
      // which ONLY fires if the utterance is JUST a greeting (e.g., "hi" alone).
      // ═══════════════════════════════════════════════════════════════════════════════

      {
        id: 'closing.thanks',
        enabled: true,
        priority: 99,
        label: 'Thanks/goodbye',
        match: { keywords: ['thank you so much', 'thanks for your help', 'goodbye for now', 'thats all i needed'], phrases: ["that's all I needed", 'have a good day', 'thanks for the help'], negativeKeywords: [] },
        answer: { answerText: "You're welcome! Thanks for calling. Have a great day!", audioUrl: '' },
        followUp: { question: '', nextAction: 'CONTINUE' }
      }
    ];

    const existingRules = this.config.discovery?.playbook?.rules || [];
    const existingIds = new Set(existingRules.map(r => r.id));

    const newCards = sampleCards.filter(c => !existingIds.has(c.id));
    this.config.discovery.playbook.rules = [...existingRules, ...newCards];
    this.isDirty = true;
    this._setDirty(true);

    alert(`Added ${newCards.length} new trigger cards. ${sampleCards.length - newCards.length} were skipped (already exist).`);
  }

  _readFormIntoConfig(container) {
    const cfg = this.config || this.getDefaultConfig();
    const discovery = cfg.discovery || {};
    discovery.style = discovery.style || {};
    discovery.playbook = discovery.playbook || {};

    // Inline style fields (not in modal)
    discovery.style.ackWord = (container.querySelector('#a2-style-ackWord')?.value || 'Ok.').trim() || 'Ok.';

    const forbidRaw = container.querySelector('#a2-style-forbid')?.value || '';
    discovery.style.forbidPhrases = forbidRaw
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    // NOTE: Style lines (bridge, robotChallenge, systemDelay, whenInDoubt) are now
    // managed by the style modal (_saveStyleModal) - not read from inline form fields.

    const typesRaw = container.querySelector('#a2-allowed-types')?.value || '';
    discovery.playbook.allowedScenarioTypes = typesRaw.split(',').map(s => s.trim()).filter(Boolean);
    const minScore = Number(container.querySelector('#a2-min-score')?.value ?? 0.72);
    discovery.playbook.minScenarioScore = Number.isFinite(minScore) ? Math.max(0, Math.min(1, minScore)) : 0.72;

    discovery.playbook.fallback = discovery.playbook.fallback || {};
    discovery.playbook.fallback.noMatchAnswer = (container.querySelector('#a2-fallback-noMatchAnswer')?.value || '').trim();
    discovery.playbook.fallback.afterAnswerQuestion = (container.querySelector('#a2-fallback-afterAnswerQuestion')?.value || '').trim();
    discovery.playbook.fallback.noMatchWhenReasonCaptured = (container.querySelector('#a2-fallback-noMatchWhenReasonCaptured')?.value || '').trim();
    discovery.playbook.fallback.noMatchClarifierQuestion = (container.querySelector('#a2-fallback-noMatchClarifierQuestion')?.value || '').trim();

    cfg.discovery = discovery;
    cfg.meta = cfg.meta || {};
    cfg.meta.uiBuild = Agent2Manager.UI_BUILD;
    this.config = cfg;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Simulator (local)
  // ──────────────────────────────────────────────────────────────────────────
  simulate(inputText) {
    const text = `${inputText || ''}`.toLowerCase();
    const style = this.config.discovery?.style || {};
    const pb = this.config.discovery?.playbook || {};
    const rules = Array.isArray(pb.rules) ? pb.rules : [];

    const matchRule = rules.find((r) => {
      const negKws = (r.match?.negativeKeywords || []).map(s => `${s}`.toLowerCase()).filter(Boolean);
      if (negKws.some(nk => nk && text.includes(nk))) return false;

      const kws = (r.match?.keywords || []).map(s => `${s}`.toLowerCase()).filter(Boolean);
      const phrases = (r.match?.phrases || []).map(s => `${s}`.toLowerCase()).filter(Boolean);

      const kwMatch = kws.some((k) => k && text.includes(k));
      const phraseMatch = phrases.some((p) => p && text.includes(p));

      return kwMatch || phraseMatch;
    }) || null;

    const ack = (style.ackWord || 'Ok.').trim() || 'Ok.';
    const answerText = matchRule?.answer?.answerText || null;
    const audioUrl = matchRule?.answer?.audioUrl || null;
    const followUp = matchRule?.followUp?.question || '';
    const nextAction = matchRule?.followUp?.nextAction || 'CONTINUE';

    const answerLine = answerText
      ? answerText.substring(0, 100) + (answerText.length > 100 ? '...' : '')
      : (matchRule ? '[No answer text set]' : '[No rule matched]');

    const spoken = [ack, answerLine, followUp].map(s => `${s || ''}`.trim()).filter(Boolean).join(' ');

    return {
      uiBuild: Agent2Manager.UI_BUILD,
      discoveryEnabled: this.config.discovery?.enabled === true,
      inputPreview: `${inputText || ''}`.substring(0, 160),
      selectedRule: matchRule ? { id: matchRule.id, label: matchRule.label } : null,
      plan: {
        answerSource: matchRule ? (audioUrl ? 'audio' : 'tts') : 'fallback',
        answerText: answerText || null,
        audioUrl: audioUrl || null,
        nextAction,
        followUpQuestion: followUp
      },
      spokenPreview: spoken.substring(0, 220)
    };
  }
}

window.Agent2Manager = Agent2Manager;
