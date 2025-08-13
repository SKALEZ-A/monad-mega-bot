/**
 * WhitelistInitializer - Ensures whitelist is properly initialized on bot startup
 */

const fs = require('fs').promises;
const path = require('path');
const { ethers } = require('ethers');

class WhitelistInitializer {
    constructor(dataDir = './data', whitelistFile = 'whitelist.json') {
        this.dataDir = path.resolve(dataDir);
        this.whitelistPath = path.join(this.dataDir, whitelistFile);
        
        // Default addresses as specified in requirements
        this.defaultAddresses = [
            '0xe2F92e8f706997B021919a092437372B268a432d',
            '0x5230b89d6728a10b34b8EC1C740a7A7a1C4afe94'
        ];
    }

    /**
     * Initialize whitelist system on bot startup
     * @returns {Promise<object>} - Initialization result
     */
    async initialize() {
        const result = {
            success: false,
            created: false,
            restored: false,
            errors: [],
            addressCount: 0
        };

        try {
            console.log('🔧 Initializing whitelist system...');

            // Step 1: Ensure data directory exists
            await this.ensureDataDirectory();

            // Step 2: Check and initialize whitelist file
            const fileResult = await this.initializeWhitelistFile();
            result.created = fileResult.created;
            result.restored = fileResult.restored;

            // Step 3: Verify integrity
            const integrity = await this.verifyIntegrity();
            result.addressCount = integrity.totalAddresses;

            if (!integrity.isValid) {
                result.errors.push(`Found ${integrity.invalidAddresses} invalid addresses`);
            }

            // Step 4: Set permissions (non-critical)
            try {
                await this.setPermissions();
            } catch (error) {
                console.warn('⚠️ Could not set file permissions:', error.message);
            }

            result.success = true;
            
            if (result.created) {
                console.log(`✅ Whitelist initialized with ${result.addressCount} default addresses`);
            } else if (result.restored) {
                console.log(`✅ Whitelist restored with ${result.addressCount} addresses`);
            } else {
                console.log(`✅ Whitelist validated with ${result.addressCount} addresses`);
            }

            return result;

        } catch (error) {
            console.error('❌ Whitelist initialization failed:', error.message);
            result.errors.push(error.message);
            
            // Try emergency fallback
            try {
                await this.emergencyFallback();
                result.success = true;
                result.created = true;
                result.addressCount = this.defaultAddresses.length;
                console.log('⚠️ Using emergency fallback initialization');
            } catch (fallbackError) {
                console.error('❌ Emergency fallback failed:', fallbackError.message);
                result.errors.push(`Fallback failed: ${fallbackError.message}`);
            }

            return result;
        }
    }

    /**
     * Ensure data directory exists
     * @private
     */
    async ensureDataDirectory() {
        try {
            const stats = await fs.stat(this.dataDir);
            if (!stats.isDirectory()) {
                throw new Error(`${this.dataDir} exists but is not a directory`);
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                await fs.mkdir(this.dataDir, { recursive: true, mode: 0o755 });
                console.log('📁 Created data directory');
            } else {
                throw error;
            }
        }

        // Verify write permissions
        await fs.access(this.dataDir, fs.constants.W_OK);
    }

    /**
     * Initialize whitelist file if needed
     * @private
     */
    async initializeWhitelistFile() {
        const result = { created: false, restored: false };

        try {
            // Check if file exists and is valid
            await fs.access(this.whitelistPath);
            
            const data = await fs.readFile(this.whitelistPath, 'utf8');
            const parsed = JSON.parse(data);
            
            if (!parsed.addresses || !Array.isArray(parsed.addresses)) {
                throw new Error('Invalid file structure');
            }

            // File exists and is valid
            return result;

        } catch (error) {
            if (error.code === 'ENOENT') {
                // File doesn't exist, create it
                await this.createDefaultWhitelist();
                result.created = true;
                console.log('📋 Created default whitelist file');
                
            } else if (error.message.includes('Invalid file structure') || 
                       error.name === 'SyntaxError') {
                // File is corrupted, backup and recreate
                await this.backupCorruptedFile();
                await this.createDefaultWhitelist();
                result.restored = true;
                console.log('📋 Restored corrupted whitelist file');
                
            } else {
                throw error;
            }
        }

        return result;
    }

    /**
     * Create default whitelist file
     * @private
     */
    async createDefaultWhitelist() {
        const whitelist = {
            version: '1.0',
            lastUpdated: new Date().toISOString(),
            addresses: this.defaultAddresses.map(addr => addr.toLowerCase()),
            metadata: {
                totalAddresses: this.defaultAddresses.length,
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                initializedBy: 'bot-startup'
            }
        };

        const jsonData = JSON.stringify(whitelist, null, 2);
        await fs.writeFile(this.whitelistPath, jsonData, 'utf8');
    }

    /**
     * Backup corrupted file
     * @private
     */
    async backupCorruptedFile() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = `${this.whitelistPath}.corrupted.${timestamp}`;
            await fs.copyFile(this.whitelistPath, backupPath);
            console.log(`📋 Backed up corrupted file to: ${path.basename(backupPath)}`);
        } catch (error) {
            console.warn('⚠️ Could not backup corrupted file:', error.message);
        }
    }

    /**
     * Verify whitelist file integrity
     * @private
     */
    async verifyIntegrity() {
        const data = await fs.readFile(this.whitelistPath, 'utf8');
        const whitelist = JSON.parse(data);

        let validAddresses = 0;
        let invalidAddresses = 0;

        for (const address of whitelist.addresses) {
            if (ethers.isAddress(address)) {
                validAddresses++;
            } else {
                invalidAddresses++;
                console.warn(`⚠️ Invalid address in whitelist: ${address}`);
            }
        }

        return {
            isValid: invalidAddresses === 0,
            totalAddresses: whitelist.addresses.length,
            validAddresses,
            invalidAddresses
        };
    }

    /**
     * Set file permissions for security
     * @private
     */
    async setPermissions() {
        // Set restrictive permissions on whitelist file
        await fs.chmod(this.whitelistPath, 0o600);
        
        // Set directory permissions
        await fs.chmod(this.dataDir, 0o755);
    }

    /**
     * Emergency fallback - create minimal working whitelist in memory
     * @private
     */
    async emergencyFallback() {
        console.log('🚨 Attempting emergency fallback...');
        
        // Create minimal whitelist structure
        const minimalWhitelist = {
            version: '1.0',
            lastUpdated: new Date().toISOString(),
            addresses: this.defaultAddresses.map(addr => addr.toLowerCase()),
            metadata: {
                totalAddresses: this.defaultAddresses.length,
                createdAt: new Date().toISOString(),
                lastUpdated: new Date().toISOString(),
                initializedBy: 'emergency-fallback'
            }
        };

        // Try to write to a temporary location first
        const tempPath = `${this.whitelistPath}.temp`;
        const jsonData = JSON.stringify(minimalWhitelist, null, 2);
        
        await fs.writeFile(tempPath, jsonData, 'utf8');
        
        // If successful, move to final location
        await fs.rename(tempPath, this.whitelistPath);
        
        console.log('✅ Emergency fallback successful');
    }

    /**
     * Get initialization status
     */
    async getStatus() {
        try {
            await fs.access(this.whitelistPath);
            
            const data = await fs.readFile(this.whitelistPath, 'utf8');
            const whitelist = JSON.parse(data);
            
            return {
                exists: true,
                valid: true,
                addressCount: whitelist.addresses?.length || 0,
                lastUpdated: whitelist.lastUpdated,
                path: this.whitelistPath
            };
            
        } catch (error) {
            return {
                exists: false,
                valid: false,
                addressCount: 0,
                error: error.message,
                path: this.whitelistPath
            };
        }
    }

    /**
     * Perform health check
     */
    async healthCheck() {
        const health = {
            healthy: false,
            issues: [],
            warnings: []
        };

        try {
            // Check file exists
            await fs.access(this.whitelistPath);
            
            // Check file is readable
            const data = await fs.readFile(this.whitelistPath, 'utf8');
            const whitelist = JSON.parse(data);
            
            // Check structure
            if (!whitelist.addresses || !Array.isArray(whitelist.addresses)) {
                health.issues.push('Invalid whitelist structure');
            }
            
            // Check addresses
            let invalidCount = 0;
            for (const address of whitelist.addresses || []) {
                if (!ethers.isAddress(address)) {
                    invalidCount++;
                }
            }
            
            if (invalidCount > 0) {
                health.warnings.push(`${invalidCount} invalid addresses found`);
            }
            
            // Check if empty
            if (whitelist.addresses?.length === 0) {
                health.warnings.push('Whitelist is empty');
            }
            
            health.healthy = health.issues.length === 0;
            
        } catch (error) {
            health.issues.push(`Health check failed: ${error.message}`);
        }

        return health;
    }
}

module.exports = WhitelistInitializer;