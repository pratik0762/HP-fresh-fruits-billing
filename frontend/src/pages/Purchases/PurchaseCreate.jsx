import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useBranch } from '../../context/BranchContext';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/Common/Modal';
import { useToast } from '../../components/Common/Toast';
import { buildUnitOptions } from '../../constants/units';
import { Plus, Trash2, ArrowLeft, Calculator, Truck, UserCheck, Scale, Check, UserPlus, AlertCircle } from 'lucide-react';

const PurchaseCreate = () => {
  const navigate = useNavigate();
  const { activeBranchId, branches } = useBranch();
  const { isOwner, user } = useAuth();
  const toast = useToast();

  // Masters
  const [suppliers, setSuppliers] = useState([]);
  const [itemsList, setItemsList] = useState([]);
  // Unit dropdown mirrors the Packaging Unit list from the item master
  const unitOptions = buildUnitOptions(itemsList);
  const [agents, setAgents] = useState([]);
  const [transporters, setTransporters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Quick-add supplier modal
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickSupplier, setQuickSupplier] = useState({ name: '', phone: '', address: '', gstNumber: '' });
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState('');

  // Form State
  // Receiving branch defaults to the logged-in branch; non-owners are locked
  // to it (the backend overrides branchId for non-owners regardless).
  const [branchId, setBranchId] = useState(
    !isOwner && user?.branchId ? String(user.branchId) : (activeBranchId === 'all' ? '1' : activeBranchId)
  );
  const branchLocked = !isOwner && !!user?.branchId;
  const [supplierId, setSupplierId] = useState('');
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().split('T')[0]);
  
  // Commission Agent
  const [hasAgent, setHasAgent] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [agentCommissionRate, setAgentCommissionRate] = useState(5.0);

  // Logistics
  const [transporterId, setTransporterId] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [freightCharges, setFreightCharges] = useState(0);
  const [loadingCharges, setLoadingCharges] = useState(0);
  const [otherCharges, setOtherCharges] = useState(0);

  // Weight Variance
  const [totalBilledWeight, setTotalBilledWeight] = useState('');
  const [totalReceivedWeight, setTotalReceivedWeight] = useState('');
  const [weightVarianceReason, setWeightVarianceReason] = useState('Moisture shrinkage & drying in transit');

  // Payment — cash on the mandi gate is the normal case
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [paidAmount, setPaidAmount] = useState(0);
  const [notes, setNotes] = useState('');

  // Line items — a single BILLED quantity per line. Actual received weight is
  // captured once in the weighbridge reconciliation section below.
  const [items, setItems] = useState([
    {
      itemId: '',
      billedQuantity: 100,
      unit: 'crate',
      conversionFactor: 20, // 20 kg per crate
      ratePerUnit: 1200,
      discountAmount: 0
    }
  ]);

  useEffect(() => {
    const loadMasters = async () => {
      try {
        const [suppRes, itmRes, agRes, trRes] = await Promise.all([
          api.get('/masters/suppliers'),
          api.get('/masters/items'),
          api.get('/masters/agents'),
          api.get('/masters/transporters')
        ]);
        if (suppRes.data.success) setSuppliers(suppRes.data.suppliers);
        if (itmRes.data.success) setItemsList(itmRes.data.items);
        if (agRes.data.success) setAgents(agRes.data.agents);
        if (trRes.data.success) setTransporters(trRes.data.transporters);

        if (itmRes.data.items.length > 0) {
          const firstItm = itmRes.data.items[0];
          setItems([
            {
              itemId: firstItm.id,
              billedQuantity: 100,
              unit: firstItm.packagingUnit || 'crate',
              conversionFactor: parseFloat(firstItm.unitConversionFactor || 20),
              ratePerUnit: 1200,
              discountAmount: 0
            }
          ]);
        }
      } catch (err) {
        console.error('Failed to load masters', err);
        toast.error('Could not load suppliers & items. Please refresh the page.');
      }
    };
    loadMasters();
  }, []);

  const handleQuickAddSupplier = async (e) => {
    e.preventDefault();
    setQuickSaving(true);
    setQuickError('');
    try {
      const res = await api.post('/masters/suppliers', quickSupplier);
      if (res.data.success) {
        toast.success('Supplier added successfully');
        const newSupp = res.data.supplier;
        setSuppliers(prev => [...prev, newSupp].sort((a, b) => a.name.localeCompare(b.name)));
        setSupplierId(String(newSupp.id)); // auto-select the newly created supplier
        setIsQuickAddOpen(false);
        setQuickSupplier({ name: '', phone: '', address: '', gstNumber: '' });
      }
    } catch (err) {
      setQuickError(err.response?.data?.message || err.message || 'Failed to create supplier');
      toast.error('Could not save supplier. Please check the details.');
    } finally {
      setQuickSaving(false);
    }
  };

  const handleItemChange = (index, field, value) => {
    const updated = [...items];
    updated[index][field] = value;

    if (field === 'itemId') {
      const selected = itemsList.find(i => i.id === parseInt(value));
      if (selected) {
        updated[index].unit = selected.packagingUnit || 'crate';
        updated[index].conversionFactor = parseFloat(selected.unitConversionFactor || 1);
      }
    }

    // Loose-kg entry: conversion is 1 kg per unit (NOT the pack size), same as sales
    if (field === 'unit') {
      const selected = itemsList.find(i => i.id === parseInt(updated[index].itemId));
      const packFactor = selected ? parseFloat(selected.unitConversionFactor || 1) : 1;
      const unitLc = String(value).toLowerCase();
      if (unitLc === 'kg') {
        updated[index].conversionFactor = 1;
      } else if (unitLc === 'grams' || unitLc === 'g') {
        updated[index].conversionFactor = 0.001;
      } else if (unitLc === 'tons' || unitLc === 'ton') {
        updated[index].conversionFactor = 1000;
      } else if (unitLc === 'quintal') {
        updated[index].conversionFactor = 100;
      } else if (selected) {
        updated[index].conversionFactor = packFactor;
      }
    }

    setItems(updated);
  };

  const addItemRow = () => {
    const defaultItem = itemsList[0];
    setItems([
      ...items,
      {
        itemId: defaultItem ? defaultItem.id : '',
        billedQuantity: 50,
        unit: defaultItem ? defaultItem.packagingUnit || 'crate' : 'crate',
        conversionFactor: defaultItem ? parseFloat(defaultItem.unitConversionFactor || 20) : 20,
        ratePerUnit: 1000,
        discountAmount: 0
      }
    ]);
  };

  const removeItemRow = (index) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  // Calculations — subtotal uses the single billed quantity; computed weight
  // is the billed weight (actual received weight comes from the weighbridge box).
  let grossSubtotal = 0;
  let totalDiscount = 0;
  let computedReceivedWeightKg = 0;

  items.forEach(itm => {
    const q = parseFloat(itm.billedQuantity || 0);
    const rate = parseFloat(itm.ratePerUnit || 0);
    const disc = parseFloat(itm.discountAmount || 0);
    const conv = parseFloat(itm.conversionFactor || 1);
    grossSubtotal += (q * rate);
    totalDiscount += disc;
    computedReceivedWeightKg += (q * conv);
  });

  const netSubtotal = Math.max(0, grossSubtotal - totalDiscount);
  const billedWeightVal = totalBilledWeight !== '' ? parseFloat(totalBilledWeight) : computedReceivedWeightKg;
  const receivedWeightVal = totalReceivedWeight !== '' ? parseFloat(totalReceivedWeight) : billedWeightVal;
  const weightVarianceDiff = Math.max(0, billedWeightVal - receivedWeightVal);

  const numFreight = parseFloat(freightCharges) || 0;
  const numLoading = parseFloat(loadingCharges) || 0;
  const numOther = parseFloat(otherCharges) || 0;

  let commissionAmt = 0;
  if (hasAgent && agentId) {
    commissionAmt = parseFloat(((netSubtotal * parseFloat(agentCommissionRate || 0)) / 100).toFixed(2));
  }

  const grandTotal = netSubtotal; // Fruit value (net supplier bill)
  // Bill total = fruit cost + transportation & other landed charges
  // (e.g. fruit ₹1,000 + transport ₹500 → bill total ₹1,500)
  const totalLandedCost = parseFloat((grandTotal + numFreight + numLoading + numOther + commissionAmt).toFixed(2));
  const dueAmt = Math.max(0, totalLandedCost - (parseFloat(paidAmount) || 0));
  const avgLandedPerKg = receivedWeightVal > 0 ? (totalLandedCost / receivedWeightVal).toFixed(2) : 0;

  // Immediate paid can never exceed the total landed lot cost — clamp on input.
  const paidTouchedRef = useRef(false);
  const handlePaidChange = (value) => {
    paidTouchedRef.current = true;
    const val = parseFloat(value);
    if (!isNaN(val) && val > totalLandedCost) {
      setPaidAmount(totalLandedCost);
      toast.warning(`Immediate paid cannot exceed the bill total (₹${totalLandedCost.toLocaleString('en-IN')})`);
    } else {
      setPaidAmount(value);
    }
  };

  // Cash settlements default to paying the FULL landed lot cost (bill +
  // transport charges); Credit (on account) pays nothing now. Manual edits
  // win until the payment mode is changed again.
  useEffect(() => {
    if (paymentMode === 'CREDIT') {
      paidTouchedRef.current = false;
      setPaidAmount(0);
    } else if (!paidTouchedRef.current) {
      setPaidAmount(totalLandedCost);
    }
  }, [paymentMode, totalLandedCost]);

  const payFull = () => {
    if (paymentMode === 'CREDIT') {
      paidTouchedRef.current = false;
      setPaymentMode('CASH');
    } else {
      paidTouchedRef.current = true;
      setPaidAmount(totalLandedCost);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!supplierId) {
      setError('Please select a supplier');
      toast.warning('Please select a supplier first');
      return;
    }
    if (!items.length || items.some(i => !i.itemId)) {
      setError('Please select valid items for all lines');
      toast.warning('Please choose a fruit for every line');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const payload = {
        branchId: parseInt(branchId),
        supplierId: parseInt(supplierId),
        supplierInvoiceNumber,
        purchaseDate,
        hasAgent,
        agentId: hasAgent && agentId ? parseInt(agentId) : null,
        agentCommissionRate: parseFloat(agentCommissionRate || 0),
        transporterId: transporterId ? parseInt(transporterId) : null,
        vehicleNumber,
        freightCharges: numFreight,
        loadingCharges: numLoading,
        otherCharges: numOther,
        totalBilledWeight: billedWeightVal,
        totalReceivedWeight: receivedWeightVal,
        weightVarianceReason: weightVarianceDiff > 0 ? weightVarianceReason : '',
        paymentMode,
        paidAmount: parseFloat(paidAmount || 0),
        notes,
        items: items.map(itm => ({
          itemId: parseInt(itm.itemId),
          billedQuantity: parseFloat(itm.billedQuantity),
          receivedQuantity: parseFloat(itm.billedQuantity), // single-qty entry; weighbridge section governs received weight
          unit: itm.unit,
          conversionFactor: parseFloat(itm.conversionFactor),
          ratePerUnit: parseFloat(itm.ratePerUnit),
          discountAmount: parseFloat(itm.discountAmount || 0)
        }))
      };

      const res = await api.post('/purchases', payload);
      if (res.data.success) {
        toast.success('Purchase entry saved successfully');
        navigate('/purchases');
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to create purchase entry';
      setError(msg);
      toast.error('Could not save purchase: ' + msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6 max-w-6xl mx-auto pb-12">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => navigate('/purchases')}
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">New Fruit Purchase Entry</h1>
            <p className="text-xs text-slate-500">Record fruit lot arrivals, weight shrinkage variance & FIFO landed costs</p>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Section 1: Basic Information */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Arrival & Supplier Details</h2>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Receiving Branch</label>
              {branchLocked ? (
                <div className="w-full p-2 bg-slate-100 border border-slate-200 rounded-lg font-bold text-slate-600">
                  📍 {branches.find(b => b.id === parseInt(branchId))?.name || user?.branch?.name || 'Your branch'} (locked)
                </div>
              ) : (
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium"
                >
                  {branches.map(b => (
                    <option key={b.id} value={b.id}>{b.name} ({b.code})</option>
                  ))}
                </select>
              )}
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 flex items-center justify-between">
                <span>Supplier / Grower *</span>
                <button
                  type="button"
                  onClick={() => { setQuickError(''); setIsQuickAddOpen(true); }}
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-2 py-0.5 rounded transition"
                >
                  <UserPlus className="w-3 h-3" />
                  New Supplier
                </button>
              </label>
              <select
                required
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium"
              >
                <option value="">Select Supplier...</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name} ({s.phone})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Supplier Challan / Bill #</label>
              <input
                type="text"
                value={supplierInvoiceNumber}
                onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                placeholder="e.g. HA-EXP-9082"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Purchase Date</label>
              <input
                type="date"
                required
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900"
              />
            </div>
          </div>

          {/* Commission Agent Toggle */}
          <div className="pt-4 border-t border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={hasAgent}
                onChange={(e) => setHasAgent(e.target.checked)}
                className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
              />
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <UserCheck className="w-3.5 h-3.5 text-brand-600" />
                Purchased through Mandi Commission Agent (Arhtiya)
              </span>
            </label>

            {hasAgent && (
              <div className="flex items-center gap-3 text-xs w-full sm:w-auto">
                <select
                  value={agentId}
                  onChange={(e) => {
                    setAgentId(e.target.value);
                    const ag = agents.find(a => a.id === parseInt(e.target.value));
                    if (ag) setAgentCommissionRate(ag.defaultCommissionRate);
                  }}
                  className="p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium"
                >
                  <option value="">Select Commission Agent...</option>
                  {agents.map(a => (
                    <option key={a.id} value={a.id}>{a.name} ({a.defaultCommissionRate}%)</option>
                  ))}
                </select>

                <div className="flex items-center gap-1">
                  <input
                    type="number"
                    step="0.1"
                    value={agentCommissionRate}
                    onChange={(e) => setAgentCommissionRate(e.target.value)}
                    className="w-16 p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-mono text-right"
                  />
                  <span className="text-slate-500 font-semibold">%</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Section 2: Fruit Line Items */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Fruit Items & Packing</h2>
            <button
              type="button"
              onClick={addItemRow}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition"
            >
              <Plus className="w-3.5 h-3.5" />
              Add Fruit Item
            </button>
          </div>

          {/* ---------- Mobile / Tablet: card per line ---------- */}
          <div className="block lg:hidden space-y-3">
            {items.map((row, idx) => {
              const lineNetKg = (parseFloat(row.billedQuantity || 0) * parseFloat(row.conversionFactor || 1)).toFixed(1);
              const lineSub = (parseFloat(row.billedQuantity || 0) * parseFloat(row.ratePerUnit || 0) - parseFloat(row.discountAmount || 0)).toFixed(2);

              return (
                <div key={idx} className="p-3 rounded-xl border-2 border-slate-200 bg-slate-50/50 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Item {idx + 1}</span>
                    {items.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeItemRow(idx)}
                        className="p-1.5 text-slate-400 hover:text-rose-600 transition"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>

                  <select
                    value={row.itemId}
                    onChange={(e) => handleItemChange(idx, 'itemId', e.target.value)}
                    className="w-full p-2.5 bg-white border border-slate-300 rounded-lg text-slate-900 font-medium text-sm"
                  >
                    <option value="">Select Fruit...</option>
                    {itemsList.map(itm => (
                      <option key={itm.id} value={itm.id}>
                        {itm.name} {itm.variety ? `(${itm.variety})` : ''}
                      </option>
                    ))}
                  </select>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Billed Qty</label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={row.billedQuantity}
                        onChange={(e) => handleItemChange(idx, 'billedQuantity', e.target.value)}
                        className="w-full p-2 bg-white border border-slate-300 rounded-lg text-right font-mono font-bold text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Unit</label>
                      <select
                        value={row.unit}
                        onChange={(e) => handleItemChange(idx, 'unit', e.target.value)}
                        className="w-full p-2 bg-white border border-slate-300 rounded-lg text-sm"
                      >
                        {unitOptions.map(u => (
                          <option key={u} value={u}>{u}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Kg / Unit</label>
                      <input
                        type="number"
                        step="0.5"
                        value={row.conversionFactor}
                        onChange={(e) => handleItemChange(idx, 'conversionFactor', e.target.value)}
                        title="How many kg in 1 unit"
                        className="w-full p-2 bg-white border border-slate-300 rounded-lg text-right font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Rate ₹ (per {row.unit})</label>
                      <input
                        type="number"
                        min="0"
                        step="0.5"
                        value={row.ratePerUnit}
                        onChange={(e) => handleItemChange(idx, 'ratePerUnit', e.target.value)}
                        className="w-full p-2 bg-white border border-slate-300 rounded-lg text-right font-mono text-sm"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Discount ₹</label>
                      <input
                        type="number"
                        min="0"
                        value={row.discountAmount}
                        onChange={(e) => handleItemChange(idx, 'discountAmount', e.target.value)}
                        className="w-full p-2 bg-white border border-slate-300 rounded-lg text-right font-mono text-rose-600 text-sm"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-xs">
                    <span className="font-mono text-slate-500">Billed wt: {lineNetKg} kg</span>
                    <span className="font-mono font-black text-slate-900">₹{parseFloat(lineSub).toLocaleString('en-IN')}</span>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ---------- Desktop: full table ---------- */}
          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead>
                <tr className="bg-slate-100/70 text-slate-600 font-bold uppercase tracking-wider border-b border-slate-200">
                  <th className="p-2.5">Fruit Item</th>
                  <th className="p-2.5 w-24">Billed Qty</th>
                  <th className="p-2.5 w-20">Unit</th>
                  <th className="p-2.5 w-28">Kg/Unit Conv</th>
                  <th className="p-2.5 w-28">Billed Wt (Kg)</th>
                  <th className="p-2.5 w-28">Rate (₹)</th>
                  <th className="p-2.5 w-24">Discount</th>
                  <th className="p-2.5 w-32 text-right">Subtotal (₹)</th>
                  <th className="p-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((row, idx) => {
                  const lineNetKg = (parseFloat(row.billedQuantity || 0) * parseFloat(row.conversionFactor || 1)).toFixed(1);
                  const lineSub = (parseFloat(row.billedQuantity || 0) * parseFloat(row.ratePerUnit || 0) - parseFloat(row.discountAmount || 0)).toFixed(2);

                  return (
                    <tr key={idx} className="hover:bg-slate-50">
                      <td className="p-2">
                        <select
                          value={row.itemId}
                          onChange={(e) => handleItemChange(idx, 'itemId', e.target.value)}
                          className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium"
                        >
                          <option value="">Select Fruit...</option>
                          {itemsList.map(itm => (
                            <option key={itm.id} value={itm.id}>
                              {itm.name} {itm.variety ? `(${itm.variety})` : ''}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={row.billedQuantity}
                          onChange={(e) => handleItemChange(idx, 'billedQuantity', e.target.value)}
                          className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-right font-mono font-bold"
                        />
                      </td>
                      <td className="p-2">
                        <select
                          value={row.unit}
                          onChange={(e) => handleItemChange(idx, 'unit', e.target.value)}
                          className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
                        >
                          {unitOptions.map(u => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          step="0.5"
                          value={row.conversionFactor}
                          onChange={(e) => handleItemChange(idx, 'conversionFactor', e.target.value)}
                          title="Conversion Factor: number of kg in 1 unit"
                          className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-right font-mono"
                        />
                      </td>
                      <td className="p-2 font-mono font-bold text-slate-700">
                        {lineNetKg} kg
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min="0"
                          step="0.5"
                          value={row.ratePerUnit}
                          onChange={(e) => handleItemChange(idx, 'ratePerUnit', e.target.value)}
                          className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-right font-mono"
                        />
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min="0"
                          value={row.discountAmount}
                          onChange={(e) => handleItemChange(idx, 'discountAmount', e.target.value)}
                          className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-right font-mono text-rose-600"
                        />
                      </td>
                      <td className="p-2 text-right font-mono font-bold text-slate-900">
                        ₹{parseFloat(lineSub).toLocaleString('en-IN')}
                      </td>
                      <td className="p-2 text-center">
                        <button
                          type="button"
                          onClick={() => removeItemRow(idx)}
                          className="text-slate-400 hover:text-rose-600 p-1 transition"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Section 3: Weight Variance (Billed vs Received Weight) */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <Scale className="w-4 h-4 text-brand-600" />
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Weight Variance Reconciliation (Billed vs Weighbridge Received Weight)
            </h2>
            <span className="text-[10px] text-slate-400 font-medium">
              Stock is created from the <strong>Actual Weighed</strong> weight — leave blank if no weighbridge difference.
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Billed Total Weight (Kg)</label>
              <input
                type="number"
                step="0.5"
                value={totalBilledWeight}
                onChange={(e) => setTotalBilledWeight(e.target.value)}
                placeholder={computedReceivedWeightKg.toString()}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-slate-900"
              />
              <span className="text-[10px] text-slate-400">Auto = Σ billed qty × kg/unit</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Actual Net Fruit Weighed (Kg)</label>
              <input
                type="number"
                step="0.5"
                value={totalReceivedWeight}
                onChange={(e) => setTotalReceivedWeight(e.target.value)}
                placeholder={billedWeightVal.toString()}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono font-bold text-slate-900"
              />
              <span className="text-[10px] text-slate-400">From weighbridge slip — this becomes your stock</span>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Variance Difference</label>
              <div className="p-2 rounded-lg bg-slate-100 border border-slate-200 font-mono font-bold flex items-center justify-between">
                <span>{weightVarianceDiff.toFixed(1)} kg Difference</span>
                {weightVarianceDiff > 0 && (
                  <span className="text-xs text-rose-600 font-semibold bg-rose-50 px-2 py-0.5 rounded border border-rose-200">
                    Shrinkage Loss
                  </span>
                )}
              </div>
            </div>
          </div>

          {weightVarianceDiff > 0 && (
            <div>
              <label className="block font-semibold text-slate-700 mb-1 text-xs">Variance Reason (Recorded in Audit Ledger)</label>
              <input
                type="text"
                value={weightVarianceReason}
                onChange={(e) => setWeightVarianceReason(e.target.value)}
                placeholder="e.g. Moisture evaporation during 48h mountain transit, sorting shrinkage"
                className="w-full p-2 text-xs bg-slate-50 border border-slate-300 rounded-lg text-slate-800"
              />
            </div>
          )}
        </div>

        {/* Section 4: Transportation, Charges & Landed Cost Breakdown */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Logistics & Charges */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
              <Truck className="w-4 h-4 text-brand-600" />
              Transportation & Landed Charges
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Transporter</label>
                <select
                  value={transporterId}
                  onChange={(e) => {
                    setTransporterId(e.target.value);
                    const tr = transporters.find(t => t.id === parseInt(e.target.value));
                    if (tr) setVehicleNumber(tr.vehicleNumber);
                  }}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
                >
                  <option value="">Select Transporter...</option>
                  {transporters.map(t => (
                    <option key={t.id} value={t.id}>{t.name} ({t.vehicleNumber})</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Vehicle / Truck No.</label>
                <input
                  type="text"
                  value={vehicleNumber}
                  onChange={(e) => setVehicleNumber(e.target.value)}
                  placeholder="HP-01-AA-1234"
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono uppercase"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Freight Charges (₹)</label>
                <input
                  type="number"
                  min="0"
                  value={freightCharges}
                  onChange={(e) => setFreightCharges(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
                />
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Loading / Palledar (₹)</label>
                <input
                  type="number"
                  min="0"
                  value={loadingCharges}
                  onChange={(e) => setLoadingCharges(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 text-xs">Internal Arrival Notes</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Fruit quality grade, orchard elevation, temperature on arrival..."
                className="w-full p-2 text-xs bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {/* Landed Cost & Payment Summary */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4">
            <div>
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                <Calculator className="w-4 h-4 text-brand-600" />
                Landed Cost & Payment Terms
              </h2>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Gross Fruit Value:</span>
                  <span className="font-mono font-medium">₹{grossSubtotal.toLocaleString('en-IN')}</span>
                </div>
                {totalDiscount > 0 && (
                  <div className="flex justify-between text-rose-600">
                    <span>Supplier Discount:</span>
                    <span className="font-mono font-medium">-₹{totalDiscount.toLocaleString('en-IN')}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-800 font-bold border-t border-slate-100 pt-1">
                  <span>Net Supplier Bill:</span>
                  <span className="font-mono">₹{grandTotal.toLocaleString('en-IN')}</span>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 space-y-1 my-2">
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>+ Freight Charges:</span>
                    <span className="font-mono">₹{numFreight.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="flex justify-between text-[11px] text-slate-500">
                    <span>+ Loading / Palledar:</span>
                    <span className="font-mono">₹{numLoading.toLocaleString('en-IN')}</span>
                  </div>
                  {commissionAmt > 0 && (
                    <div className="flex justify-between text-[11px] text-slate-500">
                      <span>+ Mandi Commission ({agentCommissionRate}%):</span>
                      <span className="font-mono">₹{commissionAmt.toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-xs font-bold text-brand-800 pt-1 border-t border-slate-200">
                    <span>Bill Total (incl. Transportation):</span>
                    <span className="font-mono">₹{totalLandedCost.toLocaleString('en-IN')}</span>
                  </div>
                  <div className="text-[11px] text-brand-600 font-medium text-right">
                    ≈ ₹{avgLandedPerKg} per kg (Valuation for FIFO)
                  </div>
                </div>

                {/* Immediate Payment Entry */}
                <div className="grid grid-cols-2 gap-3 pt-2">
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Payment Mode</label>
                    <select
                      value={paymentMode}
                      onChange={(e) => {
                        paidTouchedRef.current = false;
                        setPaymentMode(e.target.value);
                      }}
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-medium"
                    >
                      <option value="CASH">Cash on Mandi Gate</option>
                      <option value="CREDIT">Credit (On Account)</option>
                      <option value="BANK">Bank / NEFT / RTGS</option>
                      <option value="UPI">UPI</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Immediate Paid (₹)</label>
                    <input
                      type="number"
                      min="0"
                      max={totalLandedCost}
                      value={paidAmount}
                      onChange={(e) => handlePaidChange(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right font-bold text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={payFull}
                      className="mt-1 text-[10px] font-bold text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-2 py-0.5 rounded transition"
                    >
                      Pay Full ₹{totalLandedCost.toLocaleString('en-IN')}
                    </button>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-2 font-bold text-slate-900">
                  <span>Balance Payable:</span>
                  <span className="font-mono text-sm text-rose-700">₹{dueAmt.toLocaleString('en-IN')}</span>
                </div>
                <p className="text-[10px] text-slate-500 text-right">
                  Immediate paid settles the supplier bill first, then freight / loading / commission.
                </p>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition disabled:opacity-60"
            >
              <Check className="w-4 h-4" />
              {loading ? 'Creating Purchase Bill & FIFO Batches...' : 'Post Purchase & Generate FIFO Batches'}
            </button>
          </div>
        </div>
      </form>

      {/* Quick-add Supplier Modal */}
      <Modal isOpen={isQuickAddOpen} onClose={() => setIsQuickAddOpen(false)} title="Quick Add Supplier" maxWidth="max-w-lg">
        {quickError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span>{quickError}</span>
          </div>
        )}

        <form onSubmit={handleQuickAddSupplier} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Supplier Name *</label>
              <input
                type="text"
                required
                value={quickSupplier.name}
                onChange={(e) => setQuickSupplier({ ...quickSupplier, name: e.target.value })}
                placeholder="e.g. Himachal Agro Orchards Ltd"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Phone *</label>
              <input
                type="tel"
                required
                value={quickSupplier.phone}
                onChange={(e) => setQuickSupplier({ ...quickSupplier, phone: e.target.value })}
                placeholder="+91 98xxx xxxxx"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">GSTIN</label>
              <input
                type="text"
                value={quickSupplier.gstNumber}
                onChange={(e) => setQuickSupplier({ ...quickSupplier, gstNumber: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Address</label>
              <input
                type="text"
                value={quickSupplier.address}
                onChange={(e) => setQuickSupplier({ ...quickSupplier, address: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsQuickAddOpen(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={quickSaving}
              className="px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg font-bold shadow-sm disabled:opacity-60"
            >
              {quickSaving ? 'Saving...' : 'Save & Select'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default PurchaseCreate;
