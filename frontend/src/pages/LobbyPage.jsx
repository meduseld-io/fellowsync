import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import Footer from '../components/Footer';
import HelpModal from '../components/HelpModal';
import InstallBanner from '../components/InstallBanner';
import GroupPanel from '../components/GroupPanel';
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
  const [reactionsEnabled, setReactionsEnabled] = useState(false);
  const [statsEnabled, setStatsEnabled] = useState(false);
  const [autoPlaylistUrl, setAutoPlaylistUrl] = useState('');
  const [blindMode, setBlindMode] = useState(false);
  const [settingsError, setSettingsError] = useState('');

  useEffect(() => { document.title = 'FellowSync - Lobby'; }, []);

  const handlePickAvatar = (color) => {
    setAvatarOverride(color);
    saveAvatarToBackend(color);
    setSelectedAvatar(color);
  };

  const handleCreate = async () => {
    setCreating(true);
    setError('');
    setSettingsError('');
    try {
      const room = await api.createRoom({
        max_consecutive: maxConsecutive,
        hear_me_out: mode === 'hear_me_out',
        vibe: vibe.trim(),
        dj_mode: mode === 'dj',
        blind_mode: blindMode,
        skip_threshold: skipThreshold,
        reactions_enabled: reactionsEnabled,
        stats_enabled: statsEnabled,
        auto_playlist_url: autoPlaylistUrl.trim(),
      });
      navigate(`/room/${room.room_id}`);
    } catch (e) {
      console.error('Failed to create room:', e);
      setSettingsError(e.message || 'Failed to create room');
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
              <button className="modal-close-btn" onClick={() => setShowSettings(false)} aria-label="Close">✕</button>
              <h3>⚙ Room Settings</h3>
              <div className="room-settings">
                <div className="setting-row">
                  <label>Mode <span className="setting-tip" data-tip="Normal: free-for-all queue. Hear Me Out: round-robin turns. DJ Mode: only the host can queue.">ⓘ</span></label>
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="normal">Normal</option>
                    <option value="hear_me_out">Hear Me Out</option>
                    <option value="dj">DJ Mode</option>
                  </select>
                </div>
                <div className="setting-row">
                  <label>Max in a row <span className="setting-tip" data-tip="Limit how many songs one person can queue consecutively.">ⓘ</span></label>
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
                  <label>Skip votes <span className="setting-tip" data-tip="Percentage of listeners that must vote before a track is skipped. The host can always skip instantly.">ⓘ</span></label>
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
                  <label>Vibe <span className="setting-tip" data-tip="Set a mood label for the room so everyone knows the vibe.">ⓘ</span></label>
                  <input
                    type="text"
                    placeholder="e.g. Metal, 90s hip-hop..."
                    value={vibe}
                    onChange={(e) => setVibe(e.target.value.slice(0, 50))}
                    maxLength={50}
                    style={{ flex: 1 }}
                  />
                </div>
                <div className="setting-divider" />
                <div className="setting-row">
                  <label>Blind Mode <span className="setting-tip" data-tip="Hides upcoming songs from listeners. You won't know what's next until it plays.">ⓘ</span></label>
                  <button
                    className={`toggle-switch${blindMode ? ' on' : ''}`}
                    onClick={() => setBlindMode(!blindMode)}
                    role="switch"
                    aria-checked={blindMode}
                  />
                </div>
                <div className="setting-row">
                  <label>Reactions <span className="setting-tip" data-tip="Show emoji reaction buttons below the now-playing card.">ⓘ</span></label>
                  <button
                    className={`toggle-switch${reactionsEnabled ? ' on' : ''}`}
                    onClick={() => setReactionsEnabled(!reactionsEnabled)}
                    role="switch"
                    aria-checked={reactionsEnabled}
                  />
                </div>
                <div className="setting-row">
                  <label>Session Stats <span className="setting-tip" data-tip="Show a panel with tracks played, skips, duration, and a top queuers leaderboard.">ⓘ</span></label>
                  <button
                    className={`toggle-switch${statsEnabled ? ' on' : ''}`}
                    onClick={() => setStatsEnabled(!statsEnabled)}
                    role="switch"
                    aria-checked={statsEnabled}
                  />
                </div>
                <div className="setting-divider" />
                <div className="setting-row auto-playlist-row">
                  <label>Auto-playlist <span className="setting-tip" data-tip="When the queue empties, tracks from this playlist auto-queue to keep the music going.">ⓘ</span></label>
                  <div className="auto-playlist-input">
                    <input
                      type="text"
                      placeholder="Paste Spotify playlist URL..."
                      value={autoPlaylistUrl}
                      onChange={(e) => setAutoPlaylistUrl(e.target.value)}
                      style={{ flex: 1 }}
                    />
                  </div>
                </div>
              </div>
              <button className="btn-primary" onClick={handleCreate} disabled={creating} style={{ marginTop: '1.25rem', width: '100%' }}>
                {creating ? 'Creating...' : 'Create Room'}
              </button>
              {settingsError && <p style={{ color: 'var(--danger)', marginTop: '0.75rem', fontSize: '0.85rem', textAlign: 'center' }}>{settingsError}</p>}
            </div>
          </div>
        )}

        <div className="lobby-actions">
          <button className="btn-primary" onClick={() => { setSettingsError(''); setShowSettings(true); }}>
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
          <GroupPanel />
          <button className="btn-logout" onClick={logout}>Logout</button>
          <HelpModal />
          {isAdmin(user?.spotify_user_id) && (
            <Link to="/admin?from=lobby" className="btn-admin">Admin</Link>
          )}
        </div>
      </div>
      <Footer />
      <InstallBanner />
    </div>
  );
}
