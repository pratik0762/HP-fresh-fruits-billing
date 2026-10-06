const ReportService = require('../services/reportService');
const { Sale, Purchase, Item, Customer, sequelize } = require('../models');

const getProfitLoss = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const { startDate, endDate } = req.query;

    const report = await ReportService.getProfitLossReport({
      branchId,
      startDate,
      endDate
    });

    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
};

const getAging = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const { partyType = 'CUSTOMER' } = req.query;

    const aging = await ReportService.getAgingReport({
      branchId,
      partyType
    });

    res.json({ success: true, aging });
  } catch (err) {
    next(err);
  }
};

const getInventoryValuation = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const report = await ReportService.getInventoryReport({ branchId });
    res.json({ success: true, report });
  } catch (err) {
    next(err);
  }
};

const getTopPerformers = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId;
    const where = branchId ? { branchId } : {};

    // Top Customers by sales volume
    const sales = await Sale.findAll({
      where,
      include: [{ model: Customer, as: 'customer', attributes: ['id', 'name', 'phone'] }]
    });

    const customerMap = {};
    for (const s of sales) {
      if (!s.customer) continue;
      const cid = s.customer.id;
      if (!customerMap[cid]) {
        customerMap[cid] = {
          id: cid,
          name: s.customer.name,
          phone: s.customer.phone,
          totalSales: 0,
          invoicesCount: 0
        };
      }
      customerMap[cid].totalSales += parseFloat(s.totalAmount || 0);
      customerMap[cid].invoicesCount += 1;
    }

    const topCustomers = Object.values(customerMap)
      .sort((a, b) => b.totalSales - a.totalSales)
      .slice(0, 10)
      .map(c => ({ ...c, totalSales: parseFloat(c.totalSales.toFixed(2)) }));

    res.json({
      success: true,
      topCustomers
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getProfitLoss,
  getAging,
  getInventoryValuation,
  getTopPerformers
};
