const mongoose = require('mongoose');

/**
 * Món yêu thích của sinh viên. Mỗi sinh viên chỉ lưu 1 lần cho mỗi món (unique index).
 * snapshot giữ tên/ảnh lúc thêm để vẫn hiển thị được khi món bị xoá khỏi thực đơn.
 */
const favoriteSchema = new mongoose.Schema({
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: 'MenuItem', required: true },
    snapshot: {
        name: { type: String, default: '' },
        imageUrl: { type: String, default: '' },
        price: { type: Number, default: 0 },
        vendorName: { type: String, default: '' },
    },
}, { timestamps: true });

favoriteSchema.index({ user: 1, menuItem: 1 }, { unique: true });
favoriteSchema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model('Favorite', favoriteSchema);
