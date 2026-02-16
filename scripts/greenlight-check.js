#!/usr/bin/env node
/* eslint-disable no-console */
const mongoose = require('mongoose');
const BlackBoxRecording = require('../models/BlackBoxRecording');

function usage() {
  console.log('Usage: node scripts/greenlight-check.js <companyId> [callId]');
  console.log('Requires MONGODB_URI env var.');
}

function pickRouteMarker(events) {
  const markers = (events || []).filter((e) => {
    const data = e?.data || {};
    return data.routePath === '/v2-agent-respond/:companyID';
  });
  return markers[markers.length - 1] || null;
}

function firstTurnOwner(events) {
  const turns = (events || []).filter((e) => (e?.turn || 0) === 1);
  const ownerLike = turns.find((e) => e?.data?.matchSource) || null;
  return ownerLike?.data?.matchSource || null;
}

function hasForbiddenDiscoverySpeaker(events) {
  const forbidden = ['LLM_FALLBACK', 'SCENARIO_MATCHED', 'HybridReceptionistLLM'];
  const responseEvents = (events || []).filter((e) => {
    const src = e?.data?.matchSource || e?.data?.source || '';
    if (!src) return false;
    const lane = (e?.data?.lane || '').toUpperCase();
    return lane === 'DISCOVERY' || src.includes('DISCOVERY') || src.includes('STEP_ENGINE');
  });
  for (const e of responseEvents) {
    const src = `${e?.data?.matchSource || e?.data?.source || ''}`;
    if (forbidden.some((f) => src.includes(f))) return src;
  }
  return null;
}

async function main() {
  const companyId = process.argv[2];
  const callId = process.argv[3];
  if (!companyId) {
    usage();
    process.exit(1);
  }
  if (!process.env.MONGODB_URI) {
    console.error('Missing MONGODB_URI');
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI, { autoIndex: false });

  const query = callId ? { companyId, callId } : { companyId };
  const rec = await BlackBoxRecording.findOne(query).sort({ startedAt: -1 }).lean();
  if (!rec) {
    console.error('No blackbox recording found for query');
    await mongoose.disconnect();
    process.exit(2);
  }

  const events = rec.events || [];
  const marker = pickRouteMarker(events);
  const turn1Owner = firstTurnOwner(events);
  const forbiddenHit = hasForbiddenDiscoverySpeaker(events);

  console.log(JSON.stringify({
    callId: rec.callId,
    startedAt: rec.startedAt,
    runtimeCommitSha: rec.runtimeCommitSha || marker?.data?.runtimeCommitSha || null,
    routePathSeen: marker?.data?.routePath || null,
    turn1MatchSource: turn1Owner,
    forbiddenDiscoverySpeakerSeen: forbiddenHit,
    greenLight: Boolean(
      (rec.runtimeCommitSha || marker?.data?.runtimeCommitSha) &&
      marker?.data?.routePath === '/v2-agent-respond/:companyID' &&
      turn1Owner &&
      !forbiddenHit
    )
  }, null, 2));

  await mongoose.disconnect();
}

main().catch(async (err) => {
  console.error(err);
  try { await mongoose.disconnect(); } catch (_) {}
  process.exit(99);
});
