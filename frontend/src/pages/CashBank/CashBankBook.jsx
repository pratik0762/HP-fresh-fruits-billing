import React, { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import { useBranch } from '../../context/BranchContext';
import DateRangeFilter from '../../components/Common/DateRangeFilter';
import { useToast } from '../../components/Common/Toast';
import { exportToExcel, getPresetRange } from '../../utils/excelExport';
import { Wallet, Landmark, ArrowDownLeft, ArrowUpRight, Download } from 'lucide-react';

const CashBankBook = () => {
  const { activeBranchId } = useBranch();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('cash'); // 'cash' or 'bank'
  const [bookData, setBookData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [dateRange, setDateRange] = useState(getPresetRange('all'));
  const rangeRef = useRef(dateRange);

  const fetchBook = async (range = rangeRef.current) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (range.start) params.append('startDate', range.start);
      if (range.end) params.append('endDate', range.end);

      const endpoint = activeTab === 'cash' ? '/cash-bank/cash-book' : '/cash-bank/bank-book';
      await api.getCached(`${endpoint}?${params.toString()}`, (res) => {
        if (res?.data?.success) setBookData(res.data);
      }, { maxAge: 15_000 });
    } catch (err) {
      console.error('Failed to load cash/bank book', err);
      toast.error('Could not load the book. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const handleRangeChange = (range) => {
    rangeRef.current = range;
    setDateRange(range);
    fetchBook(range);
  };

  // Switching tabs must drop the previous book's rows immediately — otherwise
  // cash rows render against bank keys (runningBankBalance etc.) during the
  // fetch and the page crashes with a blank white screen.
  const switchTab = (tab) => {
    if (tab === activeTab) return;
    setBookData(null);
    setActiveTab(tab);
  };

  useEffect(() => {
    fetchBook();
  }, [activeTab, activeBranchId]);

  const handleExportExcel = () => {
    const rows = entries.map(e => ({
      Date: e.date,
      Time: e.time,
      'Voucher #': e.transactionNumber,
      Type: e.type,
      Branch: e.branchName || '',
      Party: e.partyName || '',
      Reference: e.referenceNumber || '',
      [isCash ? 'Cash In' : 'Deposit']: e[inflowKey],
      [isCash ? 'Cash Out' : 'Withdrawal']: e[outflowKey],
      Balance: e[balanceKey],
      Notes: e.notes || ''
    }));
    exportToExcel([{ name: isCash ? 'Cash Book' : 'Bank Book', rows }],
      `${isCash ? 'cash-book' : 'bank-book'}_${dateRange.label.replace(/\s+/g, '-')}`);
  };

  const isCash = activeTab === 'cash';
  const entries = bookData?.entries || [];
  const currentBalance = isCash ? bookData?.currentCashOnHand : bookData?.currentBankBalance;

  const inflowKey = isCash ? 'cashIn' : 'bankDeposit';
  const outflowKey = isCash ? 'cashOut' : 'bankWithdrawal';
  const balanceKey = isCash ? 'runningCashBalance' : 'runningBankBalance';

  const totalInflow = entries.reduce((acc, e) => acc + (parseFloat(e[inflowKey]) || 0), 0);
  const totalOutflow = entries.reduce((acc, e) => acc + (parseFloat(e[outflowKey]) || 0), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Wallet className="w-6 h-6 text-brand-600" />
            Cash & Bank Books
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Day-book of physical cash chest movements and bank account transactions from the ledger.
          </p>
        </div>

        <div className="flex flex-col xl:flex-row items-stretch xl:items-center gap-2">
          <DateRangeFilter initialPreset="all" loading={loading} onChange={handleRangeChange} />
          <button
            onClick={handleExportExcel}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-sm whitespace-nowrap"
            title="Download book as Excel"
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => switchTab('cash')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition ${
            isCash ? 'bg-emerald-600 text-white shadow-sm' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'
          }`}
        >
          💵 Cash Book
        </button>
        <button
          onClick={() => switchTab('bank')}
          className={`px-4 py-2 rounded-lg text-xs font-bold transition ${
            !isCash ? 'bg-sky-600 text-white shadow-sm' : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'
          }`}
        >
          🏦 Bank Book
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className={`p-5 rounded-xl border shadow-sm ${isCash ? 'bg-emerald-50/60 border-emerald-200' : 'bg-sky-50/60 border-sky-200'}`}>
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 block">
            {isCash ? 'Current Cash on Hand' : 'Current Bank Balance'}
          </span>
          <div className="text-3xl font-black font-mono text-slate-900 mt-1">
            ₹{parseFloat(currentBalance || 0).toLocaleString('en-IN')}
          </div>
        </div>
        <div className="p-5 rounded-xl border border-emerald-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 text-emerald-700">
            <ArrowDownLeft className="w-4 h-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Inflow (Period)</span>
          </div>
          <div className="text-2xl font-bold font-mono text-emerald-800 mt-1">
            ₹{totalInflow.toLocaleString('en-IN')}
          </div>
        </div>
        <div className="p-5 rounded-xl border border-rose-200 bg-white shadow-sm">
          <div className="flex items-center gap-2 text-rose-700">
            <ArrowUpRight className="w-4 h-4" />
            <span className="text-[11px] font-bold uppercase tracking-wider">Total Outflow (Period)</span>
          </div>
          <div className="text-2xl font-bold font-mono text-rose-800 mt-1">
            ₹{totalOutflow.toLocaleString('en-IN')}
          </div>
        </div>
      </div>

      {/* Book Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider border-b border-slate-200">
                <th className="p-3">Date / Time</th>
                <th className="p-3">Voucher #</th>
                <th className="p-3">Type</th>
                <th className="p-3">Branch</th>
                <th className="p-3">Party</th>
                <th className="p-3">Reference</th>
                <th className="p-3 text-right">{isCash ? 'Cash In' : 'Deposit'}</th>
                <th className="p-3 text-right">{isCash ? 'Cash Out' : 'Withdrawal'}</th>
                <th className="p-3 text-right">Balance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {loading ? (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400">Loading ledger entries...</td>
                </tr>
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="text-center py-10 text-slate-400">
                    No {isCash ? 'cash' : 'bank'} transactions found for this period.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={e.id} className="hover:bg-slate-50">
                    <td className="p-3">
                      <span className="block text-slate-700">{e.date}</span>
                      <span className="text-[10px] text-slate-400">{e.time}</span>
                    </td>
                    <td className="p-3 font-mono font-bold text-brand-700">{e.transactionNumber}</td>
                    <td className="p-3 text-slate-600">{e.type?.replace(/_/g, ' ')}</td>
                    <td className="p-3 text-slate-600">{e.branchName || '—'}</td>
                    <td className="p-3 font-medium text-slate-800">{e.partyName || 'Internal'}</td>
                    <td className="p-3 font-mono text-[11px] text-slate-500">{e.referenceNumber || '—'}</td>
                    <td className="p-3 text-right font-mono text-emerald-700 font-semibold">
                      {parseFloat(e[inflowKey] || 0) > 0 ? `₹${parseFloat(e[inflowKey]).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="p-3 text-right font-mono text-rose-700 font-semibold">
                      {parseFloat(e[outflowKey] || 0) > 0 ? `₹${parseFloat(e[outflowKey]).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="p-3 text-right font-mono font-bold text-slate-900">
                      ₹{parseFloat(e[balanceKey] || 0).toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default CashBankBook;
