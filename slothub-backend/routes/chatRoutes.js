const express = require('express');
const router = express.Router();
const { chatWithAI, refreshChatDraft } = require('../controllers/chatController');

// [POST] Gọi API để chat với AI (tìm món, lên đơn nháp, xác nhận đặt)
router.post('/chat', chatWithAI);

// [POST] Tính lại đơn nháp khi khách sửa trực tiếp trên thẻ đơn trong chat
router.post('/draft', refreshChatDraft);

module.exports = router;
