const { ethers } = require('ethers');
const { NETWORKS } = require('../config');
const crypto = require('crypto');

/**
 * WalletManager class for managing user wallets
 * Enhanced with better security features for private key storage
 * and support for multiple wallets per user
 */
class WalletManager {
    constructor() {
        // Map of userId -> Array of wallet IDs to support multiple wallets
        this.userWalletIds = new Map();
        
        // Maps for wallet data - using wallet IDs for reference
        this.wallets = new Map(); // walletId -> { encryptedPrivateKey, address, name }
        this.walletOwners = new Map(); // walletAddress -> userId
        
        // Encryption key (in production, this should come from a secure environment variable)
        this.encryptionKey = process.env.ENCRYPTION_KEY || 'changeMeInProduction!';
    }

    /**
     * Encrypt a private key for secure storage
     * @private
     * @param {string} privateKey - Private key to encrypt
     * @returns {string} - Encrypted private key
     */
    _encryptPrivateKey(privateKey) {
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-cbc', 
            crypto.createHash('sha256').update(this.encryptionKey).digest(), 
            iv);
        
        let encrypted = cipher.update(privateKey, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        return `${iv.toString('hex')}:${encrypted}`;
    }

    /**
     * Decrypt a private key
     * @private
     * @param {string} encryptedData - Encrypted private key
     * @returns {string} - Decrypted private key
     */
    _decryptPrivateKey(encryptedData) {
        const [ivHex, encryptedHex] = encryptedData.split(':');
        const iv = Buffer.from(ivHex, 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', 
            crypto.createHash('sha256').update(this.encryptionKey).digest(), 
            iv);
        
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    }

    /**
     * Generate a new wallet for a user
     * @param {string} userId - Telegram user ID
     * @param {string} walletName - Optional name for the wallet
     * @returns {object} - Wallet details
     */
    generateWallet(userId, walletName = 'Default Wallet') {
        // Generate new wallet
        const wallet = ethers.Wallet.createRandom();
        const walletId = crypto.randomUUID();
        
        const walletDetails = {
            walletId,
            address: wallet.address,
            name: walletName,
            mnemonic: wallet.mnemonic ? wallet.mnemonic.phrase : null
        };

        // Store wallet with encrypted private key
        this.wallets.set(walletId, {
            encryptedPrivateKey: this._encryptPrivateKey(wallet.privateKey),
            address: wallet.address,
            name: walletName
        });
        
        // Add to user's wallets
        if (!this.userWalletIds.has(userId)) {
            this.userWalletIds.set(userId, [walletId]);
        } else {
            this.userWalletIds.get(userId).push(walletId);
        }
        
        this.walletOwners.set(wallet.address.toLowerCase(), userId);

        return walletDetails;
    }

    /**
     * Import a wallet for a user using private key
     * @param {string} userId - Telegram user ID
     * @param {string} privateKey - Wallet private key
     * @param {string} walletName - Optional name for the wallet
     * @returns {object} - Wallet details
     */
    importWallet(userId, privateKey, walletName = 'Imported Wallet') {
        try {
            // Validate private key
            const wallet = new ethers.Wallet(privateKey);
            const walletId = crypto.randomUUID();
            
            // Store wallet with encrypted private key
            this.wallets.set(walletId, {
                encryptedPrivateKey: this._encryptPrivateKey(privateKey),
                address: wallet.address,
                name: walletName
            });
            
            // Add to user's wallets
            if (!this.userWalletIds.has(userId)) {
                this.userWalletIds.set(userId, [walletId]);
            } else {
                this.userWalletIds.get(userId).push(walletId);
            }
            
            this.walletOwners.set(wallet.address.toLowerCase(), userId);

            return {
                walletId,
                address: wallet.address,
                name: walletName,
                mnemonic: null // Not available when importing by private key
            };
        } catch (error) {
            throw new Error(`Invalid private key: ${error.message}`);
        }
    }

    /**
     * Get wallet details for a user
     * @param {string} userId - Telegram user ID
     * @param {string} walletId - Optional wallet ID (if not provided, returns first wallet)
     * @returns {object} - Wallet details with decrypted private key
     */
    getWalletDetails(userId, walletId = null) {
        const userWalletIds = this.userWalletIds.get(userId);
        
        if (!userWalletIds || userWalletIds.length === 0) {
            throw new Error('No wallet found for this user. Please generate or import a wallet first.');
        }
        
        // Use specified walletId or default to first wallet
        const targetWalletId = walletId || userWalletIds[0];
        
        const wallet = this.wallets.get(targetWalletId);
        if (!wallet) {
            throw new Error('Wallet not found.');
        }
        
        // Return wallet with decrypted private key
        return {
            walletId: targetWalletId,
            address: wallet.address,
            privateKey: this._decryptPrivateKey(wallet.encryptedPrivateKey),
            name: wallet.name
        };
    }

    /**
     * Check if a user has at least one wallet
     * @param {string} userId - Telegram user ID
     * @returns {boolean} - True if user has a wallet
     */
    hasWallet(userId) {
        const walletIds = this.userWalletIds.get(userId);
        return !!walletIds && walletIds.length > 0;
    }

    /**
     * Get all wallets for a user
     * @param {string} userId - Telegram user ID
     * @returns {Array} - Array of wallet objects with addresses and names
     */
    getUserWallets(userId) {
        const walletIds = this.userWalletIds.get(userId);
        
        if (!walletIds || walletIds.length === 0) {
            return [];
        }
        
        return walletIds.map(id => {
            const wallet = this.wallets.get(id);
            return {
                walletId: id,
                address: wallet.address,
                name: wallet.name
            };
        });
    }

    /**
     * Get user ID for a wallet address
     * @param {string} address - Wallet address
     * @returns {string} - User ID
     */
    getWalletOwner(address) {
        return this.walletOwners.get(address.toLowerCase());
    }

    /**
     * Delete a specific wallet
     * @param {string} userId - Telegram user ID
     * @param {string} walletId - Wallet ID to delete
     * @returns {boolean} - True if successful
     */
    deleteWallet(userId, walletId) {
        const userWalletIds = this.userWalletIds.get(userId);
        
        if (!userWalletIds || !userWalletIds.includes(walletId)) {
            return false;
        }
        
        const wallet = this.wallets.get(walletId);
        if (!wallet) {
            return false;
        }
        
        // Remove wallet from user's wallet list
        this.userWalletIds.set(
            userId, 
            userWalletIds.filter(id => id !== walletId)
        );
        
        // Delete wallet data
        this.wallets.delete(walletId);
        this.walletOwners.delete(wallet.address.toLowerCase());
        
        return true;
    }

    /**
     * Get block explorer URL for a wallet address
     * @param {string} address - Wallet address
     * @param {string} network - Network key (defaults to MONAD)
     * @returns {string} - Block explorer URL
     */
    getAddressExplorerUrl(address, network = 'MONAD') {
        return `${NETWORKS[network].blockExplorerUrl}/address/${address}`;
    }
}

module.exports = WalletManager; 