const mongoose = require('mongoose');

const TradeCategorySchema = new mongoose.Schema({
  name: { type: String, required: true },
  serviceTypes: {
    qaPairs: [
      {
        question: { type: String, required: true },
        answer: { type: String, required: true }
      }
    ]
  }
});

module.exports = mongoose.model('TradeCategory', TradeCategorySchema);
