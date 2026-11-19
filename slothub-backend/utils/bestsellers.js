const Order = require('../models/Order');
const { VALID_STATUSES, startOfVnDay } = require('./demandStats');

/**
 * Món bán chạy toàn căng tin (dùng cho trang chủ sinh viên).
 *
 * Chỉ tính ĐƠN HỢP LỆ giống trang Thống kê của quầy: đã thanh toán + quầy đã nhận làm
 * (Processing / Ready / Completed). Xếp theo tổng số phần bán, hoà thì theo số đơn.
 *
 * Kỳ tính (lùi dần cho đến khi có dữ liệu, để trang chủ không bị trống):
 *   'today' — hôm nay (giờ Việt Nam, từ 00:00)
 *   'week'  — 7 ngày gần nhất (VD sáng sớm chưa có đơn hợp lệ nào)
 *   'month' — 30 ngày gần nhất (căng tin vắng đơn cả tuần, VD nghỉ lễ)
 * Kết quả được cache 60 giây — trang chủ gọi nhiều nhưng số liệu không cần tức thời.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const CACHE_MS = 60 * 1000;
const MAX_RANK = 10;

let cache = { at: 0, data: null };

const aggregateSold = (from) => Order.aggregate([
    { $match: { paymentStatus: 'Paid', status: { $in: VALID_STATUSES }, createdAt: { $gte: from } } },
    { $unwind: '$items' },
    {
        $group: {
            _id: '$items.menuItem',
            sold: { $sum: '$items.quantity' },
            orders: { $addToSet: '$_id' },
        },
    },
    { $project: { sold: 1, orderCount: { $size: '$orders' } } },
    { $sort: { sold: -1, orderCount: -1, _id: 1 } },
    { $limit: MAX_RANK * 3 },
]);

/**
 * @returns {Promise<{ period: 'today'|'week'|'month'|null, ranking: Array<{ menuItemId: string, sold: number, orderCount: number, rank: number }> }>}
 */
const getBestsellerRanking = async () => {
    if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;

    const today = startOfVnDay(new Date());
    const periods = [
        ['today', today],
        ['week', new Date(today.getTime() - 6 * DAY_MS)],
        ['month', new Date(today.getTime() - 29 * DAY_MS)],
    ];
    let period = null;
    let rows = [];
    for (const [name, from] of periods) {
        rows = await aggregateSold(from);
        if (rows.length) { period = name; break; }
    }

    const data = {
        period,
        ranking: rows
            .filter((r) => r._id)
            .slice(0, MAX_RANK)
            .map((r, i) => ({ menuItemId: String(r._id), sold: r.sold, orderCount: r.orderCount, rank: i + 1 })),
    };
    cache = { at: Date.now(), data };
    return data;
};

/** Xoá cache (dùng khi test) */
const clearBestsellerCache = () => { cache = { at: 0, data: null }; };

module.exports = { getBestsellerRanking, clearBestsellerCache, MAX_RANK };
