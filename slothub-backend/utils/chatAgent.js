const MenuItem = require('../models/MenuItem');
const TimeSlot = require('../models/TimeSlot');
const { getVendorStatus, timeToMinutes } = require('./vendorHours');
const { validatePickupSchedule } = require('./pickupSchedule');
const { generateWithFallback } = require('./geminiClient');

/**
 * SlotAI — trợ lý đặt món.
 * - LLM CHỈ phân tích câu chat thành "hành động + tiêu chí" (JSON có cấu trúc).
 * - Backend tự lọc/sắp xếp món, tính tiền, tính calo, kiểm tra kho/giờ quầy/ví từ database.
 * - Không bao giờ tạo đơn ở đây: action "confirm_order" chỉ báo frontend gọi API /orders
 *   (frontend kèm idempotencyKey) sau khi khách đã xem đơn và chọn phương thức thanh toán.
 */

const ACTIONS = [
    'search', 'add_best', 'add_items', 'set_items', 'remove_items',
    'update_order', 'show_order', 'confirm_order', 'cancel_order', 'chat', 'clarify',
];

const SORTS = ['calories_asc', 'rating_desc', 'price_asc', 'price_desc', 'protein_desc'];

const normalize = (str = '') => String(str)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[\s ​]+/g, ' ')
    .trim();

const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const nowHHmm = () => {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** Phương thức thanh toán THỰC SỰ được cấu hình (không có COD vì hệ thống nhận tại quầy, trả trước) */
const getPaymentMethods = () => {
    const payosReady = ['PAYOS_CLIENT_ID', 'PAYOS_API_KEY', 'PAYOS_CHECKSUM_KEY']
        .every((k) => String(process.env[k] || '').trim());
    const methods = [{ id: 'wallet', label: 'Ví SlotHub' }];
    if (payosReady) methods.push({ id: 'payos', label: 'Chuyển khoản (payOS)' });
    return methods;
};

// ===================== DỮ LIỆU =====================

const loadCatalog = async () => {
    const [menuItems, slots] = await Promise.all([
        MenuItem.find({ isAvailable: true })
            .populate('vendor', 'name openTime closeTime isActive isPaused pauseReason pausedUntil')
            .lean(),
        TimeSlot.find({ isActive: true }).sort({ startTime: 1 }).lean(),
    ]);
    const byId = new Map(menuItems.map((m) => [String(m._id), m]));
    return { menuItems, slots, byId };
};

const itemCard = (m, extra = {}) => {
    const status = getVendorStatus(m.vendor);
    return {
        _id: m._id,
        name: m.name,
        price: m.price,
        calories: m.calories ?? null,
        protein: m.protein ?? null,
        carbs: m.carbs ?? null,
        fat: m.fat ?? null,
        rating: m.numReviews > 0 ? Math.round((m.rating || 0) * 10) / 10 : null,
        numReviews: m.numReviews || 0,
        description: m.description || '',
        category: m.category || '',
        imageUrl: m.imageUrl || '',
        countInStock: m.countInStock ?? null,
        vendor: {
            _id: m.vendor?._id,
            name: m.vendor?.name || '',
            openTime: m.vendor?.openTime,
            closeTime: m.vendor?.closeTime,
            isActive: m.vendor?.isActive,
            isPaused: m.vendor?.isPaused,
            pausedUntil: m.vendor?.pausedUntil,
        },
        vendorIsOpen: status.isOpen,
        vendorStatusMessage: status.message || '',
        ...extra,
    };
};

// ===================== 1) LLM PHÂN TÍCH CÂU CHAT =====================

const interpret = async (message, ctx, catalog) => {
    const menuLines = catalog.menuItems.map((m) => [
        m._id, m.name, m.vendor?.name || '', `${m.price}đ`,
        m.calories != null ? `${m.calories}kcal` : 'chưa có kcal',
        m.numReviews > 0 ? `${(m.rating || 0).toFixed(1)}★(${m.numReviews})` : 'chưa có đánh giá',
        m.category || '',
    ].join(' | ')).join('\n');

    const suggestionLines = ctx.suggestions.length
        ? ctx.suggestions.map((s, i) => `${i + 1}. ${s._id} | ${s.name}`).join('\n')
        : '(chưa gợi ý món nào)';
    const draftLines = ctx.draft.items.length
        ? ctx.draft.items.map((d, i) => {
            const m = catalog.byId.get(String(d._id));
            return `${i + 1}. ${d._id} | ${m?.name || '?'} | SL ${d.quantity}`;
        }).join('\n')
        : '(trống)';

    const prompt = `
Bạn là bộ phân tích ý định cho chatbot đặt món căng tin SlotHub (nhận món tại quầy theo khung giờ).
Giờ hiện tại: ${nowHHmm()}. Khung giờ nhận: ${catalog.slots.map((s) => `${s.startTime}-${s.endTime}`).join(', ')}.
Phương thức thanh toán đang hỗ trợ: ${getPaymentMethods().map((p) => `${p.id} (${p.label})`).join(', ')}. KHÔNG có COD/tiền mặt.

THỰC ĐƠN (id | tên | quầy | giá | calo/phần | đánh giá | danh mục):
${menuLines}

MÓN VỪA GỢI Ý (theo thứ tự hiển thị):
${suggestionLines}

ĐƠN NHÁP HIỆN TẠI:
${draftLines}
Tiêu chí tìm kiếm đang áp dụng: ${JSON.stringify(ctx.criteria || {})}

Câu của khách: "${message}"

Chọn ĐÚNG MỘT action:
- "search": khách muốn tìm/gợi ý/so sánh món (VD "món ít calo nhất", "dưới 50k", "đánh giá cao nhất", "có món nào đánh giá cao hơn không", "món khác đi").
- "add_best": khách muốn ĐẶT theo tiêu chí mà không nêu tên món (VD "đặt cho tôi bữa ít calo nhất", "đặt món rẻ nhất cho 3 người").
- "add_items": thêm món cụ thể vào đơn (VD "đặt 1 cơm gà và 1 trà đào", "đặt món này/món đầu tiên", "lấy món thứ 2", "thêm một phần nữa" = +1 món vừa nhắc gần nhất).
- "set_items": đặt LẠI số lượng tuyệt đối (VD "đổi trà đào thành 3 ly").
- "remove_items": xoá món khỏi đơn (VD "bỏ trà đào").
- "update_order": chỉ đổi phương thức thanh toán / giờ nhận / ngày nhận / ghi chú.
- "show_order": xem lại đơn.
- "confirm_order": khách XÁC NHẬN đặt đơn đang có (VD "xác nhận", "ok đặt luôn", "chốt đơn").
- "cancel_order": huỷ đơn nháp.
- "clarify": thiếu thông tin quan trọng, cần hỏi lại.
- "chat": câu hỏi chung không thuộc các loại trên (giờ mở cửa, hỏi thông tin quầy...).

Trả về DUY NHẤT JSON:
{
  "action": "...",
  "criteria": {
    "keywords": [string],           // cụm từ tên món/nguyên liệu/khẩu vị, VD ["gà"], ["trà"]; [] nếu không có
    "category": string|null,        // một trong: Cơm, Bún/Phở, Đồ ăn vặt, Đồ uống, Tráng miệng, Combo
    "excludeCategories": [string],  // VD khách nói "bữa ăn", "món ăn", "ăn trưa no bụng" (không phải đồ uống) -> ["Đồ uống"]
    "maxPrice": number|null, "minPrice": number|null,   // VNĐ, "50k" -> 50000
    "maxCalories": number|null,
    "minRating": number|null,
    "highProtein": boolean,
    "sortBy": ${JSON.stringify(SORTS)} hoặc null,
    "vendorName": string|null
  },
  "resetCriteria": boolean,         // true nếu khách bắt đầu tìm một nhu cầu HOÀN TOÀN mới
  "people": number|null,            // số người ăn (VD "cho 3 người" -> 3)
  "items": [{ "menuItemId": "id trong THỰC ĐƠN", "quantity": số }],   // add_items/set_items/remove_items
  "paymentMethod": "wallet"|"payos"|null,
  "pickupTime": "HH:mm"|null, "pickupDate": "today"|"tomorrow"|null,
  "note": string|null,
  "clarifyQuestion": string|null,   // câu hỏi lại khách (khi action = clarify)
  "unmatched": [string]             // tên món khách nói nhưng không có trong THỰC ĐƠN
}
Quy tắc: chỉ dùng id có trong THỰC ĐƠN; không bịa món; "món này" = món gợi ý đầu tiên hoặc món vừa nhắc; quantity mặc định 1.`;

    const { result } = await generateWithFallback(prompt, {
        responseMimeType: 'application/json',
        temperature: 0.1,
        maxOutputTokens: 2048,
    });
    let text = result.response.text().trim();
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '').trim();
    const parsed = JSON.parse(text);
    if (!ACTIONS.includes(parsed.action)) parsed.action = 'chat';
    return parsed;
};

// ===================== 2) TÌM & XẾP HẠNG MÓN (BACKEND, DỮ LIỆU THẬT) =====================

const mergeCriteria = (prev = {}, next = {}, reset = false) => {
    const base = reset ? {} : { ...prev };
    const out = { ...base };
    for (const [k, v] of Object.entries(next || {})) {
        if (v === null || v === undefined) continue;
        if (Array.isArray(v) && !v.length && !reset) continue; // mảng rỗng = không đổi tiêu chí cũ
        if (k === 'highProtein' && v === false && !reset) continue;
        out[k] = v;
    }
    if (out.sortBy && !SORTS.includes(out.sortBy)) delete out.sortBy;
    return out;
};

const searchMenu = (criteria, catalog, { limit = 4, excludeIds = [] } = {}) => {
    const notes = [];
    const exclude = new Set(excludeIds.map(String));
    const kw = (criteria.keywords || []).map(normalize).filter(Boolean);
    const cat = criteria.category ? normalize(criteria.category) : null;
    const excluded = new Set((criteria.excludeCategories || []).map(normalize));
    const vendorKw = criteria.vendorName ? normalize(criteria.vendorName) : null;

    let pool = catalog.menuItems.filter((m) => {
        if (exclude.has(String(m._id))) return false;
        if (m.vendor?.isActive === false) return false;
        if (m.countInStock != null && m.countInStock <= 0) return false;
        const hay = normalize([m.name, m.category, m.vendor?.name, m.description].join(' '));
        if (kw.length && !kw.some((k) => hay.includes(k))) return false;
        if (cat && normalize(m.category) !== cat) return false;
        if (excluded.has(normalize(m.category))) return false;
        if (vendorKw && !normalize(m.vendor?.name).includes(vendorKw)) return false;
        if (criteria.maxPrice != null && m.price > criteria.maxPrice) return false;
        if (criteria.minPrice != null && m.price < criteria.minPrice) return false;
        return true;
    });
    const matchedBeforeData = pool.length;

    // Tiêu chí cần dữ liệu: chỉ xét món ĐÃ CÓ dữ liệu, báo rõ số món bị loại vì thiếu dữ liệu
    if (criteria.maxCalories != null || criteria.sortBy === 'calories_asc') {
        const withCal = pool.filter((m) => m.calories != null);
        if (withCal.length < pool.length) notes.push(`${pool.length - withCal.length} món phù hợp chưa có dữ liệu calo nên không được so sánh.`);
        pool = withCal;
        if (criteria.maxCalories != null) pool = pool.filter((m) => m.calories <= criteria.maxCalories);
    }
    if (criteria.minRating != null || criteria.sortBy === 'rating_desc') {
        const rated = pool.filter((m) => m.numReviews > 0);
        if (criteria.minRating != null) {
            if (rated.length < pool.length) notes.push(`${pool.length - rated.length} món chưa có đánh giá nên không xét.`);
            pool = rated.filter((m) => (m.rating || 0) >= criteria.minRating);
        }
    }
    if (criteria.highProtein || criteria.sortBy === 'protein_desc') {
        const withProtein = pool.filter((m) => m.protein != null);
        if (!withProtein.length) {
            notes.push('Hiện chưa quầy nào nhập dữ liệu protein, nên mình chưa thể lọc theo protein — các món dưới đây chỉ xét theo tiêu chí còn lại.');
        } else {
            if (withProtein.length < pool.length) notes.push(`${pool.length - withProtein.length} món chưa có dữ liệu protein nên không xét.`);
            pool = withProtein;
        }
    }

    // Ưu tiên quầy đang mở; nếu không có thì vẫn trả về nhưng ghi chú
    const openPool = pool.filter((m) => getVendorStatus(m.vendor).isOpen);
    if (openPool.length) {
        pool = openPool;
    } else if (pool.length) {
        notes.push('Các món phù hợp đều thuộc quầy đang đóng lúc này — bạn vẫn có thể đặt trước cho khung giờ quầy mở.');
    }

    const sortBy = criteria.sortBy
        || (criteria.highProtein && pool.some((m) => m.protein != null) ? 'protein_desc' : null)
        || 'rating_desc';
    const byRating = (a, b) => ((b.numReviews > 0 ? b.rating : -1) - (a.numReviews > 0 ? a.rating : -1)) || (b.numReviews - a.numReviews);
    const sorters = {
        calories_asc: (a, b) => (a.calories - b.calories) || byRating(a, b),
        rating_desc: (a, b) => byRating(a, b) || (a.price - b.price),
        price_asc: (a, b) => (a.price - b.price) || byRating(a, b),
        price_desc: (a, b) => (b.price - a.price) || byRating(a, b),
        protein_desc: (a, b) => ((b.protein ?? -1) - (a.protein ?? -1)) || byRating(a, b),
    };
    pool.sort(sorters[sortBy] || sorters.rating_desc);

    const total = pool.length;
    const results = pool.slice(0, limit).map((m, idx) => itemCard(m, { reason: buildReason(m, idx, { criteria, sortBy, total }) }));
    return { results, total, matchedBeforeData, notes, sortBy };
};

const buildReason = (m, idx, { criteria, sortBy, total }) => {
    const parts = [];
    const rank = idx === 0 ? 'nhất' : `thứ ${idx + 1}`;
    if (sortBy === 'calories_asc') parts.push(`Ít calo ${rank} (${m.calories} kcal) trong ${total} món phù hợp có dữ liệu calo`);
    if (sortBy === 'rating_desc') {
        parts.push(m.numReviews > 0
            ? `Đánh giá cao ${rank}: ${(m.rating || 0).toFixed(1)}/5 (${m.numReviews} lượt) trong ${total} món phù hợp`
            : 'Chưa có đánh giá — xếp sau các món đã được đánh giá');
    }
    if (sortBy === 'price_asc') parts.push(`Giá thấp ${rank} (${vnd(m.price)}) trong ${total} món phù hợp`);
    if (sortBy === 'price_desc') parts.push(`Giá cao ${rank} (${vnd(m.price)})`);
    if (sortBy === 'protein_desc' && m.protein != null) parts.push(`Nhiều protein ${rank} (${m.protein}g/phần)`);
    if (criteria.maxPrice != null) parts.push(`giá ${vnd(m.price)} ≤ ${vnd(criteria.maxPrice)}`);
    if (criteria.maxCalories != null && m.calories != null) parts.push(`${m.calories} kcal ≤ ${criteria.maxCalories} kcal`);
    if (criteria.minRating != null && m.numReviews > 0) parts.push(`đánh giá ${(m.rating || 0).toFixed(1)} ≥ ${criteria.minRating}`);
    return parts.join(' · ');
};

const describeCriteria = (c = {}) => {
    const parts = [];
    if (c.keywords?.length) parts.push(`"${c.keywords.join(', ')}"`);
    if (c.category) parts.push(`danh mục ${c.category}`);
    if (c.excludeCategories?.length) parts.push(`không gồm ${c.excludeCategories.join(', ')}`);
    if (c.vendorName) parts.push(`quầy ${c.vendorName}`);
    if (c.maxPrice != null) parts.push(`giá ≤ ${vnd(c.maxPrice)}`);
    if (c.minPrice != null) parts.push(`giá ≥ ${vnd(c.minPrice)}`);
    if (c.maxCalories != null) parts.push(`≤ ${c.maxCalories} kcal`);
    if (c.minRating != null) parts.push(`đánh giá ≥ ${c.minRating}`);
    if (c.highProtein && c.sortBy !== 'protein_desc') parts.push('nhiều protein');
    const sortText = {
        calories_asc: 'ít calo nhất', rating_desc: 'đánh giá cao nhất', price_asc: 'rẻ nhất',
        price_desc: 'giá cao nhất', protein_desc: 'nhiều protein nhất',
    }[c.sortBy];
    if (sortText) parts.push(sortText);
    return parts.join(', ');
};

// ===================== 3) ĐƠN NHÁP =====================

const sanitizeDraft = (draft, catalog) => {
    const items = [];
    for (const it of Array.isArray(draft?.items) ? draft.items : []) {
        const id = String(it?._id || '');
        const q = Math.floor(Number(it?.quantity) || 0);
        if (catalog.byId.has(id) && q > 0 && !items.some((x) => x._id === id)) items.push({ _id: id, quantity: Math.min(q, 50) });
    }
    const slotIds = new Set(catalog.slots.map((s) => String(s._id)));
    const methods = getPaymentMethods().map((p) => p.id);
    return {
        items,
        pickupSlot: slotIds.has(String(draft?.pickupSlot || '')) ? String(draft.pickupSlot) : null,
        pickupDate: draft?.pickupDate === 'tomorrow' ? 'tomorrow' : 'today',
        paymentMethod: methods.includes(draft?.paymentMethod) ? draft.paymentMethod : null,
        note: String(draft?.note || '').slice(0, 200),
    };
};

const pickSlotForTime = (slots, pickupTime) => {
    const t = timeToMinutes(pickupTime);
    return slots.find((s) => s.startTime === pickupTime)
        || slots.find((s) => timeToMinutes(s.startTime) <= t && t < timeToMinutes(s.endTime))
        || slots.find((s) => timeToMinutes(s.startTime) >= t)
        || slots[slots.length - 1];
};

const defaultSlot = (slots) => {
    const nowMin = timeToMinutes(nowHHmm());
    const today = slots.find((s) => timeToMinutes(s.endTime) > nowMin);
    return today ? { slot: today, date: 'today' } : { slot: slots[0], date: 'tomorrow' };
};

/** Tính toàn bộ thông tin hiển thị của đơn nháp từ DB (không tin giá/tổng do client gửi) */
const buildDraftView = (draft, catalog, user) => {
    const slot = catalog.slots.find((s) => String(s._id) === draft.pickupSlot) || null;
    const warnings = [];
    const missing = [];

    const items = draft.items.map((d) => {
        const m = catalog.byId.get(d._id);
        let quantity = d.quantity;
        if (m.countInStock != null && m.countInStock > 0 && quantity > m.countInStock) {
            warnings.push(`"${m.name}" chỉ còn ${m.countInStock} phần — đã giảm số lượng.`);
            quantity = m.countInStock;
        }
        if (slot) {
            const st = getVendorStatus(m.vendor, { slotStart: slot.startTime, slotEnd: slot.endTime });
            if (!st.isOpen) warnings.push(st.message);
        }
        return itemCard(m, {
            quantity,
            lineTotal: m.price * quantity,
            lineCalories: m.calories != null ? m.calories * quantity : null,
        });
    });

    if (!items.length) missing.push('món ăn');
    if (!slot) missing.push('khung giờ nhận');
    if (!draft.paymentMethod) missing.push('phương thức thanh toán');
    if (slot && draft.pickupDate === 'today') {
        const check = validatePickupSchedule({ startTime: slot.startTime, endTime: slot.endTime, pickupDate: 'today' });
        if (check.error) warnings.push(check.error);
    }

    const subtotal = items.reduce((s, i) => s + i.lineTotal, 0);
    const withCal = items.filter((i) => i.lineCalories != null);
    const totalCalories = withCal.reduce((s, i) => s + i.lineCalories, 0);
    const walletBalance = user?.walletBalance ?? null;
    if (draft.paymentMethod === 'wallet' && walletBalance != null && walletBalance < subtotal) {
        warnings.push(`Số dư ví (${vnd(walletBalance)}) không đủ cho ${vnd(subtotal)}.`);
    }

    return {
        ...draft,
        items,
        slots: catalog.slots.map((s) => ({ _id: s._id, startTime: s.startTime, endTime: s.endTime })),
        paymentMethods: getPaymentMethods(),
        subtotal,
        discount: 0,
        deliveryFee: 0,
        total: subtotal,
        totalCalories: withCal.length ? totalCalories : null,
        caloriesMissingFor: items.filter((i) => i.calories == null).map((i) => i.name),
        walletBalance,
        warnings: [...new Set(warnings)],
        missing,
        ready: missing.length === 0 && warnings.length === 0,
    };
};

const applyIntentToDraft = (intent, draft, catalog, { bestItems = [] } = {}) => {
    const next = { ...draft, items: draft.items.map((i) => ({ ...i })) };
    const find = (id) => next.items.find((i) => i._id === String(id));
    const valid = (intent.items || []).filter((it) => catalog.byId.has(String(it.menuItemId)));
    const changed = [];

    if (intent.action === 'add_items' || intent.action === 'add_best') {
        const toAdd = intent.action === 'add_best'
            ? bestItems.map((m) => ({ menuItemId: m._id, quantity: Math.max(1, Number(intent.people) || 1) }))
            : valid;
        for (const it of toAdd) {
            const q = Math.max(1, Math.floor(Number(it.quantity) || 1));
            const cur = find(it.menuItemId);
            if (cur) cur.quantity += q;
            else next.items.push({ _id: String(it.menuItemId), quantity: q });
            changed.push(`+${q} ${catalog.byId.get(String(it.menuItemId)).name}`);
        }
    }
    if (intent.action === 'set_items') {
        for (const it of valid) {
            const q = Math.max(0, Math.floor(Number(it.quantity) || 0));
            const cur = find(it.menuItemId);
            if (q === 0) next.items = next.items.filter((i) => i._id !== String(it.menuItemId));
            else if (cur) cur.quantity = q;
            else next.items.push({ _id: String(it.menuItemId), quantity: q });
            changed.push(`${catalog.byId.get(String(it.menuItemId)).name} = ${q}`);
        }
    }
    if (intent.action === 'remove_items') {
        for (const it of valid) {
            next.items = next.items.filter((i) => i._id !== String(it.menuItemId));
            changed.push(`bỏ ${catalog.byId.get(String(it.menuItemId)).name}`);
        }
    }

    // Các trường đơn có thể đi kèm bất kỳ câu nào ("đặt 2 trà đào, nhận 11h30, trả ví")
    const methods = getPaymentMethods().map((p) => p.id);
    if (intent.paymentMethod && methods.includes(intent.paymentMethod)) next.paymentMethod = intent.paymentMethod;
    if (intent.note) next.note = String(intent.note).slice(0, 200);
    if (intent.pickupDate === 'tomorrow' || intent.pickupDate === 'today') next.pickupDate = intent.pickupDate;
    if (intent.pickupTime && catalog.slots.length) next.pickupSlot = String(pickSlotForTime(catalog.slots, intent.pickupTime)._id);

    // Có món nhưng chưa có khung giờ → chọn khung sắp tới (khách đổi được trên thẻ đơn)
    if (next.items.length && !next.pickupSlot && catalog.slots.length) {
        const d = defaultSlot(catalog.slots);
        next.pickupSlot = String(d.slot._id);
        if (!intent.pickupDate) next.pickupDate = d.date;
    }
    // Khung đã qua hôm nay & khách không nói "hôm nay" → chuyển sang mai
    const slot = catalog.slots.find((s) => String(s._id) === next.pickupSlot);
    if (slot && next.pickupDate === 'today' && intent.pickupDate !== 'today') {
        const check = validatePickupSchedule({ startTime: slot.startTime, endTime: slot.endTime, pickupDate: 'today' });
        if (check.error) next.pickupDate = 'tomorrow';
    }
    return { draft: next, changed };
};

// ===================== 4) MỘT LƯỢT HỘI THOẠI =====================

/**
 * @returns {Promise<null | { reply, suggestions?, draft?, criteria?, confirm? }>}
 *          null = để controller trả lời như câu hỏi chung (LLM tư vấn tự do)
 */
const handleChatTurn = async ({ message, context = {}, user }) => {
    const catalog = await loadCatalog();
    const ctx = {
        suggestions: (Array.isArray(context.suggestions) ? context.suggestions : [])
            .slice(0, 8)
            .map((s) => ({ _id: String(s?._id || ''), name: String(s?.name || '').slice(0, 80) }))
            .filter((s) => catalog.byId.has(s._id)),
        draft: sanitizeDraft(context.draft, catalog),
        criteria: context.criteria && typeof context.criteria === 'object' ? context.criteria : {},
    };

    const intent = await interpret(message, ctx, catalog);
    const unmatched = (intent.unmatched || []).filter(Boolean);
    let unmatchedText = unmatched.length ? `\nMình không tìm thấy món: ${unmatched.join(', ')} trong thực đơn.` : '';
    // Khách đòi COD/tiền mặt: hệ thống chưa hỗ trợ → nói rõ, liệt kê phương thức đang có
    const codRequested = /\bcod\b|tien mat|tra khi nhan|thanh toan khi nhan/.test(normalize(message));
    if (codRequested) {
        unmatchedText += `\nSlotHub chưa hỗ trợ thanh toán tiền mặt/COD (đơn được thanh toán trước khi nhận tại quầy). Phương thức đang có: ${getPaymentMethods().map((p) => p.label).join(' / ')}.`;
    }

    if (intent.action === 'chat') return null;

    if (intent.action === 'clarify') {
        if (codRequested) {
            return { reply: `${unmatchedText.trim()}\nBạn muốn chọn phương thức nào?`, criteria: ctx.criteria };
        }
        return {
            reply: (intent.clarifyQuestion || 'Bạn nói rõ hơn giúp mình món, số lượng hoặc tiêu chí nhé?') + unmatchedText,
            criteria: ctx.criteria,
        };
    }

    const needsStudent = ['add_best', 'add_items', 'set_items', 'remove_items', 'update_order', 'show_order', 'confirm_order', 'cancel_order'];
    if (needsStudent.includes(intent.action) && (!user || user.role !== 'student')) {
        return { reply: 'Bạn đăng nhập tài khoản sinh viên để mình lên đơn giúp nhé! 🔐' };
    }

    // ----- Tìm / gợi ý -----
    if (intent.action === 'search' || intent.action === 'add_best') {
        const criteria = mergeCriteria(ctx.criteria, intent.criteria, intent.resetCriteria);
        const { results, total, notes } = searchMenu(criteria, catalog);
        const desc = describeCriteria(criteria);

        if (intent.action === 'search') {
            if (!results.length) {
                return {
                    reply: `Mình không tìm thấy món nào khớp${desc ? ` (${desc})` : ''} trong dữ liệu hiện có 😥${notes.length ? '\n' + notes.join('\n') : ''}${unmatchedText}\nBạn thử nới tiêu chí (VD tăng ngân sách) nhé!`,
                    suggestions: [],
                    criteria,
                };
            }
            const top = results[0];
            const headline = criteria.sortBy === 'calories_asc'
                ? `Món ít calo nhất là **${top.name}** (${top.calories} kcal/phần)`
                : criteria.sortBy === 'price_asc'
                    ? `Món rẻ nhất là **${top.name}** (${vnd(top.price)})`
                    : top.rating != null
                        ? `Nổi bật nhất là **${top.name}** (${top.rating}/5, ${top.numReviews} lượt đánh giá)`
                        : `Gợi ý đầu tiên là **${top.name}**`;
            return {
                reply: `Mình lọc được ${total} món phù hợp${desc ? ` (${desc})` : ''} từ dữ liệu thực đơn. ${headline}.${notes.length ? '\n' + notes.join('\n') : ''}${unmatchedText}\nBấm **Thêm vào đơn** hoặc nhắn "đặt món đầu tiên" để lên đơn nhé!`,
                suggestions: results,
                criteria,
            };
        }

        // add_best: đặt theo tiêu chí → lấy món đứng đầu
        if (!results.length) {
            return {
                reply: `Mình chưa tìm được món phù hợp${desc ? ` (${desc})` : ''} để lên đơn.${notes.length ? '\n' + notes.join('\n') : ''} Bạn đổi tiêu chí giúp mình nhé!`,
                criteria,
            };
        }
        const { draft, changed } = applyIntentToDraft(intent, ctx.draft, catalog, { bestItems: [results[0]] });
        const view = buildDraftView(draft, catalog, user);
        return {
            reply: `Mình chọn **${results[0].name}** — ${results[0].reason}.${notes.length ? '\n' + notes.join('\n') : ''}\nĐã thêm vào đơn (${changed.join(', ')}). Bạn xem lại đơn bên dưới, chọn phương thức thanh toán rồi xác nhận nhé!`,
            suggestions: results,
            draft: view,
            criteria,
        };
    }

    // ----- Huỷ đơn nháp -----
    if (intent.action === 'cancel_order') {
        return {
            reply: 'Mình đã huỷ đơn nháp. Khi nào cần, bạn cứ nhắn món muốn đặt nhé! 🍱',
            draft: buildDraftView({ items: [], pickupSlot: null, pickupDate: 'today', paymentMethod: null, note: '' }, catalog, user),
        };
    }

    // ----- Thêm / sửa / xoá món, đổi thanh toán / giờ nhận, xem / xác nhận đơn -----
    const { draft, changed } = applyIntentToDraft(intent, ctx.draft, catalog);
    const view = buildDraftView(draft, catalog, user);

    if (intent.action === 'confirm_order') {
        if (!view.items.length) return { reply: 'Đơn nháp đang trống — bạn chọn món trước nhé!', draft: view };
        if (!view.ready) {
            const need = view.missing.length ? `Còn thiếu: ${view.missing.join(', ')}.` : '';
            const askPay = view.missing.includes('phương thức thanh toán')
                ? `\nBạn muốn thanh toán bằng phương thức nào? (${view.paymentMethods.map((p) => p.label).join(' / ')})`
                : '';
            return {
                reply: `Chưa thể đặt đơn. ${need}${view.warnings.length ? '\n' + view.warnings.join('\n') : ''}${askPay}`,
                draft: view,
            };
        }
        return {
            reply: `Đang gửi đơn ${vnd(view.total)} (${view.paymentMethods.find((p) => p.id === view.paymentMethod)?.label}) lên hệ thống...`,
            draft: view,
            confirm: true,
        };
    }

    if (['add_items', 'set_items', 'remove_items'].includes(intent.action) && !changed.length) {
        return {
            reply: `Mình chưa xác định được món cần thay đổi.${unmatchedText}\nBạn ghi rõ tên món giúp mình nhé (VD "đặt 2 Trà Đào Cam Sả").`,
            draft: view,
        };
    }

    const lines = [];
    if (changed.length) lines.push(`Đã cập nhật đơn: ${changed.join(', ')}.`);
    if (intent.action === 'update_order' || intent.paymentMethod) {
        const pm = view.paymentMethods.find((p) => p.id === view.paymentMethod);
        if (pm) lines.push(`Phương thức thanh toán: ${pm.label}.`);
    }
    lines.push(view.items.length
        ? `Tổng ${vnd(view.total)}${view.totalCalories != null ? ` · ${view.totalCalories} kcal` : ''}.`
        : 'Đơn nháp đang trống.');
    if (view.items.length && !view.paymentMethod) {
        lines.push(`Bạn muốn thanh toán bằng phương thức nào? (${view.paymentMethods.map((p) => p.label).join(' / ')})`);
    } else if (view.ready) {
        lines.push('Kiểm tra lại rồi bấm **Xác nhận đặt** (hoặc nhắn "xác nhận") nhé!');
    }
    return { reply: lines.join('\n') + unmatchedText, draft: view };
};

/** Tính lại đơn nháp khi khách sửa trực tiếp trên thẻ đơn (số lượng, giờ nhận, thanh toán...) */
const refreshDraft = async ({ draft, user }) => {
    const catalog = await loadCatalog();
    const clean = sanitizeDraft(draft, catalog);
    if (clean.items.length && !clean.pickupSlot && catalog.slots.length) {
        const d = defaultSlot(catalog.slots);
        clean.pickupSlot = String(d.slot._id);
        clean.pickupDate = d.date;
    }
    return buildDraftView(clean, catalog, user);
};

module.exports = { handleChatTurn, refreshDraft, getPaymentMethods, searchMenu, loadCatalog };
