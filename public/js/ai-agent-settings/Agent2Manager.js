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
  static UI_BUILD = 'AGENT2_UI_V0.2';

  constructor(companyId) {
    this.companyId = companyId;
    this.config = null;
    this.isDirty = false;
    this._container = null;
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

    container.innerHTML = `
      <div style="padding: 20px; background: #0d1117; color: #e6edf3;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid #30363d; padding-bottom:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:10px;">
              <h2 style="margin:0; font-size:1.5rem; color:#22d3ee;">Agent 2.0</h2>
              <span id="a2-dirty-badge" style="font-size:0.75rem; padding:3px 8px; border-radius:999px; background:${this.isDirty ? '#f59e0b' : '#238636'}; color:white;">
                ${this.isDirty ? 'UNSAVED' : 'SAVED'}
              </span>
              <span style="font-size:0.7rem; padding:3px 8px; background:#21262d; border:1px solid #30363d; border-radius:999px; color:#c9d1d9;">
                UI Build: ${this.escapeHtml(Agent2Manager.UI_BUILD)}
              </span>
            </div>
            <div style="margin-top:6px; color:#8b949e; font-size:0.9rem;">
              Clean, isolated config surface. Discovery is built and locked before Booking.
            </div>
          </div>
          <div style="display:flex; gap:10px;">
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

        ${this.renderStatusCard()}
        ${this.renderStyleCard()}
        ${this.renderPlaybookCard()}
        ${this.renderSimulatorCard()}
      </div>
    `;

    this.attach(container);
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
    const bridgeLines = Array.isArray(style.bridge?.lines) ? style.bridge.lines.join('\n') : '';
    return this.renderCard(
      'Discovery Style & Safety',
      'These are UI-controlled text blocks. Keep them short, human, and consistent (e.g., use "Ok", avoid "Got it").',
      `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div>
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Ack word (prefix)</label>
            <input id="a2-style-ackWord" value="${this.escapeHtml(style.ackWord || 'Ok.')}"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px;" />
          </div>
          <div>
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Forbidden phrases (one per line)</label>
            <textarea id="a2-style-forbid" rows="2"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; resize:vertical;">${this.escapeHtml(forbid)}</textarea>
          </div>
        </div>

        <div style="margin-top:12px; display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:12px;">
            <label style="display:flex; align-items:center; gap:10px;">
              <input id="a2-bridge-enabled" type="checkbox" ${style.bridge?.enabled ? 'checked' : ''} />
              <div style="font-weight:700;">Bridge lines (dead-air filler)</div>
            </label>
            <div style="color:#8b949e; font-size:12px; margin-top:6px;">Phase 2 feature. Stored now; runtime wiring later.</div>
            <textarea id="a2-bridge-lines" rows="3"
              style="width:100%; margin-top:10px; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; resize:vertical;"
              placeholder="One per line">${this.escapeHtml(bridgeLines)}</textarea>
          </div>
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:12px;">
            <label style="display:flex; align-items:center; gap:10px;">
              <input id="a2-robot-enabled" type="checkbox" ${style.robotChallenge?.enabled ? 'checked' : ''} />
              <div style="font-weight:700;">Robot challenge response</div>
            </label>
            <textarea id="a2-robot-line" rows="3"
              style="width:100%; margin-top:10px; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; resize:vertical;"
              placeholder="Exact line">${this.escapeHtml(style.robotChallenge?.line || '')}</textarea>
          </div>
        </div>

        <div style="margin-top:12px; display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:12px;">
            <label style="display:flex; align-items:center; gap:10px;">
              <input id="a2-delay-enabled" type="checkbox" ${style.systemDelay?.enabled ? 'checked' : ''} />
              <div style="font-weight:700;">System delay scripts</div>
            </label>
            <label style="display:block; margin-top:10px; color:#cbd5e1; font-size:12px;">First delay line</label>
            <textarea id="a2-delay-first" rows="2"
              style="width:100%; margin-top:6px; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; resize:vertical;"
            >${this.escapeHtml(style.systemDelay?.firstLine || '')}</textarea>
            <label style="display:block; margin-top:10px; color:#cbd5e1; font-size:12px;">Transfer fallback line</label>
            <textarea id="a2-delay-transfer" rows="2"
              style="width:100%; margin-top:6px; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; resize:vertical;"
            >${this.escapeHtml(style.systemDelay?.transferLine || '')}</textarea>
          </div>
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:12px;">
            <label style="display:flex; align-items:center; gap:10px;">
              <input id="a2-doubt-enabled" type="checkbox" ${style.whenInDoubt?.enabled ? 'checked' : ''} />
              <div style="font-weight:700;">When in doubt -> transfer</div>
            </label>
            <textarea id="a2-doubt-line" rows="4"
              style="width:100%; margin-top:10px; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; resize:vertical;"
              placeholder="Transfer line">${this.escapeHtml(style.whenInDoubt?.transferLine || '')}</textarea>
          </div>
        </div>
      `
    );
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
          <div style="align-self:flex-end;">
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
        <div style="font-weight:700; color:#22d3ee; margin-bottom:12px;">Matching</div>
        <div style="margin-bottom:12px;">
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Keywords (comma separated) - triggers if caller says ANY of these</label>
          <input id="a2-modal-keywords" value="${this.escapeHtml(keywords)}"
            placeholder="service call, diagnostic fee, trip charge"
            style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:12px;" />
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
          <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Audio URL (optional - plays instead of TTS if set)</label>
          <input id="a2-modal-audioUrl" value="${this.escapeHtml(audioUrl)}"
            placeholder="https://cdn.example.com/audio/service-call-pricing.mp3"
            style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:12px; font-family:monospace; font-size:12px;" />
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
            <button id="a2-sim-copy"
              style="margin-top:10px; padding:10px 14px; background:#21262d; color:#c9d1d9; border:1px solid #30363d; border-radius:10px; cursor:pointer;">
              Copy JSON
            </button>
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

    container.querySelectorAll('#a2-style-ackWord, #a2-style-forbid, #a2-bridge-enabled, #a2-bridge-lines, #a2-robot-enabled, #a2-robot-line, #a2-delay-enabled, #a2-delay-first, #a2-delay-transfer, #a2-doubt-enabled, #a2-doubt-line, #a2-allowed-types, #a2-min-score')
      .forEach((el) => el?.addEventListener('input', onAnyChange));
    container.querySelectorAll('#a2-fallback-noMatchAnswer, #a2-fallback-afterAnswerQuestion')
      .forEach((el) => el?.addEventListener('input', onAnyChange));
    container.querySelectorAll('#a2-fallback-noMatchWhenReasonCaptured, #a2-fallback-noMatchClarifierQuestion')
      .forEach((el) => el?.addEventListener('input', onAnyChange));

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
  }

  _openModal(idx) {
    const modal = document.getElementById('a2-rule-modal');
    const content = document.getElementById('a2-modal-content');
    if (!modal || !content) return;

    content.innerHTML = this.renderRuleModal(idx);
    modal.style.display = 'flex';

    document.getElementById('a2-modal-cancel')?.addEventListener('click', () => this._closeModal());
    document.getElementById('a2-modal-save')?.addEventListener('click', () => this._saveModal());
    document.getElementById('a2-modal-close')?.addEventListener('click', () => this._closeModal());
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

  _readFormIntoConfig(container) {
    const cfg = this.config || this.getDefaultConfig();
    const discovery = cfg.discovery || {};
    discovery.style = discovery.style || {};
    discovery.playbook = discovery.playbook || {};

    discovery.style.ackWord = (container.querySelector('#a2-style-ackWord')?.value || 'Ok.').trim() || 'Ok.';

    const forbidRaw = container.querySelector('#a2-style-forbid')?.value || '';
    discovery.style.forbidPhrases = forbidRaw
      .split('\n')
      .map(s => s.trim())
      .filter(Boolean);

    discovery.style.bridge = discovery.style.bridge || {};
    discovery.style.bridge.enabled = container.querySelector('#a2-bridge-enabled')?.checked === true;
    const bridgeLinesRaw = container.querySelector('#a2-bridge-lines')?.value || '';
    discovery.style.bridge.lines = bridgeLinesRaw.split('\n').map(s => s.trim()).filter(Boolean);
    discovery.style.bridge.maxPerTurn = 1;

    discovery.style.robotChallenge = discovery.style.robotChallenge || {};
    discovery.style.robotChallenge.enabled = container.querySelector('#a2-robot-enabled')?.checked === true;
    discovery.style.robotChallenge.line = (container.querySelector('#a2-robot-line')?.value || '').trim();

    discovery.style.systemDelay = discovery.style.systemDelay || {};
    discovery.style.systemDelay.enabled = container.querySelector('#a2-delay-enabled')?.checked === true;
    discovery.style.systemDelay.firstLine = (container.querySelector('#a2-delay-first')?.value || '').trim();
    discovery.style.systemDelay.transferLine = (container.querySelector('#a2-delay-transfer')?.value || '').trim();

    discovery.style.whenInDoubt = discovery.style.whenInDoubt || {};
    discovery.style.whenInDoubt.enabled = container.querySelector('#a2-doubt-enabled')?.checked === true;
    discovery.style.whenInDoubt.transferLine = (container.querySelector('#a2-doubt-line')?.value || '').trim();

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
