const express = require('express');
const path = require('path');

const app = express();
const PORT = 3001;

// Middleware
app.use(express.json());
app.use(express.static('public'));

// Test company data
let testCompany = {
    _id: 'test-company-id',
    companyName: 'Test Company',
    twilioConfig: {
        accountSid: 'AC123456789',
        authToken: 'test-token',
        phoneNumbers: [
            {
                phoneNumber: '+12395551212',
                friendlyName: 'Primary Number',
                status: 'active',
                isPrimary: true
            }
        ]
    }
};

// Basic company routes
app.get('/api/company/:id', (req, res) => {
    console.log('GET /api/company/:id - Request for ID:', req.params.id);
    console.log('GET /api/company/:id - Returning company data:', JSON.stringify(testCompany, null, 2));
    res.json(testCompany);
});

app.patch('/api/company/:id', (req, res) => {
    console.log('🔧 PATCH /api/company/:id - Request for ID:', req.params.id);
    console.log('🔧 PATCH /api/company/:id - Request body:', JSON.stringify(req.body, null, 2));
    
    try {
        // Merge the update data
        if (req.body.twilioConfig) {
            console.log('🔧 Updating twilioConfig...');
            testCompany.twilioConfig = { ...testCompany.twilioConfig, ...req.body.twilioConfig };
            console.log('🔧 New twilioConfig:', JSON.stringify(testCompany.twilioConfig, null, 2));
        }
        
        // Update other fields
        Object.keys(req.body).forEach(key => {
            if (key !== 'twilioConfig') {
                console.log(`🔧 Updating ${key}:`, req.body[key]);
                testCompany[key] = req.body[key];
            }
        });
        
        console.log('✅ PATCH /api/company/:id - Successfully updated company');
        console.log('✅ PATCH /api/company/:id - Final company data:', JSON.stringify(testCompany, null, 2));
        
        res.json(testCompany);
    } catch (error) {
        console.error('❌ PATCH /api/company/:id - Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Serve the company profile page
app.get('/company-profile.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'company-profile.html'));
});

app.listen(PORT, () => {
    console.log(`🚀 Test server running on http://localhost:${PORT}`);
    console.log(`📄 Test page: http://localhost:${PORT}/company-profile.html?id=test-company-id`);
});
