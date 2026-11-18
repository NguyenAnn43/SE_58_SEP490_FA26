import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Loader2, Package, Store, X, Clock, CheckCircle2, RotateCcw, Ban, Wallet, Info } from 'lucide-react';
import api from '../api/axios';
import { AuthContext } from '../context/AuthContext';
import { appAlert, appConfirm } from '../utils/appAlert';

const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Cộng ngày cho chuỗi 'YYYY-MM-DD' */
const addDays = (key, n) => new Date(new Date(`${key}T00:00:00Z`).getTime() + n * DAY_MS).toISOString().slice(0, 10);
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const weekdayOf = (key) => new Date(`${key}T00:00:00Z`).getUTCDay();
const fmtDate = (key) => (key ? `${WEEKDAYS[weekdayOf(key)]} ${key.slice(8, 10)}/${key.slice(5, 7)}` : '—');

const MEAL_STATUS = {
  SCHEDULED: { label: 'Đã xếp ngày', cls: 'bg-blue-50 text-blue-700 border-blue-100' },
  UNSCHEDULED: { label: 'Chưa chọn ngày', cls: 'bg-amber-50 text-amber-700 border-amber-100' },
  ORDERED: { label: 'Đã tạo đơn', cls: 'bg-green-50 text-green-700 border-green-100' },
  REFUNDED: { label: 'Đã hoàn 100%', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  FORFEITED: { label: 'Đã hoàn một phần', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
};
const SUB_STATUS = {
  ACTIVE: { label: 'Đang dùng', cls: 'bg-green-100 text-green-700' },
  COMPLETED: { label: 'Đã dùng hết', cls: 'bg-gray-100 text-gray-600' },
  EXPIRED: { label: 'Hết hạn', cls: 'bg-gray-100 text-gray-600' },
  CANCELLED: { label: 'Đã huỷ', cls: 'bg-red-50 text-red-600' },
};

/** Quy định gói — hiển thị trước khi mua (bắt buộc đồng ý) */
const RulesBox = ({ rules, plan }) => {
  const t = rules?.types?.[plan?.type] || {};
  return (
    <div className="bg-orange-50/60 border border-orange-100 rounded-2xl p-4 text-sm text-gray-700 space-y-1.5">
      <p className="font-black text-gray-900 flex items-center gap-1.5"><Info size={16} className="text-[#F27124]" /> Quy định gói ăn</p>
      <p>• {t.label}: {t.meals} bữa, giảm {t.discountPercent}%, dùng trong {t.validDays} ngày kể từ ngày bắt đầu.</p>
      <p>• Chọn / dời ngày ăn trước <b>{rules?.cutoffHour}:00 hôm trước</b>. Được dời tối đa đến hết hạn gói + {rules?.graceDays} ngày.</p>
      <p>• Dời miễn phí <b>{t.freePostpones} lần</b>. Từ lần sau, bữa bị dời <b>tính giá lẻ</b> (trả thêm phần chiết khấu của bữa đó).</p>
      <p>• Quầy nghỉ / không phục vụ: hệ thống tự dời miễn phí, không tính lượt dời.</p>
      <p>• Hết hạn còn bữa chưa dùng: hoàn <b>{Math.round((rules?.lateRefundRate || 0.5) * 100)}%</b> giá gói mỗi bữa (100% nếu do quầy).</p>
      <p>• Huỷ gói khi còn hơn {rules?.lateCancelDays} ngày: hoàn các bữa chưa dùng, trừ lại phần chiết khấu đã hưởng. Trong {rules?.lateCancelDays} ngày cuối: hoàn 50% như hết hạn.</p>
    </div>
  );
};

/** Hộp thoại mua gói */
const BuyModal = ({ plan, rules, slots, balance, onClose, onDone }) => {
  const q = plan.quote;
  const earliest = rules.earliestDate;
  const [startDate, setStartDate] = useState(earliest);
  const [slotId, setSlotId] = useState('');
  const [picked, setPicked] = useState([]);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [idemKey] = useState(() => `mp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

  const days = useMemo(() => (startDate ? Array.from({ length: q.validDays }, (_, i) => addDays(startDate, i)) : []), [startDate, q.validDays]);
  useEffect(() => { setPicked([]); }, [startDate]);

  const vOpen = plan.vendor?.openTime || '00:00';
  const vClose = plan.vendor?.closeTime || '23:59';
  const usableSlots = slots.filter((s) => s.startTime >= vOpen && s.endTime <= vClose);

  const toggle = (d) => setPicked((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : prev.length >= q.meals ? prev : [...prev, d].sort()));
  const pickWeekdays = () => setPicked(days.filter((d) => ![0, 6].includes(weekdayOf(d))).slice(0, q.meals));

  const submit = async () => {
    if (!slotId) return appAlert('Vui lòng chọn khung giờ nhận món.', { type: 'warning' });
    if (!agree) return appAlert('Vui lòng đọc và đồng ý quy định gói ăn.', { type: 'warning' });
    setBusy(true);
    try {
      const res = await api.post(`/meal-plans/${plan._id}/subscribe`, {
        pickupSlotId: slotId, startDate, dates: picked, agreeTerms: true, idempotencyKey: idemKey,
      });
      await appAlert(res.data.message, { type: 'success', title: 'Mua gói thành công' });
      onDone();
    } catch (err) {
      appAlert(err.response?.data?.message || 'Không mua được gói', { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={onClose}>
      <div className="bg-white w-full sm:max-w-2xl max-h-[92vh] overflow-y-auto rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 space-y-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-black uppercase tracking-wider text-[#F27124]">{q.label}</p>
            <h2 className="text-xl font-black text-gray-900">{plan.name}</h2>
            <p className="text-sm text-gray-500 flex items-center gap-1"><Store size={14} /> {plan.vendor?.name} · {plan.menuItem?.name}</p>
          </div>
          <button type="button" onClick={onClose} className="p-2 rounded-full hover:bg-gray-100"><X size={20} /></button>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-sm font-bold text-gray-700">Ngày bắt đầu</span>
            <input type="date" min={earliest} value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5" />
            <span className="text-[11px] text-gray-400">Dùng đến {fmtDate(days[days.length - 1])}</span>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-bold text-gray-700">Khung giờ nhận món (mọi ngày)</span>
            <select value={slotId} onChange={(e) => setSlotId(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5 bg-white">
              <option value="">— Chọn khung giờ —</option>
              {usableSlots.map((s) => <option key={s._id} value={s._id}>{s.startTime} – {s.endTime}</option>)}
            </select>
            <span className="text-[11px] text-gray-400">Giờ quầy: {vOpen} – {vClose}</span>
          </label>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-bold text-gray-700">Chọn ngày ăn <span className="text-[#F27124]">{picked.length}/{q.meals}</span></p>
            <div className="flex gap-2">
              <button type="button" onClick={pickWeekdays} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-orange-50 text-[#D95F1B]">Chọn T2–T6</button>
              <button type="button" onClick={() => setPicked([])} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-600">Bỏ chọn</button>
            </div>
          </div>
          <div className="grid grid-cols-5 sm:grid-cols-7 gap-1.5">
            {days.map((d) => {
              const on = picked.includes(d);
              const full = !on && picked.length >= q.meals;
              return (
                <button key={d} type="button" disabled={full} onClick={() => toggle(d)}
                  className={`rounded-xl py-2 text-xs font-bold border transition ${on ? 'bg-[#F27124] text-white border-[#F27124]' : 'bg-white text-gray-700 border-gray-200 hover:border-[#F27124]'} ${full ? 'opacity-40' : ''} ${[0, 6].includes(weekdayOf(d)) && !on ? 'text-gray-400' : ''}`}>
                  {fmtDate(d)}
                </button>
              );
            })}
          </div>
          {picked.length < q.meals && (
            <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              Còn {q.meals - picked.length} bữa chưa chọn ngày — bạn có thể chọn sau trong mục "Gói của tôi" (trước {rules.cutoffHour}:00 hôm trước ngày ăn).
            </p>
          )}
        </div>

        <RulesBox rules={rules} plan={plan} />

        <label className="flex items-start gap-2 text-sm font-medium text-gray-700 cursor-pointer">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-1 accent-[#F27124]" />
          Tôi đã đọc và đồng ý quy định gói ăn (dời ngày, phí mất chiết khấu, hoàn tiền).
        </label>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-t border-gray-100 pt-4">
          <div>
            <p className="text-xs text-gray-400 line-through">{vnd(q.retailTotal)}</p>
            <p className="text-2xl font-black text-[#F27124]">{vnd(q.total)} <span className="text-xs font-bold text-green-600">tiết kiệm {vnd(q.saving)}</span></p>
            <p className={`text-xs font-bold flex items-center gap-1 ${balance >= q.total ? 'text-gray-500' : 'text-red-500'}`}><Wallet size={12} /> Ví: {vnd(balance)}{balance < q.total ? ' — không đủ' : ''}</p>
          </div>
          <button type="button" disabled={busy || !agree || !slotId || balance < q.total} onClick={submit}
            className="bg-[#F27124] hover:bg-[#D95F1B] disabled:opacity-40 text-white font-black px-6 py-3 rounded-xl flex items-center justify-center gap-2">
            {busy && <Loader2 size={18} className="animate-spin" />} THANH TOÁN BẰNG VÍ
          </button>
        </div>
      </div>
    </div>
  );
};

/** Hộp thoại dời / xếp ngày một bữa */
const DateModal = ({ sub, meal, mode, onClose, onDone }) => {
  const s = sub.summary;
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const willCharge = mode === 'postpone' && s.freePostponesLeft === 0 && !meal.discountLost;

  const submit = async (laterOnly = false) => {
    if (mode === 'schedule' && !date) return appAlert('Vui lòng chọn ngày.', { type: 'warning' });
    if (willCharge) {
      const okGo = await appConfirm(`Bạn đã dùng hết ${sub.freePostpones} lượt dời miễn phí. Lần dời này sẽ trừ ${vnd(s.postponePenaltyPerMeal)} (bữa này tính giá lẻ). Tiếp tục?`, { title: 'Dời có phí', confirmText: 'Dời và trả phí' });
      if (!okGo) return;
    }
    setBusy(true);
    try {
      const url = `/meal-plans/subscriptions/${sub._id}/meals/${meal._id}/${mode}`;
      const res = await api.post(url, mode === 'postpone' ? { newDate: laterOnly ? null : date || null } : { date });
      appAlert(res.data.message, { type: 'success' });
      onDone();
    } catch (err) {
      appAlert(err.response?.data?.message || 'Không cập nhật được bữa', { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white w-full max-w-md rounded-3xl p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-black">{mode === 'postpone' ? `Dời bữa ${fmtDate(meal.date)}` : 'Chọn ngày cho bữa'}</h3>
        <label className="block space-y-1">
          <span className="text-sm font-bold text-gray-700">Ngày mới</span>
          <input type="date" min={s.earliestDate} max={sub.finalDate} value={date} onChange={(e) => setDate(e.target.value)} className="w-full border border-gray-200 rounded-xl px-3 py-2.5" />
          <span className="text-[11px] text-gray-400">Từ {fmtDate(s.earliestDate)} đến {fmtDate(sub.finalDate)}, không trùng ngày đã có bữa.</span>
        </label>
        {mode === 'postpone' && (
          <p className={`text-xs rounded-lg px-3 py-2 ${willCharge ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
            {willCharge
              ? `Hết lượt dời miễn phí — lần này trừ ${vnd(s.postponePenaltyPerMeal)}.`
              : meal.discountLost ? 'Bữa này đã tính giá lẻ — dời tiếp không mất thêm phí.' : `Còn ${s.freePostponesLeft} lượt dời miễn phí.`}
          </p>
        )}
        <div className="flex flex-wrap gap-2 justify-end">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl font-bold text-gray-600 bg-gray-100">Đóng</button>
          {mode === 'postpone' && (
            <button type="button" disabled={busy} onClick={() => submit(true)} className="px-4 py-2 rounded-xl font-bold text-[#D95F1B] bg-orange-50">Để sau (chọn ngày sau)</button>
          )}
          <button type="button" disabled={busy || !date} onClick={() => submit(false)} className="px-4 py-2 rounded-xl font-black text-white bg-[#F27124] disabled:opacity-40 flex items-center gap-1.5">
            {busy && <Loader2 size={16} className="animate-spin" />} {mode === 'postpone' ? 'Dời sang ngày này' : 'Xếp ngày'}
          </button>
        </div>
      </div>
    </div>
  );
};

/** Thẻ một gói đã mua */
const SubscriptionCard = ({ sub, onPostpone, onSchedule, onCancel, navigate }) => {
  const s = sub.summary;
  const st = SUB_STATUS[sub.status] || SUB_STATUS.ACTIVE;
  const meals = [...sub.meals].sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  const active = sub.status === 'ACTIVE';
  return (
    <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-black text-gray-900 text-lg">{sub.planName}</h3>
            <span className={`text-[11px] font-black px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
          </div>
          <p className="text-sm text-gray-500">{sub.vendorName} · {sub.menuItemName} · nhận {sub.slotStart} – {sub.slotEnd}</p>
          <p className="text-xs text-gray-400 mt-0.5">Hạn {fmtDate(sub.validFrom)} → {fmtDate(sub.validUntil)} · dời tối đa đến {fmtDate(sub.finalDate)}</p>
        </div>
        <div className="text-right text-sm">
          <p className="font-black text-gray-900">{s.ordered}/{sub.mealsCount} bữa đã nhận đơn</p>
          <p className="text-xs text-gray-500">Dời miễn phí còn {s.freePostponesLeft}/{sub.freePostpones}</p>
          {sub.refundTotal > 0 && <p className="text-xs text-green-600 font-bold">Đã hoàn {vnd(sub.refundTotal)}</p>}
        </div>
      </div>

      <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className="h-full bg-[#F27124]" style={{ width: `${(s.ordered / sub.mealsCount) * 100}%` }} />
      </div>

      {active && s.unscheduled > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
          {s.unscheduled} bữa chưa chọn ngày — chọn trước {fmtDate(sub.finalDate)}, sau hạn mỗi bữa chỉ được hoàn 50%.
        </p>
      )}

      <div className="grid sm:grid-cols-2 gap-2">
        {meals.map((m) => {
          const ms = MEAL_STATUS[m.status] || MEAL_STATUS.SCHEDULED;
          return (
            <div key={m._id} className="flex items-center justify-between gap-2 border border-gray-100 rounded-2xl px-3 py-2">
              <div className="min-w-0">
                <p className="text-sm font-bold text-gray-800 flex items-center gap-1.5"><CalendarDays size={14} className="text-gray-400" /> {m.date ? fmtDate(m.date) : 'Chưa có ngày'}</p>
                <div className="flex flex-wrap gap-1 mt-0.5">
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border ${ms.cls}`}>{ms.label}</span>
                  {m.discountLost && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-red-50 text-red-600 border-red-100">Giá lẻ</span>}
                  {m.autoMovedCount > 0 && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded border bg-gray-50 text-gray-500 border-gray-100">Quầy nghỉ · tự dời</span>}
                  {m.refundAmount > 0 && <span className="text-[10px] font-bold text-green-600">+{vnd(m.refundAmount)}</span>}
                </div>
              </div>
              {active && m.status === 'SCHEDULED' && (
                m.canPostpone
                  ? <button type="button" onClick={() => onPostpone(sub, m)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-orange-50 text-[#D95F1B] flex items-center gap-1"><RotateCcw size={12} /> Dời</button>
                  : <span className="text-[10px] text-gray-400 flex items-center gap-1"><Clock size={12} /> Hết hạn dời</span>
              )}
              {active && m.status === 'UNSCHEDULED' && (
                <button type="button" onClick={() => onSchedule(sub, m)} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-[#F27124] text-white">Chọn ngày</button>
              )}
              {m.status === 'ORDERED' && (
                <button type="button" onClick={() => navigate('/orders')} className="text-xs font-bold px-3 py-1.5 rounded-lg bg-green-50 text-green-700 flex items-center gap-1"><CheckCircle2 size={12} /> Mã nhận món</button>
              )}
            </div>
          );
        })}
      </div>

      {active && (
        <div className="flex justify-end">
          <button type="button" onClick={() => onCancel(sub)} className="text-xs font-bold px-4 py-2 rounded-xl text-red-600 hover:bg-red-50 flex items-center gap-1"><Ban size={14} /> Huỷ gói</button>
        </div>
      )}
    </div>
  );
};

/** Trang Gói ăn tuần / tháng (sinh viên) */
const MealPlans = () => {
  const navigate = useNavigate();
  const { user, balance, fetchBalance } = useContext(AuthContext);
  const [plans, setPlans] = useState([]);
  const [rules, setRules] = useState(null);
  const [slots, setSlots] = useState([]);
  const [subs, setSubs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [buying, setBuying] = useState(null);
  const [dateModal, setDateModal] = useState(null);
  const [tab, setTab] = useState('plans');

  const load = useCallback(async () => {
    try {
      const [p, sl, mine] = await Promise.all([
        api.get('/meal-plans'),
        api.get('/timeslots'),
        api.get('/meal-plans/subscriptions/mine'),
      ]);
      setPlans(p.data.plans || []);
      setRules(p.data.rules);
      setSlots((sl.data || []).filter((s) => s.isActive !== false));
      setSubs(mine.data || []);
    } catch (err) {
      appAlert(err.response?.data?.message || 'Không tải được gói ăn', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    if (user.role !== 'student') { navigate('/'); return; }
    load();
    fetchBalance?.();
  }, [user, navigate, load, fetchBalance]);

  const refresh = () => { load(); fetchBalance?.(); };

  const cancel = async (sub) => {
    try {
      const pv = (await api.get(`/meal-plans/subscriptions/${sub._id}/cancel-preview`)).data;
      const ok = await appConfirm(
        `${pv.message}\n\nCòn ${pv.remainingMeals} bữa chưa dùng → hoàn ${vnd(pv.refund)} vào ví SlotHub${pv.retained ? ` (quầy giữ lại ${vnd(pv.retained)})` : ''}. Huỷ gói?`,
        { title: 'Huỷ gói ăn', confirmText: 'Huỷ gói', type: 'warning' }
      );
      if (!ok) return;
      const res = await api.post(`/meal-plans/subscriptions/${sub._id}/cancel`);
      appAlert(res.data.message, { type: 'success' });
      refresh();
    } catch (err) {
      appAlert(err.response?.data?.message || 'Không huỷ được gói', { type: 'error' });
    }
  };

  const activeCount = subs.filter((s) => s.status === 'ACTIVE').length;

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <div className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex flex-wrap items-center gap-3">
          <button type="button" onClick={() => navigate('/')} className="p-2 rounded-full hover:bg-gray-100"><ArrowLeft size={20} /></button>
          <h1 className="text-xl font-black text-gray-900 flex items-center gap-2"><Package size={22} className="text-[#F27124]" /> Gói ăn tuần / tháng</h1>
          <div className="ml-auto flex gap-1 bg-gray-100 rounded-xl p-1">
            <button type="button" onClick={() => setTab('plans')} className={`px-3 py-1.5 rounded-lg text-sm font-bold ${tab === 'plans' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>Gói đang bán</button>
            <button type="button" onClick={() => setTab('mine')} className={`px-3 py-1.5 rounded-lg text-sm font-bold ${tab === 'mine' ? 'bg-white shadow text-gray-900' : 'text-gray-500'}`}>Gói của tôi{activeCount ? ` (${activeCount})` : ''}</button>
          </div>
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-[#F27124]" size={36} /></div>
        ) : tab === 'plans' ? (
          plans.length === 0 ? (
            <div className="bg-white rounded-3xl border border-gray-100 py-20 text-center">
              <Package size={48} className="mx-auto text-gray-200 mb-4" />
              <p className="text-lg font-black text-gray-800">Chưa có quầy nào mở bán gói</p>
              <p className="text-gray-500 mt-1">Quay lại sau nhé!</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">
              {plans.map((p) => (
                <div key={p._id} className="bg-white rounded-3xl border border-gray-100 shadow-sm p-4 flex gap-4">
                  <div className="w-24 h-24 rounded-2xl overflow-hidden bg-gray-100 shrink-0">
                    {p.menuItem?.imageUrl && <img src={p.menuItem.imageUrl} alt={p.menuItem.name} className="w-full h-full object-cover" />}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col">
                    <span className={`self-start text-[10px] font-black uppercase px-2 py-0.5 rounded-full ${p.type === 'month' ? 'bg-purple-100 text-purple-700' : 'bg-blue-100 text-blue-700'}`}>{p.quote.label} · -{p.quote.discountPercent}%</span>
                    <p className="font-black text-gray-900 leading-tight mt-1">{p.name}</p>
                    <p className="text-xs text-gray-500 flex items-center gap-1"><Store size={12} /> {p.vendor?.name} · {p.quote.meals} bữa {p.menuItem?.name}</p>
                    {p.description && <p className="text-xs text-gray-400 mt-1 line-clamp-2">{p.description}</p>}
                    <div className="mt-auto pt-2 flex items-end justify-between gap-2">
                      <div>
                        <p className="text-[11px] text-gray-400 line-through">{vnd(p.quote.retailTotal)}</p>
                        <p className="text-lg font-black text-[#F27124] leading-none">{vnd(p.quote.total)}</p>
                        <p className="text-[11px] text-green-600 font-bold">{vnd(p.quote.unitPrice)}/bữa · tiết kiệm {vnd(p.quote.saving)}</p>
                      </div>
                      <button type="button" onClick={() => setBuying(p)} className="bg-[#F27124] hover:bg-[#D95F1B] text-white text-sm font-black px-4 py-2 rounded-xl">Mua gói</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )
        ) : subs.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 py-20 text-center">
            <CalendarDays size={48} className="mx-auto text-gray-200 mb-4" />
            <p className="text-lg font-black text-gray-800">Bạn chưa mua gói nào</p>
            <button type="button" onClick={() => setTab('plans')} className="mt-6 bg-gray-900 text-white px-6 py-3 rounded-xl font-bold">Xem gói đang bán</button>
          </div>
        ) : (
          <div className="space-y-4">
            {subs.map((s) => (
              <SubscriptionCard key={s._id} sub={s} navigate={navigate}
                onPostpone={(sub, meal) => setDateModal({ sub, meal, mode: 'postpone' })}
                onSchedule={(sub, meal) => setDateModal({ sub, meal, mode: 'schedule' })}
                onCancel={cancel} />
            ))}
          </div>
        )}
      </div>

      {buying && rules && (
        <BuyModal plan={buying} rules={rules} slots={slots} balance={balance || 0}
          onClose={() => setBuying(null)} onDone={() => { setBuying(null); setTab('mine'); refresh(); }} />
      )}
      {dateModal && (
        <DateModal {...dateModal} onClose={() => setDateModal(null)} onDone={() => { setDateModal(null); refresh(); }} />
      )}
    </div>
  );
};

export default MealPlans;
