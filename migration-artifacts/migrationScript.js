
/**
 * Database Migration: Single Tenant → Multi-Tenant
 */
async function migrateDatabaseToMultiTenant() {
  const db = require('./db.js');
  
  console.log('🔄 Starting database migration to multi-tenant structure...');

  // 1. Add tenant fields to existing collections
  await db.collection('knowledge_entries').updateMany(
    { tenantId: { $exists: false } },
    { 
      $set: { 
        tenantId: 'hvac_default_tenant',
        industryType: 'hvac',
        createdAt: new Date(),
        migratedFrom: 'single_tenant'
      }
    }
  );

  // 2. Create tenant registry
  await db.collection('tenants').insertOne({
    tenantId: 'hvac_default_tenant',
    companyName: 'Default HVAC Company',
    industryType: 'hvac',
    config: {
      pricing: { service_call: 49, maintenance: 89 },
      branding: { tone: 'professional_technical' },
      compliance: { epa_certified: true }
    },
    status: 'active',
    createdAt: new Date()
  });

  // 3. Create indexes for multi-tenant queries
  await db.collection('knowledge_entries').createIndex({ tenantId: 1, category: 1 });
  await db.collection('conversations').createIndex({ tenantId: 1, createdAt: -1 });

  console.log('✅ Database migration completed');
}