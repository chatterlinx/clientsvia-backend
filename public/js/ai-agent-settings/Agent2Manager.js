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
    this._activeTab = 'config'; // 'config', 'greetings', 'llmFallback', or 'callReview'
    this._calls = [];
    this._callsLoading = false;
    this._selectedCall = null;
    // LLM Fallback tab state
    this._llmModels = null;
    this._llmUsageStats = null;
    this._llmUsageLoading = false;
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
            afterAnswerQuestion: 'Would you like to schedule a visit, or do you have a question I can help with?',
            // V126: Pending question responses - UI-configured, not hardcoded
            pendingYesResponse: "Great! Let me help you with that.",
            pendingNoResponse: "No problem. Is there anything else I can help you with?",
            pendingReprompt: "Sorry, I missed that. Could you say yes or no?"
          },
          rules: []
        },
        // V4: HUMAN TONE - UI-owned empathy templates
        // NO DEFAULTS - must be configured in UI. If empty, uses fallback chain.
        humanTone: {
          enabled: true,
          templates: {
            serviceDown: [],  // MUST be configured in UI
            angry: [],        // MUST be configured in UI
            afterHours: [],   // MUST be configured in UI
            general: []       // MUST be configured in UI
          }
        },
        // V4: Intent Priority Gate - prevents FAQ hijacking on service-down calls
        intentGate: {
          enabled: true,
          basePenalty: 50,
          emergencyFullDisqualify: true,
          disqualifiedCategories: ['faq', 'info', 'sales', 'financing', 'warranty', 'maintenance_plan', 'system_age', 'lifespan', 'replacement', 'upgrade', 'new_system', 'general'],
          serviceDownKeywords: [],
          emergencyKeywords: []
        },
        // V4: DISCOVERY HANDOFF - Consent question (no time offers)
        // NO DEFAULT - must be configured in UI. If empty, no question asked.
        discoveryHandoff: {
          enabled: true,
          consentQuestion: '',  // MUST be configured in UI
          yesNext: 'BOOKING_LANE',
          noNext: 'MESSAGE_TAKING',
          forbidBookingTimes: true
        },
        // V4: Call Reason Capture - sanitizes raw transcript to clean labels
        callReasonCapture: {
          enabled: true,
          mode: 'summary_label',
          maxWords: 6,
          stripLeadingPunctuation: true,
          stripGreetingPhrases: true,
          stripNamePhrases: true,
          stripFillerWords: true,
          customMappings: []
        },
        updatedAt: null
      },
      greetings: {
        callStart: { enabled: true, text: "Thank you for calling. How can I help you today?", audioUrl: '' },
        interceptor: {
          enabled: true,
          maxWordsToQualify: 2,
          blockIfContainsIntentWords: true,
          intentWords: ['repair', 'maintenance', 'tune-up', 'not cooling', 'price', 'cost', 'schedule', 'appointment'],
          rules: []
        }
      },
      llmFallback: {
        enabled: false,
        provider: 'openai',
        model: 'gpt-4.1-mini',
        customModelOverride: '',
        triggers: {
          noMatchCountThreshold: 2,
          complexityThreshold: 0.65,
          enableOnNoTriggerCardMatch: true,
          enableOnComplexQuestions: true,
          blockedWhileBooking: true,
          complexQuestionKeywords: ['why', 'how', 'warranty', 'covered', 'dangerous', 'safe', 'thermostat blank', 'is it normal', 'should i', 'can i']
        },
        constraints: {
          maxSentences: 2,
          mustEndWithFunnelQuestion: true,
          maxOutputTokens: 160,
          temperature: 0.2,
          allowedTasks: {
            clarifyProblem: true,
            basicSafeGuidance: true,
            pricing: false,
            guarantees: false,
            legal: false
          }
        },
        prompts: {
          system: 'You are a calm, professional HVAC service coordinator. Your ONLY job is to: 1) Acknowledge the caller\'s concern with brief empathy (NO parroting their words back), 2) Ask ONE question that moves them toward scheduling a service visit. Rules: Maximum 2 sentences. Never make promises. Always end with a booking-focused question.',
          format: 'Write exactly 2 sentences. Sentence 1: brief empathy. Sentence 2: one booking funnel question.',
          safety: 'SAFETY OVERRIDE: If burning smell, smoke, electrical sparks, gas smell, or carbon monoxide mentioned: Tell them to shut off the system. If gas/CO: leave house and call 911. Offer emergency booking.'
        },
        emergencyFallbackLine: {
          text: "I'm here with you — I can get this scheduled fast. Do you prefer morning or afternoon?",
          enabled: true
        },
        usage: {
          trackTokens: true,
          showCost: true,
          currency: 'USD'
        }
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
    
    // Update export button to show changes are ready to export
    const exportBtn = document.getElementById('a2-export-json');
    if (exportBtn) {
      if (this.isDirty) {
        exportBtn.style.background = '#f59e0b';
        exportBtn.title = 'Configuration has unsaved changes - export will include current state';
      } else {
        exportBtn.style.background = '#1f6feb';
        exportBtn.title = 'Download complete Agent 2.0 wiring report with all configuration, runtime integration, and validation';
      }
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
    const isLLMFallbackTab = this._activeTab === 'llmFallback';
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
              ${isConfigTab ? 'Clean, isolated config surface. Discovery is built and locked before Booking.' : isGreetingsTab ? 'Agent 2.0 owns greetings when enabled. Legacy greeting rules are ignored.' : isLLMFallbackTab ? 'LLM hybrid assist for complex questions. Deterministic first, LLM only when needed.' : 'Enterprise call review console. Click a call to see details, transcript, and decision trail.'}
            </div>
          </div>
          <div style="display:flex; gap:10px; flex-wrap:wrap; ${isCallReviewTab || isLLMFallbackTab ? 'display:none;' : ''}">
            <button id="a2-export-json" style="padding:8px 14px; background:${this.isDirty ? '#f59e0b' : '#1f6feb'}; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600;" title="Download COMPLETE runtime wiring report including Agent 2.0 + all runtime dependencies${this.isDirty ? ' (includes unsaved changes)' : ''}">
              📥 Complete Wiring Report
            </button>
            <button id="a2-export-agent2-only" style="padding:8px 14px; background:#21262d; color:#8b949e; border:1px solid #30363d; border-radius:8px; cursor:pointer; font-size:0.85rem;" title="Export Agent 2.0 namespace only (dev/debug)">
              Agent2 Only
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
          <button id="a2-tab-llmFallback" class="a2-tab-btn" style="padding:10px 20px; background:${isLLMFallbackTab ? '#0b1220' : 'transparent'}; color:${isLLMFallbackTab ? '#22d3ee' : '#8b949e'}; border:none; border-bottom:${isLLMFallbackTab ? '2px solid #22d3ee' : '2px solid transparent'}; cursor:pointer; font-weight:${isLLMFallbackTab ? '700' : '400'}; font-size:0.95rem;">
            LLM Fallback
          </button>
          <button id="a2-tab-callReview" class="a2-tab-btn" style="padding:10px 20px; background:${isCallReviewTab ? '#0b1220' : 'transparent'}; color:${isCallReviewTab ? '#22d3ee' : '#8b949e'}; border:none; border-bottom:${isCallReviewTab ? '2px solid #22d3ee' : '2px solid transparent'}; cursor:pointer; font-weight:${isCallReviewTab ? '700' : '400'}; font-size:0.95rem;">
            Call Review
          </button>
        </div>

        <!-- TAB CONTENT -->
        <div id="a2-tab-content">
          ${isConfigTab ? this.renderConfigTab() : isGreetingsTab ? this.renderGreetingsTab() : isLLMFallbackTab ? this.renderLLMFallbackTab() : this.renderCallReviewTab()}
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
    
    // If on LLM Fallback tab, load models and usage stats
    if (isLLMFallbackTab) {
      if (!this._llmModels) {
        this.loadLLMModels();
      }
      if (!this._llmUsageStats && !this._llmUsageLoading) {
        this.loadLLMUsageStats();
      }
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

  // ══════════════════════════════════════════════════════════════════════════
  // LLM FALLBACK TAB (Hybrid Assist - UI-Controlled)
  // ══════════════════════════════════════════════════════════════════════════
  // Deterministic first (trigger cards), LLM only when needed.
  // Every setting must be UI-owned. No hidden behaviors.
  // ══════════════════════════════════════════════════════════════════════════
  renderLLMFallbackTab() {
    return `
      ${this.renderLLMMasterSwitchCard()}
      ${this.renderLLMModelSelectionCard()}
      ${this.renderLLMTriggerRulesCard()}
      ${this.renderLLMOutputConstraintsCard()}
      ${this.renderLLMHandoffModeCard()}
      ${this.renderLLMCallForwardingCard()}
      ${this.renderLLMPromptsCard()}
      ${this.renderLLMEmergencyFallbackCard()}
      ${this.renderLLMUsageDashboardCard()}
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LLM FALLBACK: Master Switch Card
  // ─────────────────────────────────────────────────────────────────────────
  renderLLMMasterSwitchCard() {
    const llm = this.config?.llmFallback || {};
    const enabled = llm.enabled === true;

    return `
      <div class="a2-card" style="background:#0b1220; border:1px solid ${enabled ? '#22d3ee' : '#30363d'}; border-radius:16px; padding:24px; margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div>
            <h3 style="margin:0; font-size:1.25rem; color:#22d3ee;">LLM Fallback</h3>
            <div style="color:#6e7681; font-size:0.85rem; margin-top:4px;">
              When enabled, LLM assists with complex questions that trigger cards can't handle.
              <span style="color:#f59e0b;">Deterministic first, LLM only when needed.</span>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:12px;">
            <span id="a2-llm-status-pill" style="padding:6px 14px; border-radius:999px; font-size:0.85rem; font-weight:600; background:${enabled ? '#064e3b' : '#7f1d1d'}; color:${enabled ? '#34d399' : '#f87171'};">
              ${enabled ? 'ENABLED' : 'DISABLED'}
            </span>
            <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
              <input type="checkbox" id="a2-llm-enabled" ${enabled ? 'checked' : ''} style="width:22px; height:22px; accent-color:#22d3ee;">
            </label>
          </div>
        </div>
        ${!enabled ? `
          <div style="margin-top:16px; padding:12px; background:#1c1917; border:1px solid #78350f; border-radius:8px; color:#fbbf24; font-size:0.9rem;">
            <strong>When OFF:</strong> Agent 2.0 never calls LLM fallback. Only trigger cards, clarifiers, and UI-owned fallback lines speak.
          </div>
        ` : `
          <div style="margin-top:16px; padding:12px; background:#052e16; border:1px solid #166534; border-radius:8px; color:#86efac; font-size:0.9rem;">
            <strong>When ON:</strong> LLM assists when trigger cards fail and conditions are met. Output is constrained (2 sentences, must end with booking question).
          </div>
        `}
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LLM FALLBACK: Model Selection Card
  // ─────────────────────────────────────────────────────────────────────────
  renderLLMModelSelectionCard() {
    const llm = this.config?.llmFallback || {};
    const provider = llm.provider || 'openai';
    const model = llm.model || 'gpt-4.1-mini';
    const customOverride = llm.customModelOverride || '';
    const models = this._llmModels?.allowedModels || [];
    const pricing = this._llmModels?.pricingTable || {};
    const currentPricing = pricing[model] || { input: '?', output: '?' };

    return `
      <div class="a2-card" style="background:#0b1220; border:1px solid #1f2937; border-radius:16px; padding:24px; margin-bottom:20px;">
        <div style="margin-bottom:16px;">
          <h3 style="margin:0; font-size:1.15rem; color:#22d3ee;">Model Selection</h3>
          <div style="color:#6e7681; font-size:0.85rem; margin-top:4px;">Choose the LLM model for fallback responses. Curated list for stability.</div>
        </div>

        <div style="display:grid; grid-template-columns:1fr 2fr; gap:16px; margin-bottom:16px;">
          <div>
            <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Provider</label>
            <select id="a2-llm-provider" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.95rem;">
              <option value="openai" ${provider === 'openai' ? 'selected' : ''}>OpenAI</option>
            </select>
          </div>
          <div>
            <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Model</label>
            <select id="a2-llm-model" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.95rem;">
              ${models.length > 0 ? models.map(m => `
                <option value="${this.escapeHtml(m.id)}" ${model === m.id ? 'selected' : ''}>${this.escapeHtml(m.name)} — ${this.escapeHtml(m.description)}</option>
              `).join('') : `
                <option value="gpt-4.1-mini" ${model === 'gpt-4.1-mini' ? 'selected' : ''}>GPT-4.1 Mini (recommended)</option>
                <option value="gpt-4.1-nano" ${model === 'gpt-4.1-nano' ? 'selected' : ''}>GPT-4.1 Nano (economy)</option>
                <option value="gpt-4.1" ${model === 'gpt-4.1' ? 'selected' : ''}>GPT-4.1 (premium)</option>
                <option value="gpt-4o-mini" ${model === 'gpt-4o-mini' ? 'selected' : ''}>GPT-4o Mini</option>
                <option value="gpt-4o" ${model === 'gpt-4o' ? 'selected' : ''}>GPT-4o (premium)</option>
              `}
            </select>
          </div>
        </div>

        <div style="padding:12px; background:#161b22; border-radius:8px; margin-bottom:16px;">
          <div style="color:#8b949e; font-size:0.85rem; margin-bottom:8px;">Current Model Pricing (per 1M tokens)</div>
          <div style="display:flex; gap:24px;">
            <div><span style="color:#6e7681;">Input:</span> <span style="color:#34d399; font-weight:600;">$${typeof currentPricing.input === 'number' ? currentPricing.input.toFixed(2) : '?'}</span></div>
            <div><span style="color:#6e7681;">Output:</span> <span style="color:#f87171; font-weight:600;">$${typeof currentPricing.output === 'number' ? currentPricing.output.toFixed(2) : '?'}</span></div>
          </div>
        </div>

        <details style="margin-top:12px;">
          <summary style="color:#6e7681; font-size:0.85rem; cursor:pointer;">Advanced: Custom Model Override</summary>
          <div style="margin-top:12px;">
            <input type="text" id="a2-llm-custom-model" value="${this.escapeHtml(customOverride)}" placeholder="e.g., gpt-4-turbo-2024-04-09" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.9rem;">
            <div style="color:#f59e0b; font-size:0.8rem; margin-top:6px;">Warning: Custom models may have unknown pricing. Cost tracking will use default rates.</div>
          </div>
        </details>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LLM FALLBACK: Trigger Rules Card
  // ─────────────────────────────────────────────────────────────────────────
  renderLLMTriggerRulesCard() {
    const llm = this.config?.llmFallback || {};
    const triggers = llm.triggers || {};
    const noMatchThreshold = triggers.noMatchCountThreshold ?? 2;
    const complexityThreshold = triggers.complexityThreshold ?? 0.65;
    const maxTurnsPerCall = triggers.maxLLMFallbackTurnsPerCall ?? 1;
    const enableOnNoMatch = triggers.enableOnNoTriggerCardMatch !== false;
    const enableOnComplex = triggers.enableOnComplexQuestions !== false;
    const blockedWhileBooking = triggers.blockedWhileBooking !== false;
    const blockedWhileDiscovery = triggers.blockedWhileDiscoveryCriticalStep !== false;
    const keywords = (triggers.complexQuestionKeywords || []).join(', ');

    return `
      <div class="a2-card" style="background:#0b1220; border:1px solid #1f2937; border-radius:16px; padding:24px; margin-bottom:20px;">
        <div style="margin-bottom:16px;">
          <h3 style="margin:0; font-size:1.15rem; color:#22d3ee;">Trigger Rules — Only When All Else Fails</h3>
          <div style="color:#6e7681; font-size:0.85rem; margin-top:4px;">LLM is ASSIST-ONLY. These are hard gates — all must pass. LLM gets ONE shot, then funnels.</div>
        </div>

        <div style="display:grid; gap:16px;">
          <!-- Checkbox triggers -->
          <div style="display:grid; gap:12px;">
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:12px; background:#161b22; border-radius:8px;">
              <input type="checkbox" id="a2-llm-trigger-nomatch" ${enableOnNoMatch ? 'checked' : ''} style="width:18px; height:18px; accent-color:#22d3ee;">
              <div>
                <div style="color:#c9d1d9; font-size:0.95rem;">Trigger when no trigger card matches</div>
                <div style="color:#6e7681; font-size:0.8rem;">LLM called only when trigger cards fail to match</div>
              </div>
            </label>
            
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:12px; background:#161b22; border-radius:8px;">
              <input type="checkbox" id="a2-llm-trigger-complex" ${enableOnComplex ? 'checked' : ''} style="width:18px; height:18px; accent-color:#22d3ee;">
              <div>
                <div style="color:#c9d1d9; font-size:0.95rem;">Trigger on complex questions</div>
                <div style="color:#6e7681; font-size:0.8rem;">LLM called when caller asks why/how/warranty/covered etc.</div>
              </div>
            </label>
            
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:12px; background:${blockedWhileBooking ? '#052e16' : '#7f1d1d'}; border:1px solid ${blockedWhileBooking ? '#166534' : '#991b1b'}; border-radius:8px;">
              <input type="checkbox" id="a2-llm-blocked-booking" ${blockedWhileBooking ? 'checked' : ''} style="width:18px; height:18px; accent-color:#22d3ee;">
              <div>
                <div style="color:${blockedWhileBooking ? '#86efac' : '#f87171'}; font-size:0.95rem; font-weight:600;">Block during booking steps</div>
                <div style="color:#8b949e; font-size:0.8rem;">NEVER call LLM during name/address/time capture. <strong>Keep booking sacred.</strong></div>
              </div>
            </label>
            
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:12px; background:${blockedWhileDiscovery ? '#052e16' : '#7f1d1d'}; border:1px solid ${blockedWhileDiscovery ? '#166534' : '#991b1b'}; border-radius:8px;">
              <input type="checkbox" id="a2-llm-blocked-discovery-critical" ${blockedWhileDiscovery ? 'checked' : ''} style="width:18px; height:18px; accent-color:#22d3ee;">
              <div>
                <div style="color:${blockedWhileDiscovery ? '#86efac' : '#f87171'}; font-size:0.95rem; font-weight:600;">Block during discovery slot-filling</div>
                <div style="color:#8b949e; font-size:0.8rem;">NEVER call LLM when collecting address/phone during discovery.</div>
              </div>
            </label>
          </div>

          <!-- Threshold inputs -->
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:16px;">
            <div>
              <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">No-Match Count Threshold</label>
              <input type="number" id="a2-llm-nomatch-threshold" value="${noMatchThreshold}" min="1" max="5" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.95rem;">
              <div style="color:#6e7681; font-size:0.8rem; margin-top:4px;">Call LLM after N failed matches</div>
            </div>
            <div>
              <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Complexity Score Threshold</label>
              <input type="number" id="a2-llm-complexity-threshold" value="${complexityThreshold}" min="0" max="1" step="0.05" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.95rem;">
              <div style="color:#6e7681; font-size:0.8rem; margin-top:4px;">Complexity score >= threshold (0-1)</div>
            </div>
            <div>
              <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Max LLM Turns Per Call</label>
              <input type="number" id="a2-llm-max-turns" value="${maxTurnsPerCall}" min="1" max="3" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.95rem;">
              <div style="color:#6e7681; font-size:0.8rem; margin-top:4px;"><strong>LLM gets ONE shot</strong></div>
            </div>
          </div>

          <!-- Complex question keywords -->
          <div>
            <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Complex Question Keywords</label>
            <textarea id="a2-llm-complex-keywords" rows="2" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px; color:#c9d1d9; font-size:0.9rem; resize:vertical;" placeholder="why, how, warranty, covered, dangerous...">${this.escapeHtml(keywords)}</textarea>
            <div style="color:#6e7681; font-size:0.8rem; margin-top:4px;">Comma-separated. If caller input contains these, eligible for LLM.</div>
          </div>
        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LLM FALLBACK: Output Constraints Card
  // ─────────────────────────────────────────────────────────────────────────
  renderLLMOutputConstraintsCard() {
    const llm = this.config?.llmFallback || {};
    const constraints = llm.constraints || {};
    const maxSentences = constraints.maxSentences ?? 2;
    const mustEndWithFunnel = constraints.mustEndWithFunnelQuestion !== false;
    const maxTokens = constraints.maxOutputTokens ?? 160;
    const temperature = constraints.temperature ?? 0.2;
    const antiParrotGuard = constraints.antiParrotGuard !== false;
    const antiParrotMaxWords = constraints.antiParrotMaxWords ?? 8;
    const blockTimeSlots = constraints.blockTimeSlots !== false;
    const tasks = constraints.allowedTasks || {};

    return `
      <div class="a2-card" style="background:#0b1220; border:1px solid #1f2937; border-radius:16px; padding:24px; margin-bottom:20px;">
        <div style="margin-bottom:16px;">
          <h3 style="margin:0; font-size:1.15rem; color:#22d3ee;">Output Constraints</h3>
          <div style="color:#6e7681; font-size:0.85rem; margin-top:4px;">Hard enforcement rules. If LLM violates these, output is discarded and emergency fallback used.</div>
        </div>

        <div style="display:grid; gap:16px;">
          <!-- Hard constraints -->
          <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:12px;">
            <div>
              <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Max Sentences</label>
              <input type="number" id="a2-llm-max-sentences" value="${maxSentences}" min="1" max="5" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.95rem;">
            </div>
            <div>
              <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Max Output Tokens</label>
              <input type="number" id="a2-llm-max-tokens" value="${maxTokens}" min="50" max="500" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.95rem;">
            </div>
            <div>
              <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Temperature</label>
              <input type="number" id="a2-llm-temperature" value="${temperature}" min="0" max="1" step="0.1" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.95rem;">
              <div style="color:#6e7681; font-size:0.75rem; margin-top:2px;">Low = deterministic</div>
            </div>
          </div>

          <!-- Boolean constraints row -->
          <div style="display:grid; grid-template-columns:repeat(2, 1fr); gap:12px;">
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:12px; background:#052e16; border:1px solid #166534; border-radius:8px;">
              <input type="checkbox" id="a2-llm-must-funnel" ${mustEndWithFunnel ? 'checked' : ''} style="width:18px; height:18px; accent-color:#22d3ee;">
              <div>
                <div style="color:#86efac; font-size:0.9rem; font-weight:600;">Must end with funnel question</div>
                <div style="color:#6e7681; font-size:0.75rem;">Every response must advance booking</div>
              </div>
            </label>
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:12px; background:${blockTimeSlots ? '#052e16' : '#7f1d1d'}; border:1px solid ${blockTimeSlots ? '#166534' : '#991b1b'}; border-radius:8px;">
              <input type="checkbox" id="a2-llm-block-time-slots" ${blockTimeSlots ? 'checked' : ''} style="width:18px; height:18px; accent-color:#22d3ee;">
              <div>
                <div style="color:${blockTimeSlots ? '#86efac' : '#f87171'}; font-size:0.9rem; font-weight:600;">Block time slots</div>
                <div style="color:#6e7681; font-size:0.75rem;">LLM NEVER offers times/dates/windows</div>
              </div>
            </label>
          </div>

          <!-- Anti-parrot guard -->
          <div style="display:grid; grid-template-columns:2fr 1fr; gap:12px; align-items:center;">
            <label style="display:flex; align-items:center; gap:10px; cursor:pointer; padding:12px; background:#161b22; border-radius:8px;">
              <input type="checkbox" id="a2-llm-anti-parrot" ${antiParrotGuard ? 'checked' : ''} style="width:18px; height:18px; accent-color:#22d3ee;">
              <div>
                <div style="color:#c9d1d9; font-size:0.9rem;">Anti-parrot guard</div>
                <div style="color:#6e7681; font-size:0.75rem;">Don't repeat caller input verbatim</div>
              </div>
            </label>
            <div>
              <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Max consecutive words</label>
              <input type="number" id="a2-llm-anti-parrot-words" value="${antiParrotMaxWords}" min="3" max="20" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.95rem;" ${!antiParrotGuard ? 'disabled' : ''}>
            </div>
          </div>

          <!-- Allowed tasks -->
          <div style="padding:16px; background:#161b22; border-radius:8px;">
            <div style="color:#8b949e; font-size:0.9rem; margin-bottom:12px; font-weight:600;">Allowed Tasks (what LLM can do)</div>
            <div style="display:grid; grid-template-columns:repeat(3, 1fr); gap:10px;">
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="a2-llm-task-clarify" ${tasks.clarifyProblem !== false ? 'checked' : ''} style="width:16px; height:16px; accent-color:#22d3ee;">
                <span style="color:#c9d1d9; font-size:0.9rem;">Clarify problem</span>
              </label>
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="a2-llm-task-guidance" ${tasks.basicSafeGuidance !== false ? 'checked' : ''} style="width:16px; height:16px; accent-color:#22d3ee;">
                <span style="color:#c9d1d9; font-size:0.9rem;">Basic safe guidance</span>
              </label>
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="a2-llm-task-deescalation" ${tasks.deescalation !== false ? 'checked' : ''} style="width:16px; height:16px; accent-color:#22d3ee;">
                <span style="color:#c9d1d9; font-size:0.9rem;">De-escalation/empathy</span>
              </label>
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="a2-llm-task-pricing" ${tasks.pricing === true ? 'checked' : ''} style="width:16px; height:16px; accent-color:#f87171;">
                <span style="color:#f87171; font-size:0.9rem;">Pricing/quotes (risky)</span>
              </label>
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="a2-llm-task-guarantees" ${tasks.guarantees === true ? 'checked' : ''} style="width:16px; height:16px; accent-color:#f87171;">
                <span style="color:#f87171; font-size:0.9rem;">Guarantees (risky)</span>
              </label>
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="a2-llm-task-legal" ${tasks.legal === true ? 'checked' : ''} style="width:16px; height:16px; accent-color:#f87171;">
                <span style="color:#f87171; font-size:0.9rem;">Legal/warranty (risky)</span>
              </label>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LLM FALLBACK: Handoff Mode Card
  // ─────────────────────────────────────────────────────────────────────────
  // LLM confirms service intent, then hands off — NEVER schedules itself
  // ─────────────────────────────────────────────────────────────────────────
  renderLLMHandoffModeCard() {
    const llm = this.config?.llmFallback || {};
    const handoff = llm.handoff || {};
    const mode = handoff.mode || 'confirmService';
    const confirmService = handoff.confirmService || {};
    const takeMessage = handoff.takeMessage || {};
    const offerForward = handoff.offerForward || {};

    return `
      <div class="a2-card" style="background:#0b1220; border:1px solid #22d3ee; border-radius:16px; padding:24px; margin-bottom:20px;">
        <div style="margin-bottom:16px;">
          <h3 style="margin:0; font-size:1.15rem; color:#22d3ee;">Handoff Strategy</h3>
          <div style="color:#6e7681; font-size:0.85rem; margin-top:4px;">LLM confirms service intent → hands off to deterministic flow. <strong>LLM NEVER offers time slots.</strong></div>
        </div>

        <div style="display:grid; gap:16px;">
          <!-- Mode selection -->
          <div style="padding:16px; background:#161b22; border-radius:8px;">
            <div style="color:#8b949e; font-size:0.9rem; margin-bottom:12px; font-weight:600;">After LLM Response → Next Step</div>
            <div style="display:grid; gap:10px;">
              <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; padding:12px; background:${mode === 'confirmService' ? '#052e16' : '#0b1220'}; border:1px solid ${mode === 'confirmService' ? '#166534' : '#30363d'}; border-radius:8px;">
                <input type="radio" name="a2-llm-handoff-mode" value="confirmService" ${mode === 'confirmService' ? 'checked' : ''} style="margin-top:3px; accent-color:#22d3ee;">
                <div>
                  <div style="color:${mode === 'confirmService' ? '#86efac' : '#c9d1d9'}; font-size:0.95rem; font-weight:600;">Confirm Service Request → Return to Discovery (Recommended)</div>
                  <div style="color:#6e7681; font-size:0.8rem; margin-top:4px;">LLM asks "Would you like a technician?" → If YES, sets bookingIntentConfirmed and hands to deterministic flow.</div>
                </div>
              </label>
              
              <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; padding:12px; background:${mode === 'takeMessage' ? '#052e16' : '#0b1220'}; border:1px solid ${mode === 'takeMessage' ? '#166534' : '#30363d'}; border-radius:8px;">
                <input type="radio" name="a2-llm-handoff-mode" value="takeMessage" ${mode === 'takeMessage' ? 'checked' : ''} style="margin-top:3px; accent-color:#22d3ee;">
                <div>
                  <div style="color:${mode === 'takeMessage' ? '#86efac' : '#c9d1d9'}; font-size:0.95rem; font-weight:600;">Take a Message</div>
                  <div style="color:#6e7681; font-size:0.8rem; margin-top:4px;">LLM asks if caller wants to leave a message → routes to message workflow.</div>
                </div>
              </label>
              
              <label style="display:flex; align-items:flex-start; gap:10px; cursor:pointer; padding:12px; background:${mode === 'offerForward' ? '#052e16' : '#0b1220'}; border:1px solid ${mode === 'offerForward' ? '#166534' : '#30363d'}; border-radius:8px; opacity:${offerForward.enabled !== false ? 1 : 0.6};">
                <input type="radio" name="a2-llm-handoff-mode" value="offerForward" ${mode === 'offerForward' ? 'checked' : ''} style="margin-top:3px; accent-color:#22d3ee;">
                <div>
                  <div style="color:${mode === 'offerForward' ? '#86efac' : '#c9d1d9'}; font-size:0.95rem; font-weight:600;">Offer Call Forward</div>
                  <div style="color:#6e7681; font-size:0.8rem; margin-top:4px;">LLM asks consent to transfer → only if caller says YES. Requires call forwarding enabled below.</div>
                </div>
              </label>
            </div>
          </div>

          <!-- Mode-specific scripts -->
          ${mode === 'confirmService' ? `
          <div style="padding:16px; background:#161b22; border-radius:8px;">
            <div style="color:#22d3ee; font-size:0.9rem; margin-bottom:12px; font-weight:600;">Confirm Service Scripts (UI-owned)</div>
            <div style="display:grid; gap:12px;">
              <div>
                <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Service Confirmation Question</label>
                <input type="text" id="a2-llm-handoff-confirm-question" value="${this.escapeHtml(confirmService.question || "Would you like to get a technician out to take a look?")}" style="width:100%; background:#0b1220; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.9rem;">
              </div>
              <div>
                <label style="color:#86efac; font-size:0.85rem; display:block; margin-bottom:6px;">If YES → Handoff Line</label>
                <input type="text" id="a2-llm-handoff-confirm-yes" value="${this.escapeHtml(confirmService.yesResponse || "Perfect — I'm going to grab a few details so we can get this scheduled.")}" style="width:100%; background:#0b1220; border:1px solid #166534; border-radius:8px; padding:10px; color:#86efac; font-size:0.9rem;">
              </div>
              <div>
                <label style="color:#f87171; font-size:0.85rem; display:block; margin-bottom:6px;">If NO → Alternative</label>
                <input type="text" id="a2-llm-handoff-confirm-no" value="${this.escapeHtml(confirmService.noResponse || "No problem. Is there anything else I can help you with today?")}" style="width:100%; background:#0b1220; border:1px solid #991b1b; border-radius:8px; padding:10px; color:#f87171; font-size:0.9rem;">
              </div>
            </div>
          </div>
          ` : mode === 'takeMessage' ? `
          <div style="padding:16px; background:#161b22; border-radius:8px;">
            <div style="color:#22d3ee; font-size:0.9rem; margin-bottom:12px; font-weight:600;">Take Message Scripts (UI-owned)</div>
            <div style="display:grid; gap:12px;">
              <div>
                <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Message Offer Question</label>
                <input type="text" id="a2-llm-handoff-message-question" value="${this.escapeHtml(takeMessage.question || "Would you like me to take a message for a callback?")}" style="width:100%; background:#0b1220; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.9rem;">
              </div>
              <div>
                <label style="color:#86efac; font-size:0.85rem; display:block; margin-bottom:6px;">If YES</label>
                <input type="text" id="a2-llm-handoff-message-yes" value="${this.escapeHtml(takeMessage.yesResponse || "Great, I'll get some info for the callback. What's the best number to reach you?")}" style="width:100%; background:#0b1220; border:1px solid #166534; border-radius:8px; padding:10px; color:#86efac; font-size:0.9rem;">
              </div>
              <div>
                <label style="color:#f87171; font-size:0.85rem; display:block; margin-bottom:6px;">If NO</label>
                <input type="text" id="a2-llm-handoff-message-no" value="${this.escapeHtml(takeMessage.noResponse || "No problem. Is there anything else I can help you with?")}" style="width:100%; background:#0b1220; border:1px solid #991b1b; border-radius:8px; padding:10px; color:#f87171; font-size:0.9rem;">
              </div>
            </div>
          </div>
          ` : `
          <div style="padding:16px; background:#161b22; border-radius:8px;">
            <div style="color:#22d3ee; font-size:0.9rem; margin-bottom:12px; font-weight:600;">Offer Forward Scripts (UI-owned)</div>
            <div style="display:grid; gap:12px;">
              <div>
                <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Forward Consent Question</label>
                <input type="text" id="a2-llm-handoff-forward-question" value="${this.escapeHtml(offerForward.question || "Would you like me to connect you to a team member now?")}" style="width:100%; background:#0b1220; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.9rem;">
              </div>
              <div>
                <label style="color:#86efac; font-size:0.85rem; display:block; margin-bottom:6px;">If YES → Connecting</label>
                <input type="text" id="a2-llm-handoff-forward-yes" value="${this.escapeHtml(offerForward.yesResponse || "Connecting you now — one moment please.")}" style="width:100%; background:#0b1220; border:1px solid #166534; border-radius:8px; padding:10px; color:#86efac; font-size:0.9rem;">
              </div>
              <div>
                <label style="color:#f87171; font-size:0.85rem; display:block; margin-bottom:6px;">If NO</label>
                <input type="text" id="a2-llm-handoff-forward-no" value="${this.escapeHtml(offerForward.noResponse || "No problem. Is there something else I can help with?")}" style="width:100%; background:#0b1220; border:1px solid #991b1b; border-radius:8px; padding:10px; color:#f87171; font-size:0.9rem;">
              </div>
            </div>
          </div>
          `}
        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LLM FALLBACK: Call Forwarding Card
  // ─────────────────────────────────────────────────────────────────────────
  // UI-owned, no hidden code. LLM must ask consent before forwarding.
  // ─────────────────────────────────────────────────────────────────────────
  renderLLMCallForwardingCard() {
    const llm = this.config?.llmFallback || {};
    const fwd = llm.callForwarding || {};
    const enabled = fwd.enabled === true;
    const numbers = fwd.numbers || [];
    const whenAllowed = fwd.whenAllowed || 'businessHours';
    const hours = fwd.businessHours || {};
    const consentScript = fwd.consentScript || "Would you like me to connect you to a team member now?";
    const failureScript = fwd.failureScript || "I wasn't able to connect you — would you like me to take a message instead?";

    return `
      <div class="a2-card" style="background:#0b1220; border:1px solid ${enabled ? '#22d3ee' : '#30363d'}; border-radius:16px; padding:24px; margin-bottom:20px; opacity:${enabled ? 1 : 0.7};">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div>
            <h3 style="margin:0; font-size:1.15rem; color:#22d3ee;">Call Forwarding Settings</h3>
            <div style="color:#6e7681; font-size:0.85rem; margin-top:4px;">LLM must ask consent. No "just forward" — must receive explicit YES.</div>
          </div>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="a2-llm-fwd-enabled" ${enabled ? 'checked' : ''} style="width:20px; height:20px; accent-color:#22d3ee;">
            <span style="color:${enabled ? '#22d3ee' : '#6e7681'}; font-size:0.9rem; font-weight:600;">${enabled ? 'Enabled' : 'Disabled'}</span>
          </label>
        </div>

        ${enabled ? `
        <div style="display:grid; gap:16px;">
          <!-- When allowed -->
          <div>
            <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">When is forwarding allowed?</label>
            <select id="a2-llm-fwd-when" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.95rem;">
              <option value="always" ${whenAllowed === 'always' ? 'selected' : ''}>Always</option>
              <option value="businessHours" ${whenAllowed === 'businessHours' ? 'selected' : ''}>Business Hours Only</option>
              <option value="afterHours" ${whenAllowed === 'afterHours' ? 'selected' : ''}>After Hours Only</option>
            </select>
          </div>

          ${whenAllowed === 'businessHours' || whenAllowed === 'afterHours' ? `
          <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:12px;">
            <div>
              <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Start Time</label>
              <input type="time" id="a2-llm-fwd-start" value="${hours.start || '08:00'}" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.95rem;">
            </div>
            <div>
              <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">End Time</label>
              <input type="time" id="a2-llm-fwd-end" value="${hours.end || '17:00'}" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.95rem;">
            </div>
            <div>
              <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Timezone</label>
              <select id="a2-llm-fwd-tz" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.95rem;">
                <option value="America/New_York" ${hours.timezone === 'America/New_York' ? 'selected' : ''}>Eastern</option>
                <option value="America/Chicago" ${hours.timezone === 'America/Chicago' ? 'selected' : ''}>Central</option>
                <option value="America/Denver" ${hours.timezone === 'America/Denver' ? 'selected' : ''}>Mountain</option>
                <option value="America/Los_Angeles" ${hours.timezone === 'America/Los_Angeles' ? 'selected' : ''}>Pacific</option>
              </select>
            </div>
          </div>
          ` : ''}

          <!-- Forward numbers -->
          <div>
            <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Forward Numbers</label>
            <div id="a2-llm-fwd-numbers-container" style="display:grid; gap:8px;">
              ${numbers.length === 0 ? `
              <div style="color:#6e7681; font-size:0.9rem; padding:12px; background:#161b22; border-radius:8px; text-align:center;">
                No forward numbers configured. Add one below.
              </div>
              ` : numbers.map((n, i) => `
              <div style="display:grid; grid-template-columns:1fr 2fr auto; gap:8px; align-items:center;">
                <input type="text" value="${this.escapeHtml(n.label || '')}" placeholder="Label" data-fwd-idx="${i}" data-fwd-field="label" style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:8px; color:#c9d1d9; font-size:0.9rem;">
                <input type="tel" value="${this.escapeHtml(n.number || '')}" placeholder="+1234567890" data-fwd-idx="${i}" data-fwd-field="number" style="background:#161b22; border:1px solid #30363d; border-radius:8px; padding:8px; color:#c9d1d9; font-size:0.9rem;">
                <button data-remove-fwd="${i}" style="background:#7f1d1d; border:none; border-radius:8px; padding:8px 12px; color:#f87171; cursor:pointer;">✕</button>
              </div>
              `).join('')}
            </div>
            <button id="a2-llm-fwd-add-number" style="margin-top:8px; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:8px 16px; color:#22d3ee; cursor:pointer; font-size:0.9rem;">+ Add Number</button>
          </div>

          <!-- Scripts -->
          <div style="display:grid; gap:12px;">
            <div>
              <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Consent Script</label>
              <input type="text" id="a2-llm-fwd-consent" value="${this.escapeHtml(consentScript)}" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.9rem;">
            </div>
            <div>
              <label style="color:#f87171; font-size:0.85rem; display:block; margin-bottom:6px;">Failure Script</label>
              <input type="text" id="a2-llm-fwd-failure" value="${this.escapeHtml(failureScript)}" style="width:100%; background:#161b22; border:1px solid #991b1b; border-radius:8px; padding:10px; color:#f87171; font-size:0.9rem;">
            </div>
          </div>
        </div>
        ` : `
        <div style="text-align:center; padding:20px; color:#6e7681;">
          Enable call forwarding to configure numbers and scripts.
        </div>
        `}
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LLM FALLBACK: Prompts Card
  // ─────────────────────────────────────────────────────────────────────────
  renderLLMPromptsCard() {
    const llm = this.config?.llmFallback || {};
    const prompts = llm.prompts || {};
    const system = prompts.system || '';
    const format = prompts.format || '';
    const safety = prompts.safety || '';
    const introLine = prompts.introLine || '';

    return `
      <div class="a2-card" style="background:#0b1220; border:1px solid #1f2937; border-radius:16px; padding:24px; margin-bottom:20px;">
        <div style="margin-bottom:16px;">
          <h3 style="margin:0; font-size:1.15rem; color:#22d3ee;">UI-Owned Prompts</h3>
          <div style="color:#6e7681; font-size:0.85rem; margin-top:4px;">These prompts control LLM behavior. Edit here = truth. No hidden hardcode.</div>
        </div>

        <div style="display:grid; gap:20px;">
          <div>
            <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Optional Intro Line (spoken before LLM response)</label>
            <input type="text" id="a2-llm-prompt-intro" value="${this.escapeHtml(introLine)}" placeholder="Give me one second — I'm going to help you get this handled quickly." style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-size:0.9rem;">
          </div>

          <div>
            <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">System Prompt</label>
            <textarea id="a2-llm-prompt-system" rows="5" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px; color:#c9d1d9; font-size:0.9rem; resize:vertical; font-family:monospace;">${this.escapeHtml(system)}</textarea>
            <div style="color:#6e7681; font-size:0.8rem; margin-top:4px;">Defines the LLM's role and rules. Keep it short and focused on booking.</div>
          </div>

          <div>
            <label style="color:#8b949e; font-size:0.85rem; display:block; margin-bottom:6px;">Response Format</label>
            <textarea id="a2-llm-prompt-format" rows="2" style="width:100%; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px; color:#c9d1d9; font-size:0.9rem; resize:vertical; font-family:monospace;">${this.escapeHtml(format)}</textarea>
            <div style="color:#6e7681; font-size:0.8rem; margin-top:4px;">Enforces output structure (2 sentences, empathy + funnel question).</div>
          </div>

          <div>
            <label style="color:#f87171; font-size:0.85rem; display:block; margin-bottom:6px;">Safety Override</label>
            <textarea id="a2-llm-prompt-safety" rows="3" style="width:100%; background:#1c1917; border:1px solid #78350f; border-radius:8px; padding:12px; color:#fbbf24; font-size:0.9rem; resize:vertical; font-family:monospace;">${this.escapeHtml(safety)}</textarea>
            <div style="color:#f59e0b; font-size:0.8rem; margin-top:4px;">Critical safety rules (burning smell, gas, CO). Takes precedence over all other prompts.</div>
          </div>
        </div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LLM FALLBACK: Emergency Fallback Card
  // ─────────────────────────────────────────────────────────────────────────
  renderLLMEmergencyFallbackCard() {
    const llm = this.config?.llmFallback || {};
    const fallback = llm.emergencyFallbackLine || {};
    const text = fallback.text || "I'm here with you — I can get this scheduled fast. Do you prefer morning or afternoon?";
    const enabled = fallback.enabled !== false;

    return `
      <div class="a2-card" style="background:#0b1220; border:1px solid #78350f; border-radius:16px; padding:24px; margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <div>
            <h3 style="margin:0; font-size:1.15rem; color:#f59e0b;">Emergency Fallback Line</h3>
            <div style="color:#6e7681; font-size:0.85rem; margin-top:4px;">Used if LLM fails, times out, or violates constraints. This is your last resort.</div>
          </div>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="a2-llm-emergency-enabled" ${enabled ? 'checked' : ''} style="width:18px; height:18px; accent-color:#f59e0b;">
            <span style="color:#c9d1d9; font-size:0.9rem;">Enabled</span>
          </label>
        </div>
        
        <textarea id="a2-llm-emergency-text" rows="2" style="width:100%; background:#1c1917; border:1px solid #78350f; border-radius:8px; padding:12px; color:#fbbf24; font-size:0.95rem; resize:vertical;">${this.escapeHtml(text)}</textarea>
        <div style="color:#f59e0b; font-size:0.8rem; margin-top:6px;">This line is 100% UI-owned. No LLM generates this — it speaks exactly as written.</div>
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LLM FALLBACK: Usage Dashboard Card
  // ─────────────────────────────────────────────────────────────────────────
  renderLLMUsageDashboardCard() {
    const stats = this._llmUsageStats || {};
    const today = stats.today || {};
    const mtd = stats.mtd || {};
    const loading = this._llmUsageLoading;

    const formatCost = (cost) => {
      if (typeof cost !== 'number') return '$0.00';
      return '$' + cost.toFixed(4);
    };

    const formatTokens = (tokens) => {
      if (typeof tokens !== 'number') return '0';
      if (tokens >= 1000000) return (tokens / 1000000).toFixed(2) + 'M';
      if (tokens >= 1000) return (tokens / 1000).toFixed(1) + 'K';
      return tokens.toString();
    };

    return `
      <div class="a2-card" style="background:#0b1220; border:1px solid #1f2937; border-radius:16px; padding:24px; margin-bottom:20px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:20px;">
          <div>
            <h3 style="margin:0; font-size:1.15rem; color:#22d3ee;">Usage Dashboard</h3>
            <div style="color:#6e7681; font-size:0.85rem; margin-top:4px;">Token usage and cost tracking. Updated on tab load.</div>
          </div>
          <button id="a2-llm-refresh-usage" style="padding:8px 14px; background:#21262d; border:1px solid #30363d; border-radius:8px; color:#c9d1d9; cursor:pointer; font-size:0.85rem;">
            ${loading ? '⏳ Loading...' : '🔄 Refresh'}
          </button>
        </div>

        ${loading ? `
          <div style="text-align:center; padding:40px; color:#6e7681;">
            <div style="font-size:2rem; margin-bottom:8px;">⏳</div>
            <div>Loading usage stats...</div>
          </div>
        ` : `
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:20px;">
            <!-- Today -->
            <div style="padding:20px; background:#161b22; border-radius:12px; border-left:4px solid #22d3ee;">
              <div style="color:#22d3ee; font-size:0.9rem; font-weight:600; margin-bottom:12px;">TODAY</div>
              <div style="display:grid; gap:8px;">
                <div style="display:flex; justify-content:space-between;">
                  <span style="color:#6e7681;">LLM Calls</span>
                  <span style="color:#c9d1d9; font-weight:600;">${today.calls || 0}</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span style="color:#6e7681;">Input Tokens</span>
                  <span style="color:#c9d1d9;">${formatTokens(today.inputTokens)}</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span style="color:#6e7681;">Output Tokens</span>
                  <span style="color:#c9d1d9;">${formatTokens(today.outputTokens)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; padding-top:8px; border-top:1px solid #30363d;">
                  <span style="color:#8b949e; font-weight:600;">Cost</span>
                  <span style="color:#34d399; font-weight:700; font-size:1.1rem;">${formatCost(today.totalCost)}</span>
                </div>
              </div>
            </div>

            <!-- Month to Date -->
            <div style="padding:20px; background:#161b22; border-radius:12px; border-left:4px solid #a855f7;">
              <div style="color:#a855f7; font-size:0.9rem; font-weight:600; margin-bottom:12px;">MONTH TO DATE</div>
              <div style="display:grid; gap:8px;">
                <div style="display:flex; justify-content:space-between;">
                  <span style="color:#6e7681;">LLM Calls</span>
                  <span style="color:#c9d1d9; font-weight:600;">${mtd.calls || 0}</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span style="color:#6e7681;">Input Tokens</span>
                  <span style="color:#c9d1d9;">${formatTokens(mtd.inputTokens)}</span>
                </div>
                <div style="display:flex; justify-content:space-between;">
                  <span style="color:#6e7681;">Output Tokens</span>
                  <span style="color:#c9d1d9;">${formatTokens(mtd.outputTokens)}</span>
                </div>
                <div style="display:flex; justify-content:space-between; padding-top:8px; border-top:1px solid #30363d;">
                  <span style="color:#8b949e; font-weight:600;">Cost</span>
                  <span style="color:#34d399; font-weight:700; font-size:1.1rem;">${formatCost(mtd.totalCost)}</span>
                </div>
              </div>
            </div>
          </div>

          ${stats.last7Days && stats.last7Days.length > 0 ? `
            <div style="margin-top:20px; padding:16px; background:#161b22; border-radius:8px;">
              <div style="color:#8b949e; font-size:0.85rem; margin-bottom:12px;">Last 7 Days</div>
              <div style="display:grid; grid-template-columns:repeat(7, 1fr); gap:8px; text-align:center;">
                ${stats.last7Days.map(day => `
                  <div style="padding:8px 4px; background:#0b1220; border-radius:6px;">
                    <div style="color:#6e7681; font-size:0.7rem;">${day._id?.split('-').slice(1).join('/')}</div>
                    <div style="color:#c9d1d9; font-size:0.85rem; font-weight:600;">${day.calls}</div>
                    <div style="color:#34d399; font-size:0.75rem;">${formatCost(day.totalCost)}</div>
                  </div>
                `).join('')}
              </div>
            </div>
          ` : ''}
        `}
      </div>
    `;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LLM FALLBACK: Data Loading Methods
  // ─────────────────────────────────────────────────────────────────────────
  async loadLLMModels() {
    const token = this._getToken();
    if (!token) return;

    try {
      const res = await fetch('/api/admin/agent2/llmFallback/models', {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (res.ok) {
        const json = await res.json();
        this._llmModels = json.data;
        // Re-render to show models in dropdown
        if (this._activeTab === 'llmFallback' && this._container) {
          this.render(this._container);
        }
      }
    } catch (err) {
      console.error('[Agent2Manager] Failed to load LLM models:', err);
    }
  }

  async loadLLMUsageStats(forceRefresh = false) {
    const token = this._getToken();
    if (!token) return;

    this._llmUsageLoading = true;
    if (this._activeTab === 'llmFallback' && this._container) {
      const dashboard = this._container.querySelector('#a2-llm-refresh-usage');
      if (dashboard) dashboard.textContent = '⏳ Loading...';
    }

    try {
      const url = `/api/admin/agent2/llmFallback/usage/${this.companyId}${forceRefresh ? '?refresh=true' : ''}`;
      const res = await fetch(url, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        }
      });

      if (res.ok) {
        const json = await res.json();
        this._llmUsageStats = json.data;
      }
    } catch (err) {
      console.error('[Agent2Manager] Failed to load LLM usage stats:', err);
    } finally {
      this._llmUsageLoading = false;
      if (this._activeTab === 'llmFallback' && this._container) {
        this.render(this._container);
      }
    }
  }

  renderCallStartGreetingCard() {
    const greetings = this.config?.greetings || {};
    const callStart = greetings.callStart || {};
    const enabled = callStart.enabled !== false;
    const text = callStart.text || "Thank you for calling. How can I help you today?";
    const audioUrl = callStart.audioUrl || '';
    const hasAudio = audioUrl && audioUrl.trim();

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
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="text" id="a2-callstart-audioUrl" value="${this.escapeHtml(audioUrl)}" placeholder="Click 'Generate MP3' or paste a URL" style="flex:1; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:12px; color:#c9d1d9; font-size:0.9rem; font-family:monospace;">
            <button id="a2-callstart-play" style="padding:10px 14px; background:#1f6feb; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600; white-space:nowrap; ${hasAudio ? '' : 'display:none;'}" data-audio-url="${this.escapeHtml(audioUrl)}">
              ▶ Play
            </button>
            <button id="a2-callstart-generate" style="padding:10px 16px; background:#238636; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600; white-space:nowrap;">
              ${hasAudio ? 'Regenerate' : 'Generate MP3'}
            </button>
          </div>
          <div id="a2-callstart-audio-status" style="margin-top:6px; color:#6e7681; font-size:0.8rem;">
            ${hasAudio ? '<span style="color:#7ee787;">Audio ready</span>' : 'No audio generated yet. Click Generate MP3 to create audio from the text above.'}
          </div>
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
        <div style="display:flex; gap:8px; align-items:center;">
          <input type="text" id="a2-greeting-modal-audioUrl" value="${this.escapeHtml(rule.audioUrl || '')}" placeholder="Click 'Generate MP3' or paste a URL" style="flex:1; background:#161b22; border:1px solid #30363d; border-radius:8px; padding:10px; color:#c9d1d9; font-family:monospace; font-size:0.85rem;">
          <button id="a2-greeting-modal-play" style="padding:10px 14px; background:#1f6feb; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600; white-space:nowrap; ${rule.audioUrl ? '' : 'display:none;'}" data-audio-url="${this.escapeHtml(rule.audioUrl || '')}">
            ▶ Play
          </button>
          <button id="a2-greeting-modal-generate" style="padding:10px 16px; background:#238636; color:white; border:none; border-radius:8px; cursor:pointer; font-weight:600; white-space:nowrap;">
            ${rule.audioUrl ? 'Regenerate' : 'Generate MP3'}
          </button>
        </div>
        <div id="a2-greeting-modal-audio-status" style="margin-top:6px; color:#6e7681; font-size:0.8rem;">
          ${rule.audioUrl ? '<span style="color:#7ee787;">Audio ready</span>' : 'No audio generated yet.'}
        </div>
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
      ['CALL_START', 'A2_GATE', 'A2_DISCOVERY_GATE', 'A2_PATH_SELECTED', 'A2_RESPONSE_READY', 'A2_TRIGGER_EVAL', 'A2_SCENARIO_EVAL', 'A2_MIC_OWNER_PROOF', 'GREETING_EVALUATED', 'GREETING_INTERCEPTED', 'CORE_RUNTIME_OWNER_RESULT', 'TWIML_SENT', 'SLOTS_EXTRACTED', 'SPEECH_SOURCE_SELECTED', 'SPEAK_PROVENANCE', 'SPOKEN_TEXT_UNMAPPED_BLOCKED', 'CALL_END'].includes(e.type)
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
              <span>📋</span> Download Call Review
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

      <!-- SPEAK PROVENANCE (What spoke + where it came from) -->
      <div style="background:#0b1220; border:1px solid #22d3ee; border-radius:12px; padding:16px; margin-bottom:16px;">
        <div style="color:#22d3ee; font-size:0.8rem; margin-bottom:10px; display:flex; align-items:center; gap:8px;">
          <span>🎯</span> SPEAK PROVENANCE (WHO SPOKE & WHY)
        </div>
        <div style="font-size:0.75rem; color:#6e7681; margin-bottom:8px;">
          Every spoken line is traced to its UI source. <span style="color:#f43f5e;">Red = BLOCKED/UNMAPPED</span>
        </div>
        ${this.renderSpeakProvenance(events)}
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
          ${transcript.length > 0 ? transcript.map(t => {
            // Determine styling based on role and error/fallback status
            let bgColor, borderColor, labelColor, icon, statusBadge = '';
            
            if (t.role === 'caller') {
              bgColor = '#1a1f2e';
              borderColor = '#30363d';
              labelColor = '#60a5fa';
              icon = '📞';
            } else if (t.isError) {
              // Error - red styling
              bgColor = '#450a0a';
              borderColor = '#991b1b';
              labelColor = '#f87171';
              icon = '❌';
              statusBadge = '<span style="background:#991b1b; color:#fecaca; padding:2px 6px; border-radius:4px; font-size:0.65rem; margin-left:8px;">ERROR</span>';
            } else if (t.isFallback) {
              // Fallback - yellow styling
              bgColor = '#422006';
              borderColor = '#92400e';
              labelColor = '#fbbf24';
              icon = '⚠️';
              statusBadge = '<span style="background:#92400e; color:#fde68a; padding:2px 6px; border-radius:4px; font-size:0.65rem; margin-left:8px;">FALLBACK</span>';
            } else if (t.mismatch) {
              // Mismatch between planned and actual - orange styling
              bgColor = '#1c1917';
              borderColor = '#78350f';
              labelColor = '#fb923c';
              icon = '🔄';
              statusBadge = '<span style="background:#78350f; color:#fed7aa; padding:2px 6px; border-radius:4px; font-size:0.65rem; margin-left:8px;">CHANGED</span>';
            } else if (t.hadAudioIssue) {
              // Audio issue - TwiML sent but audio may have failed
              bgColor = '#1c1917';
              borderColor = '#7c2d12';
              labelColor = '#fb923c';
              icon = '🔇';
              statusBadge = '<span style="background:#7c2d12; color:#fed7aa; padding:2px 6px; border-radius:4px; font-size:0.65rem; margin-left:8px;">AUDIO ISSUE</span>';
            } else if (t.onlyPlanned) {
              // Only planned available - gray/uncertain styling
              bgColor = '#1f2937';
              borderColor = '#374151';
              labelColor = '#9ca3af';
              icon = '📝';
              statusBadge = '<span style="background:#374151; color:#d1d5db; padding:2px 6px; border-radius:4px; font-size:0.65rem; margin-left:8px;">PLANNED</span>';
            } else {
              // Normal agent response - green styling (confirmed actual)
              bgColor = '#0d2818';
              borderColor = '#166534';
              labelColor = '#4ade80';
              icon = '🤖';
            }
            
            // Build the planned vs actual comparison if there's a mismatch
            let comparisonHtml = '';
            if (t.mismatch && t.plannedText) {
              comparisonHtml = `
                <div style="margin-top:8px; padding-top:8px; border-top:1px dashed #374151;">
                  <div style="font-size:0.65rem; color:#9ca3af; margin-bottom:4px;">📝 PLANNED (not delivered):</div>
                  <div style="color:#6b7280; font-size:0.8rem; font-style:italic; line-height:1.3;">"${this.escapeHtml(t.plannedText)}"</div>
                </div>
              `;
            }
            
            // V4: Build speech source attribution line for agent responses
            let sourceAttrHtml = '';
            if (t.role === 'agent' && t.speechSource) {
              const src = t.speechSource;
              const sourceLabel = this._getSpeechSourceLabel(src.sourceId);
              const isUnmapped = src.uiPath === 'UNMAPPED' || src.uiPath?.includes('UNMAPPED');
              const sourceColor = isUnmapped ? '#f87171' : '#6ee7b7';
              const sourceIcon = isUnmapped ? '⚠️' : '📍';
              
              sourceAttrHtml = `
                <div style="margin-top:8px; padding:8px; background:${isUnmapped ? '#450a0a' : '#0d1117'}; border:1px solid ${isUnmapped ? '#991b1b' : '#30363d'}; border-radius:6px;">
                  <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
                    <span style="font-size:0.7rem;">${sourceIcon}</span>
                    <span style="color:${sourceColor}; font-size:0.7rem; font-weight:600;">${sourceLabel}</span>
                    ${isUnmapped ? '<span style="background:#991b1b; color:#fecaca; padding:1px 4px; border-radius:3px; font-size:0.6rem;">HARDCODED</span>' : ''}
                  </div>
                  <div style="color:#6b7280; font-size:0.65rem; font-family:monospace; word-break:break-all;">
                    ${this.escapeHtml(src.uiPath || 'unknown')}
                  </div>
                  ${src.cardId ? `<div style="color:#818cf8; font-size:0.65rem; margin-top:2px;">Card: ${this.escapeHtml(src.cardId)}</div>` : ''}
                  ${src.note ? `<div style="color:#9ca3af; font-size:0.65rem; margin-top:2px; font-style:italic;">${this.escapeHtml(src.note)}</div>` : ''}
                </div>
              `;
            } else if (t.role === 'agent' && !t.speechSource) {
              // No source info - likely legacy call or missing provenance event
              sourceAttrHtml = `
                <div style="margin-top:8px; padding:6px 8px; background:#1c1917; border:1px solid #78350f; border-radius:6px;">
                  <div style="display:flex; align-items:center; gap:6px;">
                    <span style="font-size:0.7rem;">❓</span>
                    <span style="color:#fbbf24; font-size:0.65rem;">Source unknown (no provenance event for this turn)</span>
                  </div>
                  <div style="color:#92400e; font-size:0.6rem; margin-top:2px;">Check raw events for SPEAK_PROVENANCE or SPEECH_SOURCE_SELECTED</div>
                </div>
              `;
            }
            
            return `
            <div style="margin-bottom:10px; padding:10px; background:${bgColor}; border:1px solid ${borderColor}; border-radius:8px;">
              <div style="font-size:0.7rem; color:${labelColor}; margin-bottom:4px; font-weight:600; display:flex; align-items:center;">
                ${icon} ${t.role === 'caller' ? 'CALLER' : 'AGENT'} ${t.turn !== undefined ? `(Turn ${t.turn})` : ''}${statusBadge}
              </div>
              <div style="color:#e5e7eb; font-size:0.85rem; line-height:1.4;">${this.escapeHtml(t.text)}</div>
              ${t.fallbackReason ? `<div style="color:#fbbf24; font-size:0.7rem; margin-top:6px;">Reason: ${this.escapeHtml(t.fallbackReason)}</div>` : ''}
              ${t.hadAudioIssue ? `<div style="color:#fb923c; font-size:0.7rem; margin-top:6px;">⚠️ Audio issue: ${this.escapeHtml(t.audioIssueReason || 'file not found')} - May not have been played</div>` : ''}
              ${comparisonHtml}
              ${sourceAttrHtml}
            </div>
          `}).join('') : `
            <div style="color:#6e7681; text-align:center; padding:20px;">No transcript available</div>
          `}
        </div>
      </div>

      <!-- CALL EVENTS -->
      <div style="background:#0b1220; border:1px solid #1f2937; border-radius:12px; padding:16px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div style="color:#8b949e; font-size:0.8rem;">CALL EVENTS (${events.length} total, ${keyEvents.length} key)</div>
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
      // V4: Look for SPEECH_SOURCE_SELECTED or SPEAK_PROVENANCE at turn 0 for greeting source
      // Check both event types - SPEECH_SOURCE_SELECTED preferred
      const greetingSource = events.find(e => 
        (e.type === 'SPEECH_SOURCE_SELECTED' || e.type === 'SPEAK_PROVENANCE') && 
        (e.turn === 0 || e.turn === undefined)
      );
      transcript.push({ 
        role: 'agent', 
        text: greeting.data.text, 
        turn: 0, 
        order: 0,
        speechSource: greetingSource ? {
          sourceId: greetingSource.data?.sourceId || 'agent2.greetings.callStart',
          uiPath: greetingSource.data?.uiPath || 'aiAgentSettings.agent2.greetings.callStart.text',
          uiTab: greetingSource.data?.uiTab || 'Greetings',
          note: greetingSource.data?.note || greetingSource.data?.reason || null,
          eventType: greetingSource.type
        } : {
          sourceId: 'agent2.greetings.callStart',
          uiPath: 'aiAgentSettings.agent2.greetings.callStart.text',
          uiTab: 'Greetings'
        }
      });
    }
    
    // Step 2: Collect all caller inputs and agent responses with timestamps
    const callerInputs = [];
    const agentResponses = [];
    
    // Track audio issues per turn (for detecting delivery failures)
    let audioPreflightFailed = null;
    let fellBackToTts = null;
    
    // V4: Track speech sources per turn (for source attribution)
    let speechSources = null;
    
    events.forEach(e => {
      const t = e.t || 0;
      
      // Caller input events
      if (e.type === 'GATHER_FINAL' || e.type === 'INPUT_TEXT_FINALIZED') {
        const text = e.data?.text || e.data?.finalPreview || e.data?.speechResult || '';
        if (text && text.length > 0) {
          callerInputs.push({ text, t, eventTurn: e.turn });
        }
      }
      
      // Agent response events - collect BOTH planned and actual
      // PLANNED: A2_RESPONSE_READY, CORE_RUNTIME_OWNER_RESULT, AGENT_RESPONSE_BUILT
      // ACTUAL: TWIML_SENT (what Twilio received), ROUTE_ERROR (crash)
      // AUDIO FAILURES: AUDIO_URL_PREFLIGHT_FAILED, FELL_BACK_TO_TTS (audio issues)
      
      // Track audio preflight failures for this turn
      if (e.type === 'AUDIO_URL_PREFLIGHT_FAILED') {
        if (!audioPreflightFailed) audioPreflightFailed = {};
        audioPreflightFailed[e.turn] = {
          reason: e.data?.reason || 'unknown',
          audioUrl: e.data?.audioUrl || null,
          t
        };
      }
      
      // Track TTS fallback (means audio was missing)
      if (e.type === 'FELL_BACK_TO_TTS') {
        if (!fellBackToTts) fellBackToTts = {};
        fellBackToTts[e.turn] = {
          reason: e.data?.reason || 'audio_missing',
          missingUrl: e.data?.missingAudioUrl || null,
          t
        };
      }
      
      // Actual responses (what was really sent/happened)
      if (e.type === 'TWIML_SENT' && e.data?.responsePreview) {
        const text = e.data.responsePreview;
        const isFallback = e.data.isFallback === true;
        const fallbackReason = e.data.fallbackReason || null;
        const hasPlay = e.data.hasPlay === true;
        const playUrl = e.data.playUrl || null;
        
        // Check if this turn had audio issues
        const hadAudioIssue = (audioPreflightFailed && audioPreflightFailed[e.turn]) || 
                             (fellBackToTts && fellBackToTts[e.turn]);
        
        agentResponses.push({ 
          text, 
          t, 
          eventTurn: e.turn, 
          source: 'actual',
          isFallback,
          fallbackReason,
          hasPlay,
          playUrl,
          hadAudioIssue,
          audioIssueReason: hadAudioIssue ? 
            (audioPreflightFailed?.[e.turn]?.reason || fellBackToTts?.[e.turn]?.reason) : null
        });
      }
      
      // V4: Capture SPEECH_SOURCE_SELECTED or SPEAK_PROVENANCE for source attribution
      // Both event types contain the same source info (uiPath, sourceId, etc.)
      // SPEECH_SOURCE_SELECTED is preferred, but fall back to SPEAK_PROVENANCE if not present
      if (e.type === 'SPEECH_SOURCE_SELECTED' || e.type === 'SPEAK_PROVENANCE') {
        if (!speechSources) speechSources = {};
        // Only set if not already set (SPEECH_SOURCE_SELECTED takes precedence)
        const turnKey = e.turn ?? 0;
        if (!speechSources[turnKey] || e.type === 'SPEECH_SOURCE_SELECTED') {
          speechSources[turnKey] = {
            sourceId: e.data?.sourceId || 'unknown',
            uiPath: e.data?.uiPath || 'UNMAPPED',
            uiTab: e.data?.uiTab || null,
            cardId: e.data?.cardId || null,
            configPath: e.data?.configPath || null,
            note: e.data?.note || e.data?.reason || null,
            eventType: e.type,
            t
          };
        }
      }
      if (e.type === 'ROUTE_ERROR') {
        const errorText = `[ERROR] ${e.data?.error || 'Unknown error occurred'}`;
        agentResponses.push({ 
          text: errorText, 
          t, 
          eventTurn: e.turn, 
          source: 'actual',
          isError: true,
          errorDetails: e.data?.error
        });
      }
      
      // Planned responses (what was intended before delivery)
      if (e.type === 'A2_RESPONSE_READY' && e.data?.responsePreview) {
        agentResponses.push({ text: e.data.responsePreview, t, eventTurn: e.turn, source: 'planned' });
      } else if (e.type === 'CORE_RUNTIME_OWNER_RESULT' && e.data?.responsePreview) {
        agentResponses.push({ text: e.data.responsePreview, t, eventTurn: e.turn, source: 'planned' });
      } else if (e.type === 'AGENT_RESPONSE_BUILT' && e.data?.text) {
        agentResponses.push({ text: e.data.text, t, eventTurn: e.turn, source: 'planned' });
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
    
    // Step 5: Group responses by turn, keeping both planned and actual
    // This allows us to show "Agent planned X but actually said Y"
    const turnResponses = {}; // { turn: { planned: [], actual: [] } }
    
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
      
      if (matchedTurn) {
        if (!turnResponses[matchedTurn]) {
          turnResponses[matchedTurn] = { planned: [], actual: [] };
        }
        if (resp.source === 'actual') {
          turnResponses[matchedTurn].actual.push(resp);
        } else {
          turnResponses[matchedTurn].planned.push(resp);
        }
      }
    });
    
    // Step 6: Build transcript entries, showing both planned and actual when different
    Object.keys(turnResponses).forEach(turnStr => {
      const turn = parseInt(turnStr, 10);
      const { planned, actual } = turnResponses[turn];
      
      // Get best planned response (first one)
      const plannedResp = planned[0];
      // Get best actual response (first one)
      const actualResp = actual[0];
      
      // Determine what to show
      const entry = { 
        role: 'agent', 
        turn, 
        order: (actualResp?.t || plannedResp?.t || 0)
      };
      
      if (actualResp) {
        // We have actual response - this is truth
        entry.text = actualResp.text;
        entry.isError = actualResp.isError || false;
        entry.isFallback = actualResp.isFallback || false;
        entry.fallbackReason = actualResp.fallbackReason || null;
        
        // Track audio issues (means TwiML was sent but audio may have failed)
        entry.hadAudioIssue = actualResp.hadAudioIssue || false;
        entry.audioIssueReason = actualResp.audioIssueReason || null;
        entry.hasPlay = actualResp.hasPlay || false;
        entry.playUrl = actualResp.playUrl || null;
        
        // If planned exists and differs from actual, include it
        if (plannedResp && plannedResp.text !== actualResp.text) {
          entry.plannedText = plannedResp.text;
          entry.mismatch = true;
        }
      } else if (plannedResp) {
        // Only planned available (TWIML_SENT not logged for this turn)
        entry.text = plannedResp.text;
        entry.onlyPlanned = true; // Mark that we only have planned, not confirmed actual
      }
      
      // V4: Attach speech source info for this turn
      if (speechSources && speechSources[turn]) {
        entry.speechSource = speechSources[turn];
      }
      
      if (entry.text) {
        transcript.push(entry);
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

  /**
   * V126: Render SPEAK_PROVENANCE events in a clear, human-readable format.
   * This shows exactly what spoke, where it came from (UI path), and why.
   */
  renderSpeakProvenance(events) {
    // Find all provenance events
    const provenanceEvents = events.filter(e => 
      e.type === 'SPEAK_PROVENANCE' || 
      e.type === 'SPEECH_SOURCE_SELECTED' || 
      e.type === 'SPOKEN_TEXT_UNMAPPED_BLOCKED' ||
      e.type === 'ROUTING_PROVENANCE' ||
      e.type === 'GREETING_AUDIO_MISSING_TTS_FALLBACK'
    );
    
    if (provenanceEvents.length === 0) {
      return `
        <div style="color:#6e7681; text-align:center; padding:16px; background:#161b22; border-radius:8px;">
          <div style="margin-bottom:4px;">No SPEAK_PROVENANCE events found</div>
          <div style="font-size:0.7rem;">This call may predate V126 provenance logging</div>
        </div>
      `;
    }
    
    return provenanceEvents.map((e, idx) => {
      const d = e.data || {};
      const turn = e.turn !== undefined ? e.turn : '?';
      const isBlocked = e.type === 'SPOKEN_TEXT_UNMAPPED_BLOCKED' || d.blocked === true;
      const isRouting = e.type === 'ROUTING_PROVENANCE';
      const isAudioFallback = d.audioMissing === true;
      
      // Color based on status
      let borderColor, bgColor, statusIcon, statusText;
      if (isBlocked) {
        borderColor = '#f43f5e';
        bgColor = '#450a0a';
        statusIcon = '🚫';
        statusText = 'BLOCKED';
      } else if (isAudioFallback) {
        borderColor = '#f59e0b';
        bgColor = '#1c1408';
        statusIcon = '🔄';
        statusText = 'AUDIO FALLBACK → TTS';
      } else if (d.isFromUiConfig === false) {
        borderColor = '#fbbf24';
        bgColor = '#0d1117';
        statusIcon = '⚠️';
        statusText = 'FALLBACK';
      } else {
        borderColor = '#4ade80';
        bgColor = '#0d1117';
        statusIcon = isRouting ? '🔀' : '🎙️';
        statusText = 'UI-OWNED';
      }
      
      // Extract key info
      const sourceId = d.sourceId || d.blockedSourceId || 'unknown';
      const uiPath = d.uiPath || 'UNMAPPED';
      const uiTab = d.uiTab || '?';
      const textPreview = d.spokenTextPreview || d.textPreview || d.blockedText || '[no text]';
      const reason = d.reason || '?';
      const originalAudioPath = d.originalAudioPath || null;
      
      // Build audio fallback info line if applicable
      const audioFallbackInfo = isAudioFallback && originalAudioPath ? `
        <div style="display:flex; gap:8px; margin-top:4px; padding-top:6px; border-top:1px solid #374151;">
          <span style="color:#f59e0b; min-width:70px;">⚠️ Audio:</span>
          <span style="color:#fbbf24; font-family:monospace; font-size:0.7rem; word-break:break-all;">
            ${this.escapeHtml(originalAudioPath)} <span style="color:#f43f5e;">(FILE MISSING)</span>
          </span>
        </div>
      ` : '';
      
      return `
        <div style="background:${bgColor}; border:1px solid ${borderColor}; border-radius:8px; padding:12px; margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:8px;">
            <div style="display:flex; align-items:center; gap:8px;">
              <span style="font-size:1.1rem;">${statusIcon}</span>
              <span style="color:#6e7681; font-weight:600;">Turn ${turn}</span>
              <span style="padding:2px 8px; background:${borderColor}22; color:${borderColor}; border-radius:4px; font-size:0.7rem; font-weight:600;">
                ${statusText}
              </span>
            </div>
            <span style="color:#6e7681; font-size:0.7rem;">${isRouting ? 'ROUTING' : 'SPEECH'}</span>
          </div>
          
          <div style="display:grid; gap:6px; font-size:0.8rem;">
            <div style="display:flex; gap:8px;">
              <span style="color:#6e7681; min-width:70px;">Source:</span>
              <span style="color:#a5b4fc; font-family:monospace; font-size:0.75rem;">${this.escapeHtml(sourceId)}</span>
            </div>
            <div style="display:flex; gap:8px;">
              <span style="color:#6e7681; min-width:70px;">UI Path:</span>
              <span style="color:${uiPath === 'UNMAPPED' || uiPath.includes('HARDCODED') ? '#f43f5e' : '#4ade80'}; font-family:monospace; font-size:0.75rem; word-break:break-all;">
                ${this.escapeHtml(uiPath)}
              </span>
            </div>
            <div style="display:flex; gap:8px;">
              <span style="color:#6e7681; min-width:70px;">UI Tab:</span>
              <span style="color:#e5e7eb;">${this.escapeHtml(uiTab)}</span>
            </div>
            <div style="display:flex; gap:8px;">
              <span style="color:#6e7681; min-width:70px;">Text:</span>
              <span style="color:#e5e7eb; font-style:italic;">"${this.escapeHtml(textPreview.substring(0, 100))}${textPreview.length > 100 ? '...' : ''}"</span>
            </div>
            <div style="display:flex; gap:8px;">
              <span style="color:#6e7681; min-width:70px;">Reason:</span>
              <span style="color:#94a3b8;">${this.escapeHtml(reason)}</span>
            </div>
            ${audioFallbackInfo}
          </div>
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
      'SLOTS_EXTRACTED': '#a5b4fc',
      'SPEECH_SOURCE_SELECTED': '#86efac',
      'SPOKEN_TEXT_UNMAPPED_BLOCKED': '#f87171'
    };
    return colors[type] || '#6e7681';
  }

  // V4: Get human-readable label for speech source
  _getSpeechSourceLabel(sourceId) {
    if (!sourceId) return 'Unknown Source';
    
    const labels = {
      // Greeting sources
      'agent2.greetings.callStart': '📞 Greeting → Call Start',
      'agent2.greetings.interceptor': '👋 Greeting → Interceptor',
      
      // Discovery sources
      'agent2.discovery.triggerCard': '🎯 Trigger Card',
      'agent2.discovery.humanTone': '💜 Human Tone',
      'agent2.discovery.discoveryHandoff': '🤝 Discovery Handoff',
      'agent2.discovery.clarifier': '❓ Clarifier',
      'agent2.discovery.clarifiers': '❓ Clarifier',
      'agent2.discovery.vocabulary': '📖 Vocabulary',
      'agent2.discovery.robotChallenge': '🤖 Robot Challenge',
      'agent2.discovery.fallback': '⬇️ Fallback',
      'agent2.discovery.fallback.noMatchAnswer': '⬇️ Fallback → No Match',
      'agent2.discovery.fallback.noMatchWhenReasonCaptured': '⬇️ Fallback → Reason Captured',
      'agent2.discovery.fallback.pendingComplexFollowup': '⬇️ Fallback → Complex Followup',
      
      // Scenario engine
      'scenarioEngine.fallback': '🎭 Scenario Engine',
      
      // LLM sources
      'agent2.llmFallback': '🤖 LLM Fallback',
      'llm.fallback': '🤖 LLM Fallback',
      
      // Emergency
      'agent2.emergencyFallback': '🚨 Emergency Fallback',
      
      // Connection Quality Gate
      'connectionQualityGate.clarification': '🔄 Connection Quality Gate → Re-greet',
      'connectionQualityGate.dtmfEscape': '📞 Connection Quality Gate → DTMF Escape',
      
      // Legacy/unknown
      'legacy': '⚠️ Legacy System',
      'legacy.greeting': '⚠️ Legacy → Greeting',
      'legacy.greetingInterceptor': '⚠️ Legacy → Greeting Interceptor',
      'unknown': '❓ Unknown'
    };
    
    // Check for exact match first
    if (labels[sourceId]) return labels[sourceId];
    
    // Check for partial matches (e.g., "agent2.discovery.triggerCard[ac-repair]")
    for (const [key, label] of Object.entries(labels)) {
      if (sourceId.startsWith(key)) {
        // Extract any ID in brackets
        const match = sourceId.match(/\[([^\]]+)\]/);
        if (match) {
          return `${label} [${match[1]}]`;
        }
        return label;
      }
    }
    
    // Fallback: clean up the sourceId for display
    return sourceId.replace(/^agent2\./, '').replace(/\./g, ' → ');
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
      a.download = `call-review-${call.callSid}.json`;
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
        
        <!-- V126: Pending Question Responses - UI-configured, not hardcoded -->
        <div style="margin-top:16px; padding:16px; background:#0d1117; border:1px solid #30363d; border-radius:12px;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
            <span style="font-size:16px;">💬</span>
            <label style="color:#cbd5e1; font-size:13px; font-weight:600;">Pending Question Responses</label>
          </div>
          <p style="color:#6b7280; font-size:11px; margin-bottom:12px;">
            What the AI says when a caller responds YES, NO, or is unclear to a follow-up question.
          </p>
          <div style="display:grid; grid-template-columns: 1fr 1fr 1fr; gap:12px;">
            <div>
              <label style="display:block; color:#94a3b8; font-size:11px; margin-bottom:4px;">When caller says YES</label>
              <textarea id="a2-fallback-pendingYesResponse" rows="2"
                style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; resize:vertical; font-size:12px;"
                placeholder="Great! Let me help you with that.">${this.escapeHtml(fallback.pendingYesResponse || '')}</textarea>
            </div>
            <div>
              <label style="display:block; color:#94a3b8; font-size:11px; margin-bottom:4px;">When caller says NO</label>
              <textarea id="a2-fallback-pendingNoResponse" rows="2"
                style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; resize:vertical; font-size:12px;"
                placeholder="No problem. Is there anything else I can help you with?">${this.escapeHtml(fallback.pendingNoResponse || '')}</textarea>
            </div>
            <div>
              <label style="display:block; color:#94a3b8; font-size:11px; margin-bottom:4px;">When response is unclear (reprompt)</label>
              <textarea id="a2-fallback-pendingReprompt" rows="2"
                style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; resize:vertical; font-size:12px;"
                placeholder="Sorry, I missed that. Could you say yes or no?">${this.escapeHtml(fallback.pendingReprompt || '')}</textarea>
            </div>
          </div>
        </div>

        <!-- V126: Emergency Fallback Line - REQUIRED for No-UI-No-Speak Guard -->
        <div style="margin-top:16px; padding:16px; background:#1f1007; border:1px solid #f59e0b; border-radius:12px;">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px;">
            <span style="font-size:18px;">🛡️</span>
            <label style="color:#f59e0b; font-size:13px; font-weight:600;">Emergency Fallback Line (Required for Production)</label>
          </div>
          <p style="color:#9ca3af; font-size:11px; margin-bottom:10px;">
            This is the LAST RESORT response when all other speech sources fail validation. 
            Without this, the system will speak only "One moment please" in emergencies.
          </p>
          <textarea id="a2-emergency-fallback" rows="2"
            style="width:100%; background:#0d1117; color:#e5e7eb; border:1px solid #f59e0b; border-radius:10px; padding:10px; resize:vertical;"
            placeholder="How can I help you today?">${this.escapeHtml(this.agent2Config?.emergencyFallbackLine?.text || '')}</textarea>
        </div>

        ${this._renderEmpathyAndToneSection()}
        
        ${this._renderIntentPriorityGateSection()}
        
        ${this._renderHandoffSection()}

        ${this._renderNormalizationSection()}
        
        ${this._renderGlobalNegativeKeywordsSection()}
        
        ${this._renderLLMFallbackSection()}

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

  // ──────────────────────────────────────────────────────────────────────────
  // V4: HUMAN TONE SECTION (UI-owned empathy templates)
  // ──────────────────────────────────────────────────────────────────────────
  _renderEmpathyAndToneSection() {
    const humanTone = this.config?.discovery?.humanTone || {};
    const enabled = humanTone.enabled !== false;
    const templates = humanTone.templates || {};
    const serviceDownLines = Array.isArray(templates.serviceDown) ? templates.serviceDown : [];
    const angryLines = Array.isArray(templates.angry) ? templates.angry : [];
    const generalLines = Array.isArray(templates.general) ? templates.general : [];
    
    // Check if any templates are configured
    const hasTemplates = serviceDownLines.length > 0 || angryLines.length > 0 || generalLines.length > 0;
    
    return `
      <div style="margin-top:20px; padding:16px; background:#0b1220; border:1px solid ${hasTemplates ? '#1e3a5f' : '#f59e0b'}; border-radius:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:18px;">💜</span>
            <label style="color:#a78bfa; font-size:14px; font-weight:600;">Human Tone</label>
            <span style="font-size:10px; background:#1e3a5f; color:#818cf8; padding:2px 6px; border-radius:4px;">V4</span>
            ${!hasTemplates ? '<span style="font-size:10px; background:#78350f; color:#fbbf24; padding:2px 6px; border-radius:4px; margin-left:4px;">NOT CONFIGURED</span>' : ''}
          </div>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="a2-humantone-enabled" ${enabled ? 'checked' : ''} 
              style="width:16px; height:16px; cursor:pointer;"/>
            <span style="color:#94a3b8; font-size:12px;">Enabled</span>
          </label>
        </div>
        
        <p style="color:#6b7280; font-size:11px; margin-bottom:8px;">
          UI-owned empathy templates. These are the ONLY empathy lines the AI can speak.
        </p>
        ${!hasTemplates ? `
        <div style="margin-bottom:12px; padding:8px; background:#1c1917; border:1px solid #78350f; border-radius:6px;">
          <p style="color:#fbbf24; font-size:11px; margin:0;">
            <strong>⚠️ Required:</strong> Configure at least one template below. Without these, the AI will fall back to Playbook fallback or Emergency fallback.
          </p>
        </div>
        ` : ''}
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px; margin-top:12px;">
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:10px;">
            <label style="display:block; color:#cbd5e1; font-size:11px; margin-bottom:6px;">
              Service Down / Urgent Issue
              <span style="color:#64748b; font-size:10px;">(aiAgentSettings.agent2.discovery.humanTone.templates.serviceDown[0])</span>
            </label>
            <textarea id="a2-humantone-serviceDown" rows="2"
              style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; resize:vertical; font-size:12px;"
              placeholder="(required) e.g., I hear you — no AC in this heat is miserable. I'm going to get this handled.">${this.escapeHtml(serviceDownLines[0] || '')}</textarea>
          </div>
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:10px;">
            <label style="display:block; color:#cbd5e1; font-size:11px; margin-bottom:6px;">
              Frustrated / Angry Caller
              <span style="color:#64748b; font-size:10px;">(aiAgentSettings.agent2.discovery.humanTone.templates.angry[0])</span>
            </label>
            <textarea id="a2-humantone-angry" rows="2"
              style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; resize:vertical; font-size:12px;"
              placeholder="(optional) e.g., I get it — this is frustrating. I'm here with you and we'll fix this.">${this.escapeHtml(angryLines[0] || '')}</textarea>
          </div>
        </div>
        
        <div style="margin-top:12px; padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:10px;">
          <label style="display:block; color:#cbd5e1; font-size:11px; margin-bottom:6px;">
            General Empathy (Default)
            <span style="color:#64748b; font-size:10px;">(aiAgentSettings.agent2.discovery.humanTone.templates.general[0])</span>
          </label>
          <textarea id="a2-humantone-general" rows="1"
            style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; resize:vertical; font-size:12px;"
            placeholder="(required) e.g., Got it — I can help.">${this.escapeHtml(generalLines[0] || '')}</textarea>
        </div>
        
        <div style="margin-top:12px; padding:10px; background:#052e16; border:1px solid #166534; border-radius:8px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="color:#86efac; font-size:12px;">✓</span>
            <span style="color:#86efac; font-size:11px; font-weight:500;">No-UI-No-Speak Enforced</span>
          </div>
          <p style="color:#6ee7b7; font-size:10px; margin-top:4px;">
            Only text configured here can be spoken. The AI will NEVER say "It sounds like [caller's words]" or any hardcoded text.
          </p>
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // V4: INTENT PRIORITY GATE SECTION
  // ──────────────────────────────────────────────────────────────────────────
  _renderIntentPriorityGateSection() {
    const intentGate = this.config?.discovery?.intentGate || {};
    const enabled = intentGate.enabled !== false;
    const emergencyFullDisqualify = intentGate.emergencyFullDisqualify !== false;
    const disqualifiedCategories = Array.isArray(intentGate.disqualifiedCategories) 
      ? intentGate.disqualifiedCategories 
      : ['faq', 'info', 'sales', 'financing', 'warranty', 'maintenance_plan', 'system_age', 'lifespan', 'replacement', 'upgrade', 'new_system', 'general'];
    
    return `
      <div style="margin-top:20px; padding:16px; background:#0b1220; border:1px solid #1e3a5f; border-radius:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:18px;">🚦</span>
            <label style="color:#f97316; font-size:14px; font-weight:600;">Intent Priority Gate</label>
            <span style="font-size:10px; background:#7c2d12; color:#fdba74; padding:2px 6px; border-radius:4px;">V4</span>
          </div>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="a2-intentgate-enabled" ${enabled ? 'checked' : ''} 
              style="width:16px; height:16px; cursor:pointer;"/>
            <span style="color:#94a3b8; font-size:12px;">Enabled</span>
          </label>
        </div>
        
        <p style="color:#6b7280; font-size:11px; margin-bottom:12px;">
          Prevents FAQ/sales cards from hijacking service-down calls. When "not cooling" or "emergency" detected, FAQ cards are penalized or blocked.
        </p>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:10px;">
            <label style="display:block; color:#cbd5e1; font-size:11px; margin-bottom:6px;">Card Categories to Penalize/Block</label>
            <textarea id="a2-intentgate-categories" rows="2"
              style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; resize:vertical; font-size:11px;"
              placeholder="faq, info, sales, financing, warranty, system_age">${this.escapeHtml(disqualifiedCategories.join(', '))}</textarea>
            <div style="color:#64748b; font-size:10px; margin-top:4px;">Comma-separated. Cards with matching IDs/categories get penalized.</div>
          </div>
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:10px;">
            <div style="display:flex; flex-direction:column; gap:10px;">
              <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
                <input type="checkbox" id="a2-intentgate-emergencyDisqualify" ${emergencyFullDisqualify ? 'checked' : ''} 
                  style="width:14px; height:14px; cursor:pointer;"/>
                <span style="color:#e5e7eb; font-size:12px;">Fully disqualify FAQ cards on emergency</span>
              </label>
              <p style="color:#64748b; font-size:10px;">
                When enabled, FAQ cards are completely blocked (not just penalized) when emergency keywords detected.
              </p>
            </div>
          </div>
        </div>
        
        <div style="margin-top:12px; padding:10px; background:#1c1917; border:1px solid #78350f; border-radius:8px;">
          <div style="display:flex; align-items:start; gap:8px;">
            <span style="font-size:14px;">💡</span>
            <div>
              <p style="color:#fbbf24; font-size:11px; font-weight:500; margin-bottom:2px;">Why this matters</p>
              <p style="color:#a3a3a3; font-size:10px;">
                Without this gate, a caller saying "I'm a longtime customer, my AC has problems" might match a "system age/lifespan" FAQ card instead of routing to service.
              </p>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // V4: DISCOVERY HANDOFF SECTION (UI-owned consent question)
  // ──────────────────────────────────────────────────────────────────────────
  _renderHandoffSection() {
    const discoveryHandoff = this.config?.discovery?.discoveryHandoff || {};
    const consentQuestion = discoveryHandoff.consentQuestion || '';
    const forbidBookingTimes = discoveryHandoff.forbidBookingTimes !== false;
    const hasConsent = !!consentQuestion.trim();
    
    return `
      <div style="margin-top:20px; padding:16px; background:#0b1220; border:1px solid ${hasConsent ? '#1e3a5f' : '#f59e0b'}; border-radius:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:18px;">🤝</span>
            <label style="color:#22d3ee; font-size:14px; font-weight:600;">Discovery Handoff</label>
            <span style="font-size:10px; background:#164e63; color:#67e8f9; padding:2px 6px; border-radius:4px;">V4</span>
            ${!hasConsent ? '<span style="font-size:10px; background:#78350f; color:#fbbf24; padding:2px 6px; border-radius:4px; margin-left:4px;">NOT CONFIGURED</span>' : ''}
          </div>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="a2-discoveryhandoff-forbidTimes" ${forbidBookingTimes ? 'checked' : ''} 
              style="width:16px; height:16px; cursor:pointer;"/>
            <span style="color:#94a3b8; font-size:12px;">Forbid Booking Times</span>
          </label>
        </div>
        
        <p style="color:#6b7280; font-size:11px; margin-bottom:8px;">
          UI-owned consent question. Discovery asks for yes/no ONLY — booking times are a separate lane.
        </p>
        ${!hasConsent ? `
        <div style="margin-bottom:12px; padding:8px; background:#1c1917; border:1px solid #78350f; border-radius:6px;">
          <p style="color:#fbbf24; font-size:11px; margin:0;">
            <strong>⚠️ Required:</strong> Configure a consent question below. Without this, no handoff question will be asked after empathy.
          </p>
        </div>
        ` : ''}
        
        <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:10px;">
          <label style="display:block; color:#cbd5e1; font-size:11px; margin-bottom:6px;">
            Consent Question (Yes/No only)
            <span style="color:#64748b; font-size:10px;">(aiAgentSettings.agent2.discovery.discoveryHandoff.consentQuestion)</span>
          </label>
          <textarea id="a2-discoveryhandoff-consentQuestion" rows="2"
            style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; resize:vertical; font-size:12px;"
            placeholder="(required) e.g., Do you want us to send a technician out to take a look?">${this.escapeHtml(consentQuestion)}</textarea>
        </div>
        
        <div style="margin-top:12px; padding:10px; background:#052e16; border:1px solid #166534; border-radius:8px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="color:#86efac; font-size:12px;">✓</span>
            <span style="color:#86efac; font-size:11px; font-weight:500;">No-UI-No-Speak Enforced</span>
          </div>
          <p style="color:#6ee7b7; font-size:10px; margin-top:4px;">
            Only this question can be asked during handoff. No hardcoded "morning or afternoon" or time slot offers.
          </p>
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // V4: SPEECH PREPROCESSING SECTION (Clean input BEFORE matching)
  // ──────────────────────────────────────────────────────────────────────────
  _renderNormalizationSection() {
    const preprocessing = this.config?.discovery?.preprocessing || {};
    const enabled = preprocessing.enabled !== false;
    const fillerWords = Array.isArray(preprocessing.fillerWords) 
      ? preprocessing.fillerWords 
      : [];
    const ignorePhrases = Array.isArray(preprocessing.ignorePhrases)
      ? preprocessing.ignorePhrases
      : [];
    const canonicalRewrites = Array.isArray(preprocessing.canonicalRewrites)
      ? preprocessing.canonicalRewrites
      : [];
    
    const rewritesText = canonicalRewrites.map(r => `${r.from || ''} → ${r.to || ''}`).join('\n');
    
    return `
      <div style="margin-top:20px; padding:16px; background:#0b1220; border:1px solid #1e3a5f; border-radius:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:18px;">🧹</span>
            <label style="color:#8b5cf6; font-size:14px; font-weight:600;">Speech Preprocessing</label>
            <span style="font-size:10px; background:#4c1d95; color:#c4b5fd; padding:2px 6px; border-radius:4px;">V4</span>
          </div>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="a2-preprocessing-enabled" ${enabled ? 'checked' : ''} 
              style="width:16px; height:16px; cursor:pointer;"/>
            <span style="color:#94a3b8; font-size:12px;">Enabled</span>
          </label>
        </div>
        
        <p style="color:#6b7280; font-size:11px; margin-bottom:12px;">
          Cleans caller input BEFORE trigger card matching. Removes noise for more accurate matching. <strong>Cleaned text is never spoken</strong> — only used internally.
        </p>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:10px;">
            <label style="display:block; color:#cbd5e1; font-size:11px; margin-bottom:6px;">Filler Words to Strip</label>
            <textarea id="a2-preprocessing-fillers" rows="2"
              style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; resize:vertical; font-size:11px;"
              placeholder="uh, um, like, you know, basically">${this.escapeHtml(fillerWords.join(', '))}</textarea>
            <div style="color:#64748b; font-size:10px; margin-top:4px;">Comma-separated. Added to built-in defaults (uh, um, like, you know, etc.)</div>
          </div>
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:10px;">
            <label style="display:block; color:#cbd5e1; font-size:11px; margin-bottom:6px;">Ignore Phrases (Complete Removal)</label>
            <textarea id="a2-preprocessing-ignore" rows="2"
              style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; resize:vertical; font-size:11px;"
              placeholder="my name is, long time customer, first time caller">${this.escapeHtml(ignorePhrases.join(', '))}</textarea>
            <div style="color:#64748b; font-size:10px; margin-top:4px;">Comma-separated. These phrases are completely removed.</div>
          </div>
        </div>
        
        <div style="margin-top:12px; padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:10px;">
          <label style="display:block; color:#cbd5e1; font-size:11px; margin-bottom:6px;">Canonical Rewrites (one per line: from → to)</label>
          <textarea id="a2-preprocessing-rewrites" rows="3"
            style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; resize:vertical; font-size:11px; font-family:monospace;"
            placeholder="air condition → ac&#10;not cooling → ac not cooling&#10;thermostat blank → thermostat blank">${this.escapeHtml(rewritesText)}</textarea>
          <div style="color:#64748b; font-size:10px; margin-top:4px;">Normalizes variations to canonical forms for better matching. Format: "from → to" (one per line)</div>
        </div>
        
        <div style="margin-top:12px; padding:10px; background:#1e1b4b; border:1px solid #4338ca; border-radius:8px;">
          <p style="color:#a5b4fc; font-size:10px; margin:0;">
            <strong>Important:</strong> Preprocessing improves trigger card accuracy. Cleaned text is <strong>never spoken</strong> to callers — only used for internal matching. Raw transcript is always preserved in Call Review.
          </p>
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // V4: GLOBAL NEGATIVE KEYWORDS SECTION
  // ──────────────────────────────────────────────────────────────────────────
  _renderGlobalNegativeKeywordsSection() {
    const globalNegativeKeywords = Array.isArray(this.agent2Config?.globalNegativeKeywords)
      ? this.agent2Config.globalNegativeKeywords
      : [];
    
    return `
      <div style="margin-top:20px; padding:16px; background:#0b1220; border:1px solid #1e3a5f; border-radius:12px;">
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:12px;">
          <span style="font-size:18px;">🚫</span>
          <label style="color:#ef4444; font-size:14px; font-weight:600;">Global Negative Keywords</label>
          <span style="font-size:10px; background:#7f1d1d; color:#fca5a5; padding:2px 6px; border-radius:4px;">V4</span>
        </div>
        
        <p style="color:#6b7280; font-size:11px; margin-bottom:12px;">
          These keywords disqualify ALL trigger cards when detected. Use for phrases that should never match any card (e.g., job seekers, spam).
        </p>
        
        <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:10px;">
          <label style="display:block; color:#cbd5e1; font-size:11px; margin-bottom:6px;">
            Global Negative Keywords (one per line)
            <span style="color:#64748b; font-size:10px;">(aiAgentSettings.agent2.globalNegativeKeywords)</span>
          </label>
          <textarea id="a2-global-negative-keywords" rows="4"
            style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; resize:vertical; font-size:11px;"
            placeholder="job application&#10;resume&#10;career&#10;employment">${this.escapeHtml(globalNegativeKeywords.join('\n'))}</textarea>
          <div style="color:#64748b; font-size:10px; margin-top:4px;">
            If any of these phrases appear in caller input, no trigger cards will match. Per-card negative keywords are separate.
          </div>
        </div>
      </div>
    `;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // V4: LLM FALLBACK SETTINGS SECTION
  // ──────────────────────────────────────────────────────────────────────────
  _renderLLMFallbackSection() {
    const llmFallback = this.config?.discovery?.llmFallback || {};
    const enabled = llmFallback.enabled === true;
    const mode = llmFallback.mode || 'assist_only';
    const maxTurnsPerCall = llmFallback.maxTurnsPerCall || 2;
    const blockedIfTriggerMatched = llmFallback.blockedIfTriggerMatched !== false;
    const blockedIfPendingQuestion = llmFallback.blockedIfPendingQuestion !== false;
    const forbidBookingTimes = llmFallback.forbidBookingTimes !== false;
    
    return `
      <div style="margin-top:20px; padding:16px; background:#0b1220; border:1px solid ${enabled ? '#f59e0b' : '#1e3a5f'}; border-radius:12px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <div style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:18px;">🤖</span>
            <label style="color:#fbbf24; font-size:14px; font-weight:600;">LLM Fallback Settings</label>
            <span style="font-size:10px; background:#78350f; color:#fcd34d; padding:2px 6px; border-radius:4px;">V4</span>
          </div>
          <label style="display:flex; align-items:center; gap:8px; cursor:pointer;">
            <input type="checkbox" id="a2-llmfallback-enabled" ${enabled ? 'checked' : ''} 
              style="width:16px; height:16px; cursor:pointer;"/>
            <span style="color:#94a3b8; font-size:12px;">Enabled</span>
          </label>
        </div>
        
        <p style="color:#6b7280; font-size:11px; margin-bottom:12px;">
          Controls when/how LLM can assist. LLM NEVER "takes over the mic" — it can only produce Sentence 1 (empathy). Sentence 2 is ALWAYS overridden by UI's discoveryHandoff.consentQuestion.
        </p>
        
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:10px;">
            <label style="display:block; color:#cbd5e1; font-size:11px; margin-bottom:6px;">Mode</label>
            <select id="a2-llmfallback-mode"
              style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; font-size:12px;">
              <option value="disabled" ${mode === 'disabled' ? 'selected' : ''}>Disabled (deterministic only)</option>
              <option value="assist_only" ${mode === 'assist_only' ? 'selected' : ''}>Assist Only (empathy sentence)</option>
              <option value="full" ${mode === 'full' ? 'selected' : ''}>Full (not recommended)</option>
            </select>
            <div style="color:#64748b; font-size:10px; margin-top:4px;">"Assist Only" = LLM can provide empathy, but UI controls the question.</div>
          </div>
          <div style="padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:10px;">
            <label style="display:block; color:#cbd5e1; font-size:11px; margin-bottom:6px;">Max LLM Turns Per Call</label>
            <input id="a2-llmfallback-maxTurns" type="number" min="0" max="10" value="${maxTurnsPerCall}"
              style="width:100%; background:#161b22; color:#e5e7eb; border:1px solid #30363d; border-radius:8px; padding:8px; font-size:12px;"/>
            <div style="color:#64748b; font-size:10px; margin-top:4px;">Limit how many times LLM can speak in a single call.</div>
          </div>
        </div>
        
        <div style="margin-top:12px; padding:12px; background:#0d1117; border:1px solid #30363d; border-radius:10px;">
          <label style="display:block; color:#cbd5e1; font-size:11px; margin-bottom:8px;">LLM is Blocked When:</label>
          <div style="display:flex; flex-wrap:wrap; gap:12px;">
            <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
              <input type="checkbox" id="a2-llmfallback-blockedTrigger" ${blockedIfTriggerMatched ? 'checked' : ''} 
                style="width:14px; height:14px;"/>
              <span style="color:#94a3b8; font-size:11px;">Trigger card matched</span>
            </label>
            <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
              <input type="checkbox" id="a2-llmfallback-blockedPending" ${blockedIfPendingQuestion ? 'checked' : ''} 
                style="width:14px; height:14px;"/>
              <span style="color:#94a3b8; font-size:11px;">Pending question active</span>
            </label>
            <label style="display:flex; align-items:center; gap:6px; cursor:pointer;">
              <input type="checkbox" id="a2-llmfallback-forbidTimes" ${forbidBookingTimes ? 'checked' : ''} 
                style="width:14px; height:14px;"/>
              <span style="color:#94a3b8; font-size:11px;">Forbid booking times</span>
            </label>
          </div>
        </div>
        
        <div style="margin-top:12px; padding:10px; background:#052e16; border:1px solid #166534; border-radius:8px;">
          <div style="display:flex; align-items:center; gap:6px;">
            <span style="color:#86efac; font-size:12px;">✓</span>
            <span style="color:#86efac; font-size:11px; font-weight:500;">LLM Cannot Steer Booking</span>
          </div>
          <p style="color:#6ee7b7; font-size:10px; margin-top:4px;">
            Final combined output is always validated. LLM sentence is overridden by UI's discoveryHandoff.consentQuestion. Caller stays informed + in control.
          </p>
        </div>
      </div>
    `;
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
    container.querySelector('#a2-tab-llmFallback')?.addEventListener('click', () => {
      if (this._activeTab !== 'llmFallback') {
        this._activeTab = 'llmFallback';
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
    // LLM FALLBACK TAB HANDLERS
    // ══════════════════════════════════════════════════════════════════════════

    // Master switch
    container.querySelector('#a2-llm-enabled')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.enabled = e.target.checked;
      onAnyChange();
      this.render(container);
    });

    // Model selection
    container.querySelector('#a2-llm-provider')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.provider = e.target.value;
      onAnyChange();
    });
    container.querySelector('#a2-llm-model')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.model = e.target.value;
      onAnyChange();
      this.render(container);
    });
    container.querySelector('#a2-llm-custom-model')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.customModelOverride = e.target.value.trim();
      onAnyChange();
    });

    // Trigger rules
    container.querySelector('#a2-llm-trigger-nomatch')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.triggers = this.config.llmFallback.triggers || {};
      this.config.llmFallback.triggers.enableOnNoTriggerCardMatch = e.target.checked;
      onAnyChange();
    });
    container.querySelector('#a2-llm-trigger-complex')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.triggers = this.config.llmFallback.triggers || {};
      this.config.llmFallback.triggers.enableOnComplexQuestions = e.target.checked;
      onAnyChange();
    });
    container.querySelector('#a2-llm-blocked-booking')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.triggers = this.config.llmFallback.triggers || {};
      this.config.llmFallback.triggers.blockedWhileBooking = e.target.checked;
      onAnyChange();
      this.render(container);
    });
    container.querySelector('#a2-llm-nomatch-threshold')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.triggers = this.config.llmFallback.triggers || {};
      this.config.llmFallback.triggers.noMatchCountThreshold = parseInt(e.target.value, 10) || 2;
      onAnyChange();
    });
    container.querySelector('#a2-llm-complexity-threshold')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.triggers = this.config.llmFallback.triggers || {};
      this.config.llmFallback.triggers.complexityThreshold = parseFloat(e.target.value) || 0.65;
      onAnyChange();
    });
    container.querySelector('#a2-llm-complex-keywords')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.triggers = this.config.llmFallback.triggers || {};
      this.config.llmFallback.triggers.complexQuestionKeywords = e.target.value.split(',').map(w => w.trim()).filter(Boolean);
      onAnyChange();
    });

    // Output constraints
    container.querySelector('#a2-llm-max-sentences')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.constraints = this.config.llmFallback.constraints || {};
      this.config.llmFallback.constraints.maxSentences = parseInt(e.target.value, 10) || 2;
      onAnyChange();
    });
    container.querySelector('#a2-llm-max-tokens')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.constraints = this.config.llmFallback.constraints || {};
      this.config.llmFallback.constraints.maxOutputTokens = parseInt(e.target.value, 10) || 160;
      onAnyChange();
    });
    container.querySelector('#a2-llm-temperature')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.constraints = this.config.llmFallback.constraints || {};
      this.config.llmFallback.constraints.temperature = parseFloat(e.target.value) || 0.2;
      onAnyChange();
    });
    container.querySelector('#a2-llm-must-funnel')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.constraints = this.config.llmFallback.constraints || {};
      this.config.llmFallback.constraints.mustEndWithFunnelQuestion = e.target.checked;
      onAnyChange();
    });

    // Allowed tasks
    container.querySelector('#a2-llm-task-clarify')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.constraints = this.config.llmFallback.constraints || {};
      this.config.llmFallback.constraints.allowedTasks = this.config.llmFallback.constraints.allowedTasks || {};
      this.config.llmFallback.constraints.allowedTasks.clarifyProblem = e.target.checked;
      onAnyChange();
    });
    container.querySelector('#a2-llm-task-guidance')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.constraints = this.config.llmFallback.constraints || {};
      this.config.llmFallback.constraints.allowedTasks = this.config.llmFallback.constraints.allowedTasks || {};
      this.config.llmFallback.constraints.allowedTasks.basicSafeGuidance = e.target.checked;
      onAnyChange();
    });
    container.querySelector('#a2-llm-task-pricing')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.constraints = this.config.llmFallback.constraints || {};
      this.config.llmFallback.constraints.allowedTasks = this.config.llmFallback.constraints.allowedTasks || {};
      this.config.llmFallback.constraints.allowedTasks.pricing = e.target.checked;
      onAnyChange();
    });
    container.querySelector('#a2-llm-task-guarantees')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.constraints = this.config.llmFallback.constraints || {};
      this.config.llmFallback.constraints.allowedTasks = this.config.llmFallback.constraints.allowedTasks || {};
      this.config.llmFallback.constraints.allowedTasks.guarantees = e.target.checked;
      onAnyChange();
    });
    container.querySelector('#a2-llm-task-legal')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.constraints = this.config.llmFallback.constraints || {};
      this.config.llmFallback.constraints.allowedTasks = this.config.llmFallback.constraints.allowedTasks || {};
      this.config.llmFallback.constraints.allowedTasks.legal = e.target.checked;
      onAnyChange();
    });
    container.querySelector('#a2-llm-task-deescalation')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.constraints = this.config.llmFallback.constraints || {};
      this.config.llmFallback.constraints.allowedTasks = this.config.llmFallback.constraints.allowedTasks || {};
      this.config.llmFallback.constraints.allowedTasks.deescalation = e.target.checked;
      onAnyChange();
    });

    // New trigger settings
    container.querySelector('#a2-llm-blocked-discovery-critical')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.triggers = this.config.llmFallback.triggers || {};
      this.config.llmFallback.triggers.blockedWhileDiscoveryCriticalStep = e.target.checked;
      onAnyChange();
    });
    container.querySelector('#a2-llm-max-turns')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.triggers = this.config.llmFallback.triggers || {};
      this.config.llmFallback.triggers.maxLLMFallbackTurnsPerCall = parseInt(e.target.value, 10) || 1;
      onAnyChange();
    });

    // New constraint settings
    container.querySelector('#a2-llm-block-time-slots')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.constraints = this.config.llmFallback.constraints || {};
      this.config.llmFallback.constraints.blockTimeSlots = e.target.checked;
      onAnyChange();
    });
    container.querySelector('#a2-llm-anti-parrot')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.constraints = this.config.llmFallback.constraints || {};
      this.config.llmFallback.constraints.antiParrotGuard = e.target.checked;
      onAnyChange();
      this.render(container);
    });
    container.querySelector('#a2-llm-anti-parrot-words')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.constraints = this.config.llmFallback.constraints || {};
      this.config.llmFallback.constraints.antiParrotMaxWords = parseInt(e.target.value, 10) || 8;
      onAnyChange();
    });

    // Handoff mode
    container.querySelectorAll('input[name="a2-llm-handoff-mode"]').forEach(radio => {
      radio.addEventListener('change', (e) => {
        this.config.llmFallback = this.config.llmFallback || {};
        this.config.llmFallback.handoff = this.config.llmFallback.handoff || {};
        this.config.llmFallback.handoff.mode = e.target.value;
        onAnyChange();
        this.render(container);
      });
    });
    
    // Handoff scripts - Confirm Service
    container.querySelector('#a2-llm-handoff-confirm-question')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.handoff = this.config.llmFallback.handoff || {};
      this.config.llmFallback.handoff.confirmService = this.config.llmFallback.handoff.confirmService || {};
      this.config.llmFallback.handoff.confirmService.question = e.target.value;
      onAnyChange();
    });
    container.querySelector('#a2-llm-handoff-confirm-yes')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.handoff = this.config.llmFallback.handoff || {};
      this.config.llmFallback.handoff.confirmService = this.config.llmFallback.handoff.confirmService || {};
      this.config.llmFallback.handoff.confirmService.yesResponse = e.target.value;
      onAnyChange();
    });
    container.querySelector('#a2-llm-handoff-confirm-no')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.handoff = this.config.llmFallback.handoff || {};
      this.config.llmFallback.handoff.confirmService = this.config.llmFallback.handoff.confirmService || {};
      this.config.llmFallback.handoff.confirmService.noResponse = e.target.value;
      onAnyChange();
    });
    
    // Handoff scripts - Take Message
    container.querySelector('#a2-llm-handoff-message-question')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.handoff = this.config.llmFallback.handoff || {};
      this.config.llmFallback.handoff.takeMessage = this.config.llmFallback.handoff.takeMessage || {};
      this.config.llmFallback.handoff.takeMessage.question = e.target.value;
      onAnyChange();
    });
    container.querySelector('#a2-llm-handoff-message-yes')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.handoff = this.config.llmFallback.handoff || {};
      this.config.llmFallback.handoff.takeMessage = this.config.llmFallback.handoff.takeMessage || {};
      this.config.llmFallback.handoff.takeMessage.yesResponse = e.target.value;
      onAnyChange();
    });
    container.querySelector('#a2-llm-handoff-message-no')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.handoff = this.config.llmFallback.handoff || {};
      this.config.llmFallback.handoff.takeMessage = this.config.llmFallback.handoff.takeMessage || {};
      this.config.llmFallback.handoff.takeMessage.noResponse = e.target.value;
      onAnyChange();
    });
    
    // Handoff scripts - Offer Forward
    container.querySelector('#a2-llm-handoff-forward-question')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.handoff = this.config.llmFallback.handoff || {};
      this.config.llmFallback.handoff.offerForward = this.config.llmFallback.handoff.offerForward || {};
      this.config.llmFallback.handoff.offerForward.question = e.target.value;
      onAnyChange();
    });
    container.querySelector('#a2-llm-handoff-forward-yes')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.handoff = this.config.llmFallback.handoff || {};
      this.config.llmFallback.handoff.offerForward = this.config.llmFallback.handoff.offerForward || {};
      this.config.llmFallback.handoff.offerForward.yesResponse = e.target.value;
      onAnyChange();
    });
    container.querySelector('#a2-llm-handoff-forward-no')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.handoff = this.config.llmFallback.handoff || {};
      this.config.llmFallback.handoff.offerForward = this.config.llmFallback.handoff.offerForward || {};
      this.config.llmFallback.handoff.offerForward.noResponse = e.target.value;
      onAnyChange();
    });

    // Call forwarding
    container.querySelector('#a2-llm-fwd-enabled')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.callForwarding = this.config.llmFallback.callForwarding || {};
      this.config.llmFallback.callForwarding.enabled = e.target.checked;
      // Also update offer forward enabled
      this.config.llmFallback.handoff = this.config.llmFallback.handoff || {};
      this.config.llmFallback.handoff.offerForward = this.config.llmFallback.handoff.offerForward || {};
      this.config.llmFallback.handoff.offerForward.enabled = e.target.checked;
      onAnyChange();
      this.render(container);
    });
    container.querySelector('#a2-llm-fwd-when')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.callForwarding = this.config.llmFallback.callForwarding || {};
      this.config.llmFallback.callForwarding.whenAllowed = e.target.value;
      onAnyChange();
      this.render(container);
    });
    container.querySelector('#a2-llm-fwd-start')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.callForwarding = this.config.llmFallback.callForwarding || {};
      this.config.llmFallback.callForwarding.businessHours = this.config.llmFallback.callForwarding.businessHours || {};
      this.config.llmFallback.callForwarding.businessHours.start = e.target.value;
      onAnyChange();
    });
    container.querySelector('#a2-llm-fwd-end')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.callForwarding = this.config.llmFallback.callForwarding || {};
      this.config.llmFallback.callForwarding.businessHours = this.config.llmFallback.callForwarding.businessHours || {};
      this.config.llmFallback.callForwarding.businessHours.end = e.target.value;
      onAnyChange();
    });
    container.querySelector('#a2-llm-fwd-tz')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.callForwarding = this.config.llmFallback.callForwarding || {};
      this.config.llmFallback.callForwarding.businessHours = this.config.llmFallback.callForwarding.businessHours || {};
      this.config.llmFallback.callForwarding.businessHours.timezone = e.target.value;
      onAnyChange();
    });
    container.querySelector('#a2-llm-fwd-consent')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.callForwarding = this.config.llmFallback.callForwarding || {};
      this.config.llmFallback.callForwarding.consentScript = e.target.value;
      onAnyChange();
    });
    container.querySelector('#a2-llm-fwd-failure')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.callForwarding = this.config.llmFallback.callForwarding || {};
      this.config.llmFallback.callForwarding.failureScript = e.target.value;
      onAnyChange();
    });
    
    // Forward numbers management
    container.querySelector('#a2-llm-fwd-add-number')?.addEventListener('click', () => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.callForwarding = this.config.llmFallback.callForwarding || {};
      this.config.llmFallback.callForwarding.numbers = this.config.llmFallback.callForwarding.numbers || [];
      this.config.llmFallback.callForwarding.numbers.push({ label: '', number: '', priority: 1 });
      onAnyChange();
      this.render(container);
    });
    container.querySelectorAll('[data-remove-fwd]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const idx = parseInt(e.target.dataset.removeFwd, 10);
        if (this.config.llmFallback?.callForwarding?.numbers) {
          this.config.llmFallback.callForwarding.numbers.splice(idx, 1);
          onAnyChange();
          this.render(container);
        }
      });
    });
    container.querySelectorAll('[data-fwd-idx]').forEach(input => {
      input.addEventListener('input', (e) => {
        const idx = parseInt(e.target.dataset.fwdIdx, 10);
        const field = e.target.dataset.fwdField;
        if (this.config.llmFallback?.callForwarding?.numbers?.[idx]) {
          this.config.llmFallback.callForwarding.numbers[idx][field] = e.target.value;
          onAnyChange();
        }
      });
    });

    // Intro line prompt
    container.querySelector('#a2-llm-prompt-intro')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.prompts = this.config.llmFallback.prompts || {};
      this.config.llmFallback.prompts.introLine = e.target.value;
      onAnyChange();
    });

    // Prompts
    container.querySelector('#a2-llm-prompt-system')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.prompts = this.config.llmFallback.prompts || {};
      this.config.llmFallback.prompts.system = e.target.value;
      onAnyChange();
    });
    container.querySelector('#a2-llm-prompt-format')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.prompts = this.config.llmFallback.prompts || {};
      this.config.llmFallback.prompts.format = e.target.value;
      onAnyChange();
    });
    container.querySelector('#a2-llm-prompt-safety')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.prompts = this.config.llmFallback.prompts || {};
      this.config.llmFallback.prompts.safety = e.target.value;
      onAnyChange();
    });

    // Emergency fallback
    container.querySelector('#a2-llm-emergency-enabled')?.addEventListener('change', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.emergencyFallbackLine = this.config.llmFallback.emergencyFallbackLine || {};
      this.config.llmFallback.emergencyFallbackLine.enabled = e.target.checked;
      onAnyChange();
    });
    container.querySelector('#a2-llm-emergency-text')?.addEventListener('input', (e) => {
      this.config.llmFallback = this.config.llmFallback || {};
      this.config.llmFallback.emergencyFallbackLine = this.config.llmFallback.emergencyFallbackLine || {};
      this.config.llmFallback.emergencyFallbackLine.text = e.target.value;
      onAnyChange();
    });

    // Usage dashboard refresh
    container.querySelector('#a2-llm-refresh-usage')?.addEventListener('click', () => {
      this.loadLLMUsageStats(true);
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
      // Show/hide play button based on URL
      const playBtn = container.querySelector('#a2-callstart-play');
      if (playBtn) {
        playBtn.style.display = e.target.value.trim() ? '' : 'none';
        playBtn.setAttribute('data-audio-url', e.target.value.trim());
      }
    });
    container.querySelector('#a2-callstart-play')?.addEventListener('click', () => {
      const url = container.querySelector('#a2-callstart-audioUrl')?.value?.trim();
      if (url) this._playGreetingAudio(url, 'a2-callstart-play');
    });
    container.querySelector('#a2-callstart-generate')?.addEventListener('click', () => {
      this._generateCallStartAudio();
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

    // PRIMARY EXPORT: Complete Runtime Wiring Report
    container.querySelector('#a2-export-json')?.addEventListener('click', async () => {
      try {
        const report = await this._generateCompleteRuntimeWiringReport();
        const payload = JSON.stringify(report, null, 2);
        
        // Download as file
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `complete-wiring-report-${this.companyId}-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        // Also copy to clipboard
        await navigator.clipboard.writeText(payload);
        
        // Show completion status
        const status = report.manifest.completeness.status;
        const failedChecks = report.manifest.completeness.failedChecks || [];
        
        if (status === 'PASS') {
          alert('✅ COMPLETE WIRING REPORT downloaded!\n\nCompleteness: PASS\n\nIncludes:\n- Agent 2.0 config + UI/Persisted diff\n- Runtime dependencies (Connection Recovery, DTMF)\n- Execution model (who speaks first)\n- Audio reachability verification\n- Conflict detection\n- Call Review evidence');
        } else {
          alert(`⚠️ COMPLETE WIRING REPORT downloaded!\n\nCompleteness: FAIL\n\nFailed checks:\n${failedChecks.slice(0, 5).map(c => '• ' + c).join('\n')}${failedChecks.length > 5 ? `\n... and ${failedChecks.length - 5} more` : ''}\n\nReview the JSON for details.`);
        }
      } catch (e) {
        console.error('Export failed:', e);
        alert(`Export failed: ${e.message || e}`);
      }
    });
    
    // SECONDARY EXPORT: Agent2 Only (Dev/Debug)
    container.querySelector('#a2-export-agent2-only')?.addEventListener('click', async () => {
      try {
        const report = await this._generateAgent2OnlyExport();
        const payload = JSON.stringify(report, null, 2);
        
        const blob = new Blob([payload], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `agent2-only-${this.companyId}-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        await navigator.clipboard.writeText(payload);
        alert('✅ Agent2-only export downloaded (dev/debug mode)');
      } catch (e) {
        console.error('Export failed:', e);
        alert(`Export failed: ${e.message || e}`);
      }
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
    // V126: Pending question responses + Emergency fallback line
    container.querySelectorAll('#a2-fallback-pendingYesResponse, #a2-fallback-pendingNoResponse, #a2-fallback-pendingReprompt')
      .forEach((el) => el?.addEventListener('input', onAnyChange));
    container.querySelector('#a2-emergency-fallback')?.addEventListener('input', onAnyChange);

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

    // Wire up audio buttons in modal
    document.getElementById('a2-greeting-modal-play')?.addEventListener('click', () => {
      const url = document.getElementById('a2-greeting-modal-audioUrl')?.value?.trim();
      if (url) this._playGreetingAudio(url, 'a2-greeting-modal-play');
    });
    document.getElementById('a2-greeting-modal-generate')?.addEventListener('click', () => {
      this._generateGreetingRuleAudio();
    });
    document.getElementById('a2-greeting-modal-audioUrl')?.addEventListener('input', (e) => {
      const playBtn = document.getElementById('a2-greeting-modal-play');
      if (playBtn) {
        playBtn.style.display = e.target.value.trim() ? '' : 'none';
        playBtn.setAttribute('data-audio-url', e.target.value.trim());
      }
    });
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
  // GREETING AUDIO GENERATION & PLAYBACK
  // ══════════════════════════════════════════════════════════════════════════
  _greetingAudio = null;

  _playGreetingAudio(url, btnId) {
    if (!url) return;

    // Stop any currently playing audio
    if (this._greetingAudio) {
      this._greetingAudio.pause();
      this._greetingAudio = null;
    }

    const playBtn = document.getElementById(btnId);
    if (playBtn) playBtn.textContent = '⏹ Stop';

    const audio = new Audio(url);
    this._greetingAudio = audio;

    audio.addEventListener('ended', () => {
      this._greetingAudio = null;
      if (playBtn) playBtn.textContent = '▶ Play';
    });

    audio.addEventListener('error', () => {
      this._greetingAudio = null;
      if (playBtn) playBtn.textContent = '▶ Play';
      alert('Failed to play audio. Check the URL.');
    });

    audio.play().catch(err => {
      console.error('Audio play failed:', err);
      this._greetingAudio = null;
      if (playBtn) playBtn.textContent = '▶ Play';
    });
  }

  async _generateCallStartAudio() {
    const generateBtn = document.getElementById('a2-callstart-generate');
    const statusEl = document.getElementById('a2-callstart-audio-status');
    const textEl = document.getElementById('a2-callstart-text');
    const audioUrlEl = document.getElementById('a2-callstart-audioUrl');
    const playBtn = document.getElementById('a2-callstart-play');
    const text = (textEl?.value || '').trim();

    if (!text) {
      alert('Enter greeting text first');
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
          kind: 'CONNECTION_GREETING',
          text,
          force: true
        })
      });

      const json = await res.json();

      if (json.success && json.url) {
        if (statusEl) {
          statusEl.innerHTML = `<span style="color:#7ee787;">Audio generated! Click Save to keep it.</span>`;
        }
        if (generateBtn) {
          generateBtn.textContent = 'Regenerate';
          generateBtn.disabled = false;
        }
        if (audioUrlEl) {
          audioUrlEl.value = json.url;
        }
        if (playBtn) {
          playBtn.style.display = '';
          playBtn.setAttribute('data-audio-url', json.url);
        }
        // Update config
        this.config.greetings = this.config.greetings || {};
        this.config.greetings.callStart = this.config.greetings.callStart || {};
        this.config.greetings.callStart.audioUrl = json.url;
        this._setDirty(true);
        
        // Auto-save after audio generation
        try {
          await this.save();
          if (statusEl) {
            statusEl.innerHTML = `<span style="color:#7ee787;">Audio generated and saved!</span>`;
          }
        } catch (saveErr) {
          console.error('Auto-save failed:', saveErr);
          if (statusEl) {
            statusEl.innerHTML = `<span style="color:#7ee787;">Audio generated!</span> <span style="color:#f59e0b;">Click Save to keep it.</span>`;
          }
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

  async _generateGreetingRuleAudio() {
    const generateBtn = document.getElementById('a2-greeting-modal-generate');
    const statusEl = document.getElementById('a2-greeting-modal-audio-status');
    const textEl = document.getElementById('a2-greeting-modal-responseText');
    const audioUrlEl = document.getElementById('a2-greeting-modal-audioUrl');
    const playBtn = document.getElementById('a2-greeting-modal-play');
    const text = (textEl?.value || '').trim();

    if (!text) {
      alert('Enter response text first');
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
          kind: 'GREETING_RULE',
          text,
          force: true
        })
      });

      const json = await res.json();

      if (json.success && json.url) {
        if (statusEl) {
          statusEl.innerHTML = `<span style="color:#7ee787;">Audio generated! Click Save to apply.</span>`;
        }
        if (generateBtn) {
          generateBtn.textContent = 'Regenerate';
          generateBtn.disabled = false;
        }
        if (audioUrlEl) {
          audioUrlEl.value = json.url;
        }
        if (playBtn) {
          playBtn.style.display = '';
          playBtn.setAttribute('data-audio-url', json.url);
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
    // V126: Pending question responses - UI-configured, not hardcoded
    discovery.playbook.fallback.pendingYesResponse = (container.querySelector('#a2-fallback-pendingYesResponse')?.value || '').trim();
    discovery.playbook.fallback.pendingNoResponse = (container.querySelector('#a2-fallback-pendingNoResponse')?.value || '').trim();
    discovery.playbook.fallback.pendingReprompt = (container.querySelector('#a2-fallback-pendingReprompt')?.value || '').trim();

    // ═══════════════════════════════════════════════════════════════════════
    // V4: HUMAN TONE (UI-owned empathy templates)
    // NO DEFAULTS - empty arrays if not configured (No-UI-No-Speak)
    // ═══════════════════════════════════════════════════════════════════════
    discovery.humanTone = discovery.humanTone || {};
    discovery.humanTone.enabled = container.querySelector('#a2-humantone-enabled')?.checked ?? true;
    discovery.humanTone.templates = discovery.humanTone.templates || {};
    
    const serviceDownLine = (container.querySelector('#a2-humantone-serviceDown')?.value || '').trim();
    const angryLine = (container.querySelector('#a2-humantone-angry')?.value || '').trim();
    const generalLine = (container.querySelector('#a2-humantone-general')?.value || '').trim();
    
    // NO DEFAULTS - if not configured, array stays empty (enforces UI requirement)
    discovery.humanTone.templates.serviceDown = serviceDownLine ? [serviceDownLine] : [];
    discovery.humanTone.templates.angry = angryLine ? [angryLine] : [];
    discovery.humanTone.templates.general = generalLine ? [generalLine] : [];

    // ═══════════════════════════════════════════════════════════════════════
    // V4: INTENT PRIORITY GATE
    // ═══════════════════════════════════════════════════════════════════════
    discovery.intentGate = discovery.intentGate || {};
    discovery.intentGate.enabled = container.querySelector('#a2-intentgate-enabled')?.checked ?? true;
    discovery.intentGate.emergencyFullDisqualify = container.querySelector('#a2-intentgate-emergencyDisqualify')?.checked ?? true;
    discovery.intentGate.basePenalty = 50;
    
    const categoriesRaw = (container.querySelector('#a2-intentgate-categories')?.value || '').trim();
    discovery.intentGate.disqualifiedCategories = categoriesRaw 
      ? categoriesRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : ['faq', 'info', 'sales', 'financing', 'warranty', 'maintenance_plan', 'system_age', 'lifespan', 'replacement', 'upgrade', 'new_system', 'general'];

    // ═══════════════════════════════════════════════════════════════════════
    // V4: DISCOVERY HANDOFF (UI-owned consent question)
    // NO DEFAULT - empty string if not configured (No-UI-No-Speak)
    // ═══════════════════════════════════════════════════════════════════════
    discovery.discoveryHandoff = discovery.discoveryHandoff || {};
    discovery.discoveryHandoff.enabled = true;
    discovery.discoveryHandoff.consentQuestion = (container.querySelector('#a2-discoveryhandoff-consentQuestion')?.value || '').trim();
    // NO DEFAULT for consentQuestion - must be configured in UI
    discovery.discoveryHandoff.forbidBookingTimes = container.querySelector('#a2-discoveryhandoff-forbidTimes')?.checked ?? true;
    discovery.discoveryHandoff.yesNext = 'BOOKING_LANE';
    discovery.discoveryHandoff.noNext = 'MESSAGE_TAKING';

    // ═══════════════════════════════════════════════════════════════════════
    // V4: CALL REASON CAPTURE (uses default sanitizer settings)
    // ═══════════════════════════════════════════════════════════════════════
    discovery.callReasonCapture = discovery.callReasonCapture || {};
    discovery.callReasonCapture.enabled = true;
    discovery.callReasonCapture.mode = 'summary_label';
    discovery.callReasonCapture.maxWords = 6;
    discovery.callReasonCapture.stripLeadingPunctuation = true;
    discovery.callReasonCapture.stripGreetingPhrases = true;
    discovery.callReasonCapture.stripNamePhrases = true;
    discovery.callReasonCapture.stripFillerWords = true;

    // ═══════════════════════════════════════════════════════════════════════
    // V4: SPEECH PREPROCESSING (clean input BEFORE matching)
    // ═══════════════════════════════════════════════════════════════════════
    discovery.preprocessing = discovery.preprocessing || {};
    discovery.preprocessing.enabled = container.querySelector('#a2-preprocessing-enabled')?.checked ?? true;
    
    // Filler words (comma-separated)
    const fillersRaw = (container.querySelector('#a2-preprocessing-fillers')?.value || '').trim();
    discovery.preprocessing.fillerWords = fillersRaw 
      ? fillersRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : [];
    
    // Ignore phrases (comma-separated)
    const ignoreRaw = (container.querySelector('#a2-preprocessing-ignore')?.value || '').trim();
    discovery.preprocessing.ignorePhrases = ignoreRaw
      ? ignoreRaw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
      : [];
    
    // Canonical rewrites (one per line: from → to)
    const rewritesRaw = (container.querySelector('#a2-preprocessing-rewrites')?.value || '').trim();
    discovery.preprocessing.canonicalRewrites = rewritesRaw
      ? rewritesRaw.split('\n')
          .map(line => {
            const parts = line.split('→').map(s => s.trim());
            if (parts.length === 2 && parts[0] && parts[1]) {
              return { from: parts[0].toLowerCase(), to: parts[1].toLowerCase() };
            }
            return null;
          })
          .filter(Boolean)
      : [];

    // ═══════════════════════════════════════════════════════════════════════
    // V4: LLM FALLBACK SETTINGS
    // ═══════════════════════════════════════════════════════════════════════
    discovery.llmFallback = discovery.llmFallback || {};
    discovery.llmFallback.enabled = container.querySelector('#a2-llmfallback-enabled')?.checked ?? false;
    discovery.llmFallback.mode = container.querySelector('#a2-llmfallback-mode')?.value || 'assist_only';
    discovery.llmFallback.onlyWhenAllElseFails = true;
    discovery.llmFallback.maxTurnsPerCall = Number(container.querySelector('#a2-llmfallback-maxTurns')?.value) || 2;
    discovery.llmFallback.blockedIfTriggerMatched = container.querySelector('#a2-llmfallback-blockedTrigger')?.checked ?? true;
    discovery.llmFallback.blockedIfPendingQuestion = container.querySelector('#a2-llmfallback-blockedPending')?.checked ?? true;
    discovery.llmFallback.blockedIfCapturedReasonFlow = true;
    discovery.llmFallback.blockedIfBookingLocked = true;
    discovery.llmFallback.forbidBookingTimes = container.querySelector('#a2-llmfallback-forbidTimes')?.checked ?? true;

    cfg.discovery = discovery;
    
    // ═══════════════════════════════════════════════════════════════════════
    // V4: GLOBAL NEGATIVE KEYWORDS (at agent2 root level)
    // ═══════════════════════════════════════════════════════════════════════
    const globalNegRaw = (container.querySelector('#a2-global-negative-keywords')?.value || '').trim();
    cfg.globalNegativeKeywords = globalNegRaw
      ? globalNegRaw.split('\n').map(s => s.trim().toLowerCase()).filter(Boolean)
      : [];
    
    // V126: Emergency Fallback Line - REQUIRED for No-UI-No-Speak Guard
    cfg.emergencyFallbackLine = cfg.emergencyFallbackLine || {};
    cfg.emergencyFallbackLine.text = (container.querySelector('#a2-emergency-fallback')?.value || '').trim();
    cfg.emergencyFallbackLine.enabled = true;
    
    // Preserve greetings config (managed by Greetings tab event handlers)
    cfg.greetings = cfg.greetings || {};
    
    cfg.meta = cfg.meta || {};
    cfg.meta.uiBuild = Agent2Manager.UI_BUILD;
    this.config = cfg;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // UI REGISTRY - Prevents ghost settings (all Agent2 panels must register)
  // ══════════════════════════════════════════════════════════════════════════
  static UI_REGISTRY = {
    tabs: ['config', 'greetings', 'callReview'],
    panels: {
      config: [
        'agent2Master',
        'discoveryMaster', 
        'discoveryStyle',
        'vocabularySystem',
        'clarifierSystem',
        'playbook',
        'triggerCards',
        'fallbackResponses',
        'emergencyFallbackLine', // V4: Last resort (required)
        'humanTone',             // V4: UI-owned empathy templates
        'intentPriorityGate',    // V4: FAQ hijack prevention
        'discoveryHandoff',      // V4: UI-owned consent question
        'callReasonCapture',     // V4: Reason sanitization
        'normalization'          // V4: Filler/greeting strip
      ],
      greetings: [
        'callStartGreeting',
        'greetingInterceptor',
        'intentWordBlocking'
      ],
      callReview: [
        'callList',
        'callDetail'
      ]
    },
    runtimeDependencies: [
      'agent2',
      'frontDeskBehavior.connectionQualityGate',
      'frontDeskBehavior.recoveryMessages',
      'frontDeskBehavior.conversationStages.greetingRules',
      'instantResponses',
      'afterHoursSettings',
      'transferSettings',
      'voicemailSettings'
    ]
  };

  // ══════════════════════════════════════════════════════════════════════════
  // COMPLETE RUNTIME WIRING REPORT (Primary Export)
  // ══════════════════════════════════════════════════════════════════════════
  /**
   * Generates the COMPLETE runtime wiring report including:
   * - Agent 2.0 config (all tabs)
   * - Runtime dependencies (connection recovery, DTMF fallback, greeting rules)
   * - UI snapshot vs Persisted snapshot + Diff
   * - UI coverage manifest with FAIL detection
   * - Audio reachability verification
   * - Conflict detection between speech sources
   * - Call Review evidence (last 10 calls + coverage summary)
   * 
   * PRIME DIRECTIVE: If it's not in the UI, it does not exist.
   * Any spoken line must be UI-mapped, or it's a FAIL.
   */
  async _generateCompleteRuntimeWiringReport() {
    const timestamp = new Date().toISOString();
    const failedChecks = [];
    const missingSections = [];
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: Capture UI Snapshot (current form state, even if unsaved)
    // ═══════════════════════════════════════════════════════════════════════
    this._readFormIntoConfig(this._container);
    const uiSnapshot = JSON.parse(JSON.stringify(this.config || this.getDefaultConfig()));
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: Fetch Persisted Snapshot (fresh GET from backend)
    // ═══════════════════════════════════════════════════════════════════════
    let persistedSnapshot = null;
    let frontDeskConfig = null;
    let persistedFetchError = null;
    
    try {
      const token = this._getToken();
      
      // Fetch Agent2 persisted config
      const agent2Res = await fetch(`/api/admin/agent2/${this.companyId}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (agent2Res.ok) {
        const agent2Json = await agent2Res.json();
        persistedSnapshot = agent2Json?.data || null;
      }
      
      // Fetch FrontDesk config (connection recovery, DTMF, greeting rules)
      const fdRes = await fetch(`/api/company/${this.companyId}/front-desk-config`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (fdRes.ok) {
        const fdJson = await fdRes.json();
        frontDeskConfig = fdJson?.data || fdJson || null;
      }
    } catch (err) {
      persistedFetchError = err.message;
      failedChecks.push(`PERSISTED_FETCH_FAILED: ${err.message}`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: Calculate Diff (UI vs Persisted)
    // ═══════════════════════════════════════════════════════════════════════
    const diff = this._calculateConfigDiff(uiSnapshot, persistedSnapshot);
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: UI Coverage Manifest
    // ═══════════════════════════════════════════════════════════════════════
    const uiCoverage = {
      registeredTabs: Agent2Manager.UI_REGISTRY.tabs,
      registeredPanels: Agent2Manager.UI_REGISTRY.panels,
      exportedSections: [],
      missingFromExport: [],
      status: 'PASS'
    };
    
    // Check what we're actually exporting
    const exportedSections = ['agent2Master', 'discoveryMaster', 'discoveryStyle', 
      'vocabularySystem', 'clarifierSystem', 'playbook', 'triggerCards', 'fallbackResponses',
      'callStartGreeting', 'greetingInterceptor', 'intentWordBlocking', 'callList'];
    uiCoverage.exportedSections = exportedSections;
    
    // Find any registered panels not in export
    const allRegisteredPanels = Object.values(Agent2Manager.UI_REGISTRY.panels).flat();
    const missingPanels = allRegisteredPanels.filter(p => !exportedSections.includes(p));
    if (missingPanels.length > 0) {
      uiCoverage.missingFromExport = missingPanels;
      uiCoverage.status = 'FAIL';
      failedChecks.push(`UI_COVERAGE_INCOMPLETE: Missing panels: ${missingPanels.join(', ')}`);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: Runtime Dependencies (Connection Recovery, DTMF, etc.)
    // ═══════════════════════════════════════════════════════════════════════
    const runtimeDependencies = {
      _description: 'Config surfaces outside Agent 2.0 that can override/interrupt calls',
      
      connectionQualityGate: {
        uiPath: 'aiAgentSettings.frontDeskBehavior.connectionQualityGate',
        canOverrideAgent2: true,
        executesAt: 'S1.5 (before Agent2 greeting)',
        config: frontDeskConfig?.connectionQualityGate || null,
        _extracted: {
          enabled: frontDeskConfig?.connectionQualityGate?.enabled ?? true,
          clarificationPrompt: frontDeskConfig?.connectionQualityGate?.clarificationPrompt || 
                              frontDeskConfig?.connectionQualityGate?.reGreeting || 
                              "I'm sorry, I didn't quite catch that. Could you please repeat what you said?",
          dtmfEscapeMessage: frontDeskConfig?.connectionQualityGate?.dtmfEscapeMessage || 
                            "I'm sorry, we seem to have a bad connection. Press 1 to speak with a service advisor, or press 2 to leave a voicemail.",
          transferDestination: frontDeskConfig?.connectionQualityGate?.transferDestination || '',
          maxRetries: frontDeskConfig?.connectionQualityGate?.maxRetries || 3
        }
      },
      
      connectionRecoveryMessages: {
        uiPath: 'aiAgentSettings.frontDeskBehavior.recoveryMessages',
        canOverrideAgent2: true,
        executesAt: 'Any turn (on STT failure/unclear audio)',
        config: frontDeskConfig?.recoveryMessages || null,
        _extracted: {
          audioUnclear: frontDeskConfig?.recoveryMessages?.audioUnclear || [],
          connectionCutOut: frontDeskConfig?.recoveryMessages?.connectionCutOut || [],
          silenceRecovery: frontDeskConfig?.recoveryMessages?.silenceRecovery || [],
          generalError: frontDeskConfig?.recoveryMessages?.generalError || [],
          technicalTransfer: frontDeskConfig?.recoveryMessages?.technicalTransfer || []
        }
      },
      
      legacyGreetingRules: {
        uiPath: 'aiAgentSettings.frontDeskBehavior.conversationStages.greetingRules',
        canOverrideAgent2: false,
        executesAt: 'Only when Agent2 greetings disabled',
        note: 'These are bypassed when Agent 2.0 is enabled',
        config: frontDeskConfig?.conversationStages?.greetingRules || [],
        count: (frontDeskConfig?.conversationStages?.greetingRules || []).length
      },
      
      instantResponses: {
        uiPath: 'aiAgentSettings.instantResponses',
        canOverrideAgent2: true,
        executesAt: 'Before discovery (instant match layer)',
        config: frontDeskConfig?.instantResponses || [],
        _extracted: {
          total: (frontDeskConfig?.instantResponses || []).length,
          enabled: (frontDeskConfig?.instantResponses || []).filter(r => r.enabled !== false).length,
          greetingCategory: (frontDeskConfig?.instantResponses || []).filter(r => r.category === 'greeting').length
        }
      },
      
      // V126: After-hours routing (can override all Agent2 behavior)
      afterHoursSettings: {
        uiPath: 'aiAgentSettings.afterHoursSettings',
        canOverrideAgent2: true,
        executesAt: 'Call start (before any greeting)',
        config: frontDeskConfig?.afterHoursSettings || null,
        _extracted: {
          enabled: frontDeskConfig?.afterHoursSettings?.enabled ?? false,
          action: frontDeskConfig?.afterHoursSettings?.action || 'voicemail',
          message: frontDeskConfig?.afterHoursSettings?.message || '',
          forwardNumber: frontDeskConfig?.afterHoursSettings?.forwardNumber || ''
        }
      },
      
      // V126: Transfer settings (who gets transferred where)
      transferSettings: {
        uiPath: 'aiAgentSettings.transferSettings',
        canOverrideAgent2: true,
        executesAt: 'On escalation/transfer decision',
        config: frontDeskConfig?.transferSettings || null,
        _extracted: {
          enabled: frontDeskConfig?.transferSettings?.enabled ?? true,
          transferNumber: frontDeskConfig?.transferSettings?.transferNumber || '',
          transferMessage: frontDeskConfig?.transferSettings?.transferMessage || "I'm connecting you to our team.",
          voicemailEnabled: frontDeskConfig?.voicemailSettings?.enabled ?? false,
          voicemailNumber: frontDeskConfig?.voicemailSettings?.voicemailNumber || ''
        }
      },
      
      // V126: Voicemail settings
      voicemailSettings: {
        uiPath: 'aiAgentSettings.voicemailSettings',
        canOverrideAgent2: false,
        executesAt: 'On transfer to voicemail decision',
        config: frontDeskConfig?.voicemailSettings || null,
        _extracted: {
          enabled: frontDeskConfig?.voicemailSettings?.enabled ?? false,
          greeting: frontDeskConfig?.voicemailSettings?.voicemailGreeting || ''
        }
      }
    };
    
    // Check for required runtime dependencies
    if (!frontDeskConfig) {
      missingSections.push('frontDeskBehavior');
      failedChecks.push('RUNTIME_DEPENDENCY_MISSING: Could not fetch frontDeskBehavior config');
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: Execution Model (Who Can Speak + Priority Order)
    // ═══════════════════════════════════════════════════════════════════════
    const config = uiSnapshot;
    const executionModel = {
      _description: 'Deterministic order of speech sources - first match wins',
      speechSources: [
        {
          sourceId: 'catastrophicFallback.dtmfMenu',
          uiPath: 'aiAgentSettings.frontDeskBehavior.connectionQualityGate.dtmfEscapeMessage',
          priority: 1,
          canOverride: ['*'],
          triggerCondition: 'maxRetries exceeded on connection quality issues',
          enabled: runtimeDependencies.connectionQualityGate._extracted.enabled,
          textPreview: runtimeDependencies.connectionQualityGate._extracted.dtmfEscapeMessage?.substring(0, 80)
        },
        {
          sourceId: 'connectionQualityGate.clarification',
          uiPath: 'aiAgentSettings.frontDeskBehavior.connectionQualityGate.clarificationPrompt',
          priority: 2,
          canOverride: ['agent2.greetings', 'agent2.discovery'],
          triggerCondition: 'STT confidence below threshold OR trouble phrases detected',
          enabled: runtimeDependencies.connectionQualityGate._extracted.enabled,
          textPreview: runtimeDependencies.connectionQualityGate._extracted.clarificationPrompt?.substring(0, 80)
        },
        {
          sourceId: 'connectionRecovery.audioUnclear',
          uiPath: 'aiAgentSettings.frontDeskBehavior.recoveryMessages.audioUnclear',
          priority: 3,
          canOverride: ['agent2.discovery'],
          triggerCondition: 'Audio quality issues detected mid-call',
          enabled: true,
          textPreview: (runtimeDependencies.connectionRecoveryMessages._extracted.audioUnclear[0] || '').substring(0, 80)
        },
        {
          sourceId: 'agent2.greetings.callStart',
          uiPath: 'aiAgentSettings.agent2.greetings.callStart',
          priority: 10,
          canOverride: [],
          triggerCondition: 'Turn 0 (call start) when Agent2 enabled',
          enabled: config.enabled && config.greetings?.callStart?.enabled,
          textPreview: (config.greetings?.callStart?.text || '').substring(0, 80),
          audioUrl: config.greetings?.callStart?.audioUrl || null
        },
        {
          sourceId: 'agent2.greetings.interceptor',
          uiPath: 'aiAgentSettings.agent2.greetings.interceptor.rules',
          priority: 11,
          canOverride: [],
          triggerCondition: 'Caller says short greeting (hi/hello) when Agent2 enabled',
          enabled: config.enabled && config.greetings?.interceptor?.enabled,
          rulesCount: (config.greetings?.interceptor?.rules || []).length
        },
        {
          sourceId: 'agent2.discovery.triggerCards',
          uiPath: 'aiAgentSettings.agent2.discovery.playbook.rules',
          priority: 20,
          canOverride: [],
          triggerCondition: 'Caller input matches trigger card keywords/phrases',
          enabled: config.enabled && config.discovery?.enabled,
          cardsCount: (config.discovery?.playbook?.rules || []).filter(r => r.enabled !== false).length
        },
        {
          sourceId: 'agent2.discovery.fallback',
          uiPath: 'aiAgentSettings.agent2.discovery.playbook.fallback',
          priority: 30,
          canOverride: [],
          triggerCondition: 'No trigger card match, no scenario match',
          enabled: config.enabled && config.discovery?.enabled,
          textPreview: (config.discovery?.playbook?.fallback?.noMatchAnswer || '').substring(0, 80)
        },
        {
          sourceId: 'legacy.greetingRules',
          uiPath: 'aiAgentSettings.frontDeskBehavior.conversationStages.greetingRules',
          priority: 100,
          canOverride: [],
          triggerCondition: 'Only when Agent2 greetings DISABLED',
          enabled: !(config.enabled && config.greetings?.interceptor?.enabled),
          rulesCount: runtimeDependencies.legacyGreetingRules.count
        },
        // V126: After-hours (highest priority - overrides everything)
        {
          sourceId: 'afterHours.routing',
          uiPath: 'aiAgentSettings.afterHoursSettings',
          priority: 0,
          canOverride: ['*'],
          triggerCondition: 'Outside business hours (per schedule)',
          enabled: runtimeDependencies.afterHoursSettings._extracted.enabled,
          action: runtimeDependencies.afterHoursSettings._extracted.action,
          textPreview: (runtimeDependencies.afterHoursSettings._extracted.message || '').substring(0, 80)
        },
        // V126: Transfer/Escalation
        {
          sourceId: 'transfer.humanAgent',
          uiPath: 'aiAgentSettings.transferSettings',
          priority: 50,
          canOverride: [],
          triggerCondition: 'Escalation requested OR trigger card with transfer action',
          enabled: runtimeDependencies.transferSettings._extracted.enabled,
          transferNumber: runtimeDependencies.transferSettings._extracted.transferNumber ? '✓ Configured' : '✗ Missing',
          textPreview: (runtimeDependencies.transferSettings._extracted.transferMessage || '').substring(0, 80)
        },
        // V126: Voicemail fallback
        {
          sourceId: 'voicemail.fallback',
          uiPath: 'aiAgentSettings.voicemailSettings',
          priority: 60,
          canOverride: [],
          triggerCondition: 'Transfer unavailable OR DTMF option 2 selected',
          enabled: runtimeDependencies.voicemailSettings._extracted.enabled,
          textPreview: (runtimeDependencies.voicemailSettings._extracted.greeting || '').substring(0, 80)
        }
      ]
    };
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 7: Audio Assets + Reachability Verification
    // ═══════════════════════════════════════════════════════════════════════
    const audioAssets = {
      _description: 'All configured audio URLs with reachability status (Twilio perspective)',
      overallStatus: 'CHECKING',
      assets: [],
      unreachableCount: 0,
      totalCount: 0,
      verificationMethod: 'Client-side fetch (HEAD request with 5s timeout)',
      note: 'If an audio file is UNREACHABLE, Twilio will timeout and the call may fail or use TTS fallback'
    };
    
    // Collect all audio URLs
    const allAudioUrls = [];
    
    // Agent2 call start greeting
    if (config.greetings?.callStart?.audioUrl) {
      allAudioUrls.push({
        sourceId: 'agent2.greetings.callStart',
        uiPath: 'Agent 2.0 > Greetings > Call Start Greeting',
        url: config.greetings.callStart.audioUrl,
        fallbackText: config.greetings?.callStart?.text || '[no fallback text]'
      });
    }
    
    // Agent2 greeting interceptor rules
    (config.greetings?.interceptor?.rules || []).forEach((rule, idx) => {
      if (rule.audioUrl) {
        allAudioUrls.push({
          sourceId: `agent2.greetings.interceptor.rules[${idx}]`,
          uiPath: `Agent 2.0 > Greetings > Interceptor Rule: ${rule.id || idx}`,
          url: rule.audioUrl,
          fallbackText: rule.responseText || '[no fallback text]'
        });
      }
    });
    
    // Agent2 trigger cards
    (config.discovery?.playbook?.rules || []).forEach((rule, idx) => {
      if (rule.answer?.audioUrl) {
        allAudioUrls.push({
          sourceId: `agent2.discovery.triggerCard[${idx}]`,
          uiPath: `Agent 2.0 > Configuration > Trigger Card: ${rule.label || rule.id || idx}`,
          url: rule.answer.audioUrl,
          fallbackText: rule.answer?.answerText || '[no fallback text]'
        });
      }
    });
    
    // Verify reachability for each audio URL (Twilio perspective)
    for (const asset of allAudioUrls) {
      let reachable = false;
      let error = null;
      let httpStatus = null;
      let contentType = null;
      let contentLength = null;
      let latencyMs = null;
      
      // Resolve to absolute URL (what Twilio would see)
      let absoluteUrl = asset.url;
      if (asset.url && !asset.url.startsWith('http')) {
        // Relative URL - resolve to absolute
        absoluteUrl = new URL(asset.url, window.location.origin).href;
      }
      
      const startTime = performance.now();
      
      try {
        // Use HEAD request with timeout to check reachability (same as Twilio would do)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout like Twilio
        
        const response = await fetch(absoluteUrl, { 
          method: 'HEAD', 
          signal: controller.signal,
          cache: 'no-store' // Don't use browser cache - Twilio won't have it
        });
        clearTimeout(timeoutId);
        
        latencyMs = Math.round(performance.now() - startTime);
        httpStatus = response.status;
        contentType = response.headers.get('content-type');
        contentLength = response.headers.get('content-length');
        
        // Check if it's actually audio
        const isAudio = contentType && (
          contentType.includes('audio/') || 
          contentType.includes('mpeg') || 
          contentType.includes('wav') ||
          contentType.includes('ogg')
        );
        
        reachable = response.ok && isAudio;
        if (!reachable) {
          if (!response.ok) {
            error = `HTTP ${response.status}`;
          } else if (!isAudio) {
            error = `Not audio: ${contentType || 'unknown type'}`;
          }
        }
      } catch (err) {
        latencyMs = Math.round(performance.now() - startTime);
        reachable = false;
        error = err.name === 'AbortError' ? 'TIMEOUT (>8s)' : err.message;
      }
      
      audioAssets.assets.push({
        ...asset,
        absoluteUrlResolved: absoluteUrl,
        status: reachable ? 'OK' : 'MISSING',
        reachable,
        httpStatus,
        contentType,
        bytes: contentLength ? parseInt(contentLength) : null,
        latencyMs,
        error,
        lastChecked: timestamp,
        fallbackBehavior: reachable ? 'N/A' : 'TTS with fallback text',
        hasFallbackText: !!(asset.fallbackText && asset.fallbackText !== '[no fallback text]'),
        twilioNote: reachable ? 'Twilio can fetch this URL' : 'Twilio may fail to fetch - will fall back to TTS'
      });
      
      if (!reachable) {
        audioAssets.unreachableCount++;
        // If no fallback text, this is CRITICAL - call will fail
        const severity = asset.fallbackText && asset.fallbackText !== '[no fallback text]' ? 'WARNING' : 'CRITICAL';
        failedChecks.push(`AUDIO_${severity}: ${asset.sourceId} - ${absoluteUrl} (${error}, ${latencyMs}ms)${severity === 'CRITICAL' ? ' - NO FALLBACK TEXT' : ''}`);
      }
    }
    
    // Update overall status
    audioAssets.totalCount = allAudioUrls.length;
    audioAssets.overallStatus = audioAssets.unreachableCount === 0 ? 'OK' : 
      (audioAssets.unreachableCount === audioAssets.totalCount ? 'CRITICAL' : 'PARTIAL');
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 8: Conflict Detection
    // ═══════════════════════════════════════════════════════════════════════
    const conflicts = [];
    
    // Check: Connection Quality Gate can override Agent2 Call Start
    if (runtimeDependencies.connectionQualityGate._extracted.enabled && 
        config.enabled && config.greetings?.callStart?.enabled) {
      conflicts.push({
        type: 'GREETING_SOURCE_COMPETITION',
        severity: 'WARNING',
        sources: ['connectionQualityGate.clarification', 'agent2.greetings.callStart'],
        description: 'Connection Quality Gate can speak BEFORE Agent 2.0 Call Start greeting on turn 0 if STT confidence is low',
        recommendation: 'Review if this is intended behavior. The gate\'s clarification prompt may fire instead of your configured greeting.',
        affectedPaths: [
          'aiAgentSettings.frontDeskBehavior.connectionQualityGate.clarificationPrompt',
          'aiAgentSettings.agent2.greetings.callStart.text'
        ]
      });
    }
    
    // Check: Vocabulary enabled entries but system disabled
    const vocabEntries = config.discovery?.vocabulary?.entries || [];
    const enabledVocabEntries = vocabEntries.filter(e => e.enabled);
    if (!config.discovery?.vocabulary?.enabled && enabledVocabEntries.length > 0) {
      conflicts.push({
        type: 'DISABLED_PARENT_WITH_ENABLED_CHILDREN',
        severity: 'WARNING',
        sources: ['agent2.discovery.vocabulary'],
        description: `Vocabulary system is DISABLED but has ${enabledVocabEntries.length} enabled entries that will NEVER run`,
        recommendation: 'Either enable the vocabulary system or remove the entries to avoid confusion',
        affectedPaths: ['aiAgentSettings.agent2.discovery.vocabulary.enabled']
      });
    }
    
    // Check: Clarifiers enabled entries but system disabled
    const clarifierEntries = config.discovery?.clarifiers?.entries || [];
    const enabledClarifierEntries = clarifierEntries.filter(e => e.enabled);
    if (!config.discovery?.clarifiers?.enabled && enabledClarifierEntries.length > 0) {
      conflicts.push({
        type: 'DISABLED_PARENT_WITH_ENABLED_CHILDREN',
        severity: 'WARNING',
        sources: ['agent2.discovery.clarifiers'],
        description: `Clarifier system is DISABLED but has ${enabledClarifierEntries.length} enabled entries that will NEVER run`,
        recommendation: 'Either enable the clarifier system or remove the entries to avoid confusion',
        affectedPaths: ['aiAgentSettings.agent2.discovery.clarifiers.enabled']
      });
    }
    
    // Check: DTMF fallback enabled but no transfer destination
    if (runtimeDependencies.connectionQualityGate._extracted.enabled && 
        !runtimeDependencies.connectionQualityGate._extracted.transferDestination) {
      conflicts.push({
        type: 'INCOMPLETE_FALLBACK_CONFIG',
        severity: 'CRITICAL',
        sources: ['connectionQualityGate.dtmfMenu'],
        description: 'DTMF escape menu is enabled but no transfer destination configured for Press 1',
        recommendation: 'Configure a phone number for transferDestination or disable the connection quality gate',
        affectedPaths: ['aiAgentSettings.frontDeskBehavior.connectionQualityGate.transferDestination']
      });
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 9: Call Review Evidence (Last 10 calls)
    // ═══════════════════════════════════════════════════════════════════════
    let callReviewEvidence = {
      _description: 'Evidence from Call Review showing actual runtime decisions',
      status: 'unavailable',
      sampleSize: 0,
      calls: [],
      coverageSummary: {},
      fetchError: null
    };
    
    try {
      const token = this._getToken();
      const callsRes = await fetch(`/api/admin/agent2/calls/${this.companyId}?limit=10`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      
      if (callsRes.ok) {
        const callsJson = await callsRes.json();
        const calls = callsJson?.data || [];
        
        if (calls.length > 0) {
          callReviewEvidence.status = 'available';
          callReviewEvidence.sampleSize = calls.length;
          
          // Summarize each call
          callReviewEvidence.calls = calls.map(call => ({
            callSid: call.callSid,
            timestamp: call.startTime,
            duration: call.duration,
            status: call.status,
            primaryIntent: call.primaryIntent,
            bookingCompleted: call.bookingCompleted,
            flags: call.flags || {}
          }));
          
          // Calculate coverage summary
          callReviewEvidence.coverageSummary = {
            totalCalls: calls.length,
            bookingCompleted: calls.filter(c => c.bookingCompleted).length,
            withFlags: calls.filter(c => Object.keys(c.flags || {}).length > 0).length
          };
        } else {
          callReviewEvidence.status = 'no_calls';
          failedChecks.push('EVIDENCE_UNAVAILABLE: No calls found in Call Review');
        }
      }
    } catch (err) {
      callReviewEvidence.fetchError = err.message;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 10: Agent2 Configuration (Full Detail)
    // ═══════════════════════════════════════════════════════════════════════
    const agent2Config = {
      enabled: config.enabled || false,
      
      discovery: {
        enabled: config.discovery?.enabled || false,
        style: config.discovery?.style || {},
        vocabulary: {
          enabled: config.discovery?.vocabulary?.enabled || false,
          entries: config.discovery?.vocabulary?.entries || [],
          _stats: {
            total: vocabEntries.length,
            enabled: enabledVocabEntries.length,
            hardNormalize: vocabEntries.filter(e => e.type === 'HARD_NORMALIZE').length,
            softHint: vocabEntries.filter(e => e.type === 'SOFT_HINT').length
          }
        },
        clarifiers: {
          enabled: config.discovery?.clarifiers?.enabled || false,
          maxAsksPerCall: config.discovery?.clarifiers?.maxAsksPerCall || 2,
          entries: config.discovery?.clarifiers?.entries || [],
          _stats: {
            total: clarifierEntries.length,
            enabled: enabledClarifierEntries.length
          }
        },
        playbook: {
          version: config.discovery?.playbook?.version || 'v1',
          useScenarioFallback: config.discovery?.playbook?.useScenarioFallback || false,
          allowedScenarioTypes: config.discovery?.playbook?.allowedScenarioTypes || [],
          minScenarioScore: config.discovery?.playbook?.minScenarioScore || 0.72,
          fallback: config.discovery?.playbook?.fallback || {},
          rules: config.discovery?.playbook?.rules || [],
          _stats: {
            total: (config.discovery?.playbook?.rules || []).length,
            enabled: (config.discovery?.playbook?.rules || []).filter(r => r.enabled !== false).length
          }
        },
        updatedAt: config.discovery?.updatedAt || null
      },
      
      greetings: {
        callStart: config.greetings?.callStart || {},
        interceptor: config.greetings?.interceptor || {}
      },
      
      meta: config.meta || {}
    };
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 11: Validation (Comprehensive)
    // ═══════════════════════════════════════════════════════════════════════
    const validation = {
      criticalIssues: [],
      warnings: [],
      recommendations: [],
      checks: {}
    };
    
    // Critical checks
    if (config.enabled && !config.discovery?.enabled) {
      validation.criticalIssues.push('Agent 2.0 is enabled but Discovery is DISABLED - no discovery flow will run');
    }
    
    if (audioAssets.unreachableCount > 0) {
      validation.criticalIssues.push(`${audioAssets.unreachableCount} audio file(s) are UNREACHABLE - will fallback to TTS`);
    }
    
    // Add conflicts as critical/warning based on severity
    conflicts.forEach(c => {
      if (c.severity === 'CRITICAL') {
        validation.criticalIssues.push(c.description);
      } else {
        validation.warnings.push(c.description);
      }
    });
    
    // Warnings
    if (!config.enabled) {
      validation.warnings.push('Agent 2.0 is DISABLED - legacy system is active');
    }
    
    if (config.enabled && (config.discovery?.playbook?.rules || []).length === 0) {
      validation.warnings.push('No trigger cards configured - agent will only use fallback responses');
    }
    
    if (config.enabled && !config.greetings?.callStart?.text && !config.greetings?.callStart?.audioUrl) {
      validation.warnings.push('Call start greeting is empty - connection quality gate may speak first');
    }
    
    // Recommendations
    if (!config.discovery?.vocabulary?.enabled) {
      validation.recommendations.push('Enable Vocabulary System to normalize common STT mishears');
    }
    
    if (!config.discovery?.clarifiers?.enabled) {
      validation.recommendations.push('Enable Clarifiers to disambiguate vague phrases');
    }
    
    // Checks object
    validation.checks = {
      agent2Enabled: config.enabled === true,
      discoveryEnabled: config.discovery?.enabled === true,
      greetingsConfigured: !!(config.greetings?.callStart?.text || config.greetings?.callStart?.audioUrl),
      hasTriggerCards: (config.discovery?.playbook?.rules || []).length > 0,
      hasEnabledTriggerCards: (config.discovery?.playbook?.rules || []).filter(r => r.enabled !== false).length > 0,
      vocabularyEnabled: config.discovery?.vocabulary?.enabled === true,
      clarifiersEnabled: config.discovery?.clarifiers?.enabled === true,
      allAudioReachable: audioAssets.unreachableCount === 0,
      noConflicts: conflicts.filter(c => c.severity === 'CRITICAL').length === 0,
      evidenceAvailable: callReviewEvidence.status === 'available'
    };
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 12: Runtime Fallback Audit (Hidden Text Disclosure)
    // ═══════════════════════════════════════════════════════════════════════
    // PRIME DIRECTIVE: Any spoken line must be UI-mapped.
    // These are hardcoded fallbacks that may speak when config is missing.
    // They exist for robustness but are NOT UI-controlled.
    // Look for SPEECH_SOURCE_SELECTED events with hasUiPath: false
    validation.runtimeFallbackAudit = {
      _description: 'Hardcoded fallback responses that may fire when UI-configured values are missing',
      knownFallbacks: [
        { source: 'connectionQualityGate.clarification', fallbackText: "I'm sorry, I didn't quite catch that. Could you please repeat what you said?", uiPath: 'frontDeskBehavior.connectionQualityGate.clarificationPrompt' },
        { source: 'connectionQualityGate.dtmfEscape', fallbackText: "I'm sorry, we seem to have a bad connection. Press 1 to speak with a service advisor, or press 2 to leave a voicemail.", uiPath: 'frontDeskBehavior.connectionQualityGate.dtmfEscapeMessage' },
        { source: 'agent2.discovery.fallback.noMatchAnswer', fallbackText: "How can I help you today?", uiPath: 'agent2.discovery.playbook.fallback.noMatchAnswer' },
        { source: 'agent2.discovery.fallback.noMatchWhenReasonCaptured', fallbackText: "I'm sorry to hear that.", uiPath: 'agent2.discovery.playbook.fallback.noMatchWhenReasonCaptured' },
        { source: 'agent2.greetings.interceptor.rules[].responseText', fallbackText: "Hi! How can I help you?", uiPath: 'agent2.greetings.interceptor.rules[].responseText' },
        { source: 'agent2.greetings.callStart.text', fallbackText: "Thank you for calling. How can I help you today?", uiPath: 'agent2.greetings.callStart.text' }
      ],
      howToVerify: 'In Call Review, look for SPEECH_SOURCE_SELECTED events with hasUiPath: false - these indicate a hardcoded fallback was used instead of UI-configured text.'
    };
    
    // ═══════════════════════════════════════════════════════════════════════
    // FINAL: Assemble Complete Report
    // ═══════════════════════════════════════════════════════════════════════
    const completenessStatus = failedChecks.length === 0 ? 'PASS' : 'FAIL';
    
    return {
      manifest: {
        reportType: 'COMPLETE_RUNTIME_WIRING_REPORT',
        title: 'Complete Runtime Wiring Report (Agent 2.0 + Dependencies)',
        companyId: this.companyId,
        uiBuild: Agent2Manager.UI_BUILD,
        generatedAt: timestamp,
        schemaVersion: '2.0.0',
        completeness: {
          status: completenessStatus,
          failedChecks,
          missingSections
        },
        primeDirective: 'If it is not in the UI, it does not exist. Any spoken line must be UI-mapped.'
      },
      
      uiCoverage,
      
      configSnapshots: {
        uiSnapshot,
        persistedSnapshot,
        diff,
        isDirty: this.isDirty,
        diffSummary: {
          hasChanges: diff.hasChanges,
          changedPaths: diff.changedPaths || [],
          addedPaths: diff.addedPaths || [],
          removedPaths: diff.removedPaths || []
        }
      },
      
      executionModel,
      
      agent2Config,
      
      runtimeDependencies,
      
      audioAssets,
      
      conflicts,
      
      callReviewEvidence,
      
      validation,
      
      runtimeFallbackAudit: validation.runtimeFallbackAudit
    };
  }
  
  /**
   * Calculate diff between UI snapshot and persisted snapshot
   */
  _calculateConfigDiff(uiSnapshot, persistedSnapshot) {
    if (!persistedSnapshot) {
      return { hasChanges: true, error: 'No persisted snapshot available', changedPaths: [], addedPaths: [], removedPaths: [] };
    }
    
    const changedPaths = [];
    const addedPaths = [];
    const removedPaths = [];
    
    // Deep compare helper
    const compareObjects = (ui, persisted, path = '') => {
      if (ui === persisted) return;
      
      if (typeof ui !== typeof persisted) {
        changedPaths.push({ path, ui, persisted });
        return;
      }
      
      if (typeof ui !== 'object' || ui === null || persisted === null) {
        if (ui !== persisted) {
          changedPaths.push({ path, ui, persisted });
        }
        return;
      }
      
      if (Array.isArray(ui) !== Array.isArray(persisted)) {
        changedPaths.push({ path, ui, persisted });
        return;
      }
      
      if (Array.isArray(ui)) {
        if (ui.length !== persisted.length) {
          changedPaths.push({ path, ui: `[${ui.length} items]`, persisted: `[${persisted.length} items]` });
        }
        return;
      }
      
      const uiKeys = Object.keys(ui);
      const persistedKeys = Object.keys(persisted);
      
      // Check for added keys
      uiKeys.forEach(key => {
        if (!persistedKeys.includes(key)) {
          addedPaths.push(`${path}.${key}`);
        }
      });
      
      // Check for removed keys
      persistedKeys.forEach(key => {
        if (!uiKeys.includes(key)) {
          removedPaths.push(`${path}.${key}`);
        }
      });
      
      // Recurse on common keys
      uiKeys.filter(k => persistedKeys.includes(k)).forEach(key => {
        compareObjects(ui[key], persisted[key], path ? `${path}.${key}` : key);
      });
    };
    
    try {
      compareObjects(uiSnapshot, persistedSnapshot);
    } catch (err) {
      return { hasChanges: true, error: err.message, changedPaths, addedPaths, removedPaths };
    }
    
    return {
      hasChanges: changedPaths.length > 0 || addedPaths.length > 0 || removedPaths.length > 0,
      changedPaths,
      addedPaths,
      removedPaths
    };
  }
  
  /**
   * Agent2-only export (for dev/debugging)
   */
  async _generateAgent2OnlyExport() {
    const timestamp = new Date().toISOString();
    this._readFormIntoConfig(this._container);
    const config = this.config || this.getDefaultConfig();
    
    // Fetch persisted for diff
    let persistedSnapshot = null;
    try {
      const token = this._getToken();
      const res = await fetch(`/api/admin/agent2/${this.companyId}`, {
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
      });
      if (res.ok) {
        const json = await res.json();
        persistedSnapshot = json?.data || null;
      }
    } catch (err) {
      // Ignore
    }
    
    const diff = this._calculateConfigDiff(config, persistedSnapshot);
    
    return {
      manifest: {
        reportType: 'AGENT2_ONLY_EXPORT',
        title: 'Agent 2.0 Configuration Export (Dev/Debug)',
        companyId: this.companyId,
        uiBuild: Agent2Manager.UI_BUILD,
        generatedAt: timestamp,
        schemaVersion: '2.0.0',
        note: 'This export contains ONLY Agent 2.0 namespace. For complete runtime truth, use Complete Wiring Report.'
      },
      
      configSnapshots: {
        uiSnapshot: config,
        persistedSnapshot,
        diff,
        isDirty: this.isDirty
      },
      
      agent2Config: config
    };
  }
  
  /**
   * Helper: Group trigger cards by priority for statistics
   */
  _groupByPriority(rules) {
    const groups = {};
    for (const rule of rules) {
      const priority = rule.priority || 0;
      if (!groups[priority]) groups[priority] = 0;
      groups[priority]++;
    }
    return groups;
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
