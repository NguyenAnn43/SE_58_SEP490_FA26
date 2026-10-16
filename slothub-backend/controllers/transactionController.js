const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Vendor = require('../models/Vendor');

const isVendorRole = (role) => ['vendor', 'vendor_owner'].includes(role);

// 6. [GET] Tổng quan ví chủ quầy (số dư + lịch sử rút)
const getVendorWalletSummary = async (req, res) => {
    try {
        if (!isVendorRole(req.user.role)) {
            return res.status(403).json({ message: 'Chỉ chủ quầy mới truy cập được!' });
        }
        const vendor = await Vendor.findOne({ owner: req.user.id });
        const user = await User.findById(req.user.id).select('walletBalance bankAccount name email');

        const [payoutRequests, orderRevenue] = await Promise.all([
            Transaction.find({ userId: req.user.id, type: 'PAYOUT' }).sort({ createdAt: -1 }).limit(30),
            vendor
                ? Transaction.find({ vendorId: vendor._id, type: 'PAYMENT', status: 'SUCCESS' })
                    .sort({ createdAt: -1 }).limit(30)
                : []
        ]);

        const transactions = [...payoutRequests, ...orderRevenue]
            .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
            .slice(0, 50);

        res.status(200).json({
            balance: user?.walletBalance || 0,
            bankAccount: user?.bankAccount,
            vendor,
            transactions
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy ví quầy', error: error.message });
    }
};

module.exports = {
    getVendorWalletSummary
};
