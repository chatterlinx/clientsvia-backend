/**
 * AI Agent Setup - HighLevel Competitive Mode
 * Parallel implementation with simplified UX and powerful features
 */

class AIAgentSetup {
    constructor() {
        this.currentTab = 'scheduling';
        this.selectedTemplate = null;
        this.serviceTypes = [];
        this.customQAs = [];
        this.businessCategories = [];
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
        // This would integrate with the existing agent configuration system
        const config = {
            businessType: this.selectedTemplate,
            personality: persona,
            services: template.services,
            greeting: template.greeting,
            categories: template.categories,
            operatingHours: template.hours,
            features: template.features
        };

        // Simulate API call - replace with actual implementation
        return new Promise((resolve) => {
            setTimeout(() => {
                console.log('Auto-configured with:', config);
                resolve(config);
            }, 2000);
        });
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
        this.switchTab('scheduling'); // Default to scheduling tab
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

    loadTabData(tabName) {
        switch (tabName) {
            case 'scheduling':
                this.loadSchedulingData();
                break;
            case 'knowledge':
                this.loadKnowledgeData();
                break;
            case 'personality':
                this.loadPersonalityData();
                break;
            case 'advanced':
                this.loadAdvancedData();
                break;
        }
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
        // This would load from the existing agent configuration
        try {
            // Simulated load - replace with actual API call
            console.log('Loading existing AI agent configuration...');
        } catch (error) {
            console.error('Failed to load existing configuration:', error);
        }
    }

    async saveConfiguration() {
        try {
            this.setSaveButtonLoading(true);

            const config = this.gatherConfiguration();
            
            // This would save to the existing system
            await this.saveToBackend(config);

            this.showNotification('AI Agent configuration saved successfully!', 'success');
        } catch (error) {
            console.error('Failed to save configuration:', error);
            this.showNotification('Failed to save configuration. Please try again.', 'error');
        } finally {
            this.setSaveButtonLoading(false);
        }
    }

    gatherConfiguration() {
        return {
            template: this.selectedTemplate,
            persona: document.getElementById('aiAgentPersona')?.value,
            timezone: document.getElementById('aiTimezone')?.value,
            operatingMode: document.getElementById('aiOperatingMode')?.value,
            serviceTypes: this.serviceTypes,
            customQAs: this.customQAs,
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

    async saveToBackend(config) {
        // Simulate API call - replace with actual implementation
        return new Promise((resolve) => {
            setTimeout(() => {
                console.log('Saved configuration:', config);
                resolve();
            }, 1500);
        });
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

    showNotification(message, type = 'info') {
        const notification = document.getElementById('toast-notification');
        if (notification) {
            notification.className = `fixed top-4 right-4 p-4 rounded-lg shadow-lg z-50 ${
                type === 'success' ? 'bg-green-600 text-white' :
                type === 'error' ? 'bg-red-600 text-white' :
                type === 'warning' ? 'bg-yellow-600 text-white' :
                'bg-blue-600 text-white'
            }`;
            notification.textContent = message;
            notification.classList.remove('hidden');

            setTimeout(() => {
                notification.classList.add('hidden');
            }, 5000);
        }
    }
}

// Initialize when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('ai-agent-setup-content')) {
        window.aiAgentSetup = new AIAgentSetup();
    }
});
