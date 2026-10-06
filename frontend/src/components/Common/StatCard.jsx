import React from 'react';

const StatCard = ({ title, value, subtitle, icon: Icon, trend, color = 'emerald' }) => {
  const colorSchemes = {
    emerald: {
      bg: 'bg-emerald-50 text-emerald-600',
      border: 'hover:border-emerald-300'
    },
    blue: {
      bg: 'bg-sky-50 text-sky-600',
      border: 'hover:border-sky-300'
    },
    amber: {
      bg: 'bg-amber-50 text-amber-600',
      border: 'hover:border-amber-300'
    },
    rose: {
      bg: 'bg-rose-50 text-rose-600',
      border: 'hover:border-rose-300'
    },
    purple: {
      bg: 'bg-purple-50 text-purple-600',
      border: 'hover:border-purple-300'
    },
    slate: {
      bg: 'bg-slate-100 text-slate-600',
      border: 'hover:border-slate-300'
    }
  };

  const scheme = colorSchemes[color] || colorSchemes.emerald;

  return (
    <div className={`bg-white rounded-xl p-4 sm:p-5 border border-slate-200 shadow-sm transition-all duration-200 hover:shadow-md ${scheme.border}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] sm:text-xs font-semibold text-slate-500 uppercase tracking-wider">{title}</span>
        {Icon && (
          <div className={`p-2 sm:p-2.5 rounded-lg shrink-0 ${scheme.bg}`}>
            <Icon className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
        )}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-2">
        <div className="text-xl sm:text-2xl font-bold text-slate-900 tracking-tight break-words">{value}</div>
        {trend && (
          <span className={`text-xs font-semibold ${trend > 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
            {trend > 0 ? `+${trend}%` : `${trend}%`}
          </span>
        )}
      </div>
      {subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}
    </div>
  );
};

export default StatCard;
