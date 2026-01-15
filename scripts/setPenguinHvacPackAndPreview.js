// scripts/setPenguinHvacPackAndPreview.js

require('module').Module._initPaths();
require('dotenv').config();
const mongoose = require('mongoose');

const PromptPackMigrationService = require('../services/promptPacks/PromptPackMigrationService');
const Company = require('../models/v2Company');

const COMPANY_ID = '68e3f77a9d623b8058c700c4'; // Penguin Air
const TRADE_KEY = 'hvac';
const TARGET_PACK = 'hvac_v1';
const UPGRADE_TO_PACK = 'hvac_v2';

(async () => {
    try {
        const uri = process.env.MONGODB_URI || process.env.MONGO_URI;
        if (!uri) {
            console.error('❌ No Mongo URI found. Set MONGODB_URI or MONGO_URI in your environment.');
            process.exit(1);
        }

        console.log('ℹ️ Connecting to MongoDB...');
        await mongoose.connect(uri);

        console.log(`ℹ️ Loading company ${COMPANY_ID}...`);
        const company = await Company.findById(COMPANY_ID);

        if (!company) {
            console.error('❌ Company not found.');
            process.exit(1);
        }

        const selectedByTrade = company.aiAgentSettings?.frontDeskBehavior?.promptPacks?.selectedByTrade;
        const previousPack = selectedByTrade?.get?.(TRADE_KEY) || selectedByTrade?.[TRADE_KEY] || null;
        console.log(`ℹ️ Current selected pack for trade "${TRADE_KEY}":`, previousPack);

        const allowSet = String(process.env.ALLOW_SET_HVAC_V1 || '').toLowerCase() === 'true';
        if (!previousPack && allowSet) {
            console.log(`ℹ️ Setting selectedByTrade.${TRADE_KEY} = "${TARGET_PACK}"...`);
            await Company.updateOne(
                { _id: COMPANY_ID },
                { $set: { [`aiAgentSettings.frontDeskBehavior.promptPacks.selectedByTrade.${TRADE_KEY}`]: TARGET_PACK } },
                { runValidators: false }
            );
            console.log('✅ Company updated.');
        } else if (!previousPack) {
            console.log('ℹ️ No pack selected; set ALLOW_SET_HVAC_V1=true to assign hvac_v1.');
        } else {
            console.log(`✅ Pack already set to ${previousPack}; no changes applied.`);
        }

        console.log('\nℹ️ Running HVAC pack upgrade preview (hvac_v1 → hvac_v2)...');

        const upgradePreview = await PromptPackMigrationService.previewUpgrade({
            companyId: COMPANY_ID,
            tradeKey: TRADE_KEY,
            toPack: UPGRADE_TO_PACK
        });

        console.log('\n=== UPGRADE PREVIEW (HVAC) ===');
        console.log(JSON.stringify(upgradePreview, null, 2));

        await mongoose.disconnect();
        console.log('\n✅ Done.');
    } catch (err) {
        console.error('❌ Error running hvac pack selection + preview:');
        console.error(err);
        process.exit(1);
    }
})();
