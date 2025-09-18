const mongoose = require('mongoose');
const Company = require('./models/Company');

async function debugGreeting() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb+srv://chatterlinx:Chatterlinx2024@cluster0.ow4ld.mongodb.net/clientsvia?retryWrites=true&w=majority');
    console.log('✅ Connected to MongoDB');
    
    const companyId = '68813026dd95f599c74e49c7';
    const company = await Company.findById(companyId).lean();
    
    if (!company) {
      console.log('❌ Company not found');
      return;
    }
    
    console.log('🏢 Company:', company.companyName);
    console.log('🔍 Has aiAgentLogic:', !!company.aiAgentLogic);
    console.log('🔍 Has responseCategories:', !!company.aiAgentLogic?.responseCategories);
    console.log('🔍 Has core responses:', !!company.aiAgentLogic?.responseCategories?.core);
    
    if (company.aiAgentLogic?.responseCategories?.core) {
      console.log('🎯 Core responses:', Object.keys(company.aiAgentLogic.responseCategories.core));
      console.log('🎯 Greeting response:', company.aiAgentLogic.responseCategories.core['greeting-response']);
    }
    
    // Also check backup location
    if (company.agentPersonalitySettings?.responseCategories?.core) {
      console.log('🔄 Backup core responses:', Object.keys(company.agentPersonalitySettings.responseCategories.core));
      console.log('🔄 Backup greeting:', company.agentPersonalitySettings.responseCategories.core['greeting-response']);
    }
    
    console.log('🔍 Full responseCategories structure:');
    console.log(JSON.stringify(company.aiAgentLogic?.responseCategories, null, 2));
    
  } catch (error) {
    console.error('❌ Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

debugGreeting();
