// seedDemo.js — Tạo database demo riêng (mặc định: slothub_demo) với nhiều quầy + món ăn
// Chạy: node seedDemo.js            -> ghi vào DB "slothub_demo"
//       node seedDemo.js ten_db_khac -> ghi vào DB khác
// Lưu ý: script XÓA SẠCH dữ liệu trong DB đích trước khi đổ dữ liệu mẫu.
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '.env') });

const User = require('./models/User');
const Vendor = require('./models/Vendor');
const MenuItem = require('./models/MenuItem');
const MenuItemReview = require('./models/MenuItemReview');

const DB_NAME = process.argv[2] || 'slothub_demo';
const dbUri = process.env.MONGODB_URI;

if (!dbUri) {
    console.error('❌ Không tìm thấy MONGODB_URI trong file .env!');
    process.exit(1);
}
if (DB_NAME === 'slothub') {
    console.error('❌ Không ghi đè DB chính "slothub". Hãy chọn tên DB khác.');
    process.exit(1);
}

const img = (id) => `https://images.unsplash.com/${id}?w=800`;

// Ảnh món ăn thật từ Wikimedia Commons (giấy phép tự do) cho các món không có ảnh Unsplash
const DISH_IMAGES = {
    'Cơm Tấm Sườn Trứng': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0c/C%C6%A1m_t%E1%BA%A5m_S%C3%A0i_G%C3%B2n_%28s%C6%B0%E1%BB%9Dn_tr%E1%BB%A9ng%29%2C_ng15th8n2022.jpg/960px-C%C6%A1m_t%E1%BA%A5m_S%C3%A0i_G%C3%B2n_%28s%C6%B0%E1%BB%9Dn_tr%E1%BB%A9ng%29%2C_ng15th8n2022.jpg',
    'Cơm Gà Nướng': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/d/d1/C%C6%A1m_g%C3%A0_s%C6%B0%E1%BB%9Dn_n%C6%B0%E1%BB%9Bng%2C_ng23th8n2022_%28%C4%90%C3%B9i_g%C3%A0_n%C6%B0%E1%BB%9Bng%29_%283%29.jpg/960px-C%C6%A1m_g%C3%A0_s%C6%B0%E1%BB%9Dn_n%C6%B0%E1%BB%9Bng%2C_ng23th8n2022_%28%C4%90%C3%B9i_g%C3%A0_n%C6%B0%E1%BB%9Bng%29_%283%29.jpg',
    'Canh Chua Cá Lóc': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/63/Canh_chua_c%C3%A1_l%C3%B3c_%E1%BB%9F_Th%E1%BB%A7y_Tr%C3%BAc_Qu%C3%A1n%2C_%C4%91%C6%B0%E1%BB%9Dng_Nguy%E1%BB%85n_Nh%E1%BB%AF_L%C3%A3m_%282%29.jpg/960px-Canh_chua_c%C3%A1_l%C3%B3c_%E1%BB%9F_Th%E1%BB%A7y_Tr%C3%BAc_Qu%C3%A1n%2C_%C4%91%C6%B0%E1%BB%9Dng_Nguy%E1%BB%85n_Nh%E1%BB%AF_L%C3%A3m_%282%29.jpg',
    'Trà Đá': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/9c/Ly_tr%C3%A0_%C4%91%C3%A1_SG%2C_ng3th5n2022.jpg/960px-Ly_tr%C3%A0_%C4%91%C3%A1_SG%2C_ng3th5n2022.jpg',
    'Phở Gà': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/10/Pho_ga_%28noodle_soup_with_chicken%29%2C_Hanoi_%286945821707%29.jpg/960px-Pho_ga_%28noodle_soup_with_chicken%29%2C_Hanoi_%286945821707%29.jpg',
    'Phở Bò Đặc Biệt': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/42/Ph%E1%BB%9F_b%C3%B2_in_a_German_restaurant_01.jpg/960px-Ph%E1%BB%9F_b%C3%B2_in_a_German_restaurant_01.jpg',
    'Quẩy Giòn': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/78/Youtiao.jpg/960px-Youtiao.jpg',
    'Bún Bò Tái': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/00/Bun-Bo-Hue-from-Huong-Giang-2011.jpg/960px-Bun-Bo-Hue-from-Huong-Giang-2011.jpg',
    'Bún Thịt Nướng': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/47/Bun_thit_nuong.jpg/960px-Bun_thit_nuong.jpg',
    'Bún Chả Hà Nội': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/56/Bun_cha_Hanoi.jpg/960px-Bun_cha_Hanoi.jpg',
    'Gỏi Cuốn Tôm Thịt': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f2/Goi_cuon_Phuongnhu.JPG/960px-Goi_cuon_Phuongnhu.JPG',
    'Cà Phê Muối': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/0/0d/Ly_c%C3%A0_ph%C3%AA_mu%E1%BB%91i_%E1%BB%9F_T%C3%A2n_Ph%C3%BA_ng14th5n2023_%281%29.jpg/960px-Ly_c%C3%A0_ph%C3%AA_mu%E1%BB%91i_%E1%BB%9F_T%C3%A2n_Ph%C3%BA_ng14th5n2023_%281%29.jpg',
    'Trà Đào Cam Sả': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6b/Peach_iced_tea_with_orange_slices.jpg/960px-Peach_iced_tea_with_orange_slices.jpg',
    'Sinh Tố Bơ': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a5/Sinh_t%E1%BB%91_b%C6%A1.jpg/960px-Sinh_t%E1%BB%91_b%C6%A1.jpg',
    'Bánh Mì Trứng': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4d/M%E1%BB%99t_ph%E1%BA%A7n_b%C3%A1nh_m%C3%AC_ch%E1%BA%A3o_v%E1%BB%9Bi_tr%E1%BB%A9ng_v%C3%A0_ch%E1%BA%A3_%2838657217774%29.jpg/960px-M%E1%BB%99t_ph%E1%BA%A7n_b%C3%A1nh_m%C3%AC_ch%E1%BA%A3o_v%E1%BB%9Bi_tr%E1%BB%A9ng_v%C3%A0_ch%E1%BA%A3_%2838657217774%29.jpg',
    'Bánh Mì Gà Xé': 'https://upload.wikimedia.org/wikipedia/commons/a/a2/Viet_McRib_Banh_Mi.jpg',
    'Combo Bánh Mì + Cà Phê': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c5/2023-12-10_Coffee_and_b%C3%A1nh_m%C3%AC_in_Saigon.jpg/960px-2023-12-10_Coffee_and_b%C3%A1nh_m%C3%AC_in_Saigon.jpg',
    'Bánh Tráng Trộn': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/63/Vietnamese_%22banh_trang_tron%22.JPG/960px-Vietnamese_%22banh_trang_tron%22.JPG',
    'Xiên Que Thập Cẩm': 'https://upload.wikimedia.org/wikipedia/commons/b/b4/A_skewer_of_Fish_ball.png',
    'Gà Rán Popcorn': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/14/Chicken_Popcorn.jpg/960px-Chicken_Popcorn.jpg',
    'Nem Chua Rán': 'https://upload.wikimedia.org/wikipedia/commons/2/26/Nem-chua-ran2.jpg',
    'Chè Thái Sầu Riêng': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f8/Jakarta_street-side_Es_Cendol_4.jpg/960px-Jakarta_street-side_Es_Cendol_4.jpg',
    'Bánh Flan Caramel': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/43/Homemade_Flan.jpg/960px-Homemade_Flan.jpg',
    'Chè Khúc Bạch': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/68/Ch%C3%A8_kh%C3%BAc_b%E1%BA%A1ch_%E1%BB%9F_qu%C3%A1n_Th%E1%BA%A3o_Vy_2020_09_06.jpg/960px-Ch%C3%A8_kh%C3%BAc_b%E1%BA%A1ch_%E1%BB%9F_qu%C3%A1n_Th%E1%BA%A3o_Vy_2020_09_06.jpg',
};

// ================= DỮ LIỆU QUẦY + MÓN =================
const STALLS = [
    {
        owner: { name: 'Trần Văn Tấm', email: 'comtam@slothub.vn' },
        vendor: {
            name: 'Cơm Tấm Sài Gòn',
            description: 'Cơm tấm sườn nướng than hoa chuẩn vị miền Nam',
            imageUrl: img('photo-1512058564366-18510be2db19'),
            openTime: '00:00', closeTime: '23:59', category: 'Cơm'
        },
        items: [
            { name: 'Cơm Tấm Sườn Bì Chả', price: 40000, calories: 780, category: 'Cơm', description: 'Sườn nướng, bì, chả trứng, mỡ hành', imageUrl: img('photo-1512058564366-18510be2db19') },
            { name: 'Cơm Tấm Sườn Trứng', price: 35000, calories: 690, category: 'Cơm', description: 'Sườn nướng mật ong + trứng ốp la' },
            { name: 'Cơm Gà Nướng', price: 38000, calories: 640, category: 'Cơm', description: 'Đùi gà nướng sả, dưa leo, cà chua' },
            { name: 'Canh Chua Cá Lóc', price: 20000, calories: 180, category: 'Combo', description: 'Ăn kèm cơm, chua ngọt thanh mát' },
            { name: 'Trà Đá', price: 5000, calories: 0, category: 'Đồ uống', description: 'Miễn phí thêm đá' }
        ]
    },
    {
        owner: { name: 'Nguyễn Thị Phở', email: 'pho@slothub.vn' },
        vendor: {
            name: 'Phở Hà Nội 1990',
            description: 'Phở bò nước dùng hầm xương 12 tiếng',
            imageUrl: img('photo-1503764654157-72d979d9af2f'),
            openTime: '06:00', closeTime: '14:00', category: 'Bún/Phở'
        },
        items: [
            { name: 'Phở Bò Tái Chín', price: 45000, calories: 450, category: 'Bún/Phở', description: 'Bò tái, bò chín, hành tây, rau thơm', imageUrl: img('photo-1503764654157-72d979d9af2f') },
            { name: 'Phở Gà', price: 40000, calories: 400, category: 'Bún/Phở', description: 'Gà ta xé, nước dùng trong' },
            { name: 'Phở Bò Đặc Biệt', price: 55000, calories: 560, category: 'Bún/Phở', description: 'Đủ topping: tái, nạm, gầu, bò viên' },
            { name: 'Quẩy Giòn', price: 5000, calories: 150, category: 'Đồ ăn vặt', description: '2 chiếc, ăn kèm phở' }
        ]
    },
    {
        owner: { name: 'Lê Thị Xuân', email: 'bunbo@slothub.vn' },
        vendor: {
            name: 'Bún Bò Huế O Xuân',
            description: 'Bún bò cay nồng đúng điệu xứ Huế',
            imageUrl: img('photo-1631709497146-a239ef373cf1'),
            openTime: '07:00', closeTime: '19:00', category: 'Bún/Phở'
        },
        items: [
            { name: 'Bún Bò Giò Heo', price: 45000, calories: 620, category: 'Bún/Phở', description: 'Giò heo, chả cua, huyết', imageUrl: img('photo-1631709497146-a239ef373cf1') },
            { name: 'Bún Bò Tái', price: 40000, calories: 480, category: 'Bún/Phở', description: 'Bò tái mềm, sả thơm' },
            { name: 'Bún Thịt Nướng', price: 35000, calories: 520, category: 'Bún/Phở', description: 'Thịt nướng, chả giò, nước mắm chua ngọt' },
            { name: 'Bún Chả Hà Nội', price: 40000, calories: 600, category: 'Bún/Phở', description: 'Chả viên + chả miếng nướng than' },
            { name: 'Gỏi Cuốn Tôm Thịt', price: 25000, calories: 210, category: 'Đồ ăn vặt', description: '3 cuốn, chấm tương đậu phộng' }
        ]
    },
    {
        owner: { name: 'Phạm Minh Trà', email: 'trasua@slothub.vn' },
        vendor: {
            name: 'SlotTea - Trà Sữa & Cà Phê',
            description: 'Trà sữa trân châu, cà phê muối, nước ép tươi',
            imageUrl: img('photo-1558857563-b371033873b8'),
            openTime: '07:00', closeTime: '21:00', category: 'Đồ uống'
        },
        items: [
            { name: 'Trà Sữa Trân Châu Đường Đen', price: 30000, calories: 380, category: 'Đồ uống', description: 'Size M, trân châu nấu mới mỗi 2 tiếng', imageUrl: img('photo-1558857563-b371033873b8') },
            { name: 'Cà Phê Sữa Đá', price: 20000, calories: 180, category: 'Đồ uống', description: 'Phin truyền thống, sữa đặc', imageUrl: img('photo-1461023058943-07fcbe16d735') },
            { name: 'Cà Phê Muối', price: 25000, calories: 220, category: 'Đồ uống', description: 'Kem muối béo mặn đặc trưng' },
            { name: 'Trà Đào Cam Sả', price: 28000, calories: 150, category: 'Đồ uống', description: 'Đào miếng, cam tươi, sả' },
            { name: 'Nước Ép Cam', price: 25000, calories: 110, category: 'Đồ uống', description: '100% cam vắt, không đường', imageUrl: img('photo-1600271886742-f049cd451bba') },
            { name: 'Sinh Tố Bơ', price: 30000, calories: 320, category: 'Đồ uống', description: 'Bơ sáp Đắk Lắk' }
        ]
    },
    {
        owner: { name: 'Võ Thanh Mì', email: 'banhmi@slothub.vn' },
        vendor: {
            name: 'Bánh Mì Hội An',
            description: 'Bánh mì giòn rụm, pate nhà làm',
            imageUrl: img('photo-1600454309261-3dc9b7597637'),
            openTime: '06:00', closeTime: '11:00', category: 'Đồ ăn vặt'
        },
        items: [
            { name: 'Bánh Mì Thập Cẩm', price: 25000, calories: 520, category: 'Đồ ăn vặt', description: 'Pate, chả lụa, xá xíu, rau dưa', imageUrl: img('photo-1600454309261-3dc9b7597637') },
            { name: 'Bánh Mì Trứng', price: 18000, calories: 380, category: 'Đồ ăn vặt', description: '2 trứng ốp la, pate' },
            { name: 'Bánh Mì Gà Xé', price: 22000, calories: 420, category: 'Đồ ăn vặt', description: 'Gà xé phay, sốt mayonnaise' },
            { name: 'Combo Bánh Mì + Cà Phê', price: 35000, calories: 600, category: 'Combo', description: 'Bánh mì thập cẩm + cà phê sữa đá' }
        ]
    },
    {
        owner: { name: 'Đỗ Thị Ba', email: 'anvat@slothub.vn' },
        vendor: {
            name: 'Ăn Vặt Cô Ba',
            description: 'Xiên que, khoai tây chiên, bánh tráng trộn',
            imageUrl: img('photo-1573080496219-bb080dd4f877'),
            openTime: '10:00', closeTime: '20:00', category: 'Đồ ăn vặt'
        },
        items: [
            { name: 'Khoai Tây Chiên', price: 20000, calories: 365, category: 'Đồ ăn vặt', description: 'Lắc phô mai hoặc rong biển', imageUrl: img('photo-1573080496219-bb080dd4f877') },
            { name: 'Bánh Tráng Trộn', price: 20000, calories: 300, category: 'Đồ ăn vặt', description: 'Xoài, trứng cút, khô bò, rau răm' },
            { name: 'Xiên Que Thập Cẩm', price: 30000, calories: 450, category: 'Đồ ăn vặt', description: '5 xiên: cá viên, bò viên, xúc xích' },
            { name: 'Gà Rán Popcorn', price: 35000, calories: 480, category: 'Đồ ăn vặt', description: 'Gà viên chiên giòn, sốt cay' },
            { name: 'Nem Chua Rán', price: 25000, calories: 330, category: 'Đồ ăn vặt', description: '10 chiếc, kèm tương ớt', isAvailable: false, countInStock: 0 }
        ]
    },
    {
        owner: { name: 'Hồ Ngọc Chè', email: 'che@slothub.vn' },
        vendor: {
            name: 'Chè & Tráng Miệng Ngọt Ngào',
            description: 'Chè Thái, sữa chua, bánh flan mát lạnh',
            imageUrl: img('photo-1488477181946-6428a0291777'),
            openTime: '09:00', closeTime: '21:00', category: 'Tráng miệng',
            isPaused: true, pauseReason: 'Quầy nghỉ phép hôm nay, mai mở lại nha!'
        },
        items: [
            { name: 'Chè Thái Sầu Riêng', price: 25000, calories: 350, category: 'Tráng miệng', description: 'Sầu riêng, mít, thạch, nước cốt dừa' },
            { name: 'Sữa Chua Nếp Cẩm', price: 18000, calories: 210, category: 'Tráng miệng', description: 'Sữa chua nhà làm, nếp cẩm dẻo', imageUrl: img('photo-1488477181946-6428a0291777') },
            { name: 'Bánh Flan Caramel', price: 12000, calories: 160, category: 'Tráng miệng', description: 'Mềm mịn, caramel đắng nhẹ' },
            { name: 'Chè Khúc Bạch', price: 22000, calories: 240, category: 'Tráng miệng', description: 'Khúc bạch phô mai, hạnh nhân' }
        ]
    }
];

const STUDENTS = [
    { name: 'Huy Diep An', email: 'an.hd@fpt.edu.vn', studentId: 'SE170488', walletBalance: 1000000 },
    { name: 'Nguyễn Minh Khoa', email: 'khoa.nm@fpt.edu.vn', studentId: 'SE180123', walletBalance: 250000 },
    { name: 'Trần Thu Hà', email: 'ha.tt@fpt.edu.vn', studentId: 'SE180456', walletBalance: 50000 }
];

const REVIEW_TEXTS = [
    { rating: 5, comment: 'Ngon xuất sắc, sẽ quay lại!' },
    { rating: 4, comment: 'Ngon, phần ăn vừa đủ no.' },
    { rating: 5, comment: 'Lấy món nhanh, không phải xếp hàng 👍' },
    { rating: 3, comment: 'Tạm ổn, hơi mặn một chút.' },
    { rating: 4, comment: 'Giá hợp lý cho sinh viên.' }
];

const run = async () => {
    await mongoose.connect(dbUri, { dbName: DB_NAME });
    console.log(`✅ Đã kết nối DB: ${mongoose.connection.name}`);

    // Làm sạch toàn bộ DB đích
    await mongoose.connection.db.dropDatabase();
    console.log('🧹 Đã xóa dữ liệu cũ trong DB đích');

    // --- ADMIN ---
    const admin = await User.create({
        name: 'SlotHub Admin',
        email: 'admin@slothub.vn',
        password: 'Admin@123',
        role: 'admin',
        bankAccount: { bankName: 'MB', accountNumber: '0999888777', accountName: 'SLOTHUB ADMIN' }
    });

    // --- SINH VIÊN ---
    const students = [];
    for (const s of STUDENTS) {
        students.push(await User.create({ ...s, role: 'student', isActive: true }));
    }

    // --- QUẦY + CHỦ QUẦY + MÓN ---
    let itemCount = 0;
    const allItems = [];
    for (const stall of STALLS) {
        const owner = await User.create({
            ...stall.owner,
            password: 'Vendor@123',
            role: 'vendor_owner',
            isApproved: true
        });
        const vendor = await Vendor.create({ ...stall.vendor, owner: owner._id, isActive: true });

        for (const it of stall.items) {
            const item = await MenuItem.create({
                countInStock: 50,
                dailyQuota: 100,
                isAvailable: true,
                ...it,
                imageUrl: it.imageUrl || DISH_IMAGES[it.name] || '',
                vendor: vendor._id
            });
            allItems.push({ item, vendor });
            itemCount++;
        }
    }

    // --- ĐÁNH GIÁ MẪU (mỗi món đang bán nhận 0-3 review) ---
    let reviewCount = 0;
    for (const [idx, { item, vendor }] of allItems.entries()) {
        if (!item.isAvailable) continue;
        const n = idx % 4; // 0..3 review
        for (let k = 0; k < n && k < students.length; k++) {
            const st = students[k];
            const r = REVIEW_TEXTS[(idx + k) % REVIEW_TEXTS.length];
            item.reviews.push({ user: st._id, name: st.name, rating: r.rating, comment: r.comment });
            await MenuItemReview.create({
                menuItem: item._id, vendor: vendor._id, user: st._id,
                name: st.name, rating: r.rating, comment: r.comment
            });
            reviewCount++;
        }
        if (item.reviews.length) {
            item.numReviews = item.reviews.length;
            item.rating = item.reviews.reduce((a, r) => a + r.rating, 0) / item.numReviews;
            item.totalSold = 10 + idx * 3;
            await item.save();
        }
    }

    console.log('------------------------------------------');
    console.log(`🎉 ĐÃ TẠO DB "${DB_NAME}" THÀNH CÔNG!`);
    console.log(`🏪 Quầy: ${STALLS.length} | 🍱 Món: ${itemCount} | ⭐ Đánh giá: ${reviewCount}`);
    console.log(`🛡️  Admin: ${admin.email} / Admin@123`);
    console.log('🧑‍🍳 Chủ quầy (mật khẩu chung Vendor@123):');
    STALLS.forEach((s) => console.log(`    - ${s.owner.email}  →  ${s.vendor.name}`));
    console.log('🎓 Sinh viên (đăng nhập bằng Google):');
    STUDENTS.forEach((s) => console.log(`    - ${s.email} | Ví: ${s.walletBalance.toLocaleString()}đ`));
    console.log('------------------------------------------');
    process.exit(0);
};

run().catch((err) => {
    console.error('❌ Lỗi seed:', err.message);
    process.exit(1);
});
