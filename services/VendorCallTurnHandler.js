/**
 * VendorCallTurnHandler
 * ---------------------------------------------------------------------------
 * Deterministic, contract-safe handler for vendor/supplier calls.
 *
 * This runs ONLY when:
 * - callState.callerType === 'vendor'
 * - company.aiAgentSettings.frontDeskBehavior.vendorHandling.enabled === true
 *
 * Goals:
 * - Collect a minimal "vendor message" bundle (summary, optional order/customer)
 * - Create a VendorCall record for the Call Center UI
 * - Avoid polluting the Customer directory
 *
 * IMPORTANT:
 * - Prompts are UI-controlled under frontDeskBehavior.vendorHandling.prompts
 * - Defaults exist ONLY as safety nets ("DEFAULT - OVERRIDE IN UI")
 */

const VendorCall = require('../models/VendorCall');
const logger = require('../utils/logger');

function getVendorPrompts(company) {
  const cfg = company?.aiAgentSettings?.frontDeskBehavior?.vendorHandling || {};
  const prompts = cfg.prompts || {};

  return {
    greeting: prompts.greeting || 'Thanks for calling. How can we help?',
    askSummary: prompts.askSummary || 'What can I help you with today?',
    askOrderNumber: prompts.askOrderNumber || 'Do you have an order number or invoice number I should note?',
    askCustomerName: prompts.askCustomerName || 'Which customer is this regarding?',
    completion: prompts.completion || 'Got it. I’ll make sure the team gets this message right away.',
    transferMessage: prompts.transferMessage || 'Thank you. Let me connect you to our team.'
  };
}

function coerceNonEmptyText(text) {
  if (!text) return null;
  const t = String(text).trim();
  return t.length ? t : null;
}

function extractCandidateOrderNumber(text) {
  const t = coerceNonEmptyText(text);
  if (!t) return null;

  // Heuristic: look for "order/invoice/po/#" patterns, otherwise accept a short alphanumeric token.
  const m1 = t.match(/\b(?:order|invoice|inv|po|p\.o\.|ticket|tracking|ref|reference)\s*(?:#|number|no\.|num)?\s*[:\-]?\s*([A-Z0-9\-]{3,})\b/i);
  if (m1?.[1]) return m1[1].toUpperCase();

  const m2 = t.match(/\b#\s*([A-Z0-9\-]{3,})\b/i);
  if (m2?.[1]) return m2[1].toUpperCase();

  return null;
}

class VendorCallTurnHandler {
  /**
   * @returns {Promise<{ result: object, updatedCallState: object }>}
   */
  static async handleTurn({ companyId, company, callSid, fromNumber, userText, callState }) {
    const vendorHandling = company?.aiAgentSettings?.frontDeskBehavior?.vendorHandling || {};
    const enabled = vendorHandling.enabled === true;
    const mode = vendorHandling.mode || 'collect_message';
    const allowLinkToCustomer = vendorHandling.allowLinkToCustomer === true;

    if (!enabled || mode === 'ignore') {
      return {
        result: null,
        updatedCallState: callState
      };
    }

    const prompts = getVendorPrompts(company);
    const state = { ...(callState || {}) };
    state.vendorFlow = state.vendorFlow || {};
    state.vendorFlow.startedAt = state.vendorFlow.startedAt || new Date().toISOString();
    state.vendorFlow.completed = state.vendorFlow.completed === true;

    // If completed, keep routing away from vendor flow
    if (state.vendorFlow.completed) {
      return {
        result: {
          action: 'continue',
          response: prompts.transferMessage,
          text: prompts.transferMessage
        },
        updatedCallState: state
      };
    }

    // Step machine (deterministic)
    const existingSummary = coerceNonEmptyText(state.vendorFlow.summary);
    const existingOrderNumber = coerceNonEmptyText(state.vendorFlow.orderNumber);
    const existingCustomerName = coerceNonEmptyText(state.vendorFlow.relatedCustomerName);

    // Capture from this turn if we're waiting on a field
    const utterance = coerceNonEmptyText(userText);
    if (utterance) {
      if (!existingSummary) {
        state.vendorFlow.summary = utterance;
      } else if (allowLinkToCustomer && !existingCustomerName) {
        state.vendorFlow.relatedCustomerName = utterance;
      } else if (!existingOrderNumber) {
        state.vendorFlow.orderNumber = extractCandidateOrderNumber(utterance) || utterance;
      }
    }

    const summary = coerceNonEmptyText(state.vendorFlow.summary);
    const relatedCustomerName = coerceNonEmptyText(state.vendorFlow.relatedCustomerName);
    const orderNumber = coerceNonEmptyText(state.vendorFlow.orderNumber);

    // Decide next prompt
    if (!summary) {
      state.vendorFlow.step = 'ASK_SUMMARY';
      return {
        result: {
          action: 'continue',
          response: prompts.askSummary,
          text: prompts.askSummary
        },
        updatedCallState: state
      };
    }

    if (allowLinkToCustomer && !relatedCustomerName) {
      state.vendorFlow.step = 'ASK_CUSTOMER_NAME';
      return {
        result: {
          action: 'continue',
          response: prompts.askCustomerName,
          text: prompts.askCustomerName
        },
        updatedCallState: state
      };
    }

    // Order number is optional; only ask once if missing
    if (!orderNumber && state.vendorFlow.askedOrderNumber !== true) {
      state.vendorFlow.askedOrderNumber = true;
      state.vendorFlow.step = 'ASK_ORDER_NUMBER';
      return {
        result: {
          action: 'continue',
          response: prompts.askOrderNumber,
          text: prompts.askOrderNumber
        },
        updatedCallState: state
      };
    }

    // Persist VendorCall now that we have the minimum required (summary)
    if (!state.vendorFlow.vendorCallId) {
      try {
        const vendorId = state.vendorId || state.vendorContext?.vendorId || null;
        const vendorName = state.vendorContext?.vendorName || null;

        const created = await VendorCall.createCall({
          companyId,
          vendorId: vendorId || undefined,
          vendorName: vendorName || 'Unknown Vendor',
          phone: fromNumber,
          callerName: null,
          summary,
          reason: 'other',
          urgency: 'normal',
          orderNumber: orderNumber || undefined,
          relatedCustomerName: relatedCustomerName || undefined,
          actionRequired: summary,
          actionStatus: 'pending',
          handledBy: 'ai',
          calledAt: new Date()
        });

        state.vendorFlow.vendorCallId = created.callId;
        logger.info('[VENDOR_FLOW] Vendor call recorded', {
          companyId,
          callSid,
          vendorCallId: created.callId
        });
      } catch (err) {
        logger.error('[VENDOR_FLOW] Failed to create VendorCall (non-blocking)', {
          companyId,
          callSid,
          error: err.message
        });
      }
    }

    state.vendorFlow.completed = true;
    state.vendorFlow.step = 'COMPLETED';

    if (mode === 'transfer') {
      return {
        result: {
          action: 'transfer',
          shouldTransfer: true,
          transferReason: 'vendor_message_captured',
          response: prompts.transferMessage,
          text: prompts.transferMessage
        },
        updatedCallState: state
      };
    }

    // Default: collect_message → after capture, transfer (platform disallows hangup)
    return {
      result: {
        action: 'transfer',
        shouldTransfer: true,
        transferReason: 'vendor_message_captured',
        response: prompts.completion,
        text: prompts.completion
      },
      updatedCallState: state
    };
  }
}

module.exports = VendorCallTurnHandler;


