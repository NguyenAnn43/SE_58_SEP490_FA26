// scripts/migrateOrderApproval.js — Bổ sung trạng thái duyệt đơn & hoàn tiền cho ĐƠN CŨ
// Chạy:  node scripts/migrateOrderApproval.js            (DB trong MONGODB_URI của .env)
//        node scripts/migrateOrderApproval.js slothub      (chỉ định tên DB khác)
// An toàn khi chạy lại: chỉ cập nhật đơn CHƯA có trường approvalStatus / refundStatus.
const path = require('path');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '..', '.env'), quiet: true });

const dbName = process.argv[2];

const run = async () => {
    await mongoose.connect(process.env.MONGODB_URI, dbName ? { dbName } : {});
    const orders = mongoose.connection.db.collection('orders');
    console.log(`🗄️  DB: ${mongoose.connection.name}`);

    // Đơn đã vào bếp / đã giao trước khi có bước duyệt → coi như đã duyệt
    const approved = await orders.updateMany(
        { approvalStatus: { $exists: false }, status: { $in: ['Processing', 'Ready', 'Completed'] } },
        [{ $set: { approvalStatus: 'APPROVED', approvedAt: { $ifNull: ['$updatedAt', '$createdAt'] } } }]
    );
    // Đơn đang chờ / đã huỷ → chưa từng được duyệt
    const pending = await orders.updateMany(
        { approvalStatus: { $exists: false } },
        { $set: { approvalStatus: 'PENDING' } }
    );
    // Hoàn tiền: đơn đã hoàn (huỷ trước đây) → SUCCESS qua ví; còn lại → không cần hoàn
    const refunded = await orders.updateMany(
        { refundStatus: { $exists: false }, paymentStatus: { $in: ['Refunded', 'PartialRefunded'] } },
        { $set: { refundStatus: 'SUCCESS', refundMethod: 'WALLET' } }
    );
    const notRequired = await orders.updateMany(
        { refundStatus: { $exists: false } },
        { $set: { refundStatus: 'NOT_REQUIRED' } }
    );

    console.log(`✅ approvalStatus=APPROVED: ${approved.modifiedCount} đơn`);
    console.log(`✅ approvalStatus=PENDING : ${pending.modifiedCount} đơn`);
    console.log(`✅ refundStatus=SUCCESS   : ${refunded.modifiedCount} đơn`);
    console.log(`✅ refundStatus=NOT_REQUIRED: ${notRequired.modifiedCount} đơn`);
    await mongoose.disconnect();
};

run().catch((err) => {
    console.error('❌ Migration lỗi:', err.message);
    process.exit(1);
});
