import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import Footer from '../components/Footer';
import { isAdmin } from '../utils/admin';
import './AdminPage.css';

export default function AdminPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const admin = user && isAdmin(user.spotify_user_id);

  useEffect(() => {
    if (!admin) {
      navigate('/lobby');
      return;
    }
    loadRooms();
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

  const handleDelete = async (roomId) => {
    if (!confirm(`Delete room ${roomId}?`)) return;
    try {
      await api.adminDeleteRoom(roomId);
      setRooms(rooms.filter(r => r.room_id !== roomId));
    } catch (e) {
      console.error('Failed to delete room:', e);
    }
  };

  if (!admin) return null;

  return (
    <div className="admin-page">
      <div className="admin-card">
        <h1>Fellow<span style={{ color: 'var(--fella-color)' }}>Sync</span> Admin</h1>

        <div className="admin-links">
          <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noreferrer" className="admin-link-btn">
            Spotify Developer Dashboard
          </a>
          <a href="https://github.com/meduseld-io/fellowsync" target="_blank" rel="noreferrer" className="admin-link-btn">
            GitHub Repo
          </a>
        </div>

        <h2>Active Rooms <span className="room-count">{rooms.length}</span></h2>

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

      <div className="admin-footer-actions">
        <button className="btn-secondary" onClick={() => navigate('/lobby')}>Back to Lobby</button>
        <button className="btn-secondary" onClick={loadRooms} disabled={loading}>Refresh</button>
      </div>
      <Footer />
    </div>
  );
}
