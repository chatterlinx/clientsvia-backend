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
const router = express.Router();
const mongoose = require('mongoose');

/**
 * @route   GET /api/admin/emergency/inspect-company/:companyId
 * @desc    Inspect a specific company's voice settings structure
 * @access  ADMIN ONLY
 */
router.get('/inspect-company/:companyId', async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log('\n🔍 INSPECTING COMPANY:', companyId);
        
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
            hasAiAgentLogic: !!company.aiAgentLogic,
            aiAgentLogicType: typeof company.aiAgentLogic,
            hasVoiceSettings: !!company.aiAgentLogic?.voiceSettings,
            voiceSettingsType: typeof company.aiAgentLogic?.voiceSettings,
            voiceSettingsIsArray: Array.isArray(company.aiAgentLogic?.voiceSettings),
            voiceSettingsIsNull: company.aiAgentLogic?.voiceSettings === null,
            voiceSettingsValue: company.aiAgentLogic?.voiceSettings,
            rawDocument: {
                aiAgentLogic: company.aiAgentLogic
            }
        };
        
        console.log('📊 Analysis:', JSON.stringify(analysis, null, 2));
        
        res.json({
            success: true,
            analysis
        });
        
    } catch (error) {
        console.error('❌ INSPECTION ERROR:', error);
        res.status(500).json({
            success: false,
            message: 'Inspection failed',
            error: error.message
        });
    }
});

/**
 * @route   POST /api/admin/emergency/repair-voice-settings
 * @desc    Emergency repair for corrupt voiceSettings data
 * @access  ADMIN ONLY
 */
router.post('/repair-voice-settings', async (req, res) => {
    try {
        console.log('\n🚨 EMERGENCY REPAIR: Voice Settings Corruption Fix');
        console.log('═'.repeat(80));
        
        // Get direct MongoDB access (bypass Mongoose validation)
        const db = mongoose.connection.db;
        const companiesCollection = db.collection('v2companies');
        
        console.log('🔍 Scanning for ALL companies...');
        
        // Get ALL companies to inspect their voiceSettings
        const allCompanies = await companiesCollection.find({}).toArray();
        
        console.log(`📊 Found ${allCompanies.length} total companies`);
        
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
        
        console.log(`\n🔍 Found ${corruptCompanies.length} companies with corrupt voiceSettings`);
        
        if (corruptCompanies.length === 0) {
            console.log('✅ No corruption found!');
            return res.json({
                success: true,
                message: 'No corruption found. All voiceSettings are valid.',
                report
            });
        }
        
        // Repair each corrupt company
        console.log('\n🔧 Starting repairs...');
        
        for (const company of corruptCompanies) {
            try {
                console.log(`🔧 Repairing: ${company.companyName} (${company._id})`);
                
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
                
                console.log(`   ✅ Repaired`);
                
            } catch (error) {
                console.error(`   ❌ Failed:`, error.message);
                report.repairResults.push({
                    companyId: company._id.toString(),
                    companyName: company.companyName,
                    success: false,
                    error: error.message
                });
            }
        }
        
        // Verify repairs
        console.log('\n🔍 Verifying repairs...');
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
        
        console.log('\n' + '═'.repeat(80));
        console.log('📊 REPAIR COMPLETE');
        console.log(`   Total scanned: ${report.totalCompanies}`);
        console.log(`   Found corrupt: ${report.corruptCompanies.length}`);
        console.log(`   Successfully repaired: ${report.successfulRepairs}`);
        console.log(`   Failed: ${report.failedRepairs}`);
        console.log(`   Still corrupt: ${stillCorrupt.length}`);
        console.log('═'.repeat(80));
        
        res.json({
            success: true,
            message: `Repaired ${report.successfulRepairs} of ${report.corruptCompanies.length} corrupt companies`,
            report
        });
        
    } catch (error) {
        console.error('❌ EMERGENCY REPAIR ERROR:', error);
        res.status(500).json({
            success: false,
            message: 'Emergency repair failed',
            error: error.message
        });
    }
});

module.exports = router;

