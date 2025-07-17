// scripts/add-penguin-air-behavior-rules.js
// Script to add production-grade behavior rules to Penguin Air company profile

const { MongoClient, ObjectId } = require('mongodb');
require('dotenv').config();

const PENGUIN_AIR_COMPANY_ID = "686a680241806a4991f7367f";

const penguinAirBehaviorRules = {
  politeGreeting: true,
  alwaysAcknowledge: true,
  silenceLimitSeconds: 2,
  fallbackResponse: "I'm here to help with your heating and cooling needs. What can I assist you with?",
  escalationTriggers: [
    "robot", 
    "are you real", 
    "human", 
    "frustrated", 
    "talk to a person",
    "speak to someone",
    "this is frustrating",
    "transfer me",
    "supervisor"
  ],
  technicianNames: ["Dustin", "Marcello"],
  transferToAdvisorOnFrustration: true,
  systemDelayWarningSeconds: 2,
  robotDetectionKeywords: [
    "are you real",
    "robot",
    "machine", 
    "not a human",
    "fake voice",
    "automated",
    "bot",
    "artificial"
  ],
  afterHours: {
    enabled: true,
    hours: { start: 7, end: 19 }, // 7 AM to 7 PM Eastern
    messageOption: true,
    timezone: "America/New_York",
    emergencyNumber: "+15551234567" // Replace with actual emergency line
  },
  maxSilenceWarnings: 2,
  enableSmartEscalation: true,
  conversationTimeout: 300, // 5 minutes
  serviceAdvisorNumber: "+15551234567", // Replace with actual service advisor number
  
  // Penguin Air specific settings
  companySpecific: {
    brandName: "Penguin Air",
    serviceAreas: ["heating", "cooling", "HVAC", "air conditioning", "furnace"],
    emergencyKeywords: ["no heat", "no cooling", "emergency", "urgent", "broke down"],
    schedulingHours: {
      monday: { start: 7, end: 19 },
      tuesday: { start: 7, end: 19 },
      wednesday: { start: 7, end: 19 },
      thursday: { start: 7, end: 19 },
      friday: { start: 7, end: 19 },
      saturday: { start: 8, end: 17 },
      sunday: { start: 10, end: 16 }
    }
  }
};

async function addBehaviorRulesToPenguinAir() {
  let client;
  
  try {
    // Connect to MongoDB
    client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
    await client.connect();
    
    const db = client.db();
    const companiesCollection = db.collection('companies');
    
    console.log('🔍 Looking for Penguin Air company profile...');
    
    // Find Penguin Air company
    const penguinAir = await companiesCollection.findOne({
      _id: new ObjectId(PENGUIN_AIR_COMPANY_ID)
    });
    
    if (!penguinAir) {
      console.error('❌ Penguin Air company not found with ID:', PENGUIN_AIR_COMPANY_ID);
      return;
    }
    
    console.log('✅ Found Penguin Air:', penguinAir.name);
    
    // Update company with behavior rules
    const result = await companiesCollection.updateOne(
      { _id: new ObjectId(PENGUIN_AIR_COMPANY_ID) },
      { 
        $set: { 
          behaviorRules: penguinAirBehaviorRules,
          behaviorRulesVersion: "1.0",
          behaviorRulesUpdated: new Date()
        } 
      }
    );
    
    if (result.modifiedCount === 1) {
      console.log('🎉 Successfully added behavior rules to Penguin Air!');
      console.log('📋 Behavior Rules Summary:');
      console.log(`   - Silence limit: ${penguinAirBehaviorRules.silenceLimitSeconds} seconds`);
      console.log(`   - Technicians: ${penguinAirBehaviorRules.technicianNames.join(', ')}`);
      console.log(`   - Escalation triggers: ${penguinAirBehaviorRules.escalationTriggers.length} configured`);
      console.log(`   - After hours: ${penguinAirBehaviorRules.afterHours.enabled ? 'Enabled' : 'Disabled'}`);
      console.log(`   - Business hours: ${penguinAirBehaviorRules.afterHours.hours.start}:00 - ${penguinAirBehaviorRules.afterHours.hours.end}:00`);
    } else {
      console.error('❌ Failed to update Penguin Air with behavior rules');
    }
    
  } catch (error) {
    console.error('💥 Error adding behavior rules:', error);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

// Verification function to check if rules were added correctly
async function verifyBehaviorRules() {
  let client;
  
  try {
    client = new MongoClient(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
    await client.connect();
    
    const db = client.db();
    const companiesCollection = db.collection('companies');
    
    const penguinAir = await companiesCollection.findOne(
      { _id: new ObjectId(PENGUIN_AIR_COMPANY_ID) },
      { projection: { name: 1, behaviorRules: 1, behaviorRulesVersion: 1 } }
    );
    
    if (penguinAir && penguinAir.behaviorRules) {
      console.log('\n✅ Verification successful!');
      console.log('📊 Current behavior rules for', penguinAir.name + ':');
      console.log(JSON.stringify(penguinAir.behaviorRules, null, 2));
    } else {
      console.log('\n❌ Verification failed - no behavior rules found');
    }
    
  } catch (error) {
    console.error('💥 Verification error:', error);
  } finally {
    if (client) {
      await client.close();
    }
  }
}

// Run the script
async function main() {
  console.log('🚀 Adding Penguin Air Behavior Rules to Production Database...\n');
  
  await addBehaviorRulesToPenguinAir();
  await verifyBehaviorRules();
  
  console.log('\n🎯 Behavior Rules Setup Complete!');
  console.log('📝 Next steps:');
  console.log('   1. Update your agent route to use behaviorMiddleware');
  console.log('   2. Test with sample calls to Penguin Air');
  console.log('   3. Monitor behavior logs for fine-tuning');
}

if (require.main === module) {
  main().catch(console.error);
}

module.exports = {
  addBehaviorRulesToPenguinAir,
  verifyBehaviorRules,
  penguinAirBehaviorRules
};
