import React, { createContext, useContext, useState, useEffect } from 'react';
import api, { setCacheIdentity, clearApiCache } from '../api/client';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(() => {
    try {
      const savedUser = localStorage.getItem('user');
      return savedUser ? JSON.parse(savedUser) : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const checkAuth = async () => {
      const token = localStorage.getItem('token');
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        const res = await api.get('/auth/me');
        if (res.data.success) {
          setCacheIdentity(`user:${res.data.user.id}`);
          setUser(res.data.user);
          localStorage.setItem('user', JSON.stringify(res.data.user));
        }
      } catch (err) {
        console.error('Auth verification failed', err);
        logout();
      } finally {
        setLoading(false);
      }
    };
    checkAuth();
  }, []);

  const login = async (email, password) => {
    const res = await api.post('/auth/login', { email, password });
    if (res.data.success) {
      localStorage.setItem('token', res.data.token);
      localStorage.setItem('user', JSON.stringify(res.data.user));
      setCacheIdentity(`user:${res.data.user.id}`);
      setUser(res.data.user);
      return res.data.user;
    }
    throw new Error(res.data.message || 'Login failed');
  };

  const logout = () => {
    clearApiCache();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    localStorage.removeItem('activeBranchId');
    setCacheIdentity('anon');
    setUser(null);
  };

  const isOwner = user?.role === 'OWNER';
  const isManager = user?.role === 'BRANCH_MANAGER';
  const isStaff = user?.role === 'STAFF';
  const isAccountant = user?.role === 'ACCOUNTANT';

  return (
    <AuthContext.Provider value={{
      user,
      loading,
      login,
      logout,
      isOwner,
      isManager,
      isStaff,
      isAccountant
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
