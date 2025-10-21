#!/usr/bin/env node
/**
 * ============================================================================
 * ROUTE VALIDATION SCRIPT
 * ============================================================================
 * Purpose: Verify all route files are registered in index.js
 * 
 * This script prevents the "forgotten route" bug that happened with
 * adminNotifications.js - where routes were defined but never registered.
 * 
 * Usage:
 *   node scripts/check-routes.js
 *   npm run check:routes
 * 
 * Exit Codes:
 *   0 - All routes registered ✅
 *   1 - Unregistered routes found ❌
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 [ROUTE VALIDATOR] Checking route registration...\n');

// ============================================================================
// STEP 1: Find all route files
// ============================================================================

function findRouteFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory()) {
            findRouteFiles(fullPath, fileList);
        } else if (file.endsWith('.js')) {
            fileList.push({
                fullPath,
                basename: path.basename(file, '.js'),
                relativePath: path.relative(process.cwd(), fullPath)
            });
        }
    }
    
    return fileList;
}

const routeFiles = findRouteFiles('./routes');
console.log(`📂 Found ${routeFiles.length} route files in ./routes/\n`);

// ============================================================================
// STEP 2: Read index.js and check registrations
// ============================================================================

const indexJSPath = './index.js';
if (!fs.existsSync(indexJSPath)) {
    console.error('❌ index.js not found!');
    process.exit(1);
}

const indexJS = fs.readFileSync(indexJSPath, 'utf-8');

// ============================================================================
// STEP 3: Check each route
// ============================================================================

const unregistered = [];
const registered = [];

for (const route of routeFiles) {
    // Check if basename is mentioned (e.g., "adminNotifications")
    const basenamePattern = route.basename.replace(/([A-Z])/g, '\\$1'); // Escape capitals for regex
    const isRegistered = 
        indexJS.includes(route.basename) ||
        indexJS.includes(route.relativePath) ||
        new RegExp(basenamePattern, 'i').test(indexJS);
    
    if (isRegistered) {
        registered.push(route);
        console.log(`✅ ${route.relativePath}`);
    } else {
        unregistered.push(route);
        console.error(`❌ ${route.relativePath} - NOT REGISTERED`);
    }
}

console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`📊 RESULTS:`);
console.log(`   ✅ Registered: ${registered.length}`);
console.log(`   ❌ Unregistered: ${unregistered.length}`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

// ============================================================================
// STEP 4: Exit with appropriate code
// ============================================================================

if (unregistered.length > 0) {
    console.error('❌ VALIDATION FAILED: Unregistered routes detected!\n');
    console.error('📝 To fix: Add these routes to index.js:');
    console.error('   1. Load route: routes.routeName = await loadRouteWithTimeout(\'./routes/...\')');
    console.error('   2. Register route: app.use(\'/api\', routes.routeName);\n');
    process.exit(1);
}

console.log('✅ VALIDATION PASSED: All routes are registered!\n');
process.exit(0);

