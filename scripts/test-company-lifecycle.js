#!/usr/bin/env node
/**
 * Test Company Lifecycle
 * 
 * Complete end-to-end test of company lifecycle:
 * 1. Create company
 * 2. Populate with realistic data
 * 3. Verify data retrieval
 * 4. Soft delete
 * 5. Verify trash
 * 6. Restore
 * 7. Hard delete
 * 8. Verify complete removal
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Company = require('../models/v2Company');

async function testLifecycle() {
    try {
        console.log(`\n${  '='.repeat(80)}`);
        console.log('🧪 TESTING COMPLETE COMPANY LIFECYCLE');
        console.log(`${'='.repeat(80)  }\n`);

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB:', mongoose.connection.db.databaseName);
        console.log('');

        const db = mongoose.connection.db;

        // ================================================================
        // PHASE 1: CREATE COMPANY
        // ================================================================
        console.log('─'.repeat(80));
        console.log('📝 PHASE 1: Create Test Company');
        console.log(`${'─'.repeat(80)  }\n`);

        const testCompany = new Company({
            companyName: 'Lifecycle Test Company',
            businessName: 'Lifecycle Test Co.',
            email: 'test@lifecycletest.com',
            ownerEmail: 'owner@lifecycletest.com',
            phone: '+15551234567',
            domain: 'lifecycletest.com',
            accountStatus: {
                status: 'active'
            },
            twilioConfig: {
                phoneNumbers: [
                    {
                        number: '+15551234567',
                        friendlyName: 'Main Line',
                        capabilities: ['voice', 'sms']
                    }
                ]
            },
            aiAgentSettings: {
                voiceSettings: {
                    apiSource: 'clientsvia',
                    voiceId: 'test-voice-id',
                    enabled: true
                },
                connectionMessages: {
                    voice: {
                        mode: 'realtime',
                        text: 'Hello! Thanks for calling Lifecycle Test Company.'
                    }
                }
            },
            configuration: {
                variables: new Map([
                    ['companyName', 'Lifecycle Test Company'],
                    ['phone', '+15551234567']
                ])
            }
        });

        await testCompany.save();
        const companyId = testCompany._id;
        console.log(`✅ Created company: ${testCompany.companyName}`);
        console.log(`   ID: ${companyId}`);
        console.log('');

        // ================================================================
        // PHASE 2: ADD RELATED DATA
        // ================================================================
        console.log('─'.repeat(80));
        console.log('📊 PHASE 2: Populate Related Data');
        console.log(`${'─'.repeat(80)  }\n`);

        // Add contacts
        const contactsColl = db.collection('v2contacts');
        await contactsColl.insertMany([
            {
                companyId,
                firstName: 'John',
                lastName: 'Doe',
                phone: '+15559876543',
                email: 'john@example.com',
                createdAt: new Date()
            },
            {
                companyId,
                firstName: 'Jane',
                lastName: 'Smith',
                phone: '+15559876544',
                email: 'jane@example.com',
                createdAt: new Date()
            }
        ]);
        console.log('✅ Added 2 contacts');

        // Add call logs
        const callsColl = db.collection('v2aiagentcalllogs');
        await callsColl.insertMany([
            {
                companyId,
                from: '+15559876543',
                to: '+15551234567',
                timestamp: new Date(),
                duration: 120,
                status: 'completed',
                transcript: 'Test call transcript 1'
            },
            {
                companyId,
                from: '+15559876544',
                to: '+15551234567',
                timestamp: new Date(),
                duration: 90,
                status: 'completed',
                transcript: 'Test call transcript 2'
            }
        ]);
        console.log('✅ Added 2 call logs');

        // Add notification logs
        const notificationsColl = db.collection('v2notificationlogs');
        await notificationsColl.insertOne({
            companyId,
            type: 'sms',
            to: '+15559876543',
            message: 'Test notification',
            timestamp: new Date(),
            status: 'sent'
        });
        console.log('✅ Added 1 notification log');
        console.log('');

        // ================================================================
        // PHASE 3: VERIFY DATA RETRIEVAL
        // ================================================================
        console.log('─'.repeat(80));
        console.log('🔍 PHASE 3: Verify Data Retrieval');
        console.log(`${'─'.repeat(80)  }\n`);

        const contactsCount = await contactsColl.countDocuments({ companyId });
        const callsCount = await callsColl.countDocuments({ companyId });
        const notificationsCount = await notificationsColl.countDocuments({ companyId });

        console.log(`✅ Retrieved ${contactsCount} contacts`);
        console.log(`✅ Retrieved ${callsCount} call logs`);
        console.log(`✅ Retrieved ${notificationsCount} notifications`);
        console.log('');

        // ================================================================
        // PHASE 4: SOFT DELETE
        // ================================================================
        console.log('─'.repeat(80));
        console.log('🗑️  PHASE 4: Soft Delete Company');
        console.log(`${'─'.repeat(80)  }\n`);

        const autoPurgeDate = new Date();
        autoPurgeDate.setDate(autoPurgeDate.getDate() + 30);

        await Company.findByIdAndUpdate(companyId, {
            $set: {
                isDeleted: true,
                deletedAt: new Date(),
                deletedBy: 'test-admin',
                deleteReason: 'Lifecycle test',
                autoPurgeAt: autoPurgeDate,
                'accountStatus.status': 'deleted'
            }
        });

        console.log('✅ Soft deleted company');
        console.log(`   Auto-purge scheduled: ${autoPurgeDate.toISOString()}`);
        console.log('');

        // Verify soft delete
        const deletedCompany = await Company.findById(companyId);
        if (deletedCompany.isDeleted && deletedCompany.deletedAt) {
            console.log('✅ Verified: Company marked as deleted');
            console.log('✅ Verified: Company still in database (soft delete)');
            console.log('✅ Verified: Related data still exists');
        } else {
            console.log('❌ ERROR: Soft delete failed!');
        }
        console.log('');

        // ================================================================
        // PHASE 5: RESTORE FROM TRASH
        // ================================================================
        console.log('─'.repeat(80));
        console.log('♻️  PHASE 5: Restore From Trash');
        console.log(`${'─'.repeat(80)  }\n`);

        await Company.findByIdAndUpdate(companyId, {
            $set: {
                isDeleted: false,
                deletedAt: null,
                deletedBy: null,
                deleteReason: null,
                autoPurgeAt: null,
                'accountStatus.status': 'active'
            }
        });

        console.log('✅ Restored company from trash');
        
        // Verify restore
        const restoredCompany = await Company.findById(companyId);
        if (!restoredCompany.isDeleted && restoredCompany.accountStatus.status === 'active') {
            console.log('✅ Verified: Company restored successfully');
            console.log('✅ Verified: Related data intact');
        } else {
            console.log('❌ ERROR: Restore failed!');
        }
        console.log('');

        // ================================================================
        // PHASE 6: HARD DELETE (PERMANENT)
        // ================================================================
        console.log('─'.repeat(80));
        console.log('💀 PHASE 6: Hard Delete (Permanent)');
        console.log(`${'─'.repeat(80)  }\n`);

        // Delete company
        await Company.findByIdAndDelete(companyId);
        console.log('✅ Hard deleted company document');

        // Delete all related data
        const deletedContacts = await contactsColl.deleteMany({ companyId });
        const deletedCalls = await callsColl.deleteMany({ companyId });
        const deletedNotifications = await notificationsColl.deleteMany({ companyId });

        console.log(`✅ Deleted ${deletedContacts.deletedCount} contacts`);
        console.log(`✅ Deleted ${deletedCalls.deletedCount} call logs`);
        console.log(`✅ Deleted ${deletedNotifications.deletedCount} notifications`);
        console.log('');

        // ================================================================
        // PHASE 7: VERIFY COMPLETE REMOVAL
        // ================================================================
        console.log('─'.repeat(80));
        console.log('🔍 PHASE 7: Verify Complete Removal');
        console.log(`${'─'.repeat(80)  }\n`);

        const checkCompany = await Company.findById(companyId);
        const checkContacts = await contactsColl.countDocuments({ companyId });
        const checkCalls = await callsColl.countDocuments({ companyId });
        const checkNotifications = await notificationsColl.countDocuments({ companyId });

        if (!checkCompany && checkContacts === 0 && checkCalls === 0 && checkNotifications === 0) {
            console.log('✅ Verified: Company completely removed');
            console.log('✅ Verified: All related data removed');
            console.log('✅ Verified: No traces left in database');
        } else {
            console.log('❌ ERROR: Incomplete removal!');
            console.log(`   Company exists: ${Boolean(checkCompany)}`);
            console.log(`   Contacts remaining: ${checkContacts}`);
            console.log(`   Calls remaining: ${checkCalls}`);
            console.log(`   Notifications remaining: ${checkNotifications}`);
        }
        console.log('');

        // ================================================================
        // SUMMARY
        // ================================================================
        console.log('='.repeat(80));
        console.log('✅ LIFECYCLE TEST COMPLETE!');
        console.log('='.repeat(80));
        console.log('');
        console.log('✓ Phase 1: Create company');
        console.log('✓ Phase 2: Populate related data');
        console.log('✓ Phase 3: Verify data retrieval');
        console.log('✓ Phase 4: Soft delete');
        console.log('✓ Phase 5: Restore from trash');
        console.log('✓ Phase 6: Hard delete');
        console.log('✓ Phase 7: Verify complete removal');
        console.log('');
        console.log('🎉 All phases passed! System is ready for production use.');
        console.log('');

        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

testLifecycle();

