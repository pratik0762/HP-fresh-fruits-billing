import React, { useState } from 'react';
import { CalendarDays, ChevronDown, ArrowRight } from 'lucide-react';
import { getPresetRange } from '../../utils/excelExport';

/**
 * Compact date-range filter.
 * One clean pill: [📅 Last Month ▾] [01-09-2026 → 26-09-2026]
 *
 * Presets: Today | Yesterday | This Month | Last Month | 3 Months |
 * This FY | Last FY | This Year | Last Year | All Time | Custom
 *
 * Fires onChange({start, end, label}) whenever the range changes so pages can
 * re-fetch with startDate/endDate params.
 */
const PRESETS = [
  ['today', 'Today'],
  ['yesterday', 'Yesterday'],
  ['thisMonth', 'This Month'],
  ['lastMonth', 'Last Month'],
  ['last3Months', 'Last 3 Months'],
  ['thisFY', 'This Financial Year'],
  ['lastFY', 'Last Financial Year'],
  ['thisYear', 'This Year'],
  ['lastYear', 'Last Year'],
  ['all', 'All Time']
];

// dd-mm-yyyy for the compact inputs
const fmtDisplay = (iso) => {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}-${m}-${y}`;
};

const DateRangeFilter = ({ onChange, initialPreset = 'thisMonth' }) => {
  const initial = getPresetRange(initialPreset);
  const [start, setStart] = useState(initial.start);
  const [end, setEnd] = useState(initial.end);
  const [preset, setPreset] = useState(initialPreset);

  const applyPreset = (key) => {
    setPreset(key);
    const range = getPresetRange(key);
    setStart(range.start);
    setEnd(range.end);
    onChange({ start: range.start, end: range.end, label: range.label });
  };

  const manualChange = (field, value) => {
    setPreset('custom');
    const next = { start: field === 'start' ? value : start, end: field === 'end' ? value : end };
    setStart(next.start);
    setEnd(next.end);
    onChange({ ...next, label: 'Custom' });
  };

  const activeLabel = preset === 'custom' ? 'Custom Range' : PRESETS.find(p => p[0] === preset)?.[1] || 'Period';

  return (
    <div className="inline-flex items-center gap-1.5 bg-white border border-slate-200 rounded-xl pl-2.5 pr-1.5 py-1.5 shadow-sm">
      {/* Preset dropdown */}
      <div className="relative flex items-center">
        <CalendarDays className="w-3.5 h-3.5 text-brand-600 absolute left-2 pointer-events-none" />
        <select
          value={preset}
          onChange={(e) => applyPreset(e.target.value)}
          className="appearance-none cursor-pointer bg-slate-100 hover:bg-slate-200/80 focus:bg-slate-200 focus:outline-none focus:ring-2 focus:ring-brand-500/40 text-[11px] font-bold text-slate-700 rounded-lg pl-7 pr-6 py-1.5 transition-colors"
          title="Quick period presets"
        >
          {PRESETS.map(([key, label]) => (
            <option key={key} value={key}>{label}</option>
          ))}
          <option value="custom">Custom Range</option>
        </select>
        <ChevronDown className="w-3 h-3 text-slate-400 absolute right-1.5 pointer-events-none" />
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-slate-200 mx-0.5" />

      {/* From date */}
      <input
        type="date"
        value={start}
        onChange={(e) => manualChange('start', e.target.value)}
        className="bg-transparent focus:outline-none focus:ring-2 focus:ring-brand-500/40 rounded-lg px-1.5 py-1 text-[11px] font-semibold text-slate-700 font-mono w-[104px] cursor-pointer hover:bg-slate-50 transition-colors"
        title={`From: ${fmtDisplay(start)}`}
      />

      <ArrowRight className="w-3 h-3 text-slate-300 shrink-0" />

      {/* To date */}
      <input
        type="date"
        value={end}
        onChange={(e) => manualChange('end', e.target.value)}
        className="bg-transparent focus:outline-none focus:ring-2 focus:ring-brand-500/40 rounded-lg px-1.5 py-1 text-[11px] font-semibold text-slate-700 font-mono w-[104px] cursor-pointer hover:bg-slate-50 transition-colors"
        title={`To: ${fmtDisplay(end)}`}
      />
    </div>
  );
};

export default DateRangeFilter;
