const WhitelistInitializer = require('../utils/whitelistInitializer');
const fs = require('fs').promises;
const path = require('path');

// Mock file system operations
jest.mock('fs/promises');

describe('Whitelist Initialization Tests', () => {
    let initializer;
    const testDataDir = './test-data';
    const testWhitelistFile = 'test-whitelist.json';

    beforeEach(() => {
        jest.clearAllMocks();
        initializer = new WhitelistInitializer(testDataDir, testWhitelistFile);
        
        // Mock successful operations by default
        fs.stat.mockResolvedValue({ isDirectory: () => true });
        fs.access.mockResolvedValue();
        fs.mkdir.mockResolvedValue();
        fs.writeFile.mockResolvedValue();
        fs.readFile.mockResolvedValue(JSON.stringify({
            addresses: ['0xe2f92e8f706997b021919a092437372b268a432d'],
            metadata: { totalAddresses: 1 }
        }));
        fs.copyFile.mockResolvedValue();
        fs.rename.mockResolvedValue();
        fs.chmod.mockResolvedValue();
    });

    describe('Data Directory Creation', () => {
        test('should create data directory if it does not exist', async () => {
            fs.stat.mockRejectedValueOnce({ code: 'ENOENT' });

            await initializer.ensureDataDirectory();

            expect(fs.mkdir).toHaveBeenCalledWith(
                path.resolve(testDataDir),
                { recursive: true, mode: 0o755 }
            );
        });

        test('should validate existing data directory', async () => {
            fs.stat.mockResolvedValue({ isDirectory: () => true });

            await initializer.ensureDataDirectory();

            expect(fs.mkdir).not.toHaveBeenCalled();
            expect(fs.access).toHaveBeenCalledWith(
                path.resolve(testDataDir),
                fs.constants.W_OK
            );
        });

        test('should throw error if path exists but is not a directory', async () => {
            fs.stat.mockResolvedValue({ isDirectory: () => false });

            await expect(initializer.ensureDataDirectory()).rejects.toThrow(
                'exists but is not a directory'
            );
        });

        test('should throw error if directory is not writable', async () => {
            fs.access.mockRejectedValue(new Error('Permission denied'));

            await expect(initializer.ensureDataDirectory()).rejects.toThrow(
                'Permission denied'
            );
        });
    });

    describe('Whitelist File Initialization', () => {
        test('should create default whitelist file if it does not exist', async () => {
            fs.access.mockRejectedValueOnce({ code: 'ENOENT' });

            const result = await initializer.initializeWhitelistFile();

            expect(result.created).toBe(true);
            expect(result.restored).toBe(false);
            expect(fs.writeFile).toHaveBeenCalled();
        });

        test('should validate existing whitelist file', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({
                addresses: ['0xe2f92e8f706997b021919a092437372b268a432d'],
                metadata: { totalAddresses: 1 }
            }));

            const result = await initializer.initializeWhitelistFile();

            expect(result.created).toBe(false);
            expect(result.restored).toBe(false);
            expect(fs.writeFile).not.toHaveBeenCalled();
        });

        test('should restore corrupted whitelist file', async () => {
            fs.readFile.mockResolvedValueOnce('invalid json');

            const result = await initializer.initializeWhitelistFile();

            expect(result.created).toBe(false);
            expect(result.restored).toBe(true);
            expect(fs.copyFile).toHaveBeenCalled(); // Backup
            expect(fs.writeFile).toHaveBeenCalled(); // Recreate
        });

        test('should restore whitelist with invalid structure', async () => {
            fs.readFile.mockResolvedValueOnce(JSON.stringify({
                // Missing addresses array
                metadata: { totalAddresses: 0 }
            }));

            const result = await initializer.initializeWhitelistFile();

            expect(result.restored).toBe(true);
            expect(fs.copyFile).toHaveBeenCalled();
            expect(fs.writeFile).toHaveBeenCalled();
        });
    });

    describe('Default Whitelist Creation', () => {
        test('should create whitelist with default addresses', async () => {
            await initializer.createDefaultWhitelist();

            expect(fs.writeFile).toHaveBeenCalled();
            
            const writeCall = fs.writeFile.mock.calls[0];
            const writtenData = JSON.parse(writeCall[1]);
            
            expect(writtenData.addresses).toEqual([
                '0xe2f92e8f706997b021919a092437372b268a432d',
                '0x5230b89d6728a10b34b8ec1c740a7a7a1c4afe94'
            ]);
            expect(writtenData.metadata.totalAddresses).toBe(2);
            expect(writtenData.metadata.initializedBy).toBe('bot-startup');
        });

        test('should normalize addresses to lowercase', async () => {
            await initializer.createDefaultWhitelist();

            const writeCall = fs.writeFile.mock.calls[0];
            const writtenData = JSON.parse(writeCall[1]);
            
            writtenData.addresses.forEach(address => {
                expect(address).toBe(address.toLowerCase());
            });
        });
    });

    describe('Integrity Verification', () => {
        test('should verify valid whitelist', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({
                addresses: [
                    '0xe2f92e8f706997b021919a092437372b268a432d',
                    '0x5230b89d6728a10b34b8ec1c740a7a7a1c4afe94'
                ]
            }));

            const integrity = await initializer.verifyIntegrity();

            expect(integrity.isValid).toBe(true);
            expect(integrity.totalAddresses).toBe(2);
            expect(integrity.validAddresses).toBe(2);
            expect(integrity.invalidAddresses).toBe(0);
        });

        test('should detect invalid addresses', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({
                addresses: [
                    '0xe2f92e8f706997b021919a092437372b268a432d', // Valid
                    'invalid-address', // Invalid
                    '0x5230b89d6728a10b34b8ec1c740a7a7a1c4afe94'  // Valid
                ]
            }));

            const integrity = await initializer.verifyIntegrity();

            expect(integrity.isValid).toBe(false);
            expect(integrity.totalAddresses).toBe(3);
            expect(integrity.validAddresses).toBe(2);
            expect(integrity.invalidAddresses).toBe(1);
        });
    });

    describe('Full Initialization Process', () => {
        test('should complete full initialization successfully', async () => {
            fs.access.mockRejectedValueOnce({ code: 'ENOENT' }); // File doesn't exist

            const result = await initializer.initialize();

            expect(result.success).toBe(true);
            expect(result.created).toBe(true);
            expect(result.addressCount).toBe(2);
            expect(result.errors).toHaveLength(0);
        });

        test('should handle initialization with existing valid file', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({
                addresses: ['0xe2f92e8f706997b021919a092437372b268a432d'],
                metadata: { totalAddresses: 1 }
            }));

            const result = await initializer.initialize();

            expect(result.success).toBe(true);
            expect(result.created).toBe(false);
            expect(result.restored).toBe(false);
            expect(result.addressCount).toBe(1);
        });

        test('should handle initialization with corrupted file', async () => {
            fs.readFile.mockResolvedValueOnce('corrupted json');

            const result = await initializer.initialize();

            expect(result.success).toBe(true);
            expect(result.restored).toBe(true);
            expect(result.addressCount).toBe(2);
        });

        test('should use emergency fallback on critical failure', async () => {
            fs.stat.mockRejectedValue(new Error('Critical filesystem error'));
            fs.writeFile.mockResolvedValueOnce(); // Emergency fallback succeeds

            const result = await initializer.initialize();

            expect(result.success).toBe(true);
            expect(result.created).toBe(true);
            expect(result.errors.length).toBeGreaterThan(0);
        });

        test('should fail gracefully when all recovery attempts fail', async () => {
            fs.stat.mockRejectedValue(new Error('Critical error'));
            fs.writeFile.mockRejectedValue(new Error('Cannot write'));

            const result = await initializer.initialize();

            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
        });
    });

    describe('Status and Health Checks', () => {
        test('should return status for existing valid file', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({
                addresses: ['0xe2f92e8f706997b021919a092437372b268a432d'],
                lastUpdated: '2024-01-01T00:00:00.000Z'
            }));

            const status = await initializer.getStatus();

            expect(status.exists).toBe(true);
            expect(status.valid).toBe(true);
            expect(status.addressCount).toBe(1);
            expect(status.lastUpdated).toBe('2024-01-01T00:00:00.000Z');
        });

        test('should return status for non-existent file', async () => {
            fs.access.mockRejectedValue({ code: 'ENOENT' });

            const status = await initializer.getStatus();

            expect(status.exists).toBe(false);
            expect(status.valid).toBe(false);
            expect(status.addressCount).toBe(0);
            expect(status.error).toBeDefined();
        });

        test('should perform health check on valid whitelist', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({
                addresses: [
                    '0xe2f92e8f706997b021919a092437372b268a432d',
                    '0x5230b89d6728a10b34b8ec1c740a7a7a1c4afe94'
                ]
            }));

            const health = await initializer.healthCheck();

            expect(health.healthy).toBe(true);
            expect(health.issues).toHaveLength(0);
            expect(health.warnings).toHaveLength(0);
        });

        test('should detect health issues', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({
                addresses: [
                    '0xe2f92e8f706997b021919a092437372b268a432d',
                    'invalid-address'
                ]
            }));

            const health = await initializer.healthCheck();

            expect(health.healthy).toBe(true); // Still healthy, just warnings
            expect(health.warnings.length).toBeGreaterThan(0);
            expect(health.warnings[0]).toContain('invalid addresses');
        });

        test('should detect empty whitelist', async () => {
            fs.readFile.mockResolvedValue(JSON.stringify({
                addresses: []
            }));

            const health = await initializer.healthCheck();

            expect(health.warnings).toContain('Whitelist is empty');
        });
    });

    describe('Emergency Fallback', () => {
        test('should create emergency fallback whitelist', async () => {
            await initializer.emergencyFallback();

            expect(fs.writeFile).toHaveBeenCalledTimes(1); // Temp file
            expect(fs.rename).toHaveBeenCalledTimes(1); // Move to final location
        });

        test('should handle emergency fallback failure', async () => {
            fs.writeFile.mockRejectedValue(new Error('Cannot write temp file'));

            await expect(initializer.emergencyFallback()).rejects.toThrow(
                'Cannot write temp file'
            );
        });
    });

    describe('File Permissions', () => {
        test('should set proper file permissions', async () => {
            await initializer.setPermissions();

            expect(fs.chmod).toHaveBeenCalledWith(
                initializer.whitelistPath,
                0o600
            );
            expect(fs.chmod).toHaveBeenCalledWith(
                initializer.dataDir,
                0o755
            );
        });

        test('should handle permission setting failure gracefully', async () => {
            fs.chmod.mockRejectedValue(new Error('Permission denied'));

            // Should not throw - permissions are non-critical
            await expect(initializer.setPermissions()).rejects.toThrow();
        });
    });

    describe('Backup Operations', () => {
        test('should backup corrupted file', async () => {
            await initializer.backupCorruptedFile();

            expect(fs.copyFile).toHaveBeenCalled();
            
            const copyCall = fs.copyFile.mock.calls[0];
            expect(copyCall[1]).toContain('.corrupted.');
        });

        test('should handle backup failure gracefully', async () => {
            fs.copyFile.mockRejectedValue(new Error('Cannot backup'));

            // Should not throw - backup failure is not critical
            await expect(initializer.backupCorruptedFile()).resolves.not.toThrow();
        });
    });
});