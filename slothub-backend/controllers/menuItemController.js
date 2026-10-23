const MenuItem = require('../models/MenuItem');
const TimeSlot = require('../models/TimeSlot');
const { getVendorStatus } = require('../utils/vendorHours');

const getAllMenuItems = async (req, res) => {
    try {
        let slotOpts = {};
        if (req.query.slotId) {
            const slot = await TimeSlot.findById(req.query.slotId);
            if (slot?.isActive !== false) {
                slotOpts = { slotStart: slot.startTime, slotEnd: slot.endTime };
            }
        }

        const menu = await MenuItem.find({ isAvailable: true }).populate('vendor', 'name openTime closeTime isActive isPaused pauseReason');
        const result = menu.map((item) => {
            const statusNow = getVendorStatus(item.vendor);
            const statusInSlot = slotOpts.slotStart
                ? getVendorStatus(item.vendor, slotOpts)
                : statusNow;
            return {
                ...item.toObject(),
                vendorIsOpen: statusInSlot.isOpen,
                vendorOpenNow: statusNow.isOpen,
                vendorStatusMessage: statusInSlot.message,
                vendorStatusNowMessage: statusNow.message,
                ...(slotOpts.slotStart && {
                    pickupSlotLabel: `${slotOpts.slotStart} – ${slotOpts.slotEnd}`
                })
            };
        });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy danh sách món', error: error.message });
    }
};

const getVendorMenu = async (req, res) => {
    try {
        const menu = await MenuItem.find({ vendor: req.params.vendorId, isAvailable: true });
        res.status(200).json(menu);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy menu', error: error.message });
    }
};

const getMenuItemById = async (req, res) => {
    try {
        const item = await MenuItem.findById(req.params.id).populate('vendor', 'name openTime closeTime isActive isPaused pauseReason');
        if (!item) return res.status(404).json({ message: 'Không tìm thấy món ăn này!' });
        const status = getVendorStatus(item.vendor);
        res.status(200).json({
            ...item.toObject(),
            vendorIsOpen: status.isOpen,
            vendorStatusMessage: status.message
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy chi tiết món', error: error.message });
    }
};

module.exports = {
    getAllMenuItems,
    getVendorMenu,
    getMenuItemById
};
