/**
 * 🚨 EMERGENCY DATABASE REPAIR API
 * 
 * ADMIN ONLY - Fixes corrupt voice settings data
 * 
 * Usage: 
 * - GET /api/admin/emergency/inspect-company/:companyId - Inspect specific company
 * - POST /api/admin/emergency/repair-voice-settings - Fix all corrupt voice settings
 */

const express = require('express');
const logger = require('../../utils/logger.js');

const router = express.Router();
const mongoose = require('mongoose');
const { authenticateJWT, requireRole } = require('../../middleware/auth');

// 🔒 SECURITY: Require admin authentication - CRITICAL repair operations
router.use(authenticateJWT);
router.use(requireRole('admin'));

/**
 * @route   GET /api/admin/emergency/inspect-company/:companyId
 * @desc    Inspect a specific company's voice settings structure
 * @access  ADMIN ONLY
 */
router.get('/inspect-company/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.info('\n🔍 INSPECTING COMPANY:', companyId);
        
        // Get direct MongoDB access
        const db = mongoose.connection.db;
        const companiesCollection = db.collection('v2companies');
        
        // Find the company
        const company = await companiesCollection.findOne({ _id: new mongoose.Types.ObjectId(companyId) });
        
        if (!company) {
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }
        
        // Analyze the voiceSettings structure
        const analysis = {
            companyId: company._id.toString(),
            companyName: company.companyName,
            hasAiAgentLogic: Boolean(company.aiAgentLogic),
            aiAgentLogicType: typeof company.aiAgentLogic,
            hasVoiceSettings: Boolean(company.aiAgentLogic?.voiceSettings),
            voiceSettingsType: typeof company.aiAgentLogic?.voiceSettings,
            voiceSettingsIsArray: Array.isArray(company.aiAgentLogic?.voiceSettings),
            voiceSettingsIsNull: company.aiAgentLogic?.voiceSettings === null,
            voiceSettingsValue: company.aiAgentLogic?.voiceSettings,
            rawDocument: {
                aiAgentLogic: company.aiAgentLogic
            }
        };
        
        logger.info('📊 Analysis:', JSON.stringify(analysis, null, 2));
        
        res.json({
            success: true,
            analysis
        });
        
    } catch (error) {
        logger.error('❌ INSPECTION ERROR:', error);
        res.status(500).json({
            success: false,
            message: 'Inspection failed',
            error: error.message
        });
    }
});

/**
 * @route   POST /api/admin/emergency/migrate-voice-schema
 * @desc    Migrate legacy string voice settings to object structure
 * @access  ADMIN ONLY
 */
router.post('/migrate-voice-schema', async (req, res) => {
    try {
        logger.info('\n🔧 VOICE SETTINGS SCHEMA MIGRATION (API)');
        logger.info('═'.repeat(80));
        
        const db = mongoose.connection.db;
        const companies = db.collection('v2companies');
        
        const results = {
            totalScanned: 0,
            fixed: {
                aiVoiceProvider: 0,
                aiVoice: 0,
                aiAgentLogicVoiceSettings: 0
            }
        };
        
        // A) Fix ai.voice.provider (if it's a string)
        logger.info('🔍 Checking ai.voice.provider...');
        const fixA = await companies.updateMany(
            { "ai.voice.provider": { $type: "string" } },
            [
                {
                    $set: {
                        "ai.voice.provider": {
                            name: "$ai.voice.provider",
                            enabled: true,
                            model: "eleven_multilingual_v2",
                            voiceId: "",
                            stability: 0.5,
                            similarity: 0.75,
                            style: 0,
                            useSpeakerBoost: true
                        }
                    }
                }
            ]
        );
        results.fixed.aiVoiceProvider = fixA.modifiedCount;
        logger.info(`   Fixed ${fixA.modifiedCount} documents`);
        
        // B) Fix ai.voice (if it's a string)
        logger.info('🔍 Checking ai.voice...');
        const fixB = await companies.updateMany(
            { "ai.voice": { $type: "string" } },
            [
                {
                    $set: {
                        "ai.voice": {
                            provider: {
                                name: "$ai.voice",
                                enabled: true,
                                model: "eleven_multilingual_v2",
                                voiceId: "",
                                stability: 0.5,
                                similarity: 0.75,
                                style: 0,
                                useSpeakerBoost: true
                            },
                            testMessage: "Hello! Thanks for calling. How can I help you today?"
                        }
                    }
                }
            ]
        );
        results.fixed.aiVoice = fixB.modifiedCount;
        logger.info(`   Fixed ${fixB.modifiedCount} documents`);
        
        // C) Fix aiAgentLogic.voiceSettings (if it's a string)
        logger.info('🔍 Checking aiAgentLogic.voiceSettings...');
        const fixC = await companies.updateMany(
            { "aiAgentLogic.voiceSettings": { $type: "string" } },
            [
                {
                    $set: {
                        "aiAgentLogic.voiceSettings": {
                            apiSource: "clientsvia",
                            apiKey: null,
                            voiceId: null,
                            stability: 0.5,
                            similarityBoost: 0.7,
                            styleExaggeration: 0.0,
                            speakerBoost: true,
                            aiModel: "eleven_turbo_v2_5",
                            outputFormat: "mp3_44100_128",
                            streamingLatency: 0,
                            enabled: true,
                            lastUpdated: new Date(),
                            version: "2.0"
                        }
                    }
                }
            ]
        );
        results.fixed.aiAgentLogicVoiceSettings = fixC.modifiedCount;
        logger.info(`   Fixed ${fixC.modifiedCount} documents`);
        
        // Summary
        results.totalScanned = await companies.countDocuments({});
        const totalFixed = Object.values(results.fixed).reduce((a, b) => a + b, 0);
        
        logger.info('\n📊 Migration complete');
        logger.info(`   Total companies: ${results.totalScanned}`);
        logger.info(`   Total fixed: ${totalFixed}`);
        
        res.json({
            success: true,
            message: `Migration complete. Fixed ${totalFixed} documents.`,
            results
        });
        
    } catch (error) {
        logger.error('❌ MIGRATION ERROR:', error);
        res.status(500).json({
            success: false,
            message: 'Migration failed',
            error: error.message
        });
    }
});

/**
 * @route   POST /api/admin/emergency/repair-voice-settings
 * @desc    Emergency repair for corrupt voiceSettings data (DEPRECATED - use migrate-voice-schema)
 * @access  ADMIN ONLY
 */
router.post('/repair-voice-settings', async (req, res) => {
    try {
        logger.info('\n🚨 EMERGENCY REPAIR: Voice Settings Corruption Fix');
        logger.info('═'.repeat(80));
        
        // Get direct MongoDB access (bypass Mongoose validation)
        const db = mongoose.connection.db;
        const companiesCollection = db.collection('v2companies');
        
        logger.info('🔍 Scanning for ALL companies...');
        
        // Get ALL companies to inspect their voiceSettings
        const allCompanies = await companiesCollection.find({}).toArray();
        
        logger.info(`📊 Found ${allCompanies.length} total companies`);
        
        const corruptCompanies = [];
        const report = {
            totalCompanies: allCompanies.length,
            scannedTypes: {},
            corruptCompanies: [],
            repairResults: []
        };
        
        // Scan each company
        for (const company of allCompanies) {
            const vsType = typeof company.aiAgentLogic?.voiceSettings;
            const isValid = company.aiAgentLogic?.voiceSettings 
                && vsType === 'object' 
                && !Array.isArray(company.aiAgentLogic.voiceSettings);
            
            // Track types
            if (!report.scannedTypes[vsType]) {
                report.scannedTypes[vsType] = 0;
            }
            report.scannedTypes[vsType]++;
            
            if (!isValid) {
                corruptCompanies.push(company);
                report.corruptCompanies.push({
                    _id: company._id.toString(),
                    companyName: company.companyName,
                    voiceSettingsType: vsType,
                    voiceSettingsValue: company.aiAgentLogic?.voiceSettings
                });
            }
        }
        
        logger.info(`\n🔍 Found ${corruptCompanies.length} companies with corrupt voiceSettings`);
        
        if (corruptCompanies.length === 0) {
            logger.info('✅ No corruption found!');
            return res.json({
                success: true,
                message: 'No corruption found. All voiceSettings are valid.',
                report
            });
        }
        
        // Repair each corrupt company
        logger.debug('\n🔧 Starting repairs...');
        
        for (const company of corruptCompanies) {
            try {
                logger.debug(`🔧 Repairing: ${company.companyName} (${company._id})`);
                
                const result = await companiesCollection.updateOne(
                    { _id: company._id },
                    {
                        $set: {
                            'aiAgentLogic.voiceSettings': {
                                // V2 Default Settings
                                apiSource: 'clientsvia',
                                apiKey: null,
                                voiceId: null,
                                
                                // Voice Quality Controls
                                stability: 0.5,
                                similarityBoost: 0.7,
                                styleExaggeration: 0.0,
                                
                                // Performance & Output
                                speakerBoost: true,
                                aiModel: 'eleven_turbo_v2_5',
                                outputFormat: 'mp3_44100_128',
                                streamingLatency: 0,
                                
                                // V2 Features
                                enabled: true,
                                lastUpdated: new Date(),
                                version: '2.0'
                            }
                        }
                    }
                );
                
                report.repairResults.push({
                    companyId: company._id.toString(),
                    companyName: company.companyName,
                    success: result.modifiedCount === 1,
                    modifiedCount: result.modifiedCount
                });
                
                logger.info(`   ✅ Repaired`);
                
            } catch (error) {
                logger.error(`   ❌ Failed:`, error.message);
                report.repairResults.push({
                    companyId: company._id.toString(),
                    companyName: company.companyName,
                    success: false,
                    error: error.message
                });
            }
        }
        
        // Verify repairs
        logger.info('\n🔍 Verifying repairs...');
        const stillCorrupt = [];
        
        for (const company of corruptCompanies) {
            const updated = await companiesCollection.findOne({ _id: company._id });
            const vsType = typeof updated.aiAgentLogic?.voiceSettings;
            const isValid = updated.aiAgentLogic?.voiceSettings 
                && vsType === 'object' 
                && !Array.isArray(updated.aiAgentLogic.voiceSettings);
            
            if (!isValid) {
                stillCorrupt.push({
                    _id: company._id.toString(),
                    companyName: company.companyName,
                    voiceSettingsType: vsType
                });
            }
        }
        
        report.stillCorrupt = stillCorrupt;
        report.successfulRepairs = report.repairResults.filter(r => r.success).length;
        report.failedRepairs = report.repairResults.filter(r => !r.success).length;
        
        logger.info(`\n${  '═'.repeat(80)}`);
        logger.info('📊 REPAIR COMPLETE');
        logger.info(`   Total scanned: ${report.totalCompanies}`);
        logger.info(`   Found corrupt: ${report.corruptCompanies.length}`);
        logger.info(`   Successfully repaired: ${report.successfulRepairs}`);
        logger.info(`   Failed: ${report.failedRepairs}`);
        logger.info(`   Still corrupt: ${stillCorrupt.length}`);
        logger.info('═'.repeat(80));
        
        res.json({
            success: true,
            message: `Repaired ${report.successfulRepairs} of ${report.corruptCompanies.length} corrupt companies`,
            report
        });
        
    } catch (error) {
        logger.error('❌ EMERGENCY REPAIR ERROR:', error);
        res.status(500).json({
            success: false,
            message: 'Emergency repair failed',
            error: error.message
        });
    }
});

module.exports = router;

