const TelegramCommands = require('../utils/telegramCommands');
const WhitelistManager = require('../utils/whitelistManager');

// Mock dependencies
jest.mock('../utils/whitelistManager');
jest.mock('../utils/userPreferences');
jest.mock('../utils/tokenPrices');

describe('TelegramCommands - Whitelist Management', () => {
    let telegramCommands;
    let mockWhitelistManager;
    let mockCtx;

    beforeEach(() => {
        // Reset mocks
        jest.clearAllMocks();
        
        // Create mock whitelist manager
        mockWhitelistManager = {
            validateAddress: jest.fn(),
            isAddressWhitelisted: jest.fn(),
            addAddress: jest.fn(),
            removeAddress: jest.fn(),
            getWhitelistedAddresses: jest.fn(),
            getWhitelistStats: jest.fn()
        };

        // Create TelegramCommands instance with mock whitelist manager
        telegramCommands = new TelegramCommands(
            null, // walletManager
            null, // monadIntegration
            null, // megaethIntegration
            mockWhitelistManager
        );

        // Mock context object
        mockCtx = {
            from: { id: 123456789 }
        };

        // Mock admin validation to return true by default
        jest.spyOn(telegramCommands, 'validateAdminAccess').mockReturnValue(true);
    });

    describe('addAddressCommand', () => {
        const validAddress = '0xe2F92e8f706997B021919a092437372B268a432d';

        test('should successfully add a valid address', async () => {
            mockWhitelistManager.validateAddress.mockReturnValue(true);
            mockWhitelistManager.isAddressWhitelisted.mockReturnValue(false);
            mockWhitelistManager.addAddress.mockResolvedValue({ 
                success: true, 
                totalAddresses: 3 
            });

            const result = await telegramCommands.addAddressCommand(mockCtx, validAddress);

            expect(result.success).toBe(true);
            expect(result.message).toContain('has been added to the whitelist');
            expect(result.message).toContain('Total whitelisted addresses: 3');
            expect(mockWhitelistManager.addAddress).toHaveBeenCalledWith(validAddress);
        });

        test('should reject invalid address format', async () => {
            const invalidAddress = 'invalid-address';
            mockWhitelistManager.validateAddress.mockReturnValue(false);

            const result = await telegramCommands.addAddressCommand(mockCtx, invalidAddress);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid address format');
            expect(mockWhitelistManager.addAddress).not.toHaveBeenCalled();
        });

        test('should handle already whitelisted address', async () => {
            mockWhitelistManager.validateAddress.mockReturnValue(true);
            mockWhitelistManager.isAddressWhitelisted.mockReturnValue(true);

            const result = await telegramCommands.addAddressCommand(mockCtx, validAddress);

            expect(result.success).toBe(false);
            expect(result.message).toContain('is already whitelisted');
            expect(mockWhitelistManager.addAddress).not.toHaveBeenCalled();
        });

        test('should reject non-admin users', async () => {
            telegramCommands.validateAdminAccess.mockReturnValue(false);

            const result = await telegramCommands.addAddressCommand(mockCtx, validAddress);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Access denied. Admin privileges required');
        });

        test('should handle missing address parameter', async () => {
            const result = await telegramCommands.addAddressCommand(mockCtx, null);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Please provide an address to add');
        });

        test('should handle whitelist manager errors', async () => {
            mockWhitelistManager.validateAddress.mockReturnValue(true);
            mockWhitelistManager.isAddressWhitelisted.mockReturnValue(false);
            mockWhitelistManager.addAddress.mockResolvedValue({ 
                success: false, 
                error: 'Storage error' 
            });

            const result = await telegramCommands.addAddressCommand(mockCtx, validAddress);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Failed to add address: Storage error');
        });
    });

    describe('removeAddressCommand', () => {
        const validAddress = '0xe2F92e8f706997B021919a092437372B268a432d';

        test('should successfully remove a whitelisted address', async () => {
            mockWhitelistManager.validateAddress.mockReturnValue(true);
            mockWhitelistManager.isAddressWhitelisted.mockReturnValue(true);
            mockWhitelistManager.removeAddress.mockResolvedValue({ 
                success: true, 
                totalAddresses: 1 
            });

            const result = await telegramCommands.removeAddressCommand(mockCtx, validAddress);

            expect(result.success).toBe(true);
            expect(result.message).toContain('has been removed from the whitelist');
            expect(result.message).toContain('Total whitelisted addresses: 1');
            expect(mockWhitelistManager.removeAddress).toHaveBeenCalledWith(validAddress);
        });

        test('should handle address not in whitelist', async () => {
            mockWhitelistManager.validateAddress.mockReturnValue(true);
            mockWhitelistManager.isAddressWhitelisted.mockReturnValue(false);

            const result = await telegramCommands.removeAddressCommand(mockCtx, validAddress);

            expect(result.success).toBe(false);
            expect(result.message).toContain('is not in the whitelist');
            expect(mockWhitelistManager.removeAddress).not.toHaveBeenCalled();
        });

        test('should reject invalid address format', async () => {
            const invalidAddress = 'invalid-address';
            mockWhitelistManager.validateAddress.mockReturnValue(false);

            const result = await telegramCommands.removeAddressCommand(mockCtx, invalidAddress);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Invalid address format');
        });

        test('should reject non-admin users', async () => {
            telegramCommands.validateAdminAccess.mockReturnValue(false);

            const result = await telegramCommands.removeAddressCommand(mockCtx, validAddress);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Access denied. Admin privileges required');
        });
    });

    describe('listWhitelistCommand', () => {
        test('should display whitelisted addresses', async () => {
            const addresses = [
                '0xe2F92e8f706997B021919a092437372B268a432d',
                '0x5230b89d6728a10b34b8EC1C740a7A7a1C4afe94'
            ];
            mockWhitelistManager.getWhitelistedAddresses.mockReturnValue(addresses);

            const result = await telegramCommands.listWhitelistCommand(mockCtx);

            expect(result.success).toBe(true);
            expect(result.message).toContain('Whitelisted Addresses');
            expect(result.message).toContain('Total: 2 addresses');
            expect(result.message).toContain(addresses[0]);
            expect(result.message).toContain(addresses[1]);
        });

        test('should handle empty whitelist', async () => {
            mockWhitelistManager.getWhitelistedAddresses.mockReturnValue([]);

            const result = await telegramCommands.listWhitelistCommand(mockCtx);

            expect(result.success).toBe(true);
            expect(result.message).toContain('Whitelist is empty');
        });

        test('should reject non-admin users', async () => {
            telegramCommands.validateAdminAccess.mockReturnValue(false);

            const result = await telegramCommands.listWhitelistCommand(mockCtx);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Access denied. Admin privileges required');
        });
    });

    describe('whitelistStatsCommand', () => {
        test('should display whitelist statistics', async () => {
            const mockStats = {
                totalAddresses: 2,
                lastUpdated: '2024-01-01T12:00:00.000Z',
                createdAt: '2024-01-01T10:00:00.000Z'
            };
            const addresses = [
                '0xe2F92e8f706997B021919a092437372B268a432d',
                '0x5230b89d6728a10b34b8EC1C740a7A7a1C4afe94'
            ];
            
            mockWhitelistManager.getWhitelistStats.mockReturnValue(mockStats);
            mockWhitelistManager.getWhitelistedAddresses.mockReturnValue(addresses);

            const result = await telegramCommands.whitelistStatsCommand(mockCtx);

            expect(result.success).toBe(true);
            expect(result.message).toContain('Whitelist Statistics');
            expect(result.message).toContain('Total Addresses: 2');
            expect(result.message).toContain('Recent Addresses');
        });

        test('should reject non-admin users', async () => {
            telegramCommands.validateAdminAccess.mockReturnValue(false);

            const result = await telegramCommands.whitelistStatsCommand(mockCtx);

            expect(result.success).toBe(false);
            expect(result.message).toContain('Access denied. Admin privileges required');
        });
    });

    describe('validateAdminAccess', () => {
        test('should validate admin access based on environment variable', () => {
            // Mock environment variable
            process.env.ADMIN_USER_IDS = '123456789,987654321';
            
            // Create new instance to pick up env var
            const commands = new TelegramCommands(null, null, null, mockWhitelistManager);
            
            const adminCtx = { from: { id: 123456789 } };
            const nonAdminCtx = { from: { id: 555555555 } };

            expect(commands.validateAdminAccess(adminCtx)).toBe(true);
            expect(commands.validateAdminAccess(nonAdminCtx)).toBe(false);
            
            // Clean up
            delete process.env.ADMIN_USER_IDS;
        });

        test('should deny access when no admin IDs configured', () => {
            delete process.env.ADMIN_USER_IDS;
            
            const commands = new TelegramCommands(null, null, null, mockWhitelistManager);
            const ctx = { from: { id: 123456789 } };

            expect(commands.validateAdminAccess(ctx)).toBe(false);
        });
    });

    describe('formatWhitelistDisplay', () => {
        test('should format addresses for display', () => {
            const addresses = [
                '0xe2F92e8f706997B021919a092437372B268a432d',
                '0x5230b89d6728a10b34b8EC1C740a7A7a1C4afe94'
            ];

            const result = telegramCommands.formatWhitelistDisplay(addresses);

            expect(result).toContain('Whitelisted Addresses');
            expect(result).toContain('Total: 2 addresses');
            expect(result).toContain('1. 0xe2F92e8f706997B021919a092437372B268a432d');
            expect(result).toContain('2. 0x5230b89d6728a10b34b8EC1C740a7A7a1C4afe94');
            expect(result).toContain('Admin Commands');
        });

        test('should handle single address correctly', () => {
            const addresses = ['0xe2F92e8f706997B021919a092437372B268a432d'];

            const result = telegramCommands.formatWhitelistDisplay(addresses);

            expect(result).toContain('Total: 1 address');
        });
    });

    describe('error handling', () => {
        test('should handle whitelist manager not initialized', async () => {
            const commandsWithoutWhitelist = new TelegramCommands(null, null, null, null);

            const result = await commandsWithoutWhitelist.addAddressCommand(mockCtx, 'test');

            expect(result.success).toBe(false);
            expect(result.message).toContain('Whitelist manager not initialized');
        });

        test('should handle unexpected errors gracefully', async () => {
            mockWhitelistManager.validateAddress.mockImplementation(() => {
                throw new Error('Unexpected error');
            });

            const result = await telegramCommands.addAddressCommand(mockCtx, 'test');

            expect(result.success).toBe(false);
            expect(result.message).toContain('Error adding address: Unexpected error');
        });
    });
});