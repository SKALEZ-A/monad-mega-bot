require('dotenv').config();

// ABIs
const ROUTER_V2_ABI = [
    "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
    "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
    "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
    "function WETH() external pure returns (address)"
];

const ERC20_ABI = [
    "function approve(address spender, uint256 amount) external returns (bool)",
    "function allowance(address owner, address spender) external view returns (uint256)",
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)",
    "function symbol() external view returns (string)",
    "function name() external view returns (string)",
    "function transfer(address recipient, uint256 amount) external returns (bool)"
];

// Network Configuration
const NETWORKS = {
    MONAD: {
        name: 'Monad Testnet',
        chainId: 10143,
        rpc: `https://testnet-rpc.monad.xyz`,
        nativeCurrency: 'MON',
        blockExplorerUrl: 'https://testnet.monadexplorer.com',
        addresses: {
            ROUTER: '0xfb8e1c3b833f9e67a71c859a132cf783b645e436',
            FACTORY: '0x733e88f248b742db6c14c0b1713af5ad7fdd59d0',
            WETH: '0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701'
        },
        tokens: {
            'WETH': {
                address: '0xB5a30b0FDc5EA94A52fDc42e3E9760Cb8449Fb37',
                symbol: 'WETH',
                name: 'Wrapped Ethereum',
                decimals: 18,
                logoURI: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png'
            },
            'WBTC': {
                address: '0xcf5a6076cfa32686c0Df13aBaDa2b40dec133F1d',
                symbol: 'WBTC',
                name: 'Wrapped Bitcoin',
                decimals: 18,
                logoURI: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png'
            },
            'USDC': {
                address: '0xf817257fed379853cDe0fa4F97AB987181B1E5Ea',
                symbol: 'USDC',
                name: 'USD Coin',
                decimals: 6,
                logoURI: 'https://assets.coingecko.com/coins/images/6319/small/USD_Coin_icon.png'
            },
            'USDT': {
                address: '0x88b8E2161DEDC77EF4ab7585569D2415a1C1055D',
                symbol: 'USDT',
                name: 'Tether USD',
                decimals: 6,
                logoURI: 'https://assets.coingecko.com/coins/images/325/small/Tether.png'
            },
            'WSOL': {
                address: '0x5387C85A4965769f6B0Df430638a1388493486F1',
                symbol: 'WSOL',
                name: 'Wrapped Solana',
                decimals: 18,
                logoURI: 'https://assets.coingecko.com/coins/images/4128/small/solana.png'
            }
        }
    }
};

// Bot configuration
const BOT_CONFIG = {
    // Default slippage tolerance for swaps
    DEFAULT_SLIPPAGE: 1.0, // 1%
    
    // Default deadline for transactions (in minutes)
    DEFAULT_DEADLINE: 20,
    
    // Default gas limit for transactions
    DEFAULT_GAS_LIMIT: 300000,
    
    // Alchemy API key for RPC access
    ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY || 'JR7qnZW40eavpINEfVB4AHZIKvcnP1NS',
    
    // BlockVision API key for token discovery
    BLOCKVISION_API_KEY: process.env.BLOCKVISION_API_KEY || '2xEdzNNWrkHVW3y0BOPMXASu0Na',
    
    // Telegram Bot Token
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN
};

module.exports = {
    NETWORKS,
    BOT_CONFIG,
    ROUTER_V2_ABI,
    ERC20_ABI
}; 