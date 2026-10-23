import React, { useState, useRef, useEffect, useContext, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, X, Send, Bot, User, Sparkles, Plus, Minus, Check, Flame, Utensils, Star, Info } from 'lucide-react';
import api from '../api/axios';
import { AuthContext } from '../context/AuthContext';
import { useLocale } from '../context/LocaleContext';
import ChatOrderPanel, { draftInputOf } from './ChatOrderPanel';
import FoodDetailModal from './FoodDetailModal';

/** Báo cho trang Home cập nhật icon giỏ hàng (giỏ được đồng bộ khi xác nhận đơn từ chatbot) */
export const CART_UPDATED_EVENT = 'slothub:cart-updated';

const vnd = (n) => `${Number(n || 0).toLocaleString('vi-VN')}đ`;
const STATUS_LABEL = { Pending: 'Chờ thanh toán', Processing: 'Quầy đang chuẩn bị', Ready: 'Sẵn sàng nhận', Completed: 'Hoàn thành', Cancelled: 'Đã huỷ' };
const PAYMENT_STATUS_LABEL = { Paid: 'Đã thanh toán', Unpaid: 'Chưa thanh toán', Failed: 'Thanh toán thất bại', Refunded: 'Đã hoàn tiền' };
const newKey = () => (window.crypto?.randomUUID ? window.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

const ChatWidget = () => {
  const { t, locale } = useLocale();
  const navigate = useNavigate();
  const { fetchBalance } = useContext(AuthContext);
  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Ngữ cảnh hội thoại gửi kèm mỗi câu: món vừa gợi ý, tiêu chí đang áp dụng, đơn nháp
  const [lastSuggestions, setLastSuggestions] = useState([]);
  const [criteria, setCriteria] = useState({});
  const [draft, setDraft] = useState(null);        // đơn nháp do server tính (giá, calo, cảnh báo...)
  const [syncing, setSyncing] = useState(false);
  const [placing, setPlacing] = useState(false);
  const [orderError, setOrderError] = useState('');
  const [detailId, setDetailId] = useState(null);
  const placeKeyRef = useRef({ signature: '', key: '' }); // idempotencyKey ổn định khi thử lại cùng một đơn
  const messagesEndRef = useRef(null);

  const addAi = (text, extra = {}) => setMessages((prev) => [...prev, { sender: 'ai', text, ...extra }]);

  useEffect(() => {
    setMessages([{ sender: 'ai', text: t('chat.greetingLong') }]);
  }, [locale, t]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, draft?.items?.length]);

  /** Gửi bản nháp đã sửa lên server để tính lại tiền/calo/cảnh báo từ DB */
  const refreshDraft = useCallback(async (input) => {
    if (!input.items.length) {
      setDraft(null);
      return;
    }
    setSyncing(true);
    setOrderError('');
    try {
      const res = await api.post('/chat/draft', { draft: input });
      setDraft(res.data.draft);
    } catch (error) {
      setOrderError(error.response?.data?.message || 'Không cập nhật được đơn, thử lại nhé!');
    } finally {
      setSyncing(false);
    }
  }, []);

  /** Thêm / bớt món từ thẻ gợi ý vào đơn nháp */
  const changeDraftQty = (item, delta) => {
    const input = draftInputOf(draft);
    const id = String(item._id);
    const exists = input.items.find((i) => i._id === id);
    const items = exists
      ? input.items.map((i) => (i._id === id ? { ...i, quantity: i.quantity + delta } : i)).filter((i) => i.quantity > 0)
      : delta > 0 ? [...input.items, { _id: id, quantity: delta }] : input.items;
    refreshDraft({ ...input, items });
  };

  /** Tạo đơn thật: đồng bộ giỏ → POST /orders (kèm idempotencyKey) → payOS nếu chọn chuyển khoản */
  const placeOrder = async (view) => {
    if (!view?.ready || placing) return;
    const input = draftInputOf(view);
    const signature = JSON.stringify(input);
    if (placeKeyRef.current.signature !== signature) placeKeyRef.current = { signature, key: newKey() };

    setPlacing(true);
    setOrderError('');
    try {
      const cartRes = await api.get('/cart');
      const cart = cartRes.data?.items ? cartRes.data : cartRes.data?.cart;
      const current = {};
      (cart?.items || []).forEach((ci) => { current[String(ci.menuItem?._id || ci.menuItem)] = ci.quantity; });
      for (const i of input.items) {
        const delta = i.quantity - (current[i._id] || 0);
        if (delta !== 0) await api.post('/cart/add', { menuItemId: i._id, quantity: delta });
      }

      const res = await api.post('/orders', {
        paymentMethod: input.paymentMethod,
        deliveryType: 'pickup',
        pickupSlot: input.pickupSlot,
        pickupDate: input.pickupDate,
        note: input.note,
        selectedMenuItemIds: input.items.map((i) => i._id),
        idempotencyKey: placeKeyRef.current.key,
      });

      api.get('/cart')
        .then((r) => window.dispatchEvent(new CustomEvent(CART_UPDATED_EVENT, { detail: r.data?.items ? r.data : r.data?.cart })))
        .catch(() => {});

      const orders = res.data.orders || (res.data.order ? [res.data.order] : []);
      const codes = orders.map((o) => `#${String(o._id).slice(-6).toUpperCase()}`).join(', ');
      const total = orders.reduce((s, o) => s + (o.totalPrice || 0), 0);

      if (input.paymentMethod === 'payos' && !res.data.duplicate) {
        addAi(`Đã tạo đơn ${codes} (${vnd(total)}) ở trạng thái **Chờ thanh toán**. Đang chuyển sang trang payOS để quét VietQR...`);
        const pay = await api.post('/payment/create_payment_link', {
          orderId: orders[0]?._id,
          batchId: res.data.checkoutBatchId,
          origin: (window.location.origin + window.location.pathname).replace(/\/$/, ''),
        });
        window.location.href = pay.data.paymentUrl;
        return;
      }

      const first = orders[0] || {};
      const lines = [
        res.data.duplicate ? '⚠️ Đơn này đã được tạo trước đó — hệ thống không tạo trùng.' : '🎉 **Đặt hàng thành công!**',
        `• Mã đơn: **${codes}**`,
        `• Tổng thanh toán: **${vnd(total)}**`,
        `• Phương thức: ${view.paymentMethods.find((p) => p.id === input.paymentMethod)?.label || input.paymentMethod}`,
        `• Trạng thái đơn: ${STATUS_LABEL[first.status] || first.status} · ${PAYMENT_STATUS_LABEL[first.paymentStatus] || first.paymentStatus}`,
      ];
      if (view.totalCalories != null) lines.push(`• Tổng calo ước tính: ${view.totalCalories} kcal`);
      lines.push('Mã QR/OTP nhận món có trong mục **Đơn hàng** và đã gửi về email của bạn.');
      addAi(lines.join('\n'), { goOrders: true });

      fetchBalance?.();
      setDraft(null);
      placeKeyRef.current = { signature: '', key: '' };
    } catch (error) {
      // Giữ nguyên đơn nháp + key để khách thử lại mà không tạo đơn trùng
      setOrderError(error.response?.data?.message || 'Không đặt được đơn, thử lại nhé!');
    } finally {
      setPlacing(false);
    }
  };

  const handleSendMessage = async (text) => {
    const userMessage = (text ?? inputText).trim();
    if (!userMessage || isLoading) return;
    setMessages((prev) => [...prev, { sender: 'user', text: userMessage }]);
    setInputText('');
    setIsLoading(true);

    try {
      const context = {
        suggestions: lastSuggestions,
        criteria,
        draft: draft ? draftInputOf(draft) : null,
      };
      const res = await api.post('/chat/chat', { message: userMessage, context });
      const suggestions = Array.isArray(res.data.suggestions) ? res.data.suggestions : [];
      addAi(res.data.reply || res.data.message, { suggestions });

      if (suggestions.length) setLastSuggestions(suggestions.map((s) => ({ _id: String(s._id), name: s.name })));
      if (res.data.criteria) setCriteria(res.data.criteria);
      if (res.data.draft) setDraft(res.data.draft.items?.length ? res.data.draft : null);
      if (res.data.confirm && res.data.draft) await placeOrder(res.data.draft);
    } catch (error) {
      const errorMsg = error.response?.data?.reply || error.response?.data?.message || 'SlotAI đang đi ăn trưa, bạn đợi chút hoặc thử lại sau nha! 😥';
      addAi(errorMsg);
    } finally {
      setIsLoading(false);
    }
  };

  // Định dạng **đậm** từ câu trả lời
  const formatText = (text = '') => text.split(/(\*\*.*?\*\*)/g).map((part, i) => (
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={i} className="text-[#F27124]">{part.slice(2, -2)}</strong>
      : <span key={i}>{part}</span>
  ));

  const draftQty = (id) => draft?.items?.find((i) => String(i._id) === String(id))?.quantity || 0;
  const lastSuggestionMsgIndex = messages.reduce((acc, m, i) => (m.suggestions?.length ? i : acc), -1);

  const renderSuggestion = (item, interactive) => {
    const id = String(item._id);
    const inDraft = draftQty(id);
    const outOfStock = item.countInStock != null && item.countInStock <= 0;
    return (
      <div key={id} className={`bg-white border rounded-2xl p-2.5 shadow-sm ${inDraft ? 'border-green-200' : 'border-orange-100'}`}>
        <div className="flex gap-3">
          {item.imageUrl ? (
            <img
              src={item.imageUrl}
              alt={item.name}
              className="w-14 h-14 rounded-xl object-cover bg-gray-100 shrink-0"
              onError={(e) => { e.currentTarget.style.visibility = 'hidden'; }}
            />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-orange-50 text-[#F27124] flex items-center justify-center shrink-0"><Utensils size={18} /></div>
          )}
          <div className="flex-1 min-w-0">
            <p className="font-black text-sm text-gray-900 truncate">{item.name}</p>
            <p className="text-[11px] text-gray-500 truncate">{item.vendor?.name}</p>
            <div className="flex flex-wrap items-center gap-x-2 text-[11px] font-bold">
              <span className="text-[#F27124]">{vnd(item.price)}</span>
              {item.calories != null
                ? <span className="flex items-center gap-0.5 text-orange-600"><Flame size={10} />{item.calories} kcal/phần</span>
                : <span className="text-gray-400 font-medium">Chưa có calo</span>}
              {item.rating != null
                ? <span className="flex items-center gap-0.5 text-amber-600"><Star size={10} className="fill-amber-400 text-amber-400" />{item.rating}/5 ({item.numReviews})</span>
                : <span className="text-gray-400 font-medium">Chưa có đánh giá</span>}
            </div>
          </div>
        </div>
        {item.description && <p className="text-[11px] text-gray-500 mt-1.5 line-clamp-2">{item.description}</p>}
        {item.reason && (
          <p className="text-[10.5px] text-orange-700 bg-orange-50 rounded-lg px-2 py-1 mt-1.5 flex gap-1">
            <Info size={11} className="shrink-0 mt-0.5" /> {item.reason}
          </p>
        )}
        {item.vendorIsOpen === false && (
          <p className="text-[10.5px] text-gray-500 mt-1">{item.vendorStatusMessage || 'Quầy đang đóng — vẫn có thể đặt trước cho khung giờ quầy mở.'}</p>
        )}
        <div className="flex items-center justify-between gap-2 mt-2">
          <button type="button" onClick={() => setDetailId(id)} className="text-[11px] font-bold text-gray-500 hover:text-[#F27124]">
            Xem chi tiết
          </button>
          {!interactive ? null : outOfStock ? (
            <span className="text-[11px] font-bold text-gray-400">Món đã hết</span>
          ) : inDraft > 0 ? (
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-black text-green-600 flex items-center gap-0.5"><Check size={12} /> Trong đơn</span>
              <div className="flex items-center gap-0.5 bg-gray-50 border border-gray-100 rounded-lg p-0.5">
                <button type="button" disabled={syncing || placing} onClick={() => changeDraftQty(item, -1)} aria-label="Giảm" className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:bg-white"><Minus size={12} /></button>
                <span className="w-5 text-center text-sm font-black">{inDraft}</span>
                <button type="button" disabled={syncing || placing} onClick={() => changeDraftQty(item, 1)} aria-label="Tăng" className="w-6 h-6 flex items-center justify-center rounded text-gray-600 hover:bg-white"><Plus size={12} /></button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={syncing || placing}
              onClick={() => changeDraftQty(item, 1)}
              className="flex items-center gap-1 text-xs font-black px-3 py-1.5 rounded-xl bg-gradient-to-r from-[#F27124] to-[#ff985e] text-white hover:shadow-md disabled:opacity-60"
            >
              <Plus size={13} /> Thêm vào đơn
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed bottom-24 lg:bottom-6 right-4 sm:right-6 z-[100] font-sans">
      {/* NÚT MỞ CHAT */}
      {!isOpen && (
        <button
          onClick={() => setIsOpen(true)}
          className="bg-gradient-to-r from-[#F27124] to-[#ff985e] text-white p-4 rounded-full shadow-2xl hover:scale-110 hover:shadow-orange-300 transition-all duration-300 flex items-center justify-center animate-bounce group relative"
        >
          <MessageSquare size={28} />
          <Sparkles size={16} className="absolute top-2 right-2 text-yellow-300 animate-pulse" />
          <span className="absolute -top-12 right-0 bg-white text-gray-800 text-sm font-bold px-4 py-2 rounded-2xl shadow-xl opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none border border-orange-100">
            {t('chat.tooltip')}
          </span>
          {draft?.items?.length > 0 && (
            <span className="absolute -top-1 -left-1 bg-green-500 text-white text-[10px] font-black w-5 h-5 rounded-full flex items-center justify-center">
              {draft.items.reduce((s, i) => s + i.quantity, 0)}
            </span>
          )}
        </button>
      )}

      {/* CỬA SỔ CHAT */}
      {isOpen && (
        <div className="bg-white w-[calc(100vw-2rem)] sm:w-[420px] h-[560px] sm:h-[660px] max-h-[calc(100vh-9rem)] rounded-[2.5rem] shadow-[0_20px_50px_rgba(242,113,36,0.15)] border border-orange-100 flex flex-col overflow-hidden animate-in slide-in-from-bottom-8 fade-in duration-300">
          <div className="bg-gradient-to-r from-[#F27124] to-[#ff985e] p-5 flex justify-between items-center text-white shrink-0 shadow-md z-10 relative overflow-hidden">
            <div className="absolute -right-10 -top-10 w-32 h-32 bg-white/10 rounded-full blur-2xl"></div>
            <div className="flex items-center gap-3 relative z-10">
              <div className="bg-white/20 p-2.5 rounded-full backdrop-blur-sm border border-white/30 shadow-sm relative">
                <Bot size={24} className="text-white" />
                <span className="absolute bottom-0 right-0 w-3 h-3 bg-green-400 border-2 border-[#ff985e] rounded-full animate-pulse"></span>
              </div>
              <div>
                <h3 className="font-black text-xl leading-tight tracking-wide">{t('chat.title')}</h3>
                <p className="text-xs text-orange-50 font-medium opacity-90">Tìm món · lên đơn · thanh toán</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="text-white hover:text-[#F27124] bg-white/10 hover:bg-white p-2 rounded-full transition-colors relative z-10"
            >
              <X size={20} />
            </button>
          </div>

          {/* TIN NHẮN */}
          <div className="flex-1 p-4 overflow-y-auto bg-gray-50 flex flex-col gap-4 custom-scrollbar">
            {messages.map((msg, index) => (
              <div key={index} className="flex flex-col gap-2">
                <div className={`flex gap-3 max-w-[90%] ${msg.sender === 'user' ? 'ml-auto flex-row-reverse' : ''}`}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 shadow-sm mt-auto ${msg.sender === 'user' ? 'bg-gradient-to-br from-gray-200 to-gray-300 text-gray-600' : 'bg-gradient-to-br from-orange-100 to-orange-200 text-[#F27124]'}`}>
                    {msg.sender === 'user' ? <User size={18} /> : <Bot size={18} />}
                  </div>
                  <div className={`p-3.5 text-[14.5px] leading-relaxed shadow-sm ${
                    msg.sender === 'user'
                      ? 'bg-gradient-to-br from-[#F27124] to-[#ff985e] text-white rounded-2xl rounded-br-sm shadow-orange-200/50'
                      : 'bg-white text-gray-700 border border-gray-100 rounded-2xl rounded-bl-sm whitespace-pre-line'
                  }`}>
                    {msg.sender === 'user' ? msg.text : formatText(msg.text)}
                    {msg.goOrders && (
                      <button
                        type="button"
                        onClick={() => { setIsOpen(false); navigate('/orders'); }}
                        className="block mt-2 text-xs font-black text-white bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded-lg"
                      >
                        Xem đơn hàng
                      </button>
                    )}
                  </div>
                </div>

                {/* THẺ MÓN GỢI Ý — chỉ nhóm gợi ý mới nhất được thao tác */}
                {msg.sender === 'ai' && msg.suggestions?.length > 0 && (
                  <div className="ml-12 flex flex-col gap-2">
                    <p className="text-[11px] font-black uppercase tracking-wider text-gray-400">Món SlotAI gợi ý (dữ liệu thực đơn)</p>
                    {msg.suggestions.map((item) => renderSuggestion(item, index === lastSuggestionMsgIndex))}
                  </div>
                )}
              </div>
            ))}

            {isLoading && (
              <div className="flex gap-3 max-w-[85%]">
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-orange-100 to-orange-200 text-[#F27124] flex items-center justify-center shrink-0 shadow-sm mt-auto">
                  <Bot size={18} />
                </div>
                <div className="bg-white border border-gray-100 px-4 py-5 rounded-2xl rounded-bl-sm shadow-sm flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 bg-[#F27124]/40 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></span>
                  <span className="w-2.5 h-2.5 bg-[#F27124]/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></span>
                  <span className="w-2.5 h-2.5 bg-[#F27124] rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></span>
                </div>
              </div>
            )}

            {/* ĐƠN HÀNG ĐANG SOẠN — luôn ở cuối hội thoại */}
            {draft?.items?.length > 0 && (
              <ChatOrderPanel
                draft={draft}
                syncing={syncing}
                placing={placing}
                error={orderError}
                onChange={refreshDraft}
                onShowDetail={(id) => setDetailId(String(id))}
                onCancel={() => { setDraft(null); setOrderError(''); addAi('Đã huỷ đơn nháp. Cần gì cứ nhắn mình nhé! 🍱'); }}
                onConfirm={() => placeOrder(draft)}
              />
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* NHẬP LIỆU */}
          <div className="p-4 bg-white border-t border-gray-100 shrink-0">
            <div className="flex gap-2 overflow-x-auto pb-2 mb-2">
              {['Món ăn ít calo nhất', 'Dưới 30k, đánh giá cao', 'Đặt 1 cơm gà và 1 trà đào', 'Xem đơn của tôi'].map((hint) => (
                <button
                  key={hint}
                  type="button"
                  disabled={isLoading || placing}
                  onClick={() => handleSendMessage(hint)}
                  className="shrink-0 text-[11px] font-bold text-[#D95F1B] bg-orange-50 border border-orange-100 px-3 py-1.5 rounded-full hover:bg-orange-100 disabled:opacity-50"
                >
                  {hint}
                </button>
              ))}
            </div>
            <div className="relative flex items-center">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder={t('chat.placeholder')}
                className="w-full bg-gray-50 border border-gray-200 rounded-full py-3.5 pl-5 pr-14 focus:bg-white focus:border-[#F27124] focus:ring-2 focus:ring-orange-50 outline-none transition-all text-[15px] font-medium"
                disabled={isLoading || placing}
              />
              <button
                onClick={() => handleSendMessage()}
                disabled={!inputText.trim() || isLoading || placing}
                className="absolute right-2 bg-gradient-to-r from-[#F27124] to-[#ff985e] text-white p-2.5 rounded-full hover:shadow-lg hover:shadow-orange-200 hover:-translate-y-0.5 transition-all active:translate-y-0 disabled:from-gray-300 disabled:to-gray-300 disabled:shadow-none disabled:hover:translate-y-0 disabled:cursor-not-allowed"
              >
                <Send size={18} className="ml-0.5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {detailId && <FoodDetailModal itemId={detailId} onClose={() => setDetailId(null)} />}

      <style dangerouslySetInnerHTML={{__html: `
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-track { background: transparent; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 10px; }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover { background: #d1d5db; }
      `}} />
    </div>
  );
};

export default ChatWidget;
