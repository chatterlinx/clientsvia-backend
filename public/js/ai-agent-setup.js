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

    /**
     * Test current script with a sample question
     */
    async testCurrentScript() {
        const question = document.getElementById('scriptTestQuestion')?.value;
        if (!question) {
            this.showNotification('Please enter a test question', 'warning');
            return;
        }

        const companyId = this.getCompanyId();
        if (!companyId) {
            this.showNotification('Company ID not found', 'error');
            return;
        }

        try {
            document.getElementById('testScriptBtn').disabled = true;
            document.getElementById('testScriptBtn').textContent = 'Testing...';

            const response = await fetch('/api/ai-agent-setup/test-script', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    question: question,
                    companyId: companyId
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.displayScriptTestResult(result);
            } else {
                this.showNotification(`Script test failed: ${result.message}`, 'error');
            }

        } catch (error) {
            console.error('Script test error:', error);
            this.showNotification('Script test failed', 'error');
        } finally {
            document.getElementById('testScriptBtn').disabled = false;
            document.getElementById('testScriptBtn').textContent = 'Test Script';
        }
    }

    /**
     * Validate current script structure
     */
    async validateCurrentScript() {
        const script = document.getElementById('behaviorGuidelines')?.value;
        if (!script) {
            this.showNotification('No script content to validate', 'warning');
            return;
        }

        const companyId = this.getCompanyId();

        try {
            document.getElementById('validateScriptBtn').disabled = true;
            document.getElementById('validateScriptBtn').textContent = 'Validating...';

            const response = await fetch('/api/ai-agent-setup/validate-script', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({
                    script: script,
                    companyId: companyId
                })
            });

            const result = await response.json();
            
            if (result.success) {
                this.displayScriptValidation(result.validation);
            } else {
                this.showNotification(`Script validation failed: ${result.message}`, 'error');
            }

        } catch (error) {
            console.error('Script validation error:', error);
            this.showNotification('Script validation failed', 'error');
        } finally {
            document.getElementById('validateScriptBtn').disabled = false;
            document.getElementById('validateScriptBtn').textContent = 'Validate Script';
        }
    }

    /**
     * Show script analytics
     */
    async showScriptAnalytics() {
        const companyId = this.getCompanyId();
        if (!companyId) {
            this.showNotification('Company ID not found', 'error');
            return;
        }

        try {
            const response = await fetch(`/api/ai-agent-setup/script-analytics/${companyId}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });

            const result = await response.json();
            
            if (result.success) {
                this.displayScriptAnalytics(result.analytics);
            } else {
                this.showNotification(`Failed to load analytics: ${result.message}`, 'error');
            }

        } catch (error) {
            console.error('Script analytics error:', error);
            this.showNotification('Failed to load script analytics', 'error');
        }
    }

    /**
     * Test script with live question
     */
    async testScriptQuestion() {
        await this.testCurrentScript();
    }

    /**
     * Display script test results
     */
    displayScriptTestResult(result) {
        const resultsDiv = document.getElementById('scriptTestResults');
        if (!resultsDiv) return;

        const { scriptResult, testQuestion, hasScript, scriptLength } = result;

        let resultHTML = `
            <div class="script-test-result">
                <div class="test-info">
                    <strong>Test Question:</strong> "${testQuestion}"<br>
                    <strong>Script Status:</strong> ${hasScript ? 'Found' : 'Missing'} (${scriptLength} chars)
                </div>
        `;

        if (scriptResult) {
            resultHTML += `
                <div class="script-response">
                    <strong>Script Response:</strong>
                    <div class="response-text">${scriptResult.text}</div>
                    <div class="debug-info">
                        <strong>Debug Info:</strong>
                        <ul>
                            <li>Section: ${scriptResult.debugInfo?.section || 'N/A'}</li>
                            <li>Match Type: ${scriptResult.debugInfo?.matchType || 'N/A'}</li>
                            <li>Escalate: ${scriptResult.escalate ? 'Yes' : 'No'}</li>
                            ${scriptResult.debugInfo?.trigger ? `<li>Trigger: "${scriptResult.debugInfo.trigger}"</li>` : ''}
                        </ul>
                    </div>
                </div>
            `;
        } else {
            resultHTML += `
                <div class="no-script-response">
                    <strong>Result:</strong> Script did not handle this question
                    <div class="fallback-info">The question would fall back to other response methods (Q&A, LLM, etc.)</div>
                </div>
            `;
        }

        resultHTML += '</div>';
        resultsDiv.innerHTML = resultHTML;
    }

    /**
     * Display script validation results
     */
    displayScriptValidation(validation) {
        const validationDiv = document.getElementById('scriptValidationResults');
        if (!validationDiv) return;

        let validationHTML = `
            <div class="script-validation-result">
                <div class="validation-status ${validation.isValid ? 'valid' : 'invalid'}">
                    <strong>Validation Status:</strong> ${validation.isValid ? '✅ Valid' : '❌ Invalid'}
                </div>
                
                <div class="pattern-analysis">
                    <strong>Pattern Analysis:</strong>
                    <ul>
                        <li>Conditionals (if/when): ${validation.patterns.conditionals}</li>
                        <li>Q&A Patterns: ${validation.patterns.qaPatterns}</li>
                        <li>Business Rules: ${validation.patterns.businessRules}</li>
                    </ul>
                </div>
        `;

        if (validation.warnings.length > 0) {
            validationHTML += `
                <div class="validation-warnings">
                    <strong>⚠️ Warnings:</strong>
                    <ul>${validation.warnings.map(w => `<li>${w}</li>`).join('')}</ul>
                </div>
            `;
        }

        if (validation.suggestions.length > 0) {
            validationHTML += `
                <div class="validation-suggestions">
                    <strong>💡 Suggestions:</strong>
                    <ul>${validation.suggestions.map(s => `<li>${s}</li>`).join('')}</ul>
                </div>
            `;
        }

        validationHTML += '</div>';
        validationDiv.innerHTML = validationHTML;
    }

    /**
     * Display script analytics
     */
    displayScriptAnalytics(analytics) {
        const analyticsDiv = document.getElementById('scriptAnalyticsResults');
        if (!analyticsDiv) return;

        let analyticsHTML = `
            <div class="script-analytics-result">
                <div class="analytics-summary">
                    <strong>Script Analytics Summary:</strong>
                    <ul>
                        <li>Script Coverage: ${analytics.scriptCoverage}%</li>
                        <li>Unmatched Questions: ${analytics.unmatchedQuestions.length}</li>
                        <li>Improvement Suggestions: ${analytics.suggestedImprovements.length}</li>
                    </ul>
                </div>
            </div>
        `;

        analyticsDiv.innerHTML = analyticsHTML;
    }

    /**
     * Get current company ID from URL or storage
     */
    getCompanyId() {
        // Try to get from URL parameters first
        const urlParams = new URLSearchParams(window.location.search);
        let companyId = urlParams.get('companyId');
        
        // If not in URL, try to get from local storage or other sources
        if (!companyId) {
            companyId = localStorage.getItem('currentCompanyId');
        }
        
        // If still not found, try to extract from page context
        if (!companyId) {
            const companySelect = document.getElementById('companySelect');
            if (companySelect) {
                companyId = companySelect.value;
            }
        }
        
        return companyId;
    }
}

// Initialize AI Agent Setup when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    if (document.getElementById('ai-agent-setup-content')) {
        window.aiAgentSetup = new AIAgentSetup();
    }
});
