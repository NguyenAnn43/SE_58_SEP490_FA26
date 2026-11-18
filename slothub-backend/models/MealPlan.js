const mongoose = require('mongoose');

/**
 * Gói ăn do chủ quầy mở bán (gói tuần / gói tháng cho 1 món).
 * Số bữa, % giảm, số lần dời miễn phí lấy theo loại gói (utils/mealPlanRules.js → PLAN_TYPES);
 * giá tính từ giá lẻ hiện tại của món và được CHỐT vào đăng ký lúc sinh viên mua.
 */
const mealPlanSchema = new mongoose.Schema({
    vendor: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    type: { type: String, enum: ['week', 'month'], required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    description: { type: String, default: '', maxlength: 500 },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });

mealPlanSchema.index({ vendor: 1, menuItem: 1, type: 1 }, { unique: true });

module.exports = mongoose.model('MealPlan', mealPlanSchema);
