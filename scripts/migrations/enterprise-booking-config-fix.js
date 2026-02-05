/**
 * ============================================================================
 * ENTERPRISE BOOKING CONFIG FIX
 * ============================================================================
 * 
 * This migration addresses critical configuration issues identified in the
 * wiring audit:
 * 
 * 1. PATH NORMALIZATION: Unify all booking paths under frontDeskBehavior
 *    - Migrate: frontDesk.booking.* → frontDeskBehavior.booking.*
 *    - Preserve: frontDeskBehavior.bookingSlots (already correct)
 * 
 * 2. APPLY CRITICAL CONFIGS: Set missing MVA-tier requirements
 *    - addressValidation.rejectQuestions = true
 *    - routing.emptyUtteranceGuard.enabled = true
 *    - discoveryConsent.clarifyingQuestions.enabled = true
 *    - discoveryConsent.clarifyingQuestions.vaguePatterns = [...]
 *    - discoveryConsent.techNameExcludeWords = [...]
 *    - discoveryConsent.issueCaptureMinConfidence = 0.5
 * 
 * 3. SLOT SCHEMA CLEANUP: Remove irrelevant properties per slot type
 *    - name slot: only name-related properties
 *    - phone slot: only phone-related properties
 *    - address slot: only address-related properties
 * 
 * Run: node scripts/migrations/enterprise-booking-config-fix.js --dry-run
 * Apply: node scripts/migrations/enterprise-booking-config-fix.js --apply
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const COMPANY_ID = '68e3f77a9d623b8058c700c4';
const MIGRATION_VERSION = 'V1.0.0';
const MIGRATION_ID = `enterprise-booking-fix-${Date.now()}`;

// ============================================================================
// SLOT TYPE SCHEMAS - Define valid properties per slot type
// ============================================================================

const COMMON_SLOT_PROPERTIES = [
    'id', 'label', 'question', 'required', 'order', 'type', 'validation',
    'confirmBack', 'confirmPrompt', 'skipIfKnown', 'helperNote', 'midCallRules',
    '_id', 'enabled', 'priority', 'invalidPrompt', 'retryPrompt'
];

const SLOT_TYPE_SCHEMAS = {
    name: [
        ...COMMON_SLOT_PROPERTIES,
        'askFullName', 'useFirstNameOnly', 'askMissingNamePart',
        'lastNameQuestion', 'firstNameQuestion', 'duplicateNamePartPrompt',
        'confirmSpelling', 'spellingVariantPrompt'
    ],
    phone: [
        ...COMMON_SLOT_PROPERTIES,
        'offerCallerId', 'callerIdPrompt', 'acceptTextMe',
        'breakDownIfUnclear', 'areaCodePrompt', 'restOfNumberPrompt'
    ],
    address: [
        ...COMMON_SLOT_PROPERTIES,
        'addressConfirmLevel', 'acceptPartialAddress', 'partialAddressPrompt',
        'cityPrompt', 'zipPrompt', 'streetBreakdownPrompt',
        'useGoogleMapsValidation', 'googleMapsValidationMode',
        'unitNumberMode', 'unitNumberPrompt', 'unitTriggerWords',
        'unitAlwaysAskZips', 'unitNeverAskZips', 'unitPromptVariants'
    ],
    time: [
        ...COMMON_SLOT_PROPERTIES,
        'offerAsap', 'offerMorningAfternoon', 'asapPhrase'
    ],
    email: [
        ...COMMON_SLOT_PROPERTIES,
        'spellOutEmail', 'offerToSendText'
    ],
    select: [
        ...COMMON_SLOT_PROPERTIES,
        'selectOptions', 'allowOther'
    ],
    yesno: [
        ...COMMON_SLOT_PROPERTIES,
        'yesAction', 'noAction'
    ],
    number: [
        ...COMMON_SLOT_PROPERTIES,
        'minValue', 'maxValue', 'unit'
    ],
    text: [
        ...COMMON_SLOT_PROPERTIES
    ],
    custom: [
        ...COMMON_SLOT_PROPERTIES
    ]
};

// ============================================================================
// CRITICAL CONFIG VALUES (MVA Tier Requirements)
// ============================================================================

const CRITICAL_CONFIGS = {
    // Address validation - reject questions as address input
    'bookingSlots.addressValidation': {
        rejectQuestions: true,
        rejectPatterns: [
            '\\?$',           // Ends with question mark
            '^(what|where|when|why|how|who|is|are|do|does|can|could|would|should)\\s',
            'not sure',
            'i don\'t know',
            'what did you say',
            'repeat that'
        ]
    },
    
    // Empty utterance guard - prevent filler-only LLM calls
    'routing.emptyUtteranceGuard': {
        enabled: true,
        minTokens: 2,
        skipPatterns: [
            '^[\\s.,!?;:\'"\\-–—]+$',  // Punctuation only
            '^(uh|um|hmm|ah|oh|eh)+[\\s.,!?]*$',  // Filler sounds
            '^\\s*$'  // Empty/whitespace
        ]
    },
    
    // Clarifying questions - ask before jumping to booking
    'discoveryConsent.clarifyingQuestions': {
        enabled: true,
        vaguePatterns: [
            'not working',
            'problems',
            'issues',
            'something wrong',
            'acting up',
            'broken',
            'wont turn on',
            'won\'t turn on',
            'keeps shutting off',
            'making noise',
            'weird sound',
            'not right',
            'having trouble'
        ],
        clarifyPrompt: 'I want to make sure I understand — can you tell me a bit more about what\'s happening?',
        maxClarifyAttempts: 2
    },
    
    // Tech name exclusion - prevent false positive name extraction
    'discoveryConsent.techNameExcludeWords': [
        'system', 'unit', 'equipment', 'machine', 'device',
        'thermostat', 'furnace', 'ac', 'air conditioner', 'heater',
        'compressor', 'condenser', 'handler', 'duct', 'vent',
        'filter', 'coil', 'refrigerant', 'freon'
    ],
    
    // Issue capture confidence - minimum threshold for scenario-based capture
    'discoveryConsent.issueCaptureMinConfidence': 0.5
};

// ============================================================================
// MIGRATION FUNCTIONS
// ============================================================================

/**
 * Clean a slot object to only include properties valid for its type
 */
function cleanSlotSchema(slot) {
    const slotType = slot.type || 'custom';
    const validProperties = SLOT_TYPE_SCHEMAS[slotType] || SLOT_TYPE_SCHEMAS.custom;
    
    const cleanedSlot = {};
    for (const prop of validProperties) {
        if (slot[prop] !== undefined) {
            cleanedSlot[prop] = slot[prop];
        }
    }
    
    // Preserve _id for Mongoose
    if (slot._id) {
        cleanedSlot._id = slot._id;
    }
    
    return cleanedSlot;
}

/**
 * Migrate legacy path to canonical path
 */
function migratePath(doc, legacyPath, canonicalPath) {
    const legacyValue = getNestedValue(doc, legacyPath);
    if (legacyValue !== undefined) {
        setNestedValue(doc, canonicalPath, legacyValue);
        deleteNestedValue(doc, legacyPath);
        return { migrated: true, from: legacyPath, to: canonicalPath, value: legacyValue };
    }
    return { migrated: false, from: legacyPath, to: canonicalPath };
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }
    return current;
}

/**
 * Set nested value in object using dot notation
 */
function setNestedValue(obj, path, value) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (current[parts[i]] === undefined) {
            current[parts[i]] = {};
        }
        current = current[parts[i]];
    }
    current[parts[parts.length - 1]] = value;
}

/**
 * Delete nested value from object using dot notation
 */
function deleteNestedValue(obj, path) {
    const parts = path.split('.');
    let current = obj;
    for (let i = 0; i < parts.length - 1; i++) {
        if (current[parts[i]] === undefined) return;
        current = current[parts[i]];
    }
    delete current[parts[parts.length - 1]];
}

/**
 * Deep clone an object
 */
function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
}

// ============================================================================
// MAIN MIGRATION
// ============================================================================

async function run(dryRun) {
    const startTime = Date.now();
    const log = [];
    
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`🔧 ENTERPRISE BOOKING CONFIG FIX: ${dryRun ? 'DRY RUN' : 'APPLYING CHANGES'}`);
    console.log('═══════════════════════════════════════════════════════════════════════════');
    console.log(`Migration ID: ${MIGRATION_ID}`);
    console.log(`Version: ${MIGRATION_VERSION}`);
    console.log(`Company ID: ${COMPANY_ID}`);
    console.log(`Timestamp: ${new Date().toISOString()}`);
    console.log('');

    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI environment variable not set');
        process.exit(1);
    }

    try {
        await mongoose.connect(mongoUri);
        console.log(`✅ Connected to MongoDB (database: ${mongoose.connection.name})\n`);

        const db = mongoose.connection.db;
        const companiesCollection = db.collection('companiesCollection');
        
        // Load company document
        const company = await companiesCollection.findOne({ 
            _id: new mongoose.Types.ObjectId(COMPANY_ID) 
        });
        
        if (!company) {
            console.error(`❌ Company not found: ${COMPANY_ID}`);
            process.exit(1);
        }
        console.log(`✅ Loaded company: ${company.companyName || company.businessName}\n`);

        // Create backup
        const backup = deepClone(company.aiAgentSettings || {});
        const backupPath = path.join(__dirname, `../../backups/aiAgentSettings-${COMPANY_ID}-${Date.now()}.json`);
        
        if (!dryRun) {
            const backupDir = path.dirname(backupPath);
            if (!fs.existsSync(backupDir)) {
                fs.mkdirSync(backupDir, { recursive: true });
            }
            fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
            console.log(`💾 Backup saved: ${backupPath}\n`);
        }

        // Initialize aiAgentSettings if needed
        if (!company.aiAgentSettings) {
            company.aiAgentSettings = {};
        }
        if (!company.aiAgentSettings.frontDeskBehavior) {
            company.aiAgentSettings.frontDeskBehavior = {};
        }

        const changes = {
            pathMigrations: [],
            criticalConfigs: [],
            slotCleanups: [],
            errors: []
        };

        // ====================================================================
        // PHASE 1: PATH NORMALIZATION
        // ====================================================================
        console.log('📋 PHASE 1: PATH NORMALIZATION');
        console.log('────────────────────────────────────────────────────────────');

        // Migrate frontDesk.booking.* → frontDeskBehavior.booking.*
        const pathMigrations = [
            ['aiAgentSettings.frontDesk.booking', 'aiAgentSettings.frontDeskBehavior.booking'],
            ['aiAgentSettings.frontDesk.addressVerification', 'aiAgentSettings.frontDeskBehavior.addressVerification'],
        ];

        for (const [legacyPath, canonicalPath] of pathMigrations) {
            const result = migratePath(company, legacyPath, canonicalPath);
            changes.pathMigrations.push(result);
            if (result.migrated) {
                console.log(`  ✅ Migrated: ${legacyPath} → ${canonicalPath}`);
                log.push(`PATH_MIGRATED: ${legacyPath} → ${canonicalPath}`);
            } else {
                console.log(`  ⏭️  Skipped (no value): ${legacyPath}`);
            }
        }

        // Clean up empty frontDesk object if it exists
        if (company.aiAgentSettings.frontDesk && 
            Object.keys(company.aiAgentSettings.frontDesk).length === 0) {
            delete company.aiAgentSettings.frontDesk;
            console.log(`  🧹 Removed empty frontDesk object`);
        }

        console.log('');

        // ====================================================================
        // PHASE 2: APPLY CRITICAL CONFIGS
        // ====================================================================
        console.log('📋 PHASE 2: APPLY CRITICAL CONFIGS (MVA Tier)');
        console.log('────────────────────────────────────────────────────────────');

        const fdb = company.aiAgentSettings.frontDeskBehavior;

        // Apply addressValidation
        if (!fdb.bookingSlots) fdb.bookingSlots = {};
        if (!fdb.bookingSlots.addressValidation) {
            fdb.bookingSlots.addressValidation = CRITICAL_CONFIGS['bookingSlots.addressValidation'];
            console.log(`  ✅ Set: bookingSlots.addressValidation.rejectQuestions = true`);
            changes.criticalConfigs.push('bookingSlots.addressValidation');
        } else if (!fdb.bookingSlots.addressValidation.rejectQuestions) {
            fdb.bookingSlots.addressValidation.rejectQuestions = true;
            fdb.bookingSlots.addressValidation.rejectPatterns = 
                CRITICAL_CONFIGS['bookingSlots.addressValidation'].rejectPatterns;
            console.log(`  ✅ Updated: bookingSlots.addressValidation.rejectQuestions = true`);
            changes.criticalConfigs.push('bookingSlots.addressValidation.rejectQuestions');
        } else {
            console.log(`  ⏭️  Skipped (already set): bookingSlots.addressValidation.rejectQuestions`);
        }

        // Apply routing.emptyUtteranceGuard
        if (!fdb.routing) fdb.routing = {};
        if (!fdb.routing.emptyUtteranceGuard) {
            fdb.routing.emptyUtteranceGuard = CRITICAL_CONFIGS['routing.emptyUtteranceGuard'];
            console.log(`  ✅ Set: routing.emptyUtteranceGuard.enabled = true`);
            changes.criticalConfigs.push('routing.emptyUtteranceGuard');
        } else if (!fdb.routing.emptyUtteranceGuard.enabled) {
            fdb.routing.emptyUtteranceGuard.enabled = true;
            console.log(`  ✅ Updated: routing.emptyUtteranceGuard.enabled = true`);
            changes.criticalConfigs.push('routing.emptyUtteranceGuard.enabled');
        } else {
            console.log(`  ⏭️  Skipped (already set): routing.emptyUtteranceGuard.enabled`);
        }

        // Apply discoveryConsent.clarifyingQuestions
        if (!fdb.discoveryConsent) fdb.discoveryConsent = {};
        if (!fdb.discoveryConsent.clarifyingQuestions) {
            fdb.discoveryConsent.clarifyingQuestions = CRITICAL_CONFIGS['discoveryConsent.clarifyingQuestions'];
            console.log(`  ✅ Set: discoveryConsent.clarifyingQuestions.enabled = true`);
            changes.criticalConfigs.push('discoveryConsent.clarifyingQuestions');
        } else if (!fdb.discoveryConsent.clarifyingQuestions.enabled) {
            Object.assign(fdb.discoveryConsent.clarifyingQuestions, 
                CRITICAL_CONFIGS['discoveryConsent.clarifyingQuestions']);
            console.log(`  ✅ Updated: discoveryConsent.clarifyingQuestions.enabled = true`);
            changes.criticalConfigs.push('discoveryConsent.clarifyingQuestions.enabled');
        } else {
            console.log(`  ⏭️  Skipped (already set): discoveryConsent.clarifyingQuestions.enabled`);
        }

        // Apply techNameExcludeWords
        if (!fdb.discoveryConsent.techNameExcludeWords || 
            fdb.discoveryConsent.techNameExcludeWords.length === 0) {
            fdb.discoveryConsent.techNameExcludeWords = CRITICAL_CONFIGS['discoveryConsent.techNameExcludeWords'];
            console.log(`  ✅ Set: discoveryConsent.techNameExcludeWords (${fdb.discoveryConsent.techNameExcludeWords.length} words)`);
            changes.criticalConfigs.push('discoveryConsent.techNameExcludeWords');
        } else {
            console.log(`  ⏭️  Skipped (already set): discoveryConsent.techNameExcludeWords`);
        }

        // Apply issueCaptureMinConfidence
        if (fdb.discoveryConsent.issueCaptureMinConfidence === undefined) {
            fdb.discoveryConsent.issueCaptureMinConfidence = CRITICAL_CONFIGS['discoveryConsent.issueCaptureMinConfidence'];
            console.log(`  ✅ Set: discoveryConsent.issueCaptureMinConfidence = 0.5`);
            changes.criticalConfigs.push('discoveryConsent.issueCaptureMinConfidence');
        } else {
            console.log(`  ⏭️  Skipped (already set): discoveryConsent.issueCaptureMinConfidence`);
        }

        console.log('');

        // ====================================================================
        // PHASE 3: SLOT SCHEMA CLEANUP
        // ====================================================================
        console.log('📋 PHASE 3: SLOT SCHEMA CLEANUP');
        console.log('────────────────────────────────────────────────────────────');

        // Get booking slots array (could be at top level or nested)
        let bookingSlots = fdb.bookingSlots;
        if (Array.isArray(bookingSlots)) {
            // Slots are directly in bookingSlots array
        } else if (bookingSlots && Array.isArray(bookingSlots.slots)) {
            bookingSlots = bookingSlots.slots;
        } else {
            // Check for slots at different location
            bookingSlots = company.aiAgentSettings.frontDeskBehavior?.bookingSlots;
            if (!Array.isArray(bookingSlots)) {
                console.log(`  ⚠️  No booking slots array found - skipping cleanup`);
                bookingSlots = null;
            }
        }

        if (Array.isArray(bookingSlots)) {
            console.log(`  Found ${bookingSlots.length} booking slots`);
            
            const cleanedSlots = [];
            for (const slot of bookingSlots) {
                const slotId = slot.id || 'unknown';
                const slotType = slot.type || 'custom';
                const originalKeys = Object.keys(slot).length;
                const cleanedSlot = cleanSlotSchema(slot);
                const cleanedKeys = Object.keys(cleanedSlot).length;
                const removedCount = originalKeys - cleanedKeys;
                
                cleanedSlots.push(cleanedSlot);
                
                if (removedCount > 0) {
                    console.log(`  ✂️  ${slotId} (${slotType}): removed ${removedCount} irrelevant properties`);
                    changes.slotCleanups.push({ id: slotId, type: slotType, removed: removedCount });
                } else {
                    console.log(`  ✓  ${slotId} (${slotType}): already clean`);
                }
            }

            // Update the slots in the document
            if (Array.isArray(fdb.bookingSlots)) {
                fdb.bookingSlots = cleanedSlots;
            } else if (fdb.bookingSlots && fdb.bookingSlots.slots) {
                fdb.bookingSlots.slots = cleanedSlots;
            }
        }

        console.log('');

        // ====================================================================
        // APPLY CHANGES
        // ====================================================================
        if (!dryRun) {
            console.log('💾 APPLYING CHANGES...');
            console.log('────────────────────────────────────────────────────────────');

            const updateResult = await companiesCollection.updateOne(
                { _id: new mongoose.Types.ObjectId(COMPANY_ID) },
                { 
                    $set: { 
                        'aiAgentSettings': company.aiAgentSettings,
                        'aiAgentSettings._migrationHistory': [
                            ...(company.aiAgentSettings._migrationHistory || []),
                            {
                                migrationId: MIGRATION_ID,
                                version: MIGRATION_VERSION,
                                timestamp: new Date().toISOString(),
                                changes: changes
                            }
                        ]
                    }
                }
            );

            console.log(`  Matched: ${updateResult.matchedCount}`);
            console.log(`  Modified: ${updateResult.modifiedCount}`);

            if (updateResult.modifiedCount > 0) {
                console.log('  ✅ Changes saved to database\n');
            } else {
                console.log('  ⚠️  No changes were made\n');
            }

            // Clear Redis cache
            try {
                const Redis = require('ioredis');
                const redis = new Redis(process.env.REDIS_URL);
                await redis.del(`company:${COMPANY_ID}`);
                await redis.del(`company-config:${COMPANY_ID}`);
                await redis.del(`scenario-pool:${COMPANY_ID}`);
                await redis.quit();
                console.log('  ✅ Redis cache cleared\n');
            } catch (e) {
                console.log(`  ⚠️  Could not clear Redis cache: ${e.message}\n`);
            }

        } else {
            console.log('🔍 DRY RUN - No changes written');
            console.log('');
            console.log('To apply these changes, run:');
            console.log('  MONGODB_URI="..." node scripts/migrations/enterprise-booking-config-fix.js --apply');
        }

        // ====================================================================
        // SUMMARY
        // ====================================================================
        const elapsed = Date.now() - startTime;
        
        console.log('');
        console.log('═══════════════════════════════════════════════════════════════════════════');
        console.log('📊 MIGRATION SUMMARY');
        console.log('═══════════════════════════════════════════════════════════════════════════');
        console.log(`Path Migrations:     ${changes.pathMigrations.filter(m => m.migrated).length} completed`);
        console.log(`Critical Configs:    ${changes.criticalConfigs.length} applied`);
        console.log(`Slot Cleanups:       ${changes.slotCleanups.length} slots cleaned`);
        console.log(`Errors:              ${changes.errors.length}`);
        console.log(`Elapsed Time:        ${elapsed}ms`);
        console.log('');
        
        if (!dryRun) {
            console.log('🧪 VERIFICATION STEPS:');
            console.log('────────────────────────────────────────────────────────────');
            console.log('1. Re-run the Wiring Report to verify:');
            console.log('   - MVA tier score should increase');
            console.log('   - Critical missing items should be resolved');
            console.log('');
            console.log('2. Test a fresh call with: "How soon can you get somebody out?"');
            console.log('');
            console.log('3. Verify in raw-events:');
            console.log('   - addressValidation.rejectQuestions = true');
            console.log('   - emptyUtteranceGuard.enabled = true');
            console.log('   - clarifyingQuestions.enabled = true');
            console.log('');
        }

        return changes;

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        console.error(error.stack);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB');
    }
}

// Parse arguments
const args = process.argv.slice(2);
const dryRun = !args.includes('--apply');

run(dryRun);
