const User = require("../models/User");
const Transaction = require("../models/Transaction");
const Vendor = require("../models/Vendor");
const MenuItem = require("../models/MenuItem");
const Order = require("../models/Order");
const Notification = require("../models/Notification");
const { getVendorStatus } = require("../utils/vendorHours");
const {
  normalizeVendorHours,
  formatVendorHoursRange,
} = require("../utils/timeFormat");
const { logAudit } = require("../utils/persistence");
const {
  getCancellationPolicy,
  saveCancellationPolicy,
  formatPolicyForDisplay,
  DEFAULT_POLICY,
} = require("../utils/cancellationPolicy");

// 1. [GET] Lấy các chỉ số thống kê cho Dashboard
// UC-43 - View Admin Dashboard.
const getDashboardStats = async (req, res) => {
  try {
    if (req.user.role !== "admin") {
      return res.status(403).json({ message: "Truy cập bị từ chối!" });
    }

    const successfulDeposits = await Transaction.aggregate([
      { $match: { type: "DEPOSIT", status: "SUCCESS" } },
      { $group: { _id: null, totalAmount: { $sum: "$amount" } } },
    ]);
    const totalDeposits =
      successfulDeposits.length > 0 ? successfulDeposits[0].totalAmount : 0;

    const orderPayments = await Transaction.aggregate([
      { $match: { type: "PAYMENT", status: "SUCCESS" } },
      { $group: { _id: null, totalAmount: { $sum: "$amount" } } },
    ]);
    const totalOrderVolume =
      orderPayments.length > 0 ? orderPayments[0].totalAmount : 0;

    const platformFees = await Transaction.aggregate([
      { $match: { type: "PLATFORM_FEE", status: "SUCCESS" } },
      { $group: { _id: null, totalAmount: { $sum: "$amount" } } },
    ]);
    const totalPlatformFee =
      platformFees.length > 0 ? platformFees[0].totalAmount : 0;

    // Ví admin đang đăng nhập (phí sàn 5% tích lũy, trừ khi đã rút nếu có)
    const adminFresh = await User.findById(req.user._id).select(
      "walletBalance",
    );
    const adminWalletBalance =
      adminFresh?.walletBalance ?? req.user.walletBalance ?? 0;

    const pendingDeposits = await Transaction.countDocuments({
      type: "DEPOSIT",
      status: "PENDING",
    });

    const studentCount = await User.countDocuments({ role: "student" });
    const vendorCount = await User.countDocuments({
      role: { $in: ["vendor", "vendor_owner"] },
    });

    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const todayTxCount = await Transaction.countDocuments({
      createdAt: { $gte: startOfToday },
    });

    res.status(200).json({
      adminWalletBalance,
      totalPlatformFee,
      totalOrderVolume,
      totalDeposits,
      pendingDeposits,
      studentCount,
      vendorCount,
      todayTxCount,
    });
  } catch (error) {
    res.status(500).json({
      message: "Lỗi khi lấy thống kê Dashboard",
      error: error.message,
    });
  }
};

module.exports = {
  getDashboardStats,
  getCashFlowChart,
  getDashboardActivity,
  getAdminBankInfo,
  getAllVendorsAdmin,
  getPendingVendors,
  approveVendor,
  rejectVendor,
  updateAdminBankInfo,
  getAdminNotifications,
  markNotificationAsRead,
  getCancellationPolicyAdmin,
  updateCancellationPolicyAdmin,
};
