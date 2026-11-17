const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
    createOrder,
    getMyOrders,
} = require('../controllers/orderController');
const {
    getVendorOrders,
    getVendorOrderDetail,
    approveOrder,
    rejectOrder,
    retryOrderRefund,
    getOrderRefundStatus,
} = require('../controllers/orderApprovalController');

// Tất cả đều yêu cầu đăng nhập
router.use(protect);

// [POST] Sinh viên đặt món
router.post('/', createOrder);

// [GET] Sinh viên xem lịch sử đơn hàng (kèm trạng thái duyệt, lý do từ chối, hoàn tiền)
router.get('/my-orders', getMyOrders);

// ===== CHỦ QUẦY (đặt trước các route /:id) =====
// [GET] Danh sách đơn của quầy, lọc ?status=awaiting|unpaid|processing|ready|completed|rejected|cancelled
router.get('/vendor/my-orders', getVendorOrders);
// [GET] Chi tiết 1 đơn của quầy + lịch sử xử lý
router.get('/vendor/:id', getVendorOrderDetail);

// [PUT] Chủ quầy duyệt / từ chối (bắt buộc lý do) đơn đang chờ
router.put('/:id/approve', approveOrder);
router.put('/:id/reject', rejectOrder);

// [GET] Tra cứu hoàn tiền · [POST] Thử lại hoàn tiền lỗi (chủ quầy của đơn / admin)
router.get('/:id/refund', getOrderRefundStatus);
router.post('/:id/refund/retry', retryOrderRefund);

module.exports = router;
