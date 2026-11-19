const MenuItem = require('../models/MenuItem');
const Order = require('../models/Order');
const Vendor = require('../models/Vendor');
const TimeSlot = require('../models/TimeSlot');
const { getVendorStatus } = require('../utils/vendorHours');
const { notifyVendorNewReview } = require('../utils/vendorNotify');
const { persistMenuItemReview } = require('../utils/persistence');
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

const createMenuItem = async (req, res) => {
    try {
        const { vendorId, name, price, description, imageUrl, category, dailyQuota } = req.body;
        const vendor = await Vendor.findById(vendorId);
        if (!vendor) return res.status(404).json({ message: 'Gian hàng không tồn tại' });

        if (vendor.owner.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Bạn không phải chủ gian hàng này!' });
        }

        const newItem = new MenuItem({
            vendor: vendorId, name, price, description, imageUrl, category, dailyQuota
        });

        await newItem.save();
        res.status(201).json({ message: 'Đã thêm món mới vào Menu!', item: newItem });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi thêm món', error: error.message });
    }
};

const toggleItemAvailability = async (req, res) => {
    try {
        const item = await MenuItem.findById(req.params.itemId).populate('vendor');
        if (!item) return res.status(404).json({ message: 'Không tìm thấy món' });

        if (item.vendor.owner.toString() !== req.user.id && req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Không có quyền truy cập' });
        }

        item.isAvailable = !item.isAvailable;
        await item.save();

        res.status(200).json({
            message: `Đã chuyển trạng thái món thành: ${item.isAvailable ? 'Còn bán' : 'Hết món'}`,
            item
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi cập nhật món', error: error.message });
    }
};

const createMenuItemReview = async (req, res) => {
    try {
        const { rating, comment } = req.body;
        const menuItemId = req.params.id;

        if (req.user.role !== 'student') {
            return res.status(403).json({ message: 'Chỉ khách hàng mới được đánh giá món ăn.' });
        }
        const stars = Number(rating);
        if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
            return res.status(400).json({ message: 'Số sao phải từ 1 đến 5.' });
        }
        if (!comment || !String(comment).trim()) {
            return res.status(400).json({ message: 'Vui lòng nhập nhận xét về món ăn.' });
        }

        const menuItem = await MenuItem.findById(menuItemId);
        if (!menuItem) return res.status(404).json({ message: 'Không tìm thấy món ăn này!' });

        // UC-27: chỉ đánh giá khi đã nhận món (đơn Completed có chứa món này)
        const hasEaten = await Order.exists({
            user: req.user.id,
            status: 'Completed',
            'items.menuItem': menuItem._id
        });
        if (!hasEaten) {
            return res.status(403).json({
                message: 'Bạn chỉ có thể đánh giá món sau khi đã đặt và nhận món này thành công.'
            });
        }

        const alreadyReviewed = menuItem.reviews.find(r => r.user.toString() === req.user.id.toString());
        if (alreadyReviewed) return res.status(400).json({ message: 'Bạn đã đánh giá món ăn này rồi!' });

        const review = {
            user: req.user.id,
            name: req.user.name,
            avatar: req.user.avatar,
            rating: stars,
            comment: String(comment).trim()
        };

        menuItem.reviews.push(review);
        menuItem.numReviews = menuItem.reviews.length;
        const totalStars = menuItem.reviews.reduce((acc, item) => item.rating + acc, 0);
        menuItem.rating = totalStars / menuItem.numReviews;

        await menuItem.save();
        const updatedItem = await MenuItem.findById(menuItemId).populate('vendor', 'name');

        await persistMenuItemReview({
            menuItem,
            user: req.user,
            rating: stars,
            comment: review.comment
        });
        await notifyVendorNewReview(req, menuItem, review, req.user);

        res.status(201).json({ message: '🎉 Cảm ơn bạn đã đánh giá món ăn!', menuItem: updatedItem });

    } catch (error) {
        res.status(500).json({ message: 'Lỗi server khi gửi đánh giá', error: error.message });
    }
};

const estimateCalories = async (req, res) => {
    try {
        const { imageUrl, name, description } = req.body;
        if (!imageUrl) {
            return res.status(400).json({ message: 'Vui lòng cung cấp link ảnh món ăn!' });
        }

        const response = await fetch(imageUrl);
        if (!response.ok) {
            return res.status(400).json({ message: 'Không thể tải ảnh từ link cung cấp!' });
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        
        // 🛡️ Xử lý MIME type sạch (tránh các params đi kèm như charset)
        let mimeType = response.headers.get('content-type') || 'image/jpeg';
        mimeType = mimeType.split(';')[0].trim();
        if (!mimeType.startsWith('image/')) {
            mimeType = 'image/jpeg'; // fallback
        }
        
        const base64Data = buffer.toString('base64');

        const { generateWithFallback } = require('../utils/geminiClient');
        // Model lấy từ GEMINI_MODEL (.env), tự chuyển model khác khi quá tải
        const generationConfig = {
            responseMimeType: 'application/json',
            temperature: 0.1 // 🌟 Đặt temperature thấp để kết quả nhất quán giữa các lần quét
        };

        const prompt = `
Bạn là chuyên gia dinh dưỡng của SlotHub. Hãy phân tích hình ảnh đĩa thức ăn được cung cấp kết hợp với thông tin sau để ước lượng tổng lượng calo (kcal) cho một phần ăn thông thường này:
- Tên món ăn: ${name || 'Chưa rõ'}
- Mô tả món ăn: ${description || 'Không có mô tả'}

Hãy phân tích thật kỹ các thành phần món ăn phát hiện được trong ảnh và đối chiếu với tên món ăn để đưa ra con số calo chuẩn xác, hợp lý và nhất quán nhất.

Trả về kết quả dưới dạng một đối tượng JSON khớp chính xác với cấu trúc sau:
{
  "calories": number (chỉ chứa số calo ước lượng dạng số nguyên, ví dụ: 450),
  "explanation": "string (giải thích ngắn gọn bằng tiếng Việt dưới 30 từ về các thành phần món ăn phát hiện được và calo ước lượng tương ứng)"
}
Chỉ trả về chuỗi JSON thô, không kèm định dạng block code markdown (như \`\`\`json).
`;

        const part = {
            inlineData: {
                data: base64Data,
                mimeType
            }
        };

        const { result } = await generateWithFallback([prompt, part], generationConfig);
        const resultText = result.response.text();
        
        // 🛡️ Đề phòng Gemini phản hồi JSON nằm trong block markdown ```json ... ```
        let cleanText = resultText.trim();
        if (cleanText.startsWith('```')) {
            cleanText = cleanText.replace(/^```json\s*/i, '').replace(/```$/, '').trim();
        }
        
        const data = JSON.parse(cleanText);

        res.status(200).json({
            success: true,
            calories: data.calories,
            explanation: data.explanation
        });

    } catch (error) {
        console.error('❌ LỖI TÍNH CALO QUA GEMINI:', error);
        res.status(500).json({ message: 'Không thể tự động tính calo cho ảnh này!', error: error.message });
    }
};

module.exports = {
    getAllMenuItems, getBestsellers, getVendorMenu, getMenuItemById, compareForDisplay,
    createMenuItem, toggleItemAvailability, createMenuItemReview,
    estimateCalories
};
