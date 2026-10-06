import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { useBranch } from '../../context/BranchContext';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/Common/DataTable';
import Badge from '../../components/Common/Badge';
import Modal from '../../components/Common/Modal';
import { useToast } from '../../components/Common/Toast';
import { exportToExcel } from '../../utils/excelExport';
import { 
  Boxes, AlertTriangle, ArrowRightLeft, Trash2, 
  Clock, Check, RefreshCw, Layers, Download 
} from 'lucide-react';

const StockOverview = () => {
  const { activeBranchId, branches } = useBranch();
  const { isOwner, user } = useAuth();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory', 'batches', 'transfers', 'wastage'

  // Default branch for entry forms: branch users are locked to their own
  // branch; owner defaults to the branch active in the navbar.
  const defaultFormBranchId = !isOwner && user?.branchId
    ? String(user.branchId)
    : (activeBranchId && activeBranchId !== 'all' ? activeBranchId : '1');
  
  const [stockList, setStockList] = useState([]);
  const [batchesList, setBatchesList] = useState([]);
  const [transfersList, setTransfersList] = useState([]);
  const [wastageList, setWastageList] = useState([]);
  const [itemsList, setItemsList] = useState([]);
  const [loading, setLoading] = useState(true);

  // Wastage Modal — guided 3-step flow
  const [isWastageOpen, setIsWastageOpen] = useState(false);
  const [wastageStep, setWastageStep] = useState(1); // 1: pick fruit, 2: qty & reason, 3: review
  const [wastageForm, setWastageForm] = useState({
    branchId: defaultFormBranchId,
    itemId: '',
    stockBatchId: '', // auto-selected via FIFO (oldest eligible batch)
    quantityKg: '',
    reason: 'Decay / Rotten in storage',
    actionTaken: 'Discarded / Dumped in Mandi compost',
    salvageRecoveryAmount: 0,
    notes: ''
  });
  const [wastageError, setWastageError] = useState('');
  const [wastageSubmitting, setWastageSubmitting] = useState(false);

  // Opens the guided wastage wizard fresh (step 1)
  const openWastageWizard = (presetBatchId = null) => {
    setWastageForm({
      branchId: defaultFormBranchId,
      itemId: '',
      stockBatchId: presetBatchId || '',
      quantityKg: '',
      reason: 'Decay / Rotten in storage',
      actionTaken: 'Discarded / Dumped in Mandi compost',
      salvageRecoveryAmount: 0,
      notes: ''
    });
    if (presetBatchId) {
      // Pre-select the fruit that belongs to the batch being written off
      const b = batchesList.find(x => x.id === parseInt(presetBatchId));
      setWastageForm(f => ({ ...f, itemId: b ? String(b.itemId) : '' }));
      setWastageStep(2);
    } else {
      setWastageStep(1);
    }
    setWastageError('');
    setIsWastageOpen(true);
  };

  // Transfer Modal
  const [isTransferOpen, setIsTransferOpen] = useState(false);
  const [transferForm, setTransferForm] = useState({
    fromBranchId: defaultFormBranchId,
    toBranchId: '',
    itemId: '',
    sourceBatchId: '',
    quantity: '',
    vehicleNumber: '',
    freightCost: 0,
    notes: ''
  });
  const [transferError, setTransferError] = useState('');
  const [transferSubmitting, setTransferSubmitting] = useState(false);

  const fetchData = async () => {
    try {
      setLoading(true);
      const [stkRes, batRes, trRes, wstRes, itmRes] = await Promise.all([
        api.getCached('/stock/overview', null, { maxAge: 10_000 }),
        api.getCached('/stock/batches', null, { maxAge: 10_000 }),
        api.getCached('/stock/transfers', null, { maxAge: 10_000 }),
        api.getCached('/stock/wastage', null, { maxAge: 10_000 }),
        api.getCached('/masters/items', null, { maxAge: 60_000 })
      ]);

      if (stkRes?.data?.success) setStockList(stkRes.data.stock);
      if (batRes?.data?.success) setBatchesList(batRes.data.batches);
      if (trRes?.data?.success) setTransfersList(trRes.data.transfers);
      if (wstRes?.data?.success) setWastageList(wstRes.data.entries);
      if (itmRes?.data?.success) setItemsList(itmRes.data.items);
    } catch (err) {
      console.error('Failed to load stock data', err);
      toast.error('Could not load stock data. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeBranchId]);

  // Handle Wastage Submit
  const handleWastageSubmit = async (e) => {
    e.preventDefault();
    setWastageError('');
    setWastageSubmitting(true);
    try {
      const res = await api.post('/stock/wastage', {
        branchId: parseInt(wastageForm.branchId),
        itemId: parseInt(wastageForm.itemId),
        stockBatchId: parseInt(wastageForm.stockBatchId),
        quantityKg: parseFloat(wastageForm.quantityKg),
        reason: wastageForm.reason,
        actionTaken: wastageForm.actionTaken,
        salvageRecoveryAmount: parseFloat(wastageForm.salvageRecoveryAmount || 0),
        notes: wastageForm.notes
      });
      if (res.data.success) {
        toast.success('Spoilage write-off recorded successfully');
        setIsWastageOpen(false);
        setWastageStep(1);
        fetchData();
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to record wastage';
      setWastageError(msg);
      toast.error('Could not record spoilage: ' + msg);
    } finally {
      setWastageSubmitting(false);
    }
  };

  // Handle Transfer Submit
  const handleTransferSubmit = async (e) => {
    e.preventDefault();
    setTransferError('');
    setTransferSubmitting(true);
    try {
      const res = await api.post('/stock/transfers', {
        fromBranchId: parseInt(transferForm.fromBranchId),
        toBranchId: parseInt(transferForm.toBranchId),
        itemId: parseInt(transferForm.itemId),
        sourceBatchId: parseInt(transferForm.sourceBatchId),
        quantity: parseFloat(transferForm.quantity),
        vehicleNumber: transferForm.vehicleNumber,
        freightCost: parseFloat(transferForm.freightCost || 0),
        notes: transferForm.notes
      });
      if (res.data.success) {
        toast.success('Stock transfer dispatched successfully');
        setIsTransferOpen(false);
        fetchData();
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to dispatch transfer';
      setTransferError(msg);
      toast.error('Could not dispatch transfer: ' + msg);
    } finally {
      setTransferSubmitting(false);
    }
  };

  const handleReceiveTransfer = async (transferId) => {
    if (!window.confirm('Confirm receipt of transfer at this destination branch?')) return;
    try {
      const res = await api.post(`/stock/transfers/${transferId}/receive`);
      if (res.data.success) {
        toast.success('Transfer received — stock added to your branch');
        fetchData();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not receive transfer. Please try again.');
    }
  };

  // Columns for Stock Overview
  const stockColumns = [
    {
      header: 'Branch',
      accessor: 'branchName',
      render: (row) => <span className="font-semibold text-slate-800 text-xs">{row.branchName}</span>
    },
    {
      header: 'Fruit Item',
      accessor: 'itemName',
      render: (row) => (
        <div>
          <span className="font-bold text-slate-900 block">{row.itemName}</span>
          <span className="text-[11px] text-slate-500">{row.variety || 'Standard Grade'}</span>
        </div>
      )
    },
    {
      header: 'Available Stock (Kg)',
      accessor: 'totalQuantityKg',
      render: (row) => (
        <div>
          <span className="font-bold font-mono text-sm text-slate-900">
            {row.totalQuantityKg?.toLocaleString('en-IN')} kg
          </span>
          <span className="text-[11px] text-slate-500 block">
            ≈ {row.quantityCrates} {row.packagingUnit || 'crates'}
          </span>
        </div>
      )
    },
    {
      header: 'Avg Landed Cost',
      accessor: 'averageCostPerKg',
      render: (row) => (
        <span className="font-mono text-xs text-slate-700">₹{row.averageCostPerKg} / kg</span>
      )
    },
    {
      header: 'Total Valuation',
      accessor: 'totalValuation',
      render: (row) => (
        <span className="font-bold font-mono text-xs text-brand-800">
          ₹{parseFloat(row.totalValuation || 0).toLocaleString('en-IN')}
        </span>
      )
    },
    {
      header: 'Reorder Status',
      accessor: 'isLowStock',
      render: (row) => (
        row.isLowStock ? (
          <span className="inline-flex items-center gap-1 text-[11px] font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
            <AlertTriangle className="w-3 h-3" /> Low Stock
          </span>
        ) : (
          <Badge variant="success">Sufficient Stock</Badge>
        )
      )
    }
  ];

  // Columns for Batches
  const batchColumns = [
    {
      header: 'Lot Number',
      accessor: 'batchNumber',
      render: (row) => <span className="font-mono font-bold text-brand-800 text-xs">{row.batchNumber}</span>
    },
    {
      header: 'Branch',
      accessor: 'branchName',
      render: (row) => <span className="text-xs text-slate-700">{row.branchName}</span>
    },
    {
      header: 'Fruit Item',
      accessor: 'itemName',
      render: (row) => (
        <div>
          <span className="font-semibold text-slate-900">{row.itemName}</span>
          <span className="text-[11px] text-slate-400 block">{row.variety}</span>
        </div>
      )
    },
    {
      header: 'Remaining Qty',
      accessor: 'currentQuantity',
      render: (row) => (
        <span className="font-mono font-bold text-xs text-slate-900">
          {row.currentQuantity} / {row.initialQuantity} {row.unit}
        </span>
      )
    },
    {
      header: 'Landed Cost',
      accessor: 'landedCostPerUnit',
      render: (row) => (
        <div className="font-mono text-xs">
          <span className="font-semibold text-slate-900">₹{row.landedCostPerUnit} / kg</span>
          {row.packagingUnit && row.packagingSizeKg ? (
            <span className="text-[10px] text-slate-400 block">
              ≈ ₹{(row.landedCostPerUnit * row.packagingSizeKg).toFixed(0)} / {row.packagingUnit} ({row.packagingSizeKg} kg)
            </span>
          ) : null}
        </div>
      )
    },
    {
      header: 'Received Date / Age',
      accessor: 'receivedDate',
      render: (row) => (
        <div className="text-xs">
          <span>{row.receivedDate}</span>
          <span className={`text-[10px] block font-semibold ${row.isNearExpiry ? 'text-rose-600' : 'text-slate-400'}`}>
            Age: {row.ageDays} days {row.isNearExpiry ? '⚠️ Near Expiry' : ''}
          </span>
        </div>
      )
    },
    {
      header: 'Status',
      accessor: 'status',
      render: (row) => (
        <div className="flex items-center gap-2">
          <Badge variant={row.status}>{row.status}</Badge>
          {parseFloat(row.currentQuantity) > 0 && (
            <button
              onClick={() => openWastageWizard(String(row.id))}
              className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-600 bg-rose-50 border border-rose-200 px-2 py-1 rounded-lg hover:bg-rose-100 transition"
              title="Write off spoilage from this batch"
            >
              <Trash2 className="w-3 h-3" />
              Write-off
            </button>
          )}
        </div>
      )
    }
  ];

  // Filter batches available for wastage (oldest first — FIFO)
  const eligibleWastageBatches = batchesList.filter(b => 
    b.status === 'ACTIVE' && 
    (!wastageForm.itemId || b.itemId === parseInt(wastageForm.itemId)) &&
    b.branchId === parseInt(wastageForm.branchId)
  ).sort((a, b) => new Date(a.receivedDate) - new Date(b.receivedDate));

  // The batch the wizard is currently acting on
  const activeWastageBatch = eligibleWastageBatches.find(b => b.id === parseInt(wastageForm.stockBatchId))
    || batchesList.find(b => b.id === parseInt(wastageForm.stockBatchId));

  const wastageQtyNum = parseFloat(wastageForm.quantityKg) || 0;
  const wastageGrossLoss = activeWastageBatch
    ? wastageQtyNum * parseFloat(activeWastageBatch.landedCostPerUnit || 0)
    : 0;
  const wastageNetLoss = Math.max(0, wastageGrossLoss - (parseFloat(wastageForm.salvageRecoveryAmount) || 0));

  // Quick qty chips relative to the selected batch
  const wastageChips = activeWastageBatch ? (() => {
    const avail = parseFloat(activeWastageBatch.currentQuantity || 0);
    return [
      { label: '5 kg', val: Math.min(5, avail) },
      { label: '10 kg', val: Math.min(10, avail) },
      { label: '25 kg', val: Math.min(25, avail) },
      { label: '50%', val: +(avail * 0.5).toFixed(1) },
      { label: 'All', val: avail }
    ];
  })() : [];

  // Filter batches available for transfer
  const eligibleTransferBatches = batchesList.filter(b => 
    b.status === 'ACTIVE' && 
    b.branchId === parseInt(transferForm.fromBranchId) &&
    (!transferForm.itemId || b.itemId === parseInt(transferForm.itemId))
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Boxes className="w-6 h-6 text-brand-600" />
            Stock, Batches & Perishability Management
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Real-time warehouse inventory, FIFO batch lots, inter-branch transfers, and spoilage write-off.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => {
              const sheets = [
                { name: 'Stock Overview', rows: stockList.map(s => ({
                  Branch: s.branchName, Item: s.itemName, Variety: s.variety,
                  'Qty (kg)': s.totalQuantityKg, 'Packs': s.quantityCrates,
                  'Avg Cost/kg': s.averageCostPerKg, Valuation: s.totalValuation,
                  'Low Stock': s.isLowStock ? 'YES' : ''
                })) },
                { name: 'Batches', rows: batchesList.map(b => ({
                  Batch: b.batchNumber, Branch: b.branchName, Item: b.itemName,
                  'Current (kg)': b.currentQuantity, 'Initial (kg)': b.initialQuantity,
                  'Cost/kg': b.landedCostPerUnit, Valuation: b.valuation,
                  Received: b.receivedDate, Expiry: b.expiryDate || '',
                  'Age (days)': b.ageDays, Status: b.status
                })) },
                { name: 'Wastage', rows: wastageList.map(w => ({
                  Date: w.entryDate, Item: w.item?.name, Branch: w.branch?.name,
                  'Qty (kg)': w.quantityKg, Reason: w.reason,
                  'Loss Amount': w.totalLossAmount, Action: w.actionTaken
                })) }
              ];
              exportToExcel(sheets, 'stock-report');
            }}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm transition"
            title="Download stock report as Excel"
          >
            <Download className="w-3.5 h-3.5" />
            Excel
          </button>
          <button
            onClick={() => openWastageWizard()}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold shadow-sm transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Write-off Spoilage
          </button>

          <button
            onClick={() => setIsTransferOpen(true)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg text-xs font-bold shadow-sm transition"
          >
            <ArrowRightLeft className="w-3.5 h-3.5" />
            Stock Transfer
          </button>
        </div>
      </div>

      {/* Tabs — pill chips: one clean row on every screen size */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 scrollbar-none">
        {[
          ['inventory', 'Overview', stockList.length, Boxes],
          ['batches', 'Batches', batchesList.length, Layers],
          ['transfers', 'Transfers', transfersList.length, ArrowRightLeft],
          ['wastage', 'Spoilage', wastageList.length, Trash2]
        ].map(([key, label, count, Icon]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2 rounded-full text-xs font-bold whitespace-nowrap transition border ${
              activeTab === key
                ? 'bg-slate-900 text-white border-slate-900 shadow-sm'
                : 'bg-white text-slate-600 border-slate-300 hover:bg-slate-50'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
              activeTab === key ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              {count}
            </span>
          </button>
        ))}
      </div>

      {/* Tab 1: Stock Overview */}
      {activeTab === 'inventory' && (
        <DataTable
          columns={stockColumns}
          data={stockList}
          searchPlaceholder="Search by item, branch or variety..."
          searchKey={(item, term) =>
            item.itemName?.toLowerCase().includes(term) ||
            item.branchName?.toLowerCase().includes(term) ||
            item.variety?.toLowerCase().includes(term)
          }
        />
      )}

      {/* Tab 2: Batches */}
      {activeTab === 'batches' && (
        <DataTable
          columns={batchColumns}
          data={batchesList}
          searchPlaceholder="Search lot number or fruit..."
          searchKey={(b, term) =>
            b.batchNumber?.toLowerCase().includes(term) ||
            b.itemName?.toLowerCase().includes(term) ||
            b.branchName?.toLowerCase().includes(term)
          }
        />
      )}

      {/* Tab 3: Transfers */}
      {activeTab === 'transfers' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider border-b border-slate-200">
                  <th className="p-3">Transfer #</th>
                  <th className="p-3">From Branch</th>
                  <th className="p-3">To Branch</th>
                  <th className="p-3">Fruit Item</th>
                  <th className="p-3">Quantity</th>
                  <th className="p-3">Vehicle</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {transfersList.map((tr) => (
                  <tr key={tr.id} className="hover:bg-slate-50">
                    <td className="p-3 font-mono font-bold text-brand-700">{tr.transferNumber}</td>
                    <td className="p-3">{tr.fromBranch?.name}</td>
                    <td className="p-3 font-semibold">{tr.toBranch?.name}</td>
                    <td className="p-3">{tr.item?.name}</td>
                    <td className="p-3 font-mono font-bold">{tr.quantity} {tr.unit}</td>
                    <td className="p-3 font-mono uppercase text-slate-500">{tr.vehicleNumber || 'Self'}</td>
                    <td className="p-3"><Badge variant={tr.status}>{tr.status}</Badge></td>
                    <td className="p-3">
                      {tr.status === 'IN_TRANSIT' ? (
                        <button
                          onClick={() => handleReceiveTransfer(tr.id)}
                          className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-700 text-white rounded font-bold transition flex items-center gap-1"
                        >
                          <Check className="w-3 h-3" /> Receive
                        </button>
                      ) : (
                        <span className="text-slate-400">Completed</span>
                      )}
                    </td>
                  </tr>
                ))}
                {transfersList.length === 0 && (
                  <tr>
                    <td colSpan={8} className="text-center py-10 text-slate-400">No stock transfers found.</td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </div>
        </div>
      )}

      {/* Tab 4: Spoilage / Wastage Entries */}
      {activeTab === 'wastage' && (
        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
          <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider border-b border-slate-200">
                <th className="p-3">Wastage #</th>
                <th className="p-3">Date</th>
                <th className="p-3">Branch</th>
                <th className="p-3">Fruit Item</th>
                <th className="p-3">Batch Lot</th>
                <th className="p-3 text-right">Spoiled Qty</th>
                <th className="p-3 text-right">Financial Loss</th>
                <th className="p-3">Reason</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {wastageList.map((wst) => (
                <tr key={wst.id} className="hover:bg-slate-50">
                  <td className="p-3 font-mono font-bold text-rose-700">{wst.entryNumber}</td>
                  <td className="p-3 text-slate-500">{wst.entryDate}</td>
                  <td className="p-3">{wst.branch?.name}</td>
                  <td className="p-3 font-semibold text-slate-900">{wst.item?.name}</td>
                  <td className="p-3 font-mono text-[11px] text-slate-600">{wst.batch?.batchNumber}</td>
                  <td className="p-3 text-right font-mono font-bold text-rose-700">{wst.quantityKg} kg</td>
                  <td className="p-3 text-right font-mono font-bold text-slate-900">₹{parseFloat(wst.totalLossAmount).toLocaleString('en-IN')}</td>
                  <td className="p-3 text-slate-600 max-w-xs truncate">{wst.reason}</td>
                </tr>
              ))}
              {wastageList.length === 0 && (
                <tr>
                  <td colSpan={8} className="text-center py-10 text-slate-400">No spoilage write-offs logged.</td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </div>
      )}

      {/* Wastage / Spoilage Modal — guided 3-step flow */}
      <Modal
        isOpen={isWastageOpen}
        onClose={() => { setIsWastageOpen(false); setWastageStep(1); }}
        title="Fruit Spoilage Write-Off"
      >
        {/* Step indicator */}
        <div className="flex items-center gap-1 mb-5">
          {['Fruit', 'Quantity & Reason', 'Review'].map((label, i) => {
            const n = i + 1;
            return (
              <React.Fragment key={n}>
                {i > 0 && <div className={`flex-1 h-0.5 rounded ${wastageStep >= n ? 'bg-rose-400' : 'bg-slate-200'}`} />}
                <div className="flex items-center gap-1.5">
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black transition ${
                    wastageStep > n ? 'bg-emerald-500 text-white'
                      : wastageStep === n ? 'bg-rose-600 text-white'
                      : 'bg-slate-200 text-slate-500'
                  }`}>
                    {wastageStep > n ? '✓' : n}
                  </span>
                  <span className={`text-[10px] font-bold uppercase tracking-wide hidden sm:inline ${wastageStep === n ? 'text-slate-900' : 'text-slate-400'}`}>{label}</span>
                </div>
              </React.Fragment>
            );
          })}
        </div>

        {wastageError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg">
            {wastageError}
          </div>
        )}

        {/* ============ STEP 1: Pick the fruit (FIFO auto-batch) ============ */}
        {wastageStep === 1 && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Branch</label>
                <select
                  value={wastageForm.branchId}
                  onChange={(e) => setWastageForm({ ...wastageForm, branchId: e.target.value, itemId: '', stockBatchId: '' })}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900"
                >
                  {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Which fruit is spoiled?</label>
                <select
                  value={wastageForm.itemId}
                  onChange={(e) => setWastageForm({ ...wastageForm, itemId: e.target.value, stockBatchId: '' })}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900"
                >
                  <option value="">Select Fruit...</option>
                  {itemsList.map(i => {
                    const hasStock = batchesList.some(b => b.itemId === i.id && b.branchId === parseInt(wastageForm.branchId) && b.status === 'ACTIVE' && parseFloat(b.currentQuantity) > 0);
                    return (
                      <option key={i.id} value={i.id} disabled={!hasStock}>
                        {i.name} ({i.variety || ''}){hasStock ? '' : ' — no stock'}
                      </option>
                    );
                  })}
                </select>
              </div>
            </div>

            {wastageForm.itemId && (
              <div>
                <p className="font-bold text-slate-700 mb-2">Affected batches (oldest first — FIFO writes off from here):</p>
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {eligibleWastageBatches.length === 0 && (
                    <p className="text-slate-400 text-center py-4">No active stock batches for this fruit in this branch.</p>
                  )}
                  {eligibleWastageBatches.map((b, i) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => setWastageForm({ ...wastageForm, stockBatchId: String(b.id) })}
                      className={`w-full text-left p-3 rounded-xl border-2 transition ${
                        parseInt(wastageForm.stockBatchId) === b.id
                          ? 'border-rose-400 bg-rose-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-mono font-bold text-[11px] text-brand-800">{b.batchNumber}</span>
                          {i === 0 && <span className="ml-2 text-[9px] font-black uppercase bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">FIFO — oldest</span>}
                        </div>
                        <span className="font-mono text-xs font-bold text-slate-900">{b.currentQuantity} kg</span>
                      </div>
                      <div className="flex items-center justify-between mt-1 text-[10px] text-slate-500">
                        <span>₹{b.landedCostPerUnit}/kg • received {b.receivedDate} ({b.ageDays}d old)</span>
                        {b.isNearExpiry && <span className="text-rose-600 font-bold">⚠ near expiry</span>}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="pt-4 border-t border-slate-200 flex justify-end gap-2">
              <button type="button" onClick={() => setIsWastageOpen(false)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold">Cancel</button>
              <button
                type="button"
                disabled={!wastageForm.stockBatchId}
                onClick={() => setWastageStep(2)}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold shadow-sm disabled:opacity-40"
              >
                Next: Quantity →
              </button>
            </div>
          </div>
        )}

        {/* ============ STEP 2: How much & why ============ */}
        {wastageStep === 2 && activeWastageBatch && (
          <div className="space-y-4 text-xs">
            <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between">
              <div>
                <span className="font-mono font-bold text-[11px] text-brand-800">{activeWastageBatch.batchNumber}</span>
                <span className="text-slate-500 block text-[10px]">{activeWastageBatch.itemName} • ₹{activeWastageBatch.landedCostPerUnit}/kg</span>
              </div>
              <span className="font-mono font-bold text-slate-900">{activeWastageBatch.currentQuantity} kg avail.</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Quantity Spoiled (Kg)</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max={activeWastageBatch.currentQuantity}
                required
                value={wastageForm.quantityKg}
                onChange={(e) => setWastageForm({ ...wastageForm, quantityKg: e.target.value })}
                placeholder="e.g. 25"
                className="w-full p-3 bg-slate-50 border-2 border-slate-300 rounded-lg font-mono font-black text-base text-center"
              />
              <div className="flex flex-wrap gap-1.5 mt-2">
                {wastageChips.map(c => (
                  <button
                    key={c.label}
                    type="button"
                    onClick={() => setWastageForm({ ...wastageForm, quantityKg: String(c.val) })}
                    className="px-2.5 py-1 rounded-full border border-slate-300 bg-white hover:bg-slate-100 text-[11px] font-bold text-slate-600 transition"
                  >
                    {c.label}
                  </button>
                ))}
              </div>
              {wastageQtyNum > parseFloat(activeWastageBatch.currentQuantity) && (
                <p className="mt-2 text-rose-600 font-bold">Cannot exceed available {activeWastageBatch.currentQuantity} kg</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Spoilage Reason</label>
                <select
                  value={wastageForm.reason}
                  onChange={(e) => setWastageForm({ ...wastageForm, reason: e.target.value })}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
                >
                  <option value="Decay / Rotten in storage">Decay / Rotten in storage</option>
                  <option value="Transit Bruising & Softness">Transit Bruising & Softness</option>
                  <option value="Over-ripe / Senescence">Over-ripe / Senescence</option>
                  <option value="Cold Storage Freeze Injury">Cold Storage Freeze Injury</option>
                  <option value="Pest / Bird Damage">Pest / Bird Damage</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Action Taken</label>
                <select
                  value={wastageForm.actionTaken}
                  onChange={(e) => setWastageForm({ ...wastageForm, actionTaken: e.target.value })}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
                >
                  <option value="Discarded / Dumped in Mandi compost">Discarded / composted</option>
                  <option value="Sold to juice vendor at salvage value">Sold to juice vendor</option>
                  <option value="Returned to grower claim">Returned to grower (claim)</option>
                </select>
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Salvage Cash Recovery (₹)</label>
                <input
                  type="number"
                  min="0"
                  value={wastageForm.salvageRecoveryAmount}
                  onChange={(e) => setWastageForm({ ...wastageForm, salvageRecoveryAmount: e.target.value })}
                  placeholder="0"
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Notes (optional)</label>
                <input
                  type="text"
                  value={wastageForm.notes}
                  onChange={(e) => setWastageForm({ ...wastageForm, notes: e.target.value })}
                  placeholder="Inspector remarks..."
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
                />
              </div>
            </div>

            {/* Live loss preview */}
            <div className="p-3 rounded-lg bg-rose-50 border border-rose-200 flex items-center justify-between">
              <span className="text-[11px] font-bold text-rose-700 uppercase tracking-wide">Estimated net loss</span>
              <span className="font-mono font-black text-rose-800">
                ₹{wastageNetLoss.toFixed(2)}
                {parseFloat(wastageForm.salvageRecoveryAmount) > 0 && (
                  <span className="text-[10px] font-semibold text-slate-500 block text-right">
                    (₹{wastageGrossLoss.toFixed(2)} − ₹{parseFloat(wastageForm.salvageRecoveryAmount).toFixed(2)} salvage)
                  </span>
                )}
              </span>
            </div>

            <div className="pt-4 border-t border-slate-200 flex justify-between gap-2">
              <button type="button" onClick={() => setWastageStep(1)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold">← Back</button>
              <button
                type="button"
                disabled={!wastageQtyNum || wastageQtyNum > parseFloat(activeWastageBatch.currentQuantity)}
                onClick={() => setWastageStep(3)}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold shadow-sm disabled:opacity-40"
              >
                Review →
              </button>
            </div>
          </div>
        )}

        {/* ============ STEP 3: Review & confirm ============ */}
        {wastageStep === 3 && activeWastageBatch && (
          <form onSubmit={handleWastageSubmit} className="space-y-4 text-xs">
            <div className="p-4 rounded-xl border-2 border-rose-200 bg-rose-50/50 space-y-2">
              <div className="flex justify-between"><span className="text-slate-500 font-semibold">Fruit</span><span className="font-bold text-slate-900">{activeWastageBatch.itemName} ({activeWastageBatch.variety || 'Std'})</span></div>
              <div className="flex justify-between"><span className="text-slate-500 font-semibold">Batch</span><span className="font-mono font-bold text-brand-800">{activeWastageBatch.batchNumber}</span></div>
              <div className="flex justify-between"><span className="text-slate-500 font-semibold">Quantity</span><span className="font-mono font-black text-rose-700">{wastageQtyNum} kg</span></div>
              <div className="flex justify-between"><span className="text-slate-500 font-semibold">Reason</span><span className="font-semibold text-slate-900 text-right max-w-[60%]">{wastageForm.reason}</span></div>
              <div className="flex justify-between"><span className="text-slate-500 font-semibold">Action</span><span className="font-semibold text-slate-900 text-right max-w-[60%]">{wastageForm.actionTaken}</span></div>
              {parseFloat(wastageForm.salvageRecoveryAmount) > 0 && (
                <div className="flex justify-between"><span className="text-slate-500 font-semibold">Salvage recovery</span><span className="font-mono font-bold text-emerald-700">₹{parseFloat(wastageForm.salvageRecoveryAmount).toFixed(2)}</span></div>
              )}
              <div className="flex justify-between pt-2 border-t border-rose-200">
                <span className="font-bold text-rose-700 uppercase">Net loss to ledger</span>
                <span className="font-mono font-black text-rose-800">₹{wastageNetLoss.toFixed(2)}</span>
              </div>
            </div>

            <p className="text-[11px] text-slate-500 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
              This deducts {wastageQtyNum} kg from FIFO stock and posts the loss to the immutable audit ledger. It cannot be edited afterwards.
            </p>

            <div className="pt-4 border-t border-slate-200 flex justify-between gap-2">
              <button type="button" onClick={() => setWastageStep(2)} className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold">← Back</button>
              <button
                type="submit"
                disabled={wastageSubmitting}
                className="px-5 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold shadow-sm disabled:opacity-60"
              >
                {wastageSubmitting ? 'Logging Loss...' : '✓ Confirm Write-Off'}
              </button>
            </div>
          </form>
        )}
      </Modal>

      {/* Transfer Modal */}
      <Modal
        isOpen={isTransferOpen}
        onClose={() => setIsTransferOpen(false)}
        title="Inter-Branch Stock Transfer"
      >
        {transferError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg">
            {transferError}
          </div>
        )}

        <form onSubmit={handleTransferSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">From Branch (Source)</label>
              <select
                value={transferForm.fromBranchId}
                onChange={(e) => setTransferForm({ ...transferForm, fromBranchId: e.target.value, sourceBatchId: '' })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              >
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">To Branch (Destination)</label>
              <select
                required
                value={transferForm.toBranchId}
                onChange={(e) => setTransferForm({ ...transferForm, toBranchId: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              >
                <option value="">Select Destination...</option>
                {branches
                  .filter(b => b.id !== parseInt(transferForm.fromBranchId))
                  .map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Fruit Item</label>
              <select
                required
                value={transferForm.itemId}
                onChange={(e) => setTransferForm({ ...transferForm, itemId: e.target.value, sourceBatchId: '' })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              >
                <option value="">Select Fruit...</option>
                {itemsList.map(i => <option key={i.id} value={i.id}>{i.name} ({i.variety || ''})</option>)}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Transfer Qty (Kg)</label>
              <input
                type="number"
                step="0.5"
                min="0.5"
                required
                value={transferForm.quantity}
                onChange={(e) => setTransferForm({ ...transferForm, quantity: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Source Batch Lot to Dispatch From</label>
              <select
                required
                value={transferForm.sourceBatchId}
                onChange={(e) => setTransferForm({ ...transferForm, sourceBatchId: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
              >
                <option value="">Select Lot / Batch...</option>
                {eligibleTransferBatches.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.batchNumber} — Avail: {b.currentQuantity} kg @ ₹{b.landedCostPerUnit}/kg (Recvd: {b.receivedDate})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Transfer Truck No.</label>
              <input
                type="text"
                value={transferForm.vehicleNumber}
                onChange={(e) => setTransferForm({ ...transferForm, vehicleNumber: e.target.value })}
                placeholder="HP-01-AA-4582"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono uppercase"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Inter-Branch Freight (₹)</label>
              <input
                type="number"
                min="0"
                value={transferForm.freightCost}
                onChange={(e) => setTransferForm({ ...transferForm, freightCost: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsTransferOpen(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={transferSubmitting}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold shadow-sm"
            >
              {transferSubmitting ? 'Dispatching...' : 'Dispatch Transfer'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default StockOverview;
