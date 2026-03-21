import { useState, useEffect } from 'react';
import './InstallBanner.css';

function isIosSafari() {
  const ua = navigator.userAgent;
  const isIos = /iP(hone|od|ad)/.test(ua);
  const isWebkit = /WebKit/.test(ua);
  const isChrome = /CriOS/.test(ua);
  const isFirefox = /FxiOS/.test(ua);
  return isIos && isWebkit && !isChrome && !isFirefox;
}

function isStandalone() {
  return window.navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
}

export default function InstallBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (isStandalone()) return;
    if (!isIosSafari()) return;
    const dismissed = sessionStorage.getItem('fs_install_dismissed');
    if (dismissed) return;
    setVisible(true);
  }, []);

  const dismiss = () => {
    sessionStorage.setItem('fs_install_dismissed', '1');
    setVisible(false);
  };

  if (!visible) return null;

  return (
    <div className="install-banner">
      <button className="install-banner-close" onClick={dismiss} aria-label="Dismiss">✕</button>
      <p>
        Install FellowSync: tap{' '}
        <span className="install-share-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </span>
        {' '}then "Add to Home Screen"
      </p>
    </div>
  );
}
