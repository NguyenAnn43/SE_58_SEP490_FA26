const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const { 
    requestTransaction, 
    getVendorWalletSummary
} = require('../controllers/transactionController');

// Tất cả liên quan đến tiền bạc đều phải đăng nhập bảo mật
router.use(protect);

// ================= API CHO NGƯỜI DÙNG =================
router.post('/request', requestTransaction); 
router.get('/vendor-wallet/me', getVendorWalletSummary);

module.exports = router;
