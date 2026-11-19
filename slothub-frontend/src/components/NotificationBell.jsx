import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import api from '../api/axios';
import { AuthContext } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import { connectUserSocket } from '../utils/socket';

/**
 * UC-08: chuông thông báo trên header của sinh viên.
 * Hiện số thông báo chưa đọc, tăng ngay khi có thông báo realtime, bấm để mở /notifications.
 */
const NotificationBell = () => {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const { t } = useLocale();
  const userId = user?._id || user?.id;
  const isStudent = user?.role === 'student';
  const [unread, setUnread] = useState(0);

  useEffect(() => {
    if (!userId || !isStudent) return undefined;
    let alive = true;
    const load = () => api.get('/notifications/me')
      .then((res) => { if (alive) setUnread(res.data?.unreadCount || 0); })
      .catch(() => {});

    load();
    const timer = setInterval(load, 30000);
    const s = connectUserSocket(userId);
    // Popup toàn app (StudentOrderNotifier) có thể đánh dấu đã đọc ngay → tải lại số thật sau 1 giây
    const onNew = () => setTimeout(load, 1000);
    s.on('student_notification', onNew);
    return () => {
      alive = false;
      clearInterval(timer);
      s.off('student_notification', onNew);
    };
  }, [userId, isStudent]);

  if (!userId || !isStudent) return null;

  return (
    <button
      type="button"
      onClick={() => navigate('/notifications')}
      className="relative p-2.5 sm:p-3 bg-white border border-gray-200 rounded-full text-gray-600 hover:text-[#F27124] hover:border-orange-200 hover:shadow-md transition-all"
      aria-label={t('nav.notifications')}
      title={t('nav.notifications')}
    >
      <Bell size={20} />
      {unread > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[20px] h-5 px-1 bg-red-500 text-white text-[10px] font-black flex items-center justify-center rounded-full border-2 border-white">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  );
};

export default NotificationBell;
