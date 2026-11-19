import React from 'react';

/** Món đang giảm giá? (API trả `discountActive` + `originalPrice`; `price` đã là giá sau giảm) */
export const hasDiscount = (item) =>
  Boolean(item?.discountActive) && Number(item?.originalPrice) > Number(item?.price);

/** "21:30 · 25/11" — giờ kết thúc giảm giá */
export const formatDiscountEnd = (value) => {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
};

/**
 * Giá món: giá đang bán (to) + giá gốc gạch ngang khi có giảm giá.
 * size: 'lg' (thẻ món) | 'md' (popup / danh sách) | 'sm' (giỏ hàng)
 */
const SIZES = {
  lg: { now: 'text-2xl', old: 'text-xs', unit: 'text-sm' },
  md: { now: 'text-xl', old: 'text-xs', unit: 'text-sm' },
  sm: { now: 'text-sm', old: 'text-[10px]', unit: 'text-xs' },
};

const PriceTag = ({ item, quantity = 1, size = 'lg', className = '' }) => {
  const s = SIZES[size] || SIZES.lg;
  const now = (Number(item?.price) || 0) * quantity;
  const discounted = hasDiscount(item);
  const old = (Number(item?.originalPrice) || 0) * quantity;

  return (
    <span className={`inline-flex flex-col leading-tight ${className}`}>
      {discounted && (
        <span className={`${s.old} font-bold text-gray-400 line-through`}>{old.toLocaleString('vi-VN')}đ</span>
      )}
      <span className={`${s.now} font-black tracking-tight ${discounted ? 'text-red-600' : 'text-[#F27124]'}`}>
        {now.toLocaleString('vi-VN')}
        <span className={`${s.unit} font-bold text-gray-400 ml-0.5`}>đ</span>
      </span>
    </span>
  );
};

export default PriceTag;
