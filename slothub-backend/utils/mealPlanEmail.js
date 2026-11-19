const sendEmail = require('./sendEmail');


/**
 * Email cho gói ăn tuần / tháng. Mọi hàm đều "gửi rồi quên": lỗi email chỉ ghi log,
 * KHÔNG làm hỏng việc mua / dời / huỷ gói.
 */

const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
/** 'YYYY-MM-DD' → 'T6 20/11' */
const fmtDate = (key) => {
    if (!key) return 'Chưa chọn ngày';
    const d = new Date(`${key}T00:00:00Z`);
    return `${WEEKDAYS[d.getUTCDay()]} ${key.slice(8, 10)}/${key.slice(5, 7)}`;
};

const STATUS_LABEL = {
    SCHEDULED: { text: 'Đã xếp ngày', color: '#2563eb' },
    UNSCHEDULED: { text: 'Chưa chọn ngày', color: '#d97706' },
    ORDERED: { text: 'Đã tạo đơn', color: '#16a34a' },
    REFUNDED: { text: 'Đã hoàn tiền', color: '#64748b' },
    FORFEITED: { text: 'Không hoàn', color: '#64748b' },
};

const loadUser = async (userOrId) => {
    if (userOrId?.email) return userOrId;
    const User = require('../models/User');
    return User.findById(userOrId).select('name email').lean();
};

const scheduleTable = (sub) => {
    const meals = [...(sub.meals || [])].sort((a, b) => {
        if (!a.date) return 1;
        if (!b.date) return -1;
        return a.date.localeCompare(b.date);
    });
    const rows = meals.map((m, i) => {
        const st = STATUS_LABEL[m.status] || { text: m.status, color: '#64748b' };
        const extra = m.penalty > 0 ? ` <span style="color:#dc2626;">(+${vnd(m.penalty)})</span>` : '';
        return `<tr>
            <td style="padding:7px 0;border-bottom:1px solid #f1f5f9;color:#94a3b8;">Bữa ${i + 1}</td>
            <td style="padding:7px 4px;border-bottom:1px solid #f1f5f9;font-weight:700;">${fmtDate(m.date)}${extra}</td>
            <td style="padding:7px 0;border-bottom:1px solid #f1f5f9;text-align:right;color:${st.color};font-weight:700;font-size:12px;">${st.text}</td>
        </tr>`;
    }).join('');
    return `<table style="width:100%;font-size:14px;color:#334155;">${rows}</table>`;
};

const layout = ({ user, title, intro, sub, body = '', note = '' }) => `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:Segoe UI,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:linear-gradient(135deg,#F27124,#ff985e);border-radius:20px 20px 0 0;padding:28px 24px;color:#fff;">
      <h1 style="margin:0;font-size:22px;">SlotHub · Gói ăn</h1>
      <p style="margin:8px 0 0;opacity:0.95;font-size:14px;">Xin chào ${user.name || 'bạn'}, ${title}</p>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 20px 20px;box-shadow:0 10px 40px rgba(0,0,0,0.06);">
      <p style="color:#475569;font-size:14px;line-height:1.6;margin-top:0;">${intro}</p>
      <div style="border:2px solid #f1f5f9;border-radius:16px;padding:18px;background:#fafafa;margin-bottom:16px;">
        <h3 style="margin:0 0 4px;color:#F27124;font-size:17px;">📦 ${sub.planName}</h3>
        <p style="margin:0 0 12px;color:#64748b;font-size:13px;">
          🏪 ${sub.vendorName} · 🍱 ${sub.menuItemName} · ⏰ nhận ${sub.slotStart} – ${sub.slotEnd}<br/>
          Hạn dùng ${fmtDate(sub.validFrom)} → ${fmtDate(sub.validUntil)} · dời tối đa đến ${fmtDate(sub.finalDate)}
        </p>
        ${body}
        ${scheduleTable(sub)}
      </div>
      ${note ? `<p style="font-size:12px;color:#64748b;line-height:1.6;background:#fff7ed;border-radius:12px;padding:12px;margin:0;">${note}</p>` : ''}
      <p style="font-size:12px;color:#94a3b8;text-align:center;margin:20px 0 0;">Quản lý gói tại SlotHub → avatar → <b>Gói ăn tuần / tháng</b>. Email tự động — không trả lời email này.</p>
    </div>
  </div>
</body></html>`;

const RULES_NOTE = (sub) => `Quy định: dời / xếp ngày trước <b>20:00 hôm trước</b>. Gói có ${sub.freePostpones} lần dời miễn phí; dời quá số lần này thì bữa đó tính giá lẻ (trừ thêm ${vnd(Math.max(0, sub.retailUnitPrice - sub.unitPrice))}).
Bữa chưa dùng khi hết hạn chỉ được hoàn 50% (quầy nghỉ → hoàn 100%). Mã QR + OTP của từng bữa được gửi qua email khi quầy làm xong bữa đó.`;

const send = async (user, subject, html, text) => {
    if (!user?.email) return;
    await sendEmail({ email: user.email, subject, html, message: text });
};

/**
 * kind: subscribe | schedule | postpone | cancel | expire | reminder
 * extra: { date, fromDate, toDate, penalty, refund, unscheduled }
 */
const buildPlanEmail = (kind, sub, extra = {}) => {
    const unscheduled = (sub.meals || []).filter((m) => m.status === 'UNSCHEDULED').length;
    switch (kind) {
        case 'subscribe':
            return {
                subject: `✅ [SlotHub] Mua ${sub.planName} thành công — lịch ăn của bạn`,
                title: 'bạn đã mua gói ăn thành công!',
                intro: `Đã thanh toán <b>${vnd(sub.totalPaid)}</b> cho ${sub.mealsCount} bữa (${vnd(sub.unitPrice)}/bữa, giảm ${sub.discountPercent}% so với giá lẻ).${unscheduled ? ` Còn <b>${unscheduled} bữa chưa chọn ngày</b> — nhớ chọn trước ${fmtDate(sub.finalDate)}.` : ''}`,
                note: RULES_NOTE(sub),
            };
        case 'schedule':
            return {
                subject: `📅 [SlotHub] Đã xếp bữa ${sub.planName} vào ${fmtDate(extra.date)}`,
                title: `bữa gói đã được xếp vào <b>${fmtDate(extra.date)}</b>.`,
                intro: `Bạn nhận món lúc ${sub.slotStart} – ${sub.slotEnd} ngày ${fmtDate(extra.date)}. Lịch ăn mới nhất:`,
                note: unscheduled ? `Còn ${unscheduled} bữa chưa chọn ngày — hạn chót ${fmtDate(sub.finalDate)}.` : '',
            };
        case 'postpone':
            return {
                subject: `🔁 [SlotHub] Đã dời bữa ${sub.planName} ${fmtDate(extra.fromDate)}${extra.toDate ? ` → ${fmtDate(extra.toDate)}` : ''}`,
                title: extra.toDate
                    ? `bữa ngày ${fmtDate(extra.fromDate)} đã được dời sang <b>${fmtDate(extra.toDate)}</b>.`
                    : `bữa ngày ${fmtDate(extra.fromDate)} đã được dời — bạn chọn ngày mới sau.`,
                intro: extra.penalty > 0
                    ? `Lần dời này vượt số lần miễn phí nên bữa tính giá lẻ — đã trừ thêm <b>${vnd(extra.penalty)}</b> từ ví SlotHub.`
                    : `Lần dời miễn phí. Còn ${Math.max(0, sub.freePostpones - sub.postponesUsed)} lượt dời miễn phí.`,
                note: unscheduled ? `Còn ${unscheduled} bữa chưa chọn ngày — hạn chót ${fmtDate(sub.finalDate)}.` : '',
            };
        case 'cancel':
        case 'expire':
            return {
                subject: `${kind === 'cancel' ? '🛑' : '⌛'} [SlotHub] ${sub.planName} đã ${kind === 'cancel' ? 'huỷ' : 'hết hạn'} — hoàn ${vnd(extra.refund)}`,
                title: kind === 'cancel' ? 'gói ăn của bạn đã được huỷ.' : 'gói ăn của bạn đã hết hạn.',
                intro: extra.refund > 0
                    ? `Đã hoàn <b>${vnd(extra.refund)}</b> vào ví SlotHub cho các bữa chưa dùng.`
                    : 'Gói đã kết thúc, không có bữa nào cần hoàn tiền.',
            };
        case 'reminder':
            return {
                subject: `⏰ [SlotHub] ${sub.planName}: còn ${unscheduled} bữa chưa chọn ngày`,
                title: `bạn còn <b>${unscheduled} bữa</b> chưa chọn ngày ăn.`,
                intro: `Hạn chọn ngày cuối cùng là <b>${fmtDate(sub.finalDate)}</b>. Sau hạn, mỗi bữa chưa dùng chỉ được hoàn 50% giá gói.`,
            };
        default:
            return null;
    }
};

/** Gửi email về gói (không chờ, không ném lỗi) */
const emailPlan = (kind, sub, extra = {}, userOrId = null) => {
    (async () => {
        const user = await loadUser(userOrId || sub.user);
        const tpl = buildPlanEmail(kind, sub, extra);
        if (!user?.email || !tpl) return;
        const html = layout({ user, title: tpl.title, intro: tpl.intro, sub, note: tpl.note });
        await send(user, tpl.subject, html, `${tpl.subject.replace(/<[^>]+>/g, '')}`);
        console.log(`📧 [Gói ăn] ${kind} → ${sub.planName} (${String(sub._id).slice(-6)})`);
    })().catch((err) => console.log(`❌ Lỗi gửi email gói ăn (${kind}):`, err.message));
};

// ---------- Email MÃ NHẬN MÓN của bữa gói: mẫu RIÊNG (tông xanh lá), khác email đơn thường ----------
const GREEN = '#059669';

/** Thứ tự bữa trong gói theo ngày ăn (bữa chưa có ngày xếp cuối) → "Bữa 2/5" */
const mealIndexOf = (sub, mealId) => {
    const sorted = [...sub.meals].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    return sorted.findIndex((m) => String(m._id) === String(mealId)) + 1;
};

const mealPickupBlock = (sub, order) => {
    const { getPickupCodeExpiresAt } = require('./pickupCode');
    const orderId = String(order._id);
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(orderId)}`;
    const exp = getPickupCodeExpiresAt(order);
    const expText = exp ? exp.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '30 phút sau khung giờ nhận';
    const meal = sub.meals.find((m) => String(m._id) === String(order.mealPlanMealId));
    const idx = meal ? mealIndexOf(sub, meal._id) : 0;
    const qty = order.items?.[0]?.quantity || 1;
    return `
      <div style="border:2px solid #d1fae5;border-radius:16px;padding:20px;margin-bottom:16px;background:#f0fdf4;">
        <p style="margin:0 0 6px;"><span style="display:inline-block;background:${GREEN};color:#fff;font-size:12px;font-weight:800;padding:4px 10px;border-radius:999px;">📦 BỮA ${idx || '?'}/${sub.mealsCount} CỦA GÓI</span></p>
        <h3 style="margin:6px 0 2px;color:#065f46;font-size:19px;">${qty} × ${sub.menuItemName}</h3>
        <p style="margin:0 0 4px;color:#047857;font-size:13px;">🏪 ${sub.vendorName} · ⏰ nhận <b>${sub.slotStart} – ${sub.slotEnd}</b> · ${fmtDate(meal?.date)}</p>
        <p style="margin:0 0 14px;color:#64748b;font-size:12px;">Mã đơn #${orderId.slice(-6).toUpperCase()} · <b style="color:${GREEN};">Đã trả trước trong gói — không cần thanh toán thêm</b></p>
        <div style="display:flex;flex-wrap:wrap;gap:16px;align-items:center;background:#fff;border-radius:12px;padding:16px;border:1px dashed #6ee7b7;">
          <img src="${qrUrl}" alt="QR nhận món" width="160" height="160" style="border-radius:8px;" />
          <div>
            <p style="margin:0 0 6px;font-size:13px;color:#64748b;">Mã OTP nhận bữa gói</p>
            <p style="margin:0 0 10px;font-size:32px;font-weight:900;letter-spacing:6px;color:#064e3b;">${order.otpCode || '----'}</p>
            <p style="margin:0;font-size:12px;color:#94a3b8;">Đưa mã QR hoặc đọc OTP cho nhân viên quầy. Hết hạn: <strong>${expText}</strong></p>
          </div>
        </div>
      </div>`;
};

const planProgress = (sub) => {
    const used = sub.meals.filter((m) => m.status === 'ORDERED').length;
    const pct = Math.round((used / Math.max(1, sub.mealsCount)) * 100);
    const upcoming = sub.meals.filter((m) => m.status === 'SCHEDULED' && m.date).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 4);
    const unscheduled = sub.meals.filter((m) => m.status === 'UNSCHEDULED').length;
    return `
      <div style="border:1px solid #e2e8f0;border-radius:14px;padding:14px 16px;margin-bottom:14px;">
        <p style="margin:0 0 8px;font-size:13px;color:#334155;font-weight:700;">Tiến độ gói: ${used}/${sub.mealsCount} bữa · còn ${Math.max(0, sub.freePostpones - sub.postponesUsed)} lần dời miễn phí</p>
        <div style="height:8px;background:#e2e8f0;border-radius:999px;overflow:hidden;"><div style="height:8px;width:${pct}%;background:${GREEN};"></div></div>
        <p style="margin:10px 0 0;font-size:12px;color:#64748b;line-height:1.6;">
          Bữa tiếp theo: ${upcoming.length ? upcoming.map((m) => `<b>${fmtDate(m.date)}</b>`).join(' · ') : '<i>chưa có</i>'}
          ${unscheduled ? `<br/><span style="color:#d97706;">Còn ${unscheduled} bữa chưa chọn ngày — hạn chót ${fmtDate(sub.finalDate)}.</span>` : ''}
        </p>
      </div>`;
};

const mealPickupHtml = (user, sub, orders, ready = false) => `
<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f8fafc;font-family:Segoe UI,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;padding:24px;">
    <div style="background:linear-gradient(135deg,#059669,#34d399);border-radius:20px 20px 0 0;padding:28px 24px;color:#fff;">
      <p style="margin:0 0 6px;font-size:12px;font-weight:800;letter-spacing:2px;opacity:0.9;">SLOTHUB · GÓI ĂN ${sub.planType === 'month' ? 'THÁNG' : 'TUẦN'}</p>
      <h1 style="margin:0;font-size:22px;">${ready ? 'Món của bạn đã làm xong — mời đến lấy ✅' : 'Bữa gói hôm nay đã sẵn sàng 🍱'}</h1>
      <p style="margin:8px 0 0;opacity:0.95;font-size:14px;">Xin chào ${user.name || 'bạn'}, ${ready ? `quầy <b>${sub.vendorName}</b> đã làm xong bữa trong <b>${sub.planName}</b>. Đến quầy lúc <b>${sub.slotStart} – ${sub.slotEnd}</b> và đưa mã bên dưới.` : `quầy <b>${sub.vendorName}</b> đang chuẩn bị bữa trong <b>${sub.planName}</b> của bạn.`}</p>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 20px 20px;box-shadow:0 10px 40px rgba(0,0,0,0.06);">
      ${orders.map((o) => mealPickupBlock(sub, o)).join('')}
      ${planProgress(sub)}
      <p style="font-size:12px;color:#64748b;line-height:1.6;background:#fff7ed;border-radius:12px;padding:12px;margin:0;">
        Không ăn được hôm nay? Lần sau hãy dời bữa <b>trước 20:00 hôm trước</b> trong mục <b>Gói ăn tuần / tháng</b>. Bữa đã tạo đơn (như bữa này) không dời được nữa.
      </p>
      <p style="font-size:12px;color:#94a3b8;text-align:center;margin:20px 0 0;">Email tự động từ SlotHub — không trả lời email này.</p>
    </div>
  </div>
</body></html>`;

/** Gửi mã QR + OTP của bữa gói (mẫu riêng). ready=true: quầy đã làm xong, mời đến lấy */
const emailMealPickup = (sub, orderIds, { ready = false } = {}) => {
    if (!orderIds?.length) return;
    (async () => {
        const Order = require('../models/Order');
        const user = await loadUser(sub.user);
        if (!user?.email) return;
        const orders = await Order.find({ _id: { $in: orderIds } });
        if (!orders.length) return;
        const first = orders[0];
        const meal = sub.meals.find((m) => String(m._id) === String(first.mealPlanMealId));
        const idx = meal ? mealIndexOf(sub, meal._id) : 0;
        const subject = ready
            ? `✅ [SlotHub] Bữa gói ${idx ? `${idx}/${sub.mealsCount} ` : ''}đã xong — mời đến lấy ${sub.menuItemName} (${sub.slotStart} – ${sub.slotEnd})`
            : `📦 [SlotHub] Bữa gói ${idx ? `${idx}/${sub.mealsCount} ` : ''}hôm nay — ${sub.menuItemName} · nhận ${sub.slotStart} – ${sub.slotEnd}`;
        await send(user, subject, mealPickupHtml(user, sub, orders, ready),
            `Bữa gói hôm nay: ${sub.menuItemName} tại ${sub.vendorName}, nhận ${sub.slotStart} - ${sub.slotEnd}. Mã OTP: ${orders.map((o) => o.otpCode).join(', ')}`);
        console.log(`📧 [Gói ăn] ${ready ? 'món đã xong + mã' : 'mã nhận món'} → ${sub.planName} (${orders.length} đơn)`);
    })().catch((err) => console.log('❌ Lỗi gửi email mã nhận món (gói ăn):', err.message));
};

module.exports = { emailPlan, emailMealPickup, buildPlanEmail, fmtDate };
