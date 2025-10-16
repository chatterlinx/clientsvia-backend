const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

async function checkCollections() {
    try {
        const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');

        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log('\n📚 Available Collections:');
        collections.forEach(col => {
            console.log(`   - ${col.name}`);
        });

        // Check for company-related collections
        const companyCollections = collections.filter(c => c.name.toLowerCase().includes('company'));
        console.log('\n🏢 Company Collections:');
        for (const col of companyCollections) {
            const count = await mongoose.connection.db.collection(col.name).countDocuments();
            console.log(`   - ${col.name}: ${count} documents`);
            
            // Sample a few
            const samples = await mongoose.connection.db.collection(col.name).find({}).limit(3).toArray();
            samples.forEach(s => {
                const name = s.companyName || s.businessName || 'Unnamed';
                const deleted = s.isDeleted ? '🗑️' : '✅';
                console.log(`      ${deleted} ${name} (${s._id})`);
            });
        }

        await mongoose.disconnect();
        console.log('\n✅ Done');
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

checkCollections();
