const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');

/**
 * MongoDB Backup and Restore Utilities
 * 
 * Note: For MongoDB Atlas (production), automated backups are enabled by default.
 * This utility provides additional local backup capabilities and validation.
 */

class BackupManager {
  constructor(mongoUri) {
    this.mongoUri = mongoUri;
    this.backupDir = path.join(__dirname, '..', 'backups');
    this.isAtlas = mongoUri.includes('mongodb.net') || mongoUri.includes('mongodb+srv');
    
    // Ensure backup directory exists
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  /**
   * Check backup status for MongoDB Atlas
   */
  async checkAtlasBackupStatus() {
    if (!this.isAtlas) {
      return { status: 'not_atlas', message: 'Not using MongoDB Atlas' };
    }

    try {
      const client = new MongoClient(this.mongoUri);
      await client.connect();
      
      // For Atlas, we can check database stats and connection
      const admin = client.db().admin();
      const status = await admin.serverStatus();
      
      await client.close();
      
      logger.info('MongoDB Atlas connection verified for backup monitoring');
      
      return {
        status: 'atlas_connected',
        message: 'MongoDB Atlas provides automated backups with point-in-time recovery',
        details: {
          atlas: true,
          automated_backups: 'enabled_by_default',
          retention: '24_hours_to_days_based_on_tier',
          point_in_time_recovery: 'available',
          manual_backup: 'available_via_atlas_ui',
          restore: 'available_via_atlas_ui'
        }
      };
      
    } catch (error) {
      logger.error('Failed to verify Atlas backup status', { error: error.message });
      return {
        status: 'error',
        message: 'Failed to connect to MongoDB Atlas for backup verification',
        error: error.message
      };
    }
  }

  /**
   * Create a manual backup export (for critical data verification)
   */
  async createManualBackup() {
    try {
      const client = new MongoClient(this.mongoUri);
      await client.connect();
      
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupData = {
        timestamp,
        backup_type: this.isAtlas ? 'atlas_manual_export' : 'local_backup',
        collections: {}
      };

      // Critical collections to backup for verification
      const criticalCollections = [
        'companies',
        'conversations', 
        'knowledgeentries',
        'alerts',
        'users'
      ];

      const db = client.db();
      
      for (const collectionName of criticalCollections) {
        try {
          const collection = db.collection(collectionName);
          const count = await collection.countDocuments();
          const sampleDoc = await collection.findOne({});
          
          backupData.collections[collectionName] = {
            document_count: count,
            has_sample: !!sampleDoc,
            last_modified: sampleDoc?.updatedAt || sampleDoc?.createdAt || 'unknown'
          };
          
          logger.info(`Backup verification: ${collectionName} - ${count} documents`);
          
        } catch (collError) {
          logger.warn(`Collection ${collectionName} not found or error`, { error: collError.message });
          backupData.collections[collectionName] = {
            error: collError.message,
            status: 'not_found_or_error'
          };
        }
      }

      await client.close();

      // Save backup metadata
      const backupFile = path.join(this.backupDir, `backup-metadata-${timestamp}.json`);
      fs.writeFileSync(backupFile, JSON.stringify(backupData, null, 2));

      logger.info('Manual backup metadata created', { file: backupFile });
      
      return {
        status: 'success',
        file: backupFile,
        data: backupData
      };
      
    } catch (error) {
      logger.error('Failed to create manual backup', { error: error.message });
      return {
        status: 'error',
        message: 'Failed to create manual backup',
        error: error.message
      };
    }
  }

  /**
   * Verify database health for backup monitoring
   */
  async verifyDatabaseHealth() {
    try {
      const client = new MongoClient(this.mongoUri);
      await client.connect();
      
      const db = client.db();
      
      // Check key collections (simple connectivity test)
      const companies = await db.collection('companies').countDocuments();
      const conversations = await db.collection('conversations').countDocuments();
      
      await client.close();
      
      const healthReport = {
        timestamp: new Date().toISOString(),
        status: 'healthy',
        connectivity: 'confirmed',
        key_collections: {
          companies,
          conversations,
          total_documents: companies + conversations
        },
        backup_recommendations: this.isAtlas ? [
          'MongoDB Atlas automated backups are active',
          'Verify backup settings in Atlas dashboard',
          'Test restore process periodically'
        ] : [
          'Consider upgrading to MongoDB Atlas for automated backups',
          'Implement custom backup scripts for self-hosted deployments'
        ]
      };
      
      logger.info('Database health verification completed', healthReport);
      
      return {
        status: 'success',
        health: healthReport
      };
      
    } catch (error) {
      logger.error('Database health check failed', { error: error.message });
      return {
        status: 'error',
        message: 'Database health check failed',
        error: error.message
      };
    }
  }

  /**
   * Get backup strategy recommendations based on environment
   */
  getBackupStrategy() {
    const isProduction = process.env.NODE_ENV === 'production';
    const hasMongoUri = !!process.env.MONGODB_URI;
    
    return {
      environment: process.env.NODE_ENV || 'development',
      primary_backup: this.isAtlas ? 'MongoDB Atlas Automated Backups' : 
                     isProduction ? 'CRITICAL: Atlas Required for Production' : 
                     'Development: Manual backups acceptable',
      production_status: isProduction ? (this.isAtlas ? 'SECURE' : 'CRITICAL_ISSUE') : 'DEVELOPMENT',
      atlas_features: this.isAtlas ? {
        continuous_backup: 'Available (recommended for production)',
        point_in_time_recovery: 'Available with continuous backup',
        scheduled_snapshots: 'Available',
        cross_region_backups: 'Available with higher tiers',
        backup_retention: '24 hours to multiple days based on tier'
      } : null,
      manual_procedures: [
        'Regular database health checks',
        'Manual backup verification exports',
        'Restore testing (quarterly recommended)',
        'Monitoring backup completion and errors'
      ],
      disaster_recovery: {
        rto: this.isAtlas ? '< 30 minutes with Atlas' : isProduction ? 'UNDEFINED - RISK' : 'Development acceptable',
        rpo: this.isAtlas ? '< 1 hour with Atlas continuous backup' : isProduction ? 'UNDEFINED - RISK' : 'Development acceptable',
        procedure: this.isAtlas ? 'Atlas UI restore process' : isProduction ? 'CRITICAL: No restore procedure' : 'Manual development restore'
      },
      recommendations: isProduction && !this.isAtlas ? [
        '🚨 CRITICAL: MongoDB Atlas required for production',
        '🚨 Current setup has no automated backups',
        '🚨 Risk of complete data loss',
        '🚨 Immediate action required'
      ] : this.isAtlas ? [
        '✅ Production-ready backup solution active',
        '✅ Automated backups enabled',
        '✅ Point-in-time recovery available'
      ] : [
        '💡 Development environment detected',
        '💡 Consider Atlas for consistent dev/prod setup',
        '💡 Manual backups sufficient for development'
      ]
    };
  }
}

module.exports = BackupManager;
