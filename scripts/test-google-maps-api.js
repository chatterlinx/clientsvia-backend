#!/usr/bin/env node
/**
 * Test Google Maps Geocoding API
 * 
 * Usage: 
 *   node scripts/test-google-maps-api.js
 *   GOOGLE_MAPS_API_KEY=your_key node scripts/test-google-maps-api.js
 */

require('dotenv').config();

const GOOGLE_MAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;

async function testGeocodingAPI() {
    console.log('\n🗺️  GOOGLE MAPS API TEST');
    console.log('═'.repeat(50));
    
    // Check if API key exists
    if (!GOOGLE_MAPS_API_KEY) {
        console.log('❌ GOOGLE_MAPS_API_KEY not found in environment');
        console.log('   Add it to .env or run with:');
        console.log('   GOOGLE_MAPS_API_KEY=your_key node scripts/test-google-maps-api.js');
        process.exit(1);
    }
    
    console.log('✅ API Key found:', GOOGLE_MAPS_API_KEY.substring(0, 10) + '...');
    
    // Test addresses
    const testAddresses = [
        '4155 metro parkway fort myers florida',
        '123 main st',
        '1600 Amphitheatre Parkway, Mountain View, CA'
    ];
    
    for (const address of testAddresses) {
        console.log('\n📍 Testing:', address);
        console.log('-'.repeat(40));
        
        try {
            const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
            url.searchParams.set('address', address);
            url.searchParams.set('key', GOOGLE_MAPS_API_KEY);
            url.searchParams.set('region', 'us');
            
            const startTime = Date.now();
            const response = await fetch(url.toString());
            const data = await response.json();
            const latency = Date.now() - startTime;
            
            if (data.status === 'OK' && data.results?.length > 0) {
                const result = data.results[0];
                console.log('✅ Status:', data.status);
                console.log('📌 Formatted:', result.formatted_address);
                console.log('🎯 Location:', result.geometry?.location);
                console.log('📊 Types:', result.types?.join(', '));
                console.log('⏱️  Latency:', latency + 'ms');
            } else {
                console.log('❌ Status:', data.status);
                console.log('   Error:', data.error_message || 'No results');
            }
        } catch (error) {
            console.log('❌ Error:', error.message);
        }
    }
    
    console.log('\n' + '═'.repeat(50));
    console.log('🏁 Test complete!\n');
}

testGeocodingAPI();
