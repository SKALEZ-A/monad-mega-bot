# Project Brief: Monad Telegram Trading Bot

## Purpose
A Telegram bot that enables users to trade tokens on the Monad Testnet blockchain. The bot provides wallet management, token swaps, transfers, and real-time blockchain data, with a focus on security, usability, and extensibility.

## Core Requirements
- **Wallet Management**: Users can create/import multiple wallets, with private keys encrypted using AES-256-CBC.
- **Token Swaps**: Swap tokens using Monad's Uniswap contracts, with real-time progress, slippage, and price impact info.
- **Token Discovery**: Scan and display all tokens in a user's wallet, not just predefined ones, using both BlockVision API and direct blockchain scanning.
- **Transfers**: Send native and ERC-20 tokens to any address, with explorer links and transaction receipts.
- **User Preferences**: Slippage, watchlists, and other settings are customizable and persist across sessions.
- **Multi-Chain Support**: Modular architecture supports Monad and MegaETH testnets, with easy extensibility for more chains.
- **Security**: Private keys are never stored in plain text. All sensitive operations require explicit user confirmation.
- **Professional UX**: Consistent UI, command buttons, network indicators, and clear error handling.

## Scope
- Monad Testnet as primary blockchain, with MegaETH as a secondary example.
- Support for all major tokens and any ERC-20 token on Monad.
- Integration with UniswapV2Router02 and related contracts.
- Persistent user preferences and wallet data (encrypted).
- Roadmap for future enhancements: multi-chain bridging, analytics, LP management, and more DEX integrations.

## Out of Scope
- Mainnet trading (testnet only for now)
- Non-ERC-20 tokens
- Advanced trading strategies (limit orders, etc.)

## Key Technologies
- Node.js, Telegraf, ethers.js, dotenv, crypto, BlockVision API
- Modular, layered architecture for easy maintenance and extension

## Security & Compliance
- Follows best practices for key management and transaction safety
- MIT License 