import { useContext, useEffect, useState } from 'react';
import api from '../api/axios';
import { AuthContext } from '../context/AuthContext';

/**
 * Bộ nhớ dùng chung id các món yêu thích (dữ liệu gốc nằm trong database — API /favorites).
 * Mọi nút tim trên trang đọc chung một nguồn nên bấm ở đâu cũng đồng bộ.
 */
let ids = new Set();
let loadedForUser = null;
let loading = null;
const listeners = new Set();

const emit = () => listeners.forEach((fn) => fn(new Set(ids)));

export const loadFavoriteIds = async (userId, force = false) => {
  if (!userId) return;
  if (!force && loadedForUser === userId) return;
  if (loading && !force) return loading;
  loading = api.get('/favorites/ids')
    .then((res) => {
      ids = new Set((res.data?.ids || []).map(String));
      loadedForUser = userId;
      emit();
    })
    .catch(() => {})
    .finally(() => { loading = null; });
  return loading;
};

const resetFavorites = () => {
  ids = new Set();
  loadedForUser = null;
  emit();
};

/** Bật/tắt yêu thích — cập nhật ngay trên giao diện, hoàn tác nếu server báo lỗi */
export const toggleFavorite = async (menuItemId) => {
  const id = String(menuItemId);
  const wasFavorite = ids.has(id);
  if (wasFavorite) ids.delete(id); else ids.add(id);
  emit();
  try {
    if (wasFavorite) await api.delete(`/favorites/${id}`);
    else await api.post(`/favorites/${id}`);
    return { isFavorite: !wasFavorite };
  } catch (error) {
    // 404 khi xoá = đã không còn trong danh sách → coi như thành công
    if (wasFavorite && error.response?.status === 404) return { isFavorite: false };
    if (wasFavorite) ids.add(id); else ids.delete(id);
    emit();
    throw error;
  }
};

export const removeFavoriteLocal = (menuItemId) => {
  ids.delete(String(menuItemId));
  emit();
};

export const useFavorites = () => {
  const { user } = useContext(AuthContext);
  const [state, setState] = useState(() => new Set(ids));
  const userId = user?._id || user?.id || null;
  const enabled = user?.role === 'student';

  useEffect(() => {
    listeners.add(setState);
    return () => listeners.delete(setState);
  }, []);

  useEffect(() => {
    if (enabled) loadFavoriteIds(String(userId));
    else if (loadedForUser) resetFavorites();
  }, [enabled, userId]);

  return {
    enabled,
    isFavorite: (id) => state.has(String(id)),
    toggle: toggleFavorite,
  };
};
