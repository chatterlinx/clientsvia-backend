const express = require('express');
const path = require('path');

const app = express();
const PORT = 3001;

// Parse JSON bodies
app.use(express.json());

// Serve static files from public directory
app.use(express.static('public'));

// Mock company API endpoint for testing
app.get('/api/companies/:id', (req, res) => {
    const companyId = req.params.id;
    console.log('📡 Mock API: Company data requested for ID:', companyId);
    
    // Return mock company data with all needed fields
    const mockCompany = {
        _id: companyId,
        companyName: "Penguin Air Solutions",
        businessPhone: "+1-555-123-4567",
        businessEmail: "contact@penguinair.com",
        businessAddress: "123 HVAC Street, Cool City, CA 90210",
        businessWebsite: "https://penguinair.com",
        description: "Professional HVAC services for residential and commercial properties",
        serviceArea: "Greater Los Angeles Area",
        businessHours: "Monday-Friday: 8:00 AM - 6:00 PM, Saturday: 9:00 AM - 4:00 PM",
        tradeTypes: ["HVAC", "Air Conditioning", "Heating"],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    
    res.json(mockCompany);
});

// Mock company update endpoint
app.patch('/api/companies/:id', (req, res) => {
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
            <li><a href="/api/companies/67759a35d7f4833f3e6ff3d8">Mock Company API</a></li>
        </ul>
    `);
});

app.listen(PORT, () => {
    console.log(`🚀 Static test server running at http://localhost:${PORT}`);
    console.log(`📋 Test company profile: http://localhost:${PORT}/company-profile?id=67759a35d7f4833f3e6ff3d8`);
});
