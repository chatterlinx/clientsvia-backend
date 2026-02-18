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
  static UI_BUILD = 'AGENT2_UI_V0.1';

  constructor(companyId) {
    this.companyId = companyId;
    this.config = null;
    this.isDirty = false;
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
            firstLine: "I'm sorry — looks like my system’s moving a little slow. Thanks for your patience!",
            transferLine: "I'm so sorry — looks like my system isn't responding. Let me transfer you to a service advisor right away."
          },
          robotChallenge: {
            enabled: true,
            line: "Please, I am here to help you! You can speak to me naturally and ask anything you need — How can I help you?"
          },
          whenInDoubt: {
            enabled: true,
            transferLine: "Ok, to ensure you get the best help, I’m transferring you to a service advisor who can assist with your service needs. Please hold."
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

    container.innerHTML = `
      <div style="padding: 20px; background: #0d1117; color: #e6edf3;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; border-bottom:1px solid #30363d; padding-bottom:12px;">
          <div>
            <div style="display:flex; align-items:center; gap:10px;">
              <h2 style="margin:0; font-size:1.5rem; color:#22d3ee;">🧩 Agent 2.0</h2>
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
              <div style="font-weight:700;">When in doubt → transfer</div>
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
      const allow = Array.isArray(r.match?.scenarioTypeAllowlist) ? r.match.scenarioTypeAllowlist.join(', ') : '';
      const follow = r.followUp?.question || '';
      const nextAction = r.followUp?.nextAction || 'CONTINUE';
      const scenarioId = r.answer?.scenarioId || '';
      return `
        <tr style="border-bottom:1px solid #1f2937;">
          <td style="padding:10px; color:#94a3b8; font-family:monospace;">${idx + 1}</td>
          <td style="padding:10px;">
            <input class="a2-rule-id" data-idx="${idx}" value="${this.escapeHtml(r.id || '')}"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:8px; font-family:monospace;" />
          </td>
          <td style="padding:10px;">
            <input class="a2-rule-label" data-idx="${idx}" value="${this.escapeHtml(r.label || '')}"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:8px;" />
          </td>
          <td style="padding:10px;">
            <input class="a2-rule-keywords" data-idx="${idx}" value="${this.escapeHtml(keywords)}"
              placeholder="comma separated"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:8px;" />
          </td>
          <td style="padding:10px;">
            <input class="a2-rule-types" data-idx="${idx}" value="${this.escapeHtml(allow)}"
              placeholder="e.g. PRICING, FAQ"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:8px; font-family:monospace;" />
          </td>
          <td style="padding:10px;">
            <input class="a2-rule-scenarioId" data-idx="${idx}" value="${this.escapeHtml(scenarioId)}"
              placeholder="scenario id (optional)"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:8px; font-family:monospace;" />
          </td>
          <td style="padding:10px;">
            <textarea class="a2-rule-followup" data-idx="${idx}" rows="2"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:8px; resize:vertical;"
            >${this.escapeHtml(follow)}</textarea>
          </td>
          <td style="padding:10px;">
            <select class="a2-rule-nextAction" data-idx="${idx}"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:8px;">
              ${this._renderNextActionOption('CONTINUE', nextAction)}
              ${this._renderNextActionOption('OFFER_SCHEDULE_OR_ADVISOR', nextAction)}
              ${this._renderNextActionOption('OFFER_REPAIR_VS_MAINTENANCE', nextAction)}
              ${this._renderNextActionOption('TRANSFER_SERVICE_ADVISOR', nextAction)}
            </select>
          </td>
          <td style="padding:10px; text-align:center;">
            <button class="a2-rule-delete" data-idx="${idx}"
              style="background:#f8514940; color:#f85149; border:1px solid #f85149; padding:6px 10px; border-radius:10px; cursor:pointer;">
              Delete
            </button>
          </td>
        </tr>
      `;
    }).join('');

    return this.renderCard(
      'Inquiry Playbook (Answer-first)',
      'Rules decide which scenario (if any) may speak and what ONE follow-up question is asked. Keep it deterministic and editable.',
      `
        <div style="display:flex; gap:12px; align-items:center; flex-wrap:wrap;">
          <div style="flex:1; min-width:240px;">
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Allowed scenario types in Discovery (comma separated)</label>
            <input id="a2-allowed-types" value="${this.escapeHtml(allowedTypes.join(', '))}"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; font-family:monospace;" />
          </div>
          <div style="width:220px;">
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Min scenario score</label>
            <input id="a2-min-score" type="number" step="0.01" min="0" max="1"
              value="${this.escapeHtml(pb.minScenarioScore ?? 0.72)}"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px;" />
          </div>
          <div style="align-self:flex-end;">
            <button id="a2-add-rule" style="padding:10px 14px; background:#334155; color:#e2e8f0; border:1px solid #475569; border-radius:10px; cursor:pointer;">
              Add Rule
            </button>
          </div>
        </div>

        <div style="margin-top:12px; display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:12px;">
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Fallback answer when no scenario matches</label>
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
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">No-match fallback when call reason is already captured</label>
            <textarea id="a2-fallback-noMatchWhenReasonCaptured" rows="2"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; resize:vertical;"
              placeholder="Ok. I'm sorry about that.">${this.escapeHtml(fallback.noMatchWhenReasonCaptured || '')}</textarea>
          </div>
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:12px;">
            <label style="display:block; color:#cbd5e1; font-size:12px; margin-bottom:6px;">Clarifier question (no match + reason captured)</label>
            <textarea id="a2-fallback-noMatchClarifierQuestion" rows="2"
              style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #30363d; border-radius:10px; padding:10px; resize:vertical;"
              placeholder="Just so I help you the right way — is the system not running at all right now, or is it running but not cooling?">${this.escapeHtml(fallback.noMatchClarifierQuestion || '')}</textarea>
          </div>
        </div>

        <div style="margin-top:12px; overflow:auto; border:1px solid #1f2937; border-radius:12px;">
          <table style="width:100%; border-collapse:collapse; min-width:1200px;">
            <thead style="background:#0b1220;">
              <tr style="border-bottom:1px solid #1f2937;">
                <th style="text-align:left; padding:10px; color:#94a3b8; font-size:12px;">#</th>
                <th style="text-align:left; padding:10px; color:#94a3b8; font-size:12px;">Rule ID</th>
                <th style="text-align:left; padding:10px; color:#94a3b8; font-size:12px;">Label</th>
                <th style="text-align:left; padding:10px; color:#94a3b8; font-size:12px;">Keywords</th>
                <th style="text-align:left; padding:10px; color:#94a3b8; font-size:12px;">Type Allowlist</th>
                <th style="text-align:left; padding:10px; color:#94a3b8; font-size:12px;">Scenario ID</th>
                <th style="text-align:left; padding:10px; color:#94a3b8; font-size:12px;">Follow-up Question</th>
                <th style="text-align:left; padding:10px; color:#94a3b8; font-size:12px;">Next Action</th>
                <th style="text-align:center; padding:10px; color:#94a3b8; font-size:12px;">—</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="9" style="padding:14px; color:#94a3b8;">No rules yet. Click “Add Rule”.</td></tr>`}
            </tbody>
          </table>
        </div>
      `
    );
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

  attach(container) {
    const onAnyChange = () => this._setDirty(true);

    const enabled = container.querySelector('#a2-enabled');
    const dEnabled = container.querySelector('#a2-discovery-enabled');
    enabled?.addEventListener('change', (e) => { this.config.enabled = e.target.checked; onAnyChange(); });
    dEnabled?.addEventListener('change', (e) => { this.config.discovery.enabled = e.target.checked; onAnyChange(); });

    // Header buttons
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

    // Style controls
    container.querySelectorAll('#a2-style-ackWord, #a2-style-forbid, #a2-bridge-enabled, #a2-bridge-lines, #a2-robot-enabled, #a2-robot-line, #a2-delay-enabled, #a2-delay-first, #a2-delay-transfer, #a2-doubt-enabled, #a2-doubt-line, #a2-allowed-types, #a2-min-score')
      .forEach((el) => el?.addEventListener('input', onAnyChange));
    container.querySelectorAll('#a2-fallback-noMatchAnswer, #a2-fallback-afterAnswerQuestion')
      .forEach((el) => el?.addEventListener('input', onAnyChange));
    container.querySelectorAll('#a2-fallback-noMatchWhenReasonCaptured, #a2-fallback-noMatchClarifierQuestion')
      .forEach((el) => el?.addEventListener('input', onAnyChange));

    // Playbook
    container.querySelector('#a2-add-rule')?.addEventListener('click', () => {
      const rules = this.config.discovery.playbook.rules || [];
      rules.push({
        id: `rule_${Date.now()}`,
        label: 'New rule',
        match: { keywords: [], scenarioTypeAllowlist: [] },
        answer: { source: 'scenario', scenarioId: '' },
        followUp: { question: '', nextAction: 'CONTINUE' }
      });
      this.config.discovery.playbook.rules = rules;
      this.isDirty = true;
      this.render(container);
    });

    container.querySelectorAll('.a2-rule-delete').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx'));
        const rules = this.config.discovery.playbook.rules || [];
        rules.splice(idx, 1);
        this.config.discovery.playbook.rules = rules;
        this.isDirty = true;
        this.render(container);
      });
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

    // Rules table inputs
    const rules = discovery.playbook.rules || [];
    container.querySelectorAll('.a2-rule-id').forEach((el) => {
      const idx = Number(el.getAttribute('data-idx'));
      rules[idx] = rules[idx] || {};
      rules[idx].id = (el.value || '').trim();
    });
    container.querySelectorAll('.a2-rule-label').forEach((el) => {
      const idx = Number(el.getAttribute('data-idx'));
      rules[idx] = rules[idx] || {};
      rules[idx].label = (el.value || '').trim();
    });
    container.querySelectorAll('.a2-rule-keywords').forEach((el) => {
      const idx = Number(el.getAttribute('data-idx'));
      rules[idx] = rules[idx] || {};
      rules[idx].match = rules[idx].match || {};
      rules[idx].match.keywords = (el.value || '').split(',').map(s => s.trim()).filter(Boolean);
    });
    container.querySelectorAll('.a2-rule-types').forEach((el) => {
      const idx = Number(el.getAttribute('data-idx'));
      rules[idx] = rules[idx] || {};
      rules[idx].match = rules[idx].match || {};
      rules[idx].match.scenarioTypeAllowlist = (el.value || '').split(',').map(s => s.trim()).filter(Boolean);
    });
    container.querySelectorAll('.a2-rule-scenarioId').forEach((el) => {
      const idx = Number(el.getAttribute('data-idx'));
      rules[idx] = rules[idx] || {};
      rules[idx].answer = rules[idx].answer || { source: 'scenario', scenarioId: '' };
      rules[idx].answer.source = 'scenario';
      rules[idx].answer.scenarioId = (el.value || '').trim();
    });
    container.querySelectorAll('.a2-rule-followup').forEach((el) => {
      const idx = Number(el.getAttribute('data-idx'));
      rules[idx] = rules[idx] || {};
      rules[idx].followUp = rules[idx].followUp || { question: '', nextAction: 'CONTINUE' };
      rules[idx].followUp.question = (el.value || '').trim();
    });
    container.querySelectorAll('.a2-rule-nextAction').forEach((el) => {
      const idx = Number(el.getAttribute('data-idx'));
      rules[idx] = rules[idx] || {};
      rules[idx].followUp = rules[idx].followUp || { question: '', nextAction: 'CONTINUE' };
      rules[idx].followUp.nextAction = el.value;
    });

    discovery.playbook.rules = rules;
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
      const kws = (r.match?.keywords || []).map(s => `${s}`.toLowerCase()).filter(Boolean);
      return kws.some((k) => k && text.includes(k));
    }) || null;

    const ack = (style.ackWord || 'Ok.').trim() || 'Ok.';
    const scenarioId = matchRule?.answer?.scenarioId || null;
    const followUp = matchRule?.followUp?.question || '';
    const nextAction = matchRule?.followUp?.nextAction || 'CONTINUE';

    const answerLine = scenarioId
      ? `[Scenario:${scenarioId}]`
      : (matchRule ? '[Scenario:NOT_SET]' : '[No rule matched]');

    const spoken = [ack, answerLine, followUp].map(s => `${s || ''}`.trim()).filter(Boolean).join(' ');

    return {
      uiBuild: Agent2Manager.UI_BUILD,
      discoveryEnabled: this.config.discovery?.enabled === true,
      inputPreview: `${inputText || ''}`.substring(0, 160),
      selectedRule: matchRule ? { id: matchRule.id, label: matchRule.label } : null,
      plan: {
        answerSource: matchRule ? 'scenario_verbatim' : 'fallback',
        scenarioId,
        nextAction,
        followUpQuestion: followUp
      },
      spokenPreview: spoken.substring(0, 220)
    };
  }
}

window.Agent2Manager = Agent2Manager;

