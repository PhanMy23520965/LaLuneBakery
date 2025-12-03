require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default || require('connect-mongo');
const User = require('./models/User');
const Product = require('./models/Product');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const app = express();

// Kết nối Database (Sẽ điền link sau)
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("Đã nối DB"))
    .catch(err => console.log(err));

// Cấu hình
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI })
}));

// --- ROUTES (Đường dẫn) ---

// 1. Trang chủ (Có Tìm kiếm & Giới thiệu)
app.get('/', async (req, res) => {
    let query = {};
    // Nếu người dùng nhập từ khóa tìm kiếm
    if (req.query.search) {
        query.name = { $regex: req.query.search, $options: 'i' }; // Tìm gần đúng, không phân biệt hoa thường
    }
    
    const products = await Product.find(query);
    res.render('home', { user: req.session.user, products: products, search: req.query.search });
});

// 2. Trang Chi tiết sản phẩm
app.get('/product/:id', async (req, res) => {
    try {
        const product = await Product.findById(req.params.id);
        res.render('product-detail', { user: req.session.user, product: product });
    } catch (err) {
        res.redirect('/');
    }
});

// 3. Chức năng tạo dữ liệu mẫu (Chạy 1 lần để có bánh trong DB)
app.get('/seed', async (req, res) => {
    await Product.deleteMany({}); // Xóa dữ liệu cũ
    await Product.create([
        {
            name: "Tiramisu Ý",
            price: 55000,
            image: "/images/tiramisu.png",
            origin: "Ý (Italy)",
            weight: "200g",
            ingredients: "Phô mai Mascarpone, Rượu Rum, Cafe Espresso",
            meaning: "Trong tiếng Ý, Tiramisu nghĩa là 'Hãy mang em đi'.",
            description: "Hương vị đăng đắng của cafe hòa quyện cùng sự béo ngậy của phô mai."
        },
        {
            name: "Red Velvet",
            price: 60000,
            image: "/images/redvelvet.png",
            origin: "Mỹ",
            weight: "250g",
            ingredients: "Cacao, Cream Cheese, Màu đỏ thực vật",
            meaning: "Biểu tượng của tình yêu nồng cháy và sự quyến rũ.",
            description: "Chiếc bánh nhung đỏ rực rỡ với lớp kem trắng mịn màng."
        },
        {
            name: "Mousse Chanh Dây",
            price: 45000,
            image: "/images/mousse.png",
            origin: "Pháp",
            weight: "180g",
            ingredients: "Chanh dây tươi, Gelatin, Whipping Cream",
            meaning: "Sự tươi mát, khởi đầu mới đầy năng lượng.",
            description: "Vị chua thanh mát lạnh tan ngay trong miệng."
        }
    ]);
    res.send("Đã tạo dữ liệu bánh thành công! Hãy quay về trang chủ.");
});

// 1. Đăng ký
app.get('/register', (req, res) => res.render('register', { error: null }));

app.post('/register', async (req, res) => {
    try {
        const { fullname, email, password, confirmPassword } = req.body;
        if (password !== confirmPassword) {
            return res.render('register', { error: 'Mật khẩu xác nhận không khớp!' });
        }
        
        // Kiểm tra email đã tồn tại chưa
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.render('register', { error: 'Email này đã được sử dụng!' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        await User.create({ fullname, email, password: hashedPassword, cart: [] });
        res.redirect('/login');
    } catch (err) {
        console.log(err);
        res.render('register', { error: 'Có lỗi xảy ra, thử lại sau.' });
    }
});

// 2. Đăng nhập
app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res) => {
    try {
        const { email, password, remember } = req.body;
        const user = await User.findOne({ email });

        if (user && await bcrypt.compare(password, user.password)) {
            req.session.user = user;
            
            // Xử lý "Ghi nhớ đăng nhập"
            if (remember === 'on') {
                // Nếu chọn ghi nhớ: Cookie sống 30 ngày
                req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; 
            } else {
                // Nếu không: Cookie sống hết phiên (tắt trình duyệt là mất)
                req.session.cookie.expires = false;
            }
            
            res.redirect('/');
        } else {
            res.render('login', { error: 'Sai email hoặc mật khẩu!' });
        }
    } catch (err) {
        res.render('login', { error: 'Lỗi hệ thống.' });
    }
});

// 3. Đăng xuất
app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/');
    });
});

// 4. Quên mật khẩu (Gửi yêu cầu)
app.get('/forgot-password', (req, res) => res.render('forgot-password', { message: null, error: null }));

app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.render('forgot-password', { error: 'Email không tồn tại trong hệ thống', message: null });

    // Tạo token ngẫu nhiên
    const token = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000; // Token hết hạn sau 1 giờ
    await user.save();

    // --- GIẢ LẬP GỬI EMAIL (Vì server free không có sẵn SMTP) ---
    // Link này sẽ hiện ở TERMINAL VS CODE của bạn
    const resetLink = `http://${req.headers.host}/reset/${token}`;
    console.log("==================================================");
    console.log("LINK ĐẶT LẠI MẬT KHẨU (Gửi cái này cho khách):");
    console.log(resetLink);
    console.log("==================================================");
    
    res.render('forgot-password', { message: 'Đã gửi link đặt lại mật khẩu! (Hãy xem Terminal VS Code để lấy link)', error: null });
});

// 5. Đặt lại mật khẩu mới
app.get('/reset/:token', async (req, res) => {
    const user = await User.findOne({ 
        resetPasswordToken: req.params.token, 
        resetPasswordExpires: { $gt: Date.now() } // Token phải chưa hết hạn
    });
    if (!user) return res.send("Link đã hết hạn hoặc không hợp lệ.");
    res.render('reset-password', { token: req.params.token });
});

app.post('/reset/:token', async (req, res) => {
    const user = await User.findOne({ 
        resetPasswordToken: req.params.token, 
        resetPasswordExpires: { $gt: Date.now() } 
    });
    if (!user) return res.send("Link không hợp lệ.");

    if (req.body.password !== req.body.confirm) return res.send("Mật khẩu không khớp.");

    user.password = await bcrypt.hash(req.body.password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();

    res.redirect('/login');
});

// --- 1. SỬA LẠI ROUTE THÊM VÀO GIỎ (Thông minh hơn: Cộng dồn số lượng) ---
app.post('/add-to-cart', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    
    const { productName, price, img } = req.body;
    const user = await User.findById(req.session.user._id);
    
    // Kiểm tra xem bánh này đã có trong giỏ chưa
    const existingItemIndex = user.cart.findIndex(item => item.productName === productName);

    if (existingItemIndex >= 0) {
        // Nếu có rồi -> Tăng số lượng lên 1
        user.cart[existingItemIndex].quantity += 1;
    } else {
        // Nếu chưa có -> Thêm mới
        user.cart.push({ productName, price, image: img, quantity: 1 });
    }
    
    await user.save();
    req.session.user = user; // Cập nhật session
    res.redirect(req.get('Referer') || '/');
});

// --- 2. THÊM ROUTE XÓA SẢN PHẨM KHỎI GIỎ ---
app.post('/remove-from-cart', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const { productName } = req.body;
    const user = await User.findById(req.session.user._id);

    // Lọc bỏ sản phẩm muốn xóa
    user.cart = user.cart.filter(item => item.productName !== productName);
    
    await user.save();
    req.session.user = user;
    res.redirect('/cart');
});

// --- 3. ROUTE THANH TOÁN (Hiển thị QR) ---
app.get('/checkout', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const user = await User.findById(req.session.user._id);

    // Tính tổng tiền
    let total = 0;
    user.cart.forEach(item => {
        total += item.price * item.quantity;
    });

    if (total === 0) return res.redirect('/cart'); // Giỏ rỗng thì không thanh toán

    // Render trang thanh toán
    res.render('payment', { user: user, total: total });
});

app.get('/cart', async (req, res) => {
    // 1. Nếu chưa đăng nhập thì đá về trang login
    if (!req.session.user) return res.redirect('/login');

    // 2. Lấy thông tin user mới nhất từ DB
    const user = await User.findById(req.session.user._id);

    // 3. Hiển thị trang cart.ejs và gửi kèm dữ liệu giỏ hàng
    res.render('cart', { cart: user.cart, user: user });
});

// --- ROUTE CẬP NHẬT SỐ LƯỢNG (MỚI) ---
app.post('/update-cart', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    
    const { productName, action } = req.body;
    const user = await User.findById(req.session.user._id);

    // Tìm vị trí món hàng trong giỏ
    const itemIndex = user.cart.findIndex(item => item.productName === productName);

    if (itemIndex > -1) {
        if (action === 'increase') {
            user.cart[itemIndex].quantity += 1; // Cộng thêm 1
        } else if (action === 'decrease') {
            user.cart[itemIndex].quantity -= 1; // Trừ đi 1
        }

        // Logic quan trọng: Nếu số lượng <= 0 thì XÓA LUÔN
        if (user.cart[itemIndex].quantity <= 0) {
            user.cart.splice(itemIndex, 1);
        }
    }

    await user.save();
    req.session.user = user; // Cập nhật session
    res.redirect('/cart'); // Load lại trang giỏ hàng
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server đang chạy tại port ${PORT}`));