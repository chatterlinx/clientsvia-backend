const mongoose = require('mongoose');
require('dotenv').config();

async function check() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  const CallSummary = require('../models/CallSummary');
  const CallTranscript = require('../models/CallTranscript');
  
  // Get most recent call
  const call = await CallSummary.findOne({ companyId: '68e3f77a9d623b8058c700c4' })
    .sort({ startedAt: -1 })
    .lean();
  
  console.log('=== MOST RECENT CALL ===');
  console.log('callId:', call?.callId);
  console.log('twilioSid:', call?.twilioSid);
  console.log('phone:', call?.phone);
  console.log('turnCount:', call?.turnCount);
  console.log('durationSeconds:', call?.durationSeconds);
  console.log('transcriptRef:', call?.transcriptRef);
  console.log('hasTranscript:', call?.hasTranscript);
  
  // Check if transcript exists
  if (call?.transcriptRef) {
    const transcript = await CallTranscript.findById(call.transcriptRef).lean();
    console.log('\n=== TRANSCRIPT BY REF ===');
    console.log('exists:', !!transcript);
    console.log('turns:', transcript?.turns?.length || 0);
  }
  
  // Also check by callId/twilioSid
  const transcriptByCallId = await CallTranscript.findOne({ 
    callId: call?.twilioSid || call?.callId 
  }).lean();
  console.log('\n=== TRANSCRIPT BY CALLID ===');
  console.log('exists:', !!transcriptByCallId);
  console.log('turns:', transcriptByCallId?.turns?.length || 0);
  
  // Count total transcripts for this company
  const transcriptCount = await CallTranscript.countDocuments({ companyId: '68e3f77a9d623b8058c700c4' });
  console.log('\n=== TOTAL TRANSCRIPTS ===');
  console.log('count:', transcriptCount);
  
  await mongoose.disconnect();
}
check().catch(e => { console.error(e); process.exit(1); });
