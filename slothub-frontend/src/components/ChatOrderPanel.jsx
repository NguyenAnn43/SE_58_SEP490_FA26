import React, { useEffect, useState } from 'react';
import { Receipt, Minus, Plus, Trash2, Wallet, QrCode, Loader2, CheckCircle2, AlertTriangle, Clock, Star, Flame, Info } from 'lucide-react';
import { isSlotPastForToday } from '../utils/vendorHours';

const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const PAYMENT_ICONS = { wallet: Wallet, payos: QrCode };

/** Lấy phần dữ liệu đơn cần gửi lên server (server tự tính giá/tổng) */
export const draftInputOf = (draft) => ({
  items: (draft?.items || []).map((i) => ({ _id: String(i._id), quantity: i.quantity })),
  pickupSlot: draft?.pickupSlot ? String(draft.pickupSlot) : null,
  pickupDate: draft?.pickupDate || 'today',
  paymentMethod: draft?.paymentMethod || null,
  note: draft?.note || '',
});

/**
 * Bản xem trước đơn hàng trong chatbot: món, số lượng, đơn giá, thành tiền, calo, đánh giá,
 * khung giờ nhận, phương thức thanh toán. Mọi số liệu do server tính lại (POST /chat/draft).
 */
const ChatOrderPanel = ({ draft, onChange, onConfirm, onCancel, onShowDetail, placing, error, syncing }) => {
  const [note, setNote] = useState(draft.note || '');
  useEffect(() => setNote(draft.note || ''), [draft.note]);

  const input = draftInputOf(draft);
  const update = (patch) => onChange({ ...input, ...patch });
  const changeQty = (id, delta) => update({
    items: input.items
      .map((i) => (i._id === String(id) ? { ...i, quantity: i.quantity + delta } : i))
      .filter((i) => i.quantity > 0),
  });

  const slots = (draft.slots || []).map((s) => ({ ...s, _id: String(s._id) }));
  const visibleSlots = draft.pickupDate === 'today' ? slots.filter((s) => !isSlotPastForToday(s)) : slots;
  const canConfirm = draft.ready && !placing && !syncing;

  return (
    <div className="bg-white border-2 border-orange-200 rounded-2xl p-3 shadow-sm flex flex-col gap-3">
      <p className="text-xs font-black uppercase tracking-wider text-[#F27124] flex items-center gap-1.5">
        <Receipt size={14} /> Đơn hàng của bạn — kiểm tra trước khi đặt
        {syncing && <Loader2 size={12} className="animate-spin text-gray-400" />}
      </p>

      {/* CHI TIẾT MÓN */}
      <div className="flex flex-col divide-y divide-gray-100">
        {draft.items.map((i) => (
          <div key={String(i._id)} className="py-2 first:pt-0">
            <div className="flex items-start gap-2">
              <button type="button" onClick={() => onShowDetail?.(i._id)} className="flex-1 min-w-0 text-left">
                <p className="text-sm font-black text-gray-900 truncate hover:text-[#F27124]">{i.name}</p>
                <p className="text-[11px] text-gray-500 truncate">{i.vendor?.name} · {vnd(i.price)}/phần</p>
              </button>
              <div className="flex items-center gap-0.5 bg-gray-50 border border-gray-100 rounded-lg p-0.5 shrink-0">
                <button type="button" onClick={() => changeQty(i._id, -1)} disabled={placing} aria-label="Giảm" className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:bg-white hover:text-[#F27124]">
                  {i.quantity === 1 ? <Trash2 size={12} /> : <Minus size={12} />}
                </button>
                <span className="w-6 text-center text-sm font-black">{i.quantity}</span>
                <button type="button" onClick={() => changeQty(i._id, 1)} disabled={placing} aria-label="Tăng" className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:bg-white hover:text-[#F27124]">
                  <Plus size={12} />
                </button>
              </div>
              <p className="w-16 text-right text-sm font-black text-gray-900 shrink-0">{vnd(i.lineTotal)}</p>
            </div>
            {/* Dinh dưỡng + đánh giá của từng món */}
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 mt-1 text-[10.5px] font-semibold text-gray-500">
              {i.calories != null ? (
                <span className="flex items-center gap-0.5 text-orange-600">
                  <Flame size={10} /> {i.calories} kcal/phần · {i.lineCalories} kcal
                </span>
              ) : (
                <span className="text-gray-400">Chưa có dữ liệu calo</span>
              )}
              {i.rating != null ? (
                <span className="flex items-center gap-0.5 text-amber-600">
                  <Star size={10} className="fill-amber-400 text-amber-400" /> {i.rating}/5 ({i.numReviews} lượt)
                </span>
              ) : (
                <span className="text-gray-400">Chưa có đánh giá</span>
              )}
              {i.protein != null && <span>P {i.protein}g</span>}
              {i.carbs != null && <span>C {i.carbs}g</span>}
              {i.fat != null && <span>F {i.fat}g</span>}
            </div>
          </div>
        ))}
      </div>

      {/* TỔNG TIỀN + TỔNG CALO */}
      <div className="bg-gray-50 rounded-xl p-2.5 text-xs flex flex-col gap-1">
        <div className="flex justify-between text-gray-600"><span>Tạm tính</span><span className="font-bold">{vnd(draft.subtotal)}</span></div>
        <div className="flex justify-between text-gray-600"><span>Giảm giá</span><span className="font-bold">{vnd(draft.discount)}</span></div>
        <div className="flex justify-between text-gray-600"><span>Phí giao hàng</span><span className="font-bold">{vnd(draft.deliveryFee)} (nhận tại quầy)</span></div>
        <div className="flex justify-between text-sm pt-1 border-t border-gray-200">
          <span className="font-black text-gray-900">Tổng thanh toán</span>
          <span className="font-black text-[#F27124]">{vnd(draft.total)}</span>
        </div>
        <div className="flex justify-between text-gray-600">
          <span className="flex items-center gap-1"><Flame size={11} className="text-orange-500" /> Tổng năng lượng</span>
          <span className="font-bold">{draft.totalCalories != null ? `${draft.totalCalories} kcal` : 'Chưa đủ dữ liệu'}</span>
        </div>
        <p className="text-[10px] text-gray-400 flex gap-1">
          <Info size={10} className="shrink-0 mt-0.5" />
          Calo do quầy nhập hoặc AI ước lượng từ ảnh — chỉ mang tính tham khảo.
          {draft.caloriesMissingFor?.length > 0 && ` Chưa tính: ${draft.caloriesMissingFor.join(', ')}.`}
        </p>
      </div>

      {/* NHẬN MÓN */}
      <div>
        <p className="text-[11px] font-black text-gray-500 uppercase mb-1 flex items-center gap-1"><Clock size={12} /> Nhận món tại quầy</p>
        <div className="flex gap-1.5 mb-1.5">
          {[['today', 'Hôm nay'], ['tomorrow', 'Ngày mai']].map(([val, label]) => (
            <button
              key={val}
              type="button"
              disabled={placing}
              onClick={() => update({ pickupDate: val })}
              className={`text-xs font-bold px-3 py-1 rounded-lg border ${draft.pickupDate === val ? 'bg-[#F27124] text-white border-[#F27124]' : 'border-gray-200 text-gray-600'}`}
            >
              {label}
            </button>
          ))}
        </div>
        <select
          value={draft.pickupSlot ? String(draft.pickupSlot) : ''}
          disabled={placing}
          onChange={(e) => update({ pickupSlot: e.target.value || null })}
          className="w-full text-sm font-bold border border-gray-200 rounded-lg px-2 py-1.5 bg-white focus:border-[#F27124] outline-none"
        >
          <option value="">— Chọn khung giờ —</option>
          {visibleSlots.map((s) => (
            <option key={s._id} value={s._id}>{s.startTime} – {s.endTime}</option>
          ))}
        </select>
      </div>

      {/* PHƯƠNG THỨC THANH TOÁN — chỉ các phương thức hệ thống đã cấu hình */}
      <div>
        <p className="text-[11px] font-black text-gray-500 uppercase mb-1">Bạn muốn thanh toán bằng phương thức nào?</p>
        <div className="flex gap-1.5">
          {(draft.paymentMethods || []).map((p) => {
            const Icon = PAYMENT_ICONS[p.id] || Wallet;
            const active = draft.paymentMethod === p.id;
            return (
              <button
                key={p.id}
                type="button"
                disabled={placing}
                onClick={() => update({ paymentMethod: p.id })}
                className={`flex-1 flex items-center justify-center gap-1 text-xs font-bold px-2 py-1.5 rounded-lg border ${active ? 'bg-orange-50 border-[#F27124] text-[#F27124]' : 'border-gray-200 text-gray-600'}`}
              >
                <Icon size={13} /> {p.label}
              </button>
            );
          })}
        </div>
        {draft.paymentMethod === 'wallet' && draft.walletBalance != null && (
          <p className="text-[11px] text-gray-500 mt-1">Số dư ví: {vnd(draft.walletBalance)}</p>
        )}
        {draft.paymentMethod === 'payos' && (
          <p className="text-[11px] text-gray-500 mt-1">Sau khi xác nhận, bạn được chuyển sang trang payOS để quét VietQR. Đơn chỉ được tính là đã thanh toán khi payOS xác nhận.</p>
        )}
      </div>

      <input
        type="text"
        value={note}
        maxLength={200}
        disabled={placing}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() => note !== (draft.note || '') && update({ note })}
        placeholder="Ghi chú cho quầy (tuỳ chọn)"
        className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 outline-none focus:border-[#F27124]"
      />

      {(draft.missing?.length > 0 || draft.warnings?.length > 0) && (
        <div className="flex flex-col gap-1">
          {draft.missing?.length > 0 && (
            <p className="text-[11px] font-bold text-gray-500">Còn thiếu: {draft.missing.join(', ')}.</p>
          )}
          {draft.warnings?.map((w) => (
            <p key={w} className="text-[11px] font-bold text-amber-700 flex gap-1">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" /> {w}
            </p>
          ))}
        </div>
      )}
      {error && <p className="text-[11px] font-bold text-red-500">{error}</p>}

      <div className="flex justify-end gap-1.5 pt-2 border-t border-gray-100">
        <button
          type="button"
          onClick={onCancel}
          disabled={placing}
          className="text-xs font-bold text-gray-500 px-3 py-2 rounded-lg hover:bg-gray-100"
        >
          Huỷ đơn
        </button>
        <button
          type="button"
          onClick={onConfirm}
          disabled={!canConfirm}
          className="flex items-center gap-1 text-xs font-black text-white bg-gradient-to-r from-[#F27124] to-[#ff985e] px-3 py-2 rounded-lg disabled:from-gray-300 disabled:to-gray-300 disabled:cursor-not-allowed"
        >
          {placing ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
          {draft.paymentMethod === 'payos' ? 'Xác nhận & thanh toán' : 'Xác nhận đặt'}
        </button>
      </div>
    </div>
  );
};

export default ChatOrderPanel;
