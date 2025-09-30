/**
 * 🔪 SURGICAL LEGACY Q&A ELIMINATION
 * ==================================
 * 
 * MISSION: DESTROY specific legacy Q&A entries showing in Company Q&A tab
 * TARGET: Exact IDs from console output and UI display
 * 
 * LEGACY Q&A ENTRIES TO ELIMINATE:
 * - "testing" / "testing answers" (68b6c876fdf0b5d0a159a0a2)
 * - "how much is your ac service?" / "A/C Service cost $49..." (68b6cafdf3c35831ad0c84dd)
 * - "how much is your ac service?" / "$49" (68b6d274766e665beb2e9c1f)
 * - "what brands do you carry?" / "we carry Trane systems only" (68b98884ae4ac3ae2b083699)
 * - "do you install thermostats?" / "yes we install most all" (68bac188145b72f747f65133)
 */

const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');

async function connectToMongoDB() {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia';
    const client = new MongoClient(uri);
    await client.connect();
    console.log('✅ Connected to MongoDB (direct connection)');
    return client;
}

async function surgicalLegacyQnAElimination() {
    console.log('🔪 SURGICAL LEGACY Q&A ELIMINATION');
    console.log('===================================');
    console.log('🎯 TARGET: Specific legacy Q&A entries from Company Q&A tab');
    console.log('⚠️  WARNING: This will permanently delete identified legacy Q&A entries');
    console.log('');

    const client = await connectToMongoDB();
    const db = client.db();

    try {
        // Target company ID from console logs
        const targetCompanyId = '68813026dd95f599c74e49c7';
        console.log(`🏢 TARGET COMPANY: ${targetCompanyId}`);
        
        // Specific legacy Q&A IDs to eliminate (from console output)
        const legacyQnAIds = [
            '68b6c876fdf0b5d0a159a0a2', // "testing" / "testing answers"
            '68b6cafdf3c35831ad0c84dd', // "how much is your ac service?" / "A/C Service cost $49..."
            '68b6d274766e665beb2e9c1f', // "how much is your ac service?" / "$49"
            '68b98884ae4ac3ae2b083699', // "what brands do you carry?" / "we carry Trane systems only"
            '68bac188145b72f747f65133'  // "do you install thermostats?" / "yes we install most all"
        ];

        console.log(`🎯 TARGETING ${legacyQnAIds.length} SPECIFIC LEGACY Q&A ENTRIES:`);
        
        // First, let's verify these entries exist and show their content
        for (const qnaId of legacyQnAIds) {
            try {
                const qna = await db.collection('companyqnas').findOne({ 
                    _id: new mongoose.Types.ObjectId(qnaId) 
                });
                
                if (qna) {
                    console.log(`\n❌ FOUND LEGACY: ${qnaId}`);
                    console.log(`   📋 Question: "${qna.question}"`);
                    console.log(`   📋 Answer: "${qna.answer.substring(0, 50)}${qna.answer.length > 50 ? '...' : ''}"`);
                    console.log(`   📋 Company: ${qna.companyId}`);
                    console.log(`   📋 Created: ${qna.createdAt}`);
                } else {
                    console.log(`\n✅ NOT FOUND: ${qnaId} (already deleted or doesn't exist)`);
                }
            } catch (error) {
                console.log(`\n❌ ERROR checking ${qnaId}: ${error.message}`);
            }
        }

        // SURGICAL ELIMINATION - Delete specific legacy Q&A entries
        console.log('\n🔪 INITIATING SURGICAL ELIMINATION...');
        console.log('⚠️  This will permanently delete the identified legacy Q&A entries');
        
        let deletedCount = 0;
        let notFoundCount = 0;
        
        for (const qnaId of legacyQnAIds) {
            try {
                const result = await db.collection('companyqnas').deleteOne({ 
                    _id: new mongoose.Types.ObjectId(qnaId) 
                });
                
                if (result.deletedCount > 0) {
                    console.log(`✅ ELIMINATED: ${qnaId}`);
                    deletedCount++;
                } else {
                    console.log(`ℹ️  NOT FOUND: ${qnaId} (already deleted)`);
                    notFoundCount++;
                }
            } catch (error) {
                console.log(`❌ ERROR deleting ${qnaId}: ${error.message}`);
            }
        }

        console.log('\n✅ SURGICAL ELIMINATION COMPLETE');
        console.log('=================================');
        console.log(`🔪 Legacy Q&As eliminated: ${deletedCount}`);
        console.log(`ℹ️  Already deleted/not found: ${notFoundCount}`);
        console.log(`📊 Total processed: ${legacyQnAIds.length}`);

        // Verify elimination - check if any of the target IDs still exist
        console.log('\n🔍 VERIFICATION: Checking for remaining legacy Q&As...');
        let remainingCount = 0;
        
        for (const qnaId of legacyQnAIds) {
            try {
                const qna = await db.collection('companyqnas').findOne({ 
                    _id: new mongoose.Types.ObjectId(qnaId) 
                });
                
                if (qna) {
                    console.log(`❌ STILL EXISTS: ${qnaId} - "${qna.question}"`);
                    remainingCount++;
                }
            } catch (error) {
                // Ignore errors during verification
            }
        }
        
        if (remainingCount === 0) {
            console.log('✅ VERIFICATION PASSED: All targeted legacy Q&As have been eliminated');
        } else {
            console.log(`❌ VERIFICATION FAILED: ${remainingCount} legacy Q&As still exist`);
        }

        // Also check for any other Q&As for this company
        console.log('\n🔍 CHECKING FOR OTHER Q&As...');
        const remainingQnAs = await db.collection('companyqnas').find({ 
            companyId: targetCompanyId 
        }).toArray();
        
        console.log(`📊 Remaining Q&As for company ${targetCompanyId}: ${remainingQnAs.length}`);
        
        if (remainingQnAs.length > 0) {
            console.log('📋 Remaining Q&As:');
            remainingQnAs.forEach((qna, index) => {
                console.log(`   ${index + 1}. "${qna.question}" (${qna._id})`);
            });
        }

    } catch (error) {
        console.error('❌ Error during surgical elimination:', error);
    } finally {
        await client.close();
        console.log('\n🔌 MongoDB connection closed');
    }
}

// Run the surgical elimination
surgicalLegacyQnAElimination().catch(console.error);
