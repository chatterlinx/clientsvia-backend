#!/usr/bin/env node
/**
 * 🚨 EMERGENCY: Restore All Q&A Entries to Active Status
 * 
 * CRITICAL ISSUE: All Q&A entries are in draft/inactive status
 * IMPACT: AI agent receptionist has no knowledge to answer callers
 * SOLUTION: Mass update all Q&A entries to 'active' status
 */

const mongoose = require('mongoose');
const CompanyQnA = require('../models/knowledge/CompanyQnA');

async function emergencyRestoreQnAActive() {
    try {
        console.log('🚨 EMERGENCY: Starting Q&A status restoration...');
        
        // Use the same connection string as production
        const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia';
        
        console.log('📡 Connecting to MongoDB...');
        await mongoose.connect(mongoUri);
        console.log('✅ Connected to MongoDB');
        
        // Target company ID from the logs
        const companyId = '68813026dd95f599c74e49c7';
        
        console.log('🔍 Finding Q&A entries for company:', companyId);
        
        // Find all Q&A entries for this company
        const qnas = await CompanyQnA.find({ companyId: companyId });
        console.log('📊 Found Q&A entries:', qnas.length);
        
        if (qnas.length === 0) {
            console.log('⚠️ No Q&A entries found - they might have been deleted');
            return;
        }
        
        // Show current status distribution
        const statusCounts = {};
        qnas.forEach(qna => {
            statusCounts[qna.status] = (statusCounts[qna.status] || 0) + 1;
        });
        
        console.log('📊 Current status distribution:', statusCounts);
        
        // Update all to active status
        console.log('🔧 Updating all Q&A entries to active status...');
        
        const updateResult = await CompanyQnA.updateMany(
            { companyId: companyId },
            { 
                status: 'active',
                lastModified: new Date()
            }
        );
        
        console.log('✅ EMERGENCY SUCCESS: Updated', updateResult.modifiedCount, 'Q&A entries to active status');
        
        // Verify the update
        const verifyQnas = await CompanyQnA.find({ companyId: companyId });
        const newStatusCounts = {};
        verifyQnas.forEach(qna => {
            newStatusCounts[qna.status] = (newStatusCounts[qna.status] || 0) + 1;
        });
        
        console.log('📊 New status distribution:', newStatusCounts);
        console.log('🎉 SUCCESS: AI agent can now access all Q&A entries for caller responses');
        
    } catch (error) {
        console.error('❌ EMERGENCY FAILED:', error);
    } finally {
        await mongoose.disconnect();
        console.log('📡 Disconnected from MongoDB');
    }
}

// Run immediately if this is the main module
if (require.main === module) {
    emergencyRestoreQnAActive()
        .then(() => {
            console.log('🎉 Emergency Q&A restoration completed');
            process.exit(0);
        })
        .catch(error => {
            console.error('❌ Emergency restoration failed:', error);
            process.exit(1);
        });
}

module.exports = emergencyRestoreQnAActive;
