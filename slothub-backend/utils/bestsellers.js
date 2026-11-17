const Order = require('../models/Order');
const { VALID_STATUSES, startOfVnDay } = require('./demandStats');

/**
 * Món bán chạy toàn căng tin (dùng cho trang chủ sinh viên).
 *
 * Chỉ tính ĐƠN HỢP LỆ giống trang Thống kê của quầy: đã thanh toán + quầy đã nhận làm
 * (Processing / Ready / Completed). Xếp theo tổng số phần bán, hoà thì theo số đơn.
 *
 * Kỳ tính: hôm nay (giờ Việt Nam, từ 00:00). Sáng sớm chưa có đơn hợp lệ nào thì dùng
 * 7 ngày gần nhất (period = 'week') để trang chủ không bị trống.
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
 * @returns {Promise<{ period: 'today'|'week'|null, ranking: Array<{ menuItemId: string, sold: number, orderCount: number, rank: number }> }>}
 */
const getBestsellerRanking = async () => {
    if (cache.data && Date.now() - cache.at < CACHE_MS) return cache.data;

    const now = new Date();
    let period = 'today';
    let rows = await aggregateSold(startOfVnDay(now));
    if (!rows.length) {
        period = 'week';
        rows = await aggregateSold(new Date(startOfVnDay(now).getTime() - 6 * DAY_MS));
    }

    const data = {
        period: rows.length ? period : null,
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
