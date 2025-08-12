const WhitelistMonitor = require('../utils/whitelistMonitor');
const WhitelistManager = require('../utils/whitelistManager');
const WhitelistMiddleware = require('../utils/whitelistMiddleware');
const fs = require('fs').promises;

// Mock file system operations
jest.mock('fs/promises');

describe('Whitelist Monitoring Tests', () => {
    let monitor;
    let mockWhitelistManager;
    let mockWhitelistMiddleware;

    beforeEach(async () => {
        jest.clearAllMocks();
        
        // Mock file system operations
        fs.mkdir.mockResolvedValue();
        fs.appendFile.mockResolvedValue();
        fs.stat.mockResolvedValue({ size: 1024 });
        fs.readdir.mockResolvedValue([]);
        fs.access.mockResolvedValue();
        fs.rename.mockResolvedValue();
        fs.unlink.mockResolvedValue();
        
        // Create mock whitelist manager
        mockWhitelistManager = {
            getWhitelistedAddresses: jest.fn().mockReturnValue(['0xe2f92e8f706997b021919a092437372b268a432d']),
            maxAddresses: 1000,
            performHealthCheck: jest.fn().mockResolvedValue({
                status: 'healthy',
                issues: [],
                warnings: []
            })
        };
        
        // Create mock whitelist middleware
        mockWhitelistMiddleware = {
            getMiddlewareStats: jest.fn().mockReturnValue({
                totalRequests: 100,
                authorizedRequests: 80,
                deniedRequests: 20
            })
        };
        
        // Initialize monitor
        monitor = new WhitelistMonitor('./test-logs', mockWhitelistManager, mockWhitelistMiddleware);
        await monitor.initialize();
    });

    afterEach(() => {
        if (monitor) {
            monitor.shutdown();
        }
    });

    describe('Initialization', () => {
        test('should initialize monitoring system successfully', async () => {
            expect(monitor.initialized).toBe(true);
            expect(fs.mkdir).toHaveBeenCalledWith(
                expect.stringContaining('test-logs'),
                { recursive: true, mode: 0o755 }
            );
        });

        test('should handle log directory creation failure', async () => {
            fs.mkdir.mockRejectedValueOnce(new Error('Permission denied'));
            
            const newMonitor = new WhitelistMonitor('./test-logs');
            
            await expect(newMonitor.initialize()).rejects.toThrow('Permission denied');
        });
    });

    describe('Access Logging', () => {
        test('should log successful access attempt', async () => {
            await monitor.logAccessAttempt(123456, 'testuser', '0xe2f92e8f706997b021919a092437372b268a432d', true, 150);
            
            expect(fs.appendFile).toHaveBeenCalledWith(
                expect.stringContaining('whitelist-access.log'),
                expect.stringContaining('"result":"GRANTED"'),
                'utf8'
            );
            
            expect(monitor.stats.accessAttempts.total).toBe(1);
            expect(monitor.stats.accessAttempts.authorized).toBe(1);
        });

        test('should log denied access attempt', async () => {
            await monitor.logAccessAttempt(123456, 'testuser', '0x1234567890123456789012345678901234567890', false, 100);
            
            expect(fs.appendFile).toHaveBeenCalledWith(
                expect.stringContaining('whitelist-access.log'),
                expect.stringContaining('"result":"DENIED"'),
                'utf8'
            );
            
            expect(monitor.stats.accessAttempts.total).toBe(1);
            expect(monitor.stats.accessAttempts.denied).toBe(1);
        });

        test('should track performance metrics', async () => {
            await monitor.logAccessAttempt(123456, 'testuser', '0xe2f92e8f706997b021919a092437372b268a432d', true, 200);
            
            expect(monitor.stats.performance.totalAccessChecks).toBe(1);
            expect(monitor.stats.performance.averageAccessCheckTime).toBe(200);
            expect(monitor.stats.performance.slowestAccessCheck).toBe(200);
        });
    });

    describe('Modification Logging', () => {
        test('should log successful address addition', async () => {
            await monitor.logModification('ADD', '0x1234567890123456789012345678901234567890', 123456, 'admin', true);
            
            expect(fs.appendFile).toHaveBeenCalledWith(
                expect.stringContaining('whitelist-modifications.log'),
                expect.stringContaining('"operation":"ADD"'),
                'utf8'
            );
            
            expect(monitor.stats.modifications.total).toBe(1);
            expect(monitor.stats.modifications.additions).toBe(1);
        });

        test('should log failed address removal', async () => {
            const error = new Error('Address not found');
            await monitor.logModification('REMOVE', '0x1234567890123456789012345678901234567890', 123456, 'admin', false, error);
            
            expect(fs.appendFile).toHaveBeenCalledWith(
                expect.stringContaining('whitelist-modifications.log'),
                expect.stringContaining('"success":false'),
                'utf8'
            );
            
            expect(monitor.stats.modifications.total).toBe(1);
            expect(monitor.stats.modifications.errors).toBe(1);
        });
    });

    describe('Error Logging', () => {
        test('should log errors with context', async () => {
            const error = new Error('Database connection failed');
            const context = { userId: 123456, operation: 'addAddress' };
            
            await monitor.logError('Failed to add address', error, context);
            
            expect(fs.appendFile).toHaveBeenCalledWith(
                expect.stringContaining('whitelist-errors.log'),
                expect.stringContaining('"message":"Failed to add address"'),
                'utf8'
            );
            
            expect(monitor.stats.errors.total).toBe(1);
            expect(monitor.stats.errors.byType['Error']).toBe(1);
        });

        test('should track error types', async () => {
            await monitor.logError('Type error', new TypeError('Invalid type'), {});
            await monitor.logError('Reference error', new ReferenceError('Undefined variable'), {});
            await monitor.logError('Another type error', new TypeError('Another type issue'), {});
            
            expect(monitor.stats.errors.byType['TypeError']).toBe(2);
            expect(monitor.stats.errors.byType['ReferenceError']).toBe(1);
        });
    });

    describe('Statistics', () => {
        test('should provide comprehensive statistics', async () => {
            // Generate some test data
            await monitor.logAccessAttempt(123456, 'user1', '0xe2f92e8f706997b021919a092437372b268a432d', true, 100);
            await monitor.logAccessAttempt(789012, 'user2', '0x1234567890123456789012345678901234567890', false, 150);
            await monitor.logModification('ADD', '0x1111111111111111111111111111111111111111', 123456, 'admin', true);
            
            const stats = monitor.getStatistics();
            
            expect(stats).toHaveProperty('timestamp');
            expect(stats).toHaveProperty('access');
            expect(stats).toHaveProperty('modifications');
            expect(stats).toHaveProperty('performance');
            expect(stats).toHaveProperty('errors');
            expect(stats).toHaveProperty('health');
            
            expect(stats.access.total).toBe(2);
            expect(stats.access.authorized).toBe(1);
            expect(stats.access.denied).toBe(1);
            expect(stats.modifications.total).toBe(1);
            expect(stats.modifications.additions).toBe(1);
        });

        test('should calculate performance metrics correctly', async () => {
            await monitor.logAccessAttempt(123456, 'user1', '0xe2f92e8f706997b021919a092437372b268a432d', true, 100);
            await monitor.logAccessAttempt(123456, 'user1', '0xe2f92e8f706997b021919a092437372b268a432d', true, 200);
            await monitor.logAccessAttempt(123456, 'user1', '0xe2f92e8f706997b021919a092437372b268a432d', true, 300);
            
            const stats = monitor.getStatistics();
            
            expect(stats.performance.totalAccessChecks).toBe(3);
            expect(stats.performance.averageAccessCheckTime).toBe(200);
            expect(stats.performance.slowestAccessCheck).toBe(300);
        });
    });

    describe('Health Monitoring', () => {
        test('should perform health check successfully', async () => {
            const health = await monitor.getHealthStatus();
            
            expect(health).toHaveProperty('status');
            expect(health).toHaveProperty('issues');
            expect(health).toHaveProperty('warnings');
            expect(health).toHaveProperty('timestamp');
            
            expect(health.status).toBe('healthy');
            expect(health.issues).toHaveLength(0);
        });

        test('should detect high error rate', async () => {
            // Generate high error rate
            for (let i = 0; i < 10; i++) {
                await monitor.logError('Test error', new Error('Test'), {});
            }
            
            // Generate some access attempts
            for (let i = 0; i < 5; i++) {
                await monitor.logAccessAttempt(123456, 'user', '0xe2f92e8f706997b021919a092437372b268a432d', true, 100);
            }
            
            const health = await monitor.getHealthStatus();
            
            expect(health.warnings.some(w => w.includes('High error rate'))).toBe(true);
        });

        test('should detect slow performance', async () => {
            // Generate slow access checks
            await monitor.logAccessAttempt(123456, 'user', '0xe2f92e8f706997b021919a092437372b268a432d', true, 2000);
            
            const health = await monitor.getHealthStatus();
            
            expect(health.warnings.some(w => w.includes('Slow access checks'))).toBe(true);
        });

        test('should handle whitelist manager health check failure', async () => {
            mockWhitelistManager.performHealthCheck.mockRejectedValue(new Error('Health check failed'));
            
            const health = await monitor.getHealthStatus();
            
            expect(health.issues.some(i => i.includes('Whitelist health check failed'))).toBe(true);
            expect(health.status).toBe('unhealthy');
        });
    });

    describe('Log Rotation', () => {
        test('should rotate logs when size limit exceeded', async () => {
            // Mock large file size
            fs.stat.mockResolvedValue({ size: 15 * 1024 * 1024 }); // 15MB
            
            await monitor.rotateLogsIfNeeded();
            
            expect(fs.rename).toHaveBeenCalled();
        });

        test('should clean up old log files', async () => {
            // Mock multiple old log files
            fs.readdir.mockResolvedValue([
                'whitelist-access.log.2024-01-01',
                'whitelist-access.log.2024-01-02',
                'whitelist-access.log.2024-01-03',
                'whitelist-access.log.2024-01-04',
                'whitelist-access.log.2024-01-05',
                'whitelist-access.log.2024-01-06',
                'whitelist-access.log.2024-01-07'
            ]);
            
            fs.stat.mockImplementation((path) => {
                const date = path.includes('2024-01-07') ? new Date('2024-01-07') : new Date('2024-01-01');
                return Promise.resolve({ mtime: date });
            });
            
            await monitor.cleanupOldLogFiles('./test-logs/whitelist-access.log');
            
            expect(fs.unlink).toHaveBeenCalled();
        });
    });

    describe('Report Generation', () => {
        test('should generate comprehensive monitoring report', async () => {
            // Generate test data
            await monitor.logAccessAttempt(123456, 'user1', '0xe2f92e8f706997b021919a092437372b268a432d', true, 100);
            await monitor.logAccessAttempt(789012, 'user2', '0x1234567890123456789012345678901234567890', false, 150);
            await monitor.logModification('ADD', '0x1111111111111111111111111111111111111111', 123456, 'admin', true);
            
            const report = await monitor.generateReport();
            
            expect(report).toHaveProperty('generatedAt');
            expect(report).toHaveProperty('summary');
            expect(report).toHaveProperty('statistics');
            expect(report).toHaveProperty('health');
            
            expect(report.summary.totalAccessAttempts).toBe(2);
            expect(report.summary.successRate).toBe('50.0%');
            expect(report.summary.totalModifications).toBe(1);
        });
    });

    describe('Statistics Reset', () => {
        test('should reset all statistics', async () => {
            // Generate some data
            await monitor.logAccessAttempt(123456, 'user', '0xe2f92e8f706997b021919a092437372b268a432d', true, 100);
            await monitor.logModification('ADD', '0x1111111111111111111111111111111111111111', 123456, 'admin', true);
            await monitor.logError('Test error', new Error('Test'), {});
            
            expect(monitor.stats.accessAttempts.total).toBe(1);
            expect(monitor.stats.modifications.total).toBe(1);
            expect(monitor.stats.errors.total).toBe(1);
            
            monitor.resetStatistics();
            
            expect(monitor.stats.accessAttempts.total).toBe(0);
            expect(monitor.stats.modifications.total).toBe(0);
            expect(monitor.stats.errors.total).toBe(0);
            expect(monitor.performanceData).toHaveLength(0);
        });
    });

    describe('Debug Logging', () => {
        test('should log debug information', async () => {
            await monitor.logDebug('Test debug message', { key: 'value' });
            
            expect(fs.appendFile).toHaveBeenCalledWith(
                expect.stringContaining('whitelist-debug.log'),
                expect.stringContaining('"level":"DEBUG"'),
                'utf8'
            );
        });
    });

    describe('Error Handling', () => {
        test('should handle log write failures gracefully', async () => {
            fs.appendFile.mockRejectedValue(new Error('Disk full'));
            
            // Should not throw
            await expect(monitor.logAccessAttempt(123456, 'user', '0xe2f92e8f706997b021919a092437372b268a432d', true, 100))
                .resolves.not.toThrow();
        });

        test('should handle health check errors gracefully', async () => {
            fs.access.mockRejectedValue(new Error('Permission denied'));
            
            const health = await monitor.getHealthStatus();
            
            expect(health.status).toBe('unhealthy');
            expect(health.issues.some(i => i.includes('Log directory not writable'))).toBe(true);
        });
    });

    describe('Performance Data Management', () => {
        test('should limit performance data entries', async () => {
            // Set a small limit for testing
            monitor.maxPerformanceEntries = 5;
            
            // Generate more entries than the limit
            for (let i = 0; i < 10; i++) {
                await monitor.logAccessAttempt(123456, 'user', '0xe2f92e8f706997b021919a092437372b268a432d', true, 100);
            }
            
            expect(monitor.performanceData.length).toBe(5);
        });
    });

    describe('Shutdown', () => {
        test('should shutdown monitoring system cleanly', () => {
            monitor.shutdown();
            
            expect(monitor.initialized).toBe(false);
            expect(monitor.healthCheckInterval).toBeNull();
        });
    });
});