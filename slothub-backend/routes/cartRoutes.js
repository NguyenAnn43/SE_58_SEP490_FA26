const express = require('express');
const router = express.Router();
const { getCart, addToCart } = require('../controllers/cartController');
const { protect } = require('../middlewares/authMiddleware'); // Đảm bảo bạn đã có middleware này

router.use(protect); // Tất cả các route bên dưới đều cần Login

router.get('/', getCart);
router.post('/add', addToCart);

module.exports = router;
