# Deploy SlotHub

Bản online gồm 3 phần, đều có gói miễn phí:

| Phần | Dịch vụ | Thư mục trong repo |
|---|---|---|
| Database | MongoDB Atlas | — |
| Backend (API + socket) | Render (Web Service) | `slothub-backend` |
| Frontend | Vercel | `slothub-frontend` |

Làm theo đúng thứ tự dưới đây: frontend cần link backend, backend cần link database.

## 1. Database: MongoDB Atlas

1. Vào https://cloud.mongodb.com → tạo cluster **M0 (Free)**.
2. **Database Access** → tạo user + mật khẩu (chỉ dùng chữ và số cho dễ).
3. **Network Access** → *Add IP Address* → `0.0.0.0/0` (Render không có IP cố định).
4. **Connect → Drivers** → chép chuỗi kết nối, thêm tên DB `slothub` trước dấu `?`:
   `mongodb+srv://USER:PASS@cluster0.xxxxx.mongodb.net/slothub?retryWrites=true&w=majority`

Đưa dữ liệu demo từ máy lên (chạy trên máy, trong `slothub-backend`):

```bash
node scripts/copyDatabase.js --from="mongodb://127.0.0.1:27017/slothub_demo" --to="<chuỗi Atlas ở trên>"
```

Database đích đã có dữ liệu thì script dừng lại; thêm `--overwrite` nếu muốn xoá dữ liệu cũ ở đó rồi chép lại.
Nếu chỉ muốn thêm gói ăn mẫu: `MONGODB_URI="<chuỗi Atlas>" node scripts/seedMealPlans.js`.

## 2. Backend: Render

1. https://dashboard.render.com → **New → Web Service** → chọn repo `NguyenAnn43/SE_58_SEP490_FA26`
   (repo public: nếu không thấy trong danh sách, dán link repo vào ô *Public Git Repository*).
2. Cấu hình:
   - **Branch**: `main`
   - **Root Directory**: `slothub-backend`
   - **Runtime**: Node
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: Free
3. **Environment** → thêm các biến trong [`slothub-backend/.env.example`](slothub-backend/.env.example)
   (giá trị lấy từ file `.env` trên máy; `MONGODB_URI` là chuỗi Atlas; `FRONTEND_URL` điền sau bước 3).
4. **Create Web Service**. Khi log hiện `🚀 Server SlotHub running`, mở
   `https://<tên-service>.onrender.com/api/timeslots` → thấy danh sách khung giờ là chạy.

## 3. Frontend: Vercel

1. https://vercel.com/new → import repo `NguyenAnn43/SE_58_SEP490_FA26`.
2. **Root Directory**: `slothub-frontend` (Vercel tự đọc `vercel.json`: build bằng `CI=false npm run build`).
3. **Environment Variables** (xem [`slothub-frontend/.env.example`](slothub-frontend/.env.example)):
   - `REACT_APP_API_URL` = `https://<tên-service>.onrender.com/api`
   - `REACT_APP_GOOGLE_CLIENT_ID` = Client ID Google (bỏ trống nếu dùng ID mặc định)
4. **Deploy** → được link dạng `https://<tên>.vercel.app`.
5. Quay lại Render → **Environment** → đặt `FRONTEND_URL` = link Vercel → **Save** (Render tự deploy lại).

## 4. Dịch vụ bên ngoài cần cập nhật link mới

- **Google đăng nhập**: Google Cloud Console → *APIs & Services → Credentials* → OAuth Client →
  thêm link Vercel vào **Authorized JavaScript origins**. Phải là người sở hữu Client ID đó;
  nếu không, tạo Client ID mới rồi đặt vào `GOOGLE_CLIENT_ID` (Render) và `REACT_APP_GOOGLE_CLIENT_ID` (Vercel).
- **payOS**: trang quản lý payOS → kênh thanh toán → **Webhook URL** =
  `https://<tên-service>.onrender.com/api/payment/payos_webhook`.

## Kiểm tra sau khi deploy

- Mở link Vercel khi chưa đăng nhập → thấy thực đơn.
- Đăng nhập admin / chủ quầy / sinh viên; đặt 1 đơn bằng ví → quầy duyệt → quét OTP nhận món.
- Admin → Cấu hình hệ thống: kiểm tra tài khoản ngân hàng nhận tiền nạp.

## Lưu ý

- **Render Free tự ngủ sau 15 phút không có truy cập**; lần mở đầu sau đó mất ~30–50 giây. Trước buổi demo nên mở web trước vài phút.
- **Tự deploy khi merge**: Render/Vercel tự deploy khi `main` có commit mới nếu được cấp quyền truy cập repo
  (chủ repo cài GitHub App của Render/Vercel). Nếu không, bấm **Manual Deploy** sau mỗi lần merge.
- **Deploy lỗi**: Render → *Events* → chọn bản trước → **Rollback**; Vercel → *Deployments* → bản trước → **Promote to Production**.
- Đổi biến môi trường của frontend phải **deploy lại** thì mới có hiệu lực (biến được gắn vào lúc build).
