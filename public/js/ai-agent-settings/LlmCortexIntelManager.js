/**
 * ============================================================================
 * LLM-0 CORTEX-INTEL MANAGER - RESPONSE TRACE VIEWER
 * ============================================================================
 * 
 * PURPOSE: Debug UI for viewing turn-by-turn orchestrator decisions
 * ARCHITECTURE: Loads ResponseTraceLog data from API and displays decision chain
 * USAGE: Control Plane → AiCore → LLM-0 Cortex-Intel
 * 
 * ============================================================================
 */

// Exposed entrypoint used by control-plane-v2.html
window.initLlmCortexIntelPanel = function initLlmCortexIntelPanel(companyId) {
  const container = document.getElementById('llm-cortex-intel-panel');
  if (!container) {
    console.warn('[LLM-CORTEX] Panel container not found');
    return;
  }

  container.innerHTML = `
    <div class="card">
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
        <div>
          <h2 style="margin: 0 0 6px;">LLM-0 Cortex-Intel – Response Trace</h2>
          <p class="muted" style="margin: 0;">
            Inspect how Frontline-Intel, 3-Tier Knowledge, and LLM-0 orchestrator worked together for a single call.
          </p>
        </div>
      </div>
      
      <div class="card" style="background: #f9fafb; padding: 16px; margin-bottom: 16px;">
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 12px;">
          <div>
            <label style="display: block; font-weight: 500; margin-bottom: 6px; font-size: 13px;">Call ID</label>
            <div style="display: flex; gap: 8px;">
              <input id="llm-cortex-call-id-input" class="cp-input" type="text" placeholder="Paste Call ID (CallSid)" 
                     style="flex: 1; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px;" />
              <button id="llm-cortex-load-trace-btn" class="btn btn-primary">Load Trace</button>
            </div>
          </div>
          <div>
            <label style="display: block; font-weight: 500; margin-bottom: 6px; font-size: 13px;">Recent Calls</label>
            <select id="llm-cortex-call-selector" style="width: 100%; padding: 8px 12px; border: 1px solid #d1d5db; border-radius: 6px; font-size: 13px;">
              <option value="">Loading...</option>
            </select>
          </div>
        </div>
      </div>

      <div id="llm-cortex-trace-summary" class="card" style="display: none; margin-bottom: 16px;"></div>
      <div id="llm-cortex-trace-details" class="card" style="display: none;"></div>
    </div>
  `;

  const callSelector = document.getElementById('llm-cortex-call-selector');
  const loadButton = document.getElementById('llm-cortex-load-trace-btn');
  const callIdInput = document.getElementById('llm-cortex-call-id-input');

  loadButton.addEventListener('click', () => {
    const callId = callIdInput.value.trim();
    if (!callId) {
      alert('Enter a Call ID first.');
      return;
    }
    fetchTrace(companyId, callId);
  });

  callSelector.addEventListener('change', () => {
    const callId = callSelector.value;
    if (callId) {
      callIdInput.value = callId;
      fetchTrace(companyId, callId);
    }
  });

  // Load recent calls to populate dropdown
  loadRecentCalls(companyId);
};

async function loadRecentCalls(companyId) {
  const selector = document.getElementById('llm-cortex-call-selector');
  const summary = document.getElementById('llm-cortex-trace-summary');

  selector.innerHTML = `<option value="">Loading recent calls...</option>`;

  try {
    const res = await fetch(`/api/company/${companyId}/response-traces/calls?limit=50`);
    const data = await res.json();

    if (!data.success) {
      selector.innerHTML = `<option value="">Failed to load calls</option>`;
      return;
    }

    if (!data.calls || !data.calls.length) {
      selector.innerHTML = `<option value="">No traced calls yet</option>`;
      summary.style.display = 'block';
      summary.innerHTML = `<p class="muted">Once calls start flowing through LLM-0, they will appear here.</p>`;
      return;
    }

    selector.innerHTML = `<option value="">Select a call…</option>`;
    data.calls.forEach((c) => {
      const date = c.startTime ? new Date(c.startTime).toLocaleString() : 'unknown';
      const label = `${c.callId.substring(0, 20)}...  •  ${c.totalTurns} turns  •  $${c.totalCost.toFixed(4)}  •  ${date}`;
      const opt = document.createElement('option');
      opt.value = c.callId;
      opt.textContent = label;
      selector.appendChild(opt);
    });
  } catch (err) {
    console.error('[LLM-CORTEX] Failed to load recent calls', err);
    selector.innerHTML = `<option value="">Error loading calls</option>`;
  }
}

async function fetchTrace(companyId, callId) {
  const summary = document.getElementById('llm-cortex-trace-summary');
  const details = document.getElementById('llm-cortex-trace-details');

  summary.style.display = 'block';
  summary.innerHTML = `<p class="muted">Loading trace for <code style="background: #e5e7eb; padding: 2px 6px; border-radius: 4px; font-size: 12px;">${callId}</code>…</p>`;
  details.style.display = 'none';
  details.innerHTML = '';

  try {
    const res = await fetch(
      `/api/company/${companyId}/response-traces?callId=${encodeURIComponent(callId)}`
    );
    const data = await res.json();

    if (!data.success) {
      summary.innerHTML = `<p style="color: #dc2626;">Failed to load trace: ${data.message || 'Unknown error'}</p>`;
      return;
    }

    if (!data.trace || !data.trace.length) {
      summary.innerHTML = `<p class="muted">No trace entries found for this call.</p>`;
      return;
    }

    const turns = data.trace;
    const first = turns[0];
    const last = turns[turns.length - 1];
    const totalCost = turns.reduce((sum, t) => sum + (t.cost?.total || 0), 0);
    const avgTurnTime = turns.reduce((sum, t) => sum + (t.performance?.totalMs || 0), 0) / turns.length;

    summary.innerHTML = `
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">
        <div>
          <div style="font-size: 11px; color: #6b7280; font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Call ID</div>
          <div style="font-family: monospace; font-size: 12px;">${callId.substring(0, 30)}...</div>
        </div>
        <div>
          <div style="font-size: 11px; color: #6b7280; font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Turns</div>
          <div style="font-size: 18px; font-weight: 600;">${turns.length}</div>
        </div>
        <div>
          <div style="font-size: 11px; color: #6b7280; font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Total Cost</div>
          <div style="font-size: 18px; font-weight: 600; color: ${totalCost > 0.5 ? '#dc2626' : '#059669'};">$${totalCost.toFixed(4)}</div>
        </div>
        <div>
          <div style="font-size: 11px; color: #6b7280; font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Avg Turn Time</div>
          <div style="font-size: 18px; font-weight: 600;">${Math.round(avgTurnTime)}ms</div>
        </div>
        <div>
          <div style="font-size: 11px; color: #6b7280; font-weight: 600; text-transform: uppercase; margin-bottom: 4px;">Duration</div>
          <div style="font-size: 13px;">
            ${first.timestamp ? new Date(first.timestamp).toLocaleTimeString() : '?'}
            →
            ${last.timestamp ? new Date(last.timestamp).toLocaleTimeString() : '?'}
          </div>
        </div>
      </div>
    `;

    // Build details table
    details.style.display = 'block';
    const rows = turns
      .map((t, idx) => {
        const action = t.orchestratorDecision && t.orchestratorDecision.action;
        const intent = t.frontlineIntel && t.frontlineIntel.intent;
        const tierUsed =
          t.knowledgeLookup &&
          t.knowledgeLookup.result &&
          t.knowledgeLookup.result.tier;
        const isExpanded = idx === turns.length - 1; // Last turn expanded by default

        return `
          <details class="card" style="margin-bottom: 12px; padding: 12px; background: #f9fafb;" ${isExpanded ? 'open' : ''}>
            <summary style="cursor: pointer; font-weight: 500; display: flex; gap: 8px; align-items: center; padding: 8px 0;">
              <span style="background: #4f46e5; color: white; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600;">Turn ${t.turnNumber}</span>
              <span style="background: #eff6ff; color: #1e40af; padding: 2px 8px; border-radius: 999px; font-size: 11px;">Intent: ${intent || 'unknown'}</span>
              <span style="background: #f0fdf4; color: #065f46; padding: 2px 8px; border-radius: 999px; font-size: 11px;">Action: ${action || 'n/a'}</span>
              ${
                tierUsed
                  ? `<span style="background: #fef3c7; color: #92400e; padding: 2px 8px; border-radius: 999px; font-size: 11px;">Tier: ${tierUsed}</span>`
                  : ''
              }
              <span style="color: #6b7280; font-size: 12px; font-weight: 400; margin-left: auto;">
                ${
                  t.input && t.input.text
                    ? sanitizeForInline(t.input.text).substring(0, 80) + '...'
                    : 'No input'
                }
              </span>
            </summary>
            <div style="margin-top: 16px; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px;">
              <div>
                <h4 style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151;">Input</h4>
                <pre style="background: white; padding: 12px; border-radius: 6px; font-size: 11px; overflow: auto; margin: 0; border: 1px solid #e5e7eb;">${sanitizeForBlock(JSON.stringify(t.input, null, 2))}</pre>
              </div>
              <div>
                <h4 style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151;">Frontline-Intel</h4>
                <pre style="background: white; padding: 12px; border-radius: 6px; font-size: 11px; overflow: auto; margin: 0; border: 1px solid #e5e7eb;">${sanitizeForBlock(JSON.stringify(t.frontlineIntel, null, 2))}</pre>
              </div>
              <div>
                <h4 style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151;">Orchestrator Decision</h4>
                <pre style="background: white; padding: 12px; border-radius: 6px; font-size: 11px; overflow: auto; margin: 0; border: 1px solid #e5e7eb;">${sanitizeForBlock(JSON.stringify(t.orchestratorDecision, null, 2))}</pre>
              </div>
              <div>
                <h4 style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151;">Knowledge Lookup (3-Tier)</h4>
                <pre style="background: white; padding: 12px; border-radius: 6px; font-size: 11px; overflow: auto; margin: 0; border: 1px solid #e5e7eb;">${sanitizeForBlock(JSON.stringify(t.knowledgeLookup, null, 2))}</pre>
              </div>
              <div>
                <h4 style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151;">Booking Action</h4>
                <pre style="background: white; padding: 12px; border-radius: 6px; font-size: 11px; overflow: auto; margin: 0; border: 1px solid #e5e7eb;">${sanitizeForBlock(JSON.stringify(t.bookingAction, null, 2))}</pre>
              </div>
              <div>
                <h4 style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151;">Performance & Cost</h4>
                <pre style="background: white; padding: 12px; border-radius: 6px; font-size: 11px; overflow: auto; margin: 0; border: 1px solid #e5e7eb;">${sanitizeForBlock(JSON.stringify({ performance: t.performance, cost: t.cost }, null, 2))}</pre>
              </div>
              <div>
                <h4 style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151;">Context Snapshot</h4>
                <pre style="background: white; padding: 12px; border-radius: 6px; font-size: 11px; overflow: auto; margin: 0; border: 1px solid #e5e7eb;">${sanitizeForBlock(JSON.stringify(t.contextSnapshot, null, 2))}</pre>
              </div>
              <div>
                <h4 style="margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #374151;">Output</h4>
                <pre style="background: white; padding: 12px; border-radius: 6px; font-size: 11px; overflow: auto; margin: 0; border: 1px solid #e5e7eb;">${sanitizeForBlock(JSON.stringify(t.output, null, 2))}</pre>
              </div>
            </div>
          </details>
        `;
      })
      .join('\n');

    details.innerHTML = `<h3 style="margin: 0 0 16px; font-size: 16px; font-weight: 600;">Turn-by-Turn Trace</h3>${rows}`;
  } catch (err) {
    console.error('[LLM-CORTEX] Failed to fetch trace', err);
    summary.innerHTML = `<p style="color: #dc2626;">Error loading trace. Check console.</p>`;
  }
}

function sanitizeForInline(str) {
  return String(str).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function sanitizeForBlock(str) {
  return String(str).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

console.log('✅ [LLM-CORTEX] LlmCortexIntelManager loaded');

