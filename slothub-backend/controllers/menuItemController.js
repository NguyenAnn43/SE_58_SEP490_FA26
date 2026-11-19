const MenuItem = require('../models/MenuItem');
const TimeSlot = require('../models/TimeSlot');
const { getVendorStatus } = require('../utils/vendorHours');
const { withPricing } = require('../utils/pricing');
const { getBestsellerRanking } = require('../utils/bestsellers');

const VENDOR_FIELDS = 'name openTime closeTime isActive isPaused pauseReason pausedUntil';
const BESTSELLER_LIMIT_DEFAULT = 5;

/** Gắn hạng bán chạy (nếu món nằm trong top) vào từng món */
const attachBestseller = (items, { period, ranking }) => {
    const byId = new Map(ranking.map((r) => [r.menuItemId, r]));
    return items.map((item) => {
        const r = byId.get(String(item._id));
        return r
            ? { ...item, bestsellerRank: r.rank, soldInPeriod: r.sold, bestsellerPeriod: period }
            : { ...item, bestsellerRank: null, soldInPeriod: 0, bestsellerPeriod: null };
    });
};

/**
 * Thứ tự hiển thị: món đặt được trước → đang giảm giá (giảm nhiều trước) → bán chạy (hạng cao trước)
 * → còn lại giữ thứ tự cũ. Món của quầy đóng / hết hàng luôn ở cuối.
 */
const compareForDisplay = (a, b) => {
    const orderableA = a.isAvailable !== false && a.vendorIsOpen !== false && (a.countInStock ?? 1) > 0;
    const orderableB = b.isAvailable !== false && b.vendorIsOpen !== false && (b.countInStock ?? 1) > 0;
    if (orderableA !== orderableB) return orderableA ? -1 : 1;
    if (a.discountActive !== b.discountActive) return a.discountActive ? -1 : 1;
    if (a.discountActive && b.discountActive && a.discountPercent !== b.discountPercent) {
        return b.discountPercent - a.discountPercent;
    }
    const rankA = a.bestsellerRank ?? Infinity;
    const rankB = b.bestsellerRank ?? Infinity;
    if (rankA !== rankB) return rankA - rankB;
    return 0;
};

const getAllMenuItems = async (req, res) => {
    try {
        let slotOpts = {};
        if (req.query.slotId) {
            const slot = await TimeSlot.findById(req.query.slotId);
            if (slot?.isActive !== false) {
                slotOpts = { slotStart: slot.startTime, slotEnd: slot.endTime };
            }
        }

        const [menu, bestsellers] = await Promise.all([
            // Trả cả món chủ quầy đã tắt (isAvailable=false) → FE vẫn hiện, gắn nhãn "Tạm hết món", không cho đặt
            MenuItem.find({}).populate('vendor', VENDOR_FIELDS),
            getBestsellerRanking(),
        ]);
        const now = new Date();
        const result = menu.map((item) => {
            const statusNow = getVendorStatus(item.vendor);
            const statusInSlot = slotOpts.slotStart
                ? getVendorStatus(item.vendor, slotOpts)
                : statusNow;
            return {
                ...withPricing(item, now),
                vendorIsOpen: statusInSlot.isOpen,
                vendorOpenNow: statusNow.isOpen,
                vendorStatusMessage: statusInSlot.message,
                vendorStatusNowMessage: statusNow.message,
                vendorClosedByNow: statusNow.closedBy || (statusNow.isOpen ? null : 'hours'),
                ...(slotOpts.slotStart && {
                    pickupSlotLabel: `${slotOpts.slotStart} – ${slotOpts.slotEnd}`
                })
            };
        });
        res.status(200).json(attachBestseller(result, bestsellers).sort(compareForDisplay));
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy danh sách món', error: error.message });
    }
};

/**
 * [GET] /api/menuitems/bestsellers?limit=5 — món bán chạy hôm nay (hoặc 7 ngày gần nhất nếu hôm nay chưa có đơn).
 * Chỉ trả món đang bán; giá đã áp dụng giảm giá.
 */
const getBestsellers = async (req, res) => {
    try {
        const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || BESTSELLER_LIMIT_DEFAULT, 1), 10);
        const { period, ranking } = await getBestsellerRanking();
        if (!ranking.length) return res.status(200).json({ period: null, items: [] });

        const docs = await MenuItem.find({
            _id: { $in: ranking.map((r) => r.menuItemId) },
            isAvailable: true,
        }).populate('vendor', VENDOR_FIELDS);
        const byId = new Map(docs.map((d) => [String(d._id), d]));
        const now = new Date();

        const items = ranking
            .filter((r) => byId.has(r.menuItemId))
            .slice(0, limit)
            .map((r, i) => {
                const doc = byId.get(r.menuItemId);
                const status = getVendorStatus(doc.vendor);
                return {
                    ...withPricing(doc, now),
                    bestsellerRank: i + 1,
                    soldInPeriod: r.sold,
                    bestsellerPeriod: period,
                    vendorIsOpen: status.isOpen,
                    vendorOpenNow: status.isOpen,
                    vendorStatusMessage: status.message,
                };
            });
        res.status(200).json({ period, items });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy món bán chạy', error: error.message });
    }
};

const getVendorMenu = async (req, res) => {
    try {
        const menu = await MenuItem.find({ vendor: req.params.vendorId }).sort({ isAvailable: -1 });
        const now = new Date();
        res.status(200).json(menu.map((m) => withPricing(m, now)));
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy menu', error: error.message });
    }
};

const getMenuItemById = async (req, res) => {
    try {
        const item = await MenuItem.findById(req.params.id).populate('vendor', VENDOR_FIELDS);
        if (!item) return res.status(404).json({ message: 'Không tìm thấy món ăn này!' });
        const status = getVendorStatus(item.vendor);
        res.status(200).json({
            ...withPricing(item),
            vendorIsOpen: status.isOpen,
            vendorStatusMessage: status.message
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy chi tiết món', error: error.message });
    }
};

module.exports = {
    getAllMenuItems,
    getBestsellers,
    getVendorMenu,
    getMenuItemById,
    compareForDisplay,
};
