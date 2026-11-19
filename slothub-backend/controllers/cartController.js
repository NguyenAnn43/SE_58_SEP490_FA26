const Cart = require('../models/Cart');
const MenuItem = require('../models/MenuItem');
const Vendor = require('../models/Vendor');
const { getVendorStatus } = require('../utils/vendorHours');
const { getEffectivePrice, withPricing } = require('../utils/pricing');

const CART_POPULATE = {
    path: 'items.menuItem',
    populate: { path: 'vendor', select: 'name openTime closeTime isActive isPaused pauseReason pausedUntil' }
};

const buildCartResponse = (cart) => {
    let totalPrice = 0;
    const vendorStatuses = {};
    const now = new Date();

    cart.items.forEach((i) => {
        if (i.menuItem?.price) totalPrice += getEffectivePrice(i.menuItem, now) * i.quantity;
    });

    for (const i of cart.items) {
        const v = i.menuItem?.vendor;
        if (!v || typeof v !== 'object') continue;
        const vid = String(v._id);
        if (vendorStatuses[vid]) continue;
        vendorStatuses[vid] = {
            ...getVendorStatus(v),
            name: v.name || 'Quầy'
        };
    }

    const vendorIds = Object.keys(vendorStatuses);
    const anyOpen = vendorIds.length === 0 || vendorIds.some((vid) => vendorStatuses[vid].isOpen);
    const allClosed = vendorIds.length > 0 && vendorIds.every((vid) => !vendorStatuses[vid].isOpen);
    const vendorOpen = !allClosed;
    const vendorStatusMessage = allClosed
        ? vendorIds.map((vid) => vendorStatuses[vid].message).find(Boolean) || 'Các quầy trong giỏ đã đóng cửa.'
        : '';

    const plain = cart.toObject();
    // Giá từng món trong giỏ = giá đang bán (đã trừ giảm giá), kèm giá gốc để hiển thị gạch ngang
    plain.items = (plain.items || []).map((i) => (
        i.menuItem && typeof i.menuItem === 'object' ? { ...i, menuItem: withPricing(i.menuItem, now) } : i
    ));

    return {
        ...plain,
        totalPrice,
        vendorOpen,
        vendorStatusMessage,
        vendorStatuses
    };
};

// 1. Lấy giỏ hàng của tôi
exports.getCart = async (req, res) => {
    try {
        // Đã thêm 'imageUrl' vào danh sách populate để load được hình ảnh ở giỏ hàng (nếu cần)
        let cart = await Cart.findOne({ user: req.user.id }).populate(CART_POPULATE);
        
        if (!cart) {
            cart = await Cart.create({ user: req.user.id, items: [] });
            return res.status(200).json({ items: [], totalPrice: 0, vendorOpen: true, vendorStatusMessage: '' });
        }

        res.status(200).json(buildCartResponse(cart));
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy giỏ hàng', error: error.message });
    }
};

// 2. Thêm món vào giỏ (Xử lý thông minh: Trùng món thì tăng số lượng)
exports.addToCart = async (req, res) => {
    try {
        const { menuItemId } = req.body;
        const quantity = Number(req.body.quantity ?? 1);
        if (!Number.isInteger(quantity) || quantity === 0) {
            return res.status(400).json({ message: 'Số lượng không hợp lệ!' });
        }
        const item = await MenuItem.findById(menuItemId);
        if (!item) return res.status(404).json({ message: 'Không tìm thấy món ăn!' });

        let cart = await Cart.findOne({ user: req.user.id });
        if (!cart) cart = new Cart({ user: req.user.id, items: [] });

        // Kiểm tra xem món này đã có trong giỏ chưa
        const itemIndex = cart.items.findIndex(p => p.menuItem.toString() === String(menuItemId));
        const currentQty = itemIndex > -1 ? cart.items[itemIndex].quantity : 0;
        const newQty = currentQty + quantity;

        // Chỉ kiểm tra khi TĂNG số lượng (giảm bớt luôn được phép, kể cả khi quầy đã đóng / món đã tắt)
        if (quantity > 0) {
            if (item.isAvailable === false) return res.status(400).json({ message: `Món "${item.name}" đã tạm hết, vui lòng chọn món khác.` });
            // So TỔNG số lượng trong giỏ sau khi thêm với tồn kho (trước đây chỉ so phần thêm → vượt kho vẫn qua)
            if (newQty > item.countInStock) {
                return res.status(400).json({
                    message: 'Kho không đủ số lượng!',
                    detail: `"${item.name}" chỉ còn ${item.countInStock} phần${currentQty ? `, giỏ của bạn đã có ${currentQty}` : ''}.`,
                    countInStock: item.countInStock,
                });
            }
            const vendor = await Vendor.findById(item.vendor);
            const vendorStatus = getVendorStatus(vendor);
            if (!vendorStatus.isOpen) {
                return res.status(400).json({ message: vendorStatus.message });
            }
        }

        if (newQty <= 0) {
            if (itemIndex > -1) cart.items.splice(itemIndex, 1);
        } else if (itemIndex > -1) {
            cart.items[itemIndex].quantity = newQty;
        } else {
            cart.items.push({ menuItem: menuItemId, quantity: newQty });
        }

        await cart.save();

        // 🌟 FIX LỖI: Phải POPULATE lại dữ liệu để Frontend có Tên và Giá hiển thị
        await cart.populate(CART_POPULATE);

        res.status(200).json({ 
            message: 'Đã thêm vào giỏ hàng!', 
            cart: buildCartResponse(cart)
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi thêm món', error: error.message });
    }
};

// 3. Xóa 1 món khỏi giỏ
exports.removeFromCart = async (req, res) => {
    try {
        const cart = await Cart.findOne({ user: req.user.id });
        cart.items = cart.items.filter(item => item.menuItem.toString() !== req.params.itemId);
        await cart.save();

        // 🌟 FIX LỖI: POPULATE lại sau khi xóa
        await cart.populate(CART_POPULATE);

        res.status(200).json({ 
            message: 'Đã xóa món ăn', 
            cart: buildCartResponse(cart)
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi xóa món', error: error.message });
    }
};

// 4. Làm trống giỏ hàng (Sau khi thanh toán thành công)
exports.clearCart = async (req, res) => {
    try {
        const cart = await Cart.findOne({ user: req.user.id });
        cart.items = [];
        await cart.save();
        
        res.status(200).json({ 
            message: 'Giỏ hàng đã được làm sạch',
            cart: { ...cart.toObject(), totalPrice: 0 }
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi làm sạch giỏ hàng' });
    }
};