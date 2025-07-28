require('dotenv').config();
const cron = require('node-cron');
const BackupManager = require('../utils/backupManager');
const logger = require('../utils/logger');

/**
 * Automated Backup Monitoring Service
 * Runs daily backup health checks and notifications
 */

class BackupMonitoringService {
  constructor() {
    this.backupManager = new BackupManager(process.env.MONGODB_URI);
    this.isRunning = false;
  }

  /**
   * Start the backup monitoring service
   */
  start() {
    if (this.isRunning) {
      logger.info('Backup monitoring service is already running');
      return;
    }

    logger.info('🔄 Starting automated backup monitoring service...');
    
    // Run daily backup health check at 2 AM
    cron.schedule('0 2 * * *', async () => {
      await this.performDailyBackupCheck();
    });

    // Run weekly backup verification at 3 AM on Sundays  
    cron.schedule('0 3 * * 0', async () => {
      await this.performWeeklyBackupVerification();
    });

    // Run monthly backup strategy review at 4 AM on 1st of month
    cron.schedule('0 4 1 * *', async () => {
      await this.performMonthlyBackupReview();
    });

    this.isRunning = true;
    logger.info('✅ Backup monitoring service started with scheduled tasks');
    
    // Run initial check
    setTimeout(() => this.performDailyBackupCheck(), 5000);
  }

  /**
   * Stop the backup monitoring service
   */
  stop() {
    if (!this.isRunning) {
      logger.info('Backup monitoring service is not running');
      return;
    }

    logger.info('🛑 Stopping backup monitoring service...');
    this.isRunning = false;
    logger.info('✅ Backup monitoring service stopped');
  }

  /**
   * Daily backup health check
   */
  async performDailyBackupCheck() {
    try {
      logger.info('🔍 Running daily backup health check...');
      
      const healthCheck = await this.backupManager.verifyDatabaseHealth();
      const atlasStatus = await this.backupManager.checkAtlasBackupStatus();
      
      if (healthCheck.status === 'success' && atlasStatus.status === 'atlas_connected') {
        logger.info('✅ Daily backup check: All systems healthy');
        logger.info('Daily backup verification passed', {
          database_health: healthCheck.status,
          atlas_status: atlasStatus.status,
          collections: healthCheck.health?.key_collections?.companies || 0,
          total_documents: healthCheck.health?.key_collections?.total_documents || 0
        });
      } else {
        logger.error('❌ Daily backup check: Issues detected', {
          database_health: healthCheck.status,
          atlas_status: atlasStatus.status,
          issues: healthCheck.issues || []
        });
        
        // Send alert for backup issues
        await this.sendBackupAlert('Daily backup check failed', {
          healthCheck,
          atlasStatus
        });
      }
      
    } catch (error) {
      logger.error('Daily backup check failed:', error);
      await this.sendBackupAlert('Daily backup check error', { error: error.message });
    }
  }

  /**
   * Weekly backup verification with detailed reporting
   */
  async performWeeklyBackupVerification() {
    try {
      logger.info('📊 Running weekly backup verification...');
      
      const strategy = this.backupManager.getBackupStrategy();
      const healthCheck = await this.backupManager.verifyDatabaseHealth();
      const atlasStatus = await this.backupManager.checkAtlasBackupStatus();
      
      // Create detailed weekly report
      const weeklyReport = {
        timestamp: new Date().toISOString(),
        backup_strategy: strategy,
        database_health: healthCheck,
        atlas_status: atlasStatus,
        recommendations: []
      };
      
      // Add recommendations based on status
      if (atlasStatus.status === 'not_atlas') {
        weeklyReport.recommendations.push('Upgrade to MongoDB Atlas for automated backups');
      }
      
      if (healthCheck.details?.collections < 5) {
        weeklyReport.recommendations.push('Monitor collection growth trends');
      }
      
      logger.info('Weekly backup verification completed', weeklyReport);
      
      // Create manual backup metadata for additional safety
      const manualBackup = await this.backupManager.createManualBackup();
      logger.info(`📝 Manual backup metadata created: ${manualBackup.backup_id}`);
      
    } catch (error) {
      logger.error('Weekly backup verification failed:', error);
      await this.sendBackupAlert('Weekly backup verification error', { error: error.message });
    }
  }

  /**
   * Monthly backup strategy review
   */
  async performMonthlyBackupReview() {
    try {
      logger.info('📈 Running monthly backup strategy review...');
      
      const strategy = this.backupManager.getBackupStrategy();
      const healthCheck = await this.backupManager.verifyDatabaseHealth();
      
      // Generate comprehensive monthly report
      const monthlyReport = {
        timestamp: new Date().toISOString(),
        period: 'monthly_review',
        current_strategy: strategy,
        database_growth: healthCheck.details,
        recommendations: [
          'Review backup retention policies',
          'Validate restore procedures',
          'Check backup storage usage',
          'Update backup documentation'
        ],
        action_items: []
      };
      
      // Check if Atlas migration is needed
      if (strategy.type === 'local_mongodb') {
        monthlyReport.action_items.push({
          priority: 'HIGH',
          action: 'Migrate to MongoDB Atlas for production-grade automated backups',
          reason: 'Local MongoDB requires manual backup management'
        });
      }
      
      // Check database size trends
      if (healthCheck.details?.total_documents > 10000) {
        monthlyReport.action_items.push({
          priority: 'MEDIUM', 
          action: 'Implement data archiving strategy',
          reason: 'Database growth may impact backup/restore times'
        });
      }
      
      logger.info('Monthly backup strategy review completed', monthlyReport);
      
    } catch (error) {
      logger.error('Monthly backup strategy review failed:', error);
      await this.sendBackupAlert('Monthly backup review error', { error: error.message });
    }
  }

  /**
   * Send backup alert (placeholder for notification system)
   */
  async sendBackupAlert(subject, details) {
    logger.error(`🚨 BACKUP ALERT: ${subject}`, details);
    
    // TODO: Integrate with notification system (email, Slack, etc.)
    // For now, just log the alert
    logger.security('Backup alert triggered', {
      alert_type: 'backup_monitoring',
      subject,
      details,
      requires_attention: true
    });
  }

  /**
   * Get service status
   */
  getStatus() {
    return {
      service: 'BackupMonitoringService',
      status: this.isRunning ? 'running' : 'stopped',
      schedules: {
        daily_check: '0 2 * * * (2 AM daily)',
        weekly_verification: '0 3 * * 0 (3 AM Sundays)', 
        monthly_review: '0 4 1 * * (4 AM 1st of month)'
      },
      next_run_times: this.isRunning ? 'Scheduled' : 'Not scheduled'
    };
  }
}

module.exports = BackupMonitoringService;
