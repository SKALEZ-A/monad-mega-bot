require('dotenv').config();
const { Telegraf, Context, Scenes, session, Markup } = require('telegraf');
const MonadIntegration = require('./utils/monadIntegration');
const MegaethIntegration = require('./utils/megaethIntegration');
const WalletManager = require('./utils/walletManager');
const TelegramCommands = require('./utils/telegramCommands');
const WhitelistManager = require('./utils/whitelistManager');
const WhitelistMiddleware = require('./utils/whitelistMiddleware');
const WhitelistInitializer = require('./utils/whitelistInitializer');
const WhitelistMonitor = require('./utils/whitelistMonitor');
const BikeBotNFTChecker = require('./utils/nftChecker')
const { BOT_CONFIG, NETWORKS } = require('./config');
const ethers = require('ethers');
const connectDB = require('./models/dbConfig');

// Add better global error handling
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

// Check if Telegram bot token is provided
if (!process.env.TELEGRAM_BOT_TOKEN) {
    console.error('❌ ERROR: TELEGRAM_BOT_TOKEN is missing in .env file');
    console.error('Please create a .env file with your Telegram bot token:');
    console.error('TELEGRAM_BOT_TOKEN=your_bot_token_here');
    process.exit(1);
}

// Validate format of Telegram bot token
if (!/^\d+:[A-Za-z0-9_-]{35}$/.test(process.env.TELEGRAM_BOT_TOKEN)) {
    console.warn('⚠️ WARNING: Your TELEGRAM_BOT_TOKEN doesn\'t match the expected format');
    console.warn('It should be something like: 1234567890:ABCDefGhIJKlmNoPQRstUVwxyZ');
    console.warn('Attempting to start anyway...');
}

// Override env RPC URL with config value to ensure consistency
if (NETWORKS.MONAD && NETWORKS.MONAD.rpc) {
    process.env.MONAD_RPC_URL = NETWORKS.MONAD.rpc;
}

// Add environment variable check and RPC check at startup
console.log("\n=== STARTUP ENVIRONMENT CHECK ===");
console.log(`Bot Token: ${process.env.TELEGRAM_BOT_TOKEN ? "Configured ✓" : "MISSING ✗"}`);
console.log(`Monad RPC URL: ${process.env.MONAD_RPC_URL ? process.env.MONAD_RPC_URL : "MISSING ✗"}`);
console.log(`MongoDB URI: ${process.env.MONGODB_URI || process.env.MONGO_URI || process.env.DATABASE_URL ? "Configured ✓" : "MISSING ✗"}`);
console.log("===================================\n");

// Global variables for bot components
let bot;
let walletManager;
let commands;
let defaultMonadIntegration;
let defaultMegaethIntegration;

// Bot State
const userStates = {};
const userSessions = {};

// User state constants
const STATES = {
    IDLE: 'idle',
    AWAITING_PRIVATE_KEY: 'awaiting_private_key',
    AWAITING_FROM_TOKEN: 'awaiting_from_token',
    AWAITING_TO_TOKEN: 'awaiting_to_token',
    AWAITING_AMOUNT: 'awaiting_amount',
    AWAITING_CONFIRMATION: 'awaiting_confirmation',
    AWAITING_RECIPIENT: 'awaiting_recipient',
    AWAITING_SEND_AMOUNT: 'awaiting_send_amount',
    AWAITING_SLIPPAGE: 'awaiting_slippage',
    AWAITING_WATCHLIST_TOKEN: 'awaiting_watchlist_token',
    AWAITING_REMOVE_TOKEN: 'awaiting_remove_token',
    AWAITING_PRICE_TOKEN: 'awaiting_price_token',
    AWAITING_TOKEN_ADDRESS: 'awaiting_token_address',
    AWAITING_NETWORK_SELECTION: 'awaiting_network_selection',
    AWAITING_NFT_ADDRESS: 'awaiting_nft_address',
    NFT_VERIFICATION_PENDING: 'nft_verification_pending'
};

// Initialize bot components after database connection
async function initializeBot() {
    try {
        // Connect to MongoDB first and wait for it
        console.log('🔄 Connecting to MongoDB...');
        await connectDB();
        console.log('✅ MongoDB connected successfully!');

        // Test database connection
        const mongoose = require('mongoose');
        if (mongoose.connection.readyState !== 1) {
            throw new Error('Database connection not ready');
        }
        console.log('✅ Database connection verified');

        // Initialize bot components after database is ready
        console.log('🔄 Initializing bot components...');

        // Initialize bot
        bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
        bot.use(session());

        // Set bot commands
        await bot.telegram.setMyCommands([
            { command: 'start', description: 'Start the bot and main menu' },
            { command: 'help', description: 'Get help and command list' },
            { command: 'wallet', description: '[Whitelisted] Manage your wallet' },
            { command: 'swap', description: '[Whitelisted] Swap tokens' },
            { command: 'send', description: '[Whitelisted] Send tokens' },
            { command: 'balances', description: '[Whitelisted] View balances' },
            { command: 'chains', description: '[Whitelisted] Switch blockchain' },
            { command: 'currentchain', description: '[Whitelisted] Show current chain' },
            { command: 'settings', description: '[Whitelisted] Bot preferences' },
            { command: 'whitelist_add', description: '[Admin] Add address to whitelist' },
            { command: 'whitelist_remove', description: '[Admin] Remove address from whitelist' },
            { command: 'whitelist_list', description: '[Admin] View whitelisted addresses' },
            { command: 'whitelist_stats', description: '[Admin] View whitelist statistics' },
            { command: 'whitelist_monitor', description: '[Admin] View monitoring dashboard' },
            { command: 'whitelist_reset_stats', description: '[Admin] Reset monitoring stats' }
        ]);

        // Initialize default wallets (for system operations)
        try {
            defaultMonadIntegration = new MonadIntegration(process.env.WALLET_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001');
            console.log('✅ Default Monad integration initialized successfully');
            defaultMegaethIntegration = new MegaethIntegration(process.env.WALLET_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001');
            console.log('✅ Default MegaETH integration initialized successfully');
        } catch (error) {
            console.error('❌ Error initializing default wallet:', error);
        }

        // Initialize managers (after database is connected)
        walletManager = new WalletManager();

        // Initialize whitelist system
        const whitelistInitializer = new WhitelistInitializer();
        const whitelistManager = new WhitelistManager();
        const whitelistMonitor = new WhitelistMonitor('./logs', whitelistManager);

        // Initialize NFT checker (uses BlockVision API directly)
        let nftChecker = null;
        try {
            nftChecker = new BikeBotNFTChecker(process.env.BIKEBOT_CONTRACT_ADDRESS);
            console.log('✅ BikeBot NFT checker initialized');
            console.log(`   Contract Address: ${process.env.BIKEBOT_CONTRACT_ADDRESS || 'Using fallback detection'}`);
            console.log(`   BlockVision API: ${process.env.BLOCKVISION_API_KEY ? 'Configured ✓' : 'Missing ✗'}`);
        } catch (error) {
            console.warn('⚠️ NFT checker initialization failed:', error.message);
        }
        
        const whitelistMiddleware = new WhitelistMiddleware(whitelistManager, walletManager, whitelistMonitor);

        // Initialize whitelist asynchronously
        try {
            // Step 1: Initialize data directory and default whitelist file
            console.log('🔧 Initializing whitelist data...');
            const initResult = await whitelistInitializer.initialize();

            if (!initResult.success) {
                throw new Error(`Whitelist initialization failed: ${initResult.errors.join(', ')}`);
            }

            if (initResult.created) {
                console.log('✅ Default whitelist created with required addresses');
            } else if (initResult.restored) {
                console.log('✅ Corrupted whitelist restored from backup');
            } else {
                console.log('✅ Existing whitelist validated');
            }

            // Step 2: Initialize whitelist manager
            await whitelistManager.initialize();
            console.log('✅ Whitelist system initialized successfully');

            // Step 3: Initialize monitoring system
            await whitelistMonitor.initialize();
            console.log('✅ Whitelist monitoring system initialized');

            // Step 4: Initialize commands with whitelist manager and monitor
            commands = new TelegramCommands(walletManager, defaultMonadIntegration, defaultMegaethIntegration, whitelistManager, whitelistMonitor);
            console.log('✅ TelegramCommands initialized with whitelist manager and monitor');

            // Step 5: Add whitelist middleware after initialization
            bot.use(whitelistMiddleware.middleware());
            console.log('✅ Whitelist middleware with NFT checking activated');

            // Step 6: Perform health check
            const health = await whitelistInitializer.healthCheck();
            if (!health.healthy) {
                console.warn('⚠️ Whitelist health issues detected:', health.issues);
            }
            if (health.warnings.length > 0) {
                console.warn('⚠️ Whitelist warnings:', health.warnings);
            }

            console.log(`📊 Whitelist ready with ${initResult.addressCount} addresses`);
            console.log(`🎨 NFT verification ${nftChecker ? 'enabled' : 'disabled'} for BikeBot NFTs`);
            
        } catch (error) {
            console.error('❌ Error initializing whitelist system:', error);
            console.error('Bot will continue with fallback whitelist settings');
            
            // Initialize commands without whitelist manager as fallback
            commands = new TelegramCommands(walletManager, defaultMonadIntegration, defaultMegaethIntegration);
            console.log('⚠️ TelegramCommands initialized without whitelist manager');
            
            // Try to continue with basic functionality
            console.log('⚠️ Bot running in degraded mode - whitelist features disabled');
        }

        console.log('✅ Wallet manager and commands initialized');

        // Setup bot handlers
        setupBotHandlers();

        // Start the bot
        await bot.launch();
        console.log('🤖 Monad Telegram Trading Bot is running and listening for updates...');

        return bot;

    } catch (error) {
        console.error('❌ Failed to initialize bot:', error);

        if (error.message.includes('ENOTFOUND') || error.message.includes('ECONNREFUSED')) {
            console.error('💡 Database connection failed. Please check:');
            console.error('   - MongoDB is running');
            console.error('   - Connection string is correct');
            console.error('   - Network connectivity');
        }

        process.exit(1);
    }
}

// Setup all bot handlers
function setupBotHandlers() {

    // User session initialization
    function getSession(ctx) {
        const userId = ctx.from.id.toString();
        if (!userSessions[userId]) {
            userSessions[userId] = {
                userId,
                state: STATES.IDLE,
                swapData: {},
                sendData: {},
                settings: {
                    slippage: BOT_CONFIG.DEFAULT_SLIPPAGE,
                    network: 'MONAD' // Default to MONAD as the selected network
                }
            };
        }
        return userSessions[userId];
    }

    // Get user's blockchain integration instance based on selected network
    async function getUserIntegration(userId, network = 'MONAD') {
        console.log(`Attempting to get blockchain integration for user ${userId} on network ${network}`);

        // Use await for hasWallet check
        const hasWallet = await walletManager.hasWallet(userId);
        if (!hasWallet) {
            console.log(`No wallet found for user ${userId}`);
            return null;
        }

        try {
            console.log(`Fetching wallet details for user ${userId}`);
            const wallet = await walletManager.getWalletDetails(userId);
            if (!wallet || !wallet.privateKey) {
                console.error(`Invalid wallet data for user ${userId}:`, wallet);
                return null;
            }
            if (network === 'MONAD') {
                console.log(`Creating MONAD Integration for user ${userId} with wallet ${wallet.address}`);
                return new MonadIntegration(wallet.privateKey);
            } else if (network === 'MEGAETH') {
                console.log(`Creating MegaETH Integration for user ${userId} with wallet ${wallet.address}`);
                return new MegaethIntegration(wallet.privateKey);
            }
            return null;
        } catch (error) {
            console.error(`Error creating integration for user ${userId}:`, error);
            return null;
        }
    }

    // Set user state
    function setState(ctx, state) {
        const session = getSession(ctx);
        session.state = state;
        console.log(`Set state for user ${ctx.from.id} to: ${state}`);
        return session;
    }

    // Reset swap data
    function resetSwapData(ctx) {
        const session = getSession(ctx);
        session.swapData = {};
        console.log(`Reset swap data for user ${ctx.from.id}`);
    }

    // Reset send data
    function resetSendData(ctx) {
        const session = getSession(ctx);
        session.sendData = {};
        console.log(`Reset send data for user ${ctx.from.id}`);
    }

    // Add this utility function
    function getNetworkDisplayName(network) {
        return NETWORKS[network]?.name || network;
    }

    bot.start(async (ctx) => {
        const session = getSession(ctx);
        const userId = ctx.from.id.toString();

        // Check if user already has access (wallet + whitelist/NFT)
        const hasWallet = await walletManager.hasWallet(userId);
        if (hasWallet) {
            // User has wallet, check if they have access
            try {
                const whitelistMiddleware = bot.middlewares.find(m => m.name === 'whitelistMiddleware');
                if (whitelistMiddleware) {
                    const accessResult = await whitelistMiddleware.checkUserAccessEnhanced(ctx);
                    if (accessResult.hasAccess) {
                        // User has full access
                        setState(ctx, STATES.IDLE);
                        const network = session.settings?.network || 'MONAD';
                        const networkText = `Network: ${getNetworkDisplayName(network)}\n\n`;
                        return await ctx.replyWithMarkdown(
                            networkText +
                            `*Welcome back to Monad Trading Bot* 🚀\n\n` +
                            `✅ Access verified${accessResult.accessMethod === 'nft' ? ' via BikeBot NFT' : ' via whitelist'}\n\n` +
                            `**Available Commands:**\n` +
                            `/wallet — Manage your wallet\n` +
                            `/swap — Swap tokens\n` +
                            `/send — Send tokens\n` +
                            `/balances — View balances\n` +
                            `/chains — Switch blockchain\n` +
                            `/help — Get help`,
                            commands.getMainMenu()
                        );
                    }
                }
            } catch (error) {
                console.error('Error checking user access:', error);
            }
        }

        // User doesn't have access - start verification process
        setState(ctx, STATES.AWAITING_NFT_ADDRESS);
        await ctx.replyWithMarkdown(
            `*Welcome to Monad Trading Bot* 🚀\n\n` +
            `🎨 **BikeBot NFT Verification Required**\n\n` +
            `To access this bot, you need to verify ownership of a BikeBot NFT.\n\n` +
            `**Verification Process:**\n` +
            `1. Enter your wallet address that contains BikeBot NFT(s)\n` +
            `2. We'll verify your NFT ownership\n` +
            `3. Once verified, you can create/import your trading wallet\n\n` +
            `📝 **Please enter your wallet address** (the one with BikeBot NFTs):\n\n` +
            `Format: 0x1234...abcd\n\n` +
            `❓ Don't have a BikeBot NFT? Contact the administrator for manual whitelist approval.`,
            Markup.keyboard([
                ['❌ Cancel']
            ]).resize()
        );
    });

    // Add chains command (inline keyboard for chain selection)
    bot.command('chains', async (ctx) => {
        setState(ctx, STATES.AWAITING_NETWORK_SELECTION);
        await ctx.reply(
            '🔄 Select a blockchain network:',
            Markup.inlineKeyboard([
                [
                    Markup.button.callback('Monad', 'network_MONAD'),
                    Markup.button.callback('MegaETH', 'network_MEGAETH')
                ]
            ])
        );
    });

    // Also handle button for chains if present
    bot.hears('⛓️ Chains', async (ctx) => {
        setState(ctx, STATES.AWAITING_NETWORK_SELECTION);
        await ctx.reply(
            '🔄 Select a blockchain network:',
            Markup.inlineKeyboard([
                [
                    Markup.button.callback('Monad', 'network_MONAD'),
                    Markup.button.callback('MegaETH', 'network_MEGAETH')
                ]
            ])
        );
    });

    // Handle network selection via callback action
    bot.action(/network_(.+)/, async (ctx) => {
        const network = ctx.match[1];
        await ctx.answerCbQuery();
        const session = getSession(ctx);
        if (network === 'MONAD' || network === 'MEGAETH') {
            session.settings.network = network;
            setState(ctx, STATES.IDLE);
            await ctx.reply(
                `Network switched to ${getNetworkDisplayName(network)} ✅`,
                commands.getMainMenu()
            );
        } else {
            await ctx.reply(
                'This network will be supported in a future update!',
                commands.getMainMenu()
            );
        }
    });

    // Help command
    bot.command('help', async (ctx) => {
        console.log(`Help command received from user ${ctx.from.id}`);
        setState(ctx, STATES.IDLE);

        const session = getSession(ctx);
        const currentNetwork = session.settings.network || 'MONAD';

        await ctx.replyWithMarkdown(
            `*Monad Trading Bot Help* ℹ️\n\n` +
            `Currently using: *${getNetworkDisplayName(currentNetwork)}*\n\n` +
            `*Commands:*\n` +
            `/start - Main menu\n` +
            `/wallet - Manage your wallet\n` +
            `/swap - Swap tokens\n` +
            `/send - Send tokens\n` +
            `/balances - View your token balances\n` +
            `/token - View token info and swap options\n` +
            `/price - Check token prices\n` +
            `/network - Select blockchain network\n` +
            `/help - Show this help message\n` +
            `/settings - Configure bot settings\n\n` +

            `*How to Use:*\n` +
            `1. First, create or import a wallet\n` +
            `2. Use buttons to navigate and perform actions\n` +
            `3. Always confirm transactions before sending\n` +
            `4. Check balances regularly\n\n` +

            `*Available Networks:*\n` +
            `- Monad: A high-performance L1 blockchain\n\n` +

            `*Links:*\n` +
            `- [Monad Explorer](${NETWORKS.MONAD.blockExplorerUrl})`,
            commands.getMainMenu()
        );
    });

    // Wallet command
    bot.command('wallet', async (ctx) => {
        console.log(`Wallet command received from user ${ctx.from.id}`);
        setState(ctx, STATES.IDLE);

        try {
            const telegramId = ctx.from.id.toString();

            // Use await for hasWallet check
            const hasWallet = await walletManager.hasWallet(telegramId);
            if (hasWallet) {
                const wallet = await walletManager.getWalletDetails(telegramId);
                const session = getSession(ctx);
                const currentNetwork = session.settings.network || 'MONAD';
                const explorerUrl = NETWORKS[currentNetwork].blockExplorerUrl;

                await ctx.replyWithMarkdown(
                    `*Your Wallet* 💼\n\n` +
                    `Address: \`${wallet.address}\`\n\n` +
                    `[View on Explorer](${explorerUrl}/address/${wallet.address})`,
                    commands.getMainMenu()
                );
            } else {
                await ctx.reply(
                    'You need to create or import a wallet first:',
                    commands.getWalletMenu()
                );
            }
        } catch (error) {
            console.error('Error in wallet command:', error);
            await ctx.reply('❌ An error occurred while retrieving wallet information.');
        }
    });


    // Swap command
    bot.command('swap', async (ctx) => {
        console.log(`Swap command received from user ${ctx.from.id}`);
        setState(ctx, STATES.IDLE);
        resetSwapData(ctx);

        const telegramId = ctx.from.id.toString();
        const hasWallet = await walletManager.hasWallet(telegramId);
        if (!hasWallet) {
            return ctx.reply(
                'You need to create or import a wallet first:',
                commands.getWalletMenu()
            );
        }
        const session = getSession(ctx);
        const currentNetwork = session.settings.network || 'MONAD';
        if (currentNetwork === 'MEGAETH') {
            return ctx.reply('⚠️ MegaETH swap is not currently supported by this bot. Please switch to Monad to use the swap feature.', commands.getMainMenu());
        }
        await ctx.replyWithMarkdown(
            `*Swap Tokens* 🔄\n\n` +
            `Select a trading pair or choose Custom Swap:`,
            commands.getSwapMenu(currentNetwork)
        );
    });

    // Send command
    bot.command('send', async (ctx) => {
        console.log(`Send command received from user ${ctx.from.id}`);
        setState(ctx, STATES.IDLE);
        resetSendData(ctx);

        const telegramId = ctx.from.id.toString();
        const hasWallet = await walletManager.hasWallet(telegramId);
        if (!hasWallet) {
            return ctx.reply(
                'You need to create or import a wallet first:',
                commands.getWalletMenu()
            );
        }

        const session = getSession(ctx);
        const currentNetwork = session.settings.network || 'MONAD';

        await ctx.reply(
            'Select a token to send:',
            commands.getSendMenu(currentNetwork)
        );
    });

    // Balances command
    bot.command('balances', async (ctx) => {
        console.log(`Balances command received from user ${ctx.from.id}`);
        setState(ctx, STATES.IDLE);

        const session = getSession(ctx);
        const network = session.settings?.network || 'MONAD';
        const networkText = `Network: ${getNetworkDisplayName(network)}\n\n`;
        await ctx.replyWithMarkdown(networkText + 'Fetching your balances... Please wait.');

        try {
            const telegramId = ctx.from.id.toString();
            const hasWallet = await walletManager.hasWallet(telegramId);
            if (!hasWallet) {
                console.log(`User ${ctx.from.id} has no wallet, showing wallet menu`);
                return ctx.reply(
                    'You need to create or import a wallet first:',
                    commands.getWalletMenu()
                );
            }

            const integration = await getUserIntegration(telegramId, network);
            if (!integration) {
                return ctx.reply(`Failed to load your wallet. Please try again later.`);
            }

            const currentNetworkBalances = await commands.formatBalances(telegramId, network);

            let message = `${currentNetworkBalances}`;

            await ctx.replyWithMarkdown(message, {
                disable_web_page_preview: true,
                ...commands.getMainMenu()
            });
        } catch (error) {
            console.error(`Error handling balances command from user ${ctx.from.id}:`, error);
            let userMessage = '❌ Error fetching balances: ' + error.message;
            if (error.message && (error.message.includes('request limit') || error.message.includes('rate limit') || error.message.includes('429') || error.message.includes('coalesce error'))) {
                userMessage = '⚠️ The network provider is currently rate-limited. Please wait a few seconds and try again, or consider upgrading your RPC provider if this happens frequently.';
            }
            await ctx.reply(userMessage);
        }
    });

    // Token command
    bot.command('token', async (ctx) => {
        console.log(`Token command received from user ${ctx.from.id}`);
        setState(ctx, STATES.AWAITING_TOKEN_ADDRESS);

        const session = getSession(ctx);
        const currentNetwork = session.settings.network || 'MONAD';

        await ctx.replyWithMarkdown(
            `*Token Explorer* 🔍\n\n` +
            `Please enter a valid token contract address (0x...):`,
            Markup.keyboard([
                ['❌ Cancel']
            ]).resize()
        );
    });

    // Price command
    bot.command('price', async (ctx) => {
        console.log(`Price command received from user ${ctx.from.id}`);
        setState(ctx, STATES.AWAITING_PRICE_TOKEN);

        await ctx.reply(
            'Enter the token symbol or address you want to check the price for:',
            Markup.keyboard([
                ['MON', 'USDC', 'WETH'],
                ['❌ Cancel']
            ]).resize()
        );
    });

    // Current chain command
    bot.command('currentchain', async (ctx) => {
        const session = getSession(ctx);
        const network = session.settings?.network || 'MONAD';
        await ctx.reply(`You are currently on: ${getNetworkDisplayName(network)}`);
    });

    // Main menu button handlers
    bot.hears('My Balances', async (ctx) => {
        setState(ctx, STATES.IDLE);
        const session = getSession(ctx);
        const network = session.settings?.network || 'MONAD';
        const networkText = `Network: ${getNetworkDisplayName(network)}\n\n`;
        await ctx.replyWithMarkdown(networkText + 'Fetching your balances... Please wait.');
        try {
            const telegramId = ctx.from.id.toString();
            const hasWallet = await walletManager.hasWallet(telegramId);
            if (!hasWallet) {
                return ctx.reply(
                    'You need to create or import a wallet first:',
                    commands.getWalletMenu()
                );
            }
            const integration = await getUserIntegration(telegramId, network);
            if (!integration) {
                return ctx.reply(`Failed to load your wallet. Please try again later.`);
            }
            const currentNetworkBalances = await commands.formatBalances(telegramId, network);
            let message = `${currentNetworkBalances}`;
            await ctx.replyWithMarkdown(message, {
                disable_web_page_preview: true,
                ...commands.getMainMenu()
            });
        } catch (error) {
            console.error(`Error handling balances command from user ${ctx.from.id}:`, error);
            let userMessage = '❌ Error fetching balances: ' + error.message;
            if (error.message && (error.message.includes('request limit') || error.message.includes('rate limit') || error.message.includes('429') || error.message.includes('coalesce error'))) {
                userMessage = '⚠️ The network provider is currently rate-limited. Please wait a few seconds and try again, or consider upgrading your RPC provider if this happens frequently.';
            }
            await ctx.reply(userMessage);
        }
    });

    bot.hears('My Wallet', async (ctx) => {
        setState(ctx, STATES.IDLE);
        try {
            const telegramId = ctx.from.id.toString();
            const hasWallet = await walletManager.hasWallet(telegramId);
            if (hasWallet) {
                const wallet = await walletManager.getWalletDetails(telegramId);
                const session = getSession(ctx);
                const currentNetwork = session.settings.network || 'MONAD';
                const explorerUrl = NETWORKS[currentNetwork].blockExplorerUrl;
                await ctx.replyWithMarkdown(
                    `*Your Wallet* 💼\n\n` +
                    `Address: \`${wallet.address}\`\n\n` +
                    `[View on Explorer](${explorerUrl}/address/${wallet.address})`,
                    commands.getMainMenu()
                );
            } else {
                await ctx.reply(
                    'You need to create or import a wallet first:',
                    commands.getWalletMenu()
                );
            }
        } catch (error) {
            console.error('Error in My Wallet handler:', error);
            await ctx.reply('❌ An error occurred while retrieving wallet information.');
        }
    });

    bot.hears('Swap Tokens', async (ctx) => {
        setState(ctx, STATES.IDLE);
        resetSwapData(ctx);
        const telegramId = ctx.from.id.toString();
        const hasWallet = await walletManager.hasWallet(telegramId);
        if (!hasWallet) {
            return ctx.reply(
                'You need to create or import a wallet first:',
                commands.getWalletMenu()
            );
        }
        const session = getSession(ctx);
        const currentNetwork = session.settings.network || 'MONAD';
        if (currentNetwork === 'MEGAETH') {
            return ctx.reply('⚠️ MegaETH swap is not currently supported by this bot. Please switch to Monad to use the swap feature.', commands.getMainMenu());
        }
        await ctx.replyWithMarkdown(
            `*Swap Tokens* 🔄\n\n` +
            `Select a trading pair or choose Custom Swap:`,
            commands.getSwapMenu(currentNetwork)
        );
    });

    bot.hears('Send', async (ctx) => {
        setState(ctx, STATES.IDLE);
        resetSendData(ctx);
        const telegramId = ctx.from.id.toString();
        const hasWallet = await walletManager.hasWallet(telegramId);
        if (!hasWallet) {
            return ctx.reply(
                'You need to create or import a wallet first:',
                commands.getWalletMenu()
            );
        }
        const session = getSession(ctx);
        const currentNetwork = session.settings.network || 'MONAD';
        await ctx.reply(
            'Select a token to send:',
            commands.getSendMenu(currentNetwork)
        );
    });

    // Import Wallet button handler
    bot.hears('📥 Import Wallet', async (ctx) => {
        setState(ctx, STATES.AWAITING_PRIVATE_KEY);
        await ctx.reply('Please enter your wallet private key to import your wallet.\n\n⚠️ *Never share your private key with anyone else!*', { parse_mode: 'Markdown' });
    });

    // Generate Wallet button handler
    bot.hears('🔑 Generate Wallet', async (ctx) => {
        console.log(`Generate Wallet button pressed by user ${ctx.from.id}`);
        setState(ctx, STATES.IDLE);

        try {
            const telegramId = ctx.from.id.toString();

            // Show loading message
            const loadingMessage = await ctx.reply('🔧 Generating your wallet... Please wait.');

            // Generate wallet (this automatically stores in database)
            const walletDetails = await walletManager.generateWallet(telegramId);

            // Delete loading message
            try {
                await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id);
            } catch (e) {
                console.log('Could not delete loading message');
            }

            const session = getSession(ctx);
            const network = session.settings.network || 'MONAD';

            await ctx.replyWithMarkdown(
                `*New Wallet Generated* ✅\n\n` +
                `Address: \`${walletDetails.address}\`\n\n` +
                `Private Key: ||${walletDetails.privateKey}||\n\n` +
                `⚠️ **IMPORTANT**: Save your private key securely. It will NOT be shown again!\n\n` +
                `[View on Explorer](${walletManager.getAddressExplorerUrl(walletDetails.address, network)})\n\n` +
                `Your wallet is now ready to use!`,
                commands.getMainMenu()
            );

            console.log(`✅ Wallet generation completed for user ${telegramId}`);

        } catch (error) {
            console.error('❌ Error generating wallet:', error);

            // Provide specific error messages
            if (error.message.includes('database') || error.message.includes('timeout')) {
                await ctx.reply('❌ Database connection issue. Your wallet was created but may not be saved. Please try again or contact support.', commands.getWalletMenu());
            } else {
                await ctx.reply(`❌ Error generating wallet: ${error.message}`, commands.getWalletMenu());
            }
        }
    });

    // Main Menu button handler
    bot.hears('🏠 Main Menu', async (ctx) => {
        setState(ctx, STATES.IDLE);
        await ctx.reply('Main menu:', commands.getMainMenu());
    });

    // Text handler for importing wallets
    bot.on('text', async (ctx, next) => {
        const session = getSession(ctx);

        if (session.state === STATES.AWAITING_PRIVATE_KEY) {
            const privateKey = ctx.message.text.trim();

            // Ignore if the user sends a known button label instead of a private key
            const knownButtons = [
                '🏠 Main Menu', '🔑 Generate Wallet', '📥 Import Wallet',
                'Swap Tokens', 'My Balances', 'Send', 'My Wallet',
                'Monad', 'MegaETH', '❌ Cancel'
            ];

            if (knownButtons.includes(privateKey)) {
                await ctx.reply('Please enter your wallet private key, or tap Main Menu to cancel.');
                return;
            }

            try {
                const telegramId = ctx.from.id.toString();

                // Show loading message
                const loadingMessage = await ctx.reply('🔧 Importing your wallet... Please wait.');

                // Import wallet (this automatically stores in database)
                const wallet = await walletManager.importWallet(telegramId, privateKey);

                // Delete loading message
                try {
                    await ctx.telegram.deleteMessage(ctx.chat.id, loadingMessage.message_id);
                } catch (e) {
                    console.log('Could not delete loading message');
                }

                setState(ctx, STATES.IDLE);

                await ctx.replyWithMarkdown(
                    `✅ *Wallet Imported Successfully!*\n\n` +
                    `Address: \`${wallet.address}\`\n\n` +
                    `[View on Explorer](${NETWORKS['MONAD'].blockExplorerUrl}/address/${wallet.address})`,
                    commands.getMainMenu()
                );

                console.log(`✅ Wallet import completed for user ${telegramId}`);

                // Delete the message containing the private key for security
                try {
                    await ctx.deleteMessage();
                } catch (deleteError) {
                    console.log('Could not delete message with private key');
                }

            } catch (error) {
                console.error('❌ Error importing wallet:', error);

                // Provide specific error messages
                if (error.message.includes('database') || error.message.includes('timeout')) {
                    await ctx.reply('❌ Database connection issue. Your wallet was created but may not be saved. Please try again or contact support.');
                } else {
                    await ctx.reply(`❌ Error importing wallet: ${error.message}`);
                }

                // Delete the message containing the private key for security
                try {
                    await ctx.deleteMessage();
                } catch (deleteError) {
                    console.log('Could not delete message with private key');
                }
            }
            return;
        }

        // Continue with other text handlers
        if (typeof next === 'function') await next();
    });

    console.log('✅ All bot handlers setup complete');
}

// Graceful shutdown handling
process.once('SIGINT', () => {
    console.log('\n🛑 Received SIGINT, shutting down gracefully...');
    if (bot) {
        bot.stop('SIGINT');
    }
    process.exit(0);
});

process.once('SIGTERM', () => {
    console.log('\n🛑 Received SIGTERM, shutting down gracefully...');
    if (bot) {
        bot.stop('SIGTERM');
    }
    process.exit(0);
});

// Start the initialization process
initializeBot().catch(error => {
    console.error('❌ Bot initialization failed:', error);
    process.exit(1);
});