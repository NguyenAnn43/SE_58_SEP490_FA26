const express = require('express');
const router = express.Router();
const {
    getAllVendors, getVendorDetail
} = require('../controllers/vendorController');

// ==============================================
// CÁC API GIAN HÀNG (PROFILE QUÁN)
// ==============================================
router.get('/', getAllVendors); // Public: Ai cũng xem được DS gian hàng

// Lấy chi tiết 1 quán (Public)
router.get('/:id', getVendorDetail);

module.exports = router;
