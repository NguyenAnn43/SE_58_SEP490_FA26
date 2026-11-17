import React, { useState, useEffect, useRef } from 'react';
import api from '../../api/axios';
import { appAlert } from '../../utils/appAlert';
import { Power, Loader2, Store, AlarmClock } from 'lucide-react';

/** Date → giá trị cho <input type="datetime-local"> (giờ máy người dùng) */
const toLocalInput = (date) => {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** VD: "07:00 18/10" */
const formatReopen = (date) => {
  const d = new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
};

/** VD: "2 giờ 15 phút" */
const formatRemaining = (date) => {
  const ms = new Date(date).getTime() - Date.now();
  if (ms <= 0) return 'sắp mở lại';
  const totalMin = Math.ceil(ms / 60000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days} ngày ${hours} giờ`;
  if (hours > 0) return `${hours} giờ ${mins} phút`;
  return `${mins} phút`;
};

/** Các mốc chọn nhanh — trả về Date hoặc null (không tự mở) */
const PRESETS = [
  { id: 'none', label: 'Không tự mở', get: () => null },
  { id: '1h', label: 'Sau 1 giờ', get: () => new Date(Date.now() + 60 * 60 * 1000) },
  { id: '3h', label: 'Sau 3 giờ', get: () => new Date(Date.now() + 3 * 60 * 60 * 1000) },
  {
    id: 'tomorrow',
    label: 'Sáng mai 7:00',
    get: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(7, 0, 0, 0);
      return d;
    },
  },
];

/**
 * Nút tạm tắt / bật lại nhận đơn cho chủ quầy, kèm hẹn giờ tự động mở lại.
 */
const VendorStorePauseToggle = ({
  vendor,
  onUpdated,
  compact = false,
}) => {
  const [isPaused, setIsPaused] = useState(!!vendor?.isPaused);
  const [pauseReason, setPauseReason] = useState(vendor?.pauseReason || '');
  const [reopenAt, setReopenAt] = useState(toLocalInput(vendor?.pausedUntil));
  const [saving, setSaving] = useState(false);
  const [showReason, setShowReason] = useState(!!vendor?.isPaused);
  const [reasonError, setReasonError] = useState('');
  const [, setTick] = useState(0);
  const reasonInputRef = useRef(null);

  useEffect(() => {
    setIsPaused(!!vendor?.isPaused);
    setPauseReason(vendor?.pauseReason || '');
    setReopenAt(toLocalInput(vendor?.pausedUntil));
    setShowReason(!!vendor?.isPaused);
  }, [vendor?.isPaused, vendor?.pauseReason, vendor?.pausedUntil]);

  // Cập nhật dòng "còn X phút" mỗi 30 giây khi đang hẹn giờ
  useEffect(() => {
    if (!isPaused || !vendor?.pausedUntil) return undefined;
    const timer = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(timer);
  }, [isPaused, vendor?.pausedUntil]);

  const savePause = async (nextPaused) => {
    if (nextPaused && !pauseReason.trim()) {
      // Mở khung tuỳ chọn, nhắc ngay dưới ô lý do và đưa con trỏ vào ô
      setShowReason(true);
      setReasonError('Nhập lý do tạm tắt để sinh viên biết (VD: đi việc, hết nguyên liệu...)');
      setTimeout(() => reasonInputRef.current?.focus(), 50);
      return;
    }
    setReasonError('');
    if (nextPaused && reopenAt && new Date(reopenAt).getTime() <= Date.now() + 60 * 1000) {
      return appAlert('Giờ mở lại phải sau thời điểm hiện tại ít nhất 1 phút.', { type: 'warning' });
    }

    setSaving(true);
    try {
      const res = await api.put('/vendor/my-store/pause', {
        isPaused: nextPaused,
        pauseReason: nextPaused ? pauseReason.trim() : '',
        pausedUntil: nextPaused && reopenAt ? new Date(reopenAt).toISOString() : null,
      });
      setIsPaused(nextPaused);
      setShowReason(nextPaused);
      if (!nextPaused) setReopenAt('');
      appAlert(res.data.message, { type: 'success' });
      onUpdated?.(res.data.vendor);
    } catch (err) {
      appAlert(err.response?.data?.message || 'Không cập nhật được trạng thái quầy', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  if (!vendor) return null;

  if (compact) {
    return (
      <button
        type="button"
        disabled={saving}
        onClick={() => savePause(!isPaused)}
        className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-black transition-all disabled:opacity-50 ${
          isPaused
            ? 'bg-green-500/15 text-green-400 border border-green-500/30 hover:bg-green-500/25'
            : 'bg-red-500/10 text-red-400 border border-red-500/30 hover:bg-red-500/20'
        }`}
      >
        {saving ? <Loader2 size={16} className="animate-spin" /> : <Power size={16} />}
        {isPaused ? 'Bật lại nhận đơn' : 'Tạm tắt quầy'}
      </button>
    );
  }

  const minInput = toLocalInput(new Date(Date.now() + 2 * 60 * 1000));
  const savedReopen = vendor.pausedUntil ? toLocalInput(vendor.pausedUntil) : '';
  const scheduleChanged = isPaused && reopenAt !== savedReopen;

  return (
    <div className={`rounded-2xl border p-5 md:p-6 ${
      isPaused
        ? 'bg-red-500/10 border-red-500/30'
        : 'bg-green-500/5 border-green-500/20'
    }`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="flex gap-3">
          <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
            isPaused ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'
          }`}>
            <Store size={24} />
          </div>
          <div>
            <h3 className="font-black text-lg">Trạng thái hoạt động quầy</h3>
            <p className="text-sm portal-muted mt-1">
              {isPaused
                ? 'Quầy đang TẮT — sinh viên không đặt món được.'
                : 'Quầy đang BẬT — nhận đơn trong khung giờ mở cửa.'}
            </p>
            {isPaused && vendor.pausedUntil && (
              <p className="text-sm mt-2 font-black text-[#F27124] flex items-center gap-1.5">
                <AlarmClock size={16} />
                Tự động mở lại lúc {formatReopen(vendor.pausedUntil)} (còn {formatRemaining(vendor.pausedUntil)})
              </p>
            )}
            {isPaused && !vendor.pausedUntil && (
              <p className="text-xs mt-2 font-bold portal-muted">Không hẹn giờ — quầy tắt đến khi bạn tự bật lại.</p>
            )}
            {vendor.statusMessage && (
              <p className="text-xs mt-2 font-medium text-[var(--portal-muted)]">{vendor.statusMessage}</p>
            )}
          </div>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={() => savePause(!isPaused)}
          className={`shrink-0 flex items-center justify-center gap-2 px-5 py-3 rounded-xl font-black text-sm transition-all disabled:opacity-50 ${
            isPaused
              ? 'bg-green-600 text-white hover:bg-green-500'
              : 'bg-red-600 text-white hover:bg-red-500'
          }`}
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Power size={18} />}
          {isPaused ? 'Bật lại nhận đơn' : showReason ? 'Xác nhận tạm tắt' : 'Tạm tắt quầy'}
        </button>
      </div>

      {!isPaused && (
        <button
          type="button"
          onClick={() => setShowReason((v) => !v)}
          className="text-xs font-bold text-[#F27124] mt-3 hover:underline"
        >
          {showReason ? 'Ẩn tuỳ chọn' : 'Thêm lý do & hẹn giờ mở lại khi tắt'}
        </button>
      )}

      {(showReason || isPaused) && (
        <div className="mt-4 space-y-4">
          <div>
            <label className="text-xs font-bold portal-muted uppercase tracking-wider">
              Lý do tạm tắt (hiển thị cho sinh viên)
            </label>
            <input
              ref={reasonInputRef}
              type="text"
              maxLength={200}
              value={pauseReason}
              onChange={(e) => {
                setPauseReason(e.target.value);
                if (reasonError) setReasonError('');
              }}
              disabled={isPaused}
              placeholder="VD: Đi việc đột xuất, hết nguyên liệu..."
              className={`mt-1.5 w-full bg-[var(--portal-input-bg)] border rounded-xl px-4 py-3 text-sm focus:border-[#F27124] outline-none disabled:opacity-60 ${
                reasonError ? 'border-red-500' : 'border-[var(--portal-border)]'
              }`}
            />
            {reasonError && <p className="text-xs font-bold text-red-500 mt-1.5">{reasonError}</p>}
          </div>

          {/* HẸN GIỜ TỰ ĐỘNG MỞ LẠI */}
          <div>
            <label className="text-xs font-bold portal-muted uppercase tracking-wider flex items-center gap-1.5">
              <AlarmClock size={14} /> Tự động mở lại vào lúc
            </label>
            <div className="flex flex-wrap gap-2 mt-2">
              {PRESETS.map((p) => {
                const value = toLocalInput(p.get());
                const active = p.id === 'none' ? !reopenAt : false;
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setReopenAt(value)}
                    className={`text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${
                      active
                        ? 'bg-[#F27124] text-white border-[#F27124]'
                        : 'border-[var(--portal-border)] hover:border-[#F27124] hover:text-[#F27124]'
                    }`}
                  >
                    {p.label}
                  </button>
                );
              })}
            </div>
            <input
              type="datetime-local"
              value={reopenAt}
              min={minInput}
              onChange={(e) => setReopenAt(e.target.value)}
              className="mt-2 w-full sm:w-auto bg-[var(--portal-input-bg)] border border-[var(--portal-border)] rounded-xl px-4 py-2.5 text-sm focus:border-[#F27124] outline-none"
            />
            <p className="text-[11px] portal-muted mt-1.5">
              {reopenAt
                ? `Quầy sẽ tự bật nhận đơn lúc ${formatReopen(reopenAt)}.`
                : 'Không hẹn giờ — quầy tắt đến khi bạn tự bật lại.'}
            </p>

            {scheduleChanged && (
              <button
                type="button"
                disabled={saving}
                onClick={() => savePause(true)}
                className="mt-3 flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-black bg-[#F27124] text-white hover:bg-[#D95F1B] disabled:opacity-50"
              >
                {saving ? <Loader2 size={16} className="animate-spin" /> : <AlarmClock size={16} />}
                Lưu giờ mở lại
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default VendorStorePauseToggle;
