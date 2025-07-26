#!/usr/bin/env node

/**
 * Test script for ElevenLabs voice integration
 * Tests both backend API and simulates frontend behavior
 */

const fetch = require('node-fetch');

const BASE_URL = 'http://localhost:3000';
const TEST_COMPANY_ID = '6885355ad1140d00583b6e82';

console.log('🎙️ Testing ElevenLabs Voice Integration');
console.log('=====================================');

async function testVoicesEndpoint() {
  console.log('\n1. Testing voices endpoint...');
  
  try {
    const response = await fetch(`${BASE_URL}/api/elevenlabs/voices?companyId=${TEST_COMPANY_ID}`);
    const data = await response.json();
    
    if (data.success && data.voices && data.voices.length > 0) {
      console.log(`✅ Voices endpoint: Found ${data.count} voices`);
      
      // Check for Mark voice specifically
      const markVoice = data.voices.find(v => v.name.toLowerCase().includes('mark'));
      if (markVoice) {
        console.log(`✅ Mark voice found: ${markVoice.name} (${markVoice.voice_id})`);
      } else {
        console.log('⚠️ Mark voice not found in results');
      }
      
      return data.voices;
    } else {
      console.log('❌ Voices endpoint failed:', data.message || 'Unknown error');
      return [];
    }
  } catch (error) {
    console.log('❌ Voices endpoint error:', error.message);
    return [];
  }
}

async function testCompanyVoicesEndpoint() {
  console.log('\n2. Testing company-specific voices endpoint...');
  
  try {
    const response = await fetch(`${BASE_URL}/api/elevenlabs/companies/${TEST_COMPANY_ID}/voices`);
    const data = await response.json();
    
    if (data.success && data.voices && data.voices.length > 0) {
      console.log(`✅ Company voices endpoint: Found ${data.count} voices`);
      console.log(`✅ Company: ${data.company.name} (useOwnApi: ${data.company.useOwnApi})`);
      
      if (data.isMockData) {
        console.log('🎭 Using mock data (expected for testing)');
      }
      
      return data.voices;
    } else {
      console.log('❌ Company voices endpoint failed:', data.message || 'Unknown error');
      return [];
    }
  } catch (error) {
    console.log('❌ Company voices endpoint error:', error.message);
    return [];
  }
}

async function simulateFrontendVoiceSelection(voices) {
  console.log('\n3. Simulating frontend voice selection logic...');
  
  if (!voices || voices.length === 0) {
    console.log('❌ No voices available for frontend simulation');
    return;
  }
  
  // Simulate auto-selection of first voice
  const firstVoice = voices[0];
  console.log(`🎯 Auto-selecting first voice: ${firstVoice.name} (${firstVoice.voice_id})`);
  
  // Check if voice ID is valid
  if (!firstVoice.voice_id || firstVoice.voice_id === 'undefined') {
    console.log('❌ First voice has invalid voice_id');
    return;
  }
  
  console.log('✅ Voice selection simulation successful');
  
  // Simulate Mark voice selection
  const markVoice = voices.find(v => v.name.toLowerCase().includes('mark'));
  if (markVoice) {
    console.log(`🎯 Mark voice selection: ${markVoice.name} (${markVoice.voice_id})`);
    
    if (!markVoice.voice_id || markVoice.voice_id === 'undefined') {
      console.log('❌ Mark voice has invalid voice_id');
    } else {
      console.log('✅ Mark voice selection valid');
    }
  }
}

async function testCompanyDataSaving() {
  console.log('\n4. Testing company data saving with voice...');
  
  try {
    // First get current company data
    const getResponse = await fetch(`${BASE_URL}/api/company/${TEST_COMPANY_ID}`);
    const companyData = await getResponse.json();
    
    if (!companyData) {
      console.log('❌ Could not fetch company data');
      return;
    }
    
    // Prepare update with voice data
    const updateData = {
      ...companyData,
      aiSettings: {
        ...companyData.aiSettings,
        elevenLabs: {
          ...companyData.aiSettings?.elevenLabs,
          voiceId: 'Mark-mock-id',
          useOwnApiKey: false
        }
      }
    };
    
    // Save the data
    const saveResponse = await fetch(`${BASE_URL}/api/company/${TEST_COMPANY_ID}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateData)
    });
    
    const saveResult = await saveResponse.json();
    
    if (saveResponse.ok && saveResult) {
      console.log('✅ Company data saved successfully');
      
      // Verify the voice was saved
      if (saveResult.aiSettings?.elevenLabs?.voiceId === 'Mark-mock-id') {
        console.log('✅ Voice ID saved correctly: Mark-mock-id');
      } else {
        console.log('⚠️ Voice ID not saved correctly:', saveResult.aiSettings?.elevenLabs?.voiceId);
      }
    } else {
      console.log('❌ Company data save failed:', saveResult?.message || 'Unknown error');
    }
  } catch (error) {
    console.log('❌ Company data save error:', error.message);
  }
}

async function runTests() {
  console.log(`🧪 Test Company ID: ${TEST_COMPANY_ID}`);
  console.log(`🌐 Base URL: ${BASE_URL}`);
  
  const voices1 = await testVoicesEndpoint();
  const voices2 = await testCompanyVoicesEndpoint();
  
  // Use whichever endpoint returned voices
  const voices = voices1.length > 0 ? voices1 : voices2;
  
  await simulateFrontendVoiceSelection(voices);
  await testCompanyDataSaving();
  
  console.log('\n🎉 ElevenLabs voice integration test complete!');
  console.log('\nNext steps:');
  console.log('- Open the company profile page in browser');
  console.log('- Navigate to the Voice tab');
  console.log('- Verify voices load without "undefined" values');
  console.log('- Test voice selection and saving');
  console.log('- Ensure loading spinner doesn\'t get stuck');
}

if (require.main === module) {
  runTests().catch(console.error);
}

module.exports = { runTests };
