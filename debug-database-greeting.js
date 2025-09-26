const mongoose = require('mongoose');
const Company = require('./models/Company');

async function debugDatabaseGreeting() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia');
    console.log('Connected to MongoDB');

    const companyId = '68813026dd95f599c74e49c7';
    const company = await Company.findById(companyId);

    if (!company) {
      console.log('Company not found');
      return;
    }

    console.log('=== DEBUGGING DATABASE GREETING ===');
    console.log('Company Name:', company.companyName);
    console.log('Business Name:', company.businessName);
    
    console.log('\n=== AI AGENT LOGIC STRUCTURE ===');
    if (company.aiAgentLogic) {
      console.log('aiAgentLogic exists:', !!company.aiAgentLogic);
      
      if (company.aiAgentLogic.responseCategories) {
        console.log('responseCategories exists:', !!company.aiAgentLogic.responseCategories);
        
        if (company.aiAgentLogic.responseCategories.core) {
          console.log('core exists:', !!company.aiAgentLogic.responseCategories.core);
          console.log('greeting-response:', company.aiAgentLogic.responseCategories.core['greeting-response']);
        } else {
          console.log('core does NOT exist');
        }
        
        if (company.aiAgentLogic.responseCategories.greeting) {
          console.log('greeting exists:', !!company.aiAgentLogic.responseCategories.greeting);
          console.log('greeting.template:', company.aiAgentLogic.responseCategories.greeting.template);
        } else {
          console.log('greeting does NOT exist');
        }
      } else {
        console.log('responseCategories does NOT exist');
      }
    } else {
      console.log('aiAgentLogic does NOT exist');
    }
    
    console.log('\n=== AGENT SETUP ===');
    if (company.agentSetup) {
      console.log('agentSetup exists:', !!company.agentSetup);
      console.log('agentGreeting:', company.agentSetup.agentGreeting);
    } else {
      console.log('agentSetup does NOT exist');
    }

    console.log('\n=== SEARCHING FOR HAHA ===');
    const companyStr = JSON.stringify(company);
    const hahaMatches = companyStr.match(/haha/gi);
    if (hahaMatches) {
      console.log('Found "haha" in company data:', hahaMatches.length, 'times');
      
      // Find the specific location
      const lines = companyStr.split('\n');
      lines.forEach((line, index) => {
        if (line.toLowerCase().includes('haha')) {
          console.log(`Line ${index + 1}:`, line.substring(0, 200));
        }
      });
    } else {
      console.log('No "haha" found in company data');
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

debugDatabaseGreeting();
