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
app.use("/api/auth", authRoutes);

const vendorRoutes = require("./routes/vendorRoutes");
app.use("/api/vendor", vendorRoutes);

const menuItemRoutes = require("./routes/menuItemRoutes");
app.use("/api/menuitems", menuItemRoutes);

const timeSlotRoutes = require("./routes/timeSlotRoutes");
app.use("/api/timeslots", timeSlotRoutes);

const cartRoutes = require("./routes/cartRoutes");
app.use("/api/cart", cartRoutes);

const chatRoutes = require("./routes/chatRoutes");
app.use("/api/chat", chatRoutes);
// ==========================================
// 4. CHẠY SERVER
// ==========================================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server SlotHub running on port ${PORT}`);
});
