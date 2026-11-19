const express = require('express');
const router = express.Router();

// Import đầy đủ các hàm từ Controller
const {
    getAllMenuItems,
    getBestsellers,
    getVendorMenu,
    getMenuItemById
} = require('../controllers/menuItemController');

// ================= ROUTE CÔNG KHAI (Không cần đăng nhập) =================

// [GET] /api/menuitems -> Lấy tất cả món ăn (Dùng cho trang Home)
router.get('/', getAllMenuItems);

// [GET] /api/menuitems/bestsellers?limit=5 -> Món bán chạy hôm nay (đặt TRƯỚC route /:id)
router.get('/bestsellers', getBestsellers);

// [GET] /api/menuitems/vendor/:vendorId -> Xem menu của 1 quán cụ thể
router.get('/vendor/:vendorId', getVendorMenu);

// [GET] /api/menuitems/:id -> Lấy chi tiết 1 món ăn (Dùng cho trang FoodDetail)
router.get('/:id', getMenuItemById);


module.exports = router;
