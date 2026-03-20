import { isAdmin } from './admin';

export const AVATAR_COLORS = ['green', 'pink', 'yellow', 'purple', 'blue'];

/** All valid colors including admin-only ones */
const ALL_COLORS = [...AVATAR_COLORS, 'dev'];

export const AVATAR_HEX = {
  green: '#4ade80',
  pink: '#ff6eb4',
  yellow: '#facc15',
  purple: '#b78aff',
  blue: '#47b5ff',
  dev: '#ff8c00',
};

/**
 * Deterministically pick an avatar based on a user ID string.
 * - For the current user: uses localStorage override
 * - For other users: uses avatarsMap from backend if available
 * - Fallback: deterministic hash-based assignment
 */
export function getAvatarForUser(userId, avatarsMap) {
  // If we have a backend-provided avatar for this user, use it
  if (avatarsMap && avatarsMap[userId]) {
    const color = avatarsMap[userId];
    if (ALL_COLORS.includes(color)) return `/avatars/${color}.png`;
  }
  // localStorage is only for the current user (set via setAvatarOverride)
  // but we don't know who "current" is here, so check localStorage
  // and it will match because only the current user sets it
  const override = localStorage.getItem('fellowsync_avatar');
  if (override && ALL_COLORS.includes(override)) {
    return `/avatars/${override}.png`;
  }
  if (isAdmin(userId)) return '/avatars/dev.png';
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return `/avatars/${AVATAR_COLORS[index]}.png`;
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
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
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
  import('../services/api.js').then(({ api }) => {
    api.setAvatar(color).catch((e) => console.error('Failed to save avatar to backend:', e));
  });
}

/**
 * Get the list of avatar colors available in the picker.
 * Admin users get the exclusive red option.
 */
export function getPickerColors(isAdminUser) {
  return isAdminUser ? [...AVATAR_COLORS, 'dev'] : AVATAR_COLORS;
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
