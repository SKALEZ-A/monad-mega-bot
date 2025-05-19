const { ethers } = require('ethers');
const { NETWORKS, ROUTER_V2_ABI, ERC20_ABI } = require('../config');
const { BOT_CONFIG } = require('../config');

/**
 * Monad Integration Utility
 * Provides functions for interacting with the MONAD testnet and its Uniswap implementation
 */
class MonadIntegration {
    constructor(privateKey) {
        if (!privateKey) {
            throw new Error('Private key is required for MONAD integration');
        }

        console.log('\n=== Initializing MONAD Integration ===');
        this.network = NETWORKS.MONAD;
        
        try {
            // Initialize provider with Alchemy API
            const alchemyApiKey = BOT_CONFIG.ALCHEMY_API_KEY || process.env.ALCHEMY_API_KEY;
            console.log(`Using Alchemy API with key: ${alchemyApiKey ? '****' + alchemyApiKey.slice(-4) : 'not provided'}`);
            
            // Using Alchemy provider with correct URL format
            this.provider = new ethers.JsonRpcProvider(this.network.rpc);
            
            // Initialize wallet with provider
            this.wallet = new ethers.Wallet(privateKey, this.provider);
            
            // Initialize contract instances
            this.routerContract = new ethers.Contract(
                this.network.addresses.ROUTER,
                ROUTER_V2_ABI,
                this.wallet
            );
            
            this.wrappedMonadContract = new ethers.Contract(
                this.network.addresses.WETH,
                ERC20_ABI,
                this.wallet
            );
            
            console.log('MONAD RPC URL:', this.network.rpc);
            console.log('Chain ID:', this.network.chainId);
            console.log('Wallet Address:', this.wallet.address);
            
            // Test connection to verify it's working
            this.provider.getBlockNumber()
                .then(blockNumber => {
                    console.log(`Successfully connected to Monad network. Current block: ${blockNumber}`);
                })
                .catch(error => {
                    console.warn(`Warning: Could not get block number: ${error.message}`);
                });
        } catch (error) {
            console.error('MONAD Integration initialization error:', error);
            throw new Error(`MONAD initialization failed: ${error.message}`);
        }
    }

    /**
     * Get the balance of the wallet's native MONAD tokens
     */
    async getNativeBalance() {
        try {
            const balance = await this.provider.getBalance(this.wallet.address);
            return {
                raw: balance,
                formatted: ethers.formatEther(balance),
                symbol: this.network.nativeCurrency
            };
        } catch (error) {
            console.error('Error getting MONAD balance:', error);
            throw new Error(`Failed to get MONAD balance: ${error.message}`);
        }
    }

    /**
     * Get the balance of a specific token on MONAD testnet
     */
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
     * Scan for all tokens owned by the user's wallet
     * Uses BlockVision API for accurate token discovery when API key is provided,
     * falls back to direct token contract queries otherwise
     * @param {boolean} includeZeroBalances - Whether to include tokens with zero balances
     * @returns {Promise<Array>} - Array of token details
     */
    async scanAllTokens(includeZeroBalances = false) {
        console.log(`Scanning for all tokens in wallet ${this.wallet.address}...`);
        
        // Try to use BlockVision API if available
        try {
            // Check if BlockVision API is available (requires API key setup in .env or config)
            const BlockVisionAPI = require('./blockVisionAPI');
            const apiKey = process.env.BLOCKVISION_API_KEY || BOT_CONFIG.BLOCKVISION_API_KEY;
            
            if (apiKey && apiKey !== '') {
                console.log('Using BlockVision API for token discovery');
                const api = new BlockVisionAPI(apiKey);
                const tokensData = await api.getAccountTokens(this.wallet.address);
                const formattedTokens = api.formatTokensForApp(tokensData);
                
                if (formattedTokens && formattedTokens.length > 0) {
                    console.log(`Found ${formattedTokens.length} tokens via BlockVision API`);
                    return formattedTokens;
                } else {
                    console.log('No tokens found via BlockVision API, falling back to direct scanning');
                }
            } else {
                console.log('BlockVision API key not found, falling back to direct scanning');
            }
        } catch (error) {
            console.warn('BlockVision API not available or error occurred:', error.message);
            console.log('Falling back to direct token scanning');
        }
        
        // If we're here, we need to use the DirectTokenScanner
        try {
            const DirectTokenScanner = require('./directTokenScanner');
            const scanner = new DirectTokenScanner(this.provider, this.wallet.address);
            
            console.log('Using DirectTokenScanner for token discovery...');
            
            // Get all known token addresses from the config
            const knownTokenAddresses = Object.values(this.network.tokens).map(token => token.address);
            
            // First scan known tokens from config
            const knownTokens = await scanner.scanCommonTokens(knownTokenAddresses);
            console.log(`Found ${knownTokens.length} known tokens`);
            
            // Add some popular tokens that might not be in the config
            // This is a list of tokens that are popular on Monad - add actual addresses here
            const popularTokens = [
                '0xB5a30b0FDc5EA94A52fDc42e3E9760Cb8449Fb37', // WETH 
                '0xcf5a6076cfa32686c0Df13aBaDa2b40dec133F1d', // WBTC
                '0xf817257fed379853cDe0fa4F97AB987181B1E5Ea', // USDC
                '0x88b8E2161DEDC77EF4ab7585569D2415a1C1055D', // USDT
                '0x5387C85A4965769f6B0Df430638a1388493486F1'  // WSOL
                // Add more popular token addresses here
            ];
            
            // Filter out duplicates
            const additionalTokens = popularTokens.filter(
                addr => !knownTokenAddresses.some(
                    known => known.toLowerCase() === addr.toLowerCase()
                )
            );
            
            // Scan additional popular tokens
            const popularResults = await scanner.scanCommonTokens(additionalTokens);
            console.log(`Found ${popularResults.length} additional popular tokens`);
            
            // Combine results
            let allTokens = [...knownTokens, ...popularResults];
            
            // If we have few tokens or user specifically wants all tokens, scan transactions
            if (allTokens.length < 5 || includeZeroBalances) {
                console.log('Scanning transaction history for more tokens...');
                try {
                    const txTokens = await scanner.scanRecentTransactions(2000);
                    console.log(`Found ${txTokens.length} tokens from transaction history`);
                    
                    // Filter out duplicates before adding
                    const newTxTokens = txTokens.filter(txToken => 
                        !allTokens.some(existing => 
                            existing.address.toLowerCase() === txToken.address.toLowerCase()
                        )
                    );
                    
                    allTokens = [...allTokens, ...newTxTokens];
                } catch (txError) {
                    console.warn('Error scanning transaction history:', txError.message);
                }
            }
            
            // Filter based on balance if needed
            if (!includeZeroBalances) {
                allTokens = allTokens.filter(token => {
                    const balanceNum = parseFloat(token.balance.formatted);
                    return balanceNum > 0;
                });
            }
            
            console.log(`Returning ${allTokens.length} total tokens`);
            return allTokens;
            
        } catch (fallbackError) {
            console.error('Error with DirectTokenScanner:', fallbackError);
            
            // Last resort - just return the known tokens from config
            const knownTokenAddresses = Object.values(this.network.tokens).map(token => token.address);
            const results = [];
            
            try {
                // First check the predefined tokens from our config
                const tokenPromises = knownTokenAddresses.map(async (tokenAddress) => {
                    try {
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
                
                console.log(`Found ${results.length} tokens from known token addresses`);
                return results;
            } catch (error) {
                console.error('Error scanning for tokens:', error);
                throw new Error(`Failed to scan for tokens: ${error.message}`);
            }
        }
    }

    /**
     * Approve a token for spending by the router
     */
    async approveToken(tokenAddress, amount) {
        try {
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ERC20_ABI,
                this.wallet
            );
            
            const decimals = await tokenContract.decimals();
            const amountInWei = ethers.parseUnits(amount.toString(), decimals);
            
            const tx = await tokenContract.approve(
                this.network.addresses.ROUTER,
                amountInWei
            );
            
            return await tx.wait();
        } catch (error) {
            console.error('Error approving token:', error);
            throw new Error(`Failed to approve token: ${error.message}`);
        }
    }

    /**
     * Swap native MONAD for a token
     * @param {string} tokenAddress - Address of the token to swap to
     * @param {string} amount - Amount of MON to swap
     * @param {number} slippage - Slippage tolerance percentage
     * @param {function} progressCallback - Optional callback for progress updates
     * @returns {Promise<object>} - Transaction details
     */
    async swapMonadForToken(tokenAddress, amount, slippage = 0.5, progressCallback = null) {
        try {
            const updateProgress = (stage, message, data = null) => {
                console.log(`${stage}: ${message}`);
                if (progressCallback) {
                    progressCallback(stage, message, data);
                }
            };
            
            updateProgress('INIT', `Preparing to swap ${amount} MON for tokens at ${tokenAddress}`);
            
            // Validate token address
            if (!ethers.isAddress(tokenAddress)) {
                throw new Error('Invalid token address');
            }
            
            // Parse the amount to wei
            let amountInWei;
            try {
                amountInWei = ethers.parseEther(amount.toString());
                updateProgress('AMOUNT', `Amount in wei: ${amountInWei}`);
            } catch (error) {
                throw new Error(`Invalid amount format: ${error.message}`);
            }
            
            // Check if we have enough balance
            updateProgress('BALANCE', 'Checking wallet balance...');
            const balance = await this.provider.getBalance(this.wallet.address);
            
            if (balance < amountInWei) {
                throw new Error(`Insufficient balance. You have ${ethers.formatEther(balance)} MON but tried to swap ${amount} MON`);
            }
            
            // Get token details
            updateProgress('TOKEN', 'Getting token details...');
            let tokenSymbol = "Unknown";
            let tokenDecimals = 18;
            let tokenName = "Unknown Token";
            
            try {
                const tokenContract = new ethers.Contract(tokenAddress, ERC20_ABI, this.provider);
                tokenSymbol = await tokenContract.symbol();
                tokenDecimals = await tokenContract.decimals();
                tokenName = await tokenContract.name();
                updateProgress('TOKEN', `Token details: ${tokenName} (${tokenSymbol}), ${tokenDecimals} decimals`);
            } catch (error) {
                updateProgress('WARNING', `Could not get token details for ${tokenAddress}: ${error.message}`);
            }
            
            // Set up the swap path and deadline
            const path = [this.network.addresses.WETH, tokenAddress];
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
            
            updateProgress('QUOTE', 'Getting price quote...');
            
            // Get expected output amount
            let amounts;
            try {
                amounts = await this.routerContract.getAmountsOut(amountInWei, path);
                updateProgress('QUOTE', `Expected output: ${ethers.formatUnits(amounts[1], tokenDecimals)} ${tokenSymbol}`);
            } catch (error) {
                throw new Error(`Failed to get swap quote: ${error.message}`);
            }
            
            // Calculate minimum amount with slippage
            const slippageBasisPoints = Math.floor(slippage * 100);
            const amountOutMin = amounts[1] - (amounts[1] * BigInt(slippageBasisPoints) / BigInt(10000));
            
            updateProgress('SLIPPAGE', `Amount out minimum (with ${slippage}% slippage): ${ethers.formatUnits(amountOutMin, tokenDecimals)} ${tokenSymbol}`);
            
            // Calculate price impact
            const priceImpact = this.calculatePriceImpact(amountInWei, amounts[1], tokenDecimals);
            updateProgress('IMPACT', `Estimated price impact: ${priceImpact.toFixed(2)}%`, { priceImpact });
            
            // High price impact warning
            if (priceImpact > 5) {
                updateProgress('WARNING', `High price impact detected (${priceImpact.toFixed(2)}%). This may result in a significant loss of funds.`);
            }
            
            // Estimate gas for the swap to ensure the transaction can proceed
            updateProgress('GAS', 'Estimating gas...');
            let gasEstimate;
            
            try {
                gasEstimate = await this.routerContract.swapExactETHForTokens.estimateGas(
                    amountOutMin,
                    path,
                    this.wallet.address,
                    deadline,
                    { value: amountInWei }
                );
                updateProgress('GAS', `Gas estimate for swap: ${gasEstimate}`);
            } catch (error) {
                console.error('Gas estimation failed:', error);
                throw new Error(`Swap transaction is likely to fail: ${error.message}`);
            }
            
            updateProgress('EXECUTE', 'Executing swap transaction...');
            
            // Add 20% buffer to gas estimate for safety
            const gasLimit = Math.floor(Number(gasEstimate) * 1.2); 
            
            try {
                const tx = await this.routerContract.swapExactETHForTokens(
                    amountOutMin,
                    path,
                    this.wallet.address,
                    deadline,
                    { 
                        value: amountInWei,
                        gasLimit
                    }
                );
                
                updateProgress('SUBMITTED', `Transaction submitted. Hash: ${tx.hash}`, { hash: tx.hash });
                
                // Wait for transaction confirmation
                updateProgress('PENDING', 'Waiting for transaction confirmation...', { hash: tx.hash });
                
                const receipt = await tx.wait();
                
                if (receipt.status === 1) {
                    updateProgress('CONFIRMED', 'Transaction confirmed successfully!', { receipt });
                    
                    // Format a detailed transaction receipt
                    const formattedReceipt = {
                        hash: tx.hash,
                        status: 'SUCCESS',
                        from: this.wallet.address,
                        to: this.network.addresses.ROUTER,
                        tokenBought: {
                            address: tokenAddress,
                            symbol: tokenSymbol,
                            name: tokenName
                        },
                        amountIn: {
                            raw: amountInWei.toString(),
                            formatted: amount
                        },
                        amountOut: {
                            raw: amounts[1].toString(),
                            formatted: ethers.formatUnits(amounts[1], tokenDecimals)
                        },
                        priceImpact: priceImpact,
                        transactionFee: {
                            gas: receipt.gasUsed.toString(),
                            gasPrice: receipt.gasPrice ? receipt.gasPrice.toString() : 'unknown',
                            total: receipt.gasUsed && receipt.gasPrice 
                                ? ethers.formatEther(receipt.gasUsed * receipt.gasPrice) + ' MON'
                                : 'unknown'
                        },
                        explorerUrl: this.getTransactionExplorerUrl(tx.hash)
                    };
                    
                    return formattedReceipt;
                } else {
                    updateProgress('FAILED', 'Transaction failed', { receipt });
                    throw new Error('Transaction failed');
                }
            } catch (error) {
                // Handle common errors with user-friendly messages
                const errorMessage = this.parseSwapError(error);
                updateProgress('ERROR', errorMessage, { error });
                throw new Error(errorMessage);
            }
        } catch (error) {
            console.error('Error in swapMonadForToken:', error);
            
            // Enhance the error message for user display
            let userFriendlyError = 'Swap failed: ';
            
            if (error.message.includes('insufficient funds')) {
                userFriendlyError += 'You do not have enough MON to complete this transaction.';
            } else if (error.message.includes('execution reverted')) {
                userFriendlyError += 'The transaction was rejected by the blockchain. This could be due to slippage or contract issues.';
            } else if (error.message.includes('timeout')) {
                userFriendlyError += 'Network timeout. Please try again when the blockchain is less congested.';
            } else {
                userFriendlyError += error.message;
            }
            
            throw new Error(userFriendlyError);
        }
    }

    /**
     * Calculate price impact of a swap
     * @private
     * @param {BigInt} amountIn - Input amount in wei
     * @param {BigInt} amountOut - Output amount in smallest unit
     * @param {number} decimals - Decimals of output token
     * @returns {number} - Price impact percentage
     */
    calculatePriceImpact(amountIn, amountOut, decimals) {
        try {
            // This is a simplified price impact calculation
            // For more accuracy, we would need to compare to the "ideal" price from an oracle
            const inputValueInETH = amountIn;
            const outputValueInETH = amountOut; // Simplified - assuming 1:1 with decimals adjustment
            
            // Convert to comparable units
            const ethDecimals = 18;
            const adjustedOutput = outputValueInETH * (10n ** BigInt(ethDecimals - decimals));
            
            // Calculate impact
            if (adjustedOutput > 0) {
                const idealOutput = inputValueInETH; // Simplified - assumes 1:1 swap in perfect conditions
                const impact = ((idealOutput - adjustedOutput) * 10000n) / idealOutput;
                return Number(impact) / 100; // Convert to percentage
            }
            return 0;
        } catch (error) {
            console.error('Error calculating price impact:', error);
            return 0; // Default to 0 in case of error
        }
    }
    
    /**
     * Parse swap errors into user-friendly messages
     * @private
     * @param {Error} error - Original error object
     * @returns {string} - User-friendly error message
     */
    parseSwapError(error) {
        const errorMessage = error.message || '';
        
        // Common Uniswap / Sushiswap errors
        if (errorMessage.includes('INSUFFICIENT_OUTPUT_AMOUNT')) {
            return 'Swap failed due to high price impact or slippage. Try increasing slippage tolerance or reducing amount.';
        }
        
        if (errorMessage.includes('EXCESSIVE_INPUT_AMOUNT')) {
            return 'Swap failed due to unusual input amount configuration. Try a different amount.';
        }
        
        if (errorMessage.includes('TRANSFER_FAILED')) {
            return 'Token transfer failed. The token contract may have restrictions or you have insufficient balance.';
        }
        
        if (errorMessage.includes('K')) {
            return 'Swap failed due to liquidity pool constraints. Try a smaller amount or different trading pair.';
        }
        
        if (errorMessage.includes('expired')) {
            return 'Transaction deadline expired. Try again with a new transaction.';
        }
        
        if (errorMessage.includes('out of gas')) {
            return 'Transaction ran out of gas. Try increasing gas limit in settings.';
        }
        
        // Network errors
        if (
            errorMessage.includes('timeout') ||
            errorMessage.includes('timed out') ||
            errorMessage.includes('Timeout')
        ) {
            return 'Network timeout. The blockchain network may be congested. Try again later.';
        }
        
        if (
            errorMessage.includes('nonce') ||
            errorMessage.includes('Nonce')
        ) {
            return 'Transaction nonce error. Your previous transaction may still be pending.';
        }
        
        // If no specific error matched, return the original message
        return `Swap failed: ${errorMessage}`;
    }

    /**
     * Swap a token for native MONAD
     */
    async swapTokenForMonad(tokenAddress, amount, slippage = 0.5) {
        try {
            console.log(`Swapping ${amount} tokens at ${tokenAddress} for MON, slippage: ${slippage}%`);
            
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ERC20_ABI,
                this.wallet
            );
            
            const decimals = await tokenContract.decimals();
            const symbol = await tokenContract.symbol();
            const amountInWei = ethers.parseUnits(amount.toString(), decimals);
            
            // Check token balance
            const balance = await tokenContract.balanceOf(this.wallet.address);
            if (balance < amountInWei) {
                const formattedBalance = ethers.formatUnits(balance, decimals);
                throw new Error(`Insufficient ${symbol} balance. You have ${formattedBalance} ${symbol} but tried to swap ${amount} ${symbol}`);
            }
            
            // Check and approve if needed
            console.log('Checking token allowance...');
            const allowance = await tokenContract.allowance(this.wallet.address, this.network.addresses.ROUTER);
            
            if (allowance < amountInWei) {
                console.log(`Approving ${amount} ${symbol} for swap...`);
                const approveTx = await this.approveToken(tokenAddress, amount);
                console.log('Token approved for swap:', approveTx.hash);
            } else {
                console.log('Token already approved for swap');
            }
            
            const path = [tokenAddress, this.network.addresses.WETH];
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
            
            console.log('Getting amounts out...');
            // Get expected output amount
            const amounts = await this.routerContract.getAmountsOut(amountInWei, path);
            console.log(`Expected output: ${ethers.formatEther(amounts[1])} MON`);
            
            // Calculate minimum amount with slippage
            const slippageBasisPoints = BigInt(Math.floor(slippage * 100));
            const amountOutMin = amounts[1] - (amounts[1] * slippageBasisPoints / BigInt(10000));
            
            console.log(`Amount out minimum (with ${slippage}% slippage): ${ethers.formatEther(amountOutMin)} MON`);
            console.log('Executing swap...');
            
            // Estimate gas for the swap to ensure the transaction can proceed
            let gasEstimate;
            try {
                gasEstimate = await this.routerContract.swapExactTokensForETH.estimateGas(
                    amountInWei,
                    amountOutMin,
                    path,
                    this.wallet.address,
                    deadline
                );
                console.log(`Gas estimate for swap: ${gasEstimate}`);
            } catch (error) {
                console.error('Gas estimation failed:', error);
                throw new Error(`Swap transaction is likely to fail: ${error.message}`);
            }
            
            const tx = await this.routerContract.swapExactTokensForETH(
                amountInWei,
                amountOutMin,
                path,
                this.wallet.address,
                deadline,
                { 
                    gasLimit: Math.floor(Number(gasEstimate) * 1.2) // Add 20% buffer to gas estimate
                }
            );
            
            console.log(`Transaction submitted. Hash: ${tx.hash}`);
            console.log('Waiting for transaction confirmation...');
            
            const receipt = await tx.wait();
            console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
            
            // Calculate the received amount
            const receivedAmount = ethers.formatEther(amounts[1]);
            
            return {
                hash: tx.hash,
                blockNumber: receipt.blockNumber,
                fromToken: symbol,
                toToken: 'MON',
                fromAmount: amount,
                toAmount: receivedAmount,
                status: receipt.status === 1 ? 'success' : 'failed',
                explorerUrl: `${this.network.blockExplorerUrl}/tx/${tx.hash}`
            };
        } catch (error) {
            console.error('Error swapping token for MONAD:', error);
            throw new Error(`Failed to swap token for MONAD: ${error.message}`);
        }
    }

    /**
     * Swap one token for another token
     */
    async swapTokenForToken(fromTokenAddress, toTokenAddress, amount, slippage = 0.5) {
        try {
            console.log(`Swapping ${amount} tokens from ${fromTokenAddress} to ${toTokenAddress}, slippage: ${slippage}%`);
            
            // Get token details for input token
            const fromTokenContract = new ethers.Contract(
                fromTokenAddress,
                ERC20_ABI,
                this.wallet
            );
            
            const fromDecimals = await fromTokenContract.decimals();
            const fromSymbol = await fromTokenContract.symbol();
            const amountInWei = ethers.parseUnits(amount.toString(), fromDecimals);
            
            // Get token details for output token
            const toTokenContract = new ethers.Contract(
                toTokenAddress,
                ERC20_ABI,
                this.provider
            );
            
            const toDecimals = await toTokenContract.decimals();
            const toSymbol = await toTokenContract.symbol();
            
            // Check token balance
            const balance = await fromTokenContract.balanceOf(this.wallet.address);
            if (balance < amountInWei) {
                const formattedBalance = ethers.formatUnits(balance, fromDecimals);
                throw new Error(`Insufficient ${fromSymbol} balance. You have ${formattedBalance} ${fromSymbol} but tried to swap ${amount} ${fromSymbol}`);
            }
            
            // Check and approve if needed
            console.log('Checking token allowance...');
            const allowance = await fromTokenContract.allowance(this.wallet.address, this.network.addresses.ROUTER);
            
            if (allowance < amountInWei) {
                console.log(`Approving ${amount} ${fromSymbol} for swap...`);
                const approveTx = await this.approveToken(fromTokenAddress, amount);
                console.log('Token approved for swap:', approveTx.hash);
            } else {
                console.log('Token already approved for swap');
            }
            
            const path = [fromTokenAddress, toTokenAddress];
            const deadline = Math.floor(Date.now() / 1000) + 60 * 20; // 20 minutes
            
            console.log('Getting amounts out...');
            
            // Get expected output amount
            const amounts = await this.routerContract.getAmountsOut(amountInWei, path);
            console.log(`Expected output: ${ethers.formatUnits(amounts[1], toDecimals)} ${toSymbol}`);
            
            // Calculate minimum amount with slippage
            const slippageBasisPoints = BigInt(Math.floor(slippage * 100));
            const amountOutMin = amounts[1] - (amounts[1] * slippageBasisPoints / BigInt(10000));
            
            console.log(`Amount out minimum (with ${slippage}% slippage): ${ethers.formatUnits(amountOutMin, toDecimals)} ${toSymbol}`);
            console.log('Executing swap...');
            
            // Estimate gas for the swap to ensure the transaction can proceed
            let gasEstimate;
            try {
                gasEstimate = await this.routerContract.swapExactTokensForTokens.estimateGas(
                    amountInWei,
                    amountOutMin,
                    path,
                    this.wallet.address,
                    deadline
                );
                console.log(`Gas estimate for swap: ${gasEstimate}`);
            } catch (error) {
                console.error('Gas estimation failed:', error);
                throw new Error(`Swap transaction is likely to fail: ${error.message}`);
            }
            
            const tx = await this.routerContract.swapExactTokensForTokens(
                amountInWei,
                amountOutMin,
                path,
                this.wallet.address,
                deadline,
                { 
                    gasLimit: Math.floor(Number(gasEstimate) * 1.2) // Add 20% buffer to gas estimate
                }
            );
            
            console.log(`Transaction submitted. Hash: ${tx.hash}`);
            console.log('Waiting for transaction confirmation...');
            
            const receipt = await tx.wait();
            console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
            
            // Calculate the received amount from transaction logs if possible
            let receivedAmount;
            try {
                // For simplicity, use the quoted amount as an approximation
                receivedAmount = ethers.formatUnits(amounts[1], toDecimals); 
            } catch (error) {
                console.error('Error parsing received amount:', error);
                receivedAmount = 'Unknown';
            }
            
            return {
                hash: tx.hash,
                blockNumber: receipt.blockNumber,
                fromToken: fromSymbol,
                toToken: toSymbol,
                fromAmount: amount,
                toAmount: receivedAmount,
                status: receipt.status === 1 ? 'success' : 'failed',
                explorerUrl: `${this.network.blockExplorerUrl}/tx/${tx.hash}`
            };
        } catch (error) {
            console.error('Error swapping token for token:', error);
            throw new Error(`Failed to swap token for token: ${error.message}`);
        }
    }

    /**
     * Get quote for a swap (preview the swap)
     */
    async getSwapQuote(fromTokenAddress, toTokenAddress, amount) {
        try {
            console.log(`Getting swap quote: ${amount} from ${fromTokenAddress} to ${toTokenAddress}`);
            
            // Get token details for input token
            let fromDecimals = 18; // Default for native token
            let fromSymbol = 'MON';
            let amountInWei;
            
            if (fromTokenAddress.toLowerCase() !== this.network.addresses.WETH.toLowerCase()) {
                try {
                    const fromTokenContract = new ethers.Contract(
                        fromTokenAddress,
                        ERC20_ABI,
                        this.provider
                    );
                    fromDecimals = await fromTokenContract.decimals();
                    fromSymbol = await fromTokenContract.symbol();
                } catch (error) {
                    console.error(`Error getting details for token ${fromTokenAddress}:`, error);
                    throw new Error(`Invalid 'from' token address: ${error.message}`);
                }
            }
            
            // Parse input amount to wei
            amountInWei = ethers.parseUnits(amount.toString(), fromDecimals);
            
            // Get token details for output token
            let toDecimals = 18; // Default for native token
            let toSymbol = 'MON';
            
            if (toTokenAddress.toLowerCase() !== this.network.addresses.WETH.toLowerCase()) {
                try {
                    const toTokenContract = new ethers.Contract(
                        toTokenAddress,
                        ERC20_ABI,
                        this.provider
                    );
                    toDecimals = await toTokenContract.decimals();
                    toSymbol = await toTokenContract.symbol();
                } catch (error) {
                    console.error(`Error getting details for token ${toTokenAddress}:`, error);
                    throw new Error(`Invalid 'to' token address: ${error.message}`);
                }
            }
            
            // Create path and get amounts out
            const path = [fromTokenAddress, toTokenAddress];
            console.log(`Fetching amounts out with path: ${path}`);
            const amounts = await this.routerContract.getAmountsOut(amountInWei, path);
            console.log(`Amounts out: ${amounts[0]} -> ${amounts[1]}`);
            
            // Format output amounts
            const fromAmount = ethers.formatUnits(amounts[0], fromDecimals);
            const toAmount = ethers.formatUnits(amounts[1], toDecimals);
            
            console.log(`Formatted quote: ${fromAmount} ${fromSymbol} -> ${toAmount} ${toSymbol}`);
            
            // Calculate rate
            const rate = parseFloat(toAmount) / parseFloat(fromAmount);
            console.log(`Rate: 1 ${fromSymbol} = ${rate} ${toSymbol}`);
            
            return {
                fromToken: fromSymbol,
                toToken: toSymbol,
                fromAmount,
                toAmount,
                rate: rate.toString(),
                fromDecimals,
                toDecimals
            };
        } catch (error) {
            console.error('Error getting swap quote:', error);
            throw new Error(`Failed to get swap quote: ${error.message}`);
        }
    }

    /**
     * Send native MONAD tokens to an address
     */
    async sendNative(toAddress, amount) {
        try {
            console.log(`Sending ${amount} MON to ${toAddress}`);
            
            // Validate the address
            if (!ethers.isAddress(toAddress)) {
                throw new Error('Invalid recipient address');
            }
            
            // Parse the amount to wei
            let amountInWei;
            try {
                amountInWei = ethers.parseEther(amount.toString());
            } catch (error) {
                throw new Error(`Invalid amount format: ${error.message}`);
            }
            
            // Check if we have enough balance
            const balance = await this.provider.getBalance(this.wallet.address);
            if (balance < amountInWei) {
                throw new Error(`Insufficient balance. You have ${ethers.formatEther(balance)} MON but tried to send ${amount} MON`);
            }
            
            // Estimate gas to ensure the transaction can proceed
            const gasEstimate = await this.provider.estimateGas({
                to: toAddress,
                value: amountInWei
            });
            
            console.log(`Gas estimate for send: ${gasEstimate}`);
            
            const tx = await this.wallet.sendTransaction({
                to: toAddress,
                value: amountInWei,
                gasLimit: Math.floor(Number(gasEstimate) * 1.2) // Add 20% buffer to gas estimate
            });
            
            console.log(`Transaction hash: ${tx.hash}`);
            console.log('Waiting for transaction confirmation...');
            
            const receipt = await tx.wait();
            console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
            
            return {
                hash: tx.hash,
                blockNumber: receipt.blockNumber,
                from: this.wallet.address,
                to: toAddress,
                amount: amount,
                status: receipt.status === 1 ? 'success' : 'failed',
                explorerUrl: `${this.network.blockExplorerUrl}/tx/${tx.hash}`
            };
        } catch (error) {
            console.error('Error sending MONAD:', error);
            throw new Error(`Failed to send MONAD: ${error.message}`);
        }
    }

    /**
     * Send tokens to an address
     */
    async sendToken(tokenAddress, toAddress, amount) {
        try {
            console.log(`Sending ${amount} tokens from ${tokenAddress} to ${toAddress}`);
            
            // Validate the recipient address
            if (!ethers.isAddress(toAddress)) {
                throw new Error('Invalid recipient address');
            }
            
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ERC20_ABI,
                this.wallet
            );
            
            // Get token info for proper formatting
            let decimals, symbol;
            try {
                decimals = await tokenContract.decimals();
                symbol = await tokenContract.symbol();
                console.log(`Token details: ${symbol}, ${decimals} decimals`);
            } catch (error) {
                console.error('Error getting token details:', error);
                throw new Error(`Invalid token address or contract: ${error.message}`);
            }
            
            // Parse amount to token units
            let amountInWei;
            try {
                amountInWei = ethers.parseUnits(amount.toString(), decimals);
                console.log(`Amount in wei: ${amountInWei} (${amount} ${symbol})`);
            } catch (error) {
                throw new Error(`Invalid amount format: ${error.message}`);
            }
            
            // Check if we have enough balance
            const balance = await tokenContract.balanceOf(this.wallet.address);
            if (balance < amountInWei) {
                const formattedBalance = ethers.formatUnits(balance, decimals);
                throw new Error(`Insufficient ${symbol} balance. You have ${formattedBalance} ${symbol} but tried to send ${amount} ${symbol}`);
            }
            
            // Estimate gas for the transfer to ensure the transaction can proceed
            let gasEstimate;
            try {
                gasEstimate = await tokenContract.transfer.estimateGas(toAddress, amountInWei);
                console.log(`Gas estimate for token transfer: ${gasEstimate}`);
            } catch (error) {
                console.error('Gas estimation failed:', error);
                throw new Error(`Transaction is likely to fail: ${error.message}`);
            }
            
            console.log(`Sending ${amount} ${symbol} (${amountInWei.toString()} wei) to ${toAddress}`);
            const tx = await tokenContract.transfer(
                toAddress, 
                amountInWei, 
                { 
                    gasLimit: Math.floor(Number(gasEstimate) * 1.2) // Add 20% buffer to gas estimate
                }
            );
            
            console.log(`Transaction hash: ${tx.hash}`);
            console.log('Waiting for transaction confirmation...');
            
            const receipt = await tx.wait();
            console.log(`Transaction confirmed in block ${receipt.blockNumber}`);
            
            return {
                hash: tx.hash,
                blockNumber: receipt.blockNumber,
                from: this.wallet.address,
                to: toAddress,
                tokenAddress: tokenAddress,
                tokenSymbol: symbol,
                amount: amount,
                status: receipt.status === 1 ? 'success' : 'failed',
                explorerUrl: `${this.network.blockExplorerUrl}/tx/${tx.hash}`
            };
        } catch (error) {
            console.error('Error sending token:', error);
            throw new Error(`Failed to send token: ${error.message}`);
        }
    }

    /**
     * Get transaction receipt from transaction hash
     */
    async getTransactionReceipt(txHash) {
        try {
            return await this.provider.getTransactionReceipt(txHash);
        } catch (error) {
            console.error('Error getting transaction receipt:', error);
            throw new Error(`Failed to get transaction receipt: ${error.message}`);
        }
    }

    /**
     * Get transaction URL for block explorer
     */
    getTransactionExplorerUrl(txHash) {
        return `${this.network.blockExplorerUrl}/tx/${txHash}`;
    }

    /**
     * Get address URL for block explorer
     */
    getAddressExplorerUrl(address) {
        return `${this.network.blockExplorerUrl}/address/${address}`;
    }
}

module.exports = MonadIntegration; 