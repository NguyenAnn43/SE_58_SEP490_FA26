const MenuItem = require('../models/MenuItem');
const { getVendorStatus } = require('./vendorHours');

/** Bỏ dấu, ký tự markdown, gộp khoảng trắng để so khớp tên món trong câu trả lời AI */
const normalize = (str = '') => String(str)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[*_#`>|]/g, ' ')
    .replace(/[\s ​]+/g, ' ')
    .trim();

const isWordChar = (ch) => !!ch && /[a-z0-9]/.test(ch);

/** Tìm vị trí tên món xuất hiện như một cụm từ trọn vẹn (không dính chữ trước/sau) */
const findWholePhrase = (haystack, phrase) => {
    let from = 0;
    while (from <= haystack.length) {
        const idx = haystack.indexOf(phrase, from);
        if (idx < 0) return -1;
        if (!isWordChar(haystack[idx - 1]) && !isWordChar(haystack[idx + phrase.length])) return idx;
        from = idx + 1;
    }
    return -1;
};

/**
 * Lấy các món thật được AI nhắc tới trong câu trả lời (theo thứ tự xuất hiện),
 * để frontend hiện thẻ món + nút "Thêm vào giỏ".
 */
const extractSuggestedItems = async (replyText, limit = 4) => {
    const text = normalize(replyText);
    if (!text) return [];

    const items = await MenuItem.find({ isAvailable: true })
        .populate('vendor', 'name openTime closeTime isActive isPaused pauseReason pausedUntil')
        .lean();

    // Tên dài khớp trước để "Phở Bò Đặc Biệt" không bị tính thành "Phở Bò"
    const candidates = items
        .map((item) => ({ item, key: normalize(item.name) }))
        .filter((c) => c.key.length >= 3)
        .sort((a, b) => b.key.length - a.key.length);

    const taken = [];
    const matches = [];
    for (const { item, key } of candidates) {
        const idx = findWholePhrase(text, key);
        if (idx < 0) continue;
        const end = idx + key.length;
        if (taken.some(([s, e]) => idx < e && end > s)) continue;
        taken.push([idx, end]);
        matches.push({ item, idx });
    }

    return matches
        .sort((a, b) => a.idx - b.idx)
        .slice(0, limit)
        .map(({ item }) => {
            const status = getVendorStatus(item.vendor);
            return {
                _id: item._id,
                name: item.name,
                price: item.price,
                calories: item.calories,
                imageUrl: item.imageUrl || '',
                rating: item.numReviews > 0 ? Math.round((item.rating || 0) * 10) / 10 : null,
                numReviews: item.numReviews || 0,
                description: item.description || '',
                category: item.category || '',
                countInStock: item.countInStock,
                vendor: { _id: item.vendor?._id, name: item.vendor?.name || '' },
                vendorIsOpen: status.isOpen,
                vendorStatusMessage: status.message || '',
            };
        });
};

module.exports = { extractSuggestedItems };
