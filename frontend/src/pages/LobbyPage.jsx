import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import Footer from '../components/Footer';
import HelpModal from '../components/HelpModal';
import { getAvatarColor, setAvatarOverride, saveAvatarToBackend, getPickerColors, AVATAR_HEX } from '../utils/avatars';
import { isAdmin } from '../utils/admin';
import './LobbyPage.css';

export default function LobbyPage() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);
  const [maxConsecutive, setMaxConsecutive] = useState(0);
  const [mode, setMode] = useState('normal');
  const [vibe, setVibe] = useState('');
  const [skipThreshold, setSkipThreshold] = useState(0.5);
  const [showAvatarPicker, setShowAvatarPicker] = useState(false);
  const [selectedAvatar, setSelectedAvatar] = useState(() => getAvatarColor(user?.spotify_user_id || ''));
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => { document.title = 'FellowSync - Lobby'; }, []);

  const handlePickAvatar = (color) => {
    setAvatarOverride(color);
    saveAvatarToBackend(color);
    setSelectedAvatar(color);
  };

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    try {
      const room = await api.createRoom({
        max_consecutive: maxConsecutive,
        hear_me_out: mode === 'hear_me_out',
        vibe: vibe.trim(),
        dj_mode: mode === 'dj',
        blind_mode: mode === 'blind',
        shuffle_mode: mode === 'shuffle',
        skip_threshold: skipThreshold,
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
        <h1>Fellow<span style={{ color: AVATAR_HEX[selectedAvatar] || '#4ade80' }}>Sync</span></h1>
        <div className="lobby-user">
          <span>{user?.display_name}</span>
          <span
            className={`lobby-fella-wrap${showAvatarPicker ? ' picker-open' : ''}`}
            data-fella-tooltip="Click to change your fella!"
            onClick={() => setShowAvatarPicker(!showAvatarPicker)}
          >
            <img
              src={`/avatars/${selectedAvatar}.png`}
              alt=""
              className="lobby-fella clickable"
            />
          </span>
          {showAvatarPicker && (
            <div className="avatar-picker">
              {getPickerColors(isAdmin(user?.spotify_user_id)).map((color) => (
                <img
                  key={color}
                  src={`/avatars/${color}.png`}
                  alt={color}
                  className={`avatar-option${selectedAvatar === color ? ' selected' : ''}`}
                  onClick={() => handlePickAvatar(color)}
                />
              ))}
            </div>
          )}
        </div>

        {error && <p style={{ color: 'var(--danger)', marginBottom: '1rem', fontSize: '0.9rem' }}>{error}</p>}

        {showSettings && (
          <div className="modal-overlay" onClick={() => setShowSettings(false)}>
            <div className="modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
              <h3>⚙ Room Settings</h3>
              <div className="room-settings">
                <div className="setting-row">
                  <label>Mode</label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="normal">Normal</option>
                    <option value="hear_me_out">Hear Me Out</option>
                    <option value="dj">DJ Mode</option>
                    <option value="blind">Blind Mode</option>
                    <option value="shuffle">Shuffle</option>
                  </select>
                </div>
                <div className="setting-row">
                  <label>Max in a row</label>
                  <select
                    value={maxConsecutive}
                    onChange={(e) => setMaxConsecutive(Number(e.target.value))}
                  >
                    <option value={0}>Unlimited</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </div>
                <div className="setting-row">
                  <label>Skip votes</label>
                  <select
                    value={skipThreshold}
                    onChange={(e) => setSkipThreshold(Number(e.target.value))}
                  >
                    <option value={0.25}>25%</option>
                    <option value={0.5}>50%</option>
                    <option value={0.75}>75%</option>
                    <option value={1.0}>Unanimous</option>
                  </select>
                </div>
                <div className="setting-row">
                  <label>Vibe</label>
                  <input
                    type="text"
                    placeholder="e.g. Metal, 90s hip-hop..."
                    value={vibe}
                    onChange={(e) => setVibe(e.target.value.slice(0, 50))}
                    maxLength={50}
                    style={{ flex: 1 }}
                  />
                </div>
              </div>
              <button className="btn-primary" onClick={handleCreate} disabled={creating} style={{ marginTop: '1.25rem', width: '100%' }}>
                {creating ? 'Creating...' : 'Create Room'}
              </button>
            </div>
          </div>
        )}

        <div className="lobby-actions">
          <button className="btn-primary" onClick={() => setShowSettings(true)}>
            Create Room
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
          {isAdmin(user?.spotify_user_id) && (
            <Link to="/admin" className="btn-admin">Admin</Link>
          )}
          <button className="btn-logout" onClick={logout}>Logout</button>
        </div>
        <HelpModal />
      </div>
      <Footer />
    </div>
  );
}
