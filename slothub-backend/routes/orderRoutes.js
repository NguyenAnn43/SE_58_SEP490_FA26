const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
    createOrder,
    getMyOrders,
    updateOrderStatus,
    verifyVendorPickup,
    getCancellationPolicyPublic,
    previewCancelOrder,
    cancelMyOrder,
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

// [GET] Chính sách hủy đơn (công khai cho SV)
router.get('/cancellation-policy', getCancellationPolicyPublic);

// ===== CHỦ QUẦY (đặt trước các route /:id) =====
// [GET] Danh sách đơn của quầy, lọc ?status=awaiting|unpaid|processing|ready|completed|rejected|cancelled
router.get('/vendor/my-orders', getVendorOrders);
// [POST] Quét QR / OTP xác nhận nhận món
router.post('/vendor/verify-pickup', verifyVendorPickup);
// [GET] Chi tiết 1 đơn của quầy + lịch sử xử lý
router.get('/vendor/:id', getVendorOrderDetail);

// [PUT] Chủ quầy duyệt / từ chối (bắt buộc lý do) đơn đang chờ
router.put('/:id/approve', approveOrder);
router.put('/:id/reject', rejectOrder);

// [GET] Tra cứu hoàn tiền · [POST] Thử lại hoàn tiền lỗi (chủ quầy của đơn / admin)
router.get('/:id/refund', getOrderRefundStatus);
router.post('/:id/refund/retry', retryOrderRefund);

// [GET] Xem trước hoàn tiền khi hủy
router.get('/:id/cancel-preview', previewCancelOrder);

// [POST] Sinh viên hủy đơn (áp dụng chính sách hoàn tiền)
router.post('/:id/cancel', cancelMyOrder);

// [PUT] Cập nhật trạng thái theo đúng luồng (Đang làm → Sẵn sàng → Hoàn thành)
router.put('/:id/status', updateOrderStatus);

module.exports = router;
