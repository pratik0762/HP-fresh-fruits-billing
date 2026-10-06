import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import api from '../../api/client';
import { useBranch } from '../../context/BranchContext';
import DataTable from '../../components/Common/DataTable';
import Badge from '../../components/Common/Badge';
import Modal from '../../components/Common/Modal';
import InvoiceModal from '../../components/Common/InvoiceModal';
import DateRangeFilter from '../../components/Common/DateRangeFilter';
import { useToast } from '../../components/Common/Toast';
import { useAuth } from '../../context/AuthContext';
import { exportToExcel, getPresetRange } from '../../utils/excelExport';
import { Plus, Eye, Pencil, Trash2, ShoppingCart, TrendingUp, AlertTriangle, Download, RotateCcw, AlertCircle } from 'lucide-react';

const SaleList = () => {
  const { activeBranchId } = useBranch();
  const [sales, setSales] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedSale, setSelectedSale] = useState(null);
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);
  const { isOwner, isManager } = useAuth();
  const toast = useToast();
  const canEdit = isOwner || isManager;
  const canDelete = isOwner;

  // Edit modal state (full invoice editor)
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    id: null,
    invoiceNumber: '',
    customerId: '',
    saleDate: '',
    hasAgent: false,
    agentId: '',
    agentCommissionRate: 5,
    transporterId: '',
    vehicleNumber: '',
    freightCharges: 0,
    overallDiscount: 0,
    taxAmount: 0,
    paymentMode: 'CREDIT',
    recordedPaid: 0,
    newAdvance: 0,
    notes: '',
    returnReason: '',
    items: []
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editHasReceipts, setEditHasReceipts] = useState(false);

  // Masters for the full edit form
  const [customers, setCustomers] = useState([]);
  const [itemsList, setItemsList] = useState([]);
  const [agents, setAgents] = useState([]);
  const [transporters, setTransporters] = useState([]);

  useEffect(() => {
    const loadMasters = async () => {
      try {
        const [custRes, itmRes, agRes, trRes] = await Promise.all([
          api.get('/masters/customers'),
          api.get('/masters/items'),
          api.get('/masters/agents'),
          api.get('/masters/transporters')
        ]);
        if (custRes.data?.success) setCustomers(custRes.data.customers);
        if (itmRes.data?.success) setItemsList(itmRes.data.items);
        if (agRes.data?.success) setAgents(agRes.data.agents);
        if (trRes.data?.success) setTransporters(trRes.data.transporters);
      } catch (err) {
        console.error('Failed to load masters', err);
        toast.error('Could not load customer & item lists. Please refresh.');
      }
    };
    loadMasters();
  }, []);

  const [dateRange, setDateRange] = useState(getPresetRange('thisMonth'));
  const rangeRef = useRef(dateRange);

  const fetchSales = async (range = rangeRef.current) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('limit', '1000');
      if (range.start && range.end) {
        params.append('startDate', range.start);
        params.append('endDate', range.end);
      }
      await api.getCached(`/sales?${params.toString()}`, (res) => {
        if (res?.data?.success) setSales(res.data.sales);
      }, { maxAge: 10_000 });
    } catch (err) {
      console.error('Failed to load sales', err);
      toast.error('Could not load sale invoices. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const handleRangeChange = (range) => {
    rangeRef.current = range;
    setDateRange(range);
    fetchSales(range);
  };

  useEffect(() => {
    fetchSales();
  }, [activeBranchId]);

  // Weighted average selling price for the period
  const periodStats = (() => {
    let gross = 0, kg = 0;
    sales.forEach(s => (s.items || []).forEach(line => {
      const w = parseFloat(line.weightKg || 0);
      gross += parseFloat(line.subtotal || 0);
      kg += w;
    }));
    return { avg: kg > 0 ? Math.round((gross / kg) * 100) / 100 : null };
  })();

  const handleExportExcel = () => {
    const rows = sales.map(s => ({
      'Invoice #': s.invoiceNumber,
      Date: s.saleDate,
      Customer: s.customer?.name || '',
      Branch: s.branch?.name || '',
      Items: (s.items || []).map(i => `${i.item?.name || ''} x${i.quantity}`).join(', '),
      Subtotal: s.subtotal,
      Discount: s.discountAmount,
      Freight: s.freightCharges,
      Total: s.totalAmount,
      'FIFO COGS': s.totalCogs,
      'Gross Profit': s.grossProfit,
      'Avg Price ₹/kg': s.avgSalePricePerKg,
      Paid: s.paidAmount,
      Due: s.dueAmount,
      Status: s.paymentStatus,
      Mode: s.paymentMode
    }));
    const totals = sales.reduce((acc, s) => ({
      total: acc.total + parseFloat(s.totalAmount || 0),
      profit: acc.profit + parseFloat(s.grossProfit || 0),
      due: acc.due + parseFloat(s.dueAmount || 0)
    }), { total: 0, profit: 0, due: 0 });
    exportToExcel([
      { name: 'Sales', rows },
      { name: 'Summary', rows: [{
        Period: `${dateRange.label} (${dateRange.start || 'start'} to ${dateRange.end || 'today'})`,
        'Total Invoices': sales.length,
        'Total Sales': totals.total,
        'Total Gross Profit': totals.profit,
        'Total Outstanding': totals.due,
        'Avg Sale Price ₹/kg': periodStats.avg
      }] }
    ], `sales_${dateRange.label.replace(/\s+/g, '-')}`);
  };

  const handleViewInvoice = (sale) => {
    setSelectedSale(sale);
    setIsInvoiceOpen(true);
  };

  const openEdit = (sale) => {
    const paid = parseFloat(sale.paidAmount || 0);
    const lineDiscounts = (sale.items || []).reduce((s, itm) => s + (parseFloat(itm.discountAmount || 0)), 0);
    setEditHasReceipts(paid > 0);
    setEditForm({
      id: sale.id,
      invoiceNumber: sale.invoiceNumber,
      customerId: sale.customerId ? String(sale.customerId) : '',
      saleDate: sale.saleDate || '',
      hasAgent: !!sale.hasAgent,
      agentId: sale.agentId ? String(sale.agentId) : '',
      agentCommissionRate: parseFloat(sale.agentCommissionRate || 0),
      transporterId: sale.transporterId ? String(sale.transporterId) : '',
      vehicleNumber: sale.vehicleNumber || '',
      freightCharges: parseFloat(sale.freightCharges || 0),
      overallDiscount: Math.max(0, parseFloat(sale.discountAmount || 0) - lineDiscounts),
      taxAmount: parseFloat(sale.taxAmount || 0),
      paymentMode: sale.paymentMode || 'CREDIT',
      recordedPaid: paid,
      newAdvance: 0,
      notes: sale.notes || '',
      returnReason: '',
      items: (sale.items || []).map(itm => ({
        id: itm.id,
        itemId: itm.itemId ? String(itm.itemId) : '',
        quantity: parseFloat(itm.quantity || 0),
        unit: itm.unit || 'kg',
        conversionFactor: parseFloat(itm.conversionFactor || 1),
        ratePerUnit: parseFloat(itm.ratePerUnit || 0),
        discountAmount: parseFloat(itm.discountAmount || 0),
        returnedQuantity: parseFloat(itm.returnedQuantity || 0) || 0,
        returnReason: ''
      }))
    });
    setEditError('');
    setIsEditOpen(true);
  };

  const handleEditItemChange = (index, field, value) => {
    const updated = [...editForm.items];
    updated[index][field] = value;
    if (field === 'itemId') {
      const selected = itemsList.find(i => i.id === parseInt(value));
      if (selected) {
        updated[index].unit = selected.packagingUnit || 'kg';
        updated[index].conversionFactor = parseFloat(selected.unitConversionFactor || 1);
      }
    }
    setEditForm({ ...editForm, items: updated });
  };

  const addEditItemRow = () => {
    const defaultItem = itemsList[0];
    setEditForm({
      ...editForm,
      items: [...editForm.items, {
        itemId: defaultItem ? String(defaultItem.id) : '',
        quantity: 0,
        unit: defaultItem ? defaultItem.packagingUnit || 'kg' : 'kg',
        conversionFactor: defaultItem ? parseFloat(defaultItem.unitConversionFactor || 1) : 1,
        ratePerUnit: 0,
        discountAmount: 0,
        returnedQuantity: 0,
        returnReason: ''
      }]
    });
  };

  const removeEditItemRow = (index) => {
    if (editForm.items.length <= 1) return;
    setEditForm({ ...editForm, items: editForm.items.filter((_, i) => i !== index) });
  };

  // Live totals preview for the edit modal
  const editGross = editForm.items.reduce((s, itm) => s + (parseFloat(itm.quantity || 0) * parseFloat(itm.ratePerUnit || 0)), 0);
  const editLineDiscount = editForm.items.reduce((s, itm) => s + (parseFloat(itm.discountAmount || 0)), 0);
  const editTotalDiscount = editLineDiscount + (parseFloat(editForm.overallDiscount || 0) || 0);
  const editTotal = Math.max(0, editGross - editTotalDiscount + (parseFloat(editForm.taxAmount || 0) || 0) + (parseFloat(editForm.freightCharges || 0) || 0));
  const editCommission = editForm.hasAgent && editForm.agentId
    ? parseFloat(((editTotal * parseFloat(editForm.agentCommissionRate || 0)) / 100).toFixed(2))
    : 0;
  const editDue = Math.max(0, editTotal - (parseFloat(editForm.recordedPaid || 0) + parseFloat(editForm.newAdvance || 0)));

  // Live preview of the defective-goods return(s)
  const editReturnValue = editForm.items.reduce((s, itm) => {
    const qty = parseFloat(itm.quantity || 0);
    const rate = parseFloat(itm.ratePerUnit || 0);
    const disc = parseFloat(itm.discountAmount || 0);
    const netUnit = qty > 0 ? (qty * rate - disc) / qty : rate;
    return s + parseFloat(((parseFloat(itm.returnedQuantity || 0) || 0) * netUnit).toFixed(2));
  }, 0);
  const editReturnQty = editForm.items.reduce((s, itm) => s + (parseFloat(itm.returnedQuantity || 0) || 0), 0);
  const editReturnKg = editForm.items.reduce((s, itm) => s + ((parseFloat(itm.returnedQuantity || 0) || 0) * (parseFloat(itm.conversionFactor || 1) || 1)), 0);

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editForm.customerId) {
      setEditError('Please select a customer');
      toast.warning('Please select a customer first');
      return;
    }
    if (!editForm.items.length || editForm.items.some(i => !i.itemId)) {
      setEditError('Please select a fruit item for every line');
      toast.warning('Please choose a fruit for every line');
      return;
    }
    if (editForm.items.some(i => (parseFloat(i.returnedQuantity) || 0) > (parseFloat(i.quantity) || 0))) {
      setEditError('Return quantity cannot exceed invoiced quantity on any line');
      toast.warning('Return quantity cannot exceed invoiced quantity on any line');
      return;
    }

    setEditSaving(true);
    setEditError('');
    try {
      const payload = {
        customerId: parseInt(editForm.customerId),
        saleDate: editForm.saleDate,
        hasAgent: editForm.hasAgent,
        agentId: editForm.hasAgent && editForm.agentId ? parseInt(editForm.agentId) : null,
        agentCommissionRate: parseFloat(editForm.agentCommissionRate || 0),
        transporterId: editForm.transporterId ? parseInt(editForm.transporterId) : null,
        vehicleNumber: editForm.vehicleNumber,
        freightCharges: parseFloat(editForm.freightCharges) || 0,
        discountAmount: parseFloat(editForm.overallDiscount) || 0,
        taxAmount: parseFloat(editForm.taxAmount) || 0,
        paymentMode: editForm.paymentMode,
        notes: editForm.notes,
        paidAmount: parseFloat(editForm.newAdvance) || 0,
        // Defective fruit returns per item
        returns: editForm.items.map(itm => ({
          itemId: parseInt(itm.itemId),
          quantity: parseFloat(itm.returnedQuantity) || 0,
          reason: itm.returnReason || editForm.returnReason || 'Defective fruit returned by customer'
        })),
        returnReason: editForm.returnReason || 'Defective fruit returned by customer',
        items: editForm.items.map(itm => ({
          itemId: parseInt(itm.itemId),
          quantity: parseFloat(itm.quantity),
          unit: itm.unit,
          conversionFactor: parseFloat(itm.conversionFactor),
          ratePerUnit: parseFloat(itm.ratePerUnit),
          discountAmount: parseFloat(itm.discountAmount || 0),
          returnedQuantity: parseFloat(itm.returnedQuantity || 0),
          returnReason: itm.returnReason || ''
        }))
      };

      const res = await api.put(`/sales/${editForm.id}`, payload);
      if (res.data?.success) {
        toast.success(res.data.message || 'Sale invoice updated successfully');
        setIsEditOpen(false);
        fetchSales();
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to update sale invoice';
      setEditError(msg);
      toast.error('Could not update invoice: ' + msg);
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (sale) => {
    if (!window.confirm(`Delete sale invoice ${sale.invoiceNumber}?\n\nThis will restore the FIFO stock batches back to inventory and reverse all revenue ledger entries. This cannot be undone.`)) return;
    try {
      const res = await api.delete(`/sales/${sale.id}`);
      if (res.data?.success) {
        toast.success('Sale invoice deleted');
        fetchSales();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this invoice. Payments may already be recorded.');
    }
  };

  const columns = [
    {
      header: 'Invoice #',
      accessor: 'invoiceNumber',
      render: (row) => (
        <div>
          <span className="font-bold text-brand-700 font-mono">{row.invoiceNumber}</span>
          <span className="text-[11px] text-slate-400 block">{row.branch?.name}</span>
        </div>
      )
    },
    {
      header: 'Date',
      accessor: 'saleDate',
      render: (row) => <span className="text-xs text-slate-600">{row.saleDate}</span>
    },
    {
      header: 'Customer / Buyer',
      accessor: 'customer',
      render: (row) => (
        <div>
          <span className="font-semibold text-slate-900 block">{row.customer?.name}</span>
          <span className="text-[11px] text-slate-400">{row.customer?.phone || 'No phone'}</span>
        </div>
      )
    },
    {
      header: 'Items Sold',
      accessor: 'items',
      render: (row) => (
        <div className="text-xs">
          {row.items?.map((itm, i) => (
            <div key={i} className="truncate max-w-xs text-slate-700 flex items-center gap-1.5">
              <span>• {itm.item?.name} ({itm.quantity} {itm.unit} / {itm.weightKg} kg)</span>
              {parseFloat(itm.returnedQuantity || 0) > 0 && (
                <span className="text-[10px] bg-emerald-50 text-emerald-700 border border-emerald-200 px-1 py-0.2 rounded font-semibold">
                  Returned: {itm.returnedQuantity} {itm.unit}
                </span>
              )}
            </div>
          ))}
        </div>
      )
    },
    {
      header: 'Gross Profit',
      accessor: 'grossProfit',
      render: (row) => {
        const profit = parseFloat(row.grossProfit || 0);
        const isPos = profit >= 0;
        return (
          <div className="font-mono">
            <span className={`font-bold ${isPos ? 'text-emerald-700' : 'text-rose-700'}`}>
              ₹{profit.toLocaleString('en-IN')}
            </span>
            <div className="text-[10px] text-slate-400">
              COGS: ₹{parseFloat(row.totalCogs || 0).toLocaleString('en-IN')}
            </div>
          </div>
        );
      }
    },
    {
      header: 'Total Amount',
      accessor: 'totalAmount',
      render: (row) => (
        <div>
          <span className="font-bold font-mono text-slate-900">₹{parseFloat(row.totalAmount).toLocaleString('en-IN')}</span>
          <div className="text-[10px] text-slate-500">
            Due: ₹{parseFloat(row.dueAmount || 0).toLocaleString('en-IN')}
          </div>
        </div>
      )
    },
    {
      header: 'Status',
      accessor: 'paymentStatus',
      render: (row) => <Badge variant={row.paymentStatus}>{row.paymentStatus}</Badge>
    },
    {
      header: 'Actions',
      accessor: 'id',
      render: (row) => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => handleViewInvoice(row)}
            className="p-1.5 rounded-lg text-slate-500 hover:text-brand-600 hover:bg-slate-100 transition"
            title="View / Print Tax Invoice"
          >
            <Eye className="w-4 h-4" />
          </button>
          {canEdit && (
            <button
              onClick={() => openEdit(row)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-sky-600 hover:bg-sky-50 transition"
              title="Edit sale & customer return"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => handleDelete(row)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition"
              title="Delete invoice (restores stock & reverses ledger)"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      )
    }
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ShoppingCart className="w-6 h-6 text-brand-600" />
            Outward Sales & Billing
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Wholesale billing, buyer sales orders, customer dispatch, and real-time FIFO stock deduction.
          </p>
        </div>

        <div className="flex flex-col xl:flex-row items-stretch xl:items-center gap-2">
          <DateRangeFilter initialPreset="thisMonth" loading={loading} onChange={handleRangeChange} />
          <button
            onClick={handleExportExcel}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-sm whitespace-nowrap"
            title="Download sales as Excel"
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </button>
          <Link
            to="/sales/new"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold shadow-sm transition whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            New Sale Invoice
          </Link>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={sales}
        searchPlaceholder="Search by invoice number, buyer or fruit..."
        searchKey={(item, term) => 
          item.invoiceNumber?.toLowerCase().includes(term) ||
          item.customer?.name?.toLowerCase().includes(term) ||
          item.items?.some(i => i.item?.name?.toLowerCase().includes(term))
        }
      />

      <InvoiceModal
        isOpen={isInvoiceOpen}
        onClose={() => setIsInvoiceOpen(false)}
        data={selectedSale}
        type="SALE"
      />

      {/* Edit Sale Modal — full invoice editor with Customer Defective Return Handler */}
      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title={`Edit Sale Invoice ${editForm.invoiceNumber}`} maxWidth="max-w-5xl">
        {editError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{editError}</span>
          </div>
        )}

        {editHasReceipts ? (
          <div className="mb-4 p-3 bg-sky-50 border border-sky-200 text-sky-900 text-xs rounded-lg">
            <strong>₹{parseFloat(editForm.recordedPaid || 0).toLocaleString('en-IN')} already collected on this invoice.</strong>{' '}
            Recorded receipts are preserved. Defective fruit returns will restore inventory stock into batches and process refund / reduce customer dues.
          </div>
        ) : (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs">
            Editing will re-allocate FIFO batches and update the append-only ledger. Defective fruit returns increase stock in inventory and record the refund transaction.
          </div>
        )}

        <form onSubmit={handleEditSubmit} className="space-y-5 text-xs">
          {/* Customer & invoice metadata */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Invoice Date</label>
              <input
                type="date"
                value={editForm.saleDate}
                onChange={(e) => setEditForm({ ...editForm, saleDate: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Customer / Buyer *</label>
              <select
                value={editForm.customerId}
                onChange={(e) => setEditForm({ ...editForm, customerId: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              >
                <option value="">Select Customer...</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.phone || 'No phone'})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Mode</label>
              <select
                value={editForm.paymentMode}
                onChange={(e) => setEditForm({ ...editForm, paymentMode: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              >
                <option value="CASH">CASH</option>
                <option value="CREDIT">CREDIT</option>
                <option value="BANK">BANK</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Vehicle / Truck No.</label>
              <input
                type="text"
                value={editForm.vehicleNumber}
                onChange={(e) => setEditForm({ ...editForm, vehicleNumber: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono uppercase"
              />
            </div>
          </div>

          {/* Commission & Logistics */}
          <div className="pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            <label className="flex items-center gap-2 cursor-pointer pb-2">
              <input
                type="checkbox"
                checked={editForm.hasAgent}
                onChange={(e) => setEditForm({ ...editForm, hasAgent: e.target.checked, agentId: e.target.checked ? editForm.agentId : '' })}
                className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
              />
              <span className="font-bold text-slate-800">Commission Agent</span>
            </label>
            {editForm.hasAgent && (
              <>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Agent</label>
                  <select
                    value={editForm.agentId}
                    onChange={(e) => {
                      const ag = agents.find(a => a.id === parseInt(e.target.value));
                      setEditForm({ ...editForm, agentId: e.target.value, agentCommissionRate: ag ? ag.defaultCommissionRate : editForm.agentCommissionRate });
                    }}
                    className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    <option value="">Select Agent...</option>
                    {agents.map(a => (
                      <option key={a.id} value={a.id}>{a.name} ({a.defaultCommissionRate}%)</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Commission %</label>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    value={editForm.agentCommissionRate}
                    onChange={(e) => setEditForm({ ...editForm, agentCommissionRate: e.target.value })}
                    className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
                  />
                </div>
              </>
            )}
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Transporter</label>
              <select
                value={editForm.transporterId}
                onChange={(e) => setEditForm({ ...editForm, transporterId: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              >
                <option value="">None / Self</option>
                {transporters.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Fruit items */}
          <div className="pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <ShoppingCart className="w-4 h-4 text-brand-600" />
                Fruit Items on Invoice ({editForm.items.length})
              </h3>
              <button
                type="button"
                onClick={addEditItemRow}
                className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold transition"
              >
                <Plus className="w-3.5 h-3.5" />
                Add Fruit Item
              </button>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100/70 text-slate-600 font-bold uppercase tracking-wider border-b border-slate-200">
                    <th className="p-2">Fruit Item</th>
                    <th className="p-2 w-24">Quantity</th>
                    <th className="p-2 w-20">Unit</th>
                    <th className="p-2 w-20">Kg/Unit</th>
                    <th className="p-2 w-20">Net Wt</th>
                    <th className="p-2 w-24">Rate (₹)</th>
                    <th className="p-2 w-20">Disc (₹)</th>
                    <th className="p-2 w-28 text-right">Subtotal</th>
                    <th className="p-2 w-8"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {editForm.items.map((row, idx) => {
                    const netKg = (parseFloat(row.quantity || 0) * parseFloat(row.conversionFactor || 1)).toFixed(1);
                    const lineSub = (parseFloat(row.quantity || 0) * parseFloat(row.ratePerUnit || 0) - parseFloat(row.discountAmount || 0)).toFixed(2);
                    return (
                      <tr key={idx}>
                        <td className="p-1">
                          <select
                            value={row.itemId}
                            onChange={(e) => handleEditItemChange(idx, 'itemId', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded-lg"
                          >
                            <option value="">Select...</option>
                            {itemsList.map(i => (
                              <option key={i.id} value={i.id}>{i.name}{i.variety ? ` — ${i.variety}` : ''}</option>
                            ))}
                          </select>
                        </td>
                        <td className="p-1">
                          <input
                            type="number" min="0"
                            value={row.quantity}
                            onChange={(e) => handleEditItemChange(idx, 'quantity', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={row.unit}
                            onChange={(e) => handleEditItemChange(idx, 'unit', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded-lg"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="number" min="0" step="0.01"
                            value={row.conversionFactor}
                            onChange={(e) => handleEditItemChange(idx, 'conversionFactor', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
                          />
                        </td>
                        <td className="p-1.5 text-center font-mono text-slate-600">{netKg} kg</td>
                        <td className="p-1">
                          <input
                            type="number" min="0" step="0.01"
                            value={row.ratePerUnit}
                            onChange={(e) => handleEditItemChange(idx, 'ratePerUnit', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="number" min="0" step="0.01"
                            value={row.discountAmount}
                            onChange={(e) => handleEditItemChange(idx, 'discountAmount', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
                          />
                        </td>
                        <td className="p-1.5 text-right font-mono font-bold text-slate-900">₹{parseFloat(lineSub).toLocaleString('en-IN')}</td>
                        <td className="p-1 text-center">
                          <button
                            type="button"
                            onClick={() => removeEditItemRow(idx)}
                            disabled={editForm.items.length <= 1}
                            className="p-1 rounded text-rose-500 hover:bg-rose-50 disabled:opacity-30"
                            title="Remove line"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Dedicated Defective Fruit Return & Refund to Customer Section */}
          <div className="pt-4 border-t border-slate-100 bg-emerald-50/30 rounded-xl p-4 border border-emerald-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-3">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-emerald-600" />
                <h3 className="font-bold text-emerald-900 uppercase tracking-wider text-xs">
                  Customer Defective Fruit Return & Refund (Per-Item Handler)
                </h3>
              </div>
              <p className="text-[11px] text-slate-500">
                When a customer returns defective fruit, stock quantity increases by that amount and the refund transaction is recorded.
              </p>
            </div>

            <div className="overflow-x-auto bg-white rounded-lg border border-emerald-200/60 shadow-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-emerald-100/50 text-emerald-900 font-bold uppercase tracking-wider border-b border-emerald-200">
                    <th className="p-2">Fruit Item</th>
                    <th className="p-2 w-20">Sold Qty</th>
                    <th className="p-2 w-28">Defective Return Qty</th>
                    <th className="p-2 w-16">Unit</th>
                    <th className="p-2 w-24">Stock Restored</th>
                    <th className="p-2 w-28 text-right">Refund to Customer</th>
                    <th className="p-2 w-48">Return Reason / Defect Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {editForm.items.map((row, idx) => {
                    const itmName = row.itemId ? itemsList.find(i => i.id === parseInt(row.itemId))?.name : 'Item';
                    const itmVariety = row.itemId ? itemsList.find(i => i.id === parseInt(row.itemId))?.variety : '';
                    const returnQty = parseFloat(row.returnedQuantity || 0);
                    const conv = parseFloat(row.conversionFactor || 1);
                    const stockKg = (returnQty * conv).toFixed(1);
                    const soldQty = parseFloat(row.quantity || 0);
                    const disc = parseFloat(row.discountAmount || 0);
                    const netUnitPrice = soldQty > 0 ? (soldQty * parseFloat(row.ratePerUnit || 0) - disc) / soldQty : parseFloat(row.ratePerUnit || 0);
                    const lineRefund = (returnQty * netUnitPrice).toFixed(2);
                    const isReturned = returnQty > 0;

                    return (
                      <tr key={idx} className={isReturned ? 'bg-emerald-50/40' : ''}>
                        <td className="p-2 font-semibold text-slate-800">
                          {itmName} {itmVariety ? <span className="text-slate-500 text-[11px]">({itmVariety})</span> : ''}
                        </td>
                        <td className="p-2 font-mono text-slate-600">{row.quantity} {row.unit}</td>
                        <td className="p-1">
                          <input
                            type="number"
                            min="0"
                            max={row.quantity || 0}
                            step="any"
                            value={row.returnedQuantity ?? 0}
                            onChange={(e) => handleEditItemChange(idx, 'returnedQuantity', e.target.value)}
                            className="w-full p-1.5 bg-emerald-50/60 border border-emerald-300 rounded-lg font-mono text-right font-bold text-emerald-700 focus:ring-2 focus:ring-emerald-400 focus:outline-none"
                            placeholder="0"
                          />
                        </td>
                        <td className="p-2 font-mono text-slate-500">{row.unit || 'unit'}</td>
                        <td className="p-2 font-mono text-emerald-700 font-semibold">
                          {isReturned ? `+${stockKg} kg` : '0 kg'}
                        </td>
                        <td className="p-2 text-right font-mono font-bold text-emerald-700">
                          ₹{parseFloat(lineRefund).toLocaleString('en-IN')}
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={row.returnReason || ''}
                            onChange={(e) => handleEditItemChange(idx, 'returnReason', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 placeholder:text-slate-400"
                            placeholder="e.g. Defective / Rotten / Quality issue"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Live defective fruit return banner */}
            <div className="mt-3 p-2.5 bg-white border border-emerald-200 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-emerald-800">
                <AlertCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  <strong>Customer Return Summary:</strong> {editReturnQty} units ({editReturnKg.toFixed(1)} kg) returned by customer.
                </span>
              </div>
              <div className="flex items-center gap-4 font-mono font-bold">
                <span className="text-slate-600">Stock Restored: <strong className="text-emerald-700">+{editReturnKg.toFixed(1)} kg</strong></span>
                <span className="text-slate-600">Customer Refund: <strong className="text-emerald-700">₹{editReturnValue.toLocaleString('en-IN')}</strong></span>
              </div>
            </div>

            <div className="mt-2">
              <label className="block font-semibold text-slate-700 mb-1">Overall Return Remarks / Notes</label>
              <input
                type="text"
                value={editForm.returnReason}
                onChange={(e) => setEditForm({ ...editForm, returnReason: e.target.value })}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg"
                placeholder="e.g. Defective fruit received back from buyer and refunded"
              />
            </div>
          </div>

          {/* Charges, receipt & notes */}
          <div className="pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Freight Charged (₹)</label>
              <input
                type="number" min="0" step="0.01"
                value={editForm.freightCharges}
                onChange={(e) => setEditForm({ ...editForm, freightCharges: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Overall Discount (₹)</label>
              <input
                type="number" min="0" step="0.01"
                value={editForm.overallDiscount}
                onChange={(e) => setEditForm({ ...editForm, overallDiscount: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Tax (₹)</label>
              <input
                type="number" min="0" step="0.01"
                value={editForm.taxAmount}
                onChange={(e) => setEditForm({ ...editForm, taxAmount: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {editHasReceipts ? 'Paid Now — New Advance (₹)' : 'Paid Now (₹)'}
              </label>
              <input
                type="number" min="0" step="0.01"
                value={editForm.newAdvance}
                onChange={(e) => setEditForm({ ...editForm, newAdvance: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
              />
              {editHasReceipts && (
                <p className="mt-1 text-[10px] text-slate-500">On record: ₹{parseFloat(editForm.recordedPaid || 0).toLocaleString('en-IN')}</p>
              )}
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Notes</label>
              <textarea
                rows={1}
                value={editForm.notes}
                onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {/* Live totals */}
          <div className="pt-3 border-t border-slate-200 flex flex-wrap justify-end gap-x-8 gap-y-1 font-mono">
            <span className="text-slate-500">Items Gross: <strong className="text-slate-900">₹{editGross.toLocaleString('en-IN')}</strong></span>
            {editTotalDiscount > 0 && <span className="text-slate-500">Total Discount: <strong className="text-slate-900">-₹{editTotalDiscount.toLocaleString('en-IN')}</strong></span>}
            {editReturnValue > 0 && <span className="text-emerald-700">Customer Refund: <strong>-₹{editReturnValue.toLocaleString('en-IN')}</strong></span>}
            {editCommission > 0 && <span className="text-slate-500">Commission: <strong className="text-slate-900">₹{editCommission.toLocaleString('en-IN')}</strong></span>}
            <span className="text-slate-500">Invoice Total: <strong className="text-brand-700">₹{editTotal.toLocaleString('en-IN')}</strong></span>
            <span className="text-slate-500">Due: <strong className="text-rose-700">₹{editDue.toLocaleString('en-IN')}</strong></span>
          </div>

          <div className="pt-4 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsEditOpen(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={editSaving}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold shadow-sm disabled:opacity-60"
            >
              {editSaving ? 'Saving...' : 'Save & Re-post Invoice'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default SaleList;
