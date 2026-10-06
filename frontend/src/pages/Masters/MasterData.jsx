import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import DataTable from '../../components/Common/DataTable';
import Modal from '../../components/Common/Modal';
import { useToast } from '../../components/Common/Toast';
import { useAuth } from '../../context/AuthContext';
import { useBranch } from '../../context/BranchContext';
import { exportToExcel } from '../../utils/excelExport';
import { Database, Plus, Building2, Apple, Users, Truck, UserCheck, ShoppingCart, AlertCircle, Trash2, Pencil, Download, Eye, EyeOff } from 'lucide-react';

const TABS = [
  { key: 'branches', label: 'Branches', icon: Building2 },
  { key: 'items', label: 'Fruit Items', icon: Apple },
  { key: 'suppliers', label: 'Suppliers', icon: Users },
  { key: 'customers', label: 'Customers', icon: ShoppingCart },
  { key: 'agents', label: 'Commission Agents', icon: UserCheck },
  { key: 'transporters', label: 'Transporters', icon: Truck },
  { key: 'users', label: 'Users', icon: Database }
];

// Standard packaging units offered in the dropdown (custom values also allowed via backend)
const PACK_UNITS = ['PCS', 'BOX', 'BAG', 'GRAMS', 'KG', 'TONS'];

const EMPTY_FORMS = {
  branches: { name: '', code: '', location: '', address: '', phone: '' },
  items: { name: '', variety: '', category: 'Fruit', packagingUnit: 'BOX', packSizeGrams: 100, packSizePcs: 1, pieceWeightGrams: 100, packSizeUnit: 'g', reorderThreshold: '', shelfLifeDays: 14 },
  suppliers: { name: '', phone: '', email: '', address: '', gstNumber: '', branchId: '' },
  customers: { name: '', phone: '', email: '', address: '', gstNumber: '', branchId: '' },
  agents: { name: '', contactPerson: '', phone: '', defaultCommissionRate: 5, address: '', branchId: '' },
  transporters: { name: '', vehicleNumber: '', driverName: '', driverPhone: '', transportCompany: '' },
  users: { name: '', email: '', password: '', role: 'STAFF', branchId: '', phone: '' }
};

const MasterData = () => {
  const { isOwner, user } = useAuth();
  const { branches } = useBranch();
  const toast = useToast();
  const [activeTab, setActiveTab] = useState('items');
  const [data, setData] = useState({
    branches: [], items: [], suppliers: [], customers: [], agents: [], transporters: [], users: []
  });
  const [loading, setLoading] = useState(true);

  const [isOpen, setIsOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [showPassword, setShowPassword] = useState(false); // eye toggle on the password field
  const [form, setForm] = useState(EMPTY_FORMS[activeTab]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const ENDPOINTS = {
    branches: ['branches', 'branches'],
    items: ['items', 'items'],
    suppliers: ['suppliers', 'suppliers'],
    customers: ['customers', 'customers'],
    agents: ['agents', 'agents'],
    transporters: ['transporters', 'transporters'],
    users: ['users', 'users']
  };

  const fetchData = async () => {
    try {
      setLoading(true);
      // Cached GETs: masters change rarely, so re-visits paint instantly from
      // the SWR cache and refresh silently in the background.
      const endpoints = Object.keys(ENDPOINTS).map(k =>
        k === 'users' && !isOwner
          ? Promise.resolve({ data: { success: false } })
          : api.getCached(`/masters/${ENDPOINTS[k][0]}`, null, { maxAge: 60_000 })
      );
      const results = await Promise.all(endpoints);
      const nextData = {};
      Object.keys(ENDPOINTS).forEach((k, i) => {
        const res = results[i];
        const listKey = ENDPOINTS[k][1];
        if (res?.data?.success) {
          nextData[k] = res.data[listKey] || res.data.users || [];
        }
      });
      setData(prev => ({ ...prev, ...nextData }));
    } catch (err) {
      console.error('Failed to load master data', err);
      toast.error('Could not load data. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const openCreate = () => {
    setForm(EMPTY_FORMS[activeTab]);
    setEditingId(null);
    setError('');
    setShowPassword(false);
    setIsOpen(true);
  };

  // Pre-fill the form from an existing row and switch the modal into edit mode
  const openEdit = (row) => {
    const base = EMPTY_FORMS[activeTab];
    const filled = {};
    Object.keys(base).forEach(k => {
      filled[k] = row[k] ?? base[k];
    });
    filled.password = ''; // never pre-fill passwords
    if (activeTab === 'users') filled.branchId = row.branchId ?? '';
    // Parties carry their owning branch so the owner can move them on edit
    if (activeTab === 'suppliers' || activeTab === 'customers' || activeTab === 'agents') {
      filled.branchId = row.branchId ? String(row.branchId) : '';
    }
    if (activeTab === 'items') {
      // Round-trip based on how the pack size was originally entered
      const factorKg = parseFloat(row.unitConversionFactor || 1);
      const unit = (row.packSizeUnit || (factorKg < 1 ? 'g' : 'kg')).toLowerCase();
      filled.packSizeUnit = unit;
      if (unit === 'pcs') {
        const pieceG = parseFloat(row.pieceWeightGrams || 0);
        filled.pieceWeightGrams = pieceG > 0 ? pieceG : 100;
        filled.packSizePcs = pieceG > 0 ? Math.round((factorKg * 1000) / pieceG) : '';
      } else if (unit === 'g') {
        filled.packSizeGrams = parseFloat((factorKg * 1000).toFixed(2));
      } else {
        filled.packSizeGrams = factorKg;
      }
      filled.reorderThreshold = row.reorderThreshold || '';
    }
    setForm(filled);
    setEditingId(row.id);
    setError('');
    setShowPassword(false);
    setIsOpen(true);
  };

  const handleDelete = async (tab, row) => {
    if (!window.confirm(`Delete ${row.name || 'this record'}?\n\nThe record will be deactivated; history is preserved. Deletion is blocked if money is still outstanding.`)) return;
    try {
      const res = await api.delete(`/masters/${tab}/${row.id}`);
      if (res.data.success) {
        toast.success(`${row.name} deleted successfully`);
        fetchData();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not delete. Money may still be pending on this record.');
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const payload = { ...form };
      // Numeric coercions
      if (activeTab === 'items') {
        if (form.packSizeUnit === 'pcs') {
          payload.packSizePcs = parseFloat(form.packSizePcs);
          payload.pieceWeightGrams = parseFloat(form.pieceWeightGrams);
        } else if (form.packSizeUnit === 'g') {
          payload.packSizeGrams = parseFloat(form.packSizeGrams);
        } else {
          payload.unitConversionFactor = parseFloat(form.packSizeGrams);
        }
        // Optional: only sent when filled
        if (form.reorderThreshold !== '' && form.reorderThreshold != null) {
          payload.reorderThreshold = parseFloat(form.reorderThreshold);
        } else {
          payload.reorderThreshold = 0;
        }
        payload.shelfLifeDays = parseInt(form.shelfLifeDays);
      }
      if (activeTab === 'suppliers' || activeTab === 'customers') {
        // Owner picks the owning branch when creating a party; branch users are
        // always stamped with their own branch server-side.
        // On edit, the owner may also move the party to another branch.
        if (isOwner && form.branchId) payload.branchId = parseInt(form.branchId);
      }
      if (activeTab === 'agents') {
        payload.defaultCommissionRate = parseFloat(form.defaultCommissionRate) || 5;
        // Owner picks the owning branch when creating an agent; branch users
        // are always stamped with their own branch server-side. On edit the
        // owner may also move the agent to another branch.
        if (isOwner) {
          payload.branchId = form.branchId ? parseInt(form.branchId) : null;
        }
      }
      if (activeTab === 'users') {
        payload.branchId = form.branchId ? parseInt(form.branchId) : null;
        // Password is optional when editing an existing user
        if (editingId && !payload.password) delete payload.password;
      }

      const res = editingId
        ? await api.put(`/masters/${activeTab}/${editingId}`, payload)
        : await api.post(`/masters/${activeTab}`, payload);
      if (res.data.success) {
        toast.success(editingId ? 'Record updated successfully' : 'Record saved successfully');
        setIsOpen(false);
        fetchData();
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || `Failed to ${editingId ? 'update' : 'create'} record`;
      setError(msg);
      toast.error(msg);
    } finally {
      setSubmitting(false);
    }
  };

  // Shared Edit + Delete action buttons for owner-only master lists
  const actionsColumn = (tab, label) => ({
    header: 'Actions',
    accessor: 'id',
    render: r => isOwner ? (
      <div className="flex items-center gap-1">
        <button
          onClick={() => openEdit(r)}
          className="p-1.5 rounded-lg text-slate-400 hover:text-brand-700 hover:bg-brand-50 transition"
          title={`Edit ${label}`}
        >
          <Pencil className="w-4 h-4" />
        </button>
        <button
          onClick={() => handleDelete(tab, r)}
          disabled={r.isActive === false}
          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
          title={r.isActive === false ? 'Already deleted' : `Delete ${label}`}
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    ) : null
  });

  const renderField = (key, label, type = 'text', required = false, extra = {}) => {
    const isPassword = type === 'password';
    return (
      <div key={key}>
        <label className="block font-semibold text-slate-700 mb-1">{label}{required && ' *'}</label>
        <div className="relative">
          <input
            type={isPassword ? (showPassword ? 'text' : 'password') : type}
            required={required}
            value={form[key] ?? ''}
            onChange={(e) => setForm({ ...form, [key]: e.target.value })}
            className={`w-full p-2 bg-slate-50 border border-slate-300 rounded-lg ${isPassword ? 'pr-10' : ''} ${type === 'number' ? 'font-mono text-right' : ''}`}
            {...extra}
          />
          {isPassword && (
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              title={showPassword ? 'Hide password' : 'Show password'}
              className="absolute inset-y-0 right-0 flex items-center px-3 text-slate-400 hover:text-slate-700 transition-colors"
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>
    );
  };

  const renderSelect = (key, label, options, required = false) => (
    <div key={key}>
      <label className="block font-semibold text-slate-700 mb-1">{label}{required && ' *'}</label>
      <select
        required={required}
        value={form[key] ?? ''}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-bold"
      >
        {options.map(opt => (
          <option key={opt} value={opt}>{opt}</option>
        ))}
      </select>
    </div>
  );

  // Standard units + any custom/legacy unit already saved on existing items
  const packUnitOptions = [...new Set([
    ...PACK_UNITS,
    ...(data.items || []).map(i => i.packagingUnit).filter(Boolean)
  ])];

  const columnsByTab = {
    branches: [
      { header: 'Code', accessor: 'code', render: r => <span className="font-mono font-bold text-brand-700">{r.code}</span> },
      { header: 'Branch Name', accessor: 'name', render: r => <span className="font-semibold text-slate-900">{r.name}</span> },
      { header: 'Location', accessor: 'location', render: r => <span className="text-xs text-slate-600">{r.location}</span> },
      { header: 'Phone', accessor: 'phone', render: r => <span className="text-xs font-mono text-slate-500">{r.phone || '—'}</span> },
      actionsColumn('branches', 'branch')
    ],
    items: [
      { header: 'Fruit', accessor: 'name', render: r => <span className="font-semibold text-slate-900">{r.name}<span className="text-[11px] text-slate-400 font-normal block">({r.variety || 'Std'})</span></span> },
      { header: 'Category', accessor: 'category', render: r => <span className="text-xs font-semibold text-slate-700 bg-slate-100 px-2 py-0.5 rounded whitespace-nowrap">{r.category}</span> },
      { header: 'Pack / Conv', accessor: 'unitConversionFactor', render: r => {
        const kg = parseFloat(r.unitConversionFactor);
        let size;
        if ((r.packSizeUnit || '').toLowerCase() === 'pcs') {
          const pieceG = parseFloat(r.pieceWeightGrams || 0);
          const pcs = pieceG > 0 ? Math.round((kg * 1000) / pieceG) : null;
          size = pcs ? `${pcs} pcs × ${pieceG}g` : `${kg} kg`;
        } else if (kg < 1) {
          size = `${parseFloat((kg * 1000).toFixed(2))} g`;
        } else {
          size = `${parseFloat(kg)} kg`;
        }
        return <span className="text-[11px] font-mono font-semibold text-brand-800 bg-brand-50 border border-brand-100 px-2 py-0.5 rounded whitespace-nowrap inline-block">1 {r.packagingUnit} = {size}</span>;
      } },
      { header: 'Shelf Life', accessor: 'shelfLifeDays', render: r => <span className="text-xs whitespace-nowrap">{r.shelfLifeDays} days</span> },
      actionsColumn('items', 'item')
    ],
    suppliers: [
      { header: 'Supplier', accessor: 'name', render: r => <span className="font-semibold text-slate-900">{r.name}</span> },
      { header: 'Phone', accessor: 'phone', render: r => <span className="text-xs font-mono">{r.phone}</span> },
      { header: 'Branch', accessor: 'branch', render: r => <span className="text-[11px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded">{r.branch?.name || 'Unassigned'}</span> },
      { header: 'GSTIN', accessor: 'gstNumber', render: r => <span className="text-xs font-mono text-slate-500">{r.gstNumber || '—'}</span> },
      { header: 'Actions', accessor: 'id', render: r => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => openEdit(r)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-brand-700 hover:bg-brand-50 transition"
            title="Edit supplier"
          >
            <Pencil className="w-4 h-4" />
          </button>
          {isOwner && (
            <button
              onClick={() => handleDelete('suppliers', r)}
              disabled={r.isActive === false}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
              title={r.isActive === false ? 'Already deleted' : 'Delete supplier'}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      ) }
    ],
    customers: [
      { header: 'Customer', accessor: 'name', render: r => <span className="font-semibold text-slate-900">{r.name}</span> },
      { header: 'Phone', accessor: 'phone', render: r => <span className="text-xs font-mono">{r.phone}</span> },
      { header: 'Branch', accessor: 'branch', render: r => <span className="text-[11px] font-bold text-sky-700 bg-sky-50 border border-sky-200 px-2 py-0.5 rounded">{r.branch?.name || 'Unassigned'}</span> },
      { header: 'GSTIN', accessor: 'gstNumber', render: r => <span className="text-xs font-mono text-slate-500">{r.gstNumber || '—'}</span> },
      { header: 'Actions', accessor: 'id', render: r => (
        <div className="flex items-center gap-1">
          <button
            onClick={() => openEdit(r)}
            className="p-1.5 rounded-lg text-slate-400 hover:text-brand-700 hover:bg-brand-50 transition"
            title="Edit customer"
          >
            <Pencil className="w-4 h-4" />
          </button>
          {isOwner && (
            <button
              onClick={() => handleDelete('customers', r)}
              disabled={r.isActive === false}
              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition disabled:opacity-30 disabled:cursor-not-allowed"
              title={r.isActive === false ? 'Already deleted' : 'Delete customer'}
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      ) }
    ],
    agents: [
      { header: 'Agent (Arhtiya)', accessor: 'name', render: r => <span className="font-semibold text-slate-900">{r.name}</span> },
      { header: 'Phone', accessor: 'phone', render: r => <span className="text-xs font-mono">{r.phone}</span> },
      { header: 'Commission', accessor: 'defaultCommissionRate', render: r => <span className="font-mono text-xs font-bold text-purple-700">{parseFloat(r.defaultCommissionRate)}%</span> },
      actionsColumn('agents', 'agent')
    ],
    transporters: [
      { header: 'Transporter', accessor: 'name', render: r => <span className="font-semibold text-slate-900">{r.name}<span className="text-[11px] text-slate-400 block">{r.transportCompany || ''}</span></span> },
      { header: 'Vehicle', accessor: 'vehicleNumber', render: r => <span className="font-mono text-xs font-bold uppercase">{r.vehicleNumber}</span> },
      { header: 'Driver', accessor: 'driverName', render: r => <span className="text-xs">{r.driverName || '—'}<span className="text-[11px] text-slate-400 block font-mono">{r.driverPhone || ''}</span></span> },
      actionsColumn('transporters', 'transporter')
    ],
    users: [
      { header: 'User', accessor: 'name', render: r => <span className="font-semibold text-slate-900">{r.name}</span> },
      { header: 'Email', accessor: 'email', render: r => <span className="text-xs font-mono text-slate-600">{r.email}</span> },
      { header: 'Role', accessor: 'role', render: r => <span className="text-xs font-bold text-purple-700">{r.role?.replace('_', ' ')}</span> },
      { header: 'Branch', accessor: 'branch', render: r => <span className="text-xs text-slate-600">{r.branch?.name || 'All (Owner)'}</span> },
      actionsColumn('users', 'user')
    ]
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Database className="w-6 h-6 text-brand-600" />
            Master Data
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Branches, fruit catalogue with conversion factors, parties, logistics & user role management.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const rows = (data[activeTab] || []).map(row => {
                const clean = {};
                Object.entries(row).forEach(([k, v]) => {
                  clean[k] = v !== null && typeof v === 'object' ? (v.name || JSON.stringify(v)) : v;
                });
                return clean;
              });
              exportToExcel([{ name: activeTab, rows }], `master-${activeTab}`);
            }}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-bold shadow-sm transition"
            title="Download this list as Excel"
          >
            <Download className="w-4 h-4" />
            Excel
          </button>
          <button
            onClick={openCreate}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold shadow-sm transition"
          >
            <Plus className="w-4 h-4" />
            Add New {TABS.find(t => t.key === activeTab)?.label.replace(/s$/, '')}
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(t => {
          const Icon = t.icon;
          const disabled = t.key === 'users' && !isOwner;
          return (
            <button
              key={t.key}
              onClick={() => !disabled && setActiveTab(t.key)}
              disabled={disabled}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition ${
                activeTab === t.key
                  ? 'bg-slate-900 text-white shadow-sm'
                  : disabled
                    ? 'bg-slate-100 text-slate-300 cursor-not-allowed'
                    : 'bg-white border border-slate-300 text-slate-600 hover:bg-slate-50'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {t.label}
            </button>
          );
        })}
      </div>

      <DataTable
        columns={columnsByTab[activeTab]}
        data={data[activeTab]}
        searchPlaceholder={`Search ${activeTab}...`}
        searchKey={(item, term) =>
          JSON.stringify(item).toLowerCase().includes(term)
        }
        emptyMessage={`No ${activeTab} records found`}
      />

      {/* Create Modal */}
      <Modal
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
        title={`${editingId ? 'Edit' : 'Add New'} ${TABS.find(t => t.key === activeTab)?.label.replace(/s$/, '')}`}
        maxWidth="max-w-2xl"
        backdropClassName="bg-black/60 backdrop-blur-md"
      >
        {error && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {activeTab === 'branches' && (
              <>
                {renderField('name', 'Branch Name', 'text', true)}
                {renderField('code', 'Branch Code (e.g. DEL)', 'text', true, { maxLength: 5 })}
                {renderField('location', 'Location', 'text', true)}
                {renderField('phone', 'Phone')}
                <div className="sm:col-span-2">{renderField('address', 'Full Address')}</div>
              </>
            )}

            {activeTab === 'items' && (
              <>
                {renderField('name', 'Fruit Name', 'text', true)}
                {renderField('variety', 'Variety / Grade')}
                {renderSelect('packagingUnit', 'Packaging Unit', packUnitOptions, true)}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Pack Size (Conversion) *</label>
                  {form.packSizeUnit === 'pcs' ? (
                    <div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <input
                            type="number"
                            required
                            step="1"
                            min="1"
                            value={form.packSizePcs ?? ''}
                            onChange={(e) => setForm({ ...form, packSizePcs: e.target.value })}
                            className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
                            placeholder="pieces"
                          />
                          <span className="text-[10px] text-slate-400 block mt-0.5">pieces per pack</span>
                        </div>
                        <div>
                          <input
                            type="number"
                            required
                            step="any"
                            min="0.01"
                            value={form.pieceWeightGrams ?? ''}
                            onChange={(e) => setForm({ ...form, pieceWeightGrams: e.target.value })}
                            className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
                            placeholder="grams/pc"
                          />
                          <span className="text-[10px] text-slate-400 block mt-0.5">avg. grams per piece</span>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, packSizeUnit: 'g' })}
                        className="text-[10px] mt-1 text-brand-700 font-semibold hover:underline"
                      >
                        ← switch to gram/kg entry instead
                      </button>
                    </div>
                  ) : (
                    <div className="flex gap-2">
                      <input
                        type="number"
                        required
                        step="any"
                        min="0.001"
                        value={form.packSizeGrams ?? ''}
                        onChange={(e) => setForm({ ...form, packSizeGrams: e.target.value })}
                        className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono text-right"
                        placeholder="e.g. 100"
                      />
                      <select
                        value={form.packSizeUnit}
                        onChange={(e) => setForm({ ...form, packSizeUnit: e.target.value })}
                        className="p-2 bg-slate-50 border border-slate-300 rounded-lg font-bold"
                      >
                        <option value="g">g</option>
                        <option value="kg">kg</option>
                        <option value="pcs">PCS</option>
                      </select>
                    </div>
                  )}
                  <span className="text-[10px] text-slate-400 block mt-1">Stock is always tracked in kg internally{form.packSizeUnit === 'pcs' ? ' (pieces × grams/piece = kg per pack)' : ' (100 g = 0.1 kg)'}</span>
                </div>
                {renderField('shelfLifeDays', 'Shelf Life (days)', 'number', true, { step: '1', min: '1' })}
              </>
            )}

            {activeTab === 'suppliers' && (
              <>
                {renderField('name', 'Supplier Name', 'text', true)}
                {isOwner && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Branch *</label>
                    <select
                      required
                      value={form.branchId ?? ''}
                      onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-bold"
                    >
                      <option value="">Select branch...</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                    </select>
                    <span className="text-[10px] text-slate-400 block mt-0.5">The supplier will only be visible to this branch.</span>
                  </div>
                )}
                {!isOwner && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Branch</label>
                    <div className="w-full p-2 bg-slate-100 border border-slate-200 rounded-lg font-bold text-slate-600">📍 {user?.branch?.name || 'Your branch'} (auto-assigned)</div>
                  </div>
                )}
                {renderField('phone', 'Phone', 'text', true)}
                {renderField('email', 'Email', 'email')}
                {renderField('gstNumber', 'GSTIN')}
                <div className="sm:col-span-2">{renderField('address', 'Address')}</div>
              </>
            )}

            {activeTab === 'customers' && (
              <>
                {renderField('name', 'Customer Name', 'text', true)}
                {isOwner && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Branch *</label>
                    <select
                      required
                      value={form.branchId ?? ''}
                      onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-bold"
                    >
                      <option value="">Select branch...</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                    </select>
                    <span className="text-[10px] text-slate-400 block mt-0.5">The customer will only be visible to this branch.</span>
                  </div>
                )}
                {!isOwner && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Branch</label>
                    <div className="w-full p-2 bg-slate-100 border border-slate-200 rounded-lg font-bold text-slate-600">📍 {user?.branch?.name || 'Your branch'} (auto-assigned)</div>
                  </div>
                )}
                {renderField('phone', 'Phone', 'text', true)}
                {renderField('email', 'Email', 'email')}
                {renderField('gstNumber', 'GSTIN')}
                <div className="sm:col-span-2">{renderField('address', 'Address')}</div>
              </>
            )}

            {activeTab === 'agents' && (
              <>
                {renderField('name', 'Agent / Firm Name', 'text', true)}
                {isOwner && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Branch</label>
                    <select
                      value={form.branchId ?? ''}
                      onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                      className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-bold"
                    >
                      <option value="">All branches (owner-level)</option>
                      {branches.map(b => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
                    </select>
                    <span className="text-[10px] text-slate-400 block mt-0.5">Pick a branch to make this agent visible only there.</span>
                  </div>
                )}
                {!isOwner && (
                  <div>
                    <label className="block font-semibold text-slate-700 mb-1">Branch</label>
                    <div className="w-full p-2 bg-slate-100 border border-slate-200 rounded-lg font-bold text-slate-600">📍 {user?.branch?.name || 'Your branch'} (auto-assigned)</div>
                  </div>
                )}
                {renderField('contactPerson', 'Contact Person')}
                {renderField('phone', 'Phone', 'text', true)}
                {renderField('defaultCommissionRate', 'Default Commission %', 'number', true, { step: '0.1', min: '0' })}
                <div className="sm:col-span-2">{renderField('address', 'Address')}</div>
              </>
            )}

            {activeTab === 'transporters' && (
              <>
                {renderField('name', 'Transporter Name', 'text', true)}
                {renderField('vehicleNumber', 'Vehicle Number', 'text', true)}
                {renderField('driverName', 'Driver Name')}
                {renderField('driverPhone', 'Driver Phone')}
                {renderField('transportCompany', 'Transport Company')}
              </>
            )}

            {activeTab === 'users' && (
              <>
                {renderField('name', 'Full Name', 'text', true)}
                {renderField('email', 'Email', 'email', true)}
                {renderField('password', editingId ? 'New Password (leave blank to keep current)' : 'Password', 'password', !editingId, { minLength: 6 })}
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Role *</label>
                  <select
                    value={form.role}
                    onChange={(e) => setForm({ ...form, role: e.target.value })}
                    className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-bold"
                  >
                    <option value="OWNER">Owner</option>
                    <option value="BRANCH_MANAGER">Branch Manager</option>
                    <option value="STAFF">Staff</option>
                    <option value="ACCOUNTANT">Accountant</option>
                  </select>
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 mb-1">Branch</label>
                  <select
                    value={form.branchId}
                    onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                    className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
                  >
                    <option value="">None (Owner / All branches)</option>
                    {data.branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </div>
                {renderField('phone', 'Phone')}
              </>
            )}
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
              {submitting ? 'Saving...' : editingId ? 'Update Record' : 'Save Record'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default MasterData;
