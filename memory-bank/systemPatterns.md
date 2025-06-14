# System Patterns: Monad Telegram Trading Bot

## Architecture Overview
- **Layered Architecture**:
  - **Bot Interface Layer**: Handles Telegram interactions (commands, buttons, messages).
  - **Business Logic Layer**: Processes user requests, manages state, and coordinates actions.
  - **Integration Layer**: Manages blockchain interactions (Monad, MegaETH) via modular integration classes.
  - **Data Layer**: Handles encrypted wallet storage, user preferences, and persistent settings.

## Key Technical Decisions
- **Modular Blockchain Integration**: Each supported chain (Monad, MegaETH) has its own integration class implementing a common interface (getBalance, swap, send, scanAllTokens, etc.).
- **Centralized Config**: All network, contract, and token details are managed in a single config file for easy updates and expansion.
- **Encrypted Key Storage**: Private keys are encrypted using AES-256-CBC and never stored in plain text.
- **Token Discovery**: Uses both BlockVision API and direct blockchain scanning for comprehensive token detection.
- **Persistent User Preferences**: User settings (slippage, watchlist) are stored in a JSON file for persistence across sessions.
- **Command-Driven UI**: All bot actions are accessible via Telegram commands and menu buttons, ensuring a consistent UX.

## Component Relationships
- **index.js**: Main entry point, initializes bot, managers, and integrations.
- **utils/monadIntegration.js & megaethIntegration.js**: Blockchain-specific logic for wallet, swap, and token operations.
- **utils/walletManager.js**: Handles wallet creation/import, encryption, and multi-wallet support.
- **utils/telegramCommands.js**: Encapsulates all Telegram command logic and menu generation.
- **utils/tokenPrices.js**: Fetches token prices from Uniswap pairs.
- **utils/userPreferences.js**: Manages user watchlists and slippage settings.
- **utils/blockVisionAPI.js & directTokenScanner.js**: Token discovery via API and direct chain scanning.
- **config/index.js**: Centralized network and contract configuration.

## Design Patterns Used
- **Factory Pattern**: For instantiating the correct blockchain integration based on user/network.
- **Service Provider Pattern**: Each blockchain integration acts as a service provider with a common interface.
- **Registry Pattern**: Supported chains and tokens are registered in config for dynamic access.
- **Command Pattern**: Telegram commands and menu actions are mapped to handler functions.

## Extensibility
- New chains, tokens, or features can be added by extending the config and integration classes without major refactoring. 