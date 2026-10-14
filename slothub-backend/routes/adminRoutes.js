const express = require("express");
const router = express.Router();
const {
  getDashboardStats,
  getCashFlowChart,
  getDashboardActivity,
  getAdminBankInfo,
  getAllVendorsAdmin,
  getPendingVendors,
  approveVendor,
  rejectVendor,
  updateAdminBankInfo,
  getAdminNotifications, // 🌟 Import hàm thông báo
  markNotificationAsRead, // 🌟 Import hàm thông báo
  getCancellationPolicyAdmin,
  updateCancellationPolicyAdmin,
} = require("../controllers/adminController");
const { protect } = require("../middlewares/authMiddleware");

// Bảo mật: Phải có token đăng nhập mới được gọi
router.use(protect);

// UC-43 - View Admin Dashboard.
// UC-44 - View Cash Flow Chart.
// UC-45 - Reconcile Cash Flow.
router.get("/stats", getDashboardStats);
router.get("/cash-flow", getCashFlowChart);
router.get("/activity", getDashboardActivity);

// UC-50 - Config System Bank.
router.get("/bank-info", getAdminBankInfo);
router.put("/bank-info", updateAdminBankInfo);

// UC-48 - Approve Stall Registrations.
// UC-49 - Manage Approved Vendors.
router.get("/vendors", getAllVendorsAdmin);
router.get("/pending-vendors", getPendingVendors);
router.put("/approve-vendor/:userId", approveVendor);
router.delete("/reject-vendor/:userId", rejectVendor);

// Admin notification center.
router.get("/notifications", getAdminNotifications);
router.put("/notifications/:id/read", markNotificationAsRead);

// Admin policy configuration.
router.get("/cancellation-policy", getCancellationPolicyAdmin);
router.put("/cancellation-policy", updateCancellationPolicyAdmin);

module.exports = router;
