/**
 * ============================================================================
 * SYSTEM SNAPSHOT API
 * ============================================================================
 * Purpose: Generate complete JSON snapshot of everything the AI agent can see
 * Usage: Flow Tree tab "Copy JSON" feature
 * 
 * This is the SINGLE SOURCE OF TRUTH for the entire system configuration.
 * If something is not in this snapshot, it does not exist for the agent.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Models
const Company = require('../../models/Company');
const DynamicFlow = require('../../models/DynamicFlow');
const ConversationSession = require('../../models/ConversationSession');

/**
 * GET /api/company/:companyId/system-snapshot
 * 
 * Generate complete system snapshot for a company
 * Used by Flow Tree tab to show everything wired to the agent
 */
router.get('/', async (req, res) => {
  const startTime = Date.now();
  const { companyId } = req.params;
  
  try {
    console.log(`📸 [SYSTEM SNAPSHOT] Generating snapshot for company: ${companyId}`);
    
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
    
    // ═══════════════════════════════════════════════════════════════════
    // 2. FETCH DYNAMIC FLOWS
    // ═══════════════════════════════════════════════════════════════════
    const dynamicFlows = await DynamicFlow.find({
      companyId: companyId,
      isTemplate: { $ne: true }
    }).lean();
    
    // ═══════════════════════════════════════════════════════════════════
    // 3. CHECK FOR ACTIVE SESSION (Live Call)
    // ═══════════════════════════════════════════════════════════════════
    const activeSession = await ConversationSession.findOne({
      companyId: companyId,
      status: { $in: ['active', 'in_progress'] }
    }).sort({ createdAt: -1 }).lean();
    
    // ═══════════════════════════════════════════════════════════════════
    // 4. BUILD SNAPSHOT
    // ═══════════════════════════════════════════════════════════════════
    
    const cheatSheet = company.cheatSheet || {};
    const aiAgentSettings = company.aiAgentSettings || {};
    const frontDeskBehavior = aiAgentSettings.frontDeskBehavior || {};
    
    const snapshot = {
      // ─────────────────────────────────────────────────────────────────
      // META
      // ─────────────────────────────────────────────────────────────────
      companyId: company._id,
      companyName: company.name || company.companyName,
      sessionId: activeSession ? activeSession._id : null,
      timestamp: new Date().toISOString(),
      mode: activeSession ? 'LIVE' : 'IDLE',
      generatedIn: null, // Will be set at end
      
      // ─────────────────────────────────────────────────────────────────
      // FRONT DESK (Static Configuration)
      // ─────────────────────────────────────────────────────────────────
      frontDesk: {
        greeting: {
          enabled: frontDeskBehavior.greetingRules?.enabled ?? true,
          rules: (frontDeskBehavior.greetingRules?.rules || []).map(rule => ({
            trigger: rule.trigger,
            response: rule.response,
            priority: rule.priority || 0
          })),
          defaultGreeting: frontDeskBehavior.defaultGreeting || company.greeting || null
        },
        tone: {
          conversationStyle: frontDeskBehavior.conversationStyle || 'balanced',
          personalityTraits: frontDeskBehavior.personalityTraits || []
        },
        confirmationRules: {
          requireExplicitConsent: frontDeskBehavior.requireExplicitConsent ?? true,
          confirmationPhrases: frontDeskBehavior.confirmationPhrases || []
        },
        bookingPreferences: {
          bookingSlots: (frontDeskBehavior.bookingSlots || []).map(slot => ({
            key: slot.key,
            label: slot.label,
            required: slot.required,
            question: slot.question,
            type: slot.type
          })),
          bookingEnabled: frontDeskBehavior.bookingEnabled ?? true
        },
        escalationRules: {
          enabled: frontDeskBehavior.escalationEnabled ?? true,
          triggers: frontDeskBehavior.escalationTriggers || [],
          defaultTarget: frontDeskBehavior.defaultEscalationTarget || null
        },
        policies: {
          blockPricing: frontDeskBehavior.blockPricing ?? true,
          blockUrls: frontDeskBehavior.blockUrls ?? false,
          phoneMasking: frontDeskBehavior.phoneMasking ?? true,
          forbiddenPhrases: frontDeskBehavior.forbiddenPhrases || []
        },
        emotions: {
          enabled: frontDeskBehavior.emotionDetection?.enabled ?? false,
          responses: frontDeskBehavior.emotionDetection?.responses || {}
        },
        frustration: {
          enabled: frontDeskBehavior.frustrationHandling?.enabled ?? false,
          threshold: frontDeskBehavior.frustrationHandling?.threshold || 3,
          escalateOnMax: frontDeskBehavior.frustrationHandling?.escalateOnMax ?? true
        }
      },
      
      // ─────────────────────────────────────────────────────────────────
      // CALL PROTECTION (Pre-Answer Filters)
      // ─────────────────────────────────────────────────────────────────
      callProtection: {
        enabled: true,
        rules: (cheatSheet.edgeCases || []).map(ec => ({
          id: ec._id || ec.id || null,
          name: ec.name,
          type: ec.type || 'custom',
          priority: ec.priority || 10,
          enabled: ec.enabled !== false,
          patterns: ec.triggerPatterns || [],
          responseText: ec.responseText || null,
          action: ec.action || 'respond'
        }))
      },
      
      // ─────────────────────────────────────────────────────────────────
      // DYNAMIC FLOWS (The ONLY Routing Brain)
      // ─────────────────────────────────────────────────────────────────
      dynamicFlows: dynamicFlows.map(flow => ({
        flowId: flow._id,
        flowKey: flow.flowKey,
        name: flow.name,
        priority: flow.priority || 0,
        enabled: flow.isActive !== false,
        allowConcurrent: flow.settings?.allowConcurrent ?? true,
        triggers: {
          type: flow.trigger?.type || 'PHRASE_MATCH',
          phrases: flow.trigger?.phrases || [],
          minConfidence: flow.trigger?.minConfidence || 0.7
        },
        conditions: flow.conditions || {},
        actions: (flow.actions || []).map(action => ({
          type: action.type,
          order: action.order || 0,
          config: action.config || {}
        })),
        settings: {
          allowConcurrent: flow.settings?.allowConcurrent ?? true,
          maxTriggersPerCall: flow.settings?.maxTriggersPerCall || 1
        },
        tradeCategoryId: flow.tradeCategoryId || null
      })).sort((a, b) => (b.priority || 0) - (a.priority || 0)),
      
      // ─────────────────────────────────────────────────────────────────
      // TRANSFER TARGETS
      // ─────────────────────────────────────────────────────────────────
      transferTargets: (cheatSheet.transferRules || []).map(rule => ({
        id: rule._id || rule.id || null,
        label: rule.contactNameOrQueue || rule.label || 'Unnamed',
        intentTag: rule.intentTag,
        phone: rule.phoneNumber || null,
        priority: rule.priority || 10,
        enabled: rule.enabled !== false,
        afterHoursOnly: rule.afterHoursOnly || false,
        preTransferScript: rule.preTransferScript || null,
        availability: rule.availability || 'business_hours'
      })),
      
      // ─────────────────────────────────────────────────────────────────
      // COMPANY CONTACTS
      // ─────────────────────────────────────────────────────────────────
      companyContacts: (cheatSheet.companyContacts || []).map(contact => ({
        id: contact._id || contact.id || null,
        name: contact.name,
        role: contact.role || 'Other',
        phone: contact.phone || contact.phoneNumber || null,
        email: contact.email || null,
        availability: contact.availability || '24/7',
        primary: contact.isPrimary || false,
        notes: contact.notes || null
      })),
      
      // ─────────────────────────────────────────────────────────────────
      // LINKS
      // ─────────────────────────────────────────────────────────────────
      links: (cheatSheet.links || []).map(link => ({
        id: link._id || link.id || null,
        label: link.label,
        category: link.category || 'other',
        url: link.url,
        shortDescription: link.shortDescription || null,
        usageNotes: link.usageNotes || link.shortDescription || null
      })),
      
      // ─────────────────────────────────────────────────────────────────
      // CALL CONTEXT (Live Only)
      // ─────────────────────────────────────────────────────────────────
      callContext: activeSession ? {
        sessionId: activeSession._id,
        channel: activeSession.channel || 'voice',
        startedAt: activeSession.createdAt,
        mode: activeSession.mode || 'DISCOVERY',
        activeFlow: activeSession.dynamicFlows?.currentFlowKey || null,
        matchedTriggers: activeSession.dynamicFlows?.trace?.slice(-1)[0]?.fired?.map(f => f.key) || [],
        confidence: activeSession.dynamicFlows?.trace?.slice(-1)[0]?.fired?.[0]?.matchScore || null,
        entitiesCollected: {
          name: activeSession.collectedData?.name || null,
          phone: activeSession.collectedData?.phone || activeSession.callerPhone || null,
          address: activeSession.collectedData?.address || null,
          serviceType: activeSession.collectedData?.serviceType || null,
          urgency: activeSession.collectedData?.urgency || null
        },
        callLedger: {
          facts: activeSession.callLedger?.facts || {},
          entries: (activeSession.callLedger?.entries || []).slice(-10),
          activeScenarios: activeSession.callLedger?.activeScenarios || []
        },
        locks: {
          bookingLocked: activeSession.locks?.bookingLocked || false,
          flowAcked: activeSession.locks?.flowAcked || {}
        },
        actionsTaken: (activeSession.dynamicFlows?.trace || [])
          .flatMap(t => t.actionsExecuted || [])
          .map(a => a.type)
          .slice(-20)
      } : null,
      
      // ─────────────────────────────────────────────────────────────────
      // VERSIONING
      // ─────────────────────────────────────────────────────────────────
      versioning: {
        activeVersionId: cheatSheet.activeVersionId || null,
        draftVersionId: cheatSheet.draftVersionId || null,
        isLive: cheatSheet.isLive ?? true,
        lastPublishedAt: cheatSheet.lastPublishedAt || null,
        totalVersions: cheatSheet.versions?.length || 0
      },
      
      // ─────────────────────────────────────────────────────────────────
      // TRADE CATEGORY (if assigned)
      // ─────────────────────────────────────────────────────────────────
      tradeCategory: {
        id: company.tradeCategoryId || null,
        name: company.tradeCategoryName || company.industryType || null
      }
    };
    
    // Set generation time
    snapshot.generatedIn = `${Date.now() - startTime}ms`;
    
    console.log(`✅ [SYSTEM SNAPSHOT] Generated in ${snapshot.generatedIn}`);
    console.log(`   - Mode: ${snapshot.mode}`);
    console.log(`   - Dynamic Flows: ${snapshot.dynamicFlows.length}`);
    console.log(`   - Transfer Targets: ${snapshot.transferTargets.length}`);
    console.log(`   - Company Contacts: ${snapshot.companyContacts.length}`);
    console.log(`   - Links: ${snapshot.links.length}`);
    console.log(`   - Call Protection Rules: ${snapshot.callProtection.rules.length}`);
    
    res.json({
      success: true,
      snapshot
    });
    
  } catch (error) {
    console.error('❌ [SYSTEM SNAPSHOT] Error generating snapshot:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;

