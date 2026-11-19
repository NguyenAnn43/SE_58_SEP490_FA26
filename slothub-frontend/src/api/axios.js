import axios from 'axios';

const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
// Bản deploy: đặt REACT_APP_API_URL (VD https://ten-backend.onrender.com/api) trong biến môi trường của Vercel
const baseURL = process.env.REACT_APP_API_URL
  || (isLocalhost ? 'http://localhost:5000/api' : 'https://slothub-toivoa.onrender.com/api');

const api = axios.create({
    baseURL,
});

// Tự động đính kèm Token khi gọi API
api.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
}, (error) => {
    return Promise.reject(error);
});

export default api;