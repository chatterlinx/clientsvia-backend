#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 * SEED BEHAVIOR PROFILES - Apply V23 behavior profiles to companies
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Usage:
 *   node scripts/seed-behavior-profiles.js                    # List companies
 *   node scripts/seed-behavior-profiles.js --company=ID       # Apply to specific company
 *   node scripts/seed-behavior-profiles.js --trade=HVAC       # Apply HVAC profile by trade
 *   node scripts/seed-behavior-profiles.js --all              # Apply to all companies
 *   node scripts/seed-behavior-profiles.js --dry-run          # Preview without saving
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');

// ═══════════════════════════════════════════════════════════════════════════
// BEHAVIOR PROFILE TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

const PROFILES = {
  GENERIC: {
    mode: 'HYBRID',
    humorLevel: 0.4,
    empathyLevel: 0.8,
    directnessLevel: 0.7,
    maxHumorPerReply: 1,
    allowSmallTalkSeconds: 10,
    safetyStrictness: 1.0,
    globalEmergencyKeywords: [
      'burning smell', 'smoke', 'sparks', 'fire', 'gas smell',
      'leaking into ceiling', 'water pouring', 'flooding',
      'unconscious', 'chest pain', 'bleeding a lot'
    ],
    globalBillingConflictKeywords: [
      'you charged', 'my bill', 'refund', 'dispute',
      'overcharged', 'chargeback', 'billing error', 'invoice is wrong'
    ],
    globalJokePatterns: [
      'lol', 'lmao', 'haha', 'this thing is dead',
      "i'm dying here", 'this is killing me'
    ],
    tradeOverrides: {}
  },

  HVAC: {
    mode: 'HYBRID',
    humorLevel: 0.6,
    empathyLevel: 0.8,
    directnessLevel: 0.7,
    maxHumorPerReply: 1,
    allowSmallTalkSeconds: 15,
    safetyStrictness: 1.0,
    globalEmergencyKeywords: [
      'burning smell', 'smoke', 'sparks', 'fire', 'gas smell',
      'leaking into ceiling', 'water pouring', 'flooding'
    ],
    globalBillingConflictKeywords: [
      'you charged', 'my bill', 'refund', 'dispute',
      'overcharged', 'chargeback', 'billing error', 'invoice is wrong'
    ],
    globalJokePatterns: [
      'lol', 'lmao', 'haha', 'this thing is dead', 'this unit is dead',
      "i'm dying here", 'this is killing me', 'my ac is dead',
      'my house is an oven', "i'm melting"
    ],
    tradeOverrides: {
      HVAC: {
        emergencyKeywords: [
          'ac is smoking', 'smoke from vent', 'smoke from vents',
          'smoke from the ac', 'ac caught fire', 'unit on fire',
          'burning plastic smell from vents', 'water coming through ceiling',
          'water dripping from vent', 'water leaking from the ac'
        ],
        billingConflictKeywords: [],
        jokePatterns: [
          'house is an oven', "i'm melting", 'my ac is dead',
          'feels like hell in here', 'sauna in my house'
        ]
      }
    }
  },

  PLUMBING: {
    mode: 'HYBRID',
    humorLevel: 0.5,
    empathyLevel: 0.9,
    directnessLevel: 0.7,
    maxHumorPerReply: 1,
    allowSmallTalkSeconds: 15,
    safetyStrictness: 1.0,
    globalEmergencyKeywords: [
      'leaking into ceiling', 'water pouring', 'flooding', 'sewage', 'sewer'
    ],
    globalBillingConflictKeywords: [
      'you charged', 'my bill', 'refund', 'dispute',
      'overcharged', 'chargeback', 'billing error', 'invoice is wrong'
    ],
    globalJokePatterns: [
      'lol', 'lmao', 'haha', 'this thing is dead', 'this is killing me'
    ],
    tradeOverrides: {
      PLUMBING: {
        emergencyKeywords: [
          'sewage backing up', 'sewer backing up', 'toilet overflowing',
          'toilet is overflowing', 'burst pipe', 'pipe burst', 'pipe exploded',
          'water main broke', 'water main is broken', 'water all over the floor',
          'water everywhere', 'basement is flooded'
        ],
        billingConflictKeywords: [],
        jokePatterns: [
          'my bathroom is a swimming pool', 'indoor pool now',
          'feels like a water park in here'
        ]
      }
    }
  },

  DENTAL: {
    mode: 'HYBRID',
    humorLevel: 0.2,
    empathyLevel: 0.95,
    directnessLevel: 0.6,
    maxHumorPerReply: 0,
    allowSmallTalkSeconds: 5,
    safetyStrictness: 1.0,
    globalEmergencyKeywords: [
      "bleeding won't stop", 'bleeding will not stop', 'bleeding a lot',
      'severe tooth pain', 'unbearable tooth pain', 'face is swelling',
      'jaw is swelling', 'infection spreading', 'swelling getting worse'
    ],
    globalBillingConflictKeywords: [
      'you charged', 'my bill', 'refund', 'dispute', 'overcharged',
      'chargeback', 'billing error', 'invoice is wrong', "insurance didn't cover"
    ],
    globalJokePatterns: ['lol', 'haha'],
    tradeOverrides: {
      DENTAL: {
        emergencyKeywords: [
          'severe tooth pain', 'pain is unbearable', "bleeding won't stop",
          'bleeding will not stop', 'face is swelling', 'cheek is swelling',
          'swelling around tooth', 'infection getting worse'
        ],
        billingConflictKeywords: [],
        jokePatterns: ['my teeth hate me', 'i need new teeth already']
      }
    }
  },

  ELECTRICAL: {
    mode: 'HYBRID',
    humorLevel: 0.3,
    empathyLevel: 0.8,
    directnessLevel: 0.8,
    maxHumorPerReply: 1,
    allowSmallTalkSeconds: 10,
    safetyStrictness: 1.0,
    globalEmergencyKeywords: [
      'burning smell', 'electrical burning smell', 'smoke', 'sparks', 'fire', 'gas smell'
    ],
    globalBillingConflictKeywords: [
      'you charged', 'my bill', 'refund', 'dispute',
      'overcharged', 'chargeback', 'billing error', 'invoice is wrong'
    ],
    globalJokePatterns: ['lol', 'haha', 'this is killing me'],
    tradeOverrides: {
      ELECTRICAL: {
        emergencyKeywords: [
          'outlet is smoking', 'outlet is sparking', 'sparks from outlet',
          'sparks from socket', 'breaker keeps tripping', 'panel is hot',
          'electrical burning smell', 'smoke coming from panel', 'smoke coming from outlet'
        ],
        billingConflictKeywords: [],
        jokePatterns: ['house is trying to electrocute me']
      }
    }
  }
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

async function connectDB() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('❌ MONGODB_URI not set in environment');
    process.exit(1);
  }
  
  await mongoose.connect(uri);
  console.log('✅ Connected to MongoDB');
}

async function listCompanies() {
  const Company = mongoose.connection.collection('companies');
  const companies = await Company.find({}, {
    projection: { _id: 1, companyName: 1, trade: 1, 'aiAgentSettings.behaviorProfile.mode': 1 }
  }).toArray();
  
  console.log('\n📋 COMPANIES IN DATABASE:\n');
  console.log('ID                       | Trade      | Behavior Mode | Company Name');
  console.log('─'.repeat(80));
  
  for (const c of companies) {
    const id = c._id.toString().padEnd(24);
    const trade = (c.trade || 'N/A').padEnd(10);
    const mode = (c.aiAgentSettings?.behaviorProfile?.mode || 'NOT SET').padEnd(13);
    const name = c.companyName || 'Unknown';
    console.log(`${id} | ${trade} | ${mode} | ${name}`);
  }
  
  console.log('\n💡 Usage:');
  console.log('  node scripts/seed-behavior-profiles.js --company=<ID> --trade=HVAC');
  console.log('  node scripts/seed-behavior-profiles.js --company=<ID> --trade=PLUMBING');
  console.log('  node scripts/seed-behavior-profiles.js --company=<ID> --trade=GENERIC');
}

async function applyProfile(companyId, tradeKey, dryRun = false) {
  const Company = mongoose.connection.collection('companies');
  
  // Get the company
  const company = await Company.findOne({ _id: new mongoose.Types.ObjectId(companyId) });
  if (!company) {
    console.error(`❌ Company not found: ${companyId}`);
    return false;
  }
  
  // Get the profile
  const profile = PROFILES[tradeKey.toUpperCase()] || PROFILES.GENERIC;
  
  console.log(`\n🎭 APPLYING BEHAVIOR PROFILE`);
  console.log(`   Company: ${company.companyName} (${companyId})`);
  console.log(`   Profile: ${tradeKey.toUpperCase()}`);
  console.log(`   Mode: ${profile.mode}`);
  console.log(`   Humor: ${profile.humorLevel}`);
  console.log(`   Empathy: ${profile.empathyLevel}`);
  console.log(`   Directness: ${profile.directnessLevel}`);
  console.log(`   Emergency Keywords: ${profile.globalEmergencyKeywords.length}`);
  console.log(`   Trade Overrides: ${Object.keys(profile.tradeOverrides).join(', ') || 'none'}`);
  
  if (dryRun) {
    console.log('\n🔸 DRY RUN - No changes saved');
    console.log('\n📄 Profile that would be applied:');
    console.log(JSON.stringify(profile, null, 2));
    return true;
  }
  
  // Apply the profile
  const result = await Company.updateOne(
    { _id: new mongoose.Types.ObjectId(companyId) },
    { 
      $set: { 
        'aiAgentSettings.behaviorProfile': profile,
        'trade': profile.tradeOverrides && Object.keys(profile.tradeOverrides)[0] 
          ? Object.keys(profile.tradeOverrides)[0] 
          : company.trade
      } 
    }
  );
  
  if (result.modifiedCount > 0) {
    console.log('\n✅ PROFILE APPLIED SUCCESSFULLY');
    console.log(`   Modified: ${result.modifiedCount} document(s)`);
  } else {
    console.log('\n⚠️ No changes made (profile may already be set)');
  }
  
  return true;
}

async function applyToAll(tradeKey, dryRun = false) {
  const Company = mongoose.connection.collection('companies');
  const companies = await Company.find({}).toArray();
  
  console.log(`\n🌐 APPLYING ${tradeKey.toUpperCase()} PROFILE TO ALL COMPANIES`);
  console.log(`   Total companies: ${companies.length}`);
  
  if (dryRun) {
    console.log('\n🔸 DRY RUN - No changes will be saved\n');
  }
  
  let success = 0;
  let failed = 0;
  
  for (const c of companies) {
    try {
      // Use company's existing trade or the specified trade
      const effectiveTrade = c.trade || tradeKey;
      await applyProfile(c._id.toString(), effectiveTrade, dryRun);
      success++;
    } catch (err) {
      console.error(`❌ Failed for ${c.companyName}: ${err.message}`);
      failed++;
    }
  }
  
  console.log(`\n📊 SUMMARY: ${success} succeeded, ${failed} failed`);
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  
  const companyId = args.find(a => a.startsWith('--company='))?.split('=')[1];
  const tradeKey = args.find(a => a.startsWith('--trade='))?.split('=')[1] || 'GENERIC';
  const dryRun = args.includes('--dry-run');
  const applyAll = args.includes('--all');
  
  await connectDB();
  
  try {
    if (applyAll) {
      await applyToAll(tradeKey, dryRun);
    } else if (companyId) {
      await applyProfile(companyId, tradeKey, dryRun);
    } else {
      await listCompanies();
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
  }
}

main();

