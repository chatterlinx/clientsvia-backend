// Debug logging endpoint to capture and return console output
const express = require('express');
const router = express.Router();

// Store logs in memory (temporary for debugging)
let debugLogs = [];
const MAX_LOGS = 100;

// Override console.log to capture logs
const originalConsoleLog = console.log;
console.log = function(...args) {
    // Call original console.log
    originalConsoleLog.apply(console, args);
    
    // Store in memory for debugging
    const logEntry = {
        timestamp: new Date().toISOString(),
        message: args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : String(arg)).join(' ')
    };
    
    debugLogs.push(logEntry);
    
    // Keep only last MAX_LOGS entries
    if (debugLogs.length > MAX_LOGS) {
        debugLogs = debugLogs.slice(-MAX_LOGS);
    }
};

/**
 * @route   GET /api/debug/logs
 * @desc    Get recent console logs for debugging
 */
router.get('/logs', (req, res) => {
    try {
        const { last = 20 } = req.query;
        const recentLogs = debugLogs.slice(-parseInt(last));
        
        res.json({
            success: true,
            data: {
                logs: recentLogs,
                total: debugLogs.length,
                showing: recentLogs.length
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Failed to retrieve logs',
            error: error.message
        });
    }
});

/**
 * @route   DELETE /api/debug/logs
 * @desc    Clear stored logs
 */
router.delete('/logs', (req, res) => {
    debugLogs = [];
    res.json({
        success: true,
        message: 'Logs cleared'
    });
});

/**
 * @route   GET /api/debug/trigger-qna-load
 * @desc    Trigger Q&A loading with detailed logging
 */
router.get('/trigger-qna-load', async (req, res) => {
    try {
        console.log('🔥 DEBUG TRIGGER: Starting manual Q&A load test...');
        
        // Clear previous logs
        debugLogs = [];
        
        // Trigger the trade categories endpoint internally
        const axios = require('axios');
        const baseUrl = process.env.NODE_ENV === 'production' 
            ? 'https://clientsvia-backend.onrender.com'
            : 'http://localhost:4000';
            
        console.log(`🌐 Making internal request to: ${baseUrl}/api/enterprise-trade-categories?companyId=global`);
        
        const response = await axios.get(`${baseUrl}/api/enterprise-trade-categories?companyId=global`);
        
        console.log('✅ Internal request completed');
        console.log('📊 Response data summary:', {
            categoriesCount: response.data.data?.length || 0,
            firstCategoryQnAs: response.data.data?.[0]?.qnas?.length || 0
        });
        
        res.json({
            success: true,
            message: 'Q&A load triggered successfully',
            data: {
                categoriesFound: response.data.data?.length || 0,
                logsGenerated: debugLogs.length,
                sampleResponse: response.data
            }
        });
        
    } catch (error) {
        console.error('❌ DEBUG TRIGGER ERROR:', error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to trigger Q&A load',
            error: error.message,
            logsGenerated: debugLogs.length
        });
    }
});

module.exports = router;
