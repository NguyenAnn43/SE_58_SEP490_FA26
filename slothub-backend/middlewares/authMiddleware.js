const jwt = require("jsonwebtoken");
const User = require("../models/User");

// 1. Hàm kiểm tra đăng nhập (Bảo vệ vòng ngoài)
const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    try {
      token = req.headers.authorization.split(" ")[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      req.user = await User.findById(decoded.id).select("-password");
      if (!req.user) {
        return res
          .status(401)
          .json({ message: "Tài khoản không tồn tại hoặc đã bị vô hiệu hóa!" });
      }
      if ((decoded.tokenVersion || 0) !== (req.user.tokenVersion || 0)) {
        return res.status(401).json({
          message: "Phiên đăng nhập đã bị thu hồi. Vui lòng đăng nhập lại.",
        });
      }
      return next();
    } catch (error) {
      return res
        .status(401)
        .json({ message: "Thẻ Token không hợp lệ hoặc đã hết hạn!" });
    }
  }

  if (!token) {
    return res
      .status(401)
      .json({ message: "Bạn chưa đăng nhập, không có quyền truy cập!" });
  }
};

module.exports = { protect };
