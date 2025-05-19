# Monad Trading Bot

A Telegram bot for trading tokens on the Monad Testnet blockchain. This bot allows users to:

- Create or import wallets with enhanced security
- Manage multiple wallets per user
- Swap tokens on Monad blockchain with detailed transaction progress
- Send tokens to other addresses
- View ALL tokens in your wallet, not just predefined ones
- Customize settings like slippage
- Get detailed price impact information before swapping

## Setup Instructions

1. Clone this repository
2. Configure your environment variables in `.env` file:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token
   MONAD_RPC_URL=https://testnet-rpc.monad.xyz
   WALLET_PRIVATE_KEY=your_system_wallet_private_key
   ENCRYPTION_KEY=your_secure_encryption_key
   ```
3. Install dependencies:
   ```
   npm install
   ```
4. Start the bot:
   ```
   npm start
   ```

## Enhanced Security Features

The bot now includes several security enhancements:

- **Encrypted Private Key Storage**: User private keys are never stored in plain text
- **Encryption Key Protection**: Uses AES-256-CBC encryption with a secure key
- **Multiple Wallet Support**: Users can manage multiple wallets with different names
- **Secure Transaction Handling**: Better error handling and validation before transactions

## Using the Bot

Once the bot is running, you can interact with it using the following commands:

- `/start` - Initialize the bot and see welcome message
- `/wallet` - Manage your wallets (create, import, or manage multiple wallets)
- `/swap` - Swap tokens on Monad with real-time progress updates
- `/send` - Send tokens to another address
- `/balances` - View ALL tokens in your wallet, not just predefined ones
- `/price` - Check token prices
- `/token` - View detailed information about any token by address
- `/help` - Get help with using the bot
- `/settings` - Configure bot settings like slippage

## Router Addresses

The bot uses the following contract addresses for trading on Monad:

```
UniswapV2Router02: 0xfb8e1c3b833f9e67a71c859a132cf783b645e436
Uniswap UniversalRouter: 0x3ae6d8a282d67893e17aa70ebffb33ee5aa65893
UniswapV2Factory: 0x733e88f248b742db6c14c0b1713af5ad7fdd59d0
UniswapV3Factory: 0x961235a9020b05c44df1026d956d1f4d78014276
WrappedMonad (WMON): 0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701
```

## Token Scanning

The bot now scans for ALL tokens owned by the user on the blockchain:

- Shows complete list of tokens with balances
- Not limited to just predefined tokens
- Displays token prices and value when available
- Auto-detects token balances when addresses are pasted

## Detailed Transaction Progress

When performing swaps, the bot now provides:

- Step-by-step transaction progress updates
- Detailed price impact warnings
- Clear success/failure messages with explorer links
- Comprehensive transaction receipt information

## Environment Variables

The bot requires the following environment variables:

- `TELEGRAM_BOT_TOKEN`: Your Telegram bot token from BotFather
- `MONAD_RPC_URL`: Monad testnet RPC URL
- `WALLET_PRIVATE_KEY`: Private key for the system wallet (used for operations)
- `ENCRYPTION_KEY`: Secure key used to encrypt user wallet private keys

## Troubleshooting

If you experience any issues with the bot, try these steps:

1. Make sure your `.env` file has all required environment variables
2. Check that you have enough MON tokens in your wallet for gas fees
3. Use the `/help` command to get assistance
4. Try restarting the bot if commands are unresponsive
5. Ensure you're connected to the Monad testnet

## Monad Network Information

The bot uses the following Monad testnet details:

- **Network Name**: Monad Testnet
- **Chain ID**: 10143
- **RPC URL**: https://testnet-rpc.monad.xyz
- **Block Explorer**: https://testnet.monadexplorer.com
- **Faucet**: https://faucet.monad.xyz

## Supported Tokens

The bot supports trading the following tokens on Monad testnet:

- **MON**: Native currency
- **WETH**: 0xB5a30b0FDc5EA94A52fDc42e3E9760Cb8449Fb37
- **USDC**: 0xf817257fed379853cDe0fa4F97AB987181B1E5Ea
- **USDT**: 0x88b8E2161DEDC77EF4ab7585569D2415a1C1055D
- **WBTC**: 0xcf5a6076cfa32686c0Df13aBaDa2b40dec133F1d
- **WSOL**: 0x5387C85A4965769f6B0Df430638a1388493486F1

Additionally, the bot will discover and show ANY other ERC-20 tokens in your wallet.

## Security Notes

- The bot encrypts private keys using AES-256-CBC encryption
- Set a strong, unique ENCRYPTION_KEY in the .env file for production
- Never share your private key with anyone
- Use dedicated wallets with limited funds for testing
- Run in a secure environment

## Future Enhancements

- Persistent encrypted storage for wallet data
- Support for multichain bridging
- Trading history and analytics
- LP token management
- Integration with additional DEXes
- Gas price customization

## License

MIT 