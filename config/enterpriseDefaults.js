/**
 * Enterprise Booking Flow Defaults and Configuration
 * Production-ready defaults for enterprise booking flows with comprehensive validation
 */

const enterpriseBookingFlowDefaults = {
    // Default enterprise booking flow schema
    defaultSchema: {
        companyID: "{{companyId}}",
        version: 1,
        schemaType: "enterprise",
        isActive: true,
        validationLevel: "strict",
        
        // Enterprise booking fields with comprehensive validation
        fields: [
            {
                prompt: "Ok. What's the service address, including city?",
                name: "address.full",
                type: "string",
                required: true,
                validate: "len>=8",
                sanitize: true,
                priority: 1,
                helpText: "Full address including street, city, and ZIP code",
                examples: ["123 Main St, Springfield, IL 62701"],
                errorMessages: {
                    required: "Service address is required for scheduling",
                    minLength: "Please provide a complete address including city"
                }
            },
            {
                prompt: "Is there a gate code or special access instruction?",
                name: "address.access",
                type: "string",
                required: false,
                maxLength: 200,
                priority: 2,
                helpText: "Gate codes, building access, parking instructions",
                examples: ["Gate code: 1234", "Ring bell for unit 3A", "Park in visitor spaces"]
            },
            {
                prompt: "Is the number you're calling from the best cell for text updates?",
                name: "contact.phone",
                type: "phone",
                required: true,
                normalize: "+1E164",
                priority: 3,
                validate: "phoneUS",
                helpText: "Mobile number for appointment confirmations and updates",
                errorMessages: {
                    required: "Phone number is required for appointment coordination",
                    invalid: "Please provide a valid US phone number"
                }
            },
            {
                prompt: "What's the best name for the on-site contact?",
                name: "contact.name",
                type: "string",
                required: true,
                minLength: 2,
                maxLength: 100,
                priority: 4,
                sanitize: true,
                validate: "nameFormat",
                helpText: "Full name of person who will be present during service",
                errorMessages: {
                    required: "Contact name is required for service coordination",
                    minLength: "Please provide a complete name"
                }
            },
            {
                prompt: "Do you prefer morning or afternoon?",
                name: "slot.preference",
                type: "enum",
                options: ["morning", "afternoon", "no_preference"],
                required: true,
                priority: 5,
                helpText: "Time preference for scheduling your appointment",
                default: "no_preference"
            },
            {
                prompt: "Any technician preference? Dustin, Marcello, or first available?",
                name: "tech.preference",
                type: "enum",
                options: ["dustin", "marcello", "first_available"],
                required: false,
                priority: 6,
                default: "first_available",
                helpText: "Preferred technician or first available"
            },
            {
                prompt: "Will you provide filters, or would you like us to supply them for an additional charge?",
                name: "filters.preference",
                type: "enum",
                options: ["customer_provides", "company_supplies_quote"],
                required: true,
                priority: 7,
                helpText: "Filter supply arrangement",
                conditionalLogic: {
                    showFollowUp: "company_supplies_quote"
                }
            },
            {
                prompt: "If you'd like us to supply, do you know the filter size and quantity?",
                name: "filters.details",
                type: "string",
                requiredIf: {"filters.preference": "company_supplies_quote"},
                maxLength: 500,
                priority: 8,
                helpText: "Filter specifications (size, type, quantity)",
                examples: ["20x25x1, pleated, quantity 2", "Not sure, please assess on-site"]
            },
            {
                prompt: "Is this a repair issue or a maintenance tune-up?",
                name: "service.type",
                type: "enum",
                options: ["repair", "maintenance", "emergency", "installation"],
                required: true,
                priority: 9,
                helpText: "Type of service needed",
                conditionalLogic: {
                    emergencyHandling: "emergency"
                }
            },
            {
                prompt: "Briefly, what's going on with the system?",
                name: "service.note",
                type: "string",
                required: false,
                maxLength: 1000,
                priority: 10,
                sanitize: true,
                helpText: "Description of the issue or maintenance needed",
                examples: ["AC not cooling properly", "Annual maintenance checkup", "Strange noise from unit"]
            },
            {
                prompt: "Email for the confirmation (optional).",
                name: "contact.email",
                type: "email",
                required: false,
                priority: 11,
                validate: "emailFormat",
                helpText: "Email address for appointment confirmations",
                errorMessages: {
                    invalid: "Please provide a valid email address"
                }
            },
            {
                prompt: "Do we have permission to text updates to this number?",
                name: "consent.sms",
                type: "boolean",
                required: true,
                priority: 12,
                helpText: "Consent for SMS notifications about your appointment",
                legalText: "Standard messaging rates may apply. You can opt out anytime.",
                default: true
            }
        ],
        
        // Enterprise validation rules
        validation: {
            strictMode: true,
            sanitizeInputs: true,
            requireAllMandatory: true,
            customValidators: {
                phoneUS: /^\+?1?[2-9]\d{2}[2-9]\d{2}\d{4}$/,
                nameFormat: /^[a-zA-Z\s\-\.]{2,}$/,
                emailFormat: /^[^\s@]+@[^\s@]+\.[^\s@]+$/
            }
        },
        
        // Enterprise workflow configuration
        workflow: {
            // Idempotency and reliability
            idempotencyEnabled: true,
            idempotencyTTLHours: 24,
            autoResumeOnDisconnect: true,
            maxRetryAttempts: 3,
            
            // Field collection order and logic
            collectInOrder: true,
            skipOptionalOnTimeout: true,
            allowFieldSkipping: false,
            confirmationRequired: true,
            
            // Conditional logic handling
            conditionalFieldsEnabled: true,
            dynamicValidation: true,
            realTimeFieldValidation: true,
            
            // Error handling and recovery
            errorHandling: {
                invalidInput: "ask_clarification",
                incompleteResponse: "provide_examples",
                technicalError: "graceful_fallback",
                maxErrorsBeforeEscalation: 3
            }
        },
        
        // Enterprise compliance and audit
        compliance: {
            dataRetentionDays: 2555, // 7 years for business records
            encryptSensitiveData: true,
            auditTrailEnabled: true,
            consentTracking: true,
            gdprCompliant: true,
            
            // PII handling
            piiFields: ["contact.name", "contact.phone", "contact.email", "address.full"],
            anonymizeAfterDays: 90,
            purgeAfterDays: 2555
        },
        
        // Enterprise integration settings
        integration: {
            crmSyncEnabled: true,
            calendarIntegration: true,
            webhookUrl: null,
            webhookRetryPolicy: {
                maxRetries: 5,
                backoffStrategy: "exponential",
                timeoutMs: 10000
            },
            
            // External system mappings
            fieldMappings: {
                "address.full": "service_address",
                "contact.name": "customer_name",
                "contact.phone": "primary_phone",
                "contact.email": "email_address",
                "service.type": "service_category",
                "service.note": "service_description"
            }
        },
        
        // Enterprise SLA and performance
        sla: {
            maxCollectionTimeMinutes: 15,
            responseTimeoutSeconds: 30,
            offerSlotWithinSeconds: 12,
            confirmBookingWithinMinutes: 5,
            handoffMaxSeconds: 15,
            
            // Performance tracking
            trackMetrics: true,
            alertOnSLABreach: true,
            escalateOnRepeatedFailures: true
        },
        
        // Metadata and versioning
        metadata: {
            createdBy: "system",
            industry: "hvac_services",
            serviceTypes: ["repair", "maintenance", "emergency", "installation"],
            businessHours: {
                monday: "8:00-17:00",
                tuesday: "8:00-17:00", 
                wednesday: "8:00-17:00",
                thursday: "8:00-17:00",
                friday: "8:00-17:00",
                saturday: "9:00-15:00",
                sunday: "closed"
            },
            emergencyHours: "24/7",
            serviceRadius: "50 miles",
            version: "1.0.0",
            lastUpdated: new Date().toISOString()
        }
    },
    
    // Enterprise AI Intelligence defaults with composite confidence
    enterpriseAIDefaults: {
        confidencePolicy: {
            companyKB: {
                min: 0.80,
                weight: 0.50,
                description: "Company-specific knowledge base"
            },
            tradeKB: {
                min: 0.75,
                weight: 0.30,
                description: "Industry trade knowledge"
            },
            vector: {
                min: 0.70,
                weight: 0.20,
                description: "Vector similarity search"
            },
            recencyHalfLifeDays: 90,
            llmFallback: {
                enabled: true,
                allowlistIntents: ["general_question", "small_talk", "greeting"],
                timeoutMs: 1800,
                maxTokens: 150
            }
        },
        
        providerRouter: {
            stt: ["deepgram", "google"],
            tts: ["elevenlabs", "google"],
            llm: ["gemini", "openai"],
            fallbackChain: true,
            healthCheckIntervalMs: 30000
        },
        
        circuitBreakers: {
            failFast: true,
            errorRateThreshold: 0.08,
            latencyP95Ms: 2200,
            recoveryTimeMs: 60000
        },
        
        costControls: {
            dailyUsd: 50,
            monthlyUsd: 1500,
            onBreach: "downgrade_llm_and_alert",
            costPerCall: {
                target: 0.25,
                max: 2.0
            }
        },
        
        memoryManagement: {
            sessionTTLMinutes: 45,
            callerProfile: {
                enabled: false,
                ttlDays: 365,
                keyBy: "phone_company",
                requireConsent: true
            }
        },
        
        securityAndCompliance: {
            promptFirewall: {
                enabled: true,
                blockJailbreaks: true,
                sanitizePII: true,
                contentFiltering: "moderate"
            },
            dataResidency: "US",
            encryptionInTransit: true,
            encryptionAtRest: true,
            auditLogging: true
        }
    },
    
    // Enterprise booking SLA configuration
    bookingSLA: {
        companyID: "{{companyId}}",
        sla: {
            offerSlotMs: 12000,
            confirmBookingMs: 300000,
            handoffMs: 15000,
            maxCollectionTimeMs: 900000 // 15 minutes
        },
        
        capacity: {
            checkTechCalendars: true,
            includeTravelTime: true,
            maxDailyBookings: 8,
            bufferBetweenJobsMinutes: 30,
            noBookingAfter: "20:00",
            emergencyOverride: true
        },
        
        automation: {
            autoConfirm: false,
            requireManagerApproval: false,
            sendConfirmationSMS: true,
            sendConfirmationEmail: true,
            createCRMEntry: true
        }
    },
    
    // Provider router defaults for enterprise
    providerDefaults: {
        companyID: "{{companyId}}",
        providers: {
            stt: ["deepgram", "google"],
            tts: ["elevenlabs", "google"], 
            llm: ["gemini", "openai"]
        },
        circuitBreakers: {
            failFast: true,
            errorRateThreshold: 0.08,
            latencyP95Ms: 2200
        },
        routing: {
            primary: "gemini",
            fallback: "openai",
            emergency: "openai",
            loadBalancing: false,
            preferLocal: false
        }
    },
    
    // Cost caps defaults for enterprise
    costCapDefaults: {
        companyID: "{{companyId}}",
        budgets: {
            dailyUsd: 50,
            monthlyUsd: 1500,
            onBreach: "downgrade_llm_and_alert"
        },
        tracking: {
            granular: true,
            alertThresholds: {
                daily: 0.8,
                monthly: 0.9
            },
            costPerCall: {
                target: 0.25,
                max: 2.0
            }
        }
    },
    
    // Knowledge lifecycle defaults
    knowledgeLifecycleDefaults: {
        governancePolicy: {
            requireApproval: true,
            autoApprove: false,
            twoPersonReview: false,
            reviewSLAHours: 48,
            approvalSLAHours: 72
        },
        
        qualityStandards: {
            minQuestionLength: 10,
            minAnswerLength: 20,
            requireSourceOfTruth: true,
            requireCategory: true,
            requireOwner: true,
            requireReviewSchedule: true
        },
        
        lifecycleManagement: {
            defaultValidityDays: 365,
            defaultReviewDays: 90,
            expiredItemHandling: "archive",
            automaticRenewal: false,
            notificationSchedule: [30, 7, 1] // days before expiry
        }
    }
};

module.exports = enterpriseBookingFlowDefaults;
