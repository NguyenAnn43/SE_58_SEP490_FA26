// scripts/copyDatabase.js — Chép TOÀN BỘ dữ liệu từ một MongoDB sang MongoDB khác
// (VD: DB demo trên máy → MongoDB Atlas của bản deploy). Dữ liệu đi thẳng giữa 2 DB, không lưu vào git.
//
// Chạy:
//   node scripts/copyDatabase.js --from="mongodb://127.0.0.1:27017/slothub_demo" --to="mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/slothub"
//   thêm --overwrite nếu DB đích đã có dữ liệu (sẽ XOÁ dữ liệu cũ ở DB đích trước khi chép)
//
// - Giữ nguyên _id → liên kết giữa các bảng (đơn ↔ quầy ↔ món ↔ người dùng) vẫn đúng.
// - Index (unique...) sẽ được backend tự tạo lại khi khởi động.
const mongoose = require('mongoose');

const arg = (name) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : '';
};
const FROM = arg('from');
const TO = arg('to');
const OVERWRITE = process.argv.includes('--overwrite');
const BATCH = 1000;

const hideCredentials = (uri) => uri.replace(/\/\/[^@/]*@/, '//***@');

(async () => {
  if (!FROM || !TO) {
    console.error('Thiếu tham số. VD: node scripts/copyDatabase.js --from="mongodb://127.0.0.1:27017/slothub_demo" --to="mongodb+srv://..."');
    process.exit(1);
  }
  if (FROM === TO) {
    console.error('--from và --to giống nhau, không chép.');
    process.exit(1);
  }

  const src = await mongoose.createConnection(FROM).asPromise();
  const dst = await mongoose.createConnection(TO).asPromise();
  console.log(`Nguồn: ${hideCredentials(FROM)} (${src.name})`);
  console.log(`Đích : ${hideCredentials(TO)} (${dst.name})`);

  const collections = (await src.db.listCollections({}, { nameOnly: true }).toArray())
    .map((c) => c.name)
    .filter((n) => !n.startsWith('system.'))
    .sort();

  // Chặn ghi đè nhầm: DB đích đã có dữ liệu mà không có --overwrite → dừng
  const existing = [];
  for (const name of collections) {
    const n = await dst.db.collection(name).estimatedDocumentCount();
    if (n > 0) existing.push(`${name} (${n})`);
  }
  if (existing.length && !OVERWRITE) {
    console.error(`DB đích đã có dữ liệu: ${existing.join(', ')}.\nThêm --overwrite để XOÁ dữ liệu cũ ở DB đích rồi chép lại.`);
    await Promise.all([src.close(), dst.close()]);
    process.exit(1);
  }

  let total = 0;
  for (const name of collections) {
    const target = dst.db.collection(name);
    if (OVERWRITE) await target.deleteMany({});
    let batch = [];
    let copied = 0;
    for await (const doc of src.db.collection(name).find()) {
      batch.push(doc);
      if (batch.length >= BATCH) {
        await target.insertMany(batch, { ordered: false });
        copied += batch.length;
        batch = [];
      }
    }
    if (batch.length) {
      await target.insertMany(batch, { ordered: false });
      copied += batch.length;
    }
    total += copied;
    console.log(`  ${name}: ${copied}`);
  }

  console.log(`\nĐã chép ${total} bản ghi trong ${collections.length} bảng.`);
  await Promise.all([src.close(), dst.close()]);
})().catch((err) => {
  console.error('Lỗi chép dữ liệu:', err.message);
  process.exit(1);
});
