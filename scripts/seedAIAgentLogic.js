/**
 * seedAIAgentLogic.js - Production seed script for AI Agent Logic
 * 
 * This script sets up default AI Agent Logic configurations for companies
 * and creates sample data for testing the system.
 */

const mongoose = require('mongoose');
const Company = require('../models/Company');
const CompanyQnA = require('../models/knowledge/CompanyQnA');
const TradeQnA = require('../models/TradeQnA');
const { ResponseTrace } = require('../src/runtime/ResponseTrace');

// Default AI Agent Logic configuration
const defaultAIAgentLogic = {
  enabled: true,
  version: "1.0",
  
  answerPriorityFlow: [
    {
      id: "company-knowledge",
      name: "Company Knowledge Base",
      description: "Custom company-specific Q&A and information",
      active: true,
      primary: true,
      priority: 1,
      icon: "building",
      category: "knowledge",
      confidenceThreshold: 0.8,
      intelligenceLevel: "high",
      performance: {
        successRate: 0.95,
        avgConfidence: 0.88,
        usageCount: 0
      }
    },
    {
      id: "trade-qa",
      name: "Trade Category Knowledge",
      description: "Industry-specific trade knowledge and answers",
      active: true,
      primary: false,
      priority: 2,
      icon: "tools",
      category: "trade",
      confidenceThreshold: 0.75,
      intelligenceLevel: "high",
      performance: {
        successRate: 0.87,
        avgConfidence: 0.82,
        usageCount: 0
      }
    },
    {
      id: "template-intelligence",
      name: "Template Intelligence",
      description: "Smart template-based responses and patterns",
      active: true,
      primary: false,
      priority: 3,
      icon: "template",
      category: "template",
      confidenceThreshold: 0.6,
      intelligenceLevel: "medium",
      performance: {
        successRate: 0.78,
        avgConfidence: 0.72,
        usageCount: 0
      }
    },
    {
      id: "llm-fallback",
      name: "LLM Fallback",
      description: "Large Language Model for complex queries",
      active: true,
      primary: false,
      priority: 4,
      icon: "brain",
      category: "ai",
      confidenceThreshold: 0.5,
      intelligenceLevel: "smart",
      performance: {
        successRate: 0.72,
        avgConfidence: 0.68,
        usageCount: 0
      }
    }
  ],
  
  thresholds: {
    companyKB: 0.8,
    tradeQA: 0.75,
    vector: 0.7,
    templates: 0.6
  },
  
  selectedTradeCategories: ["hvac", "plumbing", "electrical"],
  
  knowledgeSourceControls: {
    companyKB: { enabled: true, weight: 1.0 },
    tradeQA: { enabled: true, weight: 0.9 },
    vector: { enabled: false, weight: 0.8 },
    templates: { enabled: true, weight: 0.7 }
  },
  
  responseCategories: {
    greeting: {
      enabled: true,
      template: "Hello! Thank you for calling {companyName}. I'm your AI assistant. How can I help you today?"
    },
    hours: {
      enabled: true,
      template: "Our business hours are Monday through Friday, 8 AM to 6 PM, and Saturday 9 AM to 4 PM. We're closed on Sundays."
    },
    emergency: {
      enabled: true,
      template: "I understand this is an emergency. I'm connecting you with our emergency service team right away."
    },
    noMatch: {
      enabled: true,
      template: "I'm not sure about that specific question. Let me transfer you to one of our experts who can help you better."
    }
  },
  
  agentPersonality: {
    enabled: true,
    style: "professional",
    enthusiasm: "moderate",
    voice: {
      pace: "normal",
      tone: "friendly",
      volume: "normal"
    }
  },
  
  behaviorControls: {
    silencePolicy: {
      enabled: true,
      maxSilences: 3,
      warningThreshold: 2,
      warningMessage: "I'm still here. Are you there? Please let me know how I can help you.",
      hangupMessage: "I haven't heard from you. I'll end this call now. Please call back when you're ready to speak."
    },
    
    bargeInHandling: {
      enabled: true,
      strategy: "polite",
      maxSpeechDuration: 30000,
      politeMessage: "Sorry, let me listen to what you're saying."
    },
    
    emotionAcknowledgment: {
      enabled: true,
      responses: {
        frustrated: "I understand you're frustrated. Let me help you with that.",
        angry: "I hear that you're upset. I want to make this right for you.",
        confused: "I can sense some confusion. Let me clarify that for you.",
        happy: "I'm glad to hear the positive tone! Let me help you further."
      }
    },
    
    escalationPolicy: {
      enabled: true,
      confidenceFloor: 0.3,
      maxFailedAttempts: 3,
      keywords: ["speak to human", "manager", "supervisor", "representative"],
      keywordMessage: "I'll transfer you to one of our team members who can better assist you.",
      lowConfidenceMessage: "Let me connect you with an expert who can help you with this.",
      maxAttemptsMessage: "I want to make sure you get the help you need. Let me transfer you to a specialist."
    }
  },
  
  bookingFlow: {
    enabled: true,
    steps: [
      {
        field: "name",
        type: "name",
        prompt: "I'd be happy to schedule that for you. Could you please tell me your name?",
        required: true
      },
      {
        field: "phone",
        type: "phone",
        prompt: "What's the best phone number to reach you at?",
        required: true
      },
      {
        field: "service",
        type: "service",
        prompt: "What type of service do you need?",
        options: ["HVAC Repair", "Plumbing", "Electrical", "Maintenance", "Installation"],
        required: true
      },
      {
        field: "address",
        type: "address",
        prompt: "What's the service address?",
        required: true
      },
      {
        field: "datetime",
        type: "datetime",
        prompt: "When would you like us to come out? You can say something like 'tomorrow at 2 PM' or 'Friday morning'.",
        required: true
      },
      {
        field: "description",
        type: "text",
        prompt: "Could you briefly describe the issue or what you need help with?",
        required: false
      }
    ]
  },
  
  modelConfig: {
    primaryModel: "gemini-pro",
    fallbackModel: "openai-gpt4",
    temperature: 0.7,
    maxTokens: 500,
    timeout: 30000
  },
  
  intentRouting: {
    globalThreshold: 0.7,
    intents: [
      {
        name: "booking",
        handler: "booking",
        threshold: 0.8,
        keywords: ["schedule", "appointment", "book", "repair", "fix", "service"],
        phrases: ["need service", "set up appointment", "schedule a visit"],
        patterns: ["(schedule|book).*appointment", "(need|want).*service"]
      },
      {
        name: "hours",
        handler: "information",
        threshold: 0.8,
        keywords: ["hours", "open", "closed", "when"],
        phrases: ["business hours", "what time", "when are you open"],
        patterns: ["what.*hours", "when.*open"]
      },
      {
        name: "transfer",
        handler: "transfer",
        threshold: 0.9,
        keywords: ["human", "person", "representative", "manager"],
        phrases: ["speak to someone", "talk to a person", "customer service"],
        patterns: ["(speak|talk).*human", "(speak|talk).*person"]
      },
      {
        name: "emergency",
        handler: "emergency",
        threshold: 0.9,
        keywords: ["emergency", "urgent", "asap", "leak", "no heat"],
        phrases: ["right now", "immediately", "emergency service"],
        patterns: ["no (heat|hot water)", "water leak", "gas leak"]
      }
    ]
  }
};

// Sample knowledge base entries
const sampleKnowledgeEntries = [
  {
    question: "What are your service areas?",
    answer: "We provide service throughout the metropolitan area, including downtown, suburbs, and surrounding counties. If you're unsure whether we serve your area, please provide your zip code and I'll confirm for you.",
    keywords: ["service area", "location", "where", "coverage"],
    category: "general"
  },
  {
    question: "Do you offer emergency services?",
    answer: "Yes, we offer 24/7 emergency services for urgent issues like gas leaks, major water leaks, no heat in winter, and electrical emergencies. Emergency service calls have priority scheduling and may have additional charges.",
    keywords: ["emergency", "24/7", "urgent", "after hours"],
    category: "services"
  },
  {
    question: "What payment methods do you accept?",
    answer: "We accept cash, all major credit cards (Visa, MasterCard, American Express, Discover), personal checks, and we also offer financing options for larger projects. Payment is typically due upon completion of work.",
    keywords: ["payment", "credit card", "financing", "cost"],
    category: "billing"
  },
  {
    question: "How much does a service call cost?",
    answer: "Our standard service call fee is $89, which covers the diagnostic and travel time. This fee is waived if you proceed with any repairs over $150. We provide upfront pricing before any work begins.",
    keywords: ["cost", "price", "service call", "fee", "diagnostic"],
    category: "billing"
  },
  {
    question: "Are you licensed and insured?",
    answer: "Yes, we are fully licensed, bonded, and insured. Our technicians are certified professionals with ongoing training. We're happy to provide proof of insurance and licensing upon request.",
    keywords: ["licensed", "insured", "certified", "qualified"],
    category: "credentials"
  }
];

// Sample trade Q&A entries
const sampleTradeQAs = [
  {
    trade: "hvac",
    question: "Why isn't my air conditioner cooling?",
    answer: "There are several common reasons: dirty air filter, low refrigerant, faulty thermostat, or dirty condenser coils. Start by checking and replacing your air filter. If that doesn't help, you'll need professional service to diagnose the issue.",
    keywords: ["ac not cooling", "air conditioner", "not cold", "warm air"]
  },
  {
    trade: "hvac",
    question: "How often should I change my air filter?",
    answer: "Generally every 1-3 months, depending on the type of filter, your home's air quality, pets, and usage. Check monthly and replace when it looks dirty or according to manufacturer recommendations.",
    keywords: ["air filter", "change filter", "replace filter", "how often"]
  },
  {
    trade: "plumbing",
    question: "My toilet won't stop running",
    answer: "This is usually caused by a faulty flapper, chain, or fill valve in the tank. Try lifting the flapper to see if it stops, or jiggle the handle. If that doesn't work, the internal components may need replacement.",
    keywords: ["toilet running", "toilet won't stop", "water running", "toilet tank"]
  },
  {
    trade: "electrical",
    question: "Why does my circuit breaker keep tripping?",
    answer: "Circuit breakers trip to protect your home from electrical overload or faults. Common causes include overloaded circuits, short circuits, or ground faults. Don't reset it repeatedly - this indicates a problem that needs professional attention.",
    keywords: ["breaker tripping", "circuit breaker", "electrical problem", "power out"]
  }
];

async function seedAIAgentLogic() {
  try {
    console.log('🌱 Starting AI Agent Logic seeding...');
    
    // Connect to MongoDB if not already connected
    if (mongoose.connection.readyState === 0) {
      const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || 'mongodb://localhost:27017/clientsvia';
      console.log('Connecting to MongoDB...');
      await mongoose.connect(mongoUri);
      console.log('✅ Connected to MongoDB');
    }

    // Get all companies that don't have AI Agent Logic configured
    const companies = await Company.find({
      $or: [
        { aiAgentLogic: { $exists: false } },
        { 'aiAgentLogic.enabled': { $ne: true } }
      ]
    });

    console.log(`📊 Found ${companies.length} companies to configure`);

    // Configure each company
    for (const company of companies) {
      console.log(`🏢 Configuring AI Agent Logic for company: ${company.businessName || company._id}`);
      
      // Set up AI Agent Logic configuration
      company.aiAgentLogic = {
        ...defaultAIAgentLogic,
        // Customize greeting template with company name
        responseCategories: {
          ...defaultAIAgentLogic.responseCategories,
          greeting: {
            ...defaultAIAgentLogic.responseCategories.greeting,
            template: defaultAIAgentLogic.responseCategories.greeting.template.replace(
              '{companyName}', 
              company.businessName || 'our company'
            )
          }
        }
      };

      await company.save();
      console.log(`✅ AI Agent Logic configured for ${company.businessName || company._id}`);

      // Add sample knowledge entries for this company using new CompanyQnA model
      for (const entry of sampleKnowledgeEntries) {
        const existingEntry = await CompanyQnA.findOne({
          companyId: company._id,
          question: entry.question
        });

        if (!existingEntry) {
          await CompanyQnA.create({
            companyId: company._id,
            question: entry.question,
            answer: entry.answer,
            category: entry.category || 'general',
            keywords: entry.keywords || [],
            isActive: true,
            createdAt: new Date(),
            updatedAt: new Date()
          });
        }
      }
      
      console.log(`📚 Added ${sampleKnowledgeEntries.length} knowledge entries`);
    }

    // Add sample trade Q&A entries (shared across companies)
    console.log('📝 Adding sample trade Q&A entries...');
    
    for (const entry of sampleTradeQAs) {
      const existingEntry = await TradeQnA.findOne({
        trade: entry.trade,
        question: entry.question
      });

      if (!existingEntry) {
        await TradeQnA.create({
          ...entry,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date()
        });
      }
    }

    console.log(`✅ Added ${sampleTradeQAs.length} trade Q&A entries`);

    // Clean up old response traces (keep last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    
    const cleanupResult = await ResponseTrace.deleteMany({
      timestamp: { $lt: thirtyDaysAgo }
    });
    
    console.log(`🧹 Cleaned up ${cleanupResult.deletedCount} old response traces`);

    console.log('🎉 AI Agent Logic seeding completed successfully!');
    
    return {
      companiesConfigured: companies.length,
      knowledgeEntriesAdded: sampleKnowledgeEntries.length,
      tradeQAsAdded: sampleTradeQAs.length,
      oldTracesRemoved: cleanupResult.deletedCount
    };

  } catch (error) {
    console.error('❌ Error seeding AI Agent Logic:', error);
    throw error;
  }
}

// Function to reset a specific company's AI configuration
async function resetCompanyAIConfig(companyID) {
  try {
    const company = await Company.findById(companyID);
    if (!company) {
      throw new Error(`Company with ID ${companyID} not found`);
    }

    company.aiAgentLogic = {
      ...defaultAIAgentLogic,
      responseCategories: {
        ...defaultAIAgentLogic.responseCategories,
        greeting: {
          ...defaultAIAgentLogic.responseCategories.greeting,
          template: defaultAIAgentLogic.responseCategories.greeting.template.replace(
            '{companyName}', 
            company.businessName || 'our company'
          )
        }
      }
    };

    await company.save();
    console.log(`✅ Reset AI configuration for company: ${company.businessName || companyID}`);
    
    return company.aiAgentLogic;
  } catch (error) {
    console.error(`❌ Error resetting company AI config: ${error.message}`);
    throw error;
  }
}

// Function to backup current configurations
async function backupAIConfigurations() {
  try {
    const companies = await Company.find(
      { 'aiAgentLogic.enabled': true },
      { _id: 1, businessName: 1, aiAgentLogic: 1 }
    );

    const backup = {
      timestamp: new Date(),
      version: "1.0",
      companies: companies.map(company => ({
        companyID: company._id,
        businessName: company.businessName,
        aiAgentLogic: company.aiAgentLogic
      }))
    };

    const backupPath = `./backups/ai-agent-logic-backup-${Date.now()}.json`;
    const fs = require('fs');
    const path = require('path');
    
    // Ensure backups directory exists
    const backupsDir = path.dirname(backupPath);
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
    console.log(`💾 AI configurations backed up to: ${backupPath}`);
    
    return backupPath;
  } catch (error) {
    console.error('❌ Error backing up AI configurations:', error);
    throw error;
  }
}

// CLI interface
if (require.main === module) {
  const command = process.argv[2];
  const companyID = process.argv[3];

  (async () => {
    try {
      switch (command) {
        case 'seed':
          await seedAIAgentLogic();
          break;
        case 'reset':
          if (!companyID) {
            console.error('Usage: node seedAIAgentLogic.js reset <companyID>');
            process.exit(1);
          }
          await resetCompanyAIConfig(companyID);
          break;
        case 'backup':
          await backupAIConfigurations();
          break;
        default:
          console.log('Usage:');
          console.log('  node seedAIAgentLogic.js seed     - Set up AI Agent Logic for all companies');
          console.log('  node seedAIAgentLogic.js reset <companyID> - Reset AI config for specific company');
          console.log('  node seedAIAgentLogic.js backup   - Backup current AI configurations');
          break;
      }
    } catch (error) {
      console.error('Script failed:', error);
      process.exit(1);
    } finally {
      if (mongoose.connection.readyState === 1) {
        await mongoose.disconnect();
        console.log('📡 Disconnected from MongoDB');
      }
    }
  })();
}

module.exports = {
  seedAIAgentLogic,
  resetCompanyAIConfig,
  backupAIConfigurations,
  defaultAIAgentLogic
};
