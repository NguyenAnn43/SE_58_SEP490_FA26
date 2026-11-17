const Vendor = require('../models/Vendor');
const { getTopItems, getTimeseries, getForecast } = require('../utils/demandStats');

/** Thống kê chỉ cho chủ quầy, chỉ trên đơn của quầy mình (vendor lấy từ token, không từ query) */
const withMyVendor = (handler) => async (req, res) => {
    try {
        if (!['vendor', 'vendor_owner'].includes(req.user.role)) {
            return res.status(403).json({ message: 'Chỉ chủ quầy mới xem được thống kê.' });
        }
        const vendor = await Vendor.findOne({ owner: req.user.id }).select('_id name');
        if (!vendor) return res.status(404).json({ message: 'Bạn chưa có gian hàng!' });
        const data = await handler(vendor._id, req.query);
        res.status(200).json(data);
    } catch (error) {
        res.status(error.status || 500).json({ message: error.status ? error.message : 'Lỗi thống kê', error: error.message });
    }
};

// [GET] /vendor/stats/top-items?from=YYYY-MM-DD&to=YYYY-MM-DD&limit=10
const getTopItemsStats = withMyVendor(getTopItems);
// [GET] /vendor/stats/timeseries?from&to&granularity=day|week
const getTimeseriesStats = withMyVendor(getTimeseries);
// [GET] /vendor/stats/forecast?horizonDays=30|60
const getForecastStats = withMyVendor(getForecast);

module.exports = { getTopItemsStats, getTimeseriesStats, getForecastStats };
