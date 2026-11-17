// scripts/seedDemoActivity.js — Thêm DỮ LIỆU DEMO: quầy + món mới, sinh viên mẫu, ~12 tuần lượt mua, đánh giá.
//
// Chạy:   node scripts/seedDemoActivity.js            → DB trong MONGODB_URI (.env), mặc định slothub_demo
//         node scripts/seedDemoActivity.js --remove   → gỡ toàn bộ dữ liệu demo do script này tạo
//         node scripts/seedDemoActivity.js --db=ten_db
//
// - KHÔNG xoá dữ liệu thật: mọi bản ghi do script tạo đều có cờ demoSeed: true; chạy lại sẽ gỡ bản cũ trước.
// - Đơn mẫu đi đúng các trạng thái của hệ thống (đã thanh toán + đã duyệt → Hoàn thành; một ít Huỷ / Từ chối)
//   để trang Thống kê & Dự báo, Top món, đánh giá và chatbot có dữ liệu.
// - Không cộng/trừ ví (chỉ là lịch sử để demo thống kê).
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const args = process.argv.slice(2);
const REMOVE_ONLY = args.includes('--remove');
const dbArg = (args.find((a) => a.startsWith('--db=')) || '').slice(5);
const WEEKS = 12;
const SEED_FLAG = { demoSeed: true };

// ---------- Ngẫu nhiên cố định (chạy lại ra cùng dữ liệu) ----------
let seed = 20261020;
const rand = () => {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const randInt = (a, b) => a + Math.floor(rand() * (b - a + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const poisson = (lambda) => { // số đơn/ngày
    const L = Math.exp(-lambda); let k = 0; let p = 1;
    do { k++; p *= rand(); } while (p > L);
    return k - 1;
};
const weightedPick = (items, weightOf) => {
    const total = items.reduce((s, i) => s + weightOf(i), 0);
    let r = rand() * total;
    for (const i of items) { r -= weightOf(i); if (r <= 0) return i; }
    return items[items.length - 1];
};

// ---------- Ảnh thật (Wikimedia Commons) cho món mới ----------
const IMAGE_MAP = {
  'Salad Ức Gà': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e7/Chicken_breast_with_salad_of_mixed_greens%2C_tomato%2C_bell_peppers%2C_and_green_olives_-_Massachusetts.jpg/960px-Chicken_breast_with_salad_of_mixed_greens%2C_tomato%2C_bell_peppers%2C_and_green_olives_-_Massachusetts.jpg',
  'Cơm Gạo Lứt Cá Hồi': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f9/Poke_Bowl_at_Churutto.jpg/960px-Poke_Bowl_at_Churutto.jpg',
  'Bowl Bò Áp Chảo': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/93/Rice_Bowl_Beef_Belly_Don.jpg/960px-Rice_Bowl_Beef_Belly_Don.jpg',
  'Sữa Chua Granola': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/7/72/Granola_and_Yogurt.jpg/960px-Granola_and_Yogurt.jpg',
  'Nước Ép Cần Tây': 'https://upload.wikimedia.org/wikipedia/commons/9/97/Celery_juice.jpg',
  'Cơm Chay Thập Cẩm': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/94/House_Special_Tofu_%26_Mushroom_-_The_Big_Bowl_2023-10-25.jpg/960px-House_Special_Tofu_%26_Mushroom_-_The_Big_Bowl_2023-10-25.jpg',
  'Bún Riêu Chay': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/98/Bun_rieu_with_herbs.jpg/960px-Bun_rieu_with_herbs.jpg',
  'Đậu Hũ Sốt Cà': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/f/f1/Tomato-sauced_tofu.jpg/960px-Tomato-sauced_tofu.jpg',
  'Chả Giò Chay': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/b/bb/Ch%E1%BA%A3_gi%C3%B2_%28Vietnamese_Spring_Rolls%29_-_12.jpg/960px-Ch%E1%BA%A3_gi%C3%B2_%28Vietnamese_Spring_Rolls%29_-_12.jpg',
  'Canh Rau Củ': 'https://upload.wikimedia.org/wikipedia/commons/a/a1/VegetableClearSoup_HomeMade_Mumbai.jpg',
  'Hủ Tiếu Nam Vang': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/6b/H%E1%BB%A7_ti%E1%BA%BFu_Nam_vang_gi%C3%B2.jpg/960px-H%E1%BB%A7_ti%E1%BA%BFu_Nam_vang_gi%C3%B2.jpg',
  'Mì Vịt Tiềm': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/cc/M%C3%AC_v%E1%BB%8Bt_ti%E1%BB%81m.jpg/960px-M%C3%AC_v%E1%BB%8Bt_ti%E1%BB%81m.jpg',
  'Mì Xào Bò': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/14/Beef_Stir-fried_Noodles_-_Frank%27s_Noodle_House.jpg/960px-Beef_Stir-fried_Noodles_-_Frank%27s_Noodle_House.jpg',
  'Hoành Thánh Chiên': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/48/Deep-fried_wontons.jpg/960px-Deep-fried_wontons.jpg',
  'Sủi Cảo': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/65/S%E1%BB%A7i_c%E1%BA%A3o_%E6%B0%B4%E9%A4%83_t%E1%BA%A1i_Qu%E1%BA%A3ng_Ch%C3%A2u_%E5%BB%A3%E5%B7%9E_%282019%29_%E2%80%93_1.jpg/960px-S%E1%BB%A7i_c%E1%BA%A3o_%E6%B0%B4%E9%A4%83_t%E1%BA%A1i_Qu%E1%BA%A3ng_Ch%C3%A2u_%E5%BB%A3%E5%B7%9E_%282019%29_%E2%80%93_1.jpg',
  'Gà Rán Giòn': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/2/2c/Fried-Chicken-Set.jpg/960px-Fried-Chicken-Set.jpg',
  'Burger Bò Phô Mai': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/4/4d/Cheeseburger.jpg/960px-Cheeseburger.jpg',
  'Khoai Lang Lắc Phô Mai': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a2/Sweet_Potato_Fries_3.jpg/960px-Sweet_Potato_Fries_3.jpg',
  'Mì Ý Sốt Bò Bằm': 'https://upload.wikimedia.org/wikipedia/commons/8/83/Spaghetti_Bolognese.jpg',
  'Trà Chanh Mật Ong': 'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c1/Sweet_iced_lemon_tea_with_honey.jpg/960px-Sweet_iced_lemon_tea_with_honey.jpg',
};

// ---------- Quầy + món mới ----------
const NEW_STALLS = [
    {
        owner: { name: 'Lý Thanh Xanh', email: 'healthy@slothub.vn' },
        vendor: { name: 'Healthy Bowl Xanh', description: 'Bữa ăn healthy giàu đạm, ít dầu mỡ cho sinh viên', openTime: '07:00', closeTime: '20:00', category: 'Combo' },
        demand: 5,
        items: [
            { name: 'Salad Ức Gà', price: 45000, calories: 320, protein: 35, carbs: 12, fat: 12, category: 'Combo', description: 'Ức gà áp chảo, rau trộn, sốt mè rang' },
            { name: 'Cơm Gạo Lứt Cá Hồi', price: 65000, calories: 520, protein: 32, carbs: 55, fat: 18, category: 'Cơm', description: 'Cá hồi áp chảo, gạo lứt, rong biển, rau củ' },
            { name: 'Bowl Bò Áp Chảo', price: 55000, calories: 580, protein: 38, carbs: 50, fat: 22, category: 'Cơm', description: 'Bò áp chảo, trứng lòng đào, cơm, salad' },
            { name: 'Sữa Chua Granola', price: 30000, calories: 280, protein: 12, carbs: 40, fat: 8, category: 'Tráng miệng', description: 'Sữa chua Hy Lạp, granola, trái cây tươi' },
            { name: 'Nước Ép Cần Tây', price: 28000, calories: 70, protein: 2, carbs: 15, fat: 0, category: 'Đồ uống', description: 'Cần tây, táo xanh, không đường' },
        ],
    },
    {
        owner: { name: 'Thích Thị An', email: 'chay@slothub.vn' },
        vendor: { name: 'Bếp Chay An Nhiên', description: 'Món chay thanh đạm, nấu mới mỗi ngày', openTime: '06:30', closeTime: '14:30', category: 'Cơm' },
        demand: 3,
        items: [
            { name: 'Cơm Chay Thập Cẩm', price: 35000, calories: 480, protein: 16, carbs: 70, fat: 12, category: 'Cơm', description: 'Đậu hũ, nấm, rau củ xào, cơm trắng' },
            { name: 'Bún Riêu Chay', price: 35000, calories: 420, protein: 14, carbs: 65, fat: 10, category: 'Bún/Phở', description: 'Riêu đậu hũ, cà chua, rau sống' },
            { name: 'Đậu Hũ Sốt Cà', price: 30000, calories: 350, protein: 18, carbs: 30, fat: 16, category: 'Cơm', description: 'Đậu hũ non sốt cà chua, ăn kèm cơm' },
            { name: 'Chả Giò Chay', price: 25000, calories: 320, protein: 8, carbs: 35, fat: 16, category: 'Đồ ăn vặt', description: '5 cuốn, nhân khoai môn & nấm' },
            { name: 'Canh Rau Củ', price: 15000, calories: 90, protein: 4, carbs: 14, fat: 2, category: 'Combo', description: 'Canh rau củ thanh mát' },
        ],
    },
    {
        owner: { name: 'Quách Văn Vang', email: 'hutieu@slothub.vn' },
        vendor: { name: 'Mì & Hủ Tiếu Nam Vang', description: 'Hủ tiếu, mì nước, mì xào đậm vị', openTime: '06:00', closeTime: '21:00', category: 'Bún/Phở' },
        demand: 6,
        items: [
            { name: 'Hủ Tiếu Nam Vang', price: 45000, calories: 520, protein: 28, carbs: 60, fat: 16, category: 'Bún/Phở', description: 'Tôm, thịt bằm, gan, trứng cút' },
            { name: 'Mì Vịt Tiềm', price: 55000, calories: 650, protein: 34, carbs: 62, fat: 28, category: 'Bún/Phở', description: 'Đùi vịt tiềm thuốc bắc, mì trứng' },
            { name: 'Mì Xào Bò', price: 45000, calories: 680, protein: 30, carbs: 70, fat: 30, category: 'Bún/Phở', description: 'Mì xào giòn, bò mềm, cải ngọt' },
            { name: 'Hoành Thánh Chiên', price: 30000, calories: 420, protein: 14, carbs: 38, fat: 24, category: 'Đồ ăn vặt', description: '8 viên, sốt chua ngọt' },
            { name: 'Sủi Cảo', price: 35000, calories: 380, protein: 18, carbs: 40, fat: 14, category: 'Đồ ăn vặt', description: '6 viên nhân tôm thịt, nước dùng' },
        ],
    },
    {
        owner: { name: 'Trương Minh Giòn', email: 'garan@slothub.vn' },
        vendor: { name: 'Gà Rán & Burger Campus', description: 'Gà rán giòn, burger, mì Ý cho bữa no nê', openTime: '10:00', closeTime: '22:00', category: 'Đồ ăn vặt' },
        demand: 7,
        items: [
            { name: 'Gà Rán Giòn', price: 45000, calories: 720, protein: 40, carbs: 30, fat: 45, category: 'Combo', description: '2 miếng gà rán + 1 phần cơm' },
            { name: 'Burger Bò Phô Mai', price: 49000, calories: 650, protein: 30, carbs: 45, fat: 35, category: 'Đồ ăn vặt', description: 'Bò nướng, phô mai cheddar, rau tươi' },
            { name: 'Khoai Lang Lắc Phô Mai', price: 29000, calories: 400, protein: 5, carbs: 55, fat: 18, category: 'Đồ ăn vặt', description: 'Khoai lang chiên lắc bột phô mai' },
            { name: 'Mì Ý Sốt Bò Bằm', price: 49000, calories: 620, protein: 26, carbs: 80, fat: 20, category: 'Combo', description: 'Spaghetti sốt bò bằm cà chua' },
            { name: 'Trà Chanh Mật Ong', price: 20000, calories: 120, protein: 0, carbs: 30, fat: 0, category: 'Đồ uống', description: 'Chanh tươi, mật ong rừng' },
        ],
    },
];
// Mức cầu cơ bản cho các quầy có sẵn (đơn/ngày thường)
const EXISTING_DEMAND = {
    'Cơm Tấm Sài Gòn': 7, 'Phở Hà Nội 1990': 5, 'Bún Bò Huế O Xuân': 4, 'SlotTea - Trà Sữa & Cà Phê': 8,
    'Bánh Mì Hội An': 5, 'Ăn Vặt Cô Ba': 4, 'Chè & Tráng Miệng Ngọt Ngào': 3,
};

const STUDENTS = [
    'Nguyễn Hoàng Minh', 'Trần Thảo Vy', 'Lê Quốc Bảo', 'Phạm Ngọc Anh', 'Võ Đức Huy', 'Đặng Khánh Linh', 'Bùi Gia Hân',
    'Hoàng Tuấn Kiệt', 'Ngô Mai Phương', 'Đỗ Thành Đạt', 'Huỳnh Bảo Trâm', 'Phan Nhật Nam', 'Vũ Thu Trang', 'Lâm Hải Đăng', 'Tạ Quỳnh Như',
];

const REVIEW_TEXT = {
    5: ['Ngon xuất sắc, sẽ quay lại!', 'Đồ ăn nóng, lấy món nhanh, không phải xếp hàng 👍', 'Phần ăn đầy đặn, đáng tiền', 'Quá ngon, món tủ của mình luôn', 'Ăn trưa nhanh gọn, rất hài lòng'],
    4: ['Ngon, giá hợp lý cho sinh viên', 'Ổn áp, lần sau gọi tiếp', 'Vị ngon, có điều hơi đông giờ cao điểm', 'Khá ngon, đóng gói sạch sẽ'],
    3: ['Tạm ổn, hơi mặn một chút', 'Bình thường, không có gì đặc biệt', 'Phần hơi ít so với giá'],
    2: ['Hơi nguội khi nhận', 'Chưa hợp khẩu vị lắm'],
};

const SLOTS = [
    ['10:00', '10:30'], ['10:30', '11:00'], ['11:00', '11:30'], ['11:30', '12:00'], ['12:00', '12:30'], ['17:00', '17:30'], ['17:30', '18:00'],
];

const toMin = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const VN = 7 * 3600e3;
const DAY = 864e5;

// ===================================================================

const removeDemo = async (db) => {
    const cols = ['orders', 'menuitemreviews', 'reviews', 'menuitems', 'vendors', 'users', 'orderstatuslogs'];
    for (const c of cols) {
        const r = await db.collection(c).deleteMany(SEED_FLAG);
        if (r.deletedCount) console.log(`🧹 Gỡ ${r.deletedCount} bản ghi demo trong ${c}`);
    }
};

/** Tính lại điểm đánh giá, số lượt, danh sách review nhúng và số đã bán của mọi món từ dữ liệu thật + demo */
const recomputeItemStats = async (db) => {
    const reviewAgg = await db.collection('menuitemreviews').aggregate([
        { $sort: { createdAt: -1 } },
        { $group: { _id: '$menuItem', avg: { $avg: '$rating' }, n: { $sum: 1 }, latest: { $push: { user: '$user', name: '$name', avatar: '$avatar', rating: '$rating', comment: '$comment', createdAt: '$createdAt', updatedAt: '$updatedAt' } } } },
    ]).toArray();
    const soldAgg = await db.collection('orders').aggregate([
        { $match: { status: 'Completed' } },
        { $unwind: '$items' },
        { $group: { _id: '$items.menuItem', sold: { $sum: '$items.quantity' } } },
    ]).toArray();
    const reviewMap = new Map(reviewAgg.map((r) => [String(r._id), r]));
    const soldMap = new Map(soldAgg.map((s) => [String(s._id), s.sold]));
    const items = await db.collection('menuitems').find({}, { projection: { _id: 1 } }).toArray();
    for (const it of items) {
        const r = reviewMap.get(String(it._id));
        await db.collection('menuitems').updateOne({ _id: it._id }, {
            $set: {
                rating: r ? Math.round(r.avg * 10) / 10 : 0,
                numReviews: r ? r.n : 0,
                reviews: r ? r.latest.slice(0, 20).reverse() : [],
                totalSold: soldMap.get(String(it._id)) || 0,
            },
        });
    }
};

const run = async () => {
    await mongoose.connect(process.env.MONGODB_URI, dbArg ? { dbName: dbArg } : {});
    const db = mongoose.connection.db;
    console.log(`🗄️  DB: ${mongoose.connection.name}`);

    await removeDemo(db);
    if (REMOVE_ONLY) {
        await recomputeItemStats(db);
        console.log('✅ Đã gỡ dữ liệu demo và tính lại đánh giá / số đã bán.');
        return mongoose.disconnect();
    }

    const now = new Date();
    const vendorPass = await bcrypt.hash('Vendor@123', 10);

    // 1) Quầy + món mới
    for (const stall of NEW_STALLS) {
        const exists = await db.collection('users').findOne({ email: stall.owner.email });
        if (exists) { console.log(`⏭️  Bỏ qua ${stall.owner.email} (tài khoản đã tồn tại, không phải demo)`); continue; }
        const owner = await db.collection('users').insertOne({
            ...stall.owner, password: vendorPass, role: 'vendor_owner', isApproved: true, isActive: true,
            walletBalance: 0, bankAccount: { bankName: '', accountNumber: '', accountName: '' }, avatar: '', phone: '', googleId: '', studentId: '',
            createdAt: now, updatedAt: now, ...SEED_FLAG,
        });
        const vendor = await db.collection('vendors').insertOne({
            ...stall.vendor, owner: owner.insertedId, imageUrl: IMAGE_MAP[stall.items[0].name] || '',
            isActive: true, isPaused: false, pauseReason: '', pausedAt: null, pausedUntil: null,
            createdAt: now, updatedAt: now, ...SEED_FLAG,
        });
        await db.collection('menuitems').insertMany(stall.items.map((it) => ({
            ...it, vendor: vendor.insertedId, imageUrl: IMAGE_MAP[it.name] || '', isAvailable: true,
            countInStock: 60, dailyQuota: 100, totalSold: 0, reviews: [], rating: 0, numReviews: 0,
            createdAt: now, updatedAt: now, ...SEED_FLAG,
        })));
        EXISTING_DEMAND[stall.vendor.name] = stall.demand;
        console.log(`🏪 Thêm quầy ${stall.vendor.name} (${stall.items.length} món) — ${stall.owner.email} / Vendor@123`);
    }

    // 2) Sinh viên mẫu (đăng nhập thật bằng Google; đây chỉ là tài khoản dữ liệu)
    const studentDocs = STUDENTS.map((name, i) => ({
        name, email: `sv${String(i + 1).padStart(2, '0')}@student.slothub.vn`, role: 'student', isActive: true, isApproved: true,
        walletBalance: 500000, studentId: `SE18${String(1000 + i * 37).slice(-4)}`, avatar: '', phone: '', googleId: '',
        bankAccount: { bankName: '', accountNumber: '', accountName: '' }, createdAt: new Date(now - WEEKS * 7 * DAY), updatedAt: now, ...SEED_FLAG,
    }));
    await db.collection('users').insertMany(studentDocs);
    const students = await db.collection('users').find({ ...SEED_FLAG, role: 'student' }).toArray();
    console.log(`🎓 Thêm ${students.length} sinh viên mẫu (sv01..sv15@student.slothub.vn)`);

    // 3) Lượt mua ~12 tuần: mỗi món có xu hướng riêng (tăng / giảm / ổn định)
    const vendors = await db.collection('vendors').find({ name: { $in: Object.keys(EXISTING_DEMAND) } }).toArray();
    const allItems = await db.collection('menuitems').find({ vendor: { $in: vendors.map((v) => v._id) }, isAvailable: true }).toArray();
    const itemTrend = new Map(allItems.map((it) => [String(it._id), { base: 0.5 + rand() * 1.5, trend: -0.6 + rand() * 1.4 }]));
    const orders = [];
    const startDay = Math.floor((now.getTime() + VN) / DAY) - WEEKS * 7; // ngày (giờ VN)
    const todayIdx = Math.floor((now.getTime() + VN) / DAY);

    for (let d = startDay; d < todayIdx; d++) {
        const dow = new Date(d * DAY).getUTCDay(); // 0=CN
        const dayFactor = dow === 0 ? 0.25 : dow === 6 ? 0.5 : 1;
        const progress = (d - startDay) / (todayIdx - startDay); // 0 → 1 theo thời gian
        for (const v of vendors) {
            const items = allItems.filter((it) => String(it.vendor) === String(v._id));
            if (!items.length) continue;
            const growth = 0.85 + progress * 0.3; // cả hệ thống tăng nhẹ theo thời gian
            const nOrders = poisson((EXISTING_DEMAND[v.name] || 3) * dayFactor * growth);
            const open = toMin(v.openTime || '07:00');
            const close = toMin(v.closeTime || '21:00');
            const slots = SLOTS.filter(([s, e]) => toMin(s) >= open && toMin(e) <= close);
            if (!slots.length) continue;
            for (let k = 0; k < nOrders; k++) {
                const weightOf = (it) => {
                    const t = itemTrend.get(String(it._id));
                    return Math.max(0.05, t.base * (1 + t.trend * progress));
                };
                const lines = new Map();
                const nLines = rand() < 0.3 ? 2 : 1;
                for (let l = 0; l < nLines; l++) {
                    const it = weightedPick(items, weightOf);
                    const q = rand() < 0.15 ? 2 : 1;
                    lines.set(String(it._id), { it, q: (lines.get(String(it._id))?.q || 0) + q });
                }
                const orderItems = [...lines.values()].map(({ it, q }) => ({
                    menuItem: it._id, quantity: q, price: it.price, ...(it.calories != null && { calories: it.calories }),
                }));
                const total = orderItems.reduce((s, i) => s + i.price * i.quantity, 0);
                const [s, e] = pick(slots);
                const pickupStart = d * DAY - VN + toMin(s) * 60e3;
                const created = new Date(pickupStart - randInt(20, 180) * 60e3);
                const student = pick(students);
                const r = rand();
                const status = r < 0.04 ? 'Cancelled' : r < 0.07 ? 'Rejected' : 'Completed';
                const base = {
                    user: student._id, vendor: v._id, items: orderItems, totalPrice: total, discountAmount: 0, voucherCode: '', voucherId: null,
                    note: '', deliveryType: 'pickup', pickupSlot: `${s} - ${e}`, pickupSlotId: null,
                    pickupSlotStartAt: new Date(pickupStart), pickupSlotEndAt: new Date(d * DAY - VN + toMin(e) * 60e3), pickupDay: 'today',
                    paymentMethod: rand() < 0.75 ? 'wallet' : 'payos', otpCode: String(randInt(1000, 9999)),
                    pickupCodeIssuedAt: created, pickupCodeExpiresAt: new Date(d * DAY - VN + toMin(e) * 60e3 + 30 * 60e3),
                    createdAt: created, updatedAt: new Date(pickupStart + 20 * 60e3), ...SEED_FLAG,
                };
                if (status === 'Completed') {
                    orders.push({ ...base, status, paymentStatus: 'Paid', approvalStatus: 'APPROVED', approvedAt: new Date(created.getTime() + 5 * 60e3), refundStatus: 'NOT_REQUIRED' });
                } else if (status === 'Rejected') {
                    orders.push({
                        ...base, status, paymentStatus: 'Refunded', approvalStatus: 'REJECTED', rejectedAt: new Date(created.getTime() + 8 * 60e3),
                        rejectReason: pick(['Hết món / hết nguyên liệu', 'Quá tải đơn', 'Không kịp chuẩn bị trong khung giờ']),
                        refundStatus: 'SUCCESS', refundMethod: 'WALLET', refundAmount: total, refundPercent: 100, refundedAt: new Date(created.getTime() + 8 * 60e3),
                    });
                } else {
                    orders.push({
                        ...base, status, paymentStatus: 'Refunded', approvalStatus: 'PENDING', cancelledBy: 'student', cancelledAt: new Date(created.getTime() + 10 * 60e3),
                        cancelReason: 'Đổi kế hoạch', refundStatus: 'SUCCESS', refundMethod: 'WALLET', refundAmount: total, refundPercent: 100,
                    });
                }
            }
        }
    }
    if (orders.length) await db.collection('orders').insertMany(orders);
    const completed = orders.filter((o) => o.status === 'Completed');
    console.log(`🧾 Thêm ${orders.length} đơn (${completed.length} hoàn thành, ${orders.filter((o) => o.status === 'Rejected').length} bị từ chối, ${orders.filter((o) => o.status === 'Cancelled').length} đã huỷ) trong ${WEEKS} tuần`);

    // 4) Đánh giá món + quầy từ sinh viên đã nhận món (mỗi SV đánh giá 1 món tối đa 1 lần)
    const reviewed = new Set((await db.collection('menuitemreviews').find({}, { projection: { menuItem: 1, user: 1 } }).toArray())
        .map((r) => `${r.menuItem}:${r.user}`));
    const itemQuality = new Map(allItems.map((it) => [String(it._id), 3.6 + rand() * 1.3])); // món "ngon" hơn được chấm cao hơn
    const studentById = new Map(students.map((s) => [String(s._id), s]));
    const itemReviews = [];
    const vendorReviews = [];
    const vendorReviewed = new Set();
    for (const o of completed) {
        if (rand() > 0.3) continue;
        for (const line of o.items) {
            const key = `${line.menuItem}:${o.user}`;
            if (reviewed.has(key)) continue;
            reviewed.add(key);
            const q = itemQuality.get(String(line.menuItem)) || 4.2;
            const rating = Math.max(2, Math.min(5, Math.round(q + (rand() - 0.5) * 1.6)));
            const st = studentById.get(String(o.user));
            const at = new Date(o.updatedAt.getTime() + randInt(10, 240) * 60e3);
            itemReviews.push({
                menuItem: line.menuItem, vendor: o.vendor, user: o.user, order: null, name: st?.name || 'Sinh viên', avatar: '',
                rating, comment: pick(REVIEW_TEXT[rating] || REVIEW_TEXT[4]), createdAt: at, updatedAt: at, ...SEED_FLAG,
            });
            const vKey = `${o.vendor}:${o.user}`;
            if (!vendorReviewed.has(vKey) && rand() < 0.4) {
                vendorReviewed.add(vKey);
                vendorReviews.push({ vendorId: o.vendor, user: o.user, rating, comment: pick(REVIEW_TEXT[rating] || REVIEW_TEXT[4]), images: [], createdAt: at, updatedAt: at, ...SEED_FLAG });
            }
        }
    }
    if (itemReviews.length) await db.collection('menuitemreviews').insertMany(itemReviews, { ordered: false }).catch((e) => console.log('⚠️ Một số review trùng bị bỏ qua:', e.code));
    if (vendorReviews.length) await db.collection('reviews').insertMany(vendorReviews);
    console.log(`⭐ Thêm ${itemReviews.length} đánh giá món + ${vendorReviews.length} đánh giá quầy`);

    // 5) Tính lại rating / numReviews / review nhúng / totalSold cho mọi món
    await recomputeItemStats(db);
    const top = await db.collection('menuitems').find({ numReviews: { $gt: 0 } }).sort({ totalSold: -1 }).limit(5).toArray();
    console.log('🏆 Top bán chạy:', top.map((t) => `${t.name} (${t.totalSold} phần, ${t.rating}★/${t.numReviews})`).join(' · '));
    console.log('✅ Xong. Gỡ dữ liệu demo: node scripts/seedDemoActivity.js --remove');
    await mongoose.disconnect();
};

run().catch((err) => {
    console.error('❌ Lỗi seed:', err.message);
    process.exit(1);
});
