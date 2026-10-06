import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../api/client';
import { useBranch } from '../../context/BranchContext';
import { useAuth } from '../../context/AuthContext';
import Modal from '../../components/Common/Modal';
import { useToast } from '../../components/Common/Toast';
import { buildUnitOptions } from '../../constants/units';
import { Plus, Trash2, ArrowLeft, Check, AlertCircle, ShoppingCart, ShieldAlert, UserPlus } from 'lucide-react';

const SaleCreate = () => {
  const navigate = useNavigate();
  const { activeBranchId, branches } = useBranch();
  const { isOwner, user } = useAuth();
  const toast = useToast();

  // Masters
  const [customers, setCustomers] = useState([]);
  const [itemsList, setItemsList] = useState([]);
  // Unit dropdown mirrors the Packaging Unit list from the item master
  const unitOptions = buildUnitOptions(itemsList);
  const [stockOverview, setStockOverview] = useState([]);
  const [agents, setAgents] = useState([]);
  const [transporters, setTransporters] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Quick-add buyer (customer) modal
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [quickCustomer, setQuickCustomer] = useState({ name: '', phone: '', address: '', gstNumber: '' });
  const [quickSaving, setQuickSaving] = useState(false);
  const [quickError, setQuickError] = useState('');

  // Form State
  // Non-owner users are locked to their own branch (matches backend, which
  // overrides branchId server-side for non-owners anyway).
  const [branchId, setBranchId] = useState(
    !isOwner && user?.branchId ? String(user.branchId) : (activeBranchId === 'all' ? '1' : activeBranchId)
  );
  const branchLocked = !isOwner && !!user?.branchId;
  const [customerId, setCustomerId] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [saleDate, setSaleDate] = useState(new Date().toISOString().split('T')[0]);

  // Commission & Logistics
  const [hasAgent, setHasAgent] = useState(false);
  const [agentId, setAgentId] = useState('');
  const [agentCommissionRate, setAgentCommissionRate] = useState(5.0);
  const [transporterId, setTransporterId] = useState('');
  const [vehicleNumber, setVehicleNumber] = useState('');
  const [freightCharges, setFreightCharges] = useState(0);

  // Billing & Payment
  const [discountAmount, setDiscountAmount] = useState(0);
  const [taxAmount, setTaxAmount] = useState(0);
  const [paymentMode, setPaymentMode] = useState('CASH');
  const [paidAmount, setPaidAmount] = useState(0);
  const [notes, setNotes] = useState('');

  // Line items — default to loose-kg selling: Qty (kg) × rate per kg.
  const [items, setItems] = useState([
    {
      itemId: '',
      quantity: 1,
      unit: 'kg',
      conversionFactor: 1,
      ratePerUnit: 0,
      discountAmount: 0
    }
  ]);

  useEffect(() => {
    const loadData = async () => {
      try {
        const [custRes, itmRes, stRes, agRes, trRes] = await Promise.all([
          api.getCached('/masters/customers', null, { maxAge: 60_000 }),
          api.getCached('/masters/items', null, { maxAge: 60_000 }),
          api.getCached('/stock/overview', null, { maxAge: 10_000 }),
          api.getCached('/masters/agents', null, { maxAge: 60_000 }),
          api.getCached('/masters/transporters', null, { maxAge: 60_000 })
        ]);
        if (custRes.data.success) setCustomers(custRes.data.customers);
        if (itmRes.data.success) setItemsList(itmRes.data.items);
        if (stRes.data.success) setStockOverview(stRes.data.stock);
        if (agRes.data.success) setAgents(agRes.data.agents);
        if (trRes.data.success) setTransporters(trRes.data.transporters);

        if (itmRes.data.items.length > 0) {
          const first = itmRes.data.items[0];
          setItems([
            {
              itemId: first.id,
              quantity: 1,
              unit: 'kg',
              conversionFactor: 1,
              ratePerUnit: 0,
              discountAmount: 0
            }
          ]);
        }
      } catch (err) {
        console.error('Failed to load masters', err);
        toast.error('Could not load customers & items. Please refresh the page.');
      }
    };
    loadData();
  }, [branchId]);

  const handleQuickAddCustomer = async (e) => {
    e.preventDefault();
    setQuickSaving(true);
    setQuickError('');
    try {
      const res = await api.post('/masters/customers', quickCustomer);
      if (res.data.success) {
        toast.success('Customer added successfully');
        const newCust = res.data.customer;
        setCustomers(prev => [...prev, newCust].sort((a, b) => a.name.localeCompare(b.name)));
        handleCustomerChange(String(newCust.id)); // auto-select the new buyer
        setIsQuickAddOpen(false);
        setQuickCustomer({ name: '', phone: '', address: '', gstNumber: '' });
      }
    } catch (err) {
      setQuickError(err.response?.data?.message || err.message || 'Failed to create customer');
      toast.error('Could not save customer. Please check the details.');
    } finally {
      setQuickSaving(false);
    }
  };

  const handleCustomerChange = (cid) => {
    setCustomerId(cid);
    const cust = customers.find(c => c.id === parseInt(cid));
    setSelectedCustomer(cust || null);
  };

  const handleItemChange = (index, field, value) => {
    const updated = [...items];
    updated[index][field] = value;

    if (field === 'itemId') {
      const selected = itemsList.find(i => i.id === parseInt(value));
      if (selected) {
        // Default to loose-kg selling (the common case): Qty × 1 kg, rate per kg.
        // Pack units (box/crate) can still be picked from the Unit dropdown.
        updated[index].unit = 'kg';
        updated[index].conversionFactor = 1;
      }
    }

    // Selling in loose kg (or grams): conversion must reflect the picked unit,
    // NOT the pack size — otherwise "2 kg" deducts 2 × pack-size from stock.
    if (field === 'unit') {
      const selected = itemsList.find(i => i.id === parseInt(updated[index].itemId));
      const packFactor = selected ? parseFloat(selected.unitConversionFactor || 1) : 1;
      const unitLc = String(value).toLowerCase();
      if (unitLc === 'kg') {
        updated[index].conversionFactor = 1;
      } else if (unitLc === 'grams' || unitLc === 'g') {
        updated[index].conversionFactor = 0.001;
      } else if (unitLc === 'ton(s)' || unitLc === 'tons' || unitLc === 'ton') {
        updated[index].conversionFactor = 1000;
      } else if (unitLc === 'quintal') {
        updated[index].conversionFactor = 100;
      } else if (selected) {
        // pack-style unit (crate/box/bag/pcs): revert to the item's master pack factor
        updated[index].conversionFactor = packFactor;
      }
    }

    setItems(updated);
  };

  const addItemRow = () => {
    const first = itemsList[0];
    setItems([
      ...items,
      {
        itemId: first ? first.id : '',
        quantity: 1,
        unit: 'kg',
        conversionFactor: 1,
        ratePerUnit: 0,
        discountAmount: 0
      }
    ]);
  };

  const removeItemRow = (idx) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  // Calculations
  let itemsSubtotal = 0;
  let itemsLineDiscounts = 0;
  let totalWeightKg = 0;

  items.forEach(itm => {
    const q = parseFloat(itm.quantity || 0);
    const rate = parseFloat(itm.ratePerUnit || 0);
    const disc = parseFloat(itm.discountAmount || 0);
    const conv = parseFloat(itm.conversionFactor || 1);
    itemsSubtotal += (q * rate);
    itemsLineDiscounts += disc;
    totalWeightKg += (q * conv);
  });

  const overallDiscount = parseFloat(discountAmount) || 0;
  const netDiscount = itemsLineDiscounts + overallDiscount;
  const numTax = parseFloat(taxAmount) || 0;
  const numFreight = parseFloat(freightCharges) || 0;
  const grandTotal = Math.max(0, itemsSubtotal - netDiscount + numTax + numFreight);

  const numPaid = parseFloat(paidAmount) || 0;
  const dueAmt = Math.max(0, grandTotal - numPaid);

  // Collected amount can never exceed the invoice total — clamp on input.
  const paidTouchedRef = useRef(false);
  const handlePaidChange = (value) => {
    paidTouchedRef.current = true;
    const val = parseFloat(value);
    if (!isNaN(val) && val > grandTotal) {
      setPaidAmount(grandTotal);
      toast.warning(`Collected amount cannot exceed the invoice total (₹${grandTotal.toLocaleString('en-IN')})`);
    } else {
      setPaidAmount(value);
    }
  };

  // Cash/UPI/Bank collections default to receiving the FULL invoice amount;
  // Credit (on account) collects nothing now. Manual edits win until the
  // payment mode is changed again.
  useEffect(() => {
    if (paymentMode === 'CREDIT') {
      paidTouchedRef.current = false;
      setPaidAmount(0);
    } else if (!paidTouchedRef.current) {
      setPaidAmount(grandTotal);
    }
  }, [paymentMode, grandTotal]);

  // Quick button: switch to cash and collect the full invoice amount
  const payFull = () => {
    if (paymentMode === 'CREDIT') {
      paidTouchedRef.current = false;
      setPaymentMode('CASH');
    } else {
      paidTouchedRef.current = true;
      setPaidAmount(grandTotal);
    }
  };

  // Credit limit check
  const custLimit = selectedCustomer ? parseFloat(selectedCustomer.creditLimit || 50000) : 50000;
  const isCreditExceeded = selectedCustomer && paymentMode === 'CREDIT' && dueAmt > custLimit;

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!customerId) {
      setError('Please select a customer');
      toast.warning('Please select a customer first');
      return;
    }
    if (!items.length || items.some(i => !i.itemId)) {
      setError('Please select valid fruit items for all line items');
      toast.warning('Please choose a fruit for every line');
      return;
    }
    if (isCreditExceeded) {
      toast.warning('Credit limit exceeded — invoice will be saved with a warning');
    }

    setLoading(true);
    setError('');

    try {
      const payload = {
        branchId: parseInt(branchId),
        customerId: parseInt(customerId),
        saleDate,
        hasAgent,
        agentId: hasAgent && agentId ? parseInt(agentId) : null,
        agentCommissionRate: parseFloat(agentCommissionRate || 0),
        transporterId: transporterId ? parseInt(transporterId) : null,
        vehicleNumber,
        freightCharges: parseFloat(freightCharges || 0),
        discountAmount: overallDiscount,
        taxAmount: numTax,
        paymentMode,
        paidAmount: numPaid,
        notes,
        items: items.map(itm => ({
          itemId: parseInt(itm.itemId),
          quantity: parseFloat(itm.quantity),
          unit: itm.unit,
          conversionFactor: parseFloat(itm.conversionFactor),
          ratePerUnit: parseFloat(itm.ratePerUnit),
          discountAmount: parseFloat(itm.discountAmount || 0)
        }))
      };

      const res = await api.post('/sales', payload);
      if (res.data.success) {
        toast.success('Sale invoice saved successfully');
        navigate('/sales');
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to create sale invoice';
      setError(msg);
      toast.error('Could not save sale: ' + msg);
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
            onClick={() => navigate('/sales')}
            className="p-2 rounded-lg bg-white border border-slate-200 text-slate-600 hover:bg-slate-100 transition"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
              <ShoppingCart className="w-6 h-6 text-brand-600" />
              New Outward Sale Invoice
            </h1>
            <p className="text-xs text-slate-500">
              Customer dispatch with automatic FIFO batch deduction and gross profit calculation
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold flex items-center gap-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Customer & Branch */}
        <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Customer & Dispatch Branch</h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Dispatching Branch</label>
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
                <span>Customer / Buyer *</span>
                <button
                  type="button"
                  onClick={() => { setQuickError(''); setIsQuickAddOpen(true); }}
                  className="inline-flex items-center gap-1 text-[10px] font-bold text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-2 py-0.5 rounded transition"
                >
                  <UserPlus className="w-3 h-3" />
                  New Buyer
                </button>
              </label>
              <select
                required
                value={customerId}
                onChange={(e) => handleCustomerChange(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900 font-medium"
              >
                <option value="">Select Customer...</option>
                {customers.map(c => (
                  <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Invoice Date</label>
              <input
                type="date"
                required
                value={saleDate}
                onChange={(e) => setSaleDate(e.target.value)}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg text-slate-900"
              />
            </div>
          </div>

          {/* Customer Credit Limit Indicator */}
          {selectedCustomer && (
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-bold text-slate-800">{selectedCustomer.name}</span>
                <span className="text-slate-500 ml-2">Contact: {selectedCustomer.contactPerson || 'Direct'} ({selectedCustomer.phone})</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-slate-600">
                  Approved Credit Limit: <strong className="text-slate-900">₹{parseFloat(selectedCustomer.creditLimit).toLocaleString('en-IN')}</strong>
                </span>
                {isCreditExceeded && (
                  <span className="inline-flex items-center gap-1 text-rose-700 bg-rose-100 font-bold px-2 py-0.5 rounded border border-rose-300">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    Credit Limit Warning
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Fruit Line Items with Available Stock */}
        <div className="bg-white p-4 sm:p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Fruit Items to Sell</h2>
              <p className="text-[11px] text-slate-400">Stock will be automatically deducted from oldest received batches (FIFO)</p>
            </div>
            <button
              type="button"
              onClick={addItemRow}
              className="inline-flex items-center gap-1 px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg text-xs font-bold transition shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Add Fruit Item</span>
              <span className="sm:hidden">Add</span>
            </button>
          </div>

          {/* ---------- Mobile / Tablet: card per line ---------- */}
          <div className="block lg:hidden space-y-3">
            {items.map((row, idx) => {
              const lineNetKg = (parseFloat(row.quantity || 0) * parseFloat(row.conversionFactor || 1)).toFixed(1);
              const lineSub = (parseFloat(row.quantity || 0) * parseFloat(row.ratePerUnit || 0) - parseFloat(row.discountAmount || 0)).toFixed(2);
              const stockInfo = stockOverview.find(s => s.itemId === parseInt(row.itemId) && s.branchId === parseInt(branchId));
              const availKg = stockInfo ? stockInfo.totalQuantityKg : 0;
              const availCrates = stockInfo ? stockInfo.quantityCrates : 0;
              const isLow = parseFloat(lineNetKg) > availKg;

              return (
                <div key={idx} className={`p-3 rounded-xl border-2 space-y-3 ${isLow ? 'border-rose-200 bg-rose-50/40' : 'border-slate-200 bg-slate-50/50'}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Item {idx + 1}</span>
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-mono font-bold ${isLow ? 'text-rose-600' : 'text-emerald-700'}`}>
                        Stock: {availKg} kg
                      </span>
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
                      <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Sale Qty</label>
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={row.quantity}
                        onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                        className={`w-full p-2 bg-white border rounded-lg text-right font-mono font-bold text-sm ${
                          isLow ? 'border-rose-400 text-rose-700' : 'border-slate-300 text-slate-900'
                        }`}
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
                    <div>
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
                    <span className="font-mono text-slate-500">{lineNetKg} kg × ₹{row.ratePerUnit}</span>
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
                  <th className="p-2.5 w-32">Available Stock</th>
                  <th className="p-2.5 w-24">Sale Qty</th>
                  <th className="p-2.5 w-20">Unit</th>
                  <th className="p-2.5 w-24">Kg/Unit</th>
                  <th className="p-2.5 w-24">Weight (Kg)</th>
                  <th className="p-2.5 w-28">Rate (₹)</th>
                  <th className="p-2.5 w-24">Discount</th>
                  <th className="p-2.5 w-32 text-right">Subtotal (₹)</th>
                  <th className="p-2.5 w-10"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {items.map((row, idx) => {
                  const lineNetKg = (parseFloat(row.quantity || 0) * parseFloat(row.conversionFactor || 1)).toFixed(1);
                  const lineSub = (parseFloat(row.quantity || 0) * parseFloat(row.ratePerUnit || 0) - parseFloat(row.discountAmount || 0)).toFixed(2);

                  // Find available stock for this item in current branch
                  const stockInfo = stockOverview.find(s => s.itemId === parseInt(row.itemId) && s.branchId === parseInt(branchId));
                  const availKg = stockInfo ? stockInfo.totalQuantityKg : 0;
                  const availCrates = stockInfo ? stockInfo.quantityCrates : 0;
                  const isLow = parseFloat(lineNetKg) > availKg;

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
                        <span className={`font-mono text-[11px] block font-semibold ${isLow ? 'text-rose-600' : 'text-emerald-700'}`}>
                          {availKg} kg
                        </span>
                        <span className="text-[10px] text-slate-400">({availCrates} crates)</span>
                      </td>
                      <td className="p-2">
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={row.quantity}
                          onChange={(e) => handleItemChange(idx, 'quantity', e.target.value)}
                          className={`w-full p-2 bg-slate-50 border rounded-lg text-right font-mono font-bold ${
                            isLow ? 'border-rose-400 text-rose-700' : 'border-slate-300 text-slate-900'
                          }`}
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
                      <td className="p-2 text-right font-mono text-[11px] text-slate-500" title="Auto-managed from the Unit dropdown">
                        {parseFloat(row.conversionFactor || 1)}
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

        {/* Transportation, Logistics & Payment Mode */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm space-y-4">
            <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Dispatch Logistics</h2>

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
                  placeholder="Customer pickup or truck"
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
                <label className="block font-semibold text-slate-700 mb-1">Additional Overall Discount (₹)</label>
                <input
                  type="number"
                  min="0"
                  value={discountAmount}
                  onChange={(e) => setDiscountAmount(e.target.value)}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right text-rose-600"
                />
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1 text-xs">Sale Notes / Gate Instructions</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Gate pass reference, driver contact, delivery instructions..."
                className="w-full p-2 text-xs bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>
          </div>

          {/* Bill Summary & Payment Collection */}
          <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between space-y-4">
            <div>
              <h2 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">Bill Summary & Settlement</h2>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between text-slate-600">
                  <span>Gross Line Items:</span>
                  <span className="font-mono font-medium">₹{itemsSubtotal.toLocaleString('en-IN')}</span>
                </div>
                {netDiscount > 0 && (
                  <div className="flex justify-between text-rose-600">
                    <span>Total Discount:</span>
                    <span className="font-mono font-medium">-₹{netDiscount.toLocaleString('en-IN')}</span>
                  </div>
                )}
                {parseFloat(freightCharges) > 0 && (
                  <div className="flex justify-between text-slate-600">
                    <span>Freight Charges:</span>
                    <span className="font-mono font-medium">+₹{parseFloat(freightCharges).toLocaleString('en-IN')}</span>
                  </div>
                )}
                <div className="flex justify-between text-slate-900 font-extrabold text-sm border-t border-slate-200 pt-2">
                  <span>Total Invoice Amount:</span>
                  <span className="font-mono text-brand-700">₹{grandTotal.toLocaleString('en-IN')}</span>
                </div>

                {/* Payment Mode Selection */}
                <div className="grid grid-cols-2 gap-3 pt-3 border-t border-slate-100">
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
                      <option value="CASH">Cash Collection</option>
                      <option value="CREDIT">Credit (On Account)</option>
                      <option value="UPI">UPI / QR Code</option>
                      <option value="BANK">Bank Transfer / NEFT</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Amount Collected (₹)</label>
                    <input
                      type="number"
                      min="0"
                      max={grandTotal}
                      value={paidAmount}
                      onChange={(e) => handlePaidChange(e.target.value)}
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right font-bold text-slate-900"
                    />
                    <button
                      type="button"
                      onClick={payFull}
                      className="mt-1 text-[10px] font-bold text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 px-2 py-0.5 rounded transition"
                    >
                      Pay Full ₹{grandTotal.toLocaleString('en-IN')}
                    </button>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-2 font-bold text-slate-900">
                  <span>Receivable Balance (Customer Due):</span>
                  <span className={`font-mono text-sm ${dueAmt > 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                    ₹{dueAmt.toLocaleString('en-IN')}
                  </span>
                </div>
                {dueAmt > 0 && paymentMode === 'CASH' && (
                  <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-2 py-1">
                    Partial cash collection — the balance of ₹{dueAmt.toLocaleString('en-IN')} stays as customer credit (receivable).
                  </p>
                )}
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 px-4 bg-brand-600 hover:bg-brand-700 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2 shadow-sm transition disabled:opacity-60"
            >
              <Check className="w-4 h-4" />
              {loading ? 'Processing FIFO Stock Deduction...' : 'Post Sale & Deduct FIFO Stock'}
            </button>
          </div>
        </div>
      </form>

      {/* Quick-add Buyer Modal */}
      <Modal isOpen={isQuickAddOpen} onClose={() => setIsQuickAddOpen(false)} title="Quick Add Buyer (Customer)" maxWidth="max-w-lg">
        {quickError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span>{quickError}</span>
          </div>
        )}

        <form onSubmit={handleQuickAddCustomer} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Buyer / Firm Name *</label>
              <input
                type="text"
                required
                value={quickCustomer.name}
                onChange={(e) => setQuickCustomer({ ...quickCustomer, name: e.target.value })}
                placeholder="e.g. Modern Fresh Supermarkets Pvt Ltd"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Phone *</label>
              <input
                type="tel"
                required
                value={quickCustomer.phone}
                onChange={(e) => setQuickCustomer({ ...quickCustomer, phone: e.target.value })}
                placeholder="+91 98xxx xxxxx"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">GSTIN</label>
              <input
                type="text"
                value={quickCustomer.gstNumber}
                onChange={(e) => setQuickCustomer({ ...quickCustomer, gstNumber: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
            </div>
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Address</label>
              <input
                type="text"
                value={quickCustomer.address}
                onChange={(e) => setQuickCustomer({ ...quickCustomer, address: e.target.value })}
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

export default SaleCreate;
