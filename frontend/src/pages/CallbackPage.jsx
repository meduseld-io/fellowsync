import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function CallbackPage() {
  const [params] = useSearchParams();
  const { handleCallback } = useAuth();
  const navigate = useNavigate();
  const called = useRef(false);

  useEffect(() => {
    if (called.current) return;
    called.current = true;

    const code = params.get('code');
    if (!code) {
      console.error('No authorization code in callback URL');
      navigate('/');
      return;
    }

    handleCallback(code).then((user) => {
      navigate(user ? '/lobby' : '/');
    });
  }, [params, handleCallback, navigate]);

  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}>
      <p>Connecting to Spotify...</p>
    </div>
  );
}
