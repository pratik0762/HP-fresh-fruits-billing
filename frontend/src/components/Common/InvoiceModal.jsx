import React from 'react';
import Modal from './Modal';
import Badge from './Badge';
import { Printer, Download } from 'lucide-react';

const InvoiceModal = ({ isOpen, onClose, data, type = 'SALE' }) => {
  if (!data) return null;

  const isSale = type === 'SALE';
  const title = isSale ? `Tax / Mandi Invoice #${data.invoiceNumber}` : `Purchase Bill #${data.invoiceNumber}`;
  const party = isSale ? data.customer : data.supplier;
  const partyTitle = isSale ? 'Billed To (Buyer / Customer)' : 'Received From (Supplier / Grower)';

  const handlePrint = () => {
    window.print();
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} maxWidth="max-w-4xl">
      <div className="flex justify-end gap-2 mb-4 no-print">
        <button
          onClick={handlePrint}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white rounded-lg text-sm font-semibold shadow-sm transition"
        >
          <Printer className="w-4 h-4" />
          Print / Save PDF
        </button>
      </div>

      <div id="printable-invoice" className="bg-white p-6 rounded-xl border border-slate-200 text-slate-800">
        {/* Header */}
        <div className="flex justify-between items-start border-b border-slate-200 pb-6">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-2xl">🍏</span>
              <h1 className="text-2xl font-black text-slate-900 tracking-tight">HP FRESH FRUITS ERP</h1>
            </div>
            <p className="text-xs text-slate-500 font-medium mt-1">Multi-Branch Fruit Trading, Cold Storage & Mandi Supply</p>
            <p className="text-xs text-slate-600 mt-2">
              <strong className="text-slate-800">{data.branch?.name || 'Central Mandi Office'}</strong><br />
              {data.branch?.address || 'Azadpur Mandi Wholesale Yard, Delhi'}<br />
              Phone: {data.branch?.phone || '+91 11 2767 8901'}
            </p>
          </div>

          <div className="text-right">
            <h2 className="text-lg font-bold text-brand-700 tracking-wide uppercase">
              {isSale ? 'TAX / SALE INVOICE' : 'PURCHASE BILL'}
            </h2>
            <p className="text-sm font-semibold text-slate-900 mt-1">{data.invoiceNumber}</p>
            <p className="text-xs text-slate-500 mt-0.5">Date: {data.saleDate || data.purchaseDate}</p>
            <div className="mt-2">
              <Badge variant={data.paymentStatus}>{data.paymentStatus}</Badge>
            </div>
          </div>
        </div>

        {/* Parties Grid */}
        <div className="grid grid-cols-2 gap-8 my-6 text-xs">
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <span className="font-bold text-slate-500 uppercase tracking-wider block mb-1">{partyTitle}</span>
            <p className="font-bold text-sm text-slate-900">{party?.name || 'Party Name'}</p>
            <p className="text-slate-600 mt-1">{party?.address || 'Mandi Yard'}</p>
            <p className="text-slate-600">Phone: {party?.phone || '—'}</p>
            {party?.gstNumber && <p className="text-slate-600 font-mono mt-1">GSTIN: {party.gstNumber}</p>}
          </div>

          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
            <span className="font-bold text-slate-500 uppercase tracking-wider block mb-1">Logistics & Deal Info</span>
            <p className="text-slate-700"><strong className="text-slate-900">Vehicle No:</strong> {data.vehicleNumber || data.transporter?.vehicleNumber || 'Self Pickup'}</p>
            {data.transporter?.name && <p className="text-slate-700"><strong className="text-slate-900">Transporter:</strong> {data.transporter.name}</p>}
            {data.hasAgent && data.agent && (
              <p className="text-slate-700 mt-1">
                <strong className="text-slate-900">Commission Agent:</strong> {data.agent.name} ({data.agentCommissionRate}%)
              </p>
            )}
            <p className="text-slate-700 mt-1"><strong className="text-slate-900">Payment Mode:</strong> {data.paymentMode}</p>
          </div>
        </div>

        {/* Itemized Table */}
        <div className="overflow-x-auto my-6">
          <table className="w-full text-xs text-left border-collapse border border-slate-200">
            <thead>
              <tr className="bg-slate-100 text-slate-700 font-bold uppercase tracking-wider">
                <th className="border border-slate-200 p-2 text-center w-8">#</th>
                <th className="border border-slate-200 p-2">Item Description</th>
                <th className="border border-slate-200 p-2 text-right">Quantity</th>
                <th className="border border-slate-200 p-2 text-right">Net Wt (Kg)</th>
                <th className="border border-slate-200 p-2 text-right">Rate</th>
                <th className="border border-slate-200 p-2 text-right">Discount</th>
                <th className="border border-slate-200 p-2 text-right">Subtotal (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {(data.items || []).map((itm, idx) => (
                <tr key={idx} className="hover:bg-slate-50">
                  <td className="border border-slate-200 p-2 text-center text-slate-500">{idx + 1}</td>
                  <td className="border border-slate-200 p-2 font-medium text-slate-900">
                    {itm.item?.name} {itm.item?.variety ? `— ${itm.item.variety}` : ''}
                  </td>
                  <td className="border border-slate-200 p-2 text-right font-mono">
                    {itm.quantity || itm.receivedQuantity} {itm.unit}
                  </td>
                  <td className="border border-slate-200 p-2 text-right font-mono">
                    {itm.weightKg || itm.receivedWeightKg} kg
                  </td>
                  <td className="border border-slate-200 p-2 text-right font-mono">
                    ₹{parseFloat(itm.ratePerUnit).toFixed(2)}
                  </td>
                  <td className="border border-slate-200 p-2 text-right font-mono text-rose-600">
                    {parseFloat(itm.discountAmount) > 0 ? `-₹${parseFloat(itm.discountAmount).toFixed(2)}` : '0.00'}
                  </td>
                  <td className="border border-slate-200 p-2 text-right font-semibold font-mono text-slate-900">
                    ₹{parseFloat(itm.subtotal).toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Financial Breakdown */}
        <div className="flex justify-between items-start my-6">
          <div className="w-1/2 text-xs text-slate-600 space-y-1">
            <p className="font-bold text-slate-800 uppercase">Terms & Audit Trail</p>
            <p>• Goods once sold cannot be returned after mandi gate departure.</p>
            <p>• Stock batch deductions strictly allocated via FIFO.</p>
            <p>• Immutable ledger hash logged in transaction ledger.</p>
            {data.notes && <p className="mt-2 text-slate-700 italic">Note: {data.notes}</p>}
          </div>

          <div className="w-1/3 bg-slate-50 p-4 rounded-lg border border-slate-200 space-y-2 text-xs">
            <div className="flex justify-between text-slate-600">
              <span>Items Subtotal:</span>
              <span className="font-mono font-medium">₹{parseFloat(data.subtotal).toFixed(2)}</span>
            </div>
            {parseFloat(data.discountAmount) > 0 && (
              <div className="flex justify-between text-rose-600">
                <span>Total Discount:</span>
                <span className="font-mono font-medium">-₹{parseFloat(data.discountAmount).toFixed(2)}</span>
              </div>
            )}
            {parseFloat(data.freightCharges) > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Freight Charges:</span>
                <span className="font-mono font-medium">+₹{parseFloat(data.freightCharges).toFixed(2)}</span>
              </div>
            )}
            {!isSale && (parseFloat(data.loadingCharges) > 0 || parseFloat(data.otherCharges) > 0) && (
              <div className="flex justify-between text-slate-600">
                <span>Loading / Other Charges:</span>
                <span className="font-mono font-medium">+₹{(parseFloat(data.loadingCharges || 0) + parseFloat(data.otherCharges || 0)).toFixed(2)}</span>
              </div>
            )}
            {parseFloat(data.agentCommissionAmount) > 0 && (
              <div className="flex justify-between text-slate-600">
                <span>Mandi Commission:</span>
                <span className="font-mono font-medium">₹{parseFloat(data.agentCommissionAmount).toFixed(2)}</span>
              </div>
            )}
            <div className="border-t border-slate-300 pt-2 flex justify-between text-sm font-bold text-slate-900">
              <span>Total Bill Amount:</span>
              <span className="font-mono text-brand-700">
                ₹{(isSale
                  ? parseFloat(data.subtotal || 0) - parseFloat(data.discountAmount || 0) + parseFloat(data.taxAmount || 0) + parseFloat(data.freightCharges || 0)
                  : parseFloat(data.totalAmount || 0)
                ).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between text-emerald-700 font-medium">
              <span>Paid Amount:</span>
              <span className="font-mono">₹{parseFloat(data.paidAmount || 0).toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-rose-700 font-bold border-t border-slate-200 pt-1">
              <span>Balance Due:</span>
              <span className="font-mono">₹{parseFloat(data.dueAmount || 0).toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Footer Signature */}
        <div className="mt-12 pt-6 border-t border-slate-200 flex justify-between items-end text-xs text-slate-500">
          <div>
            <p>Prepared By: Staff Entry Operator</p>
            <p>Verified By: Mandi Branch Manager</p>
          </div>
          <div className="text-right">
            <div className="w-40 border-b border-slate-400 mb-1"></div>
            <p className="font-semibold text-slate-700">Authorized Signatory</p>
            <p className="text-[10px]">HP Fresh Fruits ERP</p>
          </div>
        </div>
      </div>
    </Modal>
  );
};

export default InvoiceModal;
