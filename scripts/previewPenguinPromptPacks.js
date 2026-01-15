require('module').Module._initPaths();
require('dotenv').config();
const mongoose = require('mongoose');

const PromptPackMigrationService = require('../services/promptPacks/PromptPackMigrationService');

const COMPANY_ID = '68e3f77a9d623b8058c700c4'; // Penguin Air

(async () => {
    try {
        const uri = process.env.MONGODB_URI || process.env.MONGO_URI;

        if (!uri) {
            console.error('❌ No Mongo URI found. Set MONGODB_URI or MONGO_URI in your environment.');
            process.exit(1);
        }

        console.log('ℹ️ Connecting to MongoDB...');
        await mongoose.connect(uri);

        console.log('ℹ️ Running migration preview for Penguin...');
        const migrationPreview = await PromptPackMigrationService.previewMigration({
            companyId: COMPANY_ID,
            migrationVersion: 'v1'
        });

        console.log('\n=== MIGRATION PREVIEW ===');
        console.log(JSON.stringify(migrationPreview, null, 2));

        console.log('\nℹ️ Running HVAC pack upgrade preview (hvac_v1 → hvac_v2)...');
        const upgradePreview = await PromptPackMigrationService.previewUpgrade({
            companyId: COMPANY_ID,
            tradeKey: 'hvac',
            toPack: 'hvac_v2'
        });

        console.log('\n=== UPGRADE PREVIEW (HVAC) ===');
        console.log(JSON.stringify(upgradePreview, null, 2));

        await mongoose.disconnect();
        console.log('\n✅ Done.');
    } catch (err) {
        console.error('❌ Error running previews:');
        console.error(err);
        process.exit(1);
    }
})();
