import { Coffee, Sun, CloudSun, Flame, Sunset, Moon, UtensilsCrossed } from 'lucide-react';

/**
 * Xác định "buổi" của khung giờ nhận món theo giờ bắt đầu (không theo thứ tự).
 * Key dùng để lấy nhãn i18n (`slotPeriods.<key>`) và icon tương ứng.
 */
const PERIODS = [
  { key: 'breakfast', from: 0, to: 10 * 60 },            // trước 10:00
  { key: 'earlyLunch', from: 10 * 60, to: 11 * 60 },     // 10:00 – 11:00
  { key: 'lunchPeak', from: 11 * 60, to: 12 * 60 + 30 }, // 11:00 – 12:30
  { key: 'lateLunch', from: 12 * 60 + 30, to: 14 * 60 }, // 12:30 – 14:00
  { key: 'afternoon', from: 14 * 60, to: 17 * 60 },      // 14:00 – 17:00
  { key: 'dinner', from: 17 * 60, to: 20 * 60 },         // 17:00 – 20:00
  { key: 'lateNight', from: 20 * 60, to: 24 * 60 },      // sau 20:00
];

const toMinutes = (timeStr) => {
  const [h, m] = String(timeStr || '00:00').split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
};

export const getSlotPeriodKey = (startTime) => {
  const min = toMinutes(startTime);
  return (PERIODS.find((p) => min >= p.from && min < p.to) || PERIODS[0]).key;
};

const DEFAULT_PERIOD_LABELS = {
  breakfast: 'Bữa sáng',
  earlyLunch: 'Trưa sớm · ít đông',
  lunchPeak: 'Cao điểm trưa',
  lateLunch: 'Trưa muộn',
  afternoon: 'Bữa xế chiều',
  dinner: 'Bữa tối',
  lateNight: 'Ăn khuya',
};

const PERIOD_ICONS = {
  breakfast: Coffee,
  earlyLunch: CloudSun,
  lunchPeak: Flame,
  lateLunch: Sun,
  afternoon: Sunset,
  dinner: UtensilsCrossed,
  lateNight: Moon,
};

/** Component icon (lucide) của khung giờ */
export const getSlotPeriodIcon = (startTime) => PERIOD_ICONS[getSlotPeriodKey(startTime)] || Sun;

/** Nhãn của khung giờ; `periods` là object nhãn từ i18n (có thể undefined) */
export const getSlotPeriodLabel = (startTime, periods) => {
  const key = getSlotPeriodKey(startTime);
  const dict = periods && typeof periods === 'object' && !Array.isArray(periods) ? periods : DEFAULT_PERIOD_LABELS;
  return dict[key] || DEFAULT_PERIOD_LABELS[key];
};
