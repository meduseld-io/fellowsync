import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import { api } from '../services/api';
import Footer from '../components/Footer';
import InstallBanner from '../components/InstallBanner';
import './LoginPage.css';

export default function LoginPage() {
  const { login } = useAuth();
  const [requireByok, setRequireByok] = useState(null);
  const [view, setView] = useState('main'); // main, create, join
  const [error, setError] = useState('');
  const [showContact, setShowContact] = useState(false);

  // Create form
  const [name, setName] = useState('');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [creating, setCreating] = useState(false);

  // Join form
  const [joinId, setJoinId] = useState('');
  const [joining, setJoining] = useState(false);

  useEffect(() => { document.title = 'FellowSync - Login'; }, []);

  useEffect(() => {
    api.getAuthConfig()
      .then((data) => setRequireByok(data.require_byok))
      .catch((e) => {
        console.error('Failed to load auth config:', e);
        setRequireByok(false);
      });
  }, []);

  const handleCreate = async () => {
    if (!name.trim() || !clientId.trim() || !clientSecret.trim()) {
      setError('All fields are required');
      return;
    }
    setCreating(true);
    setError('');
    try {
      const data = await api.createGroup(name.trim(), clientId.trim(), clientSecret.trim());
      // Sync created — now login through it
      login(data.group.id);
    } catch (e) {
      console.error('Failed to create group:', e);
      setError(e.message || 'Failed to create sync');
      setCreating(false);
    }
  };

  const handleJoin = async () => {
    if (!joinId.trim()) return;
    setJoining(true);
    setError('');
    try {
      const data = await api.joinGroup(joinId.trim());
      // Joined — now login through the sync
      login(data.group.id);
    } catch (e) {
      console.error('Failed to join group:', e);
      setError(e.message || 'Sync not found or full');
      setJoining(false);
    }
  };

  // Loading config
  if (requireByok === null) {
    return (
      <div className="login-page">
        <div className="login-card">
          <img src="/logo.png" alt="FellowSync" style={{ maxWidth: 320, width: '80%', height: 'auto', marginBottom: '1rem' }} />
          <p style={{ color: 'var(--text-muted)' }}>Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/logo.png" alt="FellowSync" style={{ maxWidth: 320, width: '80%', height: 'auto', marginBottom: '1rem' }} />
        <h1>Fellow<span style={{ color: 'var(--fella-color)' }}>Sync</span></h1>
        <p>One does not simply listen alone...</p>

        {error && <p className="login-error">{error}</p>}

        {view === 'main' && (
          <>
            {requireByok ? (
              <div className="byok-section">
                <p className="byok-hint">
                  Each sync needs their own Spotify app.
                  One person creates a sync, up to 5 others join with the sync ID.
                </p>
                <div className="byok-buttons">
                  <button className="btn-spotify" onClick={() => { setView('create'); setError(''); }}>
                    Create a Sync
                  </button>
                  <button className="btn-join-group" onClick={() => { setView('join'); setError(''); }}>
                    Join a Sync
                  </button>
                </div>
                <button className="btn-direct-login" onClick={() => login()}>
                  I already have access
                </button>
              </div>
            ) : (
              <button className="btn-spotify" onClick={() => login()}>
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381C8.64 5.801 15.6 6.06 20.04 8.82c.54.3.72 1.02.42 1.56-.3.42-1.02.6-1.56.3z"/>
                </svg>
                Login with Spotify
              </button>
            )}
          </>
        )}

        {view === 'create' && (
          <div className="byok-form">
            <h3>Create a Sync</h3>
            <p className="byok-form-hint">
              Create a free Spotify app at{' '}
              <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer">
                developer.spotify.com
              </a>
              <br />
              Set the redirect URI to: <code>{window.location.origin}/callback</code>
            </p>
            <input
              type="text"
              placeholder="Sync name (e.g. The Fellowship)"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 50))}
              maxLength={50}
            />
            <input
              type="text"
              placeholder="Spotify Client ID"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            />
            <input
              type="password"
              placeholder="Spotify Client Secret"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
            />
            <button className="btn-spotify" onClick={handleCreate} disabled={creating}>
              {creating ? 'Creating...' : 'Create & Login'}
            </button>
            <button className="btn-back" onClick={() => { setView('main'); setError(''); }}>Back</button>
          </div>
        )}

        {view === 'join' && (
          <div className="byok-form">
            <h3>Join a Sync</h3>
            <p className="byok-form-hint">Ask your sync leader for the sync ID.</p>
            <input
              type="text"
              placeholder="Sync ID"
              value={joinId}
              onChange={(e) => setJoinId(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleJoin()}
            />
            <button className="btn-spotify" onClick={handleJoin} disabled={joining}>
              {joining ? 'Joining...' : 'Join & Login'}
            </button>
            <button className="btn-back" onClick={() => { setView('main'); setError(''); }}>Back</button>
          </div>
        )}
        <button className="btn-contact" onClick={() => setShowContact(true)}>Contact</button>
        {showContact && (
          <div className="help-overlay" onClick={() => setShowContact(false)}>
            <div className="contact-modal" onClick={(e) => e.stopPropagation()}>
              <p>Questions, issues, or feedback?</p>
              <a href="mailto:404@meduseld.io" className="btn-spotify" style={{ textDecoration: 'none' }}>
                ✉ 404@meduseld.io
              </a>
            </div>
          </div>
        )}
      </div>
      <Footer />
      <InstallBanner />
    </div>
  );
}
