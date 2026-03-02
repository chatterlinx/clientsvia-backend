#!/usr/bin/env node
const { MongoClient } = require("mongodb");
require('dotenv').config();

(async () => {
  const uri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.MONGODB_CONNECTION_STRING;
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db();

  const companyId = "68e3f77a9d623b8058c700c4";

  console.log('\n=== PENGUIN AIR TRIGGER SETTINGS ===\n');
  
  const settings = await db.collection("companyTriggerSettings").findOne(
    { companyId },
    { 
      projection: { 
        companyId: 1, 
        activeGroupId: 1, 
        groupSelectedAt: 1, 
        groupSelectedBy: 1,
        strictMode: 1,
        disabledGlobalTriggerIds: 1,
        partialOverrides: 1,
        createdAt: 1,
        updatedAt: 1
      } 
    }
  );

  if (!settings) {
    console.log('❌ NO SETTINGS DOCUMENT FOUND!');
    console.log('   This means runtime has NO activeGroupId pointer.');
    console.log('   Global triggers will be EMPTY (0) every call.\n');
  } else {
    console.log('Settings document:');
    console.log(JSON.stringify(settings, null, 2));
    console.log('');
    
    if (!settings.activeGroupId) {
      console.log('🚨 SMOKING GUN FOUND:');
      console.log('   activeGroupId: null/undefined');
      console.log('   This means the dropdown selection is NOT saved to runtime.');
      console.log('   UI shows "HVAC" but runtime sees nothing.');
      console.log('');
    } else {
      console.log('✅ Runtime pointer exists:');
      console.log(`   activeGroupId: ${settings.activeGroupId}`);
      console.log('');
      
      // Check if that group exists
      const group = await db.collection("globalTriggerGroups").findOne({ groupId: settings.activeGroupId });
      if (!group) {
        console.log(`❌ ORPHANED POINTER: Group "${settings.activeGroupId}" does not exist!`);
      } else {
        console.log(`✅ Group exists: ${group.name} (${group.triggerCount || 0} triggers)`);
      }
    }
  }

  await client.close();
})().catch(e => { console.error(e); process.exit(1); });
