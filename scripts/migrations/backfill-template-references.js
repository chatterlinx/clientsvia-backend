#!/usr/bin/env node
/**
 * BACKFILL TEMPLATE REFERENCES
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Copies template references from legacy location to canonical field:
 *   FROM: company.configuration.templates (or similar legacy paths)
 *   TO:   company.aiAgentSettings.templateReferences
 * 
 * Usage:
 *   node scripts/migrations/backfill-template-references.js [companyId]
 * 
 * If no companyId provided, processes ALL companies with empty templateReferences.
 */

const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGODB_URI;

async function backfillTemplateReferences(targetCompanyId = null) {
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  BACKFILL TEMPLATE REFERENCES MIGRATION');
    console.log('═══════════════════════════════════════════════════════════════\n');

    if (!MONGODB_URI) {
        console.error('❌ MONGODB_URI not set. Run this in production environment or set .env');
        process.exit(1);
    }

    await mongoose.connect(MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const db = mongoose.connection.db;
    const companiesCollection = db.collection('companiesCollection');

    // Build query
    const query = {
        $or: [
            { 'aiAgentSettings.templateReferences': { $exists: false } },
            { 'aiAgentSettings.templateReferences': { $size: 0 } },
            { 'aiAgentSettings.templateReferences': null }
        ]
    };

    if (targetCompanyId) {
        query._id = new mongoose.Types.ObjectId(targetCompanyId);
    }

    const companies = await companiesCollection.find(query).toArray();
    console.log(`📊 Found ${companies.length} companies with empty templateReferences\n`);

    let updated = 0;
    let skipped = 0;

    for (const company of companies) {
        console.log(`\n─────────────────────────────────────────────────────────────────`);
        console.log(`🏢 ${company.companyName || company.name} (${company._id})`);

        // Check for legacy template locations
        const legacyTemplates = [];

        // Location 1: configuration.templates
        if (company.configuration?.templates?.length > 0) {
            console.log(`  📦 Found templates in configuration.templates: ${company.configuration.templates.length}`);
            for (const t of company.configuration.templates) {
                legacyTemplates.push({
                    templateId: t.templateId || t._id || t.id,
                    templateName: t.templateName || t.name || 'Unknown Template',
                    templateType: t.templateType || t.type || company.tradeType || 'universal',
                    scope: t.scope || 'primary',
                    enabled: t.enabled !== false
                });
            }
        }

        // Location 2: dataConfig.templates (another possible legacy location)
        if (company.dataConfig?.templates?.length > 0) {
            console.log(`  📦 Found templates in dataConfig.templates: ${company.dataConfig.templates.length}`);
            for (const t of company.dataConfig.templates) {
                // Avoid duplicates
                const exists = legacyTemplates.find(lt => 
                    String(lt.templateId) === String(t.templateId || t._id || t.id)
                );
                if (!exists) {
                    legacyTemplates.push({
                        templateId: t.templateId || t._id || t.id,
                        templateName: t.templateName || t.name || 'Unknown Template',
                        templateType: t.templateType || t.type || company.tradeType || 'universal',
                        scope: t.scope || 'secondary',
                        enabled: t.enabled !== false
                    });
                }
            }
        }

        // Location 3: aiAgentLogic.primaryTemplateId (single template reference)
        if (company.aiAgentLogic?.primaryTemplateId) {
            console.log(`  📦 Found primaryTemplateId in aiAgentLogic`);
            const exists = legacyTemplates.find(lt => 
                String(lt.templateId) === String(company.aiAgentLogic.primaryTemplateId)
            );
            if (!exists) {
                legacyTemplates.push({
                    templateId: company.aiAgentLogic.primaryTemplateId,
                    templateName: company.aiAgentLogic.primaryTemplateName || 'Primary Template',
                    templateType: company.tradeType || 'universal',
                    scope: 'primary',
                    enabled: true
                });
            }
        }

        if (legacyTemplates.length === 0) {
            console.log(`  ⏭️  No legacy templates found - skipping`);
            skipped++;
            continue;
        }

        console.log(`\n  📋 Templates to backfill:`);
        for (const t of legacyTemplates) {
            console.log(`     - ${t.templateName} (${t.templateId}) [${t.scope}]`);
        }

        // Update the company
        const result = await companiesCollection.updateOne(
            { _id: company._id },
            {
                $set: {
                    'aiAgentSettings.templateReferences': legacyTemplates
                }
            }
        );

        if (result.modifiedCount > 0) {
            console.log(`  ✅ UPDATED - Backfilled ${legacyTemplates.length} template(s)`);
            updated++;
        } else {
            console.log(`  ⚠️  No changes made`);
            skipped++;
        }
    }

    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('  MIGRATION COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`  ✅ Updated: ${updated}`);
    console.log(`  ⏭️  Skipped: ${skipped}`);
    console.log(`  📊 Total:   ${companies.length}`);
    console.log('═══════════════════════════════════════════════════════════════\n');

    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
}

// Run
const companyId = process.argv[2] || null;
if (companyId) {
    console.log(`🎯 Target company: ${companyId}`);
}

backfillTemplateReferences(companyId)
    .then(() => process.exit(0))
    .catch(err => {
        console.error('❌ Migration failed:', err);
        process.exit(1);
    });

