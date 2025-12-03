require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default || require('connect-mongo');
const bcrypt = require('bcryptjs');

// Import Models
const User = require('./models/User');
const Product = require('./models/Product');

const app = express();

// 1. Kết nối Database
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✔ Đã kết nối MongoDB"))
    .catch(err => console.log("❌ Lỗi kết nối DB:", err));

// 2. Cấu hình App
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } // 1 ngày
}));

// ================= ROUTES ================= //

// --- TRANG CHỦ ---
app.get('/', async (req, res) => {
    let query = {};
    if (req.query.search) {
        query.name = { $regex: req.query.search, $options: 'i' };
    }
    const products = await Product.find(query);
    res.render('home', { user: req.session.user, products: products, search: req.query.search });
});

// --- CHI TIẾT SẢN PHẨM ---
app.get('/product/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        res.render('product-detail', { user: req.session.user, product: product });
    } catch (err) {
        res.redirect('/');
    }
});

// --- AUTHENTICATION (SĐT + Tên + Địa chỉ) ---

// 1. Đăng ký
app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
    try {
        // Lấy phone và address thay vì email
        const { fullname, phone, address, password, confirmPassword } = req.body;
        
        if (password !== confirmPassword) {
            return res.render('register', { error: 'Mật khẩu xác nhận không khớp!' });
        }
        
        // Kiểm tra xem SĐT đã tồn tại chưa
        const existingUser = await User.findOne({ phone: phone });
        if (existingUser) {
            return res.render('register', { error: 'Số điện thoại này đã được đăng ký!' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // Tạo User mới với SĐT và Địa chỉ
        await User.create({ 
            fullname, 
            phone, 
            address, 
            password: hashedPassword, 
            cart: [] 
        });

        res.render('login', { 
            error: null, 
            success: "Đăng ký thành công! Mời bạn đăng nhập." 
        });

    } catch (err) {
        console.log(err);
        res.render('register', { error: 'Lỗi hệ thống, vui lòng thử lại.' });
    }
});

// 2. Đăng nhập (Dùng SĐT)
app.get('/login', (req, res) => res.render('login', { error: null, success: null }));

app.post('/login', async (req, res) => {
    try {
        const { phone, password, remember } = req.body;
        
        // Tìm user theo SĐT
        const user = await User.findOne({ phone: phone });

        if (user && await bcrypt.compare(password, user.password)) {
            
            req.session.user = user;
            
            if (remember === 'on') {
                req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; 
            } else {
                req.session.cookie.expires = false;
            }
            
            res.redirect('/');
        } else {
            res.render('login', { error: 'Sai số điện thoại hoặc mật khẩu!', success: null });
        }
    } catch (err) {
        res.render('login', { error: 'Lỗi hệ thống.', success: null });
    }
});

// 3. Đăng xuất
app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// --- ADMIN & GIỎ HÀNG (Giữ nguyên logic cũ) ---

app.get('/admin', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const products = await Product.find({});
    res.render('admin', { products: products });
});

app.get('/admin/add', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.render('admin-form', { formTitle: 'Thêm Bánh Mới', action: '/admin/add', product: {} });
});

app.post('/admin/add', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    await Product.create(req.body);
    res.redirect('/admin');
});

app.get('/admin/edit/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const product = await Product.findById(req.params.id);
    res.render('admin-form', { formTitle: 'Sửa Bánh', action: '/admin/edit/' + product._id, product: product });
});

app.post('/admin/edit/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    await Product.findByIdAndUpdate(req.params.id, req.body);
    res.redirect('/admin');
});

app.post('/admin/delete/:id', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    await Product.findByIdAndDelete(req.params.id);
    res.redirect('/admin');
});

app.get('/cart', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const user = await User.findById(req.session.user._id);
    res.render('cart', { cart: user.cart, user: user });
});

app.post('/add-to-cart', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { productName, price, img } = req.body;
    const user = await User.findById(req.session.user._id);
    const existingIndex = user.cart.findIndex(item => item.productName === productName);
    if (existingIndex >= 0) user.cart[existingIndex].quantity += 1;
    else user.cart.push({ productName, price, image: img, quantity: 1 });
    await user.save();
    req.session.user = user;
    res.redirect(req.get('Referer') || '/');
});

app.post('/update-cart', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { productName, action } = req.body;
    const user = await User.findById(req.session.user._id);
    const index = user.cart.findIndex(item => item.productName === productName);
    if (index > -1) {
        if (action === 'increase') user.cart[index].quantity += 1;
        if (action === 'decrease') user.cart[index].quantity -= 1;
        if (user.cart[index].quantity <= 0) user.cart.splice(index, 1);
    }
    await user.save();
    req.session.user = user;
    res.redirect('/cart');
});

app.post('/remove-from-cart', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const user = await User.findById(req.session.user._id);
    user.cart = user.cart.filter(item => item.productName !== req.body.productName);
    await user.save();
    req.session.user = user;
    res.redirect('/cart');
});

app.get('/checkout', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const user = await User.findById(req.session.user._id);
    let total = user.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    if (total === 0) return res.redirect('/cart');
    res.render('payment', { user: user, total: total });
});

// Seed data
app.get('/seed', async (req, res) => {
    await Product.deleteMany({});
    await Product.create([
        { name: "Tiramisu Ý", price: 55000, image: "/images/tiramisu.png", origin: "Ý", weight: "200g", ingredients: "Phô mai, Cafe", meaning: "Hãy mang em đi", description: "Bánh ngon." },
        { name: "Red Velvet", price: 60000, image: "/images/redvelvet.png", origin: "Mỹ", weight: "250g", ingredients: "Cacao", meaning: "Tình yêu", description: "Bánh đỏ." },
        { name: "Mousse Chanh Dây", price: 45000, image: "/images/mousse.png", origin: "Pháp", weight: "180g", ingredients: "Chanh dây", meaning: "Tươi mát", description: "Bánh chua." }
    ]);
    res.send("Đã tạo dữ liệu mẫu.");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server đang chạy tại port ${PORT}`));