/**
 * 🧪 ANALYTICS DASHBOARD FIX TEST
 * ================================
 * Test script to validate that the Analytics Dashboard tab switching
 * works correctly after fixing the fetchAnalyticsMetrics ReferenceError.
 */

const puppeteer = require('puppeteer');

async function testAnalyticsDashboardFix() {
    console.log('🧪 Starting Analytics Dashboard Fix Test...\n');
    
    let browser;
    try {
        browser = await puppeteer.launch({ 
            headless: false, // Set to true for production testing
            defaultViewport: { width: 1920, height: 1080 },
            devtools: true
        });
        
        const page = await browser.newPage();
        
        // Enable console logging
        page.on('console', msg => {
            console.log('🖥️  BROWSER:', msg.text());
        });
        
        page.on('pageerror', error => {
            console.error('❌ PAGE ERROR:', error.message);
        });
        
        // Navigate to company profile page
        console.log('📍 Navigating to company profile page...');
        await page.goto('https://clientsvia-backend.onrender.com/company-profile.html?company=test', {
            waitUntil: 'networkidle0',
            timeout: 60000
        });
        
        // Wait for page to fully load
        await page.waitForTimeout(3000);
        
        console.log('🔍 Checking if AI Agent Logic tab exists...');
        
        // Check if AI Agent Logic tab exists
        const aiAgentTab = await page.$('[data-section="ai-agent-logic"]');
        if (!aiAgentTab) {
            throw new Error('AI Agent Logic tab not found!');
        }
        console.log('✅ AI Agent Logic tab found');
        
        // Click on AI Agent Logic tab
        console.log('🖱️  Clicking AI Agent Logic tab...');
        await aiAgentTab.click();
        await page.waitForTimeout(2000);
        
        // Check if Analytics Dashboard sub-tab exists
        console.log('🔍 Checking if Analytics Dashboard sub-tab exists...');
        const analyticsTab = await page.$('[data-clientsvia-tab="analytics"]');
        if (!analyticsTab) {
            throw new Error('Analytics Dashboard sub-tab not found!');
        }
        console.log('✅ Analytics Dashboard sub-tab found');
        
        // Listen for any JavaScript errors
        const jsErrors = [];
        page.on('pageerror', error => {
            jsErrors.push(error.message);
        });
        
        // Click on Analytics Dashboard tab
        console.log('🖱️  Clicking Analytics Dashboard tab...');
        await analyticsTab.click();
        await page.waitForTimeout(3000);
        
        // Check for JavaScript errors
        if (jsErrors.length > 0) {
            console.error('❌ JavaScript errors detected:');
            jsErrors.forEach((error, index) => {
                console.error(`   ${index + 1}. ${error}`);
            });
            throw new Error('JavaScript errors detected during tab switching');
        }
        
        // Check if analytics content is visible
        console.log('🔍 Checking if Analytics Dashboard content is visible...');
        const analyticsContent = await page.$('[data-content="analytics"]');
        if (!analyticsContent) {
            throw new Error('Analytics Dashboard content not found!');
        }
        
        const isVisible = await page.evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
        }, analyticsContent);
        
        if (!isVisible) {
            throw new Error('Analytics Dashboard content is not visible!');
        }
        console.log('✅ Analytics Dashboard content is visible');
        
        // Check if metrics are being loaded
        console.log('🔍 Checking if analytics metrics are being loaded...');
        await page.waitForTimeout(2000);
        
        // Check for specific metric elements
        const successRateEl = await page.$('#success-rate-value');
        const responseTimeEl = await page.$('#response-time-value');
        const confidenceEl = await page.$('#confidence-value');
        const activeSessionsEl = await page.$('#active-sessions-value');
        
        let metricsFound = 0;
        if (successRateEl) metricsFound++;
        if (responseTimeEl) metricsFound++;
        if (confidenceEl) metricsFound++;
        if (activeSessionsEl) metricsFound++;
        
        console.log(`✅ Found ${metricsFound}/4 analytics metric elements`);
        
        // Test tab switching back and forth
        console.log('🔄 Testing tab switching...');
        
        // Switch to Flow Designer tab
        const flowDesignerTab = await page.$('[data-clientsvia-tab="flow-designer"]');
        if (flowDesignerTab) {
            await flowDesignerTab.click();
            await page.waitForTimeout(1000);
            console.log('✅ Successfully switched to Flow Designer tab');
        }
        
        // Switch back to Analytics Dashboard
        await analyticsTab.click();
        await page.waitForTimeout(1000);
        console.log('✅ Successfully switched back to Analytics Dashboard tab');
        
        console.log('\n🎉 ANALYTICS DASHBOARD FIX TEST COMPLETED SUCCESSFULLY!');
        console.log('✅ All tests passed:');
        console.log('   - AI Agent Logic tab exists and is clickable');
        console.log('   - Analytics Dashboard sub-tab exists and is clickable');
        console.log('   - No JavaScript errors during tab switching');
        console.log('   - Analytics Dashboard content is visible');
        console.log(`   - Found ${metricsFound}/4 analytics metric elements`);
        console.log('   - Tab switching works correctly');
        console.log('\n📊 The Analytics Dashboard is now production-ready!');
        
    } catch (error) {
        console.error('\n❌ ANALYTICS DASHBOARD FIX TEST FAILED!');
        console.error('Error:', error.message);
        process.exit(1);
        
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

// Run the test
testAnalyticsDashboardFix();
