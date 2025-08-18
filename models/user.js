const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSchema = new Schema({
  telegram_id: {
    type: Number,
    required: true,
    unique: true,
    index: true
  },
  wallet_address: {
    type: String,
    sparse: true, // This allows multiple null values but enforces uniqueness on non-null values
    index: true
  },
  wallet_data: {
    type: String
  }, // Complete wallet data as JSON (includes encrypted private key)
  encrypted_private_key: {
    type: String
  }, // Also store separately for easy access/migration

  // Add NFT verification fields that were missing
  nft_verified: {
    type: Boolean,
    default: false
  },
  nft_verification_address: {
    type: String,
    sparse: true
  },
  nft_count: {
    type: Number,
    default: 0
  },
  nft_verification_date: {
    type: Date
  },

  // User state management
  user_state: {
    type: String,
    enum: ['awaiting_nft_address', 'wallet_setup', 'active', 'inactive'],
    default: 'inactive'
  }
}, {
  timestamps: true
});

// Create a sparse unique index on wallet_address
// This allows multiple documents with null wallet_address but enforces uniqueness on actual addresses
UserSchema.index(
  { wallet_address: 1 },
  {
    unique: true,
    sparse: true,
    name: 'wallet_address_sparse_unique'
  }
);

// Add a compound index for NFT verification lookups
UserSchema.index(
  { nft_verified: 1, nft_verification_address: 1 },
  {
    sparse: true,
    name: 'nft_verification_lookup'
  }
);

// Pre-save middleware to handle wallet_address normalization
UserSchema.pre('save', function (next) {
  // Normalize wallet address to lowercase if it exists
  if (this.wallet_address) {
    this.wallet_address = this.wallet_address.toLowerCase().trim();
  }

  // If wallet_address is empty string, set to null for sparse index
  if (this.wallet_address === '') {
    this.wallet_address = null;
  }

  next();
});

// Instance method to check if user has wallet
UserSchema.methods.hasWallet = function () {
  return !!(this.wallet_address && this.encrypted_private_key);
};

// Instance method to check if user has NFT verification
UserSchema.methods.hasNFTVerification = function () {
  return !!(this.nft_verified && this.nft_verification_address);
};

// Static method to find user by wallet address
UserSchema.statics.findByWalletAddress = function (address) {
  if (!address) return null;
  return this.findOne({ wallet_address: address.toLowerCase().trim() });
};

// Static method to safely create or find user
UserSchema.statics.findOrCreate = async function (telegram_id) {
  try {
    let user = await this.findOne({ telegram_id });
    if (!user) {
      user = new this({ telegram_id });
      await user.save();
    }
    return user;
  } catch (error) {
    // Handle duplicate key error
    if (error.code === 11000) {
      // Try to find the user again (might have been created by another process)
      const existingUser = await this.findOne({ telegram_id });
      if (existingUser) {
        return existingUser;
      }
    }
    throw error;
  }
};

module.exports = mongoose.model("User", UserSchema);