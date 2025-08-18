const WhitelistErrorHandler = require('./whitelistErrorHandler');

/**
 * WhitelistMiddleware - Telegram bot middleware for address-based access control with NFT verification
 */
class WhitelistMiddleware {
    constructor(whitelistManager, walletManager, monitor = null, nftChecker = null) {
        this.whitelistManager = whitelistManager;
        this.walletManager = walletManager;
        this.nftChecker = nftChecker; // New NFT checker instance
        this.errorHandler = new WhitelistErrorHandler();
        this.monitor = monitor;

        // Commands that bypass whitelist check
        this.bypassCommands = [
            '/start',
            '/help',
            'start',
            'help'
        ];

        // Admin commands that require special handling
        this.adminCommands = [
            '/whitelist_add',
            '/whitelist_remove',
            '/whitelist_list',
            '/whitelist_stats',
            'whitelist_add',
            'whitelist_remove',
            'whitelist_list',
            'whitelist_stats'
        ];

        // Cache for user access status to reduce repeated checks
        this.accessCache = new Map();
        this.cacheTimeout = 5 * 60 * 1000; // 5 minutes

        // NFT verification cache (longer timeout since NFTs change less frequently)
        this.nftCache = new Map();
        this.nftCacheTimeout = 15 * 60 * 1000; // 15 minutes

        // Rate limiting for failed access attempts
        this.failedAttempts = new Map();
        this.maxFailedAttempts = 5;
        this.failedAttemptWindow = 15 * 60 * 1000; // 15 minutes

        // Monitoring
        this.accessStats = {
            totalRequests: 0,
            authorizedRequests: 0,
            deniedRequests: 0,
            errorRequests: 0,
            bypassedRequests: 0,
            nftVerified: 0,
            nftDenied: 0
        };
    }

    /**
     * Check if user has been NFT verified (for users without wallets yet)
     * @param {string} userId - User ID to check
     * @returns {object} - NFT verification result
     */
    async checkUserNFTVerification(userId) {
        try {
            // Use the new utility function instead of the old one
            const { checkUserAccess } = require('../utils/user');
            const accessInfo = await checkUserAccess(userId);

            console.log(`User access check for ${userId}:`, {
                hasAccess: accessInfo.hasAccess,
                hasWallet: accessInfo.hasWallet,
                hasNFTVerification: accessInfo.hasNFTVerification,
                walletAddress: accessInfo.walletAddress,
                nftVerificationAddress: accessInfo.nftVerificationAddress
            });

            if (accessInfo.hasNFTVerification) {
                return {
                    hasAccess: true,
                    verifiedAddress: accessInfo.nftVerificationAddress,
                    nftCount: accessInfo.user.nft_count || 1,
                    verifiedAt: accessInfo.user.nft_verification_date,
                    reason: 'nft_verified'
                };
            }

            return {
                hasAccess: false,
                reason: 'not_nft_verified'
            };

        } catch (error) {
            console.error('Error checking user NFT verification:', error);

            // More specific error handling
            if (error.message.includes('already associated')) {
                return {
                    hasAccess: false,
                    reason: 'wallet_conflict',
                    error: error.message
                };
            }

            return {
                hasAccess: false,
                reason: 'verification_check_error',
                error: error.message
            };
        }
    }

    /**
     * Get the middleware function for Telegraf bot
     * @returns {Function} - Telegraf middleware function
     */
    middleware() {
        return async (ctx, next) => {
            const startTime = Date.now();
            this.accessStats.totalRequests++;

            try {
                // Check if this command should bypass whitelist
                if (this.shouldSkipWhitelistCheck(ctx)) {
                    this.accessStats.bypassedRequests++;
                    return await next();
                }

                // Check rate limiting for failed attempts
                if (this.isRateLimited(ctx)) {
                    this.accessStats.deniedRequests++;
                    await this.handleRateLimitExceeded(ctx);
                    return;
                }

                // Check user access with enhanced error handling
                const accessResult = await this.checkUserAccessEnhanced(ctx);

                if (accessResult.hasAccess) {
                    // User is authorized, proceed to next middleware/handler
                    this.accessStats.authorizedRequests++;
                    this.clearFailedAttempts(ctx);

                    // Update stats based on access method
                    if (accessResult.accessMethod === 'nft') {
                        this.accessStats.nftVerified++;
                    }

                    // Log successful access
                    if (this.monitor) {
                        await this.monitor.logAccessAttempt(
                            ctx.from.id,
                            ctx.from.username,
                            accessResult.details?.address,
                            true,
                            Date.now() - startTime,
                            accessResult.accessMethod
                        );
                    }

                    return await next();
                } else {
                    // User is not authorized, handle unauthorized access
                    this.accessStats.deniedRequests++;
                    this.recordFailedAttempt(ctx);

                    // Update stats based on denial reason
                    if (accessResult.reason === 'no_nft' || accessResult.reason === 'nft_check_failed') {
                        this.accessStats.nftDenied++;
                    }

                    // Log denied access
                    if (this.monitor) {
                        await this.monitor.logAccessAttempt(
                            ctx.from.id,
                            ctx.from.username,
                            accessResult.details?.address,
                            false,
                            Date.now() - startTime,
                            null,
                            accessResult.reason
                        );
                    }

                    await this.handleUnauthorizedAccessEnhanced(ctx, accessResult);
                    return; // Stop processing
                }

            } catch (error) {
                this.accessStats.errorRequests++;
                console.error('Error in whitelist middleware:', error);

                // Enhanced error handling
                const userMessage = this.errorHandler.formatUserError(error, 'Access verification');

                try {
                    await ctx.reply(
                        `⚠️ ${userMessage}`,
                        { parse_mode: 'Markdown' }
                    );
                } catch (replyError) {
                    console.error('Failed to send error message to user:', replyError);
                }

                return;
            } finally {
                // Log performance metrics
                const duration = Date.now() - startTime;
                if (duration > 1000) {
                    console.warn(`Slow whitelist check: ${duration}ms for user ${ctx.from?.id}`);
                }
            }
        };
    }

    /**
     * Enhanced user access checking with NFT verification
     * @param {object} ctx - Telegraf context
     * @returns {object} - Detailed access result
     */
    async checkUserAccessEnhanced(ctx) {
        const result = {
            hasAccess: false,
            reason: 'unknown',
            details: {},
            timestamp: Date.now(),
            accessMethod: null
        };

        try {
            const userId = ctx.from.id.toString();

            // Check cache first
            const cacheKey = userId;
            const cachedResult = this.accessCache.get(cacheKey);
            if (cachedResult && (Date.now() - cachedResult.timestamp) < this.cacheTimeout) {
                return {
                    ...cachedResult,
                    fromCache: true
                };
            }

            // Check if whitelist manager is available and initialized
            if (!this.whitelistManager || !this.whitelistManager.initialized) {
                result.reason = 'system_not_ready';
                result.details.message = 'Whitelist system is not ready';
                return result;
            }

            // Check if user has a wallet
            const hasWallet = await this.walletManager.hasWallet(userId);
            if (!hasWallet) {
                // User has no wallet - check if they have NFT verification
                const nftVerification = await this.checkUserNFTVerification(userId);
                if (nftVerification.hasAccess) {
                    result.hasAccess = true;
                    result.reason = 'nft_pre_verified';
                    result.accessMethod = 'nft_verification';
                    result.details.message = `Pre-verified NFT ownership at ${nftVerification.verifiedAddress}`;
                    result.details.nftCount = nftVerification.nftCount;
                    this.accessCache.set(cacheKey, result);
                    return result;
                } else {
                    result.reason = 'no_wallet_no_verification';
                    result.details.message = 'User has no wallet and no NFT verification';
                    this.accessCache.set(cacheKey, result);
                    return result;
                }
            }

            // Get user's wallet address with validation
            let wallet;
            try {
                wallet = await this.walletManager.getWalletDetails(userId);
            } catch (error) {
                result.reason = 'wallet_error';
                result.details.message = 'Error retrieving wallet details';
                result.details.error = error.message;
                this.accessCache.set(cacheKey, result);
                return result;
            }

            if (!wallet || !wallet.address) {
                result.reason = 'invalid_wallet';
                result.details.message = 'Invalid wallet configuration';
                this.accessCache.set(cacheKey, result);
                return result;
            }

            // Validate address format
            if (!this.whitelistManager.validateAddress(wallet.address)) {
                result.reason = 'invalid_address';
                result.details.message = 'Wallet address format is invalid';
                result.details.address = wallet.address;
                this.accessCache.set(cacheKey, result);
                return result;
            }

            result.details.address = wallet.address;

            // First check: Traditional whitelist
            const isWhitelisted = this.whitelistManager.isAddressWhitelisted(wallet.address);

            if (isWhitelisted) {
                result.hasAccess = true;
                result.reason = 'whitelisted';
                result.accessMethod = 'whitelist';
                result.details.message = 'Address is traditionally whitelisted';
                this.accessCache.set(cacheKey, result);
                console.log(`Traditional whitelist access granted for user ${userId} (${wallet.address})`);
                return result;
            }

            // Second check: NFT verification (if NFT checker is available)
            if (this.nftChecker) {
                console.log(`Checking NFT access for user ${userId} (${wallet.address})`);
                const nftResult = await this.nftChecker.checkBikeBotNFTs(wallet.address);

                if (nftResult.hasNFT && nftResult.count > 0) {
                    result.hasAccess = true;
                    result.reason = 'nft_verified';
                    result.accessMethod = 'nft';
                    result.details.message = `BikeBot NFT verified: ${nftResult.count} NFT(s) found`;
                    result.details.nftData = nftResult.nfts;
                    this.accessCache.set(cacheKey, result);
                    console.log(`NFT access granted for user ${userId} (${wallet.address}): ${nftResult.count} BikeBot NFT(s)`);
                    return result;
                } else {
                    console.log(`No qualifying NFTs found for user ${userId} (${wallet.address})`);
                    result.reason = nftResult.error ? 'nft_check_failed' : 'no_nft';
                    result.details.message = nftResult.error || 'No BikeBot NFTs found in wallet';
                }
            } else {
                console.warn('NFT checker not available, falling back to traditional whitelist only');
            }

            // If we reach here, access is denied
            result.hasAccess = false;
            result.reason = result.reason || 'not_whitelisted';
            result.details.message = result.details.message || 'Address is not whitelisted and no qualifying NFTs found';

            // Cache the result
            this.accessCache.set(cacheKey, result);

            console.log(`Access denied for user ${userId} (${wallet.address}): ${result.reason}`);
            return result;

        } catch (error) {
            console.error('Error in enhanced user access check:', error);
            result.reason = 'check_error';
            result.details.message = 'Error during access verification';
            result.details.error = error.message;
            return result;
        }
    }

    /**
     * Check if address has qualifying BikeBot NFTs
     * @param {string} address - Wallet address to check
     * @returns {object} - NFT verification result
     */
    async checkNFTAccess(address) {
        const result = {
            hasAccess: false,
            reason: 'no_nft',
            message: 'No BikeBot NFTs found',
            nftCount: 0,
            nftData: []
        };

        try {
            // Check NFT cache first
            const nftCacheKey = address.toLowerCase();
            const cachedNFTResult = this.nftCache.get(nftCacheKey);
            if (cachedNFTResult && (Date.now() - cachedNFTResult.timestamp) < this.nftCacheTimeout) {
                console.log(`Using cached NFT result for ${address}`);
                return cachedNFTResult.result;
            }

            // Use the NFT checker to verify BikeBot NFTs
            const nftVerification = await this.nftChecker.checkBikeBotNFTs(address);

            if (nftVerification.hasNFT) {
                result.hasAccess = true;
                result.reason = 'nft_verified';
                result.message = `Verified: ${nftVerification.count} BikeBot NFT(s) found`;
                result.nftCount = nftVerification.count;
                result.nftData = nftVerification.nfts;
            } else {
                result.reason = 'no_nft';
                result.message = 'No BikeBot NFTs found in this wallet';
            }

            // Cache the NFT result
            this.nftCache.set(nftCacheKey, {
                result: { ...result },
                timestamp: Date.now()
            });

            return result;

        } catch (error) {
            console.error('Error checking NFT access:', error);
            result.reason = 'nft_check_failed';
            result.message = `NFT verification failed: ${error.message}`;
            return result;
        }
    }

    /**
     * Enhanced unauthorized access handling with NFT-specific feedback
     * @param {object} ctx - Telegraf context
     * @param {object} accessResult - Result from access check
     */
    async handleUnauthorizedAccessEnhanced(ctx, accessResult) {
        try {
            const userId = ctx.from.id.toString();
            const username = ctx.from.username || 'Unknown';

            // Log unauthorized access attempt with details
            console.warn(`Unauthorized access attempt by user ${userId} (@${username}):`, {
                reason: accessResult.reason,
                details: accessResult.details
            });

            let errorMessage = '🚫 *Access Denied*\n\n';

            switch (accessResult.reason) {
                case 'system_not_ready':
                    errorMessage += 'The whitelist system is currently initializing. Please try again in a moment.';
                    break;

                case 'no_wallet_no_verification':
                    errorMessage += '🏦 **Setup Required**\n\n';
                    errorMessage += 'To access this bot, you need to:\n\n';
                    errorMessage += '1️⃣ **Verify BikeBot NFT ownership** (provide address with NFT)\n';
                    errorMessage += '2️⃣ **Create or import a trading wallet**\n\n';
                    errorMessage += 'Use /start to begin the verification process.';
                    break;

                case 'nft_pre_verified':
                    // This shouldn't happen as pre-verified users should have access
                    errorMessage += '✅ Your NFT ownership is verified, but there was an access error.\n\n';
                    errorMessage += 'Please try again or contact support.';
                    break;

                case 'no_wallet':
                    errorMessage += '🏦 You need to create or import a wallet first to verify your access.\n\n';
                    errorMessage += 'Use /start to begin wallet setup.';
                    break;

                case 'wallet_error':
                    errorMessage += '⚠️ There was an error accessing your wallet configuration. Please try importing your wallet again.\n\n';
                    errorMessage += 'Use /start to reconfigure your wallet.';
                    break;

                case 'invalid_wallet':
                    errorMessage += '❌ Your wallet configuration is invalid. Please try importing your wallet again.\n\n';
                    errorMessage += 'Use /start to reconfigure your wallet.';
                    break;

                case 'invalid_address':
                    errorMessage += '🔍 Your wallet address format is invalid. Please reimport your wallet with a valid private key.\n\n';
                    errorMessage += 'Use /start to reconfigure your wallet.';
                    break;

                case 'no_nft':
                    errorMessage += '🎨 **BikeBot NFT Required**\n\n';
                    errorMessage += `Your wallet address (\`${accessResult.details.address}\`) does not contain any BikeBot NFTs.\n\n`;
                    errorMessage += '✅ **To gain access, you need to:**\n';
                    errorMessage += '1. Own at least one BikeBot NFT in your wallet\n';
                    errorMessage += '2. Or be manually whitelisted by an administrator\n\n';
                    errorMessage += '📞 Contact the bot administrator if you believe this is an error.';
                    break;

                case 'nft_check_failed':
                    errorMessage += '🔍 **NFT Verification Failed**\n\n';
                    errorMessage += `Unable to verify BikeBot NFTs in your wallet (\`${accessResult.details.address}\`).\n\n`;
                    errorMessage += 'This could be due to:\n';
                    errorMessage += '• Network connectivity issues\n';
                    errorMessage += '• API rate limits\n';
                    errorMessage += '• Blockchain synchronization delays\n\n';
                    errorMessage += '⏳ Please try again in a few minutes.';
                    break;

                case 'not_whitelisted':
                    errorMessage += '🔐 **Access Restricted**\n\n';
                    errorMessage += `Your wallet address (\`${accessResult.details.address}\`) is not authorized to use this bot.\n\n`;
                    errorMessage += '✅ **To gain access, you need to:**\n';
                    errorMessage += '1. Own at least one BikeBot NFT, OR\n';
                    errorMessage += '2. Be manually whitelisted by an administrator\n\n';
                    errorMessage += '📞 Contact the bot administrator if you believe this is an error.';
                    break;

                case 'check_error':
                    errorMessage += '⚠️ There was an error verifying your access. Please try again later.\n\n';
                    errorMessage += 'If the problem persists, please contact the administrator.';
                    break;

                default:
                    errorMessage += '❓ Your access could not be verified. Please ensure you have a valid wallet configured and try again.\n\n';
                    errorMessage += '💡 **Access Requirements:**\n';
                    errorMessage += '• Valid wallet with BikeBot NFT, OR\n';
                    errorMessage += '• Manual whitelist approval';
            }

            await ctx.reply(errorMessage, { parse_mode: 'Markdown' });

        } catch (error) {
            console.error('Error handling enhanced unauthorized access:', error);

            // Fallback error message
            try {
                await ctx.reply('🚫 Access denied. Please contact the administrator.');
            } catch (replyError) {
                console.error('Failed to send unauthorized access message:', replyError);
            }
        }
    }

    /**
     * Check if the current command should skip whitelist verification
     * @param {object} ctx - Telegraf context
     * @returns {boolean} - True if should skip whitelist check
     */
    shouldSkipWhitelistCheck(ctx) {
        try {
            // Check if it's a text message with command
            if (ctx.message && ctx.message.text) {
                const text = ctx.message.text.toLowerCase().trim();

                // Check for bypass commands
                for (const command of this.bypassCommands) {
                    if (text === command || text.startsWith(command + ' ')) {
                        return true;
                    }
                }
            }

            // Check if it's a callback query (inline button)
            if (ctx.callbackQuery) {
                // Allow callback queries for now, they'll be handled by their respective handlers
                return false;
            }

            // Check for specific update types that should be allowed
            if (ctx.updateType === 'callback_query') {
                return false;
            }

            return false;

        } catch (error) {
            console.error('Error checking if should skip whitelist:', error);
            return false; // Don't skip on error for security
        }
    }

    /**
     * Check if the current command is an admin command
     * @param {object} ctx - Telegraf context
     * @returns {boolean} - True if it's an admin command
     */
    isAdminCommand(ctx) {
        try {
            if (ctx.message && ctx.message.text) {
                const text = ctx.message.text.toLowerCase().trim();

                for (const command of this.adminCommands) {
                    if (text === command || text.startsWith(command + ' ')) {
                        return true;
                    }
                }
            }

            return false;

        } catch (error) {
            console.error('Error checking if admin command:', error);
            return false;
        }
    }

    /**
     * Clear NFT cache for a specific address
     * @param {string} address - Address to clear from NFT cache
     */
    clearNFTCache(address) {
        this.nftCache.delete(address.toLowerCase());
        console.log(`Cleared NFT cache for address ${address}`);
    }

    /**
     * Clear user access cache for a specific user
     * @param {string} userId - User ID to clear from cache
     */
    clearUserCache(userId) {
        this.accessCache.delete(userId);
        console.log(`Cleared access cache for user ${userId}`);
    }

    /**
     * Clear all access cache
     */
    clearAllCache() {
        this.accessCache.clear();
        this.nftCache.clear();
        console.log('Cleared all access and NFT cache');
    }

    /**
     * Check if user is rate limited due to failed attempts
     * @param {object} ctx - Telegraf context
     * @returns {boolean} - True if user is rate limited
     */
    isRateLimited(ctx) {
        const userId = ctx.from.id.toString();
        const attempts = this.failedAttempts.get(userId);

        if (!attempts) {
            return false;
        }

        const now = Date.now();
        const recentAttempts = attempts.filter(
            timestamp => (now - timestamp) < this.failedAttemptWindow
        );

        // Update the attempts list
        this.failedAttempts.set(userId, recentAttempts);

        return recentAttempts.length >= this.maxFailedAttempts;
    }

    /**
     * Record a failed access attempt
     * @param {object} ctx - Telegraf context
     */
    recordFailedAttempt(ctx) {
        const userId = ctx.from.id.toString();
        const now = Date.now();

        const attempts = this.failedAttempts.get(userId) || [];
        attempts.push(now);

        // Keep only recent attempts
        const recentAttempts = attempts.filter(
            timestamp => (now - timestamp) < this.failedAttemptWindow
        );

        this.failedAttempts.set(userId, recentAttempts);

        if (recentAttempts.length >= this.maxFailedAttempts) {
            console.warn(`User ${userId} has been rate limited due to ${recentAttempts.length} failed attempts`);
        }
    }

    /**
     * Clear failed attempts for a user
     * @param {object} ctx - Telegraf context
     */
    clearFailedAttempts(ctx) {
        const userId = ctx.from.id.toString();
        this.failedAttempts.delete(userId);
    }

    /**
     * Handle rate limit exceeded
     * @param {object} ctx - Telegraf context
     */
    async handleRateLimitExceeded(ctx) {
        try {
            const userId = ctx.from.id.toString();
            const attempts = this.failedAttempts.get(userId) || [];
            const timeRemaining = Math.ceil((this.failedAttemptWindow - (Date.now() - attempts[0])) / 1000 / 60);

            const message = `🚫 *Rate Limit Exceeded*\n\n` +
                `You have made too many failed access attempts.\n\n` +
                `Please wait ${timeRemaining} minutes before trying again.`;

            await ctx.reply(message, { parse_mode: 'Markdown' });

            console.warn(`Rate limit exceeded for user ${userId}, ${timeRemaining} minutes remaining`);

        } catch (error) {
            console.error('Error handling rate limit exceeded:', error);
        }
    }

    /**
     * Get middleware statistics including NFT verification stats
     * @returns {object} - Middleware statistics
     */
    getMiddlewareStats() {
        return {
            ...this.accessStats,
            cacheSize: this.accessCache.size,
            nftCacheSize: this.nftCache.size,
            rateLimitedUsers: this.failedAttempts.size,
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Reset middleware statistics
     */
    resetStats() {
        this.accessStats = {
            totalRequests: 0,
            authorizedRequests: 0,
            deniedRequests: 0,
            errorRequests: 0,
            bypassedRequests: 0,
            nftVerified: 0,
            nftDenied: 0
        };
        console.log('Middleware statistics reset');
    }
}

module.exports = WhitelistMiddleware;