const mongoose = require('mongoose');
const MealPlan = require('../models/MealPlan');
const MealPlanSubscription = require('../models/MealPlanSubscription');
const MenuItem = require('../models/MenuItem');
const Vendor = require('../models/Vendor');
const TimeSlot = require('../models/TimeSlot');
const Order = require('../models/Order');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { PLATFORM_FEE_RATE } = require('./settleOrderPayment');
const { logStudentWallet, logOrderStatus, notifyStudent } = require('./persistence');
const { issuePickupCode } = require('./pickupCode');
const { isVendorOpenForTimeRange } = require('./vendorHours');
const R = require('./mealPlanRules');

class MealPlanError extends Error {
    constructor(status, message) { super(message); this.status = status; }
}
const fail = (status, message) => { throw new MealPlanError(status, message); };
const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const shortId = (id) => `#${String(id).slice(-6).toUpperCase()}`;

// ======================= TIỀN =======================

/** Trừ ví sinh viên (nguyên tử: chỉ trừ khi đủ tiền). Trả số dư mới hoặc null nếu không đủ. */
const debitStudent = async (userId, amount, description) => {
    if (amount <= 0) return (await User.findById(userId).select('walletBalance'))?.walletBalance ?? 0;
    const user = await User.findOneAndUpdate(
        { _id: userId, walletBalance: { $gte: amount } },
        { $inc: { walletBalance: -amount } },
        { returnDocument: 'after' }
    ).select('walletBalance');
    if (!user) return null;
    const tx = await Transaction.create({
        userId, amount, type: 'PAYMENT', status: 'SUCCESS', paymentMethod: 'WALLET', description,
    });
    await logStudentWallet({ userId, amount: -amount, balanceAfter: user.walletBalance, type: 'PAYMENT', transactionId: tx._id, description });
    return user.walletBalance;
};

/** Hoàn tiền vào ví sinh viên */
const creditStudent = async (userId, amount, description, vendorId = null) => {
    if (amount <= 0) return;
    const user = await User.findByIdAndUpdate(userId, { $inc: { walletBalance: amount } }, { returnDocument: 'after' }).select('walletBalance');
    const tx = await Transaction.create({
        userId, vendorId, amount, type: 'REFUND', status: 'SUCCESS', paymentMethod: 'WALLET', description,
    });
    await logStudentWallet({ userId, amount, balanceAfter: user?.walletBalance, type: 'REFUND', transactionId: tx._id, description });
};

/**
 * Ghi doanh thu cho quầy từ tiền gói (bữa đã phục vụ hoặc phần giữ lại khi đóng gói):
 * 95% vào ví chủ quầy, 5% phí sàn — giống đơn thường (utils/settleOrderPayment.js).
 * Giao dịch PAYMENT ghi cho chủ quầy (không ghi cho sinh viên vì sinh viên đã trả lúc mua gói).
 */
const creditVendorRevenue = async (vendor, amount, description, orderId = null) => {
    if (!vendor || amount <= 0) return;
    const vendorShare = Math.round(amount * (1 - PLATFORM_FEE_RATE));
    const platformShare = amount - vendorShare;
    if (vendor.owner) {
        await User.findByIdAndUpdate(vendor.owner, { $inc: { walletBalance: vendorShare } });
        await Transaction.create({
            orderId, userId: vendor.owner, vendorId: vendor._id, amount, type: 'PAYMENT',
            status: 'SUCCESS', paymentMethod: 'WALLET', description,
        });
    }
    const admin = await User.findOne({ role: 'admin' }).select('_id');
    if (admin && platformShare > 0) {
        await User.findByIdAndUpdate(admin._id, { $inc: { walletBalance: platformShare } });
        await Transaction.create({
            orderId, userId: admin._id, vendorId: vendor._id, amount: platformShare, type: 'PLATFORM_FEE',
            status: 'SUCCESS', description: `Phí sàn 5% — ${description}`,
        });
    }
};

const saveSub = async (sub) => {
    try {
        await sub.save();
    } catch (err) {
        if (err instanceof mongoose.Error.VersionError) fail(409, 'Gói vừa được cập nhật ở nơi khác. Vui lòng tải lại.');
        throw err;
    }
};

// ======================= QUẦY: GÓI ĐANG BÁN =======================

/** Gói đang mở bán + báo giá (giá lẻ hiện tại của món) */
const listPublicPlans = async ({ vendorId } = {}) => {
    const filter = { isActive: true };
    if (vendorId && mongoose.isValidObjectId(vendorId)) filter.vendor = vendorId;
    const plans = await MealPlan.find(filter)
        .populate('menuItem', 'name price imageUrl calories isAvailable rating numReviews')
        .populate('vendor', 'name isActive openTime closeTime')
        .sort({ type: 1, createdAt: -1 })
        .lean();
    return plans
        .filter((p) => p.menuItem && p.menuItem.isAvailable !== false && p.vendor && p.vendor.isActive !== false)
        .map((p) => ({ ...p, quote: R.quotePlan(p.type, p.menuItem.price) }));
};

// ======================= SINH VIÊN: MUA GÓI =======================

/**
 * Mua gói: chọn khung giờ nhận, ngày bắt đầu và các ngày ăn (tối đa = số bữa; còn thiếu thì xếp sau).
 * Trừ ví toàn bộ tiền gói ngay.
 */
const subscribe = async ({ userId, planId, pickupSlotId, startDate, dates = [], agreeTerms, idempotencyKey, now = new Date() }) => {
    if (!agreeTerms) fail(400, 'Vui lòng đọc và đồng ý quy định gói ăn (dời ngày, hoàn tiền) trước khi mua.');
    if (!mongoose.isValidObjectId(planId)) fail(400, 'Mã gói không hợp lệ.');

    const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim().slice(0, 100) : '';
    if (key) {
        const existing = await MealPlanSubscription.findOne({ user: userId, idempotencyKey: key });
        if (existing) return { subscription: existing, duplicate: true };
    }

    const plan = await MealPlan.findById(planId).populate('menuItem').populate('vendor');
    if (!plan || !plan.isActive) fail(404, 'Gói không tồn tại hoặc đã ngừng bán.');
    if (!plan.menuItem || plan.menuItem.isAvailable === false) fail(400, 'Món của gói hiện ngừng bán.');
    if (!plan.vendor || plan.vendor.isActive === false) fail(400, 'Quầy đang ngừng hoạt động.');

    const slot = mongoose.isValidObjectId(pickupSlotId) ? await TimeSlot.findById(pickupSlotId) : null;
    if (!slot || slot.isActive === false) fail(400, 'Vui lòng chọn khung giờ nhận món hợp lệ.');
    if (!isVendorOpenForTimeRange(plan.vendor.openTime, plan.vendor.closeTime, slot.startTime, slot.endTime)) {
        fail(400, `Quầy không phục vụ khung ${slot.startTime} – ${slot.endTime} (giờ quầy ${plan.vendor.openTime} – ${plan.vendor.closeTime}).`);
    }

    const cfg = R.PLAN_TYPES[plan.type];
    const quote = R.quotePlan(plan.type, plan.menuItem.price);
    if (!R.isDateKey(startDate)) fail(400, 'Ngày bắt đầu không hợp lệ.');
    if (!R.isSchedulable(startDate, now)) {
        fail(400, `Ngày bắt đầu sớm nhất là ${R.earliestSchedulableDate(now)} (đặt trước 20:00 hôm trước).`);
    }
    const validUntil = R.addDays(startDate, cfg.validDays - 1);
    const finalDate = R.addDays(validUntil, R.GRACE_DAYS);

    const uniq = [...new Set((Array.isArray(dates) ? dates : []).map(String))].sort();
    if (uniq.length > cfg.meals) fail(400, `${cfg.label} chỉ có ${cfg.meals} bữa.`);
    for (const d of uniq) {
        if (!R.isDateKey(d)) fail(400, `Ngày ${d} không hợp lệ.`);
        if (d < startDate || d > validUntil) fail(400, `Ngày ${d} nằm ngoài thời hạn gói (${startDate} → ${validUntil}).`);
        if (!R.isSchedulable(d, now)) fail(400, `Ngày ${d} đã quá hạn chót đặt.`);
    }

    const meals = [
        ...uniq.map((d) => ({ date: d, status: 'SCHEDULED' })),
        ...Array.from({ length: cfg.meals - uniq.length }, () => ({ date: null, status: 'UNSCHEDULED' })),
    ];

    const description = `Mua ${plan.name} — ${cfg.meals} bữa ${plan.menuItem.name} (${plan.vendor.name})`;
    const balance = await debitStudent(userId, quote.total, description);
    if (balance === null) fail(400, `Số dư ví không đủ. Gói cần ${vnd(quote.total)}.`);

    try {
        const sub = await MealPlanSubscription.create({
            user: userId, vendor: plan.vendor._id, plan: plan._id, menuItem: plan.menuItem._id,
            planType: plan.type, planName: plan.name, menuItemName: plan.menuItem.name, vendorName: plan.vendor.name,
            mealsCount: cfg.meals, discountPercent: cfg.discountPercent, freePostpones: cfg.freePostpones,
            retailUnitPrice: quote.retailUnitPrice, unitPrice: quote.unitPrice, totalPaid: quote.total,
            pickupSlot: slot._id, slotStart: slot.startTime, slotEnd: slot.endTime,
            validFrom: startDate, validUntil, finalDate, meals,
            termsAcceptedAt: now, idempotencyKey: key || undefined,
        });
        return { subscription: sub, duplicate: false, balance };
    } catch (err) {
        // không tạo được gói → trả lại tiền
        await creditStudent(userId, quote.total, `Hoàn tiền mua gói lỗi — ${plan.name}`, plan.vendor._id);
        if (err.code === 11000 && key) {
            const existing = await MealPlanSubscription.findOne({ user: userId, idempotencyKey: key });
            if (existing) return { subscription: existing, duplicate: true };
        }
        throw err;
    }
};

const getOwnSub = async (userId, subId) => {
    if (!mongoose.isValidObjectId(subId)) fail(400, 'Mã gói không hợp lệ.');
    const sub = await MealPlanSubscription.findOne({ _id: subId, user: userId });
    if (!sub) fail(404, 'Không tìm thấy gói của bạn.');
    if (sub.status !== 'ACTIVE') fail(400, 'Gói đã kết thúc.');
    return sub;
};
const findMeal = (sub, mealId) => {
    const meal = sub.meals.id(mealId);
    if (!meal) fail(404, 'Không tìm thấy bữa trong gói.');
    return meal;
};

// ======================= DỜI / XẾP NGÀY =======================

/**
 * Dời một bữa đã xếp ngày. newDate bỏ trống = "để sau" (bữa chuyển sang chưa xếp ngày).
 * Quá số lần dời miễn phí → bữa mất chiết khấu, trừ phần chênh vào ví ngay.
 */
const postponeMeal = async ({ userId, subId, mealId, newDate = null, now = new Date() }) => {
    const sub = await getOwnSub(userId, subId);
    const meal = findMeal(sub, mealId);
    if (meal.status !== 'SCHEDULED') fail(400, 'Chỉ dời được bữa đang có ngày ăn.');
    if (!R.isSchedulable(meal.date, now)) fail(400, `Đã quá 20:00 ngày ${R.addDays(meal.date, -1)} — không dời được bữa ngày ${meal.date} nữa.`);
    if (newDate) {
        const err = R.validateNewMealDate(sub, newDate, { now, ignoreMealId: meal._id });
        if (err) fail(400, err);
    }

    const penalty = R.postponePenalty(sub, meal);
    const freeLeftBefore = Math.max(0, sub.freePostpones - sub.postponesUsed);
    if (penalty > 0) {
        const balance = await debitStudent(userId, penalty,
            `Phí dời bữa ${meal.date} (${sub.planName}) — quá ${sub.freePostpones} lần dời miễn phí, bữa này tính giá lẻ`);
        if (balance === null) fail(400, `Đã hết lượt dời miễn phí. Lần dời này cần trả thêm ${vnd(penalty)} nhưng ví không đủ.`);
        meal.penalty = (meal.penalty || 0) + penalty;
        meal.discountLost = true;
        sub.penaltyTotal += penalty;
    }
    const fromDate = meal.date;
    meal.date = newDate || null;
    meal.status = newDate ? 'SCHEDULED' : 'UNSCHEDULED';
    meal.vendorSkipped = false;
    meal.postponeCount += 1;
    sub.postponesUsed += 1;

    try {
        await saveSub(sub);
    } catch (err) {
        if (penalty > 0) await creditStudent(userId, penalty, `Hoàn phí dời bữa (lỗi cập nhật) — ${sub.planName}`, sub.vendor);
        throw err;
    }
    return {
        subscription: sub, penalty, fromDate, toDate: newDate || null,
        freePostponesLeft: Math.max(0, sub.freePostpones - sub.postponesUsed),
        usedFree: freeLeftBefore > 0,
    };
};

/** Xếp ngày cho một bữa chưa có ngày (không mất phí) */
const scheduleMeal = async ({ userId, subId, mealId, date, now = new Date() }) => {
    const sub = await getOwnSub(userId, subId);
    const meal = findMeal(sub, mealId);
    if (meal.status !== 'UNSCHEDULED') fail(400, 'Bữa này đã có ngày ăn.');
    const err = R.validateNewMealDate(sub, date, { now, ignoreMealId: meal._id });
    if (err) fail(400, err);
    meal.date = date;
    meal.status = 'SCHEDULED';
    await saveSub(sub);
    return { subscription: sub };
};

// ======================= ĐÓNG GÓI (HUỶ / HẾT HẠN) =======================

const applyClose = async (sub, { mode, now = new Date(), req = null }) => {
    const calc = R.computeClose(sub, { mode, now });
    const byMeal = new Map(calc.perMeal.map((x) => [x.mealId, x]));
    for (const m of sub.meals) {
        const r = byMeal.get(String(m._id));
        if (!r) continue;
        m.refundAmount = r.refund;
        m.status = r.retained === 0 ? 'REFUNDED' : 'FORFEITED';
        m.closedAt = now;
    }
    sub.refundTotal += calc.refund;
    sub.vendorRetained += calc.retained;
    sub.status = mode === 'cancel' ? 'CANCELLED' : 'EXPIRED';
    sub.closedAt = now;
    await saveSub(sub); // lưu trước (khoá trạng thái) rồi mới chuyển tiền → không hoàn 2 lần

    const label = mode === 'cancel' ? 'Huỷ' : 'Hết hạn';
    await creditStudent(sub.user, calc.refund, `${label} ${sub.planName} — hoàn ${calc.perMeal.length} bữa chưa dùng`, sub.vendor);
    const vendor = await Vendor.findById(sub.vendor);
    await creditVendorRevenue(vendor, calc.retained, `${label} ${sub.planName} ${shortId(sub._id)} — phần giữ lại các bữa chưa dùng`);
    if (calc.perMeal.length || mode === 'cancel') {
        await notifyStudent(req, {
            userId: sub.user,
            title: mode === 'cancel' ? 'Đã huỷ gói ăn' : 'Gói ăn đã hết hạn',
            message: calc.perMeal.length
                ? `${sub.planName}: ${calc.perMeal.length} bữa chưa dùng — đã hoàn ${vnd(calc.refund)} vào ví SlotHub.`
                : `${sub.planName} đã kết thúc.`,
            type: 'MEAL_PLAN',
        });
    }
    return calc;
};

const previewCancel = async ({ userId, subId, now = new Date() }) => {
    const sub = await getOwnSub(userId, subId);
    const calc = R.computeClose(sub, { mode: 'cancel', now });
    return { ...calc, remainingMeals: calc.perMeal.length, subscription: sub };
};

const cancelSubscription = async ({ userId, subId, now = new Date(), req = null }) => {
    const sub = await getOwnSub(userId, subId);
    const calc = await applyClose(sub, { mode: 'cancel', now, req });
    return { ...calc, subscription: sub };
};

// ======================= JOB: TẠO ĐƠN NGÀY ĂN =======================

/** Quầy phục vụ được bữa này không (quầy hoạt động, khung giờ trong giờ mở cửa, không tạm tắt qua giờ nhận) */
const vendorServes = (vendor, sub, slotStartAt) => {
    if (!vendor || vendor.isActive === false) return false;
    if (!isVendorOpenForTimeRange(vendor.openTime, vendor.closeTime, sub.slotStart, sub.slotEnd)) return false;
    if (vendor.isPaused && (!vendor.pausedUntil || new Date(vendor.pausedUntil) > slotStartAt)) return false;
    return true;
};

/** Tìm ngày gần nhất sau `fromDate` để tự dời (quầy nghỉ) — trong hạn dời, không trùng bữa khác */
const nextFreeDate = (sub, fromDate, now) => {
    for (let d = R.addDays(fromDate, 1); d <= sub.finalDate; d = R.addDays(d, 1)) {
        if (d <= R.vnDateKey(now)) continue;
        if (!sub.meals.some((m) => m.date === d && m.status !== 'REFUNDED' && m.status !== 'FORFEITED')) return d;
    }
    return null;
};

const createMealOrder = async (sub, meal, menuItem, slotStartAt, slotEndAt, now) => {
    const idempotencyKey = `mealplan:${sub._id}:${meal._id}`;
    const existing = await Order.findOne({ idempotencyKey });
    if (existing) return { order: existing, created: false };

    const paid = R.mealPaid(sub, meal);
    const order = new Order({
        user: sub.user, vendor: sub.vendor,
        items: [{ menuItem: menuItem._id, quantity: 1, price: paid, ...(menuItem.calories != null && { calories: menuItem.calories }) }],
        totalPrice: paid,
        note: `Bữa ${sub.planName} (${sub.meals.filter((m) => m.status === 'ORDERED').length + 1}/${sub.mealsCount})`,
        deliveryType: 'pickup',
        pickupSlot: `${sub.slotStart} - ${sub.slotEnd}`,
        pickupSlotId: sub.pickupSlot,
        pickupSlotStartAt: slotStartAt, pickupSlotEndAt: slotEndAt, pickupDay: 'today',
        paymentMethod: 'wallet', paymentStatus: 'Paid',
        // Gói đã trả trước và quầy đã cam kết khi mở bán gói → đơn được nhận làm luôn
        status: 'Processing', approvalStatus: 'APPROVED', approvedAt: now,
        idempotencyKey,
        mealPlanSubscription: sub._id, mealPlanMealId: meal._id,
    });
    issuePickupCode(order, now);
    await order.save();
    await logOrderStatus({ orderId: order._id, fromStatus: null, toStatus: 'Processing', changedByRole: 'system', note: `Tự tạo từ ${sub.planName}` });
    return { order, created: true };
};

/**
 * Tạo đơn cho các bữa có ngày ăn là hôm nay (hoặc bị sót từ trước).
 * Quầy không phục vụ được → tự dời sang ngày kế tiếp (miễn phí); hết ngày dời → hoàn 100% khi đóng gói.
 */
const generateDueMeals = async ({ now = new Date(), req = null } = {}) => {
    const today = R.vnDateKey(now);
    const subs = await MealPlanSubscription.find({
        status: 'ACTIVE',
        meals: { $elemMatch: { status: 'SCHEDULED', date: { $lte: today } } },
    });
    const result = { ordered: 0, moved: 0, skipped: 0 };

    for (const sub of subs) {
        try {
            const [vendor, menuItem] = await Promise.all([Vendor.findById(sub.vendor), MenuItem.findById(sub.menuItem)]);
            const due = sub.meals.filter((m) => m.status === 'SCHEDULED' && m.date <= today).sort((a, b) => a.date.localeCompare(b.date));
            const toCredit = [];
            const notices = [];

            for (const meal of due) {
                const slotStartAt = R.atVnTime(meal.date, sub.slotStart);
                const slotEndAt = R.atVnTime(meal.date, sub.slotEnd);
                const serviceable = now < slotEndAt && menuItem && menuItem.isAvailable !== false && vendorServes(vendor, sub, slotStartAt);

                if (serviceable) {
                    const { order, created } = await createMealOrder(sub, meal, menuItem, slotStartAt, slotEndAt, now);
                    meal.status = 'ORDERED';
                    meal.order = order._id;
                    if (created) {
                        toCredit.push({ amount: R.mealPaid(sub, meal), orderId: order._id });
                        notices.push({ title: 'Bữa gói hôm nay đã sẵn sàng', message: `${sub.menuItemName} tại ${sub.vendorName}, nhận lúc ${sub.slotStart} – ${sub.slotEnd}. Mã nhận món có trong mục Đơn hàng.`, orderId: order._id });
                    }
                    result.ordered += 1;
                    continue;
                }

                // Quầy / hệ thống không phục vụ được → dời miễn phí
                const from = meal.date;
                const to = nextFreeDate(sub, from, now);
                meal.autoMovedCount += 1;
                if (to) {
                    meal.date = to;
                    result.moved += 1;
                    notices.push({ title: 'Bữa gói được dời miễn phí', message: `Quầy ${sub.vendorName} không phục vụ được bữa ngày ${from}. Bữa được dời sang ${to}, không tính vào lượt dời của bạn.` });
                } else {
                    meal.date = null;
                    meal.status = 'UNSCHEDULED';
                    meal.vendorSkipped = true;
                    result.skipped += 1;
                    notices.push({ title: 'Bữa gói không phục vụ được', message: `Quầy ${sub.vendorName} không phục vụ được bữa ngày ${from} và không còn ngày dời trong hạn. Bữa này sẽ được hoàn 100% khi gói kết thúc (hoặc bạn tự chọn ngày khác).` });
                }
            }

            if (sub.meals.every((m) => !R.isOpenMeal(m))) {
                sub.status = 'COMPLETED';
                sub.closedAt = now;
            }
            await saveSub(sub);
            for (const c of toCredit) {
                await creditVendorRevenue(vendor, c.amount, `Bữa ${sub.planName} — đơn ${shortId(c.orderId)}`, c.orderId);
            }
            for (const n of notices) await notifyStudent(req, { userId: sub.user, type: 'MEAL_PLAN', ...n });
        } catch (err) {
            console.error('[mealPlan] tạo đơn lỗi', String(sub._id), err.message);
        }
    }
    return result;
};

// ======================= JOB: HẾT HẠN + NHẮC NHỞ =======================

/** Đóng các gói đã qua hạn dời cuối (finalDate): hoàn bữa chưa dùng theo quy tắc */
const closeExpired = async ({ now = new Date(), req = null } = {}) => {
    const today = R.vnDateKey(now);
    const subs = await MealPlanSubscription.find({ status: 'ACTIVE', finalDate: { $lt: today } });
    let closed = 0;
    for (const sub of subs) {
        try {
            // bữa có ngày mà chưa được tạo đơn (hệ thống sót) → coi như lỗi hệ thống, hoàn 100%
            for (const m of sub.meals) if (m.status === 'SCHEDULED') m.vendorSkipped = true;
            await applyClose(sub, { mode: 'expire', now, req });
            closed += 1;
        } catch (err) {
            console.error('[mealPlan] đóng gói lỗi', String(sub._id), err.message);
        }
    }
    return { closed };
};

/** Nhắc sinh viên khi còn 3 ngày / 1 ngày đến hạn dời cuối mà vẫn còn bữa chưa xếp ngày */
const sendReminders = async ({ now = new Date(), req = null } = {}) => {
    const today = R.vnDateKey(now);
    const subs = await MealPlanSubscription.find({
        status: 'ACTIVE',
        finalDate: { $gte: today, $lte: R.addDays(today, 3) },
        'meals.status': 'UNSCHEDULED',
    });
    let sent = 0;
    for (const sub of subs) {
        const left = R.diffDays(sub.finalDate, today);
        const tag = left <= 1 ? 'd1' : 'd3';
        if (sub.remindersSent.includes(tag)) continue;
        const unscheduled = sub.meals.filter((m) => m.status === 'UNSCHEDULED').length;
        sub.remindersSent.push(tag);
        try {
            await saveSub(sub);
            await notifyStudent(req, {
                userId: sub.user, type: 'MEAL_PLAN',
                title: `Gói ăn còn ${unscheduled} bữa chưa chọn ngày`,
                message: `${sub.planName}: hạn chọn ngày cuối cùng là ${sub.finalDate}. Sau hạn, mỗi bữa chưa dùng chỉ được hoàn 50% giá gói.`,
            });
            sent += 1;
        } catch (err) {
            console.error('[mealPlan] nhắc nhở lỗi', String(sub._id), err.message);
        }
    }
    return { sent };
};

const runMealPlanJobs = async (opts = {}) => {
    const generated = await generateDueMeals(opts);
    const reminders = await sendReminders(opts);
    const expired = await closeExpired(opts);
    return { generated, reminders, expired };
};

module.exports = {
    MealPlanError,
    listPublicPlans,
    subscribe,
    postponeMeal,
    scheduleMeal,
    previewCancel,
    cancelSubscription,
    generateDueMeals,
    closeExpired,
    sendReminders,
    runMealPlanJobs,
    creditVendorRevenue,
};
