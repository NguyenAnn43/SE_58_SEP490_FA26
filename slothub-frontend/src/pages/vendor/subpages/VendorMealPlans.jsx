import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Package, Loader2, Power, PowerOff, Users, CalendarDays, PlusCircle, CheckCircle2, Send } from 'lucide-react';
import api from '../../../api/axios';

const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const WEEKDAYS = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const fmtDate = (key) => `${WEEKDAYS[new Date(`${key}T00:00:00Z`).getUTCDay()]} ${key.slice(8, 10)}/${key.slice(5, 7)}`;
const TYPE_INFO = {
  week: { label: 'Gói tuần', desc: '5 bữa · giảm 5% · dời miễn phí 1 lần · dùng trong 7 ngày' },
  month: { label: 'Gói tháng', desc: '20 bữa · giảm 12% · dời miễn phí 3 lần · dùng trong 30 ngày' },
};

/** Chủ quầy: mở bán gói tuần / tháng + xem số suất gói cần chuẩn bị theo ngày */
const VendorMealPlans = () => {
  const [plans, setPlans] = useState([]);
  const [menu, setMenu] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [form, setForm] = useState({ type: 'week', menuItemId: '', name: '', description: '' });

  const load = useCallback(async () => {
    try {
      const [p, m, s] = await Promise.all([
        api.get('/meal-plans/vendor/mine'),
        api.get('/vendor/menu'),
        api.get('/meal-plans/vendor/schedule?days=7'),
      ]);
      setPlans(p.data || []);
      setMenu((m.data || []).filter((i) => i.isAvailable !== false));
      setSchedule(s.data);
    } catch (err) {
      alert(err.response?.data?.message || 'Không tải được gói ăn');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const selectedItem = menu.find((i) => i._id === form.menuItemId);
  const preview = useMemo(() => {
    if (!selectedItem) return null;
    const cfg = { week: [5, 5], month: [20, 12] }[form.type];
    const unit = Math.round(selectedItem.price * (100 - cfg[1]) / 100);
    return { meals: cfg[0], unit, total: unit * cfg[0], retail: selectedItem.price * cfg[0] };
  }, [selectedItem, form.type]);

  const create = async (e) => {
    e.preventDefault();
    if (!form.menuItemId) return alert('Vui lòng chọn món cho gói.');
    setBusy('create');
    try {
      const res = await api.post('/meal-plans/vendor', form);
      alert(res.data.message);
      setForm({ type: 'week', menuItemId: '', name: '', description: '' });
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Không tạo được gói');
    } finally {
      setBusy('');
    }
  };

  const toggle = async (plan) => {
    setBusy(plan._id);
    try {
      await api.put(`/meal-plans/vendor/${plan._id}`, { isActive: !plan.isActive });
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Không cập nhật được gói');
    } finally {
      setBusy('');
    }
  };

  /** Hoàn thành các suất đang làm của 1 dòng → đơn "Sẵn sàng" + gửi mã QR/OTP cho sinh viên */
  const markReady = async (key, row) => {
    const todo = (row.processing || 0) + (row.waiting || 0);
    if (!window.confirm(`Xác nhận đã làm xong ${todo} suất ${row.menuItemName} (${row.slot})?\nHệ thống sẽ gửi mã nhận món (QR + OTP) qua email cho sinh viên.`)) return;
    setBusy(key);
    try {
      const res = await api.post('/meal-plans/vendor/ready', { date: row.date, slot: row.slot, menuItemName: row.menuItemName });
      alert(res.data.message);
      load();
    } catch (err) {
      alert(err.response?.data?.message || 'Không hoàn thành được suất gói');
    } finally {
      setBusy('');
    }
  };

  if (loading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-[#F27124]" size={36} /></div>;

  const byDate = (schedule?.rows || []).reduce((acc, r) => { (acc[r.date] = acc[r.date] || []).push(r); return acc; }, {});

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-black flex items-center gap-2"><Package className="text-[#F27124]" /> Gói ăn tuần / tháng</h2>
        <p className="portal-muted text-sm mt-1">Sinh viên trả trước cả gói; mỗi ngày ăn hệ thống tự tạo đơn (đã thanh toán, đã nhận làm) và chuyển tiền bữa đó vào ví quầy.</p>
      </div>

      {/* Lịch chuẩn bị 7 ngày tới */}
      <div className="portal-card border border-[var(--portal-border)] rounded-2xl p-5">
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="font-black flex items-center gap-2"><CalendarDays size={18} /> Suất gói cần chuẩn bị (7 ngày tới)</h3>
          <span className="text-xs font-bold portal-muted flex items-center gap-1"><Users size={14} /> {schedule?.activeSubscriptions || 0} gói đang dùng</span>
        </div>
        {Object.keys(byDate).length === 0 ? (
          <p className="portal-muted text-sm">Chưa có suất gói nào trong 7 ngày tới.</p>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {Object.entries(byDate).map(([date, rows]) => (
              <div key={date} className="border border-[var(--portal-border)] rounded-xl p-3">
                <p className="font-black text-sm mb-1">{fmtDate(date)}</p>
                {rows.map((r) => {
                  const done = (r.ready || 0) + (r.completed || 0);
                  const pct = r.count ? Math.round((done / r.count) * 100) : 0;
                  const key = `${r.date}-${r.menuItemName}-${r.slot}`;
                  return (
                    <div key={key} className="mt-2 first:mt-0 space-y-1.5">
                      <p className="text-sm portal-text-secondary flex justify-between gap-2">
                        <span className="truncate">{r.menuItemName} · {r.slot}</span>
                        <b className="text-[#F27124] shrink-0">{r.count} suất</b>
                      </p>
                      {/* Tiến độ: đã hoàn thành (sẵn sàng + đã nhận) / tổng suất */}
                      <div className="h-1.5 rounded-full bg-gray-500/20 overflow-hidden">
                        <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <div className="flex flex-wrap gap-1.5 text-[11px] font-bold">
                        <span className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-500 flex items-center gap-1"><CheckCircle2 size={11} /> Đã hoàn thành {done}/{r.count}</span>
                        {r.processing > 0 && <span className="px-2 py-0.5 rounded-md bg-blue-500/15 text-blue-400">Đang làm {r.processing}</span>}
                        {r.ready > 0 && <span className="px-2 py-0.5 rounded-md bg-amber-500/15 text-amber-500">Chờ lấy {r.ready}</span>}
                        {r.completed > 0 && <span className="px-2 py-0.5 rounded-md bg-gray-500/15 portal-muted">Đã nhận {r.completed}</span>}
                        {r.waiting > 0 && <span className="px-2 py-0.5 rounded-md bg-gray-500/10 portal-muted" title="Hệ thống tự tạo đơn vào ngày ăn">Chưa tới ngày {r.waiting}</span>}
                      </div>
                      {(() => {
                        const isToday = r.date === schedule?.from;
                        const todo = (r.processing || 0) + (r.waiting || 0);
                        if (todo === 0) {
                          return (
                            <p className="w-full mt-1 text-xs font-black py-2 rounded-lg flex items-center justify-center gap-1.5 bg-emerald-500/10 text-emerald-500">
                              <CheckCircle2 size={14} /> Đã hoàn thành & gửi mã
                            </p>
                          );
                        }
                        return (
                          <button type="button" disabled={!isToday || busy === key} onClick={() => markReady(key, r)}
                            title={isToday ? '' : `Nút sẽ bấm được vào ${fmtDate(r.date)}`}
                            className={`w-full mt-1 text-xs font-black py-2 rounded-lg flex items-center justify-center gap-1.5 ${isToday
                              ? 'bg-emerald-600 hover:bg-emerald-700 text-white disabled:opacity-50'
                              : 'bg-gray-500/10 portal-muted cursor-not-allowed'}`}>
                            {busy === key ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                            {isToday ? `Đã hoàn thành ${todo} suất & gửi mã` : `Hoàn thành & gửi mã · mở vào ${fmtDate(r.date)}`}
                          </button>
                        );
                      })()}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mở bán gói mới */}
      <form onSubmit={create} className="portal-card border border-[var(--portal-border)] rounded-2xl p-5 space-y-4">
        <h3 className="font-black flex items-center gap-2"><PlusCircle size={18} /> Mở bán gói mới</h3>
        <div className="grid sm:grid-cols-2 gap-3">
          {Object.entries(TYPE_INFO).map(([k, v]) => (
            <button key={k} type="button" onClick={() => setForm({ ...form, type: k })}
              className={`text-left rounded-xl border p-3 ${form.type === k ? 'border-[#F27124] bg-[#F27124]/10' : 'border-[var(--portal-border)]'}`}>
              <p className="font-black">{v.label}</p>
              <p className="text-xs portal-muted">{v.desc}</p>
            </button>
          ))}
        </div>
        <div className="grid sm:grid-cols-2 gap-3">
          <label className="space-y-1">
            <span className="text-sm font-bold portal-text-secondary">Món trong gói *</span>
            <select value={form.menuItemId} onChange={(e) => setForm({ ...form, menuItemId: e.target.value })} className="w-full bg-[var(--portal-input-bg)] border border-[var(--portal-border)] rounded-xl px-3 py-2.5 text-[var(--portal-text)]">
              <option value="">— Chọn món —</option>
              {menu.map((i) => <option key={i._id} value={i._id}>{i.name} — {vnd(i.price)}</option>)}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-bold portal-text-secondary">Tên gói (tuỳ chọn)</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder={selectedItem ? `${TYPE_INFO[form.type].label} ${selectedItem.name}` : 'VD: Gói tuần no nê'} className="w-full bg-[var(--portal-input-bg)] border border-[var(--portal-border)] rounded-xl px-3 py-2.5 text-[var(--portal-text)]" />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-bold portal-text-secondary">Mô tả (tuỳ chọn)</span>
          <textarea rows="2" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} className="w-full bg-[var(--portal-input-bg)] border border-[var(--portal-border)] rounded-xl px-3 py-2.5 text-[var(--portal-text)]" />
        </label>
        {preview && (
          <p className="text-sm font-bold text-[#F27124]">
            Giá gói: {vnd(preview.total)} ({preview.meals} × {vnd(preview.unit)}) <span className="portal-muted font-medium line-through ml-1">{vnd(preview.retail)}</span>
            <span className="portal-muted font-medium"> — giá chốt theo giá món lúc sinh viên mua.</span>
          </p>
        )}
        <button type="submit" disabled={busy === 'create'} className="bg-[#F27124] hover:bg-[#D95F1B] text-white font-black px-5 py-2.5 rounded-xl flex items-center gap-2 disabled:opacity-50">
          {busy === 'create' && <Loader2 size={16} className="animate-spin" />} Mở bán gói
        </button>
      </form>

      {/* Gói của quầy */}
      <div className="space-y-3">
        <h3 className="font-black">Gói của quầy ({plans.length})</h3>
        {plans.length === 0 && <p className="portal-muted text-sm">Quầy chưa mở bán gói nào.</p>}
        <div className="grid sm:grid-cols-2 gap-3">
          {plans.map((p) => (
            <div key={p._id} className={`portal-card border border-[var(--portal-border)] rounded-2xl p-4 flex gap-3 ${p.isActive ? '' : 'opacity-60'}`}>
              <div className="w-16 h-16 rounded-xl overflow-hidden bg-gray-500/10 shrink-0">
                {p.menuItem?.imageUrl && <img src={p.menuItem.imageUrl} alt="" className="w-full h-full object-cover" />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-black leading-tight">{p.name}</p>
                <p className="text-xs portal-muted">{TYPE_INFO[p.type]?.label} · {p.menuItem?.name || 'Món đã xoá'}</p>
                {p.quote && <p className="text-sm font-bold text-[#F27124]">{vnd(p.quote.total)} <span className="text-xs portal-muted font-medium">({vnd(p.quote.unitPrice)}/bữa)</span></p>}
                <p className="text-xs portal-muted flex items-center gap-1"><Users size={12} /> {p.activeSubscribers} sinh viên đang dùng</p>
              </div>
              <button type="button" disabled={busy === p._id} onClick={() => toggle(p)} title={p.isActive ? 'Ngừng bán (gói đã bán vẫn phục vụ tiếp)' : 'Mở bán lại'}
                className={`self-start text-xs font-bold px-3 py-1.5 rounded-lg flex items-center gap-1 ${p.isActive ? 'bg-green-500/15 text-green-500' : 'bg-gray-500/15 portal-muted'}`}>
                {p.isActive ? <><Power size={12} /> Đang bán</> : <><PowerOff size={12} /> Ngừng bán</>}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default VendorMealPlans;
