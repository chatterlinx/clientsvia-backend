/**
 * ============================================================================
 * PRICING POLICY RESPONDER
 * ============================================================================
 *
 * Converts pricing placeholders into policy-driven responses based on
 * per-company placeholder modes.
 *
 * - LITERAL: show the value
 * - OFFER_TRANSFER: ask for transfer consent (no auto-transfer)
 * - OFFER_CALLBACK: offer callback / message taking
 */

const CompanyPlaceholders = require('../../models/CompanyPlaceholders');
const { getCatalog, resolveAlias } = require('../../config/placeholders/PlaceholderCatalog');
const TransferConsentGate = require('./TransferConsentGate');
const logger = require('../../utils/logger');

function extractPlaceholderKeys(text) {
    if (!text || typeof text !== 'string') return [];
    const keys = [];
    const regex = /\{?\{([a-zA-Z][a-zA-Z0-9_]*)\}?\}?|\[([a-zA-Z][a-zA-Z0-9_]*)\]/g;
    let match;
    while ((match = regex.exec(text)) !== null) {
        const key = match[1] || match[2];
        if (key) keys.push(key);
    }
    return keys;
}

function canonicalizeKey(rawKey) {
    if (!rawKey) return '';
    const cleaned = String(rawKey).trim().replace(/^\{+/, '').replace(/\}+$/, '');
    const canonical = resolveAlias(cleaned) || cleaned;
    return canonical;
}

function normalizeMode(mode, defaultMode = 'LITERAL', supportsModes = []) {
    const normalized = (mode || defaultMode || 'LITERAL').toString().trim().toUpperCase();
    if (supportsModes.length > 0 && !supportsModes.includes(normalized)) {
        return (defaultMode || 'LITERAL').toString().trim().toUpperCase();
    }
    return normalized;
}

function getPolicyScripts({ catalogEntry, placeholderEntry }) {
    const base = (catalogEntry && typeof catalogEntry === 'object' && catalogEntry.policyScripts)
        ? catalogEntry.policyScripts
        : {};

    const scripts = {
        transferOffer: base.transferOffer || '',
        transferConfirm: base.transferConfirm || '',
        transferDecline: base.transferDecline || '',
        callbackOffer: base.callbackOffer || ''
    };

    const metaPrompt = placeholderEntry?.meta?.callbackPrompt;
    if (metaPrompt && String(metaPrompt).trim()) {
        scripts.callbackOffer = String(metaPrompt).trim();
    }

    return scripts;
}

function buildValueMap(placeholderEntries, company) {
    const map = new Map();
    const entries = placeholderEntries instanceof Map
        ? placeholderEntries
        : new Map(Object.entries(placeholderEntries || {}));

    for (const [key, entry] of entries.entries()) {
        if (!entry) continue;
        const value = entry.value;
        if (value !== undefined && value !== null) {
            map.set(String(key).toLowerCase(), String(value));
        }
    }

    // Inject minimal system fallbacks for legacy safety
    if (company) {
        if (!map.has('companyname') && company.companyName) {
            map.set('companyname', company.companyName);
        }
        const phone = company.companyPhone || company.phoneNumber;
        if (!map.has('companyphone') && phone) {
            map.set('companyphone', phone);
        }
        if (!map.has('companyid') && company._id) {
            map.set('companyid', company._id.toString());
        }
        if (!map.has('tradekey') && company.tradeKey) {
            map.set('tradekey', company.tradeKey);
        }
    }

    return map;
}

function buildPricingResponse({ mode, scripts }) {
    if (mode === 'OFFER_TRANSFER') {
        return scripts.transferOffer || null;
    }

    if (mode === 'OFFER_CALLBACK') {
        return scripts.callbackOffer || null;
    }

    return null;
}

async function applyPricingPolicy({
    replyText,
    companyId,
    company,
    session,
    userText,
    tradeKey
}) {
    if (!replyText || !companyId) {
        return { applied: false, replyText: replyText || '' };
    }

    const catalog = getCatalog(tradeKey);
    const pendingOffer = session?.pricingPolicy?.transferOfferPending === true;
    if (pendingOffer) {
        const consent = TransferConsentGate.canTransferCall({
            userText,
            transferOfferPending: true
        });

        const offerToken = canonicalizeKey(session?.pricingPolicy?.offerToken || '');
        const catalogEntry = offerToken ? catalog.byKey[offerToken] : null;
        const scripts = getPolicyScripts({ catalogEntry, placeholderEntry: null });

        if (consent.decision === 'accept') {
            if (!scripts.transferConfirm) {
                logger.warn('[PRICING POLICY] Missing transfer confirm script', {
                    companyId,
                    tokenKey: offerToken || null
                });
                return { applied: false, replyText };
            }
            return {
                applied: true,
                replyText: scripts.transferConfirm,
                requiresTransfer: true,
                policyEvent: 'transfer_accept',
                pricingState: {
                    transferOfferPending: false,
                    lastDecision: 'accept',
                    lastDecisionAt: new Date()
                }
            };
        }

        if (consent.decision === 'decline') {
            if (!scripts.transferDecline) {
                logger.warn('[PRICING POLICY] Missing transfer decline script', {
                    companyId,
                    tokenKey: offerToken || null
                });
                return { applied: false, replyText };
            }
            return {
                applied: true,
                replyText: scripts.transferDecline,
                requiresTransfer: false,
                policyEvent: 'transfer_decline',
                pricingState: {
                    transferOfferPending: false,
                    lastDecision: 'decline',
                    lastDecisionAt: new Date()
                }
            };
        }
    }

    const hasPlaceholders = /[{\[]/.test(replyText);
    if (!hasPlaceholders) {
        return { applied: false, replyText };
    }

    let placeholderEntries;
    try {
        placeholderEntries = await CompanyPlaceholders.getPlaceholdersDetailedMap(companyId);
    } catch (error) {
        logger.warn('[PRICING POLICY] Failed to load placeholders (non-fatal)', {
            companyId,
            error: error.message
        });
        placeholderEntries = new Map();
    }

    const tokens = extractPlaceholderKeys(replyText);

    let policyTarget = null;
    for (const rawKey of tokens) {
        const canonicalKey = canonicalizeKey(rawKey);
        if (!canonicalKey) continue;

        const catalogEntry = catalog.byKey[canonicalKey];
        if (!catalogEntry || catalogEntry.category !== 'pricing' || catalogEntry.scope !== 'company') {
            continue;
        }

        const entry = placeholderEntries.get(canonicalKey.toLowerCase());
        const supportsModes = Array.isArray(catalogEntry.supportsModes) ? catalogEntry.supportsModes : [];
        const defaultMode = (catalogEntry.defaultMode || 'LITERAL').toString().trim().toUpperCase();
        const effectiveMode = normalizeMode(entry?.mode, defaultMode, supportsModes);

        if (effectiveMode && effectiveMode !== 'LITERAL') {
            policyTarget = {
                tokenKey: canonicalKey,
                entry: entry || null,
                mode: effectiveMode,
                catalogEntry
            };
            break;
        }
    }

    if (policyTarget) {
        const scripts = getPolicyScripts({
            catalogEntry: policyTarget.catalogEntry,
            placeholderEntry: policyTarget.entry
        });
        const policyReply = buildPricingResponse({
            mode: policyTarget.mode,
            scripts
        });

        if (policyReply) {
            const now = new Date();
            return {
                applied: true,
                replyText: policyReply,
                policyMode: policyTarget.mode,
                tokenKey: policyTarget.tokenKey,
                requiresTransfer: policyTarget.mode === 'OFFER_TRANSFER',
                policyEvent: 'pricing_offer',
                pricingState: {
                    transferOfferPending: policyTarget.mode === 'OFFER_TRANSFER',
                    offerToken: policyTarget.tokenKey,
                    offerMode: policyTarget.mode,
                    offeredAt: now
                }
            };
        }
    }

    // Default: render placeholders with company values
    const valueMap = buildValueMap(placeholderEntries, company);
    const rendered = CompanyPlaceholders.render(replyText, valueMap);
    return {
        applied: false,
        replyText: rendered
    };
}

module.exports = {
    applyPricingPolicy,
    buildPricingResponse,
    extractPlaceholderKeys
};
