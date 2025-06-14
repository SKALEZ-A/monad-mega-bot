const { ethers } = require('ethers');
const { NETWORKS, ROUTER_V2_ABI, ERC20_ABI } = require('../config');
const { BOT_CONFIG } = require('../config');

/**
 * MegaETH Integration Utility
 * Provides functions for interacting with the MegaETH testnet and its Uniswap implementation
 */
class MegaethIntegration {
    constructor(privateKey) {
        if (!privateKey) {
            throw new Error('Private key is required for MegaETH integration');
        }

        console.log('\n=== Initializing MegaETH Integration ===');
        this.network = NETWORKS.MEGAETH;

        try {
            // Initialize provider
            this.provider = new ethers.JsonRpcProvider(this.network.rpc);
            // Initialize wallet with provider
            this.wallet = new ethers.Wallet(privateKey, this.provider);
            // Initialize contract instances (placeholders for now)
            this.routerContract = new ethers.Contract(
                this.network.addresses.ROUTER,
                ROUTER_V2_ABI,
                this.wallet
            );
            this.wrappedEthContract = new ethers.Contract(
                this.network.addresses.WETH,
                ERC20_ABI,
                this.wallet
            );
            console.log('MegaETH RPC URL:', this.network.rpc);
            console.log('Chain ID:', this.network.chainId);
            console.log('Wallet Address:', this.wallet.address);
            // Test connection
            this.provider.getBlockNumber()
                .then(blockNumber => {
                    console.log(`Successfully connected to MegaETH network. Current block: ${blockNumber}`);
                })
                .catch(error => {
                    console.warn(`Warning: Could not get block number: ${error.message}`);
                });
        } catch (error) {
            console.error('MegaETH Integration initialization error:', error);
            throw new Error(`MegaETH initialization failed: ${error.message}`);
        }
    }

    // Example: Get the balance of the wallet's native ETH tokens
    async getNativeBalance() {
        try {
            const balance = await this.provider.getBalance(this.wallet.address);
            return {
                raw: balance,
                formatted: ethers.formatEther(balance),
                symbol: this.network.nativeCurrency
            };
        } catch (error) {
            console.error('Error getting MegaETH balance:', error);
            throw new Error(`Failed to get MegaETH balance: ${error.message}`);
        }
    }

    // Example: Get the balance of a specific token on MegaETH testnet
    async getTokenBalance(tokenAddress) {
        try {
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ERC20_ABI,
                this.provider
            );
            const balance = await tokenContract.balanceOf(this.wallet.address);
            const decimals = await tokenContract.decimals();
            const symbol = await tokenContract.symbol();
            return {
                raw: balance,
                formatted: ethers.formatUnits(balance, decimals),
                symbol
            };
        } catch (error) {
            console.error('Error getting token balance:', error);
            throw new Error(`Failed to get token balance: ${error.message}`);
        }
    }

    /**
     * Scan for all tokens owned by the user's wallet on MegaETH
     * For now, use direct token contract queries for known tokens in config
     * @param {boolean} includeZeroBalances - Whether to include tokens with zero balances
     * @returns {Promise<Array>} - Array of token details
     */
    async scanAllTokens(includeZeroBalances = false) {
        console.log(`Scanning for all tokens in wallet ${this.wallet.address} on MegaETH...`);
        try {
            // Get all known token addresses from the config, skip invalid/placeholder addresses
            const knownTokenAddresses = Object.values(this.network.tokens)
                .map(token => token.address)
                .filter(addr => addr && addr !== '0x0000000000000000000000000000000000000000');
            const results = [];
            // Query each token contract for balance
            const tokenPromises = knownTokenAddresses.map(async (tokenAddress) => {
                try {
                    if (!ethers.isAddress(tokenAddress) || tokenAddress === '0x0000000000000000000000000000000000000000') return null;
                    const tokenContract = new ethers.Contract(
                        tokenAddress,
                        ERC20_ABI,
                        this.provider
                    );
                    const balance = await tokenContract.balanceOf(this.wallet.address);
                    const decimals = await tokenContract.decimals();
                    const symbol = await tokenContract.symbol();
                    const name = await tokenContract.name();
                    const tokenConfigEntry = Object.values(this.network.tokens).find(
                        token => token.address.toLowerCase() === tokenAddress.toLowerCase()
                    );
                    return {
                        address: tokenAddress,
                        symbol,
                        name,
                        balance: {
                            raw: balance.toString(),
                            formatted: ethers.formatUnits(balance, decimals)
                        },
                        decimals,
                        logoURI: tokenConfigEntry?.logoURI || null
                    };
                } catch (error) {
                    console.warn(`Error getting token details for ${tokenAddress}:`, error);
                    return null;
                }
            });
            const tokenResults = await Promise.all(tokenPromises);
            results.push(...tokenResults.filter(Boolean));
            // Filter based on balance if needed
            let filteredResults = results;
            if (!includeZeroBalances) {
                filteredResults = results.filter(token => {
                    if (!token || !token.balance || typeof token.balance.formatted === 'undefined') return false;
                    const balanceNum = parseFloat(token.balance.formatted);
                    return balanceNum > 0;
                });
            }
            console.log(`Returning ${filteredResults.length} tokens for MegaETH`);
            return filteredResults;
        } catch (error) {
            console.error('Error scanning for tokens on MegaETH:', error);
            throw new Error(`Failed to scan for tokens on MegaETH: ${error.message}`);
        }
    }

    // Add more methods as needed, mirroring MonadIntegration
}

module.exports = MegaethIntegration;
