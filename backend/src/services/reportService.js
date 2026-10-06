const { Op } = require('sequelize');
const { 
  Sale, Purchase, Expense, WastageEntry, StockBatch, Customer, Supplier, Transaction, RunningBalance, Item, Branch, sequelize 
} = require('../models');

class ReportService {
  /**
   * Profit & Loss Report strictly implementing the fruit trading formula:
   * Net Sales Revenue = Sales Total - Discounts - Sale Commissions
   * Landed COGS = Sum of batch landed costs of items sold
   * Losses = Spoilage/Wastage Losses + Weight Variance Losses
   * Gross Margin = Net Sales Revenue - Landed COGS - Losses
   * Operating Overheads = Mandi Fees + Cold Storage + Labor/Palledar + Electricity + Rent + Fuel + Packaging
   * Net Profit = Gross Margin - Operating Overheads
   */
  static async getProfitLossReport({ branchId, startDate, endDate }) {
    const whereBranch = branchId ? { branchId } : {};
    const dateRange = {};
    if (startDate) dateRange[Op.gte] = startDate;
    if (endDate) dateRange[Op.lte] = endDate;

    const saleWhere = { ...whereBranch };
    if (startDate || endDate) saleWhere.saleDate = dateRange;

    const purchaseWhere = { ...whereBranch };
    if (startDate || endDate) purchaseWhere.purchaseDate = dateRange;

    const expenseWhere = { ...whereBranch };
    if (startDate || endDate) expenseWhere.expenseDate = dateRange;

    const wastageWhere = { ...whereBranch };
    if (startDate || endDate) wastageWhere.entryDate = dateRange;

    // PERFORMANCE: each section is a single SQL GROUP BY aggregate instead of
    // loading every row into JS (which was the dashboard's heaviest path —
    // getProfitLossReport runs 2× per dashboard load). Numbers below are
    // strings from SQLite; the parsers coerce back to floats.
    const num = (v) => parseFloat(v || 0) || 0;

    // 1. Sales Summary (one grouped query)
    const [saleAgg] = await Sale.findAll({
      where: saleWhere,
      attributes: [
        [sequelize.fn('SUM', sequelize.col('totalAmount')), 'totalSalesRevenue'],
        [sequelize.fn('SUM', sequelize.col('discountAmount')), 'totalSaleDiscounts'],
        [sequelize.fn('SUM', sequelize.col('agentCommissionAmount')), 'totalSaleCommissions'],
        [sequelize.fn('SUM', sequelize.col('totalCogs')), 'totalCogs']
      ],
      raw: true
    });
    const totalSalesRevenue = num(saleAgg?.totalSalesRevenue);
    const totalSaleDiscounts = num(saleAgg?.totalSaleDiscounts);
    const totalSaleCommissions = num(saleAgg?.totalSaleCommissions);
    const totalCogs = num(saleAgg?.totalCogs);

    const netSalesRevenue = parseFloat((totalSalesRevenue - totalSaleCommissions).toFixed(2));

    // 2. Weight Variance Losses from Purchases (one grouped query)
    const [purchaseAgg] = await Purchase.findAll({
      where: purchaseWhere,
      attributes: [
        [sequelize.fn('SUM', sequelize.col('totalAmount')), 'totalPurchasesAmount'],
        [sequelize.fn('SUM', sequelize.col('weightVarianceLossAmount')), 'totalWeightVarianceLoss'],
        [sequelize.fn('SUM', sequelize.col('freightCharges')), 'totalPurchaseFreight'],
        [sequelize.fn('SUM', sequelize.col('agentCommissionAmount')), 'totalPurchaseCommissions']
      ],
      raw: true
    });
    const totalPurchasesAmount = num(purchaseAgg?.totalPurchasesAmount);
    const totalWeightVarianceLoss = num(purchaseAgg?.totalWeightVarianceLoss);
    const totalPurchaseFreight = num(purchaseAgg?.totalPurchaseFreight);
    const totalPurchaseCommissions = num(purchaseAgg?.totalPurchaseCommissions);

    // 3. Fruit Spoilage / Wastage Losses (one grouped query)
    const [wastageAgg] = await WastageEntry.findAll({
      where: wastageWhere,
      attributes: [
        [sequelize.fn('SUM', sequelize.col('totalLossAmount')), 'totalWastageLoss'],
        [sequelize.fn('SUM', sequelize.col('salvageRecoveryAmount')), 'totalSalvageRecovery']
      ],
      raw: true
    });
    const totalWastageLoss = num(wastageAgg?.totalWastageLoss);
    const totalSalvageRecovery = num(wastageAgg?.totalSalvageRecovery);
    const netWastageLoss = parseFloat(Math.max(0, totalWastageLoss - totalSalvageRecovery).toFixed(2));

    // Gross Profit
    const grossProfit = parseFloat((netSalesRevenue - totalCogs - netWastageLoss - totalWeightVarianceLoss).toFixed(2));

    // 4. Operating Expenses breakdown (one grouped query by category)
    const expenseRows = await Expense.findAll({
      where: expenseWhere,
      attributes: [
        'category',
        [sequelize.fn('SUM', sequelize.col('amount')), 'total']
      ],
      group: ['category'],
      raw: true
    });
    let totalOperatingExpenses = 0;
    const expensesByCategory = {};
    for (const row of expenseRows) {
      const amt = num(row.total);
      totalOperatingExpenses += amt;
      expensesByCategory[row.category] = parseFloat(amt.toFixed(2));
    }

    // Net Profit
    const netProfit = parseFloat((grossProfit - totalOperatingExpenses).toFixed(2));

    return {
      period: { startDate: startDate || 'All Time', endDate: endDate || 'Current' },
      branchId: branchId || 'All Branches',
      revenue: {
        totalSalesRevenue: parseFloat(totalSalesRevenue.toFixed(2)),
        totalSaleCommissions: parseFloat(totalSaleCommissions.toFixed(2)),
        netSalesRevenue
      },
      directCosts: {
        costOfGoodsSold: parseFloat(totalCogs.toFixed(2)),
        weightVarianceLoss: parseFloat(totalWeightVarianceLoss.toFixed(2)),
        fruitWastageLoss: netWastageLoss,
        totalDirectCost: parseFloat((totalCogs + totalWeightVarianceLoss + netWastageLoss).toFixed(2))
      },
      grossProfit,
      grossProfitMarginPct: netSalesRevenue > 0 ? parseFloat(((grossProfit / netSalesRevenue) * 100).toFixed(2)) : 0,
      operatingExpenses: {
        total: parseFloat(totalOperatingExpenses.toFixed(2)),
        breakdown: expensesByCategory
      },
      netProfit,
      netProfitMarginPct: netSalesRevenue > 0 ? parseFloat(((netProfit / netSalesRevenue) * 100).toFixed(2)) : 0
    };
  }

  /**
   * Accounts Receivable & Payable Aging Schedule (0-7, 8-15, 16-30, 30+ days)
   */
  static async getAgingReport({ branchId, partyType = 'CUSTOMER' }) {
    const where = branchId ? { branchId } : {};
    const today = new Date();

    if (partyType === 'CUSTOMER') {
      // Pending sales invoices
      const pendingSales = await Sale.findAll({
        where: {
          ...where,
          paymentStatus: { [Op.in]: ['PENDING', 'PARTIAL'] }
        },
        include: [{ model: Customer, as: 'customer', attributes: ['id', 'name', 'phone', 'creditLimit'] }]
      });

      const agingBuckets = {
        '0-7': { label: '0–7 Days (Current)', total: 0, count: 0, items: [] },
        '8-15': { label: '8–15 Days', total: 0, count: 0, items: [] },
        '16-30': { label: '16–30 Days (Overdue)', total: 0, count: 0, items: [] },
        '30+': { label: '30+ Days (Critical Alert)', total: 0, count: 0, items: [] }
      };

      let grandTotalDue = 0;

      for (const sale of pendingSales) {
        const saleDate = new Date(sale.saleDate);
        const diffDays = Math.floor((today - saleDate) / (1000 * 60 * 60 * 24));
        const dueAmt = parseFloat(sale.dueAmount || 0);
        grandTotalDue += dueAmt;

        let bucket = '30+';
        if (diffDays <= 7) bucket = '0-7';
        else if (diffDays <= 15) bucket = '8-15';
        else if (diffDays <= 30) bucket = '16-30';

        agingBuckets[bucket].total = parseFloat((agingBuckets[bucket].total + dueAmt).toFixed(2));
        agingBuckets[bucket].count += 1;
        agingBuckets[bucket].items.push({
          id: sale.id,
          invoiceNumber: sale.invoiceNumber,
          saleDate: sale.saleDate,
          customerName: sale.customer ? sale.customer.name : 'Unknown',
          customerPhone: sale.customer ? sale.customer.phone : '',
          totalAmount: parseFloat(sale.totalAmount),
          paidAmount: parseFloat(sale.paidAmount),
          dueAmount: dueAmt,
          daysOverdue: diffDays
        });
      }

      return {
        partyType: 'CUSTOMER',
        grandTotalDue: parseFloat(grandTotalDue.toFixed(2)),
        buckets: agingBuckets
      };
    } else {
      // Pending purchase bills for suppliers
      const pendingPurchases = await Purchase.findAll({
        where: {
          ...where,
          paymentStatus: { [Op.in]: ['PENDING', 'PARTIAL'] }
        },
        include: [{ model: Supplier, as: 'supplier', attributes: ['id', 'name', 'phone'] }]
      });

      const agingBuckets = {
        '0-7': { label: '0–7 Days', total: 0, count: 0, items: [] },
        '8-15': { label: '8–15 Days', total: 0, count: 0, items: [] },
        '16-30': { label: '16–30 Days', total: 0, count: 0, items: [] },
        '30+': { label: '30+ Days', total: 0, count: 0, items: [] }
      };

      let grandTotalPayable = 0;

      for (const pur of pendingPurchases) {
        const purDate = new Date(pur.purchaseDate);
        const diffDays = Math.floor((today - purDate) / (1000 * 60 * 60 * 24));
        const dueAmt = parseFloat(pur.dueAmount || 0);
        grandTotalPayable += dueAmt;

        let bucket = '30+';
        if (diffDays <= 7) bucket = '0-7';
        else if (diffDays <= 15) bucket = '8-15';
        else if (diffDays <= 30) bucket = '16-30';

        agingBuckets[bucket].total = parseFloat((agingBuckets[bucket].total + dueAmt).toFixed(2));
        agingBuckets[bucket].count += 1;
        agingBuckets[bucket].items.push({
          id: pur.id,
          invoiceNumber: pur.invoiceNumber,
          purchaseDate: pur.purchaseDate,
          supplierName: pur.supplier ? pur.supplier.name : 'Unknown',
          supplierPhone: pur.supplier ? pur.supplier.phone : '',
          totalAmount: parseFloat(pur.totalAmount),
          paidAmount: parseFloat(pur.paidAmount),
          dueAmount: dueAmt,
          daysOverdue: diffDays
        });
      }

      return {
        partyType: 'SUPPLIER',
        grandTotalDue: parseFloat(grandTotalPayable.toFixed(2)),
        buckets: agingBuckets
      };
    }
  }

  /**
   * Current Stock Valuation & Batch Aging
   */
  static async getInventoryReport({ branchId }) {
    const where = { status: 'ACTIVE', currentQuantity: { [Op.gt]: 0 } };
    if (branchId) where.branchId = branchId;

    const batches = await StockBatch.findAll({
      where,
      include: [
        { model: Item, as: 'item' },
        { model: Branch, as: 'branch', attributes: ['id', 'name', 'code'] }
      ],
      order: [['receivedDate', 'ASC']]
    });

    let totalQuantityKg = 0;
    let totalValuation = 0;
    const itemsMap = {};
    const today = new Date();

    for (const b of batches) {
      const qty = parseFloat(b.currentQuantity);
      const landedCost = parseFloat(b.landedCostPerUnit);
      const val = parseFloat((qty * landedCost).toFixed(2));
      totalQuantityKg += qty;
      totalValuation += val;

      const recDate = new Date(b.receivedDate);
      const ageDays = Math.floor((today - recDate) / (1000 * 60 * 60 * 24));

      if (!itemsMap[b.itemId]) {
        itemsMap[b.itemId] = {
          itemId: b.itemId,
          name: b.item ? b.item.name : 'Unknown',
          variety: b.item ? b.item.variety : '',
          reorderThreshold: b.item ? parseFloat(b.item.reorderThreshold) : 100,
          shelfLifeDays: b.item ? b.item.shelfLifeDays : 14,
          totalStockKg: 0,
          totalValuation: 0,
          batches: []
        };
      }

      itemsMap[b.itemId].totalStockKg = parseFloat((itemsMap[b.itemId].totalStockKg + qty).toFixed(2));
      itemsMap[b.itemId].totalValuation = parseFloat((itemsMap[b.itemId].totalValuation + val).toFixed(2));
      itemsMap[b.itemId].batches.push({
        id: b.id,
        batchNumber: b.batchNumber,
        branchName: b.branch ? b.branch.name : '',
        currentQuantityKg: qty,
        landedCostPerKg: landedCost,
        valuation: val,
        receivedDate: b.receivedDate,
        expiryDate: b.expiryDate,
        ageDays,
        isNearExpiry: ageDays > ((b.item?.shelfLifeDays || 14) - 3)
      });
    }

    return {
      totalQuantityKg: parseFloat(totalQuantityKg.toFixed(2)),
      totalValuation: parseFloat(totalValuation.toFixed(2)),
      itemBreakdown: Object.values(itemsMap)
    };
  }
}

module.exports = ReportService;
