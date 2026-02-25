/**
 * CallTranscriptV2
 * 
 * New canonical, append-during-call transcript storage keyed by (companyId, callSid).
 * This collection is intentionally separate from legacy CallTranscript to avoid
 * schema drift and mixed read/write contracts.
 */

const mongoose = require('mongoose');

const TurnSchema = new mongoose.Schema(
  {
    turnNumber: { type: Number, required: true },
    speaker: { type: String, enum: ['caller', 'agent', 'system'], required: true },
    text: { type: String, required: true },
    ts: { type: Date, required: true },
    sourceKey: { type: String, default: null }, // greetings, agent2, booking, kb, etc.
    trace: { type: mongoose.Schema.Types.Mixed, default: null } // optional per-turn trace payload
  },
  { _id: false }
);

const TraceSchema = new mongoose.Schema(
  {
    traceKey: { type: String, required: true }, // stable dedupe key (e.g. `${turnNumber}:${kind}`)
    turnNumber: { type: Number, default: null },
    kind: { type: String, required: true }, // matcher / router / greeting / finalize
    ts: { type: Date, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { _id: false }
);

const CallTranscriptV2Schema = new mongoose.Schema(
  {
    companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'v2Company', required: true, index: true },
    callSid: { type: String, required: true, index: true },

    callMeta: {
      from: { type: String, default: null },
      to: { type: String, default: null },
      startedAt: { type: Date, default: null },
      endedAt: { type: Date, default: null },
      twilioDurationSeconds: { type: Number, default: null }
    },

    firstTurnTs: { type: Date, default: null, index: true },
    lastTurnTs: { type: Date, default: null, index: true },

    // For fast list rendering without pulling full turns.
    // Key must allow multiple lines within the same turnNumber, so it includes sourceKey + a short text prefix.
    // We keep a human-only keyset so the Call Console list uses conversational truth (caller+agent),
    // even when we also log system/TwiML actions.
    turnKeys: { type: [String], default: [] }, // all speakers
    humanTurnKeys: { type: [String], default: [] }, // speaker in ['caller','agent']
    systemTurnKeys: { type: [String], default: [] }, // speaker === 'system'
    traceKeys: { type: [String], default: [] },

    turns: { type: [TurnSchema], default: [] },
    trace: { type: [TraceSchema], default: [] }
  },
  { collection: 'call_transcripts_v2', timestamps: true }
);

CallTranscriptV2Schema.index({ companyId: 1, callSid: 1 }, { unique: true });
CallTranscriptV2Schema.index({ companyId: 1, updatedAt: -1 });

function normalizeSpeaker(speaker) {
  if (speaker === 'agent' || speaker === 'caller' || speaker === 'system') return speaker;
  if (speaker === 'user' || speaker === 'customer') return 'caller';
  return 'caller';
}

function toDate(value, fallback = null) {
  if (!value) return fallback;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

/**
 * Append turns during the live call.
 * 
 * - Idempotency: deduped at read-time using turnKeys; webhook retries may append duplicates.
 * - Performance: single atomic update; safe with concurrent writers.
 */
CallTranscriptV2Schema.statics.appendTurns = async function appendTurns(companyId, callSid, turns, opts = {}) {
  if (!companyId || !callSid) return;

  const now = new Date();
  const cleaned = (Array.isArray(turns) ? turns : [])
    .map((t) => {
      const speaker = normalizeSpeaker(t?.speaker);
      const text = `${t?.text || ''}`.trim();
      const turnNumber = Number.isFinite(t?.turnNumber) ? t.turnNumber : (Number.isFinite(t?.turn) ? t.turn : null);
      const ts = toDate(t?.ts || t?.timestamp, now);
      const sourceKey = t?.sourceKey ? `${t.sourceKey}` : (t?.source ? `${t.source}` : null);
      const trace = t?.trace ?? null;

      if (!Number.isFinite(turnNumber) || text.length === 0) return null;
      return { turnNumber, speaker, text, ts, sourceKey, trace };
    })
    .filter(Boolean);

  if (cleaned.length === 0) return;

  const keys = cleaned.map((t) => {
    const src = t.sourceKey || '';
    const textPrefix = `${t.text || ''}`.trim().toLowerCase().substring(0, 24);
    return `${t.turnNumber}:${t.speaker}:${src}:${textPrefix}`;
  });
  const humanKeys = cleaned
    .filter(t => t.speaker === 'caller' || t.speaker === 'agent')
    .map((t) => {
      const src = t.sourceKey || '';
      const textPrefix = `${t.text || ''}`.trim().toLowerCase().substring(0, 24);
      return `${t.turnNumber}:${t.speaker}:${src}:${textPrefix}`;
    });
  const systemKeys = cleaned
    .filter(t => t.speaker === 'system')
    .map((t) => {
      const src = t.sourceKey || '';
      const textPrefix = `${t.text || ''}`.trim().toLowerCase().substring(0, 24);
      return `${t.turnNumber}:${t.speaker}:${src}:${textPrefix}`;
    });
  const minTs = cleaned.reduce((min, t) => (!min || t.ts < min ? t.ts : min), null);
  const maxTs = cleaned.reduce((max, t) => (!max || t.ts > max ? t.ts : max), null);

  const setOnInsert = {
    companyId,
    callSid,
    callMeta: {
      from: opts?.from || null,
      to: opts?.to || null,
      startedAt: toDate(opts?.startedAt, null),
      endedAt: null,
      twilioDurationSeconds: null
    }
  };

  const $set = { updatedAt: now };
  if (opts?.from) $set['callMeta.from'] = opts.from;
  if (opts?.to) $set['callMeta.to'] = opts.to;
  if (opts?.startedAt) $set['callMeta.startedAt'] = toDate(opts.startedAt, null);

  const update = {
    $setOnInsert: setOnInsert,
    $set,
    $push: { turns: { $each: cleaned } },
    $addToSet: {
      turnKeys: { $each: keys },
      ...(humanKeys.length > 0 ? { humanTurnKeys: { $each: humanKeys } } : {}),
      ...(systemKeys.length > 0 ? { systemTurnKeys: { $each: systemKeys } } : {})
    }
  };

  if (minTs) update.$min = { ...(update.$min || {}), firstTurnTs: minTs };
  if (maxTs) update.$max = { ...(update.$max || {}), lastTurnTs: maxTs };

  await this.updateOne({ companyId, callSid }, update, { upsert: true });
};

/**
 * Append trace entries alongside turns.
 */
CallTranscriptV2Schema.statics.appendTrace = async function appendTrace(companyId, callSid, entries) {
  if (!companyId || !callSid) return;

  const now = new Date();
  const cleaned = (Array.isArray(entries) ? entries : [])
    .map((e) => {
      const kind = `${e?.kind || ''}`.trim();
      const turnNumber = Number.isFinite(e?.turnNumber) ? e.turnNumber : null;
      const ts = toDate(e?.ts, now);
      const payload = e?.payload || {};
      if (!kind) return null;
      const traceKey = `${turnNumber ?? 'na'}:${kind}`;
      return { traceKey, turnNumber, kind, ts, payload };
    })
    .filter(Boolean);

  if (cleaned.length === 0) return;

  const keys = cleaned.map((t) => t.traceKey);
  const minTs = cleaned.reduce((min, t) => (!min || t.ts < min ? t.ts : min), null);
  const maxTs = cleaned.reduce((max, t) => (!max || t.ts > max ? t.ts : max), null);

  const update = {
    $set: { updatedAt: now },
    $push: { trace: { $each: cleaned } },
    $addToSet: { traceKeys: { $each: keys } }
  };

  if (minTs) update.$min = { ...(update.$min || {}), firstTurnTs: minTs };
  if (maxTs) update.$max = { ...(update.$max || {}), lastTurnTs: maxTs };

  await this.updateOne({ companyId, callSid }, update, { upsert: true });
};

/**
 * Finalize call meta (endedAt, duration).
 */
CallTranscriptV2Schema.statics.finalizeCall = async function finalizeCall(companyId, callSid, { endedAt, twilioDurationSeconds } = {}) {
  if (!companyId || !callSid) return;

  const safeEndedAt = toDate(endedAt, new Date());
  const dur = Number.isFinite(twilioDurationSeconds) ? twilioDurationSeconds : parseInt(twilioDurationSeconds || '0', 10);
  const durationSafe = Number.isFinite(dur) && dur >= 0 ? dur : null;

  await this.updateOne(
    { companyId, callSid },
    {
      $set: {
        'callMeta.endedAt': safeEndedAt,
        ...(durationSafe === null ? {} : { 'callMeta.twilioDurationSeconds': durationSafe }),
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
};

module.exports = mongoose.model('CallTranscriptV2', CallTranscriptV2Schema);

