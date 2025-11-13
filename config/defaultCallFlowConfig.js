/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DEFAULT CALL FLOW CONFIGURATION
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Defines the default processing sequence for incoming calls
 * Scope: Per companyId (each company can customize)
 * Usage: Backfills callFlowConfig when creating new companies
 * 
 * Architecture:
 * - Layer 0 (spamFilter) is ALWAYS first and locked
 * - Steps 1-7 are reorderable via Call Flow tab
 * - Each step can be enabled/disabled independently
 * - System validates dependencies and warns about cost/time impacts
 * 
 * Design Philosophy:
 * - Start with full intelligence on ALL calls (quality first)
 * - Fast-path optimization available later (data-driven)
 * - Learn patterns before optimizing for speed
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const defaultCallFlowConfig = [
    // ═══════════════════════════════════════════════════════════════════════
    // LAYER 0: SPAM FILTER (Always First, Cannot Be Reordered)
    // ═══════════════════════════════════════════════════════════════════════
    {
        id: 'spamFilter',
        enabled: true,
        locked: true,  // Cannot be reordered or disabled
        params: {}
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 1: EDGE CASE DETECTION (AI Spam, Robocalls, Dead Air)
    // ═══════════════════════════════════════════════════════════════════════
    {
        id: 'edgeCases',
        enabled: true,
        locked: false,
        params: {}
        // Uses: cheatSheet.edgeCases[] from database
        // Can short-circuit: YES (hangs up or provides canned response)
        // Avg time: ~10ms
        // Cost: $0.00
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 2: TRANSFER RULES (Emergency, Billing, Department Routing)
    // ═══════════════════════════════════════════════════════════════════════
    {
        id: 'transferRules',
        enabled: true,
        locked: false,
        params: {}
        // Uses: cheatSheet.transferRules[] from database
        // Can short-circuit: PARTIAL (transfers call, skips scenarios)
        // Avg time: ~15ms
        // Cost: $0.00
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 3: FRONTLINE-INTEL (THE HUB - Intelligent Gatekeeper)
    // ═══════════════════════════════════════════════════════════════════════
    {
        id: 'frontlineIntel',
        enabled: true,  // Enabled by default for quality
        locked: false,
        params: {
            model: 'gpt-4o-mini',               // Cheap & fast model
            timeout: 5000,                      // 5 second timeout
            retries: 1,                         // Retry once on failure
            fallbackToRaw: true,                // Use raw input if LLM fails
            enableCustomerLookup: true,         // Look up returning customers
            enableServiceValidation: true,      // Detect wrong company/service
            enableContextCapture: true,         // Capture story context
            maxCostPerCall: 0.01,              // Hard cost cap
            
            // Fast-path optimization (disabled at launch)
            // Enable after 1000+ calls and 95%+ satisfaction
            fastPath: {
                enabled: false,                 // Start disabled (Phase 1)
                patterns: [],                   // Learned patterns (populated later)
                minCallsBeforeEnable: 1000,    // Safety threshold
                minTier1HitRate: 0.90,         // 90% Tier 1 success required
                minCustomerSat: 0.95,          // 95% satisfaction required
                skipFrontlineIntel: true,       // When pattern matches, go straight to Tier 1
                routeDirectlyTo: 'scenarioMatching'
            }
        }
        // Uses: cheatSheet.frontlineIntel (text) from database
        // Can short-circuit: YES (wrong number, wrong service detection)
        // Avg time: ~800ms (LLM call)
        // Cost: $0.003 per call
        // Output: cleanedInput, customer info, context, validation
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 4: SCENARIO MATCHING (3-Tier Intelligence)
    // ═══════════════════════════════════════════════════════════════════════
    {
        id: 'scenarioMatching',
        enabled: true,  // Core routing, cannot disable
        locked: false,
        params: {
            enableTier1: true,   // Keywords (free, ~12ms)
            enableTier2: true,   // Semantic Q&A (free, ~45ms)
            enableTier3: true,   // LLM fallback ($0.003, ~800ms)
            tier1Threshold: 0.70,
            tier2Threshold: 0.75,
            tier3Threshold: 0.50
        }
        // Uses: Scenarios, keywords, Q&A pairs, frontlineIntel cleanedInput
        // Can short-circuit: NO (always generates response)
        // Avg time: 12ms (Tier 1 hit), 45ms (Tier 2 hit), 800ms (Tier 3)
        // Cost: $0.00 (Tier 1/2), $0.003 (Tier 3)
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 5: CONTENT GUARDRAILS (Safety & Compliance)
    // ═══════════════════════════════════════════════════════════════════════
    {
        id: 'guardrails',
        enabled: true,  // Always on for safety (admin can disable with warning)
        locked: false,
        params: {}
        // Uses: cheatSheet.guardrails[] from database
        // Can short-circuit: NO (modifies response)
        // Avg time: ~8ms
        // Cost: $0.00
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 6: BEHAVIOR POLISH (Tone & Text Transformation)
    // ═══════════════════════════════════════════════════════════════════════
    {
        id: 'behaviorPolish',
        enabled: true,
        locked: false,
        params: {}
        // Uses: cheatSheet.behaviorRules[] from database
        // Can short-circuit: NO (modifies response)
        // Avg time: ~3ms
        // Cost: $0.00
    },
    
    // ═══════════════════════════════════════════════════════════════════════
    // STEP 7: CONTEXT INJECTION (Story Acknowledgment)
    // ═══════════════════════════════════════════════════════════════════════
    {
        id: 'contextInjection',
        enabled: true,
        locked: false,
        params: {}
        // Uses: context from Frontline-Intel output
        // Can short-circuit: NO (modifies response)
        // Avg time: ~2ms
        // Cost: $0.00
        // Dependencies: Requires frontlineIntel to be enabled
    }
];

// ═══════════════════════════════════════════════════════════════════════════
// PERFORMANCE ESTIMATES (Default Configuration)
// ═══════════════════════════════════════════════════════════════════════════
/*
Best Case (90% of calls - Tier 1 hit):
    spamFilter:         2ms
    edgeCases:         10ms (no match)
    transferRules:     15ms (no match)
    frontlineIntel:   800ms (LLM processes)
    scenarioMatching:  12ms (Tier 1 hit) ✅
    guardrails:         8ms
    behaviorPolish:     3ms
    contextInjection:   2ms
    ───────────────────────
    TOTAL:            852ms ⚡
    COST:          $0.003 💰

Worst Case (2% of calls - Tier 3 fallback):
    spamFilter:         2ms
    edgeCases:         10ms (no match)
    transferRules:     15ms (no match)
    frontlineIntel:   800ms (LLM processes)
    scenarioMatching: 800ms (Tier 3 fallback) ⚠️
    guardrails:         8ms
    behaviorPolish:     3ms
    contextInjection:   2ms
    ───────────────────────
    TOTAL:           1640ms ⚠️
    COST:          $0.006 💰💰

Short-Circuit (8% of calls - Edge case or wrong number):
    spamFilter:         2ms
    edgeCases:          5ms (MATCH - hang up) ✅
    ───────────────────────
    TOTAL:              7ms 🚀
    COST:           $0.00 💚
    (Saved: 845ms + $0.003 by skipping Frontline-Intel!)

Monthly Cost Estimate (1000 calls):
    90% × $0.003 = $2.70 (Frontline-Intel + Tier 1)
    2% × $0.006  = $0.12 (Frontline-Intel + Tier 3)
    8% × $0.00   = $0.00 (Edge cases blocked early)
    ─────────────────────
    TOTAL:        ~$2.82/month

For enterprise clients paying $50-500/month: NEGLIGIBLE! ✅
*/

module.exports = defaultCallFlowConfig;

