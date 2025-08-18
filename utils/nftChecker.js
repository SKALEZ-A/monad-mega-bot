/**
 * Enhanced BikeBot NFT Checker - Uses BlockVision API for NFT scanning
 */
class BikeBotNFTChecker {
  constructor(bikeBotContractAddress = null) {
    // Replace with actual BikeBot contract address
    this.bikeBotContractAddress = bikeBotContractAddress || process.env.BIKEBOT_CONTRACT_ADDRESS || '0x3019bf1dfb84e5b46ca9d0eec37de08a59a41308';

    // Simple cache to avoid repeated API calls
    this.cache = new Map();
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes

    console.log(`BikeBot NFT Checker initialized with contract: ${this.bikeBotContractAddress}`);
  }

  /**
   * Check if an address owns BikeBot NFTs using BlockVision API
   * @param {string} address - Wallet address to check
   * @returns {object} - Verification result
   */
  async checkBikeBotNFTs(address) {
    try {
      if (!address || address.trim() === '') {
        console.warn('Empty address provided to NFT checker');
        return {
          hasNFT: false,
          count: 0,
          nfts: [],
          error: 'No address provided',
          checkedAt: new Date().toISOString()
        };
      }

      // Validate address format (basic check)
      const cleanAddress = address.trim();
      if (!cleanAddress.startsWith('0x') || cleanAddress.length !== 42) {
        console.warn(`Invalid address format: ${cleanAddress}`);
        return {
          hasNFT: false,
          count: 0,
          nfts: [],
          error: 'Invalid address format',
          checkedAt: new Date().toISOString()
        };
      }

      console.log(`Checking BikeBot NFTs for address: ${cleanAddress}`);

      // Check cache first
      const cacheKey = cleanAddress.toLowerCase();
      const cached = this.cache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < this.cacheTimeout) {
        console.log(`Using cached NFT result for ${cleanAddress}: ${cached.result.hasNFT ? 'HAS NFT' : 'NO NFT'}`);
        return cached.result;
      }

      // Try to use BlockVision API if available
      let nftData = [];
      try {
        const BlockVisionAPI = require('./blockVisionAPI');
        const apiKey = process.env.BLOCKVISION_API_KEY;

        if (!apiKey || apiKey === '') {
          console.warn('BlockVision API key not found - NFT checking disabled');
          return {
            hasNFT: false,
            count: 0,
            nfts: [],
            error: 'BlockVision API key not configured',
            checkedAt: new Date().toISOString()
          };
        }

        console.log('Using BlockVision API for NFT scanning');
        const api = new BlockVisionAPI(apiKey);
        nftData = await api.getAccountNFTs(cleanAddress);
        console.log(`BlockVision API returned ${nftData.length} NFTs for ${cleanAddress}`);

        // Debug: Log first few NFTs to see structure
        if (nftData.length > 0) {
          console.log('Sample NFT data structure:', JSON.stringify(nftData.slice(0, 2), null, 2));
        }

      } catch (apiError) {
        console.error('Error calling BlockVision API for NFTs:', apiError);
        return {
          hasNFT: false,
          count: 0,
          nfts: [],
          error: `API Error: ${apiError.message}`,
          checkedAt: new Date().toISOString()
        };
      }

      // Filter for BikeBot NFTs
      const bikeBotNFTs = this.filterBikeBotNFTs(nftData);

      const result = {
        hasNFT: bikeBotNFTs.length > 0,
        count: bikeBotNFTs.length,
        nfts: bikeBotNFTs.map(nft => this.formatNFTData(nft)),
        totalNFTsChecked: nftData.length,
        checkedAt: new Date().toISOString()
      };

      // Cache the result
      this.cache.set(cacheKey, {
        result,
        timestamp: Date.now()
      });

      if (result.hasNFT) {
        console.log(`✅ Found ${result.count} BikeBot NFT(s) for address ${cleanAddress}`);
        console.log('BikeBot NFTs found:', result.nfts.map(nft => `${nft.name} (${nft.tokenId})`));
      } else {
        console.log(`❌ No BikeBot NFTs found for address ${cleanAddress} (checked ${result.totalNFTsChecked} total NFTs)`);

        // Debug: Show what collections we did find
        if (nftData.length > 0) {
          const collections = [...new Set(nftData.map(nft => nft.collectionName || nft.name || 'Unknown').filter(Boolean))];
          console.log('Collections found:', collections.slice(0, 5));
        }
      }

      return result;

    } catch (error) {
      console.error(`Error checking BikeBot NFTs for ${address}:`, error);
      return {
        hasNFT: false,
        count: 0,
        nfts: [],
        error: error.message,
        checkedAt: new Date().toISOString()
      };
    }
  }

  /**
   * Filter NFTs to find BikeBot NFTs
   * @param {Array} nfts - Array of NFT data from BlockVision API
   * @returns {Array} - Array of BikeBot NFTs
   */
  filterBikeBotNFTs(nfts) {
    if (!Array.isArray(nfts)) {
      console.warn('NFT data is not an array:', typeof nfts);
      return [];
    }

    console.log(`Filtering ${nfts.length} NFTs for BikeBot matches...`);
    console.log(`Looking for contract address: ${this.bikeBotContractAddress}`);

    const matches = nfts.filter(nft => {
      // Debug log for each NFT
      const nftInfo = {
        contractAddress: nft.contractAddress,
        collectionName: nft.collectionName,
        name: nft.name,
        symbol: nft.symbol
      };

      // Method 1: Check by contract address (most reliable)
      if (this.bikeBotContractAddress &&
        this.bikeBotContractAddress !== '0x1234567890123456789012345678901234567890' &&
        nft.contractAddress) {
        if (nft.contractAddress.toLowerCase() === this.bikeBotContractAddress.toLowerCase()) {
          console.log(`✅ Found BikeBot NFT by contract address:`, nftInfo);
          return true;
        }
      }

      // Method 2: Check by collection name (fallback)
      if (nft.collectionName) {
        const collectionName = nft.collectionName.toLowerCase();
        const bikeBotPatterns = ['bikebot', 'bike bot', 'bike-bot', 'bikebot nft'];

        for (const pattern of bikeBotPatterns) {
          if (collectionName.includes(pattern)) {
            console.log(`✅ Found BikeBot NFT by collection name (${pattern}):`, nftInfo);
            return true;
          }
        }
      }

      // Method 3: Check by token name (additional fallback)
      if (nft.name) {
        const tokenName = nft.name.toLowerCase();
        const bikeBotPatterns = ['bikebot', 'bike bot', 'bike-bot'];

        for (const pattern of bikeBotPatterns) {
          if (tokenName.includes(pattern)) {
            console.log(`✅ Found BikeBot NFT by token name (${pattern}):`, nftInfo);
            return true;
          }
        }
      }

      // Method 4: Check by token symbol (if available)
      if (nft.symbol) {
        const symbol = nft.symbol.toLowerCase();
        if (symbol.includes('bikebot') || symbol === 'bike' || symbol === 'bot') {
          console.log(`✅ Found BikeBot NFT by symbol:`, nftInfo);
          return true;
        }
      }

      return false;
    });

    console.log(`Found ${matches.length} BikeBot NFT matches out of ${nfts.length} total NFTs`);
    return matches;
  }

  /**
   * Format NFT data for consistent output
   * @param {object} nft - Raw NFT data from BlockVision API
   * @returns {object} - Formatted NFT data
   */
  formatNFTData(nft) {
    return {
      contractAddress: nft.contractAddress || 'Unknown',
      tokenId: nft.tokenId || nft.id || 'Unknown',
      name: nft.name || 'Unnamed BikeBot NFT',
      collectionName: nft.collectionName || 'BikeBot Collection',
      symbol: nft.symbol || 'BIKEBOT',
      imageUrl: nft.imageURL || nft.image || null,
      description: nft.description || null,
      attributes: nft.attributes || [],
      rarity: nft.rarity || null,
      standard: nft.standard || 'ERC-721'
    };
  }

  /**
   * Test the NFT checker with a known address (for debugging)
   * @param {string} testAddress - Address to test with
   */
  async testNFTChecker(testAddress) {
    console.log(`\n=== Testing NFT Checker ===`);
    console.log(`Test Address: ${testAddress}`);
    console.log(`BikeBot Contract: ${this.bikeBotContractAddress}`);
    console.log(`API Key Present: ${!!process.env.BLOCKVISION_API_KEY}`);

    const result = await this.checkBikeBotNFTs(testAddress);

    console.log(`\n=== Test Results ===`);
    console.log(`Has NFT: ${result.hasNFT}`);
    console.log(`Count: ${result.count}`);
    console.log(`Total NFTs Checked: ${result.totalNFTsChecked}`);
    console.log(`Error: ${result.error || 'None'}`);

    if (result.nfts.length > 0) {
      console.log(`NFTs Found:`, result.nfts);
    }

    console.log(`=== End Test ===\n`);

    return result;
  }

  /**
   * Clear cache for specific address
   * @param {string} address - Address to clear from cache
   */
  clearCache(address) {
    if (address) {
      this.cache.delete(address.toLowerCase());
      console.log(`Cleared NFT cache for address: ${address}`);
    } else {
      this.cache.clear();
      console.log('Cleared all NFT cache');
    }
  }

  /**
   * Get checker statistics
   * @returns {object} - Statistics
   */
  getStats() {
    return {
      cacheSize: this.cache.size,
      bikeBotContract: this.bikeBotContractAddress,
      cacheTimeout: this.cacheTimeout,
      apiKeyConfigured: !!process.env.BLOCKVISION_API_KEY
    };
  }

  /**
   * Set BikeBot contract address
   * @param {string} contractAddress - New contract address
   */
  setBikeBotContract(contractAddress) {
    this.bikeBotContractAddress = contractAddress;
    this.clearCache(); // Clear cache when contract changes
    console.log(`BikeBot contract address updated to: ${contractAddress}`);
  }
}

module.exports = BikeBotNFTChecker;