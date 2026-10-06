import React, { createContext, useContext, useState, useEffect } from 'react';
import api from '../api/client';
import { useAuth } from './AuthContext';

const BranchContext = createContext(null);

export const BranchProvider = ({ children }) => {
  const { user, isOwner } = useAuth();
  const [branches, setBranches] = useState([]);
  const [activeBranchId, setActiveBranchIdState] = useState(() => {
    return localStorage.getItem('activeBranchId') || 'all';
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchBranches = async () => {
      if (!user) return;
      try {
        const res = await api.get('/masters/branches');
        if (res.data.success) {
          setBranches(res.data.branches);
          if (!isOwner && user.branchId) {
            // Non-owners are strictly bound to their assigned branch
            setActiveBranchIdState(user.branchId.toString());
            localStorage.setItem('activeBranchId', user.branchId.toString());
          }
        }
      } catch (err) {
        console.error('Failed to load branches', err);
      } finally {
        setLoading(false);
      }
    };
    fetchBranches();
  }, [user, isOwner]);

  const setActiveBranchId = (id) => {
    if (!isOwner && id !== user?.branchId?.toString()) {
      return; // Prevent unauthorized branch switch
    }
    setActiveBranchIdState(id);
    localStorage.setItem('activeBranchId', id);
  };

  const activeBranch = branches.find(b => b.id.toString() === activeBranchId) || null;

  return (
    <BranchContext.Provider value={{
      branches,
      activeBranchId,
      activeBranch,
      setActiveBranchId,
      loading
    }}>
      {children}
    </BranchContext.Provider>
  );
};

export const useBranch = () => useContext(BranchContext);
