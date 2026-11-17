/**
 * Giá bán của món — MỌI nơi tính tiền (giỏ hàng, đặt đơn, chatbot, món yêu thích) dùng chung file này,
 * để giá hiển thị và giá thực trừ tiền luôn khớp nhau. Không tin giá do client gửi lên.
 *
 * Giảm giá món: discountPercent (1–90) áp dụng trong khoảng [discountStartAt, discountEndAt).
 * Bỏ trống ngày bắt đầu = áp dụng ngay; bỏ trống ngày kết thúc = áp dụng đến khi quầy tắt.
 */
const MAX_DISCOUNT_PERCENT = 90;

const toPlain = (item) => (item && typeof item.toObject === 'function' ? item.toObject() : item);

/** Món đang trong thời gian giảm giá? */
const isDiscountActive = (item, now = new Date()) => {
    if (!item) return false;
    const pct = Number(item.discountPercent) || 0;
    if (pct <= 0) return false;
    const start = item.discountStartAt ? new Date(item.discountStartAt) : null;
    const end = item.discountEndAt ? new Date(item.discountEndAt) : null;
    if (start && now < start) return false;
    if (end && now >= end) return false;
    return true;
};

/** Giá thực bán lúc `now` (đã trừ giảm giá nếu đang áp dụng), làm tròn đến đồng */
const getEffectivePrice = (item, now = new Date()) => {
    const base = Number(item?.price) || 0;
    if (!isDiscountActive(item, now)) return base;
    const pct = Math.min(Number(item.discountPercent), MAX_DISCOUNT_PERCENT);
    return Math.round((base * (100 - pct)) / 100);
};

/**
 * Bản sao món cho API công khai: `price` = giá đang bán, kèm `originalPrice` và thông tin giảm giá.
 * Frontend cũ chỉ đọc `price` vẫn hiển thị / tính đúng tiền.
 */
const withPricing = (item, now = new Date()) => {
    const obj = toPlain(item);
    if (!obj) return obj;
    const active = isDiscountActive(obj, now);
    return {
        ...obj,
        price: getEffectivePrice(obj, now),
        originalPrice: Number(obj.price) || 0,
        discountActive: active,
        discountPercent: active ? Number(obj.discountPercent) : 0,
        discountEndAt: active ? obj.discountEndAt || null : null,
    };
};

/** Thông tin giảm giá kèm theo (không đổi `price`) — dùng cho trang quản lý thực đơn của chủ quầy */
const discountInfo = (item, now = new Date()) => ({
    discountActive: isDiscountActive(item, now),
    effectivePrice: getEffectivePrice(item, now),
});

const parseDateInput = (value) => {
    if (value === null || value === '' || value === undefined) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? undefined : d;
};

/**
 * Đọc + kiểm tra dữ liệu giảm giá từ body (thêm / sửa món).
 * Trả { ok, set, unset } — chỉ xử lý các trường có gửi lên.
 */
const parseDiscountInput = (body = {}, current = {}) => {
    const set = {};
    const unset = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);

    if (has('discountPercent')) {
        const raw = body.discountPercent;
        const n = raw === '' || raw === null ? 0 : Number(raw);
        if (!Number.isInteger(n) || n < 0 || n > MAX_DISCOUNT_PERCENT) {
            return { ok: false, message: `Giảm giá phải là số nguyên từ 0 đến ${MAX_DISCOUNT_PERCENT}%.` };
        }
        set.discountPercent = n;
    }
    for (const key of ['discountStartAt', 'discountEndAt']) {
        if (!has(key)) continue;
        const d = parseDateInput(body[key]);
        if (d === undefined) return { ok: false, message: 'Thời gian giảm giá không hợp lệ.' };
        if (d === null) unset[key] = 1;
        else set[key] = d;
    }

    const pct = set.discountPercent ?? current.discountPercent ?? 0;
    const start = unset.discountStartAt ? null : (set.discountStartAt ?? current.discountStartAt ?? null);
    const end = unset.discountEndAt ? null : (set.discountEndAt ?? current.discountEndAt ?? null);
    if (pct > 0 && start && end && new Date(end) <= new Date(start)) {
        return { ok: false, message: 'Thời gian kết thúc giảm giá phải sau thời gian bắt đầu.' };
    }
    // Chỉ chặn khi chủ quầy ĐẶT MỚI ngày kết thúc ở quá khứ — sửa món khác mà giữ nguyên đợt giảm giá cũ (đã hết) vẫn lưu được
    const currentEnd = current.discountEndAt ? new Date(current.discountEndAt).getTime() : null;
    const endChanged = has('discountEndAt') && end && new Date(end).getTime() !== currentEnd;
    if (pct > 0 && endChanged && new Date(end) <= new Date()) {
        return { ok: false, message: 'Thời gian kết thúc giảm giá phải ở tương lai.' };
    }
    return { ok: true, set, unset };
};

module.exports = {
    MAX_DISCOUNT_PERCENT,
    isDiscountActive,
    getEffectivePrice,
    withPricing,
    discountInfo,
    parseDiscountInput,
};
