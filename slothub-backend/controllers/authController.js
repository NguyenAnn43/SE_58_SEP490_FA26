const User = require("../models/User");
const jwt = require("jsonwebtoken");

const generateToken = (user) => {
  return jwt.sign(
    { id: user._id, role: user.role, tokenVersion: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: "7d" },
  );
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Vui lòng nhập Email và Mật khẩu!" });
    }

    // Phải thêm .select('+password') để lấy trường password bị ẩn
    const user = await User.findOne({ email }).select("+password");
    if (!user)
      return res
        .status(401)
        .json({ message: "Tài khoản không tồn tại trong hệ thống!" });

    if (user.role === "student") {
      return res.status(403).json({
        message: "CẢNH BÁO: Khách hàng vui lòng đăng nhập bằng nút Google!",
      });
    }

    // 🌟 CHỐT CHẶN: Chặn Vendor chưa được Admin duyệt
    if (
      (user.role === "vendor" || user.role === "vendor_owner") &&
      user.isApproved === false
    ) {
      return res.status(403).json({
        message:
          "Gian hàng của bạn đang chờ Admin phê duyệt! Vui lòng quay lại sau.",
      });
    }

    if (!user.password) {
      return res.status(400).json({
        message:
          "Tài khoản này chưa được thiết lập mật khẩu. Vui lòng liên hệ Admin!",
      });
    }

    // So sánh mật khẩu bằng hàm đã viết sẵn trong Model
    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(401).json({ message: "Sai mật khẩu!" });

    const token = generateToken(user);
    user.password = undefined;

    res.status(200).json({
      message: "🔑 Đăng nhập hệ thống Quản trị thành công!",
      token: token,
      user: {
        _id: user._id,
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone || "",
        role: user.role,
        avatar: user.avatar,
        walletBalance: user.walletBalance,
        bankAccount: user.bankAccount,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Lỗi server", error: error.message });
  }
};

const googleLogin = async (req, res) => {
  try {
    const { access_token: accessToken } = req.body;
    if (!accessToken) {
      return res.status(400).json({ message: "Thiếu Google Access Token!" });
    }

    const response = await fetch(
      "https://www.googleapis.com/oauth2/v3/userinfo",
      {
        headers: { Authorization: `Bearer ${accessToken}` },
      },
    );
    const { email, email_verified: emailVerified } = await response.json();

    if (!email || !emailVerified) {
      return res
        .status(401)
        .json({ message: "Thông tin tài khoản Google không hợp lệ." });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res
        .status(401)
        .json({ message: "Tài khoản không tồn tại trong hệ thống!" });
    }

    const token = generateToken(user);
    return res.status(200).json({
      message: "Đăng nhập Google thành công!",
      token,
      user: {
        _id: user._id,
        id: user._id,
        name: user.name,
        email: user.email,
        phone: user.phone || "",
        role: user.role,
        avatar: user.avatar,
        walletBalance: user.walletBalance,
        bankAccount: user.bankAccount,
      },
    });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Lỗi xác thực Google từ Server", error: error.message });
  }
};

const logout = async (req, res) => {
  try {
    req.user.tokenVersion = (req.user.tokenVersion || 0) + 1;
    await req.user.save();
    res.status(200).json({ message: "Đăng xuất thành công." });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Lỗi khi đăng xuất.", error: error.message });
  }
};

module.exports = { login, googleLogin, logout };
