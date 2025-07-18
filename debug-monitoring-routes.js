/**
 * Debug monitoring routes loading
 */

const express = require('express');
const app = express();

console.log('🔍 Testing monitoring routes loading...');

try {
    const monitoringRoutes = require('./routes/monitoring');
    console.log('✅ monitoring routes loaded successfully');
    console.log('📊 Route object type:', typeof monitoringRoutes);
    console.log('📊 Route object keys:', Object.keys(monitoringRoutes));
    
    // Test the specific route
    app.use('/api/monitoring', monitoringRoutes);
    console.log('✅ Monitoring routes registered');
    
    // Test a simple route
    app.get('/test', (req, res) => {
        res.json({ message: 'Test route works' });
    });
    
    const server = app.listen(3001, () => {
        console.log('🚀 Test server running on port 3001');
        console.log('📡 Test URL: http://localhost:3001/api/monitoring/dashboard/686a680241806a4991f7367f');
        
        // Auto-shutdown after 30 seconds
        setTimeout(() => {
            server.close();
            console.log('⏹️ Test server stopped');
            process.exit(0);
        }, 30000);
    });
    
} catch (error) {
    console.error('❌ Error loading monitoring routes:', error);
    console.error('📍 Error stack:', error.stack);
    process.exit(1);
}
