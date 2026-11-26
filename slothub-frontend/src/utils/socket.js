import { io } from 'socket.io-client';

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
// Mặc định lấy theo REACT_APP_API_URL (bỏ đuôi /api) → chỉ cần đặt 1 biến khi deploy
const SOCKET_URL = process.env.REACT_APP_SOCKET_URL
  || (process.env.REACT_APP_API_URL && process.env.REACT_APP_API_URL.replace(/\/api\/?$/, ''))
  || (isLocalhost ? 'http://localhost:5000' : 'https://slothub-toivoa.onrender.com');

let socket = null;

// Phòng (room) đã vào. Server quên hết phòng khi socket mất kết nối (Render ngủ/deploy lại, mạng chập chờn),
// nên mỗi lần kết nối lại phải vào lại — nếu không, tin nhắn / thông báo realtime sẽ không tới nữa.
let joinedUserId = null;
const joinedConversations = new Set();

export const getSocket = () => {
  if (!socket) {
    socket = io(SOCKET_URL, { autoConnect: false, transports: ['websocket', 'polling'] });
    socket.on('connect', () => {
      if (joinedUserId) socket.emit('join_user', joinedUserId);
      joinedConversations.forEach((id) => socket.emit('join_conversation', id));
    });
  }
  return socket;
};

export const connectUserSocket = (userId) => {
  const s = getSocket();
  if (userId) joinedUserId = String(userId);
  if (!s.connected) s.connect(); // sự kiện 'connect' ở trên sẽ vào phòng user
  else if (userId) s.emit('join_user', String(userId));
  return s;
};

/** Vào phòng của 1 hội thoại (tự vào lại sau khi kết nối lại) */
export const joinConversation = (conversationId) => {
  if (!conversationId) return;
  const id = String(conversationId);
  joinedConversations.add(id);
  const s = getSocket();
  if (s.connected) s.emit('join_conversation', id);
};

export const disconnectSocket = () => {
  joinedUserId = null;
  joinedConversations.clear();
  if (socket?.connected) socket.disconnect();
};
