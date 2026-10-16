const Transaction = require('../models/Transaction');
const User = require('../models/User');
const Vendor = require('../models/Vendor');
const { notifyAdmin } = require('../utils/adminNotify');

const isVendorRole = (role) => ['vendor', 'vendor_owner'].includes(role);

// 1. [POST] Yêu cầu Nạp tiền vào ví (Sinh viên)
const requestTransaction = async (req, res) => {
    try {
        const { type, amount, description } = req.body;
        const userId = req.user.id;

        if (!amount || amount <= 0) {
            return res.status(400).json({ message: 'Số tiền không hợp lệ!' });
        }

        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({ message: 'Không tìm thấy người dùng!' });
        }

        const vendorUser = isVendorRole(user.role);
        if (vendorUser && type === 'DEPOSIT') {
            return res.status(400).json({ message: 'Chủ quầy không nạp ví qua kênh này. Doanh thu được cộng tự động khi có đơn.' });
        }

        const txType = type;

        if (!['DEPOSIT'].includes(txType)) {
            return res.status(400).json({ message: 'Loại giao dịch không hợp lệ!' });
        }

        const newTransaction = new Transaction({
            userId: user._id,
            amount: amount,
            type: txType,
            status: 'PENDING',
            description: description || `Nạp ${amount.toLocaleString()}đ`
        });
        await newTransaction.save();

        const who = user.name || user.email;
        await notifyAdmin(req, {
            title: 'Yêu cầu nạp tiền',
            message: `${who} yêu cầu nạp ${Number(amount).toLocaleString('vi-VN')}đ vào ví`,
            type: 'DEPOSIT',
            actionLink: 'transactions'
        });

        res.status(201).json({ 
            message: 'Yêu cầu Nạp tiền đã được gửi. Admin sẽ duyệt và chuyển khoản sớm nhất!',
            transaction: newTransaction,
            newBalance: user.walletBalance
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi xử lý giao dịch', error: error.message });
    }
};

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
    requestTransaction,
    getVendorWalletSummary
};
