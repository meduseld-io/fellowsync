import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { getSocket } from '../services/socket';
import { syncPlayback } from '../services/spotifyPlayer';
import HelpModal from '../components/HelpModal';
import Footer from '../components/Footer';
import { getAvatarForUser } from '../utils/avatars';
import './RoomPage.css';

export default function RoomPage() {
  const { roomId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deviceWarning, setDeviceWarning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [queueError, setQueueError] = useState('');
  const searchTimeout = useRef(null);
  const socketRef = useRef(null);

  const intentionalLeave = useRef(false);

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Load room and connect socket
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const data = await api.getRoom(roomId);
        if (mounted) setRoom(data);
      } catch (e) {
        console.error('Failed to load room:', e);
        if (mounted) setError('Room not found');
        return;
      }

      const socket = getSocket();
      socketRef.current = socket;
      socket.emit('join_room', { room_id: roomId });

      socket.on('room_state', (state) => { if (mounted) setRoom(state); });
      socket.on('playback_sync', (state) => { if (mounted) setRoom(state); });
      socket.on('queue_updated', (state) => { if (mounted) setRoom(state); });
      socket.on('error', (data) => console.error('Socket error:', data.message));
    }

    init();

    return () => {
      mounted = false;
      if (socketRef.current) {
        if (intentionalLeave.current) {
          socketRef.current.emit('leave_room', { room_id: roomId });
        }
        socketRef.current.off('room_state');
        socketRef.current.off('playback_sync');
        socketRef.current.off('queue_updated');
        socketRef.current.off('error');
      }
    };
  }, [roomId]);

  // Sync playback when room state changes
  useEffect(() => {
    if (!room || !room.current_track) return;
    // We don't have the user's access token on the client side directly,
    // so sync is triggered via the backend broadcasting to all clients.
    // Each client calls Spotify API with their own token stored in session.
    // For MVP, we rely on the backend to coordinate — client-side sync
    // would require passing tokens to the frontend (future enhancement).
  }, [room?.current_track, room?.is_playing, room?.position_ms]);

  // Search with debounce
  const handleSearch = useCallback((query) => {
    setSearchQuery(query);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    searchTimeout.current = setTimeout(async () => {
      setSearching(true);
      try {
        const data = await api.search(query);
        setSearchResults(data.tracks || []);
      } catch (e) {
        console.error('Search failed:', e);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, []);

  const handleAddTrack = async (track) => {
    setQueueError('');
    try {
      const updated = await api.addToQueue(roomId, track);
      setRoom(updated);
      setSearchQuery('');
      setSearchResults([]);
    } catch (e) {
      console.error('Failed to add track to queue:', e);
      if (e.message && e.message.includes('consecutive')) {
        setQueueError(e.message);
        setTimeout(() => setQueueError(''), 5000);
      }
    }
  };

  const handleSkip = async () => {
    try {
      const updated = await api.skipTrack(roomId);
      setRoom(updated);
    } catch (e) {
      console.error('Failed to skip track:', e);
    }
  };

  const handlePlay = async () => {
    try {
      const updated = await api.play(roomId);
      setRoom(updated);
      if (updated.playback_errors?.some(e => e.error === 'no_device')) {
        setDeviceWarning(true);
      } else {
        setDeviceWarning(false);
      }
    } catch (e) {
      console.error('Failed to start playback:', e);
    }
  };

  const handlePause = async () => {
    try {
      const updated = await api.pause(roomId);
      setRoom(updated);
    } catch (e) {
      console.error('Failed to pause playback:', e);
    }
  };

  const handleCopyCode = () => {
    navigator.clipboard.writeText(roomId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch((e) => {
      console.error('Failed to copy room code:', e);
    });
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      const updated = await api.sync(roomId);
      setRoom(updated);
      if (updated.sync_error?.error === 'no_device') {
        setDeviceWarning(true);
      } else {
        setDeviceWarning(false);
      }
    } catch (e) {
      console.error('Failed to sync playback:', e);
    } finally {
      setSyncing(false);
    }
  };

  const handleUpdateSettings = async (newSettings) => {
    try {
      const updated = await api.updateSettings(roomId, newSettings);
      setRoom(updated);
    } catch (e) {
      console.error('Failed to update room settings:', e);
    }
  };

  const handleLeave = () => {
    intentionalLeave.current = true;
    if (socketRef.current) {
      socketRef.current.emit('leave_room', { room_id: roomId });
    }
    navigate('/lobby');
  };

  if (error) {
    return (
      <div className="room-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <div style={{ textAlign: 'center' }}>
          <p style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{error}</p>
          <button className="btn-secondary" onClick={() => navigate('/lobby')}>Back to Lobby</button>
        </div>
      </div>
    );
  }

  if (!room) {
    return (
      <div className="room-page" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
        <p>Loading room...</p>
      </div>
    );
  }

  const isHost = user?.spotify_user_id === room.host_id;
  const participants = room.participants || {};
  const queue = room.queue || [];
  const currentTrack = room.current_track_info;

  return (
    <div className="room-page">
      <div className="room-header">
        <div>
          <h1>Fellow<span style={{ color: '#4ade80' }}>Sync</span></h1>
          <div className="room-modes">
            {room.hear_me_out && <span className="mode-badge hear-me-out">🎤 Hear Me Out</span>}
            {room.max_consecutive > 0 && <span className="mode-badge">Max {room.max_consecutive} in a row</span>}
          </div>
        </div>
        <div className="room-header-actions">
          <span className="room-code" onClick={handleCopyCode}>
            {copied ? '✓ Copied' : roomId}
          </span>
          <button className="btn-secondary" onClick={handleLeave} style={{ padding: '8px 14px', fontSize: '0.85rem' }}>
            Leave
          </button>
        </div>
      </div>

      {/* Now Playing */}
      <div className="now-playing">
        <button
          className="btn-sync"
          onClick={handleSync}
          disabled={syncing || !room.is_playing}
        >
          {syncing ? 'Syncing...' : 'Sync!'}
        </button>
        <div className="now-playing-content">
          {currentTrack?.album_art ? (
            <img className="now-playing-art" src={currentTrack.album_art} alt={currentTrack.name} />
          ) : (
            <div className="now-playing-art-placeholder">🎵</div>
          )}
          <div className="now-playing-info">
            <h3>{currentTrack ? currentTrack.name : 'Nothing playing'}</h3>
            <p>{currentTrack ? currentTrack.artist : 'Add tracks to the queue to get started'}</p>
            {currentTrack?.queued_by && (
              <p style={{ fontSize: '0.8rem', color: 'var(--green)', marginTop: '2px' }}>
                Added by {currentTrack.queued_by}
              </p>
            )}
            {isHost && (
              <div className="playback-controls">
                {room.is_playing ? (
                  <button className="btn-secondary" onClick={handlePause}>⏸ Pause</button>
                ) : (
                  <button className="btn-primary" onClick={handlePlay} disabled={!currentTrack && queue.length === 0}>
                    ▶ Play
                  </button>
                )}
                <button className="btn-secondary" onClick={handleSkip} disabled={queue.length === 0 && !currentTrack}>
                  ⏭ Skip
                </button>
              </div>
            )}
            {!isHost && currentTrack && (
              <div className="playback-controls">
                <button
                  className={`btn-secondary${room.skip_votes?.includes(user?.spotify_user_id) ? ' voted' : ''}`}
                  onClick={handleSkip}
                >
                  ⏭ Vote Skip {room.skip_votes?.length > 0 && `(${room.skip_votes.length}/${Math.ceil(Object.keys(participants).length * 0.5)})`}
                </button>
              </div>
            )}
            {deviceWarning && (
              <div className="no-device-warning">
                ⚠️ No active Spotify device found. Open Spotify on any device and play something briefly, then try again.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="room-grid">
        {/* Left column: Search + Queue */}
        <div>
          {/* Search */}
          <div className="panel" style={{ marginBottom: '1.5rem' }}>
            <h2>Add Track</h2>
            <div className="search-box">
              <input
                type="text"
                placeholder="Search Spotify..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
              />
            </div>
            {searching && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>Searching...</p>}
            {queueError && <p className="queue-error">{queueError}</p>}
            {searchResults.length > 0 && (
              <ul className="search-results">
                {searchResults.map((track) => (
                  <li key={track.uri} className="search-item">
                    {track.album_art && <img src={track.album_art} alt="" />}
                    <div className="search-item-info">
                      <div className="track-name">{track.name}</div>
                      <div className="track-artist">{track.artist}</div>
                    </div>
                    <button className="btn-add" onClick={() => handleAddTrack(track)}>+ Add</button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Queue */}
          <div className="panel">
            <h2>
              Queue
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                {queue.length} track{queue.length !== 1 ? 's' : ''}
              </span>
            </h2>
            {queue.length === 0 ? (
              <p className="queue-empty">Queue is empty. Search and add tracks above.</p>
            ) : (
              <ul className="queue-list">
                {queue.map((track, i) => (
                  <li key={`${track.uri}-${i}`} className="queue-item">
                    {track.album_art && <img src={track.album_art} alt="" />}
                    <div className="queue-item-info">
                      <div className="track-name">{track.name}</div>
                      <div className="track-artist">{track.artist}</div>
                    </div>
                    {track.queued_by && (
                      <span className="queued-by">Added by {track.queued_by}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Right column: Participants + Help */}
        <div style={{ alignSelf: 'start' }}>
          <div className="panel">
            <h2>
              Listeners
              <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                {Object.keys(participants).length}
              </span>
            </h2>
            <ul className="participants-list">
              {Object.entries(participants).map(([uid, name]) => (
                <li key={uid} className="participant">
                  <img className="participant-avatar" src={getAvatarForUser(uid)} alt="" />
                  <span>{name}</span>
                  {uid === room.host_id && <span className="host-badge">Host</span>}
                </li>
              ))}
            </ul>
          </div>
          {isHost && (
            <div className="panel" style={{ marginTop: '1.5rem' }}>
              <h2>⚙ Settings</h2>
              <div className="room-settings">
                <div className="setting-row">
                  <label>Mode</label>
                  <select
                    value={room.hear_me_out ? 'hear_me_out' : 'normal'}
                    onChange={(e) => handleUpdateSettings({ hear_me_out: e.target.value === 'hear_me_out' })}
                  >
                    <option value="normal">Normal</option>
                    <option value="hear_me_out">Hear Me Out</option>
                  </select>
                </div>
                <div className="setting-row">
                  <label>Max in a row</label>
                  <select
                    value={room.max_consecutive || 0}
                    onChange={(e) => handleUpdateSettings({ max_consecutive: Number(e.target.value) })}
                  >
                    <option value={0}>Unlimited</option>
                    <option value={1}>1</option>
                    <option value={2}>2</option>
                    <option value={3}>3</option>
                  </select>
                </div>
              </div>
            </div>
          )}
          <HelpModal />
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '1.5rem 0 0.5rem', opacity: 0.4 }}>
        <img src="/logo.png" alt="FellowSync" style={{ maxWidth: 100, height: 'auto' }} />
      </div>
      <Footer />
    </div>
  );
}
