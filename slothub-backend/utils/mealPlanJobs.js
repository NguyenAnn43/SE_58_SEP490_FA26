const { runMealPlanJobs } = require('./mealPlanService');

const INTERVAL_MS = 60 * 1000;
let running = false;

/**
 * Mỗi phút: tạo đơn cho bữa gói đến ngày ăn, nhắc bữa chưa xếp ngày, đóng gói hết hạn (hoàn tiền).
 * Không chạy chồng lượt nếu lượt trước chưa xong.
 */
const tick = async (app) => {
    if (running) return;
    running = true;
    try {
        const r = await runMealPlanJobs({ req: app ? { app } : null });
        const { ordered, moved, skipped } = r.generated;
        if (ordered || moved || skipped || r.expired.closed || r.reminders.sent) {
            console.log(`🍱 [Gói ăn] tạo ${ordered} đơn, dời ${moved}, không phục vụ ${skipped}, nhắc ${r.reminders.sent}, đóng ${r.expired.closed} gói`);
        }
    } catch (err) {
        console.error('[mealPlanJobs]', err.message);
    } finally {
        running = false;
    }
};

const startMealPlanJobs = (app) => {
    setTimeout(() => tick(app), 5000); // đợi kết nối DB
    return setInterval(() => tick(app), INTERVAL_MS);
};

module.exports = { startMealPlanJobs, tick };
