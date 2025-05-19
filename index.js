require('dotenv').config();
const { Telegraf, Scenes, session, Markup } = require('telegraf');
const MonadIntegration = require('./utils/monadIntegration');
const WalletManager = require('./utils/walletManager');
const TelegramCommands = require('./utils/telegramCommands');
const { BOT_CONFIG, NETWORKS } = require('./config');
const ethers = require('ethers');

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
console.log("===================================\n");

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
    AWAITING_NETWORK_SELECTION: 'awaiting_network_selection'
};

// Initialize bot
const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
bot.use(session());

// Helper function to escape special Markdown V2 characters
function escapeMarkdown(text) {
    if (!text) return '';
    // Escape special characters: _*[]()~`>#+-=|{}.!
    return text.replace(/([_*\[\]()~`>#\+\-=|{}.!])/g, '\\$1');
}

// Initialize default wallets (for system operations)
let defaultMonadIntegration;
try {
    defaultMonadIntegration = new MonadIntegration(process.env.WALLET_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001');
    console.log('Default Monad integration initialized successfully');
} catch (error) {
    console.error('Error initializing default wallet:', error);
}

// Initialize managers
const walletManager = new WalletManager();
const commands = new TelegramCommands(walletManager, defaultMonadIntegration);

// Update the main menu to include chains button instead of "Switch Network"
const originalGetMainMenu = commands.getMainMenu;
commands.getMainMenu = function() {
    return Markup.keyboard([
        ['💰 My Wallet', '💱 Swap Tokens'],
        ['💸 Send', '📊 My Balances'],
        ['ℹ️ Help'],
        ['⚙️ Settings']
    ]).resize();
};

// Add network indicator to bot responses
bot.use((ctx, next) => {
    const userId = ctx.from?.id.toString();
    if (userId) {
        // Store original reply method
        const originalReply = ctx.reply;
        const originalReplyWithMarkdown = ctx.replyWithMarkdown;
        
        // Override reply method to include network info
        ctx.reply = function(text, extra = {}) {
            const session = getSession(ctx);
            // Only add network info if it's not already in the message
            if (!text.includes(`Network: ${getNetworkDisplayName('MONAD')}`)) {
                const networkText = `Network: ${getNetworkDisplayName('MONAD')}\n\n`;
            return originalReply.call(this, networkText + text, extra);
            }
            return originalReply.call(this, text, extra);
        };
        
        // Override replyWithMarkdown method
        ctx.replyWithMarkdown = function(text, extra = {}) {
            const session = getSession(ctx);
            // Only add network info if it's not already in the message
            if (!text.includes(`*Network: ${getNetworkDisplayName('MONAD')}*`)) {
            const networkText = `*Network: ${getNetworkDisplayName('MONAD')}*\n\n`;
            return originalReplyWithMarkdown.call(this, networkText + text, extra);
            }
            return originalReplyWithMarkdown.call(this, text, extra);
        };
    }
    return next();
});

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
function getUserIntegration(userId) {
    console.log(`Attempting to get blockchain integration for user ${userId}`);
    
    if (!walletManager.hasWallet(userId)) {
        console.log(`No wallet found for user ${userId}`);
        return null;
    }
    
    try {
        console.log(`Fetching wallet details for user ${userId}`);
        const wallet = walletManager.getWalletDetails(userId);
        
        if (!wallet || !wallet.privateKey) {
            console.error(`Invalid wallet data for user ${userId}:`, wallet);
            return null;
        }
        
        console.log(`Creating MONAD Integration for user ${userId} with wallet ${wallet.address}`);
        
        const integration = new MonadIntegration(wallet.privateKey);
        
        console.log(`Successfully created MONAD Integration instance for user ${userId}`);
        return integration;
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

// Get selected network display name
function getNetworkDisplayName(network) {
    return NETWORKS[network].name;
}

// Start command
bot.start(async (ctx) => {
    const session = getSession(ctx);
    setState(ctx, STATES.IDLE);
    
    await ctx.replyWithMarkdown(
        `*Welcome to Monad Trading Bot* 🚀\n\n` +
        `This bot allows you to trade tokens on the Monad blockchain.\n\n` +
        `Commands:\n` +
        `/start - Show this message\n` +
        `/wallet - Manage your wallet\n` +
        `/swap - Swap tokens\n` +
        `/send - Send tokens\n` +
        `/balances - View your token balances\n` +
        `/price - Check token prices\n` +
        `/network - Select blockchain network\n` +
        `/chains - Quick chain selection\n` +
        `/help - Get help\n` +
        `/settings - Configure bot settings`,
        commands.getMainMenu()
    );
});

// Add chains command
bot.command('chains', async (ctx) => {
    console.log(`Chains command received from user ${ctx.from.id}`);
    setState(ctx, STATES.AWAITING_NETWORK_SELECTION);
    
    await ctx.reply(
        '🔄 Select a blockchain network:',
        Markup.inlineKeyboard([
            [
                Markup.button.callback('Monad', 'network_MONAD')
            ]
        ])
    );
});

// Handle "⛓️ Chains" button click
bot.hears('⛓️ Chains', async (ctx) => {
    console.log(`Chains button pressed by user ${ctx.from.id}`);
    setState(ctx, STATES.AWAITING_NETWORK_SELECTION);
    
    await ctx.reply(
        '🔄 Select a blockchain network:',
        Markup.inlineKeyboard([
            [
                Markup.button.callback('Monad', 'network_MONAD')
            ]
        ])
    );
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
        `1. First, create or import a wallet using /wallet\n` +
        `2. Select your preferred blockchain network with /network\n` +
        `3. Fund your wallet with test tokens\n` +
        `4. Use /token to lookup any token by address and swap\n` +
        `5. Use /balances to check your token balances\n\n` +
        
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
    
    if (walletManager.hasWallet(ctx.from.id.toString())) {
        const wallet = walletManager.getWalletDetails(ctx.from.id.toString());
        const session = getSession(ctx);
        const currentNetwork = session.settings.network || 'MONAD';
        const explorerUrl = NETWORKS[currentNetwork].blockExplorerUrl;
        
        await ctx.replyWithMarkdown(
            `*Your Wallet* 💼\n\n` +
            `Network: *${getNetworkDisplayName(currentNetwork)}*\n` +
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
});

// Swap command
bot.command('swap', async (ctx) => {
    console.log(`Swap command received from user ${ctx.from.id}`);
    setState(ctx, STATES.IDLE);
    resetSwapData(ctx);
    
    if (!walletManager.hasWallet(ctx.from.id.toString())) {
        return ctx.reply(
            'You need to create or import a wallet first:',
            commands.getWalletMenu()
        );
    }
    
    const session = getSession(ctx);
    const currentNetwork = session.settings.network || 'MONAD';
    
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
    
    if (!walletManager.hasWallet(ctx.from.id.toString())) {
        return ctx.reply(
            'You need to create or import a wallet first:',
            commands.getWalletMenu()
        );
    }
    
    const session = getSession(ctx);
    const currentNetwork = session.settings.network || 'MONAD';
    
    await ctx.replyWithMarkdown(
        `*Send Tokens* 📤\n\n` +
        `Select the token you want to send:`,
        commands.getSendMenu(currentNetwork)
    );
});

// Balances command
bot.command('balances', async (ctx) => {
    console.log(`Balances command received from user ${ctx.from.id}`);
    setState(ctx, STATES.IDLE);
    
    try {
        if (!walletManager.hasWallet(ctx.from.id.toString())) {
            console.log(`User ${ctx.from.id} has no wallet, showing wallet menu`);
            return ctx.reply(
                'You need to create or import a wallet first:',
                commands.getWalletMenu()
            );
        }
        
        // Get session data
        const session = getSession(ctx);
        const currentNetwork = session.settings.network || 'MONAD';
        
        await ctx.replyWithMarkdown(`Fetching your balances... Please wait.`);
        
        // Get the current network's balances
        const integration = getUserIntegration(ctx.from.id.toString());
        if (!integration) {
            return ctx.reply(`Failed to load your wallet. Please try again later.`);
        }

        // Show balances for current network
        const currentNetworkBalances = await commands.formatBalances(ctx.from.id.toString(), currentNetwork);

        // Send consolidated balances message
        let message = `*Your ${getNetworkDisplayName(currentNetwork)} Balances* 💰\n\n${currentNetworkBalances}`;

        await ctx.replyWithMarkdown(message, {
            disable_web_page_preview: true,
            ...commands.getMainMenu()
        });
    } catch (error) {
        console.error(`Error handling balances command from user ${ctx.from.id}:`, error);
        await ctx.reply(`❌ Error fetching balances: ${error.message}`);
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
        `Network: *${getNetworkDisplayName(currentNetwork)}*\n\n` +
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

// --- BUTTON HANDLERS ---
// These need to be registered BEFORE the 'text' handler
// Handle "My Wallet" button
bot.hears('💰 My Wallet', async (ctx) => {
    console.log(`BUTTON HANDLER: My Wallet button pressed by user ${ctx.from.id}`);
    setState(ctx, STATES.IDLE);
    
    if (walletManager.hasWallet(ctx.from.id.toString())) {
        const wallet = walletManager.getWalletDetails(ctx.from.id.toString());
        const session = getSession(ctx);
        const network = session.settings.network || 'MONAD';
        
        await ctx.replyWithMarkdown(
            `*Your Wallet*\n\n` +
            `Address: \`${wallet.address}\`\n` +
            `[View on Explorer](${walletManager.getAddressExplorerUrl(wallet.address, network)})\n\n` +
            `Use the buttons below to view balances or manage your wallet:`,
            commands.getMainMenu()
        );
    } else {
        await ctx.reply(
            'You don\'t have a wallet yet. Please create or import one:',
            commands.getWalletMenu()
        );
    }
});

// Handle "Swap Tokens" button
bot.hears('💱 Swap Tokens', async (ctx) => {
    console.log(`BUTTON HANDLER: Swap Tokens button pressed by user ${ctx.from.id}`);
    setState(ctx, STATES.IDLE);
    resetSwapData(ctx);
    
    if (!walletManager.hasWallet(ctx.from.id.toString())) {
        return ctx.reply(
            'You need to create or import a wallet first:',
            commands.getWalletMenu()
        );
    }
    
    const session = getSession(ctx);
    const currentNetwork = session.settings.network || 'MONAD';
    
    await ctx.replyWithMarkdown(
        `*Swap Tokens* 🔄\n\n` +
        `Select a trading pair or choose Custom Swap:`,
        commands.getSwapMenu(currentNetwork)
    );
});

// Handle "Send" button
bot.hears('💸 Send', async (ctx) => {
    console.log(`BUTTON HANDLER: Send button pressed by user ${ctx.from.id}`);
        setState(ctx, STATES.IDLE);
        resetSendData(ctx);
    
    if (!walletManager.hasWallet(ctx.from.id.toString())) {
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

// Handle "My Balances" button
bot.hears('📊 My Balances', async (ctx) => {
    console.log(`BUTTON HANDLER: My Balances button pressed by user ${ctx.from.id}`);
            setState(ctx, STATES.IDLE);
    
    if (!walletManager.hasWallet(ctx.from.id.toString())) {
        return ctx.reply(
            'You need to create or import a wallet first:',
            commands.getWalletMenu()
        );
    }
    
    await ctx.reply('Fetching your balances... Please wait.');
    
    try {
        const session = getSession(ctx);
        const network = session.settings.network || 'MONAD';
        const balanceText = await commands.formatBalances(ctx.from.id.toString(), network);
        
        await ctx.replyWithMarkdown(balanceText, { 
            disable_web_page_preview: true,
            ...commands.getMainMenu()
        });
        } catch (error) {
        console.error('Error fetching balances:', error);
        await ctx.reply(`Error fetching balances: ${error.message}`, commands.getMainMenu());
    }
});

// Handle "Help" button
bot.hears('ℹ️ Help', async (ctx) => {
    console.log(`BUTTON HANDLER: Help button pressed by user ${ctx.from.id}`);
    setState(ctx, STATES.IDLE);
    
    await ctx.replyWithMarkdown(
        `*Monad Trading Bot Help* 🔍\n\n` +
        `*Main Commands:*\n` +
        `/start - Show welcome message\n` +
        `/wallet - Manage your wallet\n` +
        `/swap - Swap tokens\n` +
        `/send - Send tokens\n` +
        `/balances - View token balances\n` +
        `/price - Check token prices\n` +
        `/settings - Adjust bot settings\n\n` +
        
        `*Advanced Commands:*\n` +
        `/token - View token info\n` +
        `/watchlist - Manage token watchlist\n\n` +
        
        `*Using the Bot:*\n` +
        `1. First, create or import a wallet\n` +
        `2. Use buttons to navigate and perform actions\n` +
        `3. Always confirm transactions before sending\n` +
        `4. Check balances regularly\n\n` +
        
        `*Need more help?*\n` +
        `Contact support at @MonadSupportBot`,
        commands.getMainMenu()
    );
});

// Handle "Settings" button
bot.hears('⚙️ Settings', async (ctx) => {
    console.log(`BUTTON HANDLER: Settings button pressed by user ${ctx.from.id}`);
    setState(ctx, STATES.IDLE);
        
        await ctx.reply(
        'Settings Menu:',
        commands.getSettingsMenu()
    );
});

// Handle "Set Slippage" button
bot.hears('⚙️ Set Slippage', async (ctx) => {
    console.log(`BUTTON HANDLER: Set Slippage button pressed by user ${ctx.from.id}`);
    setState(ctx, STATES.AWAITING_SLIPPAGE);
    
    const session = getSession(ctx);
    const currentSlippage = session.settings.slippage || BOT_CONFIG.DEFAULT_SLIPPAGE;
    
    await ctx.reply(
        `Current slippage: ${currentSlippage}%\n\n` +
        `Enter a new slippage percentage (e.g., 0.5, 1.0, etc.):`,
            Markup.keyboard([
            ['0.1', '0.5', '1.0', '2.0'],
            ['🏠 Main Menu']
            ]).resize()
        );
});

// Handle "Manage Watchlist" button
bot.hears('📌 Manage Watchlist', async (ctx) => {
    console.log(`BUTTON HANDLER: Manage Watchlist button pressed by user ${ctx.from.id}`);
    setState(ctx, STATES.IDLE);
    
    await ctx.reply(
        'Watchlist Management:',
        commands.getWatchlistMenu()
    );
});

// Handle "Main Menu" button
bot.hears('🏠 Main Menu', async (ctx) => {
    console.log(`BUTTON HANDLER: Main Menu button pressed by user ${ctx.from.id}`);
    setState(ctx, STATES.IDLE);
    resetSwapData(ctx);
    resetSendData(ctx);
    
    await ctx.reply(
        'Main Menu:',
        commands.getMainMenu()
    );
});

// Handle token swap pair buttons (e.g., "MON → WETH", "WETH → MON", etc.)
bot.hears(/(.+) → (.+)/, async (ctx) => {
    console.log(`BUTTON HANDLER: Swap pair button pressed by user ${ctx.from.id}: ${ctx.match[0]}`);
    
    // Extract fromToken and toToken from the button text
    const fromToken = ctx.match[1].trim();
    const toToken = ctx.match[2].trim();
    
    // Validate user has a wallet
    if (!walletManager.hasWallet(ctx.from.id.toString())) {
        return ctx.reply(
            'You need to create or import a wallet first:',
            commands.getWalletMenu()
        );
    }
    
    // Get session data
    const session = getSession(ctx);
    const currentNetwork = session.settings.network || 'MONAD';
    
    // Set up swap data
    session.swapData.fromToken = fromToken;
    session.swapData.fromTokenSymbol = fromToken;
    
    // Handle custom token case
    if (toToken === 'Custom') {
        setState(ctx, STATES.AWAITING_TO_TOKEN);
                    await ctx.reply(
            `Enter the token address (0x...) for your custom token:`,
                        Markup.keyboard([
                            ['❌ Cancel']
                        ]).resize()
                    );
        return;
    }
    
    session.swapData.toToken = toToken;
    session.swapData.toTokenSymbol = toToken;
    
    // Ask for amount
    setState(ctx, STATES.AWAITING_AMOUNT);
    
    // Get the native symbol for proper prompting
    const nativeCurrency = NETWORKS[currentNetwork].nativeCurrency;
    
    await ctx.reply(
        `Enter the amount of ${fromToken === nativeCurrency ? nativeCurrency : fromToken} you want to swap:`,
        Markup.keyboard([
            ['0.1', '0.5', '1', '5'],
            ['MAX', '❌ Cancel']
        ]).resize()
    );
});

// Handle "Custom Swap" button
bot.hears('Custom Swap', async (ctx) => {
    console.log(`BUTTON HANDLER: Custom Swap button pressed by user ${ctx.from.id}`);
    
    // Validate the user has a wallet
    if (!walletManager.hasWallet(ctx.from.id.toString())) {
        return ctx.reply(
            'You need to create or import a wallet first:',
            commands.getWalletMenu()
        );
    }
    
    const session = getSession(ctx);
    const currentNetwork = session.settings.network || 'MONAD';
    
    // Set state to await from token selection
    setState(ctx, STATES.AWAITING_FROM_TOKEN);
    
    // Show token selection menu
    await ctx.reply(
        'Select the token you want to swap FROM:',
        Markup.keyboard([
            ['MON', 'WETH', 'USDC'],
            ['USDT', 'WBTC', 'WSOL'],
            ['Custom Token', '❌ Cancel']
        ]).resize()
    );
});

// Handle "Send Custom Token" button
bot.hears('Send Custom Token', async (ctx) => {
    console.log(`BUTTON HANDLER: Send Custom Token button pressed by user ${ctx.from.id}`);
    
    const session = getSession(ctx);
    setState(ctx, STATES.AWAITING_TOKEN_ADDRESS);
    session.sendData.customToken = true;
    
    await ctx.reply(
        'Please enter the token address (0x...):',
        Markup.keyboard([['❌ Cancel']]).resize()
    );
});

// Handle "View Watchlist" button
bot.hears('📊 View Watchlist', async (ctx) => {
    console.log(`BUTTON HANDLER: View Watchlist button pressed by user ${ctx.from.id}`);
                    setState(ctx, STATES.IDLE);
    
    try {
        await commands.viewWatchlist(ctx);
                } catch (error) {
        console.error('Error viewing watchlist:', error);
        await ctx.reply(`Error: ${error.message}`, commands.getWatchlistMenu());
    }
});

// Handle "Add Token" to watchlist button
bot.hears('📌 Add Token', async (ctx) => {
    console.log(`BUTTON HANDLER: Add Token button pressed by user ${ctx.from.id}`);
    setState(ctx, STATES.AWAITING_WATCHLIST_TOKEN);
    
    await ctx.reply(
        'Enter the token address (0x...) to add to your watchlist:',
        Markup.keyboard([['❌ Cancel']]).resize()
    );
});

// Handle "Remove Token" from watchlist button
bot.hears('🗑️ Remove Token', async (ctx) => {
    console.log(`BUTTON HANDLER: Remove Token button pressed by user ${ctx.from.id}`);
    setState(ctx, STATES.AWAITING_REMOVE_TOKEN);
    
    await ctx.reply(
        'Enter the token address or symbol to remove from your watchlist:',
        Markup.keyboard([['❌ Cancel']]).resize()
    );
});

// Handle send token buttons (e.g., "Send MON", "Send USDC", etc.)
bot.hears(/Send (.+)/, async (ctx) => {
    console.log(`BUTTON HANDLER: Send Token button pressed by user ${ctx.from.id}: ${ctx.match[0]}`);
    
    // Extract token from the button text
    const token = ctx.match[1].trim();
    
    // Store token in session data
    const session = getSession(ctx);
    session.sendData.token = token;
    setState(ctx, STATES.AWAITING_RECIPIENT);
    
    await ctx.reply(
        `Please enter the recipient address:`,
        Markup.keyboard([['❌ Cancel']]).resize()
    );
});

// Handle wallet button presses
bot.hears('🔑 Generate Wallet', async (ctx) => {
    console.log(`BUTTON HANDLER: Generate Wallet button pressed by user ${ctx.from.id}`);
    setState(ctx, STATES.IDLE);
    
    try {
        const walletDetails = walletManager.generateWallet(ctx.from.id.toString());
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
        } catch (error) {
        console.error('Error generating wallet:', error);
        await ctx.reply(`Error: ${error.message}`, commands.getWalletMenu());
    }
});

bot.hears('📥 Import Wallet', async (ctx) => {
    console.log(`BUTTON HANDLER: Import Wallet button pressed by user ${ctx.from.id}`);
    setState(ctx, STATES.AWAITING_PRIVATE_KEY);
    
    await ctx.reply(
        'Please enter your private key (0x...):',
        Markup.keyboard([['❌ Cancel']]).resize()
    );
});

// Handle Cancel button
bot.hears('❌ Cancel', async (ctx) => {
    console.log(`Cancel button pressed by user ${ctx.from.id}`);
    setState(ctx, STATES.IDLE);
    resetSwapData(ctx);
    resetSendData(ctx);
    
    await ctx.reply(
        'Operation cancelled.',
        commands.getMainMenu()
    );
});

// Action handlers for inline buttons (needed for transaction processing)
// Handle confirm swap action
bot.action('confirm_swap', async (ctx) => {
    console.log(`ACTION HANDLER: Confirm swap button pressed by user ${ctx.from.id}`);
    const session = getSession(ctx);
    
    if (!session.swapData || !session.swapData.fromToken || !session.swapData.toToken || !session.swapData.amount) {
        console.log('Missing swap data:', session.swapData);
        return ctx.reply('Invalid swap data. Please try again.', 
            commands.getMainMenu());
    }
    
    // Create a status message that will be updated throughout the process
    await ctx.answerCbQuery('Processing swap...');
    const statusMessage = await ctx.reply('💱 Initializing swap transaction...');
    
    try {
        // Get user's integration
        const userIntegration = new MonadIntegration(
            walletManager.getWalletDetails(ctx.from.id.toString()).privateKey
        );
        
        // Get current network from user settings
        const network = session.settings?.network || 'MONAD';
        
        // Get slippage from user settings or use default
        const slippage = session.settings?.slippage || BOT_CONFIG.DEFAULT_SLIPPAGE;
        
        // Execute the swap
        console.log(`Executing swap: ${session.swapData.fromToken} -> ${session.swapData.toToken}, amount: ${session.swapData.amount}`);
        
        // Create a function to update the status message during swap execution
        let lastProgressUpdate = Date.now();
        const updateMessage = async (stage, message) => {
            // Only update the message if it's been at least 1 second since the last update
            // to avoid hitting Telegram rate limits
            const now = Date.now();
            if (now - lastProgressUpdate > 1000) {
                try {
        await ctx.telegram.editMessageText(
                        statusMessage.chat.id,
            statusMessage.message_id, 
            null,
                        `💱 *Swap Progress*\n\n*Status*: ${stage}\n\n${message}`,
                        { parse_mode: 'Markdown' }
                    );
                    lastProgressUpdate = now;
                } catch (e) {
                    console.error('Error updating status message:', e);
                }
            }
        };
        
        // Show initial status
        await updateMessage('PREPARING', 'Preparing swap transaction...');
        
        // Execute the swap using executeSwap from telegramCommands
        const result = await commands.executeSwap(
            ctx.from.id.toString(), 
            session.swapData.fromToken, 
            session.swapData.toToken, 
            session.swapData.amount,
            slippage,
            session.swapData.fromTokenSymbol,
            session.swapData.toTokenSymbol,
            network
        );
        
        // Send the final result
        if (result.success) {
        await ctx.telegram.editMessageText(
                statusMessage.chat.id,
            statusMessage.message_id, 
            null,
                result.message,
                { parse_mode: 'Markdown' }
            );
            setState(ctx, STATES.IDLE);
            resetSwapData(ctx);
        } else {
            await ctx.telegram.editMessageText(
                statusMessage.chat.id,
                statusMessage.message_id, 
                null,
                `❌ *Swap Failed*\n\n${result.message}`,
                { parse_mode: 'Markdown' }
            );
            setState(ctx, STATES.IDLE);
            resetSwapData(ctx);
        }
        
    } catch (error) {
        console.error('Error processing swap:', error);
        await ctx.telegram.editMessageText(
            statusMessage.chat.id,
            statusMessage.message_id,
            null,
            `❌ *Swap Failed*\n\nAn unexpected error occurred: ${error.message}`,
            { parse_mode: 'Markdown' }
        );
        setState(ctx, STATES.IDLE);
        resetSwapData(ctx);
    }
});

// Handle cancel swap action
bot.action('cancel_swap', async (ctx) => {
    console.log(`ACTION HANDLER: Cancel swap button pressed by user ${ctx.from.id}`);
    
    try {
        await ctx.answerCbQuery('Swap cancelled');
        await ctx.editMessageText('Swap cancelled.');
    resetSwapData(ctx);
        setState(ctx, STATES.IDLE);
        await ctx.reply('What would you like to do instead?', commands.getMainMenu());
    } catch (error) {
        console.error('Error cancelling swap:', error);
    }
});

// Handle confirm send action
bot.action('confirm_send', async (ctx) => {
    console.log(`ACTION HANDLER: Confirm send button pressed by user ${ctx.from.id}`);
    const session = getSession(ctx);
    
    if (!session.sendData || !session.sendData.token || !session.sendData.recipient || !session.sendData.amount) {
        console.log('Missing send data:', session.sendData);
        return ctx.reply('Invalid transaction data. Please try again.', 
            commands.getMainMenu());
    }
    
    // Create a status message that will be updated throughout the process
    await ctx.answerCbQuery('Processing transaction...');
    const statusMessage = await ctx.reply('💸 Initializing transaction...');
    
    try {
        const network = session.settings.network || 'MONAD';
        
        // Execute the send operation
        const result = await commands.sendTokens(
            ctx.from.id.toString(),
            session.sendData.token,
            session.sendData.recipient,
            session.sendData.amount,
            network
        );
        
        if (result.success) {
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            statusMessage.message_id, 
            null,
                `✅ Transaction sent successfully!\n\n${result.message}`,
                { parse_mode: 'Markdown', disable_web_page_preview: true }
            );
            
            // Reset send data
            resetSendData(ctx);
            setState(ctx, STATES.IDLE);
            
            await ctx.reply('What would you like to do next?', commands.getMainMenu());
        } else {
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            statusMessage.message_id, 
            null,
                `❌ Transaction failed: ${result.message}`,
                { parse_mode: 'Markdown' }
            );
            
            await ctx.reply('Would you like to try again?', commands.getMainMenu());
        }
    } catch (error) {
        console.error('Error sending transaction:', error);
        
        await ctx.telegram.editMessageText(
            ctx.chat.id, 
            statusMessage.message_id, 
            null,
            `❌ Transaction failed with error: ${error.message}`,
            { parse_mode: 'Markdown' }
        );
        
        await ctx.reply('Would you like to try again?', commands.getMainMenu());
    }
});

// Handle cancel send action
bot.action('cancel_send', async (ctx) => {
    console.log(`ACTION HANDLER: Cancel send button pressed by user ${ctx.from.id}`);
    
    try {
        await ctx.answerCbQuery('Transaction cancelled');
        await ctx.editMessageText('Transaction cancelled.');
        resetSendData(ctx);
        setState(ctx, STATES.IDLE);
        await ctx.reply('What would you like to do instead?', commands.getMainMenu());
    } catch (error) {
        console.error('Error cancelling transaction:', error);
    }
});

// Handle network selection actions
bot.action(/network_(.+)/, async (ctx) => {
    const network = ctx.match[1];
    console.log(`ACTION HANDLER: Network selection button pressed for ${network} by user ${ctx.from.id}`);
    
    await ctx.answerCbQuery();
    
    if (network === 'MONAD') {
        const session = getSession(ctx);
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

// Handle "back" button action
bot.action('back', async (ctx) => {
    console.log(`ACTION HANDLER: Back button pressed by user ${ctx.from.id}`);
    
    try {
        await ctx.answerCbQuery();
    setState(ctx, STATES.IDLE);
        await ctx.reply('Main menu:', commands.getMainMenu());
    } catch (error) {
        console.error('Error handling back button:', error);
    }
});

// Handle main menu button
bot.action('main_menu', async (ctx) => {
    console.log(`ACTION HANDLER: Main Menu button pressed by user ${ctx.from.id}`);
    
    try {
        await ctx.answerCbQuery('Going back to main menu...');
        setState(ctx, STATES.IDLE);
        resetSwapData(ctx);
        resetSendData(ctx);
        
        await ctx.reply('Main Menu:', commands.getMainMenu());
    } catch (error) {
        console.error('Error handling main menu button:', error);
    }
});

// Handle refresh token button
bot.action(/refresh_token_(.+)/, async (ctx) => {
    console.log(`ACTION HANDLER: Refresh token button pressed by user ${ctx.from.id}`);
    const shortTokenId = ctx.match[1];
    
    try {
        await ctx.answerCbQuery('Refreshing token data...');
        
        // Resolve the full token address from the short ID
        const tokenAddress = await commands.getFullTokenAddress(shortTokenId);
        console.log(`Resolved short token ID ${shortTokenId} to full address ${tokenAddress}`);
        
        // Get integration for token scanning
        const integration = getUserIntegration(ctx.from.id.toString());
        if (!integration) {
            return ctx.reply('Please import or create a wallet first.');
        }
        
        try {
            // Create a token contract instance
            const tokenContract = new ethers.Contract(
                tokenAddress,
                [
                    "function symbol() view returns (string)",
                    "function name() view returns (string)",
                    "function decimals() view returns (uint8)",
                    "function totalSupply() view returns (uint256)",
                    "function balanceOf(address) view returns (uint256)"
                ],
                integration.provider
            );
            
            // Get token details
            const [symbol, name, decimals, totalSupply, balance] = await Promise.all([
                tokenContract.symbol().catch(() => 'Unknown'),
                tokenContract.name().catch(() => 'Unknown Token'),
                tokenContract.decimals().catch(() => 18),
                tokenContract.totalSupply().catch(() => 0),
                tokenContract.balanceOf(integration.wallet.address).catch(() => 0)
            ]);
            
            // Format the balance
            const formattedBalance = ethers.formatUnits(balance, decimals);
            const formattedTotalSupply = ethers.formatUnits(totalSupply, decimals);
            
            // Create a response message with token details
            const message = escapeMarkdown(`📊 *TOKEN DETAILS* (Refreshed)

*${symbol} (${name})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
• *Symbol:*  \`${symbol}\`
• *Name:*  \`${name}\`
• *Address:*  \`${tokenAddress}\`
• *Decimals:*  \`${decimals}\`
• *Network:*  \`Monad Testnet\`

💰 *BALANCE*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
• *Your Balance:*  \`${formattedBalance} ${symbol}\`
• *Total Supply:*  \`${formattedTotalSupply}\`

🔍 [View on Explorer](${integration.network.blockExplorerUrl}/token/${tokenAddress})`);
            
            // Get shortened token ID once 
            const shortTokenId = commands.createShortTokenId(tokenAddress);
                
            // Create and validate all callback data
            const swapFromData = commands.validateCallbackData(`swap_from_${shortTokenId}`, 'cancel_action');
            const sendData = commands.validateCallbackData(`send_${shortTokenId}`, 'cancel_action');
            const swap25Data = commands.validateCallbackData(`swap_amount_25_${shortTokenId}`, 'cancel_action');
            const swap50Data = commands.validateCallbackData(`swap_amount_50_${shortTokenId}`, 'cancel_action');
            const swap100Data = commands.validateCallbackData(`swap_amount_100_${shortTokenId}`, 'cancel_action');
            const watchData = commands.validateCallbackData(`watch_${shortTokenId}`, 'cancel_action');
            const refreshData = commands.validateCallbackData(`refresh_token_${shortTokenId}`, 'cancel_action');
            
            // Create enhanced inline keyboard with token actions
            const keyboard = {
                inline_keyboard: [
                    [
                        { text: `💱 Swap ${symbol}`, callback_data: swapFromData },
                        { text: `📤 Send ${symbol}`, callback_data: sendData }
                    ],
                    [
                        { text: `Swap 25%`, callback_data: swap25Data },
                        { text: `Swap 50%`, callback_data: swap50Data },
                        { text: `Swap 100%`, callback_data: swap100Data }
                    ],
                    [
                        { text: `📈 Add to Watchlist`, callback_data: watchData },
                        { text: `🔄 Refresh`, callback_data: refreshData }
                    ],
                    [
                        { text: `🏠 Back to Menu`, callback_data: `main_menu` }
                    ]
                ]
            };
            
            // Edit message with updated token details
            await ctx.editMessageText(
                message, 
                { 
                    parse_mode: 'MarkdownV2', 
                    disable_web_page_preview: true,
                    reply_markup: keyboard
                }
            );
            
        } catch (error) {
            console.error('Error refreshing token:', error);
            await ctx.reply(`❌ Error refreshing token data: ${error.message}`);
        }
    } catch (error) {
        console.error('Error handling refresh token action:', error);
        await ctx.reply(`❌ Error: ${error.message}`);
    }
});

// Handle percentage-based swap actions for tokens
bot.action(/swap_amount_(\d+)_(.+)/, async (ctx) => {
    console.log(`ACTION HANDLER: Swap percentage button pressed by user ${ctx.from.id}`);
    const percentage = parseInt(ctx.match[1]);
    const shortTokenId = ctx.match[2];
    
    try {
        await ctx.answerCbQuery(`Preparing to swap ${percentage}% of your tokens...`);
        
        // Get user's integration
        const integration = getUserIntegration(ctx.from.id.toString());
        if (!integration) {
            return ctx.reply('Please import or create a wallet first.');
        }
        
        // Resolve the full token address from the short ID
        const tokenAddress = await commands.getFullTokenAddress(shortTokenId);
        console.log(`Resolved short token ID ${shortTokenId} to full address ${tokenAddress}`);
        
        // Get token details
        try {
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ["function symbol() view returns (string)", "function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"],
                integration.provider
            );
            
            // Get token balance and details
            const [balance, symbol, decimals] = await Promise.all([
                tokenContract.balanceOf(integration.wallet.address),
                tokenContract.symbol().catch(() => 'Unknown'),
                tokenContract.decimals().catch(() => 18)
            ]);
            
            // Calculate amount based on percentage
            const totalBalance = ethers.formatUnits(balance, decimals);
            const amount = (parseFloat(totalBalance) * percentage / 100).toFixed(6);
            
            if (parseFloat(amount) <= 0) {
                return ctx.reply(`You don't have enough ${symbol} to swap.`);
            }
            
            // Set up session data for the swap
            const session = getSession(ctx);
            resetSwapData(ctx);
            
            session.swapData.fromToken = tokenAddress;
            session.swapData.fromTokenSymbol = symbol;
            session.swapData.amount = amount;
            
            // Add native MON as default "to" token
            const networkConfig = NETWORKS[session.settings?.network || 'MONAD'];
            session.swapData.toToken = networkConfig.addresses.WETH;
            session.swapData.toTokenSymbol = networkConfig.nativeCurrency;
            
            // Confirm the swap with the user
            const slippage = session.settings?.slippage || BOT_CONFIG.DEFAULT_SLIPPAGE;
            
            // Use reply instead of replyWithMarkdown to avoid syntax issues
            await ctx.reply(
                `*Confirm Swap* 💱\n\n` +
                `Network: *${networkConfig.name}*\n` +
                `From: *${amount} ${symbol}* (${percentage}% of balance)\n` +
                `To: *${networkConfig.nativeCurrency}*\n` +
                `Slippage Tolerance: *${slippage}%*\n\n` +
                `Do you want to proceed with this swap?`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Confirm', callback_data: 'confirm_swap' },
                                { text: '❌ Cancel', callback_data: 'cancel_swap' }
                            ]
                        ]
                    }
                }
            );
            
            setState(ctx, STATES.AWAITING_SWAP_CONFIRMATION);
        } catch (error) {
            console.error('Error preparing percentage swap:', error);
            await ctx.reply(`❌ Error preparing swap: ${error.message}`);
        }
    } catch (error) {
        console.error('Error handling percentage swap action:', error);
        await ctx.reply(`❌ Error: ${error.message}`);
    }
});

// Handle token actions (send, swap, watchlist)
bot.action(/send_(.+)/, async (ctx) => {
    console.log(`ACTION HANDLER: Send token button pressed by user ${ctx.from.id}`);
    const shortTokenId = ctx.match[1];
    
    try {
        await ctx.answerCbQuery('Preparing to send token...');
        
        // Resolve the full token address from the short ID
        const tokenAddress = await commands.getFullTokenAddress(shortTokenId);
        console.log(`Resolved short token ID ${shortTokenId} to full address ${tokenAddress}`);
        
        // Create session data for sending this token
        const session = getSession(ctx);
        resetSendData(ctx);
        session.sendData.token = tokenAddress;
        session.sendData.customToken = true;
        
        // Get token symbol for better UX
        const integration = getUserIntegration(ctx.from.id.toString());
        if (!integration) {
            return ctx.reply('Please import or create a wallet first.');
        }
        
        try {
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ["function symbol() view returns (string)", "function name() view returns (string)", "function decimals() view returns (uint8)"],
                integration.provider
            );
            
            const [symbol, name, decimals] = await Promise.all([
                tokenContract.symbol().catch(() => 'Unknown'),
                tokenContract.name().catch(() => 'Unknown Token'),
                tokenContract.decimals().catch(() => 18)
            ]);
            
            session.sendData.tokenSymbol = symbol;
            session.sendData.tokenName = name;
            session.sendData.tokenDecimals = decimals;
            
            // Set state to awaiting recipient
            setState(ctx, STATES.AWAITING_RECIPIENT);
            
            // Prompt for recipient address
            await ctx.reply(
                `🔹 *${symbol}* (${name})\nPlease enter the recipient address:`, 
                { 
                    parse_mode: 'Markdown',
                    reply_markup: {
                        keyboard: [
                            [{ text: '❌ Cancel' }]
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                }
            );
        } catch (error) {
            console.error('Error getting token details:', error);
            session.sendData.tokenSymbol = 'Custom Token';
            
            // Set state to awaiting recipient
            setState(ctx, STATES.AWAITING_RECIPIENT);
            
            // Prompt for recipient address
            await ctx.reply(
                `Token: ${tokenAddress}\nPlease enter the recipient address:`,
                {
                    reply_markup: {
                        keyboard: [
                            [{ text: '❌ Cancel' }]
                        ],
                        resize_keyboard: true,
                        one_time_keyboard: true
                    }
                }
            );
        }
    } catch (error) {
        console.error('Error handling send token action:', error);
        await ctx.reply(`❌ Error: ${error.message}`);
    }
});

bot.action(/swap_from_(.+)/, async (ctx) => {
    console.log(`ACTION HANDLER: Swap token button pressed by user ${ctx.from.id}`);
    const shortTokenId = ctx.match[1];
    
    try {
        await ctx.answerCbQuery('Preparing swap...');
        
        // Resolve the full token address from the short ID
        const tokenAddress = await commands.getFullTokenAddress(shortTokenId);
        console.log(`Resolved short token ID ${shortTokenId} to full address ${tokenAddress}`);
        
        // Set up session data for the swap
        const session = getSession(ctx);
        resetSwapData(ctx);
        session.swapData.fromToken = tokenAddress;
        
        // Get token details
        const integration = getUserIntegration(ctx.from.id.toString());
        if (!integration) {
            return ctx.reply('Please import or create a wallet first.');
        }
        
        try {
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ["function symbol() view returns (string)", "function name() view returns (string)"],
                integration.provider
            );
            
            const [symbol, name] = await Promise.all([
                tokenContract.symbol().catch(() => 'Unknown'),
                tokenContract.name().catch(() => 'Unknown Token')
            ]);
            
            session.swapData.fromSymbol = symbol;
            
            // Get all available tokens for a swap
            const networkConfig = NETWORKS[session.settings?.network || 'MONAD'];
            const availableTokens = Object.values(networkConfig.tokens).filter(
                // Filter out the token we're swapping from
                token => token.address.toLowerCase() !== tokenAddress.toLowerCase()
            );
            
            // Add native MON as an option
            availableTokens.unshift({
                symbol: networkConfig.nativeCurrency,
                name: 'Monad',
                address: integration.network.addresses.WETH, // Use WETH address for native swaps
                isNative: true
            });
            
            // Build keyboard with token options
            const keyboard = [];
            const tokensPerRow = 2;
            
            for (let i = 0; i < availableTokens.length; i += tokensPerRow) {
                const row = [];
                for (let j = 0; j < tokensPerRow && i + j < availableTokens.length; j++) {
                    const token = availableTokens[i + j];
                    // Make sure callback_data doesn't exceed Telegram's 64-byte limit
                    const shortFromId = commands.createShortTokenId(tokenAddress);
                    const shortToId = token.isNative ? 'native' : commands.createShortTokenId(token.address);
                    let callbackData = token.isNative ? 
                        `swap_to_native_from_${shortFromId}` : 
                        `swap_to_${shortToId}_from_${shortFromId}`;
                    
                    // Validate to ensure it doesn't exceed Telegram's 64-byte limit
                    callbackData = commands.validateCallbackData(callbackData, 'cancel_swap');
                    
                    console.log(`Created callback data: ${callbackData} (${callbackData.length} bytes)`);
                    
                    row.push({
                        text: token.symbol,
                        callback_data: callbackData
                    });
                }
                keyboard.push(row);
            }
            
            // Add a cancel button
            keyboard.push([{ text: 'Cancel', callback_data: 'cancel_swap' }]);
            
            await ctx.reply(
                `Select a token to swap ${symbol} to:`,
                {
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            );
            
            setState(ctx, STATES.AWAITING_SWAP_TO_TOKEN);
            
        } catch (error) {
            console.error('Error getting token details:', error);
            await ctx.reply(`❌ Error getting token details: ${error.message}`);
        }
    } catch (error) {
        console.error('Error handling swap token action:', error);
        await ctx.reply(`❌ Error: ${error.message}`);
    }
});

bot.action(/watch_(.+)/, async (ctx) => {
    console.log(`ACTION HANDLER: Watch token button pressed by user ${ctx.from.id}`);
    const shortTokenId = ctx.match[1];
    
    try {
        await ctx.answerCbQuery('Adding to watchlist...');
        
        // Resolve the full token address from the short ID
        const tokenAddress = await commands.getFullTokenAddress(shortTokenId);
        console.log(`Resolved short token ID ${shortTokenId} to full address ${tokenAddress}`);
        
        // Get token details
        const integration = getUserIntegration(ctx.from.id.toString());
        if (!integration) {
            return ctx.reply('Please import or create a wallet first.');
        }
        
        try {
            const tokenContract = new ethers.Contract(
                tokenAddress,
                ["function symbol() view returns (string)", "function name() view returns (string)"],
                integration.provider
            );
            
            const [symbol, name] = await Promise.all([
                tokenContract.symbol().catch(() => 'Unknown'),
                tokenContract.name().catch(() => 'Unknown Token')
            ]);
            
            // Add to user's watchlist (implement in session data)
            const session = getSession(ctx);
            if (!session.watchlist) {
                session.watchlist = [];
            }
            
            // Check if token is already in watchlist
            const existingIndex = session.watchlist.findIndex(
                t => t.address.toLowerCase() === tokenAddress.toLowerCase()
            );
            
            if (existingIndex >= 0) {
                await ctx.reply(`${symbol} is already in your watchlist!`);
            } else {
                // Add to watchlist
                session.watchlist.push({
                    address: tokenAddress,
                    symbol,
                    name,
                    dateAdded: new Date().toISOString()
                });
                
                await ctx.reply(`✅ Added ${symbol} (${name}) to your watchlist!`);
            }
        } catch (error) {
            console.error('Error adding token to watchlist:', error);
            await ctx.reply(`❌ Error adding token to watchlist: ${error.message}`);
        }
    } catch (error) {
        console.error('Error handling watch token action:', error);
        await ctx.reply(`❌ Error: ${error.message}`);
    }
});

// Handle swap_to_token actions (selecting a destination token)
bot.action(/swap_to_(.+)_from_(.+)/, async (ctx) => {
    console.log(`ACTION HANDLER: Swap to token button pressed by user ${ctx.from.id}`);
    const toShortTokenId = ctx.match[1];
    const fromShortTokenId = ctx.match[2];
    
    try {
        await ctx.answerCbQuery('Preparing swap...');
        
        // Resolve the full token addresses from the short IDs
        const toTokenAddress = await commands.getFullTokenAddress(toShortTokenId);
        const fromTokenAddress = await commands.getFullTokenAddress(fromShortTokenId);
        console.log(`Resolved tokens: From ${fromShortTokenId} (${fromTokenAddress}) to ${toShortTokenId} (${toTokenAddress})`);
        
        // Get token details
        const integration = getUserIntegration(ctx.from.id.toString());
        if (!integration) {
            return ctx.reply('Please import or create a wallet first.');
        }
        
        try {
            // Get symbols for better UX
            const fromTokenContract = new ethers.Contract(
                fromTokenAddress,
                ["function symbol() view returns (string)", "function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"],
                integration.provider
            );
            
            const toTokenContract = new ethers.Contract(
                toTokenAddress,
                ["function symbol() view returns (string)"],
                integration.provider
            );
            
            const [fromSymbol, toSymbol, fromBalance, fromDecimals] = await Promise.all([
                fromTokenContract.symbol().catch(() => 'Unknown'),
                toTokenContract.symbol().catch(() => 'Unknown'),
                fromTokenContract.balanceOf(integration.wallet.address),
                fromTokenContract.decimals().catch(() => 18)
            ]);
            
            // Set up session data for the swap
            const session = getSession(ctx);
            resetSwapData(ctx);
            
            session.swapData.fromToken = fromTokenAddress;
            session.swapData.fromTokenSymbol = fromSymbol;
            session.swapData.toToken = toTokenAddress;
            session.swapData.toTokenSymbol = toSymbol;
            
            // Format the balance for display
            const formattedBalance = ethers.formatUnits(fromBalance, fromDecimals);
            
            // Prompt for amount
            await ctx.reply(
                `Available balance: ${formattedBalance} ${fromSymbol}\n\n` +
                `Enter the amount of ${fromSymbol} you want to swap for ${toSymbol}:`,
                {
                    reply_markup: {
                        keyboard: [
                            ['25% of balance', '50% of balance', '100% of balance'],
                            ['0.1', '1', '10'],
                            ['❌ Cancel']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            
            setState(ctx, STATES.AWAITING_AMOUNT);
            
        } catch (error) {
            console.error('Error preparing token swap:', error);
            await ctx.reply(`❌ Error preparing swap: ${error.message}`);
        }
    } catch (error) {
        console.error('Error handling swap_to action:', error);
        await ctx.reply(`❌ Error: ${error.message}`);
    }
});

// Handle swap_to_native actions (selecting native token as destination)
bot.action(/swap_to_native_from_(.+)/, async (ctx) => {
    console.log(`ACTION HANDLER: Swap to native button pressed by user ${ctx.from.id}`);
    const fromShortTokenId = ctx.match[1];
    
    try {
        await ctx.answerCbQuery('Preparing swap to native currency...');
        
        // Resolve the full token address from the short ID
        const fromTokenAddress = await commands.getFullTokenAddress(fromShortTokenId);
        console.log(`Resolved from token: ${fromShortTokenId} (${fromTokenAddress})`);
        
        // Get token details
        const integration = getUserIntegration(ctx.from.id.toString());
        if (!integration) {
            return ctx.reply('Please import or create a wallet first.');
        }
        
        try {
            // Get source token details
            const fromTokenContract = new ethers.Contract(
                fromTokenAddress,
                ["function symbol() view returns (string)", "function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"],
                integration.provider
            );
            
            const [fromSymbol, fromBalance, fromDecimals] = await Promise.all([
                fromTokenContract.symbol().catch(() => 'Unknown'),
                fromTokenContract.balanceOf(integration.wallet.address),
                fromTokenContract.decimals().catch(() => 18)
            ]);
            
            // Set up session data for the swap
            const session = getSession(ctx);
            const networkConfig = NETWORKS[session.settings?.network || 'MONAD'];
            const nativeSymbol = networkConfig.nativeCurrency;
            
            resetSwapData(ctx);
            
            session.swapData.fromToken = fromTokenAddress;
            session.swapData.fromTokenSymbol = fromSymbol;
            session.swapData.toToken = networkConfig.addresses.WETH; // Use WETH address for native swaps
            session.swapData.toTokenSymbol = nativeSymbol;
            
            // Format the balance for display
            const formattedBalance = ethers.formatUnits(fromBalance, fromDecimals);
            
            // Prompt for amount
            await ctx.reply(
                `Available balance: ${formattedBalance} ${fromSymbol}\n\n` +
                `Enter the amount of ${fromSymbol} you want to swap for ${nativeSymbol}:`,
                {
                    reply_markup: {
                        keyboard: [
                            ['25% of balance', '50% of balance', '100% of balance'],
                            ['0.1', '1', '10'],
                            ['❌ Cancel']
                        ],
                        resize_keyboard: true
                    }
                }
            );
            
            setState(ctx, STATES.AWAITING_AMOUNT);
            
        } catch (error) {
            console.error('Error preparing token to native swap:', error);
            await ctx.reply(`❌ Error preparing swap: ${error.message}`);
        }
    } catch (error) {
        console.error('Error handling swap_to_native action:', error);
        await ctx.reply(`❌ Error: ${error.message}`);
    }
});

// NOW register the text handler, which should run only if no button handlers match
// Handle text input
bot.on('text', async (ctx) => {
    const text = ctx.message.text;
    const session = getSession(ctx);
    
    // Check for cancel actions
    if (text === '❌ Cancel') {
        setState(ctx, STATES.IDLE);
        resetSwapData(ctx);
        resetSendData(ctx);
        return ctx.reply('Operation cancelled.', commands.getMainMenu());
    }
    
    // Custom token address scanning
    // Check if the text looks like an ethereum address - Auto-detect contract address pasting
    if (text.startsWith('0x') && text.length === 42 && 
        session.state !== STATES.AWAITING_PRIVATE_KEY && 
        session.state !== STATES.AWAITING_TOKEN_ADDRESS && 
        session.state !== STATES.AWAITING_RECIPIENT) {
        
        console.log(`Detected token address input: ${text}`);
        
        try {
            // Validate the address
            if (!ethers.isAddress(text)) {
                return ctx.reply('Please enter a valid token address (0x...).');
            }
            
            // Show a loading message because token scanning might take time
            const loadingMsg = await ctx.reply('🔍 Scanning token contract... Please wait...');
            
            // Get integration for token scanning
            const integration = getUserIntegration(ctx.from.id.toString());
            if (!integration) {
                await ctx.telegram.editMessageText(
                    ctx.chat.id, 
                    loadingMsg.message_id, 
                    null, 
                    'Please import or create a wallet first.'
                );
                return;
            }
            
            try {
                // Create a token contract instance
                const tokenContract = new ethers.Contract(
                    text,
                    [
                        "function symbol() view returns (string)",
                        "function name() view returns (string)",
                        "function decimals() view returns (uint8)",
                        "function totalSupply() view returns (uint256)",
                        "function balanceOf(address) view returns (uint256)"
                    ],
                    integration.provider
                );
                
                // Get token details
                const [symbol, name, decimals, totalSupply, balance] = await Promise.all([
                    tokenContract.symbol().catch(() => 'Unknown'),
                    tokenContract.name().catch(() => 'Unknown Token'),
                    tokenContract.decimals().catch(() => 18),
                    tokenContract.totalSupply().catch(() => 0),
                    tokenContract.balanceOf(integration.wallet.address).catch(() => 0)
                ]);
                
                // Format the balance
                const formattedBalance = ethers.formatUnits(balance, decimals);
                const formattedTotalSupply = ethers.formatUnits(totalSupply, decimals);
                
                // Create a more professional response message with token details
                const message = escapeMarkdown(`📊 *TOKEN DETAILS*

*${symbol} (${name})*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
• *Symbol:*  \`${symbol}\`
• *Name:*  \`${name}\`
• *Address:*  \`${text}\`
• *Decimals:*  \`${decimals}\`
• *Network:*  \`Monad Testnet\`

💰 *BALANCE*
━━━━━━━━━━━━━━━━━━━━━━━━━━━
• *Your Balance:*  \`${formattedBalance} ${symbol}\`
• *Total Supply:*  \`${formattedTotalSupply}\`

🔍 [View on Explorer](${integration.network.blockExplorerUrl}/token/${text})`);
                
                                // Get shortened token ID once 
                const shortTokenId = commands.createShortTokenId(text);
                
                // Create and validate all callback data
                const swapFromData = commands.validateCallbackData(`swap_from_${shortTokenId}`, 'cancel_action');
                const sendData = commands.validateCallbackData(`send_${shortTokenId}`, 'cancel_action');
                const swap25Data = commands.validateCallbackData(`swap_amount_25_${shortTokenId}`, 'cancel_action');
                const swap50Data = commands.validateCallbackData(`swap_amount_50_${shortTokenId}`, 'cancel_action');
                const swap100Data = commands.validateCallbackData(`swap_amount_100_${shortTokenId}`, 'cancel_action');
                const watchData = commands.validateCallbackData(`watch_${shortTokenId}`, 'cancel_action');
                const refreshData = commands.validateCallbackData(`refresh_token_${shortTokenId}`, 'cancel_action');
                
                // Create enhanced inline keyboard with token actions including swap amounts
                const keyboard = {
                    inline_keyboard: [
                        [
                            { text: `💱 Swap ${symbol}`, callback_data: swapFromData },
                            { text: `📤 Send ${symbol}`, callback_data: sendData }
                        ],
                        [
                            { text: `Swap 25%`, callback_data: swap25Data },
                            { text: `Swap 50%`, callback_data: swap50Data },
                            { text: `Swap 100%`, callback_data: swap100Data }
                        ],
                        [
                            { text: `📈 Add to Watchlist`, callback_data: watchData },
                            { text: `🔄 Refresh`, callback_data: refreshData }
                        ],
                        [
                            { text: `🏠 Back to Menu`, callback_data: `main_menu` }
                        ]
                    ]
                };
                
                // Edit the loading message to show token details
                await ctx.telegram.editMessageText(
                    ctx.chat.id, 
                    loadingMsg.message_id, 
                    null, 
                    message, 
                    { 
                        parse_mode: 'MarkdownV2', 
                        disable_web_page_preview: true,
                        reply_markup: keyboard
                    }
                );
                
                return;
            } catch (error) {
                console.error('Error scanning token:', error);
                
                // Check if the error is related to the contract not being a valid token
                if (error.message.includes('call revert exception') || 
                    error.message.includes('invalid address') || 
                    error.message.includes('invalid bytecode')) {
                    await ctx.telegram.editMessageText(
                        ctx.chat.id, 
                        loadingMsg.message_id, 
                        null, 
                        `❌ This address does not appear to be a valid ERC20 token contract.`
                    );
                } else {
                    // Generic error message for other errors
                    await ctx.telegram.editMessageText(
                        ctx.chat.id, 
                        loadingMsg.message_id, 
                        null, 
                        `❌ Error scanning token contract: ${error.message}`
                    );
                }
                return;
            }
        } catch (error) {
            console.error('Error processing token address:', error);
            await ctx.reply(`❌ Error processing token: ${error.message}`);
            return;
        }
    } else if (session.state === STATES.AWAITING_PRIVATE_KEY) {
        // Check if this looks like a private key
        if (!text.startsWith('0x') || text.length !== 66) {
            return ctx.reply('Please enter a valid private key (66 characters, starts with 0x).');
        }
        
        try {
            // Import the wallet
            const walletDetails = walletManager.importWallet(ctx.from.id.toString(), text);
            
            // Respond with success
        await ctx.reply(
                `✅ Wallet imported successfully!\n\n` +
                `Address: \`${walletDetails.address}\`\n\n` +
                `What would you like to do next?`,
                commands.getMainMenu()
        );
            
            setState(ctx, STATES.IDLE);
    } catch (error) {
            console.error('Error importing wallet:', error);
            await ctx.reply(`❌ Error importing wallet: ${error.message}`);
        }
    } else if (session.state === STATES.AWAITING_AMOUNT) {
        console.log(`Amount input received: ${text}`);
        
        // Handle MAX input
        if (text.toUpperCase() === 'MAX') {
            // Would need to get user's balance here
            return ctx.reply('The MAX feature is not yet implemented. Please enter a specific amount.');
        }
        
        // Handle percentage-based inputs
        const percentageMatch = text.match(/(\d+)%\s*of\s*balance/i);
        if (percentageMatch) {
            const percentage = parseInt(percentageMatch[1]);
            if (isNaN(percentage) || percentage <= 0 || percentage > 100) {
                return ctx.reply('Please enter a valid percentage between 1 and 100.');
            }
            
            try {
                // Get token details from session
                if (!session.swapData || !session.swapData.fromToken || !session.swapData.fromTokenSymbol) {
                    return ctx.reply('Invalid swap data. Please start the swap process again.');
                }
                
                // Get user's integration
                const integration = getUserIntegration(ctx.from.id.toString());
                if (!integration) {
                    return ctx.reply('Please import or create a wallet first.');
                }
                
                // Create a contract to check balance
                const tokenContract = new ethers.Contract(
                    session.swapData.fromToken,
                    ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)"],
                    integration.provider
                );
                
                // Get token balance and decimals
                const [balance, decimals] = await Promise.all([
                    tokenContract.balanceOf(integration.wallet.address),
                    tokenContract.decimals().catch(() => 18)
                ]);
                
                // Calculate amount based on percentage
                const totalBalance = ethers.formatUnits(balance, decimals);
                const amount = (parseFloat(totalBalance) * percentage / 100).toFixed(6);
                
                if (parseFloat(amount) <= 0) {
                    return ctx.reply(`You don't have enough ${session.swapData.fromTokenSymbol} to swap.`);
                }
                
                // Store amount in session
                session.swapData.amount = amount;
                
                // Get network and slippage settings
                const networkName = getNetworkDisplayName(session.settings?.network || 'MONAD');
                const slippage = session.settings?.slippage || BOT_CONFIG.DEFAULT_SLIPPAGE;
                
                // Confirm the swap with the user
                await ctx.replyWithMarkdown(
                    `*Confirm Swap* 💱\n\n` +
                    `Network: *${networkName}*\n` +
                    `From: *${amount} ${session.swapData.fromTokenSymbol}*\n` +
                    `To: *${session.swapData.toTokenSymbol}*\n` +
                    `Slippage Tolerance: *${slippage}%*\n\n` +
                    `Do you want to proceed with this swap?`,
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [
                                    { text: '✅ Confirm', callback_data: 'confirm_swap' },
                                    { text: '❌ Cancel', callback_data: 'cancel_swap' }
                                ]
                            ]
                        }
                    }
                );
                
                setState(ctx, STATES.AWAITING_SWAP_CONFIRMATION);
                return;
            } catch (error) {
                console.error('Error processing percentage-based amount:', error);
                await ctx.reply(`❌ Error: ${error.message}`);
                return;
            }
        }
        
        // Check if number input
        const amount = parseFloat(text);
        if (isNaN(amount) || amount <= 0) {
            return ctx.reply('Please enter a valid positive number.');
        }
        
        try {
            // Validate swap data
            if (!session.swapData || !session.swapData.fromToken || !session.swapData.fromTokenSymbol) {
                return ctx.reply('Invalid swap data. Please start the swap process again.');
            }
            
            // Store swap amount in session
            session.swapData.amount = amount;
            
            // Get network display name
            const networkName = getNetworkDisplayName(session.settings?.network || 'MONAD');
            
            // Get slippage setting
            const slippage = session.settings?.slippage || BOT_CONFIG.DEFAULT_SLIPPAGE;
            
            // Confirm the swap with the user
            await ctx.replyWithMarkdown(
                `*Confirm Swap* 💱\n\n` +
                `Network: *${networkName}*\n` +
                `From: *${amount} ${session.swapData.fromTokenSymbol}*\n` +
                `To: *${session.swapData.toTokenSymbol}*\n` +
                `Slippage Tolerance: *${slippage}%*\n\n` +
                `Do you want to proceed with this swap?`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: '✅ Confirm', callback_data: 'confirm_swap' },
                                { text: '❌ Cancel', callback_data: 'cancel_swap' }
                            ]
                        ]
                    }
                }
            );
            
            setState(ctx, STATES.AWAITING_SWAP_CONFIRMATION);
            return;
        } catch (error) {
            console.error('Error processing amount input:', error);
            await ctx.reply(`❌ Error: ${error.message}`);
        }
    }
});

// Start the bot
bot.launch()
    .then(() => {
        console.log('Bot started successfully!');
        console.log(`Bot username: @${bot.botInfo.username}`);
        console.log('Waiting for messages... (If the bot doesn\'t respond, check the Telegram bot token)');
    })
    .catch(err => {
        console.error('❌ ERROR STARTING BOT:', err);
        console.error('Please check your Telegram bot token in the .env file');
    });

// Enhanced error handling
bot.catch((err, ctx) => {
    console.error(`❌ BOT ERROR for ${ctx.updateType}:`, err);
    
    // Send error message to user
    ctx.reply(
        `An error occurred: ${err.message}\n\nPlease try again or use /help`,
        commands.getMainMenu()
    ).catch(e => {
        console.error('Error sending error message:', e);
    });
});