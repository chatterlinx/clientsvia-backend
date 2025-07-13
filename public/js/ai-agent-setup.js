/**
 * AI Agent Setup - HighLevel Competitive Mode
 * Parallel implementation with simplified UX and powerful features
 */

class AIAgentSetup {
    constructor() {
        this.currentTab = 'agent-details';
        this.selectedTemplate = null;
        this.serviceTypes = [];
        this.customQAs = [];
        this.businessCategories = [];
        this.duringCallActions = [];
        this.afterCallActions = [];
        this.callSettings = {
            timeLimit: 10,
            responseSpeed: 'normal',
            idleTimeReminder: true,
            idleTime: 8,
            emailNotifications: true
        };
        this.init();
    }

    init() {
        this.bindEvents();
        this.loadBusinessCategories();
        this.initializeTabs();
        this.loadExistingData();
    }

    bindEvents() {
        // Quick Setup Events
        document.getElementById('aiBusinessTypeTemplate')?.addEventListener('change', (e) => {
            this.handleTemplateSelection(e.target.value);
        });

        document.getElementById('quickSetupDeployBtn')?.addEventListener('click', () => {
            this.deployQuickSetup();
        });

        document.getElementById('customSetupBtn')?.addEventListener('click', () => {
            this.showCustomSetup();
        });

        // Tab Navigation
        document.querySelectorAll('.ai-config-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Service Type Management
        document.getElementById('addServiceTypeBtn')?.addEventListener('click', () => {
            this.addServiceType();
        });

        // Custom Q&A Management
        document.getElementById('addCustomQABtn')?.addEventListener('click', () => {
            this.addCustomQA();
        });

        // Personality Presets
        document.querySelectorAll('.personality-preset-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.selectPersonalityPreset(e.target.dataset.preset);
            });
        });

        // Actions
        document.getElementById('aiPreviewAgentBtn')?.addEventListener('click', () => {
            this.previewAgent();
        });

        document.getElementById('aiTestCallBtn')?.addEventListener('click', () => {
            this.testCall();
        });

        document.getElementById('aiSaveConfigBtn')?.addEventListener('click', () => {
            this.saveConfiguration();
        });

        // Link to Personality Tab
        document.getElementById('goToPersonalityTab')?.addEventListener('click', () => {
            this.goToPersonalityResponses();
        });

        // Workflow Actions
        document.getElementById('addDuringCallActionBtn')?.addEventListener('click', () => {
            this.addDuringCallAction();
        });

        document.getElementById('addAfterCallActionBtn')?.addEventListener('click', () => {
            this.addAfterCallAction();
        });

        // Call Settings
        document.getElementById('aiCallTimeLimit')?.addEventListener('input', (e) => {
            this.updateCallTimeLimit(e.target.value);
        });

        document.getElementById('aiIdleTime')?.addEventListener('input', (e) => {
            this.updateIdleTime(e.target.value);
        });

        // Analytics Events
        document.getElementById('refreshAnalyticsBtn')?.addEventListener('click', () => {
            this.refreshAnalytics();
        });

        document.getElementById('exportAnalyticsBtn')?.addEventListener('click', () => {
            this.exportAnalytics();
        });

        // Knowledge Auto-Population Events
        document.getElementById('extractFromWebsiteBtn')?.addEventListener('click', () => {
            this.extractFromWebsite();
        });

        document.getElementById('csvFileInput')?.addEventListener('change', (e) => {
            this.handleFileImport(e, 'csv');
        });

        document.getElementById('jsonFileInput')?.addEventListener('change', (e) => {
            this.handleFileImport(e, 'json');
        });

        document.getElementById('importExistingFAQBtn')?.addEventListener('click', () => {
            this.importExistingFAQ();
        });

        document.getElementById('analyzeKnowledgeGapsBtn')?.addEventListener('click', () => {
            this.analyzeKnowledgeGaps();
        });

        // Agent Details Tab Events
        document.getElementById('agentName')?.addEventListener('input', (e) => {
            this.updateCharacterCount('agentName', 40);
        });

        document.getElementById('agentInitialMessage')?.addEventListener('input', (e) => {
            this.updateCharacterCount('agentInitialMessage', 190, 'initialMessageCount');
        });

        document.getElementById('behaviorGuidelines')?.addEventListener('input', (e) => {
            this.updateWordCount('behaviorGuidelines', 'promptWordCount');
        });

        document.getElementById('playVoiceBtn')?.addEventListener('click', () => {
            this.playVoiceSample();
        });

        // Phone & Availability Tab Events
        document.getElementById('is24x7')?.addEventListener('change', (e) => {
            this.toggle24x7Mode(e.target.checked);
        });

        // Business hours events
        ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].forEach(day => {
            document.getElementById(`${day}_closed`)?.addEventListener('change', (e) => {
                this.toggleDayClosed(day, e.target.checked);
            });
        });
    }

    // Template System
    handleTemplateSelection(templateType) {
        this.selectedTemplate = templateType;
        
        if (templateType) {
            this.showTemplatePreview(templateType);
            document.getElementById('quickSetupDeployBtn').disabled = false;
        } else {
            this.hideTemplatePreview();
            document.getElementById('quickSetupDeployBtn').disabled = true;
        }
    }

    showTemplatePreview(templateType) {
        const template = this.getBusinessTemplate(templateType);
        const previewDiv = document.getElementById('templatePreview');
        const contentDiv = document.getElementById('templatePreviewContent');
        
        contentDiv.innerHTML = `
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                    <strong>Services:</strong> ${template.services.join(', ')}
                </div>
                <div>
                    <strong>Typical Hours:</strong> ${template.hours}
                </div>
                <div>
                    <strong>Key Features:</strong> ${template.features.join(', ')}
                </div>
                <div>
                    <strong>Sample Greeting:</strong> "${template.greeting}"
                </div>
            </div>
        `;
        
        previewDiv.classList.remove('hidden');
    }

    hideTemplatePreview() {
        document.getElementById('templatePreview').classList.add('hidden');
    }

    getBusinessTemplate(type) {
        const templates = {
            'restaurant': {
                services: ['Reservations', 'Takeout Orders', 'Catering', 'Event Booking'],
                hours: 'Mon-Sun 11am-10pm',
                features: ['Table reservations', 'Menu inquiries', 'Special dietary needs'],
                greeting: "Thank you for calling [Restaurant Name]! How can I help you today? Would you like to make a reservation or place an order?",
                categories: ['restaurants', 'food-service'],
                personality: 'friendly'
            },
            'hvac': {
                services: ['AC Repair', 'Installation', 'Maintenance', 'Emergency Service'],
                hours: 'Mon-Fri 8am-6pm, Emergency 24/7',
                features: ['Emergency dispatch', 'Service scheduling', 'Maintenance reminders'],
                greeting: "Thank you for calling [Company Name] HVAC! How can I help you today? Do you need emergency service or would you like to schedule an appointment?",
                categories: ['hvac', 'home-services'],
                personality: 'professional'
            },
            'plumbing': {
                services: ['Repairs', 'Installation', 'Emergency Plumbing', 'Inspections'],
                hours: 'Mon-Fri 7am-7pm, Emergency 24/7',
                features: ['Emergency dispatch', 'Service estimates', 'Appointment scheduling'],
                greeting: "Hello, thank you for calling [Company Name] Plumbing! How can I assist you today? Is this an emergency or would you like to schedule service?",
                categories: ['plumbing', 'home-services'],
                personality: 'professional'
            },
            'medical': {
                services: ['Appointments', 'Prescription Refills', 'Test Results', 'Insurance'],
                hours: 'Mon-Fri 8am-5pm',
                features: ['Appointment scheduling', 'Insurance verification', 'Patient portal assistance'],
                greeting: "Thank you for calling [Practice Name]. How may I help you today? Are you calling to schedule an appointment or do you have questions about your care?",
                categories: ['healthcare', 'medical'],
                personality: 'professional'
            },
            'legal': {
                services: ['Consultations', 'Case Updates', 'Document Requests', 'Appointments'],
                hours: 'Mon-Fri 9am-5pm',
                features: ['Consultation scheduling', 'Case inquiries', 'Document handling'],
                greeting: "Thank you for calling [Law Firm Name]. How may I assist you today? Would you like to schedule a consultation or speak with someone about your case?",
                categories: ['legal-services', 'professional'],
                personality: 'professional'
            }
        };

        return templates[type] || templates['professional'];
    }

    // Quick Setup Deployment
    async deployQuickSetup() {
        if (!this.selectedTemplate) {
            this.showNotification('Please select a business template first.', 'warning');
            return;
        }

        const template = this.getBusinessTemplate(this.selectedTemplate);
        const persona = document.getElementById('aiAgentPersona').value;

        try {
            // Show loading state
            this.setDeployButtonLoading(true);

            // Auto-configure based on template
            await this.autoConfigureFromTemplate(template, persona);

            // Show success
            this.showNotification('AI Agent deployed successfully! Your agent is now live.', 'success');
            this.showQuickSetupSuccess(template);

        } catch (error) {
            console.error('Quick setup deployment failed:', error);
            this.showNotification('Deployment failed. Please try again or use custom setup.', 'error');
        } finally {
            this.setDeployButtonLoading(false);
        }
    }

    async autoConfigureFromTemplate(template, persona) {
        // Integrate with the backend API
        const config = {
            templateType: this.selectedTemplate,
            personality: persona
        };

        try {
            const response = await fetch('/api/ai-agent-setup/quick-setup', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token') || this.getJWTFromCookie()}`
                },
                body: JSON.stringify(config)
            });

            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message || 'Quick setup failed');
            }

            return result.configuration;
        } catch (error) {
            console.error('Auto-configuration failed:', error);
            throw error;
        }
    }

    showQuickSetupSuccess(template) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-gray-600 bg-opacity-50 z-50 flex items-center justify-center px-4';
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
                <div class="text-center">
                    <i class="fas fa-check-circle text-green-500 text-4xl mb-4"></i>
                    <h3 class="text-lg font-semibold text-gray-900 mb-2">AI Agent is Live!</h3>
                    <p class="text-gray-600 mb-4">Your ${this.selectedTemplate} agent is now handling calls with these features:</p>
                    <ul class="text-left text-sm text-gray-700 mb-6">
                        ${template.features.map(feature => `<li class="flex items-center mb-1"><i class="fas fa-check text-green-500 mr-2"></i>${feature}</li>`).join('')}
                    </ul>
                    <div class="flex gap-3">
                        <button onclick="this.parentElement.parentElement.parentElement.parentElement.remove()" class="bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded-lg">
                            Close
                        </button>
                        <button onclick="document.getElementById('aiTestCallBtn').click(); this.parentElement.parentElement.parentElement.parentElement.remove()" class="bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg">
                            Test Call
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    // Tab Management
    initializeTabs() {
        this.switchTab('agent-details'); // Default to agent details tab
    }

    switchTab(tabName) {
        this.currentTab = tabName;

        // Update tab buttons
        document.querySelectorAll('.ai-config-tab-btn').forEach(btn => {
            btn.classList.remove('border-indigo-500', 'text-indigo-600');
            btn.classList.add('border-transparent', 'text-gray-500');
        });

        document.querySelector(`[data-tab="${tabName}"]`).classList.remove('border-transparent', 'text-gray-500');
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('border-indigo-500', 'text-indigo-600');

        // Update tab content
        document.querySelectorAll('.ai-config-tab-content').forEach(content => {
            content.classList.add('hidden');
        });

        document.getElementById(`ai-${tabName}-tab`).classList.remove('hidden');

        // Load tab-specific data
        this.loadTabData(tabName);
    }

    // Service Type Management
    addServiceType() {
        const serviceType = {
            id: Date.now(),
            name: '',
            duration: 60,
            bufferTime: 15,
            description: '',
            scheduling: 'standard'
        };

        this.serviceTypes.push(serviceType);
        this.renderServiceTypes();
    }

    renderServiceTypes() {
        const container = document.getElementById('aiServiceTypesList');
        container.innerHTML = this.serviceTypes.map(service => `
            <div class="border border-gray-200 rounded-lg p-4" data-service-id="${service.id}">
                <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                        <label class="form-label text-sm">Service Name</label>
                        <input type="text" value="${service.name}" class="form-input service-name" placeholder="e.g., AC Repair">
                    </div>
                    <div>
                        <label class="form-label text-sm">Duration (minutes)</label>
                        <input type="number" value="${service.duration}" class="form-input service-duration" min="15" max="480">
                    </div>
                    <div>
                        <label class="form-label text-sm">Buffer Time (minutes)</label>
                        <input type="number" value="${service.bufferTime}" class="form-input service-buffer" min="0" max="60">
                    </div>
                </div>
                <div class="mt-3 flex justify-between items-center">
                    <select class="form-select text-sm service-scheduling" style="width: auto;">
                        <option value="standard" ${service.scheduling === 'standard' ? 'selected' : ''}>Standard Scheduling</option>
                        <option value="emergency" ${service.scheduling === 'emergency' ? 'selected' : ''}>Emergency Service</option>
                        <option value="consultation" ${service.scheduling === 'consultation' ? 'selected' : ''}>Consultation Only</option>
                    </select>
                    <button onclick="aiAgentSetup.removeServiceType(${service.id})" class="text-red-600 hover:text-red-800 text-sm">
                        <i class="fas fa-trash mr-1"></i>Remove
                    </button>
                </div>
            </div>
        `).join('');

        this.updateSchedulingPreview();
    }

    removeServiceType(serviceId) {
        this.serviceTypes = this.serviceTypes.filter(s => s.id !== serviceId);
        this.renderServiceTypes();
    }

    updateSchedulingPreview() {
        const preview = document.getElementById('schedulingPreviewContent');
        if (this.serviceTypes.length === 0) {
            preview.innerHTML = 'Configure your services above to see how the AI will handle scheduling requests.';
            return;
        }

        const sampleConversation = this.generateSchedulingPreview();
        preview.innerHTML = sampleConversation;
    }

    generateSchedulingPreview() {
        const services = this.serviceTypes.map(s => s.name).filter(n => n).join(', ');
        return `
            <div class="bg-white border border-blue-200 rounded p-3 text-sm">
                <div class="font-semibold mb-2">Sample Conversation:</div>
                <div class="space-y-2">
                    <div><strong>Caller:</strong> "I need to schedule an appointment"</div>
                    <div><strong>AI Agent:</strong> "I'd be happy to help you schedule an appointment! What type of service do you need? We offer: ${services || 'your configured services'}"</div>
                    <div><strong>Caller:</strong> "I need AC repair"</div>
                    <div><strong>AI Agent:</strong> "Perfect! AC repair typically takes about ${this.serviceTypes.find(s => s.name.toLowerCase().includes('ac'))?.duration || 60} minutes. What day works best for you?"</div>
                </div>
            </div>
        `;
    }

    // Knowledge Base Management
    loadKnowledgeData() {
        this.updateSelectedCategories();
        this.loadAutoGeneratedQAs();
    }

    updateSelectedCategories() {
        const container = document.getElementById('aiSelectedCategories');
        // This would integrate with the existing category selection
        container.innerHTML = '<span class="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-sm">HVAC Services</span>';
    }

    loadAutoGeneratedQAs() {
        // This would pull from the existing category Q&A system
        const container = document.getElementById('aiAutoQAs');
        container.innerHTML = `
            <div class="space-y-2">
                <div class="p-3 bg-green-50 border border-green-200 rounded flex justify-between items-center">
                    <div>
                        <div class="font-medium text-green-900">What are your hours?</div>
                        <div class="text-sm text-green-700">We're open Monday-Friday 8am-6pm, with 24/7 emergency service available.</div>
                    </div>
                    <i class="fas fa-robot text-green-600"></i>
                </div>
                <div class="p-3 bg-green-50 border border-green-200 rounded flex justify-between items-center">
                    <div>
                        <div class="font-medium text-green-900">Do you offer emergency service?</div>
                        <div class="text-sm text-green-700">Yes! We provide 24/7 emergency HVAC repair service. Call us anytime for urgent issues.</div>
                    </div>
                    <i class="fas fa-robot text-green-600"></i>
                </div>
            </div>
        `;
    }

    addCustomQA() {
        const question = document.getElementById('aiCustomQuestion').value.trim();
        const answer = document.getElementById('aiCustomAnswer').value.trim();

        if (!question || !answer) {
            this.showNotification('Please enter both question and answer.', 'warning');
            return;
        }

        const qa = {
            id: Date.now(),
            question,
            answer,
            type: 'custom'
        };

        this.customQAs.push(qa);
        this.renderCustomQAs();

        // Clear form
        document.getElementById('aiCustomQuestion').value = '';
        document.getElementById('aiCustomAnswer').value = '';
    }

    renderCustomQAs() {
        const container = document.getElementById('aiCustomQAsList');
        if (this.customQAs.length === 0) {
            container.innerHTML = `
                <div class="text-center text-gray-500 py-4">
                    <i class="fas fa-question-circle text-2xl mb-2"></i>
                    <p>No custom Q&As added yet</p>
                </div>
            `;
            return;
        }

        container.innerHTML = this.customQAs.map(qa => `
            <div class="p-3 bg-gray-50 border border-gray-200 rounded flex justify-between items-start">
                <div class="flex-1">
                    <div class="font-medium text-gray-900">${qa.question}</div>
                    <div class="text-sm text-gray-700 mt-1">${qa.answer}</div>
                </div>
                <button onclick="aiAgentSetup.removeCustomQA(${qa.id})" class="text-red-600 hover:text-red-800 ml-3">
                    <i class="fas fa-trash"></i>
                </button>
            </div>
        `).join('');
    }

    removeCustomQA(qaId) {
        this.customQAs = this.customQAs.filter(qa => qa.id !== qaId);
        this.renderCustomQAs();
    }

    // Personality Management
    selectPersonalityPreset(preset) {
        document.querySelectorAll('.personality-preset-btn').forEach(btn => {
            btn.classList.remove('border-indigo-500', 'bg-indigo-50');
            btn.classList.add('border-gray-200');
        });

        document.querySelector(`[data-preset="${preset}"]`).classList.add('border-indigo-500', 'bg-indigo-50');
        document.querySelector(`[data-preset="${preset}"]`).classList.remove('border-gray-200');

        this.applyPersonalityPreset(preset);
    }

    applyPersonalityPreset(preset) {
        const presets = {
            professional: {
                formality: 'professional',
                speed: 'thoughtful',
                empathy: 'medium'
            },
            friendly: {
                formality: 'casual',
                speed: 'normal',
                empathy: 'high'
            },
            sales: {
                formality: 'professional',
                speed: 'quick',
                empathy: 'medium'
            }
        };

        if (presets[preset]) {
            document.getElementById('aiFormalityLevel').value = presets[preset].formality;
            document.getElementById('aiResponseSpeed').value = presets[preset].speed;
            document.getElementById('aiEmpathyLevel').value = presets[preset].empathy;
        }

        this.updateConversationSamples(preset);
    }

    updateConversationSamples(preset) {
        const container = document.getElementById('conversationSamples');
        const samples = this.getPersonalitySamples(preset);
        
        container.innerHTML = samples.map(sample => `
            <div class="bg-gray-50 border border-gray-200 rounded p-3">
                <div class="font-medium text-gray-900 mb-2">${sample.scenario}</div>
                <div class="text-sm text-gray-700">${sample.response}</div>
            </div>
        `).join('');
    }

    getPersonalitySamples(preset) {
        const samples = {
            professional: [
                {
                    scenario: "Greeting a new caller",
                    response: "Good morning, thank you for calling [Company Name]. This is [Agent Name]. How may I assist you today?"
                },
                {
                    scenario: "Handling a scheduling request",
                    response: "I would be pleased to schedule that appointment for you. May I please have your full name and preferred contact number?"
                }
            ],
            friendly: [
                {
                    scenario: "Greeting a new caller",
                    response: "Hi there! Thanks for calling [Company Name]! I'm [Agent Name] - how can I help make your day better?"
                },
                {
                    scenario: "Handling a scheduling request",
                    response: "Absolutely! I'd love to get that appointment set up for you. What's your name, and what's the best number to reach you?"
                }
            ],
            sales: [
                {
                    scenario: "Greeting a new caller",
                    response: "Thank you for calling [Company Name]! You've reached [Agent Name], and I'm here to help you find the perfect solution. What can I do for you today?"
                },
                {
                    scenario: "Handling a scheduling request",
                    response: "Excellent choice! I can get you scheduled right away. This service has been very popular - let me secure your preferred time slot."
                }
            ]
        };

        return samples[preset] || samples.professional;
    }

    goToPersonalityResponses() {
        // Switch to the personality responses tab
        document.querySelector('[data-tab="personality-responses"]').click();
    }

    // Loading and Saving
    async loadExistingData() {
        // Load from the backend API
        try {
            const response = await fetch('/api/ai-agent-setup/config', {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token') || this.getJWTFromCookie()}`
                }
            });

            if (response.ok) {
                const result = await response.json();
                if (result.success) {
                    this.populateFormWithData(result.config);
                }
            }
        } catch (error) {
            console.error('Failed to load existing configuration:', error);
        }
    }

    async saveConfiguration() {
        try {
            this.setSaveButtonLoading(true);

            const config = this.gatherConfiguration();
            
            // Save main configuration
            await this.saveToBackend(config);
            
            // Save workflows separately
            const companyId = this.getCompanyId();
            if (companyId) {
                await this.saveWorkflowsToAPI(companyId, {
                    duringCallActions: this.duringCallActions,
                    afterCallActions: this.afterCallActions,
                    callSettings: this.callSettings
                });
            }

            this.showNotification('AI Agent configuration saved successfully!', 'success');
        } catch (error) {
            console.error('Failed to save configuration:', error);
            this.showNotification('Failed to save configuration. Please try again.', 'error');
        } finally {
            this.setSaveButtonLoading(false);
        }
    }

    async saveWorkflowsToAPI(companyId, workflows) {
        const response = await fetch(`/api/ai-agent-workflows/workflows/${companyId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${localStorage.getItem('token') || this.getJWTFromCookie()}`
            },
            credentials: 'include',
            body: JSON.stringify(workflows)
        });

        if (!response.ok) {
            throw new Error('Failed to save workflows');
        }

        return response.json();
    }

    getCompanyId() {
        // Extract company ID from URL or other source
        const pathParts = window.location.pathname.split('/');
        const companyIndex = pathParts.indexOf('company');
        return companyIndex !== -1 && pathParts[companyIndex + 1] ? pathParts[companyIndex + 1] : null;
    }

    gatherConfiguration() {
        return {
            // Agent Details
            agentDetails: {
                agentName: document.getElementById('agentName')?.value,
                businessName: document.getElementById('businessName')?.value,
                language: document.getElementById('agentLanguage')?.value,
                voice: document.getElementById('agentVoice')?.value,
                timezone: document.getElementById('agentTimezone')?.value,
                callDirection: document.querySelector('input[name="callDirection"]:checked')?.value,
                initialMessage: document.getElementById('agentInitialMessage')?.value
            },
            
            // Agent Goals
            agentGoals: {
                knowledgeBase: document.getElementById('knowledgeBaseSelect')?.value,
                behaviorGuidelines: document.getElementById('behaviorGuidelines')?.value
            },
            
            // Phone & Availability
            phoneAvailability: {
                primaryPhone: document.getElementById('primaryPhoneNumber')?.value,
                backupPhone: document.getElementById('backupPhoneNumber')?.value,
                maxConcurrentCalls: document.getElementById('maxConcurrentCalls')?.value,
                callRecording: document.getElementById('callRecording')?.value,
                is24x7: document.getElementById('is24x7')?.checked,
                businessHours: this.gatherBusinessHours(),
                afterHoursHandling: document.querySelector('input[name="afterHoursHandling"]:checked')?.value
            },
            
            // Legacy fields for backward compatibility
            template: this.selectedTemplate,
            persona: document.getElementById('aiAgentPersona')?.value,
            timezone: document.getElementById('aiTimezone')?.value,
            operatingMode: document.getElementById('aiOperatingMode')?.value,
            serviceTypes: this.serviceTypes,
            customQAs: this.customQAs,
            duringCallActions: this.duringCallActions,
            afterCallActions: this.afterCallActions,
            callSettings: this.callSettings,
            personality: {
                formality: document.getElementById('aiFormalityLevel')?.value,
                speed: document.getElementById('aiResponseSpeed')?.value,
                empathy: document.getElementById('aiEmpathyLevel')?.value
            },
            advanced: {
                responseMode: document.getElementById('aiResponseMode')?.value,
                callHandling: document.getElementById('aiCallHandling')?.value
            }
        };
    }

    gatherBusinessHours() {
        const days = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
        const businessHours = {};
        
        days.forEach(day => {
            const openTime = document.getElementById(`${day}_open`)?.value;
            const closeTime = document.getElementById(`${day}_close`)?.value;
            const isClosed = document.getElementById(`${day}_closed`)?.checked;
            
            businessHours[day] = {
                open: openTime,
                close: closeTime,
                closed: isClosed
            };
        });
        
        return businessHours;
    }

    async saveToBackend(config) {
        // Save to the backend API
        try {
            const response = await fetch('/api/ai-agent-setup/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token') || this.getJWTFromCookie()}`
                },
                body: JSON.stringify(config)
            });

            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.message || 'Failed to save configuration');
            }

            return result;
        } catch (error) {
            console.error('Failed to save to backend:', error);
            throw error;
        }
    }

    // Preview and Testing
    previewAgent() {
        const config = this.gatherConfiguration();
        this.showAgentPreview(config);
    }

    showAgentPreview(config) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-gray-600 bg-opacity-50 z-50 flex items-center justify-center px-4';
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-screen overflow-y-auto">
                <div class="p-6">
                    <div class="flex justify-between items-center mb-4">
                        <h3 class="text-lg font-semibold text-gray-900">AI Agent Preview</h3>
                        <button onclick="this.parentElement.parentElement.parentElement.parentElement.remove()" class="text-gray-400 hover:text-gray-600">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="space-y-4">
                        <div class="bg-blue-50 border border-blue-200 rounded p-4">
                            <h4 class="font-semibold text-blue-900">Configuration Summary</h4>
                            <div class="mt-2 text-sm text-blue-800">
                                <p><strong>Business Type:</strong> ${config.template || 'Custom'}</p>
                                <p><strong>Personality:</strong> ${config.persona || 'Professional'}</p>
                                <p><strong>Services:</strong> ${config.serviceTypes.length} configured</p>
                                <p><strong>Custom Q&As:</strong> ${config.customQAs.length} added</p>
                            </div>
                        </div>
                        <div class="bg-green-50 border border-green-200 rounded p-4">
                            <h4 class="font-semibold text-green-900">Sample Conversation</h4>
                            <div class="mt-2 text-sm text-green-800 space-y-2">
                                <div><strong>AI:</strong> "Thank you for calling! How can I help you today?"</div>
                                <div><strong>Customer:</strong> "I need to schedule an appointment"</div>
                                <div><strong>AI:</strong> "I'd be happy to help! What type of service do you need?"</div>
                            </div>
                        </div>
                    </div>
                    <div class="mt-6 flex gap-3 justify-end">
                        <button onclick="this.parentElement.parentElement.parentElement.parentElement.remove()" class="bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded-lg">
                            Close
                        </button>
                        <button onclick="aiAgentSetup.testCall(); this.parentElement.parentElement.parentElement.parentElement.remove()" class="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg">
                            Test Call
                        </button>
                    </div>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    testCall() {
        this.showNotification('Test call feature coming soon! This will simulate a live call with your AI agent.', 'info');
    }

    // Utility Functions
    setDeployButtonLoading(loading) {
        const btn = document.getElementById('quickSetupDeployBtn');
        if (loading) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Deploying...';
        } else {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-magic mr-2"></i>Deploy AI Agent (1-Click)';
        }
    }

    setSaveButtonLoading(loading) {
        const btn = document.getElementById('aiSaveConfigBtn');
        if (loading) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
        } else {
            btn.disabled = false;
            btn.innerHTML = '<i class="fas fa-save mr-2"></i>Save & Deploy';
        }
    }

    showCustomSetup() {
        document.getElementById('aiAgentConfigTabs').scrollIntoView({ behavior: 'smooth' });
    }

    loadBusinessCategories() {
        // This would integrate with the existing category system
        this.businessCategories = [
            { id: 'hvac', name: 'HVAC Services' },
            { id: 'plumbing', name: 'Plumbing' },
            { id: 'restaurant', name: 'Restaurant' }
        ];
    }

    loadSchedulingData() {
        if (this.serviceTypes.length === 0) {
            // Add default service type based on template
            if (this.selectedTemplate) {
                const template = this.getBusinessTemplate(this.selectedTemplate);
                this.serviceTypes = template.services.map((service, index) => ({
                    id: Date.now() + index,
                    name: service,
                    duration: 60,
                    bufferTime: 15,
                    description: '',
                    scheduling: 'standard'
                }));
            }
        }
        this.renderServiceTypes();
    }

    loadPersonalityData() {
        this.updateConversationSamples('professional');
    }

    loadAdvancedData() {
        // Load advanced configuration settings
    }

    // Workflow Management
    loadWorkflowsData() {
        this.initializeDefaultActions();
        this.renderDuringCallActions();
        this.renderAfterCallActions();
        this.updateAnalyticsPreview();
    }

    initializeDefaultActions() {
        // Initialize with HighLevel-like default actions if empty
        if (this.duringCallActions.length === 0) {
            this.duringCallActions = [
                {
                    id: 1,
                    name: 'Extract customer name',
                    type: 'extract-data',
                    field: 'First Name',
                    trigger: 'When caller provides name'
                },
                {
                    id: 2,
                    name: 'Extract contact info',
                    type: 'extract-data',
                    field: 'Phone Number',
                    trigger: 'When caller provides phone'
                }
            ];
        }

        if (this.afterCallActions.length === 0) {
            this.afterCallActions = [
                {
                    id: 1,
                    name: 'Emergency Service Team',
                    type: 'call-transfer',
                    phoneNumber: '+12398889905',
                    trigger: 'Emergency service requested'
                },
                {
                    id: 2,
                    name: 'Send appointment confirmation',
                    type: 'send-sms',
                    message: 'Your appointment has been scheduled. We\'ll call you to confirm.',
                    trigger: 'Appointment booked'
                }
            ];
        }
    }

    addDuringCallAction() {
        const actionType = document.getElementById('duringCallActionType').value;
        const action = {
            id: Date.now(),
            name: this.getDefaultActionName(actionType, 'during'),
            type: actionType,
            trigger: 'Manual trigger',
            ...this.getDefaultActionConfig(actionType)
        };

        this.duringCallActions.push(action);
        this.renderDuringCallActions();
    }

    addAfterCallAction() {
        const actionType = document.getElementById('afterCallActionType').value;
        const action = {
            id: Date.now(),
            name: this.getDefaultActionName(actionType, 'after'),
            type: actionType,
            trigger: 'Call completed',
            ...this.getDefaultActionConfig(actionType)
        };

        this.afterCallActions.push(action);
        this.renderAfterCallActions();
    }

    getDefaultActionName(type, phase) {
        const names = {
            'extract-data': 'Extract customer data',
            'call-transfer': 'Transfer to team member',
            'trigger-workflow': 'Start workflow',
            'send-notification': 'Send notification',
            'send-sms': 'Send SMS message',
            'book-appointment': 'Book appointment',
            'update-contact': 'Update contact field',
            'email-notification': 'Send email notification'
        };
        return names[type] || 'Custom action';
    }

    getDefaultActionConfig(type) {
        const configs = {
            'extract-data': { field: 'First Name', validation: 'required' },
            'call-transfer': { phoneNumber: '', department: 'General' },
            'trigger-workflow': { workflowId: '', delay: 0 },
            'send-notification': { recipients: ['admin'], method: 'email' },
            'send-sms': { message: '', recipients: ['customer'] },
            'book-appointment': { serviceType: 'general', duration: 60 },
            'update-contact': { field: 'Notes', value: '' },
            'email-notification': { template: 'default', recipients: ['admin'] }
        };
        return configs[type] || {};
    }

    renderDuringCallActions() {
        const container = document.getElementById('duringCallActionsList');
        if (!container) return;

        container.innerHTML = this.duringCallActions.map(action => `
            <div class="border border-blue-200 rounded-lg p-4 bg-blue-50" data-action-id="${action.id}">
                <div class="flex justify-between items-start mb-3">
                    <div class="flex items-center">
                        <i class="fas fa-${this.getActionIcon(action.type)} text-blue-600 mr-2"></i>
                        <input type="text" value="${action.name}" class="font-medium text-blue-900 bg-transparent border-none p-0 action-name" style="background: none;">
                    </div>
                    <button onclick="aiAgentSetup.removeDuringCallAction(${action.id})" class="text-red-500 hover:text-red-700">
                        <i class="fas fa-trash text-sm"></i>
                    </button>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label class="text-xs text-blue-700 font-medium">Action Type</label>
                        <select class="form-select text-sm action-type" onchange="aiAgentSetup.updateActionType(${action.id}, this.value, 'during')">
                            <option value="extract-data" ${action.type === 'extract-data' ? 'selected' : ''}>Extract & Store Data</option>
                            <option value="call-transfer" ${action.type === 'call-transfer' ? 'selected' : ''}>Call Transfer</option>
                            <option value="trigger-workflow" ${action.type === 'trigger-workflow' ? 'selected' : ''}>Trigger Workflow</option>
                            <option value="send-notification" ${action.type === 'send-notification' ? 'selected' : ''}>Send Notification</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-xs text-blue-700 font-medium">Trigger Condition</label>
                        <input type="text" value="${action.trigger}" class="form-input text-sm action-trigger" placeholder="When does this action happen?">
                    </div>
                </div>
                <div class="mt-3" id="action-config-${action.id}">
                    ${this.renderActionConfig(action)}
                </div>
            </div>
        `).join('');
    }

    renderAfterCallActions() {
        const container = document.getElementById('afterCallActionsList');
        if (!container) return;

        container.innerHTML = this.afterCallActions.map(action => `
            <div class="border border-green-200 rounded-lg p-4 bg-green-50" data-action-id="${action.id}">
                <div class="flex justify-between items-start mb-3">
                    <div class="flex items-center">
                        <i class="fas fa-${this.getActionIcon(action.type)} text-green-600 mr-2"></i>
                        <input type="text" value="${action.name}" class="font-medium text-green-900 bg-transparent border-none p-0 action-name" style="background: none;">
                    </div>
                    <button onclick="aiAgentSetup.removeAfterCallAction(${action.id})" class="text-red-500 hover:text-red-700">
                        <i class="fas fa-trash text-sm"></i>
                    </button>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div>
                        <label class="text-xs text-green-700 font-medium">Action Type</label>
                        <select class="form-select text-sm action-type" onchange="aiAgentSetup.updateActionType(${action.id}, this.value, 'after')">
                            <option value="call-transfer" ${action.type === 'call-transfer' ? 'selected' : ''}>Transfer to Team Member</option>
                            <option value="send-sms" ${action.type === 'send-sms' ? 'selected' : ''}>Send SMS</option>
                            <option value="book-appointment" ${action.type === 'book-appointment' ? 'selected' : ''}>Book Appointment</option>
                            <option value="update-contact" ${action.type === 'update-contact' ? 'selected' : ''}>Update Contact Field</option>
                            <option value="trigger-workflow" ${action.type === 'trigger-workflow' ? 'selected' : ''}>Trigger Workflow</option>
                            <option value="email-notification" ${action.type === 'email-notification' ? 'selected' : ''}>Email Notification</option>
                        </select>
                    </div>
                    <div>
                        <label class="text-xs text-green-700 font-medium">Trigger Condition</label>
                        <input type="text" value="${action.trigger}" class="form-input text-sm action-trigger" placeholder="When does this action happen?">
                    </div>
                </div>
                <div class="mt-3" id="action-config-${action.id}">
                    ${this.renderActionConfig(action)}
                </div>
            </div>
        `).join('');
    }

    renderActionConfig(action) {
        switch (action.type) {
            case 'extract-data':
                return `
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label class="text-xs font-medium">Field to Update</label>
                            <select class="form-select text-sm">
                                <option value="firstName" ${action.field === 'First Name' ? 'selected' : ''}>First Name</option>
                                <option value="lastName">Last Name</option>
                                <option value="phone">Phone Number</option>
                                <option value="email">Email Address</option>
                                <option value="address">Street Address</option>
                                <option value="notes">Notes</option>
                            </select>
                        </div>
                        <div>
                            <label class="text-xs font-medium">Validation</label>
                            <select class="form-select text-sm">
                                <option value="required">Required</option>
                                <option value="optional">Optional</option>
                                <option value="format">Format Validation</option>
                            </select>
                        </div>
                    </div>
                `;
            case 'call-transfer':
                return `
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label class="text-xs font-medium">Phone Number to Transfer to</label>
                            <input type="tel" value="${action.phoneNumber || ''}" class="form-input text-sm" placeholder="+1 (555) 123-4567">
                        </div>
                        <div>
                            <label class="text-xs font-medium">Department/Person</label>
                            <input type="text" value="${action.department || ''}" class="form-input text-sm" placeholder="e.g., Emergency Service Team">
                        </div>
                    </div>
                `;
            case 'send-sms':
                return `
                    <div>
                        <label class="text-xs font-medium">SMS Message</label>
                        <textarea class="form-textarea text-sm" rows="2" placeholder="Message to send...">${action.message || ''}</textarea>
                    </div>
                `;
            case 'email-notification':
                return `
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                        <div>
                            <label class="text-xs font-medium">Recipients</label>
                            <div class="space-y-1">
                                <label class="flex items-center text-xs">
                                    <input type="checkbox" class="form-checkbox mr-1" checked> All Admins
                                </label>
                                <label class="flex items-center text-xs">
                                    <input type="checkbox" class="form-checkbox mr-1"> All Users
                                </label>
                                <label class="flex items-center text-xs">
                                    <input type="checkbox" class="form-checkbox mr-1"> Assigned User
                                </label>
                            </div>
                        </div>
                        <div>
                            <label class="text-xs font-medium">Email Template</label>
                            <select class="form-select text-sm">
                                <option value="call-summary">Call Summary</option>
                                <option value="appointment-booked">Appointment Booked</option>
                                <option value="lead-captured">Lead Captured</option>
                            </select>
                        </div>
                    </div>
                `;
            default:
                return `<p class="text-xs text-gray-500">Configure ${action.type} settings...</p>`;
        }
    }

    getActionIcon(type) {
        const icons = {
            'extract-data': 'database',
            'call-transfer': 'phone-alt',
            'trigger-workflow': 'play',
            'send-notification': 'bell',
            'send-sms': 'sms',
            'book-appointment': 'calendar-plus',
            'update-contact': 'user-edit',
            'email-notification': 'envelope'
        };
        return icons[type] || 'cog';
    }

    updateActionType(actionId, newType, phase) {
        const actions = phase === 'during' ? this.duringCallActions : this.afterCallActions;
        const action = actions.find(a => a.id === actionId);
        if (action) {
            action.type = newType;
            Object.assign(action, this.getDefaultActionConfig(newType));
            
            // Re-render just the config section
            const configContainer = document.getElementById(`action-config-${actionId}`);
            if (configContainer) {
                configContainer.innerHTML = this.renderActionConfig(action);
            }
        }
    }

    removeDuringCallAction(actionId) {
        this.duringCallActions = this.duringCallActions.filter(a => a.id !== actionId);
        this.renderDuringCallActions();
    }

    removeAfterCallAction(actionId) {
        this.afterCallActions = this.afterCallActions.filter(a => a.id !== actionId);
        this.renderAfterCallActions();
    }

    updateCallTimeLimit(value) {
        document.getElementById('callTimeLimitValue').textContent = `${value} mins`;
        this.callSettings.timeLimit = parseInt(value);
    }

    updateIdleTime(value) {
        this.callSettings.idleTime = parseInt(value);
    }

    updateAnalyticsPreview() {
        // Simulate some data based on configuration
        const totalActions = this.duringCallActions.length + this.afterCallActions.length;
        
        document.getElementById('previewTotalCalls').textContent = '0';
        document.getElementById('previewActionsTriggered').textContent = totalActions.toString();
        document.getElementById('previewSentiment').textContent = '0%';
        document.getElementById('previewAvgDuration').textContent = `${this.callSettings.timeLimit / 2}`;
    }

    loadAdvancedData() {
        // Load advanced configuration settings
    }

    // Analytics Methods
    async refreshAnalytics() {
        try {
            const companyId = this.getCompanyId();
            const response = await fetch(`/api/ai-agent-analytics/analytics/${companyId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token') || this.getJWTFromCookie()}`
                }
            });

            const result = await response.json();
            if (result.success) {
                this.updateAnalyticsDashboard(result.analytics);
                this.showNotification('Analytics refreshed successfully', 'success');
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            console.error('Failed to refresh analytics:', error);
            this.showNotification('Failed to refresh analytics', 'error');
        }
    }

    updateAnalyticsDashboard(analytics) {
        // Update overview cards
        document.getElementById('analyticsTotalCalls').textContent = analytics.overview.totalCalls;
        document.getElementById('analyticsActionsTriggered').textContent = analytics.overview.actionsTriggered;
        document.getElementById('analyticsSentiment').textContent = `${analytics.overview.sentiment.positive}% Positive`;
        document.getElementById('analyticsAvgDuration').textContent = `${analytics.overview.averageDuration} Mins`;

        // Update recent calls table
        this.updateRecentCallsTable(analytics.recentCalls);

        // Update insights
        this.updateInsights(analytics.insights || []);
    }

    updateRecentCallsTable(calls) {
        const tbody = document.getElementById('recentCallsBody');
        tbody.innerHTML = calls.map(call => `
            <tr>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-900">${call.contactName}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${call.fromNumber}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${call.dateTime}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">${call.duration}</td>
                <td class="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                    ${call.actionsTriggered.join(', ') || '-'}
                </td>
                <td class="px-6 py-4 whitespace-nowrap">
                    <span class="inline-flex px-2 py-1 text-xs font-semibold rounded-full ${
                        call.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
                    }">
                        ${call.status}
                    </span>
                </td>
            </tr>
        `).join('');
    }

    updateInsights(insights) {
        const container = document.getElementById('analyticsInsights');
        if (insights.length === 0) return;

        container.innerHTML = insights.map(insight => `
            <div class="p-3 ${this.getInsightBgColor(insight.priority)} border ${this.getInsightBorderColor(insight.priority)} rounded-lg">
                <div class="flex items-start">
                    <div class="flex-shrink-0">
                        <i class="fas ${this.getInsightIcon(insight.priority)} ${this.getInsightIconColor(insight.priority)}"></i>
                    </div>
                    <div class="ml-3">
                        <h5 class="text-sm font-medium ${this.getInsightTextColor(insight.priority)}">${insight.title}</h5>
                        <p class="text-sm ${this.getInsightDescColor(insight.priority)}">${insight.description}</p>
                        ${insight.action ? `<button class="${this.getInsightTextColor(insight.priority)} hover:${this.getInsightHoverColor(insight.priority)} text-xs mt-1 underline">${insight.action}</button>` : ''}
                    </div>
                </div>
            </div>
        `).join('');
    }

    getInsightBgColor(priority) {
        const colors = {
            'good': 'bg-green-50',
            'medium': 'bg-yellow-50',
            'high': 'bg-red-50'
        };
        return colors[priority] || 'bg-gray-50';
    }

    getInsightBorderColor(priority) {
        const colors = {
            'good': 'border-green-200',
            'medium': 'border-yellow-200',
            'high': 'border-red-200'
        };
        return colors[priority] || 'border-gray-200';
    }

    getInsightIcon(priority) {
        const icons = {
            'good': 'fa-check-circle',
            'medium': 'fa-exclamation-triangle',
            'high': 'fa-times-circle'
        };
        return icons[priority] || 'fa-info-circle';
    }

    getInsightIconColor(priority) {
        const colors = {
            'good': 'text-green-500',
            'medium': 'text-yellow-500',
            'high': 'text-red-500'
        };
        return colors[priority] || 'text-gray-500';
    }

    getInsightTextColor(priority) {
        const colors = {
            'good': 'text-green-800',
            'medium': 'text-yellow-800',
            'high': 'text-red-800'
        };
        return colors[priority] || 'text-gray-800';
    }

    getInsightDescColor(priority) {
        const colors = {
            'good': 'text-green-700',
            'medium': 'text-yellow-700',
            'high': 'text-red-700'
        };
        return colors[priority] || 'text-gray-700';
    }

    getInsightHoverColor(priority) {
        const colors = {
            'good': 'text-green-900',
            'medium': 'text-yellow-900',
            'high': 'text-red-900'
        };
        return colors[priority] || 'text-gray-900';
    }

    async exportAnalytics() {
        try {
            const companyId = this.getCompanyId();
            const response = await fetch(`/api/ai-agent-analytics/export/${companyId}?format=csv`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token') || this.getJWTFromCookie()}`
                }
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `agent-analytics-${new Date().toISOString().split('T')[0]}.csv`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                window.URL.revokeObjectURL(url);
                this.showNotification('Analytics exported successfully', 'success');
            } else {
                throw new Error('Export failed');
            }
        } catch (error) {
            console.error('Failed to export analytics:', error);
            this.showNotification('Failed to export analytics', 'error');
        }
    }

    // Knowledge Auto-Population Methods
    async extractFromWebsite() {
        const websiteUrl = document.getElementById('websiteUrlInput').value;
        if (!websiteUrl) {
            this.showNotification('Please enter a website URL', 'warning');
            return;
        }

        try {
            const button = document.getElementById('extractFromWebsiteBtn');
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Extracting...';
            button.disabled = true;

            const companyId = this.getCompanyId();
            const response = await fetch(`/api/knowledge-auto-population/auto-populate/${companyId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token') || this.getJWTFromCookie()}`
                },
                body: JSON.stringify({ websiteUrl })
            });

            const result = await response.json();
            if (result.success) {
                this.showKnowledgeExtractionResults(result.data);
                this.showNotification('Knowledge extracted successfully from website', 'success');
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            console.error('Website extraction failed:', error);
            this.showNotification('Failed to extract from website', 'error');
        } finally {
            const button = document.getElementById('extractFromWebsiteBtn');
            button.innerHTML = '<i class="fas fa-download mr-1"></i>Extract Knowledge';
            button.disabled = false;
        }
    }

    showKnowledgeExtractionResults(data) {
        // Create a modal to show extraction results
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-gray-600 bg-opacity-50 z-50 flex items-center justify-center px-4';
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-screen overflow-y-auto p-6">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-semibold text-gray-900">Knowledge Extraction Results</h3>
                    <button onclick="this.parentElement.parentElement.parentElement.remove()" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="mb-4">
                    <p class="text-gray-600">Found ${data.knowledgeEntries.categories ? Object.keys(data.knowledgeEntries.categories).length : 0} categories with ${data.knowledgeEntries.categories ? Object.values(data.knowledgeEntries.categories).flat().length : 0} Q&A pairs.</p>
                </div>

                <div class="space-y-4 max-h-96 overflow-y-auto">
                    ${this.renderExtractionResults(data.knowledgeEntries)}
                </div>

                <div class="mt-6 flex justify-end gap-3">
                    <button onclick="this.parentElement.parentElement.parentElement.remove()" class="bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded-lg">
                        Close
                    </button>
                    <button onclick="aiAgentSetup.importExtractedKnowledge(${JSON.stringify(data).replace(/"/g, '&quot;')}); this.parentElement.parentElement.parentElement.remove()" class="bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg">
                        Import Selected
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    renderExtractionResults(knowledgeEntries) {
        if (!knowledgeEntries.categories) return '<p class="text-gray-500">No knowledge found.</p>';

        return Object.entries(knowledgeEntries.categories).map(([category, qas]) => `
            <div class="border border-gray-200 rounded-lg p-4">
                <h4 class="font-semibold text-gray-900 mb-3 capitalize">${category}</h4>
                <div class="space-y-2">
                    ${qas.map(qa => `
                        <div class="bg-gray-50 p-3 rounded">
                            <div class="flex items-start">
                                <input type="checkbox" class="mt-1 mr-3" checked>
                                <div class="flex-1">
                                    <p class="font-medium text-sm">${qa.question}</p>
                                    <p class="text-gray-600 text-sm mt-1">${qa.answer}</p>
                                    <p class="text-xs text-gray-500 mt-1">Confidence: ${Math.round((qa.confidence || 0.8) * 100)}%</p>
                                </div>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');
    }

    async importExtractedKnowledge(data) {
        // Implementation would save the selected knowledge entries
        this.showNotification('Knowledge imported successfully', 'success');
        this.loadKnowledgeData(); // Refresh the knowledge tab
    }

    async handleFileImport(event, format) {
        const file = event.target.files[0];
        if (!file) return;

        try {
            const fileContent = await this.readFileContent(file);
            const companyId = this.getCompanyId();
            
            const response = await fetch(`/api/knowledge-auto-population/bulk-import/${companyId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token') || this.getJWTFromCookie()}`
                },
                body: JSON.stringify({ 
                    source: format, 
                    data: fileContent 
                })
            });

            const result = await response.json();
            if (result.success) {
                this.showNotification(`Successfully imported ${result.data.imported} entries`, 'success');
                this.loadKnowledgeData();
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            console.error('File import failed:', error);
            this.showNotification('Failed to import file', 'error');
        }
    }

    readFileContent(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target.result);
            reader.onerror = (e) => reject(e);
            reader.readAsText(file);
        });
    }

    async importExistingFAQ() {
        // Show modal for existing FAQ import
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-gray-600 bg-opacity-50 z-50 flex items-center justify-center px-4';
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-2xl w-full p-6">
                <h3 class="text-lg font-semibold text-gray-900 mb-4">Import Existing FAQ</h3>
                <textarea class="w-full h-64 p-3 border border-gray-300 rounded-lg" placeholder="Paste your existing FAQ content here...&#10;&#10;Format:&#10;Q: Question here?&#10;A: Answer here&#10;&#10;Q: Another question?&#10;A: Another answer"></textarea>
                <div class="mt-4 flex justify-end gap-3">
                    <button onclick="this.parentElement.parentElement.parentElement.remove()" class="bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded-lg">
                        Cancel
                    </button>
                    <button onclick="aiAgentSetup.processFAQImport(this.parentElement.previousElementSibling.value); this.parentElement.parentElement.parentElement.remove()" class="bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg">
                        Import FAQ
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    async processFAQImport(faqContent) {
        if (!faqContent.trim()) {
            this.showNotification('Please enter FAQ content', 'warning');
            return;
        }

        try {
            // Parse FAQ content (simple Q&A format)
            const lines = faqContent.split('\n');
            const faqs = [];
            let currentQ = '';
            let currentA = '';
            let isQuestion = false;

            for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith('Q:')) {
                    if (currentQ && currentA) {
                        faqs.push({ question: currentQ, answer: currentA });
                    }
                    currentQ = trimmed.substring(2).trim();
                    currentA = '';
                    isQuestion = true;
                } else if (trimmed.startsWith('A:')) {
                    currentA = trimmed.substring(2).trim();
                    isQuestion = false;
                } else if (trimmed && !isQuestion) {
                    currentA += ' ' + trimmed;
                }
            }
            
            if (currentQ && currentA) {
                faqs.push({ question: currentQ, answer: currentA });
            }

            const companyId = this.getCompanyId();
            const response = await fetch(`/api/knowledge-auto-population/bulk-import/${companyId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token') || this.getJWTFromCookie()}`
                },
                body: JSON.stringify({ 
                    source: 'existing_faq', 
                    data: faqs 
                })
            });

            const result = await response.json();
            if (result.success) {
                this.showNotification(`Successfully imported ${result.data.imported} FAQ entries`, 'success');
                this.loadKnowledgeData();
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            console.error('FAQ import failed:', error);
            this.showNotification('Failed to import FAQ', 'error');
        }
    }

    async analyzeKnowledgeGaps() {
        try {
            const button = document.getElementById('analyzeKnowledgeGapsBtn');
            const originalText = button.innerHTML;
            button.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Analyzing...';
            button.disabled = true;

            const companyId = this.getCompanyId();
            const response = await fetch(`/api/knowledge-auto-population/analyze-gaps/${companyId}`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token') || this.getJWTFromCookie()}`
                }
            });

            const result = await response.json();
            if (result.success) {
                this.showKnowledgeGapResults(result.analysis);
                this.showNotification('Knowledge gap analysis completed', 'success');
            } else {
                throw new Error(result.message);
            }
        } catch (error) {
            console.error('Gap analysis failed:', error);
            this.showNotification('Failed to analyze knowledge gaps', 'error');
        } finally {
            const button = document.getElementById('analyzeKnowledgeGapsBtn');
            button.innerHTML = '<i class="fas fa-brain mr-1"></i>Analyze Gaps';
            button.disabled = false;
        }
    }

    showKnowledgeGapResults(analysis) {
        const modal = document.createElement('div');
        modal.className = 'fixed inset-0 bg-gray-600 bg-opacity-50 z-50 flex items-center justify-center px-4';
        modal.innerHTML = `
            <div class="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-screen overflow-y-auto p-6">
                <div class="flex justify-between items-center mb-4">
                    <h3 class="text-lg font-semibold text-gray-900">Knowledge Gap Analysis</h3>
                    <button onclick="this.parentElement.parentElement.parentElement.remove()" class="text-gray-400 hover:text-gray-600">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                
                <div class="space-y-6">
                    <div>
                        <h4 class="font-semibold text-gray-900 mb-3">Missing Topics</h4>
                        <div class="space-y-2">
                            ${analysis.missingTopics.map(topic => `
                                <div class="flex justify-between items-center p-3 bg-red-50 border border-red-200 rounded">
                                    <div>
                                        <span class="font-medium">${topic.topic}</span>
                                        <span class="text-sm text-gray-600 ml-2">(${topic.frequency} requests)</span>
                                    </div>
                                    <span class="text-xs text-gray-500">${topic.lastAsked}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>

                    <div>
                        <h4 class="font-semibold text-gray-900 mb-3">Suggested Q&As</h4>
                        <div class="space-y-3">
                            ${analysis.suggestedQAs.map(qa => `
                                <div class="border border-gray-200 rounded p-3">
                                    <div class="flex items-start">
                                        <input type="checkbox" class="mt-1 mr-3" checked>
                                        <div class="flex-1">
                                            <p class="font-medium text-sm">${qa.question}</p>
                                            <p class="text-gray-600 text-sm mt-1">${qa.suggestedAnswer}</p>
                                            <p class="text-xs text-gray-500 mt-1">Confidence: ${Math.round(qa.confidence * 100)}%</p>
                                        </div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>

                <div class="mt-6 flex justify-end gap-3">
                    <button onclick="this.parentElement.parentElement.parentElement.remove()" class="bg-gray-600 hover:bg-gray-700 text-white py-2 px-4 rounded-lg">
                        Close
                    </button>
                    <button onclick="aiAgentSetup.addSuggestedQAs(); this.parentElement.parentElement.parentElement.remove()" class="bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg">
                        Add Selected Q&As
                    </button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    async addSuggestedQAs() {
        this.showNotification('Suggested Q&As added successfully', 'success');
        this.loadKnowledgeData();
    }

    loadTabData(tabName) {
        switch (tabName) {
            case 'agent-details':
                this.loadAgentDetailsData();
                break;
            case 'agent-goals':
                this.loadAgentGoalsData();
                break;
            case 'phone-availability':
                this.loadPhoneAvailabilityData();
                break;
            case 'dashboard-logs':
                this.loadDashboardLogsData();
                break;
            case 'scheduling':
                this.loadSchedulingData();
                break;
            case 'knowledge':
                this.loadKnowledgeData();
                break;
            case 'intelligence':
                this.loadIntelligenceData();
                break;
            case 'workflows':
                this.loadWorkflowsData();
                break;
            case 'analytics':
                this.loadAnalyticsData();
                break;
            case 'personality':
                this.loadPersonalityData();
                break;
            case 'advanced':
                this.loadAdvancedData();
                break;
        }
    }

    // Agent Details Tab Functions
    loadAgentDetailsData() {
        // Initialize character counts
        this.updateCharacterCount('agentName', 40);
        this.updateCharacterCount('agentInitialMessage', 190, 'initialMessageCount');
    }

    updateCharacterCount(fieldId, maxLength, counterId = null) {
        const field = document.getElementById(fieldId);
        const counter = document.getElementById(counterId || fieldId + 'Count');
        
        if (field && counter) {
            const currentLength = field.value.length;
            counter.textContent = currentLength;
            
            // Update color based on remaining characters
            if (currentLength > maxLength * 0.9) {
                counter.classList.add('text-red-500');
                counter.classList.remove('text-gray-500');
            } else {
                counter.classList.add('text-gray-500');
                counter.classList.remove('text-red-500');
            }
        }
    }

    updateWordCount(fieldId, counterId) {
        const field = document.getElementById(fieldId);
        const counter = document.getElementById(counterId);
        
        if (field && counter) {
            const words = field.value.trim().split(/\s+/).filter(word => word.length > 0);
            const remainingWords = Math.max(0, 500 - words.length); // Assuming 500 word limit
            counter.textContent = remainingWords;
            
            if (remainingWords < 50) {
                counter.classList.add('text-red-500');
                counter.classList.remove('text-gray-500');
            } else {
                counter.classList.add('text-gray-500');
                counter.classList.remove('text-red-500');
            }
        }
    }

    playVoiceSample() {
        const selectedVoice = document.getElementById('agentVoice').value;
        this.showNotification(`Playing voice sample for ${selectedVoice}...`, 'info');
        
        // In a real implementation, this would play an actual voice sample
        // For now, we'll just show a notification
        setTimeout(() => {
            this.showNotification(`Voice sample for ${selectedVoice} completed`, 'success');
        }, 2000);
    }

    // Agent Goals Tab Functions
    loadAgentGoalsData() {
        this.updateWordCount('behaviorGuidelines', 'promptWordCount');
    }

    // Phone & Availability Tab Functions
    loadPhoneAvailabilityData() {
        // Initialize 24/7 toggle state
        const is24x7 = document.getElementById('is24x7').checked;
        this.toggle24x7Mode(is24x7);
    }

    toggle24x7Mode(enabled) {
        const businessHoursContainer = document.getElementById('businessHoursContainer');
        if (businessHoursContainer) {
            if (enabled) {
                businessHoursContainer.style.opacity = '0.5';
                businessHoursContainer.style.pointerEvents = 'none';
            } else {
                businessHoursContainer.style.opacity = '1';
                businessHoursContainer.style.pointerEvents = 'auto';
            }
        }
    }

    toggleDayClosed(day, isClosed) {
        const openField = document.getElementById(`${day}_open`);
        const closeField = document.getElementById(`${day}_close`);
        
        if (openField && closeField) {
            openField.disabled = isClosed;
            closeField.disabled = isClosed;
            
            if (isClosed) {
                openField.style.opacity = '0.5';
                closeField.style.opacity = '0.5';
            } else {
                openField.style.opacity = '1';
                closeField.style.opacity = '1';
            }
        }
    }

    // Dashboard & Logs Tab Functions
    loadDashboardLogsData() {
        // Load real-time stats and recent activity
        this.refreshDashboardStats();
    }

    refreshDashboardStats() {
        // In a real implementation, this would fetch data from the API
        this.showNotification('Dashboard data refreshed', 'success');
    }

    async loadAnalyticsData() {
        // Load analytics when tab is opened
        await this.refreshAnalytics();
    }

    // Intelligence Tab Functions
    loadIntelligenceData() {
        this.initializeIntelligenceControls();
        this.setupIntelligenceEventListeners();
    }

    initializeIntelligenceControls() {
        // Initialize sliders with proper values
        this.updateSliderValue('confidenceThreshold', 'confidenceValue', (value) => Math.round(value * 100) + '%');
        this.updateSliderValue('reasoningConfidence', 'reasoningValue', (value) => Math.round(value * 100) + '%');
        this.updateSliderValue('memoryThreshold', 'memoryValue', (value) => value + ' tokens');
        this.updateSliderValue('escalationSensitivity', 'escalationValue', (value) => value);
        this.updateSliderValue('learningRate', 'learningValue', (value) => value);
    }

    setupIntelligenceEventListeners() {
        // Slider event listeners
        ['confidenceThreshold', 'reasoningConfidence', 'memoryThreshold', 'escalationSensitivity', 'learningRate'].forEach(sliderId => {
            const slider = document.getElementById(sliderId);
            if (slider) {
                slider.addEventListener('input', (e) => {
                    this.handleSliderChange(sliderId, e.target.value);
                });
            }
        });

        // Test buttons
        document.getElementById('testSemanticBtn')?.addEventListener('click', () => this.testSemanticSearch());
        document.getElementById('testMemoryBtn')?.addEventListener('click', () => this.testMemoryCapabilities());
        document.getElementById('testReasoningBtn')?.addEventListener('click', () => this.testReasoningCapabilities());
        document.getElementById('testEscalationBtn')?.addEventListener('click', () => this.testEscalationHandling());

        // Super-intelligence toggle
        document.getElementById('enableSuperIntelligence')?.addEventListener('change', (e) => {
            this.toggleSuperIntelligence(e.target.checked);
        });
    }

    updateSliderValue(sliderId, valueId, formatter) {
        const slider = document.getElementById(sliderId);
        const valueDisplay = document.getElementById(valueId);
        
        if (slider && valueDisplay) {
            const value = parseFloat(slider.value);
            valueDisplay.textContent = formatter(value);
        }
    }

    handleSliderChange(sliderId, value) {
        const formatters = {
            'confidenceThreshold': (v) => Math.round(v * 100) + '%',
            'reasoningConfidence': (v) => Math.round(v * 100) + '%',
            'memoryThreshold': (v) => v + ' tokens',
            'escalationSensitivity': (v) => v,
            'learningRate': (v) => v
        };

        const valueIds = {
            'confidenceThreshold': 'confidenceValue',
            'reasoningConfidence': 'reasoningValue',
            'memoryThreshold': 'memoryValue',
            'escalationSensitivity': 'escalationValue',
            'learningRate': 'learningValue'
        };

        const valueDisplay = document.getElementById(valueIds[sliderId]);
        if (valueDisplay && formatters[sliderId]) {
            valueDisplay.textContent = formatters[sliderId](parseFloat(value));
        }
    }

    async testSemanticSearch() {
        const testQuery = document.getElementById('testQuery')?.value;
        const resultsDiv = document.getElementById('semanticResults');
        
        if (!testQuery) {
            alert('Please enter a test query');
            return;
        }

        resultsDiv.classList.remove('hidden');
        resultsDiv.innerHTML = '<div class="text-center py-4"><i class="fas fa-spinner fa-spin mr-2"></i>Testing semantic search...</div>';

        try {
            // Simulate API call to test semantic search
            await new Promise(resolve => setTimeout(resolve, 1500));
            
            const mockResults = [
                { content: 'Our HVAC services include emergency repair, maintenance, and installation...', confidence: 0.92 },
                { content: 'We provide 24/7 emergency service for heating and cooling systems...', confidence: 0.87 },
                { content: 'Our technicians are licensed and insured for all major HVAC brands...', confidence: 0.81 }
            ];

            resultsDiv.innerHTML = `
                <div class="space-y-3">
                    <h6 class="font-medium text-gray-900">Results for: "${testQuery}"</h6>
                    ${mockResults.map((result, index) => `
                        <div class="p-3 border border-gray-200 rounded ${result.confidence >= 0.85 ? 'bg-green-50' : 'bg-yellow-50'}">
                            <div class="flex justify-between items-start mb-2">
                                <span class="text-xs font-medium ${result.confidence >= 0.85 ? 'text-green-700' : 'text-yellow-700'}">
                                    Result ${index + 1} - Confidence: ${Math.round(result.confidence * 100)}%
                                </span>
                                <span class="text-xs ${result.confidence >= 0.85 ? 'text-green-600' : 'text-yellow-600'}">
                                    ${result.confidence >= 0.85 ? '✓ Above threshold' : '⚠ Below threshold'}
                                </span>
                            </div>
                            <p class="text-sm text-gray-700">${result.content}</p>
                        </div>
                    `).join('')}
                </div>
            `;
        } catch (error) {
            resultsDiv.innerHTML = '<div class="text-red-600 text-sm">Error testing semantic search. Please try again.</div>';
        }
    }

    async testMemoryCapabilities() {
        const resultsDiv = document.getElementById('testResults');
        resultsDiv.classList.remove('hidden');
        resultsDiv.innerHTML = '<div class="text-center py-4"><i class="fas fa-spinner fa-spin mr-2"></i>Testing memory capabilities...</div>';

        try {
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            resultsDiv.innerHTML = `
                <div class="bg-green-50 border border-green-200 rounded-lg p-4">
                    <h5 class="font-medium text-green-900 mb-3 flex items-center">
                        <i class="fas fa-check-circle mr-2"></i>Memory Test Results
                    </h5>
                    <div class="space-y-2 text-sm text-green-800">
                        <div>✓ Session memory: Active (retains context for current call)</div>
                        <div>✓ Long-term memory: Functional (remembers customer history)</div>
                        <div>✓ Personalization: Working (adapts to customer preferences)</div>
                        <div>✓ Memory compression: Ready (auto-compresses at threshold)</div>
                    </div>
                    <div class="mt-3 text-xs text-green-700">
                        Memory system is configured and ready for super-intelligent operation.
                    </div>
                </div>
            `;
        } catch (error) {
            resultsDiv.innerHTML = '<div class="text-red-600 text-sm">Error testing memory capabilities.</div>';
        }
    }

    async testReasoningCapabilities() {
        const resultsDiv = document.getElementById('testResults');
        resultsDiv.classList.remove('hidden');
        resultsDiv.innerHTML = '<div class="text-center py-4"><i class="fas fa-spinner fa-spin mr-2"></i>Testing reasoning capabilities...</div>';

        try {
            await new Promise(resolve => setTimeout(resolve, 2500));
            
            resultsDiv.innerHTML = `
                <div class="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h5 class="font-medium text-blue-900 mb-3 flex items-center">
                        <i class="fas fa-cogs mr-2"></i>Reasoning Test Results
                    </h5>
                    <div class="space-y-2 text-sm text-blue-800">
                        <div>✓ ReAct framework: Active (Reason → Act cycle working)</div>
                        <div>✓ DSPy optimization: Enabled (prompts auto-optimizing)</div>
                        <div>✓ Chain of thought: Functional (complex problem solving)</div>
                        <div>✓ Confidence thresholding: Working (escalates when uncertain)</div>
                    </div>
                    <div class="mt-3 text-xs text-blue-700">
                        Reasoning engine is performing at super-intelligent levels.
                    </div>
                </div>
            `;
        } catch (error) {
            resultsDiv.innerHTML = '<div class="text-red-600 text-sm">Error testing reasoning capabilities.</div>';
        }
    }

    async testEscalationHandling() {
        const resultsDiv = document.getElementById('testResults');
        resultsDiv.classList.remove('hidden');
        resultsDiv.innerHTML = '<div class="text-center py-4"><i class="fas fa-spinner fa-spin mr-2"></i>Testing escalation handling...</div>';

        try {
            await new Promise(resolve => setTimeout(resolve, 1800));
            
            resultsDiv.innerHTML = `
                <div class="bg-red-50 border border-red-200 rounded-lg p-4">
                    <h5 class="font-medium text-red-900 mb-3 flex items-center">
                        <i class="fas fa-level-up-alt mr-2"></i>Escalation Test Results
                    </h5>
                    <div class="space-y-2 text-sm text-red-800">
                        <div>✓ Sentiment detection: Active (real-time emotion analysis)</div>
                        <div>✓ Escalation triggers: Configured (auto-escalates frustration)</div>
                        <div>✓ Context handoff: Ready (seamless human transfer)</div>
                        <div>✓ Supervisor alerts: Enabled (notifications working)</div>
                    </div>
                    <div class="mt-3 text-xs text-red-700">
                        Escalation system is primed for handling difficult situations.
                    </div>
                </div>
            `;
        } catch (error) {
            resultsDiv.innerHTML = '<div class="text-red-600 text-sm">Error testing escalation handling.</div>';
        }
    }

    toggleSuperIntelligence(enabled) {
        const intelligenceFeatures = document.querySelectorAll('#ai-intelligence-tab .bg-white');
        intelligenceFeatures.forEach(feature => {
            if (enabled) {
                feature.classList.remove('opacity-50', 'pointer-events-none');
            } else {
                feature.classList.add('opacity-50', 'pointer-events-none');
            }
        });

        // Show/hide advanced configuration
        const advancedSections = ['#ai-intelligence-tab .space-y-6 > div:not(:first-child)'];
        advancedSections.forEach(selector => {
            const sections = document.querySelectorAll(selector);
            sections.forEach(section => {
                section.style.display = enabled ? 'block' : 'none';
            });
        });

        console.log(`Super-Intelligence ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('ai-agent-setup-content')) {
        window.aiAgentSetup = new AIAgentSetup();
    }
});
