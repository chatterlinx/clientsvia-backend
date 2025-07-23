const express = require('express');
const path = require('path');

const app = express();
const PORT = 3001;

// Parse JSON bodies
app.use(express.json());

// Serve static files from public directory
app.use(express.static('public'));

// Mock company API endpoint for testing - handles any company ID
app.get('/api/company/:id', (req, res) => {
    const companyId = req.params.id;
    console.log('📡 Mock API: Company data requested for ID:', companyId);
    
    // Return mock company data that works with any ID
    const mockCompany = {
        _id: companyId,
        companyName: "Dynamic Test Company",
        businessPhone: "+1-555-123-4567",
        businessEmail: "contact@testcompany.com",
        businessAddress: "123 Business Street, Test City, TC 12345",
        businessWebsite: "https://testcompany.com",
        description: "Professional services for testing purposes - this company profile works with any ID",
        serviceArea: "Global Test Area",
        businessHours: "Monday-Friday: 9:00 AM - 5:00 PM",
        
        // Additional fields for comprehensive testing
        timezone: "America/New_York",
        tradeTypes: ["General Services", "Testing", "Development"],
        
        // Configuration data
        twilioAccountSid: "ACtest123456789abcdef",
        twilioAuthToken: "test_auth_token_12345",
        twilioApiKey: "SKtest_api_key_67890",
        twilioApiSecret: "test_api_secret_xyz",
        phoneNumbers: [
            { number: "+1-555-123-4567", friendlyName: "Main Line", isPrimary: true },
            { number: "+1-555-987-6543", friendlyName: "Support Line", isPrimary: false }
        ],
        
        // ElevenLabs Configuration
        elevenLabsApiKey: "el_test_api_key_abcdef123456",
        elevenLabsVoiceId: "rachel_21m00Tcm4TlvDq8ikWAM",
        
        // AI Settings
        aiSettings: {
            model: "gpt-4",
            personality: "professional",
            ttsProvider: "elevenlabs",
            responseStyle: "conversational",
            maxTokens: 150,
            temperature: 0.7,
            systemPrompt: "You are a helpful AI assistant for our test company.",
            elevenLabs: {
                voiceId: "rachel_21m00Tcm4TlvDq8ikWAM",
                model: "eleven_monolingual_v1",
                stability: 0.5,
                similarityBoost: 0.75
            }
        },
        
        // Voice Settings
        voiceSettings: {
            provider: "elevenlabs",
            voiceId: "rachel_21m00Tcm4TlvDq8ikWAM",
            speed: 1.0,
            pitch: 1.0,
            stability: 0.5,
            similarityBoost: 0.75,
            style: 0.0,
            useSpeakerBoost: true
        },
        
        // Sample notes
        notes: [
            {
                id: 1,
                content: "This is a sample note for testing purposes.",
                timestamp: new Date().toISOString(),
                author: "System"
            }
        ],
        
        // Operating hours
        operatingHours: [
            { day: "monday", enabled: true, start: "09:00", end: "17:00" },
            { day: "tuesday", enabled: true, start: "09:00", end: "17:00" },
            { day: "wednesday", enabled: true, start: "09:00", end: "17:00" },
            { day: "thursday", enabled: true, start: "09:00", end: "17:00" },
            { day: "friday", enabled: true, start: "09:00", end: "17:00" },
            { day: "saturday", enabled: false, start: "09:00", end: "17:00" },
            { day: "sunday", enabled: false, start: "09:00", end: "17:00" }
        ],
        
        // Calendar Settings
        calendarSettings: {
            bookingWindow: 30,
            bufferTime: 15,
            defaultDuration: 60,
            timezone: "America/New_York",
            allowWeekendBookings: false,
            requireApproval: true,
            sendConfirmations: true,
            sendReminders: true,
            reminderTime: 24
        },
        
        // Agent Logic Settings
        agentLogic: {
            enabled: true,
            automatedBooking: true,
            requireHumanApproval: false,
            transferToHuman: "complex_requests",
            maxCallDuration: 10,
            recordCalls: true,
            transcribeCalls: true,
            sentiment: "professional",
            escalationKeywords: ["angry", "frustrated", "complaint", "supervisor"]
        },
        
        // Personality responses
        personalityResponses: {
            greeting: "Hello! Thank you for calling our test company. How can I help you today?",
            farewell: "Thank you for calling. Have a great day!"
        },
        
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    res.json(mockCompany);
});

// Mock company update endpoint
app.patch('/api/company/:id', (req, res) => {
    const companyId = req.params.id;
    const updateData = req.body;
    
    console.log('📡 Mock API: Company update requested for ID:', companyId);
    console.log('📝 Update data:', updateData);
    
    // Return the updated data
    res.json({
        success: true,
        message: 'Company updated successfully',
        data: updateData
    });
});

// Serve the company profile page
app.get('/company-profile', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'company-profile.html'));
});

// Root route
app.get('/', (req, res) => {
    res.send(`
        <h1>Static Test Server</h1>
        <p>Available endpoints:</p>
        <ul>
            <li><a href="/company-profile?id=67759a35d7f4833f3e6ff3d8">Company Profile Test</a></li>
            <li><a href="/api/company/67759a35d7f4833f3e6ff3d8">Mock Company API</a></li>
        </ul>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 Static test server running at http://localhost:${PORT}`);
    console.log(`📋 Test company profile: http://localhost:${PORT}/company-profile?id=67759a35d7f4833f3e6ff3d8`);
});
