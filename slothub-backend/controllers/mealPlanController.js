const mongoose = require('mongoose');
const MealPlan = require('../models/MealPlan');
const MealPlanSubscription = require('../models/MealPlanSubscription');
const MenuItem = require('../models/MenuItem');
const Vendor = require('../models/Vendor');
const svc = require('../utils/mealPlanService');
const R = require('../utils/mealPlanRules');

const isVendorRole = (role) => ['vendor', 'vendor_owner'].includes(role);

/** Bọc handler: lỗi nghiệp vụ (MealPlanError) → mã lỗi + thông báo; lỗi khác → 500 */
const handle = (fn) => async (req, res) => {
    try {
        await fn(req, res);
    } catch (err) {
        if (err instanceof svc.MealPlanError) return res.status(err.status).json({ message: err.message });
        console.error('[mealPlan]', err);
        res.status(500).json({ message: 'Lỗi xử lý gói ăn', error: err.message });
    }
};

/** Thông tin hiển thị kèm theo cho một gói đã mua */
const decorateSub = (sub, now = new Date()) => {
    const s = typeof sub.toObject === 'function' ? sub.toObject() : sub;
    const count = (st) => s.meals.filter((m) => m.status === st).length;
    return {
        ...s,
        summary: {
            ordered: count('ORDERED'),
            scheduled: count('SCHEDULED'),
            unscheduled: count('UNSCHEDULED'),
            refunded: count('REFUNDED') + count('FORFEITED'),
            freePostponesLeft: Math.max(0, s.freePostpones - s.postponesUsed),
            postponePenaltyPerMeal: Math.max(0, s.retailUnitPrice - s.unitPrice),
            earliestDate: R.earliestSchedulableDate(now),
            today: R.vnDateKey(now),
        },
        meals: s.meals.map((m) => ({
            ...m,
            canPostpone: s.status === 'ACTIVE' && m.status === 'SCHEDULED' && R.isSchedulable(m.date, now),
            postponeDeadline: m.status === 'SCHEDULED' && m.date ? R.cutoffFor(m.date) : null,
        })),
    };
};

// ======================= CÔNG KHAI / SINH VIÊN =======================

/** [GET] /api/meal-plans?vendorId= — gói đang mở bán + quy tắc */
const listPlans = handle(async (req, res) => {
    const plans = await svc.listPublicPlans({ vendorId: req.query.vendorId });
    res.json({
        plans,
        rules: {
            types: R.PLAN_TYPES,
            graceDays: R.GRACE_DAYS,
            cutoffHour: R.CUTOFF_HOUR,
            lateCancelDays: R.LATE_CANCEL_DAYS,
            lateRefundRate: R.LATE_REFUND_RATE,
            earliestDate: R.earliestSchedulableDate(new Date()),
        },
    });
});

const requireStudent = (req, res) => {
    if (req.user?.role !== 'student') {
        res.status(403).json({ message: 'Chỉ tài khoản sinh viên mới mua / quản lý gói ăn.' });
        return false;
    }
    return true;
};

/** [POST] /api/meal-plans/:id/subscribe */
const subscribe = handle(async (req, res) => {
    if (!requireStudent(req, res)) return;
    const { pickupSlotId, startDate, dates, agreeTerms, idempotencyKey } = req.body || {};
    const result = await svc.subscribe({
        userId: req.user._id, planId: req.params.id, pickupSlotId, startDate, dates, agreeTerms, idempotencyKey,
    });
    res.status(result.duplicate ? 200 : 201).json({
        message: result.duplicate ? 'Gói này đã được mua trước đó (không trừ tiền lần 2).' : 'Mua gói thành công!',
        duplicate: result.duplicate,
        balance: result.balance,
        subscription: decorateSub(result.subscription),
    });
});

/** [GET] /api/meal-plans/subscriptions/mine */
const mySubscriptions = handle(async (req, res) => {
    if (!requireStudent(req, res)) return;
    const subs = await MealPlanSubscription.find({ user: req.user._id }).sort({ status: 1, createdAt: -1 }).limit(50);
    const now = new Date();
    res.json(subs.map((s) => decorateSub(s, now)));
});

/** [POST] /api/meal-plans/subscriptions/:id/meals/:mealId/postpone  { newDate? } */
const postponeMeal = handle(async (req, res) => {
    if (!requireStudent(req, res)) return;
    const r = await svc.postponeMeal({
        userId: req.user._id, subId: req.params.id, mealId: req.params.mealId, newDate: req.body?.newDate || null,
    });
    const msg = r.toDate ? `Đã dời bữa ${r.fromDate} sang ${r.toDate}.` : `Đã dời bữa ${r.fromDate} — chọn ngày mới sau.`;
    res.json({
        message: r.penalty > 0 ? `${msg} Đã trừ ${r.penalty.toLocaleString('vi-VN')}đ (bữa này tính giá lẻ).` : `${msg} Còn ${r.freePostponesLeft} lượt dời miễn phí.`,
        penalty: r.penalty,
        subscription: decorateSub(r.subscription),
    });
});

/** [POST] /api/meal-plans/subscriptions/:id/meals/:mealId/schedule  { date } */
const scheduleMeal = handle(async (req, res) => {
    if (!requireStudent(req, res)) return;
    const r = await svc.scheduleMeal({ userId: req.user._id, subId: req.params.id, mealId: req.params.mealId, date: req.body?.date });
    res.json({ message: `Đã xếp bữa vào ngày ${req.body?.date}.`, subscription: decorateSub(r.subscription) });
});

/** [GET] /api/meal-plans/subscriptions/:id/cancel-preview */
const cancelPreview = handle(async (req, res) => {
    if (!requireStudent(req, res)) return;
    const r = await svc.previewCancel({ userId: req.user._id, subId: req.params.id });
    res.json({
        late: r.late, refund: r.refund, retained: r.retained, remainingMeals: r.remainingMeals, discountEnjoyed: r.discountEnjoyed,
        message: r.late
            ? `Gói còn dưới ${R.LATE_CANCEL_DAYS} ngày: mỗi bữa chưa dùng hoàn 50% giá gói.`
            : 'Hoàn các bữa chưa dùng, trừ lại phần chiết khấu đã hưởng ở các bữa đã ăn.',
    });
});

/** [POST] /api/meal-plans/subscriptions/:id/cancel */
const cancelSubscription = handle(async (req, res) => {
    if (!requireStudent(req, res)) return;
    const r = await svc.cancelSubscription({ userId: req.user._id, subId: req.params.id, req });
    res.json({ message: `Đã huỷ gói. Hoàn ${r.refund.toLocaleString('vi-VN')}đ vào ví SlotHub.`, refund: r.refund, subscription: decorateSub(r.subscription) });
});

// ======================= CHỦ QUẦY =======================

const getVendorOrFail = async (req, res) => {
    if (!isVendorRole(req.user?.role)) {
        res.status(403).json({ message: 'Chỉ chủ quầy mới quản lý gói ăn của quầy.' });
        return null;
    }
    const vendor = await Vendor.findOne({ owner: req.user._id });
    if (!vendor) {
        res.status(404).json({ message: 'Bạn chưa có gian hàng!' });
        return null;
    }
    return vendor;
};

/** [GET] /api/meal-plans/vendor/mine — gói của quầy + số người đang dùng */
const vendorPlans = handle(async (req, res) => {
    const vendor = await getVendorOrFail(req, res);
    if (!vendor) return;
    const plans = await MealPlan.find({ vendor: vendor._id }).populate('menuItem', 'name price imageUrl isAvailable').sort({ createdAt: -1 }).lean();
    const counts = await MealPlanSubscription.aggregate([
        { $match: { vendor: vendor._id, status: 'ACTIVE' } },
        { $group: { _id: '$plan', active: { $sum: 1 } } },
    ]);
    const byPlan = new Map(counts.map((c) => [String(c._id), c.active]));
    res.json(plans.map((p) => ({
        ...p,
        activeSubscribers: byPlan.get(String(p._id)) || 0,
        quote: p.menuItem ? R.quotePlan(p.type, p.menuItem.price) : null,
    })));
});

/** [POST] /api/meal-plans/vendor  { type, menuItemId, name?, description? } */
const vendorCreatePlan = handle(async (req, res) => {
    const vendor = await getVendorOrFail(req, res);
    if (!vendor) return;
    const { type, menuItemId, name, description } = req.body || {};
    const cfg = R.PLAN_TYPES[type];
    if (!cfg) return res.status(400).json({ message: 'Loại gói phải là "week" (gói tuần) hoặc "month" (gói tháng).' });
    if (!mongoose.isValidObjectId(menuItemId)) return res.status(400).json({ message: 'Vui lòng chọn món cho gói.' });
    const item = await MenuItem.findOne({ _id: menuItemId, vendor: vendor._id });
    if (!item) return res.status(404).json({ message: 'Món không thuộc quầy của bạn.' });
    try {
        const plan = await MealPlan.create({
            vendor: vendor._id, menuItem: item._id, type,
            name: String(name || '').trim() || `${cfg.label} ${item.name}`,
            description: String(description || '').slice(0, 500),
        });
        res.status(201).json({ message: 'Đã mở bán gói ăn!', plan: { ...plan.toObject(), quote: R.quotePlan(type, item.price) } });
    } catch (err) {
        if (err.code === 11000) return res.status(409).json({ message: `Quầy đã có ${cfg.label.toLowerCase()} cho món này.` });
        throw err;
    }
});

/** [PUT] /api/meal-plans/vendor/:id  { isActive?, name?, description? } — tắt bán không ảnh hưởng gói đã mua */
const vendorUpdatePlan = handle(async (req, res) => {
    const vendor = await getVendorOrFail(req, res);
    if (!vendor) return;
    if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: 'Mã gói không hợp lệ.' });
    const set = {};
    if (typeof req.body?.isActive === 'boolean') set.isActive = req.body.isActive;
    if (req.body?.name !== undefined) {
        const n = String(req.body.name).trim();
        if (!n) return res.status(400).json({ message: 'Tên gói không được để trống.' });
        set.name = n.slice(0, 120);
    }
    if (req.body?.description !== undefined) set.description = String(req.body.description).slice(0, 500);
    const plan = await MealPlan.findOneAndUpdate({ _id: req.params.id, vendor: vendor._id }, { $set: set }, { returnDocument: 'after' });
    if (!plan) return res.status(404).json({ message: 'Không tìm thấy gói của quầy bạn.' });
    res.json({ message: 'Đã cập nhật gói.', plan });
});

/** [GET] /api/meal-plans/vendor/schedule?days=7 — số suất gói cần chuẩn bị theo ngày */
const vendorSchedule = handle(async (req, res) => {
    const vendor = await getVendorOrFail(req, res);
    if (!vendor) return;
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 7, 1), 31);
    const today = R.vnDateKey(new Date());
    const until = R.addDays(today, days - 1);
    const rows = await MealPlanSubscription.aggregate([
        { $match: { vendor: vendor._id, status: 'ACTIVE' } },
        { $unwind: '$meals' },
        { $match: { 'meals.status': { $in: ['SCHEDULED', 'ORDERED'] }, 'meals.date': { $gte: today, $lte: until } } },
        { $group: { _id: { date: '$meals.date', item: '$menuItemName', slot: { $concat: ['$slotStart', ' - ', '$slotEnd'] } }, count: { $sum: 1 } } },
        { $sort: { '_id.date': 1, '_id.slot': 1 } },
    ]);
    const activeSubs = await MealPlanSubscription.countDocuments({ vendor: vendor._id, status: 'ACTIVE' });
    res.json({
        from: today, to: until, activeSubscriptions: activeSubs,
        rows: rows.map((r) => ({ date: r._id.date, menuItemName: r._id.item, slot: r._id.slot, count: r.count })),
    });
});

module.exports = {
    listPlans, subscribe, mySubscriptions, postponeMeal, scheduleMeal, cancelPreview, cancelSubscription,
    vendorPlans, vendorCreatePlan, vendorUpdatePlan, vendorSchedule, decorateSub,
};
