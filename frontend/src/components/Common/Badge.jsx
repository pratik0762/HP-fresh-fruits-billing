import React from 'react';

const Badge = ({ variant = 'default', children, className = '' }) => {
  const styles = {
    default: 'bg-slate-100 text-slate-700 border-slate-200',
    success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    warning: 'bg-amber-50 text-amber-700 border-amber-200',
    danger: 'bg-rose-50 text-rose-700 border-rose-200',
    info: 'bg-sky-50 text-sky-700 border-sky-200',
    purple: 'bg-purple-50 text-purple-700 border-purple-200',
    PAID: 'bg-emerald-100 text-emerald-800 border-emerald-300 font-semibold',
    PARTIAL: 'bg-amber-100 text-amber-800 border-amber-300 font-semibold',
    PENDING: 'bg-rose-100 text-rose-800 border-rose-300 font-semibold',
    ACTIVE: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    DEPLETED: 'bg-slate-100 text-slate-500 border-slate-300 line-through',
    EXPIRED: 'bg-red-100 text-red-800 border-red-300',
    IN_TRANSIT: 'bg-indigo-50 text-indigo-700 border-indigo-200 animate-pulse',
    RECEIVED: 'bg-teal-50 text-teal-700 border-teal-200'
  };

  const currentStyle = styles[variant] || styles.default;

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${currentStyle} ${className}`}>
      {children}
    </span>
  );
};

export default Badge;
