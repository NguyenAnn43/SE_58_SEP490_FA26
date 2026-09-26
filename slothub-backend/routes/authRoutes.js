const express = require("express");
const router = express.Router();
const { protect } = require("../middlewares/authMiddleware");
const { login, googleLogin, logout } = require("../controllers/authController");
const {
  getMyProfile,
  updateProfile,
} = require("../controllers/userController");

router.post("/login", login);
router.post("/google", googleLogin);
router.post("/logout", protect, logout);
router.get("/profile", protect, getMyProfile);
router.put("/profile", protect, updateProfile);

module.exports = router;
