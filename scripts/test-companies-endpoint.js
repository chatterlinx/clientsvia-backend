#!/usr/bin/env node
/**
 * Test the actual /api/admin/data-center/companies endpoint
 * to see what it returns when called with state=all
 */
require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const dataCenterRouter = require('../routes/admin/dataCenter');

async function test() {
    try {
        console.log('\n' + '='.repeat(80));
        console.log('🧪 TESTING /api/admin/data-center/companies ENDPOINT');
        console.log('='.repeat(80) + '\n');

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        // Create mock Express app
        const app = express();
        app.use(express.json());
        app.use('/api/admin/data-center', dataCenterRouter);

        // Start server
        const server = app.listen(0);
        const port = server.address().port;
        console.log(`🚀 Test server started on port ${port}\n`);

        // Test different scenarios
        const testCases = [
            { state: 'all', pageSize: 100, description: 'All companies (pageSize=100)' },
            { state: 'all', pageSize: 25, description: 'All companies (default pageSize=25)' },
            { state: 'live', pageSize: 100, description: 'Live companies only' },
            { state: 'deleted', pageSize: 100, description: 'Deleted companies only' }
        ];

        for (const testCase of testCases) {
            console.log('─'.repeat(80));
            console.log(`📊 Test: ${testCase.description}`);
            console.log('─'.repeat(80));

            const url = `http://localhost:${port}/api/admin/data-center/companies?state=${testCase.state}&pageSize=${testCase.pageSize}&page=1`;
            console.log(`   URL: GET ${url}\n`);

            const response = await fetch(url);
            
            if (!response.ok) {
                console.log(`   ❌ HTTP ${response.status} ${response.statusText}`);
                const text = await response.text();
                console.log(`   Response: ${text.substring(0, 200)}...\n`);
                continue;
            }

            const data = await response.json();
            
            console.log(`   ✅ Response:`);
            console.log(`      Total companies: ${data.total}`);
            console.log(`      Results in page: ${data.results.length}`);
            console.log(`      Page: ${data.page} of ${data.totalPages}`);
            console.log(``);

            if (data.results.length > 0) {
                console.log(`   📋 First 3 companies:`);
                data.results.slice(0, 3).forEach((c, i) => {
                    console.log(`      ${i+1}. ${c.companyName} (${c.companyId})`);
                    console.log(`         Status: ${c.accountStatus}, Deleted: ${c.isDeleted}, Calls: ${c.calls}`);
                });
            } else {
                console.log(`   ⚠️  No results returned`);
            }
            
            console.log('');
        }

        console.log('='.repeat(80));
        console.log('✅ All tests complete');
        console.log('='.repeat(80) + '\n');

        server.close();
        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

test();

