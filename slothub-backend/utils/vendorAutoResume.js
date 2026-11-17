const Vendor = require('../models/Vendor');

const CHECK_INTERVAL_MS = 60 * 1000;

/** Bật lại các quầy đã tới giờ hẹn mở lại (pausedUntil) */
const resumeExpiredPauses = async () => {
    try {
        const result = await Vendor.updateMany(
            { isPaused: true, pausedUntil: { $ne: null, $lte: new Date() } },
            { $set: { isPaused: false, pauseReason: '', pausedAt: null, pausedUntil: null } }
        );
        if (result.modifiedCount > 0) {
            console.log(`⏰ [Quầy] Tự động mở lại ${result.modifiedCount} quầy đã hết thời gian tạm tắt`);
        }
    } catch (err) {
        console.error('[vendorAutoResume]', err.message);
    }
};

/** Chạy mỗi phút; trạng thái quầy cũng tự tính hết hạn trong getVendorStatus nên không bị trễ */
const startVendorAutoResume = () => {
    resumeExpiredPauses();
    return setInterval(resumeExpiredPauses, CHECK_INTERVAL_MS);
};

module.exports = { startVendorAutoResume, resumeExpiredPauses };
