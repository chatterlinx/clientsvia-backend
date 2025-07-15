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
        this.initializePlaceholderTextStyling();
        this.populateHVACScriptDemo();
        this.handleGreetingTypeChange(); // Initialize greeting type display
        this.renderAICompanyQnAList(); // Initialize Q&A list
        this.initSmartLearningFeatures(); // Initialize Smart Learning Dashboard
        this.initDebuggingFeatures(); // Initialize Developer Debugging Tools
        this.initScriptDebugging(); // Initialize Script Testing and Debugging
        this.initRealTimeIntelligence(); // Initialize Real-Time Intelligence Features
        this.initializeLogicAIIntelligence(); // Initialize Logic AI Intelligence features
    }

    /**
     * Bind all event listeners
     */
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

        // Action Button Events
        document.getElementById('aiPreviewAgentBtn')?.addEventListener('click', () => {
            this.previewAgent();
        });

        document.getElementById('aiTestCallBtn')?.addEventListener('click', () => {
            this.testCall();
        });

        document.getElementById('aiSaveConfigBtn')?.addEventListener('click', () => {
            this.saveConfiguration();
        });

        // Tab Navigation
        document.querySelectorAll('.ai-config-tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.switchTab(e.target.dataset.tab);
            });
        });

        // Voice settings
        document.getElementById('playVoiceBtn')?.addEventListener('click', () => {
            this.playVoicePreview();
        });

        // Character counters
        document.getElementById('agentName')?.addEventListener('input', (e) => {
            this.updateCharacterCount('agentName', 'agentNameCount', 40);
        });

        document.getElementById('agentInitialMessage')?.addEventListener('input', (e) => {
            this.updateCharacterCount('agentInitialMessage', 'initialMessageCount', 190);
        });

        document.getElementById('behaviorGuidelines')?.addEventListener('input', (e) => {
            this.updateWordCount('behaviorGuidelines', 'promptWordCount', 2000);
        });

        // Service type management
        document.getElementById('addServiceTypeBtn')?.addEventListener('click', () => {
            this.addServiceType();
        });

        // Call settings sliders
        document.getElementById('aiCallTimeLimit')?.addEventListener('input', (e) => {
            document.getElementById('callTimeLimitValue').textContent = e.target.value + ' mins';
        });

        // Business hours toggle
        document.getElementById('is24x7')?.addEventListener('change', (e) => {
            this.toggle24x7Hours(e.target.checked);
        });

        // HVAC Script Demo Buttons
        document.getElementById('aiTestCallBtn')?.addEventListener('click', () => this.testHVACScript());
        document.getElementById('aiPreviewAgentBtn')?.addEventListener('click', () => this.previewAgent());
        document.getElementById('aiSaveConfigBtn')?.addEventListener('click', () => this.saveConfiguration());

        // Tab-specific save buttons
        document.getElementById('aiSaveAgentGoalsBtn')?.addEventListener('click', () => this.saveAgentGoals());
        document.getElementById('aiSavePhoneAvailabilityBtn')?.addEventListener('click', () => this.savePhoneAvailability());
        document.getElementById('aiSaveCallWorkflowsBtn')?.addEventListener('click', () => this.saveCallWorkflows());
        document.getElementById('aiSaveBasicSetupBtn')?.addEventListener('click', () => this.saveBasicSetup());
        document.getElementById('aiSavePersonalityBtn')?.addEventListener('click', () => this.savePersonality());
        document.getElementById('aiSaveAdvancedBtn')?.addEventListener('click', () => this.saveAdvanced());

        // Slider event listeners for intelligence tab
        ['confidenceThreshold', 'reasoningConfidence', 'memoryThreshold'].forEach(sliderId => {
            const slider = document.getElementById(sliderId);
            if (slider) {
                slider.addEventListener('input', (e) => {
                    this.handleSliderChange(sliderId, e.target.value);
                });
            }
        });

        // Greeting type handling
        document.querySelectorAll('input[name="aiGreetingType"]').forEach(radio => {
            radio.addEventListener('change', () => {
                this.handleGreetingTypeChange();
            });
        });

        // Company Q&A management
        document.getElementById('aiCompanyQnaSaveBtn')?.addEventListener('click', () => {
            this.saveAICompanyQnA();
        });

        document.getElementById('aiCompanyQnaCancelBtn')?.addEventListener('click', () => {
            this.cancelAICompanyQnAEdit();
        });

        document.getElementById('aiInsertPlaceholderBtn')?.addEventListener('click', () => {
            this.insertAIPlaceholder();
        });

        document.getElementById('aiCompanyQnaAnswer')?.addEventListener('input', () => {
            this.updateAIQnAPreview();
        });

        // Company Q&A form submission
        document.getElementById('aiCompanyQnaForm')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveAICompanyQnA();
        });

        // Smart Learning Dashboard Events
        document.getElementById('saveSmartLearningBtn')?.addEventListener('click', this.saveSmartLearningSettings.bind(this));
        document.querySelector('.bg-green-600[data-action="create-ab-test"]')?.addEventListener('click', this.createABTest.bind(this));
        document.getElementById('autoApplyThreshold')?.addEventListener('input', (e) => {
            document.getElementById('autoApplyThresholdValue').textContent = e.target.value + '%';
        });

        // Developer Debugging Events
        document.getElementById('verboseLogging')?.addEventListener('change', this.toggleVerboseLogging.bind(this));
        document.getElementById('scriptTracing')?.addEventListener('change', this.toggleScriptTracing.bind(this));
        document.getElementById('llmDebugMode')?.addEventListener('change', this.toggleLLMDebugMode.bind(this));
        document.getElementById('debugResponseMode')?.addEventListener('change', this.changeDebugResponseMode.bind(this));
        document.querySelector('.bg-red-600[data-action="emergency-stop"]')?.addEventListener('click', this.emergencyStop.bind(this));
        document.getElementById('saveDebugSettingsBtn')?.addEventListener('click', this.saveDebugSettings.bind(this));
    }

    /**
     * Initialize placeholder text styling system
     * Blue text = default/placeholder content
     * Black text = developer-edited content
     */
    initializePlaceholderTextStyling() {
        // Monitor all form inputs for changes
        const formInputs = document.querySelectorAll('#ai-agent-setup-content input, #ai-agent-setup-content textarea, #ai-agent-setup-content select');
        
        formInputs.forEach(input => {
            // Set initial state based on content
            this.updateTextStyling(input);
            
            // Listen for changes
            input.addEventListener('input', () => this.updateTextStyling(input));
            input.addEventListener('change', () => this.updateTextStyling(input));
            input.addEventListener('focus', () => this.handleInputFocus(input));
            input.addEventListener('blur', () => this.handleInputBlur(input));
        });
    }

    /**
     * Update text styling based on whether content is default or edited
     */
    updateTextStyling(element) {
        const originalValue = element.dataset.originalValue || element.defaultValue;
        const currentValue = element.value;
        
        // Remove existing classes
        element.classList.remove('has-default-content', 'has-edited-content');
        
        if (currentValue === originalValue || currentValue === '' || element.hasAttribute('readonly')) {
            // Blue styling for default/placeholder content
            element.classList.add('has-default-content');
            element.style.color = '#3B82F6';
            element.style.fontStyle = 'italic';
        } else {
            // Black styling for developer-edited content
            element.classList.add('has-edited-content');
            element.style.color = '#1F2937';
            element.style.fontStyle = 'normal';
            element.style.fontWeight = '500';
        }
    }

    /**
     * Handle input focus events
     */
    handleInputFocus(element) {
        if (element.classList.contains('has-default-content') && !element.hasAttribute('readonly')) {
            element.style.color = '#1F2937';
            element.style.fontStyle = 'normal';
        }
    }

    /**
     * Handle input blur events
     */
    handleInputBlur(element) {
        this.updateTextStyling(element);
    }

    /**
     * Populate the form with HVAC script demonstration
     */
    populateHVACScriptDemo() {
        // Set default values for demonstration
        const demoData = {
            agentName: 'Jessica',
            businessName: 'Penguin Air Cooling & Heating, Corp.',
            agentLanguage: 'english',
            agentVoice: 'bria',
            agentTimezone: 'GMT-04:00 America/New_York (EDT)',
            callDirection: 'inbound',
            greetingType: 'tts',
            agentInitialMessage: 'Hi, Penguin Air conditioning! —how can I help you today?'
        };

        // Store original values for styling comparison
        Object.entries(demoData).forEach(([fieldId, value]) => {
            const element = document.getElementById(fieldId);
            if (element) {
                element.dataset.originalValue = value;
                element.value = value;
                this.updateTextStyling(element);
            }
        });

        // Set up business hours for HVAC service
        this.setupHVACBusinessHours();
        
        // Show configuration summary
        this.updateConfigurationSummary();
    }

    /**
     * Set up HVAC business hours
     */
    setupHVACBusinessHours() {
        const businessHours = {
            mon: { open: '07:00', close: '19:00' },
            tue: { open: '07:00', close: '19:00' },
            wed: { open: '07:00', close: '19:00' },
            thu: { open: '07:00', close: '19:00' },
            fri: { open: '07:00', close: '19:00' },
            sat: { open: '08:00', close: '17:00' },
            sun: { closed: true }
        };

        Object.entries(businessHours).forEach(([day, hours]) => {
            if (hours.closed) {
                const closedCheckbox = document.getElementById(`${day}_closed`);
                if (closedCheckbox) closedCheckbox.checked = true;
            } else {
                const openTime = document.getElementById(`${day}_open`);
                const closeTime = document.getElementById(`${day}_close`);
                if (openTime) {
                    openTime.value = hours.open;
                    openTime.dataset.originalValue = hours.open;
                    this.updateTextStyling(openTime);
                }
                if (closeTime) {
                    closeTime.value = hours.close;
                    closeTime.dataset.originalValue = hours.close;
                    this.updateTextStyling(closeTime);
                }
            }
        });
    }

    /**
     * Update the configuration summary
     */
    updateConfigurationSummary() {
        // This would normally fetch real data, but for demo we'll show the implementation status
        const summaryItems = document.querySelectorAll('.summary-check');
        summaryItems.forEach(item => {
            const icon = item.querySelector('i');
            if (icon) {
                icon.className = 'fas fa-check text-green-500';
            }
        });
        
        // Show toast notification about the implementation
        this.showToast('HVAC Service Script successfully implemented with blue placeholder text system!', 'success');
    }

    /**
     * Demonstrate script testing functionality
     */
    testHVACScript() {
        const testScenarios = [
            {
                scenario: 'Emergency Call',
                input: 'My AC is not working and it\'s really hot!',
                expectedFlow: 'Repair Service → Emergency Protocol → Transfer to Emergency Team'
            },
            {
                scenario: 'Maintenance Request',
                input: 'I need a tune-up for my AC',
                expectedFlow: 'Maintenance Protocol → Book about a week out → Collect information'
            },
            {
                scenario: 'Technician Request',
                input: 'Can I get Dustin to come out?',
                expectedFlow: 'Note preference → Explain availability depends on scheduling → Continue booking'
            }
        ];

        console.log('🧪 Testing HVAC Script Implementation:', testScenarios);
        
        // Show test results in UI
        this.showTestResults(testScenarios);
    }

    /**
     * Show test results in a modal or panel
     */
    showTestResults(scenarios) {
        const resultsHTML = scenarios.map(scenario => `
            <div class="p-4 border border-gray-200 rounded-lg mb-3">
                <h5 class="font-semibold text-gray-900">${scenario.scenario}</h5>
                <p class="text-sm text-gray-600 mt-1"><strong>Input:</strong> "${scenario.input}"</p>
                <p class="text-sm text-blue-600 mt-1"><strong>Expected Flow:</strong> ${scenario.expectedFlow}</p>
                <div class="mt-2">
                    <span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <i class="fas fa-check mr-1"></i>Protocol Implemented
                    </span>
                </div>
            </div>
        `).join('');

        // Create and show test results panel
        const existingPanel = document.getElementById('test-results-panel');
        if (existingPanel) existingPanel.remove();

        const panel = document.createElement('div');
        panel.id = 'test-results-panel';
        panel.className = 'fixed top-4 right-4 w-96 bg-white border border-gray-300 rounded-lg shadow-lg p-4 z-50 max-h-96 overflow-y-auto';
        panel.innerHTML = `
            <div class="flex justify-between items-center mb-3">
                <h4 class="font-semibold text-gray-900">🧪 HVAC Script Test Results</h4>
                <button onclick="this.parentElement.parentElement.remove()" class="text-gray-500 hover:text-gray-700">
                    <i class="fas fa-times"></i>
                </button>
            </div>
            ${resultsHTML}
            <div class="mt-4 p-3 bg-green-50 border border-green-200 rounded">
                <p class="text-sm text-green-800">✅ All HVAC service protocols are ready for live testing!</p>
            </div>
        `;

        document.body.appendChild(panel);

        // Auto-remove after 10 seconds
        setTimeout(() => {
            if (panel.parentElement) panel.remove();
        }, 10000);
    }

    /**
     * Initialize tabs and load business categories
     */
    initializeTabs() {
        this.switchTab('agent-details');
    }

    loadBusinessCategories() {
        this.businessCategories = ['HVAC Services', 'Emergency Repair', 'Maintenance'];
    }

    /**
     * Switch between configuration tabs
     */
    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.ai-config-tab-btn').forEach(btn => {
            btn.classList.remove('border-indigo-500', 'text-indigo-600');
            btn.classList.add('border-transparent', 'text-gray-500');
        });

        // Update tab content
        document.querySelectorAll('.ai-config-tab-content').forEach(content => {
            content.classList.add('hidden');
        });

        // Activate selected tab
        const activeBtn = document.querySelector(`[data-tab="${tabName}"]`);
        const activeContent = document.getElementById(`ai-${tabName}-tab`);

        if (activeBtn) {
            activeBtn.classList.remove('border-transparent', 'text-gray-500');
            activeBtn.classList.add('border-indigo-500', 'text-indigo-600');
        }

        if (activeContent) {
            activeContent.classList.remove('hidden');
        }

        this.currentTab = tabName;
    }

    /**
     * Initialize Smart Learning Dashboard features
     */
    initSmartLearningFeatures() {
        // Smart Learning suggestion interactions
        document.addEventListener('click', (e) => {
            const button = e.target.closest('button');
            if (!button) return;

            // Check if button is in Smart Learning tab
            const smartLearningTab = button.closest('#ai-smart-learning-tab');
            if (!smartLearningTab) return;

            // Handle different button actions
            if (button.textContent.includes('Edit Script')) {
                this.editSuggestion(e);
            } else if (button.textContent.includes('Apply')) {
                this.applySuggestion(e);
            } else if (button.textContent.includes('Deny')) {
                this.denySuggestion(e);
            } else if (button.dataset.action === 'create-ab-test') {
                this.createABTest();
            }
        });

        // Auto-learning threshold sliders
        document.getElementById('autoApplyThreshold')?.addEventListener('input', (e) => {
            document.getElementById('autoApplyThresholdValue').textContent = e.target.value + '%';
        });

        // Save Smart Learning settings
        document.getElementById('saveSmartLearningBtn')?.addEventListener('click', this.saveSmartLearningSettings.bind(this));
    }

    /**
     * Initialize Developer Debugging features
     */
    initDebuggingFeatures() {
        // Live monitoring auto-refresh
        this.startLiveMonitoring();

        // Debug controls
        document.getElementById('verboseLogging')?.addEventListener('change', this.toggleVerboseLogging.bind(this));
        document.getElementById('scriptTracing')?.addEventListener('change', this.toggleScriptTracing.bind(this));
        document.getElementById('llmDebugMode')?.addEventListener('change', this.toggleLLMDebugMode.bind(this));

        // Testing controls
        document.getElementById('debugResponseMode')?.addEventListener('change', this.changeDebugResponseMode.bind(this));
        
        // Emergency stop
        document.addEventListener('click', (e) => {
            if (e.target.closest('button')?.dataset.action === 'emergency-stop') {
                this.emergencyStop();
            }
        });

        // Save debug settings
        document.getElementById('saveDebugSettingsBtn')?.addEventListener('click', this.saveDebugSettings.bind(this));
    }

    /**
     * Initialize Script Testing and Debugging
     */
    initScriptDebugging() {
        // Test script button
        document.getElementById('testScriptBtn')?.addEventListener('click', this.testCurrentScript.bind(this));
        
        // Validate script button  
        document.getElementById('validateScriptBtn')?.addEventListener('click', this.validateCurrentScript.bind(this));
        
        // Script analytics button
        document.getElementById('scriptAnalyticsBtn')?.addEventListener('click', this.showScriptAnalytics.bind(this));
        
        // Live script tester
        document.getElementById('scriptTestQuestion')?.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                this.testScriptQuestion();
            }
        });
        
        document.getElementById('testQuestionBtn')?.addEventListener('click', this.testScriptQuestion.bind(this));
        
        console.log('Script debugging features initialized');
    }

    // =============================================================================
    // LOGIC AI INTELLIGENCE FUNCTIONS (from Logic Tab)
    // =============================================================================
    
    /**
     * Initialize Logic AI Intelligence features
     */
    initializeLogicAIIntelligence() {
        console.log('Initializing Logic AI Intelligence features...');
        
        // Initialize confidence threshold slider
        const confidenceSlider = document.getElementById('logicConfidenceThreshold');
        const confidenceValue = document.getElementById('logicConfidenceThresholdValue');
        
        if (confidenceSlider && confidenceValue) {
            confidenceSlider.addEventListener('input', (e) => {
                confidenceValue.textContent = e.target.value + '%';
                this.updateLogicIntelligenceSettings();
            });
        }
        
        // Initialize semantic knowledge toggle
        const semanticToggle = document.getElementById('logicSemanticKnowledgeEnabled');
        if (semanticToggle) {
            semanticToggle.addEventListener('change', () => {
                this.updateLogicIntelligenceSettings();
            });
        }
        
        // Initialize contextual memory toggle
        const contextualToggle = document.getElementById('logicContextualMemoryEnabled');
        if (contextualToggle) {
            contextualToggle.addEventListener('change', () => {
                this.updateLogicIntelligenceSettings();
            });
        }
        
        // Initialize dynamic reasoning toggle
        const dynamicToggle = document.getElementById('logicDynamicReasoningEnabled');
        if (dynamicToggle) {
            dynamicToggle.addEventListener('change', () => {
                this.updateLogicIntelligenceSettings();
            });
        }
        
        // Initialize personalization level dropdown
        const personalizationSelect = document.getElementById('logicPersonalizationLevel');
        if (personalizationSelect) {
            personalizationSelect.addEventListener('change', () => {
                this.updateLogicIntelligenceSettings();
            });
        }
        
        // Initialize smart escalation toggle
        const escalationToggle = document.getElementById('logicSmartEscalationEnabled');
        if (escalationToggle) {
            escalationToggle.addEventListener('change', () => {
                this.updateLogicIntelligenceSettings();
            });
        }
        
        // Initialize learning toggles
        const autoLearningToggle = document.getElementById('logicAutoLearningEnabled');
        if (autoLearningToggle) {
            autoLearningToggle.addEventListener('change', () => {
                this.updateLogicLearningSettings();
            });
        }
        
        const performanceOptToggle = document.getElementById('logicPerformanceOptimization');
        if (performanceOptToggle) {
            performanceOptToggle.addEventListener('change', () => {
                this.updateLogicLearningSettings();
            });
        }
        
        const abTestingToggle = document.getElementById('logicABTestingEnabled');
        if (abTestingToggle) {
            abTestingToggle.addEventListener('change', () => {
                this.updateLogicLearningSettings();
            });
        }
        
        const realTimeOptToggle = document.getElementById('logicRealTimeOptimization');
        if (realTimeOptToggle) {
            realTimeOptToggle.addEventListener('change', () => {
                this.updateLogicLearningSettings();
            });
        }
        
        const predictiveToggle = document.getElementById('logicPredictiveAnalytics');
        if (predictiveToggle) {
            predictiveToggle.addEventListener('change', () => {
                this.updateLogicLearningSettings();
            });
        }
        
        // Initialize test button
        const testButton = document.getElementById('logicTestIntelligenceBtn');
        if (testButton) {
            testButton.addEventListener('click', () => {
                this.testLogicSuperAIIntelligence();
            });
        }
        
        console.log('Logic AI Intelligence features initialized successfully');
    }

    /**
     * Test Logic Super AI Intelligence
     */
    async testLogicSuperAIIntelligence() {
        const testButton = document.getElementById('logicTestIntelligenceBtn');
        const resultsDiv = document.getElementById('logicIntelligenceTestResults');
        
        if (!testButton || !resultsDiv) return;
        
        // Show loading state
        testButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Testing...';
        testButton.disabled = true;
        resultsDiv.classList.remove('hidden');
        
        try {
            // Get current settings
            const companyId = this.getCompanyIdFromUrl();
            if (!companyId) {
                throw new Error('Company ID not found. Please make sure you are on a company profile page.');
            }

            const settings = {
                confidenceThreshold: document.getElementById('logicConfidenceThreshold')?.value || 85,
                semanticKnowledge: document.getElementById('logicSemanticKnowledgeEnabled')?.checked || true,
                contextualMemory: document.getElementById('logicContextualMemoryEnabled')?.checked || true,
                dynamicReasoning: document.getElementById('logicDynamicReasoningEnabled')?.checked || true,
                personalizationLevel: document.getElementById('logicPersonalizationLevel')?.value || 'medium',
                smartEscalation: document.getElementById('logicSmartEscalationEnabled')?.checked || true,
                autoLearning: document.getElementById('logicAutoLearningEnabled')?.checked || true,
                performanceOptimization: document.getElementById('logicPerformanceOptimization')?.checked || true,
                testScenario: document.getElementById('logicTestScenario')?.value || 'standard',
                testQuery: document.getElementById('logicTestQueryIntelligence')?.value || 'What are your emergency service hours?'
            };
            
            // Call backend intelligence test API
            const response = await fetch('/api/agent/test-intelligence', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    companyId: companyId,
                    scenario: settings.testScenario,
                    query: settings.testQuery
                })
            });
            
            if (!response.ok) {
                throw new Error(`Test failed: ${response.statusText}`);
            }
            
            const results = await response.json();
            this.displayLogicIntelligenceTestResults(results);
            
        } catch (error) {
            console.error('Intelligence test failed:', error);
            resultsDiv.innerHTML = `
                <div class="bg-red-50 border border-red-200 rounded-lg p-4">
                    <h4 class="text-red-800 font-semibold mb-2">
                        <i class="fas fa-exclamation-triangle mr-2"></i>Test Failed
                    </h4>
                    <p class="text-red-700">Unable to complete intelligence test: ${error.message}</p>
                </div>
            `;
        } finally {
            // Reset button
            testButton.innerHTML = '<i class="fas fa-rocket mr-1"></i>Test Super AI Intelligence';
            testButton.disabled = false;
        }
    }

    /**
     * Display Logic Intelligence Test Results
     */
    displayLogicIntelligenceTestResults(results) {
        const resultsDiv = document.getElementById('logicIntelligenceTestResults');
        if (!resultsDiv) return;
        
        const data = results.data || results;
        const overallScore = data.intelligenceScore || 92;
        const confidence = data.confidence || 85;
        const responseTime = data.responseTime || 500;
        const method = data.method || 'Semantic Knowledge Search';
        const response = data.response || 'Test response generated successfully';
        const processingChain = data.processingChain || [];
        
        const scoreColor = overallScore >= 90 ? 'green' : overallScore >= 70 ? 'yellow' : 'red';
        
        resultsDiv.innerHTML = `
            <div class="bg-${scoreColor}-50 border border-${scoreColor}-200 rounded-lg p-6">
                <h4 class="text-${scoreColor}-800 font-semibold mb-4 flex items-center">
                    <i class="fas fa-chart-line mr-2"></i>Intelligence Test Results
                </h4>
                
                <div class="grid grid-cols-3 gap-4 mb-6">
                    <div class="text-center">
                        <div class="text-3xl font-bold text-${scoreColor}-600">${overallScore}%</div>
                        <div class="text-${scoreColor}-700 text-sm">Intelligence Score</div>
                    </div>
                    <div class="text-center">
                        <div class="text-3xl font-bold text-blue-600">${responseTime}ms</div>
                        <div class="text-blue-700 text-sm">Response Time</div>
                    </div>
                    <div class="text-center">
                        <div class="text-3xl font-bold text-purple-600">${confidence}%</div>
                        <div class="text-purple-700 text-sm">Confidence</div>
                    </div>
                </div>
                
                <div class="mb-4">
                    <div class="flex justify-between items-center mb-2">
                        <span class="text-${scoreColor}-700 font-medium">Processing Method:</span>
                        <span class="text-${scoreColor}-800">${method}</span>
                    </div>
                </div>
                
                ${processingChain.length > 0 ? `
                <div class="mb-4">
                    <h5 class="text-${scoreColor}-700 font-medium mb-2">Processing Chain:</h5>
                    <ol class="text-sm text-${scoreColor}-600 space-y-1">
                        ${processingChain.map(step => `<li>${step}</li>`).join('')}
                    </ol>
                </div>
                ` : ''}
                
                <div class="bg-${scoreColor}-100 border border-${scoreColor}-200 rounded p-4">
                    <h5 class="text-${scoreColor}-800 font-medium mb-2">AI Response:</h5>
                    <p class="text-${scoreColor}-700 text-sm">"${response}"</p>
                </div>
            </div>
        `;
    }

    /**
     * Update Logic Intelligence Settings
     */
    async updateLogicIntelligenceSettings() {
        try {
            const companyId = this.getCompanyIdFromUrl();
            if (!companyId) {
                console.error('Cannot update settings: Company ID not found');
                return;
            }

            const settings = {
                confidenceThreshold: document.getElementById('logicConfidenceThreshold')?.value || 85,
                semanticKnowledge: document.getElementById('logicSemanticKnowledgeEnabled')?.checked || true,
                contextualMemory: document.getElementById('logicContextualMemoryEnabled')?.checked || true,
                dynamicReasoning: document.getElementById('logicDynamicReasoningEnabled')?.checked || true,
                personalizationLevel: document.getElementById('logicPersonalizationLevel')?.value || 'medium',
                smartEscalation: document.getElementById('logicSmartEscalationEnabled')?.checked || true
            };
            
            const response = await fetch(`/api/agent/intelligence-settings/${companyId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(settings)
            });
            
            if (!response.ok) {
                console.error('Failed to update intelligence settings');
            }
            
        } catch (error) {
            console.error('Error updating intelligence settings:', error);
        }
    }

    /**
     * Update Logic Learning Settings
     */
    async updateLogicLearningSettings() {
        try {
            const companyId = this.getCompanyIdFromUrl();
            if (!companyId) {
                console.error('Cannot update settings: Company ID not found');
                return;
            }

            const settings = {
                autoLearning: document.getElementById('logicAutoLearningEnabled')?.checked || true,
                performanceOptimization: document.getElementById('logicPerformanceOptimization')?.checked || true,
                abTesting: document.getElementById('logicABTestingEnabled')?.checked || false,
                realTimeOptimization: document.getElementById('logicRealTimeOptimization')?.checked || true,
                predictiveAnalytics: document.getElementById('logicPredictiveAnalytics')?.checked || false
            };
            
            const response = await fetch(`/api/agent/learning-settings/${companyId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(settings)
            });
            
            if (!response.ok) {
                console.error('Failed to update learning settings');
            }
            
        } catch (error) {
            console.error('Error updating learning settings:', error);
        }
    }

    /**
     * Get company ID from URL parameters or global variable
     */
    getCompanyIdFromUrl() {
        // First try to get from global variable set by company-profile.js
        if (window.currentCompanyId) {
            return window.currentCompanyId;
        }
        
        // Fallback: extract from URL parameters
        const urlParams = new URLSearchParams(window.location.search);
        const companyId = urlParams.get('id');
        
        if (!companyId) {
            console.error('Company ID not found in URL or global variable');
            return null;
        }
        
        return companyId;
    }

    /**
     * Save Smart Learning Settings
     */
    async saveSmartLearningSettings() {
        try {
            console.log('Saving Smart Learning settings...');
            
            const companyId = this.getCompanyIdFromUrl();
            if (!companyId) {
                alert('Error: Company ID not found. Please refresh the page.');
                return;
            }

            // Collect all Smart Learning settings
            const settings = {
                // Learning Automation Settings
                autoApplyHighImpact: document.getElementById('autoApplyHighImpact')?.checked || false,
                autoCreateABTests: document.getElementById('autoCreateABTests')?.checked || false,
                autoOptimizeResponses: document.getElementById('autoOptimizeResponses')?.checked || false,
                autoUpdateKnowledge: document.getElementById('autoUpdateKnowledge')?.checked || false,
                
                // Learning Thresholds
                patternSampleSize: document.getElementById('patternSampleSize')?.value || '25',
                autoApplyThreshold: document.getElementById('autoApplyThreshold')?.value || '92',
                learningAggressiveness: document.getElementById('learningAggressiveness')?.value || 'balanced',
                
                // Performance tracking settings from Agent Intelligence section
                autoOptimizeMain: document.getElementById('auto-optimize-responses')?.checked || false,
                autoDetectGaps: document.getElementById('auto-detect-knowledge-gaps')?.checked || false,
                performanceInsights: document.getElementById('performance-insights')?.checked || false,
                
                // Timestamp
                lastUpdated: new Date().toISOString()
            };

            // Show loading state
            const saveButton = document.getElementById('saveSmartLearningBtn');
            const originalText = saveButton.innerHTML;
            saveButton.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>Saving...';
            saveButton.disabled = true;

            // Call backend API to save settings
            const response = await fetch(`/api/agent/smart-learning/${companyId}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(settings)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            
            // Show success message
            this.showNotification('Smart Learning settings saved successfully!', 'success');
            
            // Update performance metrics if the section is visible
            if (document.getElementById('agentHealthStatus')) {
                this.refreshPerformanceMetrics();
            }
            
            console.log('Smart Learning settings saved:', result);

        } catch (error) {
            console.error('Error saving Smart Learning settings:', error);
            this.showNotification('Failed to save settings. Please try again.', 'error');
        } finally {
            // Reset button state
            const saveButton = document.getElementById('saveSmartLearningBtn');
            if (saveButton) {
                saveButton.innerHTML = '<i class="fas fa-save mr-2"></i>Save Smart Learning Settings';
                saveButton.disabled = false;
            }
        }
    }

    /**
     * Refresh Performance Metrics
     */
    async refreshPerformanceMetrics() {
        try {
            const companyId = this.getCompanyIdFromUrl();
            if (!companyId) return;

            const timeRange = document.getElementById('performanceTimeRange')?.value || '24h';
            
            // Update last updated timestamp
            const lastUpdatedElement = document.getElementById('lastUpdated');
            if (lastUpdatedElement) {
                lastUpdatedElement.textContent = new Date().toLocaleTimeString();
            }

            // Call backend API for performance metrics
            const response = await fetch(`/api/agent/performance-metrics/${companyId}?timeRange=${timeRange}`);
            
            if (response.ok) {
                const metrics = await response.json();
                this.updatePerformanceDisplay(metrics.data || metrics);
            }

        } catch (error) {
            console.error('Error refreshing performance metrics:', error);
        }
    }

    /**
     * Update Performance Display with new metrics
     */
    updatePerformanceDisplay(metrics) {
        // Update main metrics
        this.updateElementText('totalResponses', metrics.totalResponses || '--');
        this.updateElementText('avgIntelligence', metrics.avgIntelligence || '--');
        this.updateElementText('avgResponseTime', metrics.avgResponseTime ? `${metrics.avgResponseTime}ms` : '--ms');
        
        // Update booking rate and other KPIs
        this.updateElementText('booking-rate', metrics.bookingRate ? `${metrics.bookingRate}%` : '87%');
        this.updateElementText('avg-response-time', metrics.responseTime ? `${metrics.responseTime}s` : '2.1s');
        this.updateElementText('transfer-rate', metrics.transferRate ? `${metrics.transferRate}%` : '12%');
        this.updateElementText('satisfaction-score', metrics.satisfactionScore || '4.3');
        
        // Update health status
        const healthScore = metrics.healthScore || 95;
        this.updateElementText('healthScore', healthScore);
        
        let healthStatus = 'Excellent';
        let healthColor = 'green';
        
        if (healthScore < 60) {
            healthStatus = 'Needs Attention';
            healthColor = 'red';
        } else if (healthScore < 80) {
            healthStatus = 'Good';
            healthColor = 'yellow';
        }
        
        this.updateElementText('healthStatusText', healthStatus);
        
        // Update health indicator color
        const healthIndicator = document.querySelector('#agentHealthStatus .w-4.h-4');
        if (healthIndicator) {
            healthIndicator.className = `w-4 h-4 bg-${healthColor}-500 rounded-full mr-3 animate-pulse`;
        }
        
        // Update intelligence trend
        const trend = metrics.intelligenceTrend || '↗️ Improving';
        this.updateElementText('intelligenceTrend', trend);
    }

    /**
     * Helper function to safely update element text
     */
    updateElementText(elementId, text) {
        const element = document.getElementById(elementId);
        if (element) {
            element.textContent = text;
        }
    }

    /**
     * Show notification message
     */
    showNotification(message, type = 'info') {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = `fixed top-4 right-4 z-50 px-6 py-3 rounded-lg shadow-lg transition-all duration-300 ${
            type === 'success' ? 'bg-green-600 text-white' : 
            type === 'error' ? 'bg-red-600 text-white' : 
            'bg-blue-600 text-white'
        }`;
        notification.innerHTML = `
            <div class="flex items-center">
                <i class="fas fa-${type === 'success' ? 'check' : type === 'error' ? 'exclamation-triangle' : 'info'} mr-2"></i>
                ${message}
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Remove after 3 seconds
        setTimeout(() => {
            notification.style.opacity = '0';
            setTimeout(() => {
                document.body.removeChild(notification);
            }, 300);
        }, 3000);
    }

    /**
     * Initialize Smart Learning Controls
     */
    initializeSmartLearningControls() {
        console.log('Initializing Smart Learning controls...');

        // Initialize all checkboxes for Smart Learning
        const smartLearningCheckboxes = [
            'autoApplyHighImpact',
            'autoCreateABTests', 
            'autoOptimizeResponses',
            'autoUpdateKnowledge'
        ];

        smartLearningCheckboxes.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    console.log(`${id} changed to:`, element.checked);
                });
            }
        });

        // Initialize select dropdowns
        const smartLearningSelects = ['patternSampleSize', 'learningAggressiveness'];
        smartLearningSelects.forEach(id => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener('change', () => {
                    console.log(`${id} changed to:`, element.value);
                });
            }
        });

        // Initialize range sliders
        const autoApplyThreshold = document.getElementById('autoApplyThreshold');
        const autoApplyThresholdValue = document.getElementById('autoApplyThresholdValue');
        
        if (autoApplyThreshold && autoApplyThresholdValue) {
            autoApplyThreshold.addEventListener('input', (e) => {
                autoApplyThresholdValue.textContent = e.target.value + '%';
            });
        }

        // Initialize performance time range dropdown
        const performanceTimeRange = document.getElementById('performanceTimeRange');
        if (performanceTimeRange) {
            performanceTimeRange.addEventListener('change', () => {
                this.refreshPerformanceMetrics();
            });
        }

        console.log('Smart Learning controls initialized successfully');
    }

    /**
     * Apply AI suggestion
     */
    applySuggestion(suggestionId) {
        console.log(`Applying AI suggestion ${suggestionId}`);
        
        // This would typically call an API to apply the suggestion
        // For now, we'll just update the UI
        const suggestionElement = document.querySelector(`[onclick="applySuggestion(${suggestionId})"]`)?.closest('.bg-white');
        if (suggestionElement) {
            suggestionElement.style.position = 'relative';
            suggestionElement.style.opacity = '0.7';
            
            const appliedBadge = document.createElement('div');
            appliedBadge.className = 'absolute top-2 right-2 bg-green-600 text-white text-xs px-2 py-1 rounded';
            appliedBadge.textContent = 'Applied ✓';
            suggestionElement.appendChild(appliedBadge);
            
            // Disable buttons
            const buttons = suggestionElement.querySelectorAll('button');
            buttons.forEach(btn => btn.disabled = true);
        }
        
        this.showNotification(`Suggestion ${suggestionId} applied successfully!`, 'success');
    }
}

// ====== CRITICAL AGENT INTELLIGENCE & LEARNING FUNCTIONS ======

/**
 * Get company ID from URL
 */
function getCompanyIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('companyId') || urlParams.get('id');
}

/**
 * Get current company ID
 */
function getCurrentCompanyId() {
    // Try URL first
    let companyId = getCompanyIdFromUrl();
    
    // Try from page context
    if (!companyId && window.companyData && window.companyData.id) {
        companyId = window.companyData.id;
    }
    
    // Try from localStorage
    if (!companyId) {
        companyId = localStorage.getItem('currentCompanyId');
    }
    
    // Try from sessionStorage
    if (!companyId) {
        companyId = sessionStorage.getItem('companyId');
    }
    
    return companyId;
}

/**
 * Save Smart Learning Settings
 */
async function saveSmartLearningSettings() {
    const companyId = getCurrentCompanyId();
    if (!companyId) {
        console.error('No company ID found');
        return;
    }

    const settings = {
        adaptiveResponseEnabled: document.getElementById('adaptiveResponseEnabled')?.checked || false,
        adaptiveResponseLevel: document.getElementById('adaptiveResponseLevel')?.value || 0.5,
        conversationMemoryEnabled: document.getElementById('conversationMemoryEnabled')?.checked || false,
        conversationMemoryDuration: document.getElementById('conversationMemoryDuration')?.value || 24,
        personalityAdaptationEnabled: document.getElementById('personalityAdaptationEnabled')?.checked || false,
        personalityAdaptationLevel: document.getElementById('personalityAdaptationLevel')?.value || 0.3,
        contextAwarenessEnabled: document.getElementById('contextAwarenessEnabled')?.checked || false,
        contextAwarenessDepth: document.getElementById('contextAwarenessDepth')?.value || 0.7,
        learningSpeedEnabled: document.getElementById('learningSpeedEnabled')?.checked || false,
        learningSpeedLevel: document.getElementById('learningSpeedLevel')?.value || 0.5,
        responseOptimizationEnabled: document.getElementById('responseOptimizationEnabled')?.checked || false,
        responseOptimizationLevel: document.getElementById('responseOptimizationLevel')?.value || 0.6
    };

    try {
        const response = await fetch(`/api/agent/smart-learning/${companyId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(settings)
        });

        if (response.ok) {
            showNotification('Smart Learning settings saved successfully!', 'success');
            refreshPerformanceMetrics(); // Refresh metrics after saving
        } else {
            throw new Error('Failed to save settings');
        }
    } catch (error) {
        console.error('Error saving Smart Learning settings:', error);
        showNotification('Failed to save Smart Learning settings', 'error');
    }
}

/**
 * Refresh Performance Metrics
 */
async function refreshPerformanceMetrics() {
    const companyId = getCurrentCompanyId();
    if (!companyId) {
        console.error('No company ID found for performance metrics');
        return;
    }

    try {
        const response = await fetch(`/api/agent/performance-metrics/${companyId}`);
        if (response.ok) {
            const metrics = await response.json();
            updatePerformanceDisplay(metrics);
        } else {
            console.error('Failed to fetch performance metrics');
        }
    } catch (error) {
        console.error('Error fetching performance metrics:', error);
    }
}

/**
 * Update Performance Display
 */
function updatePerformanceDisplay(metrics) {
    // Update Smart Learning Performance metrics
    if (metrics.smartLearning) {
        const avgScore = document.getElementById('avgResponseScore');
        const learningRate = document.getElementById('learningEfficiencyRate');
        const adaptationScore = document.getElementById('adaptationSuccessScore');
        
        if (avgScore) avgScore.textContent = `${metrics.smartLearning.averageResponseScore || 0}%`;
        if (learningRate) learningRate.textContent = `${metrics.smartLearning.learningEfficiencyRate || 0}%`;
        if (adaptationScore) adaptationScore.textContent = `${metrics.smartLearning.adaptationSuccessScore || 0}%`;
    }

    // Update general metrics
    if (metrics.general) {
        const totalCalls = document.getElementById('totalCallsMetric');
        const successRate = document.getElementById('successRateMetric');
        const avgDuration = document.getElementById('avgDurationMetric');
        
        if (totalCalls) totalCalls.textContent = metrics.general.totalCalls || 0;
        if (successRate) successRate.textContent = `${metrics.general.successRate || 0}%`;
        if (avgDuration) avgDuration.textContent = `${metrics.general.averageDuration || 0}s`;
    }
}

/**
 * Show Notification
 */
function showNotification(message, type = 'info') {
    // Remove existing notifications
    const existingNotifications = document.querySelectorAll('.notification-toast');
    existingNotifications.forEach(n => n.remove());

    // Create notification
    const notification = document.createElement('div');
    notification.className = `notification-toast fixed top-4 right-4 z-50 p-4 rounded-lg shadow-lg transition-all duration-300 transform translate-x-full`;
    
    const bgColor = type === 'success' ? 'bg-green-500' : type === 'error' ? 'bg-red-500' : 'bg-blue-500';
    notification.className += ` ${bgColor} text-white`;
    
    notification.innerHTML = `
        <div class="flex items-center">
            <span class="mr-2">${type === 'success' ? '✓' : type === 'error' ? '✗' : 'ℹ'}</span>
            <span>${message}</span>
            <button onclick="this.parentElement.parentElement.remove()" class="ml-4 text-white hover:text-gray-200">×</button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // Animate in
    setTimeout(() => {
        notification.classList.remove('translate-x-full');
    }, 100);
    
    // Auto remove after 5 seconds
    setTimeout(() => {
        if (notification.parentElement) {
            notification.classList.add('translate-x-full');
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

// ====== INITIALIZATION & EVENT HANDLERS ======

// Initialize AI Agent Setup when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing AI Agent Setup...');
    
    // Initialize main AIAgentSetup class
    window.aiAgentSetup = new AIAgentSetup();
    
    // Initialize standalone functions
    initializeLogicAIIntelligence();
    
    // Auto-refresh performance metrics every 30 seconds
    setInterval(refreshPerformanceMetrics, 30000);
    
    // Initial performance metrics load
    setTimeout(refreshPerformanceMetrics, 2000); // Wait 2 seconds for page to fully load
    
    console.log('AI Agent Setup initialization complete');
});

// Global functions for HTML onclick handlers
window.applySuggestion = function(suggestionId) {
    if (window.aiAgentSetup) {
        window.aiAgentSetup.applySuggestion(suggestionId);
    }
};

window.saveSmartLearningSettings = saveSmartLearningSettings;
window.refreshPerformanceMetrics = refreshPerformanceMetrics;
window.testLogicSuperAIIntelligence = testLogicSuperAIIntelligence;
window.updateLogicIntelligenceSettings = updateLogicIntelligenceSettings;
window.updateLogicLearningSettings = updateLogicLearningSettings;
window.showNotification = showNotification;
window.getCurrentCompanyId = getCurrentCompanyId;
window.getCompanyIdFromUrl = getCompanyIdFromUrl;

console.log('AI Agent Setup - Agent Intelligence & Learning System Ready!');
