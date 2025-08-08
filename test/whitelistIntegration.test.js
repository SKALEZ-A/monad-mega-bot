const { Telegraf } = require('telegraf');
const WhitelistManager = require('../utils/whitelistManager');
const WhitelistMiddleware = require('../utils/whitelistMiddleware');
const TelegramCommands = require('../utils/telegramCommands');
const WalletManager = require('../utils/walletManager');

// Mock file system operations
jest.mock('fs/promises');
jest.mock('../utils/userPreferences');
jest.mock('../utils/tokenPrices');

describe('Whitelist Integration Tests', () => {
    let bot;
    let whitelistManager;
    let whitelistMiddleware;
    let walletManager;
    let commands;
    let mockCtx;

    beforeEach(async () => {
        // Reset mocks
        jest.clearAllMocks();
        
        // Initialize managers
        whitelistManager = new WhitelistManager('./test-data/whitelist.json');
        walletManager = new WalletManager();
        commands = new TelegramCommands(walletManager, null, null, whitelistManager);
        whitelistMiddleware = new WhitelistMiddleware(whitelistManager, walletManager);
        
        // Initialize whitelist with test data
        await whitelistManager.initialize();
        
        // Create mock context
        mockCtx = {
            from: { id: 123456789 },
            message: { text: '' },
            reply: jest.fn(),
            replyWithMarkdown: jest.fn(),
            answerCbQuery: jest.fn()
        };

        // Mock admin access
        process.env.ADMIN_USER_IDS = '123456789';
    });

    afterEach(() => {
        delete process.env.ADMIN_USER_IDS;
    });

    describe('Admin Command Integration', () => {
        test('should handle complete add address workflow', async () => {
            const testAddress = '0x1234567890123456789012345678901234567890';
            
            // Mock command text
            mockCtx.message.text = `/whitelist_add ${testAddress}`;
            
            // Execute add command
            const result = await commands.addAddressCommand(mockCtx, testAddress);
            
            expect(result.success).toBe(true);
            expect(result.message).toContain('has been added to the whitelist');
            
            // Verify address was actually added
            expect(whitelistManager.isAddressWhitelisted(testAddress)).toBe(true);
        });

        test('should handle complete remove address workflow', async () => {
            const testAddress = '0x1234567890123456789012345678901234567890';
            
            // First add the address
            await whitelistManager.addAddress(testAddress);
            expect(whitelistManager.isAddressWhitelisted(testAddress)).toBe(true);
            
            // Mock command text
            mockCtx.message.text = `/whitelist_remove ${testAddress}`;
            
            // Execute remove command
            const result = await commands.removeAddressCommand(mockCtx, testAddress);
            
            expect(result.success).toBe(true);
            expect(result.message).toContain('has been removed from the whitelist');
            
            // Verify address was actually removed
            expect(whitelistManager.isAddressWhitelisted(testAddress)).toBe(false);
        });

        test('should handle list whitelist workflow', async () => {
            const testAddresses = [
                '0x1234567890123456789012345678901234567890',
                '0x0987654321098765432109876543210987654321'
            ];
            
            // Add test addresses
            for (const address of testAddresses) {
                await whitelistManager.addAddress(address);
            }
            
            // Execute list command
            const result = await commands.listWhitelistCommand(mockCtx);
            
            expect(result.success).toBe(true);
            expect(result.message).toContain('Whitelisted Addresses');
            expect(result.message).toContain(testAddresses[0]);
            expect(result.message).toContain(testAddresses[1]);
        });

        test('should handle whitelist stats workflow', async () => {
            const testAddress = '0x1234567890123456789012345678901234567890';
            await whitelistManager.addAddress(testAddress);
            
            // Execute stats command
            const result = await commands.whitelistStatsCommand(mockCtx);
            
            expect(result.success).toBe(true);
            expect(result.message).toContain('Whitelist Statistics');
            expect(result.message).toContain('Total Addresses');
        });
    });

    describe('Access Control Integration', () => {
        test('should deny admin commands to non-admin users', async () => {
            // Create non-admin context
            const nonAdminCtx = {
                ...mockCtx,
                from: { id: 999999999 }
            };
            
            const testAddress = '0x1234567890123456789012345678901234567890';
            
            // Try to execute admin command as non-admin
            const result = await commands.addAddressCommand(nonAdminCtx, testAddress);
            
            expect(result.success).toBe(false);
            expect(result.message).toContain('Access denied. Admin privileges required');
            
            // Verify address was not added
            expect(whitelistManager.isAddressWhitelisted(testAddress)).toBe(false);
        });

        test('should allow admin commands for admin users', async () => {
            const testAddress = '0x1234567890123456789012345678901234567890';
            
            // Execute admin command as admin
            const result = await commands.addAddressCommand(mockCtx, testAddress);
            
            expect(result.success).toBe(true);
            expect(result.message).toContain('has been added to the whitelist');
            
            // Verify address was added
            expect(whitelistManager.isAddressWhitelisted(testAddress)).toBe(true);
        });
    });

    describe('Middleware Integration', () => {
        test('should allow whitelisted users through middleware', async () => {
            const testAddress = '0x1234567890123456789012345678901234567890';
            const userId = '123456789';
            
            // Add address to whitelist
            await whitelistManager.addAddress(testAddress);
            
            // Mock wallet manager to return the whitelisted address
            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn().mockReturnValue({
                address: testAddress
            });
            
            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();
            
            // Mock next function
            const next = jest.fn();
            
            // Create context for middleware
            const middlewareCtx = {
                from: { id: parseInt(userId) },
                message: { text: '/balances' }
            };
            
            // Execute middleware
            await middlewareFunction(middlewareCtx, next);
            
            // Verify next was called (user allowed through)
            expect(next).toHaveBeenCalled();
        });

        test('should block non-whitelisted users through middleware', async () => {
            const testAddress = '0x9999999999999999999999999999999999999999';
            const userId = '123456789';
            
            // Mock wallet manager to return non-whitelisted address
            walletManager.hasWallet = jest.fn().mockReturnValue(true);
            walletManager.getWalletDetails = jest.fn().mockReturnValue({
                address: testAddress
            });
            
            // Create middleware function
            const middlewareFunction = whitelistMiddleware.middleware();
            
            // Mock next function
            const next = jest.fn();
            
            // Create context for middleware
            const middlewareCtx = {
                from: { id: parseInt(userId) },
                message: { text: '/balances' },
                reply: jest.fn()
            };
            
            // Execute middleware
            await middlewareFunction(middlewareCtx, next);
            
            // Verify next was NOT called (user blocked)
            expect(next).not.toHaveBeenCalled();
            
            // Verify access denied message was sent
            expect(middlewareCtx.reply).toHaveBeenCalledWith(
                expect.stringContaining('Access denied')
            );
        });
    });

    describe('Error Handling Integration', () => {
        test('should handle storage errors gracefully', async () => {
            // Mock storage error
            const originalSaveWhitelist = whitelistManager.saveWhitelist;
            whitelistManager.saveWhitelist = jest.fn().mockRejectedValue(new Error('Storage error'));
            
            const testAddress = '0x1234567890123456789012345678901234567890';
            
            // Try to add address with storage error
            const result = await commands.addAddressCommand(mockCtx, testAddress);
            
            expect(result.success).toBe(false);
            expect(result.message).toContain('Error adding address');
            
            // Restore original method
            whitelistManager.saveWhitelist = originalSaveWhitelist;
        });

        test('should handle invalid addresses gracefully', async () => {
            const invalidAddress = 'invalid-address';
            
            // Try to add invalid address
            const result = await commands.addAddressCommand(mockCtx, invalidAddress);
            
            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid address format');
        });

        test('should handle missing address parameter', async () => {
            // Try to add without address
            const result = await commands.addAddressCommand(mockCtx, null);
            
            expect(result.success).toBe(false);
            expect(result.message).toContain('Please provide an address to add');
        });
    });

    describe('Persistence Integration', () => {
        test('should persist whitelist changes across manager restarts', async () => {
            const testAddress = '0x1234567890123456789012345678901234567890';
            
            // Add address to first manager instance
            await whitelistManager.addAddress(testAddress);
            expect(whitelistManager.isAddressWhitelisted(testAddress)).toBe(true);
            
            // Create new manager instance (simulating restart)
            const newWhitelistManager = new WhitelistManager('./test-data/whitelist.json');
            await newWhitelistManager.initialize();
            
            // Verify address is still whitelisted
            expect(newWhitelistManager.isAddressWhitelisted(testAddress)).toBe(true);
        });

        test('should handle concurrent whitelist modifications', async () => {
            const testAddresses = [
                '0x1111111111111111111111111111111111111111',
                '0x2222222222222222222222222222222222222222',
                '0x3333333333333333333333333333333333333333'
            ];
            
            // Add multiple addresses concurrently
            const addPromises = testAddresses.map(address => 
                whitelistManager.addAddress(address)
            );
            
            await Promise.all(addPromises);
            
            // Verify all addresses were added
            for (const address of testAddresses) {
                expect(whitelistManager.isAddressWhitelisted(address)).toBe(true);
            }
            
            // Verify total count
            const addresses = whitelistManager.getWhitelistedAddresses();
            expect(addresses.length).toBeGreaterThanOrEqual(testAddresses.length);
        });
    });

    describe('Command Parsing Integration', () => {
        test('should parse whitelist_add command correctly', async () => {
            const testAddress = '0x1234567890123456789012345678901234567890';
            const commandText = `/whitelist_add ${testAddress}`;
            
            // Simulate command parsing (as done in bot handler)
            const parts = commandText.split(' ');
            const extractedAddress = parts.length > 1 ? parts[1].trim() : null;
            
            expect(extractedAddress).toBe(testAddress);
            
            // Execute command with parsed address
            const result = await commands.addAddressCommand(mockCtx, extractedAddress);
            
            expect(result.success).toBe(true);
            expect(whitelistManager.isAddressWhitelisted(testAddress)).toBe(true);
        });

        test('should handle whitelist_add command without address', async () => {
            const commandText = '/whitelist_add';
            
            // Simulate command parsing
            const parts = commandText.split(' ');
            const extractedAddress = parts.length > 1 ? parts[1].trim() : null;
            
            expect(extractedAddress).toBeNull();
            
            // Execute command with null address
            const result = await commands.addAddressCommand(mockCtx, extractedAddress);
            
            expect(result.success).toBe(false);
            expect(result.message).toContain('Please provide an address to add');
        });
    });
});