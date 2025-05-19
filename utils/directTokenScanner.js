const { ethers } = require('ethers');
const { ERC20_ABI } = require('../config');

/**
 * DirectTokenScanner provides token scanning without relying on external APIs
 * This is a fallback scanner that will work without API keys
 */
class DirectTokenScanner {
    constructor(provider, walletAddress) {
        this.provider = provider;
        this.walletAddress = walletAddress;
    }

    /**
     * Get token details by address
     * @param {string} tokenAddress - The token contract address
     * @returns {Promise<Object>} - Token details or null if error
     */
    async getTokenDetails(tokenAddress) {
        try {
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ERC20_ABI,
                this.provider
            );
            
            // Get basic token info
            const [balance, decimals, symbol, name] = await Promise.all([
                tokenContract.balanceOf(this.walletAddress),
                tokenContract.decimals(),
                tokenContract.symbol(),
                tokenContract.name()
            ]);
            
            // Only return if we successfully get all information
            return {
                address: tokenAddress,
                symbol,
                name,
                decimals,
                balance: {
                    raw: balance.toString(),
                    formatted: ethers.formatUnits(balance, decimals)
                }
            };
        } catch (error) {
            console.warn(`Error getting details for token ${tokenAddress}:`, error.message);
            return null;
        }
    }

    /**
     * Scan for common Monad tokens with active communities
     * This hardcoded list includes major tokens that are likely to be held
     * @returns {Promise<Array>} - Array of token details
     */
    async scanCommonTokens(tokenAddresses) {
        console.log(`Scanning ${tokenAddresses.length} common tokens for wallet ${this.walletAddress}...`);
        
        const tokenPromises = tokenAddresses.map(address => this.getTokenDetails(address));
        const results = await Promise.all(tokenPromises);
        
        // Filter out null results (tokens that had errors)
        return results.filter(token => token !== null);
    }

    /**
     * Check if a contract is likely an ERC20 token
     * @param {string} address - Contract address to check
     * @returns {Promise<boolean>} - True if likely a token
     */
    async isLikelyToken(address) {
        try {
            // Create a contract instance with minimal ABI (just the functions we need to check)
            const minimalAbi = [
                "function balanceOf(address) view returns (uint256)",
                "function decimals() view returns (uint8)",
                "function symbol() view returns (string)"
            ];
            
            const contract = new ethers.Contract(address, minimalAbi, this.provider);
            
            // Try to call common ERC20 functions
            await Promise.all([
                contract.decimals(),
                contract.symbol()
            ]);
            
            // If we get here without errors, it's likely a token
            return true;
        } catch (error) {
            return false;
        }
    }

    /**
     * Scan recent transactions to find potential tokens
     * @param {number} blockCount - Number of recent blocks to scan
     * @returns {Promise<Array>} - Array of token details
     */
    async scanRecentTransactions(blockCount = 1000) {
        try {
            console.log(`Scanning recent transactions for token discovery...`);
            
            // Get current block number
            const currentBlock = await this.provider.getBlockNumber();
            const fromBlock = Math.max(1, currentBlock - blockCount);
            
            // Create filter for Transfer events that involve our wallet
            const filter = {
                topics: [
                    ethers.id("Transfer(address,address,uint256)"),
                    null,
                    null
                ],
                fromBlock,
                toBlock: 'latest'
            };
            
            // Get all matching logs
            const logs = await this.provider.getLogs(filter);
            console.log(`Found ${logs.length} Transfer logs to analyze`);
            
            // Extract unique contract addresses
            const potentialTokens = new Set();
            for (const log of logs) {
                try {
                    // Parse the log to see if our wallet is involved
                    const topics = log.topics;
                    if (topics.length >= 3) {
                        // Extract the from and to addresses
                        const from = ethers.getAddress('0x' + topics[1].slice(26));
                        const to = ethers.getAddress('0x' + topics[2].slice(26));
                        
                        // If our wallet is involved and this appears to be a contract, add it
                        if (from.toLowerCase() === this.walletAddress.toLowerCase() || 
                            to.toLowerCase() === this.walletAddress.toLowerCase()) {
                            potentialTokens.add(log.address.toLowerCase());
                        }
                    }
                } catch (error) {
                    // Skip any logs we can't parse
                    continue;
                }
            }
            
            console.log(`Found ${potentialTokens.size} potential token contracts`);
            
            // Check if each address is likely a token and get details
            const tokenDetails = [];
            for (const address of potentialTokens) {
                // First check if it's likely a token
                const isToken = await this.isLikelyToken(address);
                if (isToken) {
                    const details = await this.getTokenDetails(address);
                    if (details) {
                        tokenDetails.push(details);
                    }
                }
            }
            
            return tokenDetails;
        } catch (error) {
            console.error('Error scanning transactions for tokens:', error);
            return [];
        }
    }
}

module.exports = DirectTokenScanner; 