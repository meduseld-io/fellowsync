const BASE = '';

async function request(path, options = {}) {
  try {
    const res = await fetch(`${BASE}${path}`, {
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', ...options.headers },
      ...options,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
  } catch (e) {
    console.error('API request failed [%s]:', path, e);
    throw e;
  }
}

export const api = {
  getLoginUrl: (groupId) => request(`/api/auth/login${groupId ? `?group_id=${groupId}` : ''}`),
  exchangeCode: (code) => request('/api/auth/callback', { method: 'POST', body: JSON.stringify({ code }) }),
  getMe: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  getAuthConfig: () => request('/api/auth/config'),

  createRoom: (options = {}) => request('/api/rooms', { method: 'POST', body: JSON.stringify(options) }),
  getRoom: (roomId) => request(`/api/rooms/${roomId}`),
  joinRoom: (roomId) => request(`/api/rooms/${roomId}/join`, { method: 'POST' }),
  addToQueue: (roomId, track, playNext = false) => request(`/api/rooms/${roomId}/queue`, { method: 'POST', body: JSON.stringify({ track, play_next: playNext }) }),
  removeFromQueue: (roomId, index) => request(`/api/rooms/${roomId}/queue/${index}`, { method: 'DELETE' }),
  reorderQueue: (roomId, fromIndex, toIndex) => request(`/api/rooms/${roomId}/queue/reorder`, { method: 'PUT', body: JSON.stringify({ from_index: fromIndex, to_index: toIndex }) }),
  clearQueue: (roomId) => request(`/api/rooms/${roomId}/queue`, { method: 'DELETE' }),
  shuffleQueue: (roomId) => request(`/api/rooms/${roomId}/queue/shuffle`, { method: 'POST' }),
  reorderAutoPlaylist: (roomId, fromIndex, toIndex) => request(`/api/rooms/${roomId}/auto-playlist/reorder`, { method: 'PUT', body: JSON.stringify({ from_index: fromIndex, to_index: toIndex }) }),
  shuffleAutoPlaylist: (roomId) => request(`/api/rooms/${roomId}/auto-playlist/shuffle`, { method: 'POST' }),
  addAutoPlaylistToQueue: (roomId, playlistIndex) => request(`/api/rooms/${roomId}/auto-playlist/add-to-queue`, { method: 'POST', body: JSON.stringify({ playlist_index: playlistIndex }) }),
  skipTrack: (roomId) => request(`/api/rooms/${roomId}/skip`, { method: 'POST' }),
  restartTrack: (roomId) => request(`/api/rooms/${roomId}/restart`, { method: 'POST' }),
  play: (roomId) => request(`/api/rooms/${roomId}/play`, { method: 'POST' }),
  pause: (roomId) => request(`/api/rooms/${roomId}/pause`, { method: 'POST' }),
  sync: (roomId) => request(`/api/rooms/${roomId}/sync`, { method: 'POST' }),
  updateSettings: (roomId, settings) => request(`/api/rooms/${roomId}/settings`, { method: 'PUT', body: JSON.stringify(settings) }),
  promoteHost: (roomId, userId) => request(`/api/rooms/${roomId}/promote`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  search: (q, type = 'track') => request(`/api/search?q=${encodeURIComponent(q)}&type=${type}`),
  getPlaylistTracks: (playlistId) => request(`/api/playlist/${playlistId}/tracks`),

  // Admin
  adminListRooms: () => request('/api/admin/rooms'),
  adminDeleteRoom: (roomId) => request(`/api/admin/rooms/${roomId}`, { method: 'DELETE' }),
  adminDeleteAllRooms: () => request('/api/admin/rooms', { method: 'DELETE' }),

  // Activity
  getActivity: (roomId) => request(`/api/rooms/${roomId}/activity`),

  // Reactions
  react: (roomId, emoji) => request(`/api/rooms/${roomId}/react`, { method: 'POST', body: JSON.stringify({ emoji }) }),

  // Stats
  getStats: (roomId) => request(`/api/rooms/${roomId}/stats`),

  // Avatar
  getAvatar: () => request('/api/auth/avatar'),
  setAvatar: (color) => request('/api/auth/avatar', { method: 'PUT', body: JSON.stringify({ color }) }),

  // Display name
  getDisplayName: () => request('/api/auth/display-name'),
  setDisplayName: (display_name) => request('/api/auth/display-name', { method: 'PUT', body: JSON.stringify({ display_name }) }),

  // Groups (BYOK)
  createGroup: (name, clientId, clientSecret) => request('/api/groups', { method: 'POST', body: JSON.stringify({ name, client_id: clientId, client_secret: clientSecret }) }),
  getMyGroup: () => request('/api/groups/me'),
  joinGroup: (groupId) => request(`/api/groups/${groupId}/join`, { method: 'POST' }),
  leaveGroup: (groupId) => request(`/api/groups/${groupId}/leave`, { method: 'POST' }),
  kickGroupMember: (groupId, userId) => request(`/api/groups/${groupId}/kick/${userId}`, { method: 'POST' }),
  updateGroupCredentials: (groupId, clientId, clientSecret) => request(`/api/groups/${groupId}/credentials`, { method: 'PUT', body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }) }),
  getGroupMembers: (groupId) => request(`/api/groups/${groupId}/members`),
  adminListGroups: () => request('/api/admin/groups'),
  adminDeleteGroup: (groupId) => request(`/api/admin/groups/${groupId}`, { method: 'DELETE' }),

  // Badges
  adminSetBadge: (userId, text, color) => request(`/api/admin/badges/${userId}`, { method: 'PUT', body: JSON.stringify({ text, color }) }),
  adminRemoveBadge: (userId) => request(`/api/admin/badges/${userId}`, { method: 'DELETE' }),
  setMyBadge: (text, color) => request('/api/me/badge', { method: 'PUT', body: JSON.stringify({ text, color }) }),
  removeMyBadge: () => request('/api/me/badge', { method: 'DELETE' }),
};
