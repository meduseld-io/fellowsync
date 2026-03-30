import { useState, useEffect } from 'react';
import './Footer.css';

export default function Footer() {
  const [version, setVersion] = useState('loading...');
  const [releaseUrl, setReleaseUrl] = useState('https://github.com/meduseld-io/fellowsync/releases');

  useEffect(() => {
    fetch('https://api.github.com/repos/meduseld-io/fellowsync/releases/latest')
      .then(res => {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(data => {
        if (data.tag_name) {
          setVersion(data.tag_name);
          setReleaseUrl(data.html_url);
        }
      })
      .catch(err => {
        console.error('Failed to fetch latest FellowSync release version:', err);
        setVersion('v0.1.0');
      });
  }, []);

  return (
    <footer className="fs-footer">
      <p>
        &copy; {new Date().getFullYear()}{' '}
        <a href="https://github.com/meduseld-io" target="_blank" rel="noreferrer">meduseld.io</a>
      </p>
      <p>
        <a href={releaseUrl} target="_blank" rel="noreferrer">{version}</a>
      </p>
    </footer>
  );
}
