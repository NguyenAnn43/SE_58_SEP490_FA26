const mongoose = require('mongoose');
const Favorite = require('../models/Favorite');
const MenuItem = require('../models/MenuItem');
const { getVendorStatus } = require('../utils/vendorHours');
const { getEffectivePrice, isDiscountActive } = require('../utils/pricing');

/**
 * Favorite List của sinh viên — luôn theo user lấy từ token (không nhận userId từ client),
 * nên sinh viên chỉ xem / sửa được danh sách của chính mình.
 */

const isValidId = (id) => mongoose.Types.ObjectId.isValid(String(id || ''));

/** Trạng thái món để hiển thị: còn bán / hết hàng / ngừng bán / quầy đóng / đã xoá */
const availabilityOf = (item) => {
    if (!item) return { code: 'DELETED', label: 'Món đã bị xoá khỏi thực đơn', canOrder: false };
    if (item.isAvailable === false) return { code: 'STOPPED', label: 'Quầy đã ngừng bán món này', canOrder: false };
    if (item.countInStock != null && item.countInStock <= 0) return { code: 'OUT_OF_STOCK', label: 'Tạm hết hàng', canOrder: false };
    if (!item.vendor || item.vendor.isActive === false) return { code: 'VENDOR_LOCKED', label: 'Quầy tạm ngưng hoạt động', canOrder: false };
    const status = getVendorStatus(item.vendor);
    if (!status.isOpen) return { code: 'VENDOR_CLOSED', label: status.message, canOrder: true, note: 'Có thể đặt trước cho khung giờ quầy mở' };
    return { code: 'AVAILABLE', label: 'Đang bán', canOrder: true };
};

// [GET] /api/favorites — danh sách món yêu thích kèm giá, đánh giá, trạng thái hiện tại
const getMyFavorites = async (req, res) => {
    try {
        const favorites = await Favorite.find({ user: req.user._id })
            .sort({ createdAt: -1 })
            .populate({
                path: 'menuItem',
                select: 'name price discountPercent discountStartAt discountEndAt imageUrl calories rating numReviews isAvailable countInStock description vendor category',
                populate: { path: 'vendor', select: 'name openTime closeTime isActive isPaused pauseReason pausedUntil' },
            })
            .lean();

        const now = new Date();
        const items = favorites.map((f) => {
            const m = f.menuItem;
            const availability = availabilityOf(m);
            const discountActive = !!m && isDiscountActive(m, now);
            return {
                favoriteId: f._id,
                menuItemId: m?._id || null,
                addedAt: f.createdAt,
                name: m?.name || f.snapshot?.name || 'Món đã xoá',
                imageUrl: m?.imageUrl || f.snapshot?.imageUrl || '',
                // price = giá đang bán (đã trừ giảm giá); priceChanged so trên giá gốc
                price: m ? getEffectivePrice(m, now) : (f.snapshot?.price ?? null),
                originalPrice: m?.price ?? null,
                discountActive,
                discountPercent: discountActive ? m.discountPercent : 0,
                priceChanged: !!m && f.snapshot?.price != null && f.snapshot.price !== m.price,
                previousPrice: f.snapshot?.price ?? null,
                calories: m?.calories ?? null,
                rating: m && m.numReviews > 0 ? Math.round((m.rating || 0) * 10) / 10 : null,
                numReviews: m?.numReviews || 0,
                description: m?.description || '',
                category: m?.category || '',
                vendor: m?.vendor ? { _id: m.vendor._id, name: m.vendor.name } : { name: f.snapshot?.vendorName || '' },
                availability,
            };
        });
        res.status(200).json({ count: items.length, items });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy danh sách yêu thích', error: error.message });
    }
};

// [GET] /api/favorites/ids — danh sách id món đã thích (để tô trái tim trên thẻ món)
const getMyFavoriteIds = async (req, res) => {
    try {
        const ids = await Favorite.find({ user: req.user._id }).distinct('menuItem');
        res.status(200).json({ ids: ids.map(String) });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy danh sách yêu thích', error: error.message });
    }
};

// [GET] /api/favorites/:menuItemId/status
const getFavoriteStatus = async (req, res) => {
    try {
        if (!isValidId(req.params.menuItemId)) return res.status(400).json({ message: 'Mã món không hợp lệ.' });
        const exists = await Favorite.exists({ user: req.user._id, menuItem: req.params.menuItemId });
        res.status(200).json({ menuItemId: req.params.menuItemId, isFavorite: !!exists });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi kiểm tra yêu thích', error: error.message });
    }
};

// [POST] /api/favorites/:menuItemId — thêm (không trùng; thêm lại món đã có → 200)
const addFavorite = async (req, res) => {
    try {
        const { menuItemId } = req.params;
        if (!isValidId(menuItemId)) return res.status(400).json({ message: 'Mã món không hợp lệ.' });
        const item = await MenuItem.findById(menuItemId).populate('vendor', 'name').lean();
        if (!item) return res.status(404).json({ message: 'Không tìm thấy món ăn.' });

        // upsert nguyên tử + unique index → không bao giờ tạo bản ghi trùng, kể cả khi bấm liên tục
        const result = await Favorite.updateOne(
            { user: req.user._id, menuItem: item._id },
            {
                $setOnInsert: {
                    user: req.user._id,
                    menuItem: item._id,
                    snapshot: { name: item.name, imageUrl: item.imageUrl || '', price: item.price, vendorName: item.vendor?.name || '' },
                },
            },
            { upsert: true }
        );
        const created = result.upsertedCount > 0;
        res.status(created ? 201 : 200).json({
            message: created ? `Đã thêm "${item.name}" vào món yêu thích.` : `"${item.name}" đã có trong món yêu thích.`,
            menuItemId: String(item._id),
            isFavorite: true,
            created,
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(200).json({ message: 'Món đã có trong danh sách yêu thích.', menuItemId: req.params.menuItemId, isFavorite: true, created: false });
        }
        res.status(500).json({ message: 'Lỗi thêm món yêu thích', error: error.message });
    }
};

// [DELETE] /api/favorites/:menuItemId
const removeFavorite = async (req, res) => {
    try {
        const { menuItemId } = req.params;
        if (!isValidId(menuItemId)) return res.status(400).json({ message: 'Mã món không hợp lệ.' });
        const result = await Favorite.deleteOne({ user: req.user._id, menuItem: menuItemId });
        if (!result.deletedCount) return res.status(404).json({ message: 'Món không có trong danh sách yêu thích của bạn.' });
        res.status(200).json({ message: 'Đã bỏ khỏi món yêu thích.', menuItemId, isFavorite: false });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi xoá món yêu thích', error: error.message });
    }
};

module.exports = { getMyFavorites, getMyFavoriteIds, getFavoriteStatus, addFavorite, removeFavorite };
