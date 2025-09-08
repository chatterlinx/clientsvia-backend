#!/usr/bin/env node

/**
 * Production Q&A Migration Script
 * This script can be run on production to fix Q&A trade category associations
 */

const axios = require('axios');

const PRODUCTION_URL = 'https://clientsvia-backend.onrender.com';

async function migrateProductionQnA() {
  try {
    console.log('🔄 Starting production Q&A migration...');
    
    // First, let's check what trade categories exist
    const categoriesResponse = await axios.get(`${PRODUCTION_URL}/api/enterprise-trade-categories?companyId=global`);
    console.log('📊 Current trade categories:', categoriesResponse.data.data.length);
    
    categoriesResponse.data.data.forEach(cat => {
      console.log(`  - ${cat.name}: ${cat.qnas.length} Q&As loaded, metadata says ${cat.metadata?.totalQAs || 0} Q&As`);
    });
    
    // Check if we can access a direct Q&A endpoint to see what Q&As exist
    console.log('\n🔍 Attempting to check Q&A data...');
    
    // Try to access company Q&As for a specific company
    const companies = ['68813026dd95f599c74e49c7', 'global'];
    
    for (const companyId of companies) {
      try {
        console.log(`\n📋 Checking Q&As for company: ${companyId}`);
        
        // Try different Q&A endpoints that might exist
        const endpoints = [
          `/api/enterprise-trade-categories/qnas/${companyId}`,
          `/api/company/${companyId}/knowledge`,
          `/api/knowledge/company/${companyId}`,
          `/api/qna/${companyId}`
        ];
        
        for (const endpoint of endpoints) {
          try {
            const response = await axios.get(`${PRODUCTION_URL}${endpoint}`);
            console.log(`✅ Found data at ${endpoint}:`, response.data);
            break;
          } catch (err) {
            console.log(`❌ No data at ${endpoint}: ${err.response?.status || err.message}`);
          }
        }
      } catch (err) {
        console.log(`❌ Error checking company ${companyId}:`, err.message);
      }
    }
    
  } catch (error) {
    console.error('❌ Production migration failed:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
  }
}

// Run the migration
migrateProductionQnA().then(() => {
  console.log('\n🎉 Production migration analysis completed');
}).catch(error => {
  console.error('💥 Migration failed:', error.message);
});
