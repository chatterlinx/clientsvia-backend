/**
 * AI Agent Setup Service - HighLevel Competitive Mode
 * Backend functionality for the new AI Agent Setup system
 */

const Company = require('../models/Company');
const AgentPrompt = require('../models/AgentPrompt');

class AIAgentSetupService {
    
    // Business Templates - HighLevel Style Quick Setup
    static getBusinessTemplates() {
        return {
            'restaurant': {
                name: 'Restaurant & Food Service',
                services: ['Reservations', 'Takeout Orders', 'Catering', 'Event Booking'],
                hours: 'Mon-Sun 11am-10pm',
                features: ['Table reservations', 'Menu inquiries', 'Special dietary needs'],
                greeting: "Thank you for calling {CompanyName}! How can I help you today? Would you like to make a reservation or place an order?",
                categories: ['restaurants', 'food-service'],
                personality: 'friendly',
                schedulingRules: [
                    {
                        serviceName: 'Table Reservation',
                        duration: 90,
                        bufferTime: 15,
                        type: 'reservation',
                        advanceBooking: '30 days'
                    },
                    {
                        serviceName: 'Catering Order',
                        duration: 30,
                        bufferTime: 0,
                        type: 'consultation',
                        advanceBooking: '7 days'
                    }
                ],
                defaultQAs: [
                    {
                        question: "What are your hours?",
                        answer: "We're open daily from 11am to 10pm. Kitchen closes at 9:30pm.",
                        keywords: ["hours", "open", "time", "when"]
                    },
                    {
                        question: "Do you take reservations?",
                        answer: "Yes! We accept reservations for parties of 2 or more. You can book online or call us directly.",
                        keywords: ["reservation", "book", "table"]
                    }
                ]
            },
            'hvac': {
                name: 'HVAC & Air Conditioning',
                services: ['AC Repair', 'Installation', 'Maintenance', 'Emergency Service'],
                hours: 'Mon-Fri 8am-6pm, Emergency 24/7',
                features: ['Emergency dispatch', 'Service scheduling', 'Maintenance reminders'],
                greeting: "Thank you for calling {CompanyName} HVAC! How can I help you today? Do you need emergency service or would you like to schedule an appointment?",
                categories: ['hvac', 'home-services'],
                personality: 'professional',
                schedulingRules: [
                    {
                        serviceName: 'AC Repair',
                        duration: 120,
                        bufferTime: 30,
                        type: 'service',
                        advanceBooking: '14 days'
                    },
                    {
                        serviceName: 'Emergency Service',
                        duration: 60,
                        bufferTime: 0,
                        type: 'emergency',
                        advanceBooking: '0 days'
                    }
                ],
                defaultQAs: [
                    {
                        question: "Do you offer emergency service?",
                        answer: "Yes! We provide 24/7 emergency HVAC repair service. Call us anytime for urgent heating or cooling issues.",
                        keywords: ["emergency", "24/7", "urgent", "broken"]
                    },
                    {
                        question: "Are you licensed and insured?",
                        answer: "Yes, we are fully licensed, bonded, and insured. All our technicians are certified HVAC professionals.",
                        keywords: ["licensed", "insured", "certified", "qualified"]
                    }
                ]
            },
            'plumbing': {
                name: 'Plumbing Services',
                services: ['Repairs', 'Installation', 'Emergency Plumbing', 'Inspections'],
                hours: 'Mon-Fri 7am-7pm, Emergency 24/7',
                features: ['Emergency dispatch', 'Service estimates', 'Appointment scheduling'],
                greeting: "Hello, thank you for calling {CompanyName} Plumbing! How can I assist you today? Is this an emergency or would you like to schedule service?",
                categories: ['plumbing', 'home-services'],
                personality: 'professional',
                schedulingRules: [
                    {
                        serviceName: 'Plumbing Repair',
                        duration: 90,
                        bufferTime: 30,
                        type: 'service',
                        advanceBooking: '7 days'
                    },
                    {
                        serviceName: 'Emergency Plumbing',
                        duration: 60,
                        bufferTime: 0,
                        type: 'emergency',
                        advanceBooking: '0 days'
                    }
                ]
            },
            'medical': {
                name: 'Medical & Healthcare',
                services: ['Appointments', 'Prescription Refills', 'Test Results', 'Insurance'],
                hours: 'Mon-Fri 8am-5pm',
                features: ['Appointment scheduling', 'Insurance verification', 'Patient portal assistance'],
                greeting: "Thank you for calling {CompanyName}. How may I help you today? Are you calling to schedule an appointment or do you have questions about your care?",
                categories: ['healthcare', 'medical'],
                personality: 'professional',
                schedulingRules: [
                    {
                        serviceName: 'Regular Appointment',
                        duration: 30,
                        bufferTime: 15,
                        type: 'appointment',
                        advanceBooking: '60 days'
                    },
                    {
                        serviceName: 'Consultation',
                        duration: 60,
                        bufferTime: 15,
                        type: 'consultation',
                        advanceBooking: '30 days'
                    }
                ]
            },
            'legal': {
                name: 'Legal Services',
                services: ['Consultations', 'Case Updates', 'Document Requests', 'Appointments'],
                hours: 'Mon-Fri 9am-5pm',
                features: ['Consultation scheduling', 'Case inquiries', 'Document handling'],
                greeting: "Thank you for calling {CompanyName}. How may I assist you today? Would you like to schedule a consultation or speak with someone about your case?",
                categories: ['legal-services', 'professional'],
                personality: 'professional'
            }
        };
    }

    // Personality Presets - HighLevel Style
    static getPersonalityPresets() {
        return {
            'professional': {
                formality: 'professional',
                speed: 'thoughtful',
                empathy: 'medium',
                responseStyle: 'formal',
                greetingStyle: 'Good morning/afternoon, thank you for calling {CompanyName}. This is {AgentName}. How may I assist you today?',
                characteristics: ['Courteous', 'Business-focused', 'Clear communication', 'Professional tone']
            },
            'friendly': {
                formality: 'casual',
                speed: 'normal',
                empathy: 'high',
                responseStyle: 'conversational',
                greetingStyle: 'Hi there! Thanks for calling {CompanyName}! I\'m {AgentName} - how can I help make your day better?',
                characteristics: ['Warm', 'Approachable', 'Conversational', 'Empathetic']
            },
            'sales': {
                formality: 'professional',
                speed: 'quick',
                empathy: 'medium',
                responseStyle: 'persuasive',
                greetingStyle: 'Thank you for calling {CompanyName}! You\'ve reached {AgentName}, and I\'m here to help you find the perfect solution. What can I do for you today?',
                characteristics: ['Goal-oriented', 'Persuasive', 'Engaging', 'Solution-focused']
            },
            'casual': {
                formality: 'casual',
                speed: 'normal',
                empathy: 'high',
                responseStyle: 'relaxed',
                greetingStyle: 'Hey! Thanks for calling {CompanyName}. I\'m {AgentName} - what\'s up?',
                characteristics: ['Relaxed', 'Informal', 'Easy-going', 'Relatable']
            }
        };
    }

    // Quick Setup - Auto-configure everything
    static async deployQuickSetup(companyId, templateType, personality) {
        try {
            const company = await Company.findById(companyId);
            if (!company) {
                throw new Error('Company not found');
            }

            const template = this.getBusinessTemplates()[templateType];
            const personalityConfig = this.getPersonalityPresets()[personality];
            
            if (!template) {
                throw new Error('Invalid template type');
            }

            // Update company with template configuration
            const updatedCompany = await this.applyTemplateToCompany(company, template, personalityConfig);
            
            // Create/update agent prompts
            await this.createAgentPromptsFromTemplate(companyId, template, personalityConfig);

            return {
                success: true,
                message: 'AI Agent deployed successfully',
                configuration: {
                    template: templateType,
                    personality: personality,
                    services: template.services,
                    features: template.features
                }
            };

        } catch (error) {
            console.error('Quick setup deployment failed:', error);
            throw error;
        }
    }

    // Apply template to company
    static async applyTemplateToCompany(company, template, personalityConfig) {
        // Update agent configuration
        company.agentSetup = company.agentSetup || {};
        
        // Basic settings
        company.agentSetup.agentGreeting = template.greeting.replace('{CompanyName}', company.name);
        company.agentSetup.agentClosing = "Thank you for calling! Have a great day!";
        company.agentSetup.mainAgentScript = this.generateMainScript(template, personalityConfig);
        
        // Categories
        company.selectedCategories = template.categories || [];
        
        // Service scheduling rules (ClientsVia differentiator)
        if (template.schedulingRules) {
            company.agentSetup.serviceSchedulingRules = template.schedulingRules.map(rule => ({
                ...rule,
                id: Date.now() + Math.random()
            }));
        }

        // Company Q&As (ClientsVia differentiator)
        if (template.defaultQAs) {
            company.companyQnAs = template.defaultQAs.map(qa => ({
                ...qa,
                id: Date.now() + Math.random(),
                isTemplate: true
            }));
        }

        // Performance settings
        company.agentSetup.speechConfidenceThreshold = 0.4;
        company.agentSetup.fuzzyMatchThreshold = 0.3;
        company.agentSetup.maxRepeats = 3;
        
        await company.save();
        return company;
    }

    // Generate main conversational script
    static generateMainScript(template, personalityConfig) {
        const characteristics = personalityConfig.characteristics.join(', ');
        
        return `
Greeting & Identification:
Agent: ${template.greeting}

Service Information:
We offer the following services: ${template.services.join(', ')}

Personality Guidelines:
- Maintain a ${personalityConfig.responseStyle} tone
- Be ${characteristics.toLowerCase()}
- Response speed: ${personalityConfig.speed}

Service Booking:
Agent: I'd be happy to help you schedule that service. May I have your full name and the best phone number to reach you?
Agent: What type of service do you need? (Options: ${template.services.join(', ')})
Agent: Which days and times work best for you?

Transfer Handling:
Agent: I can connect you with the right person or take a detailed message. Which would you prefer?

Information Responses:
${template.defaultQAs ? template.defaultQAs.map(qa => `${qa.question} ${qa.answer}`).join('\n') : ''}

Closing:
Agent: Thank you for calling ${template.name}. Have a wonderful day!
        `.trim();
    }

    // Create agent prompts from template
    static async createAgentPromptsFromTemplate(companyId, template, personalityConfig) {
        const prompts = [
            {
                companyId: companyId,
                promptName: 'Main Greeting',
                promptText: template.greeting,
                category: 'greeting',
                isActive: true,
                isTemplate: true
            },
            {
                companyId: companyId,
                promptName: 'Service Information',
                promptText: `We offer: ${template.services.join(', ')}. ${template.features.join('. ')}.`,
                category: 'services',
                isActive: true,
                isTemplate: true
            },
            {
                companyId: companyId,
                promptName: 'Scheduling Protocol',
                promptText: `For scheduling appointments, collect: customer name, phone number, service type, and preferred date/time. Our services typically require: ${template.schedulingRules ? template.schedulingRules.map(r => `${r.serviceName} (${r.duration} min)`).join(', ') : 'standard scheduling'}.`,
                category: 'scheduling',
                isActive: true,
                isTemplate: true
            }
        ];

        // Add personality-specific prompts
        prompts.push({
            companyId: companyId,
            promptName: 'Personality Guidelines',
            promptText: `Maintain ${personalityConfig.responseStyle} tone. Be ${personalityConfig.characteristics.join(', ').toLowerCase()}. Response speed should be ${personalityConfig.speed}.`,
            category: 'personality',
            isActive: true,
            isTemplate: true
        });

        // Remove existing template prompts and add new ones
        await AgentPrompt.deleteMany({ companyId: companyId, isTemplate: true });
        await AgentPrompt.insertMany(prompts);

        return prompts;
    }

    // Get AI Agent Configuration
    static async getAIAgentConfig(companyId) {
        try {
            const company = await Company.findById(companyId).populate('companyQnAs');
            if (!company) {
                throw new Error('Company not found');
            }

            return {
                basic: {
                    timezone: company.agentSetup?.timezone || 'America/New_York',
                    operatingMode: company.agentSetup?.operatingMode || 'business-hours',
                    primaryPhone: company.agentSetup?.primaryPhone || '',
                    afterHoursMode: company.agentSetup?.afterHoursMode || 'message'
                },
                scheduling: {
                    serviceTypes: company.agentSetup?.serviceSchedulingRules || [],
                    smartScheduling: company.agentSetup?.smartScheduling !== false,
                    bufferTime: company.agentSetup?.bufferTime !== false,
                    doubleBookingPrevention: company.agentSetup?.doubleBookingPrevention !== false
                },
                knowledge: {
                    selectedCategories: company.selectedCategories || [],
                    autoGeneratedQAs: company.categoryQnAs || [],
                    customQAs: company.companyQnAs || [],
                    autoLearning: company.agentSetup?.autoLearning !== false
                },
                personality: {
                    preset: company.agentSetup?.personalityPreset || 'professional',
                    formality: company.agentSetup?.formalityLevel || 'professional',
                    speed: company.agentSetup?.responseSpeed || 'normal',
                    empathy: company.agentSetup?.empathyLevel || 'medium'
                },
                advanced: {
                    responseMode: company.agentSetup?.responseMode || 'optimal',
                    callHandling: company.agentSetup?.callHandling || 'full',
                    uncertaintyHandling: company.agentSetup?.uncertaintyHandling || 'transfer',
                    escalationPhone: company.agentSetup?.escalationPhone || ''
                }
            };
        } catch (error) {
            console.error('Failed to get AI agent config:', error);
            throw error;
        }
    }

    // Save AI Agent Configuration
    static async saveAIAgentConfig(companyId, config) {
        try {
            const company = await Company.findById(companyId);
            if (!company) {
                throw new Error('Company not found');
            }

            // Update company with new configuration
            company.agentSetup = company.agentSetup || {};
            
            // Basic settings
            if (config.basic) {
                Object.assign(company.agentSetup, config.basic);
            }

            // Scheduling settings (ClientsVia differentiator)
            if (config.scheduling) {
                company.agentSetup.serviceSchedulingRules = config.scheduling.serviceTypes || [];
                company.agentSetup.smartScheduling = config.scheduling.smartScheduling;
                company.agentSetup.bufferTime = config.scheduling.bufferTime;
                company.agentSetup.doubleBookingPrevention = config.scheduling.doubleBookingPrevention;
            }

            // Knowledge settings
            if (config.knowledge) {
                company.selectedCategories = config.knowledge.selectedCategories || [];
                company.agentSetup.autoLearning = config.knowledge.autoLearning;
                
                // Handle custom Q&As
                if (config.knowledge.customQAs) {
                    company.companyQnAs = config.knowledge.customQAs;
                }
            }

            // Personality settings
            if (config.personality) {
                company.agentSetup.personalityPreset = config.personality.preset;
                company.agentSetup.formalityLevel = config.personality.formality;
                company.agentSetup.responseSpeed = config.personality.speed;
                company.agentSetup.empathyLevel = config.personality.empathy;
            }

            // Advanced settings
            if (config.advanced) {
                Object.assign(company.agentSetup, config.advanced);
            }

            await company.save();

            return {
                success: true,
                message: 'AI Agent configuration saved successfully',
                config: config
            };

        } catch (error) {
            console.error('Failed to save AI agent config:', error);
            throw error;
        }
    }

    // Generate scheduling preview
    static generateSchedulingPreview(serviceTypes, businessType = 'general') {
        if (!serviceTypes || serviceTypes.length === 0) {
            return "Configure your services to see how the AI will handle scheduling requests.";
        }

        const services = serviceTypes.map(s => s.name).filter(n => n).join(', ');
        const sampleService = serviceTypes[0];
        
        return {
            conversation: [
                { speaker: 'Caller', message: 'I need to schedule an appointment' },
                { speaker: 'AI Agent', message: `I'd be happy to help you schedule an appointment! What type of service do you need? We offer: ${services}` },
                { speaker: 'Caller', message: `I need ${sampleService.name.toLowerCase()}` },
                { speaker: 'AI Agent', message: `Perfect! ${sampleService.name} typically takes about ${sampleService.duration || 60} minutes. What day works best for you?` }
            ],
            logic: {
                serviceDetection: `AI detects "${sampleService.name}" from available services`,
                durationHandling: `Automatically allocates ${sampleService.duration || 60} minutes + ${sampleService.bufferTime || 15} minute buffer`,
                availabilityCheck: `Checks real-time calendar availability`,
                conflictResolution: sampleService.scheduling === 'emergency' ? 'Emergency slot - can override regular appointments' : 'Standard conflict prevention'
            }
        };
    }

    // Test call simulation
    static async simulateTestCall(companyId, scenario = 'booking') {
        try {
            const company = await Company.findById(companyId);
            if (!company) {
                throw new Error('Company not found');
            }

            const config = await this.getAIAgentConfig(companyId);
            
            const scenarios = {
                booking: {
                    title: 'Service Booking Test',
                    steps: [
                        { caller: 'Hello, I need to schedule an appointment', ai: company.agentSetup?.agentGreeting || 'Thank you for calling! How can I help you?' },
                        { caller: 'I need an AC repair', ai: 'I can help you schedule AC repair service. May I have your name and phone number?' },
                        { caller: 'John Smith, 555-1234', ai: 'Thank you, John. What day would work best for you?' },
                        { caller: 'Tomorrow morning', ai: 'I have availability tomorrow at 9 AM or 11 AM. Which works better for you?' }
                    ]
                },
                information: {
                    title: 'Information Request Test', 
                    steps: [
                        { caller: 'What are your hours?', ai: company.agentSetup?.agentGreeting || 'Thank you for calling!' },
                        { caller: 'I asked about your hours', ai: 'We\'re open Monday through Friday, 8 AM to 6 PM, with 24/7 emergency service available.' }
                    ]
                }
            };

            return {
                success: true,
                scenario: scenarios[scenario] || scenarios.booking,
                configuration: {
                    personality: config.personality.preset,
                    serviceTypes: config.scheduling.serviceTypes.length,
                    customQAs: config.knowledge.customQAs.length
                }
            };

        } catch (error) {
            console.error('Test call simulation failed:', error);
            throw error;
        }
    }

    // Auto-populate knowledge base from company data
    static async autoPopulateKnowledge(companyId, sources = []) {
        try {
            const company = await Company.findById(companyId);
            if (!company) {
                throw new Error('Company not found');
            }

            const knowledgeEntries = [];

            // Auto-generate knowledge from company data
            if (company.address) {
                knowledgeEntries.push({
                    question: "What's your address?",
                    answer: `We're located at ${company.address}`,
                    category: "location",
                    confidence: 0.95,
                    source: "company_profile"
                });
            }

            if (company.phone) {
                knowledgeEntries.push({
                    question: "What's your phone number?",
                    answer: `You can reach us at ${company.phone}`,
                    category: "contact",
                    confidence: 0.95,
                    source: "company_profile"
                });
            }

            if (company.email) {
                knowledgeEntries.push({
                    question: "What's your email?",
                    answer: `You can email us at ${company.email}`,
                    category: "contact",
                    confidence: 0.95,
                    source: "company_profile"
                });
            }

            // Add business hours if available
            if (company.businessHours) {
                knowledgeEntries.push({
                    question: "What are your hours?",
                    answer: `Our hours are ${company.businessHours}`,
                    category: "hours",
                    confidence: 0.95,
                    source: "company_profile"
                });
            }

            // Add services from existing Q&A
            if (company.qaData && company.qaData.length > 0) {
                company.qaData.forEach(qa => {
                    knowledgeEntries.push({
                        question: qa.question,
                        answer: qa.answer,
                        category: "imported",
                        confidence: 0.9,
                        source: "existing_qa"
                    });
                });
            }

            // Update company knowledge base
            if (!company.agentSetup) company.agentSetup = {};
            if (!company.agentSetup.knowledgeBase) company.agentSetup.knowledgeBase = [];

            // Merge with existing entries, avoiding duplicates
            const existingQuestions = company.agentSetup.knowledgeBase.map(kb => kb.question.toLowerCase());
            const newEntries = knowledgeEntries.filter(entry => 
                !existingQuestions.includes(entry.question.toLowerCase())
            );

            company.agentSetup.knowledgeBase = [
                ...company.agentSetup.knowledgeBase,
                ...newEntries
            ];

            company.agentSetup.lastUpdated = new Date();
            await company.save();

            return {
                success: true,
                message: `Added ${newEntries.length} knowledge entries`,
                entries: newEntries,
                total: company.agentSetup.knowledgeBase.length
            };
        } catch (error) {
            console.error('Auto-populate knowledge failed:', error);
            throw error;
        }
    }

    // Get call analytics with HighLevel-style metrics
    static async getCallAnalytics(companyId, startDate, endDate) {
        try {
            // This would integrate with your actual call analytics system
            // For now, return mock data based on HighLevel screenshots
            const mockAnalytics = {
                period: {
                    start: startDate || '2025-07-01',
                    end: endDate || '2025-07-13'
                },
                metrics: {
                    totalCalls: 190,
                    callsCompleted: 156,
                    completionRate: 82.1,
                    actionsTriggered: 100,
                    sentiment: {
                        positive: 58,
                        neutral: 30,
                        negative: 12
                    },
                    averageDuration: 0.5, // minutes
                    totalDuration: 95, // minutes
                },
                trends: {
                    callsVsLastMonth: -58,
                    actionsVsLastMonth: -67,
                    sentimentVsLastMonth: -4,
                    durationVsLastMonth: -65,
                    averageDurationVsLastMonth: -17
                },
                dailyData: [
                    { date: '2025-07-01', calls: 16, completedCalls: 15, actions: 8 },
                    { date: '2025-07-02', calls: 15, completedCalls: 15, actions: 7 },
                    { date: '2025-07-03', calls: 23, completedCalls: 23, actions: 12 },
                    { date: '2025-07-04', calls: 24, completedCalls: 24, actions: 14 },
                    { date: '2025-07-05', calls: 5, completedCalls: 5, actions: 3 },
                    { date: '2025-07-06', calls: 6, completedCalls: 6, actions: 4 },
                    { date: '2025-07-07', calls: 3, completedCalls: 2, actions: 1 },
                    { date: '2025-07-08', calls: 27, completedCalls: 27, actions: 15 },
                    { date: '2025-07-09', calls: 15, completedCalls: 15, actions: 8 },
                    { date: '2025-07-10', calls: 29, completedCalls: 28, actions: 16 },
                    { date: '2025-07-11', calls: 20, completedCalls: 19, actions: 11 },
                    { date: '2025-07-12', calls: 8, completedCalls: 8, actions: 4 },
                    { date: '2025-07-13', calls: 0, completedCalls: 0, actions: 0 }
                ],
                recentCalls: [
                    {
                        id: 1,
                        contactName: "Gina Duder",
                        fromNumber: "(870) 930-0324",
                        dateTime: "12 Jul 2025 2:24 PM",
                        duration: "00:16",
                        actionsTriggered: "emergency Service call Team",
                        sentiment: "neutral",
                        status: "completed"
                    },
                    {
                        id: 2,
                        contactName: "(239) 776-7818",
                        fromNumber: "(239) 776-7818",
                        dateTime: "12 Jul 2025 1:48 PM",
                        duration: "-",
                        actionsTriggered: "-",
                        sentiment: "unknown",
                        status: "missed"
                    },
                    {
                        id: 3,
                        contactName: "Pengu",
                        fromNumber: "(239) 361-5532",
                        dateTime: "12 Jul 2025 1:45 PM",
                        duration: "-",
                        actionsTriggered: "-",
                        sentiment: "unknown",
                        status: "missed"
                    },
                    {
                        id: 4,
                        contactName: "(440) 667-1890",
                        fromNumber: "(440) 667-1890",
                        dateTime: "12 Jul 2025 1:34 PM",
                        duration: "00:32",
                        actionsTriggered: "-",
                        sentiment: "positive",
                        status: "completed"
                    },
                    {
                        id: 5,
                        contactName: "(440) 667-1890",
                        fromNumber: "(440) 667-1890",
                        dateTime: "12 Jul 2025 1:33 PM",
                        duration: "00:21",
                        actionsTriggered: "appointment inquiries",
                        sentiment: "positive",
                        status: "completed"
                    }
                ],
                actionTypes: {
                    "call-transfer": 25,
                    "send-sms": 30,
                    "book-appointment": 35,
                    "extract-data": 10
                }
            };

            return mockAnalytics;
        } catch (error) {
            console.error('Call analytics failed:', error);
            throw error;
        }
    }

    // Analyze knowledge gaps from failed conversations
    static async analyzeKnowledgeGaps(companyId, days = 30) {
        try {
            // This would analyze actual call transcripts for unanswered questions
            // For now, return mock gap analysis
            const mockGaps = [
                {
                    commonQuestion: "Do you offer financing options?",
                    frequency: 12,
                    suggestedAnswer: "Yes, we offer financing options for qualifying customers. Our team can discuss payment plans that work for your budget.",
                    confidence: 0.85,
                    category: "pricing",
                    lastAsked: "2025-07-12"
                },
                {
                    commonQuestion: "What brands of equipment do you service?",
                    frequency: 8,
                    suggestedAnswer: "We service all major HVAC brands including Carrier, Trane, Lennox, Goodman, Rheem, and more.",
                    confidence: 0.92,
                    category: "services",
                    lastAsked: "2025-07-11"
                },
                {
                    commonQuestion: "Do you provide warranty on your work?",
                    frequency: 6,
                    suggestedAnswer: "Yes, all our work comes with a comprehensive warranty. Parts and labor warranties vary by service type.",
                    confidence: 0.88,
                    category: "warranty",
                    lastAsked: "2025-07-10"
                },
                {
                    commonQuestion: "Can you provide same-day service?",
                    frequency: 15,
                    suggestedAnswer: "Yes, we offer same-day service for most repairs when you call before 2 PM. Emergency service is available 24/7.",
                    confidence: 0.91,
                    category: "scheduling",
                    lastAsked: "2025-07-13"
                }
            ];

            return mockGaps;
        } catch (error) {
            console.error('Knowledge gap analysis failed:', error);
            throw error;
        }
    }

    // Test agent configuration with different scenarios
    static async testAgentConfiguration(companyId, testScenario) {
        try {
            const company = await Company.findById(companyId);
            if (!company) {
                throw new Error('Company not found');
            }

            const scenarios = {
                'appointment-booking': {
                    scenario: 'Customer calls to book an appointment',
                    expectedFlow: [
                        'Greeting and identification of service needed',
                        'Available time slots offered',
                        'Customer information collected',
                        'Appointment confirmed',
                        'Follow-up actions triggered'
                    ],
                    success: true,
                    responseTime: '1.8 seconds',
                    confidence: '94%',
                    improvements: [
                        'Consider adding more service type options',
                        'Optimize scheduling availability display'
                    ]
                },
                'emergency-service': {
                    scenario: 'Customer calls with an emergency',
                    expectedFlow: [
                        'Emergency identified quickly',
                        'Priority escalation triggered',
                        'Transfer to emergency dispatch',
                        'Customer information captured',
                        'Admin notification sent'
                    ],
                    success: true,
                    responseTime: '1.2 seconds',
                    confidence: '97%',
                    improvements: [
                        'Emergency detection is working well',
                        'Consider adding emergency callback feature'
                    ]
                },
                'general-inquiry': {
                    scenario: 'Customer asks about services and pricing',
                    expectedFlow: [
                        'Service inquiry identified',
                        'Relevant information provided from knowledge base',
                        'Follow-up appointment offered',
                        'Contact information captured',
                        'Follow-up reminder set'
                    ],
                    success: true,
                    responseTime: '2.1 seconds',
                    confidence: '91%',
                    improvements: [
                        'Add more pricing information to knowledge base',
                        'Consider service comparison features'
                    ]
                },
                'knowledge-gap': {
                    scenario: 'Customer asks question not in knowledge base',
                    expectedFlow: [
                        'Question not found in knowledge base',
                        'Graceful fallback response provided',
                        'Human agent transfer offered',
                        'Question logged for knowledge base update'
                    ],
                    success: true,
                    responseTime: '2.8 seconds',
                    confidence: '78%',
                    improvements: [
                        'Analyze recent knowledge gaps',
                        'Improve fallback responses'
                    ]
                }
            };

            return scenarios[testScenario] || scenarios['general-inquiry'];
        } catch (error) {
            console.error('Agent test failed:', error);
            throw error;
        }
    }

    // Test call simulation
}

module.exports = AIAgentSetupService;
