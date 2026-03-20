const AVATARS = ['green', 'pink', 'yellow', 'orange', 'purple', 'blue'];

/**
 * Deterministically pick an avatar based on a user ID string.
 * Same user always gets the same character.
 */
export function getAvatarForUser(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash |= 0;
  }
  const index = Math.abs(hash) % AVATARS.length;
  return `/avatars/${AVATARS[index]}.png`;
}
