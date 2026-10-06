import React from 'react';
import { NavLink } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../components/Common/Toast';
import { 
  LayoutDashboard, ShoppingBag, ShoppingCart, Boxes, 
  CreditCard, BookOpen, Wallet, Receipt, ShieldCheck, 
  Database, BarChart3, LogOut, ChevronRight, X
} from 'lucide-react';

const Sidebar = ({ isOpen = false, onClose }) => {
  const { user, logout, isAccountant } = useAuth();
  const toast = useToast();

  const handleLogout = () => {
    toast.info('You have been logged out. See you soon!');
    logout();
  };

  const navItems = [
    { name: 'Dashboard', path: '/dashboard', icon: LayoutDashboard, roles: ['OWNER', 'BRANCH_MANAGER', 'STAFF', 'ACCOUNTANT'] },
    { name: 'Purchases (Inward)', path: '/purchases', icon: ShoppingBag, roles: ['OWNER', 'BRANCH_MANAGER', 'STAFF'] },
    { name: 'Sales (Outward)', path: '/sales', icon: ShoppingCart, roles: ['OWNER', 'BRANCH_MANAGER', 'STAFF'] },
    { name: 'Stock & Batches', path: '/stock', icon: Boxes, roles: ['OWNER', 'BRANCH_MANAGER', 'STAFF', 'ACCOUNTANT'] },
    { name: 'Payments & Aging', path: '/payments', icon: CreditCard, roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
    { name: 'Ledgers (Audit)', path: '/ledgers', icon: BookOpen, roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
    { name: 'Cash & Bank Book', path: '/cash-bank', icon: Wallet, roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
    { name: 'Operating Expenses', path: '/expenses', icon: Receipt, roles: ['OWNER', 'BRANCH_MANAGER', 'STAFF', 'ACCOUNTANT'] },
    { name: 'Gate Register', path: '/gate-passes', icon: ShieldCheck, roles: ['OWNER', 'BRANCH_MANAGER', 'STAFF', 'ACCOUNTANT'] },
    { name: 'Master Data', path: '/masters', icon: Database, roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] },
    { name: 'Reports & P&L', path: '/reports', icon: BarChart3, roles: ['OWNER', 'BRANCH_MANAGER', 'ACCOUNTANT'] }
  ];

  const allowedNav = navItems.filter(item => item.roles.includes(user?.role));

  return (
    <>
      {/* Mobile overlay — dims the page and closes the drawer on tap */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm lg:hidden animate-fadeIn"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-slate-900 text-slate-300 flex flex-col border-r border-slate-800 select-none
          transform transition-transform duration-200 ease-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:static lg:z-auto lg:translate-x-0 lg:transform-none
          print:hidden
        `}
      >
        {/* Brand Header */}
        <div className="h-16 flex items-center gap-3 px-6 bg-slate-950/70 border-b border-slate-800/80">
          <span className="text-2xl">🍏</span>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-white tracking-tight flex items-center gap-1.5">
              HP Fresh Fruits
            </h1>
            <span className="text-[10px] text-brand-400 font-semibold tracking-wider uppercase">Multi-Branch ERP</span>
          </div>
          {/* Close button — mobile only */}
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 lg:hidden"
            title="Close menu"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation Links */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <div className="px-3 pb-2 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            Main Navigation
          </div>
          {allowedNav.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.path}
                to={item.path}
                onClick={onClose}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3 py-2.5 rounded-lg text-xs font-semibold transition-all duration-150 ${
                    isActive
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/60'
                  }`
                }
              >
                <div className="flex items-center gap-3">
                  <Icon className="w-4 h-4" />
                  <span>{item.name}</span>
                </div>
                <ChevronRight className="w-3.5 h-3.5 opacity-40" />
              </NavLink>
            );
          })}
        </nav>

        {/* User Profile Footer */}
        <div className="p-3 bg-slate-950/80 border-t border-slate-800">
          <div className="flex items-center justify-between p-2 rounded-lg bg-slate-900/60">
            <div className="overflow-hidden">
              <p className="text-xs font-bold text-white truncate">{user?.name}</p>
              <p className="text-[10px] text-brand-400 font-medium capitalize">{user?.role?.replace('_', ' ')}</p>
            </div>
            <button
              onClick={handleLogout}
              title="Logout"
              className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-950/30 rounded-md transition-colors"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
};

export default Sidebar;
