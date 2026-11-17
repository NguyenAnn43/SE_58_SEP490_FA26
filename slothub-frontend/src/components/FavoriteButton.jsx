import React, { useState } from 'react';
import { Heart } from 'lucide-react';
import { useFavorites } from '../utils/favoritesStore';
import { appAlert } from '../utils/appAlert';

/** Nút tim thêm/bỏ món yêu thích (chỉ hiện với tài khoản sinh viên) */
const FavoriteButton = ({ menuItemId, size = 18, className = '', withLabel = false }) => {
  const { enabled, isFavorite, toggle } = useFavorites();
  const [busy, setBusy] = useState(false);
  if (!enabled || !menuItemId) return null;
  const active = isFavorite(menuItemId);

  const onClick = async (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      await toggle(menuItemId);
    } catch (error) {
      appAlert(error.response?.data?.message || 'Không cập nhật được món yêu thích', { type: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={active ? 'Bỏ khỏi món yêu thích' : 'Thêm vào món yêu thích'}
      title={active ? 'Bỏ khỏi món yêu thích' : 'Thêm vào món yêu thích'}
      className={`flex items-center justify-center gap-1.5 transition-transform active:scale-90 ${className}`}
    >
      <Heart size={size} className={active ? 'fill-red-500 text-red-500' : 'text-gray-500'} />
      {withLabel && <span className="text-sm font-bold">{active ? 'Đã yêu thích' : 'Yêu thích'}</span>}
    </button>
  );
};

export default FavoriteButton;
