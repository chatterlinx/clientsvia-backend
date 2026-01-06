/**
 * Rebuild Dynamic Flow indexes safely (enterprise deterministic).
 *
 * Why:
 * - Fixes invalid legacy index combinations (sparse + partialFilterExpression)
 * - Removes unsupported partial expressions ($ne / $not) in some Mongo environments
 * - Ensures canonical uniqueness:
 *   - Templates: uniq (flowKey) where isTemplate=true
 *   - Company flows: uniq (companyId + flowKey) where isTemplate=false
 *
 * Run (Render shell):
 *   cd /opt/render/project/src
 *   node scripts/migrations/rebuild-dynamic-flow-indexes.js
 */

const mongoose = require('mongoose');
const logger = require('../../utils/logger');

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error('MONGODB_URI is not set');
  }

  await mongoose.connect(uri);
  logger.info('[MIGRATION] Connected');

  const DynamicFlow = require('../../models/DynamicFlow');
  const col = mongoose.connection.collection('dynamic_flows');

  // 1) Ensure isTemplate exists everywhere (required for stable partial indexes)
  const res = await col.updateMany(
    { isTemplate: { $exists: false } },
    { $set: { isTemplate: false } }
  );
  logger.info('[MIGRATION] Backfilled isTemplate where missing', {
    matched: res.matchedCount,
    modified: res.modifiedCount
  });

  // 2) Sync indexes based on current Mongoose schema
  // NOTE: syncIndexes drops indexes not in schema, then builds required ones.
  logger.info('[MIGRATION] Syncing indexes for dynamic_flows...');
  const syncRes = await DynamicFlow.syncIndexes();
  logger.info('[MIGRATION] syncIndexes complete', syncRes);

  await mongoose.disconnect();
  logger.info('[MIGRATION] Done');
}

main().catch(err => {
  // Never swallow; this is an ops tool.
  // eslint-disable-next-line no-console
  console.error('❌ [MIGRATION] Failed:', err);
  process.exit(1);
});


