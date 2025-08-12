const { default: mongoose } = require("mongoose")
const { BOT_CONFIG } = require('../config/index');

const connectDB = async () => {
  try {
    await mongoose.connect(BOT_CONFIG.MONGO_URI, {
      serverSelectionTimeoutMS: 10000,
    })
    console.log('MongoDB connected successfully');
  } catch (error) {
    console.error('MongoDB connection failed:', error);
    process.exit(1);
  }
}

module.exports = connectDB