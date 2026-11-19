import React, { useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft, Bell, CheckCircle2, Loader2, ShoppingBag, XCircle, Wallet, Package, Info, ChefHat,
} from 'lucide-react';
import api from '../api/axios';
import { AuthContext } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import LanguageToggle from '../components/LanguageToggle';
import { connectUserSocket } from '../utils/socket';

/** Biểu tượng + màu theo loại thông báo của sinh viên */
const TYPE_STYLE = {
  ORDER_APPROVED: { Icon: ChefHat, cls: 'bg-blue-50 text-blue-500' },
  ORDER_READY: { Icon: Bell, cls: 'bg-orange-50 text-[#F27124]' },
  ORDER_COMPLETED: { Icon: CheckCircle2, cls: 'bg-emerald-50 text-emerald-500' },
  ORDER_REJECTED: { Icon: XCircle, cls: 'bg-red-50 text-red-500' },
  ORDER_CANCELLED: { Icon: XCircle, cls: 'bg-red-50 text-red-500' },
  REFUND_SUCCESS: { Icon: Wallet, cls: 'bg-emerald-50 text-emerald-500' },
  REFUND_FAILED: { Icon: Wallet, cls: 'bg-amber-50 text-amber-500' },
  MEAL_PLAN: { Icon: Package, cls: 'bg-emerald-50 text-emerald-500' },
  PICKUP: { Icon: ShoppingBag, cls: 'bg-orange-50 text-[#F27124]' },
};
const DEFAULT_STYLE = { Icon: Info, cls: 'bg-gray-100 text-gray-500' };

/** Bấm vào thông báo thì mở màn hình liên quan */
const targetOf = (noti) => {
  if (noti.type === 'MEAL_PLAN') return '/meal-plans';
  if (noti.orderId || String(noti.type || '').startsWith('ORDER_') || String(noti.type || '').startsWith('REFUND_') || noti.type === 'PICKUP') {
    return '/orders';
  }
  return null;
};

/**
 * UC-08 – View Notifications (Student)
 * Danh sách thông báo của sinh viên: đơn được duyệt / sẵn sàng / đã nhận, bị từ chối, hoàn tiền, gói ăn...
 * Cập nhật realtime qua socket "student_notification" và tự làm mới mỗi 30 giây.
 */
const StudentNotifications = () => {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const { t, locale } = useLocale();
  const userId = user?._id || user?.id;
  const role = user?.role;

  const [notifications, setNotifications] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await api.get('/notifications/me');
      setNotifications(res.data?.notifications || []);
      setUnreadCount(res.data?.unreadCount || 0);
      setError('');
    } catch (err) {
      setError(err.response?.data?.message || t('notifications.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (!userId) {
      navigate('/login');
      return undefined;
    }
    if (role !== 'student') {
      navigate('/');
      return undefined;
    }
    fetchNotifications();
    const timer = setInterval(fetchNotifications, 30000);
    const s = connectUserSocket(userId);
    const onNew = () => fetchNotifications();
    s.on('student_notification', onNew);
    return () => {
      clearInterval(timer);
      s.off('student_notification', onNew);
    };
  }, [userId, role, navigate, fetchNotifications]);

  const markOne = async (noti) => {
    if (noti.isRead) return;
    setNotifications((list) => list.map((n) => (n._id === noti._id ? { ...n, isRead: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
    try {
      await api.put(`/notifications/${noti._id}/read`);
    } catch {
      fetchNotifications();
    }
  };

  const markAll = async () => {
    try {
      await api.put('/notifications/read-all');
      setNotifications((list) => list.map((n) => ({ ...n, isRead: true })));
      setUnreadCount(0);
    } catch (err) {
      setError(err.response?.data?.message || t('notifications.loadError'));
    }
  };

  const handleClick = async (noti) => {
    await markOne(noti);
    const to = targetOf(noti);
    if (to) navigate(to);
  };

  const timeAgo = (dateStr) => {
    const mins = Math.floor((Date.now() - new Date(dateStr).getTime()) / 60000);
    if (mins < 1) return t('notifications.justNow');
    if (mins < 60) return t('notifications.minutesAgo', { count: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t('notifications.hoursAgo', { count: hrs });
    const days = Math.floor(hrs / 24);
    if (days < 7) return t('notifications.daysAgo', { count: days });
    return new Date(dateStr).toLocaleDateString(locale === 'en' ? 'en-GB' : 'vi-VN');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50/50 via-[#F9FAFB] to-[#F9FAFB] pb-10">
      <header className="bg-white/90 backdrop-blur-md px-4 sm:px-6 py-3 shadow-sm sticky top-0 z-40 border-b border-orange-100/60">
        <div className="max-w-2xl mx-auto flex items-center gap-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="p-2 bg-gray-50 hover:bg-orange-50 hover:text-[#F27124] rounded-full transition-colors shrink-0"
            aria-label={t('nav.home')}
          >
            <ArrowLeft size={20} />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="text-base sm:text-lg font-black text-gray-800 flex items-center gap-2">
              <Bell size={20} className="text-[#F27124] shrink-0" />
              {t('notifications.title')}
              {unreadCount > 0 && (
                <span className="bg-red-500 text-white text-[11px] font-black px-2 py-0.5 rounded-full">
                  {unreadCount > 99 ? '99+' : unreadCount}
                </span>
              )}
            </h1>
            <p className="text-[11px] sm:text-xs text-gray-500 font-medium truncate">{t('notifications.subtitle')}</p>
          </div>
          <LanguageToggle />
        </div>
      </header>

      <main className="max-w-2xl mx-auto mt-4 sm:mt-6 px-3 sm:px-4 space-y-3">
        {unreadCount > 0 && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={markAll}
              className="text-xs font-black text-[#F27124] bg-white border border-orange-100 hover:bg-orange-50 px-4 py-2 rounded-xl flex items-center gap-1.5 shadow-sm"
            >
              <CheckCircle2 size={14} /> {t('notifications.markAll')}
            </button>
          </div>
        )}

        {error && (
          <p className="text-sm font-bold text-red-600 bg-red-50 border border-red-100 rounded-2xl px-4 py-3">{error}</p>
        )}

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 size={36} className="animate-spin text-[#F27124]" />
          </div>
        ) : notifications.length === 0 ? (
          <div className="bg-white border border-gray-100 rounded-[2rem] p-10 text-center shadow-sm">
            <Bell size={44} className="mx-auto text-gray-300 mb-3" />
            <p className="font-black text-gray-700">{t('notifications.empty')}</p>
            <p className="text-sm text-gray-500 mt-1">{t('notifications.emptyHint')}</p>
          </div>
        ) : (
          notifications.map((noti) => {
            const { Icon, cls } = TYPE_STYLE[noti.type] || DEFAULT_STYLE;
            return (
              <button
                key={noti._id}
                type="button"
                onClick={() => handleClick(noti)}
                className={`w-full text-left bg-white rounded-2xl border p-4 flex gap-3 items-start transition-all hover:border-orange-200 hover:shadow-md ${
                  noti.isRead ? 'border-gray-100 opacity-75' : 'border-orange-200 shadow-sm'
                }`}
              >
                <div className={`w-11 h-11 rounded-full flex items-center justify-center shrink-0 ${cls}`}>
                  <Icon size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className={`text-sm ${noti.isRead ? 'font-bold text-gray-700' : 'font-black text-gray-900'}`}>{noti.title}</p>
                    {!noti.isRead && <span className="w-2.5 h-2.5 rounded-full bg-[#F27124] mt-1.5 shrink-0" aria-label={t('notifications.unread')} />}
                  </div>
                  <p className="text-sm text-gray-600 mt-0.5 break-words whitespace-pre-line">{noti.message}</p>
                  <p className="text-[11px] text-gray-400 font-bold mt-1.5">{timeAgo(noti.createdAt)}</p>
                </div>
              </button>
            );
          })
        )}
      </main>
    </div>
  );
};

export default StudentNotifications;
