const User = require('../models/user');

const getUser = async (telegram_id) => {
  try {
    // Use the static method we defined in the schema
    const user = await User.findOrCreate(telegram_id);
    return user;
  } catch (error) {
    console.error("Error fetching user:", error);

    // Provide more specific error messages
    if (error.code === 11000) {
      console.error(`Duplicate key error for telegram_id ${telegram_id}`);
      // Try one more time to find the user
      try {
        const existingUser = await User.findOne({ telegram_id });
        if (existingUser) {
          return existingUser;
        }
      } catch (retryError) {
        console.error("Retry failed:", retryError);
      }
      throw new Error("User creation conflict - please try again");
    }

    throw new Error(`Failed to fetch user: ${error.message}`);
  }
}

const updateUser = async (telegram_id, updateData) => {
  try {
    // Clean the update data
    const cleanUpdateData = { ...updateData };

    // Handle wallet_address specifically
    if (cleanUpdateData.wallet_address !== undefined) {
      if (cleanUpdateData.wallet_address === '' || cleanUpdateData.wallet_address === null) {
        cleanUpdateData.wallet_address = null;
      } else {
        cleanUpdateData.wallet_address = cleanUpdateData.wallet_address.toLowerCase().trim();
      }
    }

    const updatedUser = await User.findOneAndUpdate(
      { telegram_id: telegram_id },
      cleanUpdateData,
      {
        new: true,
        runValidators: true, // Ensure validation runs on update
        upsert: false // Don't create if doesn't exist - use getUser for that
      }
    );

    if (!updatedUser) {
      throw new Error(`User with telegram_id ${telegram_id} not found`);
    }

    return updatedUser;
  } catch (error) {
    console.error("Error updating user:", error);

    // Handle specific MongoDB errors
    if (error.code === 11000) {
      // Extract which field caused the duplicate key error
      const field = Object.keys(error.keyValue || {})[0];
      const value = error.keyValue?.[field];

      if (field === 'wallet_address') {
        throw new Error(`Wallet address ${value} is already associated with another user`);
      } else if (field === 'telegram_id') {
        throw new Error(`Telegram ID ${value} already exists`);
      } else {
        throw new Error(`Duplicate value for field: ${field}`);
      }
    }

    if (error.name === 'ValidationError') {
      const validationErrors = Object.values(error.errors).map(err => err.message);
      throw new Error(`Validation failed: ${validationErrors.join(', ')}`);
    }

    throw new Error(`Failed to update user: ${error.message}`);
  }
}

// New utility function to set wallet for user
const setUserWallet = async (telegram_id, walletAddress, encryptedPrivateKey, walletData = null) => {
  try {
    // Check if wallet address is already taken by another user
    if (walletAddress) {
      const existingWallet = await User.findByWalletAddress(walletAddress);
      if (existingWallet && existingWallet.telegram_id !== telegram_id) {
        throw new Error('Wallet address is already associated with another user');
      }
    }

    const updateData = {
      wallet_address: walletAddress,
      encrypted_private_key: encryptedPrivateKey,
      user_state: 'active'
    };

    if (walletData) {
      updateData.wallet_data = walletData;
    }

    return await updateUser(telegram_id, updateData);
  } catch (error) {
    console.error('Error setting user wallet:', error);
    throw error;
  }
}

// New utility function to set NFT verification
const setUserNFTVerification = async (telegram_id, verificationAddress, nftCount = 1) => {
  try {
    const updateData = {
      nft_verified: true,
      nft_verification_address: verificationAddress.toLowerCase().trim(),
      nft_count: nftCount,
      nft_verification_date: new Date(),
      user_state: 'active'
    };

    return await updateUser(telegram_id, updateData);
  } catch (error) {
    console.error('Error setting NFT verification:', error);
    throw error;
  }
}

// New utility function to check if user has access (wallet or NFT)
const checkUserAccess = async (telegram_id) => {
  try {
    const user = await getUser(telegram_id);

    return {
      hasAccess: user.hasWallet() || user.hasNFTVerification(),
      hasWallet: user.hasWallet(),
      hasNFTVerification: user.hasNFTVerification(),
      walletAddress: user.wallet_address,
      nftVerificationAddress: user.nft_verification_address,
      user: user
    };
  } catch (error) {
    console.error('Error checking user access:', error);
    throw error;
  }
}

// New utility function to clear user wallet (for wallet reset)
const clearUserWallet = async (telegram_id) => {
  try {
    return await updateUser(telegram_id, {
      wallet_address: null,
      encrypted_private_key: null,
      wallet_data: null,
      user_state: user.nft_verified ? 'active' : 'inactive'
    });
  } catch (error) {
    console.error('Error clearing user wallet:', error);
    throw error;
  }
}

// New utility function to set user state
const setUserState = async (telegram_id, state) => {
  try {
    return await updateUser(telegram_id, { user_state: state });
  } catch (error) {
    console.error('Error setting user state:', error);
    throw error;
  }
}

module.exports = {
  getUser,
  updateUser,
  setUserWallet,
  setUserNFTVerification,
  checkUserAccess,
  clearUserWallet,
  setUserState
};