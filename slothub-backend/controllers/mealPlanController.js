const mongoose = require('mongoose');
const MealPlan = require('../models/MealPlan');
const MealPlanSubscription = require('../models/MealPlanSubscription');
const MenuItem = require('../models/MenuItem');
const Vendor = require('../models/Vendor');
const Order = require('../models/Order');
const svc = require('../utils/mealPlanService');
const R = require('../utils/mealPlanRules');
const { emailPlan, emailMealPickup, fmtDate } = require('../utils/mealPlanEmail');
const { logOrderStatus, notifyStudent } = require('../utils/persistence');
const { notifyVendorMealPlan } = require('../utils/vendorNotify');

const studentName = (req) => req.user?.name || req.user?.email || 'Sinh viên';
/** Lịch ăn ngắn gọn cho thông báo quầy: "T6 20/11, T7 21/11 (+3 chưa chọn ngày)" */
const shortSchedule = (sub) => {
    const dated = sub.meals.filter((m) => m.status === 'SCHEDULED' && m.date).map((m) => m.date).sort();
    const un = sub.meals.filter((m) => m.status === 'UNSCHEDULED').length;
    return `${dated.length ? dated.map(fmtDate).join(', ') : 'chưa có ngày'}${un ? ` (+${un} bữa chưa chọn ngày)` : ''}`;
};

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
    if (!result.duplicate) {
        const s = result.subscription;
        emailPlan('subscribe', s, {}, req.user);
        notifyVendorMealPlan(req, s, {
            title: 'Gói ăn mới',
            message: `${studentName(req)} mua ${s.planName} (${s.mealsCount} bữa, nhận ${s.slotStart} – ${s.slotEnd}). Lịch: ${shortSchedule(s)}`,
        });
    }
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
    emailPlan('postpone', r.subscription, { fromDate: r.fromDate, toDate: r.toDate, penalty: r.penalty }, req.user);
    notifyVendorMealPlan(req, r.subscription, {
        title: 'Dời bữa gói',
        message: `${studentName(req)} dời bữa ${r.subscription.menuItemName} ngày ${fmtDate(r.fromDate)}${r.toDate ? ` sang ${fmtDate(r.toDate)}` : ' (chưa chọn ngày mới)'} · nhận ${r.subscription.slotStart} – ${r.subscription.slotEnd}. Không cần chuẩn bị suất ngày ${fmtDate(r.fromDate)}.`,
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
    emailPlan('schedule', r.subscription, { date: req.body?.date }, req.user);
    notifyVendorMealPlan(req, r.subscription, {
        title: 'Xếp ngày bữa gói',
        message: `${studentName(req)} xếp 1 bữa ${r.subscription.menuItemName} vào ${fmtDate(req.body?.date)} · nhận ${r.subscription.slotStart} – ${r.subscription.slotEnd} (${r.subscription.planName}).`,
    });
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
    // Gồm cả gói COMPLETED (gói đã tạo đơn hết các bữa nhưng đơn hôm nay có thể chưa làm xong)
    const subs = await MealPlanSubscription.find({
        vendor: vendor._id,
        status: { $in: ['ACTIVE', 'COMPLETED'] },
        meals: { $elemMatch: { status: { $in: ['SCHEDULED', 'ORDERED'] }, date: { $gte: today, $lte: until } } },
    }).select('menuItemName slotStart slotEnd meals status').lean();

    const orderIds = [];
    for (const sub of subs) for (const m of sub.meals) if (m.status === 'ORDERED' && m.order && m.date >= today && m.date <= until) orderIds.push(m.order);
    const orders = orderIds.length ? await Order.find({ _id: { $in: orderIds } }).select('status').lean() : [];
    const orderStatus = new Map(orders.map((o) => [String(o._id), o.status]));

    // Mỗi dòng = ngày + món + khung giờ; đếm theo tiến độ: chưa tạo đơn / đang làm / đã xong / đã nhận
    const byKey = new Map();
    for (const sub of subs) {
        for (const m of sub.meals) {
            if (!['SCHEDULED', 'ORDERED'].includes(m.status) || !m.date || m.date < today || m.date > until) continue;
            const slot = `${sub.slotStart} - ${sub.slotEnd}`;
            const key = `${m.date}|${sub.menuItemName}|${slot}`;
            if (!byKey.has(key)) {
                byKey.set(key, { date: m.date, menuItemName: sub.menuItemName, slot, count: 0, waiting: 0, processing: 0, ready: 0, completed: 0, processingOrderIds: [] });
            }
            const row = byKey.get(key);
            row.count += 1;
            const st = m.status === 'ORDERED' ? orderStatus.get(String(m.order)) : null;
            if (!st) row.waiting += 1;                       // chưa tới ngày → hệ thống chưa tạo đơn
            else if (st === 'Processing') { row.processing += 1; row.processingOrderIds.push(String(m.order)); }
            else if (st === 'Ready') row.ready += 1;          // đã làm xong, chờ sinh viên tới lấy
            else if (st === 'Completed') row.completed += 1;  // sinh viên đã nhận món
            else row.count -= 1;                             // đơn bị huỷ → không cần chuẩn bị
        }
    }
    const rows = [...byKey.values()].filter((r) => r.count > 0)
        .sort((a, b) => a.date.localeCompare(b.date) || a.slot.localeCompare(b.slot));
    const activeSubs = await MealPlanSubscription.countDocuments({ vendor: vendor._id, status: 'ACTIVE' });
    res.json({ from: today, to: until, activeSubscriptions: activeSubs, rows });
});

/**
 * [POST] /api/meal-plans/vendor/ready  { orderIds: [] }  hoặc  { date, slot, menuItemName } (cả dòng suất hôm nay)
 * Quầy bấm "Hoàn thành" suất gói: đơn Đang làm → Sẵn sàng, báo sinh viên + gửi email mã QR/OTP mời đến lấy.
 * Chỉ đơn của gói ăn, thuộc quầy mình, đang ở trạng thái Processing (bấm 2 lần không gửi trùng).
 */
const vendorMarkReady = handle(async (req, res) => {
    const vendor = await getVendorOrFail(req, res);
    if (!vendor) return;
    let ids = (Array.isArray(req.body?.orderIds) ? req.body.orderIds : []).filter((id) => mongoose.isValidObjectId(id)).slice(0, 200);

    // Bấm theo DÒNG suất (ngày + món + khung giờ): chỉ cho ngày hôm nay; tạo đơn nếu hệ thống chưa kịp tạo
    const { date, slot, menuItemName } = req.body || {};
    if (!ids.length && date) {
        const today = R.vnDateKey(new Date());
        if (date !== today) {
            return res.status(400).json({ message: `Chỉ hoàn thành được suất của hôm nay. Suất ngày ${fmtDate(date)} sẽ bấm được vào đúng ngày đó.` });
        }
        await svc.generateDueMeals({ req });
        const subs = await MealPlanSubscription.find({
            vendor: vendor._id, status: { $in: ['ACTIVE', 'COMPLETED'] },
            meals: { $elemMatch: { status: 'ORDERED', date: today } },
        }).select('menuItemName slotStart slotEnd meals').lean();
        for (const s of subs) {
            if (menuItemName && s.menuItemName !== menuItemName) continue;
            if (slot && `${s.slotStart} - ${s.slotEnd}` !== slot) continue;
            for (const m of s.meals) if (m.status === 'ORDERED' && m.date === today && m.order) ids.push(String(m.order));
        }
    }
    if (!ids.length) return res.status(400).json({ message: 'Không có suất nào để hoàn thành (có thể quầy không phục vụ khung giờ này nên bữa đã được dời).' });

    const orders = await Order.find({
        _id: { $in: ids }, vendor: vendor._id, status: 'Processing', mealPlanSubscription: { $ne: null },
    }).select('_id user mealPlanSubscription');
    const done = [];
    for (const o of orders) {
        // Cập nhật có điều kiện → 2 request đồng thời chỉ 1 cái chuyển được
        const upd = await Order.updateOne({ _id: o._id, status: 'Processing' }, { $set: { status: 'Ready' } });
        if (!upd.modifiedCount) continue;
        done.push(o);
        await logOrderStatus({
            orderId: o._id, fromStatus: 'Processing', toStatus: 'Ready',
            changedBy: req.user._id, changedByRole: req.user.role, note: 'Quầy hoàn thành suất gói ăn',
        });
    }

    // Gom theo gói → mỗi sinh viên 1 email chứa mã của các suất vừa xong
    const bySub = new Map();
    for (const o of done) {
        const k = String(o.mealPlanSubscription);
        if (!bySub.has(k)) bySub.set(k, []);
        bySub.get(k).push(o._id);
    }
    for (const [subId, orderIds] of bySub) {
        const sub = await MealPlanSubscription.findById(subId);
        if (!sub) continue;
        emailMealPickup(sub, orderIds, { ready: true });
        await notifyStudent(req, {
            userId: sub.user, type: 'MEAL_PLAN', orderId: orderIds[0],
            title: 'Bữa gói đã xong — mời đến lấy',
            message: `${sub.vendorName} đã làm xong ${sub.menuItemName} (${sub.planName}). Nhận lúc ${sub.slotStart} – ${sub.slotEnd}; mã QR + OTP đã gửi về email và có trong mục Đơn hàng.`,
        });
    }

    const skipped = ids.length - done.length;
    res.json({
        message: done.length
            ? `Đã hoàn thành ${done.length} suất — đã gửi mã nhận món cho sinh viên.${skipped ? ` (${skipped} suất đã xử lý trước đó)` : ''}`
            : 'Các suất này đã được hoàn thành trước đó.',
        completed: done.length,
    });
});

module.exports = {
    vendorMarkReady,
    listPlans, subscribe, mySubscriptions, postponeMeal, scheduleMeal, cancelPreview, cancelSubscription,
    vendorPlans, vendorCreatePlan, vendorUpdatePlan, vendorSchedule, decorateSub,
};
