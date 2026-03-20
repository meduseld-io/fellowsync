export const AVATAR_COLORS = ['green', 'pink', 'yellow', 'purple', 'blue'];

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
  }
}
