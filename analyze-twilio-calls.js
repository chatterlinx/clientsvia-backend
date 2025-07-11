// Twilio Call Log Analyzer - Check for webhook timing issues
require('dotenv').config();
const twilio = require('twilio');

const accountSid = process.env.TWILIO_ACCOUNT_SID;
const authToken = process.env.TWILIO_AUTH_TOKEN;
const client = twilio(accountSid, authToken);

async function analyzeRecentCalls() {
  try {
    console.log('🔍 Analyzing recent Twilio calls for timing issues...\n');
    
    // Get recent calls from the last 24 hours
    const calls = await client.calls.list({
      startTime: new Date(Date.now() - 24 * 60 * 60 * 1000),
      limit: 10
    });
    
    for (const call of calls) {
      console.log(`📞 Call SID: ${call.sid}`);
      console.log(`   From: ${call.from} → To: ${call.to}`);
      console.log(`   Status: ${call.status}`);
      console.log(`   Duration: ${call.duration} seconds`);
      console.log(`   Start: ${call.startTime}`);
      console.log(`   End: ${call.endTime}`);
      
      // Get events for this call to see webhook timing
      try {
        const events = await client.calls(call.sid).events.list();
        console.log(`   📋 Events (${events.length}):`);
        
        events.forEach(event => {
          console.log(`     - ${event.name}: ${event.timestamp}`);
        });
      } catch (err) {
        console.log(`   ❌ Could not fetch events: ${err.message}`);
      }
      
      console.log('   ────────────────────────────────\n');
    }
    
    console.log('✅ Analysis complete. Look for long gaps between events.');
    
  } catch (error) {
    console.error('❌ Error analyzing calls:', error.message);
    
    if (error.code === 20003) {
      console.log('\n💡 Authentication issue. Check your Twilio credentials in .env:');
      console.log('   TWILIO_ACCOUNT_SID=your_account_sid');
      console.log('   TWILIO_AUTH_TOKEN=your_auth_token');
    }
  }
}

// Run the analysis
analyzeRecentCalls();
