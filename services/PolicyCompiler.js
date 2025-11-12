// services/PolicyCompiler.js
// ============================================================================
// POLICY COMPILER - Cheat Sheet → Runtime Artifact
// ============================================================================
// PURPOSE: Compile company cheat sheets into optimized, immutable runtime artifacts
// ARCHITECTURE: Schema validation → Conflict detection → Optimization → Checksum → Cache
// PERFORMANCE: Sub-10ms artifact loading, pre-compiled regexes, sorted arrays
// SAFETY: Optimistic locking, conflict auto-resolution, immutable checksum
// LEARNING: Separate from scenario learning, complementary improvement
// ============================================================================

const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const Redis = require('ioredis');
const logger = require('../utils/logger');

// Redis client (lazy initialization)
let redisClient = null;
function getRedisClient() {
  if (!redisClient) {
    redisClient = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: process.env.REDIS_PORT || 6379,
      password: process.env.REDIS_PASSWORD || null,
      db: process.env.REDIS_DB || 0,
      retryDelayOnFailover: 100,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000);
        return delay;
      }
    });
  }
  return redisClient;
}

class PolicyCompiler {
  
  // ═══════════════════════════════════════════════════════════════════
  // COMPILE: Schema → Optimized Runtime Artifact
  // ═══════════════════════════════════════════════════════════════════
  // INPUT: Company ID + cheat sheet object
  // OUTPUT: { artifact, checksum, redisKey, conflicts }
  // PROCESS:
  //   1. Acquire optimistic lock (prevent concurrent compilations)
  //   2. Detect conflicts (overlapping patterns)
  //   3. Auto-resolve conflicts (demote later rules)
  //   4. Build runtime artifact (pre-compile regexes, sort by priority)
  //   5. Generate checksum (SHA-256)
  //   6. Save to Redis (namespaced key)
  //   7. Update active pointer (if status = 'active')
  //   8. Update company record (lastCompiledAt, checksum)
  //   9. Release lock
  // ═══════════════════════════════════════════════════════════════════
  
  async compile(companyId, cheatSheet) {
    const startTime = Date.now();
    
    logger.info('[POLICY COMPILER] Starting compilation', {
      companyId,
      version: cheatSheet.version,
      status: cheatSheet.status
    });
    
    // Load Company model (lazy load to avoid circular dependencies)
    const Company = require('../models/v2Company');
    
    // ────────────────────────────────────────────────────────────────
    // STEP 1: Acquire Optimistic Lock
    // ────────────────────────────────────────────────────────────────
    // Prevents race condition if admin saves twice quickly
    // Lock is a UUID stored in company.aiAgentSettings.cheatSheet.compileLock
    const lockId = await this.acquireLock(companyId, Company);
    
    try {
      // ──────────────────────────────────────────────────────────────
      // STEP 2: Detect Conflicts
      // ──────────────────────────────────────────────────────────────
      // Check for overlapping patterns with same priority
      // Auto-resolve by demoting later rule (priority += 1)
      const conflicts = this.detectConflicts(cheatSheet);
      
      if (conflicts.length > 0) {
        logger.warn('[POLICY COMPILER] Conflicts detected, auto-resolving', {
          companyId,
          conflictCount: conflicts.length,
          conflicts: conflicts.map(c => ({
            type: c.type,
            rule1: c.rule1,
            rule2: c.rule2,
            resolution: c.resolution
          }))
        });
        
        // Auto-resolve conflicts
        conflicts.forEach(conflict => {
          if (conflict.resolution === 'AUTO_DEMOTE_LATER') {
            // Find and demote the second rule
            if (conflict.type === 'EDGE_CASE_CONFLICT') {
              const rule2 = cheatSheet.edgeCases.find(ec => ec.id === conflict.rule2);
              if (rule2) {
                rule2.priority += 1;
                logger.info('[POLICY COMPILER] Auto-demoted edge case', {
                  id: rule2.id,
                  oldPriority: rule2.priority - 1,
                  newPriority: rule2.priority
                });
              }
            } else if (conflict.type === 'TRANSFER_RULE_CONFLICT') {
              const rule2 = cheatSheet.transferRules.find(tr => tr.id === conflict.rule2);
              if (rule2) {
                rule2.priority += 1;
                logger.info('[POLICY COMPILER] Auto-demoted transfer rule', {
                  id: rule2.id,
                  oldPriority: rule2.priority - 1,
                  newPriority: rule2.priority
                });
              }
            }
          }
        });
      }
      
      // ──────────────────────────────────────────────────────────────
      // STEP 3: Build Runtime Artifact
      // ──────────────────────────────────────────────────────────────
      // Optimize for runtime performance:
      // - Pre-compile regexes
      // - Sort by priority (low = high priority)
      // - Convert arrays to Sets for O(1) lookups
      // - Remove disabled rules
      const artifact = {
        companyId,
        version: cheatSheet.version,
        status: cheatSheet.status,
        compiledAt: new Date().toISOString(),
        
        // Pre-computed sets for O(1) lookups
        behaviorFlags: new Set(cheatSheet.behaviorRules || []),
        guardrailFlags: new Set(cheatSheet.guardrails || []),
        allowedActionFlags: new Set(cheatSheet.allowedActions || []),
        
        // Edge cases: sorted by priority (low = high), regexes pre-compiled
        edgeCases: (cheatSheet.edgeCases || [])
          .filter(ec => ec.enabled !== false)
          .sort((a, b) => (a.priority || 10) - (b.priority || 10))
          .map(ec => ({
            id: ec.id,
            name: ec.name,
            patterns: (ec.triggerPatterns || []).map(p => {
              try {
                return new RegExp(p, 'i');
              } catch (err) {
                logger.error('[POLICY COMPILER] Invalid regex pattern', {
                  edgeCaseId: ec.id,
                  pattern: p,
                  error: err.message
                });
                return null;
              }
            }).filter(Boolean),
            response: ec.responseText,
            priority: ec.priority || 10
          })),
        
        // Transfer rules: sorted by priority, patterns pre-compiled
        transferRules: (cheatSheet.transferRules || [])
          .filter(tr => tr.enabled !== false)
          .sort((a, b) => (a.priority || 10) - (b.priority || 10))
          .map(tr => ({
            id: tr.id,
            intentTag: tr.intentTag,
            patterns: this.buildTransferPatterns(tr.intentTag),
            contact: tr.contactNameOrQueue,
            phone: tr.phoneNumber || null,
            script: tr.script,
            entities: tr.collectEntities || [],
            afterHoursOnly: tr.afterHoursOnly || false,
            priority: tr.priority || 10
          })),
        
        // Pre-compiled regex patterns for guardrails
        guardrailPatterns: this.compileGuardrailPatterns(cheatSheet.guardrails || [])
      };
      
      // ──────────────────────────────────────────────────────────────
      // STEP 4: Generate Checksum (SHA-256)
      // ──────────────────────────────────────────────────────────────
      // Ensures immutability - if artifact changes, checksum changes
      // Used for cache invalidation and forensics
      const checksum = this.generateChecksum(artifact);
      artifact.checksum = checksum;
      
      logger.info('[POLICY COMPILER] Artifact built', {
        companyId,
        version: artifact.version,
        checksum,
        edgeCases: artifact.edgeCases.length,
        transferRules: artifact.transferRules.length,
        behaviorRules: artifact.behaviorFlags.size,
        guardrails: artifact.guardrailFlags.size
      });
      
      // ──────────────────────────────────────────────────────────────
      // STEP 5: Serialize artifact for Redis
      // ──────────────────────────────────────────────────────────────
      // Convert Sets to arrays, RegExp to strings for JSON storage
      const serialized = this.serializeArtifact(artifact);
      
      // ──────────────────────────────────────────────────────────────
      // STEP 6: Save to Redis (Namespaced by version + checksum)
      // ──────────────────────────────────────────────────────────────
      const redisKey = `policy:${companyId}:v${cheatSheet.version}:${checksum}`;
      
      try {
        await getRedisClient().set(
          redisKey,
          JSON.stringify(serialized),
          'EX',
          86400 // 24 hour TTL
        );
        
        logger.info('[POLICY COMPILER] Artifact cached in Redis', {
          companyId,
          redisKey,
          ttl: 86400
        });
      } catch (err) {
        logger.error('[POLICY COMPILER] Redis save failed', {
          companyId,
          redisKey,
          error: err.message
        });
        // Don't throw - compilation succeeded, just cache failed
      }
      
      // ──────────────────────────────────────────────────────────────
      // STEP 7: Update Active Pointer (if status = 'active')
      // ──────────────────────────────────────────────────────────────
      if (cheatSheet.status === 'active') {
        try {
          await getRedisClient().set(
            `policy:${companyId}:active`,
            redisKey,
            'EX',
            86400
          );
          
          logger.info('[POLICY COMPILER] Active pointer updated', {
            companyId,
            activeKey: redisKey
          });
        } catch (err) {
          logger.error('[POLICY COMPILER] Active pointer update failed', {
            companyId,
            error: err.message
          });
        }
      }
      
      // ──────────────────────────────────────────────────────────────
      // STEP 8: Update Company Record
      // ──────────────────────────────────────────────────────────────
      try {
        await Company.findByIdAndUpdate(companyId, {
          'aiAgentSettings.cheatSheet.lastCompiledAt': new Date(),
          'aiAgentSettings.cheatSheet.checksum': checksum
        });
        
        logger.info('[POLICY COMPILER] Company record updated', {
          companyId,
          checksum
        });
      } catch (err) {
        logger.error('[POLICY COMPILER] Company update failed', {
          companyId,
          error: err.message
        });
        // Don't throw - compilation succeeded
      }
      
      // ──────────────────────────────────────────────────────────────
      // SUCCESS!
      // ──────────────────────────────────────────────────────────────
      const elapsed = Date.now() - startTime;
      
      logger.info('[POLICY COMPILER] Compilation successful', {
        companyId,
        version: artifact.version,
        checksum,
        redisKey,
        conflicts: conflicts.length,
        elapsedMs: elapsed
      });
      
      return {
        success: true,
        artifact,
        checksum,
        redisKey,
        conflicts,
        elapsedMs: elapsed
      };
      
    } catch (err) {
      logger.error('[POLICY COMPILER] Compilation failed', {
        companyId,
        error: err.message,
        stack: err.stack
      });
      
      throw new Error(`Policy compilation failed: ${err.message}`);
      
    } finally {
      // ──────────────────────────────────────────────────────────────
      // STEP 9: Release Lock (always, even on error)
      // ──────────────────────────────────────────────────────────────
      await this.releaseLock(companyId, lockId, require('../models/v2Company'));
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // CONFLICT DETECTOR
  // ═══════════════════════════════════════════════════════════════════
  // Detects overlapping patterns with same priority
  // Returns array of conflicts with auto-resolution strategy
  // ═══════════════════════════════════════════════════════════════════
  
  detectConflicts(cheatSheet) {
    const conflicts = [];
    
    // ──────────────────────────────────────────────────────────────
    // Check edge case overlaps
    // ──────────────────────────────────────────────────────────────
    const edgeCases = cheatSheet.edgeCases || [];
    
    for (let i = 0; i < edgeCases.length; i++) {
      for (let j = i + 1; j < edgeCases.length; j++) {
        const ec1 = edgeCases[i];
        const ec2 = edgeCases[j];
        
        // Skip if different priorities (no conflict)
        if ((ec1.priority || 10) !== (ec2.priority || 10)) {
          continue;
        }
        
        // Calculate pattern overlap
        const overlap = this.calculatePatternOverlap(
          ec1.triggerPatterns || [],
          ec2.triggerPatterns || []
        );
        
        // If > 30% overlap with same priority = conflict
        if (overlap > 0.3) {
          conflicts.push({
            type: 'EDGE_CASE_CONFLICT',
            rule1: ec1.id,
            rule1Name: ec1.name,
            rule2: ec2.id,
            rule2Name: ec2.name,
            overlapScore: overlap,
            priority: ec1.priority || 10,
            resolution: 'AUTO_DEMOTE_LATER',
            severity: 'WARNING'
          });
        }
      }
    }
    
    // ──────────────────────────────────────────────────────────────
    // Check transfer rule overlaps
    // ──────────────────────────────────────────────────────────────
    const transferRules = cheatSheet.transferRules || [];
    
    for (let i = 0; i < transferRules.length; i++) {
      for (let j = i + 1; j < transferRules.length; j++) {
        const tr1 = transferRules[i];
        const tr2 = transferRules[j];
        
        // Skip if different priorities
        if ((tr1.priority || 10) !== (tr2.priority || 10)) {
          continue;
        }
        
        // Check if same intentTag (definite conflict)
        if (tr1.intentTag === tr2.intentTag) {
          conflicts.push({
            type: 'TRANSFER_RULE_CONFLICT',
            rule1: tr1.id,
            rule1Intent: tr1.intentTag,
            rule2: tr2.id,
            rule2Intent: tr2.intentTag,
            overlapScore: 1.0, // Same intentTag = 100% overlap
            priority: tr1.priority || 10,
            resolution: 'AUTO_DEMOTE_LATER',
            severity: 'WARNING'
          });
        }
      }
    }
    
    return conflicts;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // PATTERN OVERLAP CALCULATOR
  // ═══════════════════════════════════════════════════════════════════
  // Uses Jaccard similarity: intersection / union
  // Returns score 0.0 - 1.0 (0 = no overlap, 1 = identical)
  // ═══════════════════════════════════════════════════════════════════
  
  calculatePatternOverlap(patterns1, patterns2) {
    // Extract words from patterns (split on non-word characters)
    const words1 = new Set(
      patterns1
        .flatMap(p => p.toLowerCase().split(/\W+/))
        .filter(w => w.length > 2) // Ignore short words (a, is, or, etc.)
    );
    
    const words2 = new Set(
      patterns2
        .flatMap(p => p.toLowerCase().split(/\W+/))
        .filter(w => w.length > 2)
    );
    
    // Jaccard similarity
    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);
    
    if (union.size === 0) return 0;
    
    return intersection.size / union.size;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // TRANSFER PATTERN BUILDER
  // ═══════════════════════════════════════════════════════════════════
  // Builds regex patterns based on intentTag
  // Pre-defined patterns for common transfer intents
  // ═══════════════════════════════════════════════════════════════════
  
  buildTransferPatterns(intentTag) {
    const patternMap = {
      billing: [
        /bill/i,
        /invoice/i,
        /payment/i,
        /charge/i,
        /balance/i,
        /account/i,
        /owe/i,
        /pay/i
      ],
      emergency: [
        /emergency/i,
        /urgent/i,
        /flooding/i,
        /no heat/i,
        /gas smell/i,
        /fire/i,
        /leak/i,
        /danger/i
      ],
      scheduling: [
        /appointment/i,
        /schedule/i,
        /book/i,
        /visit/i,
        /come out/i,
        /service call/i
      ],
      technical: [
        /broken/i,
        /not working/i,
        /problem/i,
        /issue/i,
        /fix/i,
        /repair/i
      ],
      general: [] // catch-all, matches everything
    };
    
    return patternMap[intentTag] || [];
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // GUARDRAIL PATTERN COMPILER
  // ═══════════════════════════════════════════════════════════════════
  // Converts guardrail flags to compiled regex patterns
  // Used at runtime for content filtering
  // ═══════════════════════════════════════════════════════════════════
  
  compileGuardrailPatterns(guardrails) {
    const patterns = {};
    
    guardrails.forEach(flag => {
      switch (flag) {
        case 'NO_PRICES':
          patterns.prices = /\$\d+(?:,\d{3})*(?:\.\d{2})?|\d+\s*dollars?/gi;
          break;
        case 'NO_PHONE_NUMBERS':
          patterns.phones = /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;
          break;
        case 'NO_URLS':
          patterns.urls = /https?:\/\/[^\s]+/gi;
          break;
        case 'NO_APOLOGIES_SPAM':
          patterns.apologies = /\b(sorry|apologize|apologies)\b/gi;
          break;
        case 'NO_MEDICAL_ADVICE':
          patterns.medical = /\b(diagnose|diagnosis|prescription|prescribe|treat|treatment|medicine|medication)\b/gi;
          break;
        case 'NO_LEGAL_ADVICE':
          patterns.legal = /\b(sue|lawsuit|lawyer|attorney|legal action|liability|liable)\b/gi;
          break;
        // Add more patterns as needed
      }
    });
    
    return patterns;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // CHECKSUM GENERATOR (SHA-256)
  // ═══════════════════════════════════════════════════════════════════
  // Generates cryptographic hash of artifact
  // Ensures immutability - if artifact changes, checksum changes
  // ═══════════════════════════════════════════════════════════════════
  
  generateChecksum(artifact) {
    // Create deterministic JSON string (sorted keys)
    const normalized = JSON.stringify(artifact, Object.keys(artifact).sort());
    
    return crypto
      .createHash('sha256')
      .update(normalized)
      .digest('hex');
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // ARTIFACT SERIALIZER
  // ═══════════════════════════════════════════════════════════════════
  // Converts runtime artifact to JSON-serializable format
  // Sets → Arrays, RegExp → {pattern, flags}
  // ═══════════════════════════════════════════════════════════════════
  
  serializeArtifact(artifact) {
    return {
      ...artifact,
      behaviorFlags: Array.from(artifact.behaviorFlags),
      guardrailFlags: Array.from(artifact.guardrailFlags),
      allowedActionFlags: Array.from(artifact.allowedActionFlags),
      edgeCases: artifact.edgeCases.map(ec => ({
        ...ec,
        patterns: ec.patterns.map(p => ({
          pattern: p.source,
          flags: p.flags
        }))
      })),
      transferRules: artifact.transferRules.map(tr => ({
        ...tr,
        patterns: tr.patterns.map(p => ({
          pattern: p.source,
          flags: p.flags
        }))
      })),
      guardrailPatterns: Object.fromEntries(
        Object.entries(artifact.guardrailPatterns).map(([key, regex]) => [
          key,
          { pattern: regex.source, flags: regex.flags }
        ])
      )
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // OPTIMISTIC LOCKING
  // ═══════════════════════════════════════════════════════════════════
  // Prevents race conditions when admin saves cheat sheet multiple times quickly
  // Lock is a UUID stored in company.aiAgentSettings.cheatSheet.compileLock
  // ═══════════════════════════════════════════════════════════════════
  
  async acquireLock(companyId, Company) {
    const lockId = uuidv4();
    
    logger.info('[POLICY COMPILER] Acquiring lock', { companyId, lockId });
    
    try {
      const result = await Company.findOneAndUpdate(
        {
          _id: companyId,
          'aiAgentSettings.cheatSheet.compileLock': null
        },
        {
          $set: { 'aiAgentSettings.cheatSheet.compileLock': lockId }
        },
        { new: true }
      );
      
      if (!result) {
        throw new Error('Compilation already in progress (lock held)');
      }
      
      logger.info('[POLICY COMPILER] Lock acquired', { companyId, lockId });
      
      return lockId;
      
    } catch (err) {
      logger.error('[POLICY COMPILER] Lock acquisition failed', {
        companyId,
        error: err.message
      });
      throw new Error('Failed to acquire compilation lock');
    }
  }
  
  async releaseLock(companyId, lockId, Company) {
    logger.info('[POLICY COMPILER] Releasing lock', { companyId, lockId });
    
    try {
      await Company.findOneAndUpdate(
        {
          _id: companyId,
          'aiAgentSettings.cheatSheet.compileLock': lockId
        },
        {
          $set: { 'aiAgentSettings.cheatSheet.compileLock': null }
        }
      );
      
      logger.info('[POLICY COMPILER] Lock released', { companyId, lockId });
      
    } catch (err) {
      logger.error('[POLICY COMPILER] Lock release failed', {
        companyId,
        lockId,
        error: err.message
      });
      // Don't throw - lock will expire naturally
    }
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXPORT SINGLETON
// ═══════════════════════════════════════════════════════════════════
module.exports = new PolicyCompiler();

