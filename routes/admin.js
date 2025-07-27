const express = require('express');
const router = express.Router();
const { authenticateJWT, requireRole } = require('../middleware/auth');
const { getDB } = require('../db');
const Alert = require('../models/Alert');
const SuggestedKnowledgeEntry = require('../models/SuggestedKnowledgeEntry');
const Company = require('../models/Company');

// All admin routes require authentication and admin role
router.use(authenticateJWT, requireRole('admin'));

/**
 * GET /admin/companies - Get all companies (admin only)
 * Returns: Array of companies with basic info, excluding sensitive data
 */
router.get('/companies', async (req, res) => {
    try {
        console.log('[ADMIN API GET /admin/companies] Admin user requesting all companies:', req.user.email);
        
        const db = getDB();
        const companiesCollection = db.collection('companies');
        
        // Get all companies with basic info (exclude sensitive fields)
        const companies = await companiesCollection.find({}, {
            projection: {
                // Include basic company info
                companyName: 1,
                tradeTypes: 1,
                status: 1,
                createdAt: 1,
                updatedAt: 1,
                companyPhone: 1,
                companyAddress: 1,
                ownerName: 1,
                ownerEmail: 1,
                contactName: 1,
                contactEmail: 1
                // Sensitive fields are automatically excluded when using inclusion projection
            }
        }).sort({ createdAt: -1 }).toArray();
        
        console.log(`[ADMIN API GET /admin/companies] Returning ${companies.length} companies to admin`);
        
        res.json({
            success: true,
            data: companies,
            count: companies.length,
            message: 'Admin access granted to company directory'
        });
        
    } catch (err) {
        console.error('[ADMIN API GET /admin/companies] Error:', err);
        res.status(500).json({ 
            message: 'Server error retrieving companies',
            error: err.message 
        });
    }
});

/**
 * GET /admin/alerts - Get all alerts (admin only)
 * Returns: Array of all alerts across all companies with company info
 */
router.get('/alerts', async (req, res) => {
    try {
        console.log('[ADMIN API GET /admin/alerts] Admin user requesting all alerts:', req.user.email);
        
        // Get all alerts with company information
        const alerts = await Alert.find({})
            .populate('companyId', 'companyName tradeTypes') // Include company name and trade types
            .sort({ timestamp: -1 }) // Most recent first
            .limit(1000); // Reasonable limit for admin dashboard
        
        console.log(`[ADMIN API GET /admin/alerts] Returning ${alerts.length} alerts to admin`);
        
        res.json({
            success: true,
            data: alerts,
            count: alerts.length,
            message: 'Admin access granted to all alerts'
        });
        
    } catch (err) {
        console.error('[ADMIN API GET /admin/alerts] Error:', err);
        res.status(500).json({ 
            message: 'Server error retrieving alerts',
            error: err.message 
        });
    }
});

/**
 * GET /admin/suggestions - Get all suggested knowledge entries (admin only) 
 * Returns: Array of all suggestions across all companies with company info
 */
router.get('/suggestions', async (req, res) => {
    try {
        console.log('[ADMIN API GET /admin/suggestions] Admin user requesting all suggestions:', req.user.email);
        
        // Get all suggested knowledge entries with company information
        const suggestions = await SuggestedKnowledgeEntry.find({})
            .populate('companyId', 'companyName tradeTypes') // Include company name and trade types
            .sort({ createdAt: -1 }) // Most recent first
            .limit(1000); // Reasonable limit for admin dashboard
        
        console.log(`[ADMIN API GET /admin/suggestions] Returning ${suggestions.length} suggestions to admin`);
        
        res.json({
            success: true,
            data: suggestions,
            count: suggestions.length,
            message: 'Admin access granted to all suggested knowledge entries'
        });
        
    } catch (err) {
        console.error('[ADMIN API GET /admin/suggestions] Error:', err);
        res.status(500).json({ 
            message: 'Server error retrieving suggestions',
            error: err.message 
        });
    }
});

/**
 * GET /admin/dashboard - Get admin dashboard summary data
 * Returns: Summary statistics for admin overview
 */
router.get('/dashboard', async (req, res) => {
    try {
        console.log('[ADMIN API GET /admin/dashboard] Admin dashboard requested by:', req.user.email);
        
        // Get counts for dashboard overview
        const [companyCount, alertCount, suggestionCount] = await Promise.all([
            Company.countDocuments({}),
            Alert.countDocuments({}),
            SuggestedKnowledgeEntry.countDocuments({})
        ]);
        
        // Get recent activity
        const [recentAlerts, recentSuggestions] = await Promise.all([
            Alert.find({}).populate('companyId', 'companyName').sort({ timestamp: -1 }).limit(5),
            SuggestedKnowledgeEntry.find({}).populate('companyId', 'companyName').sort({ createdAt: -1 }).limit(5)
        ]);
        
        res.json({
            success: true,
            data: {
                summary: {
                    totalCompanies: companyCount,
                    totalAlerts: alertCount,
                    totalSuggestions: suggestionCount,
                    lastUpdated: new Date().toISOString()
                },
                recentActivity: {
                    alerts: recentAlerts,
                    suggestions: recentSuggestions
                }
            },
            message: 'Admin dashboard data retrieved successfully'
        });
        
    } catch (err) {
        console.error('[ADMIN API GET /admin/dashboard] Error:', err);
        res.status(500).json({ 
            message: 'Server error retrieving dashboard data',
            error: err.message 
        });
    }
});

module.exports = router;
