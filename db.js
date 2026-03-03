// admin-dashboard/db.js
const mongoose = require('mongoose'); // <<< ADD MONGOOSE
const { MongoClient } = require('mongodb'); // Keep if you have other parts strictly needing a separate native client, otherwise Mongoose's client can be used.
const logger = require('./utils/logger');

// const dotenv = require('dotenv');

// Load environment variables from .env file
// dotenv.config();

const uri = process.env.MONGODB_URI;
let dbInstance = null; // This will now be derived from Mongoose or can be the separate MongoClient if needed.
let AdminNotificationService; // Lazy load to avoid circular dependency

/**
 * Connects to the MongoDB database using Mongoose.
 * Also makes the native DB instance available via Mongoose's connection.
 */
const connectDB = async () => {
    // Lazy load AdminNotificationService to avoid circular dependency
    if (!AdminNotificationService) {
        try {
            AdminNotificationService = require('./services/AdminNotificationService');
        } catch (err) {
            logger.warn('⚠️ [DB] AdminNotificationService not available during connection', { error: err.message });
        }
    }

    if (mongoose.connection.readyState === 1 && dbInstance) { // 1 === connected
        // console.log('[Mongoose & MongoDB Connection] Using existing connections.');
        return dbInstance; // Or just return, as Mongoose handles its own singleton
    }

    if (!uri) {
        const errorMsg = 'MONGODB_URI is not defined in .env file.';
        console.error('[MongoDB Connection]', errorMsg);
        
        // 🚨 CRITICAL: Missing MongoDB URI - platform cannot start
        if (AdminNotificationService) {
            await AdminNotificationService.sendAlert({
                code: 'DB_CONNECTION_MISSING_URI',
                severity: 'CRITICAL',
                companyId: null,
                companyName: 'Platform',
                message: '🔴 CRITICAL: MongoDB connection failed - MONGODB_URI missing',
                details: 'Environment variable MONGODB_URI is not configured. Platform cannot connect to database.',
                stackTrace: new Error().stack
            }).catch(notifErr => logger.error('Failed to send DB alert:', notifErr));
        }
        
        throw new Error('MONGODB_URI is not defined.');
    }

    // 🚨 CRITICAL: Validate URI includes explicit database name
    // We NEVER use default "test" database - always explicit production DB
    let dbNameFromUri = null;
    try {
        // Try to extract database name from URI
        // Handles both mongodb:// and mongodb+srv:// formats
        const uriMatch = uri.match(/mongodb(?:\+srv)?:\/\/[^/]+\/([^?&]+)/);
        dbNameFromUri = uriMatch && uriMatch[1] ? uriMatch[1].trim() : null;
    } catch (parseError) {
        console.warn('[MongoDB Connection] Could not parse database name from URI:', parseError.message);
    }
    
    if (!dbNameFromUri || dbNameFromUri === '') {
        const errorMsg = '🔴 FATAL: MONGODB_URI missing database name - would default to "test"';
        console.error('[MongoDB Connection]', errorMsg);
        console.error('[MongoDB Connection] Current URI sample: mongodb://...@host/?options');
        console.error('[MongoDB Connection] Required pattern:  mongodb://...@host/clientsvia?options');
        console.error('[MongoDB Connection]                                        ^^^^^^^^^^');
        console.error('[MongoDB Connection] Add "/clientsvia" after host, before "?"');
        console.error('[MongoDB Connection] Your URI starts with:', uri.substring(0, 50) + '...');
        
        throw new Error('MONGODB_URI must include explicit database name (e.g., /clientsvia). We do not use "test" database.');
    }
    
    if (dbNameFromUri === 'test') {
        console.error('[MongoDB Connection] 🔴 FATAL: URI explicitly set to "test" database');
        console.error('[MongoDB Connection] We do not use "test" database - change to /clientsvia');
        throw new Error('MONGODB_URI set to "test" database. Change to /clientsvia');
    }
    
    console.log('[MongoDB Connection] ✅ URI validation passed - Database name:', dbNameFromUri);

    const connectionStartTime = Date.now();

    try {
        // --- ENABLE AUTO-INDEX CREATION ---
        // ✅ Ensures all schema indexes (including text indexes) are created automatically
        // This is critical for Call Archives search functionality
        mongoose.set('autoIndex', true);
        console.log('[Mongoose] ✅ Auto-index enabled - all schema indexes will be created');
        
        // --- ESTABLISH MONGOOSE CONNECTION ---
        await mongoose.connect(uri, {
            // useNewUrlParser: true, // Deprecated in Mongoose 6+
            // useUnifiedTopology: true, // Deprecated in Mongoose 6+
            serverSelectionTimeoutMS: 10000, // 10s timeout
            socketTimeoutMS: 45000, // 45s socket timeout
        });
        
        const connectionTime = Date.now() - connectionStartTime;
        const dbName = mongoose.connection.name;
        const dbHost = mongoose.connection.host;
        const isProduction = process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';
        
        // 🚨 CRITICAL: NEVER allow "test" database - even in development
        // User requirement: "we test live as we go like a customer would"
        // NO test mode switches, NO accidental test database usage
        if (dbName === 'test') {
            const errorMsg = '🔴 FATAL: Server connected to "test" database! This is NEVER allowed.';
            console.error('[MongoDB Connection]', errorMsg);
            console.error('[MongoDB Connection] We do not use "test" mode or "test" database.');
            console.error('[MongoDB Connection] URI must include explicit database name: mongodb://.../<database_name>?...');
            console.error('[MongoDB Connection] Expected: mongodb://...@cluster.../clientsvia?...');
            console.error('[MongoDB Connection] Current DB:', dbName);
            console.error('[MongoDB Connection] Connection host:', mongoose.connection.host);
            console.error('[MongoDB Connection] This happened despite URI validation passing.');
            console.error('[MongoDB Connection] Check if URI was changed after validation or if Mongoose defaulted to "test"');
            
            if (AdminNotificationService) {
                await AdminNotificationService.sendAlert({
                    code: 'DB_CONNECTION_TEST_BLOCKED',
                    severity: 'CRITICAL',
                    companyId: null,
                    companyName: 'Platform',
                    message: '🔴 FATAL: Attempted to connect to "test" database',
                    details: `Server connected to MongoDB "test" database despite URI validation. This is never allowed - we test live with production database. Fix MONGODB_URI to include explicit database name (/clientsvia). Host: ${mongoose.connection.host}`,
                    stackTrace: new Error().stack
                }).catch(notifErr => logger.error('Failed to send DB test alert:', notifErr));
            }
            
            throw new Error('NEVER use "test" database. Update MONGODB_URI to: mongodb://...@cluster.../clientsvia?...');
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // STARTUP TRUTH BANNER - LOUD, VISIBLE, CANNOT BE IGNORED
        // Shows EXACTLY where production data lives - no guessing, no defaults
        // ═══════════════════════════════════════════════════════════════════════════
        console.log('\n');
        console.log('╔═══════════════════════════════════════════════════════════════════════════╗');
        console.log('║                    🎯 RUNTIME TRUTH - DATABASE CONNECTION                ║');
        console.log('╠═══════════════════════════════════════════════════════════════════════════╣');
        console.log(`║  Environment:     ${(process.env.NODE_ENV || 'undefined').toUpperCase().padEnd(56)} ║`);
        console.log(`║  Mongo Host:      ${dbHost.padEnd(56)} ║`);
        console.log(`║  Database Name:   ${dbName.padEnd(56)} ║`);
        console.log(`║  Connect Time:    ${(connectionTime + 'ms').padEnd(56)} ║`);
        console.log(`║  Ready State:     ${mongoose.connection.readyState === 1 ? 'CONNECTED'.padEnd(56) : 'ERROR'.padEnd(56)} ║`);
        console.log('╚═══════════════════════════════════════════════════════════════════════════╝');
        console.log('');
        
        logger.info('✅ [DB] MongoDB connected', {
            connectionTimeMs: connectionTime,
            host: dbHost,
            database: dbName,
            environment: process.env.NODE_ENV,
            isProduction
        });

        // ⚠️ WARNING: Slow database connection
        if (connectionTime > 5000 && AdminNotificationService) {
            await AdminNotificationService.sendAlert({
                code: 'DB_CONNECTION_SLOW',
                severity: 'WARNING',
                companyId: null,
                companyName: 'Platform',
                message: '⚠️ Slow MongoDB connection detected',
                details: `Database connection took ${connectionTime}ms (threshold: 5000ms). This may indicate network latency or MongoDB Atlas performance issues.`,
                stackTrace: null
            }).catch(notifErr => logger.error('Failed to send DB slow alert:', notifErr));
        }

        // Make the native 'Db' object available from Mongoose's connection
        // This dbInstance will be compatible with code expecting a native Db object.
        dbInstance = mongoose.connection.db;

        // ========================================================================
        // MONGOOSE CONNECTION EVENT MONITORING
        // ========================================================================
        
        // 🚨 CRITICAL: Database disconnected
        mongoose.connection.on('disconnected', async () => {
            logger.error('❌ [DB] MongoDB disconnected');
            if (AdminNotificationService) {
                await AdminNotificationService.sendAlert({
                    code: 'DB_CONNECTION_LOST',
                    severity: 'CRITICAL',
                    companyId: null,
                    companyName: 'Platform',
                    message: '🔴 CRITICAL: MongoDB connection lost',
                    details: 'Database connection was unexpectedly closed. Platform cannot serve requests until reconnected.',
                    stackTrace: new Error().stack
                }).catch(notifErr => logger.error('Failed to send DB disconnect alert:', notifErr));
            }
        });

        // ✅ INFO: Database reconnected
        mongoose.connection.on('reconnected', async () => {
            logger.info('✅ [DB] MongoDB reconnected');
            if (AdminNotificationService) {
                await AdminNotificationService.sendAlert({
                    code: 'DB_CONNECTION_RESTORED',
                    severity: 'INFO',
                    companyId: null,
                    companyName: 'Platform',
                    message: '✅ MongoDB connection restored',
                    details: 'Database connection has been successfully re-established.',
                    stackTrace: null
                }).catch(notifErr => logger.error('Failed to send DB reconnect alert:', notifErr));
            }
        });

        // 🚨 CRITICAL: Database error
        mongoose.connection.on('error', async (err) => {
            logger.error('❌ [DB] MongoDB error', { error: err.message, stack: err.stack });
            if (AdminNotificationService) {
                await AdminNotificationService.sendAlert({
                    code: 'DB_CONNECTION_ERROR',
                    severity: 'CRITICAL',
                    companyId: null,
                    companyName: 'Platform',
                    message: '🔴 CRITICAL: MongoDB connection error',
                    details: `Database error: ${err.message}`,
                    stackTrace: err.stack
                }).catch(notifErr => logger.error('Failed to send DB error alert:', notifErr));
            }
        });

        return dbInstance; // Or just fulfill promise, Mongoose connection is global

    } catch (e) {
        const connectionTime = Date.now() - connectionStartTime;
        console.error('[Mongoose/MongoDB Connection] [ERROR] Failed to connect:', e.message);
        console.error(e.stack); // Log full stack for more details
        
        logger.error('❌ [DB] MongoDB connection failed', {
            error: e.message,
            stack: e.stack,
            connectionTimeMs: connectionTime,
            uri: uri ? uri.replace(/\/\/([^:]+):([^@]+)@/, '//***:***@') : 'undefined' // Mask credentials
        });

        // 🚨 CRITICAL: Database connection failed
        if (AdminNotificationService) {
            await AdminNotificationService.sendAlert({
                code: 'DB_CONNECTION_FAILURE',
                severity: 'CRITICAL',
                companyId: null,
                companyName: 'Platform',
                message: '🔴 CRITICAL: MongoDB connection failed - Platform DOWN',
                details: {
                    error: e.message,
                    connectionTimeMs: connectionTime,
                    errorCode: e.code || 'UNKNOWN',
                    errorName: e.name || 'Error',
                    impact: 'ALL features unavailable - Cannot serve any requests',
                    action: 'Check MongoDB Atlas cluster status, verify MONGODB_URI, check network connectivity, verify IP whitelist includes Render IPs'
                },
                stackTrace: e.stack
            }).catch(notifErr => logger.error('Failed to send DB connection failure alert:', notifErr));
        }
        
        throw e; // Re-throw the error so the caller (e.g., index.js) can be aware
    }
};

/**
 * Returns the active native database instance (from Mongoose's connection).
 * Throws an error if Mongoose is not connected.
 */
const getDB = () => {
    if (mongoose.connection.readyState !== 1) { // 1 means connected
        console.error('[MongoDB getDB] Mongoose is not connected. Ensure connectDB() was called successfully.');
        throw new Error('Database not initialized (Mongoose not connected).');
    }
    return mongoose.connection.db; // Return the native Db instance from Mongoose
};

// ============================================================================
// 🔴 CRITICAL: Import Redis client correctly as getter
// ============================================================================
// WRONG: const { redisClient } = require('./clients');
// This destructures at module load time when redisClient is null!
//
// CORRECT: Import the entire module and access via getter
// This ensures we always get the current redisClient value
// ============================================================================
const clients = require('./clients');

// Export both functions + redisClient getter
module.exports = { 
  connectDB, 
  getDB, 
  get redisClient() {
    return clients.redisClient;
  }
};
