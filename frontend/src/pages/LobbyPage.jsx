import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import Footer from '../components/Footer';
import './LobbyPage.css';

export default function LobbyPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const room = await api.createRoom();
      navigate(`/room/${room.room_id}`);
    } catch (e) {
      console.error('Failed to create room:', e);
      setError('Failed to create room');
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setError('');
    try {
      await api.joinRoom(code);
      navigate(`/room/${code}`);
    } catch (e) {
      console.error('Failed to join room:', e);
      setError('Room not found');
    }
  };

  return (
    <div className="lobby-page">
      <div className="lobby-card">
        <img src="/logo.png" alt="FellowSync" style={{ maxWidth: 280, width: '75%', height: 'auto', marginBottom: '0.5rem' }} />
        <h1>Fellow<span style={{ color: '#4ade80' }}>Sync</span></h1>
        <div className="lobby-user">
          {user?.avatar && <img src={user.avatar} alt="" />}
          <span>{user?.display_name}</span>
        </div>

        {error && <p style={{ color: 'var(--danger)', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</p>}

        <div className="lobby-actions">
          <button className="btn-primary" onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : 'Create Room'}
          </button>

          <span className="lobby-divider">or</span>

          <div className="join-row">
            <input
              type="text"
              placeholder="ROOM CODE"
              maxLength={6}
              value={joinCode}
              onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
            <button className="btn-secondary" onClick={handleJoin} disabled={!joinCode.trim()}>
              Join
            </button>
          </div>
        </div>

        <div className="lobby-footer">
          <button className="btn-logout" onClick={logout}>Logout</button>
        </div>
      </div>
      <Footer />
    </div>
  );
}
