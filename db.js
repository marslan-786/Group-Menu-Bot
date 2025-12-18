const mongoose = require("mongoose");
const settings = require("./settings");

module.exports.connectDB = async () => {
    await mongoose.connect(settings.mongoUri, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    });
    console.log("🍃 MongoDB Connected");
};