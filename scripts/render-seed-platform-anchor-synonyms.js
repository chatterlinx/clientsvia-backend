'use strict';

/**
 * ============================================================================
 * RENDER SHELL SEED — Platform Anchor Synonyms (HVAC + universal)
 * ============================================================================
 *
 * PURPOSE:
 *   Seeds AdminSettings.globalHub.anchorSynonyms with platform default
 *   synonym lists for the UAP "Logic 1 / Word Gate" anchor matcher.
 *
 *   The anchor gate (KCDiscoveryRunner) requires ≥90% of a phrase's
 *   anchorWords[] to appear (literal stem) in the caller's input. Real
 *   callers paraphrase: "system's not cooling" instead of "ac is not
 *   cooling". Without synonyms the gate fails on a perfectly valid
 *   utterance, KC never commits, and control jumps straight to the
 *   Claude LLM agent — bypassing both KC and Groq.
 *
 *   Adding "system" / "unit" / "air conditioner" / "central air" as
 *   synonyms for the anchor "ac" lets the gate pass on the same caller
 *   utterance, KC commits its trade-specific answer, and Groq gets the
 *   chance to format the response naturally.
 *
 * SHAPE (AdminSettings.globalHub.anchorSynonyms):
 *
 *   {
 *     "ac":      ["air conditioner", "system", "unit", "central air", ...],
 *     "furnace": ["heater", "heating", "system", ...],
 *     ...
 *   }
 *
 *   Per-tenant override at company.aiAgentSettings.agent2.speechDetection.
 *   anchorSynonyms uses REPLACE semantics — a tenant key fully overrides
 *   the platform list for that anchor (empty array = explicit disable,
 *   useful when a synonym creates an industry collision, e.g. "unit"
 *   means a real-estate unit in property management, not an HVAC unit).
 *
 * IDEMPOTENCY / SAFETY:
 *   - Re-running is a SAFE NO-OP: the script merges with whatever already
 *     exists in globalHub.anchorSynonyms — keys present in the DB are
 *     LEFT UNTOUCHED, only missing platform defaults are inserted.
 *     → If an admin manually expanded "ac" with extra synonyms in the
 *       admin UI, those edits are preserved.
 *   - Pass --reset to FORCE-OVERWRITE all platform keys with the seed
 *     (admin edits to seeded keys are lost; tenant overrides on
 *     v2Company are unaffected).
 *
 * MULTI-TENANT:
 *   This is a PLATFORM seed, not per-tenant. Every company on the
 *   platform inherits these synonyms unless they override them.
 *   No companyId is touched. No tenant data changes.
 *
 * USAGE — Render Shell:
 *   node scripts/render-seed-platform-anchor-synonyms.js
 *   node scripts/render-seed-platform-anchor-synonyms.js --reset
 *
 *   After running, verify with:
 *     node -e 'require("mongodb").MongoClient.connect(process.env.MONGODB_URI).then(c=>c.db("clientsvia").collection("adminsettings").findOne()).then(d=>console.log(JSON.stringify(d.globalHub.anchorSynonyms, null, 2)))'
 *
 * ============================================================================
 */

const { MongoClient } = require('mongodb');

// ─── Platform-default synonym lists ────────────────────────────────────────
// Seeded as the universal floor every tenant inherits. Trade-specific
// vocabularies (HVAC, plumbing, electrical, etc.) are mixed in here because
// the anchor gate doesn't know the tenant's trade — it just needs to recognise
// when a caller is using a contextually equivalent term.
//
// Multi-tenant safety: a tenant in a non-HVAC trade is unaffected by these
// keys unless their own KC cards happen to use the same anchor word. If they
// do, they can override at company.aiAgentSettings.agent2.speechDetection.
const PLATFORM_ANCHOR_SYNONYMS = {
    // ── HVAC: cooling system ──────────────────────────────────────────────
    'ac':              ['air conditioner', 'air conditioning', 'a/c', 'system', 'unit', 'central air', 'cooler'],
    'aircon':          ['air conditioner', 'air conditioning', 'ac', 'a/c', 'system'],
    'cooling':         ['cool', 'cold air', 'cool air'],
    'cooler':          ['ac', 'air conditioner', 'system'],

    // ── HVAC: heating system ──────────────────────────────────────────────
    // Note: 'heater' is intentionally a UNION of HVAC + plumbing context.
    // Anchor "heater" can refer to a furnace OR a water heater; the section's
    // *anchorWords* + *coreGate* (Logic 2 embedding) disambiguate downstream.
    'furnace':         ['heater', 'heating', 'system', 'unit'],
    'heater':          ['furnace', 'heating', 'system', 'unit', 'water heater', 'hot water heater', 'hot water tank'],
    'heating':         ['heat', 'warm', 'heater', 'furnace'],
    'boiler':          ['heater', 'heating', 'system'],

    // ── HVAC: airflow / mechanical ────────────────────────────────────────
    'thermostat':      ['stat', 'temperature control', 'tstat'],
    'compressor':      ['outdoor unit', 'condenser', 'outside unit'],
    'condenser':       ['compressor', 'outdoor unit', 'outside unit'],
    'duct':            ['ducting', 'ductwork', 'vents', 'air ducts'],
    'vent':            ['register', 'duct', 'air vent'],
    'filter':          ['air filter', 'furnace filter'],

    // ── Plumbing: leaks & water ───────────────────────────────────────────
    'leak':            ['leaking', 'dripping', 'leaky', 'drip'],
    'leaking':         ['leak', 'dripping', 'leaky'],
    'drip':            ['dripping', 'leak', 'leaking'],
    'water':           ['h2o', 'leak'],
    'pipe':            ['piping', 'plumbing', 'tubing'],
    'drain':           ['drainage', 'pipe', 'draining'],
    'clog':            ['clogged', 'backed up', 'blocked', 'stopped up', 'blockage'],
    'toilet':          ['commode', 'lavatory'],
    'faucet':          ['tap', 'spigot'],
    'sink':            ['basin'],
    'shower':          ['bath', 'shower head'],
    'tub':             ['bathtub', 'bath'],
    'tankless':        ['on-demand', 'on demand', 'instant water heater'],

    // ── Electrical ────────────────────────────────────────────────────────
    'outlet':          ['plug', 'receptacle', 'socket', 'plug-in'],
    'breaker':         ['circuit breaker', 'fuse', 'panel breaker'],
    'panel':           ['breaker box', 'electrical panel', 'service panel', 'fuse box'],
    'wire':            ['wiring', 'cable', 'cord'],
    'switch':          ['light switch', 'toggle'],
    'light':           ['lights', 'bulb', 'fixture', 'lighting'],

    // ── Universal action verbs ────────────────────────────────────────────
    // Note: synonyms with apostrophes ("doesn't") work because BOTH the
    // caller's input AND the stored synonym are normalised through the same
    // strip (`/[^a-z0-9\s]/g → ' '`) before matching. So "doesn't work" the
    // synonym is stored as ["doesn","t","work"] tokens, and caller "it doesn't
    // work" tokenises identically.
    'broken':          ['broke', 'busted', 'damaged', "not working", "doesn't work", "isn't working"],
    'fix':             ['repair', 'mend', 'service'],
    'install':         ['installation', 'put in', 'set up', 'mount'],
    'replace':         ['swap', 'change out', 'new'],
    'service':         ['servicing', 'maintenance', 'tune up', 'tuneup'],

    // ── Universal negation (caller paraphrasing "not") ────────────────────
    'not':             ["ain't", "isn't", "won't", "doesn't", "don't", "wasn't", "haven't"],
};

const FIELD_PATH = 'globalHub.anchorSynonyms';

async function main() {
    const args = process.argv.slice(2);
    const reset = args.includes('--reset');

    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error('❌ MONGODB_URI not set in environment.');
        process.exit(1);
    }

    const client = new MongoClient(uri);
    await client.connect();
    try {
        const db = client.db('clientsvia');
        const coll = db.collection('adminsettings');

        let doc = await coll.findOne({});
        if (!doc) {
            console.log('📋 No AdminSettings doc — creating singleton...');
            const ins = await coll.insertOne({ globalHub: {} });
            doc = await coll.findOne({ _id: ins.insertedId });
        }

        const existing = doc?.globalHub?.anchorSynonyms || {};
        let merged;

        if (reset) {
            console.log('⚠️  --reset: forcing overwrite of all platform keys.');
            merged = { ...PLATFORM_ANCHOR_SYNONYMS };
            // Preserve any keys an admin added that aren't in the seed.
            for (const k of Object.keys(existing)) {
                if (!(k in PLATFORM_ANCHOR_SYNONYMS)) merged[k] = existing[k];
            }
        } else {
            // Idempotent merge: existing keys win, only insert missing seed keys.
            merged = { ...existing };
            let inserted = 0;
            for (const [k, v] of Object.entries(PLATFORM_ANCHOR_SYNONYMS)) {
                if (!(k in merged)) {
                    merged[k] = v;
                    inserted++;
                }
            }
            console.log(`✅ Inserted ${inserted} new platform anchor keys (existing ${Object.keys(existing).length} preserved).`);
        }

        await coll.updateOne(
            { _id: doc._id },
            {
                $set: {
                    [FIELD_PATH]: merged,
                    'globalHub.anchorSynonymsUpdatedAt': new Date(),
                    'globalHub.anchorSynonymsUpdatedBy': 'render-seed-platform-anchor-synonyms',
                    lastUpdated: new Date(),
                },
            }
        );

        const totalKeys = Object.keys(merged).length;
        const totalSyns = Object.values(merged).reduce((s, a) => s + (Array.isArray(a) ? a.length : 0), 0);
        console.log(`✅ Done. Platform anchorSynonyms now has ${totalKeys} anchor keys / ${totalSyns} total synonym phrases.`);
        console.log('   Verify in admin: AdminSettings.globalHub.anchorSynonyms');
    } finally {
        await client.close();
    }
}

main().catch(err => {
    console.error('❌ Seed failed:', err);
    process.exit(1);
});
