const express = require('express');
const router = express.Router();
const Company = require('../models/Company');

/**
 * ========================================= 
 * COMPANY KNOWLEDGE BASE API ROUTES
 * Priority #1 knowledge source for company-specific rules
 * ========================================= 
 */

// Get all company Q&As for a specific company
router.get('/companies/:companyId/company-kb', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { intent, search } = req.query;

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        let companyKB = company.companyKB || [];

        // Filter by intent if specified
        if (intent) {
            companyKB = companyKB.filter(qa => qa.intent && qa.intent.startsWith(intent));
        }

        // Search functionality
        if (search) {
            const searchLower = search.toLowerCase();
            companyKB = companyKB.filter(qa => 
                qa.question?.toLowerCase().includes(searchLower) ||
                qa.answer?.toLowerCase().includes(searchLower) ||
                qa.keywords?.some(keyword => keyword.toLowerCase().includes(searchLower))
            );
        }

        res.json({
            success: true,
            data: companyKB,
            meta: {
                total: companyKB.length,
                companyId,
                filters: { intent, search }
            }
        });

    } catch (error) {
        console.error('Error fetching company KB:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

// Add new company Q&A entry
router.post('/companies/:companyId/company-kb', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { question, answer, keywords, intent, negativeKeywords, validThrough, reviewEveryDays } = req.body;

        if (!question || !answer) {
            return res.status(400).json({ success: false, message: 'Question and answer are required' });
        }

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        if (!company.companyKB) {
            company.companyKB = [];
        }

        // Generate unique ID for the Q&A entry
        const newQnA = {
            id: `company-qa-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            source: 'company_kb',
            companyID: companyId,
            question: question.trim(),
            answer: answer.trim(),
            keywords: keywords || [],
            negativeKeywords: negativeKeywords || [],
            intent: intent || 'general',
            validThrough: validThrough || null,
            reviewEveryDays: reviewEveryDays || 180,
            version: 1,
            isActive: true,
            metadata: {
                createdAt: new Date(),
                createdBy: 'admin', // TODO: Get from auth
                updatedAt: new Date(),
                lastReviewed: new Date(),
                usage: {
                    timesMatched: 0,
                    lastMatched: null,
                    averageConfidence: 0
                }
            }
        };

        company.companyKB.push(newQnA);
        
        // Update company KB metadata
        if (!company.companyKBSettings) {
            company.companyKBSettings = {
                version: '1.0.0',
                lastUpdated: new Date(),
                autoPublish: 'manual',
                reviewFrequency: 180,
                confidenceThreshold: 0.80
            };
        } else {
            company.companyKBSettings.lastUpdated = new Date();
            // Increment version
            const versionParts = company.companyKBSettings.version.split('.');
            versionParts[2] = (parseInt(versionParts[2]) + 1).toString();
            company.companyKBSettings.version = versionParts.join('.');
        }

        await company.save();

        res.json({
            success: true,
            data: newQnA,
            message: 'Company Q&A added successfully'
        });

    } catch (error) {
        console.error('Error adding company Q&A:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

// Update company Q&A entry
router.put('/companies/:companyId/company-kb/:qaId', async (req, res) => {
    try {
        const { companyId, qaId } = req.params;
        const { question, answer, keywords, intent, negativeKeywords, validThrough, reviewEveryDays, isActive } = req.body;

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        const qaIndex = company.companyKB?.findIndex(qa => qa.id === qaId);
        if (qaIndex === -1) {
            return res.status(404).json({ success: false, message: 'Q&A entry not found' });
        }

        // Update the Q&A entry
        const updatedQnA = {
            ...company.companyKB[qaIndex],
            question: question?.trim() || company.companyKB[qaIndex].question,
            answer: answer?.trim() || company.companyKB[qaIndex].answer,
            keywords: keywords || company.companyKB[qaIndex].keywords,
            negativeKeywords: negativeKeywords || company.companyKB[qaIndex].negativeKeywords,
            intent: intent || company.companyKB[qaIndex].intent,
            validThrough: validThrough || company.companyKB[qaIndex].validThrough,
            reviewEveryDays: reviewEveryDays || company.companyKB[qaIndex].reviewEveryDays,
            isActive: isActive !== undefined ? isActive : company.companyKB[qaIndex].isActive,
            metadata: {
                ...company.companyKB[qaIndex].metadata,
                updatedAt: new Date(),
                lastReviewed: new Date()
            }
        };

        company.companyKB[qaIndex] = updatedQnA;

        // Update company KB metadata
        if (company.companyKBSettings) {
            company.companyKBSettings.lastUpdated = new Date();
        }

        await company.save();

        res.json({
            success: true,
            data: updatedQnA,
            message: 'Company Q&A updated successfully'
        });

    } catch (error) {
        console.error('Error updating company Q&A:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

// Delete company Q&A entry
router.delete('/companies/:companyId/company-kb/:qaId', async (req, res) => {
    try {
        const { companyId, qaId } = req.params;

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        const qaIndex = company.companyKB?.findIndex(qa => qa.id === qaId);
        if (qaIndex === -1) {
            return res.status(404).json({ success: false, message: 'Q&A entry not found' });
        }

        company.companyKB.splice(qaIndex, 1);

        // Update company KB metadata
        if (company.companyKBSettings) {
            company.companyKBSettings.lastUpdated = new Date();
        }

        await company.save();

        res.json({
            success: true,
            message: 'Company Q&A deleted successfully'
        });

    } catch (error) {
        console.error('Error deleting company Q&A:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

// Get/Update company KB settings
router.get('/companies/:companyId/company-kb-settings', async (req, res) => {
    try {
        const { companyId } = req.params;

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        const settings = company.companyKBSettings || {
            version: '1.0.0',
            lastUpdated: new Date(),
            autoPublish: 'manual',
            reviewFrequency: 180,
            confidenceThreshold: 0.80,
            entryCount: 0
        };

        // Update entry count
        settings.entryCount = company.companyKB?.length || 0;

        res.json({
            success: true,
            data: settings
        });

    } catch (error) {
        console.error('Error fetching company KB settings:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

router.post('/companies/:companyId/company-kb-settings', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { autoPublish, reviewFrequency, confidenceThreshold } = req.body;

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        company.companyKBSettings = {
            ...company.companyKBSettings,
            autoPublish: autoPublish || 'manual',
            reviewFrequency: reviewFrequency || 180,
            confidenceThreshold: confidenceThreshold || 0.80,
            lastUpdated: new Date()
        };

        await company.save();

        res.json({
            success: true,
            data: company.companyKBSettings,
            message: 'Company KB settings updated successfully'
        });

    } catch (error) {
        console.error('Error updating company KB settings:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

// Publish company KB (make it live)
router.post('/companies/:companyId/company-kb/publish', async (req, res) => {
    try {
        const { companyId } = req.params;

        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        // Update publish timestamp
        if (!company.companyKBSettings) {
            company.companyKBSettings = {};
        }

        company.companyKBSettings.lastPublished = new Date();
        company.companyKBSettings.publishedEntryCount = company.companyKB?.length || 0;

        await company.save();

        res.json({
            success: true,
            message: `Published ${company.companyKB?.length || 0} company Q&A entries`,
            data: {
                publishedAt: company.companyKBSettings.lastPublished,
                entryCount: company.companyKBSettings.publishedEntryCount
            }
        });

    } catch (error) {
        console.error('Error publishing company KB:', error);
        res.status(500).json({ success: false, message: 'Server error', error: error.message });
    }
});

module.exports = router;
