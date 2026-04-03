/**
 * ============================================================================
 * AUDIO HEALTH — Aggregation Dashboard Endpoint
 * ClientsVia Agent Console
 *
 * GET /:companyId/audio-health
 *
 * Returns per-page audio pre-caching statistics:
 *   - KC / Services  — section-level useFixedResponse + audioUrl
 *   - Booking         — 28 prompt textareas, promptAudio map
 *   - Turn1           — 1 textarea, promptAudio map
 *   - UAP / Discovery — 2 textareas, promptAudio map
 *   - Greetings       — callStart + interceptor rules
 *   - Triggers        — discovery + booking trigger cards
 * ============================================================================
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../../utils/logger');
const { authenticateJWT }                    = require('../../middleware/auth');
const { requirePermission, PERMISSIONS }     = require('../../middleware/rbac');

const CompanyKnowledgeContainer = require('../../models/CompanyKnowledgeContainer');
const TriggerAudio              = require('../../models/TriggerAudio');
const GreetingAudio             = require('../../models/GreetingAudio');
const CompanyLocalTrigger       = require('../../models/CompanyLocalTrigger');
const CompanyBookingTrigger     = require('../../models/CompanyBookingTrigger');
const v2Company                 = require('../../models/v2Company');

// ── Helpers ────────────────────────────────────────────────────────────────

function hasPlaceholder(text) {
  return /\{[^}]+\}/.test(text || '');
}

/** Classify audio URL health */
function urlHealth(url) {
  if (!url) return 'missing';
  if (url.startsWith('/audio-safe/')) return 'healthy';   // MongoDB fallback = deploy-proof
  if (url.startsWith('/audio/'))      return 'at-risk';   // ephemeral disk only
  return 'healthy'; // absolute URL or unknown — assume OK
}

/** Page-level status from counts */
function pageStatus(fixedCount, healthyCount, audioCount) {
  if (fixedCount === 0) return 'ok';
  if (healthyCount === fixedCount) return 'ok';
  if (healthyCount < fixedCount * 0.5) return 'error';
  return 'warning';
}

// ── Booking prompt key → text path mapping ─────────────────────────────────
// Maps each data-audio-key to a function that extracts the current text from
// the company document's booking config.

function extractBookingTexts(company) {
  const a2 = company.aiAgentSettings?.agent2 || {};
  const bc = a2.bookingConfig || {};
  const bp = a2.bookingPrompts || {};
  const pc = bc.preferenceCapture || {};

  return {
    'bridgePhrase':                     a2.bridge?.bookingBridgePhrase || '',
    'recognitionConfirmPrompt':         bc.callerRecognition?.confirmPrompt || '',
    'builtinName.askPrompt':            bc.builtinPrompts?.askName || bp.askName || '',
    'builtinName.reanchorPhrase':       bc.builtinPrompts?.nameReAnchor || '',
    'builtinName.confirmFull':          bc.builtinPrompts?.confirmFullName || '',
    'builtinName.confirmFirstAskLast':  bc.builtinPrompts?.confirmFirstNameAskLast || '',
    'builtinName.askLastOnly':          bc.builtinPrompts?.askLastNameOnly || '',
    'builtinName.confirmAmbiguous':     bc.builtinPrompts?.confirmNameAmbiguous || '',
    'builtinName.confirmPartialAskLast': bc.builtinPrompts?.confirmNamePartialCorrected || '',
    'builtinName.confirmFirstGotLast':  bc.builtinPrompts?.confirmFirstNameGotLastAsk || '',
    'builtinPhone.askPrompt':           bc.builtinPrompts?.askPhone || bp.askPhone || '',
    'builtinPhone.reanchorPhrase':      bc.builtinPrompts?.phoneReAnchor || '',
    'builtinPhone.invalidRe':           bc.builtinPrompts?.phoneInvalid || '',
    'builtinAddress.askPrompt':         bc.builtinPrompts?.askAddress || bp.askAddress || '',
    'builtinAddress.reanchorPhrase':    bc.builtinPrompts?.addressReAnchor || '',
    'preferenceDay.askPrompt':          pc.askDayPrompt || '',
    'preferenceDay.urgencyResponse':    pc.urgentPrompt || '',
    'preferenceTime.askPrompt':         pc.askTimePrompt || '',
    'preferenceTime.noSlotsPrompt':     pc.noSlotsOnDayPrompt || '',
    'altContact.offerPrompt':           bc.altContact?.offerPrompt || '',
    'confirmation.template':            bc.confirmation?.template || '',
    'confirmation.timeConfirmPrompt':   bc.confirmation?.timeConfirmPrompt || '',
    'confirmation.timeAmbiguousPrompt': bc.confirmation?.timeAmbiguousPrompt || '',
    'calendar.holdMessage':             bc.calendar?.holdMessage || a2.discovery?.holdMessage || '',
    'calendar.offerTimesPrompt':        bc.calendar?.offerTimesPrompt || '',
    'calendar.noTimesPrompt':           bc.calendar?.noTimesPrompt || '',
    'calendar.confirmationMessage':     bc.calendar?.confirmationMessage || '',
    'digressionAck':                    bc.builtinPrompts?.t2DigressionAck || '',
  };
}

// Human-readable labels for booking keys
const BOOKING_LABELS = {
  'bridgePhrase':                     'Bridge Phrase',
  'recognitionConfirmPrompt':         'Recognition Confirm',
  'builtinName.askPrompt':            'Ask Name',
  'builtinName.reanchorPhrase':       'Name Re-anchor',
  'builtinName.confirmFull':          'Confirm Full Name',
  'builtinName.confirmFirstAskLast':  'Confirm First, Ask Last',
  'builtinName.askLastOnly':          'Ask Last Name Only',
  'builtinName.confirmAmbiguous':     'Confirm Name (Ambiguous)',
  'builtinName.confirmPartialAskLast': 'Confirm Partial Name',
  'builtinName.confirmFirstGotLast':  'Confirm First, Got Last',
  'builtinPhone.askPrompt':           'Ask Phone',
  'builtinPhone.reanchorPhrase':      'Phone Re-anchor',
  'builtinPhone.invalidRe':           'Phone Invalid Re-ask',
  'builtinAddress.askPrompt':         'Ask Address',
  'builtinAddress.reanchorPhrase':    'Address Re-anchor',
  'preferenceDay.askPrompt':          'Ask Preferred Day',
  'preferenceDay.urgencyResponse':    'Urgency Response',
  'preferenceTime.askPrompt':         'Ask Preferred Time',
  'preferenceTime.noSlotsPrompt':     'No Slots on Day',
  'altContact.offerPrompt':           'Alt Contact Offer',
  'confirmation.template':            'Confirmation Template',
  'confirmation.timeConfirmPrompt':   'Time Confirm',
  'confirmation.timeAmbiguousPrompt': 'Time Ambiguous',
  'calendar.holdMessage':             'Calendar Hold Message',
  'calendar.offerTimesPrompt':        'Calendar Offer Times',
  'calendar.noTimesPrompt':           'Calendar No Times',
  'calendar.confirmationMessage':     'Calendar Confirmation',
  'digressionAck':                    'Digression Ack',
};

// ── Build promptAudio detail rows ──────────────────────────────────────────

function buildPromptAudioDetails(textMap, promptAudio, labels) {
  const details = [];
  let fixedCount = 0, audioCount = 0, healthyCount = 0, staleCount = 0;

  for (const [key, text] of Object.entries(textMap)) {
    const trimmed = (text || '').trim();
    const hasPh   = hasPlaceholder(trimmed);
    const isFixed = !!trimmed && !hasPh;
    const entry   = promptAudio?.[key];
    const hasAudio = !!(entry?.url);
    const health  = !isFixed ? 'n/a'
                  : !hasAudio ? 'missing'
                  : urlHealth(entry.url) === 'at-risk' ? 'at-risk'
                  : (entry.generatedText?.trim() || '') !== trimmed ? 'stale'
                  : 'healthy';

    if (isFixed) fixedCount++;
    if (isFixed && hasAudio) audioCount++;
    if (health === 'healthy') healthyCount++;
    if (health === 'stale') staleCount++;

    details.push({
      id:       key,
      label:    labels[key] || key,
      isFixed,
      hasAudio,
      health,
      notes:    hasPh ? `Contains {placeholder} — cannot pre-record` : !trimmed ? 'No text configured' : null,
    });
  }

  return { details, fixedCount, audioCount, healthyCount, staleCount };
}

// ── Main endpoint ──────────────────────────────────────────────────────────

router.get('/:companyId/audio-health',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    try {
      const { companyId } = req.params;

      // ── Parallel queries ──────────────────────────────────────────────
      const [company, kcContainers, discoveryTriggers, bookingTriggers, triggerAudios, greetingAudios] = await Promise.all([
        v2Company.findById(companyId)
          .select('aiAgentSettings agentSettings')
          .lean(),
        CompanyKnowledgeContainer.find({ companyId, isActive: true })
          .select('title sections.label sections.useFixedResponse sections.audioUrl sections.content useFixedResponse')
          .lean(),
        CompanyLocalTrigger.find({ companyId, isDeleted: { $ne: true }, enabled: true })
          .select('ruleId label responseMode answerText audioUrl')
          .lean(),
        CompanyBookingTrigger.find({ companyId, isDeleted: { $ne: true }, enabled: true })
          .select('ruleId label responseMode answerText audioUrl')
          .lean(),
        TriggerAudio.find({ companyId, isValid: true })
          .select('ruleId audioUrl textHash sourceText')
          .lean(),
        GreetingAudio.find({ companyId })
          .select('type ruleId audioUrl textHash sourceText')
          .lean(),
      ]);

      if (!company) return res.status(404).json({ error: 'Company not found' });

      const pages = [];

      // ── 1. KC / Services ────────────────────────────────────────────
      {
        const details = [];
        let totalPrompts = 0, fixedCount = 0, audioCount = 0, healthyCount = 0, staleCount = 0;

        for (const container of kcContainers) {
          for (const section of (container.sections || [])) {
            totalPrompts++;
            const isFixed  = section.useFixedResponse === true;
            const hasAudio = !!section.audioUrl;
            const health   = !isFixed ? 'n/a'
                           : !hasAudio ? 'missing'
                           : urlHealth(section.audioUrl);

            if (isFixed) fixedCount++;
            if (isFixed && hasAudio) audioCount++;
            if (health === 'healthy') healthyCount++;
            if (health === 'stale') staleCount++;

            details.push({
              id:       `${container.title} :: ${section.label}`,
              label:    `${section.label}`,
              isFixed,
              hasAudio,
              health,
              notes:    null,
            });
          }
        }

        pages.push({
          page: 'KC / Services',
          totalPrompts,
          fixedCount,
          audioCount,
          healthyCount,
          staleCount,
          status: pageStatus(fixedCount, healthyCount, audioCount),
          details,
        });
      }

      // ── 2. Booking ──────────────────────────────────────────────────
      {
        const textMap     = extractBookingTexts(company);
        const promptAudio = company.aiAgentSettings?.agent2?.bookingConfig?.promptAudio || {};
        const result      = buildPromptAudioDetails(textMap, promptAudio, BOOKING_LABELS);

        pages.push({
          page: 'Booking',
          totalPrompts: Object.keys(textMap).length,
          ...result,
          status: pageStatus(result.fixedCount, result.healthyCount, result.audioCount),
        });
      }

      // ── 3. Turn1 ───────────────────────────────────────────────────
      {
        const turn1 = company.aiAgentSettings?.turn1 || {};
        const textMap = { 'didntUnderstandText': turn1.didntUnderstandText || '' };
        const promptAudio = turn1.promptAudio || {};
        const result = buildPromptAudioDetails(textMap, promptAudio, { 'didntUnderstandText': "Didn't Understand" });

        pages.push({
          page: 'Turn1',
          totalPrompts: 1,
          ...result,
          status: pageStatus(result.fixedCount, result.healthyCount, result.audioCount),
        });
      }

      // ── 4. UAP / Discovery ─────────────────────────────────────────
      {
        const ds = company.agentSettings?.discoverySettings || {};
        const tpls = ds.uapbTemplates || {};
        const textMap = {
          'gracefulPivot': tpls.gracefulPivot || '',
          'resumePrompt':  tpls.resumePrompt  || '',
        };
        const promptAudio = ds.promptAudio || {};
        const result = buildPromptAudioDetails(textMap, promptAudio, {
          'gracefulPivot': 'Graceful Pivot',
          'resumePrompt':  'Resume Prompt',
        });

        pages.push({
          page: 'UAP / Discovery',
          totalPrompts: 2,
          ...result,
          status: pageStatus(result.fixedCount, result.healthyCount, result.audioCount),
        });
      }

      // ── 5. Greetings ───────────────────────────────────────────────
      {
        const greetings = company.aiAgentSettings?.agent2?.greetings || {};
        const callStart = greetings.callStart || {};
        const rules     = greetings.interceptor?.rules || [];
        const gaMap     = new Map();
        for (const ga of greetingAudios) {
          gaMap.set(`${ga.type}::${ga.ruleId}`, ga);
        }

        const details = [];
        let totalPrompts = 0, fixedCount = 0, audioCount = 0, healthyCount = 0, staleCount = 0;

        // Call Start
        totalPrompts++;
        const csText  = (callStart.text || '').trim();
        const csFixed = !!csText;
        const csAudio = !!callStart.audioUrl;
        const csGA    = gaMap.get('CALL_START::call-start');
        // Health: audioUrl exists + GreetingAudio record in MongoDB
        const csHealth = !csFixed ? 'n/a'
                       : !csAudio ? 'missing'
                       : !csGA ? 'at-risk'
                       : 'healthy';

        if (csFixed) fixedCount++;
        if (csFixed && csAudio) audioCount++;
        if (csHealth === 'healthy') healthyCount++;

        details.push({
          id: 'callStart', label: 'Call Start Greeting',
          isFixed: csFixed, hasAudio: csAudio, health: csHealth, notes: null,
        });

        // Interceptor rules
        for (const rule of rules) {
          totalPrompts++;
          const rText  = (rule.response || '').trim();
          const rFixed = !!rText && rule.enabled !== false;
          const rAudio = !!rule.audioUrl;
          const rGA    = gaMap.get(`RULE::${rule.ruleId}`);
          const rHealth = !rFixed ? 'n/a'
                        : !rAudio ? 'missing'
                        : !rGA ? 'at-risk'
                        : 'healthy';

          if (rFixed) fixedCount++;
          if (rFixed && rAudio) audioCount++;
          if (rHealth === 'healthy') healthyCount++;

          details.push({
            id: `rule::${rule.ruleId}`,
            label: `Interceptor: ${(rule.triggers || []).slice(0, 2).join(', ') || rule.ruleId}`,
            isFixed: rFixed, hasAudio: rAudio, health: rHealth, notes: null,
          });
        }

        pages.push({
          page: 'Greetings',
          totalPrompts, fixedCount, audioCount, healthyCount, staleCount,
          status: pageStatus(fixedCount, healthyCount, audioCount),
          details,
        });
      }

      // ── 6. Triggers (Discovery + Booking) ──────────────────────────
      {
        const allTriggers = [...discoveryTriggers, ...bookingTriggers];
        const taMap = new Map();
        for (const ta of triggerAudios) {
          taMap.set(ta.ruleId, ta);
        }

        const details = [];
        let totalPrompts = 0, fixedCount = 0, audioCount = 0, healthyCount = 0, staleCount = 0;

        for (const trigger of allTriggers) {
          totalPrompts++;
          const text    = (trigger.answerText || '').trim();
          const isFixed = trigger.responseMode === 'standard' && !!text;
          const ta      = taMap.get(trigger.ruleId);
          const hasAudio = !!(trigger.audioUrl || ta?.audioUrl);

          let health = 'n/a';
          if (isFixed) {
            if (!hasAudio) {
              health = 'missing';
            } else if (ta) {
              // Check staleness via text hash
              const currentHash = TriggerAudio.hashText(text);
              health = currentHash === ta.textHash ? urlHealth(ta.audioUrl) : 'stale';
            } else {
              health = urlHealth(trigger.audioUrl);
            }
          }

          if (isFixed) fixedCount++;
          if (isFixed && hasAudio) audioCount++;
          if (health === 'healthy') healthyCount++;
          if (health === 'stale') staleCount++;

          details.push({
            id:       trigger.ruleId,
            label:    trigger.label || trigger.ruleId,
            isFixed,
            hasAudio,
            health,
            notes:    trigger.responseMode === 'llm' ? 'LLM mode — audio generated at runtime' : null,
          });
        }

        pages.push({
          page: 'Triggers',
          totalPrompts, fixedCount, audioCount, healthyCount, staleCount,
          status: pageStatus(fixedCount, healthyCount, audioCount),
          details,
        });
      }

      // ── Summary ────────────────────────────────────────────────────
      const summary = {
        totalPrompts:   pages.reduce((s, p) => s + p.totalPrompts, 0),
        totalFixed:     pages.reduce((s, p) => s + p.fixedCount, 0),
        totalWithAudio: pages.reduce((s, p) => s + p.audioCount, 0),
        totalHealthy:   pages.reduce((s, p) => s + p.healthyCount, 0),
        totalStale:     pages.reduce((s, p) => s + p.staleCount, 0),
      };

      return res.json({ success: true, summary, pages });

    } catch (err) {
      logger.error('[audio-health] GET failed', { error: err.message, stack: err.stack });
      return res.status(500).json({ error: 'Failed to load audio health data' });
    }
  }
);

module.exports = router;
