const Order = require('../models/Order');
const Vendor = require('../models/Vendor');
const Transaction = require('../models/Transaction');
const StudentWalletLog = require('../models/StudentWalletLog');
const OrderStatusLog = require('../models/OrderStatusLog');
const { reverseOrderPayment } = require('../utils/settleOrderPayment');
const { logOrderStatus, logAudit, notifyStudent } = require('../utils/persistence');
const { notifyAdmin } = require('../utils/adminNotify');

/**
 * Chủ quầy duyệt / từ chối đơn + hoàn tiền khi từ chối đơn đã thanh toán.
 *
 * Quy tắc:
 * - Chỉ đơn ĐÃ THANH TOÁN đang chờ (status Pending, approvalStatus PENDING) mới được Approve/Reject.
 *   Đơn payOS chưa thanh toán chưa vào bếp nên không cần duyệt.
 * - Approve/Reject dùng cập nhật nguyên tử có điều kiện → 2 request đồng thời chỉ 1 cái thành công.
 * - Hoàn tiền: vào ví SlotHub (payOS không có API hoàn tiền) → chỉ SUCCESS khi ví đã cộng thật.
 *   PENDING|FAILED → PROCESSING là nguyên tử nên không xử lý trùng; có kiểm tra đã hoàn trước đó.
 */

const isVendorRole = (role) => ['vendor', 'vendor_owner'].includes(role);
const shortCode = (id) => `#${String(id).slice(-6).toUpperCase()}`;
const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;

const REJECT_REASON_MIN = 3;
const REJECT_REASON_MAX = 300;

const ORDER_POPULATE = [
    { path: 'user', select: 'name phone studentId' },
    { path: 'items.menuItem', select: 'name price imageUrl' },
    { path: 'vendor', select: 'name' },
];

/** Bộ lọc trạng thái dùng chung cho danh sách đơn của quầy */
const STATUS_FILTERS = {
    awaiting: { status: 'Pending', paymentStatus: 'Paid', approvalStatus: 'PENDING' },
    unpaid: { status: 'Pending', paymentStatus: { $ne: 'Paid' } },
    processing: { status: 'Processing' },
    ready: { status: 'Ready' },
    completed: { status: 'Completed' },
    rejected: { status: 'Rejected' },
    cancelled: { status: 'Cancelled' },
};

const getMyVendor = (userId) => Vendor.findOne({ owner: userId });

// ===================== HOÀN TIỀN =====================

/**
 * Hoàn 100% đơn bị từ chối vào ví SlotHub. An toàn khi gọi lại (retry):
 * chỉ chạy khi chiếm được trạng thái PENDING|FAILED → PROCESSING.
 */
const processOrderRefund = async (orderId, { req, reason = '' } = {}) => {
    const claimed = await Order.findOneAndUpdate(
        { _id: orderId, paymentStatus: 'Paid', refundStatus: { $in: ['PENDING', 'FAILED'] } },
        { $set: { refundStatus: 'PROCESSING', refundError: '' }, $inc: { refundAttempts: 1 } },
        { new: true }
    );
    if (!claimed) return { skipped: true };

    const code = shortCode(claimed._id);
    try {
        // Lần thử trước có thể đã cộng ví rồi mới lỗi ở bước sau → không cộng lần 2
        const alreadyCredited = await StudentWalletLog.findOne({ order: claimed._id, type: 'REFUND' })
            || await Transaction.findOne({ orderId: claimed._id, type: 'REFUND', status: 'SUCCESS' });

        let refundAmount = claimed.totalPrice;
        if (!alreadyCredited) {
            const result = await reverseOrderPayment(claimed, {
                description: `Hoàn 100% đơn ${code} — quầy từ chối${reason ? `: ${reason}` : ''}`,
            });
            refundAmount = result.refundAmount;
        }

        await Order.updateOne({ _id: claimed._id }, {
            $set: {
                refundStatus: 'SUCCESS',
                refundMethod: 'WALLET',
                refundedAt: new Date(),
                refundError: '',
                paymentStatus: 'Refunded',
                refundPercent: 100,
                refundAmount,
            },
        });
        await notifyStudent(req, {
            userId: claimed.user,
            title: 'Đã hoàn tiền',
            message: `Đơn ${code} bị quầy từ chối${reason ? ` (lý do: ${reason})` : ''} — đã hoàn ${vnd(refundAmount)} vào ví SlotHub của bạn.`,
            type: 'REFUND_SUCCESS',
            orderId: claimed._id,
        });
        return { success: true, refundAmount };
    } catch (error) {
        await Order.updateOne({ _id: claimed._id }, {
            $set: { refundStatus: 'FAILED', refundError: String(error.message || error).slice(0, 300) },
        });
        await notifyAdmin(req, {
            title: 'Hoàn tiền thất bại',
            message: `Đơn ${code} (${vnd(claimed.totalPrice)}) hoàn tiền lỗi: ${error.message}. Cần xử lý lại.`,
            type: 'REFUND_FAILED',
            actionLink: 'transactions',
        });
        await notifyStudent(req, {
            userId: claimed.user,
            title: 'Hoàn tiền đang được xử lý lại',
            message: `Hoàn tiền đơn ${code} gặp lỗi tạm thời — hệ thống đã báo quản trị viên xử lý lại.`,
            type: 'REFUND_FAILED',
            orderId: claimed._id,
        });
        return { success: false, error: error.message };
    }
};

// ===================== API CHỦ QUẦY =====================

// [GET] /orders/vendor/my-orders?status=awaiting|unpaid|processing|ready|completed|rejected|cancelled
const getVendorOrders = async (req, res) => {
    try {
        const vendor = await getMyVendor(req.user.id);
        if (!vendor) return res.status(404).json({ message: 'Bạn chưa có gian hàng!' });

        const filter = { vendor: vendor._id };
        const key = String(req.query.status || '').toLowerCase();
        if (key && key !== 'all') {
            if (!STATUS_FILTERS[key]) return res.status(400).json({ message: 'Bộ lọc trạng thái không hợp lệ.' });
            Object.assign(filter, STATUS_FILTERS[key]);
        }

        const orders = await Order.find(filter).populate(ORDER_POPULATE).sort({ createdAt: -1 });
        res.status(200).json(orders);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy đơn', error: error.message });
    }
};

// [GET] /orders/vendor/:id — chi tiết + lịch sử xử lý
const getVendorOrderDetail = async (req, res) => {
    try {
        const vendor = await getMyVendor(req.user.id);
        if (!vendor) return res.status(404).json({ message: 'Bạn chưa có gian hàng!' });
        const order = await Order.findOne({ _id: req.params.id, vendor: vendor._id }).populate(ORDER_POPULATE);
        if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn của quầy bạn.' });
        const history = await OrderStatusLog.find({ order: order._id }).sort({ createdAt: 1 }).lean();
        res.status(200).json({ order, history });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi lấy chi tiết đơn', error: error.message });
    }
};

// [PUT] /orders/:id/approve
const approveOrder = async (req, res) => {
    try {
        if (!isVendorRole(req.user.role)) return res.status(403).json({ message: 'Chỉ chủ quầy được duyệt đơn.' });
        const vendor = await getMyVendor(req.user.id);
        if (!vendor) return res.status(404).json({ message: 'Bạn chưa có gian hàng!' });

        const now = new Date();
        const order = await Order.findOneAndUpdate(
            { _id: req.params.id, vendor: vendor._id, ...STATUS_FILTERS.awaiting },
            { $set: { approvalStatus: 'APPROVED', status: 'Processing', approvedAt: now, approvedBy: req.user.id } },
            { new: true }
        );
        if (!order) {
            const current = await Order.findOne({ _id: req.params.id, vendor: vendor._id }).select('status approvalStatus paymentStatus');
            if (!current) return res.status(404).json({ message: 'Không tìm thấy đơn của quầy bạn.' });
            return res.status(409).json({
                message: current.paymentStatus !== 'Paid'
                    ? 'Đơn chưa được thanh toán — chưa thể duyệt.'
                    : `Đơn đã được xử lý trước đó (${current.approvalStatus}).`,
            });
        }

        await logOrderStatus({
            orderId: order._id, fromStatus: 'Pending', toStatus: 'Processing',
            changedBy: req.user.id, changedByRole: req.user.role, note: 'Chủ quầy duyệt đơn',
        });
        await logAudit({
            actor: req.user.id, actorRole: req.user.role, action: 'ORDER_APPROVED',
            entityType: 'Order', entityId: order._id,
        });
        await notifyStudent(req, {
            userId: order.user,
            title: 'Quầy đã nhận đơn',
            message: `${vendor.name} đã xác nhận đơn ${shortCode(order._id)} và đang chuẩn bị món.`,
            type: 'ORDER_APPROVED',
            orderId: order._id,
        });

        const populated = await Order.findById(order._id).populate(ORDER_POPULATE);
        res.status(200).json({ message: 'Đã duyệt đơn — chuyển sang Đang làm.', order: populated });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi duyệt đơn', error: error.message });
    }
};

// [PUT] /orders/:id/reject  { reason }
const rejectOrder = async (req, res) => {
    try {
        if (!isVendorRole(req.user.role)) return res.status(403).json({ message: 'Chỉ chủ quầy được từ chối đơn.' });
        const reason = String(req.body?.reason || '').trim();
        if (reason.length < REJECT_REASON_MIN) {
            return res.status(400).json({ message: 'Vui lòng nhập lý do từ chối (tối thiểu 3 ký tự).' });
        }
        if (reason.length > REJECT_REASON_MAX) {
            return res.status(400).json({ message: `Lý do tối đa ${REJECT_REASON_MAX} ký tự.` });
        }
        const vendor = await getMyVendor(req.user.id);
        if (!vendor) return res.status(404).json({ message: 'Bạn chưa có gian hàng!' });

        const now = new Date();
        const order = await Order.findOneAndUpdate(
            { _id: req.params.id, vendor: vendor._id, ...STATUS_FILTERS.awaiting },
            {
                $set: {
                    approvalStatus: 'REJECTED',
                    status: 'Rejected',
                    rejectedAt: now,
                    rejectedBy: req.user.id,
                    rejectReason: reason,
                    refundStatus: 'PENDING',
                },
            },
            { new: true }
        );
        if (!order) {
            const current = await Order.findOne({ _id: req.params.id, vendor: vendor._id }).select('status approvalStatus paymentStatus');
            if (!current) return res.status(404).json({ message: 'Không tìm thấy đơn của quầy bạn.' });
            return res.status(409).json({
                message: current.paymentStatus !== 'Paid'
                    ? 'Đơn chưa được thanh toán — không cần từ chối.'
                    : `Đơn đã được xử lý trước đó (${current.approvalStatus}).`,
            });
        }

        await logOrderStatus({
            orderId: order._id, fromStatus: 'Pending', toStatus: 'Rejected',
            changedBy: req.user.id, changedByRole: req.user.role, note: `Chủ quầy từ chối: ${reason}`,
        });
        await logAudit({
            actor: req.user.id, actorRole: req.user.role, action: 'ORDER_REJECTED',
            entityType: 'Order', entityId: order._id, metadata: { reason },
        });
        await notifyStudent(req, {
            userId: order.user,
            title: 'Đơn bị từ chối',
            message: `${vendor.name} từ chối đơn ${shortCode(order._id)}. Lý do: ${reason}. Hệ thống đang hoàn ${vnd(order.totalPrice)} vào ví của bạn.`,
            type: 'ORDER_REJECTED',
            orderId: order._id,
        });

        const refund = await processOrderRefund(order._id, { req, reason });
        const populated = await Order.findById(order._id).populate(ORDER_POPULATE);
        res.status(200).json({
            message: refund.success
                ? `Đã từ chối đơn và hoàn ${vnd(refund.refundAmount)} vào ví sinh viên.`
                : `Đã từ chối đơn. Hoàn tiền chưa thành công (${refund.error || 'đang xử lý'}) — có thể thử lại.`,
            refund,
            order: populated,
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi từ chối đơn', error: error.message });
    }
};

// [POST] /orders/:id/refund/retry — chủ quầy của đơn hoặc admin
const retryOrderRefund = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id);
        if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn.' });
        if (req.user.role !== 'admin') {
            const vendor = isVendorRole(req.user.role) ? await getMyVendor(req.user.id) : null;
            if (!vendor || String(order.vendor) !== String(vendor._id)) {
                return res.status(403).json({ message: 'Không có quyền với đơn này.' });
            }
        }
        if (order.refundStatus !== 'FAILED') {
            return res.status(409).json({ message: `Không thể thử lại — trạng thái hoàn tiền: ${order.refundStatus}.` });
        }
        const refund = await processOrderRefund(order._id, { req, reason: order.rejectReason });
        const updated = await Order.findById(order._id).populate(ORDER_POPULATE);
        res.status(200).json({
            message: refund.success ? 'Hoàn tiền thành công.' : `Hoàn tiền vẫn lỗi: ${refund.error || 'đang xử lý'}`,
            refund,
            order: updated,
        });
    } catch (error) {
        res.status(500).json({ message: 'Lỗi thử lại hoàn tiền', error: error.message });
    }
};

// [GET] /orders/:id/refund — sinh viên chủ đơn, chủ quầy của đơn hoặc admin
const getOrderRefundStatus = async (req, res) => {
    try {
        const order = await Order.findById(req.params.id)
            .select('user vendor status approvalStatus paymentStatus paymentMethod totalPrice rejectReason rejectedAt refundStatus refundMethod refundAmount refundError refundAttempts refundedAt');
        if (!order) return res.status(404).json({ message: 'Không tìm thấy đơn.' });
        const role = req.user.role;
        let allowed = role === 'admin' || String(order.user) === String(req.user.id);
        if (!allowed && isVendorRole(role)) {
            const vendor = await getMyVendor(req.user.id);
            allowed = !!vendor && String(order.vendor) === String(vendor._id);
        }
        if (!allowed) return res.status(403).json({ message: 'Không có quyền xem đơn này.' });

        const data = order.toObject();
        // Sinh viên không cần thấy chi tiết lỗi kỹ thuật
        if (role === 'student') delete data.refundError;
        res.status(200).json(data);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi tra cứu hoàn tiền', error: error.message });
    }
};

module.exports = {
    getVendorOrders,
    getVendorOrderDetail,
    approveOrder,
    rejectOrder,
    retryOrderRefund,
    getOrderRefundStatus,
    processOrderRefund,
};
