const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
    createOrder,
    getMyOrders,
} = require('../controllers/orderController');

// Tất cả đều yêu cầu đăng nhập
router.use(protect);

// [POST] Sinh viên đặt món
router.post('/', createOrder);

// [GET] Sinh viên xem lịch sử đơn hàng
router.get('/my-orders', getMyOrders);

module.exports = router;
