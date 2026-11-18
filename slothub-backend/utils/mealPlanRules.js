/**
 * Quy tắc GÓI ĂN TUẦN / THÁNG (hàm thuần — không đụng database, dễ kiểm thử).
 *
 * - Gói tuần: 5 bữa, giảm 5%, dời miễn phí 1 lần, dùng trong 7 ngày.
 * - Gói tháng: 20 bữa, giảm 12%, dời miễn phí 3 lần, dùng trong 30 ngày.
 * - Ngày ăn: báo dời / xếp ngày trước 20:00 hôm trước. Được dời tối đa đến hết hạn gói + 7 ngày.
 * - Dời quá số lần miễn phí → bữa đó MẤT CHIẾT KHẤU (trả thêm phần chênh với giá lẻ, mỗi bữa tối đa 1 lần)
 *   → tổng tiền không bao giờ vượt giá mua lẻ.
 * - Quầy nghỉ / không phục vụ → hệ thống tự dời miễn phí (không tính vào số lần dời).
 * - Hết hạn còn bữa chưa dùng: hoàn 50% giá gói của bữa đó (lỗi do sinh viên); 100% nếu do quầy / hệ thống.
 * - Huỷ gói: còn > 7 ngày → hoàn các bữa còn lại, trừ lại phần chiết khấu đã hưởng của các bữa đã ăn;
 *   trong 7 ngày cuối → như hết hạn (50%).
 * - Phần tiền giữ lại thuộc về quầy (tính như doanh thu, vẫn trừ phí sàn như mọi đơn).
 *
 * Ngày luôn là chuỗi 'YYYY-MM-DD' theo giờ Việt Nam.
 */

const PLAN_TYPES = {
    week: { label: 'Gói tuần', meals: 5, discountPercent: 5, freePostpones: 1, validDays: 7 },
    month: { label: 'Gói tháng', meals: 20, discountPercent: 12, freePostpones: 3, validDays: 30 },
};
const GRACE_DAYS = 7;          // dời tối đa đến hết hạn + 7 ngày
const CUTOFF_HOUR = 20;        // hạn chót 20:00 hôm trước
const LATE_CANCEL_DAYS = 7;    // huỷ trong 7 ngày cuối = như hết hạn
const LATE_REFUND_RATE = 0.5;  // hoàn 50% bữa chưa dùng do sinh viên

const DAY_MS = 24 * 60 * 60 * 1000;
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;

// ---------------- Ngày giờ Việt Nam ----------------
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isDateKey = (s) => typeof s === 'string' && DATE_RE.test(s) && !Number.isNaN(new Date(`${s}T00:00:00+07:00`).getTime());
const vnDateKey = (d = new Date()) => new Date(new Date(d).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);
const addDays = (key, n) => new Date(new Date(`${key}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const diffDays = (a, b) => Math.round((new Date(`${a}T00:00:00Z`) - new Date(`${b}T00:00:00Z`)) / DAY_MS); // a - b
/** Thời điểm cụ thể của 'HH:mm' trong ngày key (giờ VN) */
const atVnTime = (key, hhmm = '00:00') => new Date(`${key}T${hhmm}:00+07:00`);
/** Thứ trong tuần (0 = CN … 6 = T7) của ngày key */
const weekdayOf = (key) => new Date(`${key}T00:00:00Z`).getUTCDay();

/** Hạn chót để xếp / dời bữa ngày `key`: 20:00 hôm trước */
const cutoffFor = (key) => atVnTime(addDays(key, -1), `${String(CUTOFF_HOUR).padStart(2, '0')}:00`);
/** Ngày `key` còn xếp / dời được không (chưa qua hạn chót) */
const isSchedulable = (key, now = new Date()) => isDateKey(key) && now < cutoffFor(key);
/** Ngày sớm nhất còn xếp được */
const earliestSchedulableDate = (now = new Date()) => {
    const tomorrow = addDays(vnDateKey(now), 1);
    return isSchedulable(tomorrow, now) ? tomorrow : addDays(tomorrow, 1);
};

// ---------------- Giá ----------------
const unitPriceOf = (retailUnitPrice, discountPercent) =>
    Math.round((Number(retailUnitPrice) || 0) * (100 - (Number(discountPercent) || 0)) / 100);

/** Báo giá một gói từ giá lẻ của món */
const quotePlan = (type, retailUnitPrice) => {
    const cfg = PLAN_TYPES[type];
    if (!cfg) return null;
    const unitPrice = unitPriceOf(retailUnitPrice, cfg.discountPercent);
    const retailTotal = (Number(retailUnitPrice) || 0) * cfg.meals;
    const total = unitPrice * cfg.meals;
    return {
        type, label: cfg.label, meals: cfg.meals, discountPercent: cfg.discountPercent,
        freePostpones: cfg.freePostpones, validDays: cfg.validDays,
        retailUnitPrice: Number(retailUnitPrice) || 0, unitPrice, retailTotal, total, saving: retailTotal - total,
    };
};

/** Số tiền sinh viên đã trả cho một bữa (giá gói + phí mất chiết khấu nếu có) */
const mealPaid = (sub, meal) => (sub.unitPrice || 0) + (meal.penalty || 0);

/** Phí khi dời thêm 1 bữa (0 nếu còn lượt miễn phí hoặc bữa này đã mất chiết khấu) */
const postponePenalty = (sub, meal) => {
    if ((sub.postponesUsed || 0) < (sub.freePostpones || 0)) return 0;
    if (meal.discountLost) return 0;
    return Math.max(0, (sub.retailUnitPrice || 0) - (sub.unitPrice || 0));
};

// ---------------- Trạng thái bữa ----------------
const OPEN_MEAL_STATUSES = ['SCHEDULED', 'UNSCHEDULED']; // chưa dùng
const isOpenMeal = (m) => OPEN_MEAL_STATUSES.includes(m.status);

/**
 * Kiểm tra ngày mới cho một bữa: còn hạn chót, trong hạn gói (+7 ngày), không trùng ngày bữa khác.
 * @returns {string|null} thông báo lỗi hoặc null nếu hợp lệ
 */
const validateNewMealDate = (sub, date, { now = new Date(), ignoreMealId = null } = {}) => {
    if (!isDateKey(date)) return 'Ngày không hợp lệ.';
    if (!isSchedulable(date, now)) return `Đã quá hạn chót (20:00 hôm trước) để chọn ngày ${date}.`;
    if (date < sub.validFrom) return `Ngày ${date} trước ngày bắt đầu gói (${sub.validFrom}).`;
    if (date > sub.finalDate) return `Chỉ dời được đến hết ngày ${sub.finalDate} (hết hạn gói + ${GRACE_DAYS} ngày).`;
    const clash = (sub.meals || []).some((m) => String(m._id) !== String(ignoreMealId) && m.date === date && m.status !== 'CANCELLED');
    if (clash) return `Ngày ${date} đã có một bữa trong gói.`;
    return null;
};

/**
 * Tính tiền khi đóng gói (hết hạn hoặc huỷ). Không ghi DB.
 * mode: 'expire' | 'cancel'
 * @returns {{ late: boolean, refund: number, retained: number, perMeal: Array<{ mealId, refund, retained }>, discountEnjoyed: number }}
 */
const computeClose = (sub, { mode, now = new Date() }) => {
    const meals = sub.meals || [];
    const open = meals.filter(isOpenMeal);
    const daysLeft = diffDays(sub.validUntil, vnDateKey(now));
    const late = mode === 'expire' || daysLeft < LATE_CANCEL_DAYS;

    if (late) {
        const perMeal = open.map((m) => {
            const paid = mealPaid(sub, m);
            const refund = m.vendorSkipped ? paid : Math.round((sub.unitPrice || 0) * LATE_REFUND_RATE);
            return { mealId: String(m._id), refund, retained: paid - refund };
        });
        return {
            late: true,
            refund: perMeal.reduce((s, x) => s + x.refund, 0),
            retained: perMeal.reduce((s, x) => s + x.retained, 0),
            perMeal,
            discountEnjoyed: 0,
        };
    }

    // Huỷ sớm: hoàn đủ phần đã trả của các bữa còn lại, trừ lại chiết khấu đã hưởng ở các bữa đã ăn
    const remainingPaid = open.reduce((s, m) => s + mealPaid(sub, m), 0);
    const discountPerMeal = Math.max(0, (sub.retailUnitPrice || 0) - (sub.unitPrice || 0));
    const discountEnjoyed = meals.filter((m) => m.status === 'ORDERED' && !m.discountLost).length * discountPerMeal;
    const refund = Math.max(0, remainingPaid - discountEnjoyed);
    const retained = remainingPaid - refund;
    // chia đều phần giữ lại cho các bữa (chỉ để ghi sổ)
    const perMeal = open.map((m, i) => {
        const share = i === open.length - 1
            ? retained - Math.floor(retained / open.length) * (open.length - 1)
            : Math.floor(retained / open.length);
        return { mealId: String(m._id), refund: mealPaid(sub, m) - share, retained: share };
    });
    return { late: false, refund, retained, perMeal, discountEnjoyed };
};

module.exports = {
    PLAN_TYPES, GRACE_DAYS, CUTOFF_HOUR, LATE_CANCEL_DAYS, LATE_REFUND_RATE,
    isDateKey, vnDateKey, addDays, diffDays, atVnTime, weekdayOf,
    cutoffFor, isSchedulable, earliestSchedulableDate,
    unitPriceOf, quotePlan, mealPaid, postponePenalty,
    OPEN_MEAL_STATUSES, isOpenMeal, validateNewMealDate, computeClose,
};
