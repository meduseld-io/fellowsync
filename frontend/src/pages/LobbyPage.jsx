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
  const [maxConsecutive, setMaxConsecutive] = useState(0);
  const [mode, setMode] = useState('normal');

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const room = await api.createRoom({
        max_consecutive: maxConsecutive,
        hear_me_out: mode === 'hear_me_out',
      });
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

        <div className="room-options">
          <div className="option-row">
            <label htmlFor="maxConsecutive">Max songs in a row per user</label>
            <select
              id="maxConsecutive"
              value={maxConsecutive}
              onChange={(e) => setMaxConsecutive(Number(e.target.value))}
            >
              <option value={0}>Unlimited</option>
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </div>
          <div className="option-row">
            <label htmlFor="mode">
              Mode
              <span className="tooltip-icon" data-tooltip="Normal: free-for-all queue. Hear Me Out: alternates songs between users so everyone gets a turn.">?</span>
            </label>
            <select
              id="mode"
              value={mode}
              onChange={(e) => setMode(e.target.value)}
            >
              <option value="normal">Normal</option>
              <option value="hear_me_out">Hear Me Out</option>
            </select>
          </div>
        </div>

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
