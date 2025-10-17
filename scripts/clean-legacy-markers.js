/**
 * CLEAN LEGACY MARKERS
 * 
 * Removes all legacy comments and markers from files:
 * - Emoji comments (🔧, 🗑️, ⚠️, etc.)
 * - REMOVED/DELETED/FIXME/TODO markers
 * - Old debugging comments
 * - Temporary fix comments
 */

const fs = require('fs');
const path = require('path');

const filesToClean = [
    '/Users/marc/MyProjects/clientsvia-backend/public/company-profile.html',
    '/Users/marc/MyProjects/clientsvia-backend/public/js/company-profile-modern.js'
];

function cleanFile(filePath) {
    console.log(`\nCleaning: ${path.basename(filePath)}`);
    
    let content = fs.readFileSync(filePath, 'utf8');
    const originalLength = content.length;
    const originalLines = content.split('\n').length;
    
    // Remove lines with emoji comments
    content = content.split('\n').filter(line => {
        const hasEmoji = /[🔧🗑️⚠️❌✅🚀📋👥⚙️📞🌐💾📡🎯🔍🏗️🧠🎨🧪🔥🚨💡🛡️🔄]/g.test(line);
        return !hasEmoji;
    }).join('\n');
    
    // Remove comment lines with legacy markers
    const legacyPatterns = [
        /\/\* REMOVED:.*?\*\//g,
        /\/\/ REMOVED:.*$/gm,
        /<!-- REMOVED:.*?-->/g,
        /\/\* DELETED:.*?\*\//g,
        /\/\/ DELETED:.*$/gm,
        /<!-- DELETED:.*?-->/g,
        /\/\/ FIXME:.*$/gm,
        /\/\/ TODO:.*$/gm,
        /\/\/ HACK:.*$/gm,
        /\/\/ TEMP:.*$/gm,
        /\/\* \[FIXED\].*?\*\//g,
        /\/\/ \[FIXED\].*$/gm,
        /\/\* HOTFIX:.*?\*\//g,
        /\/\/ HOTFIX:.*$/gm,
        /\/\* BULLETPROOF:.*?\*\//g,
        /\/\/ BULLETPROOF:.*$/gm,
        /\/\* AGGRESSIVE FIX:.*?\*\//g,
        /\/\/ AGGRESSIVE FIX:.*$/gm,
        /\/\* CRITICAL:.*?\*\//g,
        /\/\/ CRITICAL:.*$/gm
    ];
    
    legacyPatterns.forEach(pattern => {
        content = content.replace(pattern, '');
    });
    
    // Remove empty comment blocks
    content = content.replace(/\/\*\s*\*\//g, '');
    content = content.replace(/<!--\s*-->/g, '');
    
    // Remove multiple consecutive blank lines (more than 2)
    content = content.replace(/\n{4,}/g, '\n\n\n');
    
    const newLength = content.length;
    const newLines = content.split('\n').length;
    const removedLines = originalLines - newLines;
    
    fs.writeFileSync(filePath, content, 'utf8');
    
    console.log(`  Original: ${originalLines} lines, ${originalLength} bytes`);
    console.log(`  Cleaned: ${newLines} lines, ${newLength} bytes`);
    console.log(`  Removed: ${removedLines} lines`);
    console.log(`  ✅ Cleaned!`);
}

console.log('============================================');
console.log('CLEANING LEGACY MARKERS');
console.log('============================================');

filesToClean.forEach(cleanFile);

console.log('\n============================================');
console.log('✅ ALL FILES CLEANED!');
console.log('============================================\n');

