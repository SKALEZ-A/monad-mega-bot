const { Markup } = require('telegraf');
const { NETWORKS } = require('../config');
const userPreferences = require('./userPreferences');
const tokenPrices = require('./tokenPrices');
const { ethers } = require('ethers');

/**
 * TelegramCommands class for handling bot commands
 */
class TelegramCommands {
    constructor(walletManager, monadIntegration) {
        this.walletManager = walletManager;
        this.monadIntegration = monadIntegration;
        this.userPreferences = userPreferences;
        this.tokenPrices = tokenPrices;
        
        // Create a mapping of network identifiers to their integration instances
        this.integrations = {
            'MONAD': this.monadIntegration
        };
    }

    /**
     * Get integration instance for a specific network
     */
    getIntegration(network = 'MONAD', userId) {
        if (userId && this.walletManager.hasWallet(userId)) {
            // Create a new integration instance with the user's wallet
            const wallet = this.walletManager.getWalletDetails(userId);
            if (wallet && wallet.privateKey) {
                try {
                    // Create a new MonadIntegration instance with the user's wallet
                    console.log(`Creating a new integration instance for user ${userId} with wallet ${wallet.address}`);
                    const MonadIntegration = require('./monadIntegration');
                    return new MonadIntegration(wallet.privateKey);
                } catch (error) {
                    console.error(`Error creating integration for user ${userId}:`, error);
                }
            }
        }
        
        // Fallback to the default integration
        console.log(`Using default integration for network ${network}`);
        return this.integrations[network] || this.monadIntegration;
    }

    /**
     * Get the main menu keyboard
     */
    getMainMenu() {
        return Markup.keyboard([
            ['💰 My Wallet', '💱 Swap Tokens'],
            ['💸 Send', '📊 My Balances'],
            ['🔄 Switch Network', 'ℹ️ Help'],
            ['⚙️ Settings']
        ]).resize();
    }

    /**
     * Get the wallet menu keyboard
     */
    getWalletMenu() {
        return Markup.keyboard([
            ['🔑 Generate Wallet', '📥 Import Wallet'],
            ['🏠 Main Menu']
        ]).resize();
    }
    
    /**
     * Get the settings menu keyboard
     */
    getSettingsMenu() {
        return Markup.keyboard([
            ['⚙️ Set Slippage', '📌 Manage Watchlist'],
            ['🏠 Main Menu']
        ]).resize();
    }
    
    /**
     * Get the watchlist menu keyboard
     */
    getWatchlistMenu() {
        return Markup.keyboard([
            ['📌 Add Token', '🗑️ Remove Token'],
            ['📊 View Watchlist', '🏠 Main Menu']
        ]).resize();
    }

    /**
     * Get the swap menu keyboard with token options based on the network
     */
    getSwapMenu(network = 'MONAD') {
        const networkConfig = NETWORKS[network];
        const nativeSymbol = networkConfig.nativeCurrency;
        const wethSymbol = 'WETH';
        
        if (network === 'MONAD') {
            // Get available tokens for MONAD
            const tokens = Object.values(networkConfig.tokens);
            
            return Markup.keyboard([
                [`${nativeSymbol} → ${wethSymbol}`, `${nativeSymbol} → ${tokens[0].symbol}`, `${nativeSymbol} → Custom`],
                [`${wethSymbol} → ${nativeSymbol}`, `${tokens[0].symbol} → ${nativeSymbol}`, `${wethSymbol} → ${tokens[0].symbol}`],
                [`${tokens[0].symbol} → ${wethSymbol}`, 'Custom Swap'],
                ['🏠 Main Menu']
            ]).resize();
        } else {
            // Default to MONAD
            // Get available tokens for Monad
            const tokens = Object.values(networkConfig.tokens);
            
            return Markup.keyboard([
                [`${nativeSymbol} → ${tokens[0].symbol}`, `${nativeSymbol} → ${tokens[1].symbol}`, `${nativeSymbol} → ${tokens[2].symbol}`],
                [`${tokens[0].symbol} → ${nativeSymbol}`, `${tokens[1].symbol} → ${nativeSymbol}`, `${tokens[2].symbol} → ${nativeSymbol}`],
                [`${tokens[0].symbol} → ${tokens[1].symbol}`, `${tokens[1].symbol} → ${tokens[0].symbol}`, 'Custom Swap'],
                ['🏠 Main Menu']
            ]).resize();
        }
    }

    /**
     * Get the token selection keyboard based on the network
     */
    getTokenSelectionMenu(action, network = 'MONAD') {
        const networkConfig = NETWORKS[network];
        if (!networkConfig) {
            // Fallback to MONAD if network not found
            network = 'MONAD';
        }
        
        const tokens = Object.entries(networkConfig.tokens).map(([key, token]) => key);
        tokens.unshift(networkConfig.nativeCurrency); // Add native token at the beginning
        
        const rows = [];
        for (let i = 0; i < tokens.length; i += 3) {
            rows.push(tokens.slice(i, i + 3).map(token => `${action} ${token}`));
        }
        
        rows.push(['🏠 Main Menu']);
        
        return Markup.keyboard(rows).resize();
    }

    /**
     * Get the send menu keyboard based on the network
     */
    getSendMenu(network = 'MONAD') {
        const networkConfig = NETWORKS[network];
        const nativeSymbol = networkConfig.nativeCurrency;
        
        // Get available tokens
        const tokens = Object.keys(networkConfig.tokens);
        
        return Markup.keyboard([
            [`Send ${nativeSymbol}`, `Send ${tokens[0]}`, `Send ${tokens[1]}`],
            [`Send ${tokens[2]}`, `Send ${tokens[3]}`, 'Send Custom Token'],
            ['🏠 Main Menu']
        ]).resize();
    }

    /**
     * Get back button inline keyboard
     */
    getBackButton() {
        return Markup.inlineKeyboard([
            Markup.button.callback('◀️ Back', 'back')
        ]);
    }

    /**
     * Format token balances for display based on the network
     */
    async formatBalances(userId, network = 'MONAD') {
        try {
            if (!this.walletManager.hasWallet(userId)) {
                return 'No wallet found. Please generate or import a wallet first.';
            }

            const wallet = this.walletManager.getWalletDetails(userId);
            const integration = this.getIntegration(network, userId);
            const networkConfig = NETWORKS[network];
            
            console.log(`Fetching balances for ${wallet.address} on ${network}...`);
            
            // Show a loading message to let user know we're scanning all tokens
            console.log('Scanning for all tokens (including zero balances)...');
            
            // Scan all tokens owned by the user using the improved scanAllTokens method
            // Always include zero balances to show ALL tokens
            const tokens = await integration.scanAllTokens(true); 
            console.log(`Found ${tokens.length} tokens for address ${wallet.address}`);
            
            // Get native balance
            const nativeBalance = await integration.getNativeBalance();
            
            let message = `📊 *WALLET BALANCE*\n`;
            message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
            message += `👛 *Address:* \`${wallet.address}\`\n\n`;
            
            message += `💎 *NATIVE TOKEN*\n`;
            message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
            message += `• *${nativeBalance.symbol}*: \`${nativeBalance.formatted}\`\n\n`;
            
            if (tokens.length > 0) {
                message += `🪙 *ERC20 TOKENS*\n`;
                message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                
                // Sort tokens by balance (highest first)
                const sortedTokens = tokens.sort((a, b) => {
                    const aBalance = parseFloat(a.balance.formatted) || 0;
                    const bBalance = parseFloat(b.balance.formatted) || 0;
                    return bBalance - aBalance;
                });
                
                // Display tokens with balances first
                const tokensWithBalance = sortedTokens.filter(token => 
                    parseFloat(token.balance.formatted) > 0
                );
                
                if (tokensWithBalance.length > 0) {
                    for (const token of tokensWithBalance) {
                        message += `• *${token.symbol}*: \`${token.balance.formatted}\`\n`;
                    }
                    message += '\n';
                } else {
                    message += `• No token balances found\n\n`;
                }
                
                // Show tokens with zero balance at the end
                const zeroBalanceTokens = sortedTokens.filter(token => 
                    parseFloat(token.balance.formatted) === 0
                );
                
                if (zeroBalanceTokens.length > 0) {
                    message += `📋 *OTHER AVAILABLE TOKENS*\n`;
                    message += `━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`;
                    
                    // Group tokens by 3 per line to save space
                    const tokenGroups = [];
                    for (let i = 0; i < zeroBalanceTokens.length; i += 3) {
                        const group = zeroBalanceTokens.slice(i, i + 3);
                        tokenGroups.push(group.map(t => t.symbol).join(', '));
                    }
                    
                    message += tokenGroups.map(g => `• ${g}`).join('\n');
                    message += '\n\n';
                }
            } else {
                message += `*No ERC20 tokens found for this wallet.*\n\n`;
            }
            
            message += `🔍 [View Wallet on Explorer](${networkConfig.blockExplorerUrl}/address/${wallet.address})`;
            
            return message;
        } catch (error) {
            console.error('Error formatting balances:', error);
            return `Error retrieving balances: ${error.message}`;
        }
    }

    /**
     * Format token balances without including network or wallet details (for consolidated view)
     */
    async formatBalancesWithoutNetworkInfo(userId, network = 'MONAD') {
        if (network !== 'MONAD') {
            return 'Network not supported.';
        }
        
        try {
            if (!this.walletManager.hasWallet(userId)) {
                return 'No wallet found. Please generate or import a wallet first.';
            }

            const wallet = this.walletManager.getWalletDetails(userId);
            const integration = this.getIntegration(network, userId);
            const networkConfig = NETWORKS[network];
            
            // Get native balance
            const nativeBalance = await integration.getNativeBalance();
            let message = `• *${nativeBalance.symbol}*: \`${nativeBalance.formatted}\``;
            
            // Scan for all tokens with nonzero balances
            const tokens = await integration.scanAllTokens(false); // false = only include tokens with non-zero balances
            
            if (tokens.length > 0) {
                // Sort tokens by balance (highest first)
                const sortedTokens = tokens.sort((a, b) => {
                    const aBalance = parseFloat(a.balance.formatted) || 0;
                    const bBalance = parseFloat(b.balance.formatted) || 0;
                    return bBalance - aBalance;
                });
                
                // Only show non-zero balances
                const tokensWithBalance = sortedTokens.filter(token => 
                    parseFloat(token.balance.formatted) > 0
                );
                
                for (const token of tokensWithBalance) {
                    message += `\n• *${token.symbol}*: \`${token.balance.formatted}\``;
                }
            }
            
            return message;
        } catch (error) {
            console.error('Error formatting balances without network info:', error);
            return `Error retrieving balances: ${error.message}`;
        }
    }

    /**
     * Format swap quote for display based on the network
     */
    async formatSwapQuote(fromToken, toToken, amount, network = 'MONAD') {
        try {
            let fromTokenAddress, toTokenAddress;
            const networkConfig = NETWORKS[network];
            const nativeSymbol = networkConfig.nativeCurrency;
            const integration = this.getIntegration(network, null);
            
            // Get token addresses
            if (fromToken === nativeSymbol) {
                fromTokenAddress = networkConfig.addresses.WETH;
            } else {
                fromTokenAddress = networkConfig.tokens[fromToken]?.address;
            }
            
            if (toToken === nativeSymbol) {
                toTokenAddress = networkConfig.addresses.WETH;
            } else {
                toTokenAddress = networkConfig.tokens[toToken]?.address;
            }
            
            if (!fromTokenAddress) {
                throw new Error(`Unknown token: ${fromToken}`);
            }
            
            if (!toTokenAddress) {
                throw new Error(`Unknown token: ${toToken}`);
            }
            
            const quote = await integration.getSwapQuote(fromTokenAddress, toTokenAddress, amount);
            
            let message = `*Swap Quote*\n\n`;
            message += `From: *${amount} ${fromToken}*\n`;
            message += `To: *${quote.toToken.amount} ${toToken}*\n\n`;
            
            // Get USD values if possible
            try {
                const fromUsdValue = await this.tokenPrices.getUsdValue(fromToken, amount, network);
                const toUsdValue = await this.tokenPrices.getUsdValue(toToken, quote.toToken.amount, network);
                
                if (fromUsdValue && toUsdValue) {
                    message += `USD Value: $${fromUsdValue.toFixed(2)} → $${toUsdValue.toFixed(2)}\n\n`;
                }
            } catch (error) {
                console.error('Error getting USD values:', error);
            }
            
            // Calculate price impact if possible
            try {
                const priceImpact = ((1 - (toUsdValue / fromUsdValue)) * 100).toFixed(2);
                if (!isNaN(priceImpact) && priceImpact > 0) {
                    message += `Price Impact: ${priceImpact}%\n\n`;
                }
            } catch (error) {
                // Ignore price impact calculation errors
            }
            
            return message;
        } catch (error) {
            console.error('Error formatting swap quote:', error);
            return `Error: ${error.message}`;
        }
    }

    /**
     * Get the token address from a symbol or address
     * @private
     */
    async _getTokenAddress(tokenSymbolOrAddress, network = 'MONAD') {
        console.log(`Getting token address for ${tokenSymbolOrAddress} on ${network}`);
        // If it already looks like an address, return it
        if (typeof tokenSymbolOrAddress === 'string' && 
            tokenSymbolOrAddress.startsWith('0x') && 
            tokenSymbolOrAddress.length === 42) {
            console.log(`Token ${tokenSymbolOrAddress} already appears to be an address, returning as is`);
            return tokenSymbolOrAddress;
        }
        
        // Check for native currency (MON)
            const networkConfig = NETWORKS[network];
        const nativeCurrency = networkConfig.nativeCurrency;
        if (tokenSymbolOrAddress.toUpperCase() === nativeCurrency) {
            console.log(`Token ${tokenSymbolOrAddress} is the native currency, returning WETH address: ${networkConfig.addresses.WETH}`);
            return networkConfig.addresses.WETH;
        }
        
        // Look up in token list
        const token = Object.values(networkConfig.tokens).find(
            t => t.symbol.toUpperCase() === tokenSymbolOrAddress.toUpperCase()
        );
        
        if (token) {
            console.log(`Found token ${tokenSymbolOrAddress} in config: ${token.address}`);
            return token.address;
        }
        
        // If not found, assume it's an unknown token address and return as is
        console.log(`Token ${tokenSymbolOrAddress} not found in config, treating as custom token address`);
        return tokenSymbolOrAddress;
    }

    /**
     * Swap tokens based on the network
     */
    async executeSwap(userId, fromToken, toToken, amount, slippage = 0.5, fromTokenSymbol, toTokenSymbol, network = 'MONAD') {
        try {
            // Get the user's integration for the selected network
            const integration = this.getIntegration(network, userId);
            if (!integration) {
                return { success: false, message: 'Error: Could not initialize wallet connection. Please try again.' };
            }
            
            // Check native currency for the network
            const nativeCurrency = NETWORKS[network].nativeCurrency;
            console.log(`Executing swap: ${fromToken} (${fromTokenSymbol}) -> ${toToken} (${toTokenSymbol}), amount: ${amount}, slippage: ${slippage}%`);
            
            // Resolve token addresses
            let fromTokenAddress, toTokenAddress;
            
            try {
                fromTokenAddress = await this._getTokenAddress(fromToken, network);
                toTokenAddress = await this._getTokenAddress(toToken, network);
                console.log(`Resolved addresses: From ${fromTokenAddress}, To ${toTokenAddress}`);
            } catch (error) {
                console.error('Error resolving token addresses:', error);
                return { success: false, message: `Error: Could not resolve token addresses. ${error.message}` };
            }

            // Check if we're swapping native MON to a token
            if (fromTokenSymbol === nativeCurrency) {
                console.log(`Swapping native ${nativeCurrency} for token`);
                
                // Define progress callback for real-time updates
                const progressUpdates = [];
                const progressCallback = (stage, message, data) => {
                    console.log(`[${stage}] ${message}`);
                    progressUpdates.push({ stage, message, data });
                };
                
                try {
                    // Execute the swap with progress callback
                    const result = await integration.swapMonadForToken(
                        toTokenAddress, 
                        amount, 
                        slippage,
                        progressCallback
                    );
                    
                    // Safety check for result structure
                    if (!result) {
                        throw new Error('Swap returned empty result');
                    }
                    
                    // Make sure result.amountOut exists and has formatted property
                    let outputAmount = 'Unknown amount';
                    if (result.amountOut && typeof result.amountOut === 'object' && 'formatted' in result.amountOut) {
                        outputAmount = result.amountOut.formatted;
                    } else if (result.toAmount) {
                        outputAmount = result.toAmount;
                    }
                                         
                    // Make sure result.priceImpact exists
                    let priceImpact = 'Unknown';
                    if (result.priceImpact !== undefined && result.priceImpact !== null) {
                        // Check if priceImpact is a number and has toFixed method
                        if (typeof result.priceImpact === 'number' || 
                            (typeof result.priceImpact === 'object' && 'toFixed' in result.priceImpact)) {
                            priceImpact = result.priceImpact.toFixed(2) + '%';
                        } else {
                            priceImpact = result.priceImpact.toString() + '%';
                        }
                    }
                    
                    // Format successful result safely
                    const successMessage = 
                        `✅ *Swap Successful*\n\n` +
                        `Swapped ${amount} ${nativeCurrency} for ${outputAmount} ${toTokenSymbol}\n\n` +
                        `💰 *Transaction Details*\n` +
                        `• Price Impact: ${priceImpact}\n` +
                        `• Gas Used: ${result.transactionFee?.gas || 'Unknown'}\n` +
                        `• Gas Price: ${result.transactionFee?.gasPrice || 'Unknown'}\n` +
                        `• Total Fee: ${result.transactionFee?.total || 'Unknown'}\n\n` +
                        `[View on Explorer](${result.explorerUrl || 'https://testnet.monadexplorer.com/'})`;
                    
                    return { 
                        success: true, 
                        message: successMessage,
                        txData: result,
                        progressUpdates
                    };
                } catch (error) {
                    console.error('Error during swap:', error);
                    return { 
                        success: false, 
                        message: `Error: ${error.message}`,
                        progressUpdates
                    };
                }
            } 
            // Check if we're swapping a token to native MON
            else if (toTokenSymbol === nativeCurrency) {
                console.log(`Swapping token for native ${nativeCurrency}`);
                
                try {
                    // Execute token to MON swap
                    const result = await integration.swapTokenForMonad(
                        fromTokenAddress,
                        amount,
                        slippage
                    );
                    
                    // Safety check for result
                    if (!result) {
                        throw new Error('Swap returned empty result');
                    }
                    
                    // Make sure the formatted output is available with safer checks
                    let outputAmount = 'Unknown amount';
                    if (result.amountOut && typeof result.amountOut === 'object' && 'formatted' in result.amountOut) {
                        outputAmount = result.amountOut.formatted;
                    } else if (result.toAmount) {
                        outputAmount = result.toAmount;
                    }
                    
                    // Make sure priceImpact is valid with safer checks
                    let priceImpact = 'Unknown';
                    if (result.priceImpact !== undefined && result.priceImpact !== null) {
                        if (typeof result.priceImpact === 'number' || 
                            (typeof result.priceImpact === 'object' && 'toFixed' in result.priceImpact)) {
                            priceImpact = result.priceImpact.toFixed(2) + '%';
                        } else {
                            priceImpact = result.priceImpact.toString() + '%';
                        }
                    }
                    
                    // Format successful result with safe property access
                    const successMessage = 
                        `✅ *Swap Successful*\n\n` +
                        `Swapped ${amount} ${fromTokenSymbol} for ${outputAmount} ${nativeCurrency}\n\n` +
                        `💰 *Transaction Details*\n` +
                        `• Price Impact: ${priceImpact}\n` +
                        `• Gas Used: ${result.transactionFee?.gas || 'Unknown'}\n` +
                        `• Gas Price: ${result.transactionFee?.gasPrice || 'Unknown'}\n` +
                        `• Total Fee: ${result.transactionFee?.total || 'Unknown'}\n\n` +
                        `[View on Explorer](${result.explorerUrl || 'https://testnet.monadexplorer.com/'})`;
                    
                    return { 
                        success: true, 
                        message: successMessage,
                        txData: result
                    };
                } catch (error) {
                    console.error('Error during swap:', error);
                    return { 
                        success: false, 
                        message: `Error: ${error.message}`
                    };
                }
            } 
            // Token to token swap
            else {
                console.log(`Swapping token for token: ${fromTokenSymbol} -> ${toTokenSymbol}`);
                
                try {
                    // Execute token to token swap
                    const result = await integration.swapTokenForToken(
                        fromTokenAddress,
                        toTokenAddress,
                        amount,
                        slippage
                    );
                    
                    // Safety check for result
                    if (!result) {
                        throw new Error('Swap returned empty result');
                    }
                    
                    // Make sure toAmount exists with safer check
                    const outputAmount = result.toAmount || 
                                       (result.amountOut && result.amountOut.formatted ? 
                                       result.amountOut.formatted : 'Unknown amount');
                    
                    // Safe check for priceImpact
                    let priceImpact = 'Unknown';
                    if (result.priceImpact !== undefined && result.priceImpact !== null) {
                        if (typeof result.priceImpact === 'number' || 
                            (typeof result.priceImpact === 'object' && 'toFixed' in result.priceImpact)) {
                            priceImpact = result.priceImpact.toFixed(2) + '%';
                        } else {
                            priceImpact = result.priceImpact.toString() + '%';
                        }
                    }
                    
                    // Format successful result with safe property access
                    const successMessage = 
                        `✅ *Swap Successful*\n\n` +
                        `Swapped ${amount} ${fromTokenSymbol} for ${outputAmount} ${toTokenSymbol}\n\n` +
                        `💰 *Transaction Details*\n` +
                        `• Price Impact: ${priceImpact}\n` +
                        `• Gas Used: ${result.transactionFee?.gas || 'Unknown'}\n` +
                        `• Gas Price: ${result.transactionFee?.gasPrice || 'Unknown'}\n` +
                        `• Total Fee: ${result.transactionFee?.total || 'Unknown'}\n\n` +
                        `[View on Explorer](${result.explorerUrl || 'https://testnet.monadexplorer.com/'})`;
                    
                    return { 
                        success: true, 
                        message: successMessage,
                        txData: result
                    };
                } catch (error) {
                    console.error('Error during swap:', error);
                    return { 
                        success: false, 
                        message: `Error: ${error.message}`
                    };
                }
            }
        } catch (error) {
            console.error('Error in executeSwap:', error);
            return { success: false, message: `Unexpected error: ${error.message}` };
        }
    }

    /**
     * Send tokens based on the network
     */
    async sendTokens(userId, token, recipient, amount, network = 'MONAD') {
        try {
            const wallet = this.walletManager.getWalletDetails(userId);
            if (!wallet || !wallet.privateKey) {
                throw new Error('Wallet not found. Please create or import a wallet first.');
            }
            
            const networkConfig = NETWORKS[network];
            const nativeSymbol = networkConfig.nativeCurrency;
            const integration = this.getIntegration(network, userId);
            
            console.log(`Sending ${amount} ${token} to ${recipient}`);
            
            // Validate recipient address
            if (!ethers.isAddress(recipient)) {
                throw new Error('Invalid recipient address');
            }
            
            let result;
            
            // Check if sending native currency or token
            const tokenAddress = await this._getTokenAddress(token, network);
            if (tokenAddress === 'native' || token === nativeSymbol) {
                // Sending native currency
                console.log(`Sending native currency: ${amount} ${nativeSymbol}`);
                result = await integration.sendNative(recipient, amount);
            } else {
                // Sending token
                console.log(`Sending token: ${amount} of ${tokenAddress}`);
                result = await integration.sendToken(tokenAddress, recipient, amount);
            }
            
            if (result && result.status === 'success') {
                let successMessage = `✅ *Transfer Successful*\n\n`;
                successMessage += `Token: *${result.token}*\n`;
                successMessage += `Amount: *${result.amount}*\n`;
                successMessage += `To: \`${result.to}\`\n\n`;
                successMessage += `[View Transaction](${result.explorerUrl})`;
                
                return { 
                    success: true, 
                    message: successMessage,
                    txData: result
                };
            } else {
                throw new Error('Transfer failed or returned invalid result');
            }
        } catch (error) {
            console.error('Error sending tokens:', error);
            return {
                success: false,
                message: `Error: ${error.message}`
            };
        }
    }

    /**
     * Add a token to the watchlist based on the network
     */
    async addToWatchlist(ctx, tokenAddress, network = 'MONAD') {
        try {
            const userId = ctx.from.id.toString();
            const integration = this.getIntegration(network, userId);
            
            // Validate token address
            if (!ethers.isAddress(tokenAddress)) {
                return `❌ Invalid token address. Please provide a valid Ethereum address.`;
            }
            
            // Get token details from the blockchain
            try {
                const tokenContract = new ethers.Contract(
                    tokenAddress,
                    ["function symbol() view returns (string)", "function name() view returns (string)", "function decimals() view returns (uint8)"],
                    integration.provider
                );
                
                const symbol = await tokenContract.symbol();
                const name = await tokenContract.name();
                const decimals = await tokenContract.decimals();
                
                // Add to watchlist
                this.userPreferences.addToWatchlist(userId, {
                    address: tokenAddress,
                    symbol,
                    name,
                    decimals,
                    network
                });
                
                return `✅ Token added to watchlist:\n\n*${symbol} (${name})*\nAddress: \`${tokenAddress}\`\nDecimals: ${decimals}`;
                
            } catch (error) {
                console.error('Error getting token details for watchlist:', error);
                return `❌ Could not get token details. Is this a valid ERC-20 token address?`;
            }
            
        } catch (error) {
            console.error('Error adding to watchlist:', error);
            return `❌ Error: ${error.message}`;
        }
    }

    /**
     * Remove a token from the watchlist based on the network
     */
    async removeFromWatchlist(ctx, tokenAddressOrSymbol, network = 'MONAD') {
        try {
            const userId = ctx.from.id.toString();
            
            // Get the watchlist
            const watchlist = this.userPreferences.getWatchlist(userId, network);
            if (!watchlist || watchlist.length === 0) {
                return `❌ Your watchlist is empty.`;
            }
            
            // Find the token in the watchlist
            let tokenToRemove;
            for (const token of watchlist) {
                if (
                    token.address.toLowerCase() === tokenAddressOrSymbol.toLowerCase() ||
                    token.symbol.toLowerCase() === tokenAddressOrSymbol.toLowerCase()
                ) {
                    tokenToRemove = token;
                    break;
                }
            }
            
            if (!tokenToRemove) {
                return `❌ Token "${tokenAddressOrSymbol}" not found in your watchlist.`;
            }
            
            // Remove the token
            this.userPreferences.removeFromWatchlist(userId, tokenToRemove.address, network);
            
            return `✅ Token removed from watchlist: *${tokenToRemove.symbol}*`;
            
        } catch (error) {
            console.error('Error removing from watchlist:', error);
            return `❌ Error: ${error.message}`;
        }
    }

    /**
     * View the watchlist based on the network
     */
    async viewWatchlist(ctx, network = 'MONAD') {
        try {
            const userId = ctx.from.id.toString();
            
            // Get the watchlist
            const watchlist = this.userPreferences.getWatchlist(userId, network);
            if (!watchlist || watchlist.length === 0) {
                return `Your watchlist on ${NETWORKS[network].name} is empty. Add tokens with the "Add Token" command.`;
            }
            
            // Format the watchlist
            let message = `*Your ${NETWORKS[network].name} Watchlist* 📋\n\n`;
            
            const integration = this.getIntegration(network, userId);
            
            // Get balances for each token
            for (const token of watchlist) {
                try {
                    const balance = await integration.getTokenBalance(token.address);
                    message += `🔹 *${token.symbol}* - ${balance.formatted}\n`;
                    message += `   Contract: \`${token.address}\`\n`;
                    message += `   [View on Explorer](${NETWORKS[network].tokenExplorer}${token.address})\n\n`;
                } catch (error) {
                    console.error(`Error getting token balance for ${token.symbol}:`, error);
                    message += `🔹 *${token.symbol}* - Error getting balance\n`;
                    message += `   Contract: \`${token.address}\`\n`;
                    message += `   [View on Explorer](${NETWORKS[network].tokenExplorer}${token.address})\n\n`;
                }
            }
            
            return message;
        } catch (error) {
            console.error('Error viewing watchlist:', error);
            return `❌ Error: ${error.message}`;
        }
    }

    /**
     * Set slippage tolerance for swaps
     */
    async setSlippage(ctx, slippage) {
        try {
            const userId = ctx.from.id.toString();
            
            // Validate slippage
            const slippageValue = parseFloat(slippage);
            if (isNaN(slippageValue) || slippageValue < 0.1 || slippageValue > 50) {
                return `❌ Invalid slippage value. Please provide a number between 0.1 and 50.`;
            }
            
            // Save the slippage preference
            this.userPreferences.setSlippageTolerance(userId, slippageValue);
            
            return `✅ Slippage tolerance set to ${slippageValue}%`;
            
        } catch (error) {
            console.error('Error setting slippage:', error);
            return `❌ Error: ${error.message}`;
        }
    }

    /**
     * Get token price information based on the network
     */
    async getTokenPrice(ctxOrToken, tokenAddressOrSymbol, network = 'MONAD') {
        try {
            let tokenAddress;
            let ctx = typeof ctxOrToken === 'object' ? ctxOrToken : null;
            let tokenSymbolOrAddress = ctx ? tokenAddressOrSymbol : ctxOrToken;
            
            const networkConfig = NETWORKS[network];
            const nativeCurrency = networkConfig.nativeCurrency;
            const integration = this.getIntegration(network, null);
            
            // Get token address
            if (tokenSymbolOrAddress.toLowerCase() === nativeCurrency.toLowerCase()) {
                // Handle native token
                return await this.tokenPrices.getNativeTokenPrice(network);
            } else if (Object.keys(networkConfig.tokens).some(symbol => 
                symbol.toLowerCase() === tokenSymbolOrAddress.toLowerCase())) {
                // Handle known token by symbol
                const symbol = Object.keys(networkConfig.tokens).find(s => 
                    s.toLowerCase() === tokenSymbolOrAddress.toLowerCase());
                tokenAddress = networkConfig.tokens[symbol].address;
            } else if (ethers.isAddress(tokenSymbolOrAddress)) {
                // Handle token by address
                tokenAddress = tokenSymbolOrAddress;
            } else {
                throw new Error(`Unknown token: ${tokenSymbolOrAddress}`);
            }
            
            // Fetch token details
            const tokenDetails = await this.getTokenInfo(null, tokenAddress, network);
            
            // Fetch token price
            const price = await this.tokenPrices.getTokenPrice(tokenAddress, network);
            
            // Format response
            if (ctx) {
                let message = `*${tokenDetails.symbol} (${tokenDetails.name})* 💰\n\n`;
                message += `Current Price: $${price ? price.toFixed(6) : 'Unknown'}\n`;
                message += `Decimals: ${tokenDetails.decimals}\n`;
                message += `Address: \`${tokenAddress}\`\n\n`;
                
                // Add links
                message += `[View on Explorer](${networkConfig.blockExplorerUrl}/token/${tokenAddress})`;
                
                return message;
            } else {
                return {
                    symbol: tokenDetails.symbol,
                    name: tokenDetails.name,
                    price: price || 0,
                    address: tokenAddress,
                    decimals: tokenDetails.decimals
                };
            }
            
        } catch (error) {
            console.error('Error getting token price:', error);
            if (ctx) {
                return `❌ Error: ${error.message}`;
            } else {
                throw error;
            }
        }
    }

    /**
     * Get detailed token information based on the network
     */
    async getTokenInfo(ctx, tokenAddress, network = 'MONAD') {
        try {
            const integration = this.getIntegration(network, null);
            const networkConfig = NETWORKS[network];
            
            // Validate address
            if (!ethers.isAddress(tokenAddress)) {
                throw new Error('Invalid token address');
            }
            
            // Create token contract instance
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ["function symbol() view returns (string)", "function name() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)"],
                integration.provider
            );
            
            // Get token details
            const [symbol, name, decimals, totalSupply] = await Promise.all([
                tokenContract.symbol(),
                tokenContract.name(),
                tokenContract.decimals(),
                tokenContract.totalSupply()
            ]);
            
            const formattedTotalSupply = ethers.formatUnits(totalSupply, decimals);
            
            // Try to get token price
            let price;
            try {
                price = await this.tokenPrices.getTokenPrice(tokenAddress, network);
            } catch (error) {
                console.error('Error getting token price for info:', error);
                price = null;
            }
            
            // Format response
            if (ctx) {
                let message = `*${symbol} (${name})* ℹ️\n\n`;
                message += `Symbol: ${symbol}\n`;
                message += `Name: ${name}\n`;
                message += `Decimals: ${decimals}\n`;
                message += `Total Supply: ${parseFloat(formattedTotalSupply).toLocaleString()}\n`;
                message += `Price: ${price ? '$' + price.toFixed(6) : 'Unknown'}\n\n`;
                message += `Address: \`${tokenAddress}\`\n\n`;
                
                // Add links
                message += `[View on Explorer](${networkConfig.blockExplorerUrl}/token/${tokenAddress})`;
                
                return message;
            } else {
                return {
                    symbol,
                    name,
                    decimals,
                    totalSupply: formattedTotalSupply,
                    price: price || 0,
                    address: tokenAddress
                };
            }
            
        } catch (error) {
            console.error('Error getting token info:', error);
            if (ctx) {
                return `❌ Error: ${error.message}`;
            } else {
                throw error;
            }
        }
    }

    /**
     * Get token options based on the network
     */
    async getTokenOptions(network = 'MONAD') {
        if (network === 'MONAD') {
            // Get available tokens for MONAD
            const tokens = Object.values(NETWORKS.MONAD.tokens);
            return tokens.map(token => ({
                text: `${token.symbol}`,
                callback_data: `token_${token.address}`
            }));
        }
        
        return []; // Return empty array for unsupported networks
    }

    /**
     * Swap native currency for a token
     */
    async swapNativeForToken(userId, tokenAddress, amount, slippage = 0.5, network = 'MONAD') {
        console.log(`Processing swap of native currency for token ${tokenAddress}`);
        
        try {
            // Get user's blockchain integration
            const integration = this.getIntegration(network, userId);
            if (!integration) {
                return { success: false, error: 'Wallet not found' };
            }
            
            // Execute the swap based on the network
            let result = await this.monadIntegration.swapMonadForToken(tokenAddress, amount, slippage);
            
            return {
                success: true,
                hash: result.hash,
                fromToken: result.fromToken,
                toToken: result.toToken,
                fromAmount: result.fromAmount,
                toAmount: result.toAmount,
                explorerUrl: result.explorerUrl
            };
        } catch (error) {
            console.error('Error in swapNativeForToken:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Swap a token for native currency
     */
    async swapTokenForNative(userId, tokenAddress, amount, slippage = 0.5, network = 'MONAD') {
        console.log(`Processing swap of token ${tokenAddress} for native currency`);
        
        try {
            // Get user's blockchain integration
            const integration = this.getIntegration(network, userId);
            if (!integration) {
                return { success: false, error: 'Wallet not found' };
            }
            
            // Execute the swap based on the network
            let result = await this.monadIntegration.swapTokenForMonad(tokenAddress, amount, slippage);
            
            return {
                success: true,
                hash: result.hash,
                fromToken: result.fromToken,
                toToken: result.toToken,
                fromAmount: result.fromAmount,
                toAmount: result.toAmount,
                explorerUrl: result.explorerUrl
            };
        } catch (error) {
            console.error('Error in swapTokenForNative:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Create shortened token identifier for callback_data to avoid Telegram's 64-byte limit
     * @param {string} tokenAddress - Full token address
     * @returns {string} - Shortened identifier (first 10 chars of address)
     */
    createShortTokenId(tokenAddress) {
        // If it's already a short identifier or not an address, return as is
        if (!tokenAddress || tokenAddress.length < 20) {
            console.log(`Token ID already short or invalid: "${tokenAddress}"`);
            return tokenAddress || 'unknown';
        }
        
        try {
            // Use the first 10 characters of the address for the short ID (includes 0x prefix)
            // This provides a good balance between uniqueness and size
            const shortId = tokenAddress.slice(0, 10);
            console.log(`Created short token ID: ${shortId} from ${tokenAddress}`);
            return shortId;
        } catch (error) {
            console.error(`Error creating short token ID for ${tokenAddress}:`, error);
            // Return a safe fallback value
            return 'tkn_' + Math.random().toString(36).substring(2, 8);
        }
    }
    
    /**
     * Validate and format callback data to ensure it doesn't exceed Telegram's 64-byte limit
     * @param {string} callbackData - The callback data string
     * @param {string} fallback - Fallback value if truncation isn't possible
     * @returns {string} - Valid callback data within size limits
     */
    validateCallbackData(callbackData, fallback = 'cancel_action') {
        // Telegram has a 64-byte limit for callback_data
        const MAX_CALLBACK_DATA_LENGTH = 64;
        
        if (!callbackData) {
            console.warn('Empty callback data provided, using fallback');
            return fallback;
        }
        
        // Check if we're already within limits
        if (callbackData.length <= MAX_CALLBACK_DATA_LENGTH) {
            return callbackData;
        }
        
        console.warn(`Callback data exceeds maximum length: ${callbackData.length} bytes`);
        console.warn(`Offending callback data: ${callbackData}`);
        
        // Try to truncate if possible - this is a last resort
        // For structured data like swap_to_X_from_Y, specific handling would be needed
        // Here we're just ensuring we don't crash the bot
        if (callbackData.length > MAX_CALLBACK_DATA_LENGTH) {
            console.warn(`Truncating callback data: ${callbackData}`);
            return fallback;
        }
        
        return fallback;
    }
    
    /**
     * Get the full token address from a short token ID
     * Used when receiving callback data from Telegram
     * @param {string} shortId - Shortened token identifier
     * @param {string} network - Network identifier
     * @returns {Promise<string>} - Full token address
     */
    async getFullTokenAddress(shortId, network = 'MONAD') {
        if (!shortId) {
            console.warn('Empty short token ID provided, returning default token');
            // Return WETH as a default
            return NETWORKS[network]?.addresses?.WETH || '0x0000000000000000000000000000000000000000';
        }
        
        // If it's already a full address, return it
        if (shortId && shortId.startsWith('0x') && shortId.length === 42) {
            console.log(`Short ID is already a full address: ${shortId}`);
            return shortId;
        }
        
        // Check if it's a known token symbol
        try {
            const fullAddress = await this._getTokenAddress(shortId, network);
            if (fullAddress && fullAddress.startsWith('0x')) {
                console.log(`Resolved short ID ${shortId} as token symbol to ${fullAddress}`);
                return fullAddress;
            }
        } catch (error) {
            console.log(`Not a known token symbol: ${shortId}`);
        }
        
        // It's a short ID, try to find the corresponding full address
        console.log(`Looking for full address with prefix: ${shortId}`);
        
        // Get all known token addresses for the network
        const allTokens = [];
        
        // Add tokens from network config
        try {
            const networkTokens = Object.values(NETWORKS[network]?.tokens || {})
                .map(token => token.address);
            allTokens.push(...networkTokens);
            
            // Add common addresses from the network config
            const commonAddresses = Object.values(NETWORKS[network]?.addresses || {});
            allTokens.push(...commonAddresses);
            
            // Find token that starts with the short ID
            const matchingToken = allTokens.find(addr => 
                addr.toLowerCase().startsWith(shortId.toLowerCase())
            );
            
            if (matchingToken) {
                console.log(`Found matching token: ${matchingToken}`);
                return matchingToken;
            }
        } catch (error) {
            console.error(`Error finding full address for ${shortId}:`, error);
        }
        
        // If no match found and it looks like a short address (starts with 0x), 
        // try to use it as-is with a warning
        if (shortId.startsWith('0x')) {
            console.warn(`No full address found for short ID: ${shortId}, using as partial address`);
            // For safety, return a known valid token instead of a partial address
            return NETWORKS[network]?.addresses?.WETH || '0x0000000000000000000000000000000000000000';
        }
        
        // Last resort fallback - return WETH address
        console.warn(`No resolution for token ID ${shortId}, using WETH as fallback`);
        return NETWORKS[network]?.addresses?.WETH || '0x0000000000000000000000000000000000000000';
    }
}

module.exports = TelegramCommands; 