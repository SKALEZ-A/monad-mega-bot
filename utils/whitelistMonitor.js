/**
 * WhitelistMonitor - Comprehensive monitoring and logging for whitelist operations
 */

const fs = require('fs').promises;
const path = require('path');

class WhitelistMonitor {
    constructor(logDir = './logs', whitelistManager = null, whitelistMiddleware = null) {
        this.logDir = path.resolve(logDir);
        this.whitelistManager = whitelistManager;
        this.whitelistMiddleware = whitelistMiddleware;
        
        // Log files
        this.accessLogFile = path.join(this.logDir, 'whitelist-access.log');
        this.modificationLogFile = path.join(this.logDir, 'whitelist-modifications.log');
        this.errorLogFile = path.join(this.logDir, 'whitelist-errors.log');
        this.debugLogFile = path.join(this.logDir, 'whitelist-debug.log');
        
        // Statistics tracking
        this.stats = {
            accessAttempts: {
                total: 0,
                authorized: 0,
                denied: 0,
                errors: 0
            },
            modifications: {
                total: 0,
                additions: 0,
                removals: 0,
                errors: 0
            },
            performance: {
                averageAccessCheckTime: 0,
                slowestAccessCheck: 0,
                totalAccessChecks: 0
            },
            errors: {
                total: 0,
                byType: {}
            }
        };
        
        // Performance tracking
        this.performanceData = [];
        this.maxPerformanceEntries = 1000;
        
        // Health check intervals
        this.healthCheckInterval = null;
        this.healthCheckFrequency = 5 * 60 * 1000; // 5 minutes
        
        // Log rotation settings
        this.maxLogSize = 10 * 1024 * 1024; // 10MB
        this.maxLogFiles = 5;
        
        this.initialized = false;
    }

    /**
     * Initialize the monitoring system
     */
    async initialize() {
        try {
            console.log('📊 Initializing whitelist monitoring...');
            
            // Ensure log directory exists
            await this.ensureLogDirectory();
            
            // Start periodic health checks
            this.startHealthChecks();
            
            // Set up log rotation
            this.setupLogRotation();
            
            this.initialized = true;
            console.log('✅ Whitelist monitoring initialized');
            
        } catch (error) {
            console.error('❌ Error initializing whitelist monitoring:', error);
            throw error;
        }
    }

    /**
     * Ensure log directory exists
     * @private
     */
    async ensureLogDirectory() {
        try {
            await fs.mkdir(this.logDir, { recursive: true, mode: 0o755 });
        } catch (error) {
            if (error.code !== 'EEXIST') {
                throw error;
            }
        }
    }

    /**
     * Log access attempt
     */
    async logAccessAttempt(userId, username, address, result, duration = 0) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            userId,
            username: username || 'Unknown',
            address: address || 'No address',
            result: result ? 'GRANTED' : 'DENIED',
            duration: `${duration}ms`,
            userAgent: 'Telegram Bot'
        };

        // Update statistics
        this.stats.accessAttempts.total++;
        if (result) {
            this.stats.accessAttempts.authorized++;
        } else {
            this.stats.accessAttempts.denied++;
        }

        // Track performance
        this.trackPerformance('access_check', duration);

        // Write to access log
        await this.writeLog(this.accessLogFile, logEntry);

        // Debug logging for denied access
        if (!result) {
            await this.logDebug(`Access denied for user ${userId} (${username}) with address ${address}`);
        }
    }

    /**
     * Log whitelist modification
     */
    async logModification(operation, address, userId, username, success, error = null) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            operation, // 'ADD' or 'REMOVE'
            address,
            userId,
            username: username || 'Unknown',
            success,
            error: error ? error.message : null,
            whitelistSize: this.whitelistManager ? this.whitelistManager.getWhitelistedAddresses().length : 'Unknown'
        };

        // Update statistics
        this.stats.modifications.total++;
        if (success) {
            if (operation === 'ADD') {
                this.stats.modifications.additions++;
            } else if (operation === 'REMOVE') {
                this.stats.modifications.removals++;
            }
        } else {
            this.stats.modifications.errors++;
        }

        // Write to modification log
        await this.writeLog(this.modificationLogFile, logEntry);

        // Log to debug if there was an error
        if (!success && error) {
            await this.logError(`Modification failed: ${operation} ${address}`, error, { userId, username });
        }
    }

    /**
     * Log error
     */
    async logError(message, error, context = {}) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            message,
            error: {
                name: error.name,
                message: error.message,
                stack: error.stack
            },
            context
        };

        // Update error statistics
        this.stats.errors.total++;
        const errorType = error.name || 'Unknown';
        this.stats.errors.byType[errorType] = (this.stats.errors.byType[errorType] || 0) + 1;

        // Write to error log
        await this.writeLog(this.errorLogFile, logEntry);

        // Also log to debug
        await this.logDebug(`ERROR: ${message} - ${error.message}`);
    }

    /**
     * Log debug information
     */
    async logDebug(message, data = null) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: 'DEBUG',
            message,
            data
        };

        await this.writeLog(this.debugLogFile, logEntry);
    }

    /**
     * Write log entry to file
     * @private
     */
    async writeLog(logFile, entry) {
        try {
            const logLine = JSON.stringify(entry) + '\n';
            await fs.appendFile(logFile, logLine, 'utf8');
        } catch (error) {
            console.error(`Failed to write to log file ${logFile}:`, error);
        }
    }

    /**
     * Track performance metrics
     * @private
     */
    trackPerformance(operation, duration) {
        this.performanceData.push({
            operation,
            duration,
            timestamp: Date.now()
        });

        // Keep only recent entries
        if (this.performanceData.length > this.maxPerformanceEntries) {
            this.performanceData = this.performanceData.slice(-this.maxPerformanceEntries);
        }

        // Update performance statistics
        if (operation === 'access_check') {
            this.stats.performance.totalAccessChecks++;
            
            const totalDuration = this.performanceData
                .filter(entry => entry.operation === 'access_check')
                .reduce((sum, entry) => sum + entry.duration, 0);
            
            this.stats.performance.averageAccessCheckTime = 
                totalDuration / this.stats.performance.totalAccessChecks;
            
            if (duration > this.stats.performance.slowestAccessCheck) {
                this.stats.performance.slowestAccessCheck = duration;
            }
        }
    }

    /**
     * Get comprehensive statistics
     */
    getStatistics() {
        const now = Date.now();
        const oneHourAgo = now - (60 * 60 * 1000);
        const oneDayAgo = now - (24 * 60 * 60 * 1000);

        // Calculate recent performance metrics
        const recentPerformance = this.performanceData.filter(
            entry => entry.timestamp > oneHourAgo
        );

        const recentAccessChecks = recentPerformance.filter(
            entry => entry.operation === 'access_check'
        );

        const recentAverageTime = recentAccessChecks.length > 0 ?
            recentAccessChecks.reduce((sum, entry) => sum + entry.duration, 0) / recentAccessChecks.length :
            0;

        return {
            timestamp: new Date().toISOString(),
            uptime: this.initialized ? 'Running' : 'Not initialized',
            
            // Access statistics
            access: {
                ...this.stats.accessAttempts,
                recentHour: {
                    checks: recentAccessChecks.length,
                    averageTime: Math.round(recentAverageTime * 100) / 100
                }
            },
            
            // Modification statistics
            modifications: this.stats.modifications,
            
            // Performance metrics
            performance: {
                ...this.stats.performance,
                averageAccessCheckTime: Math.round(this.stats.performance.averageAccessCheckTime * 100) / 100,
                recentAverageTime: Math.round(recentAverageTime * 100) / 100
            },
            
            // Error statistics
            errors: this.stats.errors,
            
            // System health
            health: this.whitelistManager ? {
                whitelistSize: this.whitelistManager.getWhitelistedAddresses().length,
                maxSize: this.whitelistManager.maxAddresses,
                utilizationPercent: Math.round(
                    (this.whitelistManager.getWhitelistedAddresses().length / this.whitelistManager.maxAddresses) * 100
                )
            } : null,
            
            // Middleware statistics
            middleware: this.whitelistMiddleware ? this.whitelistMiddleware.getMiddlewareStats() : null
        };
    }

    /**
     * Get health status
     */
    async getHealthStatus() {
        const health = {
            status: 'healthy',
            issues: [],
            warnings: [],
            timestamp: new Date().toISOString()
        };

        try {
            // Check if monitoring is initialized
            if (!this.initialized) {
                health.issues.push('Monitoring system not initialized');
                health.status = 'unhealthy';
            }

            // Check log directory accessibility
            try {
                await fs.access(this.logDir, fs.constants.W_OK);
            } catch (error) {
                health.issues.push(`Log directory not writable: ${error.message}`);
                health.status = 'unhealthy';
            }

            // Check error rate
            const errorRate = this.stats.accessAttempts.total > 0 ?
                (this.stats.errors.total / this.stats.accessAttempts.total) * 100 : 0;

            if (errorRate > 10) {
                health.warnings.push(`High error rate: ${errorRate.toFixed(2)}%`);
            }

            // Check performance
            if (this.stats.performance.averageAccessCheckTime > 1000) {
                health.warnings.push(`Slow access checks: ${this.stats.performance.averageAccessCheckTime.toFixed(2)}ms average`);
            }

            // Check whitelist manager health
            if (this.whitelistManager) {
                try {
                    const whitelistHealth = await this.whitelistManager.performHealthCheck();
                    if (whitelistHealth.status !== 'healthy') {
                        health.issues.push(...whitelistHealth.issues);
                        health.warnings.push(...whitelistHealth.warnings);
                        if (whitelistHealth.status === 'unhealthy') {
                            health.status = 'unhealthy';
                        }
                    }
                } catch (error) {
                    health.issues.push(`Whitelist health check failed: ${error.message}`);
                    health.status = 'unhealthy';
                }
            }

            // Check log file sizes
            await this.checkLogFileSizes(health);

        } catch (error) {
            health.issues.push(`Health check failed: ${error.message}`);
            health.status = 'error';
        }

        return health;
    }

    /**
     * Check log file sizes and warn if they're getting large
     * @private
     */
    async checkLogFileSizes(health) {
        const logFiles = [
            this.accessLogFile,
            this.modificationLogFile,
            this.errorLogFile,
            this.debugLogFile
        ];

        for (const logFile of logFiles) {
            try {
                const stats = await fs.stat(logFile);
                const sizeMB = stats.size / (1024 * 1024);
                
                if (sizeMB > this.maxLogSize / (1024 * 1024) * 0.8) {
                    health.warnings.push(`Log file ${path.basename(logFile)} is ${sizeMB.toFixed(2)}MB (approaching rotation threshold)`);
                }
            } catch (error) {
                // File doesn't exist yet, which is fine
                if (error.code !== 'ENOENT') {
                    health.warnings.push(`Could not check size of ${path.basename(logFile)}: ${error.message}`);
                }
            }
        }
    }

    /**
     * Start periodic health checks
     * @private
     */
    startHealthChecks() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
        }

        this.healthCheckInterval = setInterval(async () => {
            try {
                const health = await this.getHealthStatus();
                
                if (health.status === 'unhealthy') {
                    console.warn('⚠️ Whitelist monitoring health issues detected:', health.issues);
                }
                
                if (health.warnings.length > 0) {
                    console.warn('⚠️ Whitelist monitoring warnings:', health.warnings);
                }
                
                // Log health status
                await this.logDebug('Periodic health check', health);
                
            } catch (error) {
                console.error('❌ Error during periodic health check:', error);
                await this.logError('Periodic health check failed', error);
            }
        }, this.healthCheckFrequency);
    }

    /**
     * Setup log rotation
     * @private
     */
    setupLogRotation() {
        // Check log sizes periodically and rotate if needed
        setInterval(async () => {
            await this.rotateLogsIfNeeded();
        }, 60 * 60 * 1000); // Check every hour
    }

    /**
     * Rotate logs if they exceed size limit
     * @private
     */
    async rotateLogsIfNeeded() {
        const logFiles = [
            this.accessLogFile,
            this.modificationLogFile,
            this.errorLogFile,
            this.debugLogFile
        ];

        for (const logFile of logFiles) {
            try {
                const stats = await fs.stat(logFile);
                
                if (stats.size > this.maxLogSize) {
                    await this.rotateLogFile(logFile);
                }
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    console.error(`Error checking log file size ${logFile}:`, error);
                }
            }
        }
    }

    /**
     * Rotate a specific log file
     * @private
     */
    async rotateLogFile(logFile) {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const rotatedFile = `${logFile}.${timestamp}`;
            
            // Move current log to rotated file
            await fs.rename(logFile, rotatedFile);
            
            console.log(`📋 Rotated log file: ${path.basename(logFile)} -> ${path.basename(rotatedFile)}`);
            
            // Clean up old rotated files
            await this.cleanupOldLogFiles(logFile);
            
        } catch (error) {
            console.error(`Error rotating log file ${logFile}:`, error);
        }
    }

    /**
     * Clean up old rotated log files
     * @private
     */
    async cleanupOldLogFiles(baseLogFile) {
        try {
            const logDir = path.dirname(baseLogFile);
            const baseName = path.basename(baseLogFile);
            
            const files = await fs.readdir(logDir);
            const rotatedFiles = files
                .filter(file => file.startsWith(`${baseName}.`))
                .map(file => ({
                    name: file,
                    path: path.join(logDir, file),
                    stat: null
                }));

            // Get file stats
            for (const file of rotatedFiles) {
                try {
                    file.stat = await fs.stat(file.path);
                } catch (error) {
                    console.warn(`Could not stat rotated log file ${file.name}:`, error);
                }
            }

            // Sort by modification time (newest first)
            const validFiles = rotatedFiles
                .filter(file => file.stat)
                .sort((a, b) => b.stat.mtime - a.stat.mtime);

            // Remove old files beyond the limit
            if (validFiles.length > this.maxLogFiles) {
                const filesToDelete = validFiles.slice(this.maxLogFiles);
                
                for (const file of filesToDelete) {
                    try {
                        await fs.unlink(file.path);
                        console.log(`🗑️ Deleted old log file: ${file.name}`);
                    } catch (error) {
                        console.warn(`Could not delete old log file ${file.name}:`, error);
                    }
                }
            }

        } catch (error) {
            console.error('Error cleaning up old log files:', error);
        }
    }

    /**
     * Generate monitoring report
     */
    async generateReport() {
        const stats = this.getStatistics();
        const health = await this.getHealthStatus();
        
        const report = {
            generatedAt: new Date().toISOString(),
            summary: {
                status: health.status,
                totalAccessAttempts: stats.access.total,
                successRate: stats.access.total > 0 ? 
                    ((stats.access.authorized / stats.access.total) * 100).toFixed(2) + '%' : 'N/A',
                totalModifications: stats.modifications.total,
                errorRate: stats.access.total > 0 ? 
                    ((stats.errors.total / stats.access.total) * 100).toFixed(2) + '%' : 'N/A',
                averageResponseTime: stats.performance.averageAccessCheckTime.toFixed(2) + 'ms'
            },
            statistics: stats,
            health: health
        };

        return report;
    }

    /**
     * Reset statistics
     */
    resetStatistics() {
        this.stats = {
            accessAttempts: { total: 0, authorized: 0, denied: 0, errors: 0 },
            modifications: { total: 0, additions: 0, removals: 0, errors: 0 },
            performance: { averageAccessCheckTime: 0, slowestAccessCheck: 0, totalAccessChecks: 0 },
            errors: { total: 0, byType: {} }
        };
        
        this.performanceData = [];
        
        console.log('📊 Whitelist monitoring statistics reset');
    }

    /**
     * Shutdown monitoring system
     */
    shutdown() {
        if (this.healthCheckInterval) {
            clearInterval(this.healthCheckInterval);
            this.healthCheckInterval = null;
        }
        
        this.initialized = false;
        console.log('📊 Whitelist monitoring shutdown');
    }
}

module.exports = WhitelistMonitor;