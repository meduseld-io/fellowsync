import { Routes, Route, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import LoginPage from './pages/LoginPage';
import CallbackPage from './pages/CallbackPage';
import LobbyPage from './pages/LobbyPage';
import RoomPage from './pages/RoomPage';
import AdminPage from './pages/AdminPage';
import { getAvatarColor, setFavicon, AVATAR_HEX } from './utils/avatars';

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>Loading...</div>;
  if (!user) return <Navigate to="/" replace />;
  return children;
}

function AppRoutes() {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (user?.spotify_user_id) {
      const color = getAvatarColor(user.spotify_user_id);
      setFavicon(color);
      document.documentElement.style.setProperty('--fella-color', AVATAR_HEX[color] || '#4ade80');
    }
  }, [user]);

  if (loading) {
    return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>Loading...</div>;
  }

  return (
    <Routes>
      <Route path="/" element={user ? <Navigate to="/lobby" replace /> : <LoginPage />} />
      <Route path="/callback" element={<CallbackPage />} />
      <Route path="/lobby" element={<ProtectedRoute><LobbyPage /></ProtectedRoute>} />
      <Route path="/room/:roomId" element={<ProtectedRoute><RoomPage /></ProtectedRoute>} />
      <Route path="/admin" element={<ProtectedRoute><AdminPage /></ProtectedRoute>} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
