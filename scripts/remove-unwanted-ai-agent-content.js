#!/usr/bin/env node

/**
 * Remove Unwanted AI Agent Logic Content
 * 
 * This script removes the Flow Designer, A/B Testing, and Personalization content
 * that was supposed to be removed but is still present in the Analytics tab.
 * 
 * Target sections to remove:
 * 1. Flow Configuration Panel
 * 2. Visual Flow Designer  
 * 3. A/B Testing Framework
 * 4. Personalization content
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, '../public/company-profile.html');

console.log('🧹 Starting removal of unwanted AI Agent Logic content...');

// Read the file
let content = fs.readFileSync(filePath, 'utf8');
console.log(`📄 File loaded: ${content.length} characters`);

// Define sections to remove with their start and end markers
const sectionsToRemove = [
    {
        name: 'Flow Configuration Panel',
        startMarker: '<!-- Flow Configuration Panel -->',
        endMarker: '</div>\n\n                                    <!-- Visual Flow Designer -->'
    },
    {
        name: 'Visual Flow Designer',
        startMarker: '<!-- Visual Flow Designer -->',
        endMarker: '</div>\n                                    </div>\n\n                                    <!-- A/B Testing Framework -->'
    },
    {
        name: 'A/B Testing Framework',
        startMarker: '<!-- A/B Testing Framework -->',
        endMarker: '</div>\n                                        </div>\n\n                                        <!-- ========================================= -->'
    }
];

let removedCount = 0;

// Remove each section
sectionsToRemove.forEach(section => {
    const startIndex = content.indexOf(section.startMarker);
    const endIndex = content.indexOf(section.endMarker);
    
    if (startIndex !== -1 && endIndex !== -1) {
        console.log(`🎯 Found ${section.name} at positions ${startIndex} to ${endIndex + section.endMarker.length}`);
        
        // Remove the section
        const before = content.substring(0, startIndex);
        const after = content.substring(endIndex + section.endMarker.length);
        content = before + after;
        
        console.log(`✅ Removed ${section.name}`);
        removedCount++;
    } else {
        console.log(`⚠️  Could not find ${section.name} (start: ${startIndex}, end: ${endIndex})`);
    }
});

// Also remove any remaining Flow Configuration references
const flowConfigPatterns = [
    /<!-- Flow Configuration Panel -->[\s\S]*?<\/div>\s*<\/div>/g,
    /<h5[^>]*>.*Flow Configuration.*<\/h5>[\s\S]*?<\/div>\s*<\/div>/g,
    /<i class="fas fa-cog[^"]*"><\/i>Flow Configuration[\s\S]*?<\/div>\s*<\/div>/g
];

flowConfigPatterns.forEach((pattern, index) => {
    const matches = content.match(pattern);
    if (matches) {
        console.log(`🎯 Found ${matches.length} Flow Configuration pattern ${index + 1} matches`);
        content = content.replace(pattern, '');
        removedCount += matches.length;
    }
});

// Remove A/B Testing patterns
const abTestingPatterns = [
    /<h4[^>]*>.*A\/B Testing Framework.*<\/h4>[\s\S]*?<\/div>\s*<\/div>/g,
    /<i class="fas fa-flask[^"]*"><\/i>A\/B Testing Framework[\s\S]*?<\/div>\s*<\/div>/g,
    /Active Tests[\s\S]*?Create Your First Test[\s\S]*?<\/button>/g
];

abTestingPatterns.forEach((pattern, index) => {
    const matches = content.match(pattern);
    if (matches) {
        console.log(`🎯 Found ${matches.length} A/B Testing pattern ${index + 1} matches`);
        content = content.replace(pattern, '');
        removedCount += matches.length;
    }
});

// Clean up any double empty lines
content = content.replace(/\n\n\n+/g, '\n\n');

// Write the cleaned content back
fs.writeFileSync(filePath, content);

console.log(`✅ Cleanup complete! Removed ${removedCount} unwanted sections`);
console.log(`📄 Final file size: ${content.length} characters`);
console.log('🎯 The AI Agent Logic tab should now show only the 3 core tabs: Knowledge Sources, Analytics Dashboard, and Agent Personality');
