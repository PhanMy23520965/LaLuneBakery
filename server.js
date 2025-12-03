require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo').default || require('connect-mongo');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const nodemailer = require('nodemailer');

// Import Models
const User = require('./models/User');
const Product = require('./models/Product');

const app = express();

// 1. Cấu hình Email
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 587,
    secure: false, // false cho port 587, true cho port 465
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS
    },
    tls: {
        // Không từ chối chứng chỉ máy chủ (giúp tránh lỗi SSL trên Render)
        rejectUnauthorized: false 
    }
});

// 2. Kết nối Database
mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log("✔ Đã kết nối MongoDB"))
    .catch(err => console.log("❌ Lỗi kết nối DB:", err));

// 3. Cấu hình App
app.set('view engine', 'ejs');
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use(session({
    secret: process.env.SESSION_SECRET || 'secret',
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGO_URI }),
    cookie: { maxAge: 1000 * 60 * 60 * 24 } 
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

// --- AUTHENTICATION ---

// 1. Hiển thị trang Đăng ký (Sửa lỗi Cannot GET /register)
app.get('/register', (req, res) => res.render('register', { error: null }));

// 2. Xử lý Đăng ký (Logic mới: Cho phép đăng ký lại nếu chưa xác thực)
app.post('/register', async (req, res) => {
    try {
        const { fullname, email, password, confirmPassword } = req.body;
        
        if (password !== confirmPassword) return res.render('register', { error: 'Mật khẩu xác nhận không khớp!' });
        
        const existingUser = await User.findOne({ email });

        // Logic Quan Trọng:
        // Nếu email đã có VÀ đã kích hoạt -> Báo lỗi
        if (existingUser && existingUser.isVerified) {
            return res.render('register', { error: 'Email này đã được đăng ký và kích hoạt!' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const token = crypto.randomBytes(32).toString('hex');

        // Nếu email đã có nhưng CHƯA kích hoạt -> Cập nhật lại thông tin mới
        if (existingUser && !existingUser.isVerified) {
            existingUser.password = hashedPassword;
            existingUser.fullname = fullname;
            existingUser.verificationToken = token;
            await existingUser.save();
        } 
        // Nếu chưa có -> Tạo mới
        else {
            await User.create({ 
                fullname, email, password: hashedPassword, 
                cart: [], isVerified: false, verificationToken: token 
            });
        }

        // Tạo Link xác thực chuẩn (Fix lỗi http/https)
        const domain = req.headers.host; // la-lune-bakery.onrender.com
        const protocol = req.headers['x-forwarded-proto'] || 'http'; // Tự nhận diện https trên Render
        const verifyLink = `${protocol}://${domain}/verify-email/${token}`;

        const mailOptions = {
            from: '"La Lune Bakery" <no-reply@lalune.com>',
            to: email,
            subject: 'Xác thực tài khoản - La Lune Bakery',
            html: `
                <div style="font-family: Arial; padding: 20px; background: #F9F7F2;">
                    <div style="max-width: 600px; margin: auto; background: white; padding: 20px; border-radius: 10px;">
                        <h2 style="color: #D4A5A5; text-align: center;">Chào mừng ${fullname}! 🌙</h2>
                        <p>Vui lòng bấm nút dưới đây để kích hoạt tài khoản:</p>
                        <div style="text-align: center; margin: 30px 0;">
                            <a href="${verifyLink}" style="background: #D4A5A5; color: white; padding: 12px 25px; text-decoration: none; border-radius: 25px; font-weight: bold;">Xác thực ngay</a>
                        </div>
                        <p style="text-align: center; font-size: 12px; color: #888;">(Link này có hiệu lực cho lần đăng ký mới nhất)</p>
                    </div>
                </div>`
        };

        await transporter.sendMail(mailOptions);
        
        res.render('login', { 
            error: null, 
            success: "🎉 Đăng ký thành công! Vui lòng kiểm tra email để xác thực tài khoản." 
        });

    } catch (err) {
        console.log(err);
        res.render('register', { error: 'Lỗi hệ thống, vui lòng thử lại.' });
    }
});

// 3. Xử lý khi bấm link trong Email
app.get('/verify-email/:token', async (req, res) => {
    try {
        const user = await User.findOne({ verificationToken: req.params.token });
        
        // Nếu không tìm thấy user khớp với token -> Báo lỗi
        if (!user) {
            return res.render('login', { error: "Link xác thực không hợp lệ hoặc đã hết hạn!", success: null });
        }

        // Kích hoạt
        user.isVerified = true;
        user.verificationToken = undefined; // Xóa token đi
        await user.save();

        res.render('login', { error: null, success: "✅ Xác thực thành công! Bạn có thể đăng nhập ngay." });
    } catch (err) {
        console.log(err);
        res.redirect('/login');
    }
});

// 4. Đăng nhập & Đăng xuất
app.get('/login', (req, res) => res.render('login', { error: null, success: null }));

app.post('/login', async (req, res) => {
    try {
        const { email, password, remember } = req.body;
        const user = await User.findOne({ email });

        if (user && await bcrypt.compare(password, user.password)) {
            // Chặn nếu chưa xác thực
            if (!user.isVerified) {
                return res.render('login', { 
                    error: "⚠️ Tài khoản chưa kích hoạt! Hãy kiểm tra email (hoặc đăng ký lại để nhận mail mới).", 
                    success: null 
                });
            }

            req.session.user = user;
            if (remember === 'on') {
                req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; 
            } else {
                req.session.cookie.expires = false;
            }
            res.redirect('/');
        } else {
            res.render('login', { error: 'Sai email hoặc mật khẩu!', success: null });
        }
    } catch (err) {
        res.render('login', { error: 'Lỗi hệ thống.', success: null });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/'));
});

// --- GIỎ HÀNG (Sửa lỗi Cannot GET /cart và /back) ---

// 1. Hiển thị giỏ hàng
app.get('/cart', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const user = await User.findById(req.session.user._id);
    res.render('cart', { cart: user.cart, user: user });
});

// 2. Thêm vào giỏ
app.post('/add-to-cart', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    
    const { productName, price, img } = req.body;
    const user = await User.findById(req.session.user._id);
    
    const existingIndex = user.cart.findIndex(item => item.productName === productName);
    if (existingIndex >= 0) {
        user.cart[existingIndex].quantity += 1;
    } else {
        user.cart.push({ productName, price, image: img, quantity: 1 });
    }
    
    await user.save();
    req.session.user = user;
    
    // SỬA LỖI EXPRESS 5: Thay 'back' bằng referer
    res.redirect(req.get('Referer') || '/');
});

// 3. Cập nhật số lượng
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

// 4. Xóa khỏi giỏ
app.post('/remove-from-cart', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const user = await User.findById(req.session.user._id);
    user.cart = user.cart.filter(item => item.productName !== req.body.productName);
    await user.save();
    req.session.user = user;
    res.redirect('/cart');
});

// 5. Thanh toán
app.get('/checkout', async (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    const user = await User.findById(req.session.user._id);
    let total = user.cart.reduce((sum, item) => sum + item.price * item.quantity, 0);
    
    if (total === 0) return res.redirect('/cart');
    res.render('payment', { user: user, total: total });
});

// --- QUÊN MẬT KHẨU ---
app.get('/forgot-password', (req, res) => res.render('forgot-password', { message: null, error: null }));

app.post('/forgot-password', async (req, res) => {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.render('forgot-password', { error: 'Email không tồn tại', message: null });

    const token = crypto.randomBytes(20).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 3600000;
    await user.save();

    const domain = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const resetLink = `${protocol}://${domain}/reset/${token}`;
    
    const mailOptions = {
        from: '"La Lune Bakery" <no-reply@lalune.com>',
        to: email,
        subject: 'Đặt lại mật khẩu',
        html: `Bấm vào đây để đặt lại mật khẩu: <a href="${resetLink}">${resetLink}</a>`
    };
    await transporter.sendMail(mailOptions);
    
    res.render('forgot-password', { message: 'Đã gửi link đặt lại mật khẩu!', error: null });
});

app.get('/reset/:token', async (req, res) => {
    const user = await User.findOne({ resetPasswordToken: req.params.token, resetPasswordExpires: { $gt: Date.now() } });
    if (!user) return res.send("Link hết hạn.");
    res.render('reset-password', { token: req.params.token });
});

app.post('/reset/:token', async (req, res) => {
    const user = await User.findOne({ resetPasswordToken: req.params.token, resetPasswordExpires: { $gt: Date.now() } });
    if (!user) return res.send("Link không hợp lệ.");
    if (req.body.password !== req.body.confirm) return res.send("Mật khẩu không khớp.");

    user.password = await bcrypt.hash(req.body.password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    res.redirect('/login');
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Server đang chạy tại port ${PORT}`));