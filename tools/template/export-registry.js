#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EXPORT REGISTRY GENERATOR - NO GUESSING SCENARIO IDS
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * This tool reads an exported template JSON and generates an ID registry.
 * Use this registry to build patch payloads with REAL IDs - no guessing!
 * 
 * Usage:
 *   node tools/template/export-registry.js ./path/to/export.json
 *   node tools/template/export-registry.js ./path/to/export.json --output registry.json
 *   node tools/template/export-registry.js ./path/to/export.json --search "warm air"
 * 
 * Output:
 *   - JSON with all templateId, categoryId, scenarioId mappings
 *   - Summary counts
 *   - Search results if --search provided
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');

// ═══════════════════════════════════════════════════════════════════════════════
// PARSE ARGUMENTS
// ═══════════════════════════════════════════════════════════════════════════════

const args = process.argv.slice(2);

if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
    console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  EXPORT REGISTRY GENERATOR                                                     ║
║  Generate ID registry from template export - NO GUESSING IDs!                  ║
╚═══════════════════════════════════════════════════════════════════════════════╝

Usage:
  node tools/template/export-registry.js <export.json> [options]

Options:
  --output <file>     Write registry to file instead of stdout
  --search <term>     Search for scenarios by name/trigger
  --compact           Compact JSON output (no pretty print)
  --ids-only          Output only scenarioId list (for scripting)
  --help, -h          Show this help

Examples:
  # Generate full registry
  node tools/template/export-registry.js ./company-export.json

  # Search for specific scenarios
  node tools/template/export-registry.js ./company-export.json --search "warm air"

  # Output to file
  node tools/template/export-registry.js ./company-export.json --output registry.json

  # Get just IDs (for scripting)
  node tools/template/export-registry.js ./company-export.json --ids-only
`);
    process.exit(0);
}

const inputFile = args[0];
const outputIdx = args.indexOf('--output');
const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : null;
const searchIdx = args.indexOf('--search');
const searchTerm = searchIdx !== -1 ? args[searchIdx + 1]?.toLowerCase() : null;
const compact = args.includes('--compact');
const idsOnly = args.includes('--ids-only');

// ═══════════════════════════════════════════════════════════════════════════════
// READ AND PARSE EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

if (!fs.existsSync(inputFile)) {
    console.error(`❌ File not found: ${inputFile}`);
    process.exit(1);
}

let exportData;
try {
    const content = fs.readFileSync(inputFile, 'utf-8');
    exportData = JSON.parse(content);
} catch (error) {
    console.error(`❌ Failed to parse JSON: ${error.message}`);
    process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXTRACT TEMPLATE DATA
// ═══════════════════════════════════════════════════════════════════════════════

// Handle different export formats
let templates = [];

if (exportData.templates && Array.isArray(exportData.templates)) {
    // Full company export format
    templates = exportData.templates;
} else if (exportData.categories && Array.isArray(exportData.categories)) {
    // Single template format
    templates = [exportData];
} else if (exportData.dataConfig?.templates) {
    // Platform snapshot format
    templates = exportData.dataConfig.templates;
} else {
    console.error('❌ Unrecognized export format. Expected templates array or categories array.');
    process.exit(1);
}

// ═══════════════════════════════════════════════════════════════════════════════
// BUILD REGISTRY
// ═══════════════════════════════════════════════════════════════════════════════

const registry = {
    generatedAt: new Date().toISOString(),
    sourceFile: path.basename(inputFile),
    templates: []
};

let totalCategories = 0;
let totalScenarios = 0;
let totalTriggers = 0;
const allScenarioIds = [];

for (const template of templates) {
    const templateEntry = {
        templateId: template.templateId || template._id?.toString() || 'unknown',
        templateName: template.templateName || template.name || 'Unknown Template',
        templateType: template.templateType || 'universal',
        categories: []
    };

    for (const category of template.categories || []) {
        totalCategories++;
        
        const categoryEntry = {
            categoryId: category.categoryId || category.id,
            categoryName: category.categoryName || category.name,
            scenarioCount: (category.scenarios || []).length,
            scenarios: []
        };

        for (const scenario of category.scenarios || []) {
            totalScenarios++;
            const triggerCount = (scenario.triggers || []).length;
            totalTriggers += triggerCount;

            const scenarioEntry = {
                scenarioId: scenario.scenarioId,
                scenarioName: scenario.name || scenario.scenarioName,
                triggerCount,
                status: scenario.status || 'live',
                scenarioType: scenario.scenarioType || 'UNKNOWN',
                scope: scenario.scope || 'GLOBAL',
                ownerCompanyId: scenario.ownerCompanyId || null
            };

            // Include triggers for search
            if (searchTerm) {
                scenarioEntry.triggers = scenario.triggers || [];
            }

            categoryEntry.scenarios.push(scenarioEntry);
            allScenarioIds.push(scenario.scenarioId);
        }

        templateEntry.categories.push(categoryEntry);
    }

    registry.templates.push(templateEntry);
}

registry.summary = {
    templateCount: registry.templates.length,
    categoryCount: totalCategories,
    scenarioCount: totalScenarios,
    triggerCount: totalTriggers
};

// ═══════════════════════════════════════════════════════════════════════════════
// SEARCH (if requested)
// ═══════════════════════════════════════════════════════════════════════════════

if (searchTerm) {
    console.log(`\n🔍 Searching for: "${searchTerm}"\n`);
    
    const matches = [];
    
    for (const template of registry.templates) {
        for (const category of template.categories) {
            for (const scenario of category.scenarios) {
                const nameMatch = scenario.scenarioName?.toLowerCase().includes(searchTerm);
                const triggerMatch = scenario.triggers?.some(t => 
                    t.toLowerCase().includes(searchTerm)
                );
                
                if (nameMatch || triggerMatch) {
                    matches.push({
                        templateId: template.templateId,
                        templateName: template.templateName,
                        categoryId: category.categoryId,
                        categoryName: category.categoryName,
                        scenarioId: scenario.scenarioId,
                        scenarioName: scenario.scenarioName,
                        matchedIn: nameMatch ? 'name' : 'triggers'
                    });
                }
            }
        }
    }

    if (matches.length === 0) {
        console.log('No matches found.\n');
    } else {
        console.log(`Found ${matches.length} matches:\n`);
        matches.forEach((m, i) => {
            console.log(`${i + 1}. ${m.scenarioName}`);
            console.log(`   scenarioId: ${m.scenarioId}`);
            console.log(`   categoryId: ${m.categoryId} (${m.categoryName})`);
            console.log(`   templateId: ${m.templateId}`);
            console.log('');
        });
    }
    
    process.exit(0);
}

// ═══════════════════════════════════════════════════════════════════════════════
// OUTPUT
// ═══════════════════════════════════════════════════════════════════════════════

if (idsOnly) {
    // Just output scenario IDs
    console.log(allScenarioIds.join('\n'));
    process.exit(0);
}

const output = compact 
    ? JSON.stringify(registry) 
    : JSON.stringify(registry, null, 2);

if (outputFile) {
    fs.writeFileSync(outputFile, output);
    console.log(`✅ Registry written to: ${outputFile}`);
    console.log(`   Templates: ${registry.summary.templateCount}`);
    console.log(`   Categories: ${registry.summary.categoryCount}`);
    console.log(`   Scenarios: ${registry.summary.scenarioCount}`);
    console.log(`   Triggers: ${registry.summary.triggerCount}`);
} else {
    console.log(output);
}

// ═══════════════════════════════════════════════════════════════════════════════
// VALIDATION WARNINGS
// ═══════════════════════════════════════════════════════════════════════════════

// Check for potential issues
const warnings = [];

for (const template of registry.templates) {
    for (const category of template.categories) {
        for (const scenario of category.scenarios) {
            if (scenario.scope !== 'GLOBAL') {
                warnings.push(`⚠️ Non-GLOBAL scope: ${scenario.scenarioId} (${scenario.scope})`);
            }
            if (scenario.ownerCompanyId) {
                warnings.push(`⚠️ Has ownerCompanyId: ${scenario.scenarioId}`);
            }
            if (scenario.scenarioType === 'UNKNOWN') {
                warnings.push(`⚠️ UNKNOWN scenarioType: ${scenario.scenarioId} (${scenario.scenarioName})`);
            }
        }
    }
}

if (warnings.length > 0 && !outputFile) {
    console.error('\n' + '═'.repeat(60));
    console.error('⚠️  WARNINGS:');
    warnings.slice(0, 10).forEach(w => console.error(w));
    if (warnings.length > 10) {
        console.error(`... and ${warnings.length - 10} more warnings`);
    }
}

