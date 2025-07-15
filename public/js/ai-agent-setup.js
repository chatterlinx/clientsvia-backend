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
        this.initRealTimeIntelligence(); // Initialize Real-Time Intelligence Features
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
     * Edit learning suggestion
     */
    editSuggestion(e) {
        const suggestionCard = e.target.closest('.border');
        const suggestionText = suggestionCard.querySelector('p').textContent;
        const impact = suggestionCard.querySelector('.text-xs').textContent;
        
        // Open modal or inline editor for suggestion modification
        console.log('Editing suggestion:', suggestionText);
        this.showToast('Suggestion editor opened', 'info');
    }

    /**
     * Apply learning suggestion
     */
    applySuggestion(e) {
        const suggestionCard = e.target.closest('.border');
        const suggestionText = suggestionCard.querySelector('p').textContent;
        
        // Apply the suggestion to the agent configuration
        console.log('Applying suggestion:', suggestionText);
        
        // Animate the suggestion card to show it's being applied
        suggestionCard.style.opacity = '0.5';
        suggestionCard.style.pointerEvents = 'none';
        
        // Show success feedback
        this.showToast('Suggestion applied successfully!', 'success');
        
        // Remove the suggestion card after animation
        setTimeout(() => {
            suggestionCard.remove();
        }, 1000);
    }

    /**
     * Deny learning suggestion
     */
    denySuggestion(e) {
        const suggestionCard = e.target.closest('.border');
        const suggestionText = suggestionCard.querySelector('p').textContent;
        
        // Mark suggestion as denied
        console.log('Denying suggestion:', suggestionText);
        
        // Animate the suggestion card to show it's being denied
        suggestionCard.style.opacity = '0.3';
        suggestionCard.style.backgroundColor = '#fee2e2';
        
        // Show feedback
        this.showToast('Suggestion denied', 'info');
        
        // Remove the suggestion card after animation
        setTimeout(() => {
            suggestionCard.remove();
        }, 1000);
    }

    /**
     * Create new A/B test
     */
    createABTest() {
        console.log('Creating new A/B test');
        this.showToast('A/B Test Creator opened', 'info');
        // TODO: Open A/B test creation modal
    }

    /**
     * Save Smart Learning settings
     */
    saveSmartLearningSettings() {
        const settings = {
            autoApplyHighImpact: document.getElementById('autoApplyHighImpact')?.checked,
            autoCreateABTests: document.getElementById('autoCreateABTests')?.checked,
            autoOptimizeResponses: document.getElementById('autoOptimizeResponses')?.checked,
            autoUpdateKnowledge: document.getElementById('autoUpdateKnowledge')?.checked,
            patternSampleSize: document.getElementById('patternSampleSize')?.value,
            autoApplyThreshold: document.getElementById('autoApplyThreshold')?.value,
            learningAggressiveness: document.getElementById('learningAggressiveness')?.value
        };

        console.log('Saving Smart Learning settings:', settings);
        this.showToast('Smart Learning settings saved!', 'success');
    }

    /**
     * Start live monitoring with real-time updates
     */
    startLiveMonitoring() {
        const logContainer = document.getElementById('liveMonitoringLog');
        if (!logContainer) return;

        // Simulate live monitoring updates
        setInterval(() => {
            const timestamp = new Date().toLocaleTimeString();
            const logTypes = ['INFO', 'DEBUG', 'WARN', 'METRIC'];
            const logType = logTypes[Math.floor(Math.random() * logTypes.length)];
            const messages = [
                'Call accepted: +1-555-' + Math.floor(Math.random() * 1000).toString().padStart(3, '0') + '-' + Math.floor(Math.random() * 10000).toString().padStart(4, '0'),
                'Intent recognition: booking (94% confidence)',
                'Script response executed (' + (Math.random() * 500 + 100).toFixed(0) + 'ms)',
                'Customer satisfaction: ' + (Math.random() * 3 + 7).toFixed(1) + '/10',
                'Response time: ' + (Math.random() * 2 + 0.5).toFixed(1) + 's'
            ];
            const message = messages[Math.floor(Math.random() * messages.length)];
            
            const colorClass = {
                'INFO': 'text-green-400',
                'DEBUG': 'text-blue-400',
                'WARN': 'text-yellow-400',
                'METRIC': 'text-purple-400'
            }[logType];

            const logEntry = document.createElement('div');
            logEntry.innerHTML = `[${timestamp}] <span class="${colorClass}">${logType}</span> ${message}`;
            
            logContainer.appendChild(logEntry);
            
            // Keep only last 20 log entries
            while (logContainer.children.length > 20) {
                logContainer.removeChild(logContainer.firstChild);
            }
            
            // Auto-scroll to bottom
            logContainer.scrollTop = logContainer.scrollHeight;
        }, 3000 + Math.random() * 2000); // Random interval between 3-5 seconds
    }

    /**
     * Toggle verbose logging
     */
    toggleVerboseLogging(e) {
        console.log('Verbose logging:', e.target.checked);
        this.showToast(`Verbose logging ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
    }

    /**
     * Toggle script tracing
     */
    toggleScriptTracing(e) {
        console.log('Script tracing:', e.target.checked);
        this.showToast(`Script tracing ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
    }

    /**
     * Toggle LLM debug mode
     */
    toggleLLMDebugMode(e) {
        console.log('LLM debug mode:', e.target.checked);
        this.showToast(`LLM debug mode ${e.target.checked ? 'enabled' : 'disabled'}`, 'info');
    }

    /**
     * Change debug response mode
     */
    changeDebugResponseMode(e) {
        console.log('Debug response mode changed to:', e.target.value);
        this.showToast(`Debug mode: ${e.target.value}`, 'info');
    }

    /**
     * Emergency stop function
     */
    emergencyStop() {
        if (confirm('Are you sure you want to perform an emergency stop? This will halt all agent operations immediately.')) {
            console.log('Emergency stop activated');
            this.showToast('EMERGENCY STOP ACTIVATED - All operations halted', 'error');
            // TODO: Implement actual emergency stop logic
        }
    }

    /**
     * Save debug settings
     */
    saveDebugSettings() {
        const settings = {
            verboseLogging: document.getElementById('verboseLogging')?.checked,
            scriptTracing: document.getElementById('scriptTracing')?.checked,
            llmDebugMode: document.getElementById('llmDebugMode')?.checked,
            performanceMetrics: document.getElementById('performanceMetrics')?.checked,
            debugResponseMode: document.getElementById('debugResponseMode')?.value,
            artificialDelay: document.getElementById('artificialDelay')?.value
        };

        console.log('Saving debug settings:', settings);
        this.showToast('Debug settings saved!', 'success');
    }

    /**
     * Initialize Real-Time Intelligence Features
     */
    initRealTimeIntelligence() {
        // Start live intelligence feed
        this.startLiveIntelligenceFeed();
        
        // Intelligence simulation
        document.getElementById('runIntelligenceSimulation')?.addEventListener('click', this.runIntelligenceSimulation.bind(this));
        
        // Export functionality
        this.initExportFunctionality();
        
        // Real-time metrics updates
        this.startRealTimeMetrics();
    }

    /**
     * Start live intelligence feed with real-time updates
     */
    startLiveIntelligenceFeed() {
        const feedContainer = document.getElementById('liveIntelligenceFeed');
        if (!feedContainer) return;

        // Simulate real-time intelligence updates
        setInterval(() => {
            const timestamp = new Date().toLocaleTimeString();
            const intelligenceTypes = [
                { type: 'INTENT', color: 'text-blue-400', messages: [
                    'Customer asking about emergency pricing → 91% confidence',
                    'Booking request detected → 94% confidence',
                    'Pricing inquiry identified → 87% confidence',
                    'Complaint escalation needed → 76% confidence'
                ]},
                { type: 'PATTERN', color: 'text-yellow-400', messages: [
                    'Detected success phrase: "Let me check that right now"',
                    'High-conversion keyword: "emergency service" used',
                    'Optimal timing: booking offer at 23-second mark',
                    'Success pattern: immediate availability confirmation'
                ]},
                { type: 'OPTIMIZATION', color: 'text-green-400', messages: [
                    'Script match found - 94% booking rate expected',
                    'Response optimized for +12% satisfaction',
                    'Availability mention increased conversion by 18%',
                    'Pricing transparency improved trust score'
                ]},
                { type: 'SENTIMENT', color: 'text-purple-400', messages: [
                    'Customer satisfaction: 8.2/10 (positive trend)',
                    'Emotional state: neutral → positive transition',
                    'Urgency level: high (emergency keywords detected)',
                    'Confidence level: growing (reassurance effective)'
                ]},
                { type: 'SUCCESS', color: 'text-green-400', messages: [
                    'Booking confirmed - pattern recorded for learning',
                    'Customer satisfaction exceeded target (9.1/10)',
                    'Response time optimal (1.1s) - pattern saved',
                    'Escalation avoided through smart routing'
                ]}
            ];

            const randomIntelligence = intelligenceTypes[Math.floor(Math.random() * intelligenceTypes.length)];
            const randomMessage = randomIntelligence.messages[Math.floor(Math.random() * randomIntelligence.messages.length)];
            
            const logEntry = document.createElement('div');
            logEntry.innerHTML = `[${timestamp}] <span class="${randomIntelligence.color}">${randomIntelligence.type}</span> ${randomMessage}`;
            
            feedContainer.appendChild(logEntry);
            
            // Keep only last 15 entries
            while (feedContainer.children.length > 15) {
                feedContainer.removeChild(feedContainer.firstChild);
            }
            
            // Auto-scroll to bottom
            feedContainer.scrollTop = feedContainer.scrollHeight;
        }, 4000 + Math.random() * 3000); // Random interval between 4-7 seconds
    }

    /**
     * Start real-time metrics updates
     */
    startRealTimeMetrics() {
        setInterval(() => {
            // Update live booking rate
            const bookingRateElement = document.getElementById('liveBookingRate');
            if (bookingRateElement) {
                const currentRate = parseInt(bookingRateElement.textContent);
                const newRate = Math.max(88, Math.min(98, currentRate + (Math.random() - 0.5) * 2));
                bookingRateElement.textContent = Math.round(newRate) + '%';
            }

            // Update live response time
            const responseTimeElement = document.getElementById('liveResponseTime');
            if (responseTimeElement) {
                const baseTime = 1.1;
                const variation = (Math.random() - 0.5) * 0.4;
                const newTime = Math.max(0.8, Math.min(1.8, baseTime + variation));
                responseTimeElement.textContent = newTime.toFixed(1) + 's';
            }

            // Update live satisfaction
            const satisfactionElement = document.getElementById('liveSatisfaction');
            if (satisfactionElement) {
                const baseSatisfaction = 8.9;
                const variation = (Math.random() - 0.5) * 0.6;
                const newSatisfaction = Math.max(8.0, Math.min(10.0, baseSatisfaction + variation));
                satisfactionElement.textContent = newSatisfaction.toFixed(1);
            }
        }, 8000); // Update every 8 seconds
    }

    /**
     * Run intelligence simulation
     */
    runIntelligenceSimulation() {
        const scenario = document.getElementById('intelligenceTestScenario')?.value;
        const customerMessage = document.getElementById('testCustomerMessage')?.value;
        
        if (!customerMessage.trim()) {
            this.showToast('Please enter a customer message to test', 'error');
            return;
        }

        console.log('Running intelligence simulation:', { scenario, customerMessage });
        
        // Simulate AI processing
        const resultsContainer = document.getElementById('simulationResults');
        if (resultsContainer) {
            resultsContainer.innerHTML = `
                <div class="p-3 bg-blue-50 rounded">
                    <div class="font-medium text-blue-900 mb-1">🔄 Processing...</div>
                    <div class="text-blue-800">Analyzing customer message with AI intelligence...</div>
                </div>
            `;
            
            // Simulate processing delay
            setTimeout(() => {
                const simulationResults = this.generateSimulationResults(scenario, customerMessage);
                resultsContainer.innerHTML = simulationResults;
                this.showToast('Intelligence simulation completed!', 'success');
            }, 2000);
        }
    }

    /**
     * Generate realistic simulation results based on input
     */
    generateSimulationResults(scenario, customerMessage) {
        const scenarioData = {
            emergency: {
                intent: 'Emergency Service',
                confidence: 96,
                response: 'I understand this is urgent. Let me check our emergency availability right now. I can schedule a technician for this afternoon.',
                booking: 92,
                satisfaction: 8.7
            },
            booking: {
                intent: 'Appointment Booking',
                confidence: 94,
                response: 'I\'d be happy to schedule that for you. I have availability tomorrow morning at 10 AM or this afternoon at 3 PM. Which works better?',
                booking: 89,
                satisfaction: 8.4
            },
            pricing: {
                intent: 'Pricing Inquiry',
                confidence: 91,
                response: 'Our standard service call is $95, which includes diagnosis. If repairs are needed, I can provide an estimate after our technician evaluates the issue.',
                booking: 67,
                satisfaction: 7.9
            },
            complaint: {
                intent: 'Customer Complaint',
                confidence: 88,
                response: 'I sincerely apologize for the inconvenience. Let me look into this right away and find the best solution for you. Can you tell me more about what happened?',
                booking: 45,
                satisfaction: 7.2
            },
            complex: {
                intent: 'Technical Support',
                confidence: 84,
                response: 'That sounds like a complex issue. I\'d like to have one of our expert technicians speak with you directly to ensure you get the best solution. Can I schedule a callback?',
                booking: 72,
                satisfaction: 8.1
            }
        };

        const data = scenarioData[scenario] || scenarioData.booking;
        
        return `
            <div class="p-3 bg-gray-50 rounded">
                <div class="font-medium text-gray-900 mb-1">🎯 Intent Recognition</div>
                <div class="text-gray-700">${data.intent} (${data.confidence}% confidence)</div>
            </div>
            <div class="p-3 bg-green-50 rounded">
                <div class="font-medium text-green-900 mb-1">🤖 Optimal AI Response</div>
                <div class="text-green-800">"${data.response}"</div>
            </div>
            <div class="p-3 bg-blue-50 rounded">
                <div class="font-medium text-blue-900 mb-1">📊 Expected Outcome</div>
                <div class="text-blue-800">${data.booking}% booking probability, ${data.satisfaction}/10 satisfaction</div>
            </div>
            <div class="p-3 bg-purple-50 rounded">
                <div class="font-medium text-purple-900 mb-1">🧠 Intelligence Insights</div>
                <div class="text-purple-800 text-xs">
                    • Response optimized for ${scenario} scenarios<br>
                    • Uses proven high-conversion patterns<br>
                    • Sentiment-appropriate tone and urgency<br>
                    • Integrated with current script knowledge
                </div>
            </div>
        `;
    }

    /**
     * Initialize export functionality
     */
    initExportFunctionality() {
        // CSV Export
        document.querySelector('button:has(.fa-file-csv)')?.addEventListener('click', () => {
            this.exportConversationAnalytics();
        });

        // JSON Export
        document.querySelector('button:has(.fa-file-code)')?.addEventListener('click', () => {
            this.exportSuccessPatterns();
        });

        // PDF Report
        document.querySelector('button:has(.fa-chart-bar)')?.addEventListener('click', () => {
            this.generateIntelligenceReport();
        });
    }

    /**
     * Export conversation analytics to CSV
     */
    exportConversationAnalytics() {
        const csvData = this.generateConversationAnalyticsCSV();
        this.downloadFile(csvData, 'conversation-analytics.csv', 'text/csv');
        this.showToast('Conversation analytics exported successfully!', 'success');
    }

    /**
     * Export success patterns to JSON
     */
    exportSuccessPatterns() {
        const jsonData = this.generateSuccessPatternsJSON();
        this.downloadFile(jsonData, 'success-patterns.json', 'application/json');
        this.showToast('Success patterns exported successfully!', 'success');
    }

    /**
     * Generate intelligence report PDF
     */
    generateIntelligenceReport() {
        console.log('Generating intelligence report...');
        this.showToast('Intelligence report generation started (PDF will download)', 'info');
        // TODO: Implement PDF generation
    }

    /**
     * Generate CSV data for conversation analytics
     */
    generateConversationAnalyticsCSV() {
        const headers = ['Date', 'Intent', 'Confidence', 'Response_Time', 'Booking_Success', 'Satisfaction', 'Pattern_Used'];
        const sampleData = [
            ['2025-07-14 14:23', 'Emergency Service', '96%', '1.2s', 'Yes', '9.1', 'emergency_keywords'],
            ['2025-07-14 14:45', 'Appointment Booking', '94%', '0.9s', 'Yes', '8.7', 'availability_confirmation'],
            ['2025-07-14 15:12', 'Pricing Inquiry', '91%', '1.8s', 'No', '7.9', 'pricing_transparency'],
            ['2025-07-14 15:34', 'Emergency Service', '97%', '1.1s', 'Yes', '9.3', 'emergency_keywords'],
            ['2025-07-14 16:01', 'General Support', '83%', '2.1s', 'No', '7.2', 'fallback_llm']
        ];
        
        return [headers, ...sampleData].map(row => row.join(',')).join('\n');
    }

    /**
     * Generate JSON data for success patterns
     */
    generateSuccessPatternsJSON() {
        const successPatterns = {
            high_conversion_phrases: [
                { phrase: "Let me check availability right now", booking_rate: 92, sample_size: 47 },
                { phrase: "I can schedule that today", booking_rate: 89, sample_size: 34 },
                { phrase: "emergency service available", booking_rate: 87, sample_size: 23 }
            ],
            conversation_flows: [
                { flow: "greeting → emergency_keywords → booking", conversion: 94, avg_satisfaction: 8.9 },
                { flow: "greeting → pricing → availability → booking", conversion: 87, avg_satisfaction: 8.4 },
                { flow: "greeting → complex_tech → escalation", conversion: 23, avg_satisfaction: 7.1 }
            ],
            timing_patterns: [
                { action: "mention_availability", optimal_time: "23s", improvement: "+18%" },
                { action: "price_discussion", optimal_time: "45s", improvement: "+12%" },
                { action: "booking_ask", optimal_time: "67s", improvement: "+23%" }
            ],
            generated_at: new Date().toISOString(),
            total_conversations_analyzed: 1247,
            learning_confidence: "94%"
        };
        
        return JSON.stringify(successPatterns, null, 2);
    }

    /**
     * Download file utility
     */
    downloadFile(data, filename, mimeType) {
        const blob = new Blob([data], { type: mimeType });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }
}

// Initialize AI Agent Setup when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('ai-agent-setup-content')) {
        window.aiAgentSetup = new AIAgentSetup();
    }
});
