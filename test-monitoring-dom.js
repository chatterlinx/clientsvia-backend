#!/usr/bin/env node

/**
 * Test script to verify monitoring DOM elements are properly set up
 */

const puppeteer = require('puppeteer');

async function testMonitoringDOM() {
    console.log('🧪 Testing Monitoring DOM Elements...');
    
    let browser;
    try {
        browser = await puppeteer.launch({ headless: false });
        const page = await browser.newPage();
        
        // Enable console logging
        page.on('console', (msg) => {
            console.log('🌐 BROWSER:', msg.text());
        });
        
        // Navigate to company profile
        await page.goto('http://localhost:3000/company-profile.html');
        
        // Wait for page to load
        await page.waitForTimeout(2000);
        
        // Test DOM elements exist
        const results = await page.evaluate(() => {
            const results = {
                monitoringSection: !!document.getElementById('agent-monitoring-section'),
                dashboardButton: !!document.getElementById('open-monitoring-dashboard'),
                reviewButton: !!document.getElementById('review-pending-interactions'),
                flaggedButton: !!document.getElementById('view-flagged-items'),
                exportButton: !!document.getElementById('export-monitoring-data'),
                activityFeed: !!document.getElementById('activity-feed'),
                monitoringStats: !!document.getElementById('monitoring-stats')
            };
            
            console.log('🔍 DOM Element Check Results:', results);
            return results;
        });
        
        console.log('✅ DOM Test Results:');
        Object.entries(results).forEach(([key, value]) => {
            console.log(`  ${key}: ${value ? '✅ Found' : '❌ Missing'}`);
        });
        
        // Test monitoring initialization
        await page.evaluate(() => {
            if (typeof window.testMonitoringSystem === 'function') {
                console.log('🧪 Running monitoring system test...');
                window.testMonitoringSystem();
            } else {
                console.log('⚠️ testMonitoringSystem function not found');
            }
        });
        
        // Wait for test to complete
        await page.waitForTimeout(3000);
        
        console.log('✅ Monitoring DOM test completed');
        
    } catch (error) {
        console.error('❌ Test failed:', error);
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Run the test
if (require.main === module) {
    testMonitoringDOM();
}

module.exports = { testMonitoringDOM };
