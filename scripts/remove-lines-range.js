#!/usr/bin/env node

/**
 * Remove Lines Range Script
 * 
 * Removes specific line ranges from the company-profile.html file
 * to eliminate unwanted Flow Canvas and A/B Testing content.
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../public/company-profile.html');

console.log('🔧 Removing unwanted content by line ranges...');

// Read the file
let content = fs.readFileSync(filePath, 'utf8');
let lines = content.split('\n');

console.log(`📄 Original file: ${lines.length} lines`);

// Define ranges to remove (inclusive)
const rangesToRemove = [
    { start: 2687, end: 3173, description: 'A/B Testing Framework and Personalization content' },
];

// Remove ranges in reverse order to maintain line numbers
rangesToRemove.reverse().forEach(range => {
    console.log(`🗑️  Removing lines ${range.start}-${range.end}: ${range.description}`);
    
    // Convert to 0-based indexing
    const startIdx = range.start - 1;
    const endIdx = range.end - 1;
    
    // Remove the lines
    lines.splice(startIdx, endIdx - startIdx + 1);
    
    console.log(`✅ Removed ${endIdx - startIdx + 1} lines`);
});

// Join lines back together
content = lines.join('\n');

// Write back to file
fs.writeFileSync(filePath, content);

console.log(`📄 Final file: ${lines.length} lines`);
console.log('✅ Line removal complete!');

// Verify JavaScript functions are still intact
const criticalFunctions = [
    'function initClientsViaIntelligence',
    'function loadAgentAnalytics',
    'function initClientsViaTabs'
];

console.log('\n🔍 Verifying JavaScript functions...');
criticalFunctions.forEach(func => {
    if (content.includes(func)) {
        console.log(`✅ ${func} - PRESERVED`);
    } else {
        console.log(`❌ ${func} - MISSING!`);
    }
});
