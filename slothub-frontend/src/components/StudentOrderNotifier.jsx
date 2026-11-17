import { useContext, useEffect, useRef } from 'react';
import api from '../api/axios';
import { AuthContext } from '../context/AuthContext';
import { appAlert } from '../utils/appAlert';
import { connectUserSocket } from '../utils/socket';

/** Loại thông báo đơn hàng cần báo ngay cho sinh viên, ở BẤT KỲ trang nào */
const ALERT_META = {
  ORDER_REJECTED: { type: 'error', icon: '❌' },
  REFUND_FAILED: { type: 'warning', icon: '⚠️' },
  REFUND_SUCCESS: { type: 'success', icon: '💸' },
  ORDER_APPROVED: { type: 'info', icon: '👨‍🍳' },
  ORDER_READY: { type: 'info', icon: '🔔' },
  ORDER_COMPLETED: { type: 'success', icon: '✅' },
};
// Khi mở app: chỉ nhắc lại các thông báo quan trọng bị lỡ (bị từ chối / hoàn tiền)
const MISSED_TYPES = ['ORDER_REJECTED', 'REFUND_SUCCESS', 'REFUND_FAILED'];

const markRead = (ids) => Promise.all(ids.map((id) => api.put(`/notifications/${id}/read`).catch(() => {})));

/**
 * Hiện thông báo đơn hàng cho sinh viên:
 *  - realtime qua socket (quầy duyệt / từ chối, hoàn tiền, sẵn sàng, đã nhận món)
 *  - lúc mở app: các thông báo từ chối / hoàn tiền chưa đọc (khi sinh viên offline)
 */
const StudentOrderNotifier = () => {
  const { user, fetchBalance } = useContext(AuthContext);
  const userId = user?._id || user?.id;
  const shownRef = useRef(new Set());

  // 1) Thông báo bị lỡ khi offline
  useEffect(() => {
    if (!userId || user?.role !== 'student') return;
    api.get('/notifications/me')
      .then((res) => {
        const missed = (res.data?.notifications || [])
          .filter((n) => !n.isRead && MISSED_TYPES.includes(n.type) && !shownRef.current.has(String(n._id)))
          .reverse();
        if (!missed.length) return;
        missed.forEach((n) => shownRef.current.add(String(n._id)));
        const hasRejected = missed.some((n) => n.type === 'ORDER_REJECTED');
        appAlert(missed.map((n) => `${ALERT_META[n.type]?.icon || '•'} ${n.message}`).join('\n\n'), {
          type: hasRejected ? 'error' : 'info',
          title: hasRejected ? 'Đơn hàng của bạn bị từ chối' : 'Cập nhật đơn hàng',
        });
        markRead(missed.map((n) => n._id));
      })
      .catch(() => {});
  }, [userId, user?.role]);

  // 2) Realtime — gom các thông báo đến sát nhau (VD "bị từ chối" + "đã hoàn tiền") thành 1 popup,
  //    vì popup sau sẽ đè popup trước nếu hiện riêng
  useEffect(() => {
    if (!userId || user?.role !== 'student') return undefined;
    const s = connectUserSocket(userId);
    let pending = [];
    let timer = null;

    const flush = () => {
      const batch = pending;
      pending = [];
      timer = null;
      if (!batch.length) return;
      const rejected = batch.find((n) => n.type === 'ORDER_REJECTED');
      const lead = rejected || batch[0];
      const meta = ALERT_META[lead.type];
      appAlert(
        batch.length === 1 ? lead.message : batch.map((n) => `${ALERT_META[n.type]?.icon || '•'} ${n.message}`).join('\n\n'),
        { type: rejected ? 'error' : meta.type, title: `${meta.icon} ${lead.title}` }
      );
      markRead(batch.map((n) => n._id).filter(Boolean));
    };

    const onNotification = (noti) => {
      if (!ALERT_META[noti?.type] || shownRef.current.has(String(noti._id))) return;
      shownRef.current.add(String(noti._id));
      if (noti.type === 'REFUND_SUCCESS') fetchBalance?.();
      pending.push(noti);
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, 700);
    };

    s.on('student_notification', onNotification);
    return () => {
      s.off('student_notification', onNotification);
      if (timer) clearTimeout(timer);
    };
  }, [userId, user?.role, fetchBalance]);

  return null;
};

export default StudentOrderNotifier;
