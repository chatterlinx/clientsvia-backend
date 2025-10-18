#!/usr/bin/env node
/**
 * ============================================================================
 * DATA CENTER - CREATE MONGODB INDEXES
 * ============================================================================
 * Creates all required indexes for fast queries in Data Center
 * Run once during initial setup, safe to re-run (idempotent)
 * ============================================================================
 */

const mongoose = require('mongoose');
require('dotenv').config();

async function createIndexes() {
    try {
        console.log('🚀 DATA CENTER - Creating MongoDB Indexes\n');
        console.log('='.repeat(80));

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const db = mongoose.connection.db;

        // ========================================================================
        // COMPANIES COLLECTION
        // ========================================================================
        console.log('📋 COMPANIES COLLECTION (companiesCollection)');
        console.log('-'.repeat(80));

        const companies = db.collection('companiesCollection');

        // 1. Full-text search on name, business name, domain
        console.log('Creating text index for search...');
        await companies.createIndex(
            { companyName: 'text', businessName: 'text', domain: 'text' },
            { name: 'text_search', background: true }
        );
        console.log('✅ Text search index created\n');

        // 2. Email lookup (owner, primary)
        console.log('Creating email indexes...');
        await companies.createIndex(
            { email: 1, ownerEmail: 1 },
            { name: 'email_lookup', background: true, sparse: true }
        );
        console.log('✅ Email lookup indexes created\n');

        // 3. Phone lookup (Twilio numbers)
        console.log('Creating phone number index...');
        await companies.createIndex(
            { 'twilioConfig.phoneNumbers.number': 1 },
            { name: 'phone_lookup', background: true, sparse: true }
        );
        console.log('✅ Phone lookup index created\n');

        // 4. Status + date (for filtering live/deleted/stale)
        console.log('Creating status + date compound index...');
        await companies.createIndex(
            { isDeleted: 1, isActive: 1, createdAt: -1 },
            { name: 'status_date', background: true }
        );
        console.log('✅ Status + date index created\n');

        // 5. Auto-purge scheduling
        console.log('Creating auto-purge index...');
        await companies.createIndex(
            { autoPurgeAt: 1 },
            { name: 'auto_purge', background: true, sparse: true }
        );
        console.log('✅ Auto-purge index created\n');

        // 6. Trade categories (for filtering)
        console.log('Creating trade categories index...');
        await companies.createIndex(
            { tradeCategories: 1 },
            { name: 'trade_categories', background: true, sparse: true }
        );
        console.log('✅ Trade categories index created\n');

        // ========================================================================
        // CALL LOGS COLLECTION
        // ========================================================================
        console.log('\n📞 CALL LOGS COLLECTION (v2aiagentcalllogs)');
        console.log('-'.repeat(80));

        const callLogs = db.collection('v2aiagentcalllogs');

        // 7. Company + date (for time-range queries)
        console.log('Creating company + timestamp compound index...');
        await callLogs.createIndex(
            { companyId: 1, timestamp: -1 },
            { name: 'company_timestamp', background: true }
        );
        console.log('✅ Company + timestamp index created\n');

        // 8. Company + status (for filtering by outcome)
        console.log('Creating company + status index...');
        await callLogs.createIndex(
            { companyId: 1, status: 1 },
            { name: 'company_status', background: true }
        );
        console.log('✅ Company + status index created\n');

        // ========================================================================
        // CONTACTS COLLECTION (for customer search)
        // ========================================================================
        console.log('\n👥 CONTACTS COLLECTION (v2contacts)');
        console.log('-'.repeat(80));

        const contacts = db.collection('v2contacts');

        // 9. Company + phone (for customer lookup)
        console.log('Creating company + phone index...');
        await contacts.createIndex(
            { companyId: 1, phone: 1 },
            { name: 'company_phone', background: true }
        );
        console.log('✅ Company + phone index created\n');

        // 10. Company + last activity (for sorting customers)
        console.log('Creating company + last contacted index...');
        await contacts.createIndex(
            { companyId: 1, lastContacted: -1 },
            { name: 'company_last_contacted', background: true }
        );
        console.log('✅ Company + last contacted index created\n');

        // ========================================================================
        // NOTIFICATION LOGS (for audit trail)
        // ========================================================================
        console.log('\n📝 NOTIFICATION LOGS COLLECTION (v2notificationlogs)');
        console.log('-'.repeat(80));

        const notificationLogs = db.collection('v2notificationlogs');

        // 11. Company + timestamp (for audit queries)
        console.log('Creating company + timestamp index...');
        await notificationLogs.createIndex(
            { companyId: 1, timestamp: -1 },
            { name: 'company_timestamp', background: true }
        );
        console.log('✅ Company + timestamp index created\n');

        // ========================================================================
        // SUMMARY
        // ========================================================================
        console.log('\n' + '='.repeat(80));
        console.log('✅ ALL INDEXES CREATED SUCCESSFULLY');
        console.log('='.repeat(80));

        console.log('\n📊 INDEX SUMMARY:');
        console.log('  Companies Collection:');
        console.log('    ✓ Text search (name, domain)');
        console.log('    ✓ Email lookup');
        console.log('    ✓ Phone lookup');
        console.log('    ✓ Status + date');
        console.log('    ✓ Auto-purge schedule');
        console.log('    ✓ Trade categories');
        console.log('\n  Call Logs Collection:');
        console.log('    ✓ Company + timestamp');
        console.log('    ✓ Company + status');
        console.log('\n  Contacts Collection:');
        console.log('    ✓ Company + phone');
        console.log('    ✓ Company + last contacted');
        console.log('\n  Notification Logs Collection:');
        console.log('    ✓ Company + timestamp');

        console.log('\n🎯 PERFORMANCE TARGETS:');
        console.log('  - Simple search: < 50ms');
        console.log('  - Full-text search: < 200ms');
        console.log('  - Date-range queries: < 500ms');
        console.log('  - Complex aggregations: < 1000ms');

        console.log('\n💡 NOTE: Indexes are created in background mode');
        console.log('   Large collections may take a few minutes to complete\n');

        process.exit(0);
    } catch (error) {
        console.error('\n❌ INDEX CREATION FAILED:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

createIndexes();

