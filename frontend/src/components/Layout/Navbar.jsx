import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useBranch } from '../../context/BranchContext';
import { Building2, Shield, Calendar, Menu } from 'lucide-react';

const Navbar = ({ onMenuClick }) => {
  const { user, isOwner } = useAuth();
  const { branches, activeBranchId, setActiveBranchId } = useBranch();

  const roleColors = {
    OWNER: 'bg-purple-100 text-purple-800 border-purple-200',
    BRANCH_MANAGER: 'bg-sky-100 text-sky-800 border-sky-200',
    STAFF: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    ACCOUNTANT: 'bg-amber-100 text-amber-800 border-amber-200'
  };

  const todayStr = new Date().toLocaleDateString('en-IN', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric'
  });

  return (
    <header className="h-14 sm:h-16 bg-white border-b border-slate-200 px-3 sm:px-6 flex items-center justify-between shadow-xs sticky top-0 z-30">
      {/* Left: hamburger (mobile) + Branch Selector */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          onClick={onMenuClick}
          className="p-2 -ml-1 rounded-lg text-slate-600 hover:bg-slate-100 hover:text-slate-900 lg:hidden"
          title="Open menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 min-w-0">
          <Building2 className="w-4 h-4 text-brand-600 shrink-0" />
          <span className="hidden sm:inline font-semibold text-slate-500 text-xs shrink-0">Branch:</span>
        </div>

        {isOwner ? (
          <select
            value={activeBranchId}
            onChange={(e) => setActiveBranchId(e.target.value)}
            className="min-w-0 max-w-[45vw] sm:max-w-none text-xs font-semibold bg-slate-50 border border-slate-300 rounded-lg px-2 sm:px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 text-slate-800 shadow-2xs cursor-pointer truncate"
          >
            <option value="all">🏢 Consolidated (All)</option>
            {branches.map((b) => (
              <option key={b.id} value={b.id.toString()}>
                📍 {b.name} ({b.code})
              </option>
            ))}
          </select>
        ) : (
          <div className="min-w-0 text-xs font-bold text-slate-800 bg-slate-100 px-2 sm:px-3 py-1.5 rounded-lg border border-slate-200 truncate">
            📍 {user?.branch ? `${user.branch.name} (${user.branch.code})` : 'Assigned Branch'}
          </div>
        )}
      </div>

      {/* Right: Date & User Role Indicator */}
      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        <div className="hidden md:flex items-center gap-2 text-xs text-slate-500 font-medium">
          <Calendar className="w-3.5 h-3.5" />
          <span>{todayStr}</span>
        </div>

        <div className="h-4 w-px bg-slate-200 hidden md:block"></div>

        {/* Role Badge */}
        <div className="flex items-center gap-2">
          <span className={`text-[10px] sm:text-[11px] font-bold px-2 sm:px-2.5 py-1 rounded-full border ${roleColors[user?.role] || 'bg-slate-100'}`}>
            <Shield className="w-3 h-3 inline mr-1" />
            {user?.role?.replace('_', ' ')}
          </span>
          <span className="text-xs font-bold text-slate-700 hidden sm:inline">
            {user?.name?.split(' ')[0]}
          </span>
        </div>
      </div>
    </header>
  );
};

export default Navbar;
