// models/Product.js
const mongoose = require('mongoose');

const productSchema = new mongoose.Schema({
    name: String,           // Tên bánh
    price: Number,          // Giá
    image: String,          // Đường dẫn ảnh
    origin: String,         // Nguồn gốc
    weight: String,         // Khối lượng
    ingredients: String,    // Nguyên liệu đặc biệt
    meaning: String,        // Ý nghĩa của bánh
    description: String     // Mô tả ngắn
});

module.exports = mongoose.model('Product', productSchema);