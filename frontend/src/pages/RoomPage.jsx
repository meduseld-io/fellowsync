import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
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
  const searchTimeout = useRef(null);
  const socketRef = useRef(null);
  const prevParticipantsRef = useRef({});

  const intentionalLeave = useRef(false);

  // Scroll to top on mount
  useEffect(() => {
    window.scrollTo(0, 0);
    document.title = 'FellowSync - Room';
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
        // Toast for participant changes
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
    }
  };

  const handlePromote = async (userId) => {
    try {
      const updated = await api.promoteHost(roomId, userId);
      setRoom(updated);
    } catch (e) {
      console.error('Failed to promote user to host:', e);
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
  const participantAvatars = room.participant_avatars || {};
  const queue = room.queue || [];
  const currentTrack = room.current_track_info;

  return (
    <div className="room-page">
      <ToastContainer />
      <div className="room-header">
        <div>
          <h1>Fellow<span style={{ color: 'var(--fella-color)' }}>Sync</span></h1>
          <div className="room-modes">
            {room.hear_me_out && <span className="mode-badge hear-me-out">🎤 Hear Me Out</span>}
            {room.max_consecutive > 0 && <span className="mode-badge">Max {room.max_consecutive} in a row</span>}
          </div>
        </div>
        <div className="room-header-actions">
          {isAdmin(user?.spotify_user_id) && (
            <Link to="/admin" className="btn-admin">Admin</Link>
          )}
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
                  ⏭<span className="btn-label"> Vote Skip</span> {room.skip_votes?.length > 0 && `(${room.skip_votes.length}/${Math.ceil(Object.keys(participants).length * 0.5)})`}
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
                  <li
                    key={`${track.uri}-${i}`}
                    className={`queue-item${dragIndex === i ? ' dragging' : ''}`}
                    draggable={isHost}
                    onDragStart={isHost ? () => handleDragStart(i) : undefined}
                    onDragOver={isHost ? (e) => handleDragOver(e, i) : undefined}
                    onDrop={isHost ? (e) => handleDrop(e, i) : undefined}
                    onDragEnd={isHost ? handleDragEnd : undefined}
                  >
                    {isHost && <span className="drag-handle">⠿</span>}
                    {track.album_art && <img src={track.album_art} alt="" />}
                    <div className="queue-item-info">
                      <div className="track-name">{track.name}</div>
                      <div className="track-artist">{track.artist}</div>
                    </div>
                    {(isHost || track.queued_by_id === user?.spotify_user_id) && (
                      <button className="btn-remove" onClick={() => handleRemoveTrack(i)}>✕</button>
                    )}
                    {track.queued_by && (
                      <span className="queued-by">
                        {track.play_next ? `Plays next · ${track.queued_by}` : `Added by ${track.queued_by}`}
                      </span>
                    )}
                  </li>
                ))}
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
