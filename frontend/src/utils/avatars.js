export const AVATAR_COLORS = ['green', 'pink', 'yellow', 'purple', 'blue'];

export const AVATAR_HEX = {
  green: '#4ade80',
  pink: '#ff6eb4',
  yellow: '#facc15',
  purple: '#b78aff',
  blue: '#47b5ff',
};

/**
 * Deterministically pick an avatar based on a user ID string.
 * Checks localStorage for a user override first.
 */
export function getAvatarForUser(userId) {
  const override = localStorage.getItem('fellowsync_avatar');
  if (override && AVATAR_COLORS.includes(override)) {
    return `/avatars/${override}.png`;
  }
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
  if (override && AVATAR_COLORS.includes(override)) {
    return override;
  }
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATAR_COLORS.length;
  return AVATAR_COLORS[index];
}

export function setAvatarOverride(color) {
  if (AVATAR_COLORS.includes(color)) {
    localStorage.setItem('fellowsync_avatar', color);
    setFavicon(color);
    document.documentElement.style.setProperty('--fella-color', AVATAR_HEX[color] || '#4ade80');
  }
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
