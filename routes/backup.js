const express = require('express');
const router = express.Router();
const BackupManager = require('../utils/backupManager');
const logger = require('../utils/logger');
const { authenticateJWT, requireRole } = require('../middleware/auth');

/**
 * Backup monitoring and management endpoints
 * All endpoints require admin authentication for security
 */

// Apply authentication middleware to all backup routes
router.use(authenticateJWT, requireRole('admin'));

// GET /api/backup/status - Check backup status and strategy
router.get('/status', async (req, res) => {
  try {
    const backupManager = new BackupManager(process.env.MONGODB_URI);
    
    // Get backup strategy
    const strategy = backupManager.getBackupStrategy();
    
    // Check Atlas backup status
    const atlasStatus = await backupManager.checkAtlasBackupStatus();
    
    // Verify database health
    const healthCheck = await backupManager.verifyDatabaseHealth();
    
    const backupStatus = {
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      backup_strategy: strategy,
      atlas_status: atlasStatus,
      database_health: healthCheck,
      overall_status: atlasStatus.status === 'atlas_connected' ? 'secure' : 
                     strategy.production_status === 'CRITICAL_ISSUE' ? 'critical' : 'warning'
    };
    
    // Log backup check
    logger.info('Backup status checked', {
      status: backupStatus.overall_status,
      atlas: atlasStatus.status,
      health: healthCheck.status
    });
    
    // Return appropriate HTTP status
    const httpStatus = backupStatus.overall_status === 'secure' ? 200 :
                      backupStatus.overall_status === 'critical' ? 503 : 200;
    
    res.status(httpStatus).json(backupStatus);
    
  } catch (error) {
    logger.error('Backup status check failed', { error: error.message });
    res.status(500).json({
      error: 'Backup status check failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/backup/verify - Create manual backup verification
router.post('/verify', async (req, res) => {
  try {
    const backupManager = new BackupManager(process.env.MONGODB_URI);
    
    const manualBackup = await backupManager.createManualBackup();
    
    logger.info('Manual backup verification requested', { 
      status: manualBackup.status,
      file: manualBackup.file 
    });
    
    res.json({
      timestamp: new Date().toISOString(),
      manual_backup: manualBackup,
      message: 'Manual backup verification completed'
    });
    
  } catch (error) {
    logger.error('Manual backup verification failed', { error: error.message });
    res.status(500).json({
      error: 'Manual backup verification failed',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/backup/recommendations - Get backup recommendations
router.get('/recommendations', async (req, res) => {
  try {
    const backupManager = new BackupManager(process.env.MONGODB_URI);
    const strategy = backupManager.getBackupStrategy();
    
    res.json({
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      recommendations: strategy.recommendations,
      disaster_recovery: strategy.disaster_recovery,
      next_steps: strategy.production_status === 'CRITICAL_ISSUE' ? [
        'Migrate to MongoDB Atlas immediately',
        'Configure automated backups',
        'Test restore procedures',
        'Document disaster recovery plan'
      ] : strategy.atlas_features ? [
        'Verify Atlas backup settings monthly',
        'Test restore procedures quarterly',
        'Monitor backup completion logs',
        'Review retention policies annually'
      ] : [
        'Consider upgrading to Atlas for production',
        'Implement manual backup procedures',
        'Schedule regular data exports'
      ]
    });
    
  } catch (error) {
    logger.error('Backup recommendations request failed', { error: error.message });
    res.status(500).json({
      error: 'Failed to get backup recommendations',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
