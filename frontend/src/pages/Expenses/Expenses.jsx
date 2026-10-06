import React, { useState, useEffect, useRef } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useBranch } from '../../context/BranchContext';
import DataTable from '../../components/Common/DataTable';
import Modal from '../../components/Common/Modal';
import DateRangeFilter from '../../components/Common/DateRangeFilter';
import { useToast } from '../../components/Common/Toast';
import { exportToExcel, getPresetRange } from '../../utils/excelExport';
import { Receipt, Plus, AlertCircle, IndianRupee, Download } from 'lucide-react';

const EXPENSE_CATEGORIES = [
  'RENT',
  'ELECTRICITY'
];

const Expenses = () => {
  const { isOwner, user } = useAuth();
  const { activeBranchId } = useBranch();
  const toast = useToast();
  const [expenses, setExpenses] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);

  const [isOpen, setIsOpen] = useState(false);
  // Branch users are always locked to their own branch; owner picks any
  // branch, defaulting to the one active in the navbar (or the first).
  const defaultBranchId = () => {
    if (!isOwner && user?.branchId) return String(user.branchId);
    if (activeBranchId && activeBranchId !== 'all') return activeBranchId;
    return '';
  };

  const [form, setForm] = useState({
    branchId: defaultBranchId(),
    category: 'RENT',
    amount: '',
    paymentMode: 'CASH',
    paidTo: '',
    description: '',
    receiptNo: '',
    expenseDate: new Date().toISOString().split('T')[0]
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [dateRange, setDateRange] = useState(getPresetRange('thisMonth'));
  const rangeRef = useRef(dateRange);

  const fetchExpenses = async (range = rangeRef.current) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (range.start && range.end) {
        params.append('startDate', range.start);
        params.append('endDate', range.end);
      }
      const [expRes, brRes] = await Promise.all([
        api.getCached(`/expenses?${params.toString()}`, null, { maxAge: 10_000 }),
        api.getCached('/masters/branches', null, { maxAge: 60_000 })
      ]);
      if (expRes?.data?.success) setExpenses(expRes.data.expenses);
      if (brRes?.data?.success) setBranches(brRes.data.branches);
    } catch (err) {
      console.error('Failed to load expenses', err);
      toast.error('Could not load expenses. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const handleRangeChange = (range) => {
    rangeRef.current = range;
    setDateRange(range);
    fetchExpenses(range);
  };

  useEffect(() => {
    fetchExpenses();
  }, []);

  const handleExportExcel = () => {
    const rows = expenses.map(x => ({
      'Expense #': x.expenseNumber,
      Date: x.expenseDate,
      Category: x.category,
      'Paid To': x.paidTo,
      Description: x.description,
      Branch: x.branch?.name || '',
      Amount: x.amount,
      Mode: x.paymentMode,
      'Receipt #': x.receiptNo || ''
    }));
    const byCat = {};
    expenses.forEach(x => { byCat[x.category] = (byCat[x.category] || 0) + parseFloat(x.amount || 0); });
    exportToExcel([
      { name: 'Expenses', rows },
      { name: 'By Category', rows: Object.entries(byCat).map(([cat, amt]) => ({ Category: cat, Total: amt })) }
    ], `expenses_${dateRange.label.replace(/\s+/g, '-')}`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await api.post('/expenses', {
        branchId: parseInt(form.branchId),
        category: form.category,
        amount: parseFloat(form.amount),
        paymentMode: form.paymentMode,
        paidTo: form.paidTo,
        description: form.description,
        receiptNo: form.receiptNo,
        expenseDate: form.expenseDate
      });
      if (res.data.success) {
        toast.success('Expense recorded successfully');
        setIsOpen(false);
        fetchExpenses();
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to record expense';
      setError(msg);
      toast.error('Could not record expense: ' + msg);
    } finally {
      setSubmitting(false);
    }
  };

  const totalExpenses = expenses.reduce((acc, ex) => acc + (parseFloat(ex.amount) || 0), 0);

  const columns = [
    {
      header: 'Expense #',
      accessor: 'expenseNumber',
      render: (row) => <span className="font-mono font-bold text-brand-700 text-xs">{row.expenseNumber}</span>
    },
    {
      header: 'Date',
      accessor: 'expenseDate',
      render: (row) => <span className="text-xs text-slate-500">{row.expenseDate}</span>
    },
    {
      header: 'Branch',
      accessor: 'branch',
      render: (row) => <span className="text-xs text-slate-700">{row.branch?.name}</span>
    },
    {
      header: 'Category',
      accessor: 'category',
      render: (row) => (
        <span className="text-xs font-semibold text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
          {row.category.replace(/_/g, ' ')}
        </span>
      )
    },
    {
      header: 'Paid To',
      accessor: 'paidTo',
      render: (row) => <span className="text-xs font-medium text-slate-800">{row.paidTo}</span>
    },
    {
      header: 'Description',
      accessor: 'description',
      render: (row) => <span className="text-xs text-slate-500 truncate max-w-xs block">{row.description || '—'}</span>
    },
    {
      header: 'Mode',
      accessor: 'paymentMode',
      render: (row) => (
        <span className="text-[11px] font-bold text-slate-600 bg-slate-100 px-2 py-0.5 rounded">
          {row.paymentMode}
        </span>
      )
    },
    {
      header: 'Amount',
      accessor: 'amount',
      render: (row) => (
        <span className="font-mono font-bold text-sm text-rose-700">
          ₹{parseFloat(row.amount).toLocaleString('en-IN')}
        </span>
      )
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Receipt className="w-6 h-6 text-brand-600" />
            Operating Expenses
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Mandi fees, cold storage power, labor/palledar, rent, fuel & other overheads — posted to ledger on entry.
          </p>
        </div>

        <div className="flex flex-col xl:flex-row items-stretch xl:items-center gap-2">
          <DateRangeFilter initialPreset="thisMonth" loading={loading} onChange={handleRangeChange} />
          <button
            onClick={handleExportExcel}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-sm whitespace-nowrap"
            title="Download expenses as Excel"
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </button>
          <div className="text-right">
            <span className="text-[10px] uppercase tracking-wider text-slate-400 block">Total Overheads</span>
            <span className="text-lg font-bold font-mono text-rose-700">
              ₹{totalExpenses.toLocaleString('en-IN')}
            </span>
          </div>
          <button
            onClick={() => setIsOpen(true)}
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold shadow-sm transition whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Record Expense
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={expenses}
        searchPlaceholder="Search expense number, category or payee..."
        searchKey={(ex, term) =>
          ex.expenseNumber?.toLowerCase().includes(term) ||
          ex.category?.toLowerCase().includes(term) ||
          ex.paidTo?.toLowerCase().includes(term) ||
          ex.description?.toLowerCase().includes(term)
        }
        emptyMessage="No expenses recorded yet"
      />

      {/* Modal */}
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Record Operating Expense" maxWidth="max-w-2xl">
        {error && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Branch</label>
              {isOwner ? (
                <select
                  required
                  value={form.branchId}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900"
                >
                  <option value="">Select branch...</option>
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                </select>
              ) : (
                <div className="w-full p-2 bg-slate-100 border border-slate-200 rounded-lg font-bold text-slate-600">
                  📍 {user?.branch?.name || 'Your branch'} (auto)
                </div>
              )}
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Expense Category *</label>
              <select
                required
                value={form.category}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900"
              >
                {EXPENSE_CATEGORIES.map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Amount (₹) *</label>
              <input
                type="number"
                step="0.01"
                min="1"
                required
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="e.g. 4500"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-sm"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Mode</label>
              <select
                value={form.paymentMode}
                onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              >
                <option value="CASH">Cash</option>
                <option value="BANK">Bank / NEFT</option>
                <option value="UPI">UPI</option>
                <option value="CHEQUE">Cheque</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Paid To *</label>
              <input
                type="text"
                required
                value={form.paidTo}
                onChange={(e) => setForm({ ...form, paidTo: e.target.value })}
                placeholder="e.g. Azadpur Mandi Hamal Union"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Receipt / Voucher #</label>
              <input
                type="text"
                value={form.receiptNo}
                onChange={(e) => setForm({ ...form, receiptNo: e.target.value })}
                placeholder="e.g. HAM-449"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Expense Date</label>
              <input
                type="date"
                required
                value={form.expenseDate}
                onChange={(e) => setForm({ ...form, expenseDate: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Description</label>
              <textarea
                rows={2}
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="e.g. Unloading charges for 350 fruit crates from HP & Punjab trucks"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold shadow-sm disabled:opacity-60"
            >
              {submitting ? 'Posting...' : 'Post Expense to Ledger'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default Expenses;
