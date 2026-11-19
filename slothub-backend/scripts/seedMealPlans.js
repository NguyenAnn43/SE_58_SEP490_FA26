// scripts/seedMealPlans.js — Tạo GÓI ĂN mẫu (tuần / tháng) cho mọi quầy: mỗi quầy tối đa 4 món đắt nhất còn bán.
//
// Chạy:   node scripts/seedMealPlans.js               → DB trong MONGODB_URI (.env), mặc định slothub_demo
//         node scripts/seedMealPlans.js --db=ten_db
//
// - Chạy lại không tạo trùng (upsert theo quầy + món + loại gói), không sửa gói quầy đã tự tạo / chỉnh.
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const mongoose = require("mongoose");
const Vendor = require("../models/Vendor");
const MenuItem = require("../models/MenuItem");
const MealPlan = require("../models/MealPlan");

const dbArg = process.argv.find((a) => a.startsWith("--db="));
const resolveUri = () => {
  const base = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/slothub_demo";
  if (!dbArg) return base;
  const u = new URL(base);
  u.pathname = "/" + dbArg.slice(5);
  return u.toString();
};

const DESC = {
  week: (n) => `Ăn ${n} 5 bữa trong tuần, trả trước một lần, rẻ hơn mua lẻ 5%.`,
  month: (n) => `Trọn tháng 20 bữa ${n}, tiết kiệm 12% so với mua lẻ, dời lịch linh hoạt.`,
};
// món 1: tuần, món 2: tháng, món 3: cả tuần + tháng, món 4: tuần
const TYPES = [['week'], ['month'], ['week', 'month'], ['week']];

(async () => {
  await mongoose.connect(resolveUri());
  const vendors = await Vendor.find({}).lean();
  let created = 0, skipped = 0;
  for (const v of vendors) {
    const items = await MenuItem.find({ vendor: v._id, isAvailable: { $ne: false } }).sort({ price: -1 }).limit(4).lean();
    const lines = [];
    for (let i = 0; i < items.length; i++) {
      for (const type of TYPES[i]) {
        const label = type === 'week' ? 'Gói tuần' : 'Gói tháng';
        const res = await MealPlan.updateOne(
          { vendor: v._id, menuItem: items[i]._id, type },
          { $setOnInsert: { name: `${label} ${items[i].name}`, description: DESC[type](items[i].name), isActive: true } },
          { upsert: true });
        res.upsertedCount ? created++ : skipped++;
        lines.push(`${label} ${items[i].name}`);
      }
    }
    const total = await MealPlan.distinct('menuItem', { vendor: v._id, isActive: true });
    console.log(`${v.name} (${items.length} món khả dụng) -> ${total.length} món có gói: ${lines.join(' | ')}`);
  }
  console.log(`\nTạo mới ${created}, đã có sẵn ${skipped}. Tổng gói: ${await MealPlan.countDocuments()}`);
  await mongoose.disconnect();
})().catch((e) => { console.error(e); process.exit(1); });
