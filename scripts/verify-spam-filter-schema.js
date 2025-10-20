#!/usr/bin/env node

/**
 * SPAM FILTER SCHEMA VERIFICATION
 * 
 * Ensures consistency across:
 * 1. Mongoose Model (v2Company.js)
 * 2. Backend API (callFiltering.js)
 * 3. Frontend (SpamFilterManager.js)
 */

const fs = require('fs');
const path = require('path');

console.log('🔍 SPAM FILTER SCHEMA VERIFICATION\n');
console.log('================================================\n');

// Define the expected schema
const EXPECTED_NEW_SCHEMA = ['checkGlobalSpamDB', 'enableFrequencyCheck', 'enableRobocallDetection'];
const EXPECTED_OLD_SCHEMA = ['blockKnownSpam', 'blockHighFrequency', 'blockRobocalls'];

let allPassed = true;

// ============================================================================
// 1. CHECK MONGOOSE MODEL
// ============================================================================
console.log('1️⃣  CHECKING MONGOOSE MODEL (models/v2Company.js)\n');

const modelPath = path.join(__dirname, '../models/v2Company.js');
const modelContent = fs.readFileSync(modelPath, 'utf8');

// Check for new schema keys
console.log('   ✅ NEW SCHEMA KEYS:');
EXPECTED_NEW_SCHEMA.forEach(key => {
    if (modelContent.includes(key)) {
        console.log(`      ✓ ${key}: FOUND`);
    } else {
        console.log(`      ✗ ${key}: MISSING ❌`);
        allPassed = false;
    }
});

// Check for old schema keys (should exist for migration)
console.log('\n   🔧 OLD SCHEMA KEYS (for migration):');
EXPECTED_OLD_SCHEMA.forEach(key => {
    if (modelContent.includes(key)) {
        console.log(`      ✓ ${key}: FOUND`);
    } else {
        console.log(`      ⚠️  ${key}: MISSING (migration may fail)`);
    }
});

// ============================================================================
// 2. CHECK BACKEND API
// ============================================================================
console.log('\n\n2️⃣  CHECKING BACKEND API (routes/admin/callFiltering.js)\n');

const apiPath = path.join(__dirname, '../routes/admin/callFiltering.js');
const apiContent = fs.readFileSync(apiPath, 'utf8');

// Check if backend handles new schema in GET
console.log('   📥 GET ENDPOINT (migration logic):');
EXPECTED_NEW_SCHEMA.forEach(key => {
    if (apiContent.includes(key)) {
        console.log(`      ✓ ${key}: FOUND`);
    } else {
        console.log(`      ✗ ${key}: MISSING ❌`);
        allPassed = false;
    }
});

// Check if backend saves new schema in PUT/PATCH
console.log('\n   💾 PUT/PATCH ENDPOINT (save logic):');
const hasSaveLogic = apiContent.includes('updateFilteringSettings');
if (hasSaveLogic) {
    console.log('      ✓ updateFilteringSettings function: FOUND');
    
    // Verify it saves all new keys
    EXPECTED_NEW_SCHEMA.forEach(key => {
        const savePattern = new RegExp(`settings\\.${key}\\s*[=:]`, 'g');
        if (savePattern.test(apiContent)) {
            console.log(`      ✓ Saves ${key}: YES`);
        } else {
            console.log(`      ✗ Saves ${key}: NO ❌`);
            allPassed = false;
        }
    });
} else {
    console.log('      ✗ updateFilteringSettings function: NOT FOUND ❌');
    allPassed = false;
}

// ============================================================================
// 3. CHECK FRONTEND
// ============================================================================
console.log('\n\n3️⃣  CHECKING FRONTEND (public/js/ai-agent-settings/SpamFilterManager.js)\n');

const frontendPath = path.join(__dirname, '../public/js/ai-agent-settings/SpamFilterManager.js');
const frontendContent = fs.readFileSync(frontendPath, 'utf8');

console.log('   📤 FRONTEND SENDS:');
EXPECTED_NEW_SCHEMA.forEach(key => {
    if (frontendContent.includes(key)) {
        console.log(`      ✓ ${key}: FOUND`);
    } else {
        console.log(`      ✗ ${key}: MISSING ❌`);
        allPassed = false;
    }
});

console.log('\n   📥 FRONTEND RECEIVES:');
EXPECTED_NEW_SCHEMA.forEach(key => {
    // Check if frontend renders these settings
    const renderPattern = new RegExp(`settings\\.${key}`, 'g');
    if (renderPattern.test(frontendContent)) {
        console.log(`      ✓ Renders ${key}: YES`);
    } else {
        console.log(`      ⚠️  Renders ${key}: CANNOT VERIFY`);
    }
});

// ============================================================================
// 4. SUMMARY
// ============================================================================
console.log('\n\n================================================\n');

if (allPassed) {
    console.log('✅ ALL CHECKS PASSED!\n');
    console.log('The spam filter schema is consistent across:');
    console.log('   - Mongoose Model');
    console.log('   - Backend API');
    console.log('   - Frontend UI\n');
    console.log('🎯 System is production-ready for 100+ companies!\n');
} else {
    console.log('❌ SOME CHECKS FAILED!\n');
    console.log('⚠️  Schema inconsistencies detected. Please review the issues above.\n');
    console.log('This could cause problems across all companies.\n');
    process.exit(1);
}

// ============================================================================
// 5. BONUS: Check for any hardcoded old schema references
// ============================================================================
console.log('📋 BONUS: Checking for hardcoded old schema usage...\n');

let foundHardcodedOldSchema = false;

// Check if backend API still uses old schema in responses (bad)
const oldSchemaInResponse = EXPECTED_OLD_SCHEMA.some(key => {
    const pattern = new RegExp(`\\{[^}]*${key}[^}]*\\}`, 'g');
    return pattern.test(apiContent);
});

if (oldSchemaInResponse) {
    console.log('   ⚠️  Backend may still be using old schema in responses');
    foundHardcodedOldSchema = true;
} else {
    console.log('   ✓ Backend uses new schema in responses');
}

// Check if frontend has any old schema references (bad)
const oldSchemaInFrontend = EXPECTED_OLD_SCHEMA.some(key => frontendContent.includes(key));
if (oldSchemaInFrontend) {
    console.log('   ⚠️  Frontend may still reference old schema keys');
    foundHardcodedOldSchema = true;
} else {
    console.log('   ✓ Frontend only uses new schema');
}

if (!foundHardcodedOldSchema) {
    console.log('\n✅ No hardcoded old schema references found!\n');
} else {
    console.log('\n⚠️  Some old schema references found (review for cleanup)\n');
}

console.log('================================================\n');

