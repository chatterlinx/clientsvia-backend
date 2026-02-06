/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * ENABLE STRICT CONTROL PLANE MODE FOR A COMPANY
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Usage:
 *   node scripts/enable-strict-mode.js <companyId> [level]
 * 
 * Examples:
 *   node scripts/enable-strict-mode.js 68e3f77a9d623b8058c700c4 strict
 *   node scripts/enable-strict-mode.js 68e3f77a9d623b8058c700c4 warn
 * 
 * This script enables the Control Plane enforcement for a specific company.
 * 
 * Levels:
 *   - "warn"   = Log violations but don't block (safe for migration)
 *   - "strict" = Block and fail closed on violations (production)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');

async function main() {
    const companyId = process.argv[2];
    const level = process.argv[3] || 'strict';
    
    if (!companyId) {
        console.log('Usage: MONGODB_URI="mongodb+srv://..." node scripts/enable-strict-mode.js <companyId> [level]');
        console.log('');
        console.log('Levels:');
        console.log('  warn   - Log violations but continue (migration mode)');
        console.log('  strict - Block and fail closed (production mode)');
        process.exit(1);
    }
    
    if (!['warn', 'strict'].includes(level)) {
        console.error('ERROR: Level must be "warn" or "strict"');
        process.exit(1);
    }
    
    // Support multiple env var names (Render uses different names)
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL;
    const envVarUsed = process.env.MONGODB_URI ? 'MONGODB_URI' : 
                       process.env.MONGO_URI ? 'MONGO_URI' : 
                       process.env.DATABASE_URL ? 'DATABASE_URL' : null;
    
    if (!mongoUri) {
        console.error('ERROR: No MongoDB connection string found');
        console.error('');
        console.error('Set one of: MONGODB_URI, MONGO_URI, or DATABASE_URL');
        console.error('');
        console.error('Usage:');
        console.error('  MONGODB_URI="mongodb+srv://..." node scripts/enable-strict-mode.js <companyId> [level]');
        console.error('');
        console.error('Or run from Render Shell where env vars are already set.');
        process.exit(1);
    }
    
    console.log(`Using env var: ${envVarUsed}`);
    
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log('ENABLE STRICT CONTROL PLANE MODE');
    console.log('═══════════════════════════════════════════════════════════════════════════════');
    console.log(`Company ID: ${companyId}`);
    console.log(`Level: ${level}`);
    
    // Show which database we're connecting to (mask credentials)
    const maskedUri = mongoUri.replace(/:\/\/[^@]+@/, '://***:***@');
    console.log(`Database: ${maskedUri}`);
    console.log('');
    
    try {
        await mongoose.connect(mongoUri);
        console.log('✓ Connected to MongoDB');
        
        const Company = mongoose.model('Company', new mongoose.Schema({}, { strict: false }), 'companies');
        
        const company = await Company.findById(companyId);
        
        if (!company) {
            console.error(`ERROR: Company not found: ${companyId}`);
            process.exit(1);
        }
        
        console.log(`✓ Found company: ${company.companyName || company.name || companyId}`);
        
        // Get current settings
        const currentEnforcement = company.aiAgentSettings?.frontDesk?.enforcement;
        console.log('');
        console.log('CURRENT ENFORCEMENT SETTINGS:');
        console.log(JSON.stringify(currentEnforcement || {}, null, 2));
        
        // Update enforcement settings
        const updateResult = await Company.updateOne(
            { _id: companyId },
            {
                $set: {
                    'aiAgentSettings.frontDesk.enforcement.strictControlPlaneOnly': level === 'strict',
                    'aiAgentSettings.frontDesk.enforcement.level': level
                }
            }
        );
        
        console.log('');
        console.log('UPDATE RESULT:');
        console.log(`  Modified: ${updateResult.modifiedCount}`);
        
        // Verify the update
        const updatedCompany = await Company.findById(companyId);
        const newEnforcement = updatedCompany.aiAgentSettings?.frontDesk?.enforcement;
        
        console.log('');
        console.log('NEW ENFORCEMENT SETTINGS:');
        console.log(JSON.stringify(newEnforcement || {}, null, 2));
        
        console.log('');
        console.log('═══════════════════════════════════════════════════════════════════════════════');
        if (level === 'strict') {
            console.log('✓ STRICT MODE ENABLED');
            console.log('');
            console.log('WHAT THIS MEANS:');
            console.log('  - All turns will route through FrontDeskRuntime');
            console.log('  - Config violations will BLOCK and fail closed');
            console.log('  - CONTROL_PLANE_HEADER will show strictMode: true');
            console.log('');
            console.log('NEXT: Make a test call and verify:');
            console.log('  1. CONTROL_PLANE_HEADER shows strictMode=true, validation.ok=true');
            console.log('  2. DECISION_TRACE shows keysUsed[] is non-empty');
            console.log('  3. DECISION_TRACE shows violations[] is empty');
        } else {
            console.log('✓ WARN MODE ENABLED');
            console.log('');
            console.log('WHAT THIS MEANS:');
            console.log('  - Legacy paths will still run');
            console.log('  - Config violations will LOG but not block');
            console.log('  - Use this for migration period, then switch to strict');
        }
        console.log('═══════════════════════════════════════════════════════════════════════════════');
        
    } catch (error) {
        console.error('ERROR:', error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
    }
}

main();
