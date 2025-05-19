const fs = require('fs');
const path = require('path');

/**
 * UserPreferences class for managing user settings and preferences
 */
class UserPreferences {
    constructor() {
        this.dataDir = path.join(__dirname, '../data');
        this.preferencesFile = path.join(this.dataDir, 'preferences.json');
        this.preferences = this.loadPreferences();
        
        // Ensure data directory exists
        if (!fs.existsSync(this.dataDir)) {
            fs.mkdirSync(this.dataDir, { recursive: true });
        }
    }

    /**
     * Load user preferences from file
     */
    loadPreferences() {
        try {
            if (fs.existsSync(this.preferencesFile)) {
                const data = fs.readFileSync(this.preferencesFile, 'utf8');
                return JSON.parse(data);
            }
            return {};
        } catch (error) {
            console.error('Error loading user preferences:', error);
            return {};
        }
    }

    /**
     * Save user preferences to file
     */
    savePreferences() {
        try {
            fs.writeFileSync(this.preferencesFile, JSON.stringify(this.preferences, null, 2), 'utf8');
        } catch (error) {
            console.error('Error saving user preferences:', error);
        }
    }

    /**
     * Add a token to user's watchlist
     * @param {string} userId - Telegram user ID 
     * @param {object} token - Token information { address, symbol, decimals }
     */
    addWatchlistToken(userId, token) {
        if (!this.preferences[userId]) {
            this.preferences[userId] = {
                watchlist: [],
                slippage: 0.5
            };
        }

        // Check if token is already in watchlist
        const existingToken = this.preferences[userId].watchlist.find(t => 
            t.address.toLowerCase() === token.address.toLowerCase()
        );

        if (!existingToken) {
            this.preferences[userId].watchlist.push(token);
            this.savePreferences();
            return true;
        }
        
        return false;
    }

    /**
     * Remove a token from user's watchlist
     * @param {string} userId - Telegram user ID
     * @param {string} tokenAddress - Token address to remove
     */
    removeWatchlistToken(userId, tokenAddress) {
        if (!this.preferences[userId] || !this.preferences[userId].watchlist) {
            return false;
        }

        const initialLength = this.preferences[userId].watchlist.length;
        this.preferences[userId].watchlist = this.preferences[userId].watchlist.filter(
            token => token.address.toLowerCase() !== tokenAddress.toLowerCase()
        );

        if (initialLength !== this.preferences[userId].watchlist.length) {
            this.savePreferences();
            return true;
        }
        
        return false;
    }

    /**
     * Get user's watchlist
     * @param {string} userId - Telegram user ID
     */
    getWatchlist(userId) {
        if (!this.preferences[userId] || !this.preferences[userId].watchlist) {
            return [];
        }
        
        return this.preferences[userId].watchlist;
    }

    /**
     * Set user's slippage preference
     * @param {string} userId - Telegram user ID
     * @param {number} slippage - Slippage percentage (0.1 to 5.0)
     */
    setSlippage(userId, slippage) {
        if (!this.preferences[userId]) {
            this.preferences[userId] = {
                watchlist: [],
                slippage: 0.5
            };
        }
        
        // Validate slippage value
        const slippageValue = parseFloat(slippage);
        if (isNaN(slippageValue) || slippageValue < 0.1 || slippageValue > 5.0) {
            return false;
        }
        
        this.preferences[userId].slippage = slippageValue;
        this.savePreferences();
        return true;
    }

    /**
     * Get user's slippage preference
     * @param {string} userId - Telegram user ID
     */
    getSlippage(userId) {
        if (!this.preferences[userId] || this.preferences[userId].slippage === undefined) {
            return 0.5; // Default slippage
        }
        
        return this.preferences[userId].slippage;
    }
}

module.exports = new UserPreferences(); 