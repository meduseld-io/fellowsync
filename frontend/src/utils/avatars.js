import { isAdmin } from './admin';
import { api } from '../services/api.js';

export const AVATAR_COLORS = [
  'green', 'pink', 'yellow', 'purple', 'blue',
  'bee', 'bunny', 'cloud', 'devil',
  'moon', 'mush', 'pump', 'rasp', 'strawb', 'sun',
];

/** All valid colors including admin-only ones */
const ALL_COLORS = [...AVATAR_COLORS, 'dev', 'king'];

export const AVATAR_HEX = {
  green: '#4ade80',
  pink: '#ff6eb4',
  yellow: '#facc15',
  purple: '#b78aff',
  blue: '#47b5ff',
  bee: '#f5a623',
  bunny: '#e8b4d8',
  cloud: '#a8d8ea',
  devil: '#e74c3c',
  king: '#b78aff',
  moon: '#c4b5fd',
  mush: '#d35d6e',
  pump: '#f97316',
  rasp: '#e11d48',
  strawb: '#ff4d6d',
  sun: '#ffb347',
  dev: '#ff8c00',
};

/**
 * Deterministically pick an avatar based on a user ID string.
 * - When avatarsMap is provided (room context): use backend data, fall back to hash
 * - When avatarsMap is NOT provided (lobby/self): use localStorage override, fall back to hash
 */
export function getAvatarForUser(userId, avatarsMap) {
  // Room context: use backend-provided avatars only
  if (avatarsMap) {
    if (avatarsMap[userId]) {
      const color = avatarsMap[userId];
      if (ALL_COLORS.includes(color)) return `/avatars/${color}.png`;
    }
    // No backend avatar for this user — use deterministic hash (not localStorage)
    if (isAdmin(userId)) return '/avatars/dev.png';
    return `/avatars/${_hashColor(userId)}.png`;
  }
  // No avatarsMap (lobby/self context): use localStorage override
  const override = localStorage.getItem('fellowsync_avatar');
  if (override && ALL_COLORS.includes(override)) {
    return `/avatars/${override}.png`;
  }
  if (isAdmin(userId)) return '/avatars/dev.png';
  return `/avatars/${_hashColor(userId)}.png`;
}

function _hashColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

/**
 * Get the current avatar color name for a user.
 */
export function getAvatarColor(userId) {
  const override = localStorage.getItem('fellowsync_avatar');
  if (override && ALL_COLORS.includes(override)) {
    return override;
  }
  if (isAdmin(userId)) return 'dev';
  return _hashColor(userId);
}

export function setAvatarOverride(color) {
  if (ALL_COLORS.includes(color)) {
    localStorage.setItem('fellowsync_avatar', color);
    setFavicon(color);
    document.documentElement.style.setProperty('--fella-color', AVATAR_HEX[color] || '#4ade80');
  }
}

/**
 * Save avatar choice to the backend (fire-and-forget).
 */
export function saveAvatarToBackend(color) {
  api.setAvatar(color).catch((e) => console.error('Failed to save avatar to backend:', e));
}

/**
 * Get the list of avatar colors available in the picker.
 * Admin users get the exclusive red option.
 */
export function getPickerColors(isAdminUser) {
  return isAdminUser ? [...AVATAR_COLORS, 'king', 'dev'] : AVATAR_COLORS;
}

export function setFavicon(color) {
  const link = document.getElementById('favicon');
  if (!link) return;
  const img = new Image();
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext('2d');
    const scale = Math.min(32 / img.width, 32 / img.height);
    const w = img.width * scale;
    const h = img.height * scale;
    ctx.drawImage(img, (32 - w) / 2, (32 - h) / 2, w, h);
    link.href = canvas.toDataURL('image/png');
  };
  img.src = `/avatars/${color}.png`;
}
