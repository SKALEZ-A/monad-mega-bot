/**
 * Comprehensive Integration Tests for Whitelist System
 * 
 * These tests verify the complete end-to-end functionality of the whitelist system,
 * including user access flow, admin operations, middleware integration, and persistence.
 */

const { Telegraf } = require('telegraf');
const WhitelistManager = require('../utils/whitelistManager');
const WhitelistMiddleware = require('../utils/whitelistMiddleware');
const WhitelistMonitor = require('../utils/whitelistMonitor');
const WhitelistInitializer = require('../utils/whitelistInitializer');
const TelegramCommands = require('../utils/telegramCommands');
const WalletManager = require('../utils/walletManager');

// Mock file system operations
jest.mock('fs/promises');
const fs = require('fs/promises');

// Mock external dependencies
jest.mock('../utils/userPreferences');
jest.mock('../utils/tokenPrices');

describe('Whitelist System - Full Integration Tests', () => {
    let whitelistManager;
    let whitelistMiddleware;
    let whitelistMonitor;
    let whitelistInitializer;
    let telegramCommands;
    let walletManager;
    let bot;

    // Test data
    const testAddresses = {
        whitelisted: '0xe2f92e8f706997b021919a092437372b268a432d',
        notWhitelisted: '0x1234567890123456789012345678901234567890',
        newAddress: '0x9876543210987654321098765432109876543210'
    };

    const testUsers = {
        whitelistedUser: { id: 123456789, username: 'whitelisted_user' },
        nonWhitelistedUser: { id: 987654321, username: 'non_whitelisted_user' },
        adminUser: { id: 111111111, username: 'admin_user' }
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        
        // Mock successful file operations
        fs.mkdir.mockResolvedValue();
        fs.access.mockResolvedValue();
        fs.readFile.mockResolvedValue(JSON.stringify({
            addresses: [testAddresses.whitelisted],
            metadata: { totalAddresses: 1 }
        }));
        fs.writeFile.mockResolvedValue();
        fs.appendFile.mockResolvedValue();
        fs.copyFile.mockResolvedValue();
        fs.rename.mockResolvedValue();
        fs.readdir.mockResolvedValue([]);
        fs.stat.mockResolvedValue({ size: 1024, mtime: new Date() });
        fs.chmod.mockResolvedValue();
        fs.unlink.mockResolvedValue();

        // Set admin user for testing
        process.env.ADMIN_USER_IDS = testUsers.adminUser.id.toString();

        // Initialize components in correct order
        whitelistInitializer = new WhitelistInitializer('./test-data', 'test-whitelist.json');
        whitelistManager = new WhitelistManager('./test-data/test-whitelist.json');
        whitelistMonitor = new WhitelistMonitor('./test-logs', whitelistManager);
        walletManager = new WalletManager();
        whitelistMiddleware = new WhitelistMiddleware(whitelistManager, walletManager, whitelistMonitor);
        telegramCommands = new TelegramCommands(walletManager, null, null, whitelistManager, whitelistMonitor);

        // Initialize all components
        await whitelistInitializer.initialize();
        await whitelistManager.initialize();
        await whitelistMonitor.initialize();

        // Create mock bot
        bot = new Telegraf('mock-token');
    });

    afterEach(() => {
        if (whitelistMonitor) {
            whitelistMonitor.shutdown();
        }
        delete process.env.ADMIN_USER_IDS;
    });

    describe('Complete User Access Flow', () => {
        test('should allow whitelisted user through complete flow', async () => {
            // Setup: User has wallet with whitelisted address
            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn().mockReturnValue({
                address: testAddresses.whitelisted
            });

            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();
            const next = jest.fn();

            // Create context for whitelisted user
            const ctx = {
                from: testUsers.whitelistedUser,
                message: { text: '/balances' },
                reply: jest.fn(),
                replyWithMarkdown: jest.fn()
            };

            // Execute middleware
            await middlewareFunction(ctx, next);

            // Verify user was allowed through
            expect(next).toHaveBeenCalled();
            expect(ctx.reply).not.toHaveBeenCalled();

            // Verify monitoring logged the access
            const stats = whitelistMonitor.getStatistics();
            expect(stats.access.total).toBe(1);
            expect(stats.access.authorized).toBe(1);
            expect(stats.access.denied).toBe(0);
        });

        test('should block non-whitelisted user through complete flow', async () => {
            // Setup: User has wallet with non-whitelisted address
            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn().mockReturnValue({
                address: testAddresses.notWhitelisted
            });

            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();
            const next = jest.fn();

            // Create context for non-whitelisted user
            const ctx = {
                from: testUsers.nonWhitelistedUser,
                message: { text: '/balances' },
                reply: jest.fn(),
                replyWithMarkdown: jest.fn()
            };

            // Execute middleware
            await middlewareFunction(ctx, next);

            // Verify user was blocked
            expect(next).not.toHaveBeenCalled();
            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Access Denied'),
                { parse_mode: 'Markdown' }
            );

            // Verify monitoring logged the denial
            const stats = whitelistMonitor.getStatistics();
            expect(stats.access.total).toBe(1);
            expect(stats.access.authorized).toBe(0);
            expect(stats.access.denied).toBe(1);
        });

        test('should handle user with no wallet', async () => {
            // Setup: User has no wallet
            walletManager.hasWallet = jest.fn().mockReturnValue(false);

            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();
            const next = jest.fn();

            // Create context
            const ctx = {
                from: testUsers.nonWhitelistedUser,
                message: { text: '/balances' },
                reply: jest.fn()
            };

            // Execute middleware
            await middlewareFunction(ctx, next);

            // Verify user was blocked with appropriate message
            expect(next).not.toHaveBeenCalled();
            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('create or import a wallet'),
                { parse_mode: 'Markdown' }
            );
        });
    });

    describe('Admin Whitelist Management Operations', () => {
        test('should complete full add address workflow', async () => {
            // Create admin context
            const adminCtx = {
                from: testUsers.adminUser,
                message: { text: `/whitelist_add ${testAddresses.newAddress}` }
            };

            // Execute add command
            const result = await telegramCommands.addAddressCommand(adminCtx, testAddresses.newAddress);

            // Verify command succeeded
            expect(result.success).toBe(true);
            expect(result.message).toContain('has been added to the whitelist');

            // Verify address was actually added to manager
            expect(whitelistManager.isAddressWhitelisted(testAddresses.newAddress)).toBe(true);

            // Verify monitoring logged the modification
            const stats = whitelistMonitor.getStatistics();
            expect(stats.modifications.total).toBe(1);
            expect(stats.modifications.additions).toBe(1);
        });

        test('should complete full remove address workflow', async () => {
            // First add an address to remove
            await whitelistManager.addAddress(testAddresses.newAddress);
            expect(whitelistManager.isAddressWhitelisted(testAddresses.newAddress)).toBe(true);

            // Create admin context
            const adminCtx = {
                from: testUsers.adminUser,
                message: { text: `/whitelist_remove ${testAddresses.newAddress}` }
            };

            // Execute remove command
            const result = await telegramCommands.removeAddressCommand(adminCtx, testAddresses.newAddress);

            // Verify command succeeded
            expect(result.success).toBe(true);
            expect(result.message).toContain('has been removed from the whitelist');

            // Verify address was actually removed from manager
            expect(whitelistManager.isAddressWhitelisted(testAddresses.newAddress)).toBe(false);

            // Verify monitoring logged the modification
            const stats = whitelistMonitor.getStatistics();
            expect(stats.modifications.total).toBe(1);
            expect(stats.modifications.removals).toBe(1);
        });

        test('should complete full list whitelist workflow', async () => {
            // Add some test addresses
            await whitelistManager.addAddress(testAddresses.newAddress);

            // Create admin context
            const adminCtx = {
                from: testUsers.adminUser
            };

            // Execute list command
            const result = await telegramCommands.listWhitelistCommand(adminCtx);

            // Verify command succeeded
            expect(result.success).toBe(true);
            expect(result.message).toContain('Whitelisted Addresses');
            expect(result.message).toContain(testAddresses.whitelisted);
            expect(result.message).toContain(testAddresses.newAddress);
        });

        test('should deny admin commands to non-admin users', async () => {
            // Create non-admin context
            const nonAdminCtx = {
                from: testUsers.nonWhitelistedUser
            };

            // Try to execute admin command
            const result = await telegramCommands.addAddressCommand(nonAdminCtx, testAddresses.newAddress);

            // Verify command was denied
            expect(result.success).toBe(false);
            expect(result.message).toContain('Access denied. Admin privileges required');

            // Verify address was not added
            expect(whitelistManager.isAddressWhitelisted(testAddresses.newAddress)).toBe(false);
        });
    });

    describe('Bot Restart and Persistence', () => {
        test('should persist whitelist changes across manager restarts', async () => {
            // Add address to first manager instance
            await whitelistManager.addAddress(testAddresses.newAddress);
            expect(whitelistManager.isAddressWhitelisted(testAddresses.newAddress)).toBe(true);

            // Create new manager instance (simulating restart)
            const newWhitelistManager = new WhitelistManager('./test-data/test-whitelist.json');
            await newWhitelistManager.initialize();

            // Verify address is still whitelisted
            expect(newWhitelistManager.isAddressWhitelisted(testAddresses.newAddress)).toBe(true);
        });

        test('should handle corrupted whitelist file on restart', async () => {
            // Mock corrupted file on first read, then successful backup restore
            fs.readFile
                .mockRejectedValueOnce(new Error('Invalid JSON'))
                .mockResolvedValueOnce(JSON.stringify({
                    addresses: [testAddresses.whitelisted],
                    metadata: { totalAddresses: 1 }
                }));

            // Mock backup file exists
            fs.readdir.mockResolvedValue(['test-whitelist.json.backup.2024-01-01']);

            // Initialize new manager
            const newWhitelistManager = new WhitelistManager('./test-data/test-whitelist.json');
            await newWhitelistManager.initialize();

            // Verify manager initialized successfully with default addresses
            expect(newWhitelistManager.isAddressWhitelisted(testAddresses.whitelisted)).toBe(true);
        });
    });

    describe('Middleware Integration with Bot Commands', () => {
        test('should integrate middleware with existing bot functionality', async () => {
            // Setup whitelisted user
            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn().mockReturnValue({
                address: testAddresses.whitelisted
            });

            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();

            // Test various bot commands
            const commands = ['/balances', '/swap', '/send', '/wallet'];
            
            for (const command of commands) {
                const next = jest.fn();
                const ctx = {
                    from: testUsers.whitelistedUser,
                    message: { text: command },
                    reply: jest.fn()
                };

                await middlewareFunction(ctx, next);
                expect(next).toHaveBeenCalled();
            }

            // Verify all access attempts were logged
            const stats = whitelistMonitor.getStatistics();
            expect(stats.access.total).toBe(commands.length);
            expect(stats.access.authorized).toBe(commands.length);
        });

        test('should bypass whitelist for allowed commands', async () => {
            // Setup user with no wallet (would normally be blocked)
            walletManager.hasWallet = jest.fn().mockReturnValue(false);

            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();

            // Test bypass commands
            const bypassCommands = ['/start', '/help'];
            
            for (const command of bypassCommands) {
                const next = jest.fn();
                const ctx = {
                    from: testUsers.nonWhitelistedUser,
                    message: { text: command },
                    reply: jest.fn()
                };

                await middlewareFunction(ctx, next);
                expect(next).toHaveBeenCalled();
            }

            // Verify bypass commands were not logged as access attempts
            const stats = whitelistMonitor.getStatistics();
            expect(stats.access.total).toBe(0);
        });
    });

    describe('Error Handling and Recovery', () => {
        test('should handle storage errors gracefully during operations', async () => {
            // Mock storage error
            fs.writeFile.mockRejectedValueOnce(new Error('Disk full'));

            // Try to add address
            const adminCtx = { from: testUsers.adminUser };
            const result = await telegramCommands.addAddressCommand(adminCtx, testAddresses.newAddress);

            // Verify error was handled gracefully
            expect(result.success).toBe(false);
            expect(result.message).toContain('Error adding address');

            // Verify error was logged
            const stats = whitelistMonitor.getStatistics();
            expect(stats.errors.total).toBeGreaterThan(0);
        });

        test('should handle middleware errors without crashing', async () => {
            // Mock wallet manager error
            walletManager.hasWallet = jest.fn().mockImplementation(() => {
                throw new Error('Database connection failed');
            });

            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();
            const next = jest.fn();
            const ctx = {
                from: testUsers.whitelistedUser,
                message: { text: '/balances' },
                reply: jest.fn()
            };

            // Execute middleware - should not throw
            await expect(middlewareFunction(ctx, next)).resolves.not.toThrow();

            // Verify user was denied access due to error
            expect(next).not.toHaveBeenCalled();
            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Access verification failed'),
                { parse_mode: 'Markdown' }
            );
        });

        test('should recover from whitelist corruption', async () => {
            // Simulate corruption recovery
            const recoveryResult = await whitelistManager.handleStorageCorruption();

            // Verify recovery was successful
            expect(recoveryResult).toBe(true);
            expect(whitelistManager.initialized).toBe(true);

            // Verify default addresses are available
            expect(whitelistManager.isAddressWhitelisted(testAddresses.whitelisted)).toBe(true);
        });
    });

    describe('Monitoring and Statistics Integration', () => {
        test('should track comprehensive statistics across all operations', async () => {
            // Perform various operations
            
            // 1. Successful access
            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn().mockReturnValue({
                address: testAddresses.whitelisted
            });

            const middlewareFunction = whitelistMiddleware.middleware();
            const ctx1 = {
                from: testUsers.whitelistedUser,
                message: { text: '/balances' },
                reply: jest.fn()
            };
            await middlewareFunction(ctx1, jest.fn());

            // 2. Denied access
            walletManager.getWalletDetails = jest.fn().mockReturnValue({
                address: testAddresses.notWhitelisted
            });

            const ctx2 = {
                from: testUsers.nonWhitelistedUser,
                message: { text: '/balances' },
                reply: jest.fn()
            };
            await middlewareFunction(ctx2, jest.fn());

            // 3. Admin operations
            const adminCtx = { from: testUsers.adminUser };
            await telegramCommands.addAddressCommand(adminCtx, testAddresses.newAddress);
            await telegramCommands.removeAddressCommand(adminCtx, testAddresses.newAddress);

            // 4. Generate error
            await whitelistMonitor.logError('Test error', new Error('Test'), {});

            // Verify comprehensive statistics
            const stats = whitelistMonitor.getStatistics();
            
            expect(stats.access.total).toBe(2);
            expect(stats.access.authorized).toBe(1);
            expect(stats.access.denied).toBe(1);
            expect(stats.modifications.total).toBe(2);
            expect(stats.modifications.additions).toBe(1);
            expect(stats.modifications.removals).toBe(1);
            expect(stats.errors.total).toBe(1);
        });

        test('should generate comprehensive monitoring report', async () => {
            // Generate some activity
            await whitelistMonitor.logAccessAttempt(
                testUsers.whitelistedUser.id,
                testUsers.whitelistedUser.username,
                testAddresses.whitelisted,
                true,
                150
            );

            await whitelistMonitor.logModification(
                'ADD',
                testAddresses.newAddress,
                testUsers.adminUser.id,
                testUsers.adminUser.username,
                true
            );

            // Generate report
            const report = await whitelistMonitor.generateReport();

            // Verify report structure
            expect(report).toHaveProperty('generatedAt');
            expect(report).toHaveProperty('summary');
            expect(report).toHaveProperty('statistics');
            expect(report).toHaveProperty('health');

            // Verify summary data
            expect(report.summary.totalAccessAttempts).toBe(1);
            expect(report.summary.successRate).toBe('100.0%');
            expect(report.summary.totalModifications).toBe(1);
        });
    });

    describe('Performance and Load Testing', () => {
        test('should handle multiple concurrent access checks', async () => {
            // Setup multiple users
            const users = [
                { id: 1001, address: testAddresses.whitelisted },
                { id: 1002, address: testAddresses.notWhitelisted },
                { id: 1003, address: testAddresses.whitelisted },
                { id: 1004, address: testAddresses.notWhitelisted },
                { id: 1005, address: testAddresses.whitelisted }
            ];

            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn().mockImplementation((userId) => {
                const user = users.find(u => u.id.toString() === userId);
                return { address: user ? user.address : testAddresses.notWhitelisted };
            });

            // Create concurrent access checks
            const middlewareFunction = whitelistMiddleware.middleware();
            const promises = users.map(user => {
                const ctx = {
                    from: { id: user.id, username: `user${user.id}` },
                    message: { text: '/balances' },
                    reply: jest.fn()
                };
                return middlewareFunction(ctx, jest.fn());
            });

            // Execute all concurrently
            await Promise.all(promises);

            // Verify all were processed
            const stats = whitelistMonitor.getStatistics();
            expect(stats.access.total).toBe(users.length);
            expect(stats.access.authorized).toBe(3); // 3 whitelisted users
            expect(stats.access.denied).toBe(2); // 2 non-whitelisted users
        });

        test('should handle multiple concurrent admin operations', async () => {
            const addresses = [
                '0x1111111111111111111111111111111111111111',
                '0x2222222222222222222222222222222222222222',
                '0x3333333333333333333333333333333333333333',
                '0x4444444444444444444444444444444444444444',
                '0x5555555555555555555555555555555555555555'
            ];

            const adminCtx = { from: testUsers.adminUser };

            // Add addresses concurrently
            const addPromises = addresses.map(address => 
                telegramCommands.addAddressCommand(adminCtx, address)
            );

            const results = await Promise.all(addPromises);

            // Verify all succeeded
            results.forEach(result => {
                expect(result.success).toBe(true);
            });

            // Verify all addresses were added
            addresses.forEach(address => {
                expect(whitelistManager.isAddressWhitelisted(address)).toBe(true);
            });

            // Verify monitoring tracked all operations
            const stats = whitelistMonitor.getStatistics();
            expect(stats.modifications.total).toBe(addresses.length);
            expect(stats.modifications.additions).toBe(addresses.length);
        });
    });

    describe('System Health and Monitoring', () => {
        test('should perform comprehensive system health check', async () => {
            // Generate some activity to test health monitoring
            await whitelistMonitor.logAccessAttempt(
                testUsers.whitelistedUser.id,
                testUsers.whitelistedUser.username,
                testAddresses.whitelisted,
                true,
                100
            );

            // Perform health check
            const health = await whitelistMonitor.getHealthStatus();

            // Verify health check structure
            expect(health).toHaveProperty('status');
            expect(health).toHaveProperty('issues');
            expect(health).toHaveProperty('warnings');
            expect(health).toHaveProperty('timestamp');

            // System should be healthy
            expect(health.status).toBe('healthy');
            expect(health.issues).toHaveLength(0);
        });

        test('should detect and report system issues', async () => {
            // Simulate high error rate
            for (let i = 0; i < 10; i++) {
                await whitelistMonitor.logError('Test error', new Error('Test'), {});
            }

            // Add some access attempts to calculate error rate
            await whitelistMonitor.logAccessAttempt(
                testUsers.whitelistedUser.id,
                testUsers.whitelistedUser.username,
                testAddresses.whitelisted,
                true,
                100
            );

            // Perform health check
            const health = await whitelistMonitor.getHealthStatus();

            // Should detect high error rate
            expect(health.warnings.some(w => w.includes('High error rate'))).toBe(true);
        });
    });

    describe('Edge Cases and Boundary Conditions', () => {
        test('should handle whitelist at maximum capacity', async () => {
            // Set small max size for testing
            whitelistManager.maxAddresses = 3;

            // Fill whitelist to capacity
            await whitelistManager.addAddress('0x1111111111111111111111111111111111111111');
            await whitelistManager.addAddress('0x2222222222222222222222222222222222222222');

            // Try to add one more (should fail)
            const adminCtx = { from: testUsers.adminUser };
            const result = await telegramCommands.addAddressCommand(
                adminCtx, 
                '0x3333333333333333333333333333333333333333'
            );

            expect(result.success).toBe(false);
            expect(result.message).toContain('Maximum whitelist size');
        });

        test('should handle rapid successive operations', async () => {
            const adminCtx = { from: testUsers.adminUser };
            const testAddress = '0x1111111111111111111111111111111111111111';

            // Rapid add/remove operations
            const operations = [];
            for (let i = 0; i < 10; i++) {
                operations.push(telegramCommands.addAddressCommand(adminCtx, testAddress));
                operations.push(telegramCommands.removeAddressCommand(adminCtx, testAddress));
            }

            // Execute all operations
            const results = await Promise.all(operations);

            // Some should succeed, some should fail (address already exists/doesn't exist)
            const successes = results.filter(r => r.success).length;
            const failures = results.filter(r => !r.success).length;

            expect(successes).toBeGreaterThan(0);
            expect(failures).toBeGreaterThan(0);
            expect(successes + failures).toBe(20);
        });
    });
});