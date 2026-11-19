const mongoose = require('mongoose');
const Review = require('../models/Review');
const { notifyVendorNewStallReview } = require('../utils/vendorNotify');
const Order = require('../models/Order'); // Import bảng Order mới

// 1. [POST] Gửi đánh giá (Có hỗ trợ up nhiều ảnh hộp cơm)
const createReview = async (req, res) => {
    try {
        const { vendorId, rating, comment, images } = req.body;
        const userId = req.user.id; // Lấy ID khách hàng từ token đăng nhập

        if (req.user.role !== 'student') {
            return res.status(403).json({ message: 'Chỉ khách hàng mới được đánh giá gian hàng.' });
        }
        if (!mongoose.Types.ObjectId.isValid(vendorId)) {
            return res.status(400).json({ message: 'Gian hàng không hợp lệ.' });
        }
        const stars = Number(rating);
        if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
            return res.status(400).json({ message: 'Số sao phải từ 1 đến 5.' });
        }
        if (!comment || !String(comment).trim()) {
            return res.status(400).json({ message: 'Hãy để lại vài dòng nhận xét nhé!' });
        }

        // KIỂM TRA CHỐNG FAKE REVIEW: 
        // Khách hàng này đã từng mua và nhận món (Completed) tại gian hàng này chưa?
        const hasCompletedOrder = await Order.findOne({
            user: userId,
            vendor: vendorId,
            status: 'Completed' // Chỉ khi nào cầm hộp cơm trên tay mới được review
        });

        if (!hasCompletedOrder) {
            return res.status(403).json({ 
                message: 'Bạn chỉ có thể đánh giá sau khi đã đặt và nhận món thành công tại gian hàng này!' 
            });
        }

        // UC-28: mỗi khách hàng chỉ đánh giá 1 lần cho mỗi gian hàng
        const alreadyReviewed = await Review.exists({ vendorId, user: userId });
        if (alreadyReviewed) {
            return res.status(400).json({ message: 'Bạn đã đánh giá gian hàng này rồi!' });
        }

        // Lưu review vào Database
        const newReview = new Review({
            vendorId,
            user: userId,
            rating: stars,
            comment: String(comment).trim(),
            images: Array.isArray(images) ? images : []
        });
        await newReview.save();
        await notifyVendorNewStallReview(req, vendorId, newReview, req.user);

        res.status(201).json({ message: 'Cảm ơn bạn đã đánh giá gian hàng!', data: newReview });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ message: 'Bạn đã đánh giá gian hàng này rồi!' });
        }
        res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
};

// 2. [GET] Lấy danh sách đánh giá của một gian hàng cụ thể
const getVendorReviews = async (req, res) => {
    try {
        const reviews = await Review.find({ vendorId: req.params.vendorId })
            // Nâng cấp: Lấy name và lấy thêm cả avatar để Frontend hiển thị cho đẹp
            .populate('user', 'name avatar') 
            .sort({ createdAt: -1 }); // Feedback mới nhất lên đầu
            
        res.status(200).json(reviews);
    } catch (error) {
        res.status(500).json({ message: 'Lỗi server', error: error.message });
    }
};

module.exports = { createReview, getVendorReviews };