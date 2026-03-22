import { useState, useEffect } from 'react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import './GroupPanel.css';

export default function GroupPanel() {
  const { user, login } = useAuth();
  const [group, setGroup] = useState(null);
  const [members, setMembers] = useState({});
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showJoin, setShowJoin] = useState(false);
  const [error, setError] = useState('');

  // Create form
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [creating, setCreating] = useState(false);

  // Join form
  const [joinId, setJoinId] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    loadGroup();
  }, []);

  const loadGroup = async () => {
    try {
      const data = await api.getMyGroup();
      setGroup(data.group);
      setMembers(data.members || {});
    } catch (e) {
      console.error('Failed to load group:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !clientId.trim() || !clientSecret.trim()) {
      setError('All fields are required');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const data = await api.createGroup(name.trim(), clientId.trim(), clientSecret.trim());
      setGroup(data.group);
      setMembers({ [user.spotify_user_id]: user.display_name });
      setShowCreate(false);
      setName('');
      setClientId('');
      setClientSecret('');
    } catch (e) {
      console.error('Failed to create group:', e);
      setError(e.message || 'Failed to create sync');
    } finally {
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    if (!joinId.trim()) return;
    setJoining(true);
    setError('');
    try {
      const data = await api.joinGroup(joinId.trim());
      setGroup(data.group);
      setMembers(data.members || {});
      setShowJoin(false);
      setJoinId('');
    } catch (e) {
      console.error('Failed to join group:', e);
      setError(e.message || 'Sync not found or full');
    } finally {
      setJoining(false);
    }
  };

  const handleLeave = async () => {
    if (!group) return;
    try {
      await api.leaveGroup(group.id);
      setGroup(null);
      setMembers({});
    } catch (e) {
      console.error('Failed to leave group:', e);
    }
  };

  const handleReauth = () => {
    if (!group) return;
    login(group.id);
  };

  if (loading) return null;

  // User is in a group
  if (group) {
    const isAuthed = user?.group_id === group.id;
    const memberList = Object.entries(members);

    return (
      <div className="group-panel">
        <div className="group-info">
          <span className="group-name">👥 {group.name}</span>
          <span className="group-count">{group.member_count}/5</span>
        </div>
        <div className="group-id-row">
          <span className="group-id-label">ID:</span>
          <code className="group-id-code">{group.id}</code>
        </div>
        {memberList.length > 0 && (
          <div className="group-members">
            {memberList.map(([uid, name]) => (
              <span key={uid} className={`group-member${uid === group.leader_id ? ' leader' : ''}`}>
                {name}{uid === group.leader_id ? ' ★' : ''}
              </span>
            ))}
          </div>
        )}
        {!isAuthed && (
          <button className="btn-group-reauth" onClick={handleReauth}>
            Re-login with sync credentials
          </button>
        )}
        <div className="group-actions">
          <button className="btn-group-leave" onClick={handleLeave}>
            Leave Sync
          </button>
        </div>
      </div>
    );
  }

  // No group — show create/join options
  return (
    <div className="group-panel">
      {error && <p className="group-error">{error}</p>}

      {!showCreate && !showJoin && (
        <div className="group-options">
          <p className="group-hint">Bring your own Spotify app for your friend group (5 users per app)</p>
          <div className="group-btn-row">
            <button className="btn-group" onClick={() => { setShowCreate(true); setError(''); }}>Create Sync</button>
            <button className="btn-group" onClick={() => { setShowJoin(true); setError(''); }}>Join Sync</button>
          </div>
        </div>
      )}

      {showCreate && (
        <div className="group-form">
          <h4>Create a Sync</h4>
          <input type="text" placeholder="Sync name" value={name} onChange={(e) => setName(e.target.value.slice(0, 50))} maxLength={50} />
          <input type="text" placeholder="Spotify Client ID" value={clientId} onChange={(e) => setClientId(e.target.value)} />
          <input type="password" placeholder="Spotify Client Secret" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} />
          <p className="group-form-hint">
            Create a Spotify app at <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer">developer.spotify.com</a>
          </p>
          <div className="group-btn-row">
            <button className="btn-group" onClick={handleCreate} disabled={creating}>{creating ? 'Creating...' : 'Create'}</button>
            <button className="btn-group-cancel" onClick={() => { setShowCreate(false); setError(''); }}>Cancel</button>
          </div>
        </div>
      )}

      {showJoin && (
        <div className="group-form">
          <h4>Join a Sync</h4>
          <input type="text" placeholder="Sync ID" value={joinId} onChange={(e) => setJoinId(e.target.value)} />
          <div className="group-btn-row">
            <button className="btn-group" onClick={handleJoin} disabled={joining}>{joining ? 'Joining...' : 'Join'}</button>
            <button className="btn-group-cancel" onClick={() => { setShowJoin(false); setError(''); }}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
