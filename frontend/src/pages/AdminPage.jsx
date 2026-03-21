import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import Footer from '../components/Footer';
import { isAdmin } from '../utils/admin';
import './AdminPage.css';

export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [rooms, setRooms] = useState([]);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const from = searchParams.get('from');
  const fromRoomId = searchParams.get('roomId');

  const admin = user && isAdmin(user.spotify_user_id);

  useEffect(() => {
    if (!admin) {
      navigate('/lobby');
      return;
    }
    document.title = 'FellowSync - Admin';
    loadRooms();
    loadGroups();
  }, [admin]);

  const loadRooms = async () => {
    setLoading(true);
    try {
      const data = await api.adminListRooms();
      setRooms(data.rooms || []);
    } catch (e) {
      console.error('Failed to load admin rooms:', e);
      setError('Failed to load rooms');
    } finally {
      setLoading(false);
    }
  };

  const loadGroups = async () => {
    try {
      const data = await api.adminListGroups();
      setGroups(data.groups || []);
    } catch (e) {
      console.error('Failed to load admin groups:', e);
    }
  };

  const handleDelete = async (roomId) => {
    if (!confirm(`Delete room ${roomId}?`)) return;
    try {
      await api.adminDeleteRoom(roomId);
      setRooms(rooms.filter(r => r.room_id !== roomId));
    } catch (e) {
      console.error('Failed to delete room:', e);
    }
  };

  const handleDeleteAll = async () => {
    if (!confirm(`Delete all ${rooms.length} rooms?`)) return;
    try {
      await api.adminDeleteAllRooms();
      setRooms([]);
    } catch (e) {
      console.error('Failed to delete all rooms:', e);
    }
  };

  const handleDeleteGroup = async (groupId) => {
    if (!confirm(`Delete group ${groupId}?`)) return;
    try {
      await api.adminDeleteGroup(groupId);
      setGroups(groups.filter(g => g.id !== groupId));
    } catch (e) {
      console.error('Failed to delete group:', e);
    }
  };

  const handleJoinRoom = async (roomId) => {
    try {
      await api.joinRoom(roomId);
      navigate(`/room/${roomId}`);
    } catch (e) {
      console.error('Failed to join room:', e);
    }
  };

  const handleBack = () => {
    if (from === 'room' && fromRoomId) {
      navigate(`/room/${fromRoomId}`);
    } else {
      navigate('/lobby');
    }
  };

  if (!admin) return null;

  return (
    <div className="admin-page">
      <div className="admin-card">
        <div className="admin-header">
          <h1>Fellow<span style={{ color: 'var(--fella-color)' }}>Sync</span> Admin</h1>
          <div className="admin-nav">
            <button className="btn-secondary" onClick={handleBack}>
              {from === 'room' && fromRoomId ? 'Back to Room' : 'Back to Lobby'}
            </button>
            <button className="btn-secondary" onClick={loadRooms} disabled={loading}>Refresh</button>
          </div>
        </div>

        <h2>
          Active Rooms <span className="room-count">{rooms.length}</span>
          {rooms.length > 0 && (
            <button className="btn-delete-room" style={{ marginLeft: 'auto' }} onClick={handleDeleteAll}>Delete All</button>
          )}
        </h2>

        {loading && <p className="admin-muted">Loading...</p>}
        {error && <p className="admin-error">{error}</p>}
        {!loading && rooms.length === 0 && <p className="admin-muted">No active rooms</p>}

        {rooms.map(room => (
          <div key={room.room_id} className="admin-room">
            <div className="admin-room-header">
              <span className="admin-room-code">{room.room_id}</span>
              <span className={`admin-room-status ${room.is_playing ? 'playing' : 'idle'}`}>
                {room.is_playing ? '▶ Playing' : '⏸ Idle'}
              </span>
              <button className="btn-join-room" onClick={() => handleJoinRoom(room.room_id)}>Join</button>
              <button className="btn-delete-room" onClick={() => handleDelete(room.room_id)}>Delete</button>
            </div>
            <div className="admin-room-details">
              <span>👥 {room.participant_count} listener{room.participant_count !== 1 ? 's' : ''}</span>
              <span>🎵 {room.queue_length} in queue</span>
              {room.hear_me_out && <span className="admin-badge hmo">Hear Me Out</span>}
              {room.max_consecutive > 0 && <span className="admin-badge">Max {room.max_consecutive}</span>}
            </div>
            {room.current_track && <div className="admin-room-track">Now: {room.current_track}</div>}
            <div className="admin-room-participants">
              {Object.entries(room.participants).map(([uid, name]) => (
                <span key={uid} className={`admin-participant${uid === room.host_id ? ' host' : ''}`}>
                  {name}{uid === room.host_id ? ' ★' : ''}
                </span>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="admin-card" style={{ marginTop: '1rem' }}>
        <h2>
          BYOK Groups <span className="room-count">{groups.length}</span>
        </h2>
        {groups.length === 0 && <p className="admin-muted">No groups</p>}
        {groups.map(group => (
          <div key={group.id} className="admin-room">
            <div className="admin-room-header">
              <span className="admin-room-code">{group.name}</span>
              <span className="admin-muted" style={{ fontSize: '0.75rem' }}>{group.id}</span>
              <button className="btn-delete-room" onClick={() => handleDeleteGroup(group.id)}>Delete</button>
            </div>
            <div className="admin-room-details">
              <span>👥 {group.member_count}/5</span>
              <span>👑 {group.leader_name}</span>
              <span className="admin-muted" style={{ fontSize: '0.75rem' }}>App: {group.client_id?.slice(0, 12)}...</span>
            </div>
          </div>
        ))}
      </div>

      <div className="admin-footer-actions">
        <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" className="admin-link-btn">
          Spotify Developer Dashboard
        </a>
        <a href="https://github.com/meduseld-io/fellowsync" target="_blank" rel="noreferrer" className="admin-link-btn">
          GitHub Repo
        </a>
      </div>
      <Footer />
    </div>
  );
}
