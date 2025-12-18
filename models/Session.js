const mongoose = require("mongoose");

module.exports = mongoose.model("Session", new mongoose.Schema({
    number: { type: String, unique: true },
    registered: Boolean,
    lastStatus: String
}));