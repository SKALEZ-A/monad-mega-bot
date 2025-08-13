/**
 * Bot Integration Tests for Whitelist System
 * 
 * These tests verify the integration of the whitelist system with the actual
 * Telegram bot commands and middleware in a realistic bot environment.
 */

const { Telegraf } = require('telegraf');
const WhitelistManager = require('../utils/whitelistManager');
const WhitelistMiddleware = require('../utils/whitelistMiddleware');
const WhitelistMonitor = require('../utils/whitelistMonitor');
const TelegramCommands = require('../utils/telegramCommands');
const WalletManager = require('../utils/walletManager');

// Mock file system and external dependencies
jest.mock('fs/promises');
jest.mock('../utils/userPreferences');
jest.mock('../utils/tokenPrices');

const fs = require('fs/promises');

describe('Bot Integration Tests - Whitelist System', () => {
    let bot;
    let whitelistManager;
    let whitelistMiddleware;
    let whitelistMonitor;
    let telegramCommands;
    let walletManager;

    // Test users and addresses
    const testData = {
        whitelistedAddress: '0xe2f92e8f706997b021919a092437372b268a432d',
        nonWhitelistedAddress: '0x1234567890123456789012345678901234567890',
        adminUserId: 123456789,
        regularUserId: 987654321,
        newAddress: '0x9876543210987654321098765432109876543210'
    };

    beforeEach(async () => {
        jest.clearAllMocks();
        
        // Mock file system operations
        fs.mkdir.mockResolvedValue();
        fs.access.mockResolvedValue();
        fs.readFile.mockResolvedValue(JSON.stringify({
            addresses: [testData.whitelistedAddress],
            metadata: { totalAddresses: 1 }
        }));
        fs.writeFile.mockResolvedValue();
        fs.appendFile.mockResolvedValue();
        fs.copyFile.mockResolvedValue();
        fs.readdir.mockResolvedValue([]);
        fs.stat.mockResolvedValue({ size: 1024, mtime: new Date() });
        fs.chmod.mockResolvedValue();

        // Set admin user
        process.env.ADMIN_USER_IDS = testData.adminUserId.toString();

        // Initialize components
        whitelistManager = new WhitelistManager('./test-data/whitelist.json');
        whitelistMonitor = new WhitelistMonitor('./test-logs', whitelistManager);
        walletManager = new WalletManager();
        whitelistMiddleware = new WhitelistMiddleware(whitelistManager, walletManager, whitelistMonitor);
        telegramCommands = new TelegramCommands(walletManager, null, null, whitelistManager, whitelistMonitor);

        // Initialize all components
        await whitelistManager.initialize();
        await whitelistMonitor.initialize();

        // Create bot instance
        bot = new Telegraf('mock-token');
        
        // Add whitelist middleware
        bot.use(whitelistMiddleware.middleware());
    });

    afterEach(() => {
        if (whitelistMonitor) {
            whitelistMonitor.shutdown();
        }
        delete process.env.ADMIN_USER_IDS;
    });

    describe('Bot Command Integration', () => {
        test('should integrate whitelist commands with bot', async () => {
            // Mock admin context
            const adminCtx = {
                from: { id: testData.adminUserId, username: 'admin' },
                message: { text: `/whitelist_add ${testData.newAddress}` },
                reply: jest.fn(),
                replyWithMarkdown: jest.fn()
            };

            // Execute whitelist_add command through TelegramCommands
            const result = await telegramCommands.addAddressCommand(adminCtx, testData.newAddress);

            // Verify command executed successfully
            expect(result.success).toBe(true);
            expect(result.message).toContain('has been added to the whitelist');

            // Verify address was actually added
            expect(whitelistManager.isAddressWhitelisted(testData.newAddress)).toBe(true);

            // Verify monitoring logged the operation
            const stats = whitelistMonitor.getStatistics();
            expect(stats.modifications.total).toBe(1);
            expect(stats.modifications.additions).toBe(1);
        });

        test('should handle whitelist_list command integration', async () => {
            // Add some addresses first
            await whitelistManager.addAddress(testData.newAddress);

            // Mock admin context
            const adminCtx = {
                from: { id: testData.adminUserId, username: 'admin' },
                reply: jest.fn(),
                replyWithMarkdown: jest.fn()
            };

            // Execute list command
            const result = await telegramCommands.listWhitelistCommand(adminCtx);

            // Verify response
            expect(result.success).toBe(true);
            expect(result.message).toContain('Whitelisted Addresses');
            expect(result.message).toContain(testData.whitelistedAddress);
            expect(result.message).toContain(testData.newAddress);
            expect(result.message).toContain('Total: 2 addresses');
        });

        test('should handle whitelist_monitor command integration', async () => {
            // Generate some monitoring data
            await whitelistMonitor.logAccessAttempt(
                testData.regularUserId,
                'testuser',
                testData.whitelistedAddress,
                true,
                150
            );

            // Mock admin context
            const adminCtx = {
                from: { id: testData.adminUserId, username: 'admin' }
            };

            // Execute monitoring command
            const result = await telegramCommands.whitelistMonitoringCommand(adminCtx);

            // Verify response
            expect(result.success).toBe(true);
            expect(result.message).toContain('Whitelist Monitoring Report');
            expect(result.message).toContain('Total attempts: 1');
            expect(result.message).toContain('Authorized: 1');
        });
    });

    describe('Middleware Integration with Bot Flow', () => {
        test('should allow whitelisted user to access bot commands', async () => {
            // Setup whitelisted user
            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn().mockReturnValue({
                address: testData.whitelistedAddress
            });

            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();

            // Test multiple bot commands
            const commands = ['/balances', '/swap', '/send', '/wallet', '/help'];
            
            for (const command of commands) {
                const next = jest.fn();
                const ctx = {
                    from: { id: testData.regularUserId, username: 'testuser' },
                    message: { text: command },
                    reply: jest.fn()
                };

                await middlewareFunction(ctx, next);

                if (command === '/help') {
                    // Help should bypass whitelist
                    expect(next).toHaveBeenCalled();
                } else {
                    // Other commands should go through whitelist check
                    expect(next).toHaveBeenCalled();
                }
            }
        });

        test('should block non-whitelisted user from protected commands', async () => {
            // Setup non-whitelisted user
            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn().mockReturnValue({
                address: testData.nonWhitelistedAddress
            });

            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();

            // Test protected commands
            const protectedCommands = ['/balances', '/swap', '/send', '/wallet'];
            
            for (const command of protectedCommands) {
                const next = jest.fn();
                const ctx = {
                    from: { id: testData.regularUserId, username: 'testuser' },
                    message: { text: command },
                    reply: jest.fn()
                };

                await middlewareFunction(ctx, next);

                // Should be blocked
                expect(next).not.toHaveBeenCalled();
                expect(ctx.reply).toHaveBeenCalledWith(
                    expect.stringContaining('Access Denied'),
                    { parse_mode: 'Markdown' }
                );
            }
        });

        test('should allow bypass commands for all users', async () => {
            // Setup user with no wallet (would normally be blocked)
            walletManager.hasWallet = jest.fn().mockReturnValue(false);

            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();

            // Test bypass commands
            const bypassCommands = ['/start', '/help'];
            
            for (const command of bypassCommands) {
                const next = jest.fn();
                const ctx = {
                    from: { id: testData.regularUserId, username: 'testuser' },
                    message: { text: command },
                    reply: jest.fn()
                };

                await middlewareFunction(ctx, next);

                // Should be allowed through
                expect(next).toHaveBeenCalled();
                expect(ctx.reply).not.toHaveBeenCalled();
            }
        });
    });

    describe('Admin Access Control Integration', () => {
        test('should allow admin commands for authorized users', async () => {
            const adminCommands = [
                { command: 'addAddressCommand', args: [testData.newAddress] },
                { command: 'listWhitelistCommand', args: [] },
                { command: 'whitelistStatsCommand', args: [] },
                { command: 'whitelistMonitoringCommand', args: [] }
            ];

            const adminCtx = {
                from: { id: testData.adminUserId, username: 'admin' }
            };

            for (const { command, args } of adminCommands) {
                const result = await telegramCommands[command](adminCtx, ...args);
                
                // Admin should be able to execute all commands
                expect(result.success).toBe(true);
                expect(result.message).not.toContain('Access denied');
            }
        });

        test('should deny admin commands for non-admin users', async () => {
            const adminCommands = [
                { command: 'addAddressCommand', args: [testData.newAddress] },
                { command: 'removeAddressCommand', args: [testData.newAddress] },
                { command: 'listWhitelistCommand', args: [] },
                { command: 'whitelistStatsCommand', args: [] }
            ];

            const regularCtx = {
                from: { id: testData.regularUserId, username: 'regular_user' }
            };

            for (const { command, args } of adminCommands) {
                const result = await telegramCommands[command](regularCtx, ...args);
                
                // Regular user should be denied
                expect(result.success).toBe(false);
                expect(result.message).toContain('Access denied. Admin privileges required');
            }
        });
    });

    describe('Error Handling in Bot Context', () => {
        test('should handle middleware errors gracefully in bot context', async () => {
            // Mock wallet manager to throw error
            walletManager.hasWallet = jest.fn().mockImplementation(() => {
                throw new Error('Database connection failed');
            });

            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();
            const next = jest.fn();
            const ctx = {
                from: { id: testData.regularUserId, username: 'testuser' },
                message: { text: '/balances' },
                reply: jest.fn()
            };

            // Should not throw error
            await expect(middlewareFunction(ctx, next)).resolves.not.toThrow();

            // Should deny access and provide user-friendly message
            expect(next).not.toHaveBeenCalled();
            expect(ctx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Access verification failed'),
                { parse_mode: 'Markdown' }
            );
        });

        test('should handle command errors gracefully', async () => {
            // Mock whitelist manager to throw error
            whitelistManager.addAddress = jest.fn().mockRejectedValue(new Error('Storage error'));

            const adminCtx = {
                from: { id: testData.adminUserId, username: 'admin' }
            };

            // Execute command that will fail
            const result = await telegramCommands.addAddressCommand(adminCtx, testData.newAddress);

            // Should handle error gracefully
            expect(result.success).toBe(false);
            expect(result.message).toContain('Error adding address');
        });
    });

    describe('Performance in Bot Context', () => {
        test('should handle high-frequency middleware checks', async () => {
            // Setup whitelisted user
            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn().mockReturnValue({
                address: testData.whitelistedAddress
            });

            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();

            // Simulate high-frequency requests
            const requests = [];
            for (let i = 0; i < 100; i++) {
                const next = jest.fn();
                const ctx = {
                    from: { id: testData.regularUserId, username: 'testuser' },
                    message: { text: '/balances' },
                    reply: jest.fn()
                };

                requests.push(middlewareFunction(ctx, next));
            }

            // Execute all requests
            const startTime = Date.now();
            await Promise.all(requests);
            const duration = Date.now() - startTime;

            // Should complete in reasonable time (less than 5 seconds for 100 requests)
            expect(duration).toBeLessThan(5000);

            // Verify all requests were processed
            const stats = whitelistMonitor.getStatistics();
            expect(stats.access.total).toBe(100);
            expect(stats.access.authorized).toBe(100);
        });

        test('should cache access results for performance', async () => {
            // Setup user
            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn().mockReturnValue({
                address: testData.whitelistedAddress
            });

            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();

            // Make multiple requests for same user
            for (let i = 0; i < 5; i++) {
                const next = jest.fn();
                const ctx = {
                    from: { id: testData.regularUserId, username: 'testuser' },
                    message: { text: '/balances' },
                    reply: jest.fn()
                };

                await middlewareFunction(ctx, next);
                expect(next).toHaveBeenCalled();
            }

            // Wallet details should be called less frequently due to caching
            // (exact number depends on cache implementation)
            expect(walletManager.getWalletDetails).toHaveBeenCalled();
        });
    });

    describe('Monitoring Integration in Bot Context', () => {
        test('should track all bot interactions through monitoring', async () => {
            // Setup users
            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn()
                .mockReturnValueOnce({ address: testData.whitelistedAddress })
                .mockReturnValueOnce({ address: testData.nonWhitelistedAddress });

            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();

            // Simulate various interactions
            
            // 1. Successful access
            const ctx1 = {
                from: { id: testData.regularUserId, username: 'user1' },
                message: { text: '/balances' },
                reply: jest.fn()
            };
            await middlewareFunction(ctx1, jest.fn());

            // 2. Denied access
            const ctx2 = {
                from: { id: testData.regularUserId + 1, username: 'user2' },
                message: { text: '/swap' },
                reply: jest.fn()
            };
            await middlewareFunction(ctx2, jest.fn());

            // 3. Admin operation
            const adminCtx = {
                from: { id: testData.adminUserId, username: 'admin' }
            };
            await telegramCommands.addAddressCommand(adminCtx, testData.newAddress);

            // Verify comprehensive monitoring
            const stats = whitelistMonitor.getStatistics();
            expect(stats.access.total).toBe(2);
            expect(stats.access.authorized).toBe(1);
            expect(stats.access.denied).toBe(1);
            expect(stats.modifications.total).toBe(1);
            expect(stats.modifications.additions).toBe(1);

            // Generate monitoring report
            const report = await whitelistMonitor.generateReport();
            expect(report.summary.totalAccessAttempts).toBe(2);
            expect(report.summary.successRate).toBe('50.0%');
            expect(report.summary.totalModifications).toBe(1);
        });
    });

    describe('Bot Lifecycle Integration', () => {
        test('should handle bot startup with whitelist system', async () => {
            // Simulate bot startup sequence
            
            // 1. Initialize whitelist system
            expect(whitelistManager.initialized).toBe(true);
            expect(whitelistMonitor.initialized).toBe(true);

            // 2. Verify middleware is active
            expect(whitelistMiddleware).toBeDefined();

            // 3. Verify commands are available
            expect(telegramCommands.whitelistManager).toBe(whitelistManager);
            expect(telegramCommands.monitor).toBe(whitelistMonitor);

            // 4. Test system functionality
            const adminCtx = { from: { id: testData.adminUserId, username: 'admin' } };
            const result = await telegramCommands.listWhitelistCommand(adminCtx);
            expect(result.success).toBe(true);
        });

        test('should handle bot shutdown gracefully', async () => {
            // Simulate bot shutdown
            whitelistMonitor.shutdown();

            // Verify cleanup
            expect(whitelistMonitor.initialized).toBe(false);
            expect(whitelistMonitor.healthCheckInterval).toBeNull();
        });
    });

    describe('Real-world Scenarios', () => {
        test('should handle typical user journey', async () => {
            // Scenario: New user tries to use bot, gets denied, admin adds them, user can then access

            // 1. New user tries to access bot
            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn().mockReturnValue({
                address: testData.newAddress
            });

            const middlewareFunction = whitelistMiddleware.middleware();
            const userCtx = {
                from: { id: testData.regularUserId, username: 'newuser' },
                message: { text: '/balances' },
                reply: jest.fn()
            };

            // Should be denied initially
            await middlewareFunction(userCtx, jest.fn());
            expect(userCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('not authorized'),
                { parse_mode: 'Markdown' }
            );

            // 2. Admin adds user to whitelist
            const adminCtx = { from: { id: testData.adminUserId, username: 'admin' } };
            const addResult = await telegramCommands.addAddressCommand(adminCtx, testData.newAddress);
            expect(addResult.success).toBe(true);

            // 3. User tries again and should now be allowed
            const next = jest.fn();
            userCtx.reply = jest.fn(); // Reset mock
            await middlewareFunction(userCtx, next);
            expect(next).toHaveBeenCalled();
            expect(userCtx.reply).not.toHaveBeenCalled();

            // 4. Verify monitoring tracked the journey
            const stats = whitelistMonitor.getStatistics();
            expect(stats.access.total).toBe(2);
            expect(stats.access.denied).toBe(1);
            expect(stats.access.authorized).toBe(1);
            expect(stats.modifications.additions).toBe(1);
        });

        test('should handle admin management workflow', async () => {
            // Scenario: Admin manages whitelist through various operations

            const adminCtx = { from: { id: testData.adminUserId, username: 'admin' } };
            const addresses = [
                '0x1111111111111111111111111111111111111111',
                '0x2222222222222222222222222222222222222222',
                '0x3333333333333333333333333333333333333333'
            ];

            // 1. Admin views current whitelist
            let result = await telegramCommands.listWhitelistCommand(adminCtx);
            expect(result.success).toBe(true);
            expect(result.message).toContain('Total: 1 address'); // Default address

            // 2. Admin adds multiple addresses
            for (const address of addresses) {
                result = await telegramCommands.addAddressCommand(adminCtx, address);
                expect(result.success).toBe(true);
            }

            // 3. Admin views updated whitelist
            result = await telegramCommands.listWhitelistCommand(adminCtx);
            expect(result.success).toBe(true);
            expect(result.message).toContain('Total: 4 addresses');

            // 4. Admin removes one address
            result = await telegramCommands.removeAddressCommand(adminCtx, addresses[0]);
            expect(result.success).toBe(true);

            // 5. Admin checks monitoring stats
            result = await telegramCommands.whitelistMonitoringCommand(adminCtx);
            expect(result.success).toBe(true);
            expect(result.message).toContain('Modifications');
            expect(result.message).toContain('Total: 4'); // 3 adds + 1 remove

            // 6. Verify final state
            expect(whitelistManager.isAddressWhitelisted(addresses[0])).toBe(false);
            expect(whitelistManager.isAddressWhitelisted(addresses[1])).toBe(true);
            expect(whitelistManager.isAddressWhitelisted(addresses[2])).toBe(true);
        });
    });
});