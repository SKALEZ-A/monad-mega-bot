const axios = require('axios');

/**
 * Utility to interact with BlockVision API for Monad blockchain
 * This provides a better, more reliable way to get all token balances for a wallet
 */
class BlockVisionAPI {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.blockvision.org/v2/monad';
    }

    /**
     * Get all tokens for a wallet address
     * @param {string} address - The wallet address to query
     * @returns {Promise<Array>} - Array of tokens with balances
     */
    async getAccountTokens(address) {
        try {
            const response = await axios.get(`${this.baseUrl}/account/tokens`, {
                params: { address },
                headers: {
                    'x-api-key': this.apiKey
                }
            });

            if (response.data && response.data.code === 0) {
                // Return the token data if successful
                return response.data.result.data || [];
            } else {
                console.error('Error fetching tokens from BlockVision:', response.data.reason || 'Unknown error');
                return [];
            }
        } catch (error) {
            console.error('Error calling BlockVision API:', error.message);
            throw new Error(`Failed to fetch token balances: ${error.message}`);
        }
    }

    /**
     * Convert BlockVision API token data to our app's format
     * @param {Array} tokens - Array of tokens from BlockVision API
     * @returns {Array} - Formatted tokens for our app
     */
    formatTokensForApp(tokens) {
        return tokens.map(token => ({
            address: token.contractAddress,
            symbol: token.symbol,
            name: token.name,
            decimals: token.decimal,
            balance: {
                raw: token.balance,
                formatted: token.balance ? (parseFloat(token.balance) / Math.pow(10, token.decimal)).toString() : '0'
            },
            logoURI: token.imageURL || null
        }));
    }
}

module.exports = BlockVisionAPI; 