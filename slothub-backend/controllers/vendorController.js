const Vendor = require('../models/Vendor');
const Order = require('../models/Order');
const mongoose = require('mongoose');

const { getVendorStatus } = require('../utils/vendorHours');
const { normalizeVendorHours } = require('../utils/timeFormat');

// ========================================================
// PHẦN 1: QUẢN LÝ THÔNG TIN GIAN HÀNG (PROFILE QUÁN)
// ========================================================

const getAllVendors = async (req, res) => {
    try {
        const vendors = await Vendor.find()
            .select('name openTime closeTime isActive isPaused pauseReason category imageUrl description')
            .sort({ isActive: -1, name: 1 });

        const updatedVendors = vendors.map(vendor => {
            const normalized = normalizeVendorHours(vendor);
            const status = getVendorStatus(normalized);
            return {
                ...normalized,
                isOpen: status.isOpen,
                statusMessage: status.isOpen
                    ? 'Đang mở cửa 🟢'
                    : (normalized.isPaused ? 'Tạm tắt 🔴' : 'Hiện đã đóng cửa 🔴'),
            };
        });

        res.status(200).json(updatedVendors);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy danh sách gian hàng', error: error.message });
    }
};

const getVendorDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const vendor = await Vendor.findById(id);
        
        if (!vendor) return res.status(404).json({ message: 'Không tìm thấy gian hàng' });

        const stats = await Order.aggregate([
            { $match: { vendor: new mongoose.Types.ObjectId(id), status: 'Completed' } },
            { $group: { 
                _id: null, 
                totalRevenue: { $sum: "$totalPrice" }, 
                totalOrders: { $sum: 1 } 
            }}
        ]);

        res.status(200).json({
            vendor,
            analytics: {
                revenue: stats.length > 0 ? stats[0].totalRevenue : 0,
                orders: stats.length > 0 ? stats[0].totalOrders : 0
            }
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy chi tiết gian hàng', error: error.message });
    }
};

module.exports = {
    getAllVendors,
    getVendorDetail
};
