/**
 * Predeploy QA Gates (machine-checkable, no excuses)
 *
 * Usage:
 *   QA_BASE_URL="https://clientsvia-backend.onrender.com" \
 *   QA_TOKEN="Bearer <TOKEN>" \
 *   QA_COMPANY_ID="<companyId>" \
 *   node scripts/qa/predeploy-gates.js
 *
 * Optional:
 *   QA_EXPECT_SCHEMA_VERSION="RT_V22.2"
 */

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

async function httpJson(url, token) {
  const res = await fetch(url, {
    headers: {
      Authorization: token,
      'Content-Type': 'application/json'
    }
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response from ${url}: ${text.substring(0, 300)}`);
  }
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} from ${url}: ${JSON.stringify(json).substring(0, 600)}`);
  }
  return json;
}

async function main() {
  const baseUrl = process.env.QA_BASE_URL;
  const token = process.env.QA_TOKEN;
  const companyId = process.env.QA_COMPANY_ID;
  const expectSchemaVersion = process.env.QA_EXPECT_SCHEMA_VERSION || null;

  assert(baseUrl, 'Missing QA_BASE_URL');
  assert(token, 'Missing QA_TOKEN (include full Authorization header value, e.g. "Bearer ...")');
  assert(companyId, 'Missing QA_COMPANY_ID');

  const runtimeTruthUrl = `${baseUrl}/api/company/${companyId}/runtime-truth`;
  const scenarioLinkCheckUrl = `${baseUrl}/api/admin/scenario-diagnostics/link-check/${companyId}`;
  const kpiSummaryUrl = `${baseUrl}/api/company/${companyId}/kpi/summary`;

  console.log('[QA] Fetching runtime-truth…');
  const truth = await httpJson(runtimeTruthUrl, token);
  assert(truth && typeof truth === 'object', 'runtime-truth returned non-object');
  assert(truth._meta && truth._meta.schemaVersion, 'runtime-truth missing _meta.schemaVersion');
  if (expectSchemaVersion) {
    assert(truth._meta.schemaVersion === expectSchemaVersion, `schemaVersion mismatch: expected ${expectSchemaVersion}, got ${truth._meta.schemaVersion}`);
  }
  assert(typeof truth._meta.effectiveConfigVersion === 'string' && truth._meta.effectiveConfigVersion.length >= 6, 'runtime-truth missing effectiveConfigVersion');

  // Booking sanity
  assert(truth.controlPlane?.frontDesk?.booking, 'runtime-truth missing controlPlane.frontDesk.booking');

  // Scenario pool sanity
  console.log('[QA] Fetching scenario link-check…');
  const link = await httpJson(scenarioLinkCheckUrl, token);
  assert(link && link.success === true, 'scenario link-check did not return success:true');
  const poolCount = link.data?.effectiveScenarioPoolCount;
  assert(typeof poolCount === 'number' && poolCount >= 1, `effectiveScenarioPoolCount must be >= 1 (got ${poolCount})`);

  // KPI endpoint sanity (may be empty in a fresh company; must still return valid structure)
  console.log('[QA] Fetching KPI summary…');
  const kpi = await httpJson(kpiSummaryUrl, token);
  assert(kpi && kpi.success === true, 'kpi summary did not return success:true');
  assert(kpi.data && typeof kpi.data === 'object', 'kpi summary missing data');

  console.log('✅ QA gates passed');
  console.log(`- schemaVersion: ${truth._meta.schemaVersion}`);
  console.log(`- effectiveConfigVersion: ${truth._meta.effectiveConfigVersion}`);
  console.log(`- effectiveScenarioPoolCount: ${poolCount}`);
}

main().catch((err) => {
  console.error('❌ QA gates FAILED');
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});


