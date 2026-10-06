import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../components/Common/Toast';
import { Lock, Mail, ArrowRight, ShieldCheck, Eye, EyeOff } from 'lucide-react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      toast.success('Welcome back! Login successful.');
      navigate('/dashboard');
    } catch (err) {
      const msg = err.response?.data?.message || err.message || 'Login failed';
      setError(msg);
      toast.error('Wrong email or password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col justify-center items-center p-4 sm:p-6 lg:p-8 selection:bg-brand-500 selection:text-white relative overflow-hidden">
      {/* Beautiful background: layered gradient + soft light orbs */}
      <div className="absolute inset-0 bg-gradient-to-br from-emerald-950 via-slate-900 to-brand-950 pointer-events-none"></div>
      <div className="absolute -top-32 -left-32 w-[28rem] h-[28rem] bg-emerald-500/20 rounded-full blur-3xl pointer-events-none animate-pulse-soft"></div>
      <div className="absolute -bottom-40 -right-24 w-[32rem] h-[32rem] bg-brand-500/15 rounded-full blur-3xl pointer-events-none animate-pulse-soft" style={{ animationDelay: '1.5s' }}></div>
      <div className="absolute top-1/3 right-1/4 w-72 h-72 bg-lime-400/10 rounded-full blur-3xl pointer-events-none"></div>
      {/* Subtle grid texture */}
      <div
        className="absolute inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: 'linear-gradient(rgba(255,255,255,.6) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.6) 1px, transparent 1px)',
          backgroundSize: '48px 48px'
        }}
      ></div>
      {/* Fruit-icon pattern watermark */}
      <div
        className="absolute inset-0 pointer-events-none animate-watermark-drift"
        style={{
          backgroundImage: `url("data:image/svg+xml,${encodeURIComponent(
            `<svg xmlns='http://www.w3.org/2000/svg' width='180' height='180'><text x='12' y='44' font-size='30'>🍎</text><text x='96' y='36' font-size='26'>🍇</text><text x='52' y='112' font-size='28'>🥭</text><text x='126' y='128' font-size='24'>🍏</text><text x='10' y='168' font-size='22'>🍊</text></svg>`
          )}")`,
          opacity: 0.05
        }}
      ></div>

      <div className="w-full max-w-md z-10">
        {/* Brand Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center p-3 bg-white/10 border border-white/20 rounded-2xl mb-3 shadow-lg backdrop-blur-md">
            <span className="text-4xl">🍏</span>
          </div>
          <h1 className="text-2xl font-black text-white tracking-tight">HP Fresh Fruits ERP</h1>
          <p className="text-xs text-emerald-200/70 mt-1 font-medium">
            Multi-Branch Fruit Trading, Cold Storage & Mandi Supply
          </p>
        </div>

        {/* Login Card */}
        <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-white/60 p-6 sm:p-8">
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-rose-50 border border-rose-200 text-rose-700 text-xs font-semibold">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Work Email
              </label>
              <div className="relative">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@hpfruits.com"
                  className="w-full pl-9 pr-4 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white text-slate-900"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-9 pr-10 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 focus:bg-white text-slate-900"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 transition"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 py-2.5 px-4 bg-gradient-to-r from-brand-600 to-emerald-600 hover:from-brand-700 hover:to-emerald-700 text-white rounded-lg text-sm font-bold flex items-center justify-center gap-2 shadow-md transition disabled:opacity-60"
            >
              {loading ? 'Authenticating...' : 'Sign In to ERP'}
              <ArrowRight className="w-4 h-4" />
            </button>
          </form>
        </div>

        {/* Security & Audit notice */}
        <div className="mt-6 text-center text-xs text-emerald-100/60 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-emerald-400" />
          <span>Immutable Append-Only Financial & Stock Ledger</span>
        </div>
      </div>
    </div>
  );
};

export default Login;
