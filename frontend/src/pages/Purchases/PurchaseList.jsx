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
import { Plus, Eye, Pencil, Trash2, Scale, ShoppingBag, AlertTriangle, Download, RotateCcw, AlertCircle } from 'lucide-react';

const PurchaseList = () => {
  const { activeBranchId } = useBranch();
  const [purchases, setPurchases] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedPurchase, setSelectedPurchase] = useState(null);
  const [isInvoiceOpen, setIsInvoiceOpen] = useState(false);
  const { isOwner, isManager } = useAuth();
  const toast = useToast();
  const canEdit = isOwner || isManager;
  const canDelete = isOwner;

  // Edit modal state (full bill editor)
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({
    id: null,
    invoiceNumber: '',
    supplierId: '',
    supplierInvoiceNumber: '',
    purchaseDate: '',
    hasAgent: false,
    agentId: '',
    agentCommissionRate: 5,
    transporterId: '',
    vehicleNumber: '',
    freightCharges: 0,
    loadingCharges: 0,
    otherCharges: 0,
    paymentMode: 'CREDIT',
    paidAmount: 0,
    recordedPaid: 0,
    newAdvance: 0,
    weightVarianceReason: '',
    notes: '',
    returnReason: '',
    items: []
  });
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');
  const [editHasPayments, setEditHasPayments] = useState(false);

  // Masters for the full edit form
  const [suppliers, setSuppliers] = useState([]);
  const [itemsList, setItemsList] = useState([]);
  const [agents, setAgents] = useState([]);
  const [transporters, setTransporters] = useState([]);

  useEffect(() => {
    const loadMasters = async () => {
      try {
        const [suppRes, itmRes, agRes, trRes] = await Promise.all([
          api.get('/masters/suppliers'),
          api.get('/masters/items'),
          api.get('/masters/agents'),
          api.get('/masters/transporters')
        ]);
        if (suppRes.data?.success) setSuppliers(suppRes.data.suppliers);
        if (itmRes.data?.success) setItemsList(itmRes.data.items);
        if (agRes.data?.success) setAgents(agRes.data.agents);
        if (trRes.data?.success) setTransporters(trRes.data.transporters);
      } catch (err) {
        console.error('Failed to load masters', err);
        toast.error('Could not load supplier & item lists. Please refresh.');
      }
    };
    loadMasters();
  }, []);

  const [dateRange, setDateRange] = useState(getPresetRange('thisMonth'));
  const rangeRef = useRef(dateRange);

  const fetchPurchases = async (range = rangeRef.current) => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      params.append('limit', '1000');
      if (range.start && range.end) {
        params.append('startDate', range.start);
        params.append('endDate', range.end);
      }
      await api.getCached(`/purchases?${params.toString()}`, (res) => {
        if (res?.data?.success) setPurchases(res.data.purchases);
      }, { maxAge: 10_000 });
    } catch (err) {
      console.error('Failed to load purchases', err);
      toast.error('Could not load purchase bills. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  const handleRangeChange = (range) => {
    rangeRef.current = range;
    setDateRange(range);
    fetchPurchases(range);
  };

  useEffect(() => {
    fetchPurchases();
  }, [activeBranchId]);

  const handleExportExcel = () => {
    const rows = purchases.map(p => ({
      'Bill #': p.invoiceNumber,
      'Challan #': p.supplierInvoiceNumber || '',
      Date: p.purchaseDate,
      Supplier: p.supplier?.name || '',
      Branch: p.branch?.name || '',
      Items: (p.items || []).map(i => `${i.item?.name || ''} x${i.receivedQuantity}`).join(', '),
      'Billed Wt (kg)': p.totalBilledWeight,
      'Received Wt (kg)': p.totalReceivedWeight,
      'Weight Loss (kg)': p.weightVariance,
      Freight: p.freightCharges,
      Commission: p.agentCommissionAmount,
      Total: p.totalAmount,
      Paid: p.paidAmount,
      Due: p.dueAmount,
      Status: p.paymentStatus
    }));
    const totals = purchases.reduce((acc, p) => ({
      total: acc.total + parseFloat(p.totalAmount || 0),
      paid: acc.paid + parseFloat(p.paidAmount || 0),
      due: acc.due + parseFloat(p.dueAmount || 0)
    }), { total: 0, paid: 0, due: 0 });
    exportToExcel([
      { name: 'Purchases', rows },
      { name: 'Summary', rows: [{
        Period: `${dateRange.label} (${dateRange.start || 'start'} to ${dateRange.end || 'today'})`,
        'Total Bills': purchases.length,
        'Total Purchases': totals.total,
        'Total Paid': totals.paid,
        'Total Outstanding': totals.due
      }] }
    ], `purchases_${dateRange.label.replace(/\s+/g, '-')}`);
  };

  const handleViewInvoice = (pur) => {
    setSelectedPurchase(pur);
    setIsInvoiceOpen(true);
  };

  const openEdit = (pur) => {
    const paid = parseFloat(pur.paidAmount || 0);
    setEditHasPayments(paid > 0);
    setEditForm({
      id: pur.id,
      invoiceNumber: pur.invoiceNumber,
      supplierId: pur.supplierId ? String(pur.supplierId) : '',
      supplierInvoiceNumber: pur.supplierInvoiceNumber || '',
      purchaseDate: pur.purchaseDate || '',
      hasAgent: !!pur.hasAgent,
      agentId: pur.agentId ? String(pur.agentId) : '',
      agentCommissionRate: parseFloat(pur.agentCommissionRate || 0),
      transporterId: pur.transporterId ? String(pur.transporterId) : '',
      vehicleNumber: pur.vehicleNumber || '',
      freightCharges: parseFloat(pur.freightCharges || 0),
      loadingCharges: parseFloat(pur.loadingCharges || 0),
      otherCharges: parseFloat(pur.otherCharges || 0),
      paymentMode: pur.paymentMode || 'CREDIT',
      paidAmount: paid,
      recordedPaid: paid,
      newAdvance: 0,
      weightVarianceReason: pur.weightVarianceReason || '',
      notes: pur.notes || '',
      returnReason: '',
      items: (pur.items || []).map(itm => ({
        id: itm.id,
        itemId: itm.itemId ? String(itm.itemId) : '',
        billedQuantity: parseFloat(itm.billedQuantity || 0),
        unit: itm.unit || 'crate',
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
        updated[index].unit = selected.packagingUnit || 'crate';
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
        billedQuantity: 0,
        unit: defaultItem ? defaultItem.packagingUnit || 'crate' : 'crate',
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
  const editGross = editForm.items.reduce((s, itm) => s + (parseFloat(itm.billedQuantity || 0) * parseFloat(itm.ratePerUnit || 0)), 0);
  const editDiscount = editForm.items.reduce((s, itm) => s + (parseFloat(itm.discountAmount || 0)), 0);
  const editNet = Math.max(0, editGross - editDiscount);
  const editCommission = editForm.hasAgent && editForm.agentId
    ? parseFloat(((editNet * parseFloat(editForm.agentCommissionRate || 0)) / 100).toFixed(2))
    : 0;
  const editCharges = (parseFloat(editForm.freightCharges) || 0)
    + (parseFloat(editForm.loadingCharges) || 0)
    + (parseFloat(editForm.otherCharges) || 0)
    + editCommission;
  const editTotal = parseFloat((editNet + editCharges).toFixed(2));
  const editDue = Math.max(0, editTotal - (parseFloat(editForm.recordedPaid || 0) + parseFloat(editForm.newAdvance || 0)));

  // Live preview of the defective-goods return(s)
  const editReturnValue = editForm.items.reduce((s, itm) => {
    const billed = parseFloat(itm.billedQuantity || 0);
    const disc = parseFloat(itm.discountAmount || 0);
    const netUnit = billed > 0 ? (billed * parseFloat(itm.ratePerUnit || 0) - disc) / billed : parseFloat(itm.ratePerUnit || 0);
    return s + parseFloat(((parseFloat(itm.returnedQuantity) || 0) * netUnit).toFixed(2));
  }, 0);
  const editReturnQty = editForm.items.reduce((s, itm) => s + (parseFloat(itm.returnedQuantity || 0) || 0), 0);
  const editReturnKg = editForm.items.reduce((s, itm) => s + ((parseFloat(itm.returnedQuantity || 0) || 0) * (parseFloat(itm.conversionFactor || 1) || 1)), 0);

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (!editHasPayments && (!editForm.items.length || editForm.items.some(i => !i.itemId))) {
      setEditError('Please select a fruit item for every line');
      toast.warning('Please select a fruit item for every line');
      return;
    }
    if (editForm.items.some(i => (parseFloat(i.returnedQuantity) || 0) > (parseFloat(i.billedQuantity) || 0))) {
      setEditError('Return quantity cannot exceed the billed quantity on any line');
      toast.warning('Return quantity cannot exceed the billed quantity on any line');
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      const payload = {
        supplierInvoiceNumber: editForm.supplierInvoiceNumber,
        vehicleNumber: editForm.vehicleNumber,
        freightCharges: parseFloat(editForm.freightCharges) || 0,
        loadingCharges: parseFloat(editForm.loadingCharges) || 0,
        otherCharges: parseFloat(editForm.otherCharges) || 0,
        notes: editForm.notes,
        paymentMode: editForm.paymentMode,
        // Defective fruit returns per item
        returns: editForm.items.map(itm => ({
          itemId: parseInt(itm.itemId),
          quantity: parseFloat(itm.returnedQuantity) || 0,
          reason: itm.returnReason || editForm.returnReason || 'Defective fruit returned to supplier'
        })),
        returnReason: editForm.returnReason || 'Defective fruit returned to supplier',
        paidAmount: parseFloat(editForm.newAdvance) || 0
      };

      if (!editHasPayments) {
        payload.supplierId = parseInt(editForm.supplierId);
        payload.purchaseDate = editForm.purchaseDate;
        payload.hasAgent = editForm.hasAgent;
        payload.agentId = editForm.hasAgent && editForm.agentId ? parseInt(editForm.agentId) : null;
        payload.agentCommissionRate = parseFloat(editForm.agentCommissionRate || 0);
        payload.transporterId = editForm.transporterId ? parseInt(editForm.transporterId) : null;
        payload.weightVarianceReason = editForm.weightVarianceReason;
        payload.items = editForm.items.map(itm => ({
          itemId: parseInt(itm.itemId),
          billedQuantity: parseFloat(itm.billedQuantity),
          receivedQuantity: parseFloat(itm.billedQuantity),
          unit: itm.unit,
          conversionFactor: parseFloat(itm.conversionFactor),
          ratePerUnit: parseFloat(itm.ratePerUnit),
          discountAmount: parseFloat(itm.discountAmount || 0),
          returnedQuantity: parseFloat(itm.returnedQuantity || 0),
          returnReason: itm.returnReason || ''
        }));
      }

      const res = await api.put(`/purchases/${editForm.id}`, payload);
      if (res.data?.success) {
        toast.success(res.data.message || 'Purchase bill updated successfully');
        setIsEditOpen(false);
        fetchPurchases();
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to update bill';
      setEditError(msg);
      toast.error('Could not update bill: ' + msg);
    } finally {
      setEditSaving(false);
    }
  };

  const handleDelete = async (pur) => {
    if (!window.confirm(`Delete purchase bill ${pur.invoiceNumber}?\n\nAll ledger entries will be reversed and the FIFO stock batches removed. This cannot be undone.`)) return;
    try {
      const res = await api.delete(`/purchases/${pur.id}`);
      if (res.data?.success) {
        toast.success('Purchase bill deleted');
        fetchPurchases();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete this bill. Payments may already be recorded.');
    }
  };

  const columns = [
    {
      header: 'Bill #',
      accessor: 'invoiceNumber',
      render: (row) => (
        <div>
          <span className="font-bold text-brand-700 font-mono">{row.invoiceNumber}</span>
          {row.supplierInvoiceNumber && (
            <span className="text-[11px] text-slate-400 block">Challan: {row.supplierInvoiceNumber}</span>
          )}
        </div>
      )
    },
    {
      header: 'Date',
      accessor: 'purchaseDate',
      render: (row) => <span className="text-xs text-slate-600">{row.purchaseDate}</span>
    },
    {
      header: 'Supplier / Grower',
      accessor: 'supplier',
      render: (row) => (
        <div>
          <span className="font-semibold text-slate-900 block">{row.supplier?.name}</span>
          <span className="text-[11px] text-slate-500">{row.branch?.name}</span>
        </div>
      )
    },
    {
      header: 'Fruit Items',
      accessor: 'items',
      render: (row) => (
        <div className="text-xs">
          {row.items?.map((itm, i) => (
            <div key={i} className="truncate max-w-xs text-slate-700 flex items-center gap-1.5">
              <span>• {itm.item?.name} ({itm.receivedQuantity} {itm.unit} / {itm.receivedWeightKg} kg)</span>
              {parseFloat(itm.returnedQuantity || 0) > 0 && (
                <span className="text-[10px] bg-rose-50 text-rose-700 border border-rose-200 px-1 py-0.2 rounded font-semibold">
                  Returned: {itm.returnedQuantity} {itm.unit}
                </span>
              )}
            </div>
          ))}
        </div>
      )
    },
    {
      header: 'Weight Variance',
      accessor: 'weightVariance',
      render: (row) => (
        <div>
          {parseFloat(row.weightVariance) > 0 ? (
            <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
              <Scale className="w-3 h-3 text-amber-600" />
              -{row.weightVariance} kg loss
            </span>
          ) : (
            <span className="text-xs text-slate-400">Accurate (0 kg)</span>
          )}
        </div>
      )
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
            title="View / Print Purchase Bill"
          >
            <Eye className="w-4 h-4" />
          </button>
          {canEdit && (
            <button
              onClick={() => openEdit(row)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-sky-600 hover:bg-sky-50 transition"
              title="Edit bill & defective fruit return"
            >
              <Pencil className="w-4 h-4" />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => handleDelete(row)}
              className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition"
              title="Delete bill (reverses ledger & removes batches)"
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
            <ShoppingBag className="w-6 h-6 text-brand-600" />
            Inward Purchases & Arrivals
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Procurement from fruit growers, mandi arhtiyas, and suppliers with landed FIFO batch tracking.
          </p>
        </div>

        <div className="flex flex-col xl:flex-row items-stretch xl:items-center gap-2">
          <DateRangeFilter initialPreset="thisMonth" loading={loading} onChange={handleRangeChange} />
          <button
            onClick={handleExportExcel}
            className="px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 shadow-sm whitespace-nowrap"
            title="Download purchases as Excel"
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </button>
          <Link
            to="/purchases/new"
            className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold shadow-sm transition whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            New Purchase Entry
          </Link>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={purchases}
        searchPlaceholder="Search by bill number, supplier or item..."
        searchKey={(item, term) => 
          item.invoiceNumber?.toLowerCase().includes(term) ||
          item.supplier?.name?.toLowerCase().includes(term) ||
          item.items?.some(i => i.item?.name?.toLowerCase().includes(term))
        }
      />

      <InvoiceModal
        isOpen={isInvoiceOpen}
        onClose={() => setIsInvoiceOpen(false)}
        data={selectedPurchase}
        type="PURCHASE"
      />

      {/* Edit Purchase Modal — full bill editor with Defective Fruit Return Handler */}
      <Modal isOpen={isEditOpen} onClose={() => setIsEditOpen(false)} title={`Edit Bill ${editForm.invoiceNumber}`} maxWidth="max-w-5xl">
        {editError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{editError}</span>
          </div>
        )}

        {editHasPayments ? (
          <div className="mb-4 p-3 bg-sky-50 border border-sky-200 text-sky-900 text-xs rounded-lg">
            <strong>₹{parseFloat(editForm.recordedPaid || 0).toLocaleString('en-IN')} already recorded as paid on this bill.</strong>{' '}
            Recorded payment vouchers are kept as-is — editing here re-posts the bill and recalculates the balance due. Defective fruit returns will reduce inventory stock and adjust supplier refund / payable balance.
          </div>
        ) : (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-800 text-xs">
            Full edit re-posts the bill: ledger entries are reversed and FIFO stock batches rebuilt with updated details. Defective fruit returns decrease inventory stock and credit supplier refund.
          </div>
        )}

        <form onSubmit={handleEditSubmit} className="space-y-5 text-xs">
          {/* Supplier & arrival details */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Purchase Date</label>
              <input
                type="date"
                value={editForm.purchaseDate}
                disabled={editHasPayments}
                onChange={(e) => setEditForm({ ...editForm, purchaseDate: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg disabled:opacity-50"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Supplier / Grower *</label>
              <select
                value={editForm.supplierId}
                disabled={editHasPayments}
                onChange={(e) => setEditForm({ ...editForm, supplierId: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg disabled:opacity-50"
              >
                <option value="">Select Supplier...</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Supplier Challan / Bill #</label>
              <input
                type="text"
                value={editForm.supplierInvoiceNumber}
                onChange={(e) => setEditForm({ ...editForm, supplierInvoiceNumber: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Payment Mode</label>
              <select
                value={editForm.paymentMode}
                disabled={editHasPayments}
                onChange={(e) => setEditForm({ ...editForm, paymentMode: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg disabled:opacity-50"
              >
                <option value="CASH">CASH</option>
                <option value="CREDIT">CREDIT</option>
                <option value="BANK">BANK</option>
              </select>
            </div>
          </div>

          {/* Commission agent & logistics */}
          <div className="pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end">
            {!editHasPayments && (
              <label className="flex items-center gap-2 cursor-pointer pb-2">
                <input
                  type="checkbox"
                  checked={editForm.hasAgent}
                  onChange={(e) => setEditForm({ ...editForm, hasAgent: e.target.checked, agentId: e.target.checked ? editForm.agentId : '' })}
                  className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
                />
                <span className="font-bold text-slate-800">Commission Agent</span>
              </label>
            )}
            {editForm.hasAgent && !editHasPayments && (
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
                disabled={editHasPayments}
                onChange={(e) => setEditForm({ ...editForm, transporterId: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg disabled:opacity-50"
              >
                <option value="">None / Self</option>
                {transporters.map(t => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
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

          {/* Fruit items entry table */}
          <div className="pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <ShoppingBag className="w-4 h-4 text-brand-600" />
                Fruit Items on Bill ({editForm.items.length})
              </h3>
              {!editHasPayments && (
                <button
                  type="button"
                  onClick={addEditItemRow}
                  className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold transition"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Fruit Item
                </button>
              )}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100/70 text-slate-600 font-bold uppercase tracking-wider border-b border-slate-200">
                    <th className="p-2">Fruit Item</th>
                    <th className="p-2 w-20">Billed Qty</th>
                    <th className="p-2 w-16">Unit</th>
                    <th className="p-2 w-20">Kg/Unit</th>
                    <th className="p-2 w-20">Billed Wt</th>
                    <th className="p-2 w-24">Rate (₹)</th>
                    <th className="p-2 w-20">Disc (₹)</th>
                    <th className="p-2 w-24 text-right">Subtotal</th>
                    {!editHasPayments && <th className="p-2 w-8"></th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {editForm.items.map((row, idx) => {
                    const netKg = (parseFloat(row.billedQuantity || 0) * parseFloat(row.conversionFactor || 1)).toFixed(1);
                    const lineSub = (parseFloat(row.billedQuantity || 0) * parseFloat(row.ratePerUnit || 0) - parseFloat(row.discountAmount || 0)).toFixed(2);
                    return (
                      <tr key={idx}>
                        <td className="p-1">
                          <select
                            value={row.itemId}
                            disabled={editHasPayments}
                            onChange={(e) => handleEditItemChange(idx, 'itemId', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded-lg disabled:opacity-50"
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
                            value={row.billedQuantity}
                            disabled={editHasPayments}
                            onChange={(e) => handleEditItemChange(idx, 'billedQuantity', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right disabled:opacity-50"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={row.unit}
                            disabled={editHasPayments}
                            onChange={(e) => handleEditItemChange(idx, 'unit', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded-lg disabled:opacity-50"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="number" min="0" step="0.01"
                            value={row.conversionFactor}
                            disabled={editHasPayments}
                            onChange={(e) => handleEditItemChange(idx, 'conversionFactor', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right disabled:opacity-50"
                          />
                        </td>
                        <td className="p-1.5 text-center font-mono text-slate-600">{netKg} kg</td>
                        <td className="p-1">
                          <input
                            type="number" min="0" step="0.01"
                            value={row.ratePerUnit}
                            disabled={editHasPayments}
                            onChange={(e) => handleEditItemChange(idx, 'ratePerUnit', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right disabled:opacity-50"
                          />
                        </td>
                        <td className="p-1">
                          <input
                            type="number" min="0" step="0.01"
                            value={row.discountAmount}
                            disabled={editHasPayments}
                            onChange={(e) => handleEditItemChange(idx, 'discountAmount', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right disabled:opacity-50"
                          />
                        </td>
                        <td className="p-1.5 text-right font-mono font-bold text-slate-900">₹{parseFloat(lineSub).toLocaleString('en-IN')}</td>
                        {!editHasPayments && (
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
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Dedicated Defective Fruit Return & Refund to Supplier Section */}
          <div className="pt-4 border-t border-slate-100 bg-rose-50/30 rounded-xl p-4 border border-rose-100">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 mb-3">
              <div className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4 text-rose-600" />
                <h3 className="font-bold text-rose-900 uppercase tracking-wider text-xs">
                  Return Defective Fruit to Supplier (Per-Item Handler)
                </h3>
              </div>
              <p className="text-[11px] text-slate-500">
                When defective fruit is returned, stock quantity decreases by that amount and the corresponding cost is refunded from the supplier.
              </p>
            </div>

            <div className="overflow-x-auto bg-white rounded-lg border border-rose-200/60 shadow-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-rose-100/50 text-rose-900 font-bold uppercase tracking-wider border-b border-rose-200">
                    <th className="p-2">Fruit Item</th>
                    <th className="p-2 w-20">Billed Qty</th>
                    <th className="p-2 w-28">Defective Return Qty</th>
                    <th className="p-2 w-16">Unit</th>
                    <th className="p-2 w-24">Stock Decrease</th>
                    <th className="p-2 w-28 text-right">Refund Amount</th>
                    <th className="p-2 w-48">Return Reason / Damage Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {editForm.items.map((row, idx) => {
                    const itmName = row.itemId ? itemsList.find(i => i.id === parseInt(row.itemId))?.name : 'Item';
                    const itmVariety = row.itemId ? itemsList.find(i => i.id === parseInt(row.itemId))?.variety : '';
                    const returnQty = parseFloat(row.returnedQuantity || 0);
                    const conv = parseFloat(row.conversionFactor || 1);
                    const stockKg = (returnQty * conv).toFixed(1);
                    const billed = parseFloat(row.billedQuantity || 0);
                    const disc = parseFloat(row.discountAmount || 0);
                    const netUnitPrice = billed > 0 ? (billed * parseFloat(row.ratePerUnit || 0) - disc) / billed : parseFloat(row.ratePerUnit || 0);
                    const lineRefund = (returnQty * netUnitPrice).toFixed(2);
                    const isReturned = returnQty > 0;

                    return (
                      <tr key={idx} className={isReturned ? 'bg-rose-50/40' : ''}>
                        <td className="p-2 font-semibold text-slate-800">
                          {itmName} {itmVariety ? <span className="text-slate-500 text-[11px]">({itmVariety})</span> : ''}
                        </td>
                        <td className="p-2 font-mono text-slate-600">{row.billedQuantity} {row.unit}</td>
                        <td className="p-1">
                          <input
                            type="number"
                            min="0"
                            max={row.billedQuantity || 0}
                            step="any"
                            value={row.returnedQuantity ?? 0}
                            onChange={(e) => handleEditItemChange(idx, 'returnedQuantity', e.target.value)}
                            className="w-full p-1.5 bg-rose-50/60 border border-rose-300 rounded-lg font-mono text-right font-bold text-rose-700 focus:ring-2 focus:ring-rose-400 focus:outline-none"
                            placeholder="0"
                          />
                        </td>
                        <td className="p-2 font-mono text-slate-500">{row.unit || 'unit'}</td>
                        <td className="p-2 font-mono text-rose-700 font-semibold">
                          {isReturned ? `-${stockKg} kg` : '0 kg'}
                        </td>
                        <td className="p-2 text-right font-mono font-bold text-rose-700">
                          ₹{parseFloat(lineRefund).toLocaleString('en-IN')}
                        </td>
                        <td className="p-1">
                          <input
                            type="text"
                            value={row.returnReason || ''}
                            onChange={(e) => handleEditItemChange(idx, 'returnReason', e.target.value)}
                            className="w-full p-1.5 bg-slate-50 border border-slate-300 rounded-lg text-slate-700 placeholder:text-slate-400"
                            placeholder="e.g. Rotten / Defective / Damaged"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Live defective fruit return banner */}
            <div className="mt-3 p-2.5 bg-white border border-rose-200 rounded-lg flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2 text-rose-800">
                <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                <span>
                  <strong>Defective Return Summary:</strong> {editReturnQty} units ({editReturnKg.toFixed(1)} kg) returned to supplier.
                </span>
              </div>
              <div className="flex items-center gap-4 font-mono font-bold">
                <span className="text-slate-600">Stock Decreased: <strong className="text-rose-700">-{editReturnKg.toFixed(1)} kg</strong></span>
                <span className="text-slate-600">Supplier Refund: <strong className="text-emerald-700">₹{editReturnValue.toLocaleString('en-IN')}</strong></span>
              </div>
            </div>

            <div className="mt-2">
              <label className="block font-semibold text-slate-700 mb-1">Overall Return Remarks / Notes</label>
              <input
                type="text"
                value={editForm.returnReason}
                onChange={(e) => setEditForm({ ...editForm, returnReason: e.target.value })}
                className="w-full p-2 bg-white border border-slate-300 rounded-lg"
                placeholder="e.g. Defective fruit returned back to grower/supplier due to spoilage"
              />
            </div>
          </div>

          {/* Other charges, payment advance & notes */}
          <div className="pt-4 border-t border-slate-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Freight Charges (₹)</label>
              <input
                type="number" min="0" step="0.01"
                value={editForm.freightCharges}
                onChange={(e) => setEditForm({ ...editForm, freightCharges: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Loading / Palledar (₹)</label>
              <input
                type="number" min="0" step="0.01"
                value={editForm.loadingCharges}
                onChange={(e) => setEditForm({ ...editForm, loadingCharges: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Other Landed Charges (₹)</label>
              <input
                type="number" min="0" step="0.01"
                value={editForm.otherCharges}
                onChange={(e) => setEditForm({ ...editForm, otherCharges: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">
                {editHasPayments ? 'Paid Now — New Advance (₹)' : 'Paid Now (₹)'}
              </label>
              <input
                type="number" min="0" step="0.01"
                value={editForm.newAdvance}
                onChange={(e) => setEditForm({ ...editForm, newAdvance: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
              />
              {editHasPayments && (
                <p className="mt-1 text-[10px] text-slate-500">On record: ₹{parseFloat(editForm.recordedPaid || 0).toLocaleString('en-IN')}</p>
              )}
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Weight Loss Reason</label>
              <input
                type="text"
                value={editForm.weightVarianceReason}
                disabled={editHasPayments}
                onChange={(e) => setEditForm({ ...editForm, weightVarianceReason: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg disabled:opacity-50"
                placeholder="e.g. Weighbridge moisture variance"
              />
            </div>
            <div className="sm:col-span-2">
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
            {editDiscount > 0 && <span className="text-slate-500">Discount: <strong className="text-slate-900">-₹{editDiscount.toLocaleString('en-IN')}</strong></span>}
            {editReturnValue > 0 && <span className="text-rose-600">Supplier Refund: <strong>-₹{editReturnValue.toLocaleString('en-IN')}</strong></span>}
            {editCommission > 0 && <span className="text-slate-500">Commission: <strong className="text-slate-900">₹{editCommission.toLocaleString('en-IN')}</strong></span>}
            <span className="text-slate-500">Bill Total: <strong className="text-brand-700">₹{editTotal.toLocaleString('en-IN')}</strong></span>
            <span className="text-slate-500">Balance Due: <strong className="text-rose-700">₹{editDue.toLocaleString('en-IN')}</strong></span>
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
              {editSaving ? 'Saving...' : 'Save & Re-post Bill'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default PurchaseList;
