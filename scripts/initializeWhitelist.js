#!/usr/bin/env node

/**
 * Whitelist Initialization Script
 * 
 * This script ensures the data directory exists and initializes the whitelist.json
 * file with default addresses if it doesn't exist.
 */

const fs = require('fs').promises;
const path = require('path');

// Configuration
const DATA_DIR = path.join(__dirname, '..', 'data');
const WHITELIST_FILE = path.join(DATA_DIR, 'whitelist.json');

// Default addresses as specified in requirements
const DEFAULT_ADDRESSES = [
    '0xe2F92e8f706997B021919a092437372B268a432d',
    '0x5230b89d6728a10b34b8EC1C740a7A7a1C4afe94'
];

/**
 * Create the default whitelist structure
 */
function createDefaultWhitelist() {
    return {
        version: '1.0',
        lastUpdated: new Date().toISOString(),
        addresses: DEFAULT_ADDRESSES.map(addr => addr.toLowerCase()),
        metadata: {
            totalAddresses: DEFAULT_ADDRESSES.length,
            createdAt: new Date().toISOString(),
            lastUpdated: new Date().toISOString(),
            initializedBy: 'initialization-script'
        }
    };
}

/**
 * Ensure data directory exists with proper permissions
 */
async function ensureDataDirectory() {
    try {
        console.log('📁 Checking data directory...');
        
        // Check if directory exists
        try {
            const stats = await fs.stat(DATA_DIR);
            if (!stats.isDirectory()) {
                throw new Error(`${DATA_DIR} exists but is not a directory`);
            }
            console.log('✅ Data directory exists');
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('📁 Creating data directory...');
                await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o755 });
                console.log('✅ Data directory created');
            } else {
                throw error;
            }
        }
        
        // Verify write permissions
        try {
            await fs.access(DATA_DIR, fs.constants.W_OK);
            console.log('✅ Data directory is writable');
        } catch (error) {
            throw new Error(`Data directory is not writable: ${error.message}`);
        }
        
        return true;
        
    } catch (error) {
        console.error('❌ Error ensuring data directory:', error.message);
        throw error;
    }
}

/**
 * Initialize whitelist file with default addresses
 */
async function initializeWhitelistFile() {
    try {
        console.log('📋 Checking whitelist file...');
        
        // Check if whitelist file already exists
        try {
            await fs.access(WHITELIST_FILE);
            console.log('ℹ️ Whitelist file already exists');
            
            // Validate existing file
            const existingData = await fs.readFile(WHITELIST_FILE, 'utf8');
            const parsed = JSON.parse(existingData);
            
            if (!parsed.addresses || !Array.isArray(parsed.addresses)) {
                throw new Error('Invalid whitelist file structure');
            }
            
            console.log(`✅ Existing whitelist file is valid (${parsed.addresses.length} addresses)`);
            return false; // File already exists and is valid
            
        } catch (error) {
            if (error.code === 'ENOENT') {
                console.log('📋 Creating default whitelist file...');
                
                const defaultWhitelist = createDefaultWhitelist();
                const jsonData = JSON.stringify(defaultWhitelist, null, 2);
                
                await fs.writeFile(WHITELIST_FILE, jsonData, 'utf8');
                
                console.log('✅ Default whitelist file created');
                console.log(`📋 Initialized with ${DEFAULT_ADDRESSES.length} default addresses:`);
                DEFAULT_ADDRESSES.forEach((addr, index) => {
                    console.log(`   ${index + 1}. ${addr}`);
                });
                
                return true; // File was created
                
            } else if (error.message.includes('Invalid whitelist file structure')) {
                console.log('⚠️ Existing whitelist file is corrupted, recreating...');
                
                // Backup corrupted file
                const backupPath = `${WHITELIST_FILE}.corrupted.${Date.now()}`;
                try {
                    await fs.copyFile(WHITELIST_FILE, backupPath);
                    console.log(`📋 Corrupted file backed up to: ${backupPath}`);
                } catch (backupError) {
                    console.warn('⚠️ Could not backup corrupted file:', backupError.message);
                }
                
                // Create new file
                const defaultWhitelist = createDefaultWhitelist();
                const jsonData = JSON.stringify(defaultWhitelist, null, 2);
                
                await fs.writeFile(WHITELIST_FILE, jsonData, 'utf8');
                console.log('✅ Whitelist file recreated with defaults');
                
                return true; // File was recreated
                
            } else {
                throw error;
            }
        }
        
    } catch (error) {
        console.error('❌ Error initializing whitelist file:', error.message);
        throw error;
    }
}

/**
 * Verify whitelist file integrity
 */
async function verifyWhitelistIntegrity() {
    try {
        console.log('🔍 Verifying whitelist integrity...');
        
        const data = await fs.readFile(WHITELIST_FILE, 'utf8');
        const whitelist = JSON.parse(data);
        
        // Check required fields
        const requiredFields = ['version', 'addresses', 'metadata'];
        for (const field of requiredFields) {
            if (!whitelist[field]) {
                throw new Error(`Missing required field: ${field}`);
            }
        }
        
        // Validate addresses
        if (!Array.isArray(whitelist.addresses)) {
            throw new Error('Addresses field must be an array');
        }
        
        // Check address format
        const { ethers } = require('ethers');
        let validAddresses = 0;
        let invalidAddresses = 0;
        
        for (const address of whitelist.addresses) {
            if (ethers.isAddress(address)) {
                validAddresses++;
            } else {
                invalidAddresses++;
                console.warn(`⚠️ Invalid address found: ${address}`);
            }
        }
        
        console.log(`✅ Whitelist integrity check complete:`);
        console.log(`   📋 Total addresses: ${whitelist.addresses.length}`);
        console.log(`   ✅ Valid addresses: ${validAddresses}`);
        if (invalidAddresses > 0) {
            console.log(`   ❌ Invalid addresses: ${invalidAddresses}`);
        }
        console.log(`   📅 Last updated: ${whitelist.lastUpdated}`);
        
        return {
            isValid: invalidAddresses === 0,
            totalAddresses: whitelist.addresses.length,
            validAddresses,
            invalidAddresses
        };
        
    } catch (error) {
        console.error('❌ Error verifying whitelist integrity:', error.message);
        throw error;
    }
}

/**
 * Set proper file permissions for security
 */
async function setFilePermissions() {
    try {
        console.log('🔒 Setting file permissions...');
        
        // Set restrictive permissions on whitelist file (owner read/write only)
        await fs.chmod(WHITELIST_FILE, 0o600);
        
        // Set directory permissions (owner read/write/execute, group and others read/execute)
        await fs.chmod(DATA_DIR, 0o755);
        
        console.log('✅ File permissions set');
        
    } catch (error) {
        console.warn('⚠️ Could not set file permissions:', error.message);
        // Don't throw - this is not critical on all systems
    }
}

/**
 * Main initialization function
 */
async function main() {
    console.log('🚀 Starting whitelist initialization...\n');
    
    try {
        // Step 1: Ensure data directory exists
        await ensureDataDirectory();
        console.log('');
        
        // Step 2: Initialize whitelist file
        const fileCreated = await initializeWhitelistFile();
        console.log('');
        
        // Step 3: Verify integrity
        const integrity = await verifyWhitelistIntegrity();
        console.log('');
        
        // Step 4: Set permissions
        await setFilePermissions();
        console.log('');
        
        // Summary
        console.log('🎉 Whitelist initialization complete!');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`📁 Data directory: ${DATA_DIR}`);
        console.log(`📋 Whitelist file: ${WHITELIST_FILE}`);
        console.log(`📊 Total addresses: ${integrity.totalAddresses}`);
        console.log(`✅ Valid addresses: ${integrity.validAddresses}`);
        
        if (fileCreated) {
            console.log('🆕 New whitelist file created with default addresses');
        } else {
            console.log('♻️ Existing whitelist file validated');
        }
        
        if (!integrity.isValid) {
            console.log('⚠️ Warning: Some addresses in the whitelist are invalid');
            process.exit(1);
        }
        
        console.log('\n✅ System ready for whitelist operations');
        
    } catch (error) {
        console.error('\n❌ Initialization failed:', error.message);
        console.error('\nPlease check the error above and try again.');
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    main().catch(error => {
        console.error('Fatal error:', error);
        process.exit(1);
    });
}

module.exports = {
    ensureDataDirectory,
    initializeWhitelistFile,
    verifyWhitelistIntegrity,
    setFilePermissions,
    createDefaultWhitelist,
    DATA_DIR,
    WHITELIST_FILE,
    DEFAULT_ADDRESSES
};