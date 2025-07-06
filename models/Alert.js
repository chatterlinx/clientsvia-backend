const mongoose = require('mongoose');

const alertSchema = new mongoose.Schema({
    companyId: {
        type: String,
        required: [true, 'Company ID is required.'],
        trim: true,
    },
    error: {
        type: String,
        required: [true, 'Error message is required.'],
        trim: true,
    },
    timestamp: {
        type: Date,
        required: [true, 'Timestamp is required.'],
        default: Date.now,
    },
    test: {
        type: Boolean,
        default: false
    }
});

alertSchema.index({ timestamp: -1 });

const Alert = mongoose.model('Alert', alertSchema);

module.exports = Alert;
