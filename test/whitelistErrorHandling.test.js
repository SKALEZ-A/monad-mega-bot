const WhitelistManager = require('../utils/whitelistManager');
const WhitelistMiddleware = require('../utils/whitelistMiddleware');
const WhitelistErrorHandler = require('../utils/whitelistErrorHandler');
const WalletManager = require('../utils/walletManager');

// Mock file system operations
jest.mock('fs/promises');
const fs = require('fs/promises');

describe('Whitelist Error Handling Tests', () => {
    let whitelistManager;
    let whitelistMiddleware;
    let walletManager;
    let errorHandler;

    beforeEach(async () => {
        jest.clearAllMocks();
        
        // Initialize components
        whitelistManager = new WhitelistManager('./test-data/whitelist.json');
        walletManager = new WalletManager();
        whitelistMiddleware = new WhitelistMiddleware(whitelistManager, walletManager);
        errorHandler = new WhitelistErrorHandler();
        
        // Mock successful file operations by default
        fs.mkdir.mockResolvedValue();
        fs.access.mockResolvedValue();
        fs.readFile.mockResolvedValue(JSON.stringify({
            addresses: ['0xe2F92e8f706997B021919a092437372B268a432d'],
            metadata: { totalAddresses: 1 }
        }));
        fs.writeFile.mockResolvedValue();
        fs.copyFile.mockResolvedValue();
        fs.readdir.mockResolvedValue([]);
        fs.stat.mockResolvedValue({ mtime: new Date() });
        
        await whitelistManager.initialize();
    });

    describe('WhitelistErrorHandler', () => {
        test('should retry operations on failure', async () => {
            let attempts = 0;
            const operation = jest.fn().mockImplementation(() => {
                attempts++;
                if (attempts < 3) {
                    throw new Error('Temporary failure');
                }
                return 'success';
            });

            const result = await errorHandler.handleWithRetry(operation, 'testOperation', 3);

            expect(result).toBe('success');
            expect(operation).toHaveBeenCalledTimes(3);
        });

        test('should not retry non-retryable errors', async () => {
            const operation = jest.fn().mockRejectedValue(new Error('Invalid address format'));

            await expect(
                errorHandler.handleWithRetry(operation, 'testOperation', 3)
            ).rejects.toThrow('Invalid address format');

            expect(operation).toHaveBeenCalledTimes(1);
        });

        test('should handle concurrent access with locking', async () => {
            const results = [];
            const operation = (value) => async () => {
                await errorHandler.delay(50);
                results.push(value);
                return value;
            };

            // Run concurrent operations
            const promises = [
                errorHandler.handleConcurrentAccess(operation('A'), 'testLock'),
                errorHandler.handleConcurrentAccess(operation('B'), 'testLock'),
                errorHandler.handleConcurrentAccess(operation('C'), 'testLock')
            ];

            await Promise.all(promises);

            // Results should be in order due to locking
            expect(results).toEqual(['A', 'B', 'C']);
        });

        test('should sanitize input correctly', () => {
            const validAddress = '0x1234567890123456789012345678901234567890';
            const invalidAddress = 'invalid-address';
            const maliciousInput = '<script>alert("xss")</script>';

            const validResult = errorHandler.sanitizeInput(validAddress, 'address');
            expect(validResult.isValid).toBe(true);
            expect(validResult.sanitized).toBe(validAddress);

            const invalidResult = errorHandler.sanitizeInput(invalidAddress, 'address');
            expect(invalidResult.isValid).toBe(false);
            expect(invalidResult.errors).toContain('Invalid Ethereum address format');

            const maliciousResult = errorHandler.sanitizeInput(maliciousInput, 'general');
            expect(maliciousResult.sanitized).not.toContain('<script>');
        });

        test('should format user-friendly error messages', () => {
            const enoentError = new Error('ENOENT: no such file or directory');
            const eaccesError = new Error('EACCES: permission denied');
            const customError = new Error('Invalid address format');

            expect(errorHandler.formatUserError(enoentError)).toContain('File not found');
            expect(errorHandler.formatUserError(eaccesError)).toContain('Permission denied');
            expect(errorHandler.formatUserError(customError)).toContain('valid Ethereum address');
        });
    });

    describe('WhitelistManager Error Handling', () => {
        test('should handle storage corruption gracefully', async () => {
            // Mock corrupted file
            fs.readFile.mockRejectedValueOnce(new Error('Invalid JSON'));
            
            // Mock successful backup operations
            fs.copyFile.mockResolvedValue();
            fs.readdir.mockResolvedValue(['whitelist.json.backup.2024-01-01']);
            
            const result = await whitelistManager.handleStorageCorruption();
            
            expect(result).toBe(true);
            expect(whitelistManager.initialized).toBe(true);
        });

        test('should create backups before modifications', async () => {
            const testAddress = '0x1234567890123456789012345678901234567890';
            
            await whitelistManager.addAddress(testAddress);
            
            expect(fs.copyFile).toHaveBeenCalled();
        });

        test('should handle file system permission errors', async () => {
            fs.writeFile.mockRejectedValue(new Error('EACCES: permission denied'));
            
            const testAddress = '0x1234567890123456789012345678901234567890';
            
            await expect(whitelistManager.addAddress(testAddress)).rejects.toThrow();
        });

        test('should validate file system access', async () => {
            const validation = await whitelistManager.errorHandler.validateFileSystemAccess('./test-file.json');
            
            expect(validation).toHaveProperty('canRead');
            expect(validation).toHaveProperty('canWrite');
            expect(validation).toHaveProperty('hasSpace');
            expect(validation).toHaveProperty('directoryExists');
        });

        test('should perform health checks', async () => {
            const healthReport = await whitelistManager.performHealthCheck();
            
            expect(healthReport).toHaveProperty('status');
            expect(healthReport).toHaveProperty('timestamp');
            expect(healthReport).toHaveProperty('issues');
            expect(healthReport).toHaveProperty('warnings');
            expect(healthReport).toHaveProperty('stats');
        });

        test('should handle maximum whitelist size', async () => {
            // Set a small max size for testing
            whitelistManager.maxAddresses = 2;
            
            // Add addresses up to the limit
            await whitelistManager.addAddress('0x1111111111111111111111111111111111111111');
            
            // Try to add one more (should fail)
            await expect(
                whitelistManager.addAddress('0x2222222222222222222222222222222222222222')
            ).rejects.toThrow('Maximum whitelist size');
        });

        test('should clean old backups', async () => {
            // Mock multiple backup files
            fs.readdir.mockResolvedValue([
                'whitelist.json.backup.2024-01-01',
                'whitelist.json.backup.2024-01-02',
                'whitelist.json.backup.2024-01-03',
                'whitelist.json.backup.2024-01-04',
                'whitelist.json.backup.2024-01-05',
                'whitelist.json.backup.2024-01-06'
            ]);
            
            fs.stat.mockImplementation((path) => {
                const date = path.includes('2024-01-06') ? new Date('2024-01-06') : new Date('2024-01-01');
                return Promise.resolve({ mtime: date });
            });
            
            fs.unlink.mockResolvedValue();
            
            await whitelistManager.cleanOldBackups();
            
            // Should delete old backups beyond maxBackups (5)
            expect(fs.unlink).toHaveBeenCalled();
        });

        test('should restore from backup on corruption', async () => {
            // Mock backup files
            fs.readdir.mockResolvedValue(['whitelist.json.backup.2024-01-01']);
            fs.stat.mockResolvedValue({ mtime: new Date() });
            
            const success = await whitelistManager.restoreFromBackup();
            
            expect(success).toBe(true);
            expect(fs.copyFile).toHaveBeenCalled();
        });
    });

    describe('WhitelistMiddleware Error Handling', () => {
        let mockCtx;

        beforeEach(() => {
            mockCtx = {
                from: { id: 123456789, username: 'testuser' },
                message: { text: '/balances' },
                reply: jest.fn(),
                replyWithMarkdown: jest.fn()
            };
        });

        test('should handle enhanced access checking', async () => {
            // Mock wallet manager
            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn().mockReturnValue({
                address: '0xe2F92e8f706997B021919a092437372B268a432d'
            });

            const result = await whitelistMiddleware.checkUserAccessEnhanced(mockCtx);

            expect(result).toHaveProperty('hasAccess');
            expect(result).toHaveProperty('reason');
            expect(result).toHaveProperty('details');
            expect(result).toHaveProperty('timestamp');
        });

        test('should handle rate limiting', async () => {
            const userId = mockCtx.from.id.toString();
            
            // Simulate multiple failed attempts
            for (let i = 0; i < 6; i++) {
                whitelistMiddleware.recordFailedAttempt(mockCtx);
            }
            
            const isRateLimited = whitelistMiddleware.isRateLimited(mockCtx);
            expect(isRateLimited).toBe(true);
        });

        test('should provide detailed unauthorized access messages', async () => {
            const accessResult = {
                hasAccess: false,
                reason: 'not_whitelisted',
                details: {
                    address: '0x1234567890123456789012345678901234567890',
                    message: 'Address is not whitelisted'
                }
            };

            await whitelistMiddleware.handleUnauthorizedAccessEnhanced(mockCtx, accessResult);

            expect(mockCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('not authorized'),
                { parse_mode: 'Markdown' }
            );
        });

        test('should handle wallet manager errors gracefully', async () => {
            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn().mockImplementation(() => {
                throw new Error('Database connection failed');
            });

            const result = await whitelistMiddleware.checkUserAccessEnhanced(mockCtx);

            expect(result.hasAccess).toBe(false);
            expect(result.reason).toBe('wallet_error');
            expect(result.details.error).toContain('Database connection failed');
        });

        test('should track middleware statistics', async () => {
            // Simulate various types of requests
            whitelistMiddleware.accessStats.totalRequests = 10;
            whitelistMiddleware.accessStats.authorizedRequests = 6;
            whitelistMiddleware.accessStats.deniedRequests = 3;
            whitelistMiddleware.accessStats.errorRequests = 1;

            const stats = whitelistMiddleware.getMiddlewareStats();

            expect(stats.totalRequests).toBe(10);
            expect(stats.authorizedRequests).toBe(6);
            expect(stats.deniedRequests).toBe(3);
            expect(stats.errorRequests).toBe(1);
            expect(stats).toHaveProperty('timestamp');
        });

        test('should clean expired cache entries', () => {
            // Add some cache entries with old timestamps
            whitelistMiddleware.accessCache.set('user1', {
                hasAccess: true,
                timestamp: Date.now() - (10 * 60 * 1000) // 10 minutes ago
            });
            
            whitelistMiddleware.accessCache.set('user2', {
                hasAccess: false,
                timestamp: Date.now() - (1 * 60 * 1000) // 1 minute ago
            });

            const cleanedCount = whitelistMiddleware.cleanExpiredCache();

            expect(cleanedCount).toBe(1); // Only the 10-minute-old entry should be cleaned
            expect(whitelistMiddleware.accessCache.has('user1')).toBe(false);
            expect(whitelistMiddleware.accessCache.has('user2')).toBe(true);
        });

        test('should handle system not ready state', async () => {
            // Mock uninitialized whitelist manager
            whitelistManager.initialized = false;

            const result = await whitelistMiddleware.checkUserAccessEnhanced(mockCtx);

            expect(result.hasAccess).toBe(false);
            expect(result.reason).toBe('system_not_ready');
        });
    });

    describe('Edge Cases and Stress Tests', () => {
        test('should handle empty input gracefully', async () => {
            const result = await whitelistManager.addAddress('');
            
            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid input');
        });

        test('should handle null and undefined inputs', async () => {
            await expect(whitelistManager.addAddress(null)).rejects.toThrow();
            await expect(whitelistManager.addAddress(undefined)).rejects.toThrow();
        });

        test('should handle malformed addresses', async () => {
            const malformedAddresses = [
                '0x123', // Too short
                '0xGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGGG', // Invalid characters
                'not-an-address', // Not hex
                '1234567890123456789012345678901234567890' // Missing 0x prefix
            ];

            for (const address of malformedAddresses) {
                const result = await whitelistManager.addAddress(address);
                expect(result.success).toBe(false);
            }
        });

        test('should handle concurrent modifications safely', async () => {
            const addresses = [
                '0x1111111111111111111111111111111111111111',
                '0x2222222222222222222222222222222222222222',
                '0x3333333333333333333333333333333333333333',
                '0x4444444444444444444444444444444444444444',
                '0x5555555555555555555555555555555555555555'
            ];

            // Add addresses concurrently
            const promises = addresses.map(address => whitelistManager.addAddress(address));
            const results = await Promise.all(promises);

            // All should succeed
            results.forEach(result => {
                expect(result.success).toBe(true);
            });

            // Verify all addresses were added
            const whitelistedAddresses = whitelistManager.getWhitelistedAddresses();
            addresses.forEach(address => {
                expect(whitelistedAddresses).toContain(address.toLowerCase());
            });
        });

        test('should handle file system errors during backup', async () => {
            // Mock backup failure
            fs.copyFile.mockRejectedValueOnce(new Error('Disk full'));

            const testAddress = '0x1234567890123456789012345678901234567890';
            
            // Should still succeed even if backup fails
            const result = await whitelistManager.addAddress(testAddress);
            expect(result.success).toBe(true);
        });

        test('should handle middleware with missing context properties', async () => {
            const incompleteCtx = {
                // Missing from property
                message: { text: '/balances' },
                reply: jest.fn()
            };

            const middleware = whitelistMiddleware.middleware();
            
            // Should not crash
            await expect(middleware(incompleteCtx, jest.fn())).resolves.not.toThrow();
        });
    });
});