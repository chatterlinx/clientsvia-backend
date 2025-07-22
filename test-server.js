const express = require('express');
const path = require('path');

const app = express();
const PORT = 3001;

// Serve static files from public directory
app.use(express.static('public'));

// Mock company API endpoint for testing
app.get('/api/companies/:id', (req, res) => {
    const companyId = req.params.id;
    console.log('📡 Mock API: Company data requested for ID:', companyId);
    
    // Return mock company data
    const mockCompany = {
        _id: companyId,
        name: "Test Company Inc.",
        email: "contact@testcompany.com",
        phone: "+1-555-123-4567",
        website: "https://testcompany.com",
        address: {
            street: "123 Business Ave",
            city: "Test City",
            state: "TS",
            zipCode: "12345",
            country: "USA"
        },
        agentSetup: {
            behaviors: {
                greeting: "Hello! How can I help you today?",
                farewell: "Thank you for calling. Have a great day!"
            },
            timezone: "America/New_York"
        },
        tradeTypes: ["Plumbing", "Electrical", "HVAC"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    res.json(mockCompany);
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
            <li><a href="/api/companies/67759a35d7f4833f3e6ff3d8">Mock Company API</a></li>
        </ul>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 Static test server running at http://localhost:${PORT}`);
    console.log(`📋 Test company profile: http://localhost:${PORT}/company-profile?id=67759a35d7f4833f3e6ff3d8`);
});
