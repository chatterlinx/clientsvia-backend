#!/usr/bin/env node

/**
 * AI Agent Logic Simplification Script
 * 
 * This script safely removes the unused/complex tabs from the AI Agent Logic interface:
 * - Flow Designer
 * - A/B Testing  
 * - Personalization
 * 
 * Keeps the essential tabs:
 * - Knowledge Sources
 * - Analytics Dashboard
 * - Agent Personality
 */

const fs = require('fs');
const path = require('path');

const HTML_FILE = path.join(__dirname, '../public/company-profile.html');

function backupFile() {
    const backupPath = HTML_FILE + '.backup-' + Date.now();
    fs.copyFileSync(HTML_FILE, backupPath);
    console.log(`✅ Backup created: ${backupPath}`);
    return backupPath;
}

function removeContentSections(content) {
    console.log('🔧 Removing unused content sections...');
    
    // Remove Flow Designer content section
    content = content.replace(
        /<!-- ========================================= -->\s*<!-- CONVERSATION FLOW DESIGNER[\s\S]*?<\/div>\s*<\/div>/,
        ''
    );
    
    // Remove A/B Testing content section  
    content = content.replace(
        /<!-- ========================================= -->\s*<!-- A\/B TESTING FRAMEWORK[\s\S]*?<\/div>\s*<\/div>/,
        ''
    );
    
    // Remove Personalization content section
    content = content.replace(
        /<!-- ========================================= -->\s*<!-- PERSONALIZATION ENGINE[\s\S]*?<\/div>\s*<\/div>/,
        ''
    );
    
    // Remove hidden personalization content
    content = content.replace(
        /<div style="display: none;">[\s\S]*?<!-- TAB 7: Advanced Personalization Engine -->[\s\S]*?<\/div>/,
        ''
    );
    
    return content;
}

function removeJavaScriptReferences(content) {
    console.log('🔧 Removing JavaScript function references...');
    
    // Remove case statements for removed tabs
    content = content.replace(/case 'flow-designer':[\s\S]*?break;/g, '');
    content = content.replace(/case 'ab-testing':[\s\S]*?break;/g, '');
    content = content.replace(/case 'personalization':[\s\S]*?break;/g, '');
    
    // Remove initialization code
    content = content.replace(/\/\/ Load A\/B tests[\s\S]*?refreshPersonalizationEngine\(\);\s*}/g, '');
    
    return content;
}

function removeFunctionDefinitions(content) {
    console.log('🔧 Removing unused function definitions...');
    
    const functionsToRemove = [
        'initFlowDesigner',
        'loadABTestingData', 
        'loadPersonalizationData',
        'addFlowNode',
        'connectFlowNodes',
        'testFlow',
        'saveFlow',
        'exportFlow',
        'createABTest',
        'loadABTests',
        'updateABTestsList',
        'startABTestingAutoRefresh',
        'stopABTestingAutoRefresh',
        'refreshPersonalizationEngine',
        'createPersonalizationRule',
        'exportPersonalizationReport',
        'filterPersonalizationRules',
        'refreshPersonalizationData',
        'setupPersonalization',
        'updatePersonalizationInsights',
        'updatePersonalizationRules',
        'initializeFlowDesigner'
    ];
    
    functionsToRemove.forEach(funcName => {
        // Remove function definitions (both async and regular)
        const funcRegex = new RegExp(`(async\\s+)?function\\s+${funcName}\\s*\\([^)]*\\)\\s*\\{[\\s\\S]*?\\n\\s*\\}`, 'g');
        content = content.replace(funcRegex, '');
        
        // Remove arrow function definitions
        const arrowRegex = new RegExp(`(const|let|var)\\s+${funcName}\\s*=\\s*\\([^)]*\\)\\s*=>\\s*\\{[\\s\\S]*?\\n\\s*\\}`, 'g');
        content = content.replace(arrowRegex, '');
    });
    
    return content;
}

function cleanupEmptyLines(content) {
    console.log('🔧 Cleaning up empty lines and formatting...');
    
    // Remove excessive empty lines (more than 2 consecutive)
    content = content.replace(/\n\s*\n\s*\n\s*\n+/g, '\n\n\n');
    
    // Remove trailing whitespace
    content = content.replace(/[ \t]+$/gm, '');
    
    return content;
}

function addSimplificationComments(content) {
    console.log('🔧 Adding simplification comments...');
    
    // Add comment at the top of AI Agent Logic section
    const simplificationComment = `
                            <!-- ============================================================================== -->
                            <!-- AI AGENT LOGIC SECTION - SIMPLIFIED FOR PRODUCTION                         -->
                            <!-- ✅ STREAMLINED: Removed Flow Designer, A/B Testing, Personalization        -->
                            <!-- ✅ FOCUSED: Knowledge Sources + Analytics + Agent Personality               -->
                            <!-- ✅ ENTERPRISE: Multi-tenant isolation with company-specific configuration   -->
                            <!-- ============================================================================== -->
    `;
    
    content = content.replace(
        /<!-- AI AGENT LOGIC SECTION - PRODUCTION MULTI-TENANT AI PLATFORM[\s\S]*?-->/,
        simplificationComment.trim()
    );
    
    return content;
}

function validateResult(content) {
    console.log('🔍 Validating simplified content...');
    
    const essentialElements = [
        'clientsvia-tab-knowledge',
        'clientsvia-tab-analytics', 
        'clientsvia-tab-personality',
        'clientsvia-knowledge-content',
        'clientsvia-analytics-content',
        'clientsvia-personality-content'
    ];
    
    const removedElements = [
        'clientsvia-tab-flow-designer',
        'clientsvia-tab-ab-testing',
        'clientsvia-tab-personalization',
        'clientsvia-flow-designer-content',
        'clientsvia-ab-testing-content', 
        'clientsvia-personalization-content'
    ];
    
    let isValid = true;
    
    // Check essential elements are still present
    essentialElements.forEach(element => {
        if (!content.includes(element)) {
            console.error(`❌ Essential element missing: ${element}`);
            isValid = false;
        }
    });
    
    // Check removed elements are gone
    removedElements.forEach(element => {
        if (content.includes(element)) {
            console.warn(`⚠️ Removed element still present: ${element}`);
        }
    });
    
    if (isValid) {
        console.log('✅ Validation passed - all essential elements preserved');
    }
    
    return isValid;
}

async function main() {
    try {
        console.log('🚀 Starting AI Agent Logic Simplification...');
        console.log('📋 Target: Remove Flow Designer, A/B Testing, Personalization');
        console.log('✅ Keep: Knowledge Sources, Analytics, Agent Personality');
        console.log('─────────────────────────────────────────────────\n');
        
        // Create backup
        const backupPath = backupFile();
        
        // Read the HTML file
        let content = fs.readFileSync(HTML_FILE, 'utf8');
        console.log(`📖 Read ${content.length} characters from ${HTML_FILE}`);
        
        // Apply transformations
        content = removeContentSections(content);
        content = removeJavaScriptReferences(content);
        content = removeFunctionDefinitions(content);
        content = cleanupEmptyLines(content);
        content = addSimplificationComments(content);
        
        // Validate result
        if (!validateResult(content)) {
            console.error('❌ Validation failed - restoring backup');
            fs.copyFileSync(backupPath, HTML_FILE);
            process.exit(1);
        }
        
        // Write the simplified content
        fs.writeFileSync(HTML_FILE, content);
        console.log(`\n✅ Simplification complete!`);
        console.log(`📝 Updated ${HTML_FILE}`);
        console.log(`💾 Backup available at ${backupPath}`);
        
        // Summary
        console.log('\n📊 SIMPLIFICATION SUMMARY:');
        console.log('✅ Removed: Flow Designer tab and content');
        console.log('✅ Removed: A/B Testing tab and content');
        console.log('✅ Removed: Personalization tab and content');
        console.log('✅ Preserved: Knowledge Sources (Priority #1)');
        console.log('✅ Preserved: Analytics Dashboard');
        console.log('✅ Preserved: Agent Personality');
        console.log('\n🎯 Result: Clean, focused AI Agent Logic interface');
        
    } catch (error) {
        console.error('❌ Simplification failed:', error);
        process.exit(1);
    }
}

if (require.main === module) {
    main();
}

module.exports = { main };
