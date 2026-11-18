const express = require('express');
const router = express.Router();
const { protect } = require('../middlewares/authMiddleware');
const c = require('../controllers/mealPlanController');

// ===== Công khai: gói đang mở bán + quy tắc =====
router.get('/', c.listPlans);

// ===== Chủ quầy (đặt trước các route /:id) =====
router.get('/vendor/mine', protect, c.vendorPlans);
router.get('/vendor/schedule', protect, c.vendorSchedule);
router.post('/vendor', protect, c.vendorCreatePlan);
router.put('/vendor/:id', protect, c.vendorUpdatePlan);

// ===== Sinh viên =====
router.get('/subscriptions/mine', protect, c.mySubscriptions);
router.get('/subscriptions/:id/cancel-preview', protect, c.cancelPreview);
router.post('/subscriptions/:id/cancel', protect, c.cancelSubscription);
router.post('/subscriptions/:id/meals/:mealId/postpone', protect, c.postponeMeal);
router.post('/subscriptions/:id/meals/:mealId/schedule', protect, c.scheduleMeal);
router.post('/:id/subscribe', protect, c.subscribe);

module.exports = router;
