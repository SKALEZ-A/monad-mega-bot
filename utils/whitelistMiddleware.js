const WhitelistErrorHandler = require('./whitelistErrorHandler');

/**
 * WhitelistMiddleware - Telegram bot middleware for address-based access control
 */
class WhitelistMiddleware {
    constructor(whitelistManager, walletManager, monitor = null) {
        this.whitelistManager = whitelistManager;
        this.walletManager = walletManager;
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
            bypassedRequests: 0
        };
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
                    
                    // Log successful access
                    if (this.monitor) {
                        await this.monitor.logAccessAttempt(
                            ctx.from.id,
                            ctx.from.username,
                            accessResult.details?.address,
                            true,
                            Date.now() - startTime
                        );
                    }
                    
                    return await next();
                } else {
                    // User is not authorized, handle unauthorized access
                    this.accessStats.deniedRequests++;
                    this.recordFailedAttempt(ctx);
                    
                    // Log denied access
                    if (this.monitor) {
                        await this.monitor.logAccessAttempt(
                            ctx.from.id,
                            ctx.from.username,
                            accessResult.details?.address,
                            false,
                            Date.now() - startTime
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
     * Check if user has access based on their wallet address
     * @param {object} ctx - Telegraf context
     * @returns {boolean} - True if user has access
     */
    async checkUserAccess(ctx) {
        try {
            const userId = ctx.from.id.toString();
            
            // Check cache first
            const cacheKey = userId;
            const cachedResult = this.accessCache.get(cacheKey);
            if (cachedResult && (Date.now() - cachedResult.timestamp) < this.cacheTimeout) {
                return cachedResult.hasAccess;
            }
            
            // Check if user has a wallet
            if (!this.walletManager.hasWallet(userId)) {
                // User has no wallet, cache negative result
                this.accessCache.set(cacheKey, {
                    hasAccess: false,
                    reason: 'no_wallet',
                    timestamp: Date.now()
                });
                return false;
            }
            
            // Get user's wallet address
            const wallet = this.walletManager.getWalletDetails(userId);
            if (!wallet || !wallet.address) {
                // Invalid wallet data, cache negative result
                this.accessCache.set(cacheKey, {
                    hasAccess: false,
                    reason: 'invalid_wallet',
                    timestamp: Date.now()
                });
                return false;
            }
            
            // Check if address is whitelisted
            const isWhitelisted = this.whitelistManager.isAddressWhitelisted(wallet.address);
            
            // Cache the result
            this.accessCache.set(cacheKey, {
                hasAccess: isWhitelisted,
                reason: isWhitelisted ? 'whitelisted' : 'not_whitelisted',
                address: wallet.address,
                timestamp: Date.now()
            });
            
            console.log(`Access check for user ${userId} (${wallet.address}): ${isWhitelisted ? 'GRANTED' : 'DENIED'}`);
            
            return isWhitelisted;
            
        } catch (error) {
            console.error('Error checking user access:', error);
            return false; // Deny access on error for security
        }
    }

    /**
     * Handle unauthorized access attempts
     * @param {object} ctx - Telegraf context
     */
    async handleUnauthorizedAccess(ctx) {
        try {
            const userId = ctx.from.id.toString();
            const username = ctx.from.username || 'Unknown';
            
            // Log unauthorized access attempt
            console.warn(`Unauthorized access attempt by user ${userId} (@${username})`);
            
            // Get cached access info for better error message
            const cachedResult = this.accessCache.get(userId);
            let errorMessage = '🚫 *Access Denied*\n\n';
            
            if (cachedResult) {
                switch (cachedResult.reason) {
                    case 'no_wallet':
                        errorMessage += 'You need to create or import a wallet first to verify your access.\n\n';
                        errorMessage += 'Use /start to begin wallet setup.';
                        break;
                        
                    case 'invalid_wallet':
                        errorMessage += 'Your wallet configuration is invalid. Please try importing your wallet again.\n\n';
                        errorMessage += 'Use /start to reconfigure your wallet.';
                        break;
                        
                    case 'not_whitelisted':
                        errorMessage += `Your wallet address is not authorized to use this bot.\n\n`;
                        errorMessage += `Address: \`${cachedResult.address}\`\n\n`;
                        errorMessage += 'Please contact the bot administrator if you believe this is an error.';
                        break;
                        
                    default:
                        errorMessage += 'Your access could not be verified. Please try again later.';
                }
            } else {
                errorMessage += 'Your access could not be verified. Please ensure you have a valid wallet configured.';
            }
            
            await ctx.reply(errorMessage, { parse_mode: 'Markdown' });
            
        } catch (error) {
            console.error('Error handling unauthorized access:', error);
            
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
     * Clear access cache for a specific user
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
        console.log('Cleared all access cache');
    }

    /**
     * Get cache statistics
     * @returns {object} - Cache statistics
     */
    getCacheStats() {
        const now = Date.now();
        let validEntries = 0;
        let expiredEntries = 0;
        
        for (const [userId, entry] of this.accessCache.entries()) {
            if ((now - entry.timestamp) < this.cacheTimeout) {
                validEntries++;
            } else {
                expiredEntries++;
            }
        }
        
        return {
            totalEntries: this.accessCache.size,
            validEntries,
            expiredEntries,
            cacheTimeout: this.cacheTimeout
        };
    }

    /**
     * Clean expired entries from cache
     */
    cleanExpiredCache() {
        const now = Date.now();
        let cleanedCount = 0;
        
        for (const [userId, entry] of this.accessCache.entries()) {
            if ((now - entry.timestamp) >= this.cacheTimeout) {
                this.accessCache.delete(userId);
                cleanedCount++;
            }
        }
        
        if (cleanedCount > 0) {
            console.log(`Cleaned ${cleanedCount} expired cache entries`);
        }
        
        return cleanedCount;
    }

    /**
     * Enhanced user access checking with detailed error reporting
     * @param {object} ctx - Telegraf context
     * @returns {object} - Detailed access result
     */
    async checkUserAccessEnhanced(ctx) {
        const result = {
            hasAccess: false,
            reason: 'unknown',
            details: {},
            timestamp: Date.now()
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
            if (!this.walletManager.hasWallet(userId)) {
                result.reason = 'no_wallet';
                result.details.message = 'User has no wallet configured';
                this.accessCache.set(cacheKey, result);
                return result;
            }
            
            // Get user's wallet address with validation
            let wallet;
            try {
                wallet = this.walletManager.getWalletDetails(userId);
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
            
            // Check if address is whitelisted
            const isWhitelisted = this.whitelistManager.isAddressWhitelisted(wallet.address);
            
            result.hasAccess = isWhitelisted;
            result.reason = isWhitelisted ? 'whitelisted' : 'not_whitelisted';
            result.details.address = wallet.address;
            result.details.message = isWhitelisted ? 
                'Address is whitelisted' : 
                'Address is not whitelisted';
            
            // Cache the result
            this.accessCache.set(cacheKey, result);
            
            console.log(`Enhanced access check for user ${userId} (${wallet.address}): ${isWhitelisted ? 'GRANTED' : 'DENIED'}`);
            
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
     * Enhanced unauthorized access handling with detailed feedback
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
                    
                case 'no_wallet':
                    errorMessage += 'You need to create or import a wallet first to verify your access.\n\n';
                    errorMessage += 'Use /start to begin wallet setup.';
                    break;
                    
                case 'wallet_error':
                    errorMessage += 'There was an error accessing your wallet configuration. Please try importing your wallet again.\n\n';
                    errorMessage += 'Use /start to reconfigure your wallet.';
                    break;
                    
                case 'invalid_wallet':
                    errorMessage += 'Your wallet configuration is invalid. Please try importing your wallet again.\n\n';
                    errorMessage += 'Use /start to reconfigure your wallet.';
                    break;
                    
                case 'invalid_address':
                    errorMessage += 'Your wallet address format is invalid. Please reimport your wallet with a valid private key.\n\n';
                    errorMessage += 'Use /start to reconfigure your wallet.';
                    break;
                    
                case 'not_whitelisted':
                    errorMessage += `Your wallet address is not authorized to use this bot.\n\n`;
                    errorMessage += `Address: \`${accessResult.details.address}\`\n\n`;
                    errorMessage += 'Please contact the bot administrator if you believe this is an error.';
                    break;
                    
                case 'check_error':
                    errorMessage += 'There was an error verifying your access. Please try again later.\n\n';
                    errorMessage += 'If the problem persists, please contact the administrator.';
                    break;
                    
                default:
                    errorMessage += 'Your access could not be verified. Please ensure you have a valid wallet configured and try again.';
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
     * Get middleware statistics
     * @returns {object} - Middleware statistics
     */
    getMiddlewareStats() {
        return {
            ...this.accessStats,
            cacheSize: this.accessCache.size,
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
            bypassedRequests: 0
        };
        console.log('Middleware statistics reset');
    }
}

module.exports = WhitelistMiddleware;