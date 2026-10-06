import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { BranchProvider } from './context/BranchContext';
import { ToastProvider } from './components/Common/Toast';
import AppLayout from './components/Layout/AppLayout';
import Login from './pages/Login';
import './index.css';

// Route-level code splitting: each page ships as its own chunk, so the first
// paint only downloads what the user is actually looking at. Pages are cached
// by the browser after the first visit (instant navigation afterwards).
const Dashboard = lazy(() => import('./pages/Dashboard'));
const PurchaseList = lazy(() => import('./pages/Purchases/PurchaseList'));
const PurchaseCreate = lazy(() => import('./pages/Purchases/PurchaseCreate'));
const SaleList = lazy(() => import('./pages/Sales/SaleList'));
const SaleCreate = lazy(() => import('./pages/Sales/SaleCreate'));
const StockOverview = lazy(() => import('./pages/Stock/StockOverview'));
const PaymentManager = lazy(() => import('./pages/Payments/PaymentManager'));
const AgingReport = lazy(() => import('./pages/Payments/AgingReport'));
const LedgerView = lazy(() => import('./pages/Ledgers/LedgerView'));
const CashBankBook = lazy(() => import('./pages/CashBank/CashBankBook'));
const Expenses = lazy(() => import('./pages/Expenses/Expenses'));
const GatePasses = lazy(() => import('./pages/GatePass/GatePasses'));
const MasterData = lazy(() => import('./pages/Masters/MasterData'));
const Reports = lazy(() => import('./pages/Reports/Reports'));

const PageLoader = () => (
  <div className="flex items-center justify-center h-64 text-slate-300">
    <span className="text-3xl animate-pulse">🍏</span>
  </div>
);

const ProtectedRoute = ({ children }) => {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-slate-400">
        <span className="text-4xl mb-3">🍏</span>
        <p className="text-sm font-medium">Loading HP Fresh Fruits ERP...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return children;
};

const App = () => {
  return (
    <Routes>
      {/* Root URL and /login always open the sign-in screen. A saved session is
          only reused when you deep-link straight to an app page (e.g. /dashboard). */}
      <Route path="/" element={<Login />} />
      <Route path="/login" element={<Login />} />
      <Route
        element={
          <ProtectedRoute>
            <AppLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
        <Route path="/purchases" element={<Suspense fallback={<PageLoader />}><PurchaseList /></Suspense>} />
        <Route path="/purchases/new" element={<Suspense fallback={<PageLoader />}><PurchaseCreate /></Suspense>} />
        <Route path="/sales" element={<Suspense fallback={<PageLoader />}><SaleList /></Suspense>} />
        <Route path="/sales/new" element={<Suspense fallback={<PageLoader />}><SaleCreate /></Suspense>} />
        <Route path="/stock" element={<Suspense fallback={<PageLoader />}><StockOverview /></Suspense>} />
        <Route path="/payments" element={<Suspense fallback={<PageLoader />}><PaymentManager /></Suspense>} />
        <Route path="/payments/aging" element={<Suspense fallback={<PageLoader />}><AgingReport /></Suspense>} />
        <Route path="/ledgers" element={<Suspense fallback={<PageLoader />}><LedgerView /></Suspense>} />
        <Route path="/cash-bank" element={<Suspense fallback={<PageLoader />}><CashBankBook /></Suspense>} />
        <Route path="/expenses" element={<Suspense fallback={<PageLoader />}><Expenses /></Suspense>} />
        <Route path="/gate-passes" element={<Suspense fallback={<PageLoader />}><GatePasses /></Suspense>} />
        <Route path="/masters" element={<Suspense fallback={<PageLoader />}><MasterData /></Suspense>} />
        <Route path="/reports" element={<Suspense fallback={<PageLoader />}><Reports /></Suspense>} />
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
};

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <BranchProvider>
            <App />
          </BranchProvider>
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
