import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import DataTable from '../../components/Common/DataTable';
import Badge from '../../components/Common/Badge';
import Modal from '../../components/Common/Modal';
import { useToast } from '../../components/Common/Toast';
import { exportToExcel } from '../../utils/excelExport';
import { BookOpen, Search, ShieldCheck, AlertTriangle, ArrowLeftRight, Download } from 'lucide-react';

const LedgerView = () => {
  const { isOwner, isAccountant } = useAuth();
  const toast = useToast();
  const canReverse = isOwner || isAccountant;
  const [partyType, setPartyType] = useState('CUSTOMER');
  const [parties, setParties] = useState([]);
  const [selectedParty, setSelectedParty] = useState(null);
  const [statement, setStatement] = useState(null);
  const [includeReversed, setIncludeReversed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [statementLoading, setStatementLoading] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Reversal modal
  const [isReverseOpen, setIsReverseOpen] = useState(false);
  const [reverseTarget, setReverseTarget] = useState(null);
  const [reverseReason, setReverseReason] = useState('');
  const [reverseError, setReverseError] = useState('');
  const [reverseSubmitting, setReverseSubmitting] = useState(false);

  useEffect(() => {
    const fetchParties = async () => {
      try {
        setLoading(true);
        setSelectedParty(null);
        setStatement(null);
        const endpoint = partyType === 'CUSTOMER' ? '/masters/customers' : '/masters/suppliers';
        const res = await api.get(endpoint);
        if (res.data.success) setParties(partyType === 'CUSTOMER' ? res.data.customers : res.data.suppliers);
      } catch (err) {
        console.error('Failed to load parties', err);
        toast.error('Could not load party list. Please refresh the page.');
      } finally {
        setLoading(false);
      }
    };
    fetchParties();
  }, [partyType]);

  const openStatement = async (party, withReversed = includeReversed) => {
    setSelectedParty(party);
    setStatementLoading(true);
    try {
      const res = await api.get(`/ledgers/statement?partyType=${partyType}&partyId=${party.id}&includeReversed=${withReversed}`);
      if (res.data.success) setStatement(res.data);
    } catch (err) {
      console.error('Failed to load statement', err);
      toast.error('Could not load ledger statement. Please try again.');
    } finally {
      setStatementLoading(false);
    }
  };

  const handleExportStatement = () => {
    if (!statement) return;
    const rows = (statement.statement || []).map(tx => ({
      Date: tx.date,
      'Voucher #': tx.transactionNumber,
      Type: tx.type,
      Reference: tx.referenceNumber || '',
      Account: tx.accountType,
      Debit: tx.debitAmount,
      Credit: tx.creditAmount,
      'Running Balance': tx.runningBalance,
      Reversed: tx.isReversed ? 'YES' : '',
      Notes: tx.notes || ''
    }));
    exportToExcel([
      { name: 'Statement', rows },
      {
        name: 'Summary',
        rows: [{
          Party: statement.party.name,
          Type: partyType,
          Phone: statement.party.phone || '',
          'Opening Balance': statement.summary.openingBalance,
          'Closing Balance': statement.summary.closingBalance,
          'Total Entries': statement.summary.totalEntries
        }]
      }
    ], `ledger-statement_${statement.party.name.replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 30)}`);
  };

  const openReverse = (tx) => {
    setReverseTarget(tx);
    setReverseReason('');
    setReverseError('');
    setIsReverseOpen(true);
  };

  const handleReverse = async (e) => {
    e.preventDefault();
    if (!reverseReason.trim()) {
      setReverseError('Reversal reason is required (audit trail).');
      toast.warning('Please write a reason for the reversal');
      return;
    }
    setReverseSubmitting(true);
    setReverseError('');
    try {
      const res = await api.post(`/ledgers/reverse/${reverseTarget.id}`, { reason: reverseReason });
      if (res.data.success) {
        toast.success('Reversal entry posted successfully');
        setIsReverseOpen(false);
        openStatement(selectedParty); // refresh statement
      }
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Reversal failed';
      setReverseError(msg);
      toast.error('Could not post reversal: ' + msg);
    } finally {
      setReverseSubmitting(false);
    }
  };

  const filteredParties = parties.filter(p =>
    !searchTerm || p.name?.toLowerCase().includes(searchTerm.toLowerCase()) || p.phone?.includes(searchTerm)
  );

  const statementColumns = [
    {
      header: 'Date',
      accessor: 'date',
      render: (row) => <span className="text-xs text-slate-500">{row.date}</span>
    },
    {
      header: 'Tx Number',
      accessor: 'transactionNumber',
      render: (row) => <span className="font-mono font-bold text-brand-700 text-xs">{row.transactionNumber}</span>
    },
    {
      header: 'Type',
      accessor: 'type',
      render: (row) => <Badge variant="info">{row.type.replace(/_/g, ' ')}</Badge>
    },
    {
      header: 'Reference',
      accessor: 'referenceNumber',
      render: (row) => <span className="font-mono text-xs text-slate-600">{row.referenceNumber || '—'}</span>
    },
    {
      header: 'Account',
      accessor: 'accountType',
      render: (row) => <span className="text-xs text-slate-600">{row.accountType.replace(/_/g, ' ')}</span>
    },
    {
      header: 'Debit',
      accessor: 'debitAmount',
      render: (row) => (
        <span className="font-mono text-xs text-emerald-700">
          {row.debitAmount > 0 ? `₹${row.debitAmount.toLocaleString('en-IN')}` : '—'}
        </span>
      )
    },
    {
      header: 'Credit',
      accessor: 'creditAmount',
      render: (row) => (
        <span className="font-mono text-xs text-rose-700">
          {row.creditAmount > 0 ? `₹${row.creditAmount.toLocaleString('en-IN')}` : '—'}
        </span>
      )
    },
    {
      header: 'Balance',
      accessor: 'runningBalance',
      render: (row) => (
        <span className="font-mono font-bold text-xs text-slate-900">₹{row.runningBalance.toLocaleString('en-IN')}</span>
      )
    },
    {
      header: 'Status',
      accessor: 'isReversed',
      render: (row) => {
        if (row.isReversed) return <Badge variant="danger">Reversed</Badge>;
        if (!canReverse) return <span className="text-[11px] text-slate-400">—</span>;
        return (
          <button
            onClick={() => openReverse(row)}
            title="Post reversing entry"
            className="p-1 text-slate-400 hover:text-rose-600 transition"
          >
            <ArrowLeftRight className="w-3.5 h-3.5" />
          </button>
        );
      }
    }
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <BookOpen className="w-6 h-6 text-brand-600" />
            Party Ledgers (Append-Only Audit)
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Immutable double-entry statements with cryptographic-style integrity verification.
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Audit toggle: show the raw append-only ledger including reversal pairs */}
          {selectedParty && (
            <label className="inline-flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeReversed}
                onChange={(e) => {
                  setIncludeReversed(e.target.checked);
                  if (selectedParty) openStatement(selectedParty, e.target.checked);
                }}
                className="w-4 h-4 text-brand-600 rounded focus:ring-brand-500"
              />
              <span className="text-xs font-bold text-slate-600">Show reversed entries</span>
            </label>
          )}

          <div className="inline-flex rounded-lg border border-slate-300 p-1 bg-white shadow-2xs">
          <button
            onClick={() => setPartyType('CUSTOMER')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${
              partyType === 'CUSTOMER' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Customer Receivables
          </button>
          <button
            onClick={() => setPartyType('SUPPLIER')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${
              partyType === 'SUPPLIER' ? 'bg-brand-600 text-white' : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Supplier Payables
          </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Party List */}
        <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden ${selectedParty ? 'lg:col-span-1' : 'lg:col-span-3'}`}>
          <div className="p-4 border-b border-slate-200 bg-slate-50/50">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder={`Search ${partyType.toLowerCase()}...`}
                className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </div>
          </div>
          <div className="divide-y divide-slate-100 max-h-[70vh] overflow-y-auto">
            {loading ? (
              <p className="p-6 text-center text-xs text-slate-400">Loading parties...</p>
            ) : filteredParties.length === 0 ? (
              <p className="p-6 text-center text-xs text-slate-400">No parties found.</p>
            ) : (
              filteredParties.map(p => (
                <button
                  key={p.id}
                  onClick={() => openStatement(p)}
                  className={`w-full text-left p-4 hover:bg-slate-50 transition ${
                    selectedParty?.id === p.id ? 'bg-brand-50/70 border-l-4 border-brand-600' : ''
                  }`}
                >
                  <span className="block font-bold text-sm text-slate-900">{p.name}</span>
                  <span className="text-[11px] text-slate-500">{p.phone || '—'}</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Statement */}
        {selectedParty && (
          <div className="lg:col-span-2 space-y-4">
            {statementLoading ? (
              <div className="bg-white p-10 rounded-xl border border-slate-200 text-center text-xs text-slate-400">
                Loading ledger statement...
              </div>
            ) : statement ? (
              <>
                {/* Summary Card */}
                <div className="bg-gradient-to-r from-slate-900 to-slate-800 p-5 rounded-xl text-white flex items-center justify-between">
                  <div>
                    <h3 className="font-bold text-sm">{statement.party.name}</h3>
                    <p className="text-[11px] text-slate-300 mt-0.5">
                      Opening: ₹{statement.summary.openingBalance.toLocaleString('en-IN')} •{' '}
                      {statement.summary.totalEntries} ledger entries
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      onClick={handleExportStatement}
                      className="p-2 bg-emerald-600 hover:bg-emerald-700 rounded-lg transition"
                      title="Download statement as Excel"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <div className="text-right">
                      <span className="text-[10px] uppercase tracking-wider text-slate-400 block">
                        {partyType === 'CUSTOMER' ? 'Receivable Balance' : 'Payable Balance'}
                      </span>
                      <span className="text-2xl font-black font-mono">
                        ₹{statement.summary.closingBalance.toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>
                </div>

                <DataTable
                  columns={statementColumns}
                  data={statement.statement}
                  searchPlaceholder="Search transactions..."
                  searchKey={(tx, term) =>
                    tx.transactionNumber?.toLowerCase().includes(term) ||
                    tx.referenceNumber?.toLowerCase().includes(term) ||
                    tx.type?.toLowerCase().includes(term)
                  }
                  emptyMessage="No ledger entries for this period"
                />
              </>
            ) : null}
          </div>
        )}
      </div>

      {/* Reverse Modal */}
      <Modal isOpen={isReverseOpen} onClose={() => setIsReverseOpen(false)} title="Post Ledger Reversal Entry" maxWidth="max-w-lg">
        {reverseError && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold rounded-lg flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" />
            <span>{reverseError}</span>
          </div>
        )}

        {reverseTarget && (
          <div className="mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
            <p className="font-bold text-slate-800">{reverseTarget.transactionNumber}</p>
            <p className="text-slate-600 mt-1">
              Debit: ₹{reverseTarget.debitAmount.toLocaleString('en-IN')} • Credit: ₹{reverseTarget.creditAmount.toLocaleString('en-IN')}
            </p>
            <p className="text-[11px] text-slate-500 mt-1 italic">{reverseTarget.notes}</p>
          </div>
        )}

        <form onSubmit={handleReverse} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">
              Reversal Reason * (permanently recorded in audit trail)
            </label>
            <textarea
              rows={3}
              required
              value={reverseReason}
              onChange={(e) => setReverseReason(e.target.value)}
              placeholder="e.g. Duplicate entry posted by mistake on dated..."
              className="w-full p-2 bg-slate-50 border border-slate-300 rounded-lg"
            />
          </div>

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2 text-amber-800">
            <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              The original entry is never deleted. An opposing reversing entry will be appended, preserving the
              immutable audit chain.
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200">
            <button
              type="button"
              onClick={() => setIsReverseOpen(false)}
              className="px-4 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg font-bold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={reverseSubmitting}
              className="px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-bold shadow-sm disabled:opacity-60"
            >
              {reverseSubmitting ? 'Reversing...' : 'Post Reversing Entry'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
};

export default LedgerView;
