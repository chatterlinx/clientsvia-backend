// tests/policy-compiler.test.js
// ============================================================================
// POLICY COMPILER INTEGRATION TEST
// ============================================================================
// TESTS:
//   1. Schema validation (cheat sheet structure)
//   2. Policy compilation (schema → artifact)
//   3. Conflict detection (overlapping patterns)
//   4. Redis caching (namespaced keys)
//   5. MongoDB updates (checksum, lastCompiledAt)
//   6. Optimistic locking (race condition prevention)
// ============================================================================

const mongoose = require('mongoose');
const Redis = require('ioredis');
const PolicyCompiler = require('../services/PolicyCompiler');
const Company = require('../models/v2Company');

// Test configuration
const TEST_MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/clientsvia_test';
const TEST_REDIS_CONFIG = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  db: 15 // Use separate DB for tests
};

let redis;

// ═══════════════════════════════════════════════════════════════════
// SETUP & TEARDOWN
// ═══════════════════════════════════════════════════════════════════

beforeAll(async () => {
  // Connect to test database
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(TEST_MONGODB_URI);
  }
  
  // Connect to test Redis
  redis = new Redis(TEST_REDIS_CONFIG);
  
  console.log('✅ Test environment ready');
});

afterAll(async () => {
  // Cleanup test data
  await Company.deleteMany({ companyName: /^TEST_/ });
  
  // Close connections
  await mongoose.connection.close();
  await redis.quit();
  
  console.log('✅ Test cleanup complete');
});

beforeEach(async () => {
  // Clear test Redis DB
  await redis.flushdb();
});

// ═══════════════════════════════════════════════════════════════════
// TEST 1: Schema Validation
// ═══════════════════════════════════════════════════════════════════

describe('PolicyCompiler - Schema Validation', () => {
  
  test('should accept valid cheat sheet structure', async () => {
    const company = new Company({
      companyName: 'TEST_Schema_Valid',
      aiAgentSettings: {
        cheatSheet: {
          version: 1,
          status: 'draft',
          updatedBy: 'test@example.com',
          
          behaviorRules: ['ACK_OK', 'USE_COMPANY_NAME'],
          
          edgeCases: [{
            id: 'ec-test-1',
            name: 'Machine Detection',
            triggerPatterns: ['machine', 'robot', 'ai'],
            responseText: "I'm here to help!",
            priority: 10,
            enabled: true
          }],
          
          transferRules: [{
            id: 'tr-test-1',
            intentTag: 'billing',
            contactNameOrQueue: 'billing_team',
            script: 'Transferring to billing...',
            collectEntities: [{
              name: 'phone',
              type: 'PHONE',
              required: true,
              prompt: 'May I have your phone number?'
            }],
            priority: 10,
            enabled: true
          }],
          
          guardrails: ['NO_PRICES', 'NO_PHONE_NUMBERS'],
          allowedActions: ['TAKE_MESSAGE', 'TRANSFER_BILLING']
        }
      }
    });
    
    const error = company.validateSync();
    expect(error).toBeUndefined();
    
    await company.save();
    expect(company._id).toBeDefined();
    
    console.log('  ✅ Valid cheat sheet structure accepted');
  });
  
  test('should reject invalid behavior rule enum', async () => {
    const company = new Company({
      companyName: 'TEST_Schema_Invalid',
      aiAgentSettings: {
        cheatSheet: {
          behaviorRules: ['INVALID_RULE'] // Not in enum
        }
      }
    });
    
    const error = company.validateSync();
    expect(error).toBeDefined();
    expect(error.errors['aiAgentSettings.cheatSheet.behaviorRules.0']).toBeDefined();
    
    console.log('  ✅ Invalid enum rejected');
  });
  
  test('should require edge case fields', async () => {
    const company = new Company({
      companyName: 'TEST_Schema_Missing',
      aiAgentSettings: {
        cheatSheet: {
          edgeCases: [{
            id: 'ec-incomplete'
            // Missing name, triggerPatterns, responseText
          }]
        }
      }
    });
    
    const error = company.validateSync();
    expect(error).toBeDefined();
    
    console.log('  ✅ Required fields enforced');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 2: Policy Compilation
// ═══════════════════════════════════════════════════════════════════

describe('PolicyCompiler - Compilation', () => {
  
  test('should compile cheat sheet to runtime artifact', async () => {
    // Create test company
    const company = await Company.create({
      companyName: 'TEST_Compile_Basic',
      aiAgentSettings: {
        cheatSheet: {
          version: 1,
          status: 'draft',
          updatedBy: 'test@example.com',
          
          behaviorRules: ['ACK_OK'],
          
          edgeCases: [{
            id: 'ec-1',
            name: 'Machine Detection',
            triggerPatterns: ['machine', 'robot'],
            responseText: "I'm here to help!",
            priority: 10,
            enabled: true
          }],
          
          guardrails: ['NO_PRICES']
        }
      }
    });
    
    // Compile
    const result = await PolicyCompiler.compile(
      company._id,
      company.aiAgentSettings.cheatSheet
    );
    
    // Verify result structure
    expect(result.success).toBe(true);
    expect(result.artifact).toBeDefined();
    expect(result.checksum).toBeDefined();
    expect(result.redisKey).toBeDefined();
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/); // SHA-256
    
    // Verify artifact structure
    expect(result.artifact.companyId).toBe(company._id.toString());
    expect(result.artifact.version).toBe(1);
    expect(result.artifact.behaviorFlags).toBeInstanceOf(Set);
    expect(result.artifact.behaviorFlags.has('ACK_OK')).toBe(true);
    expect(result.artifact.edgeCases).toHaveLength(1);
    expect(result.artifact.edgeCases[0].patterns[0]).toBeInstanceOf(RegExp);
    
    console.log('  ✅ Compilation successful');
    console.log('  📦 Checksum:', result.checksum.substring(0, 16) + '...');
    console.log('  🔑 Redis key:', result.redisKey);
  });
  
  test('should cache artifact in Redis', async () => {
    const company = await Company.create({
      companyName: 'TEST_Compile_Redis',
      aiAgentSettings: {
        cheatSheet: {
          version: 1,
          status: 'draft',
          behaviorRules: ['ACK_OK'],
          edgeCases: []
        }
      }
    });
    
    const result = await PolicyCompiler.compile(
      company._id,
      company.aiAgentSettings.cheatSheet
    );
    
    // Check Redis
    const cached = await redis.get(result.redisKey);
    expect(cached).toBeDefined();
    
    const parsed = JSON.parse(cached);
    expect(parsed.checksum).toBe(result.checksum);
    expect(parsed.version).toBe(1);
    
    console.log('  ✅ Artifact cached in Redis');
  });
  
  test('should update company record with checksum', async () => {
    const company = await Company.create({
      companyName: 'TEST_Compile_MongoDB',
      aiAgentSettings: {
        cheatSheet: {
          version: 1,
          status: 'draft',
          behaviorRules: []
        }
      }
    });
    
    const result = await PolicyCompiler.compile(
      company._id,
      company.aiAgentSettings.cheatSheet
    );
    
    // Reload company from DB
    const updated = await Company.findById(company._id);
    
    expect(updated.aiAgentSettings.cheatSheet.checksum).toBe(result.checksum);
    expect(updated.aiAgentSettings.cheatSheet.lastCompiledAt).toBeDefined();
    
    console.log('  ✅ MongoDB record updated');
  });
  
  test('should set active pointer for active policies', async () => {
    const company = await Company.create({
      companyName: 'TEST_Compile_Active',
      aiAgentSettings: {
        cheatSheet: {
          version: 1,
          status: 'active', // Important!
          behaviorRules: []
        }
      }
    });
    
    const result = await PolicyCompiler.compile(
      company._id,
      company.aiAgentSettings.cheatSheet
    );
    
    // Check active pointer
    const activeKey = await redis.get(`policy:${company._id}:active`);
    expect(activeKey).toBe(result.redisKey);
    
    console.log('  ✅ Active pointer set');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 3: Conflict Detection
// ═══════════════════════════════════════════════════════════════════

describe('PolicyCompiler - Conflict Detection', () => {
  
  test('should detect edge case conflicts', async () => {
    const company = await Company.create({
      companyName: 'TEST_Conflict_EdgeCase',
      aiAgentSettings: {
        cheatSheet: {
          version: 1,
          status: 'draft',
          
          edgeCases: [
            {
              id: 'ec-1',
              name: 'Machine Detection',
              triggerPatterns: ['machine', 'robot', 'ai'],
              responseText: 'Response 1',
              priority: 10, // SAME PRIORITY
              enabled: true
            },
            {
              id: 'ec-2',
              name: 'AI Detection',
              triggerPatterns: ['robot', 'ai', 'automated'], // OVERLAP!
              responseText: 'Response 2',
              priority: 10, // SAME PRIORITY
              enabled: true
            }
          ]
        }
      }
    });
    
    const result = await PolicyCompiler.compile(
      company._id,
      company.aiAgentSettings.cheatSheet
    );
    
    // Should detect conflict
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].type).toBe('EDGE_CASE_CONFLICT');
    expect(result.conflicts[0].rule1).toBe('ec-1');
    expect(result.conflicts[0].rule2).toBe('ec-2');
    expect(result.conflicts[0].overlapScore).toBeGreaterThan(0.3);
    
    console.log('  ✅ Conflict detected');
    console.log('  ⚠️  Overlap score:', result.conflicts[0].overlapScore.toFixed(2));
  });
  
  test('should auto-resolve conflicts by demoting later rule', async () => {
    const company = await Company.create({
      companyName: 'TEST_Conflict_AutoResolve',
      aiAgentSettings: {
        cheatSheet: {
          version: 1,
          status: 'draft',
          
          edgeCases: [
            {
              id: 'ec-1',
              name: 'First Rule',
              triggerPatterns: ['test', 'check'],
              responseText: 'Response 1',
              priority: 5,
              enabled: true
            },
            {
              id: 'ec-2',
              name: 'Second Rule',
              triggerPatterns: ['test', 'verify'], // Overlaps with first
              responseText: 'Response 2',
              priority: 5, // Same priority
              enabled: true
            }
          ]
        }
      }
    });
    
    const cheatSheet = company.aiAgentSettings.cheatSheet;
    const originalPriority = cheatSheet.edgeCases[1].priority;
    
    const result = await PolicyCompiler.compile(company._id, cheatSheet);
    
    // Should auto-demote second rule
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].resolution).toBe('AUTO_DEMOTE_LATER');
    
    // Check that priority was modified
    const demotedRule = cheatSheet.edgeCases.find(ec => ec.id === 'ec-2');
    expect(demotedRule.priority).toBe(originalPriority + 1);
    
    console.log('  ✅ Conflict auto-resolved');
    console.log('  📉 Priority demoted:', originalPriority, '→', demotedRule.priority);
  });
  
  test('should not detect conflict if priorities differ', async () => {
    const company = await Company.create({
      companyName: 'TEST_NoConflict_DiffPriority',
      aiAgentSettings: {
        cheatSheet: {
          version: 1,
          status: 'draft',
          
          edgeCases: [
            {
              id: 'ec-1',
              name: 'High Priority',
              triggerPatterns: ['urgent', 'emergency'],
              responseText: 'Response 1',
              priority: 1, // HIGH
              enabled: true
            },
            {
              id: 'ec-2',
              name: 'Low Priority',
              triggerPatterns: ['urgent', 'help'], // Same words
              responseText: 'Response 2',
              priority: 10, // LOW (different!)
              enabled: true
            }
          ]
        }
      }
    });
    
    const result = await PolicyCompiler.compile(
      company._id,
      company.aiAgentSettings.cheatSheet
    );
    
    // No conflict (different priorities)
    expect(result.conflicts).toHaveLength(0);
    
    console.log('  ✅ No conflict (different priorities)');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 4: Optimistic Locking
// ═══════════════════════════════════════════════════════════════════

describe('PolicyCompiler - Optimistic Locking', () => {
  
  test('should prevent concurrent compilations', async () => {
    const company = await Company.create({
      companyName: 'TEST_Lock_Concurrent',
      aiAgentSettings: {
        cheatSheet: {
          version: 1,
          status: 'draft',
          behaviorRules: []
        }
      }
    });
    
    // Start first compilation (don't await)
    const promise1 = PolicyCompiler.compile(
      company._id,
      company.aiAgentSettings.cheatSheet
    );
    
    // Immediately try second compilation (should fail)
    const promise2 = PolicyCompiler.compile(
      company._id,
      company.aiAgentSettings.cheatSheet
    );
    
    // One should succeed, one should fail
    const results = await Promise.allSettled([promise1, promise2]);
    
    const succeeded = results.filter(r => r.status === 'fulfilled');
    const failed = results.filter(r => r.status === 'rejected');
    
    expect(succeeded).toHaveLength(1);
    expect(failed).toHaveLength(1);
    expect(failed[0].reason.message).toMatch(/lock/i);
    
    console.log('  ✅ Concurrent compilation prevented');
    console.log('  🔒 Lock protected race condition');
  });
  
  test('should release lock after compilation', async () => {
    const company = await Company.create({
      companyName: 'TEST_Lock_Release',
      aiAgentSettings: {
        cheatSheet: {
          version: 1,
          status: 'draft',
          behaviorRules: []
        }
      }
    });
    
    // First compilation
    await PolicyCompiler.compile(
      company._id,
      company.aiAgentSettings.cheatSheet
    );
    
    // Check lock is released
    const updated = await Company.findById(company._id);
    expect(updated.aiAgentSettings.cheatSheet.compileLock).toBeNull();
    
    // Second compilation should succeed
    const result = await PolicyCompiler.compile(
      company._id,
      company.aiAgentSettings.cheatSheet
    );
    
    expect(result.success).toBe(true);
    
    console.log('  ✅ Lock released after compilation');
  });
  
  test('should release lock even on error', async () => {
    const company = await Company.create({
      companyName: 'TEST_Lock_Error',
      aiAgentSettings: {
        cheatSheet: {
          version: 1,
          status: 'draft',
          
          edgeCases: [{
            id: 'ec-bad',
            name: 'Bad Pattern',
            triggerPatterns: ['[invalid regex ('], // Invalid regex!
            responseText: 'Response',
            priority: 10,
            enabled: true
          }]
        }
      }
    });
    
    // Compilation will fail (invalid regex)
    try {
      await PolicyCompiler.compile(
        company._id,
        company.aiAgentSettings.cheatSheet
      );
    } catch (err) {
      // Expected to fail
    }
    
    // Lock should still be released
    const updated = await Company.findById(company._id);
    expect(updated.aiAgentSettings.cheatSheet.compileLock).toBeNull();
    
    console.log('  ✅ Lock released even on error');
  });
});

// ═══════════════════════════════════════════════════════════════════
// TEST 5: Runtime Artifact Structure
// ═══════════════════════════════════════════════════════════════════

describe('PolicyCompiler - Artifact Structure', () => {
  
  test('should sort edge cases by priority', async () => {
    const company = await Company.create({
      companyName: 'TEST_Artifact_Sort',
      aiAgentSettings: {
        cheatSheet: {
          version: 1,
          status: 'draft',
          
          edgeCases: [
            { id: 'ec-low', name: 'Low', triggerPatterns: ['a'], responseText: 'A', priority: 10, enabled: true },
            { id: 'ec-high', name: 'High', triggerPatterns: ['b'], responseText: 'B', priority: 1, enabled: true },
            { id: 'ec-mid', name: 'Mid', triggerPatterns: ['c'], responseText: 'C', priority: 5, enabled: true }
          ]
        }
      }
    });
    
    const result = await PolicyCompiler.compile(
      company._id,
      company.aiAgentSettings.cheatSheet
    );
    
    // Should be sorted by priority (low number = high priority = first)
    expect(result.artifact.edgeCases[0].id).toBe('ec-high');
    expect(result.artifact.edgeCases[1].id).toBe('ec-mid');
    expect(result.artifact.edgeCases[2].id).toBe('ec-low');
    
    console.log('  ✅ Edge cases sorted by priority');
  });
  
  test('should pre-compile regex patterns', async () => {
    const company = await Company.create({
      companyName: 'TEST_Artifact_Regex',
      aiAgentSettings: {
        cheatSheet: {
          version: 1,
          status: 'draft',
          
          edgeCases: [{
            id: 'ec-regex',
            name: 'Test',
            triggerPatterns: ['machine', 'robot'],
            responseText: 'Response',
            priority: 10,
            enabled: true
          }]
        }
      }
    });
    
    const result = await PolicyCompiler.compile(
      company._id,
      company.aiAgentSettings.cheatSheet
    );
    
    // Patterns should be RegExp objects
    expect(result.artifact.edgeCases[0].patterns).toHaveLength(2);
    expect(result.artifact.edgeCases[0].patterns[0]).toBeInstanceOf(RegExp);
    expect(result.artifact.edgeCases[0].patterns[0].test('MACHINE')).toBe(true); // Case insensitive
    
    console.log('  ✅ Regex patterns pre-compiled');
  });
  
  test('should filter out disabled rules', async () => {
    const company = await Company.create({
      companyName: 'TEST_Artifact_Filter',
      aiAgentSettings: {
        cheatSheet: {
          version: 1,
          status: 'draft',
          
          edgeCases: [
            { id: 'ec-enabled', name: 'Enabled', triggerPatterns: ['a'], responseText: 'A', priority: 10, enabled: true },
            { id: 'ec-disabled', name: 'Disabled', triggerPatterns: ['b'], responseText: 'B', priority: 10, enabled: false }
          ]
        }
      }
    });
    
    const result = await PolicyCompiler.compile(
      company._id,
      company.aiAgentSettings.cheatSheet
    );
    
    // Only enabled rule should be in artifact
    expect(result.artifact.edgeCases).toHaveLength(1);
    expect(result.artifact.edgeCases[0].id).toBe('ec-enabled');
    
    console.log('  ✅ Disabled rules filtered out');
  });
});

// ═══════════════════════════════════════════════════════════════════
// RUN TESTS
// ═══════════════════════════════════════════════════════════════════

console.log('\n🧪 PolicyCompiler Integration Tests\n');
console.log('Starting tests...\n');

