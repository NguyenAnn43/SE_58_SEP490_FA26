const Order = require('../models/Order');
const User = require('../models/User');
const Cart = require('../models/Cart');
const Vendor = require('../models/Vendor');
const TimeSlot = require('../models/TimeSlot');
const crypto = require('crypto');
const { settleOrderPayment } = require('../utils/settleOrderPayment');
const { getVendorStatus } = require('../utils/vendorHours');
const { notifyVendorNewOrder } = require('../utils/vendorNotify');
const { sendPickupEmail } = require('../utils/pickupEmail');
const { issuePickupCode } = require('../utils/pickupCode');
const {
    logOrderStatus,
    logStudentWallet
} = require('../utils/persistence');
const {
    resolvePickupSchedule,
    validatePickupSchedule,
} = require('../utils/pickupSchedule');

const normalizeVendorId = (vendor) => {
    if (!vendor) return null;
    if (typeof vendor === 'object' && vendor._id) {
        return String(vendor._id);
    }
    return String(vendor);
};

const CART_POPULATE = {
    path: 'items.menuItem',
    populate: { path: 'vendor', select: 'name openTime closeTime isActive isPaused pauseReason' }
};

const buildVendorGroups = (cartItems, selectedMenuItemIds) => {
    const selectedSet = Array.isArray(selectedMenuItemIds) && selectedMenuItemIds.length
        ? new Set(selectedMenuItemIds.map(String))
        : null;

    const itemsToProcess = cartItems.filter((ci) => {
        const id = ci.menuItem?._id?.toString() || ci.menuItem?.toString();
        return selectedSet ? selectedSet.has(id) : true;
    });

    const vendorGroups = new Map();
    for (const cartItem of itemsToProcess) {
        const vendorId = String(cartItem.menuItem?.vendor?._id || cartItem.menuItem?.vendor || '');
        if (!vendorId) continue;
        if (!vendorGroups.has(vendorId)) vendorGroups.set(vendorId, []);
        vendorGroups.get(vendorId).push(cartItem);
    }

    return { itemsToProcess, vendorGroups };
};

const processVendorGroup = async (cartItems, slotOpts) => {
    let totalAmount = 0;
    const processedItems = [];
    let vendorId = null;

    for (const cartItem of cartItems) {
        const itemDb = cartItem.menuItem;
        if (!itemDb || itemDb.isAvailable === false || itemDb.countInStock < cartItem.quantity) {
            return {
                error: `Món ${itemDb ? itemDb.name : 'không xác định'} đã hết hoặc không đủ số lượng!`
            };
        }
        vendorId = itemDb.vendor?._id || itemDb.vendor;
        totalAmount += itemDb.price * cartItem.quantity;
        processedItems.push({
            menuItem: itemDb._id,
            quantity: cartItem.quantity,
            price: itemDb.price
        });
    }

    const vendor = await Vendor.findById(vendorId);
    const vendorCheck = getVendorStatus(vendor, slotOpts);
    if (!vendorCheck.isOpen) {
        return { error: vendorCheck.message };
    }

    return { vendorId: normalizeVendorId(vendorId), vendor, totalAmount, processedItems };
};

const removeProcessedCartItems = async (cart, processedMenuItemIds) => {
    const processedSet = new Set(processedMenuItemIds.map(String));
    cart.items = cart.items.filter((ci) => {
        const id = ci.menuItem?._id?.toString() || ci.menuItem?.toString();
        return !processedSet.has(id);
    });
    await cart.save();
};

// 1. [POST] Sinh viên đặt đồ ăn (hỗ trợ chọn món + nhiều quầy)
const createOrder = async (req, res) => {
    try {
        const { paymentMethod, note, pickupSlot, pickupDate, selectedMenuItemIds } = req.body;
        const userId = req.user.id;

        if (!pickupSlot) return res.status(400).json({ message: 'Vui lòng chọn khung giờ nhận hàng!' });
        const slot = await TimeSlot.findById(pickupSlot);
        if (!slot) return res.status(400).json({ message: 'Khung giờ không hợp lệ!' });

        const scheduleCheck = validatePickupSchedule({
            startTime: slot.startTime,
            endTime: slot.endTime,
            pickupDate,
        });
        if (scheduleCheck.error) {
            return res.status(400).json({ message: scheduleCheck.error });
        }

        const pickupSchedule = resolvePickupSchedule({
            startTime: slot.startTime,
            endTime: slot.endTime,
            pickupDate,
        });
        const pickupSlotLabel = `${slot.startTime} - ${slot.endTime}`;
        const { pickupSlotStartAt, pickupSlotEndAt, pickupDay } = pickupSchedule;
        const slotOpts = { slotStart: slot.startTime, slotEnd: slot.endTime };

        const cart = await Cart.findOne({ user: userId }).populate(CART_POPULATE);
        if (!cart || cart.items.length === 0) {
            return res.status(400).json({ message: 'Giỏ hàng đang trống!' });
        }

        const { itemsToProcess, vendorGroups } = buildVendorGroups(cart.items, selectedMenuItemIds);
        if (itemsToProcess.length === 0) {
            return res.status(400).json({ message: 'Vui lòng chọn ít nhất một món để thanh toán!' });
        }

        const groupEntries = [];
        let grandTotal = 0;
        const processedMenuItemIds = [];

        for (const [_, groupItems] of vendorGroups.entries()) {
            const result = await processVendorGroup(groupItems, slotOpts);
            if (result.error) {
                return res.status(400).json({ message: result.error });
            }
            grandTotal += result.totalAmount;
            groupItems.forEach((ci) => {
                processedMenuItemIds.push(ci.menuItem._id.toString());
            });
            groupEntries.push(result);
        }

        const checkoutBatchId = vendorGroups.size > 1 ? crypto.randomUUID() : undefined;
        const createdOrders = [];
        const vendorNames = {};

        // --- XỬ LÝ THANH TOÁN VÍ NỘI BỘ ---
        if (paymentMethod === 'wallet') {
            const user = await User.findById(userId);
            if (user.walletBalance < grandTotal) {
                return res.status(400).json({ message: 'Số dư ví không đủ!' });
            }

            user.walletBalance -= grandTotal;
            await user.save();
            let runningBalance = user.walletBalance + grandTotal;

            for (const group of groupEntries) {
                const newOrder = new Order({
                    user: userId,
                    vendor: group.vendorId,
                    items: group.processedItems,
                    totalPrice: group.totalAmount,
                    note,
                    pickupSlot: pickupSlotLabel,
                    pickupSlotId: slot._id,
                    pickupSlotStartAt,
                    pickupSlotEndAt,
                    pickupDay,
                    status: 'Processing',
                    paymentStatus: 'Paid',
                    paymentMethod: 'wallet',
                    checkoutBatchId
                });
                issuePickupCode(newOrder);
                await newOrder.save();
                vendorNames[String(group.vendorId)] = group.vendor?.name || 'Quầy căng tin';

                await logOrderStatus({
                    orderId: newOrder._id,
                    fromStatus: '',
                    toStatus: 'Processing',
                    changedBy: userId,
                    changedByRole: 'student',
                    note: 'Đặt đơn & thanh toán ví'
                });
                await settleOrderPayment({
                    orderId: newOrder._id,
                    studentUserId: userId,
                    vendorDocId: group.vendorId,
                    totalAmount: group.totalAmount,
                    paymentMethod: 'wallet'
                });
                await logStudentWallet({
                    userId,
                    amount: -group.totalAmount,
                    balanceAfter: (runningBalance -= group.totalAmount),
                    type: 'PAYMENT',
                    orderId: newOrder._id,
                    description: `Thanh toán đơn #${String(newOrder._id).slice(-6)}`
                });

                await notifyVendorNewOrder(req, newOrder, user);
                createdOrders.push(newOrder);
            }

            await removeProcessedCartItems(cart, processedMenuItemIds);

            const populatedOrders = await Order.find({ _id: { $in: createdOrders.map((o) => o._id) } })
                .populate('vendor', 'name')
                .populate('items.menuItem', 'name price imageUrl');

            sendPickupEmail({ user, orders: populatedOrders, vendorNames }).catch((err) =>
                console.log('❌ Lỗi gửi email mã nhận món:', err.message)
            );

            return res.status(201).json({
                message: createdOrders.length > 1
                    ? `Đặt ${createdOrders.length} đơn tại ${createdOrders.length} quầy thành công!`
                    : 'Đặt đơn thành công!',
                orders: populatedOrders,
                order: populatedOrders[0],
                checkoutBatchId
            });
        }

        return res.status(400).json({ message: 'Phương thức thanh toán không hợp lệ!' });

    } catch (error) {
        res.status(500).json({ message: 'Lỗi tạo đơn', error: error.message });
    }
};

module.exports = {
    createOrder
};
