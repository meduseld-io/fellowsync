import { createContext, useContext, useState, useEffect } from 'react';
import { api } from '../services/api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.getMe()
      .then((data) => {
        if (data.authenticated) setUser(data.user);
      })
      .catch((e) => console.error('Failed to check auth status:', e))
      .finally(() => setLoading(false));
  }, []);

  const login = async () => {
    try {
      const { url } = await api.getLoginUrl();
      window.location.href = url;
    } catch (e) {
      console.error('Failed to get login URL:', e);
    }
  };

  const handleCallback = async (code) => {
    try {
      const data = await api.exchangeCode(code);
      setUser(data.user);
      return data.user;
    } catch (e) {
      console.error('Failed to exchange auth code:', e);
      return null;
    }
  };

  const logout = async () => {
    try {
      await api.logout();
    } catch (e) {
      console.error('Failed to logout:', e);
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, handleCallback }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
