/**
 * Excellence Analysis Job
 * 
 * PURPOSE: Nightly job to generate LLM improvement suggestions
 * - Runs at 3 AM to avoid impacting production
 * - Caches results for 24 hours
 * - Generates suggestions for all active companies
 * 
 * USAGE:
 * - Scheduled via cron: node jobs/excellenceAnalysis.js
 * - Or triggered manually: node jobs/excellenceAnalysis.js --company=COMPANY_ID
 * 
 * @module jobs/excellenceAnalysis
 */

require('dotenv').config();
const mongoose = require('mongoose');
const logger = require('../utils/logger');
const AgentExcellenceService = require('../services/AgentExcellenceService');
const V2Company = require('../models/v2Company');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Max companies to process in one run (to avoid timeout)
  batchSize: 50,
  
  // Delay between companies (to avoid rate limiting)
  delayBetweenCompanies: 2000, // 2 seconds
  
  // Only process companies with recent activity
  minCallsRequired: 5, // Must have at least 5 calls in last 7 days
  
  // MongoDB connection timeout
  connectionTimeout: 30000
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN JOB
// ═══════════════════════════════════════════════════════════════════════════

async function runExcellenceAnalysis() {
  const startTime = Date.now();
  const results = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    errors: []
  };
  
  logger.info('[EXCELLENCE JOB] Starting nightly analysis');
  
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: CONFIG.connectionTimeout
    });
    logger.info('[EXCELLENCE JOB] Connected to MongoDB');
    
    // Check for single company mode
    const args = process.argv.slice(2);
    const companyArg = args.find(a => a.startsWith('--company='));
    
    let companies;
    
    if (companyArg) {
      // Single company mode
      const companyId = companyArg.split('=')[1];
      const company = await V2Company.findById(companyId);
      companies = company ? [company] : [];
      logger.info('[EXCELLENCE JOB] Single company mode', { companyId });
    } else {
      // Get all active companies
      companies = await V2Company.find({
        isActive: true,
        deleted: { $ne: true }
      }).select('_id companyName trade');
      
      logger.info('[EXCELLENCE JOB] Found companies', { count: companies.length });
    }
    
    // Process each company
    for (const company of companies.slice(0, CONFIG.batchSize)) {
      results.processed++;
      
      try {
        logger.info('[EXCELLENCE JOB] Processing company', {
          companyId: String(company._id),
          name: company.companyName
        });
        
        // Calculate score first
        const score = await AgentExcellenceService.calculateScore(company._id);
        
        // Check if company has enough activity
        if (score.rawMetrics.totalCalls < CONFIG.minCallsRequired) {
          logger.info('[EXCELLENCE JOB] Skipping - insufficient activity', {
            companyId: String(company._id),
            calls: score.rawMetrics.totalCalls
          });
          results.skipped++;
          continue;
        }
        
        // Generate LLM suggestions
        await AgentExcellenceService.generateImprovementSuggestions(company._id);
        
        results.succeeded++;
        
        logger.info('[EXCELLENCE JOB] Company processed successfully', {
          companyId: String(company._id),
          score: score.overallScore
        });
        
        // Delay between companies
        if (CONFIG.delayBetweenCompanies > 0) {
          await new Promise(resolve => setTimeout(resolve, CONFIG.delayBetweenCompanies));
        }
        
      } catch (error) {
        results.failed++;
        results.errors.push({
          companyId: String(company._id),
          error: error.message
        });
        
        logger.error('[EXCELLENCE JOB] Company failed', {
          companyId: String(company._id),
          error: error.message
        });
      }
    }
    
  } catch (error) {
    logger.error('[EXCELLENCE JOB] Job failed', {
      error: error.message,
      stack: error.stack
    });
    throw error;
    
  } finally {
    // Disconnect from MongoDB
    await mongoose.disconnect();
    
    const duration = Date.now() - startTime;
    
    logger.info('[EXCELLENCE JOB] Completed', {
      duration: `${Math.round(duration / 1000)}s`,
      ...results
    });
    
    // Log summary
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('EXCELLENCE ANALYSIS JOB COMPLETE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Duration: ${Math.round(duration / 1000)} seconds`);
    console.log(`Processed: ${results.processed}`);
    console.log(`Succeeded: ${results.succeeded}`);
    console.log(`Failed: ${results.failed}`);
    console.log(`Skipped: ${results.skipped}`);
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    if (results.errors.length > 0) {
      console.log('ERRORS:');
      results.errors.forEach(e => {
        console.log(`  - ${e.companyId}: ${e.error}`);
      });
    }
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// RUN
// ═══════════════════════════════════════════════════════════════════════════

if (require.main === module) {
  runExcellenceAnalysis()
    .then(results => {
      process.exit(results.failed > 0 ? 1 : 0);
    })
    .catch(error => {
      console.error('Job failed:', error);
      process.exit(1);
    });
}

module.exports = { runExcellenceAnalysis };

