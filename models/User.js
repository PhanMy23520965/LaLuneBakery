const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    fullname: String,
    // Đổi email thành phone
    phone: { type: String, unique: true, required: true },
    // Thêm địa chỉ
    address: { type: String, default: "" },
    password: { type: String, required: true },
    cart: [
        {
            productName: String,
            price: Number,
            image: String,
            quantity: { type: Number, default: 1 }
        }
    ]
});

module.exports = mongoose.model('User', userSchema);