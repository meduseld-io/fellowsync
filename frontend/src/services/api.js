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
    console.error(`API request failed [${path}]:`, e);
    throw e;
  }
}

export const api = {
  getLoginUrl: (groupId) => request(`/api/auth/login${groupId ? `?group_id=${groupId}` : ''}`),
  exchangeCode: (code) => request('/api/auth/callback', { method: 'POST', body: JSON.stringify({ code }) }),
  getMe: () => request('/api/auth/me'),
  logout: () => request('/api/auth/logout', { method: 'POST' }),

  createRoom: (options = {}) => request('/api/rooms', { method: 'POST', body: JSON.stringify(options) }),
  getRoom: (roomId) => request(`/api/rooms/${roomId}`),
  joinRoom: (roomId) => request(`/api/rooms/${roomId}/join`, { method: 'POST' }),
  addToQueue: (roomId, track, playNext = false) => request(`/api/rooms/${roomId}/queue`, { method: 'POST', body: JSON.stringify({ track, play_next: playNext }) }),
  removeFromQueue: (roomId, index) => request(`/api/rooms/${roomId}/queue/${index}`, { method: 'DELETE' }),
  reorderQueue: (roomId, fromIndex, toIndex) => request(`/api/rooms/${roomId}/queue/reorder`, { method: 'PUT', body: JSON.stringify({ from_index: fromIndex, to_index: toIndex }) }),
  clearQueue: (roomId) => request(`/api/rooms/${roomId}/queue`, { method: 'DELETE' }),
  shuffleQueue: (roomId) => request(`/api/rooms/${roomId}/queue/shuffle`, { method: 'POST' }),
  skipTrack: (roomId) => request(`/api/rooms/${roomId}/skip`, { method: 'POST' }),
  play: (roomId) => request(`/api/rooms/${roomId}/play`, { method: 'POST' }),
  pause: (roomId) => request(`/api/rooms/${roomId}/pause`, { method: 'POST' }),
  sync: (roomId) => request(`/api/rooms/${roomId}/sync`, { method: 'POST' }),
  updateSettings: (roomId, settings) => request(`/api/rooms/${roomId}/settings`, { method: 'PUT', body: JSON.stringify(settings) }),
  promoteHost: (roomId, userId) => request(`/api/rooms/${roomId}/promote`, { method: 'POST', body: JSON.stringify({ user_id: userId }) }),
  search: (q, type = 'track') => request(`/api/search?q=${encodeURIComponent(q)}&type=${type}`),

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

  // Groups (BYOK)
  createGroup: (name, clientId, clientSecret) => request('/api/groups', { method: 'POST', body: JSON.stringify({ name, client_id: clientId, client_secret: clientSecret }) }),
  getMyGroup: () => request('/api/groups/me'),
  joinGroup: (groupId) => request(`/api/groups/${groupId}/join`, { method: 'POST' }),
  leaveGroup: (groupId) => request(`/api/groups/${groupId}/leave`, { method: 'POST' }),
  updateGroupCredentials: (groupId, clientId, clientSecret) => request(`/api/groups/${groupId}/credentials`, { method: 'PUT', body: JSON.stringify({ client_id: clientId, client_secret: clientSecret }) }),
  getGroupMembers: (groupId) => request(`/api/groups/${groupId}/members`),
  adminListGroups: () => request('/api/admin/groups'),
  adminDeleteGroup: (groupId) => request(`/api/admin/groups/${groupId}`, { method: 'DELETE' }),
};
