const { Op } = require('sequelize');
const { 
  Sale, Purchase, StockBatch, RunningBalance, Item, Branch, Customer, Supplier, sequelize 
} = require('../models');
const ReportService = require('../services/reportService');

// Local-calendar date string (YYYY-MM-DD) — NOT UTC. toISOString() shifts the
// date backwards for IST (UTC+5:30), which put early-morning entries on the
// previous day and started the "month" window on the last day of the prior month.
const toLocalDateStr = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getDashboardStats = async (req, res, next) => {
  try {
    const branchId = req.targetBranchId; // null for consolidated all-branches if Owner
    const whereBranch = branchId ? { branchId } : {};

    const todayStr = toLocalDateStr();

    // 1. Today's Purchases
    const todayPurchases = await Purchase.findAll({
      where: { ...whereBranch, purchaseDate: todayStr }
    });
    const todayPurchaseTotal = todayPurchases.reduce((acc, p) => acc + parseFloat(p.totalAmount || 0), 0);

    // 2. Today's Sales
    const todaySales = await Sale.findAll({
      where: { ...whereBranch, saleDate: todayStr }
    });
    const todaySaleTotal = todaySales.reduce((acc, s) => acc + parseFloat(s.totalAmount || 0), 0);

    // Today's Gross Profit — computed by the SAME P&L engine as the month card
    // (net sales − agent commission − FIFO COGS − wastage − weight variance) so
    // both figures share one definition and no stale stored values are trusted.
    const todayPnl = await ReportService.getProfitLossReport({
      branchId,
      startDate: todayStr,
      endDate: todayStr
    });
    const todaySaleGrossProfit = todayPnl.grossProfit;

    // 3. Month to Date P&L (local calendar month, not UTC-shifted)
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    const startOfMonthStr = toLocalDateStr(startOfMonth);

    const pnl = await ReportService.getProfitLossReport({
      branchId,
      startDate: startOfMonthStr,
      endDate: todayStr
    });

    // 4. Total Stock Quantity & Valuation
    const activeBatches = await StockBatch.findAll({
      where: {
        ...whereBranch,
        status: 'ACTIVE',
        currentQuantity: { [Op.gt]: 0 }
      }
    });

    let totalStockKg = 0;
    let totalStockValuation = 0;
    for (const b of activeBatches) {
      const qty = parseFloat(b.currentQuantity || 0);
      const cost = parseFloat(b.landedCostPerUnit || 0);
      totalStockKg += qty;
      totalStockValuation += (qty * cost);
    }

    // 5. Cash on Hand & Bank Balance (from running_balances or ledger)
    const runningBalances = await RunningBalance.findAll({
      where: branchId ? { branchId } : {}
    });

    let cashOnHand = 0;
    let bankBalance = 0;
    let pendingReceivables = 0;
    let pendingPayables = 0;

    for (const rb of runningBalances) {
      const bal = parseFloat(rb.currentBalance || 0);
      if (rb.entityType === 'CASH') cashOnHand += bal;
      if (rb.entityType === 'BANK') bankBalance += bal;
      if (rb.entityType === 'CUSTOMER' && bal > 0) pendingReceivables += bal;
      if (rb.entityType === 'SUPPLIER' && bal > 0) pendingPayables += bal;
    }

    // 6. Trend charts: Last 14 days daily sales & profit.
    // PERFORMANCE: two grouped queries (by date) instead of 28 sequential
    // per-day findAll calls — this was the dashboard's biggest bottleneck.
    const pastDays = 14;
    const trendStart = new Date();
    trendStart.setDate(trendStart.getDate() - (pastDays - 1));
    const trendStartStr = toLocalDateStr(trendStart);

    const trendSales = await Sale.findAll({
      where: { ...whereBranch, saleDate: { [Op.gte]: trendStartStr } },
      attributes: [
        'saleDate',
        [sequelize.fn('SUM', sequelize.col('totalAmount')), 'sales'],
        [sequelize.fn('SUM', sequelize.col('grossProfit')), 'profit']
      ],
      group: ['saleDate'],
      raw: true
    });
    const trendPurchases = await Purchase.findAll({
      where: { ...whereBranch, purchaseDate: { [Op.gte]: trendStartStr } },
      attributes: [
        'purchaseDate',
        [sequelize.fn('SUM', sequelize.col('totalAmount')), 'purchases']
      ],
      group: ['purchaseDate'],
      raw: true
    });

    const salesByDate = {};
    for (const r of trendSales) salesByDate[r.saleDate] = r;
    const purchasesByDate = {};
    for (const r of trendPurchases) purchasesByDate[r.purchaseDate] = r;

    const trendData = [];
    for (let i = pastDays - 1; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dStr = toLocalDateStr(d);

      const salesAmt = parseFloat(salesByDate[dStr]?.sales || 0);
      const profitAmt = parseFloat(salesByDate[dStr]?.profit || 0);
      const purchaseAmt = parseFloat(purchasesByDate[dStr]?.purchases || 0);

      trendData.push({
        date: dStr.slice(5), // MM-DD
        fullDate: dStr,
        sales: parseFloat(salesAmt.toFixed(2)),
        profit: parseFloat(profitAmt.toFixed(2)),
        purchases: parseFloat(purchaseAmt.toFixed(2))
      });
    }

    // 7. Low Stock Alerts
    const allItems = await Item.findAll({ where: { isActive: true } });
    const lowStockAlerts = [];

    for (const itm of allItems) {
      const itmBatches = activeBatches.filter(b => b.itemId === itm.id);
      const curStock = itmBatches.reduce((acc, b) => acc + parseFloat(b.currentQuantity || 0), 0);
      const threshold = parseFloat(itm.reorderThreshold || 100);

      if (curStock <= threshold) {
        lowStockAlerts.push({
          itemId: itm.id,
          name: itm.name,
          variety: itm.variety,
          currentStockKg: parseFloat(curStock.toFixed(2)),
          reorderThreshold: threshold,
          unit: itm.baseUnit
        });
      }
    }

    // 8. Near Expiry Alerts (Perishable fruits with age > shelfLife - 3 days)
    const nearExpiryAlerts = [];
    const now = new Date();
    for (const b of activeBatches) {
      const item = allItems.find(i => i.id === b.itemId);
      const shelfLife = item?.shelfLifeDays || 14;
      const recDate = new Date(b.receivedDate);
      const ageDays = Math.floor((now - recDate) / (1000 * 60 * 60 * 24));

      if (ageDays >= (shelfLife - 4)) {
        nearExpiryAlerts.push({
          batchId: b.id,
          batchNumber: b.batchNumber,
          itemName: item ? `${item.name} (${item.variety || ''})` : 'Unknown',
          currentQuantityKg: parseFloat(b.currentQuantity),
          receivedDate: b.receivedDate,
          ageDays,
          shelfLifeDays: shelfLife,
          daysLeft: Math.max(0, shelfLife - ageDays)
        });
      }
    }

    // 9. Overdue Payment Aging
    const aging = await ReportService.getAgingReport({ branchId, partyType: 'CUSTOMER' });

    res.json({
      success: true,
      branchId: branchId || 'CONSOLIDATED',
      today: {
        purchaseTotal: parseFloat(todayPurchaseTotal.toFixed(2)),
        saleTotal: parseFloat(todaySaleTotal.toFixed(2)),
        grossProfit: parseFloat(todaySaleGrossProfit.toFixed(2)),
        netSales: todayPnl.revenue.netSalesRevenue,
        cogs: todayPnl.directCosts.costOfGoodsSold
      },
      monthToDate: {
        netSales: pnl.revenue.netSalesRevenue,
        cogs: pnl.directCosts.costOfGoodsSold,
        losses: pnl.directCosts.weightVarianceLoss + pnl.directCosts.fruitWastageLoss,
        operatingExpenses: pnl.operatingExpenses.total,
        netProfit: pnl.netProfit,
        profitMarginPct: pnl.netProfitMarginPct
      },
      totals: {
        totalStockKg: parseFloat(totalStockKg.toFixed(2)),
        totalStockValuation: parseFloat(totalStockValuation.toFixed(2)),
        cashOnHand: parseFloat(cashOnHand.toFixed(2)),
        bankBalance: parseFloat(bankBalance.toFixed(2)),
        pendingReceivables: parseFloat(pendingReceivables.toFixed(2)),
        pendingPayables: parseFloat(pendingPayables.toFixed(2))
      },
      trendData,
      alerts: {
        lowStock: lowStockAlerts,
        nearExpiry: nearExpiryAlerts,
        overduePayments: aging.buckets
      }
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getDashboardStats
};
