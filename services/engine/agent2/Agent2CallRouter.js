/**
 * ============================================================================
 * AGENT 2.0 CALL ROUTER — Top-Level Intent Gate (5-Bucket Classifier)
 * ============================================================================
 *
 * PURPOSE:
 * Classifies every caller utterance into one of 5 business-meaningful intent
 * buckets BEFORE the trigger card pool is scanned. This allows TriggerCardMatcher
 * to pre-filter from 200+ cards down to ~15-30 relevant cards per turn.
 *
 * BUCKETS:
 *   booking_service      — Repair, maintenance, install, emergency dispatch
 *   billing_payment      — Invoices, payments, charges, billing questions
 *   membership_plan      — Service agreements, maintenance plans, contracts
 *   existing_appointment — Reschedule, cancel, confirm, appointment status
 *   other_operator       — Speak to a person, complaint, hours, general
 *
 * DESIGN PRINCIPLES:
 * - Zero LLM dependency — pure deterministic token scoring
 * - Zero API calls — runs entirely in memory in < 5ms
 * - UI-driven: company.aiAgentSettings.agent2.discovery.callRouter overrides
 * - All defaults visible in admin console (no hidden patterns)
 * - Multi-turn aware: Turn 1 bucket stored in call state as prior for Turn 2+
 *
 * SCORING MODEL (per bucket):
 *   1. Anchor match → instant HIGH_CONFIDENCE win (0.95)
 *   2. Primary token score × 3 each
 *   3. Secondary token score × 1 each
 *   4. Negative token penalty × -2 each (reduces score for wrong bucket)
 *   5. Confidence = winner_score / calibration_max
 *
 * CONFIDENCE THRESHOLDS:
 *   >= 0.85 → HIGH — enforce bucket filtering in TriggerCardMatcher
 *   0.60-0.84 → MEDIUM — advisory (emit event, filter if configured)
 *   < 0.60 → LOW — no filtering, full trigger scan
 *
 * WIRING:
 * - Called from: Agent2DiscoveryRunner.js after ScrabEngine, before TriggerCardMatcher
 * - Output: { bucket, subBucket, confidence, tier, scores, matchedAnchor }
 * - TriggerCardMatcher receives routerResult as options.callRouterResult
 *
 * ============================================================================
 */

'use strict';

const logger = require('../../../utils/logger');

// ════════════════════════════════════════════════════════════════════════════
// INDUSTRY ONTOLOGIES — Served to admin UI via GET /triggers/router-config
// These are the complete, visible default definitions for each bucket.
// Company overrides stored in: company.aiAgentSettings.agent2.discovery.callRouter
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_ONTOLOGIES = {

  // ─── BUCKET 1: BOOKING / SERVICE ─────────────────────────────────────────
  // Covers: repair calls, maintenance visits, installs, quotes, emergencies
  booking_service: {
    label: 'Booking / Service',
    description: 'Caller needs a technician dispatched (repair, maintenance, install, emergency)',
    color: '#3b82f6',

    // Anchor phrases — instant HIGH_CONFIDENCE if matched (exact substring)
    anchors: [
      'schedule an appointment', 'schedule service', 'need someone to come',
      'send a technician', 'send someone out', 'service call',
      'need a tech', 'come out and fix', 'fix my ac', 'fix my furnace',
      'not cooling', 'not heating', 'not working', 'stopped working',
      'emergency service', 'need service today', 'urgent repair',
      'book a service', 'set up a visit'
    ],

    // Primary tokens — strong positive signals (score × 3 each)
    primaryTokens: [
      'schedule', 'appointment', 'technician', 'repair', 'fix',
      'broken', 'not working', 'stopped', 'not cooling', 'not heating',
      'service', 'diagnose', 'emergency', 'urgent', 'install', 'replace',
      'maintenance', 'tune up', 'check', 'inspect', 'quote', 'estimate',
      'sparks', 'flooding', 'gas', 'leak', 'burning smell', 'no heat',
      'no cool', 'blowing warm', 'blowing cold', 'not blowing', 'ice',
      'frozen', 'breaker', 'dripping', 'noise', 'banging', 'squealing',
      'freon', 'refrigerant', 'thermostat blank', 'thermostat dead'
    ],

    // Secondary tokens — weak positive signals (score × 1 each)
    secondaryTokens: [
      'help', 'issue', 'problem', 'unit', 'system', 'air conditioner',
      'furnace', 'hvac', 'heat pump', 'compressor', 'blower', 'duct',
      'vent', 'filter', 'coil', 'capacitor', 'need', 'want', 'looking'
    ],

    // Negative tokens — reduce score if present (score - 2 each)
    negativeTokens: [
      'invoice', 'bill', 'payment', 'charge', 'owe',
      'reschedule', 'cancel', 'existing appointment',
      'speak to a person', 'talk to someone', 'manager'
    ],

    // Sub-buckets (detected within booking_service)
    subBuckets: {
      repair: {
        label: 'Repair / Emergency',
        tokens: ['broken', 'not working', 'stopped', 'fix', 'repair', 'not cooling', 'not heating',
                 'leaking', 'dripping', 'sparks', 'burning', 'emergency', 'urgent', 'breaker', 'ice',
                 'frozen', 'noise', 'banging', 'squealing', 'no heat', 'no cool'],
        weight: 3
      },
      maintenance: {
        label: 'Maintenance / Tune-Up',
        tokens: ['maintenance', 'tune up', 'tune-up', 'annual', 'service visit', 'checkup',
                 'inspect', 'clean filter', 'filter change', 'seasonal'],
        weight: 3
      },
      install_quote: {
        label: 'Install / Quote',
        tokens: ['install', 'replace', 'new system', 'new unit', 'new ac', 'quote',
                 'estimate', 'replacement', 'upgrade', 'cost', 'how much'],
        weight: 3
      }
    }
  },

  // ─── BUCKET 2: BILLING / PAYMENT ─────────────────────────────────────────
  billing_payment: {
    label: 'Billing / Payment',
    description: 'Caller has a question about an invoice, charge, or payment',
    color: '#f59e0b',

    anchors: [
      'billing question', 'about my invoice', 'payment question',
      'about my bill', 'question about my payment', 'about the charge',
      'invoice question', 'i have a charge', 'what was i charged'
    ],

    primaryTokens: [
      'invoice', 'billing', 'payment', 'owe', 'charge', 'bill', 'pay',
      'credit card', 'collections', 'overdue', 'balance', 'statement',
      'receipt', 'finance', 'financing', 'account balance'
    ],

    secondaryTokens: ['account', 'amount', 'cost', 'price', 'fee', 'refund'],

    negativeTokens: [
      'schedule', 'fix', 'repair', 'not working', 'emergency',
      'reschedule', 'cancel appointment'
    ],

    subBuckets: {}
  },

  // ─── BUCKET 3: MEMBERSHIP / PLAN ─────────────────────────────────────────
  membership_plan: {
    label: 'Membership / Maintenance Plan',
    description: 'Caller asking about or signing up for a service plan or contract',
    color: '#8b5cf6',

    anchors: [
      'maintenance plan', 'service agreement', 'service plan', 'service contract',
      'about the membership', 'how does the plan work', 'sign up for the plan',
      'maintenance membership', 'join the plan', 'enroll in the plan',
      'what does the plan cover'
    ],

    primaryTokens: [
      'maintenance plan', 'service agreement', 'membership', 'service plan',
      'contract', 'enroll', 'sign up', 'join', 'renewal', 'annual plan',
      'protection plan', 'coverage', 'benefits', 'priority service'
    ],

    secondaryTokens: [
      'annual', 'monthly', 'plan', 'agreement', 'discount', 'member',
      'priority', 'included', 'covers', 'scheduled visits'
    ],

    negativeTokens: [
      'invoice', 'payment', 'not working', 'broken', 'emergency', 'fix'
    ],

    subBuckets: {}
  },

  // ─── BUCKET 4: EXISTING APPOINTMENT ──────────────────────────────────────
  existing_appointment: {
    label: 'Existing Appointment',
    description: 'Caller managing an existing appointment (reschedule, cancel, status)',
    color: '#10b981',

    anchors: [
      'reschedule my appointment', 'cancel my appointment',
      'when is the technician coming', 'change my appointment',
      'cancel the service call', 'move my appointment',
      'what time is my appointment', 'is my appointment still on',
      'confirm my appointment', 'calling to cancel'
    ],

    primaryTokens: [
      'reschedule', 'cancel appointment', 'change appointment',
      'technician coming', 'tech coming', 'appointment status',
      'confirm appointment', 'when is someone coming', 'cancel service',
      'postpone', 'push back appointment'
    ],

    secondaryTokens: [
      'appointment', 'cancel', 'scheduled', 'coming', 'tomorrow',
      'what time', 'when', 'still on', 'confirmed'
    ],

    negativeTokens: [
      'schedule new', 'new appointment', 'book', 'not working', 'fix',
      'repair', 'emergency', 'invoice', 'billing'
    ],

    subBuckets: {
      reschedule: {
        label: 'Reschedule',
        tokens: ['reschedule', 'change appointment', 'move appointment', 'different time', 'different day'],
        weight: 3
      },
      cancel: {
        label: 'Cancel',
        tokens: ['cancel appointment', 'cancel service', 'cancel my', 'calling to cancel'],
        weight: 3
      },
      status: {
        label: 'Status / Confirm',
        tokens: ['when is', 'what time', 'confirm', 'still coming', 'appointment status', 'on the way'],
        weight: 3
      }
    }
  },

  // ─── BUCKET 5: OTHER / OPERATOR / COMPLAINT ──────────────────────────────
  other_operator: {
    label: 'Other / Operator / Complaint',
    description: 'General inquiry, complaint, callback request, or operator transfer',
    color: '#6b7280',

    anchors: [
      'speak to a person', 'talk to someone', 'call me back',
      'are you a robot', 'is this automated', 'have someone call me',
      'speak with a human', 'transfer me', 'connect me',
      'want to speak to a manager', 'file a complaint'
    ],

    primaryTokens: [
      'manager', 'complaint', 'human', 'person', 'operator', 'speak to',
      'talk to', 'callback', 'call me back', 'transfer', 'escalate',
      'robot', 'automated', 'real person', 'live person', 'hours',
      'are you open', 'what time do you open'
    ],

    secondaryTokens: [
      'speak', 'talk', 'someone', 'help', 'please', 'need to talk',
      'have a concern', 'unhappy', 'frustrated'
    ],

    negativeTokens: [
      'not working', 'fix', 'repair', 'schedule', 'appointment',
      'invoice', 'billing', 'maintenance plan'
    ],

    subBuckets: {}
  }
};

const ROUTER_BUCKET_KEYS = new Set(Object.keys(DEFAULT_ONTOLOGIES));

// Calibration max score for confidence normalization
// Based on: 5 strong primary tokens (×3 each) = 15 points
const CALIBRATION_MAX = 15;

// ════════════════════════════════════════════════════════════════════════════
// HELPERS
// ════════════════════════════════════════════════════════════════════════════

function normalizeText(text) {
  return `${text || ''}`.toLowerCase().trim();
}

/**
 * Lightweight contraction expansion — mirrors ScrabEngine defaults.
 * Ensures CallRouter works correctly even if called before ScrabEngine
 * (defense in depth). ScrabEngine still runs first in production.
 */
function expandContractions(text) {
  return text
    .replace(/\bisn't\b/g, 'is not')
    .replace(/\bwon't\b/g, 'will not')
    .replace(/\bdoesn't\b/g, 'does not')
    .replace(/\bcan't\b/g, 'cannot')
    .replace(/\bhasn't\b/g, 'has not')
    .replace(/\bwasn't\b/g, 'was not')
    .replace(/\bdidn't\b/g, 'did not')
    .replace(/\bwouldn't\b/g, 'would not')
    .replace(/\bcouldn't\b/g, 'could not')
    .replace(/\baren't\b/g, 'are not')
    .replace(/\bhaven't\b/g, 'have not')
    .replace(/\bit's\b/g, 'it is')
    .replace(/\bquit working\b/g, 'stopped working')
    .replace(/\bon the fritz\b/g, 'not working')
    .replace(/\bacting up\b/g, 'not working');
}

function extractWords(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);
}

function safeObj(v, fallback = {}) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
}

/**
 * Score input against a list of token patterns (single/multi-word).
 * Returns the count of distinct tokens that appeared in the input.
 */
function scoreTokenList(input, inputWords, tokens) {
  let score = 0;
  for (const token of tokens) {
    const tokenNorm = normalizeText(token);
    // Multi-word: substring match
    if (tokenNorm.includes(' ')) {
      if (input.includes(tokenNorm)) score++;
    } else {
      // Single word: exact word match
      if (inputWords.has(tokenNorm)) score++;
    }
  }
  return score;
}

/**
 * Check if any anchor phrase is a substring of the input.
 * Returns the matched anchor or null.
 */
function matchAnchor(input, anchors) {
  for (const anchor of anchors) {
    if (input.includes(normalizeText(anchor))) return anchor;
  }
  return null;
}

/**
 * Detect sub-bucket within the winning bucket.
 */
function detectSubBucket(input, inputWords, subBuckets) {
  if (!subBuckets || Object.keys(subBuckets).length === 0) return null;

  let winner = null;
  let winnerScore = 0;

  for (const [key, def] of Object.entries(subBuckets)) {
    const score = scoreTokenList(input, inputWords, def.tokens || []);
    if (score > winnerScore) {
      winnerScore = score;
      winner = key;
    }
  }

  return winner;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN CLASSIFIER
// ════════════════════════════════════════════════════════════════════════════

class Agent2CallRouter {
  /**
   * Classify the caller utterance into one of 5 intent buckets.
   *
   * @param {string} inputText - Normalized text from ScrabEngine output
   * @param {Object} config    - UI-driven overrides (from company callRouter config)
   * @param {Object} context   - { turn, priorBucket, priorConfidence }
   * @returns {CallRouterResult}
   */
  static classify(inputText, config = {}, context = {}) {
    const input      = expandContractions(normalizeText(inputText));
    const inputWords = new Set(extractWords(input));
    const turn       = typeof context.turn === 'number' ? context.turn : 0;

    if (!input) {
      return Agent2CallRouter._buildResult(null, null, 0, 'EMPTY', null, {});
    }

    // Merge company config overrides with defaults (UI-controlled per bucket)
    const ontologies = Agent2CallRouter._mergeOntologies(config);
    const scores     = {};

    // ─── Score every bucket ────────────────────────────────────────────────
    for (const [bucketKey, ontology] of Object.entries(ontologies)) {
      // Step 1: Anchor check (instant high-confidence)
      const anchorHit = matchAnchor(input, ontology.anchors || []);
      if (anchorHit) {
        const subBucket = detectSubBucket(input, inputWords, ontology.subBuckets);
        logger.debug('[Agent2CallRouter] Anchor match', { bucket: bucketKey, anchor: anchorHit });
        return Agent2CallRouter._buildResult(bucketKey, subBucket, 0.95, 'HIGH', anchorHit, {
          [bucketKey]: { anchor: anchorHit, primary: 0, secondary: 0, negative: 0, total: 15 }
        });
      }

      // Step 2: Weighted token scoring
      const primaryScore   = scoreTokenList(input, inputWords, ontology.primaryTokens   || []) * 3;
      const secondaryScore = scoreTokenList(input, inputWords, ontology.secondaryTokens || []) * 1;
      const negativeScore  = scoreTokenList(input, inputWords, ontology.negativeTokens  || []) * 2;
      const total          = Math.max(0, primaryScore + secondaryScore - negativeScore);

      scores[bucketKey] = { primary: primaryScore, secondary: secondaryScore, negative: negativeScore, total };
    }

    // ─── Find winner ───────────────────────────────────────────────────────
    const sortedBuckets = Object.entries(scores).sort((a, b) => b[1].total - a[1].total);
    const [winnerKey, winnerScore]   = sortedBuckets[0]  || [null, { total: 0 }];
    const [runnerKey, runnerScore]   = sortedBuckets[1]  || [null, { total: 0 }];

    if (!winnerKey || winnerScore.total === 0) {
      return Agent2CallRouter._buildResult(null, null, 0, 'UNKNOWN', null, scores);
    }

    // Confidence: ratio of winner to calibration max, penalized by runner-up proximity
    const rawConfidence = Math.min(1.0, winnerScore.total / CALIBRATION_MAX);
    const gap           = winnerScore.total - (runnerScore?.total || 0);
    const gapPenalty    = gap < 3 ? 0.15 : gap < 6 ? 0.05 : 0;
    const confidence    = Math.max(0, rawConfidence - gapPenalty);

    const tier = confidence >= 0.85 ? 'HIGH'
               : confidence >= 0.60 ? 'MEDIUM'
               : 'LOW';

    // ─── Multi-turn prior weighting ────────────────────────────────────────
    // If Turn 1 established a bucket and we're on Turn 2+, apply a prior boost
    // to reduce flip-flopping when caller is elaborating on the same intent.
    let finalBucket    = winnerKey;
    let finalConfidence = confidence;

    if (turn > 0 && context.priorBucket && context.priorBucket !== winnerKey) {
      const priorConfidence = context.priorConfidence || 0.7;
      // If prior was strong and current is weak, lean toward prior
      if (priorConfidence >= 0.75 && confidence < 0.65) {
        finalBucket     = context.priorBucket;
        finalConfidence = Math.min(0.75, priorConfidence * 0.85);
        logger.debug('[Agent2CallRouter] Multi-turn prior override', {
          prior: context.priorBucket, current: winnerKey, confidence
        });
      }
    }

    const subBucket = detectSubBucket(input, inputWords, ontologies[finalBucket]?.subBuckets || {});

    return Agent2CallRouter._buildResult(finalBucket, subBucket, finalConfidence, tier, null, scores);
  }

  /**
   * Build a standardized result object.
   */
  static _buildResult(bucket, subBucket, confidence, tier, matchedAnchor, scores) {
    return {
      bucket,           // string | null
      subBucket,        // string | null (within bucket)
      confidence,       // 0.0 – 1.0
      tier,             // 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN' | 'EMPTY'
      matchedAnchor,    // string | null (if anchor fired)
      scores,           // { bucketKey: { primary, secondary, negative, total } }
      isHighConfidence: confidence >= 0.85,
      isMediumConfidence: confidence >= 0.60 && confidence < 0.85,
      shouldFilter: confidence >= 0.70,   // Whether TriggerCardMatcher should pre-filter
      timestamp: Date.now()
    };
  }

  /**
   * Merge company config overrides with the default ontologies.
   * Companies can add custom tokens to any bucket via:
   *   company.aiAgentSettings.agent2.discovery.callRouter.bucketOverrides
   */
  static _mergeOntologies(config = {}) {
    const overrides = safeObj(config.bucketOverrides, {});
    const merged    = {};

    for (const [key, ontology] of Object.entries(DEFAULT_ONTOLOGIES)) {
      const override = safeObj(overrides[key], {});
      merged[key] = {
        ...ontology,
        anchors:         [...(ontology.anchors        || []), ...(override.additionalAnchors        || [])],
        primaryTokens:   [...(ontology.primaryTokens  || []), ...(override.additionalPrimaryTokens  || [])],
        secondaryTokens: [...(ontology.secondaryTokens|| []), ...(override.additionalSecondaryTokens|| [])],
        negativeTokens:  [...(ontology.negativeTokens || []), ...(override.additionalNegativeTokens || [])]
      };
    }

    return merged;
  }

  /**
   * Apply router result to filter trigger cards.
   * Returns: { filteredCards, totalCards, filteredCount, bucketUsed }
   *
   * Cards with matching bucket OR no bucket (null/untagged) are always included.
   * When confidence < shouldFilter threshold, returns ALL cards unchanged.
   */
  static applyToTriggerPool(cards, routerResult) {
    if (!routerResult || !routerResult.bucket || !routerResult.shouldFilter) {
      return {
        filteredCards: cards,
        totalCards: cards.length,
        filteredCount: 0,
        bucketUsed: null,
        filtered: false
      };
    }

    const { bucket } = routerResult;
    const filtered   = [];
    const excluded   = [];

    for (const card of cards) {
      const rawBucket = card.bucket || null;
      const cardBucket = rawBucket && ROUTER_BUCKET_KEYS.has(rawBucket) ? rawBucket : null;
      // Include: card bucket matches, or card is untagged (null bucket)
      if (cardBucket === null || cardBucket === bucket) {
        filtered.push(card);
      } else {
        excluded.push(card);
      }
    }

    logger.debug('[Agent2CallRouter] Pool filtered', {
      bucket,
      before: cards.length,
      after:  filtered.length,
      excluded: excluded.length
    });

    return {
      filteredCards: filtered,
      totalCards:   cards.length,
      filteredCount: excluded.length,
      bucketUsed:   bucket,
      filtered:     true
    };
  }

  /**
   * Get the complete default ontology definitions for admin UI display.
   * Returns all buckets with their tokens and anchors visible to admins.
   */
  static getDefaultOntologies() {
    return DEFAULT_ONTOLOGIES;
  }

  /**
   * Get default config structure for company storage.
   * Stored in: company.aiAgentSettings.agent2.discovery.callRouter
   */
  static getDefaultConfig() {
    return {
      enabled: true,
      // Minimum confidence to enforce bucket-based pool filtering
      filterThreshold: 0.70,
      // Per-bucket token overrides (company-specific additions)
      bucketOverrides: {
        booking_service:      { additionalAnchors: [], additionalPrimaryTokens: [], additionalSecondaryTokens: [], additionalNegativeTokens: [] },
        billing_payment:      { additionalAnchors: [], additionalPrimaryTokens: [], additionalSecondaryTokens: [], additionalNegativeTokens: [] },
        membership_plan:      { additionalAnchors: [], additionalPrimaryTokens: [], additionalSecondaryTokens: [], additionalNegativeTokens: [] },
        existing_appointment: { additionalAnchors: [], additionalPrimaryTokens: [], additionalSecondaryTokens: [], additionalNegativeTokens: [] },
        other_operator:       { additionalAnchors: [], additionalPrimaryTokens: [], additionalSecondaryTokens: [], additionalNegativeTokens: [] }
      }
    };
  }
}

module.exports = { Agent2CallRouter, DEFAULT_ONTOLOGIES };
