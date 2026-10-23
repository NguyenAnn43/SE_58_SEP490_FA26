const express = require('express');
const router = express.Router();
const { getActiveTimeSlots } = require('../controllers/timeSlotController');

// [GET] Xem danh sách các khung giờ trống (Ai cũng xem được để chọn lúc đặt món)
router.get('/', getActiveTimeSlots);

module.exports = router;
