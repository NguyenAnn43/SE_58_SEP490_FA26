const MenuItem = require('../models/MenuItem');
const { getVendorStatus } = require('../utils/vendorHours');

const getAllMenuItems = async (req, res) => {
    try {
        const menu = await MenuItem.find({ isAvailable: true }).populate('vendor', 'name openTime closeTime isActive isPaused pauseReason');
        const result = menu.map((item) => {
            const statusNow = getVendorStatus(item.vendor);
            return {
                ...item.toObject(),
                vendorIsOpen: statusNow.isOpen,
                vendorOpenNow: statusNow.isOpen,
                vendorStatusMessage: statusNow.message,
                vendorStatusNowMessage: statusNow.message
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

module.exports = {
    getAllMenuItems,
    getVendorMenu
};
