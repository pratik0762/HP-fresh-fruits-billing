import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useBranch } from '../../context/BranchContext';
import DataTable from '../../components/Common/DataTable';
import Badge from '../../components/Common/Badge';
import Modal from '../../components/Common/Modal';
import { useToast } from '../../components/Common/Toast';
import { ShieldCheck, Plus, LogOut, Truck, AlertCircle } from 'lucide-react';

const GatePasses = () => {
  const { isOwner, user } = useAuth();
  const { activeBranchId } = useBranch();
  const toast = useToast();
  const [passes, setPasses] = useState([]);
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);

  const [isOpen, setIsOpen] = useState(false);
  const [form, setForm] = useState({
    branchId: !isOwner && user?.branchId
      ? String(user.branchId)
      : (activeBranchId && activeBranchId !== 'all' ? activeBranchId : ''),
    passType: 'INWARD',
    vehicleNumber: '',
    driverName: '',
    driverPhone: '',
    purpose: 'PURCHASE_DELIVERY',
    grossWeightKg: '',
    tareWeightKg: '',
    securityGuardName: '',
    notes: ''
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const fetchPasses = async () => {
    try {
      setLoading(true);
      const [gpRes, brRes] = await Promise.all([
        api.get('/gate-passes'),
        api.get('/masters/branches')
      ]);
      if (gpRes.data.success) setPasses(gpRes.data.passes);
      if (brRes.data.success) setBranches(brRes.data.branches);
    } catch (err) {
      console.error('Failed to load gate passes', err);
      toast.error('Could not load gate passes. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPasses();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const res = await api.post('/gate-passes', {
        branchId: parseInt(form.branchId),
        passType: form.passType,
        vehicleNumber: form.vehicleNumber,
        driverName: form.driverName,
        driverPhone: form.driverPhone,
        purpose: form.purpose,
        grossWeightKg: form.grossWeightKg ? parseFloat(form.grossWeightKg) : null,
        tareWeightKg: form.tareWeightKg ? parseFloat(form.tareWeightKg) : null,
        securityGuardName: form.securityGuardName,
        notes: form.notes
      });
      if (res.data.success) {
        toast.success('Gate pass issued successfully');
        setIsOpen(false);
        fetchPasses();
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Failed to issue gate pass';
      setError(msg);
      toast.error('Could not issue gate pass: ' + msg);
    } finally {
      setSubmitting(false);
    }
  };

  const handleMarkExit = async (pass) => {
    if (!window.confirm(`Mark vehicle ${pass.vehicleNumber} as exited?`)) return;
    try {
      const res = await api.put(`/gate-passes/${pass.id}/exit`, {});
      if (res.data.success) {
        toast.success(`Vehicle ${pass.vehicleNumber} marked as exited`);
        fetchPasses();
      }
    } catch (err) {
      toast.error(err.response?.data?.message || 'Could not mark exit. Please try again.');
    }
  };

  const columns = [
    {
      header: 'Pass #',
      accessor: 'passNumber',
      render: (row) => <span className="font-mono font-bold text-brand-700 text-xs">{row.passNumber}</span>
    },
    {
      header: 'Time In',
      accessor: 'timeIn',
      render: (row) => (
        <span className="text-xs text-slate-500">
          {new Date(row.timeIn).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
        </span>
      )
    },
    {
      header: 'Vehicle',
      accessor: 'vehicleNumber',
      render: (row) => (
        <div className="flex items-center gap-1.5">
          <Truck className="w-3.5 h-3.5 text-slate-400" />
          <span className="font-mono font-bold text-xs text-slate-800 uppercase">{row.vehicleNumber}</span>
        </div>
      )
    },
    {
      header: 'Type / Purpose',
      accessor: 'passType',
      render: (row) => (
        <div className="text-xs">
          <Badge variant={row.passType === 'INWARD' ? 'info' : 'purple'}>{row.passType}</Badge>
          <span className="block text-[10px] text-slate-400 mt-1">{row.purpose?.replace(/_/g, ' ')}</span>
        </div>
      )
    },
    {
      header: 'Branch',
      accessor: 'branch',
      render: (row) => <span className="text-xs text-slate-600">{row.branch?.name}</span>
    },
    {
      header: 'Net Fruit Wt',
      accessor: 'netFruitWeightKg',
      render: (row) => (
        <span className="font-mono text-xs font-bold text-slate-800">
          {row.netFruitWeightKg ? `${parseFloat(row.netFruitWeightKg).toLocaleString('en-IN')} kg` : '—'}
        </span>
      )
    },
    {
      header: 'Status',
      accessor: 'status',
      render: (row) => <Badge variant={row.status === 'IN_PREMISES' ? 'warning' : 'success'}>{row.status === 'IN_PREMISES' ? 'IN PREMISES' : 'EXITED'}</Badge>
    },
    {
      header: 'Actions',
      accessor: 'id',
      render: (row) =>
        row.status === 'IN_PREMISES' ? (
          <button
            onClick={() => handleMarkExit(row)}
            title="Mark vehicle exit"
            className="p-1.5 rounded-lg text-slate-500 hover:text-rose-600 hover:bg-rose-50 transition"
          >
            <LogOut className="w-4 h-4" />
          </button>
        ) : (
          <span className="text-[11px] text-slate-400">
            {row.timeOut ? new Date(row.timeOut).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' }) : ''}
          </span>
        )
    }
  ];

  const inPremisesCount = passes.filter(p => p.status === 'IN_PREMISES').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <ShieldCheck className="w-6 h-6 text-brand-600" />
            Security Gate Register
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Vehicle weighbridge log with fruit net-weight calculation — {inPremisesCount} vehicle(s) currently in premises.
          </p>
        </div>

        <button
          onClick={() => setIsOpen(true)}
          className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-xs font-bold shadow-sm transition"
        >
          <Plus className="w-4 h-4" />
          Issue Gate Pass
        </button>
      </div>

      <DataTable
        columns={columns}
        data={passes}
        searchPlaceholder="Search pass number or vehicle..."
        searchKey={(p, term) =>
          p.passNumber?.toLowerCase().includes(term) ||
          p.vehicleNumber?.toLowerCase().includes(term) ||
          p.driverName?.toLowerCase().includes(term)
        }
        emptyMessage="No gate passes issued yet"
      />

      {/* Create Modal */}
      <Modal isOpen={isOpen} onClose={() => setIsOpen(false)} title="Issue New Gate Pass" maxWidth="max-w-2xl">
        {error && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleCreate} className="space-y-4 text-xs">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block font-semibold text-slate-700 mb-1">Branch</label>
              {isOwner ? (
                <select
                  required
                  value={form.branchId}
                  onChange={(e) => setForm({ ...form, branchId: e.target.value })}
                  className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
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
              <label className="block font-semibold text-slate-700 mb-1">Pass Type</label>
              <select
                value={form.passType}
                onChange={(e) => setForm({ ...form, passType: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-bold"
              >
                <option value="INWARD">INWARD (Vehicle entering with fruit)</option>
                <option value="OUTWARD">OUTWARD (Vehicle dispatching fruit)</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Vehicle Number *</label>
              <input
                type="text"
                required
                value={form.vehicleNumber}
                onChange={(e) => setForm({ ...form, vehicleNumber: e.target.value })}
                placeholder="HP-01-AA-4582"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono uppercase"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Purpose</label>
              <select
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              >
                <option value="PURCHASE_DELIVERY">Purchase Delivery (Inward Fruit)</option>
                <option value="SALE_DISPATCH">Sale Dispatch (Outward Fruit)</option>
                <option value="STOCK_TRANSFER">Inter-Branch Stock Transfer</option>
                <option value="EMPTY_CRATES">Empty Crate Return</option>
                <option value="OTHER">Other</option>
              </select>
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Driver Name</label>
              <input
                type="text"
                value={form.driverName}
                onChange={(e) => setForm({ ...form, driverName: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Driver Phone</label>
              <input
                type="tel"
                value={form.driverPhone}
                onChange={(e) => setForm({ ...form, driverPhone: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Gross Weight (Kg)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={form.grossWeightKg}
                onChange={(e) => setForm({ ...form, grossWeightKg: e.target.value })}
                placeholder="Weighbridge reading"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
            </div>

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Tare Weight (Kg)</label>
              <input
                type="number"
                step="0.5"
                min="0"
                value={form.tareWeightKg}
                onChange={(e) => setForm({ ...form, tareWeightKg: e.target.value })}
                placeholder="Empty vehicle weight"
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg font-mono"
              />
            </div>

            {form.grossWeightKg && form.tareWeightKg && parseFloat(form.grossWeightKg) > parseFloat(form.tareWeightKg) && (
              <div className="sm:col-span-2 p-3 bg-brand-50 border border-brand-200 rounded-lg text-brand-800 font-semibold text-center">
                Net Fruit Weight: {(parseFloat(form.grossWeightKg) - parseFloat(form.tareWeightKg)).toFixed(2)} kg
              </div>
            )}

            <div>
              <label className="block font-semibold text-slate-700 mb-1">Security Guard on Duty</label>
              <input
                type="text"
                value={form.securityGuardName}
                onChange={(e) => setForm({ ...form, securityGuardName: e.target.value })}
                className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
              />
            </div>

            <div className="sm:col-span-2">
              <label className="block font-semibold text-slate-700 mb-1">Notes</label>
              <textarea
                rows={2}
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
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
              {submitting ? 'Issuing...' : 'Issue Gate Pass'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default GatePasses;
