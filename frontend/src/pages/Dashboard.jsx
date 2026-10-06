import React, { useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useBranch } from '../context/BranchContext';
import StatCard from '../components/Common/StatCard';
import { useToast } from '../components/Common/Toast';
import { 
  ShoppingBag, ShoppingCart, TrendingUp, Boxes, 
  Wallet, Landmark, ArrowUpRight, ArrowDownLeft, 
  AlertTriangle, Clock, Calendar, RefreshCw
} from 'lucide-react';
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis, 
  Tooltip, CartesianGrid, Legend, BarChart, Bar
} from 'recharts';

const Dashboard = () => {
  const { user, isOwner } = useAuth();
  const { activeBranchId, activeBranch } = useBranch();
  const toast = useToast();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchStats = async () => {
    try {
      setRefreshing(true);
      // Instant paint from cache on repeat visits; fresh data swaps in silently.
      await api.getCached('/dashboard/stats', (res) => {
        if (res?.data?.success) setStats(res.data);
      }, { maxAge: 15_000 });
    } catch (err) {
      console.error('Failed to load dashboard stats', err);
      toast.error('Could not load dashboard. Please refresh the page.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStats();
  }, [activeBranchId]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <RefreshCw className="w-8 h-8 animate-spin text-brand-500 mb-2" />
        <p className="text-sm font-medium">Aggregating real-time ledger metrics...</p>
      </div>
    );
  }

  const { today = {}, monthToDate = {}, totals = {}, trendData = [], alerts = {} } = stats || {};

  return (
    <div className="space-y-6 pb-12">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4 bg-gradient-to-r from-slate-900 to-slate-800 p-4 sm:p-6 rounded-2xl text-white shadow-sm">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">🍏</span>
            <h1 className="text-xl font-bold tracking-tight">
              {activeBranch ? `${activeBranch.name} Dashboard` : 'Consolidated Multi-Branch Dashboard'}
            </h1>
          </div>
          <p className="text-xs text-slate-300 mt-1">
            Real-time figures synchronized transactionally with the append-only ledger.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={fetchStats}
            disabled={refreshing}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700/60 hover:bg-slate-700 text-slate-200 rounded-lg text-xs font-semibold transition border border-slate-600"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />
            {refreshing ? 'Syncing...' : 'Sync Ledger'}
          </button>
        </div>
      </div>

      {/* Row 1: Daily Figures */}
      <div>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          Today's Operations ({new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })})
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Today's Sales"
            value={`₹${today.saleTotal?.toLocaleString('en-IN') || 0}`}
            subtitle="Dispatched invoices"
            icon={ShoppingCart}
            color="emerald"
          />
          <StatCard
            title="Today's Purchases"
            value={`₹${today.purchaseTotal?.toLocaleString('en-IN') || 0}`}
            subtitle="Mandi & grower arrivals"
            icon={ShoppingBag}
            color="blue"
          />
          <StatCard
            title="Today's Gross Profit"
            value={`₹${today.grossProfit?.toLocaleString('en-IN') || 0}`}
            subtitle="After FIFO COGS, wastage & weight loss"
            icon={TrendingUp}
            color="amber"
          />
          <StatCard
            title="Month Net Margin"
            value={`₹${monthToDate.netProfit?.toLocaleString('en-IN') || 0}`}
            subtitle={`${monthToDate.profitMarginPct || 0}% net fruit profit margin`}
            icon={Landmark}
            color="purple"
          />
        </div>
      </div>

      {/* Row 2: Financial Assets & Balances */}
      <div>
        <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
          Ledger Assets & Working Capital
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            title="Cash on Hand"
            value={`₹${totals.cashOnHand?.toLocaleString('en-IN') || 0}`}
            subtitle="Verified Mandi cash chest"
            icon={Wallet}
            color="emerald"
          />
          <StatCard
            title="Bank Balance"
            value={`₹${totals.bankBalance?.toLocaleString('en-IN') || 0}`}
            subtitle="HDFC / Current accounts"
            icon={Landmark}
            color="blue"
          />
          <StatCard
            title="Pending Receivables"
            value={`₹${totals.pendingReceivables?.toLocaleString('en-IN') || 0}`}
            subtitle="Unpaid customer dues"
            icon={ArrowDownLeft}
            color="rose"
          />
          <StatCard
            title="Pending Payables"
            value={`₹${totals.pendingPayables?.toLocaleString('en-IN') || 0}`}
            subtitle="Owed to growers & suppliers"
            icon={ArrowUpRight}
            color="amber"
          />
        </div>
      </div>

      {/* Row 3: Stock Status & Trend Chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Sales & Profit Chart */}
        <div className="lg:col-span-2 bg-white p-6 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-bold text-slate-900">14-Day Sales & Gross Profit Trend</h3>
              <p className="text-xs text-slate-500">Comparing gross billings against FIFO fruit margin</p>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="flex items-center gap-1.5 text-slate-600 font-medium">
                <span className="w-3 h-3 rounded-sm bg-emerald-500 inline-block"></span> Sales
              </span>
              <span className="flex items-center gap-1.5 text-slate-600 font-medium">
                <span className="w-3 h-3 rounded-sm bg-sky-500 inline-block"></span> Profit
              </span>
            </div>
          </div>

          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trendData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorSales" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorProfit" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0284c7" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#0284c7" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="date" stroke="#94a3b8" fontSize={11} />
                <YAxis stroke="#94a3b8" fontSize={11} tickFormatter={(v) => `₹${v/1000}k`} />
                <Tooltip 
                  formatter={(value) => [`₹${value.toLocaleString('en-IN')}`, '']}
                  contentStyle={{ backgroundColor: '#0f172a', borderColor: '#334155', borderRadius: '8px', color: '#fff', fontSize: '12px' }}
                />
                <Area type="monotone" dataKey="sales" name="Sales" stroke="#10b981" strokeWidth={2} fillOpacity={1} fill="url(#colorSales)" />
                <Area type="monotone" dataKey="profit" name="Gross Profit" stroke="#0284c7" strokeWidth={2} fillOpacity={1} fill="url(#colorProfit)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Live Stock Summary */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-slate-900">Current Stock Valuation</h3>
              <Boxes className="w-5 h-5 text-brand-600" />
            </div>

            <div className="p-4 bg-brand-50/60 rounded-xl border border-brand-100 text-center mb-6">
              <span className="text-xs font-semibold text-brand-800 uppercase tracking-wider">Total Inventory Value</span>
              <div className="text-3xl font-extrabold text-brand-900 mt-1">
                ₹{totals.totalStockValuation?.toLocaleString('en-IN') || 0}
              </div>
              <span className="text-xs text-brand-700 font-medium mt-1 block">
                Across {totals.totalStockKg?.toLocaleString('en-IN') || 0} kg net fruit stock
              </span>
            </div>

            <div className="space-y-3 text-xs">
              <div className="flex justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-slate-600 font-medium">Month to Date COGS:</span>
                <span className="font-bold text-slate-900">₹{monthToDate.cogs?.toLocaleString('en-IN') || 0}</span>
              </div>
              <div className="flex justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-slate-600 font-medium">Transit & Spoilage Losses:</span>
                <span className="font-bold text-rose-600">₹{monthToDate.losses?.toLocaleString('en-IN') || 0}</span>
              </div>
              <div className="flex justify-between p-2 rounded-lg bg-slate-50 border border-slate-100">
                <span className="text-slate-600 font-medium">Operating Overheads:</span>
                <span className="font-bold text-slate-900">₹{monthToDate.operatingExpenses?.toLocaleString('en-IN') || 0}</span>
              </div>
            </div>
          </div>

          <div className="mt-6 pt-4 border-t border-slate-100 text-[11px] text-slate-400 text-center">
            FIFO Lot Costing Engine Active
          </div>
        </div>
      </div>

      {/* Row 4: Urgent Alerts Section (Low Stock, Near Expiry, Overdue Receivables) */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Low Stock Alerts */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle className="w-4 h-4 text-amber-500" />
            <h3 className="text-sm font-bold text-slate-900">Low Stock Reorder Alerts</h3>
          </div>
          {alerts.lowStock?.length > 0 ? (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {alerts.lowStock.map((item, idx) => (
                <div key={idx} className="p-2.5 rounded-lg bg-amber-50/70 border border-amber-200 text-xs flex justify-between items-center">
                  <div>
                    <span className="font-bold text-slate-900 block">{item.name}</span>
                    <span className="text-[10px] text-amber-800">{item.variety || 'Standard'}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-rose-700 block">{item.currentStockKg} {item.unit}</span>
                    <span className="text-[10px] text-slate-500">Min: {item.reorderThreshold}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 py-6 text-center">All fruit stock levels above reorder threshold.</p>
          )}
        </div>

        {/* Near Expiry Batches */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Clock className="w-4 h-4 text-rose-500" />
            <h3 className="text-sm font-bold text-slate-900">Perishable Shelf-Life Alerts</h3>
          </div>
          {alerts.nearExpiry?.length > 0 ? (
            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {alerts.nearExpiry.map((batch, idx) => (
                <div key={idx} className="p-2.5 rounded-lg bg-rose-50/70 border border-rose-200 text-xs flex justify-between items-center">
                  <div>
                    <span className="font-bold text-slate-900 block">{batch.itemName}</span>
                    <span className="text-[10px] font-mono text-slate-500">{batch.batchNumber}</span>
                  </div>
                  <div className="text-right">
                    <span className="font-bold text-rose-700 block">{batch.currentQuantityKg} kg</span>
                    <span className="text-[10px] text-rose-600 font-semibold">{batch.daysLeft} days left</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-slate-400 py-6 text-center">No batches near expiration.</p>
          )}
        </div>

        {/* Overdue Payment Aging */}
        <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-sky-500" />
            <h3 className="text-sm font-bold text-slate-900">Receivable Aging Buckets</h3>
          </div>
          <div className="space-y-2 text-xs">
            {alerts.overduePayments && Object.entries(alerts.overduePayments).map(([key, bucket]) => (
              <div key={key} className="flex items-center justify-between p-2 rounded-lg bg-slate-50 border border-slate-200">
                <span className="font-medium text-slate-700">{bucket.label}</span>
                <div className="text-right">
                  <span className="font-bold text-slate-900 block font-mono">₹{bucket.total.toLocaleString('en-IN')}</span>
                  <span className="text-[10px] text-slate-500">{bucket.count} invoices</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
