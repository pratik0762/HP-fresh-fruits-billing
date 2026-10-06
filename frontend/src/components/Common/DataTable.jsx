import React, { useState } from 'react';
import { Search, ChevronLeft, ChevronRight } from 'lucide-react';

const DataTable = ({
  columns,
  data = [],
  searchPlaceholder = 'Search records...',
  searchKey,
  emptyMessage = 'No records found',
  actions,
  mobileCards = true
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 15;

  const filteredData = data.filter(item => {
    if (!searchTerm) return true;
    if (searchKey && typeof searchKey === 'function') {
      return searchKey(item, searchTerm.toLowerCase());
    }
    const val = searchKey ? item[searchKey] : Object.values(item).join(' ');
    return String(val || '').toLowerCase().includes(searchTerm.toLowerCase());
  });

  const totalPages = Math.ceil(filteredData.length / pageSize) || 1;
  const paginatedData = filteredData.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      {/* Search & Actions Header */}
      <div className="p-4 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4 bg-slate-50/50">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
            placeholder={searchPlaceholder}
            className="w-full pl-9 pr-4 py-2 text-sm bg-white border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
          />
        </div>
        {actions && (
          <div className="flex items-center gap-2">
            {actions}
          </div>
        )}
      </div>

      {/* ---------- Mobile / Tablet: card list ---------- */}
      {mobileCards && (
        <div className="md:hidden divide-y divide-slate-100">
          {paginatedData.length > 0 ? (
            paginatedData.map((row, rIdx) => {
              const [first, ...rest] = columns;
              return (
                <div key={rIdx} className="p-3.5 active:bg-slate-50">
                  {/* First column as the card title */}
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="min-w-0 flex-1">
                      {first.render ? first.render(row) : (row[first.accessor] ?? '—')}
                    </div>
                  </div>
                  {/* Remaining columns as compact key-value rows */}
                  <div className="space-y-1.5">
                    {rest.map((col, cIdx) => (
                      <div key={cIdx} className="flex items-baseline justify-between gap-3 text-xs">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400 shrink-0">
                          {col.header}
                        </span>
                        <span className="text-right min-w-0 break-words">
                          {col.render ? col.render(row) : (row[col.accessor] ?? '—')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-12 text-center text-slate-400">
              <p className="text-base font-medium text-slate-500">{emptyMessage}</p>
              <p className="text-xs text-slate-400 mt-1">Try adjusting your search query or filters</p>
            </div>
          )}
        </div>
      )}

      {/* ---------- Desktop: full table ---------- */}
      <div className={`${mobileCards ? 'hidden md:block' : ''} overflow-x-auto`}>
        <table className="w-full text-left border-collapse text-sm">
          <thead>
            <tr className="border-b border-slate-200 bg-slate-100/70 text-slate-600 font-semibold text-xs uppercase tracking-wider">
              {columns.map((col, idx) => (
                <th key={idx} className={`py-3 px-4 whitespace-nowrap ${col.className || ''}`}>
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 text-slate-700">
            {paginatedData.length > 0 ? (
              paginatedData.map((row, rIdx) => (
                <tr key={rIdx} className="hover:bg-slate-50/80 transition-colors">
                  {columns.map((col, cIdx) => (
                    <td key={cIdx} className={`py-3.5 px-4 ${col.cellClassName || ''}`}>
                      {col.render ? col.render(row) : (row[col.accessor] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={columns.length} className="py-12 text-center text-slate-400">
                  <div className="flex flex-col items-center justify-center">
                    <p className="text-base font-medium text-slate-500">{emptyMessage}</p>
                    <p className="text-xs text-slate-400 mt-1">Try adjusting your search query or filters</p>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="px-3 sm:px-4 py-3 border-t border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 bg-slate-50/50">
        <div>
          Showing {filteredData.length === 0 ? 0 : (currentPage - 1) * pageSize + 1} to{' '}
          {Math.min(currentPage * pageSize, filteredData.length)} of {filteredData.length} records
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="p-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="px-2 font-medium text-slate-700">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="p-1.5 rounded border border-slate-200 bg-white hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};

export default DataTable;
