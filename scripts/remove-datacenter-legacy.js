/**
 * 🧹 REMOVE LEGACY REFERENCES FROM DATACENTER.JS
 * ===============================================
 * Surgically removes all legacy collection fallbacks
 * Keeps V2 collections only
 */

const fs = require('fs');

const filePath = 'routes/admin/dataCenter.js';

console.log('🔧 Reading dataCenter.js...\n');
let content = fs.readFileSync(filePath, 'utf8');

// Backup original
fs.writeFileSync(filePath + '.backup', content);
console.log('📦 Backup created: routes/admin/dataCenter.js.backup\n');

let changeCount = 0;

// ═══════════════════════════════════════════════════════════
// PATTERN 1: Remove legacy company collection fallback in findOne
// ═══════════════════════════════════════════════════════════
const findOnePattern = /\.findOne\(\{[^}]+\}\)\s*\|\|\s*await\s+[^.]+\.collection\('companies'\)\.findOne\(\{[^}]+\}\)/g;
const findOneMatches = content.match(findOnePattern);
if (findOneMatches) {
    console.log(`💀 Removing ${findOneMatches.length} legacy company findOne fallbacks...`);
    content = content.replace(findOnePattern, (match) => {
        // Extract just the first findOne (V2)
        const firstPart = match.split('||')[0].trim();
        changeCount++;
        return firstPart;
    });
}

// ═══════════════════════════════════════════════════════════
// PATTERN 2: Remove legacy company updateOne in Promise.all
// ═══════════════════════════════════════════════════════════
const updateOnePattern = /mongoose\.connection\.db\.collection\('companies'\)\.updateOne\([^)]+\),?\s*/g;
const updateOneMatches = content.match(updateOnePattern);
if (updateOneMatches) {
    console.log(`💀 Removing ${updateOneMatches.length} legacy company updateOne calls...`);
    content = content.replace(updateOnePattern, '// LEGACY REMOVED\n            ');
    changeCount += updateOneMatches.length;
}

// ═══════════════════════════════════════════════════════════
// PATTERN 3: Remove legacy company deleteOne
// ═══════════════════════════════════════════════════════════
const deleteOnePattern = /db\.collection\('companies'\)\.deleteOne\([^)]+\),?\s*/g;
const deleteOneMatches = content.match(deleteOnePattern);
if (deleteOneMatches) {
    console.log(`💀 Removing ${deleteOneMatches.length} legacy company deleteOne calls...`);
    content = content.replace(deleteOnePattern, '// LEGACY REMOVED\n            ');
    changeCount += deleteOneMatches.length;
}

// ═══════════════════════════════════════════════════════════
// PATTERN 4: Remove legacy contacts deleteMany
// ═══════════════════════════════════════════════════════════
const contactsPattern = /db\.collection\('contacts'\)\.deleteMany\([^)]+\),?\s*/g;
const contactsMatches = content.match(contactsPattern);
if (contactsMatches) {
    console.log(`💀 Removing ${contactsMatches.length} legacy contacts deleteMany calls...`);
    content = content.replace(contactsPattern, '// LEGACY REMOVED\n            ');
    changeCount += contactsMatches.length;
}

// ═══════════════════════════════════════════════════════════
// PATTERN 5: Remove legacy bookings deleteMany
// ═══════════════════════════════════════════════════════════
const bookingsPattern = /db\.collection\('bookings'\)\.deleteMany\([^)]+\),?\s*/g;
const bookingsMatches = content.match(bookingsPattern);
if (bookingsMatches) {
    console.log(`💀 Removing ${bookingsMatches.length} legacy bookings deleteMany calls...`);
    content = content.replace(bookingsPattern, '// LEGACY REMOVED\n            ');
    changeCount += bookingsMatches.length;
}

// ═══════════════════════════════════════════════════════════
// PATTERN 6: Remove legacy conversationlogs deleteMany
// ═══════════════════════════════════════════════════════════
const conversationLogsPattern = /db\.collection\('conversationlogs'\)\.deleteMany\([^)]+\),?\s*/g;
const conversationLogsMatches = content.match(conversationLogsPattern);
if (conversationLogsMatches) {
    console.log(`💀 Removing ${conversationLogsMatches.length} legacy conversationlogs deleteMany calls...`);
    content = content.replace(conversationLogsPattern, '// LEGACY REMOVED\n            ');
    changeCount += conversationLogsMatches.length;
}

// ═══════════════════════════════════════════════════════════
// PATTERN 7: Remove legacy aiagentcalllogs deleteMany
// ═══════════════════════════════════════════════════════════
const aiagentCallLogsPattern = /db\.collection\('aiagentcalllogs'\)\.deleteMany\([^)]+\),?\s*/g;
const aiagentCallLogsMatches = content.match(aiagentCallLogsPattern);
if (aiagentCallLogsMatches) {
    console.log(`💀 Removing ${aiagentCallLogsMatches.length} legacy aiagentcalllogs deleteMany calls...`);
    content = content.replace(aiagentCallLogsPattern, '// LEGACY REMOVED\n            ');
    changeCount += aiagentCallLogsMatches.length;
}

// ═══════════════════════════════════════════════════════════
// PATTERN 8: Remove legacy notificationlogs deleteMany
// ═══════════════════════════════════════════════════════════
const notificationLogsPattern = /db\.collection\('notificationlogs'\)\.deleteMany\([^)]+\),?\s*/g;
const notificationLogsMatches = content.match(notificationLogsPattern);
if (notificationLogsMatches) {
    console.log(`💀 Removing ${notificationLogsMatches.length} legacy notificationlogs deleteMany calls...`);
    content = content.replace(notificationLogsPattern, '// LEGACY REMOVED\n            ');
    changeCount += notificationLogsMatches.length;
}

// ═══════════════════════════════════════════════════════════
// PATTERN 9: Remove legacy collection variables & lookups
// ═══════════════════════════════════════════════════════════
// Replace: names.has('companies') ? db.collection('companies') : null
const legacyVarPattern = /names\.has\('companies'\)\s*\?\s*db\.collection\('companies'\)\s*:\s*null/g;
const legacyVarMatches = content.match(legacyVarPattern);
if (legacyVarMatches) {
    console.log(`💀 Removing ${legacyVarMatches.length} legacy collection variable assignments...`);
    content = content.replace(legacyVarPattern, 'null // LEGACY REMOVED');
    changeCount += legacyVarMatches.length;
}

// ═══════════════════════════════════════════════════════════
// PATTERN 10: Fix debug logging that references removed vars
// ═══════════════════════════════════════════════════════════
content = content.replace(/legacy:\s*\([^)]+\)\s*\?\s*'companies'\s*:\s*null/g, "legacy: null // REMOVED");

// ═══════════════════════════════════════════════════════════
// WRITE CLEANED FILE
// ═══════════════════════════════════════════════════════════
fs.writeFileSync(filePath, content);

console.log(`\n✅ Cleaned dataCenter.js`);
console.log(`📊 Total changes: ${changeCount}\n`);
console.log('📌 NEXT STEPS:');
console.log('   1. Review changes: git diff routes/admin/dataCenter.js');
console.log('   2. Test Data Center page');
console.log('   3. If all works, delete backup: rm routes/admin/dataCenter.js.backup\n');

