/** Chuẩn hóa mã ngân hàng cho API VietQR (img.vietqr.io) */
const BANK_ALIASES = {
  MB: 'MB', MBB: 'MB', MBBANK: 'MB', 'MB BANK': 'MB', 'NGAN HANG TMCP QUAN DOI': 'MB',
  VCB: 'VCB', VIETCOMBANK: 'VCB', 'NGAN HANG TMCP NGOAI THUONG': 'VCB',
  TCB: 'TCB', TECHCOMBANK: 'TCB', 'NGAN HANG TMCP KY THUONG': 'TCB',
  TPB: 'TPB', TPBANK: 'TPB', 'NGAN HANG TMCP TIEN PHONG': 'TPB',
  ACB: 'ACB', 'NGAN HANG TMCP A CHAU': 'ACB',
  VPB: 'VPB', VPBANK: 'VPB', 'NGAN HANG TMCP VIET NAM THINH VUONG': 'VPB',
  BIDV: 'BIDV', 'NGAN HANG TMCP DAU TU VA PHAT TRIEN': 'BIDV',
  // Khóa phải VIẾT HOA (normalizeBankCode đổi input sang chữ hoa trước khi tra)
  VTB: 'ICB', ICB: 'ICB', VIETINBANK: 'ICB', 'NGAN HANG TMCP CONG THUONG': 'ICB',
  AGRIBANK: 'VBA', VBA: 'VBA', AGR: 'VBA',
  SHB: 'SHB', HDB: 'HDB', HDBANK: 'HDB', STB: 'STB', SACOMBANK: 'STB',
  VIB: 'VIB', MSB: 'MSB', OCB: 'OCB', EIB: 'EIB', EXIMBANK: 'EIB',
  SEAB: 'SEAB', SEABANK: 'SEAB', LPB: 'LPB', LPBANK: 'LPB', LIENVIETPOSTBANK: 'LPB',
  NAB: 'NAB', NAMABANK: 'NAB', BAB: 'BAB', BACABANK: 'BAB', ABB: 'ABB', ABBANK: 'ABB',
  PVCB: 'PVCB', PVCOMBANK: 'PVCB', KLB: 'KLB', KIENLONGBANK: 'KLB', VAB: 'VAB', VIETABANK: 'VAB',
  CAKE: 'CAKE', UBANK: 'Ubank', TIMO: 'TIMO', 'BVB': 'VCCB', VIETCAPITALBANK: 'VCCB',
};

export const normalizeBankCode = (bankName = '') => {
  const key = String(bankName).trim().toUpperCase().replace(/\s+/g, ' ');
  if (!key) return '';
  if (BANK_ALIASES[key]) return BANK_ALIASES[key];
  const compact = key.replace(/\s/g, '');
  if (BANK_ALIASES[compact]) return BANK_ALIASES[compact];
  // Nếu admin đã nhập đúng mã ngắn (2-5 ký tự) thì dùng luôn
  if (/^[A-Z0-9]{2,8}$/.test(compact)) return compact;
  return key.split(' ')[0] || key;
};

export const buildVietQrUrl = ({ bankName, accountNumber, accountName, amount, addInfo }) => {
  const bank = normalizeBankCode(bankName);
  const acc = String(accountNumber || '').trim();
  if (!bank || !acc) return null;

  const params = new URLSearchParams();
  if (amount && Number(amount) > 0) params.set('amount', String(Math.round(Number(amount))));
  if (addInfo) params.set('addInfo', addInfo);
  if (accountName) params.set('accountName', accountName);

  const qs = params.toString();
  return `https://img.vietqr.io/image/${bank}-${acc}-compact.png${qs ? `?${qs}` : ''}`;
};
