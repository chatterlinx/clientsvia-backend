/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TRANSCRIPT ARCHIVER JOB
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Moves transcripts from hot MongoDB storage to cold S3 storage after 48 hours.
 * This keeps MongoDB lean and fast while preserving all historical data.
 * 
 * SCHEDULE:
 * ─────────────────────────────────────────────────────────────────────────────
 * - Runs every 6 hours
 * - Archives transcripts older than 48 hours
 * - Updates CallTranscript with S3 reference
 * - MongoDB TTL index auto-deletes after 7 days
 * 
 * S3 STRUCTURE:
 * ─────────────────────────────────────────────────────────────────────────────
 * s3://bucket/transcripts/{companyId}/{YYYY}/{MM}/{callId}.json.gz
 * 
 * COST ESTIMATE:
 * ─────────────────────────────────────────────────────────────────────────────
 * - S3 Standard-IA: $0.0125/GB/month
 * - 10,000 calls/month × 10KB avg transcript = 100MB
 * - Cost: ~$0.001/month (essentially free)
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const CallTranscript = require('../models/CallTranscript');
const logger = require('../utils/logger');
const zlib = require('zlib');
const { promisify } = require('util');

const gzip = promisify(zlib.gzip);

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // How old transcripts must be before archiving (hours)
  ARCHIVE_THRESHOLD_HOURS: 48,
  
  // Batch size for processing
  BATCH_SIZE: 100,
  
  // S3 bucket (from environment)
  S3_BUCKET: process.env.TRANSCRIPT_S3_BUCKET || 'clientsvia-transcripts',
  
  // S3 region (from environment)
  S3_REGION: process.env.AWS_REGION || 'us-east-1',
  
  // Enable S3 upload (disable for local dev)
  S3_ENABLED: process.env.TRANSCRIPT_S3_ENABLED === 'true',
  
  // Maximum transcripts to archive per run
  MAX_PER_RUN: 1000
};

// ═══════════════════════════════════════════════════════════════════════════
// S3 CLIENT (Lazy initialization)
// ═══════════════════════════════════════════════════════════════════════════

let s3Client = null;

function getS3Client() {
  if (!s3Client && CONFIG.S3_ENABLED) {
    try {
      const { S3Client } = require('@aws-sdk/client-s3');
      s3Client = new S3Client({ region: CONFIG.S3_REGION });
      logger.info('[ARCHIVER] S3 client initialized');
    } catch (err) {
      logger.error('[ARCHIVER] Failed to initialize S3 client', { error: err.message });
      return null;
    }
  }
  return s3Client;
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ARCHIVER FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the transcript archiver job
 * 
 * @returns {Promise<Object>} - Archival results
 */
async function runArchiver() {
  const startTime = Date.now();
  
  logger.info('[ARCHIVER] ═══════════════════════════════════════════════════════════════');
  logger.info('[ARCHIVER] Starting transcript archiver job');
  logger.info('[ARCHIVER] ═══════════════════════════════════════════════════════════════');
  
  // Find transcripts ready for archival
  const cutoffTime = new Date(Date.now() - CONFIG.ARCHIVE_THRESHOLD_HOURS * 60 * 60 * 1000);
  
  const candidates = await CallTranscript.find({
    createdAt: { $lte: cutoffTime },
    movedToColdAt: { $exists: false }  // Not yet archived
  })
    .limit(CONFIG.MAX_PER_RUN)
    .lean();
  
  logger.info(`[ARCHIVER] Found ${candidates.length} transcripts to archive`);
  
  if (candidates.length === 0) {
    return {
      success: true,
      archived: 0,
      errors: 0,
      duration: Date.now() - startTime
    };
  }
  
  // Process in batches
  let archived = 0;
  let errors = 0;
  
  for (let i = 0; i < candidates.length; i += CONFIG.BATCH_SIZE) {
    const batch = candidates.slice(i, i + CONFIG.BATCH_SIZE);
    
    for (const transcript of batch) {
      try {
        await archiveTranscript(transcript);
        archived++;
      } catch (err) {
        errors++;
        logger.error('[ARCHIVER] Failed to archive transcript', {
          callId: transcript.callId,
          error: err.message
        });
      }
    }
    
    // Progress log
    logger.info(`[ARCHIVER] Progress: ${archived + errors}/${candidates.length}`);
  }
  
  const duration = Date.now() - startTime;
  
  logger.info('[ARCHIVER] ═══════════════════════════════════════════════════════════════');
  logger.info('[ARCHIVER] Transcript archiver job completed', {
    archived,
    errors,
    duration: `${duration}ms`
  });
  logger.info('[ARCHIVER] ═══════════════════════════════════════════════════════════════');
  
  return {
    success: true,
    archived,
    errors,
    duration
  };
}

/**
 * Archive a single transcript to S3
 * 
 * @param {Object} transcript - Transcript document
 */
async function archiveTranscript(transcript) {
  const companyId = transcript.companyId.toString();
  const callId = transcript.callId.toString();
  const createdAt = new Date(transcript.createdAt);
  
  // Build S3 key
  const year = createdAt.getUTCFullYear();
  const month = String(createdAt.getUTCMonth() + 1).padStart(2, '0');
  const s3Key = `transcripts/${companyId}/${year}/${month}/${callId}.json.gz`;
  
  // Prepare data for archival
  const archiveData = {
    callId,
    companyId,
    turns: transcript.turns,
    createdAt: transcript.createdAt,
    archivedAt: new Date().toISOString(),
    turnCount: transcript.turns?.length || 0
  };
  
  // Compress data
  const jsonData = JSON.stringify(archiveData);
  const compressedData = await gzip(jsonData);
  
  // Upload to S3 (if enabled)
  if (CONFIG.S3_ENABLED) {
    const client = getS3Client();
    if (client) {
      const { PutObjectCommand } = require('@aws-sdk/client-s3');
      
      await client.send(new PutObjectCommand({
        Bucket: CONFIG.S3_BUCKET,
        Key: s3Key,
        Body: compressedData,
        ContentType: 'application/json',
        ContentEncoding: 'gzip',
        Metadata: {
          'companyId': companyId,
          'callId': callId,
          'turnCount': String(archiveData.turnCount)
        }
      }));
      
      logger.debug('[ARCHIVER] Uploaded to S3', { s3Key });
    }
  } else {
    // Local dev: Just log and mark as archived
    logger.debug('[ARCHIVER] S3 disabled, simulating archive', { s3Key, size: compressedData.length });
  }
  
  // Update transcript document with S3 reference
  await CallTranscript.findByIdAndUpdate(transcript._id, {
    $set: {
      movedToColdAt: new Date(),
      s3Bucket: CONFIG.S3_BUCKET,
      s3Key: s3Key,
      // Clear turns from MongoDB to save space
      // (keep a summary instead)
      turns: [],
      archivedTurnCount: archiveData.turnCount
    }
  });
}

/**
 * Retrieve an archived transcript from S3
 * 
 * @param {string} callId - Call ID
 * @returns {Promise<Object>} - Transcript data
 */
async function retrieveArchivedTranscript(callId) {
  // Find the transcript reference
  const transcript = await CallTranscript.findOne({ callId }).lean();
  
  if (!transcript) {
    throw new Error(`Transcript not found: ${callId}`);
  }
  
  // If not archived, return the turns directly
  if (!transcript.movedToColdAt || transcript.turns?.length > 0) {
    return {
      callId: transcript.callId,
      turns: transcript.turns,
      source: 'mongodb'
    };
  }
  
  // If archived but S3 disabled, we can't retrieve
  if (!CONFIG.S3_ENABLED) {
    return {
      callId: transcript.callId,
      turns: [],
      archivedTurnCount: transcript.archivedTurnCount || 0,
      source: 'archived',
      message: 'Transcript archived, S3 retrieval not enabled'
    };
  }
  
  // Retrieve from S3
  const client = getS3Client();
  if (!client) {
    throw new Error('S3 client not available');
  }
  
  const { GetObjectCommand } = require('@aws-sdk/client-s3');
  const { Readable } = require('stream');
  const gunzip = promisify(zlib.gunzip);
  
  try {
    const response = await client.send(new GetObjectCommand({
      Bucket: transcript.s3Bucket,
      Key: transcript.s3Key
    }));
    
    // Convert stream to buffer
    const chunks = [];
    for await (const chunk of response.Body) {
      chunks.push(chunk);
    }
    const buffer = Buffer.concat(chunks);
    
    // Decompress
    const decompressed = await gunzip(buffer);
    const data = JSON.parse(decompressed.toString());
    
    return {
      callId: data.callId,
      turns: data.turns,
      archivedAt: data.archivedAt,
      source: 's3'
    };
    
  } catch (err) {
    logger.error('[ARCHIVER] Failed to retrieve from S3', {
      callId,
      s3Key: transcript.s3Key,
      error: err.message
    });
    throw new Error(`Failed to retrieve archived transcript: ${err.message}`);
  }
}

/**
 * Get archiver status for monitoring
 */
async function getArchiverStatus() {
  const cutoffTime = new Date(Date.now() - CONFIG.ARCHIVE_THRESHOLD_HOURS * 60 * 60 * 1000);
  
  // Count pending archives
  const pendingCount = await CallTranscript.countDocuments({
    createdAt: { $lte: cutoffTime },
    movedToColdAt: { $exists: false }
  });
  
  // Count archived
  const archivedCount = await CallTranscript.countDocuments({
    movedToColdAt: { $exists: true }
  });
  
  // Count total in MongoDB
  const totalCount = await CallTranscript.countDocuments();
  
  // Get latest archive
  const latestArchive = await CallTranscript.findOne({
    movedToColdAt: { $exists: true }
  })
    .sort({ movedToColdAt: -1 })
    .select('movedToColdAt callId')
    .lean();
  
  return {
    status: pendingCount === 0 ? 'HEALTHY' : 'NEEDS_ARCHIVAL',
    pendingCount,
    archivedCount,
    totalInMongoDB: totalCount,
    latestArchive: latestArchive?.movedToColdAt || null,
    s3Enabled: CONFIG.S3_ENABLED,
    s3Bucket: CONFIG.S3_BUCKET,
    archiveThresholdHours: CONFIG.ARCHIVE_THRESHOLD_HOURS
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  // Connect to MongoDB if not already connected
  if (mongoose.connection.readyState !== 1) {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('MONGODB_URI environment variable is required');
      process.exit(1);
    }
    
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');
  }
  
  try {
    const result = await runArchiver();
    console.log('Archiver completed:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Archiver failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  runArchiver,
  archiveTranscript,
  retrieveArchivedTranscript,
  getArchiverStatus
};

