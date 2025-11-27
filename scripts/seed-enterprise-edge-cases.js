#!/usr/bin/env node

/**
 * ============================================================================
 * SEED ENTERPRISE EDGE CASES STARTER PACK
 * ============================================================================
 * 
 * PURPOSE: Load 5 baseline edge cases into every company's CheatSheet
 * 
 * WHAT IT DOES:
 * 1. Loads 5 foundational edge cases (Abuse, Legal, PCI, Pricing, Out-of-Scope)
 * 2. Creates/updates CheatSheetVersion for each company
 * 3. Marks as live version
 * 4. Invalidates Redis cache
 * 5. Provides immediate protection on go-live
 * 
 * SAFE TO RUN MULTIPLE TIMES: Idempotent (updates existing, skips if present)
 * 
 * Usage:
 *   node scripts/seed-enterprise-edge-cases.js [--dry-run] [--companyId=XXX] [--force]
 * 
 * Options:
 *   --dry-run      Show what would be created without saving
 *   --companyId    Seed only specific company (for testing)
 *   --force        Overwrite existing edge cases (default: merge)
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');
const CheatSheetVersion = require('../models/cheatsheet/CheatSheetVersion');
const Company = require('../models/v2Company');
const { CheatSheetRuntimeService } = require('../services/cheatsheet');

// ============================================================================
// ENTERPRISE STARTER PACK - 5 FOUNDATIONAL EDGE CASES
// ============================================================================

const ENTERPRISE_EDGE_CASES = [
  // ──────────────────────────────────────────────────────────────────────
  // 1. ABUSE & PROFANITY DETECTION (HIGHEST PRIORITY)
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'ec-abuse-detection-baseline',
    name: 'Abuse & Profanity Detection (Baseline)',
    description: 'Detects profanity, abuse, and threats. Hangs up politely and logs for review.',
    enabled: true,
    priority: 1,  // Highest priority
    
    match: {
      keywordsAny: [
        // Profanity (common)
        'fuck', 'shit', 'asshole', 'bitch', 'bastard',
        'damn', 'hell', 'crap', 'piss',
        
        // Abusive language
        'idiot', 'stupid', 'moron', 'dumb', 'loser',
        
        // Threats
        'scam', 'fraud', 'rip off', 'steal', 'cheat',
        
        // Legal threats (light - full version in separate case)
        'sue you', 'report you', 'complain'
      ],
      keywordsAll: [],
      regexPatterns: [],
      callerType: [],
      timeWindows: [],
      spamFlagsRequired: [],
      tradeRequired: []
    },
    
    action: {
      type: 'polite_hangup',
      responseTemplateId: '',
      inlineResponse: '',
      transferTarget: '',
      transferMessage: '',
      hangupMessage: 'Thank you for calling. This call is now ending. If you need assistance, please call back during business hours.'
    },
    
    sideEffects: {
      autoBlacklist: false,  // Don't auto-blacklist on first offense (set to true after testing)
      autoTag: ['abuse', 'profanity', 'terminated'],
      notifyContacts: [],  // Add manager contactId after company config
      logSeverity: 'critical'
    },
    
    auditMeta: {
      createdBy: 'Enterprise Seed Script',
      createdAt: new Date(),
      updatedBy: 'Enterprise Seed Script',
      updatedAt: new Date()
    }
  },
  
  // ──────────────────────────────────────────────────────────────────────
  // 2. LEGAL THREATS & ESCALATION
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'ec-legal-threat-baseline',
    name: 'Legal Threat Detection (Baseline)',
    description: 'Detects legal threats or lawsuit language. Escalates to management immediately.',
    enabled: true,
    priority: 2,
    
    match: {
      keywordsAny: [
        'lawyer', 'attorney', 'sue', 'lawsuit', 'legal action',
        'legal matter', 'attorney general', 'better business bureau',
        'BBB', 'court', 'subpoena', 'complaint', 'file complaint'
      ],
      keywordsAll: [],
      regexPatterns: [
        '\\b(legal|law)\\s+(action|matter|issue|problem)\\b',
        '\\b(file|filing)\\s+(complaint|lawsuit|claim)\\b'
      ],
      callerType: [],
      timeWindows: [],
      spamFlagsRequired: [],
      tradeRequired: []
    },
    
    action: {
      type: 'force_transfer',
      responseTemplateId: '',
      inlineResponse: '',
      transferTarget: 'manager',  // Assumes company has manager contact
      transferMessage: 'I understand this is a legal matter. Let me connect you with our manager who can assist you with this. Please hold.',
      hangupMessage: ''
    },
    
    sideEffects: {
      autoBlacklist: false,
      autoTag: ['legal', 'threat', 'escalated'],
      notifyContacts: [],  // Add manager + legal contactIds
      logSeverity: 'critical'
    },
    
    auditMeta: {
      createdBy: 'Enterprise Seed Script',
      createdAt: new Date(),
      updatedBy: 'Enterprise Seed Script',
      updatedAt: new Date()
    }
  },
  
  // ──────────────────────────────────────────────────────────────────────
  // 3. PCI COMPLIANCE & HIGH-RISK DATA
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'ec-pci-compliance-baseline',
    name: 'PCI & Data Security Guard (Baseline)',
    description: 'Prevents collection of credit cards, SSNs, passwords over voice. Redirects to secure payment methods.',
    enabled: true,
    priority: 3,
    
    match: {
      keywordsAny: [
        'credit card', 'card number', 'debit card',
        'social security', 'SSN', 'social security number',
        'password', 'account number', 'routing number',
        'CVV', 'expiration date', 'security code', 'pin number'
      ],
      keywordsAll: [],
      regexPatterns: [
        '\\b\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}[\\s-]?\\d{4}\\b',  // Credit card pattern
        '\\b\\d{3}-\\d{2}-\\d{4}\\b'  // SSN pattern
      ],
      callerType: [],
      timeWindows: [],
      spamFlagsRequired: [],
      tradeRequired: []
    },
    
    action: {
      type: 'override_response',
      responseTemplateId: '',
      inlineResponse: 'For your security, please don\'t share credit card or personal information over the phone. We use secure payment processing. I can send you a secure payment link via text message, or you can pay when our technician arrives. Which would you prefer?',
      transferTarget: '',
      transferMessage: '',
      hangupMessage: ''
    },
    
    sideEffects: {
      autoBlacklist: false,
      autoTag: ['pci_guard', 'security', 'sensitive_data'],
      notifyContacts: [],  // Add security contactId
      logSeverity: 'warning'
    },
    
    auditMeta: {
      createdBy: 'Enterprise Seed Script',
      createdAt: new Date(),
      updatedBy: 'Enterprise Seed Script',
      updatedAt: new Date()
    }
  },
  
  // ──────────────────────────────────────────────────────────────────────
  // 4. OUT-OF-SCOPE SERVICES
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'ec-out-of-scope-baseline',
    name: 'Out-of-Scope Service Detection (Baseline)',
    description: 'Detects requests for services outside company\'s trade. Politely declines and suggests alternatives.',
    enabled: true,
    priority: 5,
    
    match: {
      keywordsAny: [
        // Common out-of-scope requests (customize per company trade)
        'legal advice', 'lawyer', 'attorney',
        'medical advice', 'doctor', 'health',
        'financial advice', 'accountant', 'taxes',
        'immigration', 'visa', 'green card'
      ],
      keywordsAll: [],
      regexPatterns: [],
      callerType: [],
      timeWindows: [],
      spamFlagsRequired: [],
      tradeRequired: []  // Empty = applies to all trades
    },
    
    action: {
      type: 'override_response',
      responseTemplateId: '',
      inlineResponse: 'Thank you for calling! We specialize in home services. For legal, medical, or financial matters, I\'d recommend contacting a licensed professional in that field. If you need help with plumbing, HVAC, electrical, or other home services, we\'re here to help!',
      transferTarget: '',
      transferMessage: '',
      hangupMessage: ''
    },
    
    sideEffects: {
      autoBlacklist: false,
      autoTag: ['out_of_scope', 'polite_decline'],
      notifyContacts: [],
      logSeverity: 'info'
    },
    
    auditMeta: {
      createdBy: 'Enterprise Seed Script',
      createdAt: new Date(),
      updatedBy: 'Enterprise Seed Script',
      updatedAt: new Date()
    }
  },
  
  // ──────────────────────────────────────────────────────────────────────
  // 5. PRICING NEGOTIATION & DISCOUNT POLICY
  // ──────────────────────────────────────────────────────────────────────
  {
    id: 'ec-pricing-negotiation-baseline',
    name: 'Pricing & Discount Policy Enforcement (Baseline)',
    description: 'Detects pricing negotiation attempts. Provides policy response to prevent unauthorized discounts.',
    enabled: true,
    priority: 8,
    
    match: {
      keywordsAny: [
        'discount', 'cheaper', 'lower price', 'best price',
        'coupon', 'promo code', 'deal', 'special offer',
        'price match', 'competitor', 'quoted less', 'too expensive'
      ],
      keywordsAll: [],
      regexPatterns: [],
      callerType: [],
      timeWindows: [],
      spamFlagsRequired: [],
      tradeRequired: []
    },
    
    action: {
      type: 'override_response',
      responseTemplateId: '',
      inlineResponse: 'Great question! We offer transparent, competitive pricing for all our services. Our rates include professional workmanship, warranty coverage, and top-quality materials. For specific pricing, I can schedule a free consultation where our technician will provide an exact quote. We also offer financing options and seasonal promotions. Would you like to schedule that appointment?',
      transferTarget: '',
      transferMessage: '',
      hangupMessage: ''
    },
    
    sideEffects: {
      autoBlacklist: false,
      autoTag: ['pricing_inquiry', 'discount_request'],
      notifyContacts: [],
      logSeverity: 'info'
    },
    
    auditMeta: {
      createdBy: 'Enterprise Seed Script',
      createdAt: new Date(),
      updatedBy: 'Enterprise Seed Script',
      updatedAt: new Date()
    }
  }
];

// ============================================================================
// SEED LOGIC
// ============================================================================

async function seedEnterpriseEdgeCases(options = {}) {
  const { dryRun = false, companyId = null, force = false } = options;
  
  logger.info('[ENTERPRISE SEED] Starting edge cases seed...', { dryRun, companyId, force });
  
  try {
    // Connect to DB if not already connected
    if (mongoose.connection.readyState !== 1) {
      await require('../db');
      logger.info('[ENTERPRISE SEED] Connected to MongoDB');
    }
    
    // Build query
    const query = {};
    if (companyId) {
      query._id = companyId;
    }
    
    // Find all companies
    const companies = await Company.find(query).select('_id name aiAgentSettings').lean();
    logger.info('[ENTERPRISE SEED] Found companies', { 
      total: companies.length,
      companyId: companyId || 'ALL'
    });
    
    // Stats
    let seeded = 0;
    let skipped = 0;
    let errors = 0;
    
    // Process each company
    for (const company of companies) {
      try {
        // Get or create live CheatSheetVersion
        let liveVersion = await CheatSheetVersion.findOne({
          companyId: company._id,
          status: 'live'
        });
        
        if (!liveVersion) {
          // No live version exists - create one
          if (dryRun) {
            logger.info('[ENTERPRISE SEED] [DRY RUN] Would create live version', {
              companyId: company._id,
              companyName: company.name
            });
            seeded++;
            continue;
          }
          
          liveVersion = new CheatSheetVersion({
            companyId: company._id,
            versionId: `enterprise-baseline-${Date.now()}`,
            name: 'Enterprise Baseline Protection',
            status: 'live',
            config: {
              schemaVersion: 1,
              edgeCases: ENTERPRISE_EDGE_CASES,
              triage: {},
              frontlineIntel: {},
              transferRules: {},
              behavior: {},
              guardrails: {},
              bookingRules: [],
              companyContacts: [],
              links: [],
              calculators: []
            },
            metadata: {
              createdBy: 'Enterprise Seed Script',
              description: 'Baseline edge cases for immediate protection'
            },
            activatedAt: new Date()
          });
          
          await liveVersion.save();
          
          // Update company pointer
          await Company.findByIdAndUpdate(company._id, {
            'aiAgentSettings.cheatSheetMeta.liveVersionId': liveVersion.versionId
          });
          
          logger.info('[ENTERPRISE SEED] ✅ Created live version with baseline edge cases', {
            companyId: company._id,
            companyName: company.name,
            versionId: liveVersion.versionId,
            edgeCaseCount: ENTERPRISE_EDGE_CASES.length
          });
          
        } else {
          // Live version exists - merge or replace edge cases
          const existingEdgeCases = liveVersion.config.edgeCases || [];
          
          if (force) {
            // FORCE MODE: Replace all edge cases
            if (dryRun) {
              logger.info('[ENTERPRISE SEED] [DRY RUN] Would replace edge cases', {
                companyId: company._id,
                oldCount: existingEdgeCases.length,
                newCount: ENTERPRISE_EDGE_CASES.length
              });
              seeded++;
              continue;
            }
            
            liveVersion.config.edgeCases = ENTERPRISE_EDGE_CASES;
            
          } else {
            // MERGE MODE: Add new, update existing by ID
            const merged = [...existingEdgeCases];
            
            for (const newCase of ENTERPRISE_EDGE_CASES) {
              const existingIndex = merged.findIndex(ec => ec.id === newCase.id);
              
              if (existingIndex >= 0) {
                // Update existing
                merged[existingIndex] = newCase;
              } else {
                // Add new
                merged.push(newCase);
              }
            }
            
            if (dryRun) {
              logger.info('[ENTERPRISE SEED] [DRY RUN] Would merge edge cases', {
                companyId: company._id,
                oldCount: existingEdgeCases.length,
                newCount: merged.length,
                added: merged.length - existingEdgeCases.length
              });
              seeded++;
              continue;
            }
            
            liveVersion.config.edgeCases = merged;
          }
          
          liveVersion.metadata.updatedBy = 'Enterprise Seed Script';
          liveVersion.metadata.updatedAt = new Date();
          
          await liveVersion.save();
          
          logger.info('[ENTERPRISE SEED] ✅ Updated live version with baseline edge cases', {
            companyId: company._id,
            companyName: company.name,
            versionId: liveVersion.versionId,
            edgeCaseCount: liveVersion.config.edgeCases.length,
            mode: force ? 'FORCE' : 'MERGE'
          });
        }
        
        // Invalidate Redis cache
        if (!dryRun) {
          await CheatSheetRuntimeService.invalidateCache(company._id.toString());
          logger.info('[ENTERPRISE SEED] Invalidated cache', {
            companyId: company._id
          });
        }
        
        seeded++;
        
      } catch (companyError) {
        errors++;
        logger.error('[ENTERPRISE SEED] ❌ Company seed failed', {
          companyId: company._id,
          companyName: company.name,
          error: companyError.message,
          stack: companyError.stack
        });
      }
    }
    
    // Final stats
    logger.info('[ENTERPRISE SEED] ✅ Complete', {
      total: companies.length,
      seeded,
      skipped,
      errors,
      dryRun,
      edgeCasesPerCompany: ENTERPRISE_EDGE_CASES.length
    });
    
    return { success: true, seeded, skipped, errors };
    
  } catch (error) {
    logger.error('[ENTERPRISE SEED] ❌ Fatal error', {
      error: error.message,
      stack: error.stack
    });
    return { success: false, error: error.message };
  }
}

// ============================================================================
// CLI EXECUTION
// ============================================================================

if (require.main === module) {
  // Parse CLI args
  const args = process.argv.slice(2);
  const options = {
    dryRun: args.includes('--dry-run'),
    companyId: args.find(a => a.startsWith('--companyId='))?.split('=')[1] || null,
    force: args.includes('--force')
  };
  
  logger.info('[ENTERPRISE SEED] CLI execution started', options);
  
  seedEnterpriseEdgeCases(options)
    .then(result => {
      if (result.success) {
        logger.info('[ENTERPRISE SEED] ✅ SUCCESS', result);
        process.exit(0);
      } else {
        logger.error('[ENTERPRISE SEED] ❌ FAILED', result);
        process.exit(1);
      }
    })
    .catch(error => {
      logger.error('[ENTERPRISE SEED] ❌ UNEXPECTED ERROR', {
        error: error.message,
        stack: error.stack
      });
      process.exit(1);
    });
}

// ============================================================================
// EXPORTS (For programmatic use)
// ============================================================================

module.exports = {
  seedEnterpriseEdgeCases,
  ENTERPRISE_EDGE_CASES
};

