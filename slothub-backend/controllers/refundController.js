const Order = require('../models/Order');
const Transaction = require('../models/Transaction');
const { reverseOrderPayment } = require('../utils/settleOrderPayment');
const { logOrderStatus, logAudit, notifyStudent } = require('../utils/persistence');

// 1. [POST] /api/refunds/:orderId — ADMIN hoàn 100% một đơn đã thanh toán vào ví SlotHub.
// (Trước đây ai đăng nhập cũng gọi được, và cộng sai trường totalAmount (không tồn tại) → đã khoá lại cho admin,
//  chiếm đơn nguyên tử để không hoàn 2 lần, dùng chung cơ chế reverseOrderPayment: trừ lại phần quầy + phí sàn.)
const requestRefund = async (req, res) => {
    try {
        if (req.user.role !== 'admin') {
            return res.status(403).json({ message: 'Chỉ quản trị viên được hoàn tiền thủ công.' });
        }
        const { orderId } = req.params;
        const reason = String(req.body?.reason || '').trim().slice(0, 300) || 'Admin hoàn tiền';

        // Chiếm đơn nguyên tử: 2 request cùng lúc thì chỉ 1 request hoàn được tiền
        const before = await Order.findOneAndUpdate(
            { _id: orderId, paymentStatus: 'Paid', status: { $ne: 'Completed' } },
            {
                $set: {
                    status: 'Cancelled', paymentStatus: 'Refunded',
                    cancelledBy: 'admin', cancelledAt: new Date(), cancelReason: reason,
                },
            },
            { returnDocument: 'before' }
        );
        if (!before) {
            return res.status(409).json({ message: 'Đơn không tồn tại, chưa thanh toán, đã hoàn thành hoặc đã được hoàn tiền.' });
        }

        let refundAmount;
        try {
            ({ refundAmount } = await reverseOrderPayment(before, {
                description: `Admin hoàn 100% đơn #${String(before._id).slice(-6)}. Lý do: ${reason}`,
            }));
        } catch (error) {
            // Hoàn tiền lỗi → trả đơn về trạng thái cũ để admin thử lại
            await Order.updateOne({ _id: before._id }, {
                $set: {
                    status: before.status, paymentStatus: 'Paid',
                    cancelledBy: before.cancelledBy || '', cancelledAt: before.cancelledAt || null, cancelReason: before.cancelReason || '',
                },
            });
            return res.status(500).json({ message: 'Hoàn tiền lỗi, đơn đã được giữ nguyên — vui lòng thử lại.', error: error.message });
        }

        await Order.updateOne({ _id: before._id }, { $set: { refundPercent: 100, refundAmount } });
        await logOrderStatus({
            orderId: before._id, fromStatus: before.status, toStatus: 'Cancelled',
            changedBy: req.user.id, changedByRole: 'admin', note: `Admin hoàn tiền: ${reason}`,
        });
        await logAudit({
            actor: req.user.id, actorRole: 'admin', action: 'ORDER_REFUNDED_BY_ADMIN',
            entityType: 'Order', entityId: before._id, metadata: { reason, refundAmount },
        });
        await notifyStudent(req, {
            userId: before.user,
            title: 'Tiền đã về ví! 💰',
            message: `Đơn #${String(before._id).slice(-6).toUpperCase()} đã được hoàn ${Number(refundAmount).toLocaleString('vi-VN')}đ vào ví SlotHub. Lý do: ${reason}`,
            orderId: before._id,
        });

        res.status(200).json({ message: 'Hoàn tiền thành công vào ví nội bộ!', refundAmount });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi hoàn tiền', error: error.message });
    }
};

// 2. Lấy lịch sử hoàn tiền (Giữ nguyên của bạn)
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
