/**
 * Front Desk commissioning check (in-process).
 *
 * Usage:
 *   COMPANY_ID=... node scripts/commissioning/frontDeskCommissionCheck.js
 *   node scripts/commissioning/frontDeskCommissionCheck.js 68e3f77a9d623b8058c700c4
 *
 * What it does:
 * - Connects to Mongo via existing db.js (Render env already supplies MONGODB_URI).
 * - Loads the company document.
 * - Runs the full FrontDeskVerifier (same as the admin endpoint).
 * - Prints a concise JSON summary + full issues/warnings.
 * - Exits non-zero if status is not PRODUCTION_READY.
 *
 * This is UI-aligned (no new schema) and safe for production.
 */

const { connectDB } = require('../../db');
const Company = require('../../models/v2Company');
const { verifyFrontDesk } = require('../../services/verification/FrontDeskVerifier');

const companyId = process.env.COMPANY_ID || process.argv[2];

if (!companyId) {
    console.error('❌ COMPANY_ID is required (env COMPANY_ID or argv[2])');
    process.exit(1);
}

async function main() {
    await connectDB();
    const company = await Company.findById(companyId).lean();
    if (!company) {
        throw new Error(`Company not found: ${companyId}`);
    }

    const report = await verifyFrontDesk(companyId, company);
    const summary = {
        status: report.status,
        overallScore: report.overallScore,
        issues: report.issues.length,
        warnings: report.warnings.length,
        generatedAt: report.generatedAt
    };

    console.log(JSON.stringify({ summary, issues: report.issues, warnings: report.warnings }, null, 2));

    if (report.status !== 'PRODUCTION_READY') {
        process.exitCode = 1;
    }
}

main().catch((err) => {
    console.error('❌ Commissioning check failed:', err.message);
    process.exit(1);
});
