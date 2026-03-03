#!/usr/bin/env node
/**
 * View Recent Calls - Interactive Call Console CLI
 * 
 * Queries CallTranscriptV2 to show recent calls with full details.
 * No downloads, just direct viewing.
 */

// Try to load .env if it exists, but don't fail if it doesn't
try {
  require('dotenv').config();
} catch (e) {
  // Ignore if dotenv not available
}

const mongoose = require('mongoose');
const CallTranscriptV2 = require('../models/CallTranscriptV2');

// Check for MongoDB URI
const MONGODB_URI = process.env.MONGODB_URI || process.env.MONGO_URI;
if (!MONGODB_URI) {
  console.error('\n❌ Error: MONGODB_URI environment variable not set');
  console.error('\nPlease set it by either:');
  console.error('  1. Creating a .env file with: MONGODB_URI=your_mongo_connection_string');
  console.error('  2. Running: export MONGODB_URI="your_mongo_connection_string"');
  console.error('  3. Running: MONGODB_URI="your_mongo_connection_string" node scripts/view-recent-calls.js\n');
  process.exit(1);
}

// ANSI Colors for terminal output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  
  // Text colors
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  red: '\x1b[31m',
  
  // Background colors
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgRed: '\x1b[41m',
  bgBlue: '\x1b[44m',
};

function formatDuration(seconds) {
  if (!seconds) return '—';
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatPhone(phone) {
  if (!phone) return '—';
  // Format as (XXX) XXX-XXXX
  const cleaned = phone.replace(/\D/g, '');
  if (cleaned.length === 11 && cleaned[0] === '1') {
    const area = cleaned.slice(1, 4);
    const prefix = cleaned.slice(4, 7);
    const line = cleaned.slice(7);
    return `(${area}) ${prefix}-${line}`;
  }
  return phone;
}

function formatTime(date) {
  if (!date) return '—';
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

function printDivider(char = '═', length = 100) {
  console.log(colors.gray + char.repeat(length) + colors.reset);
}

function printCallSummary(call, index) {
  const duration = call.callMeta?.twilioDurationSeconds || 
    (call.callMeta?.endedAt && call.callMeta?.startedAt 
      ? Math.floor((new Date(call.callMeta.endedAt) - new Date(call.callMeta.startedAt)) / 1000)
      : null);
  
  const turnCount = call.turns?.filter(t => t.speaker === 'caller' || t.speaker === 'agent').length || 0;
  const callerTurns = call.turns?.filter(t => t.speaker === 'caller').length || 0;
  const agentTurns = call.turns?.filter(t => t.speaker === 'agent').length || 0;
  
  console.log(`\n${colors.bright}${colors.cyan}Call #${index + 1}${colors.reset}`);
  console.log(`${colors.gray}CallSid:${colors.reset} ${call.callSid}`);
  console.log(`${colors.gray}From:${colors.reset} ${formatPhone(call.callMeta?.from)}`);
  console.log(`${colors.gray}Started:${colors.reset} ${formatTime(call.callMeta?.startedAt)}`);
  console.log(`${colors.gray}Duration:${colors.reset} ${formatDuration(duration)}`);
  console.log(`${colors.gray}Turns:${colors.reset} ${turnCount} total (${callerTurns} caller, ${agentTurns} agent)`);
}

function printTranscript(call) {
  console.log(`\n${colors.bright}${colors.blue}━━━ TRANSCRIPT ━━━${colors.reset}\n`);
  
  const conversationTurns = (call.turns || [])
    .filter(t => t.speaker === 'caller' || t.speaker === 'agent')
    .sort((a, b) => a.turnNumber - b.turnNumber);
  
  conversationTurns.forEach((turn, idx) => {
    const isCaller = turn.speaker === 'caller';
    const speakerColor = isCaller ? colors.green : colors.magenta;
    const speakerLabel = isCaller ? '🎤 CALLER' : '🤖 AGENT';
    const kindLabel = turn.kind ? ` [${turn.kind}]` : '';
    
    console.log(`${colors.dim}Turn ${turn.turnNumber}${colors.reset} ${speakerColor}${speakerLabel}${colors.reset}${colors.gray}${kindLabel}${colors.reset}`);
    console.log(`  ${turn.text}`);
    
    // Show trace if available
    if (turn.trace) {
      console.log(`  ${colors.dim}└─ Trace: ${JSON.stringify(turn.trace).substring(0, 100)}...${colors.reset}`);
    }
    
    if (idx < conversationTurns.length - 1) {
      console.log(''); // Spacing between turns
    }
  });
}

function printTraceEvents(call) {
  if (!call.trace || call.trace.length === 0) {
    return;
  }
  
  console.log(`\n${colors.bright}${colors.yellow}━━━ TRACE EVENTS ━━━${colors.reset}\n`);
  
  const sortedTrace = call.trace.sort((a, b) => a.turnNumber - b.turnNumber || new Date(a.ts) - new Date(b.ts));
  
  sortedTrace.forEach((event) => {
    const turnLabel = event.turnNumber !== null ? `Turn ${event.turnNumber}` : 'N/A';
    console.log(`${colors.gray}[${turnLabel}]${colors.reset} ${colors.cyan}${event.kind}${colors.reset}`);
    
    if (event.payload && Object.keys(event.payload).length > 0) {
      const payloadStr = JSON.stringify(event.payload, null, 2)
        .split('\n')
        .map(line => `  ${colors.dim}${line}${colors.reset}`)
        .join('\n');
      console.log(payloadStr);
    }
    console.log('');
  });
}

async function viewRecentCalls(options = {}) {
  const {
    limit = 5,
    companyId = null,
    detailed = false
  } = options;
  
  try {
    console.log(`\n${colors.bright}${colors.blue}Connecting to MongoDB...${colors.reset}`);
    await mongoose.connect(MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log(`${colors.green}✓ Connected${colors.reset}\n`);
    
    printDivider();
    console.log(`${colors.bright}Fetching ${limit} most recent calls...${colors.reset}`);
    printDivider();
    
    const query = companyId ? { companyId } : {};
    const calls = await CallTranscriptV2.find(query)
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
    
    if (calls.length === 0) {
      console.log(`\n${colors.yellow}No calls found.${colors.reset}\n`);
      return;
    }
    
    console.log(`${colors.green}Found ${calls.length} call(s)${colors.reset}`);
    
    calls.forEach((call, index) => {
      printDivider();
      printCallSummary(call, index);
      printTranscript(call);
      
      if (detailed) {
        printTraceEvents(call);
      }
      
      printDivider();
    });
    
    console.log(`\n${colors.dim}Tip: Run with --detailed flag to see trace events${colors.reset}\n`);
    
  } catch (error) {
    console.error(`\n${colors.red}Error:${colors.reset}`, error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log(`${colors.gray}Disconnected from MongoDB${colors.reset}\n`);
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options = {
  limit: 5,
  detailed: args.includes('--detailed') || args.includes('-d'),
  companyId: null
};

// Parse --limit=N
const limitArg = args.find(arg => arg.startsWith('--limit='));
if (limitArg) {
  options.limit = parseInt(limitArg.split('=')[1], 10) || 5;
}

// Parse --company=ID
const companyArg = args.find(arg => arg.startsWith('--company='));
if (companyArg) {
  options.companyId = companyArg.split('=')[1];
}

// Show help
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${colors.bright}View Recent Calls - Interactive CLI${colors.reset}

${colors.cyan}Usage:${colors.reset}
  node scripts/view-recent-calls.js [options]

${colors.cyan}Options:${colors.reset}
  --limit=N         Number of calls to fetch (default: 5)
  --company=ID      Filter by company ID
  --detailed, -d    Show trace events
  --help, -h        Show this help

${colors.cyan}Examples:${colors.reset}
  node scripts/view-recent-calls.js
  node scripts/view-recent-calls.js --limit=10
  node scripts/view-recent-calls.js --detailed
  node scripts/view-recent-calls.js --company=507f1f77bcf86cd799439011 --limit=3
`);
  process.exit(0);
}

// Run the script
viewRecentCalls(options);
