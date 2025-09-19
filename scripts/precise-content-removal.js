#!/usr/bin/env node

/**
 * Precise Content Removal for AI Agent Logic Tab
 * 
 * This script surgically removes ONLY the unwanted Flow Configuration and A/B Testing
 * content from within the Analytics tab, while preserving all JavaScript functions
 * and legitimate Analytics content.
 * 
 * Target: Remove specific HTML sections that are showing unwanted content
 * Preserve: All JavaScript functions, legitimate Analytics content, tab structure
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../public/company-profile.html');

console.log('🔧 Starting precise removal of unwanted content...');

// Read the file
let content = fs.readFileSync(filePath, 'utf8');
console.log(`📄 File loaded: ${content.length} characters`);

let removedCount = 0;
let originalLength = content.length;

// 1. Remove Flow Configuration Panel (within Analytics tab)
console.log('\n🎯 Removing Flow Configuration Panel...');
const flowConfigStart = content.indexOf('<!-- Flow Configuration Panel -->');
const flowConfigEnd = content.indexOf('<!-- Visual Flow Designer -->');

if (flowConfigStart !== -1 && flowConfigEnd !== -1) {
    const before = content.substring(0, flowConfigStart);
    const after = content.substring(flowConfigEnd);
    content = before + after;
    console.log(`✅ Removed Flow Configuration Panel (${flowConfigEnd - flowConfigStart} characters)`);
    removedCount++;
} else {
    console.log(`⚠️  Flow Configuration Panel not found (start: ${flowConfigStart}, end: ${flowConfigEnd})`);
}

// 2. Remove Visual Flow Designer
console.log('\n🎯 Removing Visual Flow Designer...');
const visualFlowStart = content.indexOf('<!-- Visual Flow Designer -->');
const visualFlowEnd = content.indexOf('<!-- A/B Testing Framework -->');

if (visualFlowStart !== -1 && visualFlowEnd !== -1) {
    const before = content.substring(0, visualFlowStart);
    const after = content.substring(visualFlowEnd);
    content = before + after;
    console.log(`✅ Removed Visual Flow Designer (${visualFlowEnd - visualFlowStart} characters)`);
    removedCount++;
} else {
    console.log(`⚠️  Visual Flow Designer not found (start: ${visualFlowStart}, end: ${visualFlowEnd})`);
}

// 3. Remove A/B Testing Framework
console.log('\n🎯 Removing A/B Testing Framework...');
const abTestStart = content.indexOf('<!-- A/B Testing Framework -->');
// Find the end by looking for the next major section
const abTestEnd = content.indexOf('<!-- ========================================= -->', abTestStart + 100);

if (abTestStart !== -1 && abTestEnd !== -1) {
    const before = content.substring(0, abTestStart);
    const after = content.substring(abTestEnd);
    content = before + after;
    console.log(`✅ Removed A/B Testing Framework (${abTestEnd - abTestStart} characters)`);
    removedCount++;
} else {
    console.log(`⚠️  A/B Testing Framework not found (start: ${abTestStart}, end: ${abTestEnd})`);
}

// 4. Clean up any remaining Flow Configuration or A/B Testing references with regex
console.log('\n🧹 Cleaning up remaining references...');

// Remove any remaining Flow Configuration divs
const flowPattern = /<div[^>]*>\s*<h5[^>]*>.*Flow Configuration.*<\/h5>[\s\S]*?<\/div>\s*<\/div>/g;
const flowMatches = content.match(flowPattern);
if (flowMatches) {
    console.log(`🎯 Found ${flowMatches.length} additional Flow Configuration references`);
    content = content.replace(flowPattern, '');
    removedCount += flowMatches.length;
}

// Remove any remaining A/B Testing references
const abPattern = /<h4[^>]*>.*A\/B Testing Framework.*<\/h4>[\s\S]*?<\/div>\s*<\/div>/g;
const abMatches = content.match(abPattern);
if (abMatches) {
    console.log(`🎯 Found ${abMatches.length} additional A/B Testing references`);
    content = content.replace(abPattern, '');
    removedCount += abMatches.length;
}

// 5. Verify JavaScript functions are still intact
console.log('\n🔍 Verifying JavaScript functions are preserved...');
const criticalFunctions = [
    'function initClientsViaIntelligence',
    'function loadAgentAnalytics',
    'function initClientsViaTabs',
    'function initializeClientsviaTabListeners'
];

let allFunctionsPresent = true;
criticalFunctions.forEach(func => {
    if (content.includes(func)) {
        console.log(`✅ ${func} - PRESERVED`);
    } else {
        console.log(`❌ ${func} - MISSING!`);
        allFunctionsPresent = false;
    }
});

if (!allFunctionsPresent) {
    console.log('🚨 CRITICAL ERROR: JavaScript functions were accidentally removed!');
    console.log('🔄 Restoring from backup...');
    content = fs.readFileSync(filePath + '.backup-1758279370125', 'utf8');
    console.log('❌ Restoration failed - manual intervention required');
    process.exit(1);
}

// Clean up any double empty lines
content = content.replace(/\n\n\n+/g, '\n\n');

// Write the cleaned content back
fs.writeFileSync(filePath, content);

const finalLength = content.length;
const bytesRemoved = originalLength - finalLength;

console.log(`\n✅ Precise removal complete!`);
console.log(`📊 Statistics:`);
console.log(`   - Sections removed: ${removedCount}`);
console.log(`   - Bytes removed: ${bytesRemoved.toLocaleString()}`);
console.log(`   - Original size: ${originalLength.toLocaleString()} characters`);
console.log(`   - Final size: ${finalLength.toLocaleString()} characters`);
console.log(`   - JavaScript functions: PRESERVED ✅`);
console.log('\n🎯 The AI Agent Logic tab should now show only legitimate Analytics content');
