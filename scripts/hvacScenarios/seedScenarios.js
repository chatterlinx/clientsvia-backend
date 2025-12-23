/**
 * ============================================================================
 * HVAC SCENARIOS SEED SCRIPT
 * ============================================================================
 * Populates the existing HVAC Trade Knowledge Template with world-class
 * scenarios for all 30 empty categories.
 * 
 * Usage:
 *   node scripts/hvacScenarios/seedScenarios.js
 * 
 * Requirements:
 *   - API_URL environment variable (or defaults to local)
 *   - AUTH_TOKEN environment variable for authentication
 */

const path = require('path');

// Load all scenario modules
const emergencyAndFailure = require('./emergencyAndFailure');
const maintenanceAndService = require('./maintenanceAndService');
const systemIssues = require('./systemIssues');
const salesAndEstimates = require('./salesAndEstimates');
const customerService = require('./customerService');
const callHandling = require('./callHandling');

// Configuration
const TEMPLATE_ID = '68fb535130d19aec696d8123';
const API_BASE_URL = process.env.API_URL || 'https://cv-backend-va.onrender.com';
const AUTH_TOKEN = process.env.AUTH_TOKEN;

// Combine all category definitions
const ALL_CATEGORIES = {
    ...emergencyAndFailure.CATEGORIES,
    ...maintenanceAndService.CATEGORIES,
    ...systemIssues.CATEGORIES,
    ...salesAndEstimates.CATEGORIES,
    ...customerService.CATEGORIES,
    ...callHandling.CATEGORIES
};

/**
 * Build a complete scenario object with all required fields
 */
function buildScenarioPayload(scenario, categoryId) {
    const scenarioId = `scenario-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    return {
        scenarioId,
        version: 1,
        status: 'live',
        name: scenario.name,
        isActive: true,
        categories: [categoryId],
        priority: scenario.priority || 5,
        cooldownSeconds: scenario.cooldownSeconds || 0,
        language: 'auto',
        channel: 'any',
        
        // Triggers
        triggers: scenario.triggers || [],
        regexTriggers: scenario.regexTriggers || [],
        negativeTriggers: scenario.negativeTriggers || [],
        contextWeight: scenario.contextWeight || 0.7,
        
        // Preconditions & Effects
        preconditions: scenario.preconditions || {},
        effects: scenario.effects || {},
        
        // Example phrases
        exampleUserPhrases: scenario.exampleUserPhrases || [],
        negativeUserPhrases: scenario.negativeUserPhrases || [],
        
        // Replies
        quickReplies: scenario.quickReplies || [],
        fullReplies: scenario.fullReplies || [],
        followUpPrompts: scenario.followUpPrompts || [],
        followUpFunnel: scenario.followUpFunnel || '',
        
        // Reply configuration
        replySelection: scenario.replySelection || 'random',
        scenarioType: scenario.scenarioType || null,
        replyStrategy: scenario.replyStrategy || 'AUTO',
        followUpMode: scenario.followUpMode || 'NONE',
        followUpQuestionText: scenario.followUpQuestionText || null,
        
        // Transfer & Handoff
        transferTarget: scenario.transferTarget || null,
        minConfidence: scenario.minConfidence || null,
        handoffPolicy: scenario.handoffPolicy || 'low_confidence',
        
        // Notes & Keywords
        notes: scenario.notes || '',
        keywords: scenario.keywords || [],
        negativeKeywords: scenario.negativeKeywords || [],
        
        // Entity capture
        entityCapture: scenario.entityCapture || [],
        entityValidation: scenario.entityValidation || {
            phone: { pattern: '^[0-9]{10}$', prompt: 'Please provide a 10-digit phone number' },
            date: { pattern: '^\\d{4}-\\d{2}-\\d{2}$', prompt: 'Please provide a date (YYYY-MM-DD)' },
            time: { pattern: '^\\d{1,2}:\\d{2}', prompt: 'Please provide a time (e.g., 2:00 PM or 14:00)' }
        },
        
        // Dynamic variables
        dynamicVariables: scenario.dynamicVariables || {
            '{companyname}': "Your service provider's name",
            '{phone}': 'Your main phone number',
            '{address}': 'Your main address',
            '{website_url}': 'Your website URL',
            '{office_hours}': 'Your office hours'
        },
        
        // Action hooks
        actionHooks: scenario.actionHooks || [],
        
        // Sensitive info handling
        sensitiveInfoRule: 'platform_default',
        customMasking: {},
        
        // Timed follow-up
        timedFollowUp: scenario.timedFollowUp || {
            enabled: true,
            delaySeconds: 50,
            messages: [
                'Are you still there?',
                'Just checking in...',
                "Hello? I'm still here if you need me.",
                "Take your time—I'm here when you're ready.",
                'Still on the line? Let me know if you need anything.'
            ],
            extensionSeconds: 30
        },
        
        // Silence policy
        silencePolicy: scenario.silencePolicy || {
            maxConsecutive: 2,
            finalWarning: 'Hello? Did I lose you?'
        },
        
        // Additional fields
        qnaPairs: scenario.qnaPairs || [],
        testPhrases: scenario.testPhrases || [],
        examples: scenario.examples || [],
        escalationFlags: scenario.escalationFlags || [],
        behavior: scenario.behavior || null,
        toneLevel: scenario.toneLevel || 2,
        ttsOverride: scenario.ttsOverride || {},
        
        // Metadata
        createdBy: 'seed-script',
        updatedBy: 'seed-script',
        legacyMigrated: false
    };
}

/**
 * Create a scenario via API
 */
async function createScenario(categoryId, scenario) {
    const payload = buildScenarioPayload(scenario, categoryId);
    const url = `${API_BASE_URL}/api/admin/global-instant-responses/${TEMPLATE_ID}/categories/${categoryId}/scenarios`;
    
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${AUTH_TOKEN}`
        },
        body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Failed to create scenario "${scenario.name}": ${response.status} - ${error}`);
    }
    
    return await response.json();
}

/**
 * Main seeding function
 */
async function seedAllScenarios() {
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('  HVAC SCENARIOS SEED SCRIPT');
    console.log('  Template ID:', TEMPLATE_ID);
    console.log('  API Base:', API_BASE_URL);
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    if (!AUTH_TOKEN) {
        console.error('❌ ERROR: AUTH_TOKEN environment variable is required');
        console.log('\nUsage:');
        console.log('  AUTH_TOKEN="your-jwt-token" node scripts/hvacScenarios/seedScenarios.js');
        process.exit(1);
    }
    
    const stats = {
        categoriesProcessed: 0,
        scenariosCreated: 0,
        scenariosFailed: 0,
        errors: []
    };
    
    const categoryKeys = Object.keys(ALL_CATEGORIES);
    console.log(`📁 Found ${categoryKeys.length} categories to process\n`);
    
    for (const categoryKey of categoryKeys) {
        const category = ALL_CATEGORIES[categoryKey];
        console.log(`\n📂 Category: ${category.name}`);
        console.log(`   ID: ${category.id}`);
        console.log(`   Scenarios to create: ${category.scenarios.length}`);
        
        for (const scenario of category.scenarios) {
            try {
                console.log(`   └─ Creating: ${scenario.name}...`);
                await createScenario(category.id, scenario);
                console.log(`      ✅ Created successfully (${scenario.triggers.length} triggers)`);
                stats.scenariosCreated++;
                
                // Small delay to avoid overwhelming the API
                await new Promise(resolve => setTimeout(resolve, 200));
                
            } catch (error) {
                console.log(`      ❌ Failed: ${error.message}`);
                stats.scenariosFailed++;
                stats.errors.push({
                    category: category.name,
                    scenario: scenario.name,
                    error: error.message
                });
            }
        }
        
        stats.categoriesProcessed++;
    }
    
    // Summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  SEED COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  Categories Processed: ${stats.categoriesProcessed}`);
    console.log(`  Scenarios Created:    ${stats.scenariosCreated}`);
    console.log(`  Scenarios Failed:     ${stats.scenariosFailed}`);
    
    if (stats.errors.length > 0) {
        console.log('\n  ❌ ERRORS:');
        stats.errors.forEach(err => {
            console.log(`     - ${err.category} / ${err.scenario}: ${err.error}`);
        });
    }
    
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    return stats;
}

// Run if called directly
if (require.main === module) {
    seedAllScenarios()
        .then(stats => {
            process.exit(stats.scenariosFailed > 0 ? 1 : 0);
        })
        .catch(error => {
            console.error('Fatal error:', error);
            process.exit(1);
        });
}

module.exports = { seedAllScenarios, ALL_CATEGORIES, buildScenarioPayload };

