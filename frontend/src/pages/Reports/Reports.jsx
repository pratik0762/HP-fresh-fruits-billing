import React, { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import { useBranch } from '../../context/BranchContext';
import StatCard from '../../components/Common/StatCard';
import DateRangeFilter from '../../components/Common/DateRangeFilter';
import { useToast } from '../../components/Common/Toast';
import { exportToExcel, getPresetRange } from '../../utils/excelExport';
import { BarChart3, TrendingUp, TrendingDown, Boxes, Crown, Download, RefreshCw } from 'lucide-react';

const Reports = () => {
  const { activeBranchId } = useBranch();
  const toast = useToast();
  const [dateRange, setDateRange] = useState(getPresetRange('thisMonth'));
  const rangeRef = useRef(dateRange);
  const [pnl, setPnl] = useState(null);
  const [inventory, setInventory] = useState(null);
  const [topCustomers, setTopCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchReports = async (range = rangeRef.current) => {
    try {
      setLoading(true);
      setError('');
      const qs = range.start && range.end
        ? `startDate=${range.start}&endDate=${range.end}`
        : '';
      const [pnlRes, invRes, topRes] = await Promise.all([
        api.getCached(`/reports/profit-loss?${qs}`, null, { maxAge: 15_000 }),
        api.getCached('/reports/inventory-valuation', null, { maxAge: 15_000 }),
        api.getCached('/reports/top-performers', null, { maxAge: 15_000 })
      ]);
      if (pnlRes?.data?.success) setPnl(pnlRes.data.report);
      if (invRes?.data?.success) setInventory(invRes.data.report);
      if (topRes?.data?.success) setTopCustomers(topRes.data.topCustomers || []);
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to load reports';
      setError(msg);
      toast.error('Could not load reports: ' + msg);
      console.error('Reports error', err);
    } finally {
      setLoading(false);
    }
  };

  const handleRangeChange = (range) => {
    rangeRef.current = range;
    setDateRange(range);
    fetchReports(range);
  };

  useEffect(() => {
    fetchReports();
  }, [activeBranchId]);

  const handleExportExcel = () => {
    const label = dateRange.label || 'Custom';
    const sheets = [];

    if (pnl) {
      sheets.push({
        name: 'Profit & Loss',
        rows: [
          { Item: `Period: ${label} (${dateRange.start || 'start'} to ${dateRange.end || 'today'})`, Amount: '' },
          { Item: 'Gross Sales', Amount: pnl.revenue.totalSalesRevenue },
          { Item: 'Sale Commissions', Amount: -pnl.revenue.totalSaleCommissions },
          { Item: 'NET SALES REVENUE', Amount: pnl.revenue.netSalesRevenue },
          { Item: 'FIFO Cost of Goods Sold', Amount: -pnl.directCosts.costOfGoodsSold },
          { Item: 'Weight Variance Loss', Amount: -pnl.directCosts.weightVarianceLoss },
          { Item: 'Fruit Spoilage Loss (net)', Amount: -pnl.directCosts.fruitWastageLoss },
          { Item: 'GROSS PROFIT', Amount: pnl.grossProfit },
          ...Object.entries(pnl.operatingExpenses.breakdown || {}).map(([cat, amt]) => ({
            Item: `Overhead: ${cat.replace(/_/g, ' ')}`, Amount: -amt
          })),
          { Item: 'Total Operating Overheads', Amount: -pnl.operatingExpenses.total },
          { Item: 'NET PROFIT', Amount: pnl.netProfit }
        ]
      });
    }

    if (inventory) {
      const invRows = [];
      for (const itm of inventory.itemBreakdown || []) {
        for (const b of itm.batches || []) {
          invRows.push({
            Item: `${itm.name}${itm.variety ? ` (${itm.variety})` : ''}`,
            Batch: b.batchNumber,
            Branch: b.branchName,
            'Qty (kg)': b.currentQuantityKg,
            'Cost/kg': b.landedCostPerKg,
            Valuation: b.valuation,
            'Received Date': b.receivedDate,
            'Expiry Date': b.expiryDate || '',
            'Near Expiry': b.isNearExpiry ? 'YES' : ''
          });
        }
      }
      sheets.push({ name: 'Inventory Valuation', rows: invRows });
    }

    sheets.push({
      name: 'Top Customers',
      rows: topCustomers.map((c, i) => ({
        Rank: i + 1,
        Customer: c.name,
        Phone: c.phone,
        'Total Sales': c.totalSales,
        Invoices: c.invoicesCount
      }))
    });

    exportToExcel(sheets, `reports_${label.replace(/\s+/g, '-').replace(/[/]/g, '')}`);
  };

  const fmt = (n) => `₹${parseFloat(n || 0).toLocaleString('en-IN')}`;

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <RefreshCw className="w-8 h-8 animate-spin text-brand-500 mb-2" />
        <p className="text-sm font-medium">Generating financial reports...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <BarChart3 className="w-6 h-6 text-brand-600" />
            Reports & Profitability Analytics
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Fruit-trading P&L formula: Net Sales − Landed COGS − Spoilage/Transit Losses − Operating Overheads.
          </p>
        </div>

        <div className="flex flex-col xl:flex-row items-stretch xl:items-center gap-2">
          <DateRangeFilter
            initialPreset="thisMonth"
            loading={loading}
            onChange={handleRangeChange}
          />
          <button
            onClick={handleExportExcel}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-sm whitespace-nowrap"
            title="Download all reports as Excel"
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
          {error}
        </div>
      )}

      {pnl && (
        <>
          {/* P&L Summary Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              title="Net Sales Revenue"
              value={fmt(pnl.revenue.netSalesRevenue)}
              subtitle={`Gross: ${fmt(pnl.revenue.totalSalesRevenue)}`}
              icon={TrendingUp}
              color="emerald"
            />
            <StatCard
              title="Landed COGS"
              value={fmt(pnl.directCosts.costOfGoodsSold)}
              subtitle="FIFO batch landed costs"
              icon={TrendingDown}
              color="rose"
            />
            <StatCard
              title="Gross Profit"
              value={fmt(pnl.grossProfit)}
              subtitle={`${pnl.grossProfitMarginPct}% gross margin`}
              icon={TrendingUp}
              color="blue"
            />
            <StatCard
              title="Net Profit"
              value={fmt(pnl.netProfit)}
              subtitle={`${pnl.netProfitMarginPct}% net margin after overheads`}
              icon={Crown}
              color="purple"
            />
          </div>

          {/* P&L Statement Breakdown */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
              <h3 className="text-sm font-bold text-slate-900 mb-4">Profit & Loss Statement</h3>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between font-bold text-slate-800 pb-2 border-b border-slate-100">
                  <span>Revenue</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="pl-3">Gross Sales</span>
                  <span className="font-mono">{fmt(pnl.revenue.totalSalesRevenue)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="pl-3">(−) Sale Commissions</span>
                  <span className="font-mono text-rose-600">−{fmt(pnl.revenue.totalSaleCommissions)}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-100">
                  <span>Net Sales Revenue</span>
                  <span className="font-mono">{fmt(pnl.revenue.netSalesRevenue)}</span>
                </div>

                <div className="flex justify-between font-bold text-slate-800 pt-3 pb-2 border-b border-slate-100">
                  <span>Direct Costs</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="pl-3">FIFO Cost of Goods Sold</span>
                  <span className="font-mono text-rose-600">−{fmt(pnl.directCosts.costOfGoodsSold)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="pl-3">Weight Variance Loss</span>
                  <span className="font-mono text-rose-600">−{fmt(pnl.directCosts.weightVarianceLoss)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span className="pl-3">Fruit Spoilage Loss (net)</span>
                  <span className="font-mono text-rose-600">−{fmt(pnl.directCosts.fruitWastageLoss)}</span>
                </div>
                <div className="flex justify-between font-bold text-slate-900 pt-1 border-t border-slate-100">
                  <span>Gross Profit</span>
                  <span className={`font-mono ${pnl.grossProfit >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {fmt(pnl.grossProfit)}
                  </span>
                </div>

                <div className="flex justify-between font-bold text-slate-800 pt-3 pb-2 border-b border-slate-100">
                  <span>Operating Overheads</span>
                </div>
                {Object.entries(pnl.operatingExpenses.breakdown || {}).map(([cat, amt]) => (
                  <div key={cat} className="flex justify-between text-slate-600">
                    <span className="pl-3">{cat.replace(/_/g, ' ')}</span>
                    <span className="font-mono text-rose-600">−{fmt(amt)}</span>
                  </div>
                ))}
                <div className="flex justify-between text-slate-800 font-bold pt-1 border-t border-slate-100">
                  <span>Total Overheads</span>
                  <span className="font-mono">−{fmt(pnl.operatingExpenses.total)}</span>
                </div>

                <div className={`flex justify-between font-black text-base pt-3 mt-2 border-t-2 border-slate-300 ${pnl.netProfit >= 0 ? 'text-emerald-800' : 'text-rose-800'}`}>
                  <span>NET PROFIT</span>
                  <span className="font-mono">{fmt(pnl.netProfit)}</span>
                </div>
              </div>
            </div>

            {/* Inventory Valuation */}
            {inventory && (
              <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-slate-900">Inventory Valuation</h3>
                  <Boxes className="w-5 h-5 text-brand-600" />
                </div>

                <div className="p-4 bg-brand-50/60 rounded-xl border border-brand-100 text-center mb-4">
                  <span className="text-xs font-semibold text-brand-800 uppercase tracking-wider">Total Stock Value</span>
                  <div className="text-3xl font-extrabold text-brand-900 mt-1">{fmt(inventory.totalValuation)}</div>
                  <span className="text-xs text-brand-700 font-medium mt-1 block">
                    {inventory.totalQuantityKg.toLocaleString('en-IN')} kg on hand
                  </span>
                </div>

                <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                  {inventory.itemBreakdown.map(itm => (
                    <div key={itm.itemId} className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                      <div className="flex justify-between items-start">
                        <div>
                          <span className="font-bold text-xs text-slate-900 block">{itm.name}</span>
                          <span className="text-[10px] text-slate-500">{itm.variety || 'Standard'}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-mono font-bold text-xs text-slate-900 block">
                            {itm.totalStockKg.toLocaleString('en-IN')} kg
                          </span>
                          <span className="font-mono text-[11px] text-brand-700">{fmt(itm.totalValuation)}</span>
                        </div>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {itm.batches.slice(0, 4).map(b => (
                          <span
                            key={b.id}
                            className={`text-[10px] px-1.5 py-0.5 rounded font-mono border ${
                              b.isNearExpiry
                                ? 'bg-rose-50 text-rose-700 border-rose-200'
                                : 'bg-white text-slate-500 border-slate-200'
                            }`}
                          >
                            {b.batchNumber.split('-').slice(0, 3).join('-')} • {b.currentQuantityKg}kg
                          </span>
                        ))}
                        {itm.batches.length > 4 && (
                          <span className="text-[10px] text-slate-400 px-1">+{itm.batches.length - 4} more</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Top Customers */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
            <div className="flex items-center gap-2 mb-4">
              <Crown className="w-5 h-5 text-amber-500" />
              <h3 className="text-sm font-bold text-slate-900">Top 10 Customers by Sales Volume</h3>
            </div>

            {topCustomers.length === 0 ? (
              <p className="text-xs text-slate-400 text-center py-6">No sales data for this period.</p>
            ) : (
              <div className="space-y-2">
                {topCustomers.map((c, idx) => {
                  const maxVal = topCustomers[0].totalSales || 1;
                  return (
                    <div key={c.id} className="flex items-center gap-3">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black shrink-0 ${
                        idx === 0 ? 'bg-amber-100 text-amber-800' : idx < 3 ? 'bg-slate-200 text-slate-700' : 'bg-slate-100 text-slate-500'
                      }`}>
                        {idx + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <div className="flex justify-between items-baseline mb-1">
                          <span className="text-xs font-bold text-slate-800 truncate">{c.name}</span>
                          <span className="text-xs font-mono font-bold text-slate-900 shrink-0 ml-2">
                            {fmt(c.totalSales)}
                            <span className="text-[10px] text-slate-400 font-normal ml-1">({c.invoicesCount} inv.)</span>
                          </span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-brand-500 to-brand-600 rounded-full"
                            style={{ width: `${(c.totalSales / maxVal) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
};

export default Reports;
