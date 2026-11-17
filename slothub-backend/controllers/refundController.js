const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const { reverseOrderPayment } = require('../utils/settleOrderPayment');
const { logOrderStatus, logAudit, notifyStudent } = require('../utils/persistence');

// 1. [POST] /api/refunds/:orderId — ADMIN hoàn 100% một đơn đã thanh toán vào ví SlotHub.
// (Trước đây ai đăng nhập cũng gọi được và cộng sai trường totalAmount → đã khoá lại cho admin,
//  chiếm đơn nguyên tử để không hoàn 2 lần, dùng chung cơ chế reverseOrderPayment.)
// Quầy từ chối đơn dùng PUT /api/orders/:id/reject; sinh viên huỷ dùng POST /api/orders/:id/cancel.
const requestRefund = async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Chỉ quản trị viên được hoàn tiền thủ công.' });
        }
        const { orderId } = req.params;
        const reason = String(req.body?.reason || '').trim() || 'Admin hoàn tiền';

        const claimed = await Order.findOneAndUpdate(
            { _id: orderId, paymentStatus: 'Paid', status: { $ne: 'Completed' }, refundStatus: { $nin: ['PROCESSING', 'SUCCESS'] } },
            {
                $set: {
                    status: 'Cancelled', cancelledBy: 'admin', cancelledAt: new Date(), cancelReason: reason,
                    refundStatus: 'PROCESSING',
                },
                $inc: { refundAttempts: 1 },
            },
            { new: true }
        );
        if (!claimed) {
            return res.status(409).json({ message: 'Đơn không tồn tại, chưa thanh toán, đã hoàn thành hoặc đã được hoàn tiền.' });
        }

        try {
            const { refundAmount } = await reverseOrderPayment(claimed, {
                description: `Admin hoàn 100% đơn #${String(claimed._id).slice(-6)}. Lý do: ${reason}`,
            });
            await Order.updateOne({ _id: claimed._id }, {
                $set: {
                    paymentStatus: 'Refunded', refundStatus: 'SUCCESS', refundMethod: 'WALLET',
                    refundedAt: new Date(), refundPercent: 100, refundAmount, refundError: '',
                },
            });
            await logOrderStatus({
                orderId: claimed._id, toStatus: 'Cancelled', changedBy: req.user.id, changedByRole: 'admin',
                note: `Admin hoàn tiền: ${reason}`,
            });
            await logAudit({
                actor: req.user.id, actorRole: 'admin', action: 'ORDER_REFUNDED_BY_ADMIN',
                entityType: 'Order', entityId: claimed._id, metadata: { reason, refundAmount },
            });
            await notifyStudent(req, {
                userId: claimed.user,
                title: 'Đã hoàn tiền',
                message: `Đơn #${String(claimed._id).slice(-6).toUpperCase()} đã được hoàn ${Number(refundAmount).toLocaleString('vi-VN')}đ vào ví SlotHub.`,
                type: 'REFUND_SUCCESS',
                orderId: claimed._id,
            });
            return res.status(200).json({ message: 'Hoàn tiền thành công vào ví nội bộ!', refundAmount });
        } catch (error) {
            await Order.updateOne({ _id: claimed._id }, { $set: { refundStatus: 'FAILED', refundError: error.message } });
            return res.status(500).json({ message: 'Hoàn tiền lỗi — có thể thử lại qua /api/orders/:id/refund/retry', error: error.message });
        }
    } catch (error) {
        res.status(500).json({ message: 'Lỗi hoàn tiền', error: error.message });
    }
};

// 2. Lấy lịch sử hoàn tiền (admin)
const getRefundHistory = async (req, res) => {
    try {
        if (req.user.role !== 'admin') return res.status(403).json({ message: "Quyền hạn không đủ!" });

        const history = await Transaction.find({ type: 'REFUND' })
            .populate('userId', 'name email walletBalance')
            .populate('vendorId', 'name')
            .sort({ createdAt: -1 });

        res.status(200).json(history);
    } catch (error) {
        res.status(500).json({ message: "Lỗi lấy lịch sử", error: error.message });
    }
};

module.exports = { requestRefund, getRefundHistory };
