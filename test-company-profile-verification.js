#!/usr/bin/env node
/**
 * Company Profile Verification Test
 * Tests the company ID extraction and data loading functionality
 */

const fs = require('fs');
const path = require('path');

console.log('🧪 Company Profile Verification Test');
console.log('====================================\n');

// Test 1: Check if HTML file has the DOMContentLoaded script
console.log('📄 Test 1: Checking company-profile.html for initialization script...');
const htmlPath = path.join(__dirname, 'public', 'company-profile.html');
try {
    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
    
    // Check for DOMContentLoaded
    if (htmlContent.includes("document.addEventListener('DOMContentLoaded'")) {
        console.log('✅ DOMContentLoaded event listener found');
    } else {
        console.log('❌ DOMContentLoaded event listener NOT found');
    }
    
    // Check for company ID extraction
    if (htmlContent.includes('urlParams.get(\'id\')')) {
        console.log('✅ Company ID extraction code found');
    } else {
        console.log('❌ Company ID extraction code NOT found');
    }
    
    // Check for fetchCompanyData call
    if (htmlContent.includes('fetchCompanyData()')) {
        console.log('✅ fetchCompanyData() call found');
    } else {
        console.log('❌ fetchCompanyData() call NOT found');
    }
    
    // Check for global company ID setting
    if (htmlContent.includes('window.companyId = companyId')) {
        console.log('✅ Global company ID setting found');
    } else {
        console.log('❌ Global company ID setting NOT found');
    }
    
} catch (error) {
    console.log('❌ Error reading HTML file:', error.message);
}

console.log();

// Test 2: Check if JS file has the fetchCompanyData function exposed globally
console.log('📜 Test 2: Checking company-profile.js for global function exposure...');
const jsPath = path.join(__dirname, 'public', 'js', 'company-profile.js');
try {
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    
    // Check for fetchCompanyData function definition
    if (jsContent.includes('async function fetchCompanyData(')) {
        console.log('✅ fetchCompanyData function definition found');
    } else {
        console.log('❌ fetchCompanyData function definition NOT found');
    }
    
    // Check for global exposure
    if (jsContent.includes('window.fetchCompanyData = fetchCompanyData')) {
        console.log('✅ Global fetchCompanyData exposure found');
    } else {
        console.log('❌ Global fetchCompanyData exposure NOT found');
    }
    
    // Check for company ID fallback logic
    if (jsContent.includes('companyId || window.companyId')) {
        console.log('✅ Company ID fallback logic found');
    } else {
        console.log('❌ Company ID fallback logic NOT found');
    }
    
    // Check for global company ID setting
    if (jsContent.includes('window.currentCompanyId = companyId')) {
        console.log('✅ Global currentCompanyId setting found');
    } else {
        console.log('❌ Global currentCompanyId setting NOT found');
    }
    
    if (jsContent.includes('window.companyId = companyId')) {
        console.log('✅ Global companyId setting found');
    } else {
        console.log('❌ Global companyId setting NOT found');
    }
    
} catch (error) {
    console.log('❌ Error reading JS file:', error.message);
}

console.log();

// Test 3: Check if backend API endpoint exists
console.log('🔧 Test 3: Checking backend API endpoint...');
const serverPath = path.join(__dirname, 'server.js');
try {
    const serverContent = fs.readFileSync(serverPath, 'utf8');
    
    if (serverContent.includes('/api/company/')) {
        console.log('✅ Company API endpoint route found in server.js');
    } else {
        console.log('❌ Company API endpoint route NOT found in server.js');
    }
    
} catch (error) {
    console.log('❌ Error reading server.js:', error.message);
}

// Check if there's a separate routes file
const routesDir = path.join(__dirname, 'routes');
if (fs.existsSync(routesDir)) {
    const routeFiles = fs.readdirSync(routesDir);
    console.log('📁 Found route files:', routeFiles.join(', '));
    
    // Check if any route file has company endpoints
    let companyRouteFound = false;
    routeFiles.forEach(file => {
        if (file.endsWith('.js')) {
            try {
                const routeContent = fs.readFileSync(path.join(routesDir, file), 'utf8');
                if (routeContent.includes('/api/company/') || routeContent.includes('/:id')) {
                    console.log(`✅ Company route found in ${file}`);
                    companyRouteFound = true;
                }
            } catch (error) {
                console.log(`❌ Error reading ${file}:`, error.message);
            }
        }
    });
    
    if (!companyRouteFound) {
        console.log('❌ Company route NOT found in any route files');
    }
}

console.log();

// Test 4: Check service issue booking flow
console.log('🎯 Test 4: Checking service issue booking flow...');
const serviceIssueHandlerPath = path.join(__dirname, 'services', 'serviceIssueHandler.js');
const bookingFlowHandlerPath = path.join(__dirname, 'services', 'bookingFlowHandler.js');

if (fs.existsSync(serviceIssueHandlerPath)) {
    console.log('✅ ServiceIssueHandler found');
} else {
    console.log('❌ ServiceIssueHandler NOT found');
}

if (fs.existsSync(bookingFlowHandlerPath)) {
    console.log('✅ BookingFlowHandler found');
} else {
    console.log('❌ BookingFlowHandler NOT found');
}

// Test 5: Check monitoring system
console.log();
console.log('📊 Test 5: Checking monitoring system...');
const monitoringServicePath = path.join(__dirname, 'services', 'agentMonitoring.js');
const monitoringRoutesPath = path.join(__dirname, 'routes', 'monitoring.js');

if (fs.existsSync(monitoringServicePath)) {
    console.log('✅ Agent monitoring service found');
} else {
    console.log('❌ Agent monitoring service NOT found');
}

if (fs.existsSync(monitoringRoutesPath)) {
    console.log('✅ Monitoring routes found');
} else {
    console.log('❌ Monitoring routes NOT found');
}

console.log();
console.log('🏁 Verification Complete!');
console.log('========================');
console.log('✨ If all tests show ✅, the company profile system should be working correctly.');
console.log('🌐 Test URL format: https://your-domain.com/company-profile.html?id=YOUR_COMPANY_ID');
