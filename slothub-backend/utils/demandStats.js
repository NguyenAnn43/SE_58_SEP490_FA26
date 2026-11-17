const mongoose = require('mongoose');
const Order = require('../models/Order');

/**
 * Thống kê món nổi bật + dự báo nhu cầu cho chủ quầy.
 *
 * ĐƠN HỢP LỆ (dùng chung cho mọi số liệu): đã thanh toán (Paid) VÀ đã được quầy nhận làm
 * (Processing / Ready / Completed). Loại: chờ duyệt, bị từ chối, đã huỷ, đã hoàn tiền, chưa thanh toán.
 * Đơn trùng không phát sinh nhờ idempotencyKey khi tạo đơn.
 */
const VALID_STATUSES = ['Processing', 'Ready', 'Completed'];
const TZ = 'Asia/Ho_Chi_Minh';
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const MIN_WEEKS_FOR_FORECAST = 4;
const MAX_HISTORY_WEEKS = 26;
const DAMPING = 0.85; // xu hướng giảm dần: độ dốc nhân 0.85 mỗi tuần để không ngoại suy quá đà

const validMatch = (vendorId, from, to) => ({
    vendor: new mongoose.Types.ObjectId(String(vendorId)),
    paymentStatus: 'Paid',
    status: { $in: VALID_STATUSES },
    ...(from || to ? { createdAt: { ...(from && { $gte: from }), ...(to && { $lt: to }) } } : {}),
});

// ---------- Ngày giờ theo múi giờ Việt Nam ----------
const VN_OFFSET_MS = 7 * 60 * 60 * 1000;
const startOfVnDay = (d) => {
    const t = new Date(d).getTime() + VN_OFFSET_MS;
    return new Date(Math.floor(t / DAY_MS) * DAY_MS - VN_OFFSET_MS);
};
const startOfVnWeek = (d) => {
    const day = startOfVnDay(d);
    const dow = new Date(day.getTime() + VN_OFFSET_MS).getUTCDay(); // 0=CN
    const diff = (dow + 6) % 7; // về thứ Hai
    return new Date(day.getTime() - diff * DAY_MS);
};
const vnDateKey = (d) => new Date(new Date(d).getTime() + VN_OFFSET_MS).toISOString().slice(0, 10);

/** Khoảng thời gian từ query: from/to (YYYY-MM-DD, giờ VN) — mặc định 30 ngày gần nhất */
const parseRange = (query = {}) => {
    const now = new Date();
    const to = query.to ? new Date(startOfVnDay(new Date(`${query.to}T00:00:00+07:00`)).getTime() + DAY_MS) : new Date(startOfVnDay(now).getTime() + DAY_MS);
    const from = query.from ? startOfVnDay(new Date(`${query.from}T00:00:00+07:00`)) : new Date(to.getTime() - 30 * DAY_MS);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || from >= to) {
        const err = new Error('Khoảng thời gian không hợp lệ (from phải trước to).');
        err.status = 400;
        throw err;
    }
    if (to.getTime() - from.getTime() > 366 * DAY_MS) {
        const err = new Error('Khoảng thời gian tối đa 1 năm.');
        err.status = 400;
        throw err;
    }
    return { from, to };
};

// ===================== TOP MÓN =====================

const aggregateItems = (vendorId, from, to) => Order.aggregate([
    { $match: validMatch(vendorId, from, to) },
    { $unwind: '$items' },
    {
        $group: {
            _id: '$items.menuItem',
            orders: { $addToSet: '$_id' },
            quantity: { $sum: '$items.quantity' },
            revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
        },
    },
    { $project: { orderCount: { $size: '$orders' }, quantity: 1, revenue: 1 } },
    { $lookup: { from: 'menuitems', localField: '_id', foreignField: '_id', as: 'menu' } },
    {
        $project: {
            orderCount: 1, quantity: 1, revenue: 1,
            name: { $ifNull: [{ $arrayElemAt: ['$menu.name', 0] }, 'Món đã xoá'] },
            imageUrl: { $arrayElemAt: ['$menu.imageUrl', 0] },
            isAvailable: { $arrayElemAt: ['$menu.isAvailable', 0] },
        },
    },
]);

const getTopItems = async (vendorId, query = {}) => {
    const { from, to } = parseRange(query);
    const limit = Math.min(Math.max(Number(query.limit) || 10, 1), 50);
    const span = to.getTime() - from.getTime();
    const [current, previous, orderTotals] = await Promise.all([
        aggregateItems(vendorId, from, to),
        aggregateItems(vendorId, new Date(from.getTime() - span), from),
        Order.aggregate([
            { $match: validMatch(vendorId, from, to) },
            { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$totalPrice' } } },
        ]),
    ]);
    const prevMap = new Map(previous.map((p) => [String(p._id), p.quantity]));
    const totalQty = current.reduce((s, i) => s + i.quantity, 0);
    const items = current
        .sort((a, b) => (b.quantity - a.quantity) || (b.orderCount - a.orderCount))
        .slice(0, limit)
        .map((i, idx) => {
            const prev = prevMap.get(String(i._id)) || 0;
            return {
                rank: idx + 1,
                _id: i._id,
                name: i.name,
                imageUrl: i.imageUrl || '',
                isAvailable: i.isAvailable !== false,
                orderCount: i.orderCount,
                quantity: i.quantity,
                revenue: i.revenue,
                share: totalQty ? Math.round((i.quantity / totalQty) * 1000) / 10 : 0,
                previousQuantity: prev,
                changePct: prev ? Math.round(((i.quantity - prev) / prev) * 1000) / 10 : null,
            };
        });
    return {
        range: { from, to: new Date(to.getTime() - 1) },
        totals: {
            orders: orderTotals[0]?.orders || 0,
            revenue: orderTotals[0]?.revenue || 0,
            quantity: totalQty,
            distinctItems: current.length,
        },
        items,
        generatedAt: new Date(),
    };
};

// ===================== CHUỖI THỜI GIAN (biểu đồ) =====================

const getTimeseries = async (vendorId, query = {}) => {
    const { from, to } = parseRange(query);
    const granularity = query.granularity === 'week' ? 'week' : 'day';
    const bucketExpr = granularity === 'week'
        ? { $dateTrunc: { date: '$createdAt', unit: 'week', startOfWeek: 'monday', timezone: TZ } }
        : { $dateTrunc: { date: '$createdAt', unit: 'day', timezone: TZ } };

    const [totals, perItem, top] = await Promise.all([
        Order.aggregate([
            { $match: validMatch(vendorId, from, to) },
            { $group: { _id: bucketExpr, orders: { $sum: 1 }, revenue: { $sum: '$totalPrice' }, quantity: { $sum: { $sum: '$items.quantity' } } } },
        ]),
        Order.aggregate([
            { $match: validMatch(vendorId, from, to) },
            { $unwind: '$items' },
            { $group: { _id: { bucket: bucketExpr, item: '$items.menuItem' }, quantity: { $sum: '$items.quantity' } } },
        ]),
        aggregateItems(vendorId, from, to),
    ]);

    const topItems = top.sort((a, b) => b.quantity - a.quantity).slice(0, 5).map((i) => ({ _id: String(i._id), name: i.name }));
    const topIds = new Set(topItems.map((i) => i._id));

    // Đủ mọi mốc thời gian (kể cả ngày/tuần không có đơn = 0)
    const buckets = [];
    const step = granularity === 'week' ? WEEK_MS : DAY_MS;
    for (let t = (granularity === 'week' ? startOfVnWeek(from) : startOfVnDay(from)).getTime(); t < to.getTime(); t += step) {
        buckets.push(new Date(t));
    }
    const key = (d) => vnDateKey(d);
    const rows = new Map(buckets.map((b) => [key(b), { date: key(b), orders: 0, quantity: 0, revenue: 0 }]));
    for (const t of totals) {
        const row = rows.get(key(t._id));
        if (row) Object.assign(row, { orders: t.orders, quantity: t.quantity, revenue: t.revenue });
    }
    for (const p of perItem) {
        const id = String(p._id.item);
        if (!topIds.has(id)) continue;
        const row = rows.get(key(p._id.bucket));
        if (row) row[id] = p.quantity;
    }
    const series = [...rows.values()].map((r) => {
        topItems.forEach((i) => { if (r[i._id] == null) r[i._id] = 0; });
        return r;
    });
    return { range: { from, to: new Date(to.getTime() - 1) }, granularity, topItems, series, generatedAt: new Date() };
};

// ===================== DỰ BÁO NHU CẦU =====================

/** Hồi quy tuyến tính bình phương tối thiểu y = a + b·t */
const linearRegression = (ys) => {
    const n = ys.length;
    const xs = ys.map((_, i) => i);
    const mx = xs.reduce((s, x) => s + x, 0) / n;
    const my = ys.reduce((s, y) => s + y, 0) / n;
    let sxy = 0;
    let sxx = 0;
    for (let i = 0; i < n; i++) {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx) ** 2;
    }
    const b = sxx ? sxy / sxx : 0;
    const a = my - b * mx;
    let ssRes = 0;
    let ssTot = 0;
    for (let i = 0; i < n; i++) {
        const fit = a + b * xs[i];
        ssRes += (ys[i] - fit) ** 2;
        ssTot += (ys[i] - my) ** 2;
    }
    const sigma = n > 2 ? Math.sqrt(ssRes / (n - 2)) : 0;
    const r2 = ssTot ? Math.max(0, 1 - ssRes / ssTot) : 0;
    return { a, b, sigma, r2, mean: my };
};

const confidenceLabel = (weeks, r2, mean, sigma) => {
    const cv = mean > 0 ? sigma / mean : 1;
    if (weeks >= 12 && (r2 >= 0.5 || cv <= 0.25)) return 'Cao';
    if (weeks >= 8 && cv <= 0.6) return 'Trung bình';
    return 'Thấp';
};

const getForecast = async (vendorId, query = {}) => {
    const horizonDays = Number(query.horizonDays) === 60 ? 60 : 30;
    const horizonWeeks = Math.ceil(horizonDays / 7);
    const thisWeek = startOfVnWeek(new Date());           // tuần hiện tại chưa trọn → không đưa vào mô hình
    const historyEnd = thisWeek;

    const first = await Order.findOne(validMatch(vendorId)).sort({ createdAt: 1 }).select('createdAt').lean();
    const base = {
        method: `Hồi quy tuyến tính (bình phương tối thiểu) trên số phần bán theo tuần của từng món, xu hướng giảm dần (damped, φ=${DAMPING}) khi ngoại suy; khoảng dự báo ~80% = ±1.28·σ·√(số tuần).`,
        horizon: { days: horizonDays, weeks: horizonWeeks, from: thisWeek, to: new Date(thisWeek.getTime() + horizonWeeks * WEEK_MS - 1) },
        validOrderRule: 'Chỉ tính đơn đã thanh toán và được quầy nhận làm (Đang làm / Sẵn sàng / Hoàn thành); loại đơn chờ duyệt, bị từ chối, đã huỷ hoặc hoàn tiền.',
        generatedAt: new Date(),
    };
    if (!first) {
        return { ...base, sufficient: false, weeksOfData: 0, message: 'Quầy chưa có đơn hợp lệ nào — chưa thể thống kê hay dự báo.', items: [], overall: { history: [], forecast: [] } };
    }

    const firstWeek = startOfVnWeek(first.createdAt);
    const weeksAvailable = Math.max(0, Math.round((historyEnd.getTime() - firstWeek.getTime()) / WEEK_MS));
    const n = Math.min(weeksAvailable, MAX_HISTORY_WEEKS);
    const historyStart = new Date(historyEnd.getTime() - n * WEEK_MS);

    const rows = n > 0 ? await Order.aggregate([
        { $match: validMatch(vendorId, historyStart, historyEnd) },
        { $unwind: '$items' },
        {
            $group: {
                _id: { week: { $dateTrunc: { date: '$createdAt', unit: 'week', startOfWeek: 'monday', timezone: TZ } }, item: '$items.menuItem' },
                quantity: { $sum: '$items.quantity' },
            },
        },
        { $lookup: { from: 'menuitems', localField: '_id.item', foreignField: '_id', as: 'menu' } },
        { $project: { quantity: 1, name: { $ifNull: [{ $arrayElemAt: ['$menu.name', 0] }, 'Món đã xoá'] }, imageUrl: { $arrayElemAt: ['$menu.imageUrl', 0] } } },
    ]) : [];

    const weekIndex = (d) => Math.round((startOfVnWeek(d).getTime() - historyStart.getTime()) / WEEK_MS);
    const weeks = Array.from({ length: n }, (_, i) => new Date(historyStart.getTime() + i * WEEK_MS));
    const byItem = new Map();
    const overallSeries = new Array(n).fill(0);
    for (const r of rows) {
        const idx = weekIndex(r._id.week);
        if (idx < 0 || idx >= n) continue;
        const id = String(r._id.item);
        if (!byItem.has(id)) byItem.set(id, { _id: id, name: r.name, imageUrl: r.imageUrl || '', series: new Array(n).fill(0) });
        byItem.get(id).series[idx] += r.quantity;
        overallSeries[idx] += r.quantity;
    }

    const result = {
        ...base,
        historyRange: { from: historyStart, to: new Date(historyEnd.getTime() - 1), weeks: n },
        weeksOfData: weeksAvailable,
    };

    // Không đủ dữ liệu → chỉ trả thống kê mô tả, KHÔNG dự báo
    if (n < MIN_WEEKS_FOR_FORECAST) {
        const items = [...byItem.values()].map((it) => {
            const total = it.series.reduce((s, v) => s + v, 0);
            return { _id: it._id, name: it.name, imageUrl: it.imageUrl, historyTotal: total, historyWeeklyAvg: n ? Math.round((total / n) * 10) / 10 : 0 };
        }).sort((a, b) => b.historyTotal - a.historyTotal);
        return {
            ...result,
            sufficient: false,
            message: `Mới có ${n} tuần dữ liệu trọn vẹn (cần tối thiểu ${MIN_WEEKS_FOR_FORECAST} tuần) — chỉ hiển thị thống kê mô tả, chưa dự báo.`,
            items,
            overall: { history: weeks.map((w, i) => ({ week: vnDateKey(w), quantity: overallSeries[i] })), forecast: [] },
        };
    }

    const project = (series) => {
        const reg = linearRegression(series);
        // Mức hiện tại = giá trị khớp ở tuần cuối; độ dốc cộng dồn giảm dần φ + φ² + ... (damped trend)
        const level = reg.a + reg.b * (n - 1);
        const points = Array.from({ length: horizonWeeks }, (_, h) => {
            const damp = (DAMPING * (1 - DAMPING ** (h + 1))) / (1 - DAMPING);
            return Math.max(0, level + reg.b * damp);
        });
        const scale = horizonDays / (horizonWeeks * 7);              // 30 ngày ≈ 4.3 tuần
        const total = points.reduce((s, v) => s + v, 0) * scale;
        const margin = 1.28 * reg.sigma * Math.sqrt(horizonWeeks) * scale;
        const recent = series.slice(-4);
        const recentAvg = recent.reduce((s, v) => s + v, 0) / recent.length;
        const forecastWeeklyAvg = points.reduce((s, v) => s + v, 0) / horizonWeeks;
        const changePct = recentAvg > 0 ? ((forecastWeeklyAvg - recentAvg) / recentAvg) * 100 : (forecastWeeklyAvg > 0 ? 100 : 0);
        return { reg, points, total, margin, recentAvg, forecastWeeklyAvg, changePct };
    };

    const items = [...byItem.values()].map((it) => {
        const p = project(it.series);
        const trend = p.changePct > 10 ? 'up' : p.changePct < -10 ? 'down' : 'stable';
        return {
            _id: it._id,
            name: it.name,
            imageUrl: it.imageUrl,
            historyTotal: it.series.reduce((s, v) => s + v, 0),
            recentWeeklyAvg: Math.round(p.recentAvg * 10) / 10,
            forecastWeeklyAvg: Math.round(p.forecastWeeklyAvg * 10) / 10,
            forecastTotal: Math.round(p.total),
            low: Math.max(0, Math.round(p.total - p.margin)),
            high: Math.round(p.total + p.margin),
            changePct: Math.round(p.changePct * 10) / 10,
            trend,
            confidence: confidenceLabel(n, p.reg.r2, p.reg.mean, p.reg.sigma),
            r2: Math.round(p.reg.r2 * 100) / 100,
        };
    }).sort((a, b) => b.forecastTotal - a.forecastTotal);

    const overall = project(overallSeries);
    const weeklyMargin = 1.28 * overall.reg.sigma;
    return {
        ...result,
        sufficient: true,
        message: `Dự báo ${horizonDays} ngày tới dựa trên ${n} tuần dữ liệu (${vnDateKey(historyStart)} → ${vnDateKey(new Date(historyEnd.getTime() - 1))}).`,
        overall: {
            history: weeks.map((w, i) => ({ week: vnDateKey(w), quantity: overallSeries[i] })),
            forecast: overall.points.map((q, h) => ({
                week: vnDateKey(new Date(thisWeek.getTime() + h * WEEK_MS)),
                quantity: Math.round(q * 10) / 10,
                low: Math.max(0, Math.round((q - weeklyMargin) * 10) / 10),
                high: Math.round((q + weeklyMargin) * 10) / 10,
            })),
            total: Math.round(overall.total),
            low: Math.max(0, Math.round(overall.total - overall.margin)),
            high: Math.round(overall.total + overall.margin),
            confidence: confidenceLabel(n, overall.reg.r2, overall.reg.mean, overall.reg.sigma),
            changePct: Math.round(overall.changePct * 10) / 10,
        },
        items,
        rising: items.filter((i) => i.trend === 'up').slice(0, 5),
        falling: items.filter((i) => i.trend === 'down').slice(0, 5),
    };
};

module.exports = { getTopItems, getTimeseries, getForecast, VALID_STATUSES, linearRegression, startOfVnDay };
