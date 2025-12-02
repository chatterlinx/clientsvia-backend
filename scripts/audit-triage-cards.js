/**
 * TRIAGE CARD ENTERPRISE AUDIT
 * Reviews all triage cards for a company and evaluates enterprise readiness
 */

require('dotenv').config();
const mongoose = require('mongoose');

const COMPANY_ID = '68e3f77a9d623b8058c700c4';

async function auditCards() {
  console.log('\n🔍 Connecting to database...');
  await mongoose.connect(process.env.MONGODB_URI);
  
  const TriageCard = require('../models/TriageCard');
  
  const cards = await TriageCard.find({ 
    companyId: new mongoose.Types.ObjectId(COMPANY_ID)
  }).sort({ priority: -1 }).lean();
  
  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log('                    TRIAGE CARD ENTERPRISE AUDIT                           ');
  console.log('═══════════════════════════════════════════════════════════════════════════');
  console.log(`\n📊 OVERVIEW:`);
  console.log(`   Total Cards: ${cards.length}`);
  console.log(`   ✅ Active: ${cards.filter(c => c.isActive).length}`);
  console.log(`   ⚪ Inactive: ${cards.filter(c => !c.isActive).length}`);
  
  // Group by action
  const byAction = {};
  cards.forEach(c => {
    const action = c.quickRuleConfig?.action || 'UNKNOWN';
    byAction[action] = (byAction[action] || 0) + 1;
  });
  console.log(`\n📋 BY ACTION:`);
  Object.entries(byAction).forEach(([a, count]) => {
    const emoji = {
      'DIRECT_TO_3TIER': '🔵',
      'ESCALATE_TO_HUMAN': '🔴',
      'EXPLAIN_AND_PUSH': '🟣',
      'TAKE_MESSAGE': '🟠',
      'END_CALL_POLITE': '⚫'
    }[a] || '⚪';
    console.log(`   ${emoji} ${a}: ${count}`);
  });
  
  // Group by service type
  const byService = {};
  cards.forEach(c => {
    const svc = c.serviceType || 'OTHER';
    byService[svc] = (byService[svc] || 0) + 1;
  });
  console.log(`\n🔧 BY SERVICE TYPE:`);
  Object.entries(byService).forEach(([s, count]) => console.log(`   ${s}: ${count}`));
  
  console.log('\n───────────────────────────────────────────────────────────────────────────');
  console.log('                         DETAILED CARD REVIEW                              ');
  console.log('───────────────────────────────────────────────────────────────────────────\n');
  
  let issues = [];
  
  cards.forEach((card, i) => {
    const keywords = card.quickRuleConfig?.keywordsMustHave || [];
    const excludes = card.quickRuleConfig?.keywordsExclude || [];
    const action = card.quickRuleConfig?.action || 'N/A';
    const status = card.isActive ? '✅' : '⚪';
    const name = card.displayName || card.triageLabel || 'Unnamed';
    
    console.log(`${status} ${i+1}. ${name}`);
    console.log(`   Action: ${action} | Service: ${card.serviceType || 'N/A'} | Priority: ${card.priority || 100}`);
    console.log(`   Keywords (${keywords.length}): ${keywords.join(' | ')}`);
    if (excludes.length) {
      console.log(`   Excludes (${excludes.length}): ${excludes.join(' | ')}`);
    }
    
    // Check for issues
    if (keywords.length === 0) {
      issues.push(`⚠️ "${name}" has NO keywords - will never match!`);
      console.log(`   ⚠️ WARNING: No keywords configured!`);
    }
    if (keywords.length === 1) {
      issues.push(`⚠️ "${name}" has only 1 keyword - add variations for better matching`);
      console.log(`   ⚠️ TIP: Only 1 keyword - add variations`);
    }
    if (!card.frontlinePlaybook?.openingLines?.length) {
      issues.push(`📝 "${name}" has no opening lines - agent won't know what to say`);
    }
    
    console.log('');
  });
  
  // Summary
  console.log('───────────────────────────────────────────────────────────────────────────');
  console.log('                         ENTERPRISE ASSESSMENT                             ');
  console.log('───────────────────────────────────────────────────────────────────────────\n');
  
  const activeCards = cards.filter(c => c.isActive);
  const avgKeywords = cards.reduce((sum, c) => sum + (c.quickRuleConfig?.keywordsMustHave?.length || 0), 0) / cards.length;
  const cardsWithExcludes = cards.filter(c => c.quickRuleConfig?.keywordsExclude?.length > 0).length;
  const cardsWithPlaybook = cards.filter(c => c.frontlinePlaybook?.openingLines?.length > 0).length;
  
  console.log(`📊 METRICS:`);
  console.log(`   Average keywords per card: ${avgKeywords.toFixed(1)}`);
  console.log(`   Cards with exclude keywords: ${cardsWithExcludes}/${cards.length} (${Math.round(cardsWithExcludes/cards.length*100)}%)`);
  console.log(`   Cards with opening lines: ${cardsWithPlaybook}/${cards.length} (${Math.round(cardsWithPlaybook/cards.length*100)}%)`);
  
  if (issues.length > 0) {
    console.log(`\n⚠️ ISSUES FOUND (${issues.length}):`);
    issues.forEach(issue => console.log(`   ${issue}`));
  } else {
    console.log(`\n✅ No critical issues found!`);
  }
  
  // Grade
  let grade = 'A';
  let gradeExplanation = 'Excellent coverage';
  
  if (activeCards.length === 0) { grade = 'F'; gradeExplanation = 'No active cards!'; }
  else if (activeCards.length < 5) { grade = 'D'; gradeExplanation = 'Too few active cards'; }
  else if (avgKeywords < 2) { grade = 'C'; gradeExplanation = 'Need more keyword variations'; }
  else if (cardsWithPlaybook < cards.length * 0.5) { grade = 'B'; gradeExplanation = 'Good, but add more playbooks'; }
  else if (issues.length > 5) { grade = 'B'; gradeExplanation = 'Good coverage, minor issues'; }
  
  console.log(`\n🏆 ENTERPRISE GRADE: ${grade}`);
  console.log(`   ${gradeExplanation}`);
  
  console.log('\n═══════════════════════════════════════════════════════════════════════════\n');
  
  await mongoose.disconnect();
}

auditCards().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});

