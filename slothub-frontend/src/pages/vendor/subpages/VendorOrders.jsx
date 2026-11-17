import React, { useState, useEffect, useCallback } from 'react';
import api from '../../../api/axios';
import { appAlert } from '../../../utils/appAlert';
import {
  Loader2, CheckCircle, XCircle, Clock, User, Phone, StickyNote, RotateCcw, ChevronDown, ScanLine, Wallet, QrCode, History,
} from 'lucide-react';

const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const shortCode = (id) => `#${String(id).slice(-6).toUpperCase()}`;

/** Nhãn hiển thị — đơn Pending tách thành "Chờ duyệt" (đã trả) và "Chờ thanh toán" (payOS chưa trả) */
const displayStatus = (o) => {
  if (o.status === 'Pending') return o.paymentStatus === 'Paid' ? 'awaiting' : 'unpaid';
  return String(o.status || '').toLowerCase();
};

const FILTERS = [
  { key: 'awaiting', label: 'Chờ duyệt' },
  { key: 'processing', label: 'Đang làm' },
  { key: 'ready', label: 'Sẵn sàng' },
  { key: 'completed', label: 'Đã nhận món' },
  { key: 'rejected', label: 'Từ chối' },
  { key: 'cancelled', label: 'Đã huỷ' },
  { key: 'unpaid', label: 'Chờ thanh toán' },
  { key: 'all', label: 'Tất cả' },
];

const STATUS_META = {
  awaiting: { label: 'Chờ duyệt', cls: 'bg-yellow-500/10 text-yellow-600 border-yellow-500/30' },
  unpaid: { label: 'Chờ khách thanh toán', cls: 'bg-gray-500/10 text-gray-500 border-gray-500/20' },
  processing: { label: 'Đang làm', cls: 'bg-blue-500/10 text-blue-500 border-blue-500/20' },
  ready: { label: 'Sẵn sàng', cls: 'bg-purple-500/10 text-purple-500 border-purple-500/20' },
  completed: { label: 'Đã nhận món', cls: 'bg-green-500/10 text-green-600 border-green-500/20' },
  rejected: { label: 'Đã từ chối', cls: 'bg-red-500/10 text-red-500 border-red-500/20' },
  cancelled: { label: 'Khách đã huỷ', cls: 'bg-red-500/10 text-red-400 border-red-500/20' },
};

const REFUND_META = {
  NOT_REQUIRED: { label: 'Không cần hoàn tiền', cls: 'text-gray-500' },
  PENDING: { label: 'Chờ hoàn tiền', cls: 'text-amber-600' },
  PROCESSING: { label: 'Đang hoàn tiền...', cls: 'text-amber-600' },
  SUCCESS: { label: 'Đã hoàn vào ví SlotHub', cls: 'text-green-600' },
  FAILED: { label: 'Hoàn tiền lỗi', cls: 'text-red-500' },
};

const REJECT_PRESETS = ['Hết món / hết nguyên liệu', 'Quầy tạm ngừng phục vụ', 'Không kịp chuẩn bị trong khung giờ', 'Quá tải đơn'];

const VendorOrders = ({ refreshKey = 0, onGoPickup }) => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('awaiting');
  const [busyId, setBusyId] = useState(null);
  const [rejecting, setRejecting] = useState(null);   // đơn đang mở hộp thoại từ chối
  const [reason, setReason] = useState('');
  const [expanded, setExpanded] = useState(null);     // đơn đang xem lịch sử xử lý
  const [history, setHistory] = useState({});

  const fetchOrders = useCallback(async () => {
    try {
      const res = await api.get('/orders/vendor/my-orders');
      setOrders(res.data);
    } catch (err) {
      appAlert(err.response?.data?.message || 'Không tải được đơn hàng', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchOrders(); }, [fetchOrders, refreshKey]);

  const counts = orders.reduce((acc, o) => {
    const k = displayStatus(o);
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});
  const visible = filter === 'all' ? orders : orders.filter((o) => displayStatus(o) === filter);

  const run = async (id, fn) => {
    setBusyId(id);
    try {
      const res = await fn();
      if (res?.data?.message) appAlert(res.data.message, { type: 'success' });
      await fetchOrders();
      return true;
    } catch (err) {
      appAlert(err.response?.data?.message || 'Thao tác thất bại', { type: 'error' });
      await fetchOrders();
      return false;
    } finally {
      setBusyId(null);
    }
  };

  const approve = (o) => run(o._id, () => api.put(`/orders/${o._id}/approve`));
  const setStatus = (o, status) => run(o._id, () => api.put(`/orders/${o._id}/status`, { status }));
  const retryRefund = (o) => run(o._id, () => api.post(`/orders/${o._id}/refund/retry`));

  const submitReject = async () => {
    const text = reason.trim();
    if (text.length < 3) return appAlert('Vui lòng nhập lý do từ chối (tối thiểu 3 ký tự).', { type: 'warning' });
    const ok = await run(rejecting._id, () => api.put(`/orders/${rejecting._id}/reject`, { reason: text }));
    if (ok) {
      setRejecting(null);
      setReason('');
    }
  };

  const toggleHistory = async (o) => {
    if (expanded === o._id) return setExpanded(null);
    setExpanded(o._id);
    if (!history[o._id]) {
      try {
        const res = await api.get(`/orders/vendor/${o._id}`);
        setHistory((prev) => ({ ...prev, [o._id]: res.data.history || [] }));
      } catch {
        setHistory((prev) => ({ ...prev, [o._id]: [] }));
      }
    }
  };

  if (loading) return <div className="flex justify-center p-10"><Loader2 className="animate-spin text-[#F27124]" size={40} /></div>;

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      {onGoPickup && (
        <div className="bg-gradient-to-r from-[#F27124]/20 to-transparent border border-[#F27124]/30 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm portal-text-secondary">
            Đơn mới cần <strong className="text-[var(--portal-text)]">Duyệt</strong> trước khi làm. Khách đến lấy món? Dùng <strong className="text-[var(--portal-text)]">Quét nhận món</strong>.
          </p>
          <button type="button" onClick={onGoPickup} className="bg-[#F27124] text-white text-sm font-bold px-4 py-2 rounded-xl hover:bg-[#D95F1B] flex items-center gap-1.5">
            <ScanLine size={16} /> Mở quét QR
          </button>
        </div>
      )}

      {/* BỘ LỌC TRẠNG THÁI */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => {
          const n = f.key === 'all' ? orders.length : (counts[f.key] || 0);
          const active = filter === f.key;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={`shrink-0 px-4 py-2 rounded-xl text-sm font-bold border transition-all ${
                active ? 'bg-[#F27124] text-white border-[#F27124]' : 'border-[var(--portal-border)] portal-text-secondary hover:border-[#F27124]'
              }`}
            >
              {f.label}
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-md ${active ? 'bg-white/25' : 'bg-[var(--portal-input-bg)]'} ${f.key === 'awaiting' && n > 0 && !active ? 'text-red-500' : ''}`}>{n}</span>
            </button>
          );
        })}
      </div>

      {visible.length === 0 ? (
        <div className="text-center py-16 portal-muted">Không có đơn nào ở mục này.</div>
      ) : (
        visible.map((order) => {
          const ds = displayStatus(order);
          const meta = STATUS_META[ds] || { label: order.status, cls: 'portal-muted' };
          const busy = busyId === order._id;
          const refund = REFUND_META[order.refundStatus];
          return (
            <div key={order._id} className="portal-card p-5 sm:p-6 rounded-2xl border border-[var(--portal-border)] shadow-lg">
              <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
                <div>
                  <h3 className="font-black text-lg">Đơn hàng {shortCode(order._id)}</h3>
                  <p className="portal-muted text-xs">Đặt lúc {new Date(order.createdAt).toLocaleString('vi-VN')}</p>
                  <p className="text-sm font-bold mt-1 flex items-center gap-1.5"><Clock size={14} className="text-[#F27124]" />
                    Nhận {order.pickupDay === 'tomorrow' ? 'ngày mai' : 'hôm nay'} · {order.pickupSlot}
                  </p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-black border ${meta.cls}`}>{meta.label}</span>
              </div>

              {/* KHÁCH HÀNG (chỉ thông tin cần cho việc giao món) */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm portal-text-secondary mb-3">
                <span className="flex items-center gap-1"><User size={14} /> {order.user?.name || 'Khách'}</span>
                {order.user?.studentId && <span>MSSV: {order.user.studentId}</span>}
                {order.user?.phone && <span className="flex items-center gap-1"><Phone size={14} /> {order.user.phone}</span>}
                <span className="flex items-center gap-1">
                  {order.paymentMethod === 'payos' ? <QrCode size={14} /> : <Wallet size={14} />}
                  {order.paymentMethod === 'payos' ? 'payOS' : 'Ví SlotHub'} · {order.paymentStatus === 'Paid' ? 'Đã thanh toán' : order.paymentStatus === 'Refunded' ? 'Đã hoàn tiền' : order.paymentStatus === 'PartialRefunded' ? 'Hoàn một phần' : 'Chưa thanh toán'}
                </span>
              </div>

              {/* MÓN */}
              <div className="space-y-1.5 mb-4">
                {order.items.map((item, idx) => (
                  <div key={idx} className="flex justify-between text-sm portal-text-secondary">
                    <span>{item.quantity}× {item.menuItem?.name || 'Món đã xoá'} <span className="portal-muted">({vnd(item.price)})</span></span>
                    <span>{vnd(item.price * item.quantity)}</span>
                  </div>
                ))}
                <div className="border-t border-[var(--portal-border)] pt-2 flex justify-between font-black">
                  <span>Tổng cộng</span>
                  <span>{vnd(order.totalPrice)}</span>
                </div>
                {order.note && <p className="text-xs text-orange-500 italic flex items-center gap-1"><StickyNote size={12} /> Ghi chú: {order.note}</p>}
              </div>

              {/* TỪ CHỐI / HOÀN TIỀN */}
              {order.status === 'Rejected' && (
                <div className="rounded-xl bg-red-500/5 border border-red-500/20 p-3 mb-4 text-sm space-y-1">
                  <p><strong>Lý do từ chối:</strong> {order.rejectReason}</p>
                  {order.rejectedAt && <p className="portal-muted text-xs">Từ chối lúc {new Date(order.rejectedAt).toLocaleString('vi-VN')}</p>}
                  {refund && (
                    <p className={`font-bold ${refund.cls}`}>
                      Hoàn tiền: {refund.label}{order.refundStatus === 'SUCCESS' && order.refundAmount ? ` (${vnd(order.refundAmount)})` : ''}
                    </p>
                  )}
                  {order.refundStatus === 'FAILED' && order.refundError && <p className="text-xs text-red-500">Lỗi: {order.refundError}</p>}
                </div>
              )}

              {/* HÀNH ĐỘNG theo trạng thái */}
              <div className="flex flex-wrap gap-3">
                {ds === 'awaiting' && (
                  <>
                    <button disabled={busy} onClick={() => approve(order)} className="flex-1 min-w-[140px] bg-green-600 hover:bg-green-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                      {busy ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />} Duyệt đơn
                    </button>
                    <button disabled={busy} onClick={() => { setRejecting(order); setReason(''); }} className="flex-1 min-w-[140px] bg-red-500/10 text-red-500 border border-red-500/30 hover:bg-red-500 hover:text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                      <XCircle size={18} /> Từ chối
                    </button>
                  </>
                )}
                {ds === 'processing' && (
                  <button disabled={busy} onClick={() => setStatus(order, 'Ready')} className="flex-1 bg-purple-600 hover:bg-purple-500 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                    {busy ? <Loader2 size={18} className="animate-spin" /> : <CheckCircle size={18} />} Sẵn sàng giao
                  </button>
                )}
                {ds === 'ready' && onGoPickup && (
                  <button type="button" onClick={onGoPickup} className="flex-1 bg-[#F27124] hover:bg-[#D95F1B] text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2">
                    <ScanLine size={18} /> Quét QR nhận món
                  </button>
                )}
                {order.status === 'Rejected' && order.refundStatus === 'FAILED' && (
                  <button disabled={busy} onClick={() => retryRefund(order)} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-3 rounded-xl font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                    {busy ? <Loader2 size={18} className="animate-spin" /> : <RotateCcw size={18} />} Thử lại hoàn tiền
                  </button>
                )}
                <button type="button" onClick={() => toggleHistory(order)} className="px-4 py-3 rounded-xl text-sm font-bold portal-text-secondary border border-[var(--portal-border)] flex items-center gap-1.5">
                  <History size={16} /> Lịch sử <ChevronDown size={14} className={`transition-transform ${expanded === order._id ? 'rotate-180' : ''}`} />
                </button>
              </div>

              {expanded === order._id && (
                <div className="mt-4 border-t border-[var(--portal-border)] pt-3 space-y-1.5">
                  {!history[order._id] ? (
                    <Loader2 size={16} className="animate-spin text-[#F27124]" />
                  ) : history[order._id].length === 0 ? (
                    <p className="text-xs portal-muted">Chưa có lịch sử xử lý.</p>
                  ) : history[order._id].map((h) => (
                    <p key={h._id} className="text-xs portal-text-secondary">
                      <span className="portal-muted">{new Date(h.createdAt).toLocaleString('vi-VN')}</span> · {h.fromStatus || '—'} → <strong>{h.toStatus}</strong> ({h.changedByRole}){h.note ? ` · ${h.note}` : ''}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })
      )}

      {/* HỘP THOẠI TỪ CHỐI — bắt buộc lý do */}
      {rejecting && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !busyId && setRejecting(null)}>
          <div className="bg-[var(--portal-card)] text-[var(--portal-text)] w-full max-w-md rounded-2xl p-6 border border-[var(--portal-border)] shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-black text-lg">Từ chối đơn {shortCode(rejecting._id)}</h3>
            <p className="text-sm portal-muted mt-1">
              Khách sẽ nhận thông báo kèm lý do.{rejecting.paymentStatus === 'Paid' ? ` Hệ thống hoàn ${vnd(rejecting.totalPrice)} vào ví SlotHub của khách.` : ''}
            </p>
            <div className="flex flex-wrap gap-2 mt-4">
              {REJECT_PRESETS.map((p) => (
                <button key={p} type="button" onClick={() => setReason(p)} className={`text-xs font-bold px-3 py-1.5 rounded-lg border ${reason === p ? 'bg-red-500 text-white border-red-500' : 'border-[var(--portal-border)] portal-text-secondary'}`}>
                  {p}
                </button>
              ))}
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              maxLength={300}
              rows={3}
              placeholder="Lý do từ chối (bắt buộc)..."
              className="mt-3 w-full bg-[var(--portal-input-bg)] border border-[var(--portal-border)] rounded-xl px-3 py-2.5 text-sm outline-none focus:border-red-500"
            />
            <p className="text-[11px] portal-muted text-right">{reason.length}/300</p>
            <div className="flex justify-end gap-2 mt-3">
              <button type="button" disabled={!!busyId} onClick={() => setRejecting(null)} className="px-4 py-2 rounded-xl text-sm font-bold portal-text-secondary">Huỷ</button>
              <button type="button" disabled={!!busyId || reason.trim().length < 3} onClick={submitReject} className="px-4 py-2 rounded-xl text-sm font-black bg-red-600 text-white hover:bg-red-500 disabled:opacity-50 flex items-center gap-1.5">
                {busyId ? <Loader2 size={16} className="animate-spin" /> : <XCircle size={16} />} Xác nhận từ chối
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorOrders;
