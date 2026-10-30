const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");

dotenv.config();

const app = express();

// ==========================================
// 2. MIDDLEWARE & DB
// ==========================================
app.use(cors());
app.use(express.json());

connectDB();

// ==========================================
// 3. ROUTES DECLARATION
// ==========================================
const authRoutes = require("./routes/authRoutes");
const notificationRoutes = require('./routes/notificationRoutes');
const messageRoutes = require('./routes/messageRoutes');
const reviewRoutes = require('./routes/reviewRoutes');
const refundRoutes = require('./routes/refundRoutes');
const vendorRoutes = require("./routes/vendorRoutes");
const menuItemRoutes = require("./routes/menuItemRoutes");
const timeSlotRoutes = require("./routes/timeSlotRoutes");
const cartRoutes = require("./routes/cartRoutes");
const chatRoutes = require("./routes/chatRoutes");
const orderRoutes = require("./routes/orderRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const transactionRoutes = require("./routes/transactionRoutes");



app.use('/api/reviews', reviewRoutes);
app.use("/api/auth", authRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/refunds', refundRoutes);
app.use("/api/vendor", vendorRoutes);
app.use("/api/menuitems", menuItemRoutes);
app.use("/api/timeslots", timeSlotRoutes);
app.use("/api/cart", cartRoutes);
app.use("/api/chat", chatRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/payment", paymentRoutes);
app.use("/api/transactions", transactionRoutes);
// ==========================================
// 4. CHẠY SERVER
// ==========================================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server SlotHub running on port ${PORT}`);
});
