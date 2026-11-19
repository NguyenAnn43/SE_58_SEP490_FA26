import React, { useCallback, useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Heart, Loader2, ShoppingCart, Zap, Trash2, Star, Flame, Store, Eye } from 'lucide-react';
import api from '../api/axios';
import { AuthContext } from '../context/AuthContext';
import { appAlert } from '../utils/appAlert';
import { removeFavoriteLocal, loadFavoriteIds } from '../utils/favoritesStore';
import FoodDetailModal from '../components/FoodDetailModal';

const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;

const STATUS_STYLE = {
  AVAILABLE: 'bg-green-50 text-green-700 border-green-200',
  VENDOR_CLOSED: 'bg-amber-50 text-amber-700 border-amber-200',
  OUT_OF_STOCK: 'bg-gray-100 text-gray-600 border-gray-200',
  STOPPED: 'bg-gray-100 text-gray-600 border-gray-200',
  VENDOR_LOCKED: 'bg-gray-100 text-gray-600 border-gray-200',
  DELETED: 'bg-red-50 text-red-600 border-red-200',
};

/** Danh sách món yêu thích của sinh viên (lưu trong database, theo tài khoản) */
const Favorites = () => {
  const navigate = useNavigate();
  const { user } = useContext(AuthContext);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(null);
  const [detailId, setDetailId] = useState(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get('/favorites');
      setItems(res.data.items || []);
    } catch (err) {
      appAlert(err.response?.data?.message || 'Không tải được món yêu thích', { type: 'error' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!user) { navigate('/login'); return; }
    if (user.role !== 'student') { navigate('/'); return; }
    load();
  }, [user, navigate, load]);

  const remove = async (f) => {
    setBusy(`rm-${f.favoriteId}`);
    try {
      if (f.menuItemId) await api.delete(`/favorites/${f.menuItemId}`);
      removeFavoriteLocal(f.menuItemId);
      setItems((prev) => prev.filter((x) => x.favoriteId !== f.favoriteId));
    } catch (err) {
      appAlert(err.response?.data?.message || 'Không bỏ được món yêu thích', { type: 'error' });
    } finally {
      setBusy(null);
    }
  };

  /** Thêm vào giỏ — backend kiểm tra lại giá, kho, giờ quầy; "reorder" thì chuyển luôn sang thanh toán */
  const addToCart = async (f, reorder = false) => {
    setBusy(`${reorder ? 'ro' : 'add'}-${f.favoriteId}`);
    try {
      await api.post('/cart/add', { menuItemId: f.menuItemId, quantity: 1 });
      if (reorder) {
        navigate('/checkout');
      } else {
        appAlert(`Đã thêm "${f.name}" vào giỏ hàng.`, { type: 'success' });
      }
    } catch (err) {
      appAlert(err.response?.data?.message || 'Không thêm được vào giỏ', { type: 'error' });
      load(); // trạng thái món có thể vừa thay đổi
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="min-h-screen bg-[#F9FAFB]">
      <div className="bg-white border-b border-gray-100 sticky top-0 z-30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 py-4 flex items-center gap-3">
          <button type="button" onClick={() => navigate('/')} className="p-2 rounded-full hover:bg-gray-100"><ArrowLeft size={20} /></button>
          <h1 className="text-xl font-black text-gray-900 flex items-center gap-2"><Heart size={22} className="fill-red-500 text-red-500" /> Món yêu thích</h1>
          {!loading && <span className="text-xs font-bold text-gray-500 bg-gray-100 px-2.5 py-1 rounded-full">{items.length} món</span>}
        </div>
      </div>

      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6">
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="animate-spin text-[#F27124]" size={36} /></div>
        ) : items.length === 0 ? (
          <div className="bg-white rounded-3xl border border-gray-100 py-20 text-center">
            <Heart size={48} className="mx-auto text-gray-200 mb-4" />
            <p className="text-lg font-black text-gray-800">Chưa có món yêu thích</p>
            <p className="text-gray-500 mt-1">Bấm biểu tượng ❤️ trên món ăn để lưu lại và đặt nhanh lần sau.</p>
            <button type="button" onClick={() => navigate('/')} className="mt-6 bg-gray-900 text-white px-6 py-3 rounded-xl font-bold">Khám phá thực đơn</button>
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 gap-4">
            {items.map((f) => {
              const a = f.availability;
              const canOrder = a.canOrder && !!f.menuItemId;
              return (
                <div key={f.favoriteId} className={`bg-white rounded-3xl border border-gray-100 p-4 shadow-sm flex gap-4 ${canOrder ? '' : 'opacity-80'}`}>
                  <div className="w-24 h-24 rounded-2xl overflow-hidden bg-gray-100 shrink-0">
                    {f.imageUrl && <img src={f.imageUrl} alt={f.name} className={`w-full h-full object-cover ${canOrder ? '' : 'grayscale'}`} />}
                  </div>
                  <div className="flex-1 min-w-0 flex flex-col">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-black text-gray-900 leading-tight">{f.name}</p>
                      <button type="button" disabled={busy === `rm-${f.favoriteId}`} onClick={() => remove(f)} title="Bỏ yêu thích" className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 shrink-0">
                        {busy === `rm-${f.favoriteId}` ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
                      </button>
                    </div>
                    {f.vendor?.name && <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5"><Store size={12} /> {f.vendor.name}</p>}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-xs font-bold">
                      {f.price != null && <span className={`${f.discountActive ? 'text-red-600' : 'text-[#F27124]'} text-sm`}>{vnd(f.price)}</span>}
                      {f.discountActive ? (
                        <>
                          <span className="text-gray-400 line-through font-medium">{vnd(f.originalPrice)}</span>
                          <span className="bg-red-600 text-white text-[10px] font-black px-1.5 py-0.5 rounded">-{f.discountPercent}%</span>
                        </>
                      ) : (
                        f.priceChanged && <span className="text-gray-400 line-through font-medium">{vnd(f.previousPrice)}</span>
                      )}
                      {f.rating != null
                        ? <span className="flex items-center gap-0.5 text-amber-600"><Star size={12} className="fill-amber-400 text-amber-400" />{f.rating}/5 ({f.numReviews})</span>
                        : <span className="text-gray-400 font-medium">Chưa có đánh giá</span>}
                      {f.calories != null && <span className="flex items-center gap-0.5 text-orange-600"><Flame size={12} />{f.calories} kcal</span>}
                    </div>
                    <span className={`self-start mt-2 text-[11px] font-bold px-2 py-0.5 rounded-lg border ${STATUS_STYLE[a.code] || STATUS_STYLE.STOPPED}`}>
                      {a.label}{a.note ? ` · ${a.note}` : ''}
                    </span>
                    <div className="flex flex-wrap gap-2 mt-3">
                      {f.menuItemId && (
                        <button type="button" onClick={() => setDetailId(f.menuItemId)} className="text-xs font-bold px-3 py-2 rounded-xl border border-gray-200 text-gray-600 hover:border-[#F27124] hover:text-[#F27124] flex items-center gap-1">
                          <Eye size={14} /> Chi tiết
                        </button>
                      )}
                      <button type="button" disabled={!canOrder || !!busy} onClick={() => addToCart(f)} className="text-xs font-bold px-3 py-2 rounded-xl bg-orange-50 text-[#F27124] border border-orange-200 hover:bg-orange-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
                        {busy === `add-${f.favoriteId}` ? <Loader2 size={14} className="animate-spin" /> : <ShoppingCart size={14} />} Thêm vào giỏ
                      </button>
                      <button type="button" disabled={!canOrder || !!busy} onClick={() => addToCart(f, true)} className="text-xs font-black px-3 py-2 rounded-xl bg-[#F27124] text-white hover:bg-[#D95F1B] disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1">
                        {busy === `ro-${f.favoriteId}` ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />} Đặt lại ngay
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {detailId && (
        <FoodDetailModal
          itemId={detailId}
          onClose={() => { setDetailId(null); load(); loadFavoriteIds(String(user?._id || user?.id), true); }}
        />
      )}
    </div>
  );
};

export default Favorites;
