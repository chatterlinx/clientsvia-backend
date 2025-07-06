const cron = require('node-cron');
const Suggestion = require('../models/Suggestion');
const { extractNewQA } = require('./conversationParser');

cron.schedule('0 2 * * *', async () => {
  try {
    const newPairs = await extractNewQA();
    for (const { line, tag, evidence } of newPairs) {
      await Suggestion.create({ line, tag, evidence });
    }
    console.log('[DailyLearning] Added', newPairs.length, 'new suggestions');
  } catch (err) {
    console.error('[DailyLearning] Error updating knowledge base:', err);
  }
});
