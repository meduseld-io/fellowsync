import { useAuth } from '../context/AuthContext';
import Footer from '../components/Footer';
import './LoginPage.css';

export default function LoginPage() {
  const { login } = useAuth();

  return (
    <div className="login-page">
      <div className="login-card">
        <img src="/logo.png" alt="FellowSync" style={{ maxWidth: 320, width: '80%', height: 'auto', marginBottom: '1rem' }} />
        <h1>Fellow<span style={{ color: 'var(--fella-color)' }}>Sync</span></h1>
        <p>Listen together with friends using Spotify.</p>
        <button className="btn-spotify" onClick={login}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381C8.64 5.801 15.6 6.06 20.04 8.82c.54.3.72 1.02.42 1.56-.3.42-1.02.6-1.56.3z"/>
          </svg>
          Login with Spotify
        </button>
      </div>
      <Footer />
    </div>
  );
}
