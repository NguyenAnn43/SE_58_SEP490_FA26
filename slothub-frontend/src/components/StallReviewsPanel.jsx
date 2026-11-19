import React, { useEffect, useState } from 'react';
import { Star, MessageSquareQuote, X, Loader2 } from 'lucide-react';
import api from '../api/axios';
import { useLocale } from '../context/LocaleContext';

/** Hàng sao 1–5 (tô màu theo điểm) */
const Stars = ({ value, size = 14 }) => (
  <span className="inline-flex items-center gap-0.5">
    {[1, 2, 3, 4, 5].map((i) => (
      <Star
        key={i}
        size={size}
        className={i <= Math.round(value) ? 'text-amber-400 fill-amber-400' : 'text-gray-200 fill-gray-200'}
      />
    ))}
  </span>
);

/**
 * UC-28: hiển thị công khai đánh giá chất lượng phục vụ của một quầy.
 * Dữ liệu lấy từ GET /api/reviews/:vendorId (đánh giá gửi từ Lịch sử đơn hàng).
 */
const StallReviewsPanel = ({ vendorId, vendorName, compact = false }) => {
  const { t, locale } = useLocale();
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!vendorId) return undefined;
    let cancelled = false;
    setLoading(true);
    api.get(`/reviews/${vendorId}`)
      .then((res) => { if (!cancelled) setReviews(Array.isArray(res.data) ? res.data : []); })
      .catch(() => { if (!cancelled) setReviews([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [vendorId]);

  if (!vendorId) return null;

  const count = reviews.length;
  const avg = count ? reviews.reduce((s, r) => s + (Number(r.rating) || 0), 0) / count : 0;
  const formatDate = (d) => new Date(d).toLocaleDateString(locale === 'en' ? 'en-GB' : 'vi-VN');

  return (
    <>
      <div className={`bg-white border border-gray-100 shadow-sm ${compact ? 'rounded-2xl p-4' : 'rounded-[1.75rem] p-5'}`}>
        <h3 className="text-sm font-black text-gray-900 flex items-center gap-2 mb-2">
          <MessageSquareQuote size={18} className="text-[#F27124]" />
          {t('stallReviews.title')}
        </h3>
        {loading ? (
          <Loader2 size={18} className="animate-spin text-[#F27124]" />
        ) : count === 0 ? (
          <p className="text-xs text-gray-500 font-medium">{t('stallReviews.empty')}</p>
        ) : (
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="text-2xl font-black text-gray-900">{avg.toFixed(1)}</span>
              <div className="min-w-0">
                <Stars value={avg} />
                <p className="text-[11px] text-gray-500 font-bold">{t('stallReviews.count', { count })}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="shrink-0 text-xs font-black text-[#F27124] bg-orange-50 hover:bg-orange-100 px-3 py-2 rounded-xl transition-colors"
            >
              {t('stallReviews.viewAll')}
            </button>
          </div>
        )}
      </div>

      {open && (
        <div className="fixed inset-0 z-[60] bg-black/40 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4" onClick={() => setOpen(false)}>
          <div
            className="bg-white w-full sm:max-w-lg max-h-[85vh] rounded-t-[2rem] sm:rounded-[2rem] shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-gray-100">
              <div className="min-w-0">
                <p className="text-base font-black text-gray-900 truncate">{vendorName}</p>
                <p className="text-xs text-gray-500 font-bold flex items-center gap-1.5">
                  <Stars value={avg} size={12} /> {avg.toFixed(1)} · {t('stallReviews.count', { count })}
                </p>
              </div>
              <button type="button" onClick={() => setOpen(false)} className="p-2 rounded-full hover:bg-gray-100" aria-label={t('stallReviews.close')}>
                <X size={20} />
              </button>
            </div>
            <ul className="overflow-y-auto px-6 py-4 space-y-4">
              {reviews.map((r) => (
                <li key={r._id} className="flex gap-3">
                  {r.user?.avatar ? (
                    <img src={r.user.avatar} alt="" className="w-9 h-9 rounded-full object-cover shrink-0" referrerPolicy="no-referrer" />
                  ) : (
                    <div className="w-9 h-9 rounded-full bg-orange-50 text-[#F27124] font-black flex items-center justify-center shrink-0">
                      {(r.user?.name || '?').charAt(0).toUpperCase()}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-black text-gray-800 truncate">{r.user?.name || t('common.student')}</p>
                      <span className="text-[11px] text-gray-400 font-bold shrink-0">{formatDate(r.createdAt)}</span>
                    </div>
                    <Stars value={r.rating} size={12} />
                    <p className="text-sm text-gray-600 mt-1 break-words">{r.comment}</p>
                    {r.images?.length > 0 && (
                      <div className="flex gap-2 mt-2 flex-wrap">
                        {r.images.map((src) => (
                          <img key={src} src={src} alt="" className="w-16 h-16 rounded-xl object-cover" />
                        ))}
                      </div>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
};

export default StallReviewsPanel;
