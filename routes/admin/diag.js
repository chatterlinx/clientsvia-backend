const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Diagnostics: expose current environment and DB/Redis fingerprints (redacted)
router.get('/whoami', (req, res) => {
    const c = mongoose.connection;
    const mongoUri = process.env.MONGODB_URI || process.env.MONGO_URI || '';
    const redisUrl = process.env.REDIS_URL || process.env.UPSTASH_REDIS_REST_URL || '';

    res.json({
        nodeEnv: process.env.NODE_ENV || 'development',
        appVersion: process.env.APP_VERSION || 'dev',
        mongo: {
            host: c?.host,
            db: c?.name,
            readyState: c?.readyState, // 1 = connected
            uriHash: mongoUri
                .replace(/\/\/([^@]+)@/, '//***@')
                .replace(/([?&]authSource)=[^&]+/g, '$1=***')
        },
        redis: {
            urlHash: redisUrl.replace(/\/\/([^@]+)@/, '//***@')
        },
        time: new Date().toISOString()
    });
});

module.exports = router;


