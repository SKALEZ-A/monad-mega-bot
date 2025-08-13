const mongoose = require("mongoose");
const { Schema } = mongoose;

const UserSchema = new Schema({
  telegram_id: { type: Number, required: true, unique: true },
  wallet_address: { type: String, unique: true, sparse: true },
  wallet_data: { type: String }, // Complete wallet data as JSON (includes encrypted private key)
  encrypted_private_key: { type: String }, // Also store separately for easy access/migration
}, { timestamps: true });

module.exports = mongoose.model("User", UserSchema);