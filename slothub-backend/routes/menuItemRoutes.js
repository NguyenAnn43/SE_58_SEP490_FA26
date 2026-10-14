const express = require('express');
const router = express.Router();

// Import đầy đủ các hàm từ Controller
const {
    getAllMenuItems,
    getVendorMenu
} = require('../controllers/menuItemController');

// ================= ROUTE CÔNG KHAI (Không cần đăng nhập) =================

// [GET] /api/menuitems -> Lấy tất cả món ăn (Dùng cho trang Home)
router.get('/', getAllMenuItems);

// [GET] /api/menuitems/vendor/:vendorId -> Xem menu của 1 quán cụ thể
router.get('/vendor/:vendorId', getVendorMenu);


module.exports = router;
