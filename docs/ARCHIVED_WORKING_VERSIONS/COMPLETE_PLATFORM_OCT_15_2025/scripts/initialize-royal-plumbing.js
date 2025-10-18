#!/usr/bin/env node
/**
 * ============================================================================
 * INITIALIZE ROYAL PLUMBING - CLEAN SLATE
 * ============================================================================
 * Sets up Royal Plumbing with a clean, production-ready configuration
 * ============================================================================
 */

const mongoose = require('mongoose');
const Company = require('../models/v2Company');
require('dotenv').config();

async function initializeRoyalPlumbing() {
    try {
        console.log('🚀 INITIALIZING ROYAL PLUMBING - CLEAN SLATE\n');

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB\n');

        const companyId = '68eeaf924e989145e9d46c12';
        const company = await Company.findById(companyId);

        if (!company) {
            console.log('❌ Company not found!');
            process.exit(1);
        }

        console.log(`📋 Company: ${company.companyName || company.businessName}\n`);

        // Initialize aiAgentLogic if missing
        if (!company.aiAgentLogic) {
            console.log('🔧 Creating aiAgentLogic...');
            company.aiAgentLogic = {};
        }

        // Initialize connectionMessages with clean structure
        console.log('🔧 Initializing connectionMessages...');
        company.aiAgentLogic.connectionMessages = {
            voice: {
                mode: 'realtime',
                text: 'Thank you for calling Royal Plumbing. Please hold while we connect you...',
                prerecorded: {
                    activeFileUrl: null,
                    activeFileName: null,
                    activeDuration: null,
                    activeFileSize: null,
                    uploadedBy: null,
                    uploadedAt: null
                },
                realtime: {
                    text: 'Thank you for calling Royal Plumbing. Please hold while we connect you...',
                    voiceId: null
                },
                fallback: {
                    enabled: true,
                    voiceMessage: "We're experiencing technical difficulties. Please hold while we connect you to our team.",
                    smsEnabled: true,
                    smsMessage: "Sorry, our voice system missed your call. How can we help you?",
                    notifyAdmin: true,
                    adminNotificationMethod: 'sms',
                    adminPhone: null,
                    adminEmail: null,
                    adminSmsMessage: "⚠️ FALLBACK ALERT: Greeting fallback occurred in {companyname} ({companyid}). Please check the Messages & Greetings settings immediately."
                }
            },
            sms: {
                enabled: false,
                text: 'Thanks for contacting us! Our AI assistant will respond shortly.',
                businessHours: {
                    enabled: false,
                    duringHours: 'Thanks for texting! We\'ll respond right away...',
                    afterHours: 'Thanks for texting! We\'re currently closed but will respond first thing...'
                }
            },
            webChat: {
                enabled: false,
                text: 'Thanks for reaching out! Our AI assistant will respond in a moment...',
                showTypingIndicator: true,
                delaySeconds: 2
            },
            lastUpdated: new Date()
        };

        console.log('💾 Saving to MongoDB...');
        await company.save();

        console.log('✅ Royal Plumbing initialized successfully!\n');

        console.log('📊 Configuration:');
        console.log('  Voice mode:', company.aiAgentLogic.connectionMessages.voice.mode);
        console.log('  Voice text:', company.aiAgentLogic.connectionMessages.voice.text);
        console.log('  Fallback enabled:', company.aiAgentLogic.connectionMessages.voice.fallback.enabled);
        console.log('  Fallback is object?', typeof company.aiAgentLogic.connectionMessages.voice.fallback === 'object');

        process.exit(0);
    } catch (error) {
        console.error('❌ INITIALIZATION FAILED:', error);
        console.error('Stack:', error.stack);
        process.exit(1);
    }
}

initializeRoyalPlumbing();

