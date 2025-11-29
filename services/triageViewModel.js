// services/triageViewModel.js
// V22 Triage Card View Model Transformer
// Official UI contract for TriageCard → Screenshot-style card UI

/**
 * Transform a TriageCard Mongoose doc into the official UI view model.
 * This is the SINGLE SOURCE OF TRUTH for the card UI shape.
 * 
 * @param {Object} card - TriageCard document (lean)
 * @param {Object} [options] - Display options
 * @param {string} [options.templateName] - Template name to display
 * @param {string} [options.templateVersion] - Template version (e.g., "V22")
 * @param {string} [options.defaultCategoryLabel] - Fallback category
 * @returns {Object} Card view model for frontend
 */
function buildCardViewModel(card, options = {}) {
  if (!card) return null;

  const quick = card.quickRuleConfig || {};
  const match = card.matchHistory || {};
  const threeTier = card.threeTierPackageDraft || {};
  const frontline = card.frontlinePlaybook || {};
  const actionPlaybooks = card.actionPlaybooks || {};

  const keywordsMustHave = quick.keywordsMustHave || [];
  const triggerLabel = keywordsMustHave[0] || card.triageLabel?.toLowerCase().replace(/_/g, ' ') || '';

  // Preview: try frontline opener → explain/push line → scenario objective → description
  let previewReply = '';
  if (frontline.openingLines && frontline.openingLines.length) {
    previewReply = frontline.openingLines[0];
  } else if (
    actionPlaybooks.explainAndPush &&
    actionPlaybooks.explainAndPush.explanationLines &&
    actionPlaybooks.explainAndPush.explanationLines.length
  ) {
    previewReply = actionPlaybooks.explainAndPush.explanationLines[0];
  } else if (threeTier.scenarioObjective) {
    previewReply = threeTier.scenarioObjective;
  } else if (card.description) {
    previewReply = card.description;
  }

  // Success % (null if no data yet)
  let successPercent = null;
  if (typeof match.successRate === 'number' && match.totalMatches > 0) {
    successPercent = Math.round(match.successRate * 100);
  }

  // Category label for folder grouping (Cooling / No Cool, etc.)
  const categoryLabel =
    threeTier.categoryName ||
    card.triageCategory ||
    options.defaultCategoryLabel ||
    'Uncategorized';

  return {
    // Identity
    id: String(card._id),
    triageLabel: card.triageLabel,

    // Toggle & Display
    active: !!card.isActive,
    title: card.displayName || card.triageLabel,
    triggerLabel,
    previewReply: previewReply.substring(0, 250) + (previewReply.length > 250 ? '...' : ''),

    // Template info
    templateName: options.templateName || `${card.trade || 'Service'} Trade Knowledge Template`,
    templateVersion: options.templateVersion || 'V22',
    trade: card.trade || null,

    // Stats (right side pills)
    uses: match.totalMatches || 0,
    successPercent, // null → frontend shows "--%"

    // Classification
    categoryLabel,
    serviceType: card.serviceType || null,
    intent: card.intent || null,
    priority: card.priority || 0,

    // Action
    action: quick.action || 'DIRECT_TO_3TIER',
    explanation: quick.explanation || null,

    // Keywords for display
    keywordsMustHave,
    keywordsExclude: quick.keywordsExclude || [],
    qnaCardRef: quick.qnaCardRef || null,

    // Linked 3-Tier scenario
    linkedScenarioId: card.linkedScenario?.scenarioId || null,
    linkedScenarioName: card.linkedScenario?.scenarioName || null,

    // Timestamps
    createdAt: card.createdAt,
    updatedAt: card.updatedAt
  };
}

/**
 * Batch transform cards to view models
 */
function buildCardViewModels(cards, options = {}) {
  if (!Array.isArray(cards)) return [];
  return cards.map(card => buildCardViewModel(card, options)).filter(Boolean);
}

/**
 * Build summary stats from view models
 */
function buildSummary(viewModels) {
  return {
    totalCards: viewModels.length,
    activeCards: viewModels.filter(c => c.active).length,
    disabledCards: viewModels.filter(c => !c.active).length,
    totalTriggers: viewModels.reduce(
      (sum, c) => sum + (c.keywordsMustHave?.length || 0),
      0
    ),
    trades: [...new Set(viewModels.map(c => c.trade).filter(Boolean))],
    categories: [...new Set(viewModels.map(c => c.categoryLabel).filter(Boolean))]
  };
}

/**
 * Group view models by category for folder display
 */
function groupByCategory(viewModels) {
  const groupedMap = new Map();

  for (const vm of viewModels) {
    const key = vm.categoryLabel || 'Uncategorized';
    if (!groupedMap.has(key)) {
      groupedMap.set(key, {
        name: key,
        count: 0,
        activeCount: 0,
        cards: []
      });
    }
    const bucket = groupedMap.get(key);
    bucket.cards.push(vm);
    bucket.count += 1;
    if (vm.active) bucket.activeCount += 1;
  }

  // Sort categories alphabetically
  return Array.from(groupedMap.values()).sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  buildCardViewModel,
  buildCardViewModels,
  buildSummary,
  groupByCategory
};

