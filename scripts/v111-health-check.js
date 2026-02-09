#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * V111 HEALTH CHECK - Verify all Conversation Memory components
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Run: node scripts/v111-health-check.js [companyId]
 * 
 * Checks:
 * 1. Module imports (ConversationMemory, TurnRecordBuilder, V111Router, etc.)
 * 2. Redis connection
 * 3. MongoDB connection
 * 4. Company V111 config loading
 * 5. BlackBox event types
 * 6. End-to-end simulation
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const path = require('path');

// Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

const CHECK = `${colors.green}✓${colors.reset}`;
const FAIL = `${colors.red}✗${colors.reset}`;
const WARN = `${colors.yellow}⚠${colors.reset}`;
const INFO = `${colors.cyan}ℹ${colors.reset}`;

let passCount = 0;
let failCount = 0;
let warnCount = 0;

function pass(msg, detail = '') {
  passCount++;
  console.log(`  ${CHECK} ${msg}${detail ? colors.dim + ' - ' + detail + colors.reset : ''}`);
}

function fail(msg, detail = '') {
  failCount++;
  console.log(`  ${FAIL} ${msg}${detail ? colors.dim + ' - ' + detail + colors.reset : ''}`);
}

function warn(msg, detail = '') {
  warnCount++;
  console.log(`  ${WARN} ${msg}${detail ? colors.dim + ' - ' + detail + colors.reset : ''}`);
}

function info(msg) {
  console.log(`  ${INFO} ${msg}`);
}

function section(title) {
  console.log(`\n${colors.cyan}═══ ${title} ═══${colors.reset}`);
}

async function main() {
  const companyId = process.argv[2] || '68e3f77a9d623b8058c700c4'; // Default test company
  
  console.log(`
${colors.cyan}╔═══════════════════════════════════════════════════════════════╗
║           V111 CONVERSATION MEMORY HEALTH CHECK               ║
╚═══════════════════════════════════════════════════════════════╝${colors.reset}
`);
  console.log(`Company ID: ${companyId}`);
  console.log(`Timestamp: ${new Date().toISOString()}`);

  // ═══════════════════════════════════════════════════════════════════════════
  // 1. MODULE IMPORTS
  // ═══════════════════════════════════════════════════════════════════════════
  section('1. MODULE IMPORTS');
  
  let ConversationMemory, TurnRecordBuilder, V111Router, TranscriptGenerator, CallTranscript;
  
  try {
    ConversationMemory = require('../services/engine/ConversationMemory');
    pass('ConversationMemory', `Version: ${ConversationMemory.VERSION || 'unknown'}`);
  } catch (e) {
    fail('ConversationMemory', e.message);
  }
  
  try {
    TurnRecordBuilder = require('../services/engine/TurnRecordBuilder');
    pass('TurnRecordBuilder', `Version: ${TurnRecordBuilder.VERSION || 'unknown'}`);
  } catch (e) {
    fail('TurnRecordBuilder', e.message);
  }
  
  try {
    V111Router = require('../services/engine/V111Router');
    pass('V111Router', `Version: ${V111Router.VERSION || 'unknown'}`);
  } catch (e) {
    fail('V111Router', e.message);
  }
  
  try {
    TranscriptGenerator = require('../services/TranscriptGenerator');
    pass('TranscriptGenerator', `Version: ${TranscriptGenerator.VERSION || 'unknown'}`);
  } catch (e) {
    fail('TranscriptGenerator', e.message);
  }
  
  try {
    CallTranscript = require('../models/CallTranscript');
    pass('CallTranscript model');
  } catch (e) {
    fail('CallTranscript model', e.message);
  }
  
  try {
    const BlackBoxRecording = require('../models/BlackBoxRecording');
    const eventTypes = BlackBoxRecording.schema?.path('events.type')?.enumValues || [];
    const hasTurnRecorded = eventTypes.includes('TURN_RECORDED');
    if (hasTurnRecorded) {
      pass('BlackBoxRecording', 'TURN_RECORDED event type registered');
    } else {
      warn('BlackBoxRecording', 'TURN_RECORDED not in EVENT_TYPES enum');
    }
  } catch (e) {
    fail('BlackBoxRecording', e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 2. REDIS CONNECTION
  // ═══════════════════════════════════════════════════════════════════════════
  section('2. REDIS CONNECTION');
  
  try {
    const { getSharedRedisClient, isRedisConfigured } = require('../services/redisClientFactory');
    
    if (!isRedisConfigured()) {
      warn('Redis not configured', 'V111 will work but without cross-request persistence');
    } else {
      const redis = await getSharedRedisClient();
      if (redis) {
        // Test ping
        const pong = await redis.ping();
        if (pong === 'PONG') {
          pass('Redis connected', 'PING successful');
          
          // Test V111 key pattern
          const testKey = `conversation-memory:health-check-${Date.now()}`;
          await redis.set(testKey, JSON.stringify({ test: true }), 'EX', 10);
          const retrieved = await redis.get(testKey);
          await redis.del(testKey);
          
          if (retrieved) {
            pass('Redis read/write', 'conversation-memory key pattern works');
          } else {
            fail('Redis read/write', 'Could not retrieve test key');
          }
        } else {
          fail('Redis ping', `Unexpected response: ${pong}`);
        }
      } else {
        warn('Redis client null', 'Factory returned null');
      }
    }
  } catch (e) {
    warn('Redis', e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 3. MONGODB CONNECTION
  // ═══════════════════════════════════════════════════════════════════════════
  section('3. MONGODB CONNECTION');
  
  try {
    const mongoose = require('mongoose');
    
    // Check if already connected
    if (mongoose.connection.readyState === 1) {
      pass('MongoDB connected', `DB: ${mongoose.connection.name}`);
    } else {
      // Try to connect
      require('dotenv').config();
      const mongoUri = process.env.MONGO_URI || process.env.MONGODB_URI;
      
      if (!mongoUri) {
        warn('MongoDB URI not found in env');
      } else {
        await mongoose.connect(mongoUri);
        pass('MongoDB connected', `DB: ${mongoose.connection.name}`);
      }
    }
    
    // Test CallTranscript collection
    if (CallTranscript) {
      const count = await CallTranscript.countDocuments({});
      pass('CallTranscript collection', `${count} documents`);
    }
  } catch (e) {
    fail('MongoDB', e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 4. COMPANY V111 CONFIG
  // ═══════════════════════════════════════════════════════════════════════════
  section('4. COMPANY V111 CONFIG');
  
  try {
    const v2Company = require('../models/v2Company');
    const company = await v2Company.findById(companyId).lean();
    
    if (!company) {
      fail('Company not found', companyId);
    } else {
      pass('Company loaded', company.name || company.companyName || 'unnamed');
      
      const v111Config = company.aiAgentSettings?.frontDeskBehavior?.conversationMemory;
      
      if (!v111Config) {
        warn('V111 config not set', 'Using defaults');
      } else {
        const enabled = v111Config.enabled === true;
        if (enabled) {
          pass('V111 enabled', 'conversationMemory.enabled = true');
        } else {
          info('V111 disabled for this company');
        }
        
        // Check capture goals
        const mustFields = v111Config.captureGoals?.must?.fields || [];
        const shouldFields = v111Config.captureGoals?.should?.fields || [];
        info(`Capture goals: MUST=[${mustFields.join(',')}] SHOULD=[${shouldFields.join(',')}]`);
        
        // Check handler governance
        const scenarioEnabled = v111Config.handlerGovernance?.scenarioHandler?.enabled !== false;
        const bookingEnabled = v111Config.handlerGovernance?.bookingHandler?.enabled !== false;
        const llmEnabled = v111Config.handlerGovernance?.llmHandler?.enabled !== false;
        info(`Handlers: Scenario=${scenarioEnabled} Booking=${bookingEnabled} LLM=${llmEnabled}`);
      }
    }
  } catch (e) {
    fail('Company config', e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 5. COMPONENT INTEGRATION TEST
  // ═══════════════════════════════════════════════════════════════════════════
  section('5. COMPONENT INTEGRATION TEST');
  
  try {
    if (!ConversationMemory?.ConversationMemory) {
      warn('ConversationMemory class not available');
    } else {
      // Create a test memory instance
      const testCallId = `health-check-${Date.now()}`;
      const memory = new ConversationMemory.ConversationMemory({
        callId: testCallId,
        companyId: companyId,
        callerPhone: '+15555555555'
      });
      
      pass('ConversationMemory instantiation');
      
      // Test turn builder
      const turnBuilder = memory.startTurn(0);
      if (turnBuilder) {
        pass('TurnRecordBuilder creation');
        
        // Set caller input
        turnBuilder.setCallerInput('um hello my name is mark', 'hello my name is mark', 0.95, {
          fillersRemoved: ['um'],
          correctionsApplied: []
        });
        pass('setCallerInput');
        
        // Set routing
        turnBuilder.setRouting('LLM', [{ rule: 'health_check_test' }], [], 'DISCOVERY');
        pass('setRouting');
        
        // Set response
        turnBuilder.setResponse('LLM', 'Hello Mark! How can I help you today?', 150);
        pass('setResponse');
        
        // Set delta
        turnBuilder.setDelta(['name'], [], false);
        pass('setDelta');
        
        // Build and commit
        const turnRecord = memory.commitTurn();
        if (turnRecord && turnRecord.turn === 0) {
          pass('commitTurn', `Turn 0 committed`);
        } else {
          fail('commitTurn', 'No turn record returned');
        }
      }
      
      // Test V111 Router (if available)
      if (V111Router?.createRouter) {
        memory.setConfig({ enabled: true });
        const router = V111Router.createRouter(memory);
        const decision = router.route({});
        if (decision && decision.version) {
          pass('V111Router decision', `Handler: ${decision.handler || 'passthrough'}`);
        }
      }
      
      // Test transcript generation
      if (TranscriptGenerator?.generateAllTranscripts) {
        const transcripts = TranscriptGenerator.generateAllTranscripts(memory.toJSON(), { name: 'Test Co' });
        if (transcripts.customer && transcripts.engineering) {
          pass('TranscriptGenerator', `Customer: ${transcripts.customer.length} chars, Engineering: ${transcripts.engineering.length} chars`);
        }
      }
    }
  } catch (e) {
    fail('Integration test', e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // 6. BLACKBOX RECORDING CHECK
  // ═══════════════════════════════════════════════════════════════════════════
  section('6. BLACKBOX V111 RECORDS');
  
  try {
    const BlackBoxRecording = require('../models/BlackBoxRecording');
    
    // Count V111 turn records for this company
    const v111Count = await BlackBoxRecording.countDocuments({
      companyId: companyId,
      'events.type': 'TURN_RECORDED'
    });
    
    if (v111Count > 0) {
      pass('V111 TurnRecords found', `${v111Count} calls with V111 data`);
      
      // Get most recent
      const recent = await BlackBoxRecording.findOne({
        companyId: companyId,
        'events.type': 'TURN_RECORDED'
      }).sort({ startedAt: -1 }).lean();
      
      if (recent) {
        const turnEvents = recent.events.filter(e => e.type === 'TURN_RECORDED');
        info(`Most recent call: ${recent.callId} (${turnEvents.length} turns)`);
      }
    } else {
      info('No V111 TurnRecords yet - make a test call to generate data');
    }
    
    // Check CallTranscript collection
    const transcriptCount = await CallTranscript.countDocuments({ companyId: companyId });
    if (transcriptCount > 0) {
      pass('CallTranscripts found', `${transcriptCount} transcripts`);
    } else {
      info('No CallTranscripts yet - transcripts are generated at call end');
    }
  } catch (e) {
    fail('BlackBox check', e.message);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SUMMARY
  // ═══════════════════════════════════════════════════════════════════════════
  console.log(`
${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}
                        HEALTH CHECK SUMMARY
${colors.cyan}═══════════════════════════════════════════════════════════════${colors.reset}

  ${colors.green}Passed:${colors.reset}   ${passCount}
  ${colors.red}Failed:${colors.reset}   ${failCount}
  ${colors.yellow}Warnings:${colors.reset} ${warnCount}

`);

  if (failCount === 0) {
    console.log(`${colors.green}✓ V111 Conversation Memory is healthy!${colors.reset}\n`);
    process.exit(0);
  } else {
    console.log(`${colors.red}✗ ${failCount} check(s) failed. Review above.${colors.reset}\n`);
    process.exit(1);
  }
}

// Run
main().catch(err => {
  console.error(`\n${colors.red}Fatal error:${colors.reset}`, err.message);
  process.exit(1);
});
