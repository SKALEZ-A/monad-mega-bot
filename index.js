require('dotenv').config();
const { Telegraf, Context, Scenes, session, Markup } = require('telegraf');
const MonadIntegration = require('./utils/monadIntegration');
const MegaethIntegration = require('./utils/megaethIntegration');
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

// After initializing the bot and session middleware:
bot.telegram.setMyCommands([
  { command: 'wallet', description: 'Manage your wallet' },
  { command: 'swap', description: 'Swap tokens' },
  { command: 'send', description: 'Send tokens' },
  { command: 'balances', description: 'View balances' },
  { command: 'chains', description: 'Switch blockchain' },
  { command: 'currentchain', description: 'Show your current chain' },
  { command: 'help', description: 'Get help' },
  { command: 'settings', description: 'Preferences' }
]);

// Initialize default wallets (for system operations)
let defaultMonadIntegration;
let defaultMegaethIntegration;
try {
    defaultMonadIntegration = new MonadIntegration(process.env.WALLET_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001');
    console.log('Default Monad integration initialized successfully');
    defaultMegaethIntegration = new MegaethIntegration(process.env.WALLET_PRIVATE_KEY || '0x0000000000000000000000000000000000000000000000000000000000000001');
    console.log('Default MegaETH integration initialized successfully');
} catch (error) {
    console.error('Error initializing default wallet:', error);
}

// Initialize managers
const walletManager = new WalletManager();
const commands = new TelegramCommands(walletManager, defaultMonadIntegration, defaultMegaethIntegration);

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
function getUserIntegration(userId, network = 'MONAD') {
    console.log(`Attempting to get blockchain integration for user ${userId} on network ${network}`);
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

// Add this utility function after NETWORKS import
function getNetworkDisplayName(network) {
  return NETWORKS[network]?.name || network;
}

// Start command
bot.start(async (ctx) => {
    const session = getSession(ctx);
    setState(ctx, STATES.IDLE);
    const network = session.settings?.network || 'MONAD';
    const networkText = `Network: ${getNetworkDisplayName(network)}\n\n`;
    await ctx.replyWithMarkdown(
        networkText +
        `*Welcome to Monad Trading Bot* 🚀\n\n` +
        `Easily trade tokens, manage wallets, and explore DeFi on the Monad blockchain — all from Telegram.\n\n` +
        `Main Features:\n` +
        `• Secure wallet creation/import (AES-256 encrypted)\n` +
        `• Swap tokens using Uniswap contracts\n` +
        `• Discover and manage all your tokens\n` +
        `• Send tokens with transaction receipts\n` +
        `• Persistent preferences & multi-wallet support\n\n` +
        `Quick Commands:\n` +
        `/wallet — Manage your wallet\n` +
        `/swap — Swap tokens\n` +
        `/send — Send tokens\n` +
        `/balances — View balances\n` +
        `/chains — Switch blockchain\n` +
        `/currentchain — Show your current chain\n` +
        `/help — Get help\n` +
        `/settings — Preferences`,
        commands.getMainMenu()
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
    
    if (walletManager.hasWallet(ctx.from.id.toString())) {
        const wallet = walletManager.getWalletDetails(ctx.from.id.toString());
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

// Balances command
bot.command('balances', async (ctx) => {
    console.log(`Balances command received from user ${ctx.from.id}`);
    setState(ctx, STATES.IDLE);
    
    const session = getSession(ctx);
    const network = session.settings?.network || 'MONAD';
    const networkText = `Network: ${getNetworkDisplayName(network)}\n\n`;
    await ctx.replyWithMarkdown(networkText + 'Fetching your balances... Please wait.');
    
    try {
        if (!walletManager.hasWallet(ctx.from.id.toString())) {
            console.log(`User ${ctx.from.id} has no wallet, showing wallet menu`);
            return ctx.reply(
                'You need to create or import a wallet first:',
                commands.getWalletMenu()
            );
        }
        
        const integration = getUserIntegration(ctx.from.id.toString(), network);
        if (!integration) {
            return ctx.reply(`Failed to load your wallet. Please try again later.`);
        }

        const currentNetworkBalances = await commands.formatBalances(ctx.from.id.toString(), network);

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

// 1. Move the /currentchain command handler above the text handler
bot.command('currentchain', async (ctx) => {
    const session = getSession(ctx);
    const network = session.settings?.network || 'MONAD';
    await ctx.reply(`You are currently on: ${getNetworkDisplayName(network)}`);
});

// Update mainMenuButtons to use plain text labels
const mainMenuButtons = [
    'Swap Tokens',
    'My Balances',
    'Send',
    'My Wallet',
    '🏠 Main Menu'
];

// Main menu button handlers (make buttons work like commands)
bot.hears('My Balances', async (ctx) => {
    // Call the same logic as /balances
    setState(ctx, STATES.IDLE);
    const session = getSession(ctx);
    const network = session.settings?.network || 'MONAD';
    const networkText = `Network: ${getNetworkDisplayName(network)}\n\n`;
    await ctx.replyWithMarkdown(networkText + 'Fetching your balances... Please wait.');
    try {
        if (!walletManager.hasWallet(ctx.from.id.toString())) {
            return ctx.reply(
                'You need to create or import a wallet first:',
                commands.getWalletMenu()
            );
        }
        const integration = getUserIntegration(ctx.from.id.toString(), network);
        if (!integration) {
            return ctx.reply(`Failed to load your wallet. Please try again later.`);
        }
        const currentNetworkBalances = await commands.formatBalances(ctx.from.id.toString(), network);
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
    // Call the same logic as /wallet
    setState(ctx, STATES.IDLE);
    if (walletManager.hasWallet(ctx.from.id.toString())) {
        const wallet = walletManager.getWalletDetails(ctx.from.id.toString());
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
});

bot.hears('Swap Tokens', async (ctx) => {
    // Call the same logic as /swap
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
    // Call the same logic as /send
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

// Import Wallet button handler
bot.hears('📥 Import Wallet', async (ctx) => {
    setState(ctx, STATES.AWAITING_PRIVATE_KEY);
    await ctx.reply('Please enter your wallet private key to import your wallet.\n\n⚠️ *Never share your private key with anyone else!*', { parse_mode: 'Markdown' });
});

// Generate Wallet button handler
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

// Main Menu button handler
bot.hears('🏠 Main Menu', async (ctx) => {
    setState(ctx, STATES.IDLE);
    await ctx.reply('Main menu:', commands.getMainMenu());
});

// Update Import Wallet handler to ignore button presses as private keys
bot.on('text', async (ctx, next) => {
    const session = getSession(ctx);
    if (session.state === STATES.AWAITING_PRIVATE_KEY) {
        const privateKey = ctx.message.text.trim();
        // Ignore if the user sends a known button label instead of a private key
        const knownButtons = [
            '🏠 Main Menu', '🔑 Generate Wallet', '📥 Import Wallet',
            'Swap Tokens', 'My Balances', 'Send', 'My Wallet',
            'Monad', 'MegaETH'
        ];
        if (knownButtons.includes(privateKey)) {
            await ctx.reply('Please enter your wallet private key, or tap Main Menu to cancel.');
            return;
        }
        try {
            const wallet = walletManager.importWallet(ctx.from.id.toString(), privateKey);
            setState(ctx, STATES.IDLE);
            await ctx.replyWithMarkdown(
                `✅ *Wallet Imported Successfully!*\n\n` +
                `Address: \`${wallet.address}\`\n\n` +
                `[View on Explorer](${NETWORKS['MONAD'].blockExplorerUrl}/address/${wallet.address})`,
                commands.getMainMenu()
            );
        } catch (error) {
            await ctx.reply(`❌ Error importing wallet: ${error.message}`);
        }
        return;
    }
    // Do not reply with debug message; just ignore or call next if provided
    if (typeof next === 'function') await next();
});

// Start the bot (must be at the end of the file)
bot.launch();
console.log('🤖 Monad Telegram Trading Bot is running and listening for updates...');