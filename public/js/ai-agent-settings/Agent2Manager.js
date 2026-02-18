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
  static UI_BUILD = 'AGENT2_UI_V0.7';

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
      {
        id: 'schedule.today',
        enabled: true,
        priority: 20,
        label: 'Same-day appointment',
        match: { keywords: ['today', 'same day', 'right now', 'as soon as possible', 'asap', 'immediately'], phrases: ['can you come today', 'available today'], negativeKeywords: ['cancel'] },
        answer: { answerText: 'Let me check our schedule for today. We do our best to accommodate same-day requests.', audioUrl: '' },
        followUp: { question: 'What time works best for you — morning or afternoon?', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.tomorrow',
        enabled: true,
        priority: 21,
        label: 'Tomorrow appointment',
        match: { keywords: ['tomorrow', 'next day'], phrases: ['can you come tomorrow', 'available tomorrow'], negativeKeywords: ['cancel'] },
        answer: { answerText: 'We usually have good availability for tomorrow. Let me get some details to get you scheduled.', audioUrl: '' },
        followUp: { question: 'Do you prefer morning or afternoon?', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.weekend',
        enabled: true,
        priority: 22,
        label: 'Weekend appointment',
        match: { keywords: ['weekend', 'saturday', 'sunday'], phrases: ['available on saturday', 'come on sunday'], negativeKeywords: [] },
        answer: { answerText: 'Yes, we do offer weekend appointments. There is an additional $49 after-hours fee for weekend service.', audioUrl: '' },
        followUp: { question: 'Would you like to schedule for this weekend?', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.evening',
        enabled: true,
        priority: 23,
        label: 'Evening appointment',
        match: { keywords: ['evening', 'after work', 'after 5', 'after five', 'late appointment'], phrases: ['come in the evening', 'available after work'], negativeKeywords: [] },
        answer: { answerText: 'We do have evening appointments available. Our last appointment slot is typically 5 or 6 PM depending on the day.', audioUrl: '' },
        followUp: { question: 'What day works best for an evening appointment?', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.reschedule',
        enabled: true,
        priority: 24,
        label: 'Reschedule appointment',
        match: { keywords: ['reschedule', 'change appointment', 'move appointment', 'different time'], phrases: ['need to reschedule', 'change my appointment'], negativeKeywords: [] },
        answer: { answerText: 'No problem, I can help you reschedule. Let me pull up your appointment.', audioUrl: '' },
        followUp: { question: 'What day and time works better for you?', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.cancel',
        enabled: true,
        priority: 25,
        label: 'Cancel appointment',
        match: { keywords: ['cancel', 'cancel appointment', 'dont need'], phrases: ['need to cancel', 'cancel my appointment'], negativeKeywords: [] },
        answer: { answerText: "I understand. I can cancel that appointment for you. There's no cancellation fee.", audioUrl: '' },
        followUp: { question: 'Is there anything else I can help you with today?', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.confirm',
        enabled: true,
        priority: 26,
        label: 'Confirm appointment',
        match: { keywords: ['confirm', 'verify appointment', 'still coming'], phrases: ['confirm my appointment', 'is my appointment still on'], negativeKeywords: [] },
        answer: { answerText: 'Let me check on your appointment. Can you give me the name or phone number on the account?', audioUrl: '' },
        followUp: { question: '', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.eta',
        enabled: true,
        priority: 27,
        label: 'Technician ETA',
        match: { keywords: ['eta', 'on the way', 'running late', 'when will tech arrive', 'where is technician'], phrases: ['when will the technician be here', 'is the tech on the way'], negativeKeywords: [] },
        answer: { answerText: "Let me check on your technician's status. Can you confirm the address or phone number on the account?", audioUrl: '' },
        followUp: { question: '', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.hours',
        enabled: true,
        priority: 28,
        label: 'Business hours',
        match: { keywords: ['hours', 'open', 'close', 'business hours', 'office hours'], phrases: ['what are your hours', 'when do you open', 'when do you close'], negativeKeywords: [] },
        answer: { answerText: "Our office is open Monday through Friday, 8 AM to 5 PM. We also offer after-hours emergency service with an additional fee.", audioUrl: '' },
        followUp: { question: 'Would you like to schedule an appointment?', nextAction: 'CONTINUE' }
      },
      {
        id: 'schedule.service_area',
        enabled: true,
        priority: 29,
        label: 'Service area',
        match: { keywords: ['service area', 'come to', 'cover', 'serve'], phrases: ['do you service', 'do you come to', 'what areas do you cover'], negativeKeywords: [] },
        answer: { answerText: "We service most areas within a 30-mile radius of our office. If you give me your zip code, I can confirm we cover your area.", audioUrl: '' },
        followUp: { question: 'What is your zip code?', nextAction: 'CONTINUE' }
      },

      // ========== PROBLEMS/SYMPTOMS (21-35) ==========
      {
        id: 'problem.not_cooling',
        enabled: true,
        priority: 30,
        label: 'AC not cooling',
        match: { keywords: ['not cooling', 'no cold air', 'warm air', 'not cold', 'ac not working'], phrases: ['blowing warm air', 'not getting cold'], negativeKeywords: [] },
        answer: { answerText: "I'm sorry to hear that. There are a few things that could cause this — it could be the thermostat, refrigerant, or a component issue. We can send a technician to diagnose the problem.", audioUrl: '' },
        followUp: { question: 'Is the system running at all, or is it completely off?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.not_heating',
        enabled: true,
        priority: 31,
        label: 'Furnace not heating',
        match: { keywords: ['not heating', 'no heat', 'cold air from furnace', 'furnace not working'], phrases: ['blowing cold air', 'not getting warm'], negativeKeywords: [] },
        answer: { answerText: "I understand, that's uncomfortable. This could be an igniter, thermostat, or gas valve issue. We should have a technician take a look.", audioUrl: '' },
        followUp: { question: 'Is the system turning on at all?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.strange_noise',
        enabled: true,
        priority: 32,
        label: 'Strange noise',
        match: { keywords: ['noise', 'loud', 'banging', 'squealing', 'grinding', 'rattling', 'humming'], phrases: ['making a noise', 'sounds weird', 'hearing a sound'], negativeKeywords: [] },
        answer: { answerText: "Strange noises can indicate a variety of issues — from a loose part to a failing motor. It's best to have it checked before it gets worse.", audioUrl: '' },
        followUp: { question: 'Is the system still running, or did it stop?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.water_leak',
        enabled: true,
        priority: 33,
        label: 'Water leak',
        match: { keywords: ['water leak', 'leaking water', 'water around unit', 'puddle', 'dripping'], phrases: ['water coming from', 'water on the floor'], negativeKeywords: [] },
        answer: { answerText: "Water leaks usually mean a clogged drain line or frozen evaporator coil. Turn off the system to prevent water damage and we'll send someone out.", audioUrl: '' },
        followUp: { question: 'Would you like to schedule service today?', nextAction: 'CONTINUE' }
      },
      {
        id: 'problem.frozen',
        enabled: true,
        priority: 34,
        label: 'Frozen unit/ice',
        match: { keywords: ['frozen', 'ice', 'iced over', 'frost', 'freezing up'], phrases: ['ice on the unit', 'coils are frozen'], negativeKeywords: [] },
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
      {
        id: 'greeting.hello',
        enabled: true,
        priority: 99,
        label: 'Simple greeting',
        match: { keywords: ['hello', 'hi', 'hey', 'good morning', 'good afternoon'], phrases: [], negativeKeywords: [] },
        answer: { answerText: "Hello! Thanks for calling. How can I help you today?", audioUrl: '' },
        followUp: { question: '', nextAction: 'CONTINUE' }
      },
      {
        id: 'greeting.thanks',
        enabled: true,
        priority: 99,
        label: 'Thanks/goodbye',
        match: { keywords: ['thank you', 'thanks', 'goodbye', 'bye', 'thats all'], phrases: ["that's all I needed", 'have a good day'], negativeKeywords: [] },
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
