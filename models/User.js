const mongoose = require("mongoose");

module.exports = mongoose.model("User", new mongoose.Schema({
    telegramId: { type: Number, unique: true },
    numbers: [String]
}));