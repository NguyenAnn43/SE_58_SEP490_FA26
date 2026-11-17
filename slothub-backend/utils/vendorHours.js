const timeToMinutes = (timeStr) => {
    const [h, m] = String(timeStr || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
};

/** Quầy có đang trong khung giờ mở cửa không (hỗ trợ qua đêm, VD 22:00–06:00) */
const isVendorOpenNow = (openTime, closeTime, now = new Date()) => {
    const current = now.getHours() * 60 + now.getMinutes();
    const open = timeToMinutes(openTime);
    const close = timeToMinutes(closeTime);

    if (open === close) return true;
    if (open < close) return current >= open && current <= close;
    return current >= open || current <= close;
};

/** Khung giờ nhận món [rangeStart, rangeEnd] có nằm trong giờ mở cửa quầy không */
const isVendorOpenForTimeRange = (openTime, closeTime, rangeStart, rangeEnd) => {
    const open = timeToMinutes(openTime);
    const close = timeToMinutes(closeTime);
    const s = timeToMinutes(rangeStart);
    const e = timeToMinutes(rangeEnd);

    const overlaps = (segStart, segEnd) => s < segEnd && e > segStart;

    if (open === close) return true;
    if (open < close) return overlaps(open, close);
    return overlaps(open, 24 * 60) || overlaps(0, close);
};

/** Đang tạm tắt? (hết hẹn giờ pausedUntil thì coi như đã mở lại, kể cả trước khi job dọn kịp chạy) */
const isVendorPausedNow = (vendor, now = new Date()) => {
    if (!vendor?.isPaused) return false;
    if (vendor.pausedUntil && new Date(vendor.pausedUntil).getTime() <= now.getTime()) return false;
    return true;
};

/** VD: "07:00 18/10" theo giờ Việt Nam */
const formatReopenTime = (date) => {
    const d = new Date(date);
    const time = d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
    const day = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });
    return `${time} ${day}`;
};

const getVendorStatus = (vendor, options = {}) => {
    const { slotStart, slotEnd } = options;
    if (!vendor) {
        return { isOpen: false, message: 'Không tìm thấy thông tin quầy.' };
    }
    if (vendor.isActive === false) {
        return {
            isOpen: false,
            message: `Quầy "${vendor.name}" tạm ngưng nhận đơn (Admin).`,
            closedBy: 'admin',
        };
    }
    if (isVendorPausedNow(vendor)) {
        const reason = vendor.pauseReason?.trim();
        const reopen = vendor.pausedUntil ? ` — mở lại lúc ${formatReopenTime(vendor.pausedUntil)}` : '';
        return {
            isOpen: false,
            message: reason
                ? `Quầy "${vendor.name}" tạm tắt: ${reason}${reopen}`
                : `Quầy "${vendor.name}" tạm tắt nhận đơn — chủ quầy đang bận${reopen}.`,
            closedBy: 'vendor_pause',
            pausedUntil: vendor.pausedUntil || null,
        };
    }
    const isOpen = slotStart && slotEnd
        ? isVendorOpenForTimeRange(vendor.openTime, vendor.closeTime, slotStart, slotEnd)
        : isVendorOpenNow(vendor.openTime, vendor.closeTime);
    const slotLabel = slotStart && slotEnd ? `${slotStart} – ${slotEnd}` : null;
    return {
        isOpen,
        message: isOpen
            ? (slotLabel ? `Mở cửa trong khung ${slotLabel}` : 'Đang mở cửa')
            : slotLabel
                ? `Quầy "${vendor.name}" không phục vụ khung ${slotLabel}. Giờ quầy: ${vendor.openTime} – ${vendor.closeTime}.`
                : `Quầy "${vendor.name}" đã đóng cửa. Giờ phục vụ: ${vendor.openTime} – ${vendor.closeTime}.`
    };
};

const assertVendorsOpen = async (vendorIds, Vendor) => {
    const uniqueIds = [...new Set(vendorIds.filter(Boolean).map(String))];
    for (const id of uniqueIds) {
        const vendor = await Vendor.findById(id);
        const status = getVendorStatus(vendor);
        if (!status.isOpen) {
            return status;
        }
    }
    return { isOpen: true, message: '' };
};

module.exports = {
    timeToMinutes,
    isVendorOpenNow,
    isVendorOpenForTimeRange,
    getVendorStatus,
    assertVendorsOpen,
    isVendorPausedNow,
    formatReopenTime
};
