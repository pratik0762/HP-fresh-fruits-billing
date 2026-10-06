import * as XLSX from 'xlsx';

/**
 * Export an array of row objects to a real .xlsx Excel file.
 *
 * @param {Array<{name: string, rows: Array<Object>}>} sheets  one or more sheets
 * @param {string} filename  e.g. 'sales-report'
 */
export function exportToExcel(sheets, filename) {
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    // Flatten nested values (e.g. customer.name) before writing
    const flat = (sheet.rows || []).map(row => {
      const clean = {};
      for (const [k, v] of Object.entries(row)) {
        if (v !== null && typeof v === 'object') {
          clean[k] = v.name || v.label || JSON.stringify(v);
        } else {
          clean[k] = v;
        }
      }
      return clean;
    });

    const ws = XLSX.utils.json_to_sheet(flat.length ? flat : [{ Info: 'No data for the selected period' }]);

    // Auto-size columns roughly to content
    const keys = flat.length ? Object.keys(flat[0]) : ['Info'];
    ws['!cols'] = keys.map(k => ({
      wch: Math.min(45, Math.max(
        k.length + 2,
        ...flat.slice(0, 100).map(r => String(r[k] ?? '').length + 2)
      ))
    }));

    XLSX.utils.book_append_sheet(wb, ws, (sheet.name || 'Sheet').slice(0, 31));
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, filename.replace(/\.xlsx$/, '') + `_${stamp}.xlsx`);
}

/**
 * Pick and rename fields from an API row into a readable Excel row.
 */
export function pick(row, map) {
  const out = {};
  for (const [key, label] of Object.entries(map)) {
    const val = typeof key === 'function' ? key(row) : row[key];
    out[label] = val ?? '';
  }
  return out;
}

const toStr = (d) => {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
};

/**
 * Date range presets used by the DateRangeFilter component.
 * Indian financial year: 1 April – 31 March.
 */
export function getPresetRange(preset) {
  const now = new Date();
  const y = now.getFullYear();
  const today = toStr(now);

  switch (preset) {
    case 'today':
      return { start: today, end: today, label: 'Today' };

    case 'yesterday': {
      const d = new Date(now); d.setDate(d.getDate() - 1);
      return { start: toStr(d), end: toStr(d), label: 'Yesterday' };
    }

    case 'thisMonth':
      return { start: toStr(new Date(y, now.getMonth(), 1)), end: today, label: 'This Month' };

    case 'lastMonth': {
      const s = new Date(y, now.getMonth() - 1, 1);
      const e = new Date(y, now.getMonth(), 0);
      return { start: toStr(s), end: toStr(e), label: 'Last Month' };
    }

    case 'last3Months': {
      const s = new Date(y, now.getMonth() - 2, 1);
      return { start: toStr(s), end: today, label: 'Last 3 Months' };
    }

    case 'thisFY': {
      const fyStart = now.getMonth() >= 3 ? new Date(y, 3, 1) : new Date(y - 1, 3, 1);
      return { start: toStr(fyStart), end: today, label: `FY ${fyStart.getFullYear()}-${String(fyStart.getFullYear() + 1).slice(2)}` };
    }

    case 'lastFY': {
      const fyStartYear = now.getMonth() >= 3 ? y - 1 : y - 2;
      return {
        start: toStr(new Date(fyStartYear, 3, 1)),
        end: toStr(new Date(fyStartYear + 1, 2, 31)),
        label: `FY ${fyStartYear}-${String(fyStartYear + 1).slice(2)}`
      };
    }

    case 'thisYear':
      return { start: toStr(new Date(y, 0, 1)), end: today, label: `Year ${y}` };

    case 'lastYear':
      return { start: toStr(new Date(y - 1, 0, 1)), end: toStr(new Date(y - 1, 11, 31)), label: `Year ${y - 1}` };

    case 'all':
    default:
      return { start: '', end: '', label: 'All Time' };
  }
}
