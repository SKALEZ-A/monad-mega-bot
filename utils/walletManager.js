const { ethers } = require('ethers');
const { NETWORKS } = require('../config');
const crypto = require('crypto');

/**
 * WalletManager class that stores encrypted private keys in database
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
     * Store complete wallet data (including encrypted private key) in database
     * @private
     */
    async _storeWalletInDatabase(userId, walletData) {
        try {
            const { updateUser, getUser } = require('./user');

            console.log(`📝 Storing encrypted wallet data for user ${userId}`);

            // Ensure user exists
            await getUser(userId);

            // Prepare wallet data for database storage
            const dbWalletData = {
                walletId: walletData.walletId,
                encryptedPrivateKey: walletData.encryptedPrivateKey, // 🔐 ENCRYPTED PRIVATE KEY
                address: walletData.address,
                name: walletData.name,
                createdAt: new Date().toISOString()
            };

            // Store both wallet address AND encrypted private key in database
            await updateUser(userId, {
                wallet_address: walletData.address,
                wallet_data: JSON.stringify(dbWalletData), // Contains encrypted private key
                encrypted_private_key: walletData.encryptedPrivateKey // Also store separately for easy access
            });

            console.log(`✅ Encrypted wallet data stored in database for user ${userId}`);
            console.log(`   - Address: ${walletData.address}`);
            console.log(`   - Encrypted Private Key: ${walletData.encryptedPrivateKey.substring(0, 20)}...`);

            return true;
        } catch (error) {
            console.error(`❌ Failed to store wallet data in database:`, error.message);
            return false;
        }
    }

    /**
     * Load wallet data (including encrypted private key) from database
     * @private
     */
    async _loadWalletFromDatabase(userId) {
        try {
            const { getUser } = require('./user');
            console.log(`🔍 Loading wallet from database for user ${userId}`);

            const user = await getUser(userId);

            if (user && user.wallet_data) {
                const walletData = JSON.parse(user.wallet_data);

                console.log(`📥 Found encrypted wallet data in database for user ${userId}`);
                console.log(`   - Address: ${walletData.address}`);
                console.log(`   - Has Encrypted Private Key: ${!!walletData.encryptedPrivateKey}`);

                // Restore wallet to memory with encrypted private key
                this.wallets.set(walletData.walletId, {
                    encryptedPrivateKey: walletData.encryptedPrivateKey, // 🔐 LOADED FROM DB
                    address: walletData.address,
                    name: walletData.name
                });

                this.userWalletIds.set(userId, [walletData.walletId]);
                this.walletOwners.set(walletData.address.toLowerCase(), userId);

                console.log(`✅ Wallet with encrypted private key loaded from database for user ${userId}`);
                return true;
            }

            // Fallback: try to load from old format (only address)
            if (user && user.wallet_address && user.encrypted_private_key) {
                console.log(`📥 Found wallet in old format, migrating for user ${userId}`);

                const walletId = crypto.randomUUID();
                const walletData = {
                    walletId,
                    encryptedPrivateKey: user.encrypted_private_key,
                    address: user.wallet_address,
                    name: 'Migrated Wallet'
                };

                // Store in new format
                await this._storeWalletInDatabase(userId, walletData);

                // Load into memory
                this.wallets.set(walletId, {
                    encryptedPrivateKey: user.encrypted_private_key,
                    address: user.wallet_address,
                    name: 'Migrated Wallet'
                });

                this.userWalletIds.set(userId, [walletId]);
                this.walletOwners.set(user.wallet_address.toLowerCase(), userId);

                return true;
            }

            console.log(`❌ No wallet data found in database for user ${userId}`);
            return false;
        } catch (error) {
            console.error(`❌ Failed to load wallet from database for user ${userId}:`, error.message);
            return false;
        }
    }

    /**
     * Check if user has wallet (loads from database if needed)
     */
    async hasWallet(userId) {
        // Check memory first
        const walletIds = this.userWalletIds.get(userId);
        if (walletIds && walletIds.length > 0) {
            return true;
        }

        // Try loading from database (including encrypted private key)
        const loaded = await this._loadWalletFromDatabase(userId);
        return loaded;
    }

    /**
     * Generate a new wallet for a user
     */
    async generateWallet(userId, walletName = 'Default Wallet') {
        try {
            console.log(`🔧 Generating new wallet with encrypted private key for user ${userId}`);

            // Generate new wallet
            const wallet = ethers.Wallet.createRandom();
            const walletId = crypto.randomUUID();

            // Encrypt the private key
            const encryptedPrivateKey = this._encryptPrivateKey(wallet.privateKey);
            console.log(`🔐 Private key encrypted for user ${userId}`);

            const walletDetails = {
                walletId,
                address: wallet.address,
                name: walletName,
                mnemonic: wallet.mnemonic ? wallet.mnemonic.phrase : null,
                privateKey: wallet.privateKey // Return unencrypted for user to save
            };

            // Store wallet in memory
            this.wallets.set(walletId, {
                encryptedPrivateKey,
                address: wallet.address,
                name: walletName
            });

            this.userWalletIds.set(userId, [walletId]);
            this.walletOwners.set(wallet.address.toLowerCase(), userId);

            // Store in database WITH encrypted private key
            await this._storeWalletInDatabase(userId, {
                walletId,
                encryptedPrivateKey, // 🔐 ENCRYPTED PRIVATE KEY STORED IN DB
                address: wallet.address,
                name: walletName
            });

            console.log(`✅ Wallet generated and encrypted private key stored in database for user ${userId}`);
            return walletDetails;

        } catch (error) {
            console.error('❌ Error generating wallet:', error);
            throw new Error(`Failed to generate wallet: ${error.message}`);
        }
    }

    /**
     * Import a wallet for a user using private key
     */
    async importWallet(userId, privateKey, walletName = 'Imported Wallet') {
        try {
            console.log(`🔧 Importing wallet with encrypted private key for user ${userId}`);

            // Validate private key
            const wallet = new ethers.Wallet(privateKey);
            const walletId = crypto.randomUUID();

            // Encrypt the private key
            const encryptedPrivateKey = this._encryptPrivateKey(privateKey);
            console.log(`🔐 Private key encrypted for user ${userId}`);

            // Store wallet in memory
            this.wallets.set(walletId, {
                encryptedPrivateKey,
                address: wallet.address,
                name: walletName
            });

            this.userWalletIds.set(userId, [walletId]);
            this.walletOwners.set(wallet.address.toLowerCase(), userId);

            // Store in database WITH encrypted private key
            await this._storeWalletInDatabase(userId, {
                walletId,
                encryptedPrivateKey, // 🔐 ENCRYPTED PRIVATE KEY STORED IN DB
                address: wallet.address,
                name: walletName
            });

            console.log(`✅ Wallet imported and encrypted private key stored in database for user ${userId}`);
            return {
                walletId,
                address: wallet.address,
                name: walletName,
                mnemonic: null
            };
        } catch (error) {
            console.error('❌ Error importing wallet:', error);
            throw new Error(`Invalid private key: ${error.message}`);
        }
    }

    /**
     * Get wallet details for a user (decrypts private key from database)
     */
    async getWalletDetails(userId, walletId = null) {
        // Try to load from database if not in memory
        if (!this.userWalletIds.has(userId)) {
            await this._loadWalletFromDatabase(userId);
        }

        const userWalletIds = this.userWalletIds.get(userId);

        if (!userWalletIds || userWalletIds.length === 0) {
            throw new Error('No wallet found for this user. Please generate or import a wallet first.');
        }

        const targetWalletId = walletId || userWalletIds[0];
        const wallet = this.wallets.get(targetWalletId);

        if (!wallet) {
            throw new Error('Wallet not found.');
        }

        // Decrypt private key from database storage
        const decryptedPrivateKey = this._decryptPrivateKey(wallet.encryptedPrivateKey);
        console.log(`🔓 Private key decrypted for user ${userId}`);

        return {
            walletId: targetWalletId,
            address: wallet.address,
            privateKey: decryptedPrivateKey, // 🔓 DECRYPTED FROM DATABASE
            name: wallet.name
        };
    }

    /**
     * Get all wallets for a user
     */
    async getUserWallets(userId) {
        // Try to load from database if not in memory
        if (!this.userWalletIds.has(userId)) {
            await this._loadWalletFromDatabase(userId);
        }

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
                // Note: privateKey not included here for security
            };
        });
    }

    /**
     * Get user ID for a wallet address
     */
    getWalletOwner(address) {
        return this.walletOwners.get(address.toLowerCase());
    }

    /**
     * Delete a specific wallet (removes encrypted private key from database)
     */
    async deleteWallet(userId, walletId) {
        try {
            const userWalletIds = this.userWalletIds.get(userId);

            if (!userWalletIds || !userWalletIds.includes(walletId)) {
                return false;
            }

            const wallet = this.wallets.get(walletId);
            if (!wallet) {
                return false;
            }

            // Remove from memory
            this.userWalletIds.delete(userId);
            this.wallets.delete(walletId);
            this.walletOwners.delete(wallet.address.toLowerCase());

            // Remove from database (including encrypted private key)
            try {
                const { updateUser } = require('./user');
                await updateUser(userId, {
                    wallet_address: null,
                    wallet_data: null,
                    encrypted_private_key: null
                });
                console.log(`🗑️ Encrypted private key removed from database for user ${userId}`);
            } catch (dbError) {
                console.warn('⚠️ Wallet deleted from memory, but database update failed');
            }

            console.log(`✅ Wallet and encrypted private key deleted for user ${userId}`);
            return true;
        } catch (error) {
            console.error('❌ Error deleting wallet:', error);
            throw new Error(`Failed to delete wallet: ${error.message}`);
        }
    }

    /**
     * Get block explorer URL for a wallet address
     */
    getAddressExplorerUrl(address, network = 'MONAD') {
        return `${NETWORKS[network].blockExplorerUrl}/address/${address}`;
    }
}

module.exports = WalletManager;