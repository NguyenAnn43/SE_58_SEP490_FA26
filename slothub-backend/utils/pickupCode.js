const { computePickupCodeExpiresAt, PICKUP_CODE_AFTER_SLOT_MS } = require('./pickupSchedule');

/** Dự phòng cho đơn cũ không có khung giờ nhận */
const PICKUP_CODE_TTL_MS = 2 * 60 * 60 * 1000;

/**
 * Cấp mã nhận món. Hạn mã = hết khung giờ nhận + 30 phút
 * (đặt cho ngày mai thì mã vẫn còn hạn tới trưa mai).
 * Nếu thanh toán trễ sát/qua khung giờ, vẫn cho ít nhất 30 phút để kịp nhận.
 */
const issuePickupCode = (order, issuedAt = new Date()) => {
    if (!order.otpCode) {
        order.otpCode = Math.floor(1000 + Math.random() * 9000).toString();
    }
    const slotExpiresAt = computePickupCodeExpiresAt(order, issuedAt);
    const minExpiresAt = new Date(issuedAt.getTime() + PICKUP_CODE_AFTER_SLOT_MS);
    order.pickupCodeIssuedAt = issuedAt;
    order.pickupCodeExpiresAt = slotExpiresAt > minExpiresAt ? slotExpiresAt : minExpiresAt;
};

const getPickupCodeExpiresAt = (order) => {
    if (order.pickupCodeExpiresAt) {
        return new Date(order.pickupCodeExpiresAt);
    }
    if (order.paymentStatus === 'Paid' && order.pickupSlotEndAt) {
        return computePickupCodeExpiresAt(order);
    }
    if (order.paymentStatus === 'Paid' && order.createdAt) {
        return new Date(new Date(order.createdAt).getTime() + PICKUP_CODE_TTL_MS);
    }
    return null;
};

const isPickupCodeExpired = (order, now = new Date()) => {
    const expiresAt = getPickupCodeExpiresAt(order);
    if (!expiresAt) return true;
    return now.getTime() > expiresAt.getTime();
};

const pickupCodeExpiredMessage = () =>
    'Mã nhận món đã hết hạn (quá 30 phút sau khung giờ nhận). Vui lòng liên hệ quầy.';

module.exports = {
    PICKUP_CODE_TTL_MS,
    issuePickupCode,
    getPickupCodeExpiresAt,
    isPickupCodeExpired,
    pickupCodeExpiredMessage
};
