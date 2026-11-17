const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const {
    getMyFavorites, getMyFavoriteIds, getFavoriteStatus, addFavorite, removeFavorite,
} = require('../controllers/favoriteController');

// Bắt buộc đăng nhập + chỉ tài khoản sinh viên (user lấy từ token)
router.use(protect, (req, res, next) => {
    if (req.user.role !== 'student') {
        return res.status(403).json({ message: 'Chỉ tài khoản sinh viên mới dùng được món yêu thích.' });
    }
    next();
});

router.get('/', getMyFavorites);
router.get('/ids', getMyFavoriteIds);
router.get('/:menuItemId/status', getFavoriteStatus);
router.post('/:menuItemId', addFavorite);
router.delete('/:menuItemId', removeFavorite);

module.exports = router;
