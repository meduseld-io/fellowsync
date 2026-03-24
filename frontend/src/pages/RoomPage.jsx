import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, useLocation, Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import { getSocket } from '../services/socket';
import HelpModal from '../components/HelpModal';
import Footer from '../components/Footer';
import ToastContainer, { showToast } from '../components/Toast';
import { getAvatarForUser } from '../utils/avatars';
import { isAdmin } from '../utils/admin';
import './RoomPage.css';

export default function RoomPage() {
  const { roomId } = useParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [room, setRoom] = useState(null);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [copied, setCopied] = useState(false);
  const [deviceWarning, setDeviceWarning] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [queueError, setQueueError] = useState('');
  const [searchFilter, setSearchFilter] = useState('track');
  const [dragIndex, setDragIndex] = useState(null);
  const [vibeInput, setVibeInput] = useState('');
  const [showHostTransfer, setShowHostTransfer] = useState(false);
  const [activityLog, setActivityLog] = useState([]);
  const [showActivity, setShowActivity] = useState(false);
  const [playlistUrl, setPlaylistUrl] = useState('');
  const [floatingEmojis, setFloatingEmojis] = useState([]);
  const [stats, setStats] = useState(null);
  const [showStats, setShowStats] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [progressMs, setProgressMs] = useState(0);
  const searchTimeout = useRef(null);
  const vibeTimeout = useRef(null);
  const socketRef = useRef(null);
  const prevParticipantsRef = useRef({});

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = 'FellowSync - Room';
    if (location.state?.warning) {
      showToast(location.state.warning);
      // Clear the state so it doesn't re-show on re-render
      window.history.replaceState({}, '');
    }
  }, []);

  // Load room and connect socket
  useEffect(() => {
    let mounted = true;

    async function init() {
      try {
        const data = await api.getRoom(roomId);
        if (mounted) {
          prevParticipantsRef.current = data.participants || {};
          setRoom(data);
        }
      } catch (e) {
        console.error('Failed to load room:', e);
        if (mounted) setError('Room not found');
        return;
      }

      const socket = getSocket();
      socketRef.current = socket;
      socket.emit('join_room', { room_id: roomId });

      socket.on('room_state', (state) => {
        if (!mounted) return;
        const prev = prevParticipantsRef.current;
        const next = state.participants || {};
        Object.keys(next).forEach((uid) => {
          if (!prev[uid]) showToast(`${next[uid]} joined the room`);
        });
        Object.keys(prev).forEach((uid) => {
          if (!next[uid]) showToast(`${prev[uid]} left the room`);
        });
        prevParticipantsRef.current = next;
        setRoom(state);
      });
      socket.on('playback_sync', (state) => { if (mounted) setRoom(state); });
      socket.on('queue_updated', (state) => {
        if (!mounted) return;
        setRoom(state);
      });
      socket.on('error', (data) => console.error('Socket error:', data.message));
    }

    init();

    return () => {
      mounted = false;
      if (socketRef.current) {
        // Always leave the socket room on unmount to stop receiving broadcasts
        socketRef.current.emit('leave_room', { room_id: roomId });
        socketRef.current.off('room_state');
        socketRef.current.off('playback_sync');
        socketRef.current.off('queue_updated');
        socketRef.current.off('error');
      }
    };
  }, [roomId]);

  // Tick progress bar every second
  useEffect(() => {
    if (!room?.is_playing || !room?.current_track_info?.duration_ms) {
      setProgressMs(room?.position_ms || 0);
      return;
    }
    // Calculate current position from server state
    const calc = () => {
      const elapsed = (Date.now() / 1000 - room.last_update) * 1000;
      return Math.min(room.position_ms + elapsed, room.current_track_info.duration_ms);
    };
    setProgressMs(calc());
    const id = setInterval(() => setProgressMs(calc()), 1000);
    return () => clearInterval(id);
  }, [room?.position_ms, room?.last_update, room?.is_playing, room?.current_track_info?.duration_ms]);

  // Sync vibe input from room state (when another host sets it or on initial load)
  useEffect(() => {
    if (room?.vibe !== undefined && !vibeTimeout.current) {
      setVibeInput(room.vibe || '');
    }
  }, [room?.vibe]);

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
        const data = await api.search(query, searchFilter);
        setSearchResults(data.tracks || []);
      } catch (e) {
        console.error('Search failed:', e);
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, [searchFilter]);

  const handleAddTrack = async (track, playNext = false) => {
    setQueueError('');
    try {
      const updated = await api.addToQueue(roomId, track, playNext);
      setRoom(updated);
      setSearchQuery('');
      setSearchResults([]);
      showToast(`${track.name} added to queue`);
    } catch (e) {
      console.error('Failed to add track to queue:', e);
      if (e.message && e.message.includes('consecutive')) {
        setQueueError(e.message);
        setTimeout(() => setQueueError(''), 5000);
      }
    }
  };

  const handleClearQueue = async () => {
    try {
      const updated = await api.clearQueue(roomId);
      setRoom(updated);
      showToast('Queue cleared');
    } catch (e) {
      console.error('Failed to clear queue:', e);
    }
  };

  const handleShuffleQueue = async () => {
    try {
      const updated = await api.shuffleQueue(roomId);
      setRoom(updated);
      showToast('Queue shuffled');
    } catch (e) {
      console.error('Failed to shuffle queue:', e);
    }
  };

  const handleRemoveTrack = async (index) => {
    try {
      const trackName = queue[index]?.name || 'Track';
      const updated = await api.removeFromQueue(roomId, index);
      setRoom(updated);
      showToast(`${trackName} removed from queue`);
    } catch (e) {
      console.error('Failed to remove track from queue:', e);
    }
  };

  const handleDragStart = (index) => {
    setDragIndex(index);
  };

  const handleDragOver = (e, index) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === index) return;
  };

  const handleDrop = async (e, toIndex) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === toIndex) {
      setDragIndex(null);
      return;
    }
    try {
      const updated = await api.reorderQueue(roomId, dragIndex, toIndex);
      setRoom(updated);
    } catch (err) {
      console.error('Failed to reorder queue:', err);
    }
    setDragIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
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
      showToast(e.message || 'Failed to update settings');
    }
  };

  const handleVibeChange = (value) => {
    const trimmed = value.slice(0, 50);
    setVibeInput(trimmed);
    if (vibeTimeout.current) clearTimeout(vibeTimeout.current);
    vibeTimeout.current = setTimeout(() => {
      vibeTimeout.current = null;
      handleUpdateSettings({ vibe: trimmed });
    }, 600);
  };

  const handlePromote = async (userId) => {
    try {
      const updated = await api.promoteHost(roomId, userId);
      setRoom(updated);
    } catch (e) {
      console.error('Failed to promote user to host:', e);
    }
  };

  const handleReact = async (emoji) => {
    try {
      const updated = await api.react(roomId, emoji);
      setRoom(updated);
      // Spawn floating emoji animation
      const id = Date.now() + Math.random();
      const drift = Math.round((Math.random() - 0.5) * 40);
      setFloatingEmojis((prev) => [...prev, { id, emoji, drift }]);
      setTimeout(() => setFloatingEmojis((prev) => prev.filter((e) => e.id !== id)), 1500);
    } catch (e) {
      console.error('Failed to react:', e);
    }
  };

  const handleLeave = () => {
    const isCurrentHost = user?.spotify_user_id === room?.host_id;
    const otherParticipants = Object.keys(room?.participants || {}).filter(uid => uid !== user?.spotify_user_id);

    // If host and there are other people, ask them to pick a new host first
    if (isCurrentHost && otherParticipants.length > 0) {
      setShowHostTransfer(true);
      return;
    }

    navigate('/lobby');
  };

  const handleTransferAndLeave = async (newHostId) => {
    try {
      await api.promoteHost(roomId, newHostId);
    } catch (e) {
      console.error('Failed to transfer host before leaving:', e);
    }
    setShowHostTransfer(false);
    navigate('/lobby');
  };

  const fetchActivity = async () => {
    try {
      const data = await api.getActivity(roomId);
      setActivityLog(data.activity || []);
    } catch (e) {
      console.error('Failed to fetch activity log:', e);
    }
  };

  const toggleActivity = () => {
    if (!showActivity) fetchActivity();
    setShowActivity((v) => !v);
  };

  const fetchStats = async () => {
    try {
      const data = await api.getStats(roomId);
      setStats(data.stats || null);
    } catch (e) {
      console.error('Failed to fetch stats:', e);
    }
  };

  const toggleStats = () => {
    if (!showStats) fetchStats();
    setShowStats((v) => !v);
  };

  const formatTime = (ts) => {
    const d = new Date(ts * 1000);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatMs = (ms) => {
    const totalSec = Math.max(0, Math.floor(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
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
  const participantAvatars = room.participant_avatars || {};
  const queue = room.queue || [];
  const currentTrack = room.current_track_info;
  const otherParticipants = Object.entries(participants).filter(([uid]) => uid !== user?.spotify_user_id);

  return (
    <div className="room-page">
      <ToastContainer />

      {/* Host transfer modal */}
      {showHostTransfer && (
        <div className="modal-overlay" onClick={() => setShowHostTransfer(false)}>
          <div className="modal-content host-transfer-modal" onClick={(e) => e.stopPropagation()}>
            <h3>Transfer Host</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
              Choose a new host before leaving the room.
            </p>
            <ul className="host-transfer-list">
              {otherParticipants.map(([uid, name]) => (
                <li key={uid} className="host-transfer-item" onClick={() => handleTransferAndLeave(uid)}>
                  <img className="participant-avatar" src={getAvatarForUser(uid, participantAvatars)} alt="" />
                  <span>{name}</span>
                  {isAdmin(uid) && <span className="dev-badge">Dev</span>}
                </li>
              ))}
            </ul>
            <button className="btn-secondary" onClick={() => setShowHostTransfer(false)} style={{ marginTop: '1rem', width: '100%' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <div className="modal-overlay" onClick={() => setShowSettings(false)}>
          <div className="modal-content settings-modal" onClick={(e) => e.stopPropagation()}>
            <h3>⚙ Room Settings</h3>
            <div className="room-settings">
              <div className="setting-row">
                <label>Mode</label>
                <select
                  value={room.dj_mode ? 'dj' : room.hear_me_out ? 'hear_me_out' : 'normal'}
                  onChange={(e) => {
                    const v = e.target.value;
                    handleUpdateSettings({
                      hear_me_out: v === 'hear_me_out',
                      dj_mode: v === 'dj',
                    });
                  }}
                >
                  <option value="normal">Normal</option>
                  <option value="hear_me_out">Hear Me Out</option>
                  <option value="dj">DJ Mode</option>
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
              <div className="setting-row">
                <label>Skip votes</label>
                <select
                  value={room.skip_threshold || 0.5}
                  onChange={(e) => handleUpdateSettings({ skip_threshold: Number(e.target.value) })}
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
                  value={vibeInput}
                  onChange={(e) => handleVibeChange(e.target.value)}
                  maxLength={50}
                  style={{ flex: 1 }}
                />
              </div>
              <div className="setting-divider" />
              <div className="setting-row">
                <label>Blind Mode</label>
                <button
                  className={`toggle-switch${room.blind_mode ? ' on' : ''}`}
                  onClick={() => handleUpdateSettings({ blind_mode: !room.blind_mode })}
                  role="switch"
                  aria-checked={room.blind_mode}
                />
              </div>
              <div className="setting-row">
                <label>Reactions</label>
                <button
                  className={`toggle-switch${room.reactions_enabled ? ' on' : ''}`}
                  onClick={() => handleUpdateSettings({ reactions_enabled: !room.reactions_enabled })}
                  role="switch"
                  aria-checked={room.reactions_enabled}
                />
              </div>
              <div className="setting-row">
                <label>Session Stats</label>
                <button
                  className={`toggle-switch${room.stats_enabled ? ' on' : ''}`}
                  onClick={() => handleUpdateSettings({ stats_enabled: !room.stats_enabled })}
                  role="switch"
                  aria-checked={room.stats_enabled}
                />
              </div>
              <div className="setting-divider" />
              <div className="setting-row auto-playlist-row">
                <label>Auto-playlist</label>
                <div className="auto-playlist-input">
                  <input
                    type="text"
                    placeholder="Paste Spotify playlist URL..."
                    value={playlistUrl}
                    onChange={(e) => setPlaylistUrl(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <button
                    className="btn-add"
                    onClick={() => {
                      handleUpdateSettings({ auto_playlist_url: playlistUrl });
                      setPlaylistUrl('');
                    }}
                    disabled={!playlistUrl.trim()}
                    style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                  >
                    Set
                  </button>
                </div>
                {room.auto_playlist_name && (
                  <div className="auto-playlist-status">
                    <span>📋 {room.auto_playlist_name} ({room.auto_playlist?.length || 0} tracks, #{(room.auto_playlist_index || 0) + 1} next)</span>
                    <button
                      className="btn-remove"
                      onClick={() => handleUpdateSettings({ auto_playlist_url: '' })}
                      style={{ fontSize: '0.7rem', padding: '2px 6px', position: 'static', opacity: 1, width: 'auto', height: 'auto' }}
                    >
                      ✕
                    </button>
                  </div>
                )}
              </div>
            </div>
            <button className="btn-secondary" onClick={() => setShowSettings(false)} style={{ marginTop: '1.25rem', width: '100%' }}>
              Done
            </button>
          </div>
        </div>
      )}

      <div className="room-header">
        <div>
          <h1>Fellow<span style={{ color: 'var(--fella-color)' }}>Sync</span></h1>
          <div className="room-code-row">
            <span className="room-code" onClick={handleCopyCode}>
              {copied ? '✓ Copied' : roomId}
            </span>
            <button
              className="btn-share"
              onClick={() => {
                const url = `${window.location.origin}/join/${roomId}`;
                navigator.clipboard.writeText(url).then(() => {
                  showToast('Room link copied to clipboard');
                }).catch((e) => {
                  console.error('Failed to copy share link:', e);
                });
              }}
            >
              🔗
            </button>
          </div>
          <div className="room-modes">
            {room.hear_me_out && <span className="mode-badge hear-me-out" data-tooltip="Songs alternate between users so everyone gets a turn">🎤 Hear Me Out</span>}
            {room.max_consecutive > 0 && <span className="mode-badge" data-tooltip={`Limits how many songs one person can queue in a row (${room.max_consecutive})`}>Max {room.max_consecutive} in a row</span>}
            {room.vibe && <span className="mode-badge vibe-badge" data-tooltip="The vibe the host has set for this room">🎶 {room.vibe}</span>}
            {room.dj_mode && <span className="mode-badge dj-badge" data-tooltip="Only the host can add songs">🎧 DJ Mode</span>}
            {room.blind_mode && <span className="mode-badge blind-badge" data-tooltip="Upcoming songs are hidden until they play">🙈 Blind Mode</span>}
          </div>
        </div>
        <div className="room-header-actions">
          {isAdmin(user?.spotify_user_id) && (
            <Link to={`/admin?from=room&roomId=${roomId}`} className="btn-admin">Admin</Link>
          )}
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
            <h3>
              {currentTrack ? (
                currentTrack.spotify_url ? (
                  <a href={currentTrack.spotify_url} target="_blank" rel="noopener noreferrer" className="now-playing-link">{currentTrack.name}</a>
                ) : currentTrack.name
              ) : 'Nothing playing'}
            </h3>
            <p>{currentTrack ? currentTrack.artist : 'Add tracks to the queue to get started'}</p>
            {currentTrack?.queued_by && (
              <p style={{ fontSize: '0.8rem', color: 'var(--fella-color)', marginTop: '2px' }}>
                Added by {currentTrack.queued_by}
              </p>
            )}
            {isHost && (
              <div className="playback-controls">
                {room.is_playing ? (
                  <button className="btn-secondary" onClick={handlePause}>⏸<span className="btn-label"> Pause</span></button>
                ) : (
                  <button className="btn-primary" onClick={handlePlay} disabled={!currentTrack && queue.length === 0}>
                    ▶<span className="btn-label"> Play</span>
                  </button>
                )}
                <button className="btn-secondary" onClick={handleSkip} disabled={queue.length === 0 && !currentTrack}>
                  ⏭<span className="btn-label"> Skip</span>
                </button>
              </div>
            )}
            {!isHost && currentTrack && (
              <div className="playback-controls">
                <button
                  className={`btn-secondary${room.skip_votes?.includes(user?.spotify_user_id) ? ' voted' : ''}`}
                  onClick={handleSkip}
                >
                  ⏭<span className="btn-label"> Vote Skip</span> {room.skip_votes?.length > 0 && `(${room.skip_votes.length}/${Math.ceil(Object.keys(participants).length * (room.skip_threshold || 0.5))})`}
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
        {currentTrack?.duration_ms && (
          <div className="progress-bar-wrap">
            <span className="progress-time">{formatMs(progressMs)}</span>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${Math.min(100, (progressMs / currentTrack.duration_ms) * 100)}%` }}
              />
            </div>
            <span className="progress-time">{formatMs(currentTrack.duration_ms)}</span>
          </div>
        )}
        {room.reactions_enabled && currentTrack && (
          <div className="reactions-bar">
            {floatingEmojis.map((fe) => (
              <span key={fe.id} className="floating-emoji" style={{ '--drift': `${fe.drift}px` }}>{fe.emoji}</span>
            ))}
            {['🔥', '❤️', '😴', '💀', '😂'].map((emoji) => {
              const voters = room.reactions?.[emoji] || [];
              const voted = voters.includes(user?.spotify_user_id);
              return (
                <button
                  key={emoji}
                  className={`reaction-btn${voted ? ' reacted' : ''}`}
                  onClick={() => handleReact(emoji)}
                >
                  {emoji} {voters.length > 0 && <span className="reaction-count">{voters.length}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="room-grid">
        {/* Left column: Search + Queue */}
        <div>
          {/* Search */}
          {room.dj_mode && !isHost ? (
            <div className="panel" style={{ marginBottom: '1.5rem' }}>
              <h2>Add Track</h2>
              <p className="dj-mode-notice">🎧 DJ Mode is on — only the host can add tracks.</p>
            </div>
          ) : (
          <div className="panel" style={{ marginBottom: '1.5rem' }}>
            <h2>Add Track</h2>
            <div className="search-filters">
              {['track', 'artist', 'album'].map((type) => (
                <button
                  key={type}
                  className={`search-filter-btn${searchFilter === type ? ' active' : ''}`}
                  onClick={() => { setSearchFilter(type); if (searchQuery.trim()) handleSearch(searchQuery); }}
                >
                  {type.charAt(0).toUpperCase() + type.slice(1)}
                </button>
              ))}
            </div>
            <div className="search-box">
              <input
                type="text"
                placeholder={`Search by ${searchFilter}...`}
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
                    <div className="search-item-actions">
                      <button className="btn-add-next" onClick={() => handleAddTrack(track, true)}>▶ Next</button>
                      <button className="btn-add" onClick={() => handleAddTrack(track)}>+ Add</button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          )}

          {/* Queue */}
          <div className="panel">
            <h2>
              Queue
              {isHost && queue.length > 0 ? (
                <span className="queue-actions">
                  <span className="queue-action-btn shuffle" onClick={handleShuffleQueue}>🔀</span>
                  <span className="queue-count-clear" onClick={handleClearQueue}>
                    <span className="queue-count-text">{queue.length} track{queue.length !== 1 ? 's' : ''}</span>
                    <span className="queue-clear-text">Clear queue</span>
                  </span>
                </span>
              ) : (
                <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                  {queue.length} track{queue.length !== 1 ? 's' : ''}
                </span>
              )}
            </h2>
            {queue.length === 0 ? (
              <p className="queue-empty">Queue is empty. Search and add tracks above.</p>
            ) : (
              <ul className="queue-list">
                {queue.map((track, i) => {
                  const masked = room.blind_mode && !isHost;
                  return (
                  <li
                    key={`${track.uri}-${i}`}
                    className={`queue-item${dragIndex === i ? ' dragging' : ''}${masked ? ' blind-item' : ''}`}
                    draggable={isHost}
                    onDragStart={isHost ? () => handleDragStart(i) : undefined}
                    onDragOver={isHost ? (e) => handleDragOver(e, i) : undefined}
                    onDrop={isHost ? (e) => handleDrop(e, i) : undefined}
                    onDragEnd={isHost ? handleDragEnd : undefined}
                  >
                    {isHost && <span className="drag-handle">⠿</span>}
                    {masked ? (
                      <div className="blind-art-placeholder">?</div>
                    ) : (
                      track.album_art && <img src={track.album_art} alt="" />
                    )}
                    <div className="queue-item-info">
                      <div className="track-name">{masked ? '???' : track.name}</div>
                      <div className="track-artist">{masked ? '???' : track.artist}</div>
                    </div>
                    {!masked && (isHost || track.queued_by_id === user?.spotify_user_id) && (
                      <button className="btn-remove" onClick={() => handleRemoveTrack(i)}>✕</button>
                    )}
                    {track.queued_by && !masked && (
                      <span className="queued-by">
                        {track.play_next ? `Plays next · ${track.queued_by}` : `Added by ${track.queued_by}`}
                      </span>
                    )}
                  </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>

        {/* Right column: Last Played + Participants + Help */}
        <div style={{ alignSelf: 'start' }}>
          {room.last_track_info && (
            <div className="panel last-played-panel" style={{ marginBottom: '1.5rem' }}>
              <h2>Last Played</h2>
              <div className="last-played-content">
                {room.last_track_info.album_art && (
                  <img className="last-played-art" src={room.last_track_info.album_art} alt="" />
                )}
                <div className="last-played-info">
                  <div className="track-name">{room.last_track_info.name}</div>
                  <div className="track-artist">{room.last_track_info.artist}</div>
                  {room.last_track_info.queued_by && (
                    <div className="last-played-by">Added by {room.last_track_info.queued_by}</div>
                  )}
                </div>
              </div>
            </div>
          )}
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
                  <img className="participant-avatar" src={getAvatarForUser(uid, participantAvatars)} alt="" />
                  <span>{name}</span>
                  {uid === room.host_id && <span className="host-badge">Host</span>}
                  {isAdmin(uid) && <span className="dev-badge">Dev</span>}
                  {isHost && uid !== room.host_id && (
                    <button className="btn-promote" onClick={() => handlePromote(uid)}>
                      Make Host
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
          {(isHost || isAdmin(user?.spotify_user_id)) && (
            <div className="panel" style={{ marginTop: '1.5rem' }}>
              <h2 className="activity-header" onClick={toggleActivity} style={{ cursor: 'pointer', userSelect: 'none' }}>
                📋 Activity
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                  {showActivity ? '▾' : '▸'}
                </span>
              </h2>
              {showActivity && (
                <div className="activity-log">
                  {activityLog.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>No activity yet</p>
                  ) : (
                    <ul className="activity-list">
                      {[...activityLog].reverse().map((entry, i) => (
                        <li key={i} className="activity-entry">
                          <span className="activity-time">{formatTime(entry.ts)}</span>
                          <span className="activity-user">{entry.user}</span>
                          <span className="activity-action">{entry.action}</span>
                          {entry.detail && <span className="activity-detail">{entry.detail}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                  <button className="btn-secondary" onClick={fetchActivity} style={{ marginTop: '0.5rem', width: '100%', fontSize: '0.78rem', padding: '4px' }}>
                    Refresh
                  </button>
                </div>
              )}
            </div>
          )}
          {room.stats_enabled && (
            <div className="panel" style={{ marginTop: '1.5rem' }}>
              <h2 className="activity-header" onClick={toggleStats} style={{ cursor: 'pointer', userSelect: 'none' }}>
                📊 Session Stats
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                  {showStats ? '▾' : '▸'}
                </span>
              </h2>
              {showStats && stats && (
                <div className="stats-panel">
                  <div className="stat-row">
                    <span className="stat-label">Tracks played</span>
                    <span className="stat-value">{stats.tracks_played}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Skips</span>
                    <span className="stat-value">{stats.skips} {stats.vote_skips > 0 && `(${stats.vote_skips} by vote)`}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Session time</span>
                    <span className="stat-value">{(() => {
                      const mins = Math.floor((Date.now() / 1000 - stats.started_at) / 60);
                      return mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}h ${mins % 60}m`;
                    })()}</span>
                  </div>
                  {Object.keys(stats.queued_by_count).length > 0 && (
                    <>
                      <div className="stat-divider" />
                      <div className="stat-label" style={{ marginBottom: '4px' }}>Top queuers</div>
                      {Object.entries(stats.queued_by_count)
                        .sort(([, a], [, b]) => b - a)
                        .map(([uid, count]) => (
                          <div key={uid} className="stat-row">
                            <span className="stat-user">{stats.user_names[uid] || uid}</span>
                            <span className="stat-value">{count} track{count !== 1 ? 's' : ''}</span>
                          </div>
                        ))}
                    </>
                  )}
                  {room.reactions_enabled && stats.reaction_counts && Object.keys(stats.reaction_counts).length > 0 && (
                    <>
                      <div className="stat-divider" />
                      <div className="stat-label" style={{ marginBottom: '4px' }}>Reactions</div>
                      <div className="stat-row" style={{ flexWrap: 'wrap', gap: '6px' }}>
                        {Object.entries(stats.reaction_counts)
                          .sort(([, a], [, b]) => b - a)
                          .map(([emoji, count]) => (
                            <span key={emoji} className="stat-reaction">{emoji} {count}</span>
                          ))}
                      </div>
                    </>
                  )}
                  <button className="btn-secondary" onClick={fetchStats} style={{ marginTop: '0.5rem', width: '100%', fontSize: '0.78rem', padding: '4px' }}>
                    Refresh
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="room-footer-actions">
            {isHost && (
              <button className="btn-settings-open" onClick={() => setShowSettings(true)} style={{ width: '100%' }}>
                ⚙ Settings
              </button>
            )}
            <HelpModal />
          </div>
        </div>
      </div>

      <div style={{ textAlign: 'center', padding: '1.5rem 0 0.5rem', opacity: 0.4 }}>
        <img src="/logo.png" alt="FellowSync" style={{ maxWidth: 100, height: 'auto' }} />
      </div>
      <Footer />
    </div>
  );
}
