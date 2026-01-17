/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * MIGRATE LEGACY SCENARIO TYPES → CANONICAL
 * ═══════════════════════════════════════════════════════════════════════════════
 *
 * Purpose:
 * - Remove legacy scenarioType values (INFO_FAQ, ACTION_FLOW, SYSTEM_ACK)
 * - Normalize UNKNOWN/blank scenarioType to canonical values
 * - Update GlobalInstantResponseTemplate documents in place
 *
 * Usage:
 *   DRY_RUN=true node scripts/migrate-legacy-scenario-types.js   # Preview
 *   node scripts/migrate-legacy-scenario-types.js               # Apply
 *
 * ═══════════════════════════════════════════════════════════════════════════════
 */

require('dotenv').config();
const mongoose = require('mongoose');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const { detectScenarioType } = require('../utils/scenarioTypeDetector');
const { CANONICAL_SCENARIO_TYPES } = require('../utils/scenarioTypes');

const DRY_RUN = process.env.DRY_RUN === 'true';
const UPDATED_BY = 'migrate-legacy-scenario-types';

const LEGACY_TYPES = new Set(['INFO_FAQ', 'ACTION_FLOW', 'SYSTEM_ACK']);
const CANONICAL_TYPES = new Set(CANONICAL_SCENARIO_TYPES.filter(t => t !== 'UNKNOWN'));

function resolveScenarioType(scenario, categoryName) {
    const rawType = (scenario.scenarioType || '').toString().trim().toUpperCase();
    const actionType = (scenario.actionType || '').toString().trim().toUpperCase();
    const followUpMode = (scenario.followUpMode || '').toString().trim().toUpperCase();

    if (CANONICAL_TYPES.has(rawType)) {
        return { type: rawType, reason: 'already_canonical' };
    }

    if (rawType === 'INFO_FAQ') {
        return { type: 'FAQ', reason: 'legacy_info_faq' };
    }

    if (rawType === 'SYSTEM_ACK') {
        return { type: 'SYSTEM', reason: 'legacy_system_ack' };
    }

    // ACTION_FLOW or UNKNOWN/blank → infer using heuristics + detector
    const hasTransfer = actionType === 'TRANSFER' || Boolean(scenario.transferTarget);
    const wantsBooking = scenario.bookingIntent === true || actionType === 'REQUIRE_BOOKING' || followUpMode === 'ASK_IF_BOOK';
    const detected = detectScenarioType(scenario, categoryName);

    if (hasTransfer) {
        return { type: 'TRANSFER', reason: 'transfer_target_or_actionType' };
    }

    if (detected === 'EMERGENCY') {
        return { type: 'EMERGENCY', reason: 'detected_emergency' };
    }

    if (wantsBooking) {
        return { type: 'BOOKING', reason: 'booking_intent_or_followup' };
    }

    return { type: detected, reason: 'detected_from_content' };
}

async function main() {
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI;
    if (!mongoUri) {
        console.error('❌ MONGODB_URI not set');
        process.exit(1);
    }

    await mongoose.connect(mongoUri);
    console.log(`✅ Connected to MongoDB`);
    console.log(`Mode: ${DRY_RUN ? 'DRY RUN (preview only)' : 'APPLY (writing changes)'}`);

    const templates = await GlobalInstantResponseTemplate.find({});
    console.log(`📦 Templates found: ${templates.length}`);

    let totalScenarios = 0;
    let changedScenarios = 0;
    const changes = [];

    for (const template of templates) {
        let templateChanged = false;
        const templateChanges = [];

        for (const category of (template.categories || [])) {
            for (const scenario of (category.scenarios || [])) {
                totalScenarios++;
                const rawType = (scenario.scenarioType || '').toString().trim().toUpperCase() || 'UNKNOWN';

                const isLegacy = LEGACY_TYPES.has(rawType);
                const isUnknown = rawType === 'UNKNOWN' || rawType === '';
                if (!isLegacy && !isUnknown) {
                    continue;
                }

                const { type: resolvedType, reason } = resolveScenarioType(scenario, category.name);

                if (resolvedType && resolvedType !== rawType) {
                    templateChanged = true;
                    changedScenarios++;
                    templateChanges.push({
                        scenarioId: scenario.scenarioId || scenario._id?.toString(),
                        scenarioName: scenario.name,
                        categoryName: category.name,
                        before: rawType,
                        after: resolvedType,
                        reason
                    });

                    if (!DRY_RUN) {
                        scenario.scenarioType = resolvedType;
                        scenario.updatedAt = new Date();
                        scenario.updatedBy = UPDATED_BY;
                        scenario.scenarioTypeFixedAt = new Date();
                        scenario.scenarioTypeFixedBy = UPDATED_BY;
                    }
                }
            }
        }

        if (templateChanged) {
            changes.push({
                templateId: template._id.toString(),
                templateName: template.name,
                updates: templateChanges
            });

            if (!DRY_RUN) {
                template.updatedAt = new Date();
                template.lastUpdatedBy = UPDATED_BY;
                await template.save();
            }
        }
    }

    console.log('══════════════════════════════════════════════════════════════════════');
    console.log(`Total scenarios scanned: ${totalScenarios}`);
    console.log(`Scenarios updated: ${changedScenarios}`);
    console.log(`Templates updated: ${changes.length}`);
    console.log('══════════════════════════════════════════════════════════════════════');

    if (changes.length > 0) {
        changes.forEach(t => {
            console.log(`\n📦 ${t.templateName} (${t.templateId})`);
            t.updates.slice(0, 20).forEach(u => {
                console.log(`  - ${u.scenarioName} [${u.categoryName}]: ${u.before} → ${u.after} (${u.reason})`);
            });
            if (t.updates.length > 20) {
                console.log(`  ... ${t.updates.length - 20} more`);
            }
        });
    }

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
}

main().catch(err => {
    console.error('❌ Migration failed:', err);
    process.exit(1);
});
