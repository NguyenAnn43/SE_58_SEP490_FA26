const mongoose = require('mongoose');

/**
 * Sinh viên mua một gói ăn. Mọi thông số giá / quy tắc được CHỐT tại lúc mua (snapshot),
 * quầy đổi giá món hay hệ thống đổi quy tắc sau đó không ảnh hưởng gói đã mua.
 *
 * Trạng thái bữa:
 *  SCHEDULED   — đã chọn ngày, chờ đến ngày ăn
 *  UNSCHEDULED — chưa chọn ngày (dời "để sau" hoặc quầy nghỉ mà không còn ngày dời)
 *  ORDERED     — đã tạo đơn nhận món vào ngày ăn (tiền bữa đã chuyển cho quầy)
 *  REFUNDED    — hoàn 100% (do quầy / hệ thống)
 *  FORFEITED   — đóng gói khi chưa dùng: hoàn một phần, phần còn lại thuộc quầy
 */
const MEAL_STATUSES = ['SCHEDULED', 'UNSCHEDULED', 'ORDERED', 'REFUNDED', 'FORFEITED'];

const mealSchema = new mongoose.Schema({
    date: { type: String, default: null }, // 'YYYY-MM-DD' (giờ VN); null khi UNSCHEDULED
    status: { type: String, enum: MEAL_STATUSES, default: 'SCHEDULED' },
    order: { type: mongoose.Schema.Types.ObjectId, ref: 'Order', default: null },
    penalty: { type: Number, default: 0, min: 0 },       // tiền trả thêm vì mất chiết khấu
    discountLost: { type: Boolean, default: false },
    vendorSkipped: { type: Boolean, default: false },    // không còn ngày dời vì quầy nghỉ → hoàn 100%
    postponeCount: { type: Number, default: 0 },
    autoMovedCount: { type: Number, default: 0 },        // số lần hệ thống tự dời vì quầy nghỉ
    refundAmount: { type: Number, default: 0 },
    closedAt: { type: Date, default: null },
}, { _id: true });

const mealPlanSubscriptionSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'MealPlan', required: true },
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },

    // ---- Snapshot lúc mua ----
    planType: { type: String, enum: ['week', 'month'], required: true },
    planName: { type: String, required: true },
    menuItemName: { type: String, default: '' },
    vendorName: { type: String, default: '' },
    mealsCount: { type: Number, required: true },
    discountPercent: { type: Number, required: true },
    freePostpones: { type: Number, required: true },
    retailUnitPrice: { type: Number, required: true },
    unitPrice: { type: Number, required: true },
    totalPaid: { type: Number, required: true },

    // ---- Nhận món ----
    pickupSlot: { type: mongoose.Schema.Types.ObjectId, ref: 'TimeSlot', required: true },
    slotStart: { type: String, required: true },
    slotEnd: { type: String, required: true },

    // ---- Thời hạn (giờ VN) ----
    validFrom: { type: String, required: true },
    validUntil: { type: String, required: true },
    finalDate: { type: String, required: true, index: true }, // validUntil + 7 ngày (hạn dời cuối)

    meals: { type: [mealSchema], default: [] },

    postponesUsed: { type: Number, default: 0 },
    penaltyTotal: { type: Number, default: 0 },
    refundTotal: { type: Number, default: 0 },
    vendorRetained: { type: Number, default: 0 },

    status: { type: String, enum: ['ACTIVE', 'COMPLETED', 'EXPIRED', 'CANCELLED'], default: 'ACTIVE', index: true },
    closedAt: { type: Date, default: null },
    termsAcceptedAt: { type: Date, required: true },
    remindersSent: { type: [String], default: [] }, // VD 'd3', 'd1'
    idempotencyKey: { type: String, default: undefined },
}, { timestamps: true, optimisticConcurrency: true });

mealPlanSubscriptionSchema.index(
    { user: 1, idempotencyKey: 1 },
    { unique: true, partialFilterExpression: { idempotencyKey: { $type: 'string' } } }
);
mealPlanSubscriptionSchema.index({ status: 1, 'meals.status': 1, 'meals.date': 1 });

module.exports = mongoose.model('MealPlanSubscription', mealPlanSubscriptionSchema);
module.exports.MEAL_STATUSES = MEAL_STATUSES;
