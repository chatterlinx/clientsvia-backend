/**
 * ═══════════════════════════════════════════════════════════════════════════
 * BOOKING LOGIC MANAGER - UI Component
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * STANDALONE: No imports from Agent 2.0 or legacy systems.
 * Communication happens ONLY via JSON handoff payload.
 * 
 * CRITICAL: Uses "bookingCtx" NOT "bookingState" to avoid legacy contamination.
 * 
 * UI Sections:
 * A) Incoming Handoff Payload (JSON editor)
 * B) Derived Booking Context (read-only JSON) - bookingCtx
 * C) Next Agent Prompt (big text output)
 * D) Trace / Decisions (list)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

(function() {
  'use strict';

  class BookingLogicManager {
    constructor() {
      this.container = null;
      this.state = {
        payload: null,
        bookingCtx: null,  // NOT bookingState!
        nextPrompt: null,
        trace: [],
        latencyMs: null,
        cacheHit: null,
        error: null,
        isLoading: false,
        cacheStatus: null
      };
    }

    getAuthHeaders() {
      const token = localStorage.getItem('adminToken');
      return {
        'Content-Type': 'application/json',
        'Authorization': token ? `Bearer ${token}` : ''
      };
    }

    async init() {
      await this.loadCacheStatus();
    }

    async loadCacheStatus() {
      try {
        const res = await fetch('/api/control-plane/booking-logic/cache/status', {
          headers: this.getAuthHeaders()
        });
        const data = await res.json();
        if (data.success) {
          this.state.cacheStatus = data.data;
        }
      } catch (err) {
        console.error('[BookingLogicManager] Failed to load cache status:', err);
      }
    }

    async loadLatestPayload() {
      this.state.isLoading = true;
      this.state.error = null;
      this.render(this.container);

      try {
        const res = await fetch('/api/control-plane/booking-logic/handoff/latest', {
          headers: this.getAuthHeaders()
        });
        const data = await res.json();
        
        if (data.success && data.data.payload) {
          this.state.payload = data.data.payload;
          this.state.error = null;
        } else {
          this.state.error = data.data?.message || 'No payload found';
        }
      } catch (err) {
        this.state.error = `Failed to load: ${err.message}`;
      }

      this.state.isLoading = false;
      this.render(this.container);
    }

    async simulateFromJson(jsonText) {
      this.state.isLoading = true;
      this.state.error = null;
      this.state.bookingCtx = null;
      this.state.nextPrompt = null;
      this.state.trace = [];
      this.state.cacheHit = null;
      this.render(this.container);

      try {
        const payload = JSON.parse(jsonText);
        this.state.payload = payload;

        const res = await fetch('/api/control-plane/booking-logic/step', {
          method: 'POST',
          headers: this.getAuthHeaders(),
          body: JSON.stringify({ payload, bookingCtx: null })  // NOT bookingState!
        });

        const data = await res.json();

        if (data.success) {
          this.state.nextPrompt = data.data.nextPrompt;
          this.state.bookingCtx = data.data.bookingCtx;
          this.state.trace = data.data.trace || [];
          this.state.latencyMs = data.data.latencyMs;
          this.state.cacheHit = data.data.cacheHit;
          this.state.error = null;
        } else {
          this.state.error = data.error || 'Step computation failed';
          this.state.trace = data.trace || [];
        }
      } catch (err) {
        if (err instanceof SyntaxError) {
          this.state.error = `JSON Parse Error: ${err.message}`;
        } else {
          this.state.error = `Failed: ${err.message}`;
        }
      }

      this.state.isLoading = false;
      this.render(this.container);
    }

    clearAll() {
      this.state.payload = null;
      this.state.bookingCtx = null;
      this.state.nextPrompt = null;
      this.state.trace = [];
      this.state.latencyMs = null;
      this.state.cacheHit = null;
      this.state.error = null;
      this.render(this.container);
    }

    async invalidateCache() {
      try {
        const res = await fetch('/api/control-plane/booking-logic/cache/invalidate', {
          method: 'POST',
          headers: this.getAuthHeaders()
        });
        const data = await res.json();
        if (data.success) {
          await this.loadCacheStatus();
          this.render(this.container);
        }
      } catch (err) {
        console.error('[BookingLogicManager] Failed to invalidate cache:', err);
      }
    }

    render(container) {
      this.container = container;
      if (!container) return;

      const { payload, bookingCtx, nextPrompt, trace, latencyMs, cacheHit, error, isLoading, cacheStatus } = this.state;

      const payloadJson = payload ? JSON.stringify(payload, null, 2) : '{\n  "assumptions": {\n    "firstName": "John",\n    "lastName": "Smith"\n  }\n}';
      const bookingCtxJson = bookingCtx ? JSON.stringify(bookingCtx, null, 2) : '';

      const cacheHitDisplay = cacheHit ? 
        `FN: ${cacheHit.firstNames ? '✓ HIT' : '○ MISS'}, LN: ${cacheHit.lastNames ? '✓ HIT' : '○ MISS'}` : '';

      container.innerHTML = `
        <style>
          .bl-container {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: #e2e8f0;
            padding: 20px;
          }
          .bl-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 24px;
            padding-bottom: 16px;
            border-bottom: 1px solid #334155;
          }
          .bl-title {
            font-size: 24px;
            font-weight: 600;
            color: #f1f5f9;
            display: flex;
            align-items: center;
            gap: 12px;
          }
          .bl-title i {
            color: #60a5fa;
          }
          .bl-badge {
            background: #1e3a5f;
            color: #60a5fa;
            padding: 4px 12px;
            border-radius: 9999px;
            font-size: 12px;
            font-weight: 500;
          }
          .bl-badge-warning {
            background: #78350f;
            color: #fbbf24;
          }
          .bl-cache-status {
            display: flex;
            gap: 16px;
            font-size: 12px;
            color: #94a3b8;
            align-items: center;
          }
          .bl-cache-item {
            display: flex;
            align-items: center;
            gap: 6px;
          }
          .bl-cache-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
          }
          .bl-cache-dot.loaded { background: #22c55e; }
          .bl-cache-dot.empty { background: #f59e0b; }
          .bl-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 20px;
          }
          .bl-panel {
            background: #1e293b;
            border: 1px solid #334155;
            border-radius: 12px;
            padding: 16px;
          }
          .bl-panel-full {
            grid-column: 1 / -1;
          }
          .bl-panel-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 12px;
          }
          .bl-panel-title {
            font-size: 14px;
            font-weight: 600;
            color: #f1f5f9;
            text-transform: uppercase;
            letter-spacing: 0.5px;
          }
          .bl-btn-group {
            display: flex;
            gap: 8px;
          }
          .bl-btn {
            padding: 8px 16px;
            border-radius: 8px;
            font-size: 13px;
            font-weight: 500;
            cursor: pointer;
            border: none;
            transition: all 0.2s;
          }
          .bl-btn-primary {
            background: #3b82f6;
            color: white;
          }
          .bl-btn-primary:hover {
            background: #2563eb;
          }
          .bl-btn-secondary {
            background: #334155;
            color: #e2e8f0;
          }
          .bl-btn-secondary:hover {
            background: #475569;
          }
          .bl-btn-danger {
            background: #ef4444;
            color: white;
          }
          .bl-btn-danger:hover {
            background: #dc2626;
          }
          .bl-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
          }
          .bl-textarea {
            width: 100%;
            min-height: 200px;
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 8px;
            padding: 12px;
            font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
            font-size: 13px;
            color: #e2e8f0;
            resize: vertical;
            line-height: 1.5;
          }
          .bl-textarea:focus {
            outline: none;
            border-color: #3b82f6;
          }
          .bl-readonly {
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 8px;
            padding: 12px;
            font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
            font-size: 13px;
            color: #94a3b8;
            min-height: 150px;
            overflow: auto;
            white-space: pre-wrap;
          }
          .bl-prompt-output {
            background: linear-gradient(135deg, #1e3a5f 0%, #1e293b 100%);
            border: 2px solid #3b82f6;
            border-radius: 12px;
            padding: 20px;
            font-size: 18px;
            color: #f1f5f9;
            line-height: 1.6;
            min-height: 80px;
          }
          .bl-prompt-empty {
            color: #64748b;
            font-style: italic;
          }
          .bl-trace-list {
            background: #0f172a;
            border: 1px solid #334155;
            border-radius: 8px;
            padding: 12px;
            max-height: 300px;
            overflow-y: auto;
          }
          .bl-trace-item {
            padding: 8px 12px;
            border-radius: 6px;
            margin-bottom: 4px;
            font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
            font-size: 12px;
            color: #e2e8f0;
            background: #1e293b;
          }
          .bl-trace-item:last-child {
            margin-bottom: 0;
          }
          .bl-trace-match {
            color: #22c55e;
          }
          .bl-trace-miss {
            color: #f59e0b;
          }
          .bl-trace-reject {
            color: #ef4444;
            background: #450a0a;
          }
          .bl-error {
            background: #450a0a;
            border: 1px solid #dc2626;
            color: #fca5a5;
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 16px;
            font-size: 13px;
          }
          .bl-loading {
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 12px;
            padding: 40px;
            color: #94a3b8;
          }
          .bl-latency {
            font-size: 12px;
            color: #22c55e;
            margin-left: 12px;
          }
          .bl-cache-hit {
            font-size: 11px;
            color: #60a5fa;
            margin-left: 8px;
            font-family: monospace;
          }
          .bl-empty {
            color: #64748b;
            font-style: italic;
            text-align: center;
            padding: 20px;
          }
          .bl-warning-box {
            background: #78350f;
            border: 1px solid #fbbf24;
            color: #fef3c7;
            padding: 12px 16px;
            border-radius: 8px;
            margin-bottom: 16px;
            font-size: 13px;
          }
        </style>

        <div class="bl-container">
          <div class="bl-header">
            <div class="bl-title">
              <i class="fas fa-calendar-check"></i>
              Booking Logic
              <span class="bl-badge">STANDALONE</span>
              <span class="bl-badge bl-badge-warning">bookingCtx (not bookingState)</span>
            </div>
            <div class="bl-cache-status">
              ${cacheStatus ? `
                <div class="bl-cache-item">
                  <span class="bl-cache-dot ${cacheStatus.firstNames?.loaded ? 'loaded' : 'empty'}"></span>
                  First Names: ${cacheStatus.firstNames?.count || 0}
                </div>
                <div class="bl-cache-item">
                  <span class="bl-cache-dot ${cacheStatus.lastNames?.loaded ? 'loaded' : 'empty'}"></span>
                  Last Names: ${cacheStatus.lastNames?.count || 0}
                </div>
                <button class="bl-btn bl-btn-secondary" onclick="window.bookingLogicManager.invalidateCache()" style="padding: 4px 8px; font-size: 11px;">
                  <i class="fas fa-sync-alt"></i> Refresh Cache
                </button>
              ` : ''}
            </div>
          </div>

          <div class="bl-warning-box">
            <strong>⚠️ Contract:</strong> This module uses <code>bookingCtx</code>, NOT <code>bookingState</code>. 
            Legacy keys (slots, bookingState, flowRunner) are rejected.
          </div>

          ${error ? `<div class="bl-error"><i class="fas fa-exclamation-triangle"></i> ${this.escapeHtml(error)}</div>` : ''}

          ${isLoading ? `
            <div class="bl-loading">
              <i class="fas fa-spinner fa-spin"></i>
              Processing...
            </div>
          ` : `
            <div class="bl-grid">
              <!-- A) Incoming Handoff Payload -->
              <div class="bl-panel">
                <div class="bl-panel-header">
                  <span class="bl-panel-title">A) Incoming Handoff Payload</span>
                </div>
                <textarea 
                  id="bl-payload-input" 
                  class="bl-textarea" 
                  placeholder='{"assumptions": {"firstName": "John"}}'
                >${this.escapeHtml(payloadJson)}</textarea>
                <div class="bl-btn-group" style="margin-top: 12px;">
                  <button class="bl-btn bl-btn-secondary" onclick="window.bookingLogicManager.loadLatestPayload()">
                    <i class="fas fa-download"></i> Load Latest Payload
                  </button>
                  <button class="bl-btn bl-btn-primary" onclick="window.bookingLogicManager.simulateFromJson(document.getElementById('bl-payload-input').value)">
                    <i class="fas fa-play"></i> Simulate From JSON
                  </button>
                  <button class="bl-btn bl-btn-danger" onclick="window.bookingLogicManager.clearAll()">
                    <i class="fas fa-trash"></i> Clear
                  </button>
                </div>
              </div>

              <!-- B) Derived Booking Context (bookingCtx) -->
              <div class="bl-panel">
                <div class="bl-panel-header">
                  <span class="bl-panel-title">B) Derived Booking Context (bookingCtx)</span>
                  ${latencyMs ? `<span class="bl-latency">⚡ ${latencyMs}ms</span>` : ''}
                  ${cacheHitDisplay ? `<span class="bl-cache-hit">${cacheHitDisplay}</span>` : ''}
                </div>
                <div class="bl-readonly">${bookingCtxJson || '<span class="bl-empty">Run simulation to see bookingCtx</span>'}</div>
              </div>

              <!-- C) Next Agent Prompt -->
              <div class="bl-panel bl-panel-full">
                <div class="bl-panel-header">
                  <span class="bl-panel-title">C) Next Agent Prompt</span>
                </div>
                <div class="bl-prompt-output ${!nextPrompt ? 'bl-prompt-empty' : ''}">
                  ${nextPrompt ? `<i class="fas fa-microphone-alt" style="margin-right: 12px; color: #3b82f6;"></i>${this.escapeHtml(nextPrompt)}` : 'Run simulation to see what the agent should say next'}
                </div>
              </div>

              <!-- D) Trace / Decisions -->
              <div class="bl-panel bl-panel-full">
                <div class="bl-panel-header">
                  <span class="bl-panel-title">D) Trace / Decisions</span>
                </div>
                <div class="bl-trace-list">
                  ${trace.length > 0 ? trace.map(t => `
                    <div class="bl-trace-item ${t.includes('MATCH') ? 'bl-trace-match' : ''} ${t.includes('NO MATCH') || t.includes('not configured') ? 'bl-trace-miss' : ''} ${t.includes('REJECTED') ? 'bl-trace-reject' : ''}">
                      ${t.includes('✓') ? '<i class="fas fa-check-circle" style="color: #22c55e; margin-right: 8px;"></i>' : ''}
                      ${t.includes('✗') ? '<i class="fas fa-times-circle" style="color: #f59e0b; margin-right: 8px;"></i>' : ''}
                      ${t.includes('⚠') ? '<i class="fas fa-exclamation-triangle" style="color: #f59e0b; margin-right: 8px;"></i>' : ''}
                      ${t.includes('⛔') ? '<i class="fas fa-ban" style="color: #ef4444; margin-right: 8px;"></i>' : ''}
                      ${!t.includes('✓') && !t.includes('✗') && !t.includes('⚠') && !t.includes('⛔') ? '<i class="fas fa-info-circle" style="color: #60a5fa; margin-right: 8px;"></i>' : ''}
                      ${this.escapeHtml(t.replace(/[✓✗⚠⛔]/g, ''))}
                    </div>
                  `).join('') : '<div class="bl-empty">Run simulation to see trace</div>'}
                </div>
              </div>
            </div>
          `}
        </div>
      `;
    }

    escapeHtml(str) {
      if (!str) return '';
      return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }
  }

  // Export to global scope
  window.BookingLogicManager = BookingLogicManager;
})();
