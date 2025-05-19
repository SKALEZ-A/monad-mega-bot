const { ethers } = require('ethers');
const { NETWORKS } = require('../config');

// Uniswap V2 Pair ABI
const PAIR_ABI = [
    "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
];

const FACTORY_ABI = [
    "function getPair(address tokenA, address tokenB) external view returns (address pair)"
];

/**
 * TokenPrices class for fetching token price information from Uniswap V2 pairs
 */
class TokenPrices {
    constructor() {
        this.network = NETWORKS.MONAD;
        this.provider = new ethers.JsonRpcProvider(this.network.rpc);
        this.factoryContract = new ethers.Contract(
            this.network.addresses.FACTORY,
            FACTORY_ABI,
            this.provider
        );
        this.pairCache = new Map(); // address0-address1 -> pair address
    }

    /**
     * Get the Uniswap V2 pair address for two tokens
     * @param {string} tokenA - First token address
     * @param {string} tokenB - Second token address
     * @returns {string} Pair address
     */
    async getPairAddress(tokenA, tokenB) {
        const cacheKey = `${tokenA.toLowerCase()}-${tokenB.toLowerCase()}`;
        const reverseCacheKey = `${tokenB.toLowerCase()}-${tokenA.toLowerCase()}`;
        
        if (this.pairCache.has(cacheKey)) {
            return this.pairCache.get(cacheKey);
        }
        
        if (this.pairCache.has(reverseCacheKey)) {
            return this.pairCache.get(reverseCacheKey);
        }
        
        try {
            const pairAddress = await this.factoryContract.getPair(tokenA, tokenB);
            
            // Check if pair exists (address is not zero)
            if (pairAddress === ethers.ZeroAddress) {
                return null;
            }
            
            this.pairCache.set(cacheKey, pairAddress);
            return pairAddress;
        } catch (error) {
            console.error('Error getting pair address:', error);
            return null;
        }
    }

    /**
     * Get the price of tokenA in terms of tokenB
     * @param {string} tokenA - Address of token to get price for
     * @param {string} tokenB - Address of token to price in (e.g., USDC)
     * @param {number} decimalsA - Decimals of tokenA
     * @param {number} decimalsB - Decimals of tokenB
     * @returns {number} Price of tokenA in tokenB
     */
    async getTokenPrice(tokenA, tokenB, decimalsA = 18, decimalsB = 6) {
        try {
            const pairAddress = await this.getPairAddress(tokenA, tokenB);
            
            if (!pairAddress) {
                console.error('No pair found for tokens:', tokenA, tokenB);
                return null;
            }
            
            const pairContract = new ethers.Contract(
                pairAddress,
                PAIR_ABI,
                this.provider
            );
            
            const [reserves, token0] = await Promise.all([
                pairContract.getReserves(),
                pairContract.token0()
            ]);
            
            const [reserve0, reserve1] = reserves;
            
            // Determine which token is which in the pair
            const isToken0 = tokenA.toLowerCase() === token0.toLowerCase();
            
            // Calculate price based on reserves
            let price;
            if (isToken0) {
                // tokenA is token0, so price = reserve1/reserve0
                price = (Number(reserve1) / 10**decimalsB) / (Number(reserve0) / 10**decimalsA);
            } else {
                // tokenA is token1, so price = reserve0/reserve1
                price = (Number(reserve0) / 10**decimalsB) / (Number(reserve1) / 10**decimalsA);
            }
            
            return price;
        } catch (error) {
            console.error('Error getting token price:', error);
            return null;
        }
    }

    /**
     * Get prices for multiple tokens against a base token (e.g., USDC)
     * @param {Array} tokens - Array of token addresses
     * @param {string} baseToken - Base token address to price against
     * @returns {Object} Object mapping token addresses to prices
     */
    async getMultipleTokenPrices(tokens, baseToken = NETWORKS.MONAD.tokens.USDC.address) {
        const baseDecimals = NETWORKS.MONAD.tokens.USDC.decimals;
        const results = {};
        
        await Promise.all(
            tokens.map(async (token) => {
                if (token.address === baseToken) {
                    results[token.address] = 1;
                    return;
                }
                
                const price = await this.getTokenPrice(
                    token.address, 
                    baseToken, 
                    token.decimals, 
                    baseDecimals
                );
                
                if (price !== null) {
                    results[token.address] = price;
                }
            })
        );
        
        return results;
    }
}

module.exports = new TokenPrices(); 