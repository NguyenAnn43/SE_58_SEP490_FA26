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

app.use("/api/auth", authRoutes);
app.use('/api/notifications', notificationRoutes);


// ==========================================
// 4. CHẠY SERVER
// ==========================================
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`🚀 Server SlotHub running on port ${PORT}`);
});
