/**
 * ============================================================================
 * FULL INVENTORY API
 * ============================================================================
 * Purpose: Prove nothing is lost - show counts and sample IDs for ALL data
 * Usage: Before any migration/deletion, run this to inventory what exists
 * 
 * RULE: "Hide from nav" is allowed. "Delete code/data" is NOT allowed
 *       until this inventory shows migration is complete.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Models
const Company = require('../../models/v2Company');
const DynamicFlow = require('../../models/DynamicFlow');
const ConversationSession = require('../../models/ConversationSession');
const BlackBoxRecording = require('../../models/BlackBoxRecording');

/**
 * GET /api/company/:companyId/full-inventory
 * 
 * Returns counts + sample IDs for every relevant config/data set
 * This proves nothing is lost and identifies orphaned work
 */
router.get('/', async (req, res) => {
  const startTime = Date.now();
  const { companyId } = req.params;
  
  try {
    console.log(`📦 [INVENTORY] Generating full inventory for company: ${companyId}`);
    
    // ═══════════════════════════════════════════════════════════════════
    // 1. FETCH COMPANY DATA
    // ═══════════════════════════════════════════════════════════════════
    const company = await Company.findById(companyId).lean();
    
    if (!company) {
      return res.status(404).json({
        success: false,
        error: 'Company not found'
      });
    }
    
    const cheatSheet = company.cheatSheet || {};
    const aiAgentSettings = company.aiAgentSettings || {};
    const frontDeskBehavior = aiAgentSettings.frontDeskBehavior || {};
    
    // ═══════════════════════════════════════════════════════════════════
    // 2. BUILD INVENTORY
    // ═══════════════════════════════════════════════════════════════════
    
    const inventory = {
      companyId: company._id,
      companyName: company.name || company.companyName,
      timestamp: new Date().toISOString(),
      generatedIn: null,
      
      collections: {
        // ─────────────────────────────────────────────────────────────
        // FRONT DESK CONFIG
        // ─────────────────────────────────────────────────────────────
        frontDesk: {
          exists: !!aiAgentSettings.frontDeskBehavior,
          sections: {
            greetingRules: (frontDeskBehavior.greetingRules?.rules || []).length,
            bookingSlots: (frontDeskBehavior.bookingSlots || []).length,
            confirmationPhrases: (frontDeskBehavior.confirmationPhrases || []).length,
            forbiddenPhrases: (frontDeskBehavior.forbiddenPhrases || []).length,
            escalationTriggers: (frontDeskBehavior.escalationTriggers || []).length,
            emotionResponses: Object.keys(frontDeskBehavior.emotionDetection?.responses || {}).length,
            conversationStyle: frontDeskBehavior.conversationStyle || 'not set'
          }
        },
        
        // ─────────────────────────────────────────────────────────────
        // VARIABLES (LEGACY) - Now Placeholders
        // ─────────────────────────────────────────────────────────────
        variablesLegacy: {
          count: Object.keys(company.variables || {}).length,
          keys: Object.keys(company.variables || {}).slice(0, 20),
          sample: company.variables ? Object.entries(company.variables).slice(0, 5).map(([k, v]) => ({ key: k, value: v })) : []
        },
        
        // ─────────────────────────────────────────────────────────────
        // AI AGENT LOGIC (if exists)
        // ─────────────────────────────────────────────────────────────
        aiAgentLogic: {
          exists: !!company.aiAgentLogic,
          thresholds: company.aiAgentLogic?.thresholds || {},
          knowledgeSourcePriorities: company.aiAgentLogic?.knowledgeSourcePriorities || [],
          memorySettings: company.aiAgentLogic?.memorySettings || {}
        },
        
        // ─────────────────────────────────────────────────────────────
        // CHEAT SHEET - TRIAGE
        // ─────────────────────────────────────────────────────────────
        triage: {
          count: (cheatSheet.triageCards || []).length,
          ids: (cheatSheet.triageCards || []).slice(0, 10).map(t => t._id || t.id || 'no-id'),
          sample: (cheatSheet.triageCards || []).slice(0, 3).map(t => ({
            id: t._id || t.id,
            name: t.name || t.category,
            triggers: (t.triggers || t.triggerPhrases || []).length
          }))
        },
        
        // ─────────────────────────────────────────────────────────────
        // CHEAT SHEET - MISSION CONTROL / COMPANY INSTRUCTIONS
        // ─────────────────────────────────────────────────────────────
        missionControl: {
          exists: !!cheatSheet.companyInstructions,
          instructionsLength: (cheatSheet.companyInstructions || '').length,
          hasCustomInstructions: (cheatSheet.companyInstructions || '').length > 0
        },
        
        // ─────────────────────────────────────────────────────────────
        // CHEAT SHEET - BEHAVIOR RULES
        // ─────────────────────────────────────────────────────────────
        behaviorRules: {
          count: (cheatSheet.behaviorRules || []).length,
          sample: (cheatSheet.behaviorRules || []).slice(0, 5).map(b => ({
            id: b._id || b.id,
            name: b.name || b.label,
            enabled: b.enabled
          }))
        },
        
        // ─────────────────────────────────────────────────────────────
        // CHEAT SHEET - GUARDRAILS
        // ─────────────────────────────────────────────────────────────
        guardrails: {
          count: (cheatSheet.guardrails || []).length,
          sample: (cheatSheet.guardrails || []).slice(0, 5).map(g => ({
            id: g._id || g.id,
            name: g.name || g.label,
            enabled: g.enabled
          }))
        },
        
        // ─────────────────────────────────────────────────────────────
        // CHEAT SHEET - EDGE CASES (Call Protection)
        // ─────────────────────────────────────────────────────────────
        edgeCases: {
          count: (cheatSheet.edgeCases || []).length,
          ids: (cheatSheet.edgeCases || []).slice(0, 10).map(e => e._id || e.id || 'no-id'),
          sample: (cheatSheet.edgeCases || []).slice(0, 3).map(e => ({
            id: e._id || e.id,
            name: e.name,
            patterns: (e.triggerPatterns || []).length,
            enabled: e.enabled
          }))
        },
        
        // ─────────────────────────────────────────────────────────────
        // CHEAT SHEET - TRANSFER RULES
        // ─────────────────────────────────────────────────────────────
        transferRules: {
          count: (cheatSheet.transferRules || []).length,
          ids: (cheatSheet.transferRules || []).slice(0, 10).map(t => t._id || t.id || 'no-id'),
          sample: (cheatSheet.transferRules || []).slice(0, 3).map(t => ({
            id: t._id || t.id,
            label: t.contactNameOrQueue || t.label,
            intentTag: t.intentTag,
            enabled: t.enabled
          }))
        },
        
        // ─────────────────────────────────────────────────────────────
        // CHEAT SHEET - COMPANY CONTACTS
        // ─────────────────────────────────────────────────────────────
        companyContacts: {
          count: (cheatSheet.companyContacts || []).length,
          ids: (cheatSheet.companyContacts || []).slice(0, 10).map(c => c._id || c.id || 'no-id'),
          sample: (cheatSheet.companyContacts || []).slice(0, 3).map(c => ({
            id: c._id || c.id,
            name: c.name,
            role: c.role,
            isPrimary: c.isPrimary
          }))
        },
        
        // ─────────────────────────────────────────────────────────────
        // CHEAT SHEET - LINKS
        // ─────────────────────────────────────────────────────────────
        links: {
          count: (cheatSheet.links || []).length,
          ids: (cheatSheet.links || []).slice(0, 10).map(l => l._id || l.id || 'no-id'),
          sample: (cheatSheet.links || []).slice(0, 3).map(l => ({
            id: l._id || l.id,
            label: l.label,
            category: l.category,
            url: l.url
          }))
        },
        
        // ─────────────────────────────────────────────────────────────
        // CHEAT SHEET - BOOKING RULES
        // ─────────────────────────────────────────────────────────────
        bookingRules: {
          exists: !!cheatSheet.bookingRules,
          fields: Object.keys(cheatSheet.bookingRules || {})
        },
        
        // ─────────────────────────────────────────────────────────────
        // CHEAT SHEET - CALCULATORS
        // ─────────────────────────────────────────────────────────────
        calculators: {
          count: (cheatSheet.calculators || []).length,
          sample: (cheatSheet.calculators || []).slice(0, 3).map(c => ({
            id: c._id || c.id,
            name: c.name || c.label
          }))
        },
        
        // ─────────────────────────────────────────────────────────────
        // CHEAT SHEET - VERSIONS
        // ─────────────────────────────────────────────────────────────
        versions: {
          count: (cheatSheet.versions || []).length,
          liveVersionId: cheatSheet.liveVersionId || null,
          draftVersionId: cheatSheet.draftVersionId || null,
          sample: (cheatSheet.versions || []).slice(0, 5).map(v => ({
            id: v._id || v.id,
            label: v.label,
            isLive: v.isLive,
            createdAt: v.createdAt
          }))
        }
      },
      
      // ═══════════════════════════════════════════════════════════════
      // SEPARATE COLLECTIONS (not in company document)
      // ═══════════════════════════════════════════════════════════════
      separateCollections: {}
    };
    
    // ─────────────────────────────────────────────────────────────────
    // DYNAMIC FLOWS (separate collection)
    // ─────────────────────────────────────────────────────────────────
    const dynamicFlows = await DynamicFlow.find({
      companyId: companyId,
      isTemplate: { $ne: true }
    }).lean();
    
    inventory.separateCollections.dynamicFlows = {
      count: dynamicFlows.length,
      ids: dynamicFlows.slice(0, 10).map(f => f._id),
      sample: dynamicFlows.slice(0, 5).map(f => ({
        id: f._id,
        flowKey: f.flowKey,
        name: f.name,
        priority: f.priority,
        isActive: f.isActive,
        actionsCount: (f.actions || []).length
      }))
    };
    
    // ─────────────────────────────────────────────────────────────────
    // DYNAMIC FLOW TEMPLATES (global)
    // ─────────────────────────────────────────────────────────────────
    const templates = await DynamicFlow.find({
      isTemplate: true
    }).lean();
    
    inventory.separateCollections.dynamicFlowTemplates = {
      count: templates.length,
      byTradeCategory: {},
      sample: templates.slice(0, 5).map(t => ({
        id: t._id,
        flowKey: t.flowKey,
        name: t.name,
        tradeCategoryId: t.tradeCategoryId
      }))
    };
    
    // Group by trade category
    templates.forEach(t => {
      const catId = t.tradeCategoryId?.toString() || 'no-category';
      if (!inventory.separateCollections.dynamicFlowTemplates.byTradeCategory[catId]) {
        inventory.separateCollections.dynamicFlowTemplates.byTradeCategory[catId] = 0;
      }
      inventory.separateCollections.dynamicFlowTemplates.byTradeCategory[catId]++;
    });
    
    // ─────────────────────────────────────────────────────────────────
    // BLACK BOX RECORDINGS
    // ─────────────────────────────────────────────────────────────────
    const blackBoxCount = await BlackBoxRecording.countDocuments({ companyId: companyId });
    const recentBlackBox = await BlackBoxRecording.find({ companyId: companyId })
      .sort({ createdAt: -1 })
      .limit(5)
      .select('_id sessionId channel createdAt turnCount')
      .lean();
    
    inventory.separateCollections.blackBoxRecordings = {
      count: blackBoxCount,
      recentSample: recentBlackBox.map(b => ({
        id: b._id,
        sessionId: b.sessionId,
        channel: b.channel,
        createdAt: b.createdAt,
        turnCount: b.turnCount
      }))
    };
    
    // ─────────────────────────────────────────────────────────────────
    // CONVERSATION SESSIONS
    // ─────────────────────────────────────────────────────────────────
    const sessionCount = await ConversationSession.countDocuments({ companyId: companyId });
    const activeSessions = await ConversationSession.find({
      companyId: companyId,
      status: { $in: ['active', 'in_progress'] }
    }).limit(5).lean();
    
    inventory.separateCollections.conversationSessions = {
      totalCount: sessionCount,
      activeCount: activeSessions.length,
      activeSample: activeSessions.map(s => ({
        id: s._id,
        channel: s.channel,
        mode: s.mode,
        createdAt: s.createdAt
      }))
    };
    
    // ─────────────────────────────────────────────────────────────────
    // TRADE CATEGORIES (global)
    // ─────────────────────────────────────────────────────────────────
    try {
      const TradeCategory = mongoose.model('v2TradeCategory');
      const categories = await TradeCategory.find({}).select('_id name companyId').lean();
      
      inventory.separateCollections.tradeCategories = {
        globalCount: categories.filter(c => c.companyId === 'global').length,
        companySpecificCount: categories.filter(c => c.companyId === companyId).length,
        sample: categories.slice(0, 10).map(c => ({
          id: c._id,
          name: c.name,
          isGlobal: c.companyId === 'global'
        }))
      };
    } catch (e) {
      inventory.separateCollections.tradeCategories = { error: 'Model not found or query failed' };
    }
    
    // ═══════════════════════════════════════════════════════════════
    // SUMMARY STATS
    // ═══════════════════════════════════════════════════════════════
    inventory.summary = {
      totalConfigSections: Object.keys(inventory.collections).length,
      totalSeparateCollections: Object.keys(inventory.separateCollections).length,
      hasLegacyVariables: inventory.collections.variablesLegacy.count > 0,
      hasTriageCards: inventory.collections.triage.count > 0,
      hasBehaviorRules: inventory.collections.behaviorRules.count > 0,
      hasGuardrails: inventory.collections.guardrails.count > 0,
      hasDynamicFlows: inventory.separateCollections.dynamicFlows.count > 0,
      hasBlackBoxRecordings: inventory.separateCollections.blackBoxRecordings.count > 0,
      migrationStatus: 'INVENTORY_COMPLETE'
    };
    
    // Set generation time
    inventory.generatedIn = `${Date.now() - startTime}ms`;
    
    console.log(`✅ [INVENTORY] Generated in ${inventory.generatedIn}`);
    console.log(`   - Config sections: ${inventory.summary.totalConfigSections}`);
    console.log(`   - Separate collections: ${inventory.summary.totalSeparateCollections}`);
    console.log(`   - Legacy variables: ${inventory.collections.variablesLegacy.count}`);
    console.log(`   - Dynamic flows: ${inventory.separateCollections.dynamicFlows.count}`);
    
    res.json({
      success: true,
      inventory
    });
    
  } catch (error) {
    console.error('❌ [INVENTORY] Error generating inventory:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;

