// utils/sendEmail.js
// Gửi email theo 1 trong 2 cách:
//  1) BREVO_API_KEY có giá trị → gửi qua API HTTPS của Brevo (cổng 443).
//     Dùng cho bản deploy trên Render Free: Render chặn mọi kết nối SMTP (cổng 25/465/587).
//  2) Không có BREVO_API_KEY → gửi qua Gmail SMTP (EMAIL_USER + EMAIL_PASS) như trước — dùng khi chạy trên máy.
const nodemailer = require('nodemailer');
const dns = require('dns');

// Ép Node.js ưu tiên phân giải IPv4 trước để tránh lỗi ENETUNREACH (không hỗ trợ IPv6 trên Render)
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

const BREVO_URL = 'https://api.brevo.com/v3/smtp/email';
const BREVO_TIMEOUT_MS = 15000;

// Tạo transporter SMTP khi cần lần đầu (không mở kết nối SMTP nếu đang gửi qua Brevo)
let transporter = null;
const getTransporter = () => {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false, // Dùng cổng 587 với STARTTLS
      pool: true,    // Giữ kết nối SMTP để gửi nhanh
      maxConnections: 5,
      family: 4,     // Ép buộc chỉ dùng IPv4
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
      tls: {
        rejectUnauthorized: false
      }
    });
  }
  return transporter;
};

/** Email người gửi: EMAIL_FROM (nếu đặt) hoặc EMAIL_USER. Với Brevo, email này phải được xác minh trong mục Senders. */
const senderEmail = () => process.env.EMAIL_FROM || process.env.EMAIL_USER;

const sendViaBrevo = async ({ email, subject, message, html }) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BREVO_TIMEOUT_MS);
  try {
    const res = await fetch(BREVO_URL, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify({
        sender: { name: 'SlotHub', email: senderEmail() },
        to: [{ email }],
        subject,
        ...(html ? { htmlContent: html } : {}),
        // Brevo bắt buộc có htmlContent hoặc textContent
        ...(message || !html ? { textContent: message || subject } : {}),
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`Brevo trả lỗi ${res.status}: ${detail.slice(0, 300)}`);
    }
    return res.json().catch(() => ({}));
  } catch (err) {
    if (err.name === 'AbortError') throw new Error(`Brevo không phản hồi sau ${BREVO_TIMEOUT_MS / 1000}s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
};

const sendEmail = async (options) => {
  if (process.env.BREVO_API_KEY) {
    return sendViaBrevo(options);
  }

  // Nội dung bức thư
  const mailOptions = {
    from: `SlotHub <${senderEmail()}>`,
    to: options.email,
    subject: options.subject,
    text: options.message, // Vẫn giữ lại để luồng Quên mật khẩu cũ chạy bình thường
    html: options.html,    // Hỗ trợ gửi giao diện hóa đơn đẹp
  };

  await getTransporter().sendMail(mailOptions);
};

module.exports = sendEmail;
