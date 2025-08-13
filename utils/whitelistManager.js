const fs = require('fs').promises;
const path = require('path');
const { ethers } = require('ethers');
const WhitelistErrorHandler = require('./whitelistErrorHandler');

/**
 * WhitelistManager - Manages address whitelisting for bot access control
 */
class WhitelistManager {
    constructor(storageFilePath = './data/whitelist.json') {
        this.storageFilePath = storageFilePath;
        this.whitelist = new Set();
        this.metadata = {
            version: '1.0',
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            totalAddresses: 0
        };
        
        // Default addresses as specified in requirements
        this.defaultAddresses = [
            '0xe2F92e8f706997B021919a092437372B268a432d',
            '0x5230b89d6728a10b34b8EC1C740a7A7a1C4afe94'
        ];
        
        this.maxAddresses = 1000; // Prevent memory issues
        this.initialized = false;
        this.errorHandler = new WhitelistErrorHandler();
        
        // Backup settings
        this.backupEnabled = true;
        this.maxBackups = 5;
        
        // Health check settings
        this.lastHealthCheck = null;
        this.healthCheckInterval = 5 * 60 * 1000; // 5 minutes
    }

    /**
     * Initialize the whitelist manager by loading existing data or creating default
     */
    async initialize() {
        try {
            await this.loadWhitelist();
            this.initialized = true;
            console.log(`WhitelistManager initialized with ${this.whitelist.size} addresses`);
        } catch (error) {
            console.error('Error initializing WhitelistManager:', error);
            await this.initializeWithDefaults();
        }
    }

    /**
     * Initialize with default addresses when storage fails
     */
    async initializeWithDefaults() {
        try {
            console.log('Initializing whitelist with default addresses...');
            this.whitelist.clear();
            
            // Add default addresses
            for (const address of this.defaultAddresses) {
                const normalizedAddress = this.normalizeAddress(address);
                if (this.validateAddress(normalizedAddress)) {
                    this.whitelist.add(normalizedAddress);
                }
            }
            
            this.metadata.totalAddresses = this.whitelist.size;
            this.metadata.lastUpdated = new Date().toISOString();
            
            // Try to save the default whitelist
            await this.saveWhitelist();
            this.initialized = true;
            
            console.log(`Initialized with ${this.whitelist.size} default addresses`);
        } catch (error) {
            console.error('Failed to initialize with defaults:', error);
            // Continue with in-memory whitelist even if save fails
            this.initialized = true;
        }
    }

    /**
     * Load whitelist from storage file
     */
    async loadWhitelist() {
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(this.storageFilePath);
            await fs.mkdir(dataDir, { recursive: true });
            
            // Check if file exists
            try {
                await fs.access(this.storageFilePath);
            } catch (error) {
                // File doesn't exist, initialize with defaults
                console.log('Whitelist file not found, creating with defaults...');
                await this.initializeWithDefaults();
                return;
            }
            
            // Read and parse the file
            const data = await fs.readFile(this.storageFilePath, 'utf8');
            const whitelistData = JSON.parse(data);
            
            // Validate data structure
            if (!whitelistData.addresses || !Array.isArray(whitelistData.addresses)) {
                throw new Error('Invalid whitelist data structure');
            }
            
            // Load addresses into Set with validation
            this.whitelist.clear();
            for (const address of whitelistData.addresses) {
                const normalizedAddress = this.normalizeAddress(address);
                if (this.validateAddress(normalizedAddress)) {
                    this.whitelist.add(normalizedAddress);
                } else {
                    console.warn(`Skipping invalid address in whitelist: ${address}`);
                }
            }
            
            // Load metadata
            this.metadata = {
                ...this.metadata,
                ...whitelistData.metadata,
                totalAddresses: this.whitelist.size,
                lastUpdated: new Date().toISOString()
            };
            
            console.log(`Loaded ${this.whitelist.size} addresses from whitelist`);
            
        } catch (error) {
            console.error('Error loading whitelist:', error);
            throw error;
        }
    }

    /**
     * Save whitelist to storage file
     */
    async saveWhitelist() {
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(this.storageFilePath);
            await fs.mkdir(dataDir, { recursive: true });
            
            // Prepare data structure
            const whitelistData = {
                version: this.metadata.version,
                lastUpdated: new Date().toISOString(),
                addresses: Array.from(this.whitelist).sort(),
                metadata: {
                    ...this.metadata,
                    totalAddresses: this.whitelist.size,
                    lastUpdated: new Date().toISOString()
                }
            };
            
            // Write to file with proper formatting
            const jsonData = JSON.stringify(whitelistData, null, 2);
            await fs.writeFile(this.storageFilePath, jsonData, 'utf8');
            
            // Update metadata
            this.metadata.lastUpdated = whitelistData.lastUpdated;
            this.metadata.totalAddresses = this.whitelist.size;
            
            console.log(`Saved whitelist with ${this.whitelist.size} addresses`);
            
        } catch (error) {
            console.error('Error saving whitelist:', error);
            throw error;
        }
    }

    /**
     * Check if an address is whitelisted
     * @param {string} address - Ethereum address to check
     * @returns {boolean} - True if address is whitelisted
     */
    isAddressWhitelisted(address) {
        if (!this.initialized) {
            console.warn('WhitelistManager not initialized, denying access');
            return false;
        }
        
        if (!address) {
            return false;
        }
        
        const normalizedAddress = this.normalizeAddress(address);
        if (!this.validateAddress(normalizedAddress)) {
            return false;
        }
        
        return this.whitelist.has(normalizedAddress);
    }

    /**
     * Add an address to the whitelist
     * @param {string} address - Ethereum address to add
     * @returns {object} - Result object with success status and details
     */
    async addAddress(address) {
        return await this.errorHandler.handleConcurrentAccess(async () => {
            return await this.errorHandler.handleWithRetry(async () => {
                // Input validation and sanitization
                const sanitized = this.errorHandler.sanitizeInput(address, 'address');
                if (!sanitized.isValid) {
                    throw new Error(`Invalid input: ${sanitized.errors.join(', ')}`);
                }
                
                const normalizedAddress = this.normalizeAddress(sanitized.sanitized);
                if (!this.validateAddress(normalizedAddress)) {
                    throw new Error('Invalid address format');
                }
                
                if (this.whitelist.has(normalizedAddress)) {
                    return { 
                        success: false, 
                        error: 'Address already exists',
                        totalAddresses: this.whitelist.size
                    };
                }
                
                if (this.whitelist.size >= this.maxAddresses) {
                    throw new Error(`Maximum whitelist size (${this.maxAddresses}) reached`);
                }
                
                // Create backup before modification
                if (this.backupEnabled) {
                    await this.createBackup();
                }
                
                this.whitelist.add(normalizedAddress);
                await this.saveWhitelist();
                
                console.log(`Added address to whitelist: ${normalizedAddress}`);
                return { 
                    success: true, 
                    totalAddresses: this.whitelist.size 
                };
                
            }, 'addAddress');
        }, `whitelist_add_${address}`);
    }

    /**
     * Remove an address from the whitelist
     * @param {string} address - Ethereum address to remove
     * @returns {object} - Result object with success status and details
     */
    async removeAddress(address) {
        return await this.errorHandler.handleConcurrentAccess(async () => {
            return await this.errorHandler.handleWithRetry(async () => {
                // Input validation and sanitization
                const sanitized = this.errorHandler.sanitizeInput(address, 'address');
                if (!sanitized.isValid) {
                    throw new Error(`Invalid input: ${sanitized.errors.join(', ')}`);
                }
                
                const normalizedAddress = this.normalizeAddress(sanitized.sanitized);
                if (!this.validateAddress(normalizedAddress)) {
                    throw new Error('Invalid address format');
                }
                
                if (!this.whitelist.has(normalizedAddress)) {
                    return { 
                        success: false, 
                        error: 'Address not found',
                        totalAddresses: this.whitelist.size
                    };
                }
                
                // Create backup before modification
                if (this.backupEnabled) {
                    await this.createBackup();
                }
                
                this.whitelist.delete(normalizedAddress);
                await this.saveWhitelist();
                
                console.log(`Removed address from whitelist: ${normalizedAddress}`);
                return { 
                    success: true, 
                    totalAddresses: this.whitelist.size 
                };
                
            }, 'removeAddress');
        }, `whitelist_remove_${address}`);
    }

    /**
     * Get all whitelisted addresses
     * @returns {Array<string>} - Array of whitelisted addresses
     */
    getWhitelistedAddresses() {
        return Array.from(this.whitelist).sort();
    }

    /**
     * Get whitelist statistics
     * @returns {object} - Whitelist statistics and metadata
     */
    getWhitelistStats() {
        return {
            totalAddresses: this.whitelist.size,
            maxAddresses: this.maxAddresses,
            initialized: this.initialized,
            storageFilePath: this.storageFilePath,
            metadata: { ...this.metadata }
        };
    }

    /**
     * Validate Ethereum address format
     * @param {string} address - Address to validate
     * @returns {boolean} - True if address is valid
     */
    validateAddress(address) {
        try {
            if (!address || typeof address !== 'string') {
                return false;
            }
            
            // Use ethers.js for proper address validation
            return ethers.isAddress(address);
            
        } catch (error) {
            return false;
        }
    }

    /**
     * Normalize address to lowercase for consistent comparison
     * @param {string} address - Address to normalize
     * @returns {string} - Normalized address
     */
    normalizeAddress(address) {
        if (!address || typeof address !== 'string') {
            return '';
        }
        
        return address.toLowerCase().trim();
    }

    /**
     * Clear all addresses from whitelist (admin function)
     */
    async clearWhitelist() {
        try {
            this.whitelist.clear();
            await this.saveWhitelist();
            console.log('Whitelist cleared');
        } catch (error) {
            console.error('Error clearing whitelist:', error);
            throw error;
        }
    }

    /**
     * Reset whitelist to default addresses
     */
    async resetToDefaults() {
        return await this.errorHandler.handleWithRetry(async () => {
            // Create backup before reset
            if (this.backupEnabled) {
                await this.createBackup();
            }
            
            this.whitelist.clear();
            
            // Add default addresses
            for (const address of this.defaultAddresses) {
                const normalizedAddress = this.normalizeAddress(address);
                if (this.validateAddress(normalizedAddress)) {
                    this.whitelist.add(normalizedAddress);
                }
            }
            
            await this.saveWhitelist();
            console.log(`Reset whitelist to ${this.whitelist.size} default addresses`);
            
        }, 'resetToDefaults');
    }

    /**
     * Create a backup of the current whitelist
     */
    async createBackup() {
        try {
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const backupPath = `${this.storageFilePath}.backup.${timestamp}`;
            
            // Copy current file to backup
            try {
                await fs.copyFile(this.storageFilePath, backupPath);
                console.log(`Created whitelist backup: ${backupPath}`);
                
                // Clean old backups
                await this.cleanOldBackups();
                
            } catch (error) {
                if (error.code !== 'ENOENT') {
                    throw error;
                }
                // Original file doesn't exist, no backup needed
            }
            
        } catch (error) {
            console.error('Error creating backup:', error);
            // Don't throw - backup failure shouldn't stop the operation
        }
    }

    /**
     * Clean old backup files
     */
    async cleanOldBackups() {
        try {
            const directory = path.dirname(this.storageFilePath);
            const filename = path.basename(this.storageFilePath);
            
            const files = await fs.readdir(directory);
            const backupFiles = files
                .filter(file => file.startsWith(`${filename}.backup.`))
                .map(file => ({
                    name: file,
                    path: path.join(directory, file),
                    stat: null
                }));
            
            // Get file stats
            for (const file of backupFiles) {
                try {
                    file.stat = await fs.stat(file.path);
                } catch (error) {
                    console.warn(`Could not stat backup file ${file.name}:`, error);
                }
            }
            
            // Sort by creation time (newest first)
            const validBackups = backupFiles
                .filter(file => file.stat)
                .sort((a, b) => b.stat.mtime - a.stat.mtime);
            
            // Remove old backups
            if (validBackups.length > this.maxBackups) {
                const toDelete = validBackups.slice(this.maxBackups);
                
                for (const file of toDelete) {
                    try {
                        await fs.unlink(file.path);
                        console.log(`Deleted old backup: ${file.name}`);
                    } catch (error) {
                        console.warn(`Could not delete backup ${file.name}:`, error);
                    }
                }
            }
            
        } catch (error) {
            console.error('Error cleaning old backups:', error);
        }
    }

    /**
     * Restore from the most recent backup
     */
    async restoreFromBackup() {
        try {
            const directory = path.dirname(this.storageFilePath);
            const filename = path.basename(this.storageFilePath);
            
            const files = await fs.readdir(directory);
            const backupFiles = files
                .filter(file => file.startsWith(`${filename}.backup.`))
                .map(file => ({
                    name: file,
                    path: path.join(directory, file)
                }));
            
            if (backupFiles.length === 0) {
                throw new Error('No backup files found');
            }
            
            // Get the most recent backup
            let mostRecent = null;
            let mostRecentTime = 0;
            
            for (const file of backupFiles) {
                try {
                    const stat = await fs.stat(file.path);
                    if (stat.mtime > mostRecentTime) {
                        mostRecentTime = stat.mtime;
                        mostRecent = file;
                    }
                } catch (error) {
                    console.warn(`Could not stat backup file ${file.name}:`, error);
                }
            }
            
            if (!mostRecent) {
                throw new Error('No valid backup files found');
            }
            
            // Restore from backup
            await fs.copyFile(mostRecent.path, this.storageFilePath);
            console.log(`Restored whitelist from backup: ${mostRecent.name}`);
            
            // Reload the whitelist
            await this.loadWhitelist();
            
            return true;
            
        } catch (error) {
            console.error('Error restoring from backup:', error);
            throw error;
        }
    }

    /**
     * Perform health check on whitelist system
     */
    async performHealthCheck() {
        const healthReport = {
            timestamp: new Date().toISOString(),
            status: 'healthy',
            issues: [],
            warnings: [],
            stats: {}
        };
        
        try {
            // Check initialization status
            if (!this.initialized) {
                healthReport.issues.push('WhitelistManager not initialized');
                healthReport.status = 'unhealthy';
            }
            
            // Check file system access
            const fsValidation = await this.errorHandler.validateFileSystemAccess(this.storageFilePath);
            if (fsValidation.errors.length > 0) {
                healthReport.issues.push(...fsValidation.errors);
                healthReport.status = 'unhealthy';
            }
            
            // Check whitelist size
            if (this.whitelist.size === 0) {
                healthReport.warnings.push('Whitelist is empty');
            }
            
            if (this.whitelist.size > this.maxAddresses * 0.9) {
                healthReport.warnings.push(`Whitelist is ${Math.round((this.whitelist.size / this.maxAddresses) * 100)}% full`);
            }
            
            // Check for duplicate addresses (shouldn't happen with Set, but good to verify)
            const addressArray = Array.from(this.whitelist);
            const uniqueAddresses = new Set(addressArray);
            if (addressArray.length !== uniqueAddresses.size) {
                healthReport.issues.push('Duplicate addresses detected in whitelist');
                healthReport.status = 'unhealthy';
            }
            
            // Validate all addresses
            let invalidAddresses = 0;
            for (const address of this.whitelist) {
                if (!this.validateAddress(address)) {
                    invalidAddresses++;
                }
            }
            
            if (invalidAddresses > 0) {
                healthReport.issues.push(`${invalidAddresses} invalid addresses found in whitelist`);
                healthReport.status = 'unhealthy';
            }
            
            // Check error statistics
            const errorStats = this.errorHandler.getErrorStats();
            if (errorStats.totalErrors > 0) {
                healthReport.warnings.push(`${errorStats.totalErrors} errors recorded since last reset`);
            }
            
            // Collect statistics
            healthReport.stats = {
                totalAddresses: this.whitelist.size,
                maxAddresses: this.maxAddresses,
                utilizationPercent: Math.round((this.whitelist.size / this.maxAddresses) * 100),
                lastUpdated: this.metadata.lastUpdated,
                errorStats: errorStats,
                fileSystemAccess: fsValidation
            };
            
            // Update health check timestamp
            this.lastHealthCheck = healthReport.timestamp;
            
            // Log health status
            if (healthReport.status === 'healthy') {
                console.log('Whitelist health check: HEALTHY');
            } else {
                console.warn('Whitelist health check: ISSUES DETECTED', {
                    issues: healthReport.issues,
                    warnings: healthReport.warnings
                });
            }
            
            return healthReport;
            
        } catch (error) {
            console.error('Error during health check:', error);
            healthReport.status = 'error';
            healthReport.issues.push(`Health check failed: ${error.message}`);
            return healthReport;
        }
    }

    /**
     * Handle storage corruption by attempting recovery
     */
    async handleStorageCorruption() {
        return await this.errorHandler.handleStorageCorruption(
            this.storageFilePath,
            async () => {
                // Try to restore from backup first
                try {
                    await this.restoreFromBackup();
                    console.log('Recovered from storage corruption using backup');
                    return;
                } catch (backupError) {
                    console.warn('Could not restore from backup:', backupError);
                }
                
                // Fallback to default initialization
                console.log('Initializing with default addresses after corruption');
                await this.initializeWithDefaults();
            }
        );
    }

    /**
     * Get comprehensive system status
     */
    async getSystemStatus() {
        const status = {
            initialized: this.initialized,
            whitelistSize: this.whitelist.size,
            maxSize: this.maxAddresses,
            lastHealthCheck: this.lastHealthCheck,
            errorStats: this.errorHandler.getErrorStats(),
            metadata: { ...this.metadata }
        };
        
        // Perform health check if it's been too long
        if (!this.lastHealthCheck || 
            (Date.now() - new Date(this.lastHealthCheck).getTime()) > this.healthCheckInterval) {
            status.healthReport = await this.performHealthCheck();
        }
        
        return status;
    }
}

module.exports = WhitelistManager;