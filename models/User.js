// models/User.js
const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    fullname: { type: String, required: true }, // Thêm tên đầy đủ
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    cart: [
        {
            productName: String,
            price: Number,
            quantity: { type: Number, default: 1 },
            image: String
        }
    ],
    // Hai trường này dùng cho Quên Mật Khẩu
    resetPasswordToken: String,
    resetPasswordExpires: Date
});

module.exports = mongoose.model('User', userSchema);