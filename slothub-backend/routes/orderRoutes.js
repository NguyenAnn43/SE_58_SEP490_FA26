const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
    createOrder,
} = require('../controllers/orderController');

// Tất cả đều yêu cầu đăng nhập
router.use(protect);

// [POST] Sinh viên đặt món
router.post('/', createOrder);

module.exports = router;
