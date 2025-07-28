#!/usr/bin/env node

/**
 * Google Admin Email Management Script
 * 
 * This script helps manage which Google accounts can access admin functions
 * via Google OAuth authentication.
 */

const readline = require('readline');
const fs = require('fs');
const path = require('path');

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

// Colors for console output
const colors = {
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    blue: '\x1b[34m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
};

function log(message, color = colors.reset) {
    console.log(`${color}${message}${colors.reset}`);
}

function question(prompt) {
    return new Promise((resolve) => {
        rl.question(prompt, resolve);
    });
}

async function main() {
    log('🔐 Google OAuth Admin Email Management', colors.bold);
    log('=====================================\n');
    
    // Check current environment variables
    const currentAdminEmails = process.env.ADMIN_GOOGLE_EMAILS || '';
    const currentAllowedDomains = process.env.ALLOWED_DOMAINS || '';
    
    log('📋 Current Configuration:', colors.blue);
    log(`   Admin Emails: ${currentAdminEmails || 'None configured'}`);
    log(`   Allowed Domains: ${currentAllowedDomains || 'None configured'}\n`);
    
    log('🎯 Choose an option:', colors.yellow);
    log('1. Add admin email');
    log('2. Remove admin email');
    log('3. List current admin emails');
    log('4. Set allowed domains');
    log('5. Show environment setup instructions');
    log('6. Exit\n');
    
    const choice = await question('Enter your choice (1-6): ');
    
    switch (choice) {
        case '1':
            await addAdminEmail();
            break;
        case '2':
            await removeAdminEmail();
            break;
        case '3':
            await listAdminEmails();
            break;
        case '4':
            await setAllowedDomains();
            break;
        case '5':
            await showSetupInstructions();
            break;
        case '6':
            log('👋 Goodbye!', colors.green);
            process.exit(0);
            break;
        default:
            log('❌ Invalid choice. Please try again.', colors.red);
            await main();
    }
    
    rl.close();
}

async function addAdminEmail() {
    const email = await question('Enter admin email address: ');
    
    if (!email || !email.includes('@')) {
        log('❌ Invalid email address', colors.red);
        return await main();
    }
    
    const currentEmails = process.env.ADMIN_GOOGLE_EMAILS ? 
        process.env.ADMIN_GOOGLE_EMAILS.split(',').map(e => e.trim()) : [];
    
    if (currentEmails.includes(email)) {
        log(`⚠️  Email ${email} is already in the admin list`, colors.yellow);
    } else {
        currentEmails.push(email);
        log(`✅ Added ${email} to admin email list`, colors.green);
    }
    
    log('\n📝 To apply this change, set the environment variable:');
    log(`ADMIN_GOOGLE_EMAILS="${currentEmails.join(',')}"`, colors.blue);
    
    await question('\nPress Enter to continue...');
    await main();
}

async function removeAdminEmail() {
    const currentEmails = process.env.ADMIN_GOOGLE_EMAILS ? 
        process.env.ADMIN_GOOGLE_EMAILS.split(',').map(e => e.trim()) : [];
    
    if (currentEmails.length === 0) {
        log('❌ No admin emails configured', colors.red);
        await question('Press Enter to continue...');
        return await main();
    }
    
    log('Current admin emails:', colors.blue);
    currentEmails.forEach((email, index) => {
        log(`${index + 1}. ${email}`);
    });
    
    const choice = await question('\nEnter number to remove (or 0 to cancel): ');
    const index = parseInt(choice) - 1;
    
    if (choice === '0') {
        return await main();
    }
    
    if (index >= 0 && index < currentEmails.length) {
        const removedEmail = currentEmails.splice(index, 1)[0];
        log(`✅ Removed ${removedEmail} from admin email list`, colors.green);
        
        log('\n📝 To apply this change, set the environment variable:');
        log(`ADMIN_GOOGLE_EMAILS="${currentEmails.join(',')}"`, colors.blue);
    } else {
        log('❌ Invalid selection', colors.red);
    }
    
    await question('\nPress Enter to continue...');
    await main();
}

async function listAdminEmails() {
    const currentEmails = process.env.ADMIN_GOOGLE_EMAILS ? 
        process.env.ADMIN_GOOGLE_EMAILS.split(',').map(e => e.trim()) : [];
    
    log('📋 Current Admin Emails:', colors.blue);
    if (currentEmails.length === 0) {
        log('   None configured', colors.yellow);
    } else {
        currentEmails.forEach((email, index) => {
            log(`   ${index + 1}. ${email}`);
        });
    }
    
    await question('\nPress Enter to continue...');
    await main();
}

async function setAllowedDomains() {
    log('📝 Current allowed domains:', colors.blue);
    log(`   ${process.env.ALLOWED_DOMAINS || 'None configured'}\n`);
    
    const domains = await question('Enter allowed domains (comma-separated, e.g., company.com,trusted.org): ');
    
    log(`✅ Allowed domains set to: ${domains}`, colors.green);
    log('\n📝 To apply this change, set the environment variable:');
    log(`ALLOWED_DOMAINS="${domains}"`, colors.blue);
    
    await question('\nPress Enter to continue...');
    await main();
}

async function showSetupInstructions() {
    log('🚀 Google OAuth Setup Instructions', colors.bold);
    log('===================================\n');
    
    log('1. Google Cloud Console Setup:', colors.blue);
    log('   • Go to https://console.cloud.google.com/');
    log('   • Create a new project or select existing');
    log('   • Enable Google+ API');
    log('   • Create OAuth 2.0 credentials\n');
    
    log('2. Environment Variables:', colors.blue);
    log('   Set these in your production environment:');
    log('   GOOGLE_CLIENT_ID=your_google_client_id');
    log('   GOOGLE_CLIENT_SECRET=your_google_client_secret');
    log('   ADMIN_GOOGLE_EMAILS=admin1@gmail.com,admin2@company.com');
    log('   ALLOWED_DOMAINS=yourcompany.com (optional)\n');
    
    log('3. OAuth Redirect URI:', colors.blue);
    log('   Add this to your Google OAuth settings:');
    log('   https://yourdomain.com/api/auth/google/callback\n');
    
    log('4. Security Levels:', colors.blue);
    log('   • ADMIN_GOOGLE_EMAILS: Specific emails only (most secure)');
    log('   • ALLOWED_DOMAINS: Any email from specific domains');
    log('   • No restrictions: Anyone with Google account (not recommended)\n');
    
    await question('Press Enter to continue...');
    await main();
}

// Handle script termination
process.on('SIGINT', () => {
    log('\n👋 Goodbye!', colors.green);
    process.exit(0);
});

// Start the script
main().catch(console.error);
