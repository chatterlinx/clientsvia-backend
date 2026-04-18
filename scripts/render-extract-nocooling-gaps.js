'use strict';

/**
 * ============================================================================
 * RENDER SHELL EXTRACT — KC Section Gap Events (read-only)
 * ============================================================================
 *
 * Pulls KC_SECTION_GAP events from Customer.discoveryNotes[].qaLog[] for a
 * given companyId + container title, over the specified range. Read-only —
 * writes nothing, modifies nothing.
 *
 * PURPOSE:
 *   Feeds the KC authoring workflow. Gives us the actual caller utterances
 *   that matched a container but had no section to handle them, so new
 *   sections can be built from real caller language (not guessed phrases).
 *
 * Usage — paste into Render Shell:
 *   node scripts/render-extract-nocooling-gaps.js
 *   node scripts/render-extract-nocooling-gaps.js <companyId>
 *   node scripts/render-extract-nocooling-gaps.js <companyId> "No Cooling" 30
 *
 * Args:
 *   argv[2] — companyId    (default: Penguin Air)
 *   argv[3] — containerTitle regex substring (default: "No Cooling")
 *   argv[4] — range in days (default: 30)
 *
 * Output:
 *   JSON blob printed to stdout with grouped + sorted events.
 *   Pipe to pbcopy / file for handoff: node ... > gaps.json
 *
 * ============================================================================
 */

const { MongoClient, ObjectId } = require('mongodb');

const PENGUIN_AIR_ID = '68e3f77a9d623b8058c700c4';
const COMPANY_ID     = process.argv[2] || PENGUIN_AIR_ID;
const TITLE_FILTER   = process.argv[3] || 'No Cooling';
const RANGE_DAYS     = parseInt(process.argv[4], 10) || 30;

const MONGO_URI = process.env.MONGODB_URI;
if (!MONGO_URI) {
  console.error('ERROR: MONGODB_URI env var not set.');
  process.exit(1);
}

const DB_NAME = 'clientsvia';

(async () => {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db        = client.db(DB_NAME);
    const customers = db.collection('customers');

    const cutoffIso = new Date(Date.now() - RANGE_DAYS * 86400000).toISOString();

    const pipeline = [
      { $match: { companyId: new ObjectId(COMPANY_ID) } },
      { $unwind: { path: '$discoveryNotes', preserveNullAndEmptyArrays: false } },
      { $unwind: { path: '$discoveryNotes.qaLog', preserveNullAndEmptyArrays: false } },
      {
        $match: {
          'discoveryNotes.qaLog.type':           'KC_SECTION_GAP',
          'discoveryNotes.qaLog.timestamp':      { $gte: cutoffIso },
          'discoveryNotes.qaLog.containerTitle': { $regex: TITLE_FILTER, $options: 'i' },
        },
      },
      {
        $project: {
          _id:              0,
          callSid:          '$discoveryNotes.callSid',
          callReason:       '$discoveryNotes.callReason',
          turn:             '$discoveryNotes.qaLog.turn',
          utterance:        '$discoveryNotes.qaLog.question',
          agentResponse:    '$discoveryNotes.qaLog.answer',
          containerTitle:   '$discoveryNotes.qaLog.containerTitle',
          containerId:      '$discoveryNotes.qaLog.containerId',
          kcId:             '$discoveryNotes.qaLog.kcId',
          gapFiltered:      '$discoveryNotes.qaLog.gapFiltered',
          gapOriginalCount: '$discoveryNotes.qaLog.gapOriginalCount',
          gapFilteredCount: '$discoveryNotes.qaLog.gapFilteredCount',
          gapTopSections:   '$discoveryNotes.qaLog.gapTopSections',
          cueFrame:         '$discoveryNotes.qaLog.cueFrame',
          timestamp:        '$discoveryNotes.qaLog.timestamp',
        },
      },
      { $sort: { timestamp: -1 } },
    ];

    const events = await customers.aggregate(pipeline).toArray();

    // ── Summary stats ───────────────────────────────────────────────────────
    const byCallSid = {};
    for (const e of events) {
      byCallSid[e.callSid] = (byCallSid[e.callSid] || 0) + 1;
    }
    const uniqueCalls = Object.keys(byCallSid).length;

    const byTurn = {};
    for (const e of events) {
      byTurn[e.turn] = (byTurn[e.turn] || 0) + 1;
    }

    const output = {
      meta: {
        companyId:     COMPANY_ID,
        titleFilter:   TITLE_FILTER,
        rangeDays:     RANGE_DAYS,
        cutoffIso,
        totalEvents:   events.length,
        uniqueCalls,
        byTurn,
      },
      events,
    };

    console.log(JSON.stringify(output, null, 2));
  } catch (err) {
    console.error('ERROR:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await client.close();
  }
})();
