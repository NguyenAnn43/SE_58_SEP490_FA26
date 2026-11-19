import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import api from '../api/axios';
import { CheckCircle2, XCircle, Loader2, ArrowRight } from 'lucide-react';
import { useLocale } from '../context/LocaleContext';
import LanguageToggle from '../components/LanguageToggle';

const IS_LOCALHOST = ['localhost', '127.0.0.1'].includes(window.location.hostname);

/** 2 nút xem thử trang kết quả (chỉ hiện trên localhost) — dùng để chụp ảnh / test giao diện */
export const PaymentResultPreviewButtons = ({ className = '' }) => {
    const navigate = useNavigate();
    if (!IS_LOCALHOST) return null;
    return (
        <div className={`rounded-2xl border border-dashed border-gray-300 p-3 ${className}`}>
            <p className="text-[11px] font-bold text-gray-400 uppercase tracking-wider mb-2">Test giao diện (chỉ localhost)</p>
            <div className="flex gap-2">
                <button type="button" onClick={() => navigate('/payment-result?preview=success')}
                    className="flex-1 bg-green-50 text-green-700 border border-green-200 hover:bg-green-100 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1">
                    <CheckCircle2 size={14} /> Thành công
                </button>
                <button type="button" onClick={() => navigate('/payment-result?preview=failed')}
                    className="flex-1 bg-red-50 text-red-600 border border-red-200 hover:bg-red-100 py-2 rounded-xl text-xs font-black flex items-center justify-center gap-1">
                    <XCircle size={14} /> Thất bại
                </button>
            </div>
        </div>
    );
};

const PaymentResult = () => {
    const navigate = useNavigate();
    const location = useLocation();
    const { t } = useLocale();
    const [status, setStatus] = useState('loading');
    const [message, setMessage] = useState('');

    useEffect(() => {
        setMessage(t('paymentResult.processing'));
        const searchParams = location.search;

        // CHẾ ĐỘ XEM THỬ (chỉ localhost): /payment-result?preview=success|failed
        // → hiện giao diện kết quả, KHÔNG gọi backend, không đụng tới đơn / tiền / giỏ hàng.
        const preview = new URLSearchParams(searchParams).get('preview');
        if (IS_LOCALHOST && (preview === 'success' || preview === 'failed')) {
            setStatus(preview);
            setMessage(preview === 'failed' ? 'Bạn đã hủy thanh toán đơn hàng này.' : t('payment.success'));
            return;
        }

        if (!searchParams) {
            setStatus('failed');
            setMessage(t('paymentResult.invalid'));
            return;
        }

        // TÁCH URL ĐỂ KIỂM TRA KHÁCH CÓ BẤM HỦY HAY KHÔNG
        const urlParams = new URLSearchParams(searchParams);
        const isCancelled = urlParams.get('cancel') === 'true' || urlParams.get('vnp_ResponseCode') === '24';

        const verifyPayment = async () => {
            try {
                // Vẫn gửi URL về Backend để xử lý Database
                // Lưu ý: Route này sếp có thể đổi tên thành /payment/return nếu muốn tổng quát
                const res = await api.get(`/payment/vnpay_return${searchParams}`);
                
                if (isCancelled) {
                    setStatus('failed');
                    setMessage('Bạn đã hủy thanh toán đơn hàng này.');
                    return;
                }

                setStatus('success');
                setMessage(res.data.message || t('payment.success'));
                
                // Tiện tay xóa luôn giỏ hàng ở FE khi thanh toán thành công
                await api.delete('/cart/clear').catch(() => console.log('Cart clear info'));

            } catch (error) {
                setStatus('failed');
                // Nếu là lỗi do khách bấm hủy thì báo rõ, còn lỗi mạng/hệ thống thì báo mặc định
                if (isCancelled) {
                    setMessage('Bạn đã hủy thanh toán giao dịch này.');
                } else {
                    setMessage(error.response?.data?.message || 'Giao dịch thất bại hoặc đã bị hủy!');
                }
            }
        };

        verifyPayment();
    }, [location, t]);

    return (
        <div className="flex flex-col items-center justify-center min-h-screen bg-[#F9FAFB] p-4 font-sans text-gray-800">
            <div className="absolute top-4 right-4"><LanguageToggle /></div>
            <div className="bg-white w-full max-w-md p-8 rounded-[2.5rem] shadow-2xl shadow-gray-200/50 border border-gray-100 flex flex-col items-center text-center animate-in zoom-in-95 duration-500">
                
                {status === 'loading' && (
                    <>
                        <Loader2 size={64} className="text-[#F27124] animate-spin mb-6" />
                        <h2 className="text-2xl font-black text-gray-800 mb-2">{t('paymentResult.loadingTitle')}</h2>
                        <p className="text-gray-500 font-medium">{message}</p>
                    </>
                )}

                {status === 'success' && (
                    <>
                        <div className="w-24 h-24 bg-green-50 text-green-500 rounded-full flex items-center justify-center mb-6">
                            <CheckCircle2 size={48} />
                        </div>
                        <h2 className="text-3xl font-black text-gray-800 mb-2">{t('paymentResult.successTitle')}</h2>
                        <p className="text-gray-500 font-medium mb-8">
                            {t('paymentResult.successDesc')}
                        </p>
                        <button 
                            onClick={() => navigate('/orders')}
                            className="w-full bg-[#F27124] text-white py-4 rounded-2xl font-black flex items-center justify-center gap-2 shadow-lg shadow-orange-200 hover:bg-[#D95F1B] transition-colors"
                        >
                            {t('paymentResult.viewPickup')} <ArrowRight size={20} />
                        </button>
                    </>
                )}

                {status === 'failed' && (
                    <>
                        <div className="w-24 h-24 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-6">
                            <XCircle size={48} />
                        </div>
                        <h2 className="text-3xl font-black text-gray-800 mb-2">{t('paymentResult.failTitle')}</h2>
                        <p className="text-gray-500 font-medium mb-8">
                            {message}<br/><span className="text-sm mt-1 inline-block">{t('paymentResult.failHint')}</span>
                        </p>
                        <button 
                            onClick={() => navigate('/checkout')}
                            className="w-full bg-gray-100 text-gray-700 hover:bg-gray-200 py-4 rounded-2xl font-black flex items-center justify-center gap-2 transition-colors"
                        >
                            {t('paymentResult.backCheckout')}
                        </button>
                    </>
                )}

            </div>
        </div>
    );
};

export default PaymentResult;