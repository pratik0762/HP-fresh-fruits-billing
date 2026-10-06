import React, { useState, useEffect } from 'react';
import api from '../../api/client';
import { useBranch } from '../../context/BranchContext';
import { useToast } from '../../components/Common/Toast';
import { Clock } from 'lucide-react';

const AgingReport = () => {
  const { activeBranchId } = useBranch();
  const toast = useToast();
  const [partyType, setPartyType] = useState('CUSTOMER'); // 'CUSTOMER' or 'SUPPLIER'
  const [agingData, setAgingData] = useState(null);
  const [loading, setLoading] = useState(true);

  const fetchAging = async () => {
    try {
      setLoading(true);
      const res = await api.get(`/reports/aging?partyType=${partyType}`);
      if (res.data.success) {
        setAgingData(res.data.aging);
      }
    } catch (err) {
      console.error('Failed to load aging report', err);
      toast.error('Could not load aging report. Please refresh the page.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAging();
  }, [partyType, activeBranchId]);

  const bucketColors = {
    '0-7': 'border-emerald-200 bg-emerald-50/50 text-emerald-800',
    '8-15': 'border-blue-200 bg-blue-50/50 text-blue-800',
    '16-30': 'border-amber-200 bg-amber-50/50 text-amber-800',
    '30+': 'border-rose-200 bg-rose-50/50 text-rose-800'
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-2">
            <Clock className="w-6 h-6 text-brand-600" />
            Overdue Payment Aging Schedule
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Aging analysis divided into 0–7, 8–15, 16–30, and 30+ days overdue buckets.
          </p>
        </div>

        {/* Toggle Party Type */}
        <div className="inline-flex rounded-lg border border-slate-300 p-1 bg-white shadow-2xs">
          <button
            onClick={() => setPartyType('CUSTOMER')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${
              partyType === 'CUSTOMER'
                ? 'bg-brand-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Customer Receivables
          </button>
          <button
            onClick={() => setPartyType('SUPPLIER')}
            className={`px-3 py-1.5 rounded-md text-xs font-bold transition ${
              partyType === 'SUPPLIER'
                ? 'bg-brand-600 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900'
            }`}
          >
            Supplier Payables
          </button>
        </div>
      </div>

      {/* Summary Buckets Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {agingData?.buckets && Object.entries(agingData.buckets).map(([key, b]) => (
          <div key={key} className={`p-4 rounded-xl border ${bucketColors[key]} shadow-xs`}>
            <span className="text-[11px] font-bold uppercase tracking-wider block opacity-75">{b.label}</span>
            <div className="text-2xl font-black font-mono mt-1">₹{b.total.toLocaleString('en-IN')}</div>
            <span className="text-xs mt-1 block font-medium opacity-90">{b.count} invoices pending</span>
          </div>
        ))}
      </div>

      {/* Detailed Bucket Lists */}
      <div className="space-y-6">
        {agingData?.buckets && Object.entries(agingData.buckets).map(([key, b]) => (
          <div key={key} className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
            <div className="px-5 py-3.5 bg-slate-50/80 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full ${key === '30+' ? 'bg-rose-500 animate-pulse' : 'bg-brand-500'}`}></span>
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-800">{b.label}</h3>
              </div>
              <span className="text-xs font-mono font-bold text-slate-900">
                Subtotal: ₹{b.total.toLocaleString('en-IN')} ({b.count})
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-100 text-slate-500 font-semibold uppercase text-[11px] bg-slate-50/30">
                    <th className="p-3">Invoice #</th>
                    <th className="p-3">Date</th>
                    <th className="p-3">{partyType === 'CUSTOMER' ? 'Customer Name' : 'Supplier Name'}</th>
                    <th className="p-3">Phone</th>
                    <th className="p-3 text-right">Invoice Total</th>
                    <th className="p-3 text-right">Paid</th>
                    <th className="p-3 text-right">Balance Due</th>
                    <th className="p-3 text-center">Days Overdue</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {b.items?.map((item) => (
                    <tr key={item.id} className="hover:bg-slate-50/80">
                      <td className="p-3 font-mono font-bold text-brand-700">{item.invoiceNumber}</td>
                      <td className="p-3 text-slate-500">{item.saleDate || item.purchaseDate}</td>
                      <td className="p-3 font-semibold text-slate-900">{item.customerName || item.supplierName}</td>
                      <td className="p-3 text-slate-500">{item.customerPhone || item.supplierPhone || '—'}</td>
                      <td className="p-3 text-right font-mono text-slate-700">₹{item.totalAmount.toLocaleString('en-IN')}</td>
                      <td className="p-3 text-right font-mono text-emerald-700">₹{item.paidAmount.toLocaleString('en-IN')}</td>
                      <td className="p-3 text-right font-mono font-bold text-rose-700">₹{item.dueAmount.toLocaleString('en-IN')}</td>
                      <td className="p-3 text-center">
                        <span className={`px-2 py-0.5 rounded font-bold ${
                          item.daysOverdue > 30 ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700'
                        }`}>
                          {item.daysOverdue} days
                        </span>
                      </td>
                    </tr>
                  ))}
                  {b.items?.length === 0 && (
                    <tr>
                      <td colSpan={8} className="p-4 text-center text-slate-400">No overdue invoices in this aging bucket.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default AgingReport;
