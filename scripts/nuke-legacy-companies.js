/**
 * NUKE LEGACY COMPANIES - Permanently delete all old test/legacy companies
 * 
 * This will HARD DELETE companies that:
 * 1. Have NO account status (legacy data)
 * 2. Are test/demo companies
 * 3. Are in the legacy "companies" collection
 * 
 * KEEPS:
 * - Royal Plumbing (real company with status: active)
 * - Total Air (if exists)
 * - Any company with proper account status that looks legitimate
 */

const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia';

async function nukeLegacyCompanies() {
    console.log(`\n${'='.repeat(80)}`);
    console.log(`💀 NUKING LEGACY COMPANIES - PERMANENT DELETION`);
    console.log(`${'='.repeat(80)}\n`);

    try {
        await mongoose.connect(MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const db = mongoose.connection.db;

        // Companies to KEEP (legitimate companies with proper status)
        const companiesToKeep = [
            'Royal Plumbing',
            'Total Air'
        ];

        console.log('🛡️  PROTECTED COMPANIES (will NOT be deleted):');
        companiesToKeep.forEach(name => console.log(`   ✅ ${name}`));
        console.log('');

        // Get all companies from both collections
        const companiesCollection = db.collection('companiesCollection');
        const legacyCollection = db.collection('companies');

        const allCompanies = [
            ...await companiesCollection.find({}).toArray(),
            ...await legacyCollection.find({}).toArray()
        ];

        console.log(`📊 Found ${allCompanies.length} total companies\n`);

        // Identify companies to DELETE
        const companiesToDelete = allCompanies.filter(company => {
            const name = company.companyName || company.businessName || 'Unnamed';
            
            // Keep protected companies
            if (companiesToKeep.includes(name)) {
                return false;
            }

            // Delete if:
            // 1. No account status (legacy)
            // 2. Test/demo/debug in name
            // 3. In legacy collection
            
            const hasNoStatus = !company.accountStatus || !company.accountStatus.status;
            const isTestCompany = /test|demo|debug|sample|qa|elite hvac|abc plumbing|climate control|electric co/i.test(name);
            
            return hasNoStatus || isTestCompany;
        });

        console.log(`💀 COMPANIES TO DELETE (${companiesToDelete.length}):\n`);
        companiesToDelete.forEach((company, index) => {
            const name = company.companyName || company.businessName || 'Unnamed';
            console.log(`${index + 1}. ${name}`);
            console.log(`   ID: ${company._id}`);
            console.log(`   Status: ${company.accountStatus?.status || 'NO STATUS (legacy)'}`);
            console.log(`   Created: ${company.createdAt || 'N/A'}`);
            console.log('');
        });

        if (companiesToDelete.length === 0) {
            console.log('✅ No companies to delete - database is clean!\n');
            return;
        }

        // Confirmation
        console.log(`\n${'='.repeat(80)}`);
        console.log(`⚠️  FINAL WARNING`);
        console.log(`${'='.repeat(80)}\n`);
        console.log(`This will PERMANENTLY delete ${companiesToDelete.length} companies and ALL their data:`);
        console.log(`  • Company profiles`);
        console.log(`  • Call logs & transcripts`);
        console.log(`  • Contacts & customer data`);
        console.log(`  • Q&A & knowledge base`);
        console.log(`  • Notifications & templates`);
        console.log(`  • All related data\n`);
        console.log(`💥 THIS CANNOT BE UNDONE!\n`);

        // Wait 3 seconds for user to cancel if needed
        console.log('⏳ Starting deletion in 3 seconds... (Ctrl+C to cancel)');
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('⏳ 2...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('⏳ 1...');
        await new Promise(resolve => setTimeout(resolve, 1000));
        console.log('💥 DELETION STARTING NOW!\n');

        let totalDeleted = 0;
        let totalRecordsDeleted = 0;

        // Delete each company and all related data
        for (const company of companiesToDelete) {
            const companyId = company._id;
            const companyName = company.companyName || company.businessName || 'Unnamed';

            console.log(`\n💀 Deleting: ${companyName} (${companyId})`);

            try {
                // Delete company document from both collections
                const deleteResult = await Promise.all([
                    companiesCollection.deleteOne({ _id: companyId }),
                    legacyCollection.deleteOne({ _id: companyId })
                ]);
                
                const companyDeleted = deleteResult[0].deletedCount + deleteResult[1].deletedCount;
                console.log(`   ✅ Company document deleted: ${companyDeleted}`);

                // Delete all related data
                const deletionResults = await Promise.allSettled([
                    // Call logs
                    db.collection('v2aiagentcalllogs').deleteMany({ companyId }),
                    db.collection('aiagentcalllogs').deleteMany({ companyId }),
                    
                    // Contacts
                    db.collection('v2contacts').deleteMany({ companyId }),
                    db.collection('contacts').deleteMany({ companyId }),
                    
                    // Notifications
                    db.collection('v2notificationlogs').deleteMany({ companyId }),
                    db.collection('notificationlogs').deleteMany({ companyId }),
                    
                    // Conversation logs
                    db.collection('conversationlogs').deleteMany({ companyId }),
                    
                    // Q&A / Knowledge
                    db.collection('companyqnas').deleteMany({ companyId }),
                    db.collection('localcompanyqnas').deleteMany({ companyId }),
                    
                    // Bookings
                    db.collection('bookings').deleteMany({ companyId }),
                    
                    // Templates
                    db.collection('v2templates').deleteMany({ companyId }),
                    
                    // Instant response categories
                    db.collection('instantresponsecategories').deleteMany({ companyId }),
                    
                    // Company Q&A categories
                    db.collection('companyqnacategories').deleteMany({ companyId })
                ]);

                let relatedRecords = 0;
                deletionResults.forEach((result) => {
                    if (result.status === 'fulfilled') {
                        relatedRecords += result.value?.deletedCount || 0;
                    }
                });

                console.log(`   ✅ Related records deleted: ${relatedRecords}`);
                
                totalDeleted++;
                totalRecordsDeleted += (companyDeleted + relatedRecords);

            } catch (error) {
                console.error(`   ❌ Error deleting ${companyName}:`, error.message);
            }
        }

        console.log(`\n${'='.repeat(80)}`);
        console.log(`💀 DELETION COMPLETE`);
        console.log(`${'='.repeat(80)}\n`);
        console.log(`✅ Companies deleted: ${totalDeleted}`);
        console.log(`✅ Total records deleted: ${totalRecordsDeleted}`);
        console.log(`\n💥 Legacy data has been NUKED - like it never existed!\n`);

    } catch (error) {
        console.error('❌ Fatal error:', error);
    } finally {
        await mongoose.disconnect();
        console.log('✅ Disconnected from MongoDB\n');
    }
}

nukeLegacyCompanies().then(() => {
    process.exit(0);
}).catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
});

