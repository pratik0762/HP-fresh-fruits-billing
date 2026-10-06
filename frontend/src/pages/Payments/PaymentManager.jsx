import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useBranch } from '../../context/BranchContext';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/Common/DataTable';
import Modal from '../../components/Common/Modal';
import Badge from '../../components/Common/Badge';
import DateRangeFilter from '../../components/Common/DateRangeFilter';
import { useToast } from '../../components/Common/Toast';
import { exportToExcel, getPresetRange } from '../../utils/excelExport';
import { CreditCard, Plus, ArrowDownLeft, ArrowUpRight, Check, AlertCircle, CalendarDays, Download } from 'lucide-react';

const PaymentManager = () => {
  const { activeBranchId, branches } = useBranch();
  const { isOwner, user } = useAuth();
  const toast = useToast();
  const [payments, setPayments] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [openInvoices, setOpenInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  // New Voucher Modal
  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    // Branch users are locked to their own branch; owner defaults to the
    // branch active in the navbar (or picks one — placeholder until then).
    branchId: isOwner
      ? (activeBranchId && activeBranchId !== 'all' ? activeBranchId : '')
      : String(user?.branchId || ''),
    voucherType: 'RECEIPT_CUSTOMER', // RECEIPT_CUSTOMER, PAYMENT_SUPPLIER
    partyId: '',
    referenceId: '', // optional: settle a specific invoice
    amount: '',
    paymentMode: 'CASH', // CASH, BANK, UPI, CHEQUE
    bankReference: '',
    paymentDate: new Date().toISOString().split('T')[0],
    notes: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [dateRange, setDateRange] = useState(getPresetRange('thisMonth'));
  const rangeRef = useRef(dateRange);
  const [supplierInvoices, setSupplierInvoices] = useState([]);

  const fetchData = async (range = rangeRef.current) => {
    try {
      setLoading(true);
      const payParams = new URLSearchParams();
      if (range.start && range.end) {
        payParams.append('startDate', range.start);
        payParams.append('endDate', range.end);
      }
      const [payRes, custRes, suppRes, saleRes, purRes] = await Promise.all([
        api.getCached(`/payments?${payParams.toString()}`, null, { maxAge: 10_000 }),
        api.getCached('/masters/customers', null, { maxAge: 60_000 }),
        api.getCached('/masters/suppliers', null, { maxAge: 60_000 }),
        api.getCached('/sales?limit=1000', null, { maxAge: 10_000 }),
        api.getCached('/purchases?limit=1000', null, { maxAge: 10_000 })
      ]);
      if (payRes?.data?.success) setPayments(payRes.data.payments);
      if (custRes?.data?.success) setCustomers(custRes.data.customers);
      if (suppRes?.data?.success) setSuppliers(suppRes.data.suppliers);
      if (saleRes?.data?.success) setOpenInvoices(saleRes.data.sales.filter(s => s.paymentStatus !== 'PAID'));
      if (purRes?.data?.success) setSupplierInvoices(purRes.data.purchases.filter(p => p.paymentStatus !== 'PAID'));
    } catch (err) {
      console.error('Failed to load payments', err);
      toast.error('Could not load payment vouchers. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const handleRangeChange = (range) => {
    rangeRef.current = range;
    setDateRange(range);
    fetchData(range);
  };

  useEffect(() => {
    fetchData();
  }, [activeBranchId]);

  const handleExportExcel = () => {
    const rows = payments.map(p => ({
      'Voucher #': p.paymentNumber,
      Date: p.paymentDate,
      Type: p.voucherType,
      Party: p.partyName || '',
      Branch: p.branch?.name || '',
      Amount: p.amount,
      Mode: p.paymentMode,
      'Bank Ref': p.bankReference || '',
      Notes: p.notes || ''
    }));
    const totalIn = payments.filter(p => p.voucherType === 'RECEIPT_CUSTOMER').reduce((a, p) => a + parseFloat(p.amount || 0), 0);
    const totalOut = payments.filter(p => p.voucherType !== 'RECEIPT_CUSTOMER').reduce((a, p) => a + parseFloat(p.amount || 0), 0);
    exportToExcel([
      { name: 'Payments', rows },
      { name: 'Summary', rows: [{
        Period: `${dateRange.label} (${dateRange.start || 'start'} to ${dateRange.end || 'today'})`,
        'Total Vouchers': payments.length,
        'Total Received (Customers)': totalIn,
        'Total Paid (Suppliers/Agents)': totalOut
      }] }
    ], `payments_${dateRange.label.replace(/\s+/g, '-')}`);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const isCust = form.voucherType === 'RECEIPT_CUSTOMER';
      const res = await api.post('/payments', {
        branchId: parseInt(form.branchId),
        voucherType: form.voucherType,
        partyType: isCust ? 'CUSTOMER' : 'SUPPLIER',
        partyId: parseInt(form.partyId),
        amount: parseFloat(form.amount),
        paymentMode: form.paymentMode,
        referenceType: form.referenceId ? (isCust ? 'Sale' : 'Purchase') : null,
        referenceId: form.referenceId ? parseInt(form.referenceId) : null,
        bankReference: form.bankReference,
        paymentDate: form.paymentDate,
        notes: form.notes
      });
      if (res.data.success) {
        toast.success('Payment voucher recorded successfully');
        setIsOpen(false);
        fetchData();
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to record payment voucher';
      setError(msg);
      toast.error('Could not record payment: ' + msg);
    } finally {
      setSubmitting(false);
    }
  };

  const columns = [
    {
      header: 'Voucher #',
      accessor: 'paymentNumber',
      render: (row) => <span className="font-mono font-bold text-brand-700 text-xs">{row.paymentNumber}</span>
    },
    {
      header: 'Date',
      accessor: 'paymentDate',
      render: (row) => <span className="text-xs text-slate-500">{row.paymentDate}</span>
    },
    {
      header: 'Voucher Type',
      accessor: 'voucherType',
      render: (row) => (
        row.voucherType === 'RECEIPT_CUSTOMER' ? (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded border border-emerald-200">
            <ArrowDownLeft className="w-3.5 h-3.5" /> Customer Receipt
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 bg-amber-50 px-2.5 py-0.5 rounded border border-amber-200">
            <ArrowUpRight className="w-3.5 h-3.5" /> Supplier Payout
          </span>
        )
      )
    },
    {
      header: 'Branch',
      accessor: 'branch',
      render: (row) => <span className="text-xs text-slate-700">{row.branch?.name}</span>
    },
    {
      header: 'Amount',
      accessor: 'amount',
      render: (row) => (
        <span className="font-mono font-bold text-sm text-slate-900">
          ₹{parseFloat(row.amount).toLocaleString('en-IN')}
        </span>
      )
    },
    {
      header: 'Mode & Reference',
      accessor: 'paymentMode',
      render: (row) => (
        <div className="text-xs">
          <span className="font-semibold text-slate-800">{row.paymentMode}</span>
          {row.bankReference && <span className="font-mono text-[11px] text-slate-400 block">{row.bankReference}</span>}
        </div>
      )
    },
    {
      header: 'Notes',
      accessor: 'notes',
      render: (row) => <span className="text-xs text-slate-600 truncate max-w-xs block">{row.notes || '—'}</span>
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <CreditCard className="w-6 h-6 text-brand-600" />
            Payment Vouchers & Receipts
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Record customer collections, grower disbursements, bank transfers, and cash settlements.
          </p>
        </div>

        <div className="flex flex-col xl:flex-row items-stretch xl:items-center gap-2">
          <DateRangeFilter initialPreset="thisMonth" loading={loading} onChange={handleRangeChange} />
          <button
            onClick={handleExportExcel}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-sm whitespace-nowrap"
            title="Download payments as Excel"
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </button>
          <Link
            to="/payments/aging"
            className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-bold shadow-sm transition whitespace-nowrap"
          >
            <CalendarDays className="w-4 h-4" />
            Aging Report
          </Link>
          <button
            onClick={() => setIsOpen(true)}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Record Payment Voucher
          </button>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={payments}
        searchPlaceholder="Search voucher number, reference or mode..."
        searchKey={(p, term) =>
          p.paymentNumber?.toLowerCase().includes(term) ||
          p.paymentMode?.toLowerCase().includes(term) ||
          p.bankReference?.toLowerCase().includes(term) ||
          p.notes?.toLowerCase().includes(term)
        }
      />

      {/* Modal */}
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title="Record Payment Voucher"
      >
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
              <select
                value={form.branchId}
                onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                disabled={!isOwner}
                required
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {isOwner && <option value="">Select branch...</option>}
                {branches.map(b => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Voucher Category</label>
              <select
                value={form.voucherType}
                onChange={(e) => setForm({ ...form, voucherType: e.target.value, partyId: '' })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-bold"
              >
                <option value="RECEIPT_CUSTOMER">Customer Receipt (Inflow / Money In)</option>
                <option value="PAYMENT_SUPPLIER">Supplier Payout (Outflow / Money Out)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {form.voucherType === 'RECEIPT_CUSTOMER' ? 'Customer / Buyer *' : 'Supplier / Grower *'}
              </label>
              <select
                required
                value={form.partyId}
                onChange={(e) => setForm({ ...form, partyId: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium"
              >
                <option value="">Select Party...</option>
                {form.voucherType === 'RECEIPT_CUSTOMER' ? (
                  customers.map(c => <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>)
                ) : (
                  suppliers.map(s => <option key={s.id} value={s.id}>{s.name} ({s.phone})</option>)
                )}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Amount (₹) *</label>
              <input
                type="number"
                step="0.01"
                min="1"
                required
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                placeholder="e.g. 50000"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-sm text-slate-900"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Mode</label>
              <select
                value={form.paymentMode}
                onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-medium"
              >
                <option value="CASH">Cash on Mandi Hand</option>
                <option value="BANK">Bank Transfer / NEFT / RTGS</option>
                <option value="UPI">UPI / PhonePe / GPay</option>
                <option value="CHEQUE">Cheque</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Date</label>
              <input
                type="date"
                required
                value={form.paymentDate}
                onChange={(e) => setForm({ ...form, paymentDate: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Against Invoice (optional)</label>
              <select
                value={form.referenceId}
                onChange={(e) => {
                  const refId = e.target.value;
                  let updated = { ...form, referenceId: refId };
                  const inv = (form.voucherType === 'RECEIPT_CUSTOMER' ? openInvoices : supplierInvoices)
                    .find(i => i.id === parseInt(refId));
                  // Auto-fill the outstanding due as the payment amount
                  if (inv && !form.amount) {
                    updated.amount = String(parseFloat(inv.dueAmount || 0));
                  }
                  // For receipts, force the party to the invoice's customer
                  if (inv && form.voucherType === 'RECEIPT_CUSTOMER' && inv.customer) {
                    updated.partyId = String(inv.customer.id);
                  }
                  if (inv && form.voucherType === 'PAYMENT_SUPPLIER' && inv.supplier) {
                    updated.partyId = String(inv.supplier.id);
                  }
                  setForm(updated);
                }}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium"
              >
                <option value="">On Account (no specific invoice)</option>
                {(form.voucherType === 'RECEIPT_CUSTOMER' ? openInvoices : supplierInvoices).map(inv => (
                  <option key={inv.id} value={inv.id}>
                    {inv.invoiceNumber} — Due: ₹{parseFloat(inv.dueAmount || 0).toLocaleString('en-IN')}
                    {form.voucherType === 'RECEIPT_CUSTOMER' && inv.customer ? ` (${inv.customer.name})` : ''}
                    {form.voucherType === 'PAYMENT_SUPPLIER' && inv.supplier ? ` (${inv.supplier.name})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Bank Reference / UTR / Cheque #</label>
              <input
                type="text"
                value={form.bankReference}
                onChange={(e) => setForm({ ...form, bankReference: e.target.value })}
                placeholder="e.g. UTR-HDFC-9912093"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Remarks / Settlement Notes</label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Against Invoice #, seasonal clearing..."
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
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold shadow-sm"
            >
              {submitting ? 'Recording...' : 'Record Payment Voucher'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default PaymentManager;
