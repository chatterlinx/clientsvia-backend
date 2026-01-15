// scripts/applyPenguinHvacPackV2.js

require('module').Module._initPaths();
require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

const COMPANY_ID = '68e3f77a9d623b8058c700c4'; // Penguin Air
const TRADE_KEY = 'hvac';
const FROM_PACK = 'hvac_v1';
const TO_PACK = 'hvac_v2';
const CHANGED_BY = 'admin-script-applyPenguinHvacPackV2';

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

        const currentPack =
            company.aiAgentSettings?.frontDeskBehavior?.promptPacks?.selectedByTrade?.get?.(TRADE_KEY) ||
            company.aiAgentSettings?.frontDeskBehavior?.promptPacks?.selectedByTrade?.[TRADE_KEY] ||
            null;

        console.log(`ℹ️ Current selected pack for trade "${TRADE_KEY}":`, currentPack);

        if (currentPack && currentPack !== FROM_PACK) {
            console.warn(
                `⚠️ Expected current pack "${FROM_PACK}" but found "${currentPack}". Aborting to avoid an unexpected jump.`
            );
            process.exit(1);
        }

        if (currentPack === TO_PACK) {
            console.log(`✅ Already on ${TO_PACK}. Nothing to do.`);
            process.exit(0);
        }

        const historyEntry = {
            tradeKey: TRADE_KEY,
            fromPack: currentPack || FROM_PACK,
            toPack: TO_PACK,
            changedAt: new Date(),
            changedBy: CHANGED_BY,
            notes: 'Upgrade hvac pack from hvac_v1 to hvac_v2 (4 changed pack keys, no overrides)',
            changedKeysCount: 4,
            overrideCount: 0
        };

        console.log(`ℹ️ Setting selectedByTrade.${TRADE_KEY} = "${TO_PACK}"...`);
        await Company.updateOne(
            { _id: COMPANY_ID },
            {
                $set: { [`aiAgentSettings.frontDeskBehavior.promptPacks.selectedByTrade.${TRADE_KEY}`]: TO_PACK },
                $push: { 'aiAgentSettings.frontDeskBehavior.promptPacks.history': historyEntry }
            },
            { runValidators: false }
        );

        console.log('✅ Pack upgraded and history entry recorded.');
        await mongoose.disconnect();
        console.log('✅ Done.');
    } catch (err) {
        console.error('❌ Error applying hvac_v2 for Penguin:');
        console.error(err);
        process.exit(1);
    }
})();
