const User = require('../models/user')

const getUser = async (telegram_id) => {
  try {
    let user = await User.findOne({ telegram_id });
    if (!user) {
      user = await User.create({ telegram_id });
       await user.save()
    }

    return user;
  } catch (error) {
    console.error("Error fetching user:", error);
    throw new Error("Failed to fetch user");
  }
}

const updateUser = async (telegram_id, updateData) => {
  try {
    const update = await User.findOneAndUpdate(
      {
        telegram_id: telegram_id
      },
      updateData,
      { new: true }
    )
  } catch (error) {
    console.error("Error updating user", error)
    throw new Error("Failed to update user")
  }
}

module.exports = {
  getUser, updateUser
}