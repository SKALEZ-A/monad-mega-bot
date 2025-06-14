# Tech Context: Monad Telegram Trading Bot

## Technologies Used
- **Node.js**: Main runtime environment
- **Telegraf**: Telegram bot framework
- **ethers.js**: Blockchain interaction (wallets, contracts, transactions)
- **dotenv**: Environment variable management
- **crypto**: Encryption for private key storage
- **axios**: HTTP requests (BlockVision API, etc.)

## Development Setup
- **Environment Variables**: Required in `.env` file:
  - `TELEGRAM_BOT_TOKEN`: Telegram bot token
  - `MONAD_RPC_URL`: Monad testnet RPC URL
  - `WALLET_PRIVATE_KEY`: System wallet private key
  - `ENCRYPTION_KEY`: Key for encrypting user wallet private keys
  - (Optional) `ALCHEMY_API_KEY`, `BLOCKVISION_API_KEY`: For enhanced RPC and token discovery
- **Install**: `npm install`
- **Run**: `npm start` (production) or `npm run dev` (with nodemon)

## Technical Constraints
- **Testnet Only**: Currently supports Monad and MegaETH testnets (not mainnet)
- **ERC-20 Tokens**: Only standard ERC-20 tokens are supported for swaps and transfers
- **Key Security**: Private keys must never be stored or transmitted in plain text
- **Persistent Storage**: User preferences and wallet data are stored in local JSON files (not a database)
- **API Rate Limits**: BlockVision and Alchemy APIs may have rate limits; fallback to direct chain scanning is implemented

## Dependencies
- `telegraf`, `ethers`, `dotenv`, `crypto`, `axios`, `nodemon`
- See `package.json` for full list and versions

## Additional Notes
- **Configurable Networks**: All network and contract details are managed in `config/index.js` for easy updates
- **Extensible**: New chains, tokens, or features can be added with minimal changes to the core architecture 