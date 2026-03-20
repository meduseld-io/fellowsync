export const ADMIN_IDS = ['fs96zb0sif93rl5pfdgbniqig'];

export function isAdmin(userId) {
  return ADMIN_IDS.includes(userId);
}
